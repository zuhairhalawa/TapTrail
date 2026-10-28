import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useI18n, viewerLabels } from '../i18n/I18n';
import { hrefs } from '../router';
import { LIMITS, type Guide, type GuideLang, type Rect, type Step } from '../lib/types';
import {
  addRedaction, addStep, createStep, deleteStep, duplicateStep, moveStep, newId, removeRedaction,
  setHotspot, setInstruction, updateStep,
} from '../lib/guideOps';
import {
  getGuide, getGuideImages, getImage, pruneOrphanImages, putImage, requestPersistence, saveGuide, StorageError,
} from '../lib/storage';
import { bakeRedactions, processUpload } from '../lib/image';
import { downloadBlob, exportHtmlFile, exportProjectFile } from '../lib/projectIO';
import { slugifyFilename } from '../lib/exportHtml';
import { formatBytes } from '../lib/imageType';
import { describeError } from '../components/errors';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { ImageStage, type Tool } from '../components/ImageStage';
import { Icon } from '../components/Icon';
import { btnDanger, btnGhost, btnPrimary, btnSecondary, btnSmall, card, field, label as labelCls } from '../components/ui';

interface ImageEntry {
  url: string;
  width: number;
  height: number;
}
type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

const DEFAULT_HOTSPOT: Rect = { x: 0.3, y: 0.42, w: 0.4, h: 0.14 };
const DEFAULT_COVER: Rect = { x: 0.25, y: 0.4, w: 0.5, h: 0.1 };

export function Editor({ guideId }: { guideId: string }) {
  const { t } = useI18n();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, ImageEntry>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('hotspot');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmBurn, setConfirmBurn] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [exporting, setExporting] = useState<null | 'html' | 'json'>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);
  const guideRef = useRef<Guide | null>(null);
  const savedRef = useRef<Guide | null>(null);
  const latestRef = useRef<Guide | null>(null);
  const savingRef = useRef(false);
  const saveStateRef = useRef<SaveState>('saved');
  const dragIndexRef = useRef<number | null>(null);
  const dragDepth = useRef(0);

  const setSave = (s: SaveState) => {
    saveStateRef.current = s;
    setSaveState(s);
  };

  // ---- Load -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const urls = urlsRef;
    (async () => {
      try {
        const g = await getGuide(guideId);
        if (cancelled) return;
        if (!g) {
          setMissing(true);
          return;
        }
        const stored = await getGuideImages(guideId);
        if (cancelled) return;
        const entries: Record<string, ImageEntry> = {};
        for (const img of stored) {
          const url = URL.createObjectURL(new Blob([img.bytes], { type: img.mime }));
          urls.current.push(url);
          entries[img.id] = { url, width: img.width, height: img.height };
        }
        savedRef.current = g;
        latestRef.current = g;
        guideRef.current = g;
        setImages(entries);
        setGuide(g);
        setSelectedId(g.steps[0]?.id ?? null);
        void pruneOrphanImages(g).catch(() => undefined);
      } catch (e) {
        if (!cancelled) setLoadError(describeError(e, t));
      }
    })();
    return () => {
      cancelled = true;
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideId]);

  // ---- Autosave -----------------------------------------------------------
  const flush = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      while (latestRef.current && latestRef.current !== savedRef.current) {
        const g = latestRef.current;
        setSave('saving');
        await saveGuide(g);
        savedRef.current = g;
        requestPersistence();
      }
      setSave('saved');
      setSaveError(null);
    } catch (e) {
      setSave('error');
      setSaveError(describeError(e, t));
    } finally {
      savingRef.current = false;
    }
  }, [t]);

  useEffect(() => {
    guideRef.current = guide;
    if (!guide || guide === savedRef.current) return;
    latestRef.current = guide;
    if (saveStateRef.current !== 'error') setSave('dirty');
    const timer = setTimeout(() => void flush(), 500);
    return () => clearTimeout(timer);
  }, [guide, flush]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveStateRef.current !== 'saved') {
        void flush();
        e.preventDefault();
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      void flush();
    };
  }, [flush]);

  const update = (fn: (g: Guide) => Guide) => setGuide((g) => (g ? fn(g) : g));

  // ---- Adding screenshots ---------------------------------------------------
  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setBusy(true);
      setNotices([]);
      const problems: string[] = [];
      let added = 0;
      for (const file of files) {
        if ((guideRef.current?.steps.length ?? 0) + added >= LIMITS.maxSteps) {
          problems.push(t('editor.maxSteps', { n: LIMITS.maxSteps }));
          break;
        }
        try {
          const processed = await processUpload(file);
          const imageId = newId();
          await putImage({
            id: imageId,
            guideId,
            mime: processed.mime,
            bytes: await processed.blob.arrayBuffer(),
            width: processed.width,
            height: processed.height,
          });
          const url = URL.createObjectURL(processed.blob);
          urlsRef.current.push(url);
          const step = createStep({ imageId, width: processed.width, height: processed.height });
          setImages((prev) => ({ ...prev, [imageId]: { url, width: processed.width, height: processed.height } }));
          setGuide((g) => (g ? addStep(g, step) : g));
          setSelectedId(step.id);
          added++;
        } catch (e) {
          const name = file.name.slice(0, 60);
          problems.push(`${name}: ${describeError(e, t)}`);
          if (e instanceof StorageError && e.kind === 'quota') break;
        }
      }
      setNotices(problems);
      setBusy(false);
    },
    [guideId, t],
  );

  // Paste screenshots straight from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length > 0) {
        e.preventDefault();
        void addFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const onDrop = (e: DragEvent) => {
    dragDepth.current = 0;
    setDragging(false);
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    void addFiles(Array.from(e.dataTransfer.files));
  };

  // ---- Step operations -------------------------------------------------------
  const steps = guide?.steps ?? [];
  const index = steps.findIndex((s) => s.id === selectedId);
  const step: Step | undefined = steps[index];
  const image = step ? images[step.imageId] : undefined;

  const removeCurrentStep = () => {
    if (!guide || !step) return;
    const next = deleteStep(guide, step.id);
    latestRef.current = next;
    setGuide(next);
    setSelectedId((next.steps[Math.min(index, next.steps.length - 1)] ?? null)?.id ?? null);
    setConfirmDelete(false);
    void flush().then(() => (savedRef.current === next ? pruneOrphanImages(next) : undefined)).catch(() => undefined);
  };

  const duplicateCurrent = async () => {
    if (!guide || !step) return;
    try {
      const stored = await getImage(step.imageId);
      if (!stored) throw new Error('missing image');
      const newImageId = newId();
      await putImage({ ...stored, id: newImageId, bytes: stored.bytes.slice(0) });
      const entry = images[step.imageId];
      if (entry) setImages((prev) => ({ ...prev, [newImageId]: entry }));
      const newStepId = newId();
      update((g) => duplicateStep(g, step.id, newStepId, newImageId));
      setSelectedId(newStepId);
    } catch (e) {
      setNotices([describeError(e, t)]);
    }
  };

  const burnIn = async () => {
    if (!step) return;
    setConfirmBurn(false);
    try {
      const stored = await getImage(step.imageId);
      if (!stored) throw new Error('missing image');
      const baked = await bakeRedactions(new Blob([stored.bytes], { type: stored.mime }), step.redactions);
      await putImage({ ...stored, mime: baked.mime, bytes: await baked.blob.arrayBuffer(), width: baked.width, height: baked.height });
      const url = URL.createObjectURL(baked.blob);
      urlsRef.current.push(url);
      setImages((prev) => ({ ...prev, [step.imageId]: { url, width: baked.width, height: baked.height } }));
      update((g) => updateStep(g, step.id, { redactions: [], width: baked.width, height: baked.height }));
    } catch (e) {
      setNotices([describeError(e, t)]);
    }
  };

  // ---- Export -------------------------------------------------------------------
  const runExport = async (kind: 'html' | 'json') => {
    if (!guide) return;
    setExporting(kind);
    setExportMsg(null);
    try {
      const lookup = (id: string) => getImage(id);
      const base = slugifyFilename(guide.title);
      const blob =
        kind === 'html'
          ? await exportHtmlFile(guide, lookup, viewerLabels(guide.lang))
          : await exportProjectFile(guide, lookup);
      const name = `${base}.${kind === 'html' ? 'html' : 'taptrail.json'}`;
      downloadBlob(blob, name);
      const big = blob.size > 25 * 1024 * 1024 ? ` ${t('export.big')}` : '';
      setExportMsg({ kind: 'ok', text: `${t('export.done', { name, size: formatBytes(blob.size) })}${big}` });
    } catch (e) {
      setExportMsg({ kind: 'error', text: describeError(e, t) });
    } finally {
      setExporting(null);
    }
  };
  // ---- Render ---------------------------------------------------------------------
  if (missing || loadError) {
    return (
      <div className="mx-auto max-w-xl px-5 py-20 text-center">
        <h1 className="font-display text-3xl font-semibold">{missing ? t('editor.notFoundTitle') : t('editor.loadErrorTitle')}</h1>
        <p className="mt-3 text-muted">{missing ? t('editor.notFoundText') : loadError}</p>
        <a href={hrefs.studio} className={`${btnPrimary} mt-6`}>
          {t('editor.backToGuides')}
        </a>
      </div>
    );
  }
  if (!guide) return <p className="px-5 py-20 text-center text-muted">{t('common.loading')}</p>;

  const saveLabel: Record<SaveState, string> = {
    saved: t('editor.saved'),
    dirty: t('editor.unsaved'),
    saving: t('editor.saving'),
    error: t('editor.notSaved'),
  };

  const stepButtons = (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('editor.stepActions')}>
      <button type="button" className={`${btnSecondary} ${btnSmall}`} disabled={index <= 0} onClick={() => update((g) => moveStep(g, index, index - 1))}>
        <Icon name="up" className="size-4" />
        {t('editor.moveUp')}
      </button>
      <button type="button" className={`${btnSecondary} ${btnSmall}`} disabled={index < 0 || index >= steps.length - 1} onClick={() => update((g) => moveStep(g, index, index + 1))}>
        <Icon name="down" className="size-4" />
        {t('editor.moveDown')}
      </button>
      <button type="button" className={`${btnSecondary} ${btnSmall}`} disabled={steps.length >= LIMITS.maxSteps} onClick={() => void duplicateCurrent()}>
        <Icon name="copy" className="size-4" />
        {t('editor.duplicate')}
      </button>
      <button type="button" className={`${btnDanger} ${btnSmall}`} onClick={() => setConfirmDelete(true)}>
        <Icon name="trash" className="size-4" />
        {t('editor.deleteStep')}
      </button>
    </div>
  );

  return (
    <div
      className="mx-auto w-full max-w-[96rem] px-4 py-5 sm:px-6"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={onDrop}
    >
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3">
        <a href={hrefs.studio} className={`${btnGhost} ${btnSmall} -ms-2`}>
          <Icon name="left" className="size-4" flipRtl />
          {t('editor.backToGuides')}
        </a>
        <div className="min-w-48 basis-full sm:basis-auto sm:flex-1">
          <label htmlFor="guide-title" className="sr-only">
            {t('guide.nameLabel')}
          </label>
          <input
            id="guide-title"
            value={guide.title}
            maxLength={LIMITS.maxTitle}
            dir="auto"
            onChange={(e) => update((g) => ({ ...g, title: e.target.value, updatedAt: Date.now() }))}
            onBlur={() => {
              if (guide.title.trim() === '') update((g) => ({ ...g, title: t('guide.untitled') }));
            }}
            className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 font-display text-2xl font-semibold hover:border-line focus:border-line"
          />
        </div>
        <p
          className={`flex items-center gap-1.5 text-sm font-medium ${saveState === 'error' ? 'text-danger' : 'text-muted'}`}
          role="status"
          data-testid="save-status"
          data-state={saveState}
        >
          <Icon name={saveState === 'error' ? 'x' : saveState === 'saved' ? 'check' : 'save'} className="size-4" />
          {saveLabel[saveState]}
        </p>
        <button type="button" className={btnSecondary} onClick={() => setDetailsOpen(true)}>
          {t('editor.details')}
        </button>
        {steps.length > 0 ? (
          <a href={hrefs.preview(guide.id)} className={btnSecondary} onClick={() => void flush()}>
            <Icon name="eye" />
            {t('editor.preview')}
          </a>
        ) : null}
        <button type="button" className={btnPrimary} onClick={() => { setExportMsg(null); setExportOpen(true); }}>
          <Icon name="download" />
          {t('editor.export')}
        </button>
      </div>

      {/* Banners */}
      {saveState === 'error' && saveError && (
        <div role="alert" className="mt-4 rounded-xl border border-danger bg-danger/10 p-4 text-sm">
          <p className="font-semibold">{t('editor.saveFailedTitle')}</p>
          <p className="mt-1">{saveError}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={`${btnSecondary} ${btnSmall}`} onClick={() => void flush()}>
              {t('editor.retrySave')}
            </button>
            <button type="button" className={`${btnSecondary} ${btnSmall}`} onClick={() => void runExport('json')}>
              {t('editor.downloadBackup')}
            </button>
          </div>
        </div>
      )}
      {notices.length > 0 && (
        <div role="alert" className="mt-4 rounded-xl border border-danger bg-danger/10 p-4 text-sm" data-testid="notices">
          <ul className="list-disc space-y-1 ps-5">
            {notices.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          <button type="button" className="mt-2 underline" onClick={() => setNotices([])}>
            {t('common.dismiss')}
          </button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-label={t('editor.fileInputLabel')}
        data-testid="file-input"
        onChange={(e) => {
          void addFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        {/* Step list */}
        <aside aria-label={t('editor.stepsHeading')}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              {t('editor.stepsHeading')} ({steps.length})
            </h2>
          </div>
          <div className="flex gap-2 lg:block">
          <ol className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
            {steps.map((s, i) => {
              const img = images[s.imageId];
              const active = s.id === selectedId;
              return (
                <li
                  key={s.id}
                  draggable
                  onDragStart={(e) => {
                    dragIndexRef.current = i;
                    e.dataTransfer.setData('application/x-taptrail-step', String(i));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    if (dragIndexRef.current !== null) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (dragIndexRef.current === null) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const from = dragIndexRef.current;
                    dragIndexRef.current = null;
                    update((g) => moveStep(g, from, i));
                  }}
                  className="w-28 shrink-0 lg:w-auto"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    aria-current={active ? 'step' : undefined}
                    data-testid="step-item"
                    className={`flex w-full flex-col gap-1.5 rounded-xl border p-1.5 text-start lg:flex-row lg:items-center lg:gap-2 lg:p-2 ${active ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:border-muted'}`}
                  >
                    <span className="block h-14 overflow-hidden rounded-md bg-surface2 lg:h-14 lg:w-10 lg:shrink-0">
                      {img && <img src={img.url} alt="" className="size-full object-cover object-top" draggable={false} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-accent">{t('editor.stepN', { n: i + 1 })}</span>
                      <span className="line-clamp-2 text-[0.8125rem] text-muted" dir="auto">
                        {s.instruction || t('editor.noInstruction')}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <button type="button" className={`${btnSecondary} h-fit shrink-0 flex-col self-start px-3 py-2 text-xs lg:mt-2 lg:w-full lg:flex-row lg:self-auto lg:py-0 lg:text-sm`} onClick={() => fileRef.current?.click()} disabled={busy || steps.length >= LIMITS.maxSteps}>
            <Icon name="plus" />
            {busy ? t('editor.adding') : t('editor.addScreenshots')}
          </button>
        </div>
        </aside>

        {/* Workspace */}
        <section aria-label={t('editor.workspace')} className="min-w-0">
          {steps.length === 0 || !step ? (
            <div className={`${card} grid place-items-center border-dashed px-6 py-20 text-center ${dragging ? 'border-accent bg-accent/10' : ''}`} data-testid="dropzone">
              <span className="grid size-14 place-items-center rounded-2xl bg-accent/12 text-accent">
                <Icon name="upload" className="size-7" />
              </span>
              <h2 className="mt-5 font-display text-2xl font-semibold">{t('editor.emptyTitle')}</h2>
              <p className="mt-2 max-w-md text-muted">{t('editor.emptyText')}</p>
              <button type="button" className={`${btnPrimary} mt-6`} onClick={() => fileRef.current?.click()} disabled={busy}>
                <Icon name="image" />
                {busy ? t('editor.adding') : t('editor.chooseScreenshots')}
              </button>
              <p className="mt-3 text-xs text-muted">{t('editor.formats', { size: LIMITS.maxUploadBytes / 1024 / 1024 })}</p>
            </div>
          ) : (
            <div className={`grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] ${dragging ? 'rounded-2xl outline-2 outline-dashed outline-accent' : ''}`}>
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label={t('editor.tools')}>
                  <button type="button" aria-pressed={tool === 'hotspot'} onClick={() => setTool('hotspot')} className={`${tool === 'hotspot' ? btnPrimary : btnSecondary} ${btnSmall}`}>
                    <Icon name="cursor" className="size-4" />
                    {t('editor.toolHotspot')}
                  </button>
                  <button type="button" aria-pressed={tool === 'redact'} onClick={() => setTool('redact')} className={`${tool === 'redact' ? btnPrimary : btnSecondary} ${btnSmall}`}>
                    <Icon name="redact" className="size-4" />
                    {t('editor.toolRedact')}
                  </button>
                </div>
                <p className="mb-4 text-sm text-muted" data-testid="tool-help">
                  {tool === 'hotspot' ? t('editor.helpHotspot') : t('editor.helpRedact')}
                </p>
                {image ? (
                  <div className="pt-6">
                    <ImageStage
                      key={step.id}
                      imageUrl={image.url}
                      width={image.width}
                      height={image.height}
                      hotspot={step.hotspot}
                      redactions={step.redactions}
                      tool={tool}
                      onHotspot={(r) => update((g) => setHotspot(g, step.id, r))}
                      onRedaction={(i, r) =>
                        update((g) => (r ? updateStep(g, step.id, { redactions: step.redactions.map((x, k) => (k === i ? r : x)) }) : removeRedaction(g, step.id, i)))
                      }
                      onAddRedaction={(r) => update((g) => addRedaction(g, step.id, r))}
                    />
                  </div>
                ) : (
                  <p className="rounded-xl border border-danger p-6 text-center text-danger">{t('editor.imageMissing')}</p>
                )}
              </div>

              <div className="min-w-0 space-y-6">
                <div>
                  <h2 className="font-display text-xl font-semibold">{t('editor.stepOf', { n: index + 1, total: steps.length })}</h2>
                  <div className="mt-3">{stepButtons}</div>
                </div>

                <div>
                  <label htmlFor="instruction" className={labelCls}>
                    {t('editor.instructionLabel')}
                  </label>
                  <textarea
                    id="instruction"
                    value={step.instruction}
                    maxLength={LIMITS.maxInstruction}
                    dir="auto"
                    rows={3}
                    placeholder={t('editor.instructionPlaceholder')}
                    onChange={(e) => update((g) => setInstruction(g, step.id, e.target.value))}
                    className={`${field} resize-y`}
                  />
                  <p className="mt-1 text-xs text-muted"><bdi dir="ltr">{step.instruction.length} / {LIMITS.maxInstruction}</bdi></p>
                </div>

                {tool === 'hotspot' ? (
                  <div>
                    <h3 className="text-sm font-semibold">{t('editor.hotspotHeading')}</h3>
                    <p className="mt-1 text-sm text-muted">{step.hotspot ? t('editor.hotspotSet') : t('editor.hotspotNone')}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {!step.hotspot && (
                        <button type="button" className={`${btnSecondary} ${btnSmall}`} onClick={() => update((g) => setHotspot(g, step.id, DEFAULT_HOTSPOT))}>
                          <Icon name="plus" className="size-4" />
                          {t('editor.addHotspot')}
                        </button>
                      )}
                      {step.hotspot && (
                        <button type="button" className={`${btnSecondary} ${btnSmall}`} onClick={() => update((g) => setHotspot(g, step.id, null))}>
                          <Icon name="trash" className="size-4" />
                          {t('editor.removeHotspot')}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <h3 className="text-sm font-semibold">{t('editor.redactHeading')}</h3>
                    <p className="mt-1 text-sm text-muted">{t('editor.redactNote')}</p>
                    <ul className="mt-3 space-y-2">
                      {step.redactions.map((_, i) => (
                        <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-1.5 text-sm">
                          <span>{t('stage.redactionLabel', { n: i + 1 })}</span>
                          <button type="button" className={`${btnGhost} ${btnSmall} text-danger`} onClick={() => update((g) => removeRedaction(g, step.id, i))}>
                            {t('common.remove')}
                            <span className="sr-only"> {t('stage.redactionLabel', { n: i + 1 })}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className={`${btnSecondary} ${btnSmall}`} onClick={() => update((g) => addRedaction(g, step.id, DEFAULT_COVER))} disabled={step.redactions.length >= LIMITS.maxRedactionsPerStep}>
                        <Icon name="plus" className="size-4" />
                        {t('editor.addCover')}
                      </button>
                      {step.redactions.length > 0 && (
                        <button type="button" className={`${btnSecondary} ${btnSmall}`} onClick={() => setConfirmBurn(true)}>
                          {t('editor.burnIn')}
                        </button>
                      )}
                    </div>
                    <p className="mt-3 rounded-lg bg-surface2 p-3 text-xs text-muted">{t('editor.draftLimit')}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Dialogs */}
      <ConfirmDialog
        open={confirmDelete}
        title={t('editor.deleteStepTitle')}
        message={t('editor.deleteStepText')}
        confirmLabel={t('editor.deleteStep')}
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={removeCurrentStep}
      />
      <ConfirmDialog
        open={confirmBurn}
        title={t('editor.burnTitle')}
        message={t('editor.burnText')}
        confirmLabel={t('editor.burnConfirm')}
        danger
        onCancel={() => setConfirmBurn(false)}
        onConfirm={() => void burnIn()}
      />
      <Dialog open={detailsOpen} title={t('editor.details')} onClose={() => setDetailsOpen(false)} wide>
        <label htmlFor="guide-desc" className={labelCls}>
          {t('guide.descriptionLabel')}
        </label>
        <textarea
          id="guide-desc"
          className={`${field} min-h-24 resize-y`}
          value={guide.description}
          maxLength={LIMITS.maxDescription}
          dir="auto"
          placeholder={t('guide.descriptionPlaceholder')}
          onChange={(e) => update((g) => ({ ...g, description: e.target.value, updatedAt: Date.now() }))}
        />
        <label htmlFor="guide-lang" className={`${labelCls} mt-4`}>
          {t('guide.languageLabel')}
        </label>
        <select
          id="guide-lang"
          className={field}
          value={guide.lang}
          onChange={(e) => update((g) => ({ ...g, lang: e.target.value as GuideLang, updatedAt: Date.now() }))}
        >
          <option value="en">English</option>
          <option value="ar">العربية</option>
        </select>
        <p className="mt-1.5 text-sm text-muted">{t('guide.languageHelp')}</p>
        <div className="mt-6 flex justify-end">
          <button type="button" className={btnPrimary} onClick={() => setDetailsOpen(false)}>
            {t('common.done')}
          </button>
        </div>
      </Dialog>
      <Dialog open={exportOpen} title={t('export.title')} onClose={() => setExportOpen(false)} wide>
        {steps.length === 0 ? (
          <p className="text-muted">{t('export.needSteps')}</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-accent bg-accent/8 p-4">
              <h3 className="font-semibold">{t('export.htmlTitle')}</h3>
              <p className="mt-1 text-sm text-muted">{t('export.htmlText')}</p>
              <button type="button" className={`${btnPrimary} mt-3`} disabled={exporting !== null} onClick={() => void runExport('html')} data-testid="export-html">
                <Icon name="download" />
                {exporting === 'html' ? t('export.working') : t('export.htmlButton')}
              </button>
            </div>
            <div className="rounded-xl border border-line p-4">
              <h3 className="font-semibold">{t('export.jsonTitle')}</h3>
              <p className="mt-1 text-sm text-muted">{t('export.jsonText')}</p>
              <button type="button" className={`${btnSecondary} mt-3`} disabled={exporting !== null} onClick={() => void runExport('json')} data-testid="export-json">
                <Icon name="file" />
                {exporting === 'json' ? t('export.working') : t('export.jsonButton')}
              </button>
            </div>
            <div className="rounded-xl border border-line p-4">
              <h3 className="font-semibold">{t('export.printTitle')}</h3>
              <p className="mt-1 text-sm text-muted">{t('export.printText')}</p>
              <a href={hrefs.preview(guide.id)} className={`${btnSecondary} mt-3`}>
                <Icon name="printer" />
                {t('export.printButton')}
              </a>
            </div>
            <p className="text-xs text-muted">{t('export.privacyNote')}</p>
          </div>
        )}
        {exportMsg && (
          <p role={exportMsg.kind === 'error' ? 'alert' : 'status'} data-testid="export-message" className={`mt-4 rounded-lg p-3 text-sm font-medium ${exportMsg.kind === 'error' ? 'bg-danger/10 text-danger' : 'bg-accent/10'}`}>
            {exportMsg.text}
          </p>
        )}
        <div className="mt-6 flex justify-end">
          <button type="button" className={btnSecondary} onClick={() => setExportOpen(false)}>
            {t('common.close')}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
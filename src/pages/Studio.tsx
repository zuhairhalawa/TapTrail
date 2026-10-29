import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18n';
import { hrefs, navigate } from '../router';
import { createGuide } from '../lib/guideOps';
import { LIMITS, type Guide, type Step } from '../lib/types';
import { deleteGuide, estimateStorage, getImage, listGuides, saveGuide } from '../lib/storage';
import { importProjectText } from '../lib/projectIO';
import { bakeRedactions } from '../lib/image';
import { formatBytes } from '../lib/imageType';
import { describeError } from '../components/errors';
import { ConfirmDialog, GuideFormDialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { btnGhost, btnPrimary, btnSecondary, btnSmall, card, container, eyebrow } from '../components/ui';

/**
 * The picture a card may show for a step. Pending covers are painted into a fresh copy, exactly like
 * Preview and export do, so an unredacted screenshot is never displayed. The stored bytes (the editable
 * draft) are only read here, never written. If covering fails we show nothing rather than the original.
 */
async function thumbnailBlob(step: Step): Promise<Blob | null> {
  const img = await getImage(step.imageId);
  if (!img) return null;
  const stored = new Blob([img.bytes], { type: img.mime });
  if (step.redactions.length === 0) return stored;
  try {
    return (await bakeRedactions(stored, step.redactions)).blob;
  } catch {
    return null;
  }
}

export function Studio({ openNew }: { openNew: boolean }) {
  const { t, lang } = useI18n();
  const [guides, setGuides] = useState<Guide[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [renaming, setRenaming] = useState<Guide | null>(null);
  const [deleting, setDeleting] = useState<Guide | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Object URLs currently shown on the cards. */
  const urlsRef = useRef<string[]>([]);
  /** Bumped by every load and on unmount, so a superseded load can never publish or leak URLs. */
  const loadGen = useRef(0);

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    const fresh: string[] = [];
    const release = (urls: string[]) => urls.forEach((u) => URL.revokeObjectURL(u));
    try {
      const list = await listGuides();
      if (gen !== loadGen.current) return;
      setGuides(list);
      const next: Record<string, string> = {};
      for (const g of list) {
        const first = g.steps[0];
        if (!first) continue;
        const blob = await thumbnailBlob(first);
        if (gen !== loadGen.current) return release(fresh);
        if (blob) {
          const url = URL.createObjectURL(blob);
          fresh.push(url);
          next[g.id] = url;
        }
      }
      const usageNow = await estimateStorage();
      if (gen !== loadGen.current) return release(fresh);
      const old = urlsRef.current;
      urlsRef.current = fresh;
      setThumbs(next);
      setUsage(usageNow);
      release(old);
    } catch (e) {
      release(fresh);
      if (gen !== loadGen.current) return;
      setGuides([]);
      setError(describeError(e, t));
    }
  }, [t]);

  useEffect(() => {
    void load();
    const urls = urlsRef;
    const gen = loadGen;
    return () => {
      gen.current++; // invalidate any load still in flight
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
    };
  }, [load]);

  const create = async (v: { title: string; description: string }) => {
    try {
      const g = createGuide({ ...v, lang });
      await saveGuide(g);
      navigate(hrefs.edit(g.id));
    } catch (e) {
      setError(describeError(e, t));
      navigate(hrefs.studio);
    }
  };

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setNotice(null);
    if (file.size > LIMITS.maxImportFileBytes) {
      setError(t('error.import.too_large'));
      return;
    }
    setBusy(true);
    try {
      const g = await importProjectText(await file.text(), lang);
      setNotice(t('studio.imported', { name: g.title }));
      await load();
    } catch (e) {
      setError(describeError(e, t));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const fmtDate = (ts: number) => new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(ts);

  return (
    <div className={`${container} py-10 sm:py-14`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={eyebrow}>{t('nav.studio')}</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">{t('studio.title')}</h1>
          <p className="mt-2 max-w-xl text-muted">{t('studio.lead')}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            tabIndex={-1}
            aria-label={t('studio.importLabel')}
            data-testid="import-input"
            onChange={(e) => void onImportFile(e.target.files?.[0])}
          />
          <button type="button" className={btnSecondary} disabled={busy} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" />
            {busy ? t('studio.importing') : t('studio.import')}
          </button>
          <a href={hrefs.newGuide} className={btnPrimary}>
            <Icon name="plus" />
            {t('studio.new')}
          </a>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-6 flex items-start justify-between gap-3 rounded-xl border border-danger bg-danger/10 p-4 text-sm font-medium text-fg">
          <span>{error}</span>
          <button type="button" className="shrink-0 underline" onClick={() => setError(null)}>
            {t('common.dismiss')}
          </button>
        </p>
      )}
      {notice && (
        <p role="status" className="mt-6 rounded-xl border border-accent bg-accent/10 p-4 text-sm font-medium">
          {notice}
        </p>
      )}

      {guides === null && <p className="mt-10 text-muted">{t('common.loading')}</p>}

      {guides !== null && guides.length === 0 && (
        <div className={`${card} mt-10 grid place-items-center px-6 py-16 text-center`}>
          <span className="grid size-14 place-items-center rounded-2xl bg-accent/12 text-accent">
            <Icon name="image" className="size-7" />
          </span>
          <h2 className="mt-5 font-display text-2xl font-semibold">{t('studio.emptyTitle')}</h2>
          <p className="mt-2 max-w-md text-muted">{t('studio.emptyText')}</p>
          <a href={hrefs.newGuide} className={`${btnPrimary} mt-6`}>
            <Icon name="plus" />
            {t('studio.new')}
          </a>
        </div>
      )}

      {guides !== null && guides.length > 0 && (
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('studio.title')}>
          {guides.map((g) => (
            <li key={g.id} className={`${card} flex flex-col overflow-hidden`}>
              <a href={hrefs.edit(g.id)} className="block bg-surface2" aria-label={t('studio.open', { name: g.title })} tabIndex={-1}>
                <div className="grid h-44 place-items-center overflow-hidden">
                  {thumbs[g.id] ? (
                    <img src={thumbs[g.id]} alt="" className="h-full w-full object-cover object-top" />
                  ) : (
                    <Icon name="image" className="size-10 text-muted/50" />
                  )}
                </div>
              </a>
              <div className="flex flex-1 flex-col p-5">
                <h2 className="font-display text-xl font-semibold leading-snug" dir="auto">
                  <a href={hrefs.edit(g.id)} className="hover:text-accent">
                    {g.title}
                  </a>
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {t('studio.stepCount', { n: g.steps.length })} · {t('studio.edited', { date: fmtDate(g.updatedAt) })}
                </p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  <a href={hrefs.edit(g.id)} className={`${btnSecondary} ${btnSmall}`}>
                    <Icon name="pencil" className="size-4" />
                    {t('studio.edit')}
                  </a>
                  {g.steps.length > 0 && (
                    <a href={hrefs.preview(g.id)} className={`${btnGhost} ${btnSmall}`}>
                      <Icon name="eye" className="size-4" />
                      {t('studio.preview')}
                    </a>
                  )}
                  <button type="button" className={`${btnGhost} ${btnSmall}`} onClick={() => setRenaming(g)}>
                    {t('common.rename')}
                    <span className="sr-only"> {g.title}</span>
                  </button>
                  <button type="button" className={`${btnGhost} ${btnSmall} text-danger`} onClick={() => setDeleting(g)}>
                    <Icon name="trash" className="size-4" />
                    {t('common.delete')}
                    <span className="sr-only"> {g.title}</span>
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-10 max-w-2xl text-sm text-muted">
        {t('studio.localNote')}
        {usage && ` ${t('studio.usage', { used: formatBytes(usage.usage), total: formatBytes(usage.quota) })}`}
      </p>

      <GuideFormDialog
        open={openNew}
        title={t('studio.newTitle')}
        submitLabel={t('studio.createButton')}
        withDescription
        maxTitle={LIMITS.maxTitle}
        maxDescription={LIMITS.maxDescription}
        onSubmit={(v) => void create(v)}
        onCancel={() => navigate(hrefs.studio)}
      />
      <GuideFormDialog
        open={renaming !== null}
        title={t('studio.renameTitle')}
        submitLabel={t('common.save')}
        initialTitle={renaming?.title}
        maxTitle={LIMITS.maxTitle}
        maxDescription={LIMITS.maxDescription}
        onSubmit={async (v) => {
          if (!renaming) return;
          try {
            await saveGuide({ ...renaming, title: v.title, updatedAt: Date.now() });
            setRenaming(null);
            await load();
          } catch (e) {
            setRenaming(null);
            setError(describeError(e, t));
          }
        }}
        onCancel={() => setRenaming(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={t('studio.deleteTitle')}
        message={t('studio.deleteText', { name: deleting?.title ?? '' })}
        confirmLabel={t('studio.deleteConfirm')}
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteGuide(deleting.id);
          } catch (e) {
            setError(describeError(e, t));
          }
          setDeleting(null);
          await load();
        }}
      />
    </div>
  );
}
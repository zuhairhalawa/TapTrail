import { useEffect, useMemo, useState } from 'react';
import { useI18n, viewerLabels } from '../i18n/I18n';
import { useTheme } from '../theme';
import { hrefs } from '../router';
import type { Guide, ViewerData } from '../lib/types';
import { getGuide, getImage } from '../lib/storage';
import { bakeRedactions } from '../lib/image';
import { downloadBlob, exportHtmlFile } from '../lib/projectIO';
import { slugifyFilename } from '../lib/exportHtml';
import { describeError } from '../components/errors';
import { ViewerHost } from '../components/ViewerHost';
import { Icon } from '../components/Icon';
import { btnPrimary, btnSecondary, container } from '../components/ui';

/** Shows the guide exactly as a reader will see it: redactions are baked into the pixels first. */
export function Preview({ guideId }: { guideId: string }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [data, setData] = useState<ViewerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      try {
        const g = await getGuide(guideId);
        if (!g) {
          setError(t('editor.notFoundText'));
          return;
        }
        const steps = [];
        for (const s of g.steps) {
          const stored = await getImage(s.imageId);
          if (!stored) throw new Error('missing image');
          let blob = new Blob([stored.bytes], { type: stored.mime });
          let { width, height } = stored;
          if (s.redactions.length > 0) {
            const baked = await bakeRedactions(blob, s.redactions);
            blob = baked.blob;
            width = baked.width;
            height = baked.height;
          }
          const url = URL.createObjectURL(blob);
          urls.push(url);
          steps.push({ instruction: s.instruction, image: url, width, height, hotspot: s.hotspot });
        }
        if (cancelled) return;
        setGuide(g);
        setData({ title: g.title, description: g.description, lang: g.lang, steps, labels: viewerLabels(g.lang) });
      } catch (e) {
        if (!cancelled) setError(describeError(e, t));
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideId]);

  const options = useMemo(() => ({ theme }), [theme]);

  const download = async () => {
    if (!guide) return;
    setExporting(true);
    try {
      const blob = await exportHtmlFile(guide, (id) => getImage(id), viewerLabels(guide.lang));
      downloadBlob(blob, `${slugifyFilename(guide.title)}.html`);
    } catch (e) {
      setError(describeError(e, t));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="no-print border-b border-line bg-surface/60">
        <div className={`${container} flex flex-wrap items-center justify-between gap-3 py-3`}>
          <p className="text-sm font-medium text-muted">{t('preview.banner')}</p>
          <div className="flex flex-wrap gap-2">
            <a href={hrefs.edit(guideId)} className={btnSecondary}>
              <Icon name="left" flipRtl />
              {t('preview.backToEditing')}
            </a>
            <button type="button" className={btnSecondary} onClick={() => window.print()} disabled={!data}>
              <Icon name="printer" />
              {t('preview.print')}
            </button>
            <button type="button" className={btnPrimary} onClick={() => void download()} disabled={!data || exporting || data.steps.length === 0}>
              <Icon name="download" />
              {exporting ? t('export.working') : t('export.htmlButton')}
            </button>
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className={`${container} py-10 text-danger`}>
          {error}
        </p>
      )}
      {!error && !data && <p className={`${container} py-10 text-muted`}>{t('common.loading')}</p>}
      {data && data.steps.length === 0 && <p className={`${container} py-10 text-muted`}>{t('preview.empty')}</p>}
      {data && data.steps.length > 0 && <ViewerHost data={data} options={options} />}
    </div>
  );
}
import { useMemo } from 'react';
import { useI18n } from '../i18n/I18n';
import { useTheme } from '../theme';
import { hrefs } from '../router';
import { buildDemoGuide } from '../demo/demoGuide';
import { ViewerHost } from '../components/ViewerHost';
import { Icon, type IconName } from '../components/Icon';
import { btnPrimary, btnSecondary, card, container, eyebrow } from '../components/ui';
import type { MessageKey } from '../i18n/en';

const FEATURES: { icon: IconName; title: MessageKey; text: MessageKey }[] = [
  { icon: 'cursor', title: 'landing.f1.title', text: 'landing.f1.text' },
  { icon: 'redact', title: 'landing.f2.title', text: 'landing.f2.text' },
  { icon: 'wifioff', title: 'landing.f3.title', text: 'landing.f3.text' },
  { icon: 'lock', title: 'landing.f4.title', text: 'landing.f4.text' },
  { icon: 'globe', title: 'landing.f5.title', text: 'landing.f5.text' },
  { icon: 'keyboard', title: 'landing.f6.title', text: 'landing.f6.text' },
];

export function Landing() {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const demo = useMemo(() => buildDemoGuide(lang), [lang]);
  const options = useMemo(() => ({ theme, compact: true, headingLevel: 2 as const }), [theme]);

  return (
    <>
      <section className="hero-glow border-b border-line">
        <div className={`${container} grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:py-20`}>
          <div>
            <p className={eyebrow}>{t('landing.eyebrow')}</p>
            <h1 className="mt-4 font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.5rem]">
              {t('landing.headline')}
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">{t('landing.sub')}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={hrefs.newGuide} className={`${btnPrimary} min-h-12 px-6 text-base`}>
                {t('landing.cta')}
                <Icon name="arrow" flipRtl />
              </a>
              <a href={hrefs.studio} className={`${btnSecondary} min-h-12 px-6 text-base`}>
                {t('landing.ctaSecondary')}
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-muted">
              {(['landing.pill1', 'landing.pill2', 'landing.pill3'] as const).map((k) => (
                <li key={k} className="flex items-center gap-2">
                  <Icon name="check" className="size-4 text-accent" />
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>

          <div className="mx-auto w-full max-w-md">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-accent" id="sample-label">
              <Icon name="cursor" className="size-4" />
              {t('landing.demoLabel')}
            </p>
            <section aria-labelledby="sample-label" className={`${card} p-4 shadow-xl shadow-black/10 sm:p-5`}>
              <ViewerHost data={demo} options={options} />
            </section>
            <p className="mt-3 text-center text-xs text-muted">{t('landing.demoNote')}</p>
          </div>
        </div>
      </section>

      <section className={`${container} py-16 sm:py-20`} aria-labelledby="how-title">
        <p className={eyebrow}>{t('landing.howEyebrow')}</p>
        <h2 id="how-title" className="mt-3 max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {t('landing.howTitle')}
        </h2>
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {(['1', '2', '3'] as const).map((n) => (
            <li key={n} className={`${card} p-6`}>
              <span className="font-display text-4xl font-semibold text-accent" aria-hidden="true">
                {n}
              </span>
              <h3 className="mt-3 text-lg font-semibold">{t(`landing.how${n}.title` as MessageKey)}</h3>
              <p className="mt-2 text-muted">{t(`landing.how${n}.text` as MessageKey)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y border-line bg-surface/50" aria-labelledby="features-title">
        <div className={`${container} py-16 sm:py-20`}>
          <h2 id="features-title" className="max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {t('landing.featuresTitle')}
          </h2>
          <ul className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-4">
                <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent">
                  <Icon name={f.icon} />
                </span>
                <div>
                  <h3 className="font-semibold">{t(f.title)}</h3>
                  <p className="mt-1 text-[0.9375rem] text-muted">{t(f.text)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={`${container} py-16 sm:py-20`} aria-labelledby="privacy-title">
        <div className="grid gap-8 rounded-3xl border border-line bg-surface p-8 sm:p-12 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className={eyebrow}>{t('landing.privacyEyebrow')}</p>
            <h2 id="privacy-title" className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {t('landing.privacyTitle')}
            </h2>
            <p className="mt-4 text-muted">{t('landing.privacyText')}</p>
            <a href={hrefs.privacy} className={`${btnSecondary} mt-6`}>
              {t('landing.privacyLink')}
            </a>
          </div>
          <ul className="space-y-3 self-center">
            {(['landing.priv1', 'landing.priv2', 'landing.priv3', 'landing.priv4'] as const).map((k) => (
              <li key={k} className="flex gap-3">
                <Icon name="check" className="mt-1 size-5 text-accent" />
                <span>{t(k)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={`${container} pb-20 text-center`}>
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t('landing.finalTitle')}</h2>
        <a href={hrefs.newGuide} className={`${btnPrimary} mt-6 min-h-12 px-7 text-base`}>
          {t('landing.cta')}
          <Icon name="arrow" flipRtl />
        </a>
      </section>
    </>
  );
}
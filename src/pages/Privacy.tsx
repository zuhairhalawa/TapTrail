import { useI18n } from '../i18n/I18n';
import { hrefs } from '../router';
import { btnPrimary, card, container, eyebrow } from '../components/ui';
import type { MessageKey } from '../i18n/en';

const SECTIONS: { title: MessageKey; items: MessageKey[] }[] = [
  { title: 'privacy.s1.title', items: ['privacy.s1.a', 'privacy.s1.b', 'privacy.s1.c'] },
  { title: 'privacy.s2.title', items: ['privacy.s2.a', 'privacy.s2.b', 'privacy.s2.c'] },
  { title: 'privacy.s3.title', items: ['privacy.s3.a', 'privacy.s3.b', 'privacy.s3.c', 'privacy.s3.d'] },
  { title: 'privacy.s4.title', items: ['privacy.s4.a', 'privacy.s4.b', 'privacy.s4.c'] },
];

export function Privacy() {
  const { t } = useI18n();
  return (
    <div className={`${container} max-w-4xl py-12 sm:py-16`}>
      <p className={eyebrow}>{t('nav.privacy')}</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight sm:text-5xl">{t('privacy.title')}</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">{t('privacy.lead')}</p>
      <div className="mt-10 space-y-5">
        {SECTIONS.map((s) => (
          <section key={s.title} className={`${card} p-6 sm:p-8`}>
            <h2 className="font-display text-2xl font-semibold">{t(s.title)}</h2>
            <ul className="mt-4 list-disc space-y-2.5 ps-5 marker:text-accent">
              {s.items.map((k) => (
                <li key={k} className="text-muted">
                  {t(k)}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <a href={hrefs.newGuide} className={`${btnPrimary} mt-10`}>
        {t('landing.cta')}
      </a>
    </div>
  );
}
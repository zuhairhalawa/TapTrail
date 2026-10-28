import { useEffect } from 'react';
import { useI18n } from './i18n/I18n';
import { useTheme } from './theme';
import { hrefs, useRoute } from './router';
import { Icon, Logo } from './components/Icon';
import { container } from './components/ui';
import { Landing } from './pages/Landing';
import { Studio } from './pages/Studio';
import { Editor } from './pages/Editor';
import { Preview } from './pages/Preview';
import { Privacy } from './pages/Privacy';

export const REPO_URL = 'https://github.com/zuhairhalawa/TapTrail';

function Header() {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const route = useRoute();
  const link = (active: boolean) =>
    `whitespace-nowrap rounded-lg px-2 py-2 text-sm font-semibold sm:px-3 ${active ? 'text-accent' : 'text-muted hover:text-fg'}`;
  return (
    <header className="no-print sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className={`${container} flex h-16 items-center justify-between gap-3`}>
        <a href={hrefs.home} className="flex items-center gap-2.5 rounded-lg" aria-label={t('nav.homeLabel')}>
          <Logo />
          <span className="hidden font-display text-xl font-semibold tracking-tight min-[420px]:inline">TapTrail</span>
        </a>
        <nav aria-label={t('nav.main')} className="flex items-center gap-0.5 sm:gap-1.5">
          <a href={hrefs.studio} className={link(['studio', 'edit', 'preview'].includes(route.name))}>
            {t('nav.studio')}
          </a>
          <a href={hrefs.privacy} className={link(route.name === 'privacy')}>
            {t('nav.privacy')}
          </a>
          <button
            type="button"
            onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
            className="whitespace-nowrap rounded-lg px-2 py-2 text-sm font-semibold text-muted hover:text-fg sm:px-3"
            lang={lang === 'en' ? 'ar' : 'en'}
            aria-label={t('nav.switchLanguageLabel')}
          >
            {t('nav.switchLanguage')}
          </button>
          <button
            type="button"
            onClick={toggle}
            className="grid size-10 place-items-center rounded-lg text-muted hover:text-fg"
            aria-label={theme === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  const { t } = useI18n();
  return (
    <footer className="no-print border-t border-line">
      <div className={`${container} flex flex-col gap-2 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between`}>
        <p>{t('footer.tagline')}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <span>{t('footer.license')}</span>
          <a className="underline underline-offset-4 hover:text-fg" href={REPO_URL} rel="noopener noreferrer">
            {t('footer.source')}
          </a>
        </p>
      </div>
    </footer>
  );
}

export default function App() {
  const route = useRoute();
  const { t } = useI18n();
  useEffect(() => {
    document.title = `TapTrail — ${t('meta.title')}`;
  }, [t]);

  return (
    <>
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-fg"
      >
        {t('nav.skip')}
      </a>
      <Header />
      <main id="main" tabIndex={-1} className="outline-none">
        {route.name === 'home' && <Landing />}
        {route.name === 'studio' && <Studio openNew={route.openNew} />}
        {route.name === 'edit' && <Editor key={route.id} guideId={route.id} />}
        {route.name === 'preview' && <Preview key={route.id} guideId={route.id} />}
        {route.name === 'privacy' && <Privacy />}
      </main>
      {route.name !== 'edit' && <Footer />}
    </>
  );
}
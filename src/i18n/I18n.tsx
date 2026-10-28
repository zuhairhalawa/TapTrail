import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { GuideLang, ViewerLabels } from '../lib/types';
import { en, type MessageKey } from './en';
import { ar } from './ar';

export type Lang = GuideLang;
const DICTS: Record<Lang, Record<MessageKey, string>> = { en, ar };

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  const template = DICTS[lang][key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Text used inside guides (preview + exported file), in the guide's own language. */
export function viewerLabels(lang: Lang): ViewerLabels {
  const t = (k: MessageKey) => translate(lang, k);
  return {
    step: t('viewer.step'),
    back: t('viewer.back'),
    next: t('viewer.next'),
    finish: t('viewer.finish'),
    restart: t('viewer.restart'),
    hotspotHint: t('viewer.hotspotHint'),
    noHotspotHint: t('viewer.noHotspotHint'),
    wrongClick: t('viewer.wrongClick'),
    hotspotLabel: t('viewer.hotspotLabel'),
    screenshotAlt: t('viewer.screenshotAlt'),
    doneTitle: t('viewer.doneTitle'),
    doneText: t('viewer.doneText'),
    keyboardHint: t('viewer.keyboardHint'),
    printGuide: t('viewer.printGuide'),
    progress: t('viewer.progress'),
    madeWith: t('viewer.madeWith'),
  };
}

interface I18nValue {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  setLang: (l: Lang) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem('taptrail.lang');
    if (stored === 'ar' || stored === 'en') return stored;
  } catch {
    /* storage blocked: fall through */
  }
  return 'en';
}

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(initial ?? initialLang());
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('taptrail.lang', l);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback((key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
  const value = useMemo(() => ({ lang, dir, setLang, t }) as I18nValue, [lang, dir, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';
const ThemeContext = createContext<{ theme: Theme; toggle: () => void } | null>(null);

function initialTheme(): Theme {
  try {
    const t = localStorage.getItem('taptrail.theme');
    if (t === 'light') return 'light';
    if (t === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    /* ignore */
  }
  return 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = useCallback(() => {
    setTheme((cur) => {
      const next = cur === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('taptrail.theme', next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
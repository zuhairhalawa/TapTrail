const base =
  'inline-flex items-center justify-center gap-2 rounded-xl px-4 min-h-11 text-sm font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none select-none';
export const btnPrimary = `${base} bg-accent text-accent-fg hover:brightness-110`;
export const btnSecondary = `${base} border border-line bg-surface text-fg hover:border-accent`;
export const btnGhost = `${base} text-fg hover:bg-surface2`;
export const btnDanger = `${base} border border-danger text-danger hover:bg-danger/10`;
export const btnSmall = 'min-h-9 px-3 text-[0.8125rem]';
export const field =
  'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-base text-fg placeholder:text-muted/70 hover:border-muted/60';
export const label = 'mb-1.5 block text-sm font-semibold text-fg';
export const card = 'rounded-2xl border border-line bg-surface';
export const eyebrow = 'text-xs font-semibold uppercase tracking-[0.14em] text-accent';
export const container = 'mx-auto w-full max-w-6xl px-5 sm:px-8';
const PATHS = {
  plus: 'M12 5v14M5 12h14',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6',
  copy: 'M9 9h11v11H9zM5 15V5h10',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  left: 'M19 12H5M11 6l-6 6 6 6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  download: 'M12 3v12M7 10l5 5 5-5M4 20h16',
  upload: 'M12 15V3M7 8l5-5 5 5M4 20h16',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3',
  wifioff: 'M3 3l18 18M8.5 16.5a5 5 0 017 0M2 9a15 15 0 015-3M22 9a15 15 0 00-8-4M12 20h.01',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  printer: 'M7 8V3h10v5M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  check: 'M5 12l5 5 9-10',
  cursor: 'M5 3l14 8-6 2-2 6z',
  square: 'M4 4h16v16H4z',
  redact: 'M3 6h18v12H3zM7 10h6M7 14h10',
  image: 'M3 5h18v14H3zM8 11a2 2 0 100-4 2 2 0 000 4zM21 16l-5-5-8 8',
  pencil: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  x: 'M6 6l12 12M18 6L6 18',
  save: 'M5 3h12l2 2v16H5zM8 3v6h8V3M8 21v-7h8v7',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'size-5', flipRtl }: { name: IconName; className?: string; flipRtl?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`${className} shrink-0 ${flipRtl ? 'rtl:-scale-x-100' : ''}`}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Logo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect width="64" height="64" rx="16" fill="#0b1118" stroke="#2dd4bf" strokeOpacity=".35" />
      <path d="M14 44c8 0 8-24 18-24s8 24 18 24" fill="none" stroke="#2dd4bf" strokeWidth="5" strokeLinecap="round" />
      <circle cx="32" cy="20" r="5" fill="#2dd4bf" />
    </svg>
  );
}
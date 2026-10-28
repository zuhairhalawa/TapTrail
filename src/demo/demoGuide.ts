import type { Lang } from '../i18n/I18n';
import { viewerLabels } from '../i18n/I18n';
import type { Rect, ViewerData, ViewerStep } from '../lib/types';

/*
 * The sample guide uses ORIGINAL, fictional screens for an imaginary app called "Lumen".
 * Nothing here imitates a real product. Screens are drawn as SVG and fed to the very same
 * viewer that renders user-made guides.
 */
const W = 360;
const H = 640;
const FONT = `font-family="'Segoe UI', system-ui, Arial, sans-serif"`;
const INK = '#1c2430';
const MUTED = '#667085';
const BRAND = '#5b4bdb';

const norm = (x: number, y: number, w: number, h: number): Rect => ({ x: x / W, y: y / H, w: w / W, h: h / H });

function toDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function screen(body: string, opts: { tabs?: boolean } = {}): string {
  const tabs = opts.tabs
    ? `<rect x="0" y="584" width="${W}" height="56" fill="#fff"/><line x1="0" y1="584" x2="${W}" y2="584" stroke="#e3e6ee"/>` +
      [48, 140, 232, 312]
        .map((cx, i) => `<circle cx="${cx}" cy="612" r="9" fill="${i === 0 ? BRAND : '#c7ccd9'}"/>`)
        .join('')
    : '';
  return toDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${FONT}>` +
      `<rect width="${W}" height="${H}" fill="#f4f5fa"/>` +
      `<text x="24" y="30" font-size="13" font-weight="600" fill="${INK}">9:41</text>` +
      `<rect x="300" y="19" width="26" height="12" rx="3.5" fill="none" stroke="${INK}" opacity=".6"/>` +
      `<rect x="302.5" y="21.5" width="17" height="7" rx="1.8" fill="${INK}" opacity=".6"/>` +
      body +
      tabs +
      `</svg>`,
  );
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function row(y: number, title: string, sub = '', chevron = true): string {
  return (
    `<rect x="16" y="${y}" width="328" height="60" rx="14" fill="#fff" stroke="#e3e6ee"/>` +
    `<text x="36" y="${y + (sub ? 27 : 36)}" font-size="16" font-weight="600" fill="${INK}">${esc(title)}</text>` +
    (sub ? `<text x="36" y="${y + 46}" font-size="12.5" fill="${MUTED}">${esc(sub)}</text>` : '') +
    (chevron ? `<path d="M316 ${y + 24} l8 6 -8 6" fill="none" stroke="#98a2b3" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` : '')
  );
}

const header = (title: string, back = false) =>
  `<text x="${back ? 52 : 24}" y="80" font-size="24" font-weight="700" fill="${INK}">${esc(title)}</text>` +
  (back ? `<path d="M30 70 l-9 9 9 9" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>` : '');

function toggle(x: number, y: number, on: boolean): string {
  return (
    `<rect x="${x}" y="${y}" width="52" height="30" rx="15" fill="${on ? BRAND : '#c7ccd9'}"/>` +
    `<circle cx="${on ? x + 37 : x + 15}" cy="${y + 15}" r="12" fill="#fff"/>`
  );
}

const avatar = (cx: number, cy: number, r: number) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffd9a8"/><circle cx="${cx}" cy="${cy - r * 0.2}" r="${r * 0.36}" fill="#b4742e"/>` +
  `<path d="M${cx - r * 0.62} ${cy + r * 0.72} a${r * 0.62} ${r * 0.5} 0 0 1 ${r * 1.24} 0z" fill="#b4742e"/>`;

const SCREEN_HOME = screen(
  `<text x="24" y="86" font-size="26" font-weight="700" fill="${BRAND}">Lumen</text>` +
    avatar(316, 70, 21) +
    `<rect x="16" y="120" width="328" height="150" rx="20" fill="${BRAND}"/>` +
    `<text x="36" y="160" font-size="14" fill="#d9d5ff">Today</text>` +
    `<text x="36" y="196" font-size="22" font-weight="700" fill="#fff">3 reminders</text>` +
    `<rect x="36" y="222" width="120" height="10" rx="5" fill="#ffffff" opacity=".35"/>` +
    `<rect x="36" y="242" width="180" height="10" rx="5" fill="#ffffff" opacity=".2"/>` +
    row(290, 'Weekend plans', 'Shared with 4 people') +
    row(362, 'Reading list', '12 saved') +
    row(434, 'Photo album', 'Updated yesterday'),
  { tabs: true },
);
const SCREEN_PROFILE = screen(
  header('Profile', true) +
    avatar(180, 160, 46) +
    `<text x="180" y="242" text-anchor="middle" font-size="19" font-weight="700" fill="${INK}">Sam Rivera</text>` +
    `<text x="180" y="264" text-anchor="middle" font-size="13" fill="${MUTED}">sam@example.com</text>` +
    row(296, 'Edit profile') +
    row(366, 'Notifications') +
    row(436, 'Settings') +
    row(506, 'Help and feedback'),
);
const SCREEN_SETTINGS = screen(
  header('Settings', true) + row(110, 'Appearance', 'Light') + row(182, 'Language', 'English') + row(254, 'Security', 'Password, sign-in') + row(326, 'Storage', '1.2 GB used'),
);
const SCREEN_SECURITY_OFF = screen(
  header('Security', true) +
    `<text x="24" y="130" font-size="12.5" font-weight="700" fill="${MUTED}" letter-spacing="1">SIGN-IN</text>` +
    row(146, 'Password', 'Changed 3 months ago') +
    `<rect x="16" y="220" width="328" height="84" rx="14" fill="#fff" stroke="#e3e6ee"/>` +
    `<text x="36" y="252" font-size="16" font-weight="600" fill="${INK}">Two-step verification</text>` +
    `<text x="36" y="274" font-size="12.5" fill="${MUTED}">Ask for a code when signing in</text>` +
    toggle(278, 238, false),
);
const SCREEN_SECURITY_ON = screen(
  header('Security', true) +
    `<rect x="16" y="108" width="328" height="56" rx="14" fill="#e6f6ee" stroke="#b7e4cb"/>` +
    `<circle cx="42" cy="136" r="11" fill="#1a9e5c"/><path d="M36.5 136 l4 4 7-8" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<text x="64" y="141" font-size="14.5" font-weight="600" fill="#14633b">Two-step verification is on</text>` +
    `<rect x="16" y="190" width="328" height="84" rx="14" fill="#fff" stroke="#e3e6ee"/>` +
    `<text x="36" y="222" font-size="16" font-weight="600" fill="${INK}">Two-step verification</text>` +
    `<text x="36" y="244" font-size="12.5" fill="${MUTED}">Ask for a code when signing in</text>` +
    toggle(278, 208, true) +
    `<rect x="24" y="540" width="312" height="52" rx="26" fill="${BRAND}"/>` +
    `<text x="180" y="572" text-anchor="middle" font-size="16" font-weight="700" fill="#fff">Done</text>`,
);

const TEXT: Record<Lang, { title: string; description: string; steps: string[] }> = {
  en: {
    title: 'How to turn on account security',
    description: 'A sample guide for a fictional app called Lumen. Click the glowing area on each screen.',
    steps: [
      'Tap your profile picture in the top-right corner.',
      'Tap Settings.',
      'Tap Security.',
      'Switch on Two-step verification.',
      'Your account will now ask for a code when you sign in. Tap Done to finish.',
    ],
  },
  ar: {
    title: 'كيف تفعّل أمان الحساب',
    description: 'دليل تجريبي لتطبيق خيالي اسمه Lumen. اضغط على المنطقة المضيئة في كل شاشة.',
    steps: [
      'اضغط على صورة ملفك الشخصي في الزاوية العلوية.',
      'اضغط على Settings.',
      'اضغط على Security.',
      'فعّل خيار Two-step verification.',
      'سيطلب حسابك الآن رمزًا عند تسجيل الدخول. اضغط على Done للانتهاء.',
    ],
  },
};

const SCREENS: { image: string; hotspot: Rect }[] = [
  { image: SCREEN_HOME, hotspot: norm(290, 44, 52, 52) },
  { image: SCREEN_PROFILE, hotspot: norm(16, 436, 328, 60) },
  { image: SCREEN_SETTINGS, hotspot: norm(16, 254, 328, 60) },
  { image: SCREEN_SECURITY_OFF, hotspot: norm(268, 232, 72, 42) },
  { image: SCREEN_SECURITY_ON, hotspot: norm(24, 540, 312, 52) },
];

export function buildDemoGuide(lang: Lang): ViewerData {
  const text = TEXT[lang];
  const steps: ViewerStep[] = SCREENS.map((s, i) => ({
    instruction: text.steps[i] ?? '',
    image: s.image,
    width: W,
    height: H,
    hotspot: s.hotspot,
  }));
  return { title: text.title, description: text.description, lang, steps, labels: viewerLabels(lang) };
}
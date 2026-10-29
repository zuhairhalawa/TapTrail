import type { GuideLang, Rect, ViewerData, ViewerLabels, ViewerStep } from './types';
import { LIMITS } from './types';
import { clampRect } from './geometry';
import { sniffImageType, type ImageMime } from './imageType';

export type ProjectErrorCode =
  | 'too_large'
  | 'not_json'
  | 'wrong_format'
  | 'unsupported_version'
  | 'invalid'
  | 'too_many_steps'
  | 'bad_image'
  | 'image_too_large';

/** Thrown for any untrusted input that does not pass validation. `detail` is for developers only. */
export class ProjectError extends Error {
  readonly code: ProjectErrorCode;
  readonly detail: string;
  constructor(code: ProjectErrorCode, detail = '') {
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'ProjectError';
    this.code = code;
    this.detail = detail;
  }
}

export const PROJECT_FORMAT = 'taptrail-project';
export const PROJECT_VERSION = 1;

/** Control characters and bidi override/isolate characters (used for spoofing) are dropped. */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;

export function cleanText(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string') throw new ProjectError('invalid', `${field} must be text`);
  const cleaned = value.replace(UNSAFE_CHARS, '');
  if (cleaned.length > max) throw new ProjectError('invalid', `${field} is too long`);
  return cleaned;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function ownGet(o: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;
}

export function validateRect(value: unknown, field: string): Rect {
  if (!isRecord(value)) throw new ProjectError('invalid', `${field} must be a rectangle`);
  const nums = ['x', 'y', 'w', 'h'].map((k) => {
    const n = ownGet(value, k);
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new ProjectError('invalid', `${field}.${k} must be a number`);
    return n;
  });
  const [x, y, w, h] = nums as [number, number, number, number];
  if (x < 0 || y < 0 || x > 1 || y > 1 || w <= 0 || h <= 0 || w > 1 || h > 1 || x + w > 1.001 || y + h > 1.001) {
    throw new ProjectError('invalid', `${field} is outside the image`);
  }
  return clampRect({ x, y, w, h }, 0.001);
}

const DATA_URL_PREFIX = /^data:(image\/(?:png|jpeg|webp));base64,/;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

/** Accepts only base64 PNG/JPEG/WebP data URLs whose bytes really start like that format. */
export function checkImageDataUrl(value: unknown, field: string, maxBytes: number = LIMITS.maxImportImageBytes): ImageMime {
  if (typeof value !== 'string') throw new ProjectError('bad_image', `${field} must be an image`);
  const m = DATA_URL_PREFIX.exec(value);
  if (!m) throw new ProjectError('bad_image', `${field} must be a PNG, JPEG or WebP data URL`);
  const bodyLength = value.length - m[0].length;
  if (Math.floor((bodyLength * 3) / 4) > maxBytes) throw new ProjectError('image_too_large', field);
  if (bodyLength < 32 || bodyLength % 4 !== 0 || !BASE64_BODY.test(value.slice(m[0].length))) {
    throw new ProjectError('bad_image', `${field} is not valid base64`);
  }
  const head = atob(value.slice(m[0].length, m[0].length + 32));
  const bytes = Uint8Array.from(head, (c) => c.charCodeAt(0));
  const sniffed = sniffImageType(bytes);
  if (sniffed !== m[1]) throw new ProjectError('bad_image', `${field} content does not match its type`);
  return sniffed;
}

function checkDimension(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 20000) {
    throw new ProjectError('invalid', `${field} must be a whole number between 1 and 20000`);
  }
  return v;
}

function checkLang(v: unknown): GuideLang {
  if (v === 'en' || v === 'ar') return v;
  throw new ProjectError('invalid', 'lang must be "en" or "ar"');
}

export interface ProjectStepData {
  instruction: string;
  image: string;
  width: number;
  height: number;
  hotspot: Rect | null;
}

export interface ProjectGuideData {
  title: string;
  description: string;
  lang: GuideLang;
  steps: ProjectStepData[];
}

/** Build a brand-new, fully validated guide object. Unknown keys are never copied. */
export function validateGuideData(raw: unknown): ProjectGuideData {
  if (!isRecord(raw)) throw new ProjectError('invalid', 'guide must be an object');
  const stepsRaw = ownGet(raw, 'steps');
  if (!Array.isArray(stepsRaw)) throw new ProjectError('invalid', 'steps must be a list');
  if (stepsRaw.length > LIMITS.maxSteps) throw new ProjectError('too_many_steps', String(stepsRaw.length));
  const title = cleanText(ownGet(raw, 'title'), LIMITS.maxTitle, 'title').trim();
  const description = cleanText(ownGet(raw, 'description') ?? '', LIMITS.maxDescription, 'description');
  const lang = checkLang(ownGet(raw, 'lang') ?? 'en');
  const steps = stepsRaw.map((s, i): ProjectStepData => {
    if (!isRecord(s)) throw new ProjectError('invalid', `steps[${i}] must be an object`);
    const image = ownGet(s, 'image');
    checkImageDataUrl(image, `steps[${i}].image`);
    const hotspotRaw = ownGet(s, 'hotspot');
    return {
      instruction: cleanText(ownGet(s, 'instruction') ?? '', LIMITS.maxInstruction, `steps[${i}].instruction`),
      image: image as string,
      width: checkDimension(ownGet(s, 'width'), `steps[${i}].width`),
      height: checkDimension(ownGet(s, 'height'), `steps[${i}].height`),
      hotspot: hotspotRaw === null || hotspotRaw === undefined ? null : validateRect(hotspotRaw, `steps[${i}].hotspot`),
    };
  });
  return { title, description, lang, steps };
}

/** Parse the text of a TapTrail project file. Never executes or evaluates anything. */
export function parseProjectText(text: string): ProjectGuideData {
  if (text.length > LIMITS.maxImportFileBytes) throw new ProjectError('too_large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProjectError('not_json');
  }
  if (!isRecord(parsed) || ownGet(parsed, 'format') !== PROJECT_FORMAT) throw new ProjectError('wrong_format');
  if (ownGet(parsed, 'version') !== PROJECT_VERSION) throw new ProjectError('unsupported_version');
  return validateGuideData(ownGet(parsed, 'guide'));
}

export function stringifyProject(guide: ProjectGuideData): string {
  return JSON.stringify(
    { format: PROJECT_FORMAT, version: PROJECT_VERSION, app: 'TapTrail 0.1.1', guide },
    null,
    1,
  );
}

const LABEL_KEYS: (keyof ViewerLabels)[] = [
  'step', 'back', 'next', 'finish', 'restart', 'hotspotHint', 'noHotspotHint', 'wrongClick', 'hotspotLabel',
  'screenshotAlt', 'doneTitle', 'doneText', 'keyboardHint', 'printGuide', 'progress', 'madeWith',
];

/** Validate everything that will be embedded in an exported HTML file. */
export function sanitizeViewerData(raw: ViewerData): ViewerData {
  const labelsRaw = raw.labels as unknown;
  if (!isRecord(labelsRaw)) throw new ProjectError('invalid', 'labels missing');
  const labels = {} as ViewerLabels;
  for (const k of LABEL_KEYS) labels[k] = cleanText(ownGet(labelsRaw, k), 300, `labels.${k}`);
  const guide = validateGuideData({ title: raw.title, description: raw.description, lang: raw.lang, steps: raw.steps });
  const steps: ViewerStep[] = guide.steps.map((s) => ({
    instruction: s.instruction,
    image: s.image,
    width: s.width,
    height: s.height,
    hotspot: s.hotspot,
  }));
  return { title: guide.title, description: guide.description, lang: guide.lang, steps, labels };
}
/** A rectangle in normalized image coordinates: every value is a fraction (0..1) of the image. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type GuideLang = 'en' | 'ar';

export interface Step {
  id: string;
  instruction: string;
  /** Key into the `images` object store. */
  imageId: string;
  /** Pixel size of the stored (processed) image. */
  width: number;
  height: number;
  /** The one clickable area for this step (null = informational step). */
  hotspot: Rect | null;
  /** Opaque rectangles burned into the pixels at preview/export time. */
  redactions: Rect[];
}

export interface Guide {
  id: string;
  title: string;
  description: string;
  lang: GuideLang;
  createdAt: number;
  updatedAt: number;
  steps: Step[];
}

/** Image row in IndexedDB. Bytes are always a browser re-encoded PNG/JPEG/WebP. */
export interface StoredImage {
  id: string;
  guideId: string;
  mime: string;
  bytes: ArrayBuffer;
  width: number;
  height: number;
}

/** What a viewer (in-app or exported) needs for one step. Fully serializable. */
export interface ViewerStep {
  instruction: string;
  image: string; // data: or blob: URL
  width: number;
  height: number;
  hotspot: Rect | null;
}

export interface ViewerLabels {
  step: string; // "Step {n} of {total}"
  back: string;
  next: string;
  finish: string;
  restart: string;
  hotspotHint: string;
  noHotspotHint: string;
  wrongClick: string;
  hotspotLabel: string; // "Click here: {instruction}"
  screenshotAlt: string; // "Screenshot for step {n}"
  doneTitle: string;
  doneText: string;
  keyboardHint: string;
  printGuide: string;
  progress: string;
  madeWith: string;
}

export interface ViewerData {
  title: string;
  description: string;
  lang: GuideLang;
  steps: ViewerStep[];
  labels: ViewerLabels;
}

export const LIMITS = {
  maxSteps: 60,
  maxTitle: 120,
  maxDescription: 600,
  maxInstruction: 600,
  maxRedactionsPerStep: 30,
  /** Largest file the user may add (before re-encoding). */
  maxUploadBytes: 15 * 1024 * 1024,
  /** Longest side of a stored/exported screenshot, in pixels. */
  maxImageSide: 2000,
  /** Safety cap for a decoded image's pixel count. */
  maxImagePixels: 60_000_000,
  /** Per-image cap inside an imported project. */
  maxImportImageBytes: 12 * 1024 * 1024,
  /** Cap for a whole imported project file. */
  maxImportFileBytes: 200 * 1024 * 1024,
  /** Smallest hotspot/redaction edge (fraction of the image). */
  minRectSize: 0.01,
} as const;

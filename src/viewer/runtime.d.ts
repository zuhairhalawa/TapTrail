import type { ViewerData } from '../lib/types';

export interface MountOptions {
  theme?: 'auto' | 'light' | 'dark';
  /** Fill the whole page (standalone export). */
  full?: boolean;
  /** Smaller screenshot area (embedded in the landing page). */
  compact?: boolean;
  headingLevel?: 1 | 2;
  showFooter?: boolean;
}

export interface ViewerHandle {
  go(index: number, focus?: boolean): void;
  destroy(): void;
}

export function mountViewer(root: HTMLElement, data: ViewerData, options?: MountOptions): ViewerHandle;
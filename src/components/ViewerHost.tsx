import { useEffect, useRef } from 'react';
import type { ViewerData } from '../lib/types';
import { mountViewer, type MountOptions } from '../viewer/runtime.js';
import '../viewer/viewer.css';

/**
 * Hosts the exact same viewer runtime that is inlined into exported HTML files.
 * `data` must be memoized by the caller: a new object re-mounts the viewer.
 */
export function ViewerHost({ data, options, className }: { data: ViewerData; options?: MountOptions; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const optionsKey = JSON.stringify(options ?? {});
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const handle = mountViewer(node, data, JSON.parse(optionsKey) as MountOptions);
    return () => handle.destroy();
  }, [data, optionsKey]);
  return <div ref={ref} className={className} data-testid="viewer-host" />;
}
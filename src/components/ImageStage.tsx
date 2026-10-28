import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useI18n } from '../i18n/I18n';
import type { Rect } from '../lib/types';
import { moveRect, pointToNormalized, rectFromPoints, rectToPercent, resizeRect, type Handle } from '../lib/geometry';

export type Tool = 'hotspot' | 'redact';
type Target = { kind: 'hotspot' } | { kind: 'redaction'; index: number };
type Drag =
  | { type: 'draw'; start: { x: number; y: number } }
  | { type: 'move'; target: Target; start: { x: number; y: number }; origin: Rect }
  | { type: 'resize'; target: Target; handle: Handle; start: { x: number; y: number }; origin: Rect };

interface Props {
  imageUrl: string;
  width: number;
  height: number;
  hotspot: Rect | null;
  redactions: Rect[];
  tool: Tool;
  onHotspot: (rect: Rect | null) => void;
  onRedaction: (index: number, rect: Rect | null) => void;
  onAddRedaction: (rect: Rect) => void;
}

const HANDLES: { id: Handle; style: { left: string; top: string }; cursor: string }[] = [
  { id: 'nw', style: { left: '0%', top: '0%' }, cursor: 'nwse-resize' },
  { id: 'n', style: { left: '50%', top: '0%' }, cursor: 'ns-resize' },
  { id: 'ne', style: { left: '100%', top: '0%' }, cursor: 'nesw-resize' },
  { id: 'e', style: { left: '100%', top: '50%' }, cursor: 'ew-resize' },
  { id: 'se', style: { left: '100%', top: '100%' }, cursor: 'nwse-resize' },
  { id: 's', style: { left: '50%', top: '100%' }, cursor: 'ns-resize' },
  { id: 'sw', style: { left: '0%', top: '100%' }, cursor: 'nesw-resize' },
  { id: 'w', style: { left: '0%', top: '50%' }, cursor: 'ew-resize' },
];

const MIN_DRAW = 0.02;
const KEY_STEP = 0.01;

/** Image with a drawable/editable hotspot and opaque "cover" boxes. All coordinates are normalized (0..1). */
export function ImageStage(props: Props) {
  const { t } = useI18n();
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const latestRef = useRef<Rect | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [live, setLive] = useState<{ target: Target; rect: Rect } | null>(null);

  const point = (e: PointerEvent) => {
    const el = stageRef.current;
    if (!el) return { x: 0, y: 0 };
    return pointToNormalized(e.clientX, e.clientY, el.getBoundingClientRect());
  };

  const sameTarget = (a: Target, b: Target) => a.kind === b.kind && (a.kind === 'hotspot' || (b.kind === 'redaction' && a.index === b.index));

  const startDraw = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    dragRef.current = { type: 'draw', start: p };
    latestRef.current = { x: p.x, y: p.y, w: 0, h: 0 };
    setDraft(latestRef.current);
  };
  const startMove = (e: PointerEvent<HTMLElement>, target: Target, origin: Rect) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { type: 'move', target, start: point(e), origin };
    latestRef.current = origin;
  };
  const startResize = (e: PointerEvent<HTMLElement>, target: Target, handle: Handle, origin: Rect) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { type: 'resize', target, handle, start: point(e), origin };
    latestRef.current = origin;
  };

  const onMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = point(e);
    if (d.type === 'draw') {
      latestRef.current = rectFromPoints(d.start.x, d.start.y, p.x, p.y);
      setDraft(latestRef.current);
    } else if (d.type === 'move') {
      latestRef.current = moveRect(d.origin, p.x - d.start.x, p.y - d.start.y);
      setLive({ target: d.target, rect: latestRef.current });
    } else {
      latestRef.current = resizeRect(d.origin, d.handle, p.x - d.start.x, p.y - d.start.y);
      setLive({ target: d.target, rect: latestRef.current });
    }
  };

  const finish = (commit: boolean) => {
    const d = dragRef.current;
    const rect = latestRef.current;
    dragRef.current = null;
    latestRef.current = null;
    setDraft(null);
    setLive(null);
    if (!commit || !d || !rect) return;
    if (d.type === 'draw') {
      if (rect.w < MIN_DRAW || rect.h < MIN_DRAW) return;
      if (props.tool === 'hotspot') props.onHotspot(rect);
      else props.onAddRedaction(rect);
    } else if (d.target.kind === 'hotspot') {
      props.onHotspot(rect);
    } else {
      props.onRedaction(d.target.index, rect);
    }
  };

  const onKey = (e: KeyboardEvent, rect: Rect, commit: (r: Rect | null) => void) => {
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    };
    const a = arrows[e.key];
    if (a) {
      e.preventDefault();
      commit(e.shiftKey ? resizeRect(rect, 'se', a[0], a[1]) : moveRect(rect, a[0], a[1]));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      commit(null);
    }
  };

  const shown = (target: Target, rect: Rect) => (live && sameTarget(live.target, target) ? live.rect : rect);

  const renderBox = (key: string, target: Target, rect: Rect, active: boolean) => {
    const variant = target.kind;
    const r = shown(target, rect);
    const commit = (next: Rect | null) =>
      target.kind === 'hotspot' ? props.onHotspot(next) : props.onRedaction(target.index, next);
    const label =
      target.kind === 'hotspot' ? t('stage.hotspotLabel') : t('stage.redactionLabel', { n: target.index + 1 });
    return (
      <div
        key={key}
        role={active ? 'group' : undefined}
        aria-label={active ? label : undefined}
        aria-description={active ? t('stage.boxKeys') : undefined}
        tabIndex={active ? 0 : undefined}
        data-testid={variant === 'hotspot' ? 'hotspot-box' : 'redaction-box'}
        onPointerDown={active ? (e) => startMove(e, target, rect) : undefined}
        onKeyDown={active ? (e) => onKey(e, rect, commit) : undefined}
        style={{ ...rectToPercent(r), touchAction: 'none' }}
        className={[
          'absolute',
          active ? '@container z-10 cursor-move' : 'pointer-events-none',
          variant === 'hotspot'
            ? `rounded-md border-[3px] border-accent bg-accent/20 shadow-[0_0_0_2px_rgb(255_255_255/0.9)] ${active ? '' : 'opacity-60'}`
            : `bg-black outline-2 outline-dashed ${active ? 'outline-white' : 'outline-white/50'}`,
        ].join(' ')}
      >
        {active &&
          HANDLES.map((h) => (
            <span
              key={h.id}
              data-handle={h.id}
              onPointerDown={(e) => startResize(e, target, h.id, rect)}
              style={{ ...h.style, cursor: h.cursor, touchAction: 'none' }}
              className={`absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow pointer-coarse:size-6 ${
                h.id.length === 1 ? '@max-[96px]:hidden' : '' // small boxes keep only corner handles so the box stays visible
              }`}
            />
          ))}
        {variant === 'hotspot' && (
          <span className="pointer-events-none absolute -top-7 start-0 rounded-md bg-accent px-2 py-0.5 text-xs font-bold text-accent-fg">
            {t('stage.tapHere')}
          </span>
        )}
      </div>
    );
  };

  const ar = props.width / props.height;
  return (
    <div
      ref={stageRef}
      data-testid="image-stage"
      onPointerMove={onMove}
      onPointerUp={() => finish(true)}
      onPointerCancel={() => finish(false)}
      style={{ aspectRatio: String(ar), width: `min(100%, calc(68vh * ${ar}))`, maxWidth: `${props.width}px` }}
      className="relative mx-auto select-none overflow-visible rounded-lg border border-line bg-surface2"
    >
      <img src={props.imageUrl} alt={t('stage.imageAlt')} draggable={false} className="pointer-events-none block size-full rounded-lg" />
      <div
        data-testid="draw-surface"
        onPointerDown={startDraw}
        className="absolute inset-0 cursor-crosshair touch-none"
        aria-hidden="true"
      />
      {props.redactions.map((r, i) => renderBox(`r${i}`, { kind: 'redaction', index: i }, r, props.tool === 'redact'))}
      {props.hotspot && renderBox('h', { kind: 'hotspot' }, props.hotspot, props.tool === 'hotspot')}
      {draft && draft.w > 0 && draft.h > 0 && (
        <div
          style={rectToPercent(draft)}
          className={`pointer-events-none absolute ${
            props.tool === 'hotspot' ? 'rounded-md border-[3px] border-dashed border-accent bg-accent/20' : 'bg-black/80 outline-2 outline-dashed outline-white'
          }`}
        />
      )}
    </div>
  );
}
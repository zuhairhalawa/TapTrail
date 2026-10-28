import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../i18n/I18n';
import { ImageStage } from './ImageStage';

function setup(tool: 'hotspot' | 'redact' = 'hotspot') {
  const onHotspot = vi.fn();
  const onRedaction = vi.fn();
  const onAddRedaction = vi.fn();
  render(
    <I18nProvider initial="en">
      <ImageStage
        imageUrl="data:image/png;base64,AAAA"
        width={400}
        height={800}
        hotspot={{ x: 0.2, y: 0.2, w: 0.2, h: 0.1 }}
        redactions={[{ x: 0.5, y: 0.5, w: 0.2, h: 0.1 }]}
        tool={tool}
        onHotspot={onHotspot}
        onRedaction={onRedaction}
        onAddRedaction={onAddRedaction}
      />
    </I18nProvider>,
  );
  return { onHotspot, onRedaction, onAddRedaction };
}

describe('annotation stage accessibility and keyboard control', () => {
  it('exposes the hotspot as a labelled, focusable control', () => {
    setup();
    const box = screen.getByRole('group', { name: 'Tap area' });
    expect(box).toHaveAttribute('tabindex', '0');
    expect(box).toHaveAttribute('aria-description', expect.stringContaining('Arrow keys'));
  });

  it('moves the hotspot with arrow keys and resizes it with Shift+arrows', () => {
    const { onHotspot } = setup();
    const box = screen.getByRole('group', { name: 'Tap area' });
    fireEvent.keyDown(box, { key: 'ArrowRight' });
    expect(onHotspot).toHaveBeenLastCalledWith(expect.objectContaining({ x: expect.closeTo(0.21), y: 0.2, w: 0.2 }));
    fireEvent.keyDown(box, { key: 'ArrowDown', shiftKey: true });
    expect(onHotspot).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0.2, h: expect.closeTo(0.11) }));
  });

  it('keeps the hotspot inside the image when moved past an edge', () => {
    const { onHotspot } = setup();
    const box = screen.getByRole('group', { name: 'Tap area' });
    for (let i = 0; i < 3; i++) fireEvent.keyDown(box, { key: 'ArrowLeft' });
    expect(onHotspot.mock.calls.every(([r]) => r.x >= 0)).toBe(true);
  });

  it('removes the hotspot with Delete', () => {
    const { onHotspot } = setup();
    fireEvent.keyDown(screen.getByRole('group', { name: 'Tap area' }), { key: 'Delete' });
    expect(onHotspot).toHaveBeenCalledWith(null);
  });

  it('makes cover boxes keyboard-editable only while the cover tool is active', () => {
    const { onRedaction } = setup('redact');
    expect(screen.queryByRole('group', { name: 'Tap area' })).toBeNull();
    const cover = screen.getByRole('group', { name: 'Cover box 1' });
    fireEvent.keyDown(cover, { key: 'ArrowUp' });
    expect(onRedaction).toHaveBeenCalledWith(0, expect.objectContaining({ y: expect.closeTo(0.49) }));
    fireEvent.keyDown(cover, { key: 'Delete' });
    expect(onRedaction).toHaveBeenLastCalledWith(0, null);
  });

  it('draws a new hotspot with the pointer using normalized coordinates', () => {
    const { onHotspot } = setup();
    const stage = screen.getByTestId('image-stage');
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800, x: 0, y: 0, toJSON: () => ({}) });
    const surface = screen.getByTestId('draw-surface');
    surface.setPointerCapture = () => undefined;
    fireEvent.pointerDown(surface, { clientX: 100, clientY: 200, button: 0, pointerId: 1 });
    fireEvent.pointerMove(stage, { clientX: 300, clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(stage, { clientX: 300, clientY: 400, pointerId: 1 });
    expect(onHotspot).toHaveBeenCalledWith({ x: 0.25, y: 0.25, w: 0.5, h: 0.25 });
  });

  it('ignores accidental tiny drags', () => {
    const { onHotspot } = setup();
    const stage = screen.getByTestId('image-stage');
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800, x: 0, y: 0, toJSON: () => ({}) });
    const surface = screen.getByTestId('draw-surface');
    surface.setPointerCapture = () => undefined;
    fireEvent.pointerDown(surface, { clientX: 100, clientY: 200, button: 0, pointerId: 1 });
    fireEvent.pointerUp(stage, { clientX: 102, clientY: 202, pointerId: 1 });
    expect(onHotspot).not.toHaveBeenCalled();
  });
});
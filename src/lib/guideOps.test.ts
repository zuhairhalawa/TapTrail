import { describe, expect, it } from 'vitest';
import {
  addRedaction, addStep, createGuide, createStep, deleteStep, duplicateStep, moveStep, removeRedaction, setHotspot,
  setInstruction,
} from './guideOps';
import { LIMITS } from './types';

const mk = (n: number) => {
  let g = createGuide({ title: '  My guide  ', description: 'd', lang: 'en' });
  for (let i = 0; i < n; i++) g = addStep(g, createStep({ imageId: `img${i}`, width: 100, height: 200, instruction: `s${i}` }));
  return g;
};

describe('guide creation and step editing', () => {
  it('creates a named guide with trimmed title and no steps', () => {
    const g = createGuide({ title: '  My guide  ', lang: 'ar' });
    expect(g.title).toBe('My guide');
    expect(g.lang).toBe('ar');
    expect(g.steps).toEqual([]);
    expect(g.id).toMatch(/[0-9a-f-]{36}/);
  });
  it('adds steps in order and edits instructions', () => {
    let g = mk(2);
    expect(g.steps.map((s) => s.instruction)).toEqual(['s0', 's1']);
    g = setInstruction(g, g.steps[1]!.id, 'changed');
    expect(g.steps[1]!.instruction).toBe('changed');
  });
  it('limits instruction length', () => {
    const g = mk(1);
    const long = setInstruction(g, g.steps[0]!.id, 'x'.repeat(LIMITS.maxInstruction + 50));
    expect(long.steps[0]!.instruction).toHaveLength(LIMITS.maxInstruction);
  });
  it('does not mutate previous state', () => {
    const g = mk(2);
    const before = JSON.stringify(g);
    moveStep(g, 0, 1);
    deleteStep(g, g.steps[0]!.id);
    expect(JSON.stringify(g)).toBe(before);
  });
  it('reorders steps', () => {
    const g = moveStep(mk(3), 0, 2);
    expect(g.steps.map((s) => s.instruction)).toEqual(['s1', 's2', 's0']);
    expect(moveStep(g, 5, 0)).toBe(g);
    expect(moveStep(g, 1, 1)).toBe(g);
  });
  it('deletes steps', () => {
    const g = mk(3);
    const d = deleteStep(g, g.steps[1]!.id);
    expect(d.steps.map((s) => s.instruction)).toEqual(['s0', 's2']);
  });
  it('duplicates a step right after the original with independent copies', () => {
    let g = mk(2);
    g = setHotspot(g, g.steps[0]!.id, { x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
    const d = duplicateStep(g, g.steps[0]!.id, 'new-step', 'new-img');
    expect(d.steps).toHaveLength(3);
    expect(d.steps[1]).toMatchObject({ id: 'new-step', imageId: 'new-img', instruction: 's0' });
    expect(d.steps[1]!.hotspot).toEqual(d.steps[0]!.hotspot);
    expect(d.steps[1]!.hotspot).not.toBe(d.steps[0]!.hotspot);
  });
  it('caps the number of steps', () => {
    const g = mk(LIMITS.maxSteps);
    expect(addStep(g, createStep({ imageId: 'x', width: 1, height: 1 }))).toBe(g);
  });
  it('sets, clamps and clears a hotspot', () => {
    let g = mk(1);
    const id = g.steps[0]!.id;
    g = setHotspot(g, id, { x: 0.9, y: 0.9, w: 0.5, h: 0.5 });
    const h = g.steps[0]!.hotspot!;
    expect(h.x + h.w).toBeLessThanOrEqual(1);
    expect(h.y + h.h).toBeLessThanOrEqual(1);
    g = setHotspot(g, id, null);
    expect(g.steps[0]!.hotspot).toBeNull();
  });
  it('adds and removes redactions', () => {
    let g = mk(1);
    const id = g.steps[0]!.id;
    g = addRedaction(g, id, { x: 0.1, y: 0.1, w: 0.3, h: 0.1 });
    g = addRedaction(g, id, { x: 0.5, y: 0.5, w: 0.3, h: 0.1 });
    expect(g.steps[0]!.redactions).toHaveLength(2);
    g = removeRedaction(g, id, 0);
    expect(g.steps[0]!.redactions).toEqual([{ x: 0.5, y: 0.5, w: 0.3, h: 0.1 }]);
  });
});
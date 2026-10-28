import type { Guide, GuideLang, Rect, Step } from './types';
import { LIMITS } from './types';
import { clampRect } from './geometry';

export const newId = (): string => crypto.randomUUID();

export function createGuide(input: { title: string; description?: string; lang: GuideLang }, now = Date.now()): Guide {
  return {
    id: newId(),
    title: input.title.trim().slice(0, LIMITS.maxTitle),
    description: (input.description ?? '').trim().slice(0, LIMITS.maxDescription),
    lang: input.lang,
    createdAt: now,
    updatedAt: now,
    steps: [],
  };
}

const touch = (g: Guide, steps: Step[], now = Date.now()): Guide => ({ ...g, steps, updatedAt: now });

export function createStep(init: { imageId: string; width: number; height: number; instruction?: string }): Step {
  return {
    id: newId(),
    instruction: init.instruction ?? '',
    imageId: init.imageId,
    width: init.width,
    height: init.height,
    hotspot: null,
    redactions: [],
  };
}

export function addStep(g: Guide, step: Step): Guide {
  if (g.steps.length >= LIMITS.maxSteps) return g;
  return touch(g, [...g.steps, step]);
}

export function deleteStep(g: Guide, stepId: string): Guide {
  return touch(g, g.steps.filter((s) => s.id !== stepId));
}

/** Insert a copy right after the original. The caller supplies the id of the copied image. */
export function duplicateStep(g: Guide, stepId: string, newStepId: string, newImageId: string): Guide {
  if (g.steps.length >= LIMITS.maxSteps) return g;
  const i = g.steps.findIndex((s) => s.id === stepId);
  const src = g.steps[i];
  if (!src) return g;
  const copy: Step = {
    ...src,
    id: newStepId,
    imageId: newImageId,
    hotspot: src.hotspot ? { ...src.hotspot } : null,
    redactions: src.redactions.map((r) => ({ ...r })),
  };
  const steps = [...g.steps];
  steps.splice(i + 1, 0, copy);
  return touch(g, steps);
}

export function moveStep(g: Guide, from: number, to: number): Guide {
  if (from === to || from < 0 || to < 0 || from >= g.steps.length || to >= g.steps.length) return g;
  const steps = [...g.steps];
  const [moved] = steps.splice(from, 1);
  if (!moved) return g;
  steps.splice(to, 0, moved);
  return touch(g, steps);
}

export function updateStep(g: Guide, stepId: string, patch: Partial<Omit<Step, 'id'>>): Guide {
  return touch(
    g,
    g.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
  );
}

export function setInstruction(g: Guide, stepId: string, text: string): Guide {
  return updateStep(g, stepId, { instruction: text.slice(0, LIMITS.maxInstruction) });
}

export function setHotspot(g: Guide, stepId: string, rect: Rect | null): Guide {
  return updateStep(g, stepId, { hotspot: rect ? clampRect(rect) : null });
}

export function addRedaction(g: Guide, stepId: string, rect: Rect): Guide {
  const step = g.steps.find((s) => s.id === stepId);
  if (!step || step.redactions.length >= LIMITS.maxRedactionsPerStep) return g;
  return updateStep(g, stepId, { redactions: [...step.redactions, clampRect(rect)] });
}

export function removeRedaction(g: Guide, stepId: string, index: number): Guide {
  const step = g.steps.find((s) => s.id === stepId);
  if (!step) return g;
  return updateStep(g, stepId, { redactions: step.redactions.filter((_, i) => i !== index) });
}

export function renameGuide(g: Guide, title: string): Guide {
  return { ...g, title: title.slice(0, LIMITS.maxTitle), updatedAt: Date.now() };
}
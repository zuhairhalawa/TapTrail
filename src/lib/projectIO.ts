import { LIMITS, type Guide, type GuideLang, type StoredImage, type ViewerData, type ViewerLabels } from './types';
import { bakeRedactions, blobToDataUrl, dataUrlToBlob, processUpload } from './image';
import { buildStandaloneHtml } from './exportHtml';
import { ProjectError, parseProjectText, stringifyProject, validateGuideData, type ProjectGuideData } from './validate';
import { createGuide, createStep, newId } from './guideOps';
import { addGuideWithImages } from './storage';

type ImageLookup = (imageId: string) => Promise<StoredImage | undefined> | StoredImage | undefined;

/**
 * Build the portable representation of a guide.
 * Every step image goes through `bakeRedactions` when it has covered areas, so the original
 * unredacted pixels are never serialized; only the rasterized, covered picture is.
 */
export async function buildGuideData(guide: Guide, lookup: ImageLookup): Promise<ProjectGuideData> {
  const steps = [];
  for (const step of guide.steps) {
    const stored = await lookup(step.imageId);
    if (!stored) throw new Error(`Missing image for step ${step.id}`);
    let blob: Blob = new Blob([stored.bytes], { type: stored.mime });
    let { width, height } = stored;
    if (step.redactions.length > 0) {
      const baked = await bakeRedactions(blob, step.redactions);
      blob = baked.blob;
      width = baked.width;
      height = baked.height;
    }
    steps.push({
      instruction: step.instruction,
      image: await blobToDataUrl(blob),
      width,
      height,
      hotspot: step.hotspot,
    });
  }
  // Re-validate everything we are about to write out.
  return validateGuideData({ title: guide.title, description: guide.description, lang: guide.lang, steps });
}

export async function exportHtmlFile(guide: Guide, lookup: ImageLookup, labels: ViewerLabels): Promise<Blob> {
  const data = await buildGuideData(guide, lookup);
  const viewer: ViewerData = { ...data, labels };
  const html = await buildStandaloneHtml(viewer);
  return new Blob([html], { type: 'text/html;charset=utf-8' });
}

export async function exportProjectFile(guide: Guide, lookup: ImageLookup): Promise<Blob> {
  const data = await buildGuideData(guide, lookup);
  return new Blob([stringifyProject(data)], { type: 'application/json' });
}

/**
 * Turn an imported project into a stored guide. Every picture is decoded and re-encoded in
 * the browser, so a file that only pretends to be an image is rejected.
 *
 * All-or-nothing: pictures are processed one at a time into memory first (nothing is written yet),
 * then the guide and all its images are stored in a single transaction. A failure at any step
 * (decoder, quota, guide save) therefore leaves no image behind and never touches existing data,
 * and success is only reported after the transaction has committed.
 */
export async function importProjectText(text: string, fallbackLang: GuideLang): Promise<Guide> {
  const data = parseProjectText(text);
  let guide = createGuide({
    title: data.title || 'Imported guide',
    description: data.description,
    lang: data.lang ?? fallbackLang,
  });
  const steps = [];
  const images: StoredImage[] = [];
  let heldBytes = 0; // re-encoded pictures waiting for the commit; capped so memory stays bounded
  for (const s of data.steps) {
    const processed = await processUpload(await dataUrlToBlob(s.image));
    const bytes = await processed.blob.arrayBuffer();
    heldBytes += bytes.byteLength;
    if (heldBytes > LIMITS.maxImportFileBytes) throw new ProjectError('too_large', 'decoded pictures exceed the import limit');
    const imageId = newId();
    images.push({ id: imageId, guideId: guide.id, mime: processed.mime, bytes, width: processed.width, height: processed.height });
    steps.push({
      ...createStep({ imageId, width: processed.width, height: processed.height, instruction: s.instruction }),
      hotspot: s.hotspot,
    });
  }
  guide = { ...guide, steps };
  await addGuideWithImages(guide, images);
  return guide;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
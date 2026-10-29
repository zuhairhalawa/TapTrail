import { test } from '@playwright/test';
import { studioThumbnailScenario } from './helpers';

test.describe('studio thumbnails never show pending redactions unredacted', () => {
  test('first-step thumbnail has the cover painted in, while the editable draft stays unredacted', async ({ page }) => {
    await studioThumbnailScenario(page);
  });
});
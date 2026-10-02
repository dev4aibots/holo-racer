import { test, expect } from './fixtures';

/**
 * Boot smoke test: the game loads, renders its menu, and starts clean.
 * Fails on any console error / uncaught exception (see fixtures).
 */
test('boots to the holographic menu with no errors', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/HOLO-RACER/);

  // Menu mode cards.
  await expect(page.getByRole('button', { name: /cruise/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /time trial/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /coin rush/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /how to play/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /settings/i })).toBeVisible();

  // Canvases mounted (WebGL scene + glove overlay).
  expect(await page.locator('canvas').count()).toBeGreaterThanOrEqual(1);

  // WebGL actually works — not the graceful-failure screen.
  await expect(page.locator('[data-screen="fatal"]')).toHaveCount(0);

  await page.screenshot({ path: 'tests/e2e/screenshots/boot-menu.png' });
});

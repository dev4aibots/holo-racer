import { test, expect } from './fixtures';

/**
 * Settings panel opens from the menu and exposes the key options.
 */
test('settings panel opens and lists options', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /settings/i }).click();

  const settings = page.locator('[data-screen="settings"]');
  await expect(settings).toBeVisible({ timeout: 15_000 });

  // Core options every player needs.
  await expect(settings.getByText(/steering sensitivity/i)).toBeVisible();
  await expect(settings.getByText(/camera view/i)).toBeVisible();
  await expect(settings.getByText(/mute audio/i)).toBeVisible();
  await page.screenshot({ path: 'tests/e2e/screenshots/settings.png' });

  // Escape closes the overlay back to the menu.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /cruise/i })).toBeVisible({ timeout: 15_000 });
});

test('how-to-play panel opens and closes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /how to play/i }).click();
  await expect(page.locator('[data-screen="howto"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/pinch = click/i)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /cruise/i })).toBeVisible({ timeout: 15_000 });
});

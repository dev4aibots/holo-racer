import { test, expect, hudSpeed } from './fixtures';

/**
 * Pause menu: P pauses mid-race, all buttons present, resume continues.
 */
test('pause menu opens, shows actions, and resume continues the race', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /cruise/i }).click();

  await page.keyboard.down('ArrowUp');
  await expect
    .poll(async () => hudSpeed(page), { timeout: 180_000, intervals: [2_000] })
    .toBeGreaterThan(5);

  await page.keyboard.press('p');
  await page.keyboard.up('ArrowUp');

  const pause = page.locator('[data-screen="pause"]');
  await expect(pause).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /resume/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /restart/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /settings/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /quit/i })).toBeVisible();
  await page.screenshot({ path: 'tests/e2e/screenshots/pause-menu.png' });

  // Resume: speed climbs again.
  await page.getByRole('button', { name: /resume/i }).click();
  await page.keyboard.down('ArrowUp');
  await expect
    .poll(async () => hudSpeed(page), { timeout: 120_000, intervals: [2_000] })
    .toBeGreaterThan(5);
  await page.keyboard.up('ArrowUp');
});

test('quit to menu returns to the mode select', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /cruise/i }).click();
  await page.keyboard.down('ArrowUp');
  await expect
    .poll(async () => hudSpeed(page), { timeout: 180_000, intervals: [2_000] })
    .toBeGreaterThan(5);
  await page.keyboard.up('ArrowUp');

  await page.keyboard.press('p');
  await expect(page.locator('[data-screen="pause"]')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /quit/i }).click();
  await expect(page.getByRole('button', { name: /cruise/i })).toBeVisible({ timeout: 15_000 });
});

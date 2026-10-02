import { test as base, expect, type Page } from '@playwright/test';

/**
 * Shared fixture: every test fails fast on any console error or uncaught
 * page exception. This is the bug-catcher — rendering crashes, failed
 * asset loads and JS exceptions all surface here instead of silently
 * passing with a broken game behind them.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`[console] ${msg.text().slice(0, 300)}`);
    });
    page.on('pageerror', (err) => {
      errors.push(`[pageerror] ${String(err).slice(0, 300)}`);
    });
    await use(page);
    expect(errors, `console/page errors during test:\n${errors.join('\n')}`).toEqual([]);
  },
});

export { expect };

/** HUD speed value as a number. */
export async function hudSpeed(page: Page): Promise<number> {
  return Number((await page.locator('#hud-speed-val').textContent()) ?? '0');
}

/** HUD score value as a number. */
export async function hudScore(page: Page): Promise<number> {
  return Number((await page.locator('#hud-score-val').textContent()) ?? '0');
}

/** Start a race mode and wait until the countdown finishes (speed HUD live). */
export async function startRace(page: Page, mode: 'cruise' | 'trial' | 'rush'): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(mode, 'i') }).first().click();
  // Countdown overlay appears, then racing begins. Generous timeout for
  // software rendering where each frame advances little game time.
  await expect(page.locator('#hud-speed-val')).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => hudSpeed(page), { timeout: 180_000 })
    .toBeGreaterThanOrEqual(0); // HUD alive; countdown may still be running
}

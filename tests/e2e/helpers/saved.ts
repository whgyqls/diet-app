import type { Page } from '@playwright/test';

/**
 * Waits until edits are on the server: the "저장 중…" mark (data-testid="save-status") is gone.
 * Edits are collected for a moment before they are written, so the mark appears at once after an edit that has
 * to be saved; give it a short time to show up, then wait for it to go. Call it before a reload or a page
 * change that follows an edit, or the edit may still be on its way.
 */
export async function waitForSaved(page: Page): Promise<void> {
  const mark = page.getByTestId('save-status');
  await mark.waitFor({ state: 'visible', timeout: 400 }).catch(() => {});
  await mark.waitFor({ state: 'detached', timeout: 15_000 });
}

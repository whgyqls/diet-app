// /privacy is public, linked from the login screen, and says the same about deletion as the delete dialog.
import { expect, test } from '@playwright/test';
import { ACCOUNT_DATA_TEXT } from '../../src/lib/ui-labels';

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the page opens without a login and the login screen links to it', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('link', { name: '개인정보 안내' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(
      page.getByRole('heading', { name: '개인정보 안내' }),
    ).toBeVisible();
    // the heading is there, so the previous page is gone: one <main> left
    const notice = page.locator('main', {
      has: page.getByRole('heading', { name: '개인정보 안내' }),
    });
    // what it says is collected, stored and where
    for (const text of [
      '이메일 주소',
      'Supabase',
      'Netlify',
      'Google',
      '설정 → 계정 삭제',
    ])
      await expect(notice).toContainText(text);
    // no contact address, and nothing about the AI explanation yet
    await expect(notice).not.toContainText('@');
    await expect(notice).not.toContainText('Anthropic');
  });

  test('a visitor stays on the page (it is not sent to the login form)', async ({
    page,
  }) => {
    await page.goto('/privacy');
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByLabel('이메일')).toHaveCount(0);
  });
});

test('the privacy page and the delete dialog name the same data', async ({
  page,
}) => {
  await page.goto('/privacy');
  await expect(page.locator('main')).toContainText(ACCOUNT_DATA_TEXT);
  await page.goto('/settings');
  await page.getByRole('button', { name: '계정 삭제' }).click();
  await expect(
    page.getByRole('region', { name: '계정을 삭제할까요?' }),
  ).toContainText(ACCOUNT_DATA_TEXT);
  // the settings page links to the notice too
  await page.getByRole('button', { name: '취소' }).click();
  await page.getByRole('link', { name: '개인정보 안내' }).click();
  await expect(page).toHaveURL(/\/privacy$/);
});

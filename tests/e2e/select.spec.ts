import { expect, test } from '@playwright/test';

test('food card cycles ok -> favorite -> none and survives reload', async ({
  page,
}) => {
  await page.goto('/select');
  const card = page.getByRole('button', { name: /^닭가슴살, / });
  await card.click();
  await expect(card).toHaveAttribute('aria-label', '닭가슴살, 먹을 수 있음');
  await card.click();
  await expect(card).toHaveAttribute('aria-label', '닭가슴살, 좋아함');
  await page.reload();
  await expect(
    page.getByRole('button', { name: '닭가슴살, 좋아함' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '닭가슴살, 좋아함' }).click();
  await expect(
    page.getByRole('button', { name: '닭가슴살, 선택 안 함' }),
  ).toBeVisible();
});

test('info sheet opens and the minimum condition notice shows', async ({
  page,
}) => {
  await page.goto('/select');
  await expect(page.getByRole('status')).toContainText('단백질');
  await page.getByRole('button', { name: '닭가슴살 영양성분 보기' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('pescatarian dims meat cards', async ({ page }) => {
  await page.goto('/onboarding');
  await page.getByRole('button', { name: /페스코/ }).click();
  await page.goto('/select');
  await expect(
    page.getByText('이 스타일에서는 추천에서 제외돼요').first(),
  ).toBeVisible();
});

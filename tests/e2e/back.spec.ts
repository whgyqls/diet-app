// "← 이전 화면": goes back only when the app followed a link from there, otherwise to the screen's parent.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { seedServer } from './helpers/seed';

const PROFILE = {
  sex: 'female',
  birthYear: 1996,
  heightCm: 163,
  weightKg: 60,
  activityLevel: 2,
  goal: 'lose',
  mealsPerDay: 3,
};
const FOODS = {
  'chicken-breast': 'ok',
  'beef-eye-round': 'ok',
  'white-rice': 'ok',
  cabbage: 'ok',
  lettuce: 'ok',
  almond: 'ok',
};

const back = (page: Page) => page.getByRole('button', { name: '이전 화면' });
const url = (path: string) => new RegExp(`${path === '/' ? '' : path}/?$`);

test.describe("opened directly: the screen's parent", () => {
  for (const [from, to] of [
    ['/onboarding', '/'],
    ['/select', '/onboarding'],
    ['/saved', '/plan'],
    ['/settings', '/'],
  ] as const)
    test(`${from} -> ${to}`, async ({ page }) => {
      await page.goto(from);
      await back(page).click();
      await expect(page).toHaveURL(url(to));
    });

  test('/plan -> /select', async ({ page }) => {
    await seedServer({
      profile: PROFILE,
      selection: { foods: FOODS, seasonings: {} },
    });
    await page.goto('/plan');
    await back(page).click();
    await expect(page).toHaveURL(url('/select'));
  });
});

test('the home screen has no back button', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('link', { name: /시작하기|이어서/ }).first(),
  ).toBeVisible();
  await expect(back(page)).toHaveCount(0);
});

test('after a link, back returns to that screen; pressed again it uses the parent and stays in the app', async ({
  page,
}) => {
  await seedServer({
    profile: PROFILE,
    selection: { foods: FOODS, seasonings: {} },
  });
  await page.goto('/plan');
  await page
    .getByRole('link', { name: '재료 다시 고르기' })
    .first()
    .click({ timeout: 30_000 });
  await expect(page).toHaveURL(url('/select'));
  await back(page).click(); // the app knows /plan was the previous screen
  await expect(page).toHaveURL(url('/plan'));
  await back(page).click(); // after going back nothing is known: the parent of /plan
  await expect(page).toHaveURL(url('/select'));
  await back(page).click(); // and again: /select has no known previous screen
  await expect(page).toHaveURL(url('/onboarding'));
});

test('settings -> privacy -> back returns to settings', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('link', { name: '개인정보 안내' }).click();
  await expect(page).toHaveURL(url('/privacy'));
  await back(page).click();
  await expect(page).toHaveURL(url('/settings'));
});

test('the browser back button does not make the app button leave: it falls back to the parent', async ({
  page,
}) => {
  await page.goto('/settings');
  await page.getByRole('link', { name: '개인정보 안내' }).click();
  await expect(page).toHaveURL(url('/privacy'));
  await page.goBack();
  await expect(page).toHaveURL(url('/settings'));
  await page.goForward();
  await expect(page).toHaveURL(url('/privacy'));
  await back(page).click(); // history was used: no known previous screen, so the parent of /privacy
  await expect(page).toHaveURL(url('/'));
});

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('/privacy opened directly goes to the first screen', async ({
    page,
  }) => {
    await page.goto('/privacy');
    await back(page).click();
    await expect(page).toHaveURL(url('/'));
    await expect(page.getByLabel('이메일')).toBeVisible();
  });
});

test('the button is at least 44px', async ({ page }) => {
  for (const path of ['/settings', '/privacy', '/saved']) {
    await page.goto(path);
    const box = await back(page).boundingBox();
    expect(box!.height, path).toBeGreaterThanOrEqual(44);
    expect(box!.width, path).toBeGreaterThanOrEqual(44);
  }
});

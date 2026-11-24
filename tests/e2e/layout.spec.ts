// A page must not scroll sideways at the phone width (the project viewport is 375x667, see playwright.config.ts).
// Found on /plan: the page was wider than the screen because of the card carousel (see the layout fix notes).
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { seedServer, type SeedData } from './helpers/seed';

// Same values as PROFILE and FOODS in plan.spec.ts. Not imported: importing a spec file would register its
// tests a second time.
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

/** Server data for the test user (the app reads its data from the server since Phase 5d). */
async function seed(page: Page, state: Record<string, unknown>) {
  void page;
  await seedServer(state as SeedData);
}

/** How far the page is wider than the screen (0 = fits). */
const sidewaysPixels = (page: Page) =>
  page.evaluate(() => {
    const de = document.documentElement;
    return de.scrollWidth - de.clientWidth;
  });

// Each page waits for its real content first: a loading state is narrow and would pass for the wrong reason.
const PAGES: { path: string; ready: (page: Page) => Promise<void> }[] = [
  {
    path: '/',
    ready: (p) => p.getByRole('link', { name: '시작하기' }).waitFor(),
  },
  {
    path: '/onboarding',
    ready: (p) =>
      p.getByRole('heading', { name: '프로필·목표 입력' }).waitFor(),
  },
  {
    path: '/select',
    ready: (p) => p.getByRole('button', { name: /^닭가슴살, / }).waitFor(),
  },
  {
    path: '/saved',
    ready: (p) => p.getByText('아직 저장한 조합이 없어요').waitFor(),
  },
  {
    path: '/settings',
    ready: (p) => p.getByRole('button', { name: '로그아웃' }).waitFor(),
  },
];

for (const { path, ready } of PAGES) {
  test(`${path} does not scroll sideways at 375px`, async ({ page }) => {
    await page.goto(path);
    await ready(page);
    expect(await sidewaysPixels(page)).toBeLessThanOrEqual(0);
  });
}

test('/plan does not scroll sideways at 375px (cards loaded)', async ({
  page,
}) => {
  await seed(page, {
    profile: PROFILE,
    selection: { foods: FOODS, seasonings: {} },
  });
  await page.goto('/plan');
  await expect(page.getByRole('article').first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('region', { name: '하루 합계' }).waitFor();
  expect(await sidewaysPixels(page)).toBeLessThanOrEqual(0);
});

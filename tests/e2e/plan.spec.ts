// Phase 4a plan screen. Written only: this server cannot run a browser, so it is not executed here.
import { expect, test, type Page } from '@playwright/test';

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

/** Same shape as the zustand persist payload (src/lib/store/appStore.ts, version 2). */
async function seed(page: Page, state: Record<string, unknown>) {
  await page.addInitScript(
    (payload) => {
      window.localStorage.setItem('diet-app-v1', JSON.stringify(payload));
    },
    {
      state: { styles: [], overrides: {}, step: 0, kits: [], ...state },
      version: 2,
    },
  );
}

test('home start button leads to onboarding', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: '시작하기' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test('home shows the continue link only when profile and selection are saved', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: '시작하기' })).toBeVisible();
  await expect(page.getByRole('link', { name: /이어서/ })).toHaveCount(0);

  await seed(page, {
    profile: PROFILE,
    selection: { foods: FOODS, seasonings: {} },
  });
  await page.goto('/');
  await expect(
    page.getByRole('link', { name: '이어서 추천 보기' }),
  ).toBeVisible();
});

test('/plan without a profile guides to onboarding', async ({ page }) => {
  await page.goto('/plan');
  await expect(page.getByText('먼저 프로필을 입력해 주세요')).toBeVisible();
  await page.getByRole('link', { name: '프로필 입력하러 가기' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test('/plan with a profile but no protein/fiber guides to select', async ({
  page,
}) => {
  await seed(page, {
    profile: PROFILE,
    selection: { foods: {}, seasonings: {} },
  });
  await page.goto('/plan');
  await expect(page.getByText(/재료를 1개 이상 골라 주세요/)).toBeVisible();
  await page.getByRole('link', { name: '재료 고르러 가기' }).click();
  await expect(page).toHaveURL(/\/select$/);
});

test('shows loading, then bars, meal tabs and 5 swipeable cards', async ({
  page,
}) => {
  await seed(page, {
    profile: PROFILE,
    selection: { foods: FOODS, seasonings: {} },
  });
  await page.goto('/plan');
  await expect(page.getByText('추천 조합을 계산하고 있어요')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '하루 합계 / 목표' }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('progressbar')).toHaveCount(6);
  await expect(page.getByRole('tab')).toHaveText(['아침', '점심', '저녁']);
  await expect(page.getByRole('article')).toHaveCount(5);
});

test('2 meals per day shows only lunch and dinner tabs', async ({ page }) => {
  await seed(page, {
    profile: { ...PROFILE, mealsPerDay: 2 },
    selection: { foods: FOODS, seasonings: {} },
  });
  await page.goto('/plan');
  await expect(page.getByRole('tab')).toHaveText(['점심', '저녁'], {
    timeout: 30_000,
  });
});

test('picking another combo updates the day total and marks the card', async ({
  page,
}) => {
  await seed(page, {
    profile: PROFILE,
    selection: { foods: FOODS, seasonings: {} },
  });
  await page.goto('/plan');
  const kcalBar = page.getByRole('progressbar', { name: '칼로리' });
  await expect(kcalBar).toBeVisible({ timeout: 30_000 });
  const before = await kcalBar.getAttribute('aria-valuenow');

  const pickButtons = page.getByRole('button', { name: '이 조합 선택' });
  await expect(pickButtons.first()).toBeVisible();
  await pickButtons.first().click();
  await expect(page.getByRole('button', { name: '선택됨' })).toHaveCount(1);
  // a different combo with a different kcal is expected for at least one of the other cards
  await expect(kcalBar).not.toHaveAttribute('aria-valuenow', before ?? '');
});

test('cards show basis, cooking hint, seasoning and the empty AI slot', async ({
  page,
}) => {
  await seed(page, {
    profile: PROFILE,
    selection: { foods: FOODS, seasonings: {} },
  });
  await page.goto('/plan');
  const card = page.getByRole('article').first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText(/\((생것|조리 후)\)/).first()).toBeVisible();
  await expect(card.getByText('양념 권장량')).toBeVisible();
  await expect(card.locator('[data-slot="ai-explain"]')).toBeEmpty();
});

test('flag details are collapsed by default and open to show the source', async ({
  page,
}) => {
  await seed(page, {
    profile: PROFILE,
    styles: ['lowCarb'],
    selection: { foods: FOODS, seasonings: {} },
  });
  await page.goto('/plan');
  const summary = page.locator('details summary').first();
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/근거:/).first()).toBeHidden();
  await summary.click();
  await expect(page.getByText(/근거:/).first()).toBeVisible();
});

test('plan survives a reload with the same first combo', async ({ page }) => {
  await seed(page, {
    profile: PROFILE,
    selection: { foods: FOODS, seasonings: {} },
  });
  await page.goto('/plan');
  const first = page.getByRole('article').first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  const text = await first.innerText();
  await page.reload();
  await expect(page.getByRole('article').first()).toBeVisible({
    timeout: 30_000,
  });
  expect(await page.getByRole('article').first().innerText()).toBe(text);
});

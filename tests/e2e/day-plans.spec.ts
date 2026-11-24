// Phase 6a: save the picked day by date on /plan, list the dates on /saved, delete one.
// Needs supabase/migrations/0004_day_plans.sql on the test project.
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

const saveButton = (page: Page) =>
  page.getByRole('button', { name: '이 날짜로 저장' });
const dateInput = (page: Page) => page.getByLabel('저장할 날짜');
const cards = (page: Page) =>
  page.getByRole('region', { name: '날짜별 식단' }).getByRole('article');

async function openPlan(page: Page) {
  await seedServer({
    profile: PROFILE,
    selection: { foods: FOODS, seasonings: {} },
  });
  await page.goto('/plan');
  await expect(saveButton(page)).toBeVisible({ timeout: 30_000 });
}

async function saveFor(page: Page, date: string) {
  await dateInput(page).fill(date);
  await saveButton(page).click();
  await expect(page.getByText(`${date} 식단을 저장했어요.`)).toBeVisible();
}

test("the date starts at today (the browser's date) and can be any valid date", async ({
  page,
}) => {
  await openPlan(page);
  const today = await page.evaluate(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
  await expect(dateInput(page)).toHaveValue(today);
  await expect(saveButton(page)).toBeEnabled();
});

test('save a date, see it on /saved with its foods and basis, newest date first', async ({
  page,
}) => {
  await openPlan(page);
  await saveFor(page, '2026-11-24');
  await saveFor(page, '2026-12-01'); // a future date is fine
  await page.getByRole('link', { name: '저장한 조합에서 보기' }).click();
  await expect(page).toHaveURL(/\/saved$/);
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).nth(0)).toHaveAttribute(
    'aria-label',
    '날짜별 식단: 2026-12-01',
  );
  await expect(cards(page).nth(1)).toContainText('2026-11-24 (화)');
  await expect(cards(page).nth(1)).toContainText('하루 합계');
  await expect(cards(page).nth(1)).toContainText(/\d+g\s*\((생것|조리 후)\)/);
  await expect(cards(page).nth(1)).toContainText(/아침|점심|저녁/);
});

test('saving the same date again changes only that date', async ({ page }) => {
  await openPlan(page);
  await saveFor(page, '2026-11-20');
  await saveFor(page, '2026-11-24');
  // pick another card of a meal so the plan differs, then save the same date again
  await page.getByRole('button', { name: '이 조합 선택' }).first().click();
  await saveFor(page, '2026-11-24');
  await page.goto('/saved');
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).nth(0)).toHaveAttribute(
    'aria-label',
    '날짜별 식단: 2026-11-24',
  );
  await expect(cards(page).nth(1)).toHaveAttribute(
    'aria-label',
    '날짜별 식단: 2026-11-20',
  );
});

test('delete asks first; cancel keeps it; delete removes only that date and survives a reload', async ({
  page,
}) => {
  await openPlan(page);
  await saveFor(page, '2026-11-20');
  await saveFor(page, '2026-11-24');
  await page.goto('/saved');
  await expect(cards(page)).toHaveCount(2);

  await page.getByRole('button', { name: '2026-11-24 식단 삭제' }).click();
  await expect(page.getByText('이 날짜의 식단을 삭제할까요?')).toBeVisible();
  await page.getByRole('button', { name: '취소' }).click();
  await expect(cards(page)).toHaveCount(2);

  await page.getByRole('button', { name: '2026-11-24 식단 삭제' }).click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toHaveAttribute(
    'aria-label',
    '날짜별 식단: 2026-11-20',
  );
  await page.reload();
  await expect(cards(page)).toHaveCount(1);
});

test('nothing saved yet: the empty text', async ({ page }) => {
  await seedServer({
    profile: PROFILE,
    selection: { foods: FOODS, seasonings: {} },
  });
  await page.goto('/saved');
  await expect(page.getByTestId('day-plans-empty')).toContainText(
    '아직 날짜별로 저장한 식단이 없어요',
  );
});

test('a date outside 2020-01-01 ~ 2099-12-31 or an empty date cannot be saved', async ({
  page,
}) => {
  await openPlan(page);
  for (const bad of ['2019-12-31', '2100-01-01', '']) {
    await dateInput(page).fill(bad);
    await expect(saveButton(page)).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText(
      '2020-01-01부터 2099-12-31',
    );
  }
  await dateInput(page).fill('2020-01-01');
  await expect(saveButton(page)).toBeEnabled();
});

test('a failed save says so and keeps the screen working; a failed delete too', async ({
  page,
}) => {
  await openPlan(page);
  await saveFor(page, '2026-11-24');
  await page.route(/\/rest\/v1\/day_plans/, (route) => route.abort());
  await dateInput(page).fill('2026-11-25');
  await saveButton(page).click();
  await expect(
    page.getByText('저장하지 못했어요. 잠시 뒤에 다시 시도해 주세요.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '다시 추천' })).toBeVisible();
  await page.unroute(/\/rest\/v1\/day_plans/);

  await page.goto('/saved');
  await expect(cards(page)).toHaveCount(1);
  await page.route(/\/rest\/v1\/day_plans/, (route) => route.abort());
  await page.getByRole('button', { name: '2026-11-24 식단 삭제' }).click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(
    page.getByText('삭제하지 못했어요. 잠시 뒤에 다시 시도해 주세요.'),
  ).toBeVisible();
  await expect(cards(page)).toHaveCount(1); // still there
});

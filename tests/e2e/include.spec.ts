// Phase 6b: foods the day must contain.
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
  tofu: 'ok',
  egg: 'ok',
  'white-rice': 'ok',
  cabbage: 'ok',
  lettuce: 'ok',
  almond: 'ok',
};

test('a picked food is applied and shown as a chip without a missing warning', async ({
  page,
}) => {
  await seedServer({
    profile: PROFILE,
    selection: { foods: FOODS, seasonings: {} },
  });
  await page.goto('/plan');
  await page
    .getByRole('button', { name: '꼭 넣을 재료 고르기' })
    .click({ timeout: 30_000 });
  await page.getByRole('checkbox', { name: /^두부/ }).check();
  await page.getByRole('button', { name: '적용하기' }).click();
  const panel = page.getByRole('region', { name: '꼭 넣을 재료' });
  await expect(panel.getByText('두부', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('progressbar').first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('include-missing')).toHaveCount(0);
  // Removing the chip clears the list again.
  await panel.getByRole('button', { name: '두부 빼기' }).click();
  await expect(
    page.getByRole('button', { name: '꼭 넣을 재료 고르기' }),
  ).toBeVisible({ timeout: 30_000 });
});

test('a category over its capacity is refused with a message', async ({
  page,
}) => {
  await seedServer({
    profile: { ...PROFILE, mealsPerDay: 2 },
    selection: { foods: FOODS, seasonings: {} },
  });
  await page.goto('/plan');
  await page
    .getByRole('button', { name: '꼭 넣을 재료 고르기' })
    .click({ timeout: 30_000 });
  for (const name of [/^닭가슴살/, /^소고기 홍두깨살/])
    await page.getByRole('checkbox', { name }).check();
  // The 3rd protein is refused, so the box stays unchecked (click, not check: check() demands the change).
  await page.getByRole('checkbox', { name: /^두부/ }).click();
  await expect(page.getByTestId('include-full')).toContainText('최대 2개');
  await expect(page.getByRole('checkbox', { name: /^두부/ })).not.toBeChecked();
});

test('a food left out by the style cannot be picked', async ({ page }) => {
  await seedServer({
    profile: PROFILE,
    styles: ['lactoOvo'],
    selection: { foods: FOODS, seasonings: {} },
  });
  await page.goto('/plan');
  await page
    .getByRole('button', { name: '꼭 넣을 재료 고르기' })
    .click({ timeout: 30_000 });
  await expect(
    page.getByRole('checkbox', { name: /^닭가슴살/ }),
  ).toBeDisabled();
  await expect(
    page.getByText('이 스타일에서는 추천에서 제외돼요').first(),
  ).toBeVisible();
});

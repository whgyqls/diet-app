// /saved list. Written only: this server cannot run a browser, so it is not executed here.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { seedServer, waitForSavedCombos } from './helpers/seed';

const totals = {
  kcal: 612,
  protein: 45,
  carbs: 60,
  netCarbs: 55,
  fiber: 5,
  fat: 18,
  satFat: 3,
  sodium: 600,
  cholesterol: 90,
};
const combo = (
  id: string,
  mealType: 'breakfast' | 'lunch' | 'dinner',
  savedAt: number,
  proteinName: string,
) => ({
  id,
  savedAt,
  mealType,
  requestFingerprint: 'fp',
  signature: `sig-${id}`,
  items: [
    // a real food id (the app drops saved combos with unknown foods when it reads them); the shown name is `name`
    { foodId: 'chicken-breast', name: proteinName, grams: 150, basis: 'raw' },
    { foodId: 'white-rice', name: '쌀밥', grams: 200, basis: 'cooked' },
  ],
  oils: [{ foodId: 'olive-oil', name: '올리브유', grams: 4.5, basis: 'raw' }],
  seasonings: [{ id: 'salt', name: '소금', units: 0.5, unitLabel: '작은술' }],
  totals,
});

async function seedSaved(page: Page, items: ReturnType<typeof combo>[]) {
  void page;
  await seedServer({ saved: items });
}

test('empty state points to the plan screen', async ({ page }) => {
  await page.goto('/saved');
  await expect(page.getByText('아직 저장한 조합이 없어요')).toBeVisible();
  await page.getByRole('link', { name: '추천 보러 가기' }).click();
  await expect(page).toHaveURL(/\/plan$/);
});

test('groups by meal (breakfast, lunch, dinner) with the newest first', async ({
  page,
}) => {
  await seedSaved(page, [
    combo('a', 'dinner', 100, '연어'),
    combo('b', 'lunch', 200, '닭가슴살'),
    combo('c', 'breakfast', 300, '달걀'),
    combo('d', 'lunch', 400, '두부'),
  ]);
  await page.goto('/saved');
  const headings = page.getByRole('heading', { level: 2 });
  await expect(headings).toHaveText([/아침/, /점심/, /저녁/]);
  await expect(
    page.getByRole('region', { name: '점심' }).getByRole('article'),
  ).toHaveCount(2);
  const lunch = await page
    .getByRole('region', { name: '점심' })
    .getByRole('article')
    .allInnerTexts();
  expect(lunch[0]).toContain('두부'); // newest first
  expect(lunch[1]).toContain('닭가슴살');
});

test('a card shows foods with basis, oil, seasoning and the day totals line', async ({
  page,
}) => {
  await seedSaved(page, [combo('a', 'lunch', 100, '닭가슴살')]);
  await page.goto('/saved');
  const card = page.getByRole('article').first();
  await expect(card).toContainText('닭가슴살');
  await expect(card).toContainText('150g');
  await expect(card).toContainText('(생것)');
  await expect(card).toContainText('(조리 후)');
  await expect(card).toContainText('올리브유 4.5g');
  await expect(card).toContainText('소금 0.5작은술');
  await expect(card).toContainText('612kcal');
  await expect(card).toContainText('나트륨 600mg');
});

test('delete asks first, can be cancelled, and survives a reload', async ({
  page,
}) => {
  await seedSaved(page, [
    combo('a', 'lunch', 100, '닭가슴살'),
    combo('b', 'lunch', 200, '두부'),
  ]);
  await page.goto('/saved');
  await page.getByRole('button', { name: /^두부.* 삭제$/ }).click();
  await expect(page.getByText('삭제할까요?')).toBeVisible();
  await page.getByRole('button', { name: '취소' }).click();
  await expect(page.getByRole('article')).toHaveCount(2);

  await page.getByRole('button', { name: /^두부.* 삭제$/ }).click();
  await page.getByRole('button', { name: /삭제 확인$/ }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await waitForSavedCombos(1);
  await page.reload();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article').first()).toContainText('닭가슴살');
});

test('deleting the last combo shows the empty state', async ({ page }) => {
  await seedSaved(page, [combo('a', 'dinner', 100, '연어')]);
  await page.goto('/saved');
  await page.getByRole('button', { name: /삭제$/ }).click();
  await page.getByRole('button', { name: /삭제 확인$/ }).click();
  await expect(page.getByTestId('saved-empty')).toBeVisible();
});

test('buttons are at least 44px', async ({ page }) => {
  await seedSaved(page, [combo('a', 'lunch', 100, '닭가슴살')]);
  await page.goto('/saved');
  const box = await page.getByRole('button', { name: /삭제$/ }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

test('a star on the plan screen shows up here', async ({ page }) => {
  await seedServer({
    profile: {
      sex: 'female',
      birthYear: 1996,
      heightCm: 163,
      weightKg: 60,
      activityLevel: 2,
      goal: 'lose',
      mealsPerDay: 3,
    },
    selection: {
      foods: {
        'chicken-breast': 'ok',
        'white-rice': 'ok',
        cabbage: 'ok',
        lettuce: 'ok',
      },
      seasonings: {},
    },
  });
  await page.goto('/plan');
  await page
    .getByRole('button', { name: '조합 1 저장' })
    .click({ timeout: 30_000 });
  await waitForSavedCombos(1);
  await page.getByRole('link', { name: '저장한 조합 보기' }).click();
  await expect(page).toHaveURL(/\/saved$/);
  await expect(page.getByRole('article')).toHaveCount(1);
});

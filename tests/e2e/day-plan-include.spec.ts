// 6a "이 재료로 다시 추천받기": the foods of a saved day become the "must include" foods of a new recommendation.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { activeUser, seedServer, testAdmin } from './helpers/seed';

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
  'white-rice': 'ok',
  cabbage: 'ok',
  lettuce: 'ok',
  almond: 'ok',
};
const TOTALS = {
  kcal: 500,
  protein: 30,
  carbs: 50,
  netCarbs: 45,
  fiber: 5,
  fat: 10,
  satFat: 2,
  sodium: 300,
  cholesterol: 50,
};
const item = (foodId: string, name: string) => ({
  foodId,
  name,
  grams: 100,
  basis: 'raw' as const,
});
const meal = (
  mealType: string,
  items: ReturnType<typeof item>[],
  oils: ReturnType<typeof item>[] = [],
) => ({
  mealType,
  items,
  oils,
  seasonings: [],
  totals: TOTALS,
});

/** A saved day written straight to the table, so the foods in it are known. */
async function saveDay(date: string, meals: ReturnType<typeof meal>[]) {
  const { error } = await testAdmin()
    .from('day_plans')
    .insert({
      user_id: activeUser(),
      date,
      plan: { v: 1, meals, totals: TOTALS },
    });
  if (error) throw new Error(`seed day_plans: ${error.message}`);
}

const includeButton = (page: Page, date: string) =>
  page.getByRole('button', { name: `${date} 이 재료로 다시 추천받기` });
const panel = (page: Page) =>
  page.getByRole('region', { name: '꼭 넣을 재료' });

const DAY = [
  meal('breakfast', [
    item('chicken-breast', '닭가슴살'),
    item('white-rice', '쌀밥'),
    item('cabbage', '양배추'),
  ]),
  meal('lunch', [
    item('beef-eye-round', '소고기 홍두깨살'),
    item('lettuce', '상추'),
    item('almond', '아몬드'),
  ]),
];

test('the card says it is a new recommendation, and the button opens /plan with the foods of that day', async ({
  page,
}) => {
  await seedServer({
    profile: PROFILE,
    selection: { foods: FOODS, seasonings: {} },
  });
  await saveDay('2026-11-24', DAY);
  await page.goto('/saved');
  const note = page.getByText(
    '같은 식단이 아니라 그 재료를 넣은 새 추천이라 분량과 조합이 달라질 수 있어요.',
  );
  await expect(note).toBeVisible();
  await includeButton(page, '2026-11-24').click();
  await expect(page).toHaveURL(/\/plan$/);
  // the foods of the saved day, once each: 2 proteins, 1 carb, 2 fibers, 1 fat source
  for (const n of [
    '닭가슴살',
    '소고기 홍두깨살',
    '쌀밥',
    '양배추',
    '상추',
    '아몬드',
  ])
    await expect(panel(page).getByText(n, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  await expect(page.getByTestId('include-dropped')).toHaveCount(0);
  // and the recommendation is a plan again (not an error)
  await expect(page.getByRole('progressbar').first()).toBeVisible({
    timeout: 30_000,
  });
});

test('a button on every date card; the date it belongs to is in its name', async ({
  page,
}) => {
  await seedServer({
    profile: PROFILE,
    selection: { foods: FOODS, seasonings: {} },
  });
  await saveDay('2026-11-20', [DAY[0]]);
  await saveDay('2026-11-24', [DAY[1]]);
  await page.goto('/saved');
  await expect(includeButton(page, '2026-11-20')).toBeVisible();
  await expect(includeButton(page, '2026-11-24')).toBeVisible();
  await includeButton(page, '2026-11-20').click();
  await expect(panel(page).getByText('닭가슴살', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    panel(page).getByText('소고기 홍두깨살', { exact: true }),
  ).toHaveCount(0);
});

test('foods that cannot be taken over are told: not selected, a style, an oil, a food that is gone, over the limit', async ({
  page,
}) => {
  // a style that leaves out meat; cabbage is no longer selected; 2 meals now (a day saved with 3 meals)
  await seedServer({
    profile: { ...PROFILE, mealsPerDay: 2 },
    styles: ['lactoOvo'],
    selection: {
      foods: {
        'chicken-breast': 'ok', // selected, but the lacto-ovo style leaves it out
        tofu: 'ok',
        egg: 'ok',
        'white-rice': 'ok',
        'brown-rice': 'ok',
        'sweet-potato': 'ok',
        lettuce: 'ok',
        broccoli: 'ok',
        spinach: 'ok',
        almond: 'ok',
      },
      seasonings: {},
    },
  });
  await saveDay('2026-11-24', [
    meal(
      'breakfast',
      [
        item('chicken-breast', '닭가슴살'),
        item('white-rice', '쌀밥'),
        item('cabbage', '양배추'),
      ],
      [item('olive-oil', '올리브유')],
    ),
    meal('lunch', [
      item('tofu', '두부'),
      item('brown-rice', '현미밥'),
      item('no-such-food', '없는 재료'),
    ]),
    meal('dinner', [
      item('egg', '달걀'),
      item('sweet-potato', '고구마'),
      item('lettuce', '상추'),
    ]),
  ]);
  await page.goto('/saved');
  await includeButton(page, '2026-11-24').click();
  await expect(page).toHaveURL(/\/plan$/);
  const notice = page.getByTestId('include-dropped');
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(notice).toContainText(
    '닭가슴살은(는) 선택한 스타일에서 제외돼서',
  );
  await expect(notice).toContainText('양배추을(를) 선택에서 뺐어서');
  await expect(notice).toContainText(
    '기름은 꼭 넣을 재료로 고를 수 없어서 뺐어요.',
  );
  await expect(notice).toContainText('찾을 수 없는 재료는 뺐어요.');
  // 2 meals: protein limit 2 (tofu, egg fit), carb limit 2 (white-rice, brown-rice fit; sweet-potato is over)
  await expect(notice).toContainText(
    '고구마은(는) 하루 끼니 수 기준 상한 때문에 뺐어요.',
  );
  for (const n of ['두부', '달걀', '쌀밥', '현미밥', '상추'])
    await expect(panel(page).getByText(n, { exact: true })).toBeVisible();
  for (const n of ['닭가슴살', '양배추', '고구마', '올리브유'])
    await expect(panel(page).getByText(n, { exact: true })).toHaveCount(0);
});

test('with a "must include" list already chosen it asks first; cancel keeps it, change replaces it', async ({
  page,
}) => {
  await seedServer({
    profile: PROFILE,
    selection: { foods: FOODS, seasonings: {} },
  });
  await saveDay('2026-11-24', [DAY[0]]);
  await page.goto('/plan');
  await page
    .getByRole('button', { name: '꼭 넣을 재료 고르기' })
    .click({ timeout: 30_000 });
  await page.getByRole('checkbox', { name: /^두부/ }).check();
  await page.getByRole('button', { name: '적용하기' }).click();
  await expect(panel(page).getByText('두부', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('link', { name: '저장한 조합 보기' }).click();
  await expect(page).toHaveURL(/\/saved$/);

  await includeButton(page, '2026-11-24').click();
  await expect(
    page.getByText('꼭 넣을 재료를 이 날짜의 재료로 바꿀까요?'),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/saved$/); // nothing happened yet
  await page.getByRole('button', { name: '취소' }).click();
  await expect(
    page.getByText('꼭 넣을 재료를 이 날짜의 재료로 바꿀까요?'),
  ).toHaveCount(0);

  await includeButton(page, '2026-11-24').click();
  await page.getByRole('button', { name: '바꾸기' }).click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(panel(page).getByText('닭가슴살', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(panel(page).getByText('두부', { exact: true })).toHaveCount(0); // replaced, not added
});

test('without a profile the button is off and says what to do', async ({
  page,
}) => {
  await seedServer({ selection: { foods: FOODS, seasonings: {} } });
  await saveDay('2026-11-24', [DAY[0]]);
  await page.goto('/saved');
  await expect(includeButton(page, '2026-11-24')).toBeDisabled();
  await expect(
    page.getByText('프로필을 먼저 입력하면 쓸 수 있어요.'),
  ).toBeVisible();
});

test('the button is at least 44px tall', async ({ page }) => {
  await seedServer({
    profile: PROFILE,
    selection: { foods: FOODS, seasonings: {} },
  });
  await saveDay('2026-11-24', [DAY[0]]);
  await page.goto('/saved');
  const box = await includeButton(page, '2026-11-24').boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

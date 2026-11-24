// "이전 기록 불러오기" in a real browser (PLAN.md 9.2): a new account starts empty, the button restores the old
// pre-login record of this browser, the undo takes it back, another account's claim hides the button, and a
// restore that stopped half way is finished by pressing again without duplicates.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { seedServer, testAdmin } from './helpers/seed';

const OTHER_ACCOUNT = '99999999-9999-4999-8999-999999999999';

const totals = {
  kcal: 400,
  protein: 40,
  carbs: 20,
  netCarbs: 15,
  fiber: 5,
  fat: 10,
  satFat: 2,
  sodium: 300,
  cholesterol: 90,
};
const star = (n: number) => ({
  id: `old-${n}`,
  savedAt: 1000 + n,
  mealType: 'lunch',
  requestFingerprint: 'fp',
  signature: `cabbage:100,chicken-breast:${100 + n}|`,
  items: [
    {
      foodId: 'chicken-breast',
      name: '닭가슴살',
      grams: 100 + n,
      basis: 'raw',
    },
    { foodId: 'cabbage', name: '양배추', grams: 100, basis: 'raw' },
  ],
  oils: [],
  seasonings: [],
  totals,
});
const LEGACY_STATE = JSON.stringify({
  version: 2,
  state: {
    profile: {
      sex: 'male',
      birthYear: 1990,
      heightCm: 175,
      weightKg: 70,
      activityLevel: 2,
      goal: 'lose',
      mealsPerDay: 2,
    },
    styles: ['highProtein'],
    overrides: {},
    selection: {
      foods: { 'chicken-breast': 'ok', cabbage: 'ok', tofu: 'favorite' },
      seasonings: { salt: 'ok' },
    },
    kits: [1, 2].map((i) => ({
      id: `k${i}`,
      name: `옛 세트 ${i}`,
      selection: { foods: { tofu: 'ok' }, seasonings: {} },
      createdAt: i,
      updatedAt: i,
    })),
  },
});
const LEGACY_SAVED = JSON.stringify({ items: [star(1), star(2)] });

/** Puts the old pre-login record (and optionally a claim) into this browser before the app starts. */
async function seedLegacy(page: Page, claim?: string) {
  await page.addInitScript(
    ([state, saved, claimText]) => {
      if (!localStorage.getItem('diet-app-v1'))
        localStorage.setItem('diet-app-v1', state);
      if (!localStorage.getItem('diet-app-saved-v1'))
        localStorage.setItem('diet-app-saved-v1', saved);
      if (claimText && !localStorage.getItem('diet-app-legacy-claim-v1'))
        localStorage.setItem('diet-app-legacy-claim-v1', claimText);
    },
    [LEGACY_STATE, LEGACY_SAVED, claim ?? ''],
  );
}

const countOf = async (table: string, col: string, uid: string) => {
  const { count, error } = await testAdmin()
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(col, uid);
  if (error) throw new Error(error.message);
  return count ?? 0;
};
const restoreButton = (page: Page) =>
  page.getByRole('button', { name: '이전 기록 불러오기' });
const chicken = (page: Page) =>
  page.getByRole('button', { name: '닭가슴살, 먹을 수 있음' });

test('a new account starts empty; the button loads the previous record; the undo takes it back', async ({
  page,
  workerUser,
}) => {
  await seedLegacy(page);
  await page.goto('/select');
  await expect(restoreButton(page)).toBeVisible();
  await expect(chicken(page)).toHaveCount(0); // nothing copied silently

  await restoreButton(page).click(); // an empty account: no question, it just loads
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: '이전 기록을 불러왔어요' })
      .first(),
  ).toBeVisible();
  await expect(chicken(page)).toBeVisible();
  await expect(restoreButton(page)).toHaveCount(0);
  expect(await countOf('ingredient_kits', 'user_id', workerUser.id)).toBe(2);
  expect(await countOf('saved_combos', 'user_id', workerUser.id)).toBe(2);

  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(
    page.getByText('이전 기록 불러오기를 되돌렸어요.'),
  ).toBeVisible();
  await expect(chicken(page)).toHaveCount(0);
  await expect(restoreButton(page)).toBeVisible();
  expect(await countOf('ingredient_kits', 'user_id', workerUser.id)).toBe(0);
  expect(await countOf('saved_combos', 'user_id', workerUser.id)).toBe(0);
});

test('after a restore the button stays away, also after a reload and in another browser of the same account', async ({
  page,
  browser,
  workerUser,
}) => {
  await seedLegacy(page);
  await page.goto('/select');
  await restoreButton(page).click();
  await expect(chicken(page)).toBeVisible();
  await page.reload();
  await expect(chicken(page)).toBeVisible();
  await expect(restoreButton(page)).toHaveCount(0);

  const other = await browser.newContext({
    storageState: { cookies: workerUser.cookies, origins: [] },
  });
  try {
    const second = await other.newPage();
    await seedLegacy(second); // it has an old record of its own, but the account already loaded one
    await second.goto('http://localhost:3006/select');
    await expect(chicken(second)).toBeVisible();
    await expect(restoreButton(second)).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test('an account with values of its own is asked first; cancelling changes nothing', async ({
  page,
  workerUser,
}) => {
  await seedServer({ selection: { foods: { egg: 'ok' }, seasonings: {} } });
  await seedLegacy(page);
  await page.goto('/select');
  await restoreButton(page).click();
  const dialog = page.getByRole('alertdialog', {
    name: '이전 기록을 불러올까요?',
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('재료 선택(재료 3개로 바뀜)');
  await expect(dialog).toContainText('세트 2개');
  await dialog.getByRole('button', { name: '취소' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await countOf('ingredient_kits', 'user_id', workerUser.id)).toBe(0);
  await expect(chicken(page)).toHaveCount(0);

  await restoreButton(page).click();
  await dialog.getByRole('button', { name: '불러오기' }).click();
  await expect(chicken(page)).toBeVisible();
  expect(await countOf('ingredient_kits', 'user_id', workerUser.id)).toBe(2);
});

test("another account's claim hides the button and the record is not read", async ({
  page,
}) => {
  await seedLegacy(page, JSON.stringify({ uid: OTHER_ACCOUNT, at: 1 }));
  await page.goto('/select');
  await expect(
    page.getByRole('heading', { name: '재료 고르기' }),
  ).toBeVisible();
  await expect(restoreButton(page)).toHaveCount(0);
});

test('a restore that stops half way is finished by pressing again: no duplicates, no undo', async ({
  page,
  workerUser,
}) => {
  await seedLegacy(page);
  await page.goto('/select');
  let failures = 0;
  await page.route('**/rest/v1/rpc/set_food_prefs', (route) => {
    failures += 1;
    return route.abort();
  });
  await restoreButton(page).click();
  await expect(
    page.getByText('일부만 불러왔어요. 다시 눌러 이어서 불러오세요.'),
  ).toBeVisible();
  expect(failures).toBe(1);
  await expect(restoreButton(page)).toBeVisible(); // not marked as done: the button is still there
  expect(await countOf('ingredient_kits', 'user_id', workerUser.id)).toBe(2);

  await page.unroute('**/rest/v1/rpc/set_food_prefs');
  await restoreButton(page).click();
  await expect(page.getByText('이전 기록을 불러왔어요:')).toBeVisible();
  await expect(chicken(page)).toBeVisible();
  await expect(page.getByRole('button', { name: '되돌리기' })).toHaveCount(0); // finished, so no undo
  expect(await countOf('ingredient_kits', 'user_id', workerUser.id)).toBe(2);
  expect(await countOf('saved_combos', 'user_id', workerUser.id)).toBe(2);
});

test('pressing the button twice in a row restores once', async ({
  page,
  workerUser,
}) => {
  await seedLegacy(page);
  await page.goto('/select');
  await restoreButton(page).dblclick();
  await expect(chicken(page)).toBeVisible();
  expect(await countOf('ingredient_kits', 'user_id', workerUser.id)).toBe(2);
  expect(await countOf('saved_combos', 'user_id', workerUser.id)).toBe(2);
});

// Phase 4a plan screen. Written only: this server cannot run a browser, so it is not executed here.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { seedServer, waitForSavedCombos, type SeedData } from './helpers/seed';

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

/** Server data for the test user (the app reads its data from the server since Phase 5d). Same shape as before. */
async function seed(page: Page, state: Record<string, unknown>) {
  void page;
  await seedServer(state as SeedData);
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

// ---------------------------------------------------------------------------------------------
// Phase 4b: lock + reroll, swap, compare, save, repeat notice (written only, not run here)
// ---------------------------------------------------------------------------------------------
const seedAndOpen = async (
  page: Page,
  foods: Record<string, string> = FOODS,
) => {
  await seed(page, { profile: PROFILE, selection: { foods, seasonings: {} } });
  await page.goto('/plan');
  await expect(page.getByRole('article').first()).toBeVisible({
    timeout: 30_000,
  });
};
const articleTexts = (page: Page) => page.getByRole('article').allInnerTexts();

test('reroll keeps the picked card first and brings new cards', async ({
  page,
}) => {
  await seedAndOpen(page);
  const before = await articleTexts(page);
  await page.getByRole('button', { name: '다시 추천' }).click();
  await expect(page.getByRole('button', { name: '다시 추천' })).toBeEnabled({
    timeout: 30_000,
  });
  const after = await articleTexts(page);
  // the picked (first) card stays; the others are new combinations
  expect(after[0].replace(/조합 \d \/ \d/, '')).toBe(
    before[0].replace(/조합 \d \/ \d/, ''),
  );
  for (const text of after.slice(1))
    expect(before.map((b) => b.replace(/조합 \d \/ \d/, ''))).not.toContain(
      text.replace(/조합 \d \/ \d/, ''),
    );
});

test('a locked food stays in every card after rerolling', async ({ page }) => {
  await seedAndOpen(page);
  const lock = page.getByRole('button', { name: / 고정$/ }).first();
  const name = ((await lock.getAttribute('aria-label')) ?? '').replace(
    / 고정$/,
    '',
  );
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '다시 추천' }).click();
  await expect(page.getByRole('button', { name: '다시 추천' })).toBeEnabled({
    timeout: 30_000,
  });
  for (const text of await articleTexts(page)) expect(text).toContain(name);
});

test('a 3rd locked vegetable is refused with a notice', async ({ page }) => {
  await seedAndOpen(page, { ...FOODS, 'perilla-leaf': 'ok' });
  // lock vegetables one by one on whichever cards show them until the notice appears
  const veg = ['양배추', '상추', '깻잎'];
  for (const v of veg) {
    const btn = page.getByRole('button', { name: `${v} 고정` }).first();
    if (await btn.count()) await btn.click();
  }
  await expect(page.getByTestId('plan-notice')).toContainText(
    '식이섬유 재료는 최대 2개까지',
  );
});

test('swapping a food opens the list and re-portions the card', async ({
  page,
}) => {
  await seedAndOpen(page, { ...FOODS, salmon: 'ok', 'chicken-thigh': 'ok' });
  const card = page.getByRole('article').first();
  const before = await card.innerText();
  await card
    .getByRole('button', { name: / 바꾸기$/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('분량이 다시 계산돼요');
  // Candidates only: the close button (✕) is not inside the list.
  await dialog
    .getByRole('listitem')
    .getByRole('button')
    .and(page.locator('button:enabled'))
    .first()
    .click();
  await expect(dialog).toBeHidden();
  expect(await card.innerText()).not.toBe(before);
});

test('swap sheet closes with Escape', async ({ page }) => {
  await seedAndOpen(page);
  await page
    .getByRole('button', { name: / 바꾸기$/ })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('compare: needs 2, opens side by side, holds at most 3', async ({
  page,
}) => {
  await seedAndOpen(page);
  await page.getByRole('button', { name: '조합 1 비교에 담기' }).click();
  await expect(page.getByRole('button', { name: '비교하기' })).toBeDisabled();
  await page.getByRole('button', { name: '조합 2 비교에 담기' }).click();
  await page.getByRole('button', { name: '조합 3 비교에 담기' }).click();
  await page.getByRole('button', { name: '조합 4 비교에 담기' }).click();
  await expect(page.getByTestId('plan-notice')).toContainText(
    '비교는 최대 3개까지',
  );
  await page.getByRole('button', { name: '비교하기' }).click();
  const dialog = page.getByRole('dialog', { name: '조합 비교' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('columnheader').filter({ hasText: '아침' }),
  ).toHaveCount(3);
  await dialog.getByRole('button', { name: '빼기' }).first().click();
  await dialog.getByRole('button', { name: '닫기' }).click();
  await expect(page.getByText('비교 2/3')).toBeVisible();
});

test('a starred combo stays starred after a reload', async ({ page }) => {
  await seedAndOpen(page);
  const star = page.getByRole('button', { name: '조합 1 저장' });
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await waitForSavedCombos(1); // the star is written to the server, not by the "저장 중…" mark
  await page.reload();
  await expect(
    page.getByRole('button', { name: '조합 1 저장' }),
  ).toHaveAttribute('aria-pressed', 'true', {
    timeout: 30_000,
  });
  await page.getByRole('button', { name: '조합 1 저장' }).click();
  await expect(
    page.getByRole('button', { name: '조합 1 저장' }),
  ).toHaveAttribute('aria-pressed', 'false');
});

test('the same food in nearly every card shows the repeat notice', async ({
  page,
}) => {
  await seedAndOpen(page, {
    tofu: 'ok',
    cabbage: 'ok',
    lettuce: 'ok',
    'perilla-leaf': 'ok',
  });
  await expect(page.getByTestId('repeat-notice')).toContainText('두부');
  await expect(page.getByTestId('repeat-notice')).toContainText(
    '재료를 더 고르면',
  );
});

test('buttons on a card are at least 44px', async ({ page }) => {
  await seedAndOpen(page);
  const card = page.getByRole('article').first();
  for (const name of [
    / 고정$/,
    / 바꾸기$/,
    /비교에 담기$/,
    /저장$/,
    /이 조합 선택|선택됨/,
  ]) {
    const box = await card.getByRole('button', { name }).first().boundingBox();
    expect(box!.height, String(name)).toBeGreaterThanOrEqual(44);
    expect(box!.width, String(name)).toBeGreaterThanOrEqual(44);
  }
});

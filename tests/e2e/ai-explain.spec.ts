// Phase 6: AI explanation button. OpenRouter is never called here: /api/explain is answered by the test.
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

async function openPlan(page: import('@playwright/test').Page) {
  await seedServer({
    profile: PROFILE,
    selection: { foods: FOODS, seasonings: {} },
  });
  await page.goto('/plan');
  await expect(page.getByRole('article').first()).toBeVisible({
    timeout: 30_000,
  });
}

test('the button asks once and shows the answer with the AI tag', async ({
  page,
}) => {
  let calls = 0;
  let sent = '';
  await page.route('**/api/explain', async (route) => {
    calls += 1;
    sent = route.request().postData() ?? '';
    await route.fulfill({
      json: { text: '단백질을 채워 주는 조합이에요.', source: 'ai' },
    });
  });
  await openPlan(page);
  expect(calls).toBe(0); // nothing is asked until the button is pressed
  const card = page.getByRole('article').first();
  await card.getByRole('button', { name: 'AI 설명 보기' }).click();
  const result = card.getByTestId('ai-explain-result');
  await expect(result).toContainText('단백질을 채워 주는 조합이에요.');
  await expect(result).toContainText('AI 설명');
  expect(calls).toBe(1);
  // only ids, grams and totals go out: no profile, no targets, no email
  for (const w of ['weightKg', 'birthYear', 'heightCm', 'email', '@'])
    expect(sent).not.toContain(w);
});

test('a failed or limited call shows the plain sentence without the AI tag', async ({
  page,
}) => {
  await page.route('**/api/explain', (route) => route.abort());
  await openPlan(page);
  const card = page.getByRole('article').first();
  await card.getByRole('button', { name: 'AI 설명 보기' }).click();
  const result = card.getByTestId('ai-explain-result');
  await expect(result).toContainText('가져오지 못해 기본 설명');
  await expect(result).toContainText('감량 목표에 맞춰 분량을 계산했어요');
  await expect(result).not.toContainText('AI가 쓴 문장');
  // the rest of the screen still works
  await expect(page.getByRole('button', { name: '다시 추천' })).toBeVisible();
});

test('the server refuses a call without a session', async ({ playwright }) => {
  const anon = await playwright.request.newContext({
    baseURL: 'http://localhost:3006',
    storageState: { cookies: [], origins: [] },
  });
  const res = await anon.post('/api/explain', {
    data: {},
    headers: { Origin: 'http://localhost:3006' },
  });
  expect(res.status()).toBe(401);
  await anon.dispose();
});

test('"AI is busy" says to try again later, a limit says there are no more today', async ({
  page,
}) => {
  const answer = (reason: string) => ({
    json: {
      text: '닭가슴살 조합이에요. 합계는 400kcal예요.',
      source: 'fallback',
      reason,
    },
  });
  let reason = 'BUSY';
  await page.route('**/api/explain', (route) => route.fulfill(answer(reason)));
  await openPlan(page);
  const card = page.getByRole('article').first();
  await card.getByRole('button', { name: 'AI 설명 보기' }).click();
  const result = card.getByTestId('ai-explain-result');
  await expect(result).toContainText(
    '지금은 AI가 바빠서 기본 설명을 보여드려요. 잠시 뒤에 다시 눌러 주세요.',
  );
  await expect(result).not.toContainText('AI가 쓴 문장');

  // a failure is not remembered: another card, now with our own limit
  reason = 'LIMIT';
  const second = page.getByRole('article').nth(1);
  await second.scrollIntoViewIfNeeded();
  await second.getByRole('button', { name: 'AI 설명 보기' }).click();
  await expect(second.getByTestId('ai-explain-result')).toContainText(
    '오늘은 AI 설명을 더 쓸 수 없어서',
  );
});

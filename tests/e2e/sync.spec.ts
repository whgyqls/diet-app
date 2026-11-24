// The account data in a real browser (Phase 5d): saved to the server, not overwritten by an old local cache,
// not mixed with another user's cache, and the old pre-login record is left alone.
import { expect, test } from './fixtures';
import { waitForSaved } from './helpers/saved';
import { seedServer } from './helpers/seed';

const BASE = 'http://localhost:3006'; // browser.newContext() does not use the baseURL of the test
const OTHER_USER = '99999999-9999-4999-8999-999999999999';

/** A per-user cache as the app writes it (zustand persist payload). */
const cachePayload = (ownerUid: string, foods: Record<string, string>) =>
  JSON.stringify({
    version: 2,
    state: {
      ownerUid,
      profile: {},
      styles: [],
      overrides: {},
      selection: { foods, seasonings: {} },
      step: 0,
      kits: [],
    },
  });

test('an edit is saved: it survives a reload and shows in a second browser of the same user', async ({
  page,
  browser,
  workerUser,
}) => {
  await page.goto('/select');
  const card = page.getByRole('button', { name: /^닭가슴살, / });
  await card.click();
  await expect(card).toHaveAttribute('aria-label', '닭가슴살, 먹을 수 있음');
  await waitForSaved(page);
  await page.reload();
  await expect(
    page.getByRole('button', { name: '닭가슴살, 먹을 수 있음' }),
  ).toBeVisible();

  const other = await browser.newContext({
    storageState: { cookies: workerUser.cookies, origins: [] },
  });
  try {
    const second = await other.newPage();
    await second.goto(`${BASE}/select`);
    await expect(
      second.getByRole('button', { name: '닭가슴살, 먹을 수 있음' }),
    ).toBeVisible();
  } finally {
    await other.close();
  }
});

test('an old local cache of the same user never overwrites the server', async ({
  page,
  workerUser,
}) => {
  await seedServer({
    selection: { foods: { 'chicken-breast': 'ok' }, seasonings: {} },
  });
  const key = `diet-app-v1:u:${workerUser.id}`;
  await page.addInitScript(
    ([k, v]) => {
      if (window.localStorage.getItem(k) === null)
        window.localStorage.setItem(k, v);
    },
    [key, cachePayload(workerUser.id, { 'beef-eye-round': 'ok' })],
  );
  await page.goto('/select');
  await expect(
    page.getByRole('button', { name: '닭가슴살, 먹을 수 있음' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^소고기 홍두깨살, 선택 안 함/ }),
  ).toBeVisible();
});

test('a cache that names another user is thrown away', async ({
  page,
  workerUser,
}) => {
  const key = `diet-app-v1:u:${workerUser.id}`;
  await page.addInitScript(
    ([k, v]) => {
      if (window.localStorage.getItem(k) === null)
        window.localStorage.setItem(k, v);
    },
    [key, cachePayload(OTHER_USER, { 'chicken-breast': 'favorite' })],
  );
  await page.goto('/select');
  await expect(
    page.getByRole('button', { name: /^닭가슴살, 선택 안 함/ }),
  ).toBeVisible();
  const owner = await page.evaluate(
    (k) => JSON.parse(window.localStorage.getItem(k) ?? '{}').state?.ownerUid,
    key,
  );
  expect(owner).toBe(workerUser.id); // rewritten from the server, now this user's own
});

test('the old pre-login record stays untouched and is not copied into the account', async ({
  page,
}) => {
  const legacy = JSON.stringify({
    version: 2,
    state: {
      profile: { sex: 'male' },
      styles: [],
      overrides: {},
      selection: { foods: { 'chicken-breast': 'ok' }, seasonings: {} },
      step: 0,
      kits: [],
    },
  });
  await page.addInitScript((v) => {
    if (window.localStorage.getItem('diet-app-v1') === null)
      window.localStorage.setItem('diet-app-v1', v);
  }, legacy);
  await page.goto('/select');
  // a new account starts empty
  await expect(
    page.getByRole('button', { name: /^닭가슴살, 선택 안 함/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^닭가슴살, / }).click();
  await waitForSaved(page);
  expect(
    await page.evaluate(() => window.localStorage.getItem('diet-app-v1')),
  ).toBe(legacy);
});

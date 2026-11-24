// Account deletion in a real browser. Each test makes its own throwaway user on the TEST project (the worker
// user of the fixtures must stay alive for the other specs). After a deletion the old session must be refused
// and the user must be gone on the server. (A magic link for the same email would create a NEW account, so
// "cannot log in again" is not the thing to check.)
import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loadTestProject } from '../helpers/testProjectGuard';
import { testAdmin } from './helpers/seed';
import { signInCookies, type PwCookie } from './helpers/session';

const BASE = 'http://localhost:3006';

async function withTempUser(
  run: (user: { id: string; cookies: PwCookie[] }) => Promise<void>,
) {
  const project = loadTestProject(); // throws unless this is the marked test project
  const admin = testAdmin();
  const email = `e2e-del-${randomBytes(5).toString('hex')}@example.com`;
  const password = randomBytes(24).toString('base64url');
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user)
    throw new Error(`e2e createUser: ${created.error?.message}`);
  const id = created.data.user.id;
  try {
    await run({ id, cookies: await signInCookies(project, email, password) });
  } finally {
    await admin.auth.admin.deleteUser(id); // no-op error when the test already deleted it
  }
}

test('deleting the account: confirm, leave, old session refused, user gone on the server', async ({
  browser,
}) => {
  await withTempUser(async ({ id, cookies }) => {
    const admin = testAdmin();
    await admin.from('profiles').upsert({ id });
    const context = await browser.newContext({
      storageState: { cookies, origins: [] },
    });
    const page = await context.newPage();
    try {
      await page.goto(`${BASE}/settings`);
      await page.getByRole('button', { name: '계정 삭제' }).click();
      await expect(
        page.getByRole('heading', { name: '계정을 삭제할까요?' }),
      ).toBeVisible();
      await page.getByRole('button', { name: '취소' }).click();
      await expect(
        page.getByRole('heading', { name: '계정을 삭제할까요?' }),
      ).toHaveCount(0);
      // cancel deleted nothing
      expect((await admin.auth.admin.getUserById(id)).data.user?.id).toBe(id);

      await page.getByRole('button', { name: '계정 삭제' }).click();
      await page
        .getByRole('region', { name: '계정을 삭제할까요?' })
        .getByRole('button', { name: '계정 삭제' })
        .click();
      await expect(page).toHaveURL(`${BASE}/`);
      await expect(page.getByLabel('이메일')).toBeVisible();
      expect(
        await page.evaluate(() =>
          Object.keys(localStorage).filter((k) => k.startsWith('diet-app')),
        ),
      ).toEqual([]);

      // the user and the rows are gone on the server
      expect((await admin.auth.admin.getUserById(id)).data.user).toBeNull();
      const rows = await admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('id', id);
      expect(rows.count).toBe(0);

      // a copy of the old session is refused by the server (getUser asks the auth server)
      const old = await browser.newContext({
        storageState: { cookies, origins: [] },
      });
      try {
        const res = await old.request.delete(`${BASE}/api/account`, {
          headers: { origin: BASE },
        });
        expect(res.status()).toBe(401);
      } finally {
        await old.close();
      }
    } finally {
      await context.close();
    }
  });
});

test('a failed delete keeps the account and the login, and shows a message', async ({
  browser,
}) => {
  await withTempUser(async ({ id, cookies }) => {
    const context = await browser.newContext({
      storageState: { cookies, origins: [] },
    });
    const page = await context.newPage();
    try {
      await page.route('**/api/account', (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: '{"error":"delete_failed"}',
        }),
      );
      await page.goto(`${BASE}/settings`);
      await page.getByRole('button', { name: '계정 삭제' }).click();
      await page
        .getByRole('region', { name: '계정을 삭제할까요?' })
        .getByRole('button', { name: '계정 삭제' })
        .click();
      await expect(
        page.locator('p[role="alert"]', {
          hasText: '삭제하지 못했어요. 잠시 후 다시 시도해 주세요.',
        }),
      ).toBeVisible();
      await expect(page).toHaveURL(`${BASE}/settings`);
      expect((await testAdmin().auth.admin.getUserById(id)).data.user?.id).toBe(
        id,
      );
    } finally {
      await context.close();
    }
  });
});

test('the API refuses a request without a session, with a foreign Origin, and ignores an id in the body', async ({
  browser,
}) => {
  await withTempUser(async ({ id, cookies }) => {
    const admin = testAdmin();
    const other = await admin.auth.admin.createUser({
      email: `e2e-del-other-${randomBytes(5).toString('hex')}@example.com`,
      email_confirm: true,
    });
    const otherId = other.data.user!.id;
    const signedOut = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const me = await browser.newContext({
      storageState: { cookies, origins: [] },
    });
    try {
      expect(
        (
          await signedOut.request.delete(`${BASE}/api/account`, {
            headers: { origin: BASE },
          })
        ).status(),
      ).toBe(401);
      expect(
        (
          await me.request.delete(`${BASE}/api/account`, {
            headers: { origin: 'https://evil.example' },
          })
        ).status(),
      ).toBe(403);
      expect((await admin.auth.admin.getUserById(id)).data.user?.id).toBe(id);

      // the body names the other user: only the session's user is deleted
      const res = await me.request.delete(`${BASE}/api/account?id=${otherId}`, {
        headers: { origin: BASE },
        data: { id: otherId, userId: otherId },
      });
      expect(res.status()).toBe(200);
      expect((await admin.auth.admin.getUserById(id)).data.user).toBeNull();
      expect((await admin.auth.admin.getUserById(otherId)).data.user?.id).toBe(
        otherId,
      );
    } finally {
      await signedOut.close();
      await me.close();
      await admin.auth.admin.deleteUser(otherId);
    }
  });
});

// What stays in this browser after a deletion depends on who holds the claim on the old pre-login record
// (PLAN.md 9.2): nobody, the deleted account, or another account.
const OTHER_ACCOUNT = '99999999-9999-4999-8999-999999999999';
const CLAIM_CASES: {
  name: string;
  claimOf: (uid: string) => string | null;
  remaining: string[];
}[] = [
  { name: 'no claim', claimOf: () => null, remaining: ['unrelated-key'] },
  {
    name: "the deleted account's claim",
    claimOf: (uid) => JSON.stringify({ uid, at: 1 }),
    remaining: ['unrelated-key'],
  },
  {
    name: "another account's claim",
    claimOf: () => JSON.stringify({ uid: OTHER_ACCOUNT, at: 1 }),
    remaining: [
      'diet-app-legacy-claim-v1',
      'diet-app-saved-v1',
      'diet-app-v1',
      'unrelated-key',
    ],
  },
];

for (const c of CLAIM_CASES)
  test(`deleting the account with ${c.name}: the old record and the claim are handled as planned`, async ({
    browser,
  }) => {
    await withTempUser(async ({ id, cookies }) => {
      const context = await browser.newContext({
        storageState: { cookies, origins: [] },
      });
      const page = await context.newPage();
      try {
        await page.goto(`${BASE}/settings`);
        await page.evaluate(
          ([claim]) => {
            localStorage.setItem('diet-app-v1', '{"state":{},"version":2}');
            localStorage.setItem('diet-app-saved-v1', '{"items":[]}');
            localStorage.setItem('unrelated-key', 'x');
            if (claim) localStorage.setItem('diet-app-legacy-claim-v1', claim);
          },
          [c.claimOf(id)],
        );
        await page.getByRole('button', { name: '계정 삭제' }).click();
        await page
          .getByRole('region', { name: '계정을 삭제할까요?' })
          .getByRole('button', { name: '계정 삭제' })
          .click();
        await expect(page).toHaveURL(`${BASE}/`);
        await expect(page.getByLabel('이메일')).toBeVisible();
        const keys = await page.evaluate(() => Object.keys(localStorage));
        expect(keys.sort()).toEqual(c.remaining);
      } finally {
        await context.close();
      }
    });
  });

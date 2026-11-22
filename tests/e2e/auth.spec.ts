// Login screen, protected pages, magic link callback and logout.
// No real mail is ever sent: the OTP request is stubbed in the browser.
import { expect, test, type Page } from '@playwright/test';
import { loadTestProject } from '../helpers/testProjectGuard';
import { signInCookies } from './helpers/session';

const signedOut = { cookies: [], origins: [] };
// Next.js has its own role=alert element (the route announcer), so look at the app's <p> only.
const alert = (page: Page, text: string) =>
  page.locator('p[role="alert"]', { hasText: text });
const PROTECTED = ['/onboarding', '/select', '/plan', '/saved', '/settings'];

test.describe('signed out', () => {
  test.use({ storageState: signedOut });

  test('protected pages send a visitor to the home page with the login form', async ({
    page,
  }) => {
    for (const path of PROTECTED) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByLabel('이메일')).toBeVisible();
    }
  });

  test('encoded and upper-case paths are protected too', async ({ page }) => {
    for (const path of ['/%73elect', '/SELECT', '//plan']) {
      // full URL: a bare '//plan' would be read as a host name
      await page.goto(`http://localhost:3006${path}`);
      await expect(page.getByLabel('이메일')).toBeVisible();
    }
  });

  test('the home page shows the intro and the login form, not the start button', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: '원물 식단' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '로그인 링크 받기' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: '시작하기' })).toHaveCount(0);
  });

  test('asking for a link shows the sent message and a wait time (mail request stubbed)', async ({
    page,
  }) => {
    let requests = 0;
    await page.route('**/auth/v1/otp**', (route) => {
      requests += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}',
      });
    });
    await page.goto('/');
    await page.getByLabel('이메일').fill('someone@example.com');
    await page.getByRole('button', { name: '로그인 링크 받기' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: '메일을 보냈어요' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /다시 받기 \(\d+초\)/ }),
    ).toBeDisabled();
    expect(requests).toBe(1);
  });

  test('a rate limit from the server shows a message', async ({ page }) => {
    await page.route('**/auth/v1/otp**', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 429,
          error_code: 'over_email_send_rate_limit',
          msg: 'email rate limit exceeded',
        }),
      }),
    );
    await page.goto('/');
    await page.getByLabel('이메일').fill('someone@example.com');
    await page.getByRole('button', { name: '로그인 링크 받기' }).click();
    await expect(alert(page, '요청이 너무 많아요')).toBeVisible();
  });

  test('a bad address is refused without asking the server', async ({
    page,
  }) => {
    let requests = 0;
    await page.route('**/auth/v1/otp**', (route) => {
      requests += 1;
      return route.fulfill({ status: 200, body: '{}' });
    });
    await page.goto('/');
    await page.getByLabel('이메일').fill('not-an-email');
    await page.getByRole('button', { name: '로그인 링크 받기' }).click();
    await expect(alert(page, '이메일 주소를 확인')).toBeVisible();
    expect(requests).toBe(0);
  });

  test('a failed link comes back to the home page with a message', async ({
    page,
  }) => {
    for (const url of [
      '/auth/callback',
      '/auth/callback?token_hash=not-a-real-token&type=email',
      '/auth/callback?token_hash=x&type=recovery',
      '/auth/callback?code=not-a-real-code',
    ]) {
      await page.goto(url);
      await expect(page).toHaveURL(/\/\?auth_error=1$/);
      await expect(alert(page, '만료됐거나 이미 사용됐어요')).toBeVisible();
    }
  });
});

test('signed in: the home page offers start and settings, and settings logs out this browser only', async ({
  browser,
  page,
}) => {
  // The shared session must stay valid for the other tests, so log out a session of its own.
  await page.goto('/');
  await expect(page.getByRole('link', { name: '시작하기' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: '설정 · 로그아웃' }),
  ).toBeVisible();

  const own = await browser.newContext({ storageState: signedOut });
  try {
    const cookies = await signInCookies(
      loadTestProject(),
      process.env.E2E_USER_EMAIL!,
      process.env.E2E_USER_PASSWORD!,
    );
    await own.addCookies(cookies);
    const p = await own.newPage();
    await p.goto('http://localhost:3006/settings');
    await p.getByRole('button', { name: '로그아웃' }).click();
    await expect(p.getByLabel('이메일')).toBeVisible();
    await p.goto('http://localhost:3006/select');
    await expect(p.getByLabel('이메일')).toBeVisible();
  } finally {
    await own.close();
  }

  // the shared session is still signed in
  await page.goto('/select');
  await expect(page).toHaveURL(/\/select$/);
});

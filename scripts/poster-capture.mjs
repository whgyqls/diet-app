// Poster screenshots of the app. Plain JavaScript on purpose: tsconfig type-checks .ts/.mts files, and this
// script imports the existing .ts helpers (guard, login) through Node's type stripping.
//
//   LD_LIBRARY_PATH=$HOME/.local/lib/pw-deps/root/usr/lib/x86_64-linux-gnu node scripts/poster-capture.mjs
//   node scripts/poster-capture.mjs --check     (only the safety guard, nothing is started or created)
//
// Safety:
// - Runs ONLY against the TEST Supabase project. tests/helpers/testProjectGuard.ts must pass first; it throws
//   unless .env.test.local is the marked test project and its URL is not the production one. The values of
//   .env.local are never used (the guard only compares the production URL against the test URL).
// - Port 3006 only. If it is busy the script stops and touches nothing. The dev server it starts is its own
//   child process and is stopped by PID (process group of that child) at the end.
// - A throwaway account is created on the test project and always deleted at the end. Its email and password
//   are never printed, never shown on a screen.
// - Output goes to poster-assets/ (git-ignored). Nothing is committed.
//
// Also prints, for the phone-size pages, whether the page is wider than the viewport (scrollWidth) and which
// elements stick out. Needs an emoji font (e.g. ~/.local/share/fonts/NotoColorEmoji.ttf), or the lock icons
// show as boxes.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signInCookies } from '../tests/e2e/helpers/session.ts';
import { loadTestProject } from '../tests/helpers/testProjectGuard.ts';

const ROOT = process.cwd();
const PORT = 3006;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(ROOT, 'poster-assets');
const LOG = path.join(OUT, 'dev-server.log');
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 375, height: 812 };
const SCALE = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (msg) => console.log(`[poster] ${msg}`);

// --- 1. safety guard (before anything else) -------------------------------------------------------------
const envFile = path.join(ROOT, '.env.test.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const project = loadTestProject(); // throws unless this is the marked test project
say('guard passed: test project confirmed (no values printed)');
if (process.argv.includes('--check')) process.exit(0);

// --- helpers --------------------------------------------------------------------------------------------
function portIsFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port); // binds the same way next dev does (dual stack), so a busy 3006 is detected
  });
}

let child = null; // the dev server this script started
async function stopServer() {
  if (!child || child.exitCode !== null || !child.pid) return portIsFree(PORT);
  try {
    process.kill(-child.pid, 'SIGTERM'); // process group of OUR child only
  } catch {
    // already gone
  }
  for (let i = 0; i < 20; i += 1) {
    if (await portIsFree(PORT)) return true;
    await sleep(500);
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // already gone
  }
  await sleep(1000);
  return portIsFree(PORT);
}

async function waitReady() {
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode !== null)
      throw new Error(
        'the dev server exited early (see poster-assets/dev-server.log)',
      );
    try {
      const r = await fetch(`${BASE}/`, { redirect: 'manual' });
      if (r.status < 500) return;
    } catch {
      // not listening yet
    }
    await sleep(1000);
  }
  throw new Error('the dev server did not become ready in 120 s');
}

/** Waits until the page is finished (fonts, network quiet) and hides the Next.js dev indicator. */
async function settle(page) {
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForFunction(
    () => !document.body.innerText.includes('불러오는 중'),
    null,
    {
      timeout: 60_000,
    },
  );
  await page.waitForTimeout(600);
}

/** Is the page wider than the viewport, and which elements stick out (not counting ones clipped by a scroller)? */
async function measureOverflow(page, label) {
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right <= vw + 1) continue;
      let clipped = false;
      for (
        let p = el.parentElement;
        p && p !== document.body;
        p = p.parentElement
      ) {
        if (getComputedStyle(p).overflowX === 'visible') continue;
        if (p.getBoundingClientRect().right <= vw + 1) {
          clipped = true;
          break;
        }
      }
      if (!clipped)
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || '').slice(0, 70),
          right: Math.round(r.right),
          width: Math.round(r.width),
        });
    }
    const box = (el) =>
      el
        ? {
            w: Math.round(el.getBoundingClientRect().width),
            scrollW: el.scrollWidth,
          }
        : null;
    const carousel = document.querySelector('ul[aria-label^="추천 조합"]');
    return {
      innerWidth: window.innerWidth,
      clientWidth: vw,
      scrollWidth: de.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      main: box(document.querySelector('main')),
      carousel: box(carousel),
      carouselParent: box(carousel?.parentElement),
      offenders: offenders.slice(0, 6),
      offenderCount: offenders.length,
    };
  });
  const over = m.scrollWidth > m.clientWidth;
  say(
    `overflow ${label}: ${over ? 'WIDER than the viewport' : 'fits'} ${JSON.stringify(m)}`,
  );
  return m;
}

/**
 * Why is the page wider than the viewport? Lists the widest elements that are NOT inside a scroll container,
 * then tries candidate fixes as injected CSS (browser only, the app code is not touched) and measures again.
 */
async function diagnoseOverflow(page) {
  const probe = () =>
    page.evaluate(() => {
      const de = document.documentElement;
      const vw = de.clientWidth;
      const insideScroller = (el) => {
        for (
          let p = el.parentElement;
          p && p !== document.body;
          p = p.parentElement
        )
          if (getComputedStyle(p).overflowX !== 'visible') return true;
        return false;
      };
      const name = (el) =>
        `${el.tagName.toLowerCase()}.${String(el.className || '')
          .split(/\s+/)
          .slice(0, 3)
          .join('.')}`;
      const wide = [];
      for (const el of document.querySelectorAll('body *')) {
        if (insideScroller(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || r.right <= vw + 1) continue;
        wide.push({
          el,
          right: Math.round(r.right),
          width: Math.round(r.width),
        });
      }
      wide.sort((a, b) => b.right - a.right);
      const chain = (el) => {
        const out = [];
        for (
          let p = el;
          p && p !== document.documentElement;
          p = p.parentElement
        )
          out.push(name(p));
        return out.join(' < ');
      };
      const main = document.querySelector('main');
      return {
        vw,
        scrollWidth: de.scrollWidth,
        mainWidth: Math.round(main.getBoundingClientRect().width),
        bodyDisplay: getComputedStyle(document.body).display,
        mainMarginLeft: getComputedStyle(main).marginLeft,
        widestOutsideScrollers: wide.slice(0, 4).map((w) => ({
          el: name(w.el),
          position: getComputedStyle(w.el).position,
          right: w.right,
          width: w.width,
        })),
        widestChain: wide[0] ? chain(wide[0].el) : null,
        countOutsideScrollers: wide.length,
      };
    });
  say(`diagnose base: ${JSON.stringify(await probe())}`);
  // absolute / fixed elements anywhere (also inside scrollers): they escape a scroller that is not their containing block
  const abs = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const pos = getComputedStyle(el).position;
      if (pos !== 'absolute' && pos !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1)
        out.push({
          el: `${el.tagName.toLowerCase()}.${String(el.className || '')
            .split(/\s+/)
            .slice(0, 2)
            .join('.')}`,
          position: pos,
          right: Math.round(r.right),
          width: Math.round(r.width),
        });
    }
    out.sort((a, b) => b.right - a.right);
    return { count: out.length, widest: out.slice(0, 4) };
  });
  say(
    `diagnose absolute/fixed elements wider than the viewport: ${JSON.stringify(abs)}`,
  );
  const tryCss = async (label, css) => {
    const handle = await page.addStyleTag({ content: css });
    const r = await probe();
    await handle.evaluate((n) => n.remove());
    say(
      `diagnose with [${label}]: scrollWidth=${r.scrollWidth} mainWidth=${r.mainWidth} wideOutsideScrollers=${r.countOutsideScrollers}`,
    );
  };
  await tryCss(
    'main { max-width: 100% } (cap at the container)',
    'main{max-width:100%!important}',
  );
  await tryCss('main { width: 100% }', 'main{width:100%!important}');
  await tryCss('body { display: block }', 'body{display:block!important}');
  await tryCss('main { min-width: 0 }', 'main{min-width:0!important}');
  const CAROUSEL = 'ul[aria-label^="추천 조합"]';
  await tryCss(
    'carousel { position: relative } only',
    `${CAROUSEL}{position:relative!important}`,
  );
  await tryCss(
    'main { max-width: 100% } + carousel { position: relative }',
    `main{max-width:100%!important}${CAROUSEL}{position:relative!important}`,
  );
  await tryCss(
    'main { max-width: 100% } + carousel { contain: paint }',
    `main{max-width:100%!important}${CAROUSEL}{contain:paint!important}`,
  );
}

const files = [];
async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, type: 'png' });
  files.push(file);
  say(`saved ${path.relative(ROOT, file)}`);
}

// --- 2. data to seed: a profile and every food and seasoning selected, no style -------------------------------
const readJson = (f) =>
  JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const allOk = (list) => Object.fromEntries(list.map((x) => [x.id, 'ok']));
const SEED_KEY = 'diet-app-v1';
const SEED_STATE = JSON.stringify({
  state: {
    profile: {
      sex: 'female',
      birthYear: 1996,
      heightCm: 163,
      weightKg: 60,
      activityLevel: 2,
      goal: 'lose',
      mealsPerDay: 3,
    },
    styles: [],
    overrides: {},
    selection: {
      foods: allOk(readJson('foods.json').foods),
      seasonings: allOk(readJson('seasonings.json').seasonings),
    },
    step: 0,
    kits: [],
  },
  version: 2,
});
const seed = ([key, payload]) => {
  // only when missing: addInitScript also runs on reload and must not undo what the page saved
  if (window.localStorage.getItem(key) === null)
    window.localStorage.setItem(key, payload);
};

// --- 3. main --------------------------------------------------------------------------------------------
const admin = createClient(project.url, project.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let userId = null;
let browser = null;
let failed = false;
let cleaned = false;

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    await browser?.close();
  } catch {
    // ignore
  }
  let deleted = userId === null; // nothing was created
  if (userId !== null) {
    await admin.auth.admin.deleteUser(userId);
    const check = await admin.auth.admin.getUserById(userId);
    deleted = !!check.error || !check.data?.user;
  }
  const stopped = await stopServer();
  say(
    `temp account deleted: ${userId === null ? 'none was created' : deleted ? 'yes' : 'NO - delete it by hand'}`,
  );
  say(
    `dev server stopped, port ${PORT} free: ${stopped ? 'yes' : 'NO - check it'}`,
  );
  if (!failed) rmSync(LOG, { force: true });
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    failed = true;
    cleanup().finally(() => process.exit(130));
  });
}

try {
  mkdirSync(OUT, { recursive: true });

  if (!(await portIsFree(PORT))) {
    failed = true;
    throw new Error(
      `port ${PORT} is busy: not touching it. Free it first or ask for another port.`,
    );
  }

  // The dev server gets only the test project's public settings (Next.js does not override variables that are
  // already set, so they win over .env.local) and none of the secret keys.
  say(`starting next dev on ${PORT}`);
  const logFd = openSync(LOG, 'w');
  child = spawn(
    process.execPath,
    [
      path.join(ROOT, 'node_modules/next/dist/bin/next'),
      'dev',
      '-p',
      String(PORT),
    ],
    {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: process.env.LANG,
        NEXT_TELEMETRY_DISABLED: '1',
        NEXT_PUBLIC_SUPABASE_URL: project.url,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: project.anonKey,
      },
    },
  );
  closeSync(logFd);
  await waitReady();
  say('dev server ready');

  // throwaway account on the TEST project, signed in with a password (no mail)
  const email = `poster-${randomBytes(6).toString('hex')}@example.com`;
  const password = randomBytes(24).toString('base64url');
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user)
    throw new Error(`createUser failed: ${created.error?.message}`);
  userId = created.data.user.id;
  say('temp account created (not printed)');
  const cookies = await signInCookies(project, email, password);

  browser = await chromium.launch();
  const desktop = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: SCALE,
    baseURL: BASE,
    storageState: { cookies: [], origins: [] },
  });
  await desktop.addCookies(cookies);
  await desktop.addInitScript(seed, [SEED_KEY, SEED_STATE]);
  const page = await desktop.newPage();

  // /select
  await page.goto('/select');
  await page
    .getByRole('button', { name: /^닭가슴살, / })
    .waitFor({ timeout: 60_000 });
  await settle(page);
  await shot(page, 'select-1440x900@2x.png');

  // /plan: wait for the finished plan, star some cards, back to the first meal
  await page.goto('/plan');
  await page.getByRole('article').first().waitFor({ timeout: 120_000 });
  await page.getByRole('region', { name: '하루 합계' }).waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll('[role=progressbar]').length >= 6,
  );
  await settle(page);
  const star = async (meal, n) => {
    await page.getByRole('tab', { name: meal }).click();
    const label = `조합 ${n} 저장`;
    const btn = page.getByRole('button', { name: label, exact: true });
    await btn.click();
    await page.waitForFunction(
      (l) =>
        document
          .querySelector(`[aria-label="${l}"]`)
          ?.getAttribute('aria-pressed') === 'true',
      label,
    );
  };
  await star('점심', 1);
  await star('저녁', 1);
  await star('아침', 2);
  await star('아침', 1);
  say('4 combos starred');
  await settle(page);
  const card = await page.getByRole('article').first().boundingBox();
  say(
    `plan: first card top at y=${Math.round(card?.y ?? -1)} of ${DESKTOP.height}`,
  );
  await shot(page, 'plan-1440x900@2x.png');
  // taller version: the first card fully visible below the totals
  await page.setViewportSize({ width: DESKTOP.width, height: 1500 });
  await settle(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'plan-1440x1500@2x.png');
  await page.setViewportSize(DESKTOP);

  // /saved
  await page.goto('/saved');
  await page.waitForFunction(
    () => document.querySelectorAll('article').length >= 3,
    null,
    {
      timeout: 60_000,
    },
  );
  await settle(page);
  await shot(page, 'saved-1440x900@2x.png');
  // whole page, so every saved combo is visible
  const savedFile = path.join(OUT, 'saved-1440xfull@2x.png');
  await page.screenshot({ path: savedFile, type: 'png', fullPage: true });
  files.push(savedFile);
  say(`saved ${path.relative(ROOT, savedFile)} (full page)`);

  // /plan on a phone: same session and the same saved data (storage state of the desktop context)
  const state = await desktop.storageState();
  const phone = await browser.newContext({
    viewport: MOBILE,
    deviceScaleFactor: SCALE,
    baseURL: BASE,
    storageState: state,
  });
  const mobile = await phone.newPage();
  await mobile.goto('/plan');
  await mobile.getByRole('article').first().waitFor({ timeout: 120_000 });
  await mobile.getByRole('region', { name: '하루 합계' }).waitFor();
  await settle(mobile);
  await measureOverflow(mobile, '/plan 375');
  await diagnoseOverflow(mobile);
  await shot(mobile, 'plan-375x812@2x.png');

  await mobile.goto('/select');
  await mobile
    .getByRole('button', { name: /^닭가슴살, / })
    .waitFor({ timeout: 60_000 });
  await settle(mobile);
  await measureOverflow(mobile, '/select 375');
  await shot(mobile, 'select-375x812@2x.png');

  await mobile.goto('/saved');
  await mobile.waitForFunction(
    () => document.querySelectorAll('article').length >= 3,
    null,
    {
      timeout: 60_000,
    },
  );
  await settle(mobile);
  await measureOverflow(mobile, '/saved 375');
  await shot(mobile, 'saved-375x812@2x.png');

  say(`done: ${files.length} files in poster-assets/`);
} catch (e) {
  failed = true;
  say(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}

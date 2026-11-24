import { describe, expect, it, vi } from 'vitest';
import { callOpenRouter } from './openrouter';
import { DEFAULT_MODEL, EXPLAIN_LIMITS, pickModel, utcDay } from './config';
import { fallbackText } from './fallback';
import {
  allowedNumbers,
  cacheKeyText,
  explainRequestSchema,
  toInput,
} from './payload';
import { SYSTEM_PROMPT, userPrompt } from './prompt';
import { BANNED_WORDS, checkExplanation, parseModelText } from './validate';
import type { ExplainRequest } from './types';

const REQ: ExplainRequest = {
  goal: 'lose',
  items: [
    { id: 'chicken-breast', grams: 150.4 },
    { id: 'cabbage', grams: 100 },
  ],
  oils: [],
  seasonings: [],
  free: [],
  totals: {
    kcal: 412.3,
    protein: 36.2,
    carbs: 20,
    fat: 12.4,
    satFat: 2.84,
    fiber: 7.6,
    sodium: 310,
  },
};
const input = toInput(REQ)!;

describe('toInput', () => {
  it('takes names from the data and rounds the numbers', () => {
    expect(input.items).toEqual([
      { name: '닭가슴살', grams: 150, basis: expect.any(String) },
      { name: '양배추', grams: 100, basis: expect.any(String) },
    ]);
    expect(input.totals).toMatchObject({
      kcal: 412,
      protein: 36,
      satFat: 2.8,
      fiber: 8,
    });
  });
  it('returns null for an unknown food id', () => {
    expect(toInput({ ...REQ, items: [{ id: 'nope', grams: 10 }] })).toBeNull();
  });
});

describe('request schema', () => {
  it('accepts a normal request', () => {
    expect(explainRequestSchema.safeParse(REQ).success).toBe(true);
  });
  it('refuses unknown keys such as an email, a weight or a target', () => {
    for (const extra of [
      { email: 'a@b.c' },
      { weightKg: 60 },
      { targetKcal: 500 },
    ])
      expect(explainRequestSchema.safeParse({ ...REQ, ...extra }).success).toBe(
        false,
      );
    expect(
      explainRequestSchema.safeParse({
        ...REQ,
        totals: { ...REQ.totals, age: 30 },
      }).success,
    ).toBe(false);
  });
  it('refuses out-of-range numbers and empty or oversized lists', () => {
    expect(explainRequestSchema.safeParse({ ...REQ, items: [] }).success).toBe(
      false,
    );
    expect(
      explainRequestSchema.safeParse({
        ...REQ,
        totals: { ...REQ.totals, kcal: 99999 },
      }).success,
    ).toBe(false);
  });
});

describe('what goes to the AI and into the cache key', () => {
  const sent = SYSTEM_PROMPT + userPrompt(input) + cacheKeyText(input, 'm');
  it('has no target numbers, account or body data', () => {
    expect(Object.keys(input).sort()).toEqual(
      ['free', 'goal', 'items', 'oils', 'seasonings', 'totals'].sort(),
    );
    for (const w of [
      '@',
      'email',
      'userId',
      'weight',
      'birthYear',
      'heightCm',
      'target',
      '목표 칼로리',
    ])
      expect(sent).not.toContain(w);
  });
  it('is the same for the same combo and changes with goal, model or numbers', () => {
    const k = cacheKeyText(input, 'm');
    expect(cacheKeyText(toInput(REQ)!, 'm')).toBe(k);
    expect(cacheKeyText({ ...input, goal: 'gain' }, 'm')).not.toBe(k);
    expect(cacheKeyText(input, 'other')).not.toBe(k);
    // rounding: tiny differences below the shown precision share a cache entry
    expect(
      cacheKeyText(
        toInput({ ...REQ, totals: { ...REQ.totals, kcal: 412.4 } })!,
        'm',
      ),
    ).toBe(k);
  });
});

describe('checkExplanation', () => {
  const ok =
    '닭가슴살 150g이 단백질 36g을 채우고, 양배추가 식이섬유를 더해 줘요. 가볍게 곁들여 드세요.';
  it('accepts text that only quotes input numbers', () => {
    expect(checkExplanation(ok, input)).toEqual({ ok: true });
  });
  it('refuses a number that is not in the input', () => {
    expect(
      checkExplanation(
        '닭가슴살 200g이 들어 있어서 든든해요. 천천히 드세요.',
        input,
      ),
    ).toEqual({
      ok: false,
      reason: 'NEW_NUMBER',
    });
    expect(
      checkExplanation('단백질 3g이 들어 있는 한 끼 조합이에요.', input),
    ).toMatchObject({
      ok: false,
    });
  });
  it('allows bare counts of 1-3 but not with a unit', () => {
    expect(
      checkExplanation('단백질 1가지와 채소 2가지로 이뤄진 조합이에요.', input)
        .ok,
    ).toBe(true);
  });
  it('refuses efficacy words', () => {
    for (const w of BANNED_WORDS)
      expect(
        checkExplanation(
          `닭가슴살 150g 조합이라 ${w}에 좋아요. 천천히 드세요.`,
          input,
        ),
      ).toEqual({ ok: false, reason: 'BANNED_WORD' });
  });
  it('refuses too short, too long and too many sentences', () => {
    expect(checkExplanation('짧아요', input)).toMatchObject({
      reason: 'LENGTH',
    });
    expect(
      checkExplanation('가'.repeat(EXPLAIN_LIMITS.maxTextChars + 1), input),
    ).toMatchObject({
      reason: 'LENGTH',
    });
    expect(
      checkExplanation(
        '좋은 조합이에요. 든든해요. 균형이에요. 맛있게 드세요.',
        input,
      ),
    ).toMatchObject({
      reason: 'SENTENCES',
    });
  });
  it('does not count a decimal point as a sentence end', () => {
    expect(
      checkExplanation('포화지방 2.8g이 들어 있는 조합이에요.', input).ok,
    ).toBe(true);
  });
});

describe('parseModelText', () => {
  it('reads plain JSON, fenced JSON and JSON inside other text', () => {
    expect(parseModelText('{"text":"안녕"}')).toBe('안녕');
    expect(parseModelText('```json\n{"text":"안녕"}\n```')).toBe('안녕');
    expect(parseModelText('여기요: {"text":"안녕"} 끝')).toBe('안녕');
  });
  it('returns null for anything else', () => {
    for (const bad of [
      '안녕',
      '{"text":3}',
      '{bad json}',
      '{"other":"x"}',
      5,
      null,
    ])
      expect(parseModelText(bad)).toBeNull();
  });
});

describe('fallbackText', () => {
  it('passes its own checks: only input numbers, no efficacy words', () => {
    const t = fallbackText(input);
    expect(
      checkExplanation(t, input).ok || t.length > EXPLAIN_LIMITS.maxTextChars,
    ).toBe(true);
    for (const n of t.match(/\d+(?:\.\d+)?/g) ?? [])
      expect(allowedNumbers(input).has(Number(n))).toBe(true);
    for (const w of BANNED_WORDS) expect(t).not.toContain(w);
    expect(t).toContain('감량');
  });
});

describe('config', () => {
  it('uses the default model unless OPENROUTER_MODEL is set and not blank', () => {
    expect(pickModel(undefined)).toBe(DEFAULT_MODEL);
    expect(pickModel('  ')).toBe(DEFAULT_MODEL);
    expect(pickModel(' x/y ')).toBe('x/y');
  });
  it('counts a call on its UTC date', () => {
    expect(utcDay(new Date('2026-11-24T23:59:59Z'))).toBe('2026-11-24');
    expect(utcDay(new Date('2026-11-25T00:00:00Z'))).toBe('2026-11-25');
  });
  it('keeps the limits the user chose', () => {
    expect(EXPLAIN_LIMITS).toMatchObject({
      userPerDay: 5,
      sitePerDay: 45,
      serverTimeoutMs: 8000,
    });
  });
});

describe('callOpenRouter', () => {
  const reply = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));
  const NO_KEY = Symbol('no key');
  const run = (fetchImpl: typeof fetch, key: string | symbol = 'k') =>
    callOpenRouter({
      apiKey: key === NO_KEY ? undefined : (key as string),
      model: 'm/x',
      input,
      fetchImpl,
      timeoutMs: 50,
    });

  it('sends the key as a header, the model and only the prompt, and returns the content', async () => {
    const f = reply(200, {
      choices: [{ message: { content: '{"text":"x"}' } }],
    });
    expect(await run(f as unknown as typeof fetch)).toEqual({
      ok: true,
      content: '{"text":"x"}',
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer k',
    );
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('m/x');
    expect(JSON.stringify(body)).not.toContain('"k"');
  });
  it('maps problems to reasons', async () => {
    expect(await run(reply(429, {}) as unknown as typeof fetch)).toEqual({
      ok: false,
      reason: 'RATE_LIMIT',
    });
    expect(await run(reply(500, {}) as unknown as typeof fetch)).toEqual({
      ok: false,
      reason: 'HTTP',
    });
    expect(
      await run(reply(200, { choices: [] }) as unknown as typeof fetch),
    ).toEqual({
      ok: false,
      reason: 'BAD_RESPONSE',
    });
    expect(
      await run(reply(200, {}) as unknown as typeof fetch, NO_KEY),
    ).toEqual({
      ok: false,
      reason: 'NO_KEY',
    });
    const slow = ((_u: string, init: RequestInit) =>
      new Promise((_r, rej) =>
        init.signal?.addEventListener('abort', () =>
          rej(Object.assign(new Error('t'), { name: 'TimeoutError' })),
        ),
      )) as unknown as typeof fetch;
    expect(await run(slow)).toEqual({ ok: false, reason: 'TIMEOUT' });
  });
  it('does not call fetch without a key', async () => {
    const f = reply(200, {});
    await run(f as unknown as typeof fetch, NO_KEY);
    expect(f).not.toHaveBeenCalled();
  });
});

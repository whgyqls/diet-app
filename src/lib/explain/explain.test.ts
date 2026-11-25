import { describe, expect, it, vi } from 'vitest';
import { callOpenRouter, safeMessage } from './openrouter';
import {
  DEFAULT_MODEL,
  EXPLAIN_LIMITS,
  FALLBACK_MODELS,
  MAX_MODELS_PER_REQUEST,
  modelsForRequest,
  pickModel,
  utcDay,
} from './config';
import { fallbackText } from './fallback';
import {
  allowedNumbers,
  cacheKeyText,
  explainRequestSchema,
  toInput,
} from './payload';
import { SYSTEM_PROMPT, userPrompt } from './prompt';
import {
  BANNED_WORDS,
  checkExplanation,
  extractExplanation,
  parseModelText,
} from './validate';
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
      detail: 'unit',
    });
    expect(
      checkExplanation('단백질 7g이 들어 있는 한 끼 조합이에요.', input),
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
      ).toEqual({ ok: false, reason: 'BANNED_WORD', detail: w });
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
      '{"a":"x","b":"y"}',
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
      clientTimeoutMs: 15000,
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
    // the limit comes from config.ts only (no number repeated here)
    expect(body.max_tokens).toBe(EXPLAIN_LIMITS.maxTokens);
    expect(JSON.stringify(body)).not.toContain('"k"');
  });
  it('maps problems to reasons', async () => {
    // a 429 without X-RateLimit-* headers comes from the upstream provider
    expect(await run(reply(429, {}) as unknown as typeof fetch)).toEqual({
      ok: false,
      reason: 'RATE_LIMIT',
      scope: 'provider',
    });
    expect(await run(reply(500, {}) as unknown as typeof fetch)).toEqual({
      ok: false,
      reason: 'HTTP',
      status: 500,
    });
    expect(
      await run(reply(200, { choices: [] }) as unknown as typeof fetch),
    ).toEqual({
      ok: false,
      reason: 'BAD_RESPONSE',
      detail: 'NO_CHOICES',
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

describe('parseModelText: what small models really send', () => {
  const T = '닭가슴살 150g이에요.';
  const cases: [string, string, string | null][] = [
    ['code block', '```json\n{"text":"' + T + '"}\n```', T],
    ['code block without a language', '```\n{"text":"' + T + '"}\n```', T],
    [
      'talk before and after, with braces in it',
      '네, 설명입니다:\n{"text":"' + T + '"}\n도움이 되길 {^^}',
      T,
    ],
    ['a brace after the JSON', '{"text":"' + T + '"} 참고: {없음}', T],
    [
      'a raw line break inside the string',
      '{"text":"닭가슴살 150g이에요.\n양배추도 드세요."}',
      '닭가슴살 150g이에요. 양배추도 드세요.',
    ],
    ['a comma before the closing brace', '{"text":"' + T + '",}', T],
    ['curly quotes', '{“text”:“' + T + '”}', T],
    ['another key name', '{"explanation":"' + T + '"}', T],
    [
      'a thinking block first',
      '<think>{"text":"x"} 음…</think>{"text":"' + T + '"}',
      T,
    ],
    ['an array', '[{"text":"' + T + '"}]', T],
    [
      'a brace inside the sentence',
      '{"text":"닭가슴살 {150g}이에요."}',
      '닭가슴살 {150g}이에요.',
    ],
    ['no JSON', T, null],
    ['two string values and no text key', '{"a":"x","b":"y"}', null],
    ['cut off in the middle', '{"text":"닭가슴살 150g이에', null],
  ];
  for (const [name, content, want] of cases)
    it(name, () => expect(parseModelText(content)).toBe(want));
});

describe('extractExplanation: a plain sentence without JSON', () => {
  const ex = (c: unknown) => extractExplanation(c, input);
  it('is taken when it names a food of the combo', () => {
    expect(ex('"닭가슴살 150g이 단백질 36g을 채워 줘요."')).toEqual({
      ok: true,
      text: '닭가슴살 150g이 단백질 36g을 채워 줘요.',
      mode: 'plain',
    });
  });
  it('is refused when it names none of the foods', () => {
    expect(ex('단백질이 풍부한 조합이에요. 천천히 드세요.')).toEqual({
      ok: false,
      reason: 'NO_FOOD_NAME',
    });
  });
  it('is refused when it looks like broken JSON, code or talk about JSON', () => {
    for (const bad of [
      '{"text":"닭가슴살 150g이에',
      '```닭가슴살```',
      '닭가슴살입니다. JSON으로 드릴게요.',
      '',
      '   ',
    ])
      expect(ex(bad)).toMatchObject({ ok: false, reason: 'PARSE' });
    expect(ex(5)).toMatchObject({ ok: false, reason: 'PARSE' });
  });
  it('still goes through every other check', () => {
    const plain = (t: string) => {
      const r = ex(t);
      return r.ok ? checkExplanation(r.text, input) : r;
    };
    expect(plain('닭가슴살 999g이에요. 천천히 드세요.')).toMatchObject({
      reason: 'NEW_NUMBER',
      detail: 'unit',
    });
    expect(plain('닭가슴살이 혈당에 좋아요. 천천히 드세요.')).toMatchObject({
      reason: 'BANNED_WORD',
      detail: '혈당',
    });
    expect(plain('닭가슴살')).toMatchObject({
      reason: 'LENGTH',
      detail: 'short',
    });
    expect(plain('닭가슴살이에요. 좋아요. 든든해요. 맛있어요.')).toMatchObject({
      reason: 'SENTENCES',
    });
    expect(plain('닭가슴살 150g이 단백질 36g을 채워 줘요.')).toEqual({
      ok: true,
    });
  });
});

describe('numbers: what is allowed and what is not', () => {
  const chk = (t: string) => checkExplanation(t, input);
  it('allows a decimal input rounded to a whole number (2.8 -> 3), nothing else rounded', () => {
    expect(chk('포화지방은 약 3g으로 적은 편이에요.')).toEqual({ ok: true });
    expect(chk('포화지방은 2.8g으로 적은 편이에요.')).toEqual({ ok: true });
    expect(chk('약 410kcal로 가벼운 한 끼예요.')).toMatchObject({
      reason: 'NEW_NUMBER',
      detail: 'unit',
    });
    expect(chk('단백질이 약 35g 들어 있어요.')).toMatchObject({
      reason: 'NEW_NUMBER',
    });
  });
  it('still refuses sums, percentages and cooking numbers', () => {
    expect(chk('재료를 합치면 250g이에요. 천천히 드세요.')).toMatchObject({
      reason: 'NEW_NUMBER',
    });
    expect(chk('지방은 전체의 약 26%예요. 천천히 드세요.')).toMatchObject({
      reason: 'NEW_NUMBER',
    });
    expect(chk('양배추는 5분 정도 데쳐 드세요.')).toMatchObject({
      reason: 'NEW_NUMBER',
      detail: 'bare',
    });
  });
  it('a small count with an energy unit is not a "bare count" (2칼로리 is made up)', () => {
    expect(chk('겨우 2칼로리예요. 천천히 드세요.')).toMatchObject({
      reason: 'NEW_NUMBER',
      detail: 'unit',
    });
    expect(chk('하루 3끼 중 한 끼로 알맞아요. 천천히 드세요.')).toEqual({
      ok: true,
    });
  });
  it('units with a space, spelled units, decimals and thousands separators are read', () => {
    const big = toInput({
      ...REQ,
      totals: { ...REQ.totals, sodium: 1310 },
    })!;
    for (const t of [
      '합계는 412 kcal예요. 천천히 드세요.',
      '약 412칼로리, 단백질 36그램이에요.',
      '나트륨은 1,310mg이에요. 천천히 드세요.',
    ])
      expect(checkExplanation(t, big), t).toEqual({ ok: true });
  });
  it('the answer asks nothing the validator cannot check: the prompt forbids rounding and cooking numbers', async () => {
    const { SYSTEM_PROMPT } = await import('./prompt');
    expect(SYSTEM_PROMPT).toContain('반올림');
    expect(SYSTEM_PROMPT).toContain('조리 시간');
    expect(SYSTEM_PROMPT).toContain('효과');
  });
});

describe('callOpenRouter: a response without usable text says what was missing', () => {
  const reply = (body: unknown) =>
    (async () =>
      new Response(JSON.stringify(body), {
        status: 200,
      })) as unknown as typeof fetch;
  const run = (body: unknown) =>
    callOpenRouter({
      apiKey: 'k',
      model: 'm/x',
      input,
      fetchImpl: reply(body),
      timeoutMs: 50,
    });
  const bad = (choice: unknown, extra: object = {}) => ({
    model: 'vendor/used-model',
    choices: choice === undefined ? [] : [choice],
    ...extra,
  });

  it('reasoning used the whole budget: empty content, finish=length, token counts', async () => {
    const r = await run(
      bad(
        {
          finish_reason: 'length',
          message: { content: '', reasoning: '생각 중인 아주 비밀스러운 문장' },
        },
        {
          usage: {
            completion_tokens: 600,
            completion_tokens_details: { reasoning_tokens: 598 },
          },
        },
      ),
    );
    expect(r).toEqual({
      ok: false,
      reason: 'BAD_RESPONSE',
      detail: 'CONTENT_EMPTY+REASONING',
      model: 'vendor/used-model',
      finish: 'length',
      tokens: 600,
      reasoningTokens: 598,
    });
    // the reasoning text itself is never kept
    expect(JSON.stringify(r)).not.toContain('비밀스러운');
  });
  it('tells the other shapes apart', async () => {
    const detail = async (body: unknown) =>
      ((await run(body)) as { detail?: string }).detail;
    expect(await detail({})).toBe('NO_CHOICES');
    expect(await detail(bad(undefined))).toBe('NO_CHOICES');
    expect(await detail(bad({ finish_reason: 'stop' }))).toBe('NO_MESSAGE');
    expect(await detail(bad({ message: { content: null } }))).toBe(
      'CONTENT_NULL',
    );
    expect(await detail(bad({ message: {} }))).toBe('CONTENT_NULL');
    expect(
      await detail(
        bad({ message: { content: [{ type: 'text', text: 'x' }] } }),
      ),
    ).toBe('CONTENT_NOT_STRING');
    expect(await detail(bad({ message: { content: '  \n ' } }))).toBe(
      'CONTENT_EMPTY',
    );
    expect(
      await detail(
        bad({ message: { content: null, reasoning_details: [{ type: 'x' }] } }),
      ),
    ).toBe('CONTENT_NULL+REASONING');
  });
  it('a 200 that only carries an error gives its numeric code, not its message', async () => {
    const r = await run({ error: { code: 502, message: '비밀 오류 문구' } });
    expect(r).toMatchObject({
      ok: false,
      reason: 'BAD_RESPONSE',
      detail: 'NO_CHOICES',
      status: 502,
    });
    expect(JSON.stringify(r)).not.toContain('비밀');
  });
  it('a good answer carries the model, finish and token counts for the log', async () => {
    const r = await run(
      bad(
        { finish_reason: 'stop', message: { content: '{"text":"x"}' } },
        { usage: { completion_tokens: 40 } },
      ),
    );
    expect(r).toEqual({
      ok: true,
      content: '{"text":"x"}',
      model: 'vendor/used-model',
      finish: 'stop',
      tokens: 40,
    });
  });
});

describe('callOpenRouter: models to try', () => {
  const sent = async (fallbacks?: readonly string[], model = 'a/one:free') => {
    const f = (async () =>
      new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const spy = vi.fn(f);
    await callOpenRouter({
      apiKey: 'k',
      model,
      fallbacks,
      input,
      fetchImpl: spy as unknown as typeof fetch,
    });
    return JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
  };
  it('sends one model as `model`, several as the `models` array in priority order', async () => {
    expect(await sent()).toMatchObject({ model: 'a/one:free' });
    expect(await sent([])).not.toHaveProperty('models');
    const b = await sent(['b/two:free', 'c/three:free']);
    expect(b.models).toEqual(['a/one:free', 'b/two:free', 'c/three:free']);
    expect(b).not.toHaveProperty('model');
  });
  it('does not list the same model twice', async () => {
    expect(await sent(['a/one:free'])).toMatchObject({ model: 'a/one:free' });
    expect((await sent(['b/two:free', 'b/two:free'])).models).toEqual([
      'a/one:free',
      'b/two:free',
    ]);
  });
  it('the default is a fixed free model with a free fallback only', () => {
    expect(DEFAULT_MODEL).toBe('google/gemma-4-26b-a4b-it:free');
    expect(FALLBACK_MODELS).toEqual([
      'google/gemma-4-31b-it:free',
      'nvidia/nemotron-3.5-super-vl:free',
    ]);
    for (const m of [DEFAULT_MODEL, ...FALLBACK_MODELS])
      expect(m.endsWith(':free')).toBe(true);
    expect(DEFAULT_MODEL).not.toBe('openrouter/free');
  });
});

describe('callOpenRouter: who refused a 429 (names and numbers only)', () => {
  const NOW = 1_700_000_000_000;
  const refuse = (
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    callOpenRouter({
      apiKey: 'k',
      model: 'm/x',
      input,
      now: () => NOW,
      fetchImpl: (async () =>
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
          headers,
        })) as unknown as typeof fetch,
    });

  it('a 429 from the upstream provider: scope=provider with its name and code, never the message or raw payload', async () => {
    const r = await refuse(429, {
      error: {
        code: 429,
        message: '비밀 메시지 qwerty',
        metadata: {
          provider_name: 'Google AI Studio',
          provider_code: 429,
          raw: '제공자 원문 zxcvb',
        },
      },
    });
    expect(r).toEqual({
      ok: false,
      reason: 'RATE_LIMIT',
      scope: 'provider',
      provider: 'Google AI Studio',
      providerCode: 429,
    });
    expect(JSON.stringify(r)).not.toMatch(/qwerty|zxcvb/);
  });
  it("OpenRouter's own limit: scope=platform with the header numbers, the reset as seconds from now", async () => {
    const r = await refuse(
      429,
      { error: { code: 429, metadata: { error_type: 'rate_limit_exceeded' } } },
      {
        'X-RateLimit-Limit': '50',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(NOW + 31_200_000),
        'Retry-After': '60',
      },
    );
    expect(r).toEqual({
      ok: false,
      reason: 'RATE_LIMIT',
      scope: 'platform',
      rlLimit: 50,
      rlRemaining: 0,
      rlResetIn: 31_200,
      retryAfter: 60,
    });
  });
  it('a reset time already past is 0, and a body that is not JSON still gives the scope', async () => {
    const r = await refuse(429, 'Too Many Requests', {
      'X-RateLimit-Reset': String(NOW - 5000),
    });
    expect(r).toMatchObject({ scope: 'platform', rlResetIn: 0 });
    expect(await refuse(429, 'Too Many Requests')).toMatchObject({
      reason: 'RATE_LIMIT',
      scope: 'provider',
    });
  });
  it('another error status keeps its status and the provider name, without a scope', async () => {
    const r = await refuse(502, {
      error: {
        code: 502,
        metadata: { provider_name: 'Nvidia', provider_code: 'overloaded' },
      },
    });
    expect(r).toEqual({
      ok: false,
      reason: 'HTTP',
      status: 502,
      provider: 'Nvidia',
      providerCode: 'overloaded',
    });
  });
});

describe('the models of one request stay within the limit', () => {
  it('DEFAULT_MODEL and FALLBACK_MODELS together fit the limit, are free, and are not repeated', () => {
    const all = [DEFAULT_MODEL, ...FALLBACK_MODELS];
    expect(MAX_MODELS_PER_REQUEST).toBe(3);
    expect(all.length).toBeLessThanOrEqual(MAX_MODELS_PER_REQUEST);
    expect(new Set(all).size).toBe(all.length);
    for (const m of all) expect(m).toMatch(/^[a-z0-9._-]+\/[a-z0-9._-]+:free$/);
    expect(modelsForRequest(DEFAULT_MODEL, FALLBACK_MODELS)).toEqual(all);
  });
  it('modelsForRequest never returns more than the limit, drops repeats and blanks, keeps the order', () => {
    expect(modelsForRequest('a/1', ['a/2', 'a/3', 'a/4', 'a/5'])).toEqual([
      'a/1',
      'a/2',
      'a/3',
    ]);
    expect(modelsForRequest('a/1', ['a/1', '', 'a/2'])).toEqual(['a/1', 'a/2']);
    expect(modelsForRequest('a/1', [])).toEqual(['a/1']);
    // an OPENROUTER_MODEL override cannot push the list over the limit either
    expect(modelsForRequest('x/override', FALLBACK_MODELS)).toHaveLength(3);
  });
  it('the request body lists at most the limit, even when more fallbacks are given', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }));
    await callOpenRouter({
      apiKey: 'k',
      model: 'a/1',
      fallbacks: ['a/2', 'a/3', 'a/4', 'a/5', 'a/6'],
      input,
      fetchImpl: f as unknown as typeof fetch,
    });
    const body = JSON.parse(
      (f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.models).toEqual(['a/1', 'a/2', 'a/3']);
    expect(body.models.length).toBeLessThanOrEqual(MAX_MODELS_PER_REQUEST);
  });
});

describe('safeMessage and the message of a failed request', () => {
  // built from pieces: the source file must not hold anything shaped like a real key
  const fakeKey = ['sk', 'or', 'v1', 'x'.repeat(40)].join('-');
  it('keeps a short plain message, hides key-like tokens and odd characters, cuts at 120', () => {
    expect(safeMessage('models array must have at most 3 items')).toBe(
      'models array must have at most 3 items',
    );
    expect(safeMessage(`Invalid key ${fakeKey}`)).toBe('Invalid key …');
    const odd = safeMessage('bad {"a":1}\n<b>닭가슴살</b>')!;
    // braces, quotes, angle brackets and Korean text become "_"; only plain characters are left
    expect(odd).toMatch(/^[A-Za-z0-9 .,:/()…_-]+$/);
    expect(odd).not.toMatch(/[{}"<>닭가슴살]/);
    expect(odd.startsWith('bad ')).toBe(true);
    expect(safeMessage('x'.repeat(300))).toBe('…');
    expect(safeMessage('word '.repeat(60))!.length).toBeLessThanOrEqual(120);
    expect(safeMessage('')).toBeUndefined();
    expect(safeMessage('   ')).toBeUndefined();
    expect(safeMessage(42)).toBeUndefined();
    expect(safeMessage(undefined)).toBeUndefined();
  });
  it('a model id in a message stays readable (its parts are short)', () => {
    expect(safeMessage('unknown model google/gemma-4-31b-it:free')).toBe(
      'unknown model google/gemma-4-31b-it:free',
    );
  });
  const refuse = (
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    callOpenRouter({
      apiKey: 'k',
      model: 'm/x',
      input,
      fetchImpl: (async () =>
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
          headers,
        })) as unknown as typeof fetch,
    });
  it('a 400 gives its message and code-free result; the raw payload and the rest of the body are not read', async () => {
    const r = await refuse(400, {
      error: {
        code: 400,
        message: 'models: too many items (max 3)',
        metadata: {
          raw: '제공자 원문 zxcvb',
          provider_name: 'Google AI Studio',
        },
      },
      user_id: 'user-secret-123',
    });
    expect(r).toEqual({
      ok: false,
      reason: 'HTTP',
      status: 400,
      message: 'models: too many items (max 3)',
      provider: 'Google AI Studio',
    });
    expect(JSON.stringify(r)).not.toMatch(/zxcvb|user-secret/);
  });
  it('a 429 does not carry the message, and a body that is not JSON gives none', async () => {
    expect(
      await refuse(429, { error: { message: 'Rate limit exceeded' } }),
    ).not.toHaveProperty('message');
    expect(await refuse(400, 'Bad Request')).toEqual({
      ok: false,
      reason: 'HTTP',
      status: 400,
    });
  });
});

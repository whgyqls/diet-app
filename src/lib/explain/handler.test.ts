import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { MODEL_ATTEMPTS } from './config';
import { handleExplain, type ExplainDeps } from './handler';
import type { ExplainRequest } from './types';

const REQ: ExplainRequest = {
  goal: 'maintain',
  items: [
    { id: 'chicken-breast', grams: 150 },
    { id: 'cabbage', grams: 100 },
  ],
  oils: [],
  seasonings: [],
  free: [],
  totals: {
    kcal: 412,
    protein: 36,
    carbs: 20,
    fat: 12,
    satFat: 2.8,
    fiber: 8,
    sodium: 310,
  },
};
const GOOD =
  '{"text":"닭가슴살 150g이 단백질 36g을 채워 줘요. 양배추와 함께 드세요."}';

function deps(over: Partial<ExplainDeps> = {}) {
  const store = new Map<string, string>();
  const d: ExplainDeps = {
    model: 'm/x',
    now: () => new Date('2026-11-24T10:00:00Z'),
    isSameOrigin: (o, h) => o === `https://${h}`,
    getUserId: async () => 'user-1',
    hash: (t) => createHash('sha256').update(t).digest('hex'),
    cacheGet: vi.fn(async (h: string) => store.get(h) ?? null),
    cachePut: vi.fn(
      async (h: string, _m: string, t: string) => void store.set(h, t),
    ),
    consume: vi.fn(async () => true),
    call: vi.fn(async () => ({ ok: true as const, content: GOOD })),
    refund: vi.fn(async () => {}),
    attempts: [{ model: 'm/x', timeoutMs: 8000, minMs: 0 }],
    log: vi.fn(),
    ...over,
  };
  return d;
}
const send = (
  d: ExplainDeps,
  body: unknown = REQ,
  origin: string | null = 'https://x.app',
) =>
  handleExplain(d, {
    origin,
    host: 'x.app',
    bodyText: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('handleExplain', () => {
  it('asks the AI once, then serves the same combo from the cache without a call or a count', async () => {
    const d = deps();
    const first = await send(d);
    expect(first).toEqual({
      status: 200,
      body: { text: expect.stringContaining('150g'), source: 'ai' },
    });
    const second = await send(d);
    expect(second.body).toMatchObject({ source: 'cache' });
    expect(d.call).toHaveBeenCalledTimes(1);
    expect(d.consume).toHaveBeenCalledTimes(1);
  });
  it('refuses a foreign origin (403) and a missing session (401) before anything else', async () => {
    const d = deps({ getUserId: async () => null });
    expect((await send(d, REQ, 'https://evil.app')).status).toBe(403);
    expect((await send(d)).status).toBe(401);
    expect(d.call).not.toHaveBeenCalled();
    expect(d.consume).not.toHaveBeenCalled();
  });
  it('refuses bad, unknown-key, unknown-food and oversized requests', async () => {
    const d = deps();
    expect((await send(d, 'not json')).status).toBe(400);
    expect((await send(d, { ...REQ, email: 'a@b.c' })).status).toBe(400);
    expect(
      (await send(d, { ...REQ, items: [{ id: 'nope', grams: 5 }] })).status,
    ).toBe(400);
    expect((await send(d, ' '.repeat(9000) + JSON.stringify(REQ))).status).toBe(
      413,
    );
    expect(d.call).not.toHaveBeenCalled();
  });
  it('counts the call on the UTC day and shows the fallback when a limit is reached', async () => {
    const d = deps({ consume: vi.fn(async () => false) });
    const r = await send(d);
    expect(d.consume).toHaveBeenCalledWith('user-1', '2026-11-24');
    expect(r.body).toMatchObject({ source: 'fallback', reason: 'LIMIT' });
    expect(d.call).not.toHaveBeenCalled();
  });
  it('falls back when counting fails, when the AI fails, times out or is rate limited', async () => {
    expect(
      (
        await send(
          deps({
            consume: async () => {
              throw new Error('x');
            },
          }),
        )
      ).body,
    ).toMatchObject({
      source: 'fallback',
      reason: 'UNAVAILABLE',
    });
    expect(
      (
        await send(
          deps({ call: async () => ({ ok: false, reason: 'TIMEOUT' }) }),
        )
      ).body,
    ).toMatchObject({
      reason: 'BUSY',
    });
    expect(
      (
        await send(
          deps({ call: async () => ({ ok: false, reason: 'RATE_LIMIT' }) }),
        )
      ).body,
    ).toMatchObject({
      reason: 'BUSY',
    });
  });
  it('does not show or cache an answer with a made-up number, efficacy wording or no JSON', async () => {
    for (const content of [
      '{"text":"닭가슴살 999g이 들어 있어요. 맛있게 드세요."}',
      '{"text":"닭가슴살 150g 조합이라 혈당에 좋아요. 드세요."}',
      '그냥 문장',
    ]) {
      const d = deps({ call: async () => ({ ok: true, content }) });
      const r = await send(d);
      expect(r.body).toMatchObject({ source: 'fallback', reason: 'INVALID' });
      expect(d.cachePut).not.toHaveBeenCalled();
    }
  });
  it('still answers when the cache cannot be read or written', async () => {
    const d = deps({
      cacheGet: async () => {
        throw new Error('x');
      },
      cachePut: async () => {
        throw new Error('x');
      },
    });
    expect((await send(d)).body).toMatchObject({ source: 'ai' });
  });
  it('the cache key does not depend on anything but the combo, goal and model', async () => {
    const d = deps();
    await send(d);
    await send(d, {
      ...REQ,
      items: [
        { id: 'chicken-breast', grams: 150.2 },
        { id: 'cabbage', grams: 99.8 },
      ],
    });
    expect(d.call).toHaveBeenCalledTimes(1);
  });

  it('logs one line per fallback with the cause, and nothing about the answer, key or user', async () => {
    const secretAnswer =
      '{"text":"닭가슴살 150g이 혈당에 좋아요. 비밀문장XYZ"}';
    const d = deps({
      call: async () => ({
        ok: true,
        content: secretAnswer,
        model: 'vendor/some-free:model',
        finish: 'stop',
      }),
    });
    await send(d);
    const lines = (d.log as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    );
    // an answer our checks refuse is asked for once more from the same model: the first try, then the fallback
    expect(lines).toEqual([
      '[explain] attempt try=1 asked=m/x reason=INVALID cause=BANNED_WORD detail=혈당 model=vendor/some-free:model finish=stop ms=0',
      '[explain] fallback reason=INVALID cause=BANNED_WORD detail=혈당 model=vendor/some-free:model finish=stop ms=0 attempts=2',
    ]);
    for (const l of lines)
      for (const w of ['비밀문장XYZ', '닭가슴살', 'user-1', 'sk-or', 'Bearer'])
        expect(l).not.toContain(w);
  });

  it('logs the cause for every other way to fall back', async () => {
    const run = async (over: Partial<ExplainDeps>) => {
      const d = deps(over);
      await send(d);
      return (d.log as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => c[0] as string,
      );
    };
    expect(await run({ consume: async () => false })).toEqual([
      '[explain] fallback reason=LIMIT cause=LIMIT',
    ]);
    expect(
      await run({
        consume: async () => {
          throw new Error('x');
        },
      }),
    ).toEqual(['[explain] fallback reason=UNAVAILABLE cause=CONSUME_ERROR']);
    expect(
      await run({
        call: async () => ({ ok: false, reason: 'HTTP', status: 502 }),
      }),
    ).toEqual([
      '[explain] fallback reason=UNAVAILABLE cause=HTTP status=502 ms=0 refund=yes',
    ]);
    expect(
      await run({ call: async () => ({ ok: false, reason: 'TIMEOUT' }) }),
    ).toEqual(['[explain] fallback reason=BUSY cause=TIMEOUT ms=0 refund=yes']);
    expect(
      await run({ call: async () => ({ ok: false, reason: 'RATE_LIMIT' }) }),
    ).toEqual([
      '[explain] fallback reason=BUSY cause=RATE_LIMIT ms=0 refund=yes',
    ]);
    expect(
      await run({ call: async () => ({ ok: true, content: '그냥 {문장' }) }),
    ).toEqual([
      '[explain] attempt try=1 asked=m/x reason=INVALID cause=PARSE ms=0',
      '[explain] fallback reason=INVALID cause=PARSE ms=0 attempts=2',
    ]);
  });

  it('does not log anything for an answer that is shown, and a value with odd characters is made safe', async () => {
    const d = deps();
    await send(d);
    expect(d.log).not.toHaveBeenCalled();
    const bad = deps({
      call: async () => ({
        ok: true,
        content: GOOD,
        model: 'a b\nc"d;e',
        finish: 'length',
      }),
    });
    await send(bad);
    const line = (bad.log as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(line).toBe(
      '[explain] fallback reason=INVALID cause=TRUNCATED model=a_b_c_d_e finish=length ms=0',
    );
  });

  it('never shows or caches a cut-off answer, even when the part that arrived looks fine', async () => {
    const d = deps({
      call: async () => ({ ok: true, content: GOOD, finish: 'length' }),
    });
    expect((await send(d)).body).toMatchObject({
      source: 'fallback',
      reason: 'INVALID',
    });
    expect(d.cachePut).not.toHaveBeenCalled();
  });

  it('shows a plain sentence without JSON when it names a food, passes every check and is cached', async () => {
    const d = deps({
      call: async () => ({
        ok: true,
        content:
          '닭가슴살 150g이 단백질 36g을 채워 줘요. 양배추와 함께 드세요.',
      }),
    });
    expect((await send(d)).body).toMatchObject({ source: 'ai' });
    expect(d.cachePut).toHaveBeenCalledTimes(1);
  });

  it('logs the call time and token numbers, and turns an empty cut-off answer into TRUNCATED', async () => {
    let t = 1_000_000;
    const d = deps({
      now: () => new Date(t),
      call: async () => {
        t += 2500; // the call takes 2.5 s
        return {
          ok: false as const,
          reason: 'BAD_RESPONSE' as const,
          detail: 'CONTENT_EMPTY+REASONING',
          model: 'nvidia/some-reasoning:free',
          finish: 'length',
          tokens: 600,
          reasoningTokens: 598,
        };
      },
    });
    const r = await send(d);
    expect(r.body).toMatchObject({ source: 'fallback', reason: 'INVALID' });
    expect((d.log as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      '[explain] fallback reason=INVALID cause=TRUNCATED detail=CONTENT_EMPTY+REASONING model=nvidia/some-reasoning:free finish=length tokens=600 reasoning_tokens=598 ms=2500',
    );
  });

  it('logs a bad response that was not cut off with its detail', async () => {
    const d = deps({
      call: async () => ({
        ok: false,
        reason: 'BAD_RESPONSE',
        detail: 'NO_CHOICES',
        status: 502,
        finish: undefined,
      }),
    });
    await send(d);
    expect((d.log as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      '[explain] fallback reason=UNAVAILABLE cause=BAD_RESPONSE detail=NO_CHOICES status=502 ms=0',
    );
  });

  it("gives the counted call back for failures that are not the user's, once, for the same UTC day", async () => {
    for (const reason of ['RATE_LIMIT', 'TIMEOUT', 'HTTP', 'NO_KEY'] as const) {
      const d = deps({ call: async () => ({ ok: false, reason }) });
      await send(d);
      expect(d.consume).toHaveBeenCalledTimes(1);
      expect(d.refund).toHaveBeenCalledTimes(1);
      expect(d.refund).toHaveBeenCalledWith('user-1', '2026-11-24');
    }
  });

  it('keeps the count for a good answer, a cached one and every answer our checks refuse', async () => {
    const keep = async (over: Partial<ExplainDeps>) => {
      const d = deps(over);
      await send(d);
      return d.refund as ReturnType<typeof vi.fn>;
    };
    expect(await keep({})).not.toHaveBeenCalled();
    expect(
      await keep({ call: async () => ({ ok: true, content: '그냥 {문장' }) }),
    ).not.toHaveBeenCalled(); // PARSE
    expect(
      await keep({
        call: async () => ({
          ok: true,
          content: '{"text":"닭가슴살 999g이에요. 천천히 드세요."}',
        }),
      }),
    ).not.toHaveBeenCalled(); // NEW_NUMBER
    expect(
      await keep({
        call: async () => ({ ok: true, content: GOOD, finish: 'length' }),
      }),
    ).not.toHaveBeenCalled(); // TRUNCATED
    expect(
      await keep({
        call: async () => ({
          ok: false,
          reason: 'BAD_RESPONSE',
          detail: 'CONTENT_EMPTY',
        }),
      }),
    ).not.toHaveBeenCalled();
    expect(await keep({ consume: async () => false })).not.toHaveBeenCalled(); // our limit
  });

  it('a cache hit counts nothing and refunds nothing', async () => {
    const d = deps();
    await send(d);
    await send(d);
    expect(d.consume).toHaveBeenCalledTimes(1);
    expect(d.refund).not.toHaveBeenCalled();
  });

  it('still answers when giving the count back fails, and the log says so', async () => {
    const d = deps({
      call: async () => ({ ok: false, reason: 'RATE_LIMIT' }),
      refund: async () => {
        throw new Error('x');
      },
    });
    const r = await send(d);
    expect(r.body).toMatchObject({ source: 'fallback', reason: 'BUSY' });
    expect((d.log as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      '[explain] fallback reason=BUSY cause=RATE_LIMIT ms=0 refund=failed',
    );
  });

  it('logs who refused a 429 and the limit numbers, and nothing else of the response', async () => {
    const d = deps({
      call: async () => ({
        ok: false,
        reason: 'RATE_LIMIT',
        scope: 'provider',
        provider: 'Google AI Studio',
        providerCode: 429,
        rlLimit: 50,
        rlRemaining: 0,
        rlResetIn: 31200,
        retryAfter: 60,
      }),
    });
    await send(d);
    expect((d.log as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      '[explain] fallback reason=BUSY cause=RATE_LIMIT scope=provider provider=Google_AI_Studio provider_code=429 rl_limit=50 rl_remaining=0 rl_reset_in=31200 retry_after=60 ms=0 refund=yes',
    );
  });
});

// ---- the free models, one request each, in order ----
describe('handleExplain: the tries', () => {
  type Reply = Awaited<ReturnType<ExplainDeps['call']>>;
  const G1 = MODEL_ATTEMPTS[0].model;
  const G2 = MODEL_ATTEMPTS[1].model;
  const NEM = MODEL_ATTEMPTS[2].model;
  const rate: Reply = {
    ok: false,
    reason: 'RATE_LIMIT',
    scope: 'provider',
    provider: 'Google AI Studio',
  };
  const timeout: Reply = { ok: false, reason: 'TIMEOUT' };
  const good = (model: string): Reply => ({
    ok: true,
    content: GOOD,
    model,
    finish: 'stop',
    tokens: 40,
  });
  const refused: Reply = {
    ok: true,
    content: '{"text":"닭가슴살 999g이에요. 천천히 드세요."}',
    finish: 'stop',
  };
  const lines = (d: ExplainDeps) =>
    (d.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);

  /** Runs with the production tries. `script` gives the reply of each call, and how long that call takes (ms). */
  function run(script: [Reply, number?][], over: Partial<ExplainDeps> = {}) {
    let t = 0;
    let i = 0;
    const call = vi.fn(async () => {
      const [reply, took = 0] = script[Math.min(i++, script.length - 1)];
      t += took;
      return reply;
    });
    const d = deps({
      attempts: MODEL_ATTEMPTS,
      now: () => new Date(1_700_000_000_000 + t),
      call: call as unknown as ExplainDeps['call'],
      ...over,
    });
    return {
      d,
      call,
      calls: () =>
        call.mock.calls as unknown as [
          unknown,
          { model: string; extra?: unknown; timeoutMs: number },
        ][],
    };
  }

  it('a first model that answers is the only one asked, and nothing is logged', async () => {
    const { d, call } = run([[good(G1)]]);
    expect((await send(d)).body).toMatchObject({ source: 'ai' });
    expect(call).toHaveBeenCalledTimes(1);
    expect(d.log).not.toHaveBeenCalled();
  });

  it("goes through the models in order, one request each, with the model's own extra and time", async () => {
    const { d, calls } = run([
      [rate, 150],
      [rate, 130],
      [good(NEM), 20_000],
    ]);
    const r = await send(d);
    expect(r.body).toMatchObject({ source: 'ai' });
    expect(calls().map((c) => c[1].model)).toEqual([G1, G2, NEM]);
    expect(calls().map((c) => c[1].extra)).toEqual([
      undefined,
      undefined,
      { reasoning: { enabled: false } },
    ]);
    expect(calls().map((c) => c[1].timeoutMs)).toEqual([
      10_000, 10_000, 35_000,
    ]);
    // the text is cached with the model that wrote it, under the key of the first model
    expect(d.cachePut).toHaveBeenCalledWith(
      expect.any(String),
      NEM,
      expect.stringContaining('150g'),
    );
    expect(d.refund).not.toHaveBeenCalled();
  });

  it('logs each failed try, then the success with its try number', async () => {
    const { d } = run([
      [rate, 150],
      [rate, 130],
      [good(NEM), 20_000],
    ]);
    await send(d);
    expect(lines(d)).toEqual([
      `[explain] attempt try=1 asked=${G1} reason=BUSY cause=RATE_LIMIT scope=provider provider=Google_AI_Studio ms=150`,
      `[explain] attempt try=2 asked=${G2} reason=BUSY cause=RATE_LIMIT scope=provider provider=Google_AI_Studio ms=130`,
      `[explain] ok try=3 asked=${NEM} model=${NEM} finish=stop tokens=40 ms=20280`,
    ]);
  });

  it('when every model fails the answer is the fallback sentence, the last failure is the fallback line and the call is given back', async () => {
    const { d, call } = run([
      [rate, 150],
      [rate, 130],
      [timeout, 35_000],
    ]);
    const r = await send(d);
    expect(call).toHaveBeenCalledTimes(3);
    expect(r.body).toMatchObject({ source: 'fallback', reason: 'BUSY' });
    expect(d.refund).toHaveBeenCalledTimes(1);
    expect(d.cachePut).not.toHaveBeenCalled();
    const l = lines(d);
    expect(l).toHaveLength(3);
    expect(l[0]).toContain('attempt try=1');
    expect(l[1]).toContain('attempt try=2');
    expect(l[2]).toBe(
      '[explain] fallback reason=BUSY cause=TIMEOUT ms=35280 refund=yes attempts=3',
    );
  });

  it('does not give the call back when any model got as far as an answer our checks refuse', async () => {
    const { d } = run([
      [rate, 150],
      [refused, 2000],
      [refused, 2000],
      [rate, 100],
    ]);
    await send(d);
    expect(d.refund).not.toHaveBeenCalled();
  });

  it('skips a model when less than its minimum is left: nemotron needs 30 s of the 45 s', async () => {
    const { d, calls } = run([
      [timeout, 10_000],
      [timeout, 10_000],
      [good(NEM)],
    ]);
    const r = await send(d);
    // 20 s are used, 25 s are left: nemotron (minimum 30 s) is not asked
    expect(calls().map((c) => c[1].model)).toEqual([G1, G2]);
    expect(r.body).toMatchObject({ source: 'fallback', reason: 'BUSY' });
    expect(lines(d)[1]).toContain('attempts=2');
    expect(d.refund).toHaveBeenCalledTimes(1);
  });

  it('a try never gets more time than is left of the whole', async () => {
    const attempts = [
      { model: 'a/1:free', timeoutMs: 50_000, minMs: 1000 },
      { model: 'b/2:free', timeoutMs: 20_000, minMs: 1000 },
    ];
    const { calls } = run([[timeout, 40_000], [good('b/2:free')]], {
      attempts,
    });
    const { d, calls: c2 } = run([[timeout, 40_000], [good('b/2:free')]], {
      attempts,
    });
    await send(d);
    expect(c2().map((c) => c[1].timeoutMs)).toEqual([45_000, 5_000]);
    void calls;
  });

  it('with no time for any try the answer is the fallback sentence and nothing was asked', async () => {
    const { d, call } = run([[good(G1)]], {
      attempts: [{ model: 'a/1:free', timeoutMs: 10_000, minMs: 60_000 }],
    });
    const r = await send(d);
    expect(call).not.toHaveBeenCalled();
    expect(r.body).toMatchObject({ source: 'fallback', reason: 'UNAVAILABLE' });
    expect(lines(d)[0]).toContain('cause=NO_TIME');
    expect(d.refund).not.toHaveBeenCalled();
  });

  describe('a refused answer is asked for once more from the same model, only when twice its time is left', () => {
    it('the second try of the same model can answer', async () => {
      const { d, calls } = run([
        [refused, 2000],
        [good(G1), 2000],
      ]);
      expect((await send(d)).body).toMatchObject({ source: 'ai' });
      expect(calls().map((c) => c[1].model)).toEqual([G1, G1]);
      expect(lines(d)).toEqual([
        `[explain] attempt try=1 asked=${G1} reason=INVALID cause=NEW_NUMBER detail=unit finish=stop ms=2000`,
        `[explain] ok try=2 asked=${G1} model=${G1} finish=stop tokens=40 ms=4000`,
      ]);
    });
    it('only once: a second refused answer moves on to the next model', async () => {
      const { calls } = run([[refused, 1000], [refused, 1000], [good(G2)]]);
      const { d, calls: c } = run([
        [refused, 1000],
        [refused, 1000],
        [good(G2)],
      ]);
      await send(d);
      expect(c().map((x) => x[1].model)).toEqual([G1, G1, G2]);
      void calls;
    });
    it('not when too little time is left for another try of that length', async () => {
      // the first try took 30 s: twice that is not left of the 45 s
      const attempts = [
        { model: 'a/1:free', timeoutMs: 40_000, minMs: 1000 },
        { model: 'b/2:free', timeoutMs: 10_000, minMs: 1000 },
      ];
      const { d, calls } = run(
        [
          [refused, 30_000],
          [good('b/2:free'), 1000],
        ],
        { attempts },
      );
      await send(d);
      expect(calls().map((c) => c[1].model)).toEqual(['a/1:free', 'b/2:free']);
    });
    it('not for any other failure: 429, timeout, HTTP error, cut-off and empty answers go straight to the next model', async () => {
      const others: Reply[] = [
        rate,
        timeout,
        { ok: false, reason: 'HTTP', status: 502 },
        { ok: true, content: GOOD, finish: 'length' },
        { ok: false, reason: 'BAD_RESPONSE', detail: 'CONTENT_EMPTY' },
      ];
      for (const first of others) {
        const { d, calls } = run([[first], [good(G2)]]);
        await send(d);
        expect(
          calls().map((c) => c[1].model),
          JSON.stringify(first),
        ).toEqual([G1, G2]);
      }
    });
  });

  it('never puts the key, a response, an error message or the user into a log line', async () => {
    const { d } = run([
      [
        {
          ok: false,
          reason: 'HTTP',
          status: 400,
          message: 'bad request user-1 Bearer abc',
        },
        100,
      ],
      [refused, 100],
      [refused, 100],
      [rate, 100],
    ]);
    const r = await send(d);
    expect(JSON.stringify(r.body)).not.toMatch(/Bearer|user-1|bad request/);
    for (const l of lines(d))
      expect(l).not.toMatch(/999g|닭가슴살|sk-or|Authorization/);
  });
});

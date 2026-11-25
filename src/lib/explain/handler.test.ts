import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
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
    hasFallbackModels: true,
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
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      '[explain] fallback reason=INVALID cause=BANNED_WORD detail=혈당 model=vendor/some-free:model finish=stop ms=0',
    );
    for (const w of ['비밀문장XYZ', '닭가슴살', 'user-1', 'sk-or', 'Bearer'])
      expect(lines[0]).not.toContain(w);
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
    ).toEqual(['[explain] fallback reason=INVALID cause=PARSE ms=0']);
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
      now: () => new Date((t += 2500)),
      call: async () => ({
        ok: false,
        reason: 'BAD_RESPONSE',
        detail: 'CONTENT_EMPTY+REASONING',
        model: 'nvidia/some-reasoning:free',
        finish: 'length',
        tokens: 600,
        reasoningTokens: 598,
      }),
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

  describe('a 400 on a request that lists several models', () => {
    const bad400 = {
      ok: false as const,
      reason: 'HTTP' as const,
      status: 400,
      message: 'models: too many items (max 3)',
    };
    const good = {
      ok: true as const,
      content: GOOD,
      model: 'google/gemma-4-26b-a4b-it:free',
      finish: 'stop',
      tokens: 40,
    };
    const lines = (d: ExplainDeps) =>
      (d.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);

    it('asks again with the first model alone, shows that answer, and logs the 400 and the success with via=single_retry', async () => {
      const call = vi.fn(
        async (
          _i: unknown,
          _m: string,
          opts?: { single?: boolean; timeoutMs?: number },
        ) => (opts?.single ? good : bad400),
      );
      const d = deps({ call: call as unknown as ExplainDeps['call'] });
      const r = await send(d);
      expect(r.body).toMatchObject({ source: 'ai' });
      expect(call).toHaveBeenCalledTimes(2);
      expect(call.mock.calls[0][2]).toBeUndefined();
      expect(call.mock.calls[1][2]).toMatchObject({ single: true });
      expect(d.cachePut).toHaveBeenCalledTimes(1);
      expect(d.refund).not.toHaveBeenCalled();
      expect(lines(d)).toEqual([
        '[explain] retry reason=UNAVAILABLE cause=HTTP status=400 msg="models: too many items (max 3)" ms=0 via=single_retry',
        '[explain] ok model=google/gemma-4-26b-a4b-it:free finish=stop tokens=40 ms=0 via=single_retry',
      ]);
    });

    it('gives the second request only the time that is left of the server wait', async () => {
      let t = 0;
      const call = vi.fn(
        async (
          _i: unknown,
          _m: string,
          opts?: { single?: boolean; timeoutMs?: number },
        ) => {
          t += opts?.single ? 300 : 1000; // the first request took 1 s
          return opts?.single ? good : bad400;
        },
      );
      const d = deps({
        now: () => new Date(1_700_000_000_000 + t),
        call: call as unknown as ExplainDeps['call'],
      });
      await send(d);
      expect(call.mock.calls[1][2]!.timeoutMs).toBe(7000);
    });

    it('does not ask again when too little time is left', async () => {
      let t = 0;
      const call = vi.fn(async () => {
        t += 7000; // 1 s left, below the minimum
        return bad400;
      });
      const d = deps({
        now: () => new Date(1_700_000_000_000 + t),
        call: call as unknown as ExplainDeps['call'],
      });
      const r = await send(d);
      expect(call).toHaveBeenCalledTimes(1);
      expect(r.body).toMatchObject({
        source: 'fallback',
        reason: 'UNAVAILABLE',
      });
    });

    it('when the second request fails too, the fallback line says via=single_retry, and the call is given back', async () => {
      const call = vi.fn(
        async (_i: unknown, _m: string, opts?: { single?: boolean }) =>
          opts?.single
            ? {
                ok: false as const,
                reason: 'RATE_LIMIT' as const,
                scope: 'provider' as const,
              }
            : bad400,
      );
      const d = deps({ call: call as unknown as ExplainDeps['call'] });
      const r = await send(d);
      expect(r.body).toMatchObject({ source: 'fallback', reason: 'BUSY' });
      expect(d.refund).toHaveBeenCalledTimes(1);
      expect(lines(d)[1]).toBe(
        '[explain] fallback reason=BUSY cause=RATE_LIMIT scope=provider ms=0 refund=yes via=single_retry',
      );
    });

    it('a second 400 is reported with its message and the call is given back', async () => {
      const d = deps({ call: async () => bad400 });
      await send(d);
      expect(lines(d)).toHaveLength(2);
      expect(lines(d)[1]).toBe(
        '[explain] fallback reason=UNAVAILABLE cause=HTTP status=400 msg="models: too many items (max 3)" ms=0 refund=yes via=single_retry',
      );
      expect(d.refund).toHaveBeenCalledTimes(1);
    });

    it('is not retried for any other status, nor when the request listed only one model', async () => {
      for (const status of [401, 402, 403, 404, 500, 502]) {
        const call = vi.fn(async () => ({
          ok: false as const,
          reason: 'HTTP' as const,
          status,
        }));
        await send(deps({ call: call as unknown as ExplainDeps['call'] }));
        expect(call, String(status)).toHaveBeenCalledTimes(1);
      }
      const call = vi.fn(async () => bad400);
      await send(
        deps({
          hasFallbackModels: false,
          call: call as unknown as ExplainDeps['call'],
        }),
      );
      expect(call).toHaveBeenCalledTimes(1);
    });

    it('a request that went fine is never asked twice and logs nothing', async () => {
      const call = vi.fn(async () => good);
      const d = deps({ call: call as unknown as ExplainDeps['call'] });
      await send(d);
      expect(call).toHaveBeenCalledTimes(1);
      expect(d.log).not.toHaveBeenCalled();
    });

    it('the message in the log has no body, key or user data, and the response to the browser carries none of it', async () => {
      const d = deps({
        call: async () => ({
          ok: false as const,
          reason: 'HTTP' as const,
          status: 400,
          message: 'bad "quote" {x} user-1 Bearer abc',
        }),
      });
      const r = await send(d);
      expect(JSON.stringify(r.body)).not.toContain('quote');
      expect(lines(d)[0]).toContain('msg="bad _quote_ _x_ user-1 Bearer abc"');
    });
  });
});

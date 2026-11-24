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
      reason: 'UNAVAILABLE',
    });
    expect(
      (
        await send(
          deps({ call: async () => ({ ok: false, reason: 'RATE_LIMIT' }) }),
        )
      ).body,
    ).toMatchObject({
      reason: 'LIMIT',
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
      '[explain] fallback reason=UNAVAILABLE cause=HTTP status=502 ms=0',
    ]);
    expect(
      await run({ call: async () => ({ ok: false, reason: 'TIMEOUT' }) }),
    ).toEqual(['[explain] fallback reason=UNAVAILABLE cause=TIMEOUT ms=0']);
    expect(
      await run({ call: async () => ({ ok: false, reason: 'RATE_LIMIT' }) }),
    ).toEqual(['[explain] fallback reason=LIMIT cause=RATE_LIMIT ms=0']);
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
});

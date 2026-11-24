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
});

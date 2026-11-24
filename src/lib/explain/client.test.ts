import { describe, expect, it, vi } from 'vitest';
import { fetchExplanation } from './client';
import type { ExplainRequest } from './types';

const req = (g: number): ExplainRequest => ({
  goal: 'lose',
  items: [{ id: 'chicken-breast', grams: g }],
  oils: [],
  seasonings: [],
  free: [],
  totals: {
    kcal: 300,
    protein: 30,
    carbs: 5,
    fat: 5,
    satFat: 1,
    fiber: 2,
    sodium: 100,
  },
});
const named = (name: string) => Object.assign(new Error(name), { name });

describe('fetchExplanation', () => {
  it('giving up after the browser wait shows "try again later" (BUSY), not a plain failure', async () => {
    for (const name of ['TimeoutError', 'AbortError']) {
      const f = vi.fn(async () => {
        throw named(name);
      });
      const r = await fetchExplanation(req(101), f as unknown as typeof fetch);
      expect(r).toMatchObject({ source: 'fallback', reason: 'BUSY' });
      expect(r.text).toContain('닭가슴살');
    }
  });
  it('any other failure (offline, bad answer) is UNAVAILABLE', async () => {
    const offline = vi.fn(async () => {
      throw named('TypeError');
    });
    expect(
      await fetchExplanation(req(102), offline as unknown as typeof fetch),
    ).toMatchObject({ reason: 'UNAVAILABLE' });
    const bad = vi.fn(async () => new Response('{}', { status: 500 }));
    expect(
      await fetchExplanation(req(103), bad as unknown as typeof fetch),
    ).toMatchObject({ reason: 'UNAVAILABLE' });
  });
  it('passes through what the server says, including BUSY, and does not remember a fallback', async () => {
    const body = { text: '기본 문장', source: 'fallback', reason: 'BUSY' };
    const f = vi.fn(
      async () => new Response(JSON.stringify(body), { status: 200 }),
    );
    expect(
      await fetchExplanation(req(104), f as unknown as typeof fetch),
    ).toEqual(body);
    await fetchExplanation(req(104), f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(2); // asked again: a fallback is not cached
  });
  it('remembers a real answer for the same combo', async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ text: '설명', source: 'ai' }), {
          status: 200,
        }),
    );
    await fetchExplanation(req(105), f as unknown as typeof fetch);
    await fetchExplanation(req(105), f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

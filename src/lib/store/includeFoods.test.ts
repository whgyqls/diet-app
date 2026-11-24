import { describe, expect, it } from 'vitest';
import { STORAGE_KEY, createAppStore } from './appStore';

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('store includeFoods (session only)', () => {
  it('is set, replaced, and cleared by resetAccountData', () => {
    const store = createAppStore(memory());
    store.getState().setIncludeFoods(['salmon']);
    expect(store.getState().includeFoods).toEqual(['salmon']);
    store.getState().resetAccountData();
    expect(store.getState().includeFoods).toEqual([]);
  });

  it('is not written to storage, so a reload starts empty', async () => {
    const storage = memory();
    const store = createAppStore(storage);
    store.getState().setIncludeFoods(['salmon']);
    store.getState().toggleStyle('lowCarb'); // forces a write
    const saved = storage.data.get(STORAGE_KEY) ?? '';
    expect(saved).toContain('lowCarb');
    expect(saved).not.toContain('salmon');
    expect(saved).not.toContain('includeFoods');
  });
});

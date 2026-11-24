import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESTORE_UNDO_MS } from '@/lib/supabase/syncConstants';
import { confirmBody, doneMessage } from './messages';
import type { RestorePlan } from './planRestore';
import { restoreUi } from './restoreUi';

const plan = (over: Partial<RestorePlan> = {}): RestorePlan => ({
  settings: null,
  selection: null,
  kits: [],
  saved: [],
  skipped: {
    kitsExisting: 0,
    kitsOverCap: 0,
    savedExisting: 0,
    savedOverCap: 0,
  },
  overwrite: {
    profileFields: 0,
    styles: false,
    overrides: false,
    foods: 0,
    seasonings: 0,
  },
  needsConfirm: false,
  add: { kits: 0, saved: 0 },
  hasChanges: false,
  ...over,
});

describe('confirmBody', () => {
  it('names only what really changes, with the counts of the plan', () => {
    const body = confirmBody(
      plan({
        overwrite: {
          profileFields: 3,
          styles: true,
          overrides: false,
          foods: 12,
          seasonings: 4,
        },
        add: { kits: 2, saved: 5 },
      }),
    );
    expect(body).toContain('프로필 3개 항목');
    expect(body).toContain('식단 스타일');
    expect(body).not.toContain('직접 설정한 목표');
    expect(body).toContain('재료 선택(재료 12개·양념 4개로 바뀜)');
    expect(body).toContain('세트 2개, ★ 5개');
    expect(body).toContain('10초');
  });
});

describe('doneMessage', () => {
  it('lists what was loaded', () => {
    expect(
      doneMessage(
        plan({
          settings: { profile: {}, styles: [], overrides: {} },
          selection: { foods: {}, seasonings: {} },
          add: { kits: 2, saved: 3 },
        }),
        { kits: 0, saved: 0 },
      ),
    ).toBe('이전 기록을 불러왔어요: 프로필·설정, 재료 선택, 세트 2개, ★ 3개.');
  });
  it('says so when nothing had to change', () => {
    expect(doneMessage(plan(), { kits: 0, saved: 0 })).toContain(
      '바꿀 내용이 없었어요',
    );
  });
  it('names why items were skipped, with the caps, and that they stay in this browser', () => {
    const msg = doneMessage(
      plan({
        add: { kits: 1, saved: 0 },
        skipped: {
          kitsExisting: 1,
          kitsOverCap: 5,
          savedExisting: 2,
          savedOverCap: 4,
        },
      }),
      { kits: 1, saved: 1 },
    );
    expect(msg).toContain('이미 있음 3개');
    expect(msg).toContain('개수 제한(세트 30개·★ 300개) 9개');
    expect(msg).toContain('읽을 수 없음 2개');
    expect(msg).toContain('이 브라우저에 그대로 남아 있어요');
  });
});

describe('restoreUi (survives the screen being rebuilt, the undo window closes on its own)', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => {
    restoreUi.reset();
    vi.useRealTimers();
  });
  it('keeps the message and closes the undo window after RESTORE_UNDO_MS', () => {
    restoreUi.set({ message: 'x', undoSince: Date.now() });
    expect(restoreUi.get().undoSince).not.toBeNull();
    vi.advanceTimersByTime(RESTORE_UNDO_MS - 1);
    expect(restoreUi.get().undoSince).not.toBeNull();
    vi.advanceTimersByTime(2);
    expect(restoreUi.get().undoSince).toBeNull();
    expect(restoreUi.get().message).toBe('x');
  });
  it('a new window replaces the old timer', () => {
    restoreUi.set({ undoSince: 1 });
    vi.advanceTimersByTime(5000);
    restoreUi.set({ undoSince: 2 });
    vi.advanceTimersByTime(RESTORE_UNDO_MS - 1);
    expect(restoreUi.get().undoSince).toBe(2);
  });
});

// The texts of "이전 기록 불러오기" (confirm dialog and result). Pure: the numbers come from the plan.
import {
  RESTORE_MAX_KITS,
  RESTORE_MAX_SAVED,
} from '@/lib/supabase/syncConstants';
import type { RestorePlan } from './planRestore';

/** "바뀌는 것" and "추가되는 것" for the confirm dialog (only what the plan really does). */
export function confirmBody(plan: RestorePlan): string {
  const o = plan.overwrite;
  const changes: string[] = [];
  if (o.profileFields > 0) changes.push(`프로필 ${o.profileFields}개 항목`);
  if (o.styles) changes.push('식단 스타일');
  if (o.overrides) changes.push('직접 설정한 목표');
  if (o.foods > 0 || o.seasonings > 0) {
    const parts = [
      ...(o.foods > 0 ? [`재료 ${o.foods}개`] : []),
      ...(o.seasonings > 0 ? [`양념 ${o.seasonings}개`] : []),
    ];
    changes.push(`재료 선택(${parts.join('·')}로 바뀜)`);
  }
  const adds: string[] = [];
  if (plan.add.kits > 0) adds.push(`세트 ${plan.add.kits}개`);
  if (plan.add.saved > 0) adds.push(`★ ${plan.add.saved}개`);
  return [
    changes.length > 0 ? `바뀌는 것: ${changes.join(', ')}.` : '',
    adds.length > 0 ? `추가되는 것: ${adds.join(', ')}.` : '',
    '불러온 직후 10초 동안은 되돌릴 수 있어요.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The line shown after a restore that finished. */
export function doneMessage(
  plan: RestorePlan,
  dropped: { kits: number; saved: number },
): string {
  const done: string[] = [];
  if (plan.settings) done.push('프로필·설정');
  if (plan.selection) done.push('재료 선택');
  if (plan.add.kits > 0) done.push(`세트 ${plan.add.kits}개`);
  if (plan.add.saved > 0) done.push(`★ ${plan.add.saved}개`);
  const head =
    done.length > 0
      ? `이전 기록을 불러왔어요: ${done.join(', ')}.`
      : '이전 기록을 확인했어요. 바꿀 내용이 없었어요.';
  const s = plan.skipped;
  const existing = s.kitsExisting + s.savedExisting;
  const over = s.kitsOverCap + s.savedOverCap;
  const unreadable = dropped.kits + dropped.saved;
  const skipped: string[] = [];
  if (existing > 0) skipped.push(`이미 있음 ${existing}개`);
  if (over > 0)
    skipped.push(
      `개수 제한(세트 ${RESTORE_MAX_KITS}개·★ ${RESTORE_MAX_SAVED}개) ${over}개`,
    );
  if (unreadable > 0) skipped.push(`읽을 수 없음 ${unreadable}개`);
  return skipped.length > 0
    ? `${head} 건너뛴 항목: ${skipped.join(', ')}. 건너뛴 기록은 이 브라우저에 그대로 남아 있어요.`
    : head;
}

export const RESTORE_PARTIAL_MESSAGE =
  '일부만 불러왔어요. 다시 눌러 이어서 불러오세요.';
export const RESTORE_FAILED_MESSAGE =
  '불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
export const UNDO_DONE_MESSAGE = '이전 기록 불러오기를 되돌렸어요.';
export const UNDO_FAILED_MESSAGE =
  '되돌리지 못했어요. 이전 기록 불러오기를 다시 눌러 마무리할 수 있어요.';

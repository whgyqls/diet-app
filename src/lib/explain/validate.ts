// Checks the AI's answer before anybody sees it (or it is cached): JSON shape, length, only numbers from the
// input, no efficacy wording. Anything else is refused and the screen shows the fallback text instead.
import { EXPLAIN_LIMITS } from './config';
import { allowedNumbers } from './payload';
import type { ExplainInput } from './types';

/** Words that claim an effect on health or disease (CLAUDE.md: no efficacy wording). */
export const BANNED_WORDS = [
  '대사',
  '혈당',
  '혈압',
  '당뇨',
  '치료',
  '예방',
  '개선',
  '효과',
  '효능',
  '면역',
  '질병',
  '질환',
  '항암',
  '해독',
  '디톡스',
  '완치',
] as const;

export type InvalidReason =
  'NOT_JSON' | 'LENGTH' | 'SENTENCES' | 'NEW_NUMBER' | 'BANNED_WORD';

/** The `text` of the model's answer, or null when it is not the JSON we asked for. */
export function parseModelText(content: unknown): string | null {
  if (typeof content !== 'string') return null;
  const body = content.replace(/```(?:json)?/gi, '').trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v: unknown = JSON.parse(body.slice(start, end + 1));
    if (v && typeof v === 'object' && 'text' in v) {
      const t = (v as { text: unknown }).text;
      return typeof t === 'string' ? t.trim() : null;
    }
  } catch {
    // fall through
  }
  return null;
}

const UNIT_AFTER = /^\s*(?:g|kg|kcal|mg|%|퍼센트|그램|킬로칼로리)/i;
/** Bare counts ("2가지", "1~2문장") may be 1-3; anything with a unit must come from the input. */
const SMALL_COUNTS = new Set([1, 2, 3]);

export function checkExplanation(
  text: string,
  input: ExplainInput,
): { ok: true } | { ok: false; reason: InvalidReason } {
  const { minTextChars, maxTextChars, maxSentences } = EXPLAIN_LIMITS;
  if (text.length < minTextChars || text.length > maxTextChars)
    return { ok: false, reason: 'LENGTH' };
  const sentences = text
    .split(/[!?。]|\.(?!\d)|\n/)
    .filter((s) => s.trim()).length;
  if (sentences > maxSentences) return { ok: false, reason: 'SENTENCES' };
  if (BANNED_WORDS.some((w) => text.includes(w)))
    return { ok: false, reason: 'BANNED_WORD' };
  const allowed = allowedNumbers(input);
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    const rest = text.slice((m.index ?? 0) + m[0].length);
    const ok =
      allowed.has(n) || (SMALL_COUNTS.has(n) && !UNIT_AFTER.test(rest));
    if (!ok) return { ok: false, reason: 'NEW_NUMBER' };
  }
  return { ok: true };
}

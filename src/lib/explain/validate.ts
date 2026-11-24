// Checks the AI's answer before anybody sees it (or it is cached): finds the sentence, then length, only numbers
// from the input, no efficacy wording. Anything else is refused and the screen shows the fallback text instead.
import { EXPLAIN_LIMITS } from './config';
import { allowedNumbers } from './payload';
import type { ExplainInput } from './types';

/** Words that claim an effect on health or disease (CLAUDE.md: no efficacy wording). Kept strict on purpose. */
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
  | 'PARSE'
  | 'NO_FOOD_NAME'
  | 'TRUNCATED'
  | 'LENGTH'
  | 'SENTENCES'
  | 'NEW_NUMBER'
  | 'BANNED_WORD';
/** Why an answer was refused, plus a small hint taken from our own constants (never the answer's text). */
export type Invalid = { ok: false; reason: InvalidReason; detail?: string };

// ---- Finding the sentence ------------------------------------------------------------------------------------

const THINK = /<think>[\s\S]*?<\/think>/gi;
const normalizeQuotes = (s: string) =>
  s.replace(/[“”„‟]/g, '"').replace(/[‘’‚‛]/g, "'");

/** Every balanced {...} in `s`, found string-aware, so a brace inside text or around the JSON does not matter. */
function objectCandidates(s: string): string[] {
  const out: string[] = [];
  for (
    let start = s.indexOf('{');
    start >= 0;
    start = s.indexOf('{', start + 1)
  ) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inString) {
        if (c === '\\') i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        out.push(s.slice(start, i + 1));
        break;
      }
    }
  }
  return out;
}

/** Fixes what small models get wrong in JSON: raw line breaks inside strings and a comma before a closing brace. */
function repairJson(s: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') {
        out += c + (s[i + 1] ?? '');
        i++;
      } else if (c === '"') {
        inString = false;
        out += c;
      } else if (c === '\n' || c === '\r' || c === '\t') out += ' ';
      else out += c;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === ',' && /^\s*[}\]]/.test(s.slice(i + 1))) {
      // trailing comma: drop it
    } else out += c;
  }
  return out;
}

function textOf(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.text === 'string') return o.text.trim();
  const strings = Object.values(o).filter(
    (x): x is string => typeof x === 'string',
  );
  return strings.length === 1 ? strings[0].trim() : null;
}

/** The sentence inside a JSON object in the answer (fenced, with talk around it, slightly broken), or null. */
export function parseModelText(content: unknown): string | null {
  if (typeof content !== 'string') return null;
  const body = content.replace(THINK, '').replace(/```(?:json)?/gi, '');
  for (const variant of [body, normalizeQuotes(body)])
    for (const candidate of objectCandidates(variant))
      for (const json of [candidate, repairJson(candidate)])
        try {
          const t = textOf(JSON.parse(json));
          if (t) return t;
        } catch {
          // try the next form
        }
  return null;
}

const foodNames = (input: ExplainInput) => [
  ...input.items.map((i) => i.name),
  ...input.oils.map((o) => o.name),
];

/**
 * The sentence of the answer. JSON first (what the prompt asks for). An answer with no JSON at all is taken as
 * the sentence itself only when it names at least one of the combo's foods; every other check still applies.
 */
export function extractExplanation(
  content: unknown,
  input: ExplainInput,
): { ok: true; text: string; mode: 'json' | 'plain' } | Invalid {
  if (typeof content !== 'string') return { ok: false, reason: 'PARSE' };
  const json = parseModelText(content);
  if (json) return { ok: true, text: json, mode: 'json' };
  const body = content.replace(THINK, '').trim();
  if (!body || /[{}]|```|json/i.test(body))
    return { ok: false, reason: 'PARSE' };
  const text = body.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  if (!foodNames(input).some((n) => text.includes(n)))
    return { ok: false, reason: 'NO_FOOD_NAME' };
  return { ok: true, text, mode: 'plain' };
}

// ---- Checking the sentence -----------------------------------------------------------------------------------

const UNIT_AFTER =
  /^\s*(?:g|kg|kcal|mg|%|퍼센트|그램|킬로칼로리|칼로리|밀리그램)/i;
/** Bare counts ("2가지", "1~2문장") may be 1-3; anything with a unit must come from the input. */
const SMALL_COUNTS = new Set([1, 2, 3]);

export function checkExplanation(
  text: string,
  input: ExplainInput,
): { ok: true } | Invalid {
  const { minTextChars, maxTextChars, maxSentences } = EXPLAIN_LIMITS;
  if (text.length < minTextChars)
    return { ok: false, reason: 'LENGTH', detail: 'short' };
  if (text.length > maxTextChars)
    return { ok: false, reason: 'LENGTH', detail: 'long' };
  const sentences = text
    .split(/[!?。]|\.(?!\d)|\n/)
    .filter((s) => s.trim()).length;
  if (sentences > maxSentences) return { ok: false, reason: 'SENTENCES' };
  const banned = BANNED_WORDS.find((w) => text.includes(w));
  if (banned) return { ok: false, reason: 'BANNED_WORD', detail: banned };
  const allowed = allowedNumbers(input);
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    const withUnit = UNIT_AFTER.test(text.slice((m.index ?? 0) + m[0].length));
    if (!(allowed.has(n) || (SMALL_COUNTS.has(n) && !withUnit)))
      return {
        ok: false,
        reason: 'NEW_NUMBER',
        detail: withUnit ? 'unit' : 'bare',
      };
  }
  return { ok: true };
}

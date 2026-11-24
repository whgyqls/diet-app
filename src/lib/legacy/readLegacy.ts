// Reads the old pre-login record ("이전 기록") from the raw text of its two localStorage keys and cleans it with
// the same validators as server reads (PLAN.md 9.2). Pure; never throws: anything unusable is dropped and counted.
import type { IngredientKit, KnownIds } from '@/lib/kits/kits';
import { signatureOf, type SavedCombo } from '@/lib/plan/savedCombos';
import { sanitizePartialProfile } from '@/lib/profile';
import { migrateSelection } from '@/lib/selection/selection';
import {
  FINGERPRINT_MAX_CHARS,
  ROW_JSON_MAX_BYTES,
  SIGNATURE_MAX_CHARS,
} from '@/lib/supabase/syncConstants';
import {
  isRecord,
  sanitizeKit,
  sanitizeOverrides,
  sanitizeSavedCombo,
  sanitizeSelection,
  sanitizeStyles,
} from '@/lib/validate/validate';
import type {
  DietStyle,
  Profile,
  Selection,
  TargetOverrides,
} from '@/types/nutrition';

export type LegacyRecord = {
  profile: Partial<Profile>;
  styles: DietStyle[];
  overrides: TargetOverrides;
  selection: Selection;
  kits: IngredientKit[];
  saved: SavedCombo[];
  /** Items that could not be used (unknown ids, broken shape, a value the table would refuse). */
  dropped: { kits: number; saved: number };
  /** ★ whose stored signature differed from the one computed from its foods (the computed one is used). */
  signaturesCorrected: number;
};

const jsonBytes = (v: unknown) =>
  new TextEncoder().encode(JSON.stringify(v)).length;
const fits = (v: unknown) => jsonBytes(v) < ROW_JSON_MAX_BYTES;

const parseJson = (raw: string | null): unknown => {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

/** A kit the table accepts: the selection json is under the size limit (name and styles are checked by sanitizeKit). */
const kitFitsTable = (k: IngredientKit) =>
  fits({ foods: k.selection.foods, seasonings: k.selection.seasonings });

/** A ★ whose every column the table accepts. The signature is already the recomputed one. */
const savedFitsTable = (s: SavedCombo) =>
  s.signature.length <= SIGNATURE_MAX_CHARS &&
  s.requestFingerprint.length <= FINGERPRINT_MAX_CHARS &&
  fits(s.items) &&
  fits(s.oils) &&
  fits(s.seasonings) &&
  fits(s.totals);

export function readLegacyRecord(
  rawState: string | null,
  rawSaved: string | null,
  known: KnownIds,
): LegacyRecord {
  const out: LegacyRecord = {
    profile: {},
    styles: [],
    overrides: {},
    selection: { foods: {}, seasonings: {} },
    kits: [],
    saved: [],
    dropped: { kits: 0, saved: 0 },
    signaturesCorrected: 0,
  };

  // ---- diet-app-v1: zustand persist payload { state, version } ----
  const payload = parseJson(rawState);
  if (isRecord(payload) && isRecord(payload.state)) {
    const state = payload.state;
    const version = typeof payload.version === 'number' ? payload.version : 0;
    out.profile = sanitizePartialProfile(state.profile);
    out.styles = sanitizeStyles(state.styles);
    out.overrides = sanitizeOverrides(state.overrides);
    // version 1 and older kept the oils among the seasonings: move them BEFORE cleaning (an oil is not a known
    // seasoning id any more and would be dropped)
    const rawSel = isRecord(state.selection) ? state.selection : {};
    const moved =
      version < 2
        ? migrateSelection(
            {
              foods: isRecord(rawSel.foods)
                ? (rawSel.foods as Selection['foods'])
                : {},
              seasonings: isRecord(rawSel.seasonings)
                ? (rawSel.seasonings as Selection['seasonings'])
                : {},
            },
            known.oilIds,
          )
        : rawSel;
    out.selection = sanitizeSelection(moved, known);
    // kits exist from version 2 on
    if (version >= 2 && Array.isArray(state.kits)) {
      const names = new Set<string>();
      for (const raw of state.kits) {
        const kit = sanitizeKit(raw, known);
        if (!kit || !kitFitsTable(kit)) {
          out.dropped.kits += 1;
          continue;
        }
        // two kits with one name cannot both be stored (unique name per user): keep the first
        if (names.has(kit.name)) {
          out.dropped.kits += 1;
          continue;
        }
        names.add(kit.name);
        out.kits.push(kit);
      }
    }
  }

  // ---- diet-app-saved-v1: { items: SavedCombo[] } ----
  const savedPayload = parseJson(rawSaved);
  if (isRecord(savedPayload) && Array.isArray(savedPayload.items)) {
    for (const raw of savedPayload.items) {
      const combo = sanitizeSavedCombo(raw, known);
      if (!combo) {
        out.dropped.saved += 1;
        continue;
      }
      // The card shows ★ by comparing signatures computed from its foods, and the server keeps one row per
      // signature, so the signature must be the one computed from the stored foods, not a stored copy.
      const computed = signatureOf(
        combo.items.map((i) => ({ foodId: i.foodId, grams: i.grams })),
        combo.oils.map((i) => ({ foodId: i.foodId, grams: i.grams })),
      );
      const fixed =
        computed === combo.signature
          ? combo
          : { ...combo, signature: computed };
      if (!savedFitsTable(fixed)) {
        out.dropped.saved += 1;
        continue;
      }
      if (fixed !== combo) out.signaturesCorrected += 1;
      out.saved.push(fixed);
    }
  }
  return out;
}

/** Nothing usable in the record: the restore button stays hidden. */
export function isLegacyEmpty(r: LegacyRecord): boolean {
  return (
    Object.keys(r.profile).length === 0 &&
    r.styles.length === 0 &&
    Object.keys(r.overrides).length === 0 &&
    Object.keys(r.selection.foods).length === 0 &&
    Object.keys(r.selection.seasonings).length === 0 &&
    r.kits.length === 0 &&
    r.saved.length === 0
  );
}

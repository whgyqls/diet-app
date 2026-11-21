// Turns the (possibly partial) onboarding draft into a valid Profile, or undefined.
import { z } from 'zod';
import type { Profile, TargetOverrides } from '@/types/nutrition';
import { ADVANCED_LIMITS, PROFILE_LIMITS } from '@/lib/nutrition/constants';

const L = PROFILE_LIMITS;
const profileSchema = z.object({
  sex: z.enum(['female', 'male']),
  birthYear: z.number().int().min(L.birthYear.min).max(L.birthYear.max),
  heightCm: z.number().min(L.heightCm.min).max(L.heightCm.max),
  weightKg: z.number().min(L.weightKg.min).max(L.weightKg.max),
  activityLevel: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  goal: z.enum(['lose', 'maintain', 'gain']),
  mealsPerDay: z.union([z.literal(2), z.literal(3)]),
});

export function parseProfile(draft: Partial<Profile>): Profile | undefined {
  const r = profileSchema.safeParse(draft);
  return r.success ? r.data : undefined;
}

/** Advanced form text fields -> overrides. Empty or out-of-range fields are ignored. */
export type AdvancedDraft = {
  sodiumMax: string;
  proteinPerKg: string;
  netCarbG: string;
  fatG: string;
};

export function overridesFromDraft(d: AdvancedDraft): TargetOverrides {
  const num = (s: string, min: number, max: number) => {
    if (s.trim() === '') return undefined;
    const n = Number(s);
    return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
  };
  const A = ADVANCED_LIMITS;
  const out: TargetOverrides = {};
  const sodium = num(d.sodiumMax, A.sodiumMg.min, A.sodiumMg.max);
  const perKg = num(d.proteinPerKg, A.proteinPerKg.min, A.proteinPerKg.max);
  const carb = num(d.netCarbG, A.grams.min, A.grams.max);
  const fat = num(d.fatG, A.grams.min, A.grams.max);
  if (sodium !== undefined) out.sodiumMax = sodium;
  if (perKg !== undefined) out.protein = { perKg };
  if (carb !== undefined) out.netCarbs = { g: carb };
  if (fat !== undefined) out.fat = { g: fat };
  return out;
}

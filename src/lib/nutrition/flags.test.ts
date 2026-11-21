import { describe, expect, it } from 'vitest';
import type { FlagCode, MicroKey, NutrientTotals } from '@/types/nutrition';
import {
  FLAG_MESSAGES,
  FLAG_SOURCES,
  HARD_FROM_FOOD_NOTE,
  HEALTH_FLAGS,
  computeFlags,
} from './flags';
import { calcDayTargets } from './targets';
import { EXAMPLE_PROFILES, REF_YEAR } from './test-fixtures';

describe('flag texts', () => {
  it('has a non-empty message for every health flag', () => {
    for (const f of HEALTH_FLAGS)
      expect(FLAG_MESSAGES[f].length).toBeGreaterThan(0);
  });

  it('uses the approved wording for the high-fat, saturated-fat and low-sodium notes', () => {
    expect(FLAG_MESSAGES.HIGH_FAT_MOSTLY_UNSAT).toBe(
      '지방 비율이 일반 권고(35%)보다 높지만 대부분 불포화지방이에요.',
    );
    expect(FLAG_MESSAGES.HIGH_SAT_FAT).toBe(
      '포화지방이 하루 칼로리의 10% 이상이에요. 지방이 많은 고기나 유제품을 줄이면 낮출 수 있어요.',
    );
    expect(FLAG_MESSAGES.LOW_SODIUM).toContain('1,500mg');
  });

  it('has the vitamin D hard-from-food note', () => {
    expect(HARD_FROM_FOOD_NOTE).toBe('음식만으로는 채우기 어려운 영양소예요');
  });
});

const maintainM = EXAMPLE_PROFILES[1].profile; // 75 kg man
const dayOf = (overrides = {}) =>
  calcDayTargets(maintainM, REF_YEAR, overrides);

/** An intake that raises no flag for the default targets. */
function okIntake(targets = dayOf().targets): {
  totals: NutrientTotals;
  micros: Record<MicroKey, number>;
} {
  const fatKcal = (share: number) => (targets.kcal * share) / 9;
  return {
    totals: {
      kcal: targets.kcal,
      protein: 75 * 1.2,
      carbs: 150,
      netCarbs: 120,
      fiber: 30,
      fat: fatKcal(0.3),
      satFat: fatKcal(0.05),
      sodium: 1500,
      cholesterol: 200,
    },
    micros: { ...targets.micros },
  };
}

function flagsFor(
  intakeOver: Partial<NutrientTotals> = {},
  opts: { overrides?: object; micros?: Partial<Record<MicroKey, number>> } = {},
) {
  const { targets, flags } = dayOf(opts.overrides);
  const base = okIntake(targets);
  return computeFlags({
    profile: maintainM,
    targets,
    settingFlags: flags,
    intake: {
      totals: { ...base.totals, ...intakeOver },
      micros: { ...base.micros, ...opts.micros },
    },
  });
}
const codes = (f: { code: FlagCode }[]) => f.map((x) => x.code);

describe('computeFlags (final values, one place)', () => {
  it('raises nothing for an intake inside every limit', () => {
    expect(flagsFor()).toEqual([]);
  });

  it('every flag carries a message, a source and a basis', () => {
    const all = flagsFor(
      {
        protein: 75 * 2,
        carbs: 50,
        netCarbs: 30,
        fat: (2500 * 0.5) / 9,
        satFat: (2500 * 0.2) / 9,
        cholesterol: 400,
        kcal: 1000,
      },
      { overrides: { sodiumMax: 1400 }, micros: { calcium: 1 } },
    );
    expect(codes(all)).toEqual(
      expect.arrayContaining([
        'HIGH_PROTEIN',
        'LOW_TOTAL_CARB',
        'LOW_NET_CARB',
        'HIGH_FAT',
        'HIGH_SAT_FAT',
        'LOW_SODIUM',
        'HIGH_CHOLESTEROL',
        'LOW_KCAL',
        'MICRO_SHORTFALL',
      ]),
    );
    for (const f of all) {
      expect(f.message.length).toBeGreaterThan(0);
      expect(f.source.length).toBeGreaterThan(0);
      expect(['setting', 'intake']).toContain(f.basis);
      expect(f.message).toBe(FLAG_MESSAGES[f.code]);
      expect(f.source).toBe(FLAG_SOURCES[f.code]);
    }
  });

  it('has a source for every flag code', () => {
    for (const code of Object.keys(FLAG_MESSAGES) as FlagCode[])
      expect(FLAG_SOURCES[code].length, code).toBeGreaterThan(0);
  });

  it('HIGH_PROTEIN above 1.6 g/kg of the intake', () => {
    expect(codes(flagsFor({ protein: 75 * 1.6 }))).not.toContain(
      'HIGH_PROTEIN',
    );
    expect(codes(flagsFor({ protein: 75 * 1.6 + 0.1 }))).toContain(
      'HIGH_PROTEIN',
    );
  });

  it('LOW_TOTAL_CARB below 100 g, LOW_NET_CARB below 50 g (intake)', () => {
    expect(codes(flagsFor({ carbs: 100 }))).not.toContain('LOW_TOTAL_CARB');
    expect(codes(flagsFor({ carbs: 99.9 }))).toContain('LOW_TOTAL_CARB');
    expect(codes(flagsFor({ netCarbs: 50 }))).not.toContain('LOW_NET_CARB');
    expect(codes(flagsFor({ netCarbs: 49.9 }))).toContain('LOW_NET_CARB');
  });

  it('fat above 35% of the kcal eaten: "mostly unsaturated" while saturated fat stays under 10%, else plain HIGH_FAT', () => {
    const { targets } = dayOf();
    const fat = (share: number) => (targets.kcal * share) / 9;
    expect(codes(flagsFor({ fat: fat(0.34) }))).not.toEqual(
      expect.arrayContaining(['HIGH_FAT_MOSTLY_UNSAT']),
    );
    const unsat = codes(flagsFor({ fat: fat(0.36), satFat: fat(0.05) }));
    expect(unsat).toContain('HIGH_FAT_MOSTLY_UNSAT');
    expect(unsat).not.toContain('HIGH_FAT');
    const sat = codes(flagsFor({ fat: fat(0.36), satFat: fat(0.105) }));
    expect(sat).toContain('HIGH_FAT');
    expect(sat).toContain('HIGH_SAT_FAT');
    expect(sat).not.toContain('HIGH_FAT_MOSTLY_UNSAT');
  });

  it('HIGH_SAT_FAT only above 10% of the kcal eaten', () => {
    const { targets } = dayOf();
    const fat = (share: number) => (targets.kcal * share) / 9;
    expect(codes(flagsFor({ satFat: fat(0.099) }))).not.toContain(
      'HIGH_SAT_FAT',
    );
    expect(codes(flagsFor({ satFat: fat(0.101) }))).toContain('HIGH_SAT_FAT');
  });

  it('LOW_SODIUM is about the cap the user set, not about the sodium eaten', () => {
    expect(codes(flagsFor({ sodium: 500 }))).not.toContain('LOW_SODIUM');
    const set = flagsFor({}, { overrides: { sodiumMax: 1499 } });
    const f = set.find((x) => x.code === 'LOW_SODIUM')!;
    expect(f.basis).toBe('setting');
    expect(
      codes(flagsFor({}, { overrides: { sodiumMax: 1500 } })),
    ).not.toContain('LOW_SODIUM');
  });

  it('HIGH_CHOLESTEROL above 300 mg', () => {
    expect(codes(flagsFor({ cholesterol: 300 }))).not.toContain(
      'HIGH_CHOLESTEROL',
    );
    expect(codes(flagsFor({ cholesterol: 301 }))).toContain('HIGH_CHOLESTEROL');
  });

  it('LOW_KCAL below 80% of the target', () => {
    const { targets } = dayOf();
    expect(codes(flagsFor({ kcal: targets.kcal * 0.81 }))).not.toContain(
      'LOW_KCAL',
    );
    expect(codes(flagsFor({ kcal: targets.kcal * 0.79 }))).toContain(
      'LOW_KCAL',
    );
  });

  it('KCAL_BELOW_FLOOR when the intake is under the safe floor (man 1,500 kcal)', () => {
    expect(codes(flagsFor({ kcal: 1499 }))).toContain('KCAL_BELOW_FLOOR');
    expect(codes(flagsFor({ kcal: 2400 }))).not.toContain('KCAL_BELOW_FLOOR');
  });

  it('MICRO_SHORTFALL below 90% of a KDRI value, listing the nutrients; vitamin D never raises it', () => {
    const { targets } = dayOf();
    expect(
      codes(
        flagsFor({}, { micros: { calcium: targets.micros.calcium * 0.9 } }),
      ),
    ).not.toContain('MICRO_SHORTFALL');
    const f = flagsFor(
      {},
      { micros: { calcium: targets.micros.calcium * 0.89, iron: 0 } },
    ).find((x) => x.code === 'MICRO_SHORTFALL')!;
    expect(f.detail).toContain('칼슘');
    expect(f.detail).toContain('철');
    expect(codes(flagsFor({}, { micros: { vitaminD: 0 } }))).not.toContain(
      'MICRO_SHORTFALL',
    );
  });

  it('keeps the setting notices from calcDayTargets (clamps, below-minimum)', () => {
    const f = flagsFor({}, { overrides: { protein: { g: 400 } } });
    expect(codes(f)).toContain('PROTEIN_CLAMPED_TO_MAX');
    expect(f.find((x) => x.code === 'PROTEIN_CLAMPED_TO_MAX')!.basis).toBe(
      'setting',
    );
  });

  it('without an intake (targets only) it reports the setting-based flags', () => {
    const { targets, flags } = dayOf({ sodiumMax: 1400 });
    const f = computeFlags({
      profile: maintainM,
      targets,
      settingFlags: flags,
    });
    expect(codes(f)).toContain('LOW_SODIUM');
    expect(codes(f)).not.toContain('HIGH_CHOLESTEROL');
  });
});

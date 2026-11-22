// The DB checks styles against a hard-coded list (styles <@ array[...]). A style added to the app but not to
// the migration would make every save with that style fail, so the lists must be the same.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STYLE_ORDER } from '@/lib/ui-labels';
import { DIET_STYLES } from './validate';

const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../supabase/migrations',
);

/** Every `styles <@ array[...]` list in the migrations, in file order. */
function styleArraysInMigrations(): { file: string; values: string[] }[] {
  const out: { file: string; values: string[] }[] = [];
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8');
    for (const m of sql.matchAll(/styles\s*<@\s*array\s*\[([^\]]*)\]/gi))
      out.push({
        file,
        values: [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]),
      });
  }
  return out;
}

describe('styles in supabase/migrations', () => {
  it('finds the style checks (profiles.styles and ingredient_kits.styles)', () => {
    expect(styleArraysInMigrations().length).toBeGreaterThanOrEqual(2);
  });

  it('lists exactly the app DietStyle values, once each', () => {
    const expected = [...DIET_STYLES].sort();
    for (const { file, values } of styleArraysInMigrations()) {
      expect(new Set(values).size, file).toBe(values.length);
      expect([...values].sort(), file).toEqual(expected);
    }
  });

  it('the settings screen offers the same styles', () => {
    expect([...STYLE_ORDER].sort()).toEqual([...DIET_STYLES].sort());
  });
});

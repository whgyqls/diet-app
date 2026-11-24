// The browser bundle (.next/static) must not contain the service-role key or its variable name.
// Run `npm run build` first; without a build the real check is skipped (the scanner itself is always tested).
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** Files under dir that contain any of the needles. */
export function filesContaining(dir: string, needles: string[]): string[] {
  const hits: string[] = [];
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8');
    if (needles.some((n) => text.includes(n))) hits.push(file);
  }
  return hits;
}

describe('filesContaining', () => {
  it('finds a needle in a nested file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'scan-'));
    writeFileSync(path.join(dir, 'a.js'), 'ok');
    expect(filesContaining(dir, ['SECRET'])).toEqual([]);
    writeFileSync(path.join(dir, 'b.js'), 'x SECRET y');
    expect(filesContaining(dir, ['SECRET'])).toEqual([path.join(dir, 'b.js')]);
  });
});

const STATIC = path.join(process.cwd(), '.next/static');
const serviceKeys = ['.env.local', '.env.test.local'].flatMap((f) => {
  const file = path.join(process.cwd(), f);
  if (!existsSync(file)) return [];
  const key = (
    parseEnv(readFileSync(file, 'utf8')) as Record<string, string | undefined>
  ).SUPABASE_SERVICE_ROLE_KEY;
  return key ? [key.trim()] : [];
});

describe('build output', () => {
  it.skipIf(!existsSync(STATIC))(
    '.next/static has no service key value and no SERVICE_ROLE string',
    () => {
      expect(filesContaining(STATIC, ['SERVICE_ROLE', ...serviceKeys])).toEqual(
        [],
      );
    },
  );
});

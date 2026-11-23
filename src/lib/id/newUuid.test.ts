import { describe, expect, it } from 'vitest';
import { isUuid, newUuid, type UuidCrypto } from './newUuid';

const fill = (byte: number): UuidCrypto => ({
  getRandomValues: (a) => a.fill(byte),
});

describe('newUuid', () => {
  it('returns a version 4 UUID (default crypto)', () => {
    const id = newUuid();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('4');
    expect('89ab').toContain(id[19]);
  });

  it('uses randomUUID when the environment has it', () => {
    const c: UuidCrypto = {
      randomUUID: () => 'from-random-uuid',
      getRandomValues: () => {
        throw new Error('must not be called');
      },
    };
    expect(newUuid(c)).toBe('from-random-uuid');
  });

  it('falls back to getRandomValues without randomUUID (plain http)', () => {
    expect(newUuid(fill(0x00))).toBe('00000000-0000-4000-8000-000000000000');
    expect(newUuid(fill(0xff))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(isUuid(newUuid(fill(0x5a)))).toBe(true);
  });

  it('fallback ids are unique', () => {
    const c: UuidCrypto = { getRandomValues: (a) => crypto.getRandomValues(a) };
    const ids = new Set(Array.from({ length: 2000 }, () => newUuid(c)));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(isUuid(id)).toBe(true);
  });

  it('throws when there is no crypto at all', () => {
    expect(() => newUuid(null)).toThrow(/no crypto/);
  });
});

describe('isUuid', () => {
  it('accepts UUIDs, upper or lower case', () => {
    for (const ok of [
      '11111111-1111-4111-8111-111111111111',
      'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
      crypto.randomUUID(),
    ])
      expect(isUuid(ok), ok).toBe(true);
  });

  it('rejects ids of the old kind and anything else', () => {
    for (const bad of [
      'mgx3k2a1b2c3', // the old Date.now().toString(36) ids
      '',
      '11111111-1111-4111-8111-11111111111', // one char short
      '11111111-1111-9111-8111-111111111111', // bad version
      '11111111-1111-4111-c111-111111111111', // bad variant
      '11111111111141118111111111111111', // no dashes
      ' 11111111-1111-4111-8111-111111111111',
      5,
      null,
      undefined,
    ])
      expect(isUuid(bad), String(bad)).toBe(false);
  });
});

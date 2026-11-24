import { describe, expect, it } from 'vitest';
import { claimOwner, parseClaim, serializeClaim } from './legacyClaim';

describe('parseClaim', () => {
  it('reads what serializeClaim wrote', () => {
    expect(parseClaim(serializeClaim({ uid: 'u1', at: 5 }))).toEqual({
      uid: 'u1',
      at: 5,
    });
  });
  it('treats a missing or broken value as "no claim"', () => {
    for (const raw of [
      null,
      '',
      'not json',
      '[]',
      'null',
      '{"uid":"","at":1}',
      '{"uid":"u","at":"x"}',
      '{"uid":"u","at":-1}',
      '{"uid":1,"at":1}',
      '{"at":1}',
    ])
      expect(parseClaim(raw), String(raw)).toBeNull();
  });
});

describe('claimOwner', () => {
  it('none / mine / other', () => {
    expect(claimOwner(null, 'a')).toBe('none');
    expect(claimOwner({ uid: 'a', at: 1 }, 'a')).toBe('mine');
    expect(claimOwner({ uid: 'b', at: 1 }, 'a')).toBe('other');
  });
});

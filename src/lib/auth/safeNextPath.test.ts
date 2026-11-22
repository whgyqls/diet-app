import { describe, expect, it } from 'vitest';
import { DEFAULT_NEXT_PATH, safeNextPath } from './safeNextPath';

describe('safeNextPath', () => {
  it('keeps internal paths, with query and hash', () => {
    for (const ok of [
      '/plan',
      '/select',
      '/',
      '/saved?x=1',
      '/plan#top',
      '/a/b/c',
      '/plan?next=%2Fselect',
    ])
      expect(safeNextPath(ok), ok).toBe(ok);
  });

  it('falls back to /select for empty, missing and non-string values', () => {
    expect(DEFAULT_NEXT_PATH).toBe('/select');
    for (const v of [undefined, null, '', 5 as unknown as string])
      expect(safeNextPath(v)).toBe('/select');
  });

  it('rejects other hosts, schemes and protocol-relative URLs', () => {
    for (const bad of [
      '//evil.com',
      '///evil.com',
      '/\\evil.com',
      '\\\\evil.com',
      'https://evil.com',
      'http://evil.com/plan',
      'javascript:alert(1)',
      'data:text/html,x',
      'evil.com',
      'plan',
      '@evil.com',
    ])
      expect(safeNextPath(bad), bad).toBe('/select');
  });

  it('rejects encoded tricks (one and two rounds of decoding)', () => {
    for (const bad of [
      '/%2Fevil.com',
      '%2F%2Fevil.com',
      '/%5Cevil.com',
      '/%252Fevil.com',
      '/%255Cevil.com',
      '/%2f/evil.com',
      '/%0d%0aSet-Cookie:x=1',
      '/%E0%A4%A',
    ])
      expect(safeNextPath(bad), bad).toBe('/select');
  });

  it('rejects control characters and whitespace anywhere', () => {
    for (const bad of [
      '/plan\nx',
      '/plan\r',
      '/pl an',
      '/plan\t',
      '/plan\u0000',
      '/plan\u007f',
      ' /plan',
    ])
      expect(safeNextPath(bad), bad).toBe('/select');
  });
});

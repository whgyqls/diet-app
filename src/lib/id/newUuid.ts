// Random version 4 UUIDs for rows the client creates itself (ingredient_kits.id, saved_combos.id), so an
// optimistic update keeps its id when the row is stored.
// crypto.randomUUID exists only in secure contexts (https, localhost); the app is also opened over plain http
// on a phone while developing. getRandomValues works there too, so it is the fallback.

/** The two functions of the Web Crypto object this file uses (also what a test can fake). */
export type UuidCrypto = {
  randomUUID?: () => string;
  getRandomValues: (array: Uint8Array) => Uint8Array;
};

const HEX = '0123456789abcdef';

export function newUuid(c: UuidCrypto | null = globalThis.crypto): string {
  if (!c) throw new Error('newUuid: no crypto available in this environment');
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    out += HEX[b[i] >> 4] + HEX[b[i] & 0x0f];
    if (i === 3 || i === 5 || i === 7 || i === 9) out += '-';
  }
  return out;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && UUID_RE.test(v);

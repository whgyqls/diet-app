import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const deleteUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ auth: { admin: { deleteUser } } }),
}));

import { DELETE } from './route';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function req(
  init: { origin?: string | null; body?: unknown; query?: string } = {},
) {
  const headers = new Headers({ host: 'localhost:3006' });
  const origin =
    init.origin === undefined ? 'http://localhost:3006' : init.origin;
  if (origin) headers.set('origin', origin);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`http://localhost:3006/api/account${init.query ?? ''}`, {
    method: 'DELETE',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
// the handler only reads headers, so a plain Request is enough
const call = (r: Request) => DELETE(r as never);

beforeEach(() => {
  getUser.mockReset();
  deleteUser.mockReset();
  deleteUser.mockResolvedValue({ error: null });
});

describe('DELETE /api/account', () => {
  it('401 without a session, and deletes nothing', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await call(req());
    expect(res.status).toBe(401);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('401 when the session is invalid', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error('x') });
    expect((await call(req())).status).toBe(401);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('deletes the signed-in user', async () => {
    getUser.mockResolvedValue({ data: { user: { id: ME } }, error: null });
    const res = await call(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(deleteUser).toHaveBeenCalledWith(ME);
  });

  it('ignores an id in the body and in the query', async () => {
    getUser.mockResolvedValue({ data: { user: { id: ME } }, error: null });
    const res = await call(
      req({
        body: { id: OTHER, userId: OTHER, user_id: OTHER },
        query: `?id=${OTHER}&userId=${OTHER}`,
      }),
    );
    expect(res.status).toBe(200);
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(deleteUser).toHaveBeenCalledWith(ME);
  });

  it('403 for a missing or foreign Origin, before any session check', async () => {
    getUser.mockResolvedValue({ data: { user: { id: ME } }, error: null });
    for (const origin of [null, 'https://evil.example']) {
      expect((await call(req({ origin }))).status).toBe(403);
    }
    expect(getUser).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('500 when the delete fails, with no details', async () => {
    getUser.mockResolvedValue({ data: { user: { id: ME } }, error: null });
    deleteUser.mockResolvedValue({ error: { message: 'secret detail' } });
    const res = await call(req());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });
});

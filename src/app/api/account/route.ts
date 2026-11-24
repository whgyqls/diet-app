// DELETE /api/account: deletes the signed-in user's account and, through ON DELETE CASCADE, all their rows.
// Only the id of the verified session is used. Nothing from the body or the query string is read, so a
// request cannot name another user. Server only.
import { NextResponse, type NextRequest } from 'next/server';
import { isSameOrigin } from '@/lib/account/deleteRequest';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const reply = (status: number, error?: string) =>
  NextResponse.json(error ? { error } : { ok: true }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

export async function DELETE(request: NextRequest) {
  if (!isSameOrigin(request.headers.get('origin'), request.headers.get('host')))
    return reply(403, 'forbidden');

  // getUser() asks the auth server, so a revoked or forged session is refused (getSession() would not).
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return reply(401, 'unauthorized');

  try {
    const { error: deleteError } =
      await createAdminClient().auth.admin.deleteUser(data.user.id);
    if (deleteError) return reply(500, 'delete_failed');
  } catch {
    // not configured, or the key belongs to another project: nothing was deleted
    return reply(500, 'delete_failed');
  }
  return reply(200);
}

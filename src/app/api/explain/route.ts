// POST /api/explain: a short explanation of one recommended combo. Server only. The OpenRouter key and the
// service-role key never reach the browser. The flow and its rules are in src/lib/explain/handler.ts.
import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { isSameOrigin } from '@/lib/account/deleteRequest';
import {
  EXPLAIN_LIMITS,
  FALLBACK_MODELS,
  modelsForRequest,
  pickModel,
} from '@/lib/explain/config';
import { handleExplain, type ExplainDeps } from '@/lib/explain/handler';
import { callOpenRouter } from '@/lib/explain/openrouter';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const model = pickModel(process.env.OPENROUTER_MODEL);
  const deps: ExplainDeps = {
    model,
    now: () => new Date(),
    isSameOrigin,
    getUserId: async () => {
      // getUser() asks the auth server, so a revoked or forged session is refused.
      const { data, error } = await (await createClient()).auth.getUser();
      return error || !data.user ? null : data.user.id;
    },
    hash: (text) => createHash('sha256').update(text).digest('hex'),
    cacheGet: async (hash) => {
      const { data } = await createAdminClient()
        .from('ai_explanations')
        .select('text')
        .eq('combo_hash', hash)
        .maybeSingle();
      return data?.text ?? null;
    },
    cachePut: async (hash, m, text) => {
      // on conflict do nothing: two requests for the same combo may finish together
      await createAdminClient()
        .from('ai_explanations')
        .upsert(
          { combo_hash: hash, model: m, text },
          { onConflict: 'combo_hash', ignoreDuplicates: true },
        );
    },
    consume: async (userId, day) => {
      const { data, error } = await createAdminClient().rpc('ai_try_consume', {
        p_user: userId,
        p_day: day,
        p_user_limit: EXPLAIN_LIMITS.userPerDay,
        p_site_limit: EXPLAIN_LIMITS.sitePerDay,
      });
      if (error) throw new Error('consume_failed');
      return data === true;
    },
    refund: async (userId, day) => {
      const { error } = await createAdminClient().rpc('ai_refund', {
        p_user: userId,
        p_day: day,
      });
      if (error) throw new Error('refund_failed');
    },
    log: (line) => console.warn(line),
    hasFallbackModels: modelsForRequest(model, FALLBACK_MODELS).length > 1,
    call: (input, m, opts) =>
      callOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
        model: m,
        fallbacks: opts?.single ? [] : FALLBACK_MODELS,
        input,
        timeoutMs: opts?.timeoutMs,
      }),
  };
  const { status, body } = await handleExplain(deps, {
    origin: request.headers.get('origin'),
    host: request.headers.get('host'),
    bodyText: await request.text(),
  });
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

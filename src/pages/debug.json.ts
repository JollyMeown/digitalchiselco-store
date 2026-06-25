// TEMPORARY diagnostic endpoint — remove after fixing. Captures the real runtime error.
export const prerender = false;

export async function GET() {
  const out: Record<string, unknown> = {};
  const penv = (globalThis as any).process?.env || {};
  out.env_seen = {
    PUBLIC_SUPABASE_URL: (penv.PUBLIC_SUPABASE_URL || '').slice(0, 32),
    PUBLIC_SUPABASE_ANON_KEY: penv.PUBLIC_SUPABASE_ANON_KEY ? 'present(' + String(penv.PUBLIC_SUPABASE_ANON_KEY).length + ')' : 'MISSING',
    SUPABASE_SERVICE_ROLE_KEY: penv.SUPABASE_SERVICE_ROLE_KEY ? 'present' : 'MISSING',
  };
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const c = createClient(penv.PUBLIC_SUPABASE_URL, penv.PUBLIC_SUPABASE_ANON_KEY);
    const { data, count, error } = await c.from('products').select('id', { count: 'exact' }).limit(1);
    out.query = { count, rows: data?.length ?? null, error: error?.message ?? null };
  } catch (e: any) {
    out.crash = String(e?.stack || e).slice(0, 600);
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { 'content-type': 'application/json' } });
}

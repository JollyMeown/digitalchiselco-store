import { createClient } from '@supabase/supabase-js';

// Fallbacks let the app build/run before Supabase creds are set (queries fail gracefully).
const url = import.meta.env.PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const anon = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
export const isSupabaseConfigured = Boolean(import.meta.env.PUBLIC_SUPABASE_URL);

// Browser/SSR-safe client (respects Row-Level Security).
export const supabase = createClient(url, anon);

// Server-only client with elevated rights — use ONLY in API routes / server code.
export function supabaseAdmin() {
  const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(url, key, { auth: { persistSession: false } });
}

export type LinkStatus = 'certain' | 'likely' | 'review' | 'bundle_manual' | 'verified' | 'broken';

// admin color marker for download-link confidence
export const linkColor: Record<LinkStatus, string> = {
  certain: '#1d9e75',      // green
  verified: '#1d9e75',
  likely: '#ba7517',       // amber
  review: '#e24b4a',       // red
  bundle_manual: '#e24b4a',
  broken: '#e24b4a',
};

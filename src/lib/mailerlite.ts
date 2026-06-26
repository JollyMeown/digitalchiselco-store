// MailerLite v2 API helper.
// Calling subscribe() adds/updates a subscriber and triggers double-opt-in
// when the targeted group has "Send confirmation email" enabled in MailerLite.
//
// Required env vars:
//   MAILERLITE_API_KEY                 — Account API key (Integrations → API)
//   MAILERLITE_FREE_GROUP_ID           — Group for /free signups (free pack delivery)
//   MAILERLITE_MEMBERSHIP_GROUP_ID     — Group for /membership leads (optional; falls back to FREE group)
//
// If MAILERLITE_API_KEY is missing, all calls are no-ops — the storefront keeps
// working and we still persist to Supabase.

function env(name: string): string | undefined {
  return process.env[name] ?? (import.meta as any).env?.[name];
}

const API = 'https://connect.mailerlite.com/api';

type SubscribePayload = {
  email: string;
  name?: string | null;
  fields?: Record<string, string | number | null | undefined>;
  groupId?: string;       // explicit override
  groupKey?: 'free' | 'membership'; // pick the right env var
  source?: string;        // free-tracking only; not sent to MailerLite
};

export function isMailerLiteConfigured(): boolean {
  return !!env('MAILERLITE_API_KEY');
}

export async function subscribe(p: SubscribePayload): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const key = env('MAILERLITE_API_KEY');
  if (!key) {
    return { ok: true, skipped: true, error: 'MAILERLITE_API_KEY not set' };
  }
  // Per-group resolution. Membership only fires if a membership group id is
  // explicitly set — we never fall back to the free-pack group for membership
  // leads (those are handled by a separate system).
  let groupId = p.groupId;
  if (!groupId) {
    if (p.groupKey === 'membership') {
      groupId = env('MAILERLITE_MEMBERSHIP_GROUP_ID');
      if (!groupId) {
        return { ok: true, skipped: true, error: 'no membership group configured — skipping MailerLite' };
      }
    } else {
      groupId = env('MAILERLITE_FREE_GROUP_ID');
    }
  }

  const body: any = {
    email: p.email,
    fields: { ...(p.name ? { name: p.name } : {}), ...(p.fields || {}) },
  };
  if (groupId) body.groups = [groupId];
  // status omitted → MailerLite uses the group's default (which honors confirmation settings)

  try {
    const res = await fetch(`${API}/subscribers`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error('MailerLite subscribe failed:', res.status, text.slice(0, 300));
      return { ok: false, error: `MailerLite ${res.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    console.error('MailerLite subscribe threw:', e);
    return { ok: false, error: e.message || 'network error' };
  }
}

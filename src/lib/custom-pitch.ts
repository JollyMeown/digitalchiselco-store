// Shared by the admin custom-pitch route, the nightly drip and local scripts:
// this week's released designs + the rendered pitch (with the owner's saved
// template override applied).
import type { supabaseAdmin } from './supabase';
import { customDesignPitchEmail, applyOverride, TEMPLATE_HEADINGS, type MiniProduct } from './marketing-emails';

type DB = ReturnType<typeof supabaseAdmin>;

/** This week's released designs (up to 12 shown, true total for the link); the newest six on a quiet week. */
export async function thisWeeksDesigns(db: DB): Promise<{ products: MiniProduct[]; total: number }> {
  const sinceIso = new Date(Date.now() - 7 * 86400000).toISOString();
  const base = () => db.from('products').select('title, slug, price_usd, image_url').eq('active', true)
    .not('slug', 'like', 'gift-card-%').not('image_url', 'is', null);
  const [{ data: fresh }, { count }] = await Promise.all([
    base().gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(12),
    db.from('products').select('id', { count: 'exact', head: true }).eq('active', true).gte('created_at', sinceIso).not('slug', 'like', 'gift-card-%').not('image_url', 'is', null),
  ]);
  if (fresh?.length) return { products: fresh as MiniProduct[], total: count || fresh.length };
  const { data: newest } = await base().order('created_at', { ascending: false }).limit(6);
  return { products: (newest || []) as MiniProduct[], total: (newest || []).length };
}

export async function renderPitch(db: DB, email: string, name?: string | null, note?: string | null) {
  const { products, total } = await thisWeeksDesigns(db);
  const out = customDesignPitchEmail({ email, name, note, products, totalNew: total });
  const { data: ov } = await db.from('email_template_overrides').select('*').eq('kind', 'customPitch').maybeSingle();
  return applyOverride(out, ov as any, email, TEMPLATE_HEADINGS.customPitch);
}

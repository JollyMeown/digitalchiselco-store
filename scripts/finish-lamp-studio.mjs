// Finishes the Vase Lampshade Studio product after the owner uploads the buyer
// ZIP to Google Drive:  node scripts/finish-lamp-studio.mjs "<google-drive-share-link>"
// - attaches the download link
// - flips the product live (active = true)
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const link = process.argv[2];
if (!link || !/^https?:\/\//.test(link)) {
  console.error('Usage: node scripts/finish-lamp-studio.mjs "<google-drive-share-link>"');
  process.exit(1);
}
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: p, error } = await db.from('products').select('id, title, active').eq('slug', 'vase-lampshade-studio').single();
if (error || !p) { console.error('product not found:', error?.message); process.exit(1); }

await db.from('product_downloads').delete().eq('product_id', p.id);
const { error: e1 } = await db.from('product_downloads').insert({
  product_id: p.id,
  download_link: link,
  drive_file_id: (link.match(/\/d\/([^/]+)/) || link.match(/id=([^&]+)/) || [])[1] || null,
  sort_order: 0,
});
if (e1) { console.error('download insert failed:', e1.message); process.exit(1); }
const { error: e2 } = await db.from('products').update({ active: true, link_status: 'certain' }).eq('id', p.id);
if (e2) { console.error('activate failed:', e2.message); process.exit(1); }
console.log('DONE — "%s" is LIVE with its download link.', p.title);

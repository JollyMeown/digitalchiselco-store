import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const url = process.env.PUBLIC_SUPABASE_URL, anon = process.env.PUBLIC_SUPABASE_ANON_KEY, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, svc, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: 'jolly@digitalchiselco.com' });
const pub = createClient(url, anon, { auth: { persistSession: false } });
const { data: s } = await pub.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
const ref = new URL(url).hostname.split('.')[0];
console.log(JSON.stringify({ key: `sb-${ref}-auth-token`, value: JSON.stringify(s.session) }));

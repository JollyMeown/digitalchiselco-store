// Promote / reset the admin Supabase Auth user. Pass the password as a CLI
// argument or via the ADMIN_PASSWORD env var — the script will NOT bake one
// in, since this file lives in a public repo.
//
// Usage:
//   node scripts/create_admin.mjs <newPassword>
//   ADMIN_PASSWORD=<newPassword> node scripts/create_admin.mjs

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const email = process.env.ADMIN_EMAIL || 'jolly@digitalchiselco.com';
const password = process.argv[2] || process.env.ADMIN_PASSWORD;
if (!password || password.length < 12) {
  console.error('✗ Provide a password (12+ chars) as the first CLI arg or via ADMIN_PASSWORD env var.');
  console.error('  Example: node scripts/create_admin.mjs "your-strong-password-here"');
  process.exit(1);
}

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let userId;
const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (error) {
  if (/registered|already/i.test(error.message)) {
    const { data: list } = await db.auth.admin.listUsers();
    userId = list.users.find((u) => u.email === email)?.id;
    if (userId) await db.auth.admin.updateUserById(userId, { password });
    console.log('admin already existed — password reset.');
  } else { throw error; }
} else { userId = data.user.id; }

await db.from('profiles').upsert({ id: userId, email, is_admin: true }, { onConflict: 'id' });
console.log('✓ admin ready:', email, '| id:', userId);
console.log('  (password not echoed — save the one you provided)');

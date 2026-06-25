import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const email = 'jolly@digitalchiselco.com';
const password = process.argv[2] || 'Chisel@Admin#2026';

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
console.log('✓ admin ready:', email, '| id:', userId, '| password:', password);

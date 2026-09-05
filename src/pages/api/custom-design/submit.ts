// Public: submit a custom design request from /custom-design. The picture
// arrives as a data URL and is stored through the service role (no public
// write policy). The requester gets a confirmation email, the owner gets an
// owner_alert + Telegram + email with the picture. Rate limited per IP.
import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../../../lib/supabase';
import { rateLimit, clientIp, tooMany } from '../../../lib/rate-limit';
import { send as sendEmail } from '../../../lib/resend';
import { telegramOwner } from '../../../lib/notify';
import { customRequestReceivedEmail } from '../../../lib/marketing-emails';

export const prerender = false;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const OWNER_INBOX = 'jolly@digitalchiselco.com';
const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export const POST: APIRoute = async ({ request }) => {
  try {
    if (!(await rateLimit(`cdreq:${clientIp(request)}`, 4, 3600))) return tooMany('Too many requests from this connection, please try again in an hour.');
    const b = await request.json().catch(() => ({}));
    const name = String(b.name || '').trim().slice(0, 80) || null;
    const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
    const description = String(b.description || '').trim().slice(0, 2000) || null;
    const size_note = String(b.size || '').trim().slice(0, 120) || null;
    const material = String(b.material || '').trim().slice(0, 80) || null;
    const deadline = String(b.deadline || '').trim().slice(0, 80) || null;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Please enter a valid email so we can send the quote.' }, 400);
    if (!description || description.length < 10) return json({ error: 'Tell us a little about the design (a sentence or two).' }, 400);
    if (typeof b.website === 'string' && b.website.trim()) return json({ ok: true, id: 'ok' });   // honeypot

    const db = supabaseAdmin();
    let photo_url: string | null = null;
    const photo = typeof b.image === 'string' ? b.image : '';
    if (photo.startsWith('data:')) {
      const m = photo.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!m) return json({ error: 'Please upload a JPG, PNG or WebP picture.' }, 400);
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 8 * 1024 * 1024) return json({ error: 'The picture is over 8MB, please send a smaller one.' }, 400);
      const path = `custom-requests/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${EXT[m[1]] || 'jpg'}`;
      const up = await db.storage.from('site-media').upload(path, buf, { contentType: m[1], upsert: false });
      if (up.error) return json({ error: 'The picture could not be stored, please try again.' }, 500);
      photo_url = db.storage.from('site-media').getPublicUrl(path).data.publicUrl;
    } else return json({ error: 'Please add a picture, it is what we model from.' }, 400);

    const { data: row, error } = await db.from('custom_design_requests')
      .insert({ name, email, photo_url, description, size_note, material, deadline, status: 'new', source: 'website' })
      .select('id').single();
    if (error) { console.error('custom request insert failed:', error.message); return json({ error: 'Could not save your request, please try again.' }, 500); }
    const ref = 'CD-' + String(row.id).slice(0, 8).toUpperCase();

    // requester confirmation (transactional)
    const conf = customRequestReceivedEmail({ email, name, photoUrl: photo_url, description, ref });
    await sendEmail({ to: email, subject: conf.subject, html: conf.html, text: conf.text, tags: [{ name: 'kind', value: 'custom-request' }] }).catch(() => null);

    // owner: alert row (admin bell), Telegram, and an email with the picture
    const summary = `${name || email} · ${description.slice(0, 90)}${size_note ? ' · ' + size_note : ''}${material ? ' · ' + material : ''}`;
    await db.from('owner_alerts').insert({ kind: 'custom_request', title: `Custom design request ${ref}`, body: summary, url: '#automations', meta: { id: row.id, email, photo_url } }).then(() => null, () => null);
    await telegramOwner(`🖼 <b>Custom design request</b> ${ref}\n${esc(name || '')} &lt;${esc(email)}&gt;\n${esc(description.slice(0, 300))}\n${size_note ? 'Size: ' + esc(size_note) + '\n' : ''}${material ? 'Material: ' + esc(material) + '\n' : ''}${deadline ? 'Deadline: ' + esc(deadline) + '\n' : ''}Picture: ${photo_url}`).catch(() => null);
    await sendEmail({
      to: OWNER_INBOX, subject: `Custom design request ${ref} from ${name || email}`,
      html: `<p><b>${esc(name || '')}</b> &lt;${esc(email)}&gt;</p><p>${esc(description).replace(/\n/g, '<br>')}</p><p>Size: ${esc(size_note || '-')}<br>Material: ${esc(material || '-')}<br>Deadline: ${esc(deadline || '-')}</p><p><a href="${photo_url}">${photo_url}</a></p><p><img src="${photo_url}" style="max-width:480px;width:100%"></p><p>Reply to the requester at ${esc(email)}. Manage it in Admin &gt; Automations &gt; Custom design.</p>`,
      text: `${name || ''} <${email}>\n${description}\nSize: ${size_note || '-'}\nMaterial: ${material || '-'}\nDeadline: ${deadline || '-'}\n${photo_url}`,
      tags: [{ name: 'kind', value: 'custom-request' }],
    }).catch(() => null);
    return json({ ok: true, id: row.id, ref });
  } catch (e: any) {
    console.error('custom request submit failed:', e);
    return json({ error: 'Could not submit your request, please try again.' }, 500);
  }
};

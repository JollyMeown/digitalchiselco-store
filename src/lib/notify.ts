// Owner notification fan-out. Email alerts already flow through Resend; this
// adds an OPTIONAL Telegram push (100% free — Telegram's Bot API has no fees).
// Setup: create a bot with @BotFather, set TELEGRAM_BOT_TOKEN and
// TELEGRAM_CHAT_ID in Netlify env. Absent env vars = silently skipped, so the
// email path never depends on this.
function env(name: string): string | undefined {
  return process.env[name] ?? (import.meta as any).env?.[name];
}

export async function telegramOwner(text: string): Promise<{ ok: boolean; skipped?: boolean }> {
  const token = env('TELEGRAM_BOT_TOKEN');
  const chatId = env('TELEGRAM_CHAT_ID');
  if (!token || !chatId) return { ok: true, skipped: true };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) console.error('[telegram]', res.status, (await res.text()).slice(0, 200));
    return { ok: res.ok };
  } catch (e: any) {
    console.error('[telegram]', e?.message);
    return { ok: false };
  }
}

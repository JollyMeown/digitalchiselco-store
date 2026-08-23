// Rings the admin whenever money lands, on ANY channel:
//   • website orders  → realtime INSERT on `orders` (since migration 012)
//   • Cults3D sales   → realtime INSERT on `owner_alerts` (migration 061),
//                       written by the 10-minute Cults poller / admin refresh
// Plus a 20 s polling fallback on owner_alerts (max id) in case realtime is
// unavailable, so a sale can never ring silently. Also shows a toast with the
// design + country + amount and (if permitted) a desktop notification, so a
// sale is noticed even when the tab is in the background.
// Toggle + volume live in site_settings (Settings tab).
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

// Notification sound — the "cha-ching" served from /public.
const SOUND_URL = '/sounds/cha-ching.mp3';

type Toast = { id: string; icon: string; title: string; body?: string; url?: string; at: number };

export default function OrderSoundListener() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const settingsRef = useRef<{ enabled: boolean; volume: number }>({ enabled: true, volume: 80 });
  const lastAlertId = useRef<number | null>(null);
  const seenAlerts = useRef<Set<number>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);

  function pushToast(t: Omit<Toast, 'at'>) {
    setToasts((list) => [...list.filter((x) => x.id !== t.id), { ...t, at: Date.now() }].slice(-4));
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), 15000);
  }

  function desktopNotify(title: string, body?: string, url?: string) {
    try {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const n = new Notification(title, { body, icon: '/favicon.svg', tag: title + body });
      if (url) n.onclick = () => { window.open(url, '_blank'); n.close(); };
    } catch { /* ignore */ }
  }

  function onOwnerAlert(a: any) {
    const id = Number(a.id);
    if (!id || seenAlerts.current.has(id)) return;
    seenAlerts.current.add(id);
    if (lastAlertId.current == null || id > lastAlertId.current) lastAlertId.current = id;
    if (a.kind === 'website_order') return; // already rung via the `orders` insert
    const icon = a.kind === 'cults_sale' ? '💶' : a.kind === 'website_order' ? '🛒' : '🔔';
    playChime();
    pushToast({ id: 'alert-' + id, icon, title: a.title, body: a.body, url: a.url });
    desktopNotify(`${icon} ${a.title}`, a.body, a.url);
    // A sale should also be visible in the tab strip.
    try { document.title = `${icon} ${a.title} · ${document.title.replace(/^(💶|🛒|🔔) .*? · /, '')}`; setTimeout(() => { document.title = document.title.replace(/^(💶|🛒|🔔) .*? · /, ''); }, 60000); } catch {}
  }

  useEffect(() => {
    // Load admin sound preferences once. We re-poll occasionally so toggling
    // in Settings takes effect without a page reload.
    let cancelled = false;
    async function loadPrefs() {
      const { data } = await supabase.from('site_settings').select('order_sound_enabled,order_sound_volume').eq('id', 1).maybeSingle();
      if (!cancelled && data) settingsRef.current = { enabled: data.order_sound_enabled ?? true, volume: Math.min(100, Math.max(0, Number(data.order_sound_volume) || 80)) };
    }
    loadPrefs();
    const t = setInterval(loadPrefs, 20000);

    // Baseline: remember the newest alert id at load so history never rings.
    (async () => {
      const { data } = await supabase.from('owner_alerts').select('id').order('id', { ascending: false }).limit(1);
      if (!cancelled) lastAlertId.current = Number(data?.[0]?.id || 0);
    })();

    // Realtime: website orders (existing) + owner_alerts (Cults sales etc.)
    const ch = supabase
      .channel('admin-sales')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload: any) => {
        const o = payload?.new || {};
        playChime();
        pushToast({ id: 'order-' + (o.id || Date.now()), icon: '🛒', title: `New website order${o.total ? `: $${Number(o.total).toFixed(2)}` : ''}`, body: o.email || undefined, url: '#orders' });
        desktopNotify('🛒 New website order', o.total ? `$${Number(o.total).toFixed(2)} ${o.email || ''}` : o.email);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'owner_alerts' }, (payload: any) => onOwnerAlert(payload?.new || {}))
      .subscribe();

    // Polling fallback (20 s): anything newer than the last id we handled.
    const poll = setInterval(async () => {
      if (cancelled || lastAlertId.current == null || document.visibilityState === 'hidden') return;
      const { data } = await supabase.from('owner_alerts').select('id,kind,title,body,url').gt('id', lastAlertId.current).order('id', { ascending: true }).limit(10);
      for (const a of data || []) onOwnerAlert(a);
    }, 20000);

    return () => { cancelled = true; clearInterval(t); clearInterval(poll); supabase.removeChannel(ch); };
  }, []);

  function playChime() {
    if (!settingsRef.current.enabled) return;
    try {
      const a = audioRef.current || (audioRef.current = new Audio(SOUND_URL));
      a.volume = Math.min(1, Math.max(0, settingsRef.current.volume / 100));
      a.currentTime = 0;
      // Browsers block audio until the admin has interacted with the page
      // (clicking the "Test chime" button, navigating tabs, etc. unlocks it).
      a.play().catch(() => {});
    } catch (e) { console.warn('chime failed', e); }
  }

  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end" role="status" aria-live="polite">
      {toasts.map((t) => (
        <a key={t.id} href={t.url || '#'} target={t.url?.startsWith('http') ? '_blank' : undefined} rel="noreferrer"
          className="block max-w-sm bg-bronze-600 text-cream text-sm px-4 py-3 rounded-xl shadow-2xl animate-pulse hover:animate-none border border-cream/20">
          <div className="font-bold leading-tight">{t.icon} {t.title}</div>
          {t.body && <div className="text-xs opacity-90 mt-0.5">{t.body}</div>}
        </a>
      ))}
    </div>
  );
}

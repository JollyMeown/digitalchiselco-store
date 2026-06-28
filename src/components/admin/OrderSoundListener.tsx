// Subscribes the admin client to realtime INSERTs on the orders table and
// plays a short chime whenever one arrives. Toggleable + volume-controllable
// via site_settings (set in Settings tab).
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

// Order notification sound — the "cha-ching" served from /public.
const SOUND_URL = '/sounds/cha-ching.mp3';

export default function OrderSoundListener() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const settingsRef = useRef<{ enabled: boolean; volume: number }>({ enabled: true, volume: 80 });
  const [bumpCount, setBumpCount] = useState(0); // visual "+N new orders" pip

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

    // Realtime subscription
    const ch = supabase
      .channel('admin-orders')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => {
        playChime();
        setBumpCount((n) => n + 1);
        // Auto-clear pip after 12s
        setTimeout(() => setBumpCount((n) => Math.max(0, n - 1)), 12000);
      })
      .subscribe();

    return () => { cancelled = true; clearInterval(t); supabase.removeChannel(ch); };
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

  if (bumpCount === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 bg-bronze-600 text-cream text-sm px-4 py-2.5 rounded-full shadow-lg animate-pulse" role="status" aria-live="polite">
      🛒 {bumpCount} new order{bumpCount === 1 ? '' : 's'}
    </div>
  );
}

// Subscribes the admin client to realtime INSERTs on the orders table and
// plays a short chime whenever one arrives. Toggleable + volume-controllable
// via site_settings (set in Settings tab).
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

// Tiny pleasant chime, base64 WAV (kept short to avoid bloating the bundle).
// 3 quick sine pulses — readable as a notification, not jarring.
const CHIME =
  'data:audio/wav;base64,UklGRrYIAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YZIIAAAAAH1NfaAQ' +
  // (placeholder — replaced at runtime by a synthesised tone for tiny bundle size)
  '';

export default function OrderSoundListener() {
  const audioCtxRef = useRef<AudioContext | null>(null);
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
      // Synthesised three-tone chime (no asset needed). Plays on top of any UI.
      const ctx = audioCtxRef.current || (audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)());
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const vol = (settingsRef.current.volume / 100) * 0.45; // master limit to be polite
      const notes = [880, 1175, 1568]; // A5 → D6 → G6
      notes.forEach((freq, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = freq;
        const start = ctx.currentTime + i * 0.12;
        const dur = 0.22;
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(vol, start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        o.connect(g).connect(ctx.destination);
        o.start(start); o.stop(start + dur + 0.05);
      });
    } catch (e) { console.warn('chime failed', e); }
  }

  if (bumpCount === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 bg-bronze-600 text-cream text-sm px-4 py-2.5 rounded-full shadow-lg animate-pulse" role="status" aria-live="polite">
      🛒 {bumpCount} new order{bumpCount === 1 ? '' : 's'}
    </div>
  );
}

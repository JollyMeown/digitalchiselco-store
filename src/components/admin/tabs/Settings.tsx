import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { MARQUEE_DEFAULTS } from '../../../lib/queries';
import { Card, btnGhost, btnPrimary, inputCls, labelCls } from '../ui';

const MARQUEE_SECTIONS: [string, string][] = [
  ['collections', 'Shop by Collection'],
  ['bestsellers', 'Best Sellers'],
  ['premium', 'Premium Bundles'],
  ['madeforyou', 'Made for You'],
  ['reviews', 'Loved by Makers'],
];

const fields: [string, string, string?][] = [
  ['donation_total', 'Donation total ($)', 'Shown on homepage + footer charity counter'],
  ['discount_percent', 'Site-wide discount %', 'Strike-through price = price ÷ (1 − discount%)'],
  ['rating', 'Star rating'],
  ['reviews_count', 'Number of reviews'],
  ['sales_count', 'Number of sales'],
  ['products_count', 'Number of products'],
  ['admirers_count', 'Admirers'],
  ['experience_years', 'Years of experience'],
  ['admin_email', 'Admin contact email'],
];

export default function Settings() {
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    supabase.from('site_settings').select('*').eq('id', 1).maybeSingle().then(({ data }) => setS(data));
  }, []);

  async function save() {
    setMsg('Saving…');
    const payload = { ...s };
    delete payload.updated_at;
    const { error } = await supabase.from('site_settings').update(payload).eq('id', 1);
    setMsg(error ? 'Error: ' + error.message : '✓ Saved — live on the site.');
  }

  function testChime() {
    try {
      const ctx = audioCtxRef.current || (audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)());
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const volPct = Math.min(100, Math.max(0, Number(s.order_sound_volume) || 80));
      const vol = (volPct / 100) * 0.45;
      [880, 1175, 1568].forEach((freq, i) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = freq;
        const start = ctx.currentTime + i * 0.12; const dur = 0.22;
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(vol, start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        o.connect(g).connect(ctx.destination); o.start(start); o.stop(start + dur + 0.05);
      });
    } catch {}
  }

  // Read/merge a marquee section's settings with defaults.
  const mget = (k: string) => ({ ...(MARQUEE_DEFAULTS as any)[k], ...((s?.marquee_settings || {})[k] || {}) });
  function mset(k: string, field: string, value: any) {
    setS((prev: any) => ({
      ...prev,
      marquee_settings: {
        ...MARQUEE_DEFAULTS,
        ...(prev.marquee_settings || {}),
        [k]: { ...(MARQUEE_DEFAULTS as any)[k], ...((prev.marquee_settings || {})[k] || {}), [field]: value },
      },
    }));
  }

  if (!s) return <div className="text-sm text-ink-700/60">Loading…</div>;
  const vol = Math.min(100, Math.max(0, Number(s.order_sound_volume) || 80));
  return (
    <div className="space-y-5">
      <Card title="Site settings & stats">
        <p className="text-xs text-ink-700/60 mb-4">These drive the homepage stats, the charity counter, and the global discount % shown across the storefront.</p>
        <div className="grid md:grid-cols-3 gap-3">
          {fields.map(([k, label, hint]) => (
            <label key={k} className="block">
              <span className={labelCls}>{label}</span>
              <input value={s[k] ?? ''} onChange={(e) => setS({ ...s, [k]: e.target.value })} className={inputCls} />
              {hint && <span className="text-[11px] text-ink-700/50">{hint}</span>}
            </label>
          ))}
        </div>
      </Card>

      <Card title="🔔 Order sound notifications">
        <p className="text-xs text-ink-700/60 mb-3">When a new order lands while you're in the admin, play a short chime. Browser tab must be open for the sound to play.</p>
        <div className="grid md:grid-cols-3 gap-4 items-end">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!s.order_sound_enabled} onChange={(e) => setS({ ...s, order_sound_enabled: e.target.checked })} />
            Play sound on new order
          </label>
          <div>
            <label className={labelCls}>Volume: <span className="font-mono text-bronze-700">{vol}%</span></label>
            <input type="range" min="0" max="100" value={vol}
              onChange={(e) => setS({ ...s, order_sound_volume: Number(e.target.value) })}
              className="w-full accent-bronze-600" />
            <div className="text-[10px] text-ink-700/50 flex justify-between"><span>silent</span><span>loud</span></div>
          </div>
          <div>
            <button className={btnGhost} onClick={testChime}>▶ Test chime</button>
            <p className="text-[11px] text-ink-700/50 mt-1">Browsers require a click to enable audio — that's why this test button exists.</p>
          </div>
        </div>
      </Card>

      <Card title="🎞 Homepage motion (sliders)">
        <p className="text-xs text-ink-700/60 mb-3">Control each scrolling row on the homepage: turn motion on or off, set the speed (lower seconds = faster), and pick the scroll direction. Hover always pauses for visitors.</p>
        <div className="space-y-3">
          {MARQUEE_SECTIONS.map(([key, label]) => {
            const m = mget(key);
            return (
              <div key={key} className="grid sm:grid-cols-[180px_1fr_auto] gap-3 items-center border-t border-black/5 pt-3">
                <label className="flex items-center gap-2 text-sm font-medium text-ink-800">
                  <input type="checkbox" checked={!!m.enabled} onChange={(e) => mset(key, 'enabled', e.target.checked)} />
                  {label}
                </label>
                <div className={m.enabled ? '' : 'opacity-40 pointer-events-none'}>
                  <div className="text-[11px] text-ink-700/60 flex justify-between">
                    <span>Speed: <span className="font-mono text-bronze-700">{m.speed}s/loop</span></span>
                    <span>{m.speed <= 30 ? 'fast' : m.speed >= 90 ? 'slow' : 'medium'}</span>
                  </div>
                  <input type="range" min="10" max="150" step="5" value={m.speed}
                    onChange={(e) => mset(key, 'speed', Number(e.target.value))} className="w-full accent-bronze-600" />
                </div>
                <div className={'flex gap-1 ' + (m.enabled ? '' : 'opacity-40 pointer-events-none')}>
                  {(['left', 'right'] as const).map((dir) => (
                    <button key={dir} type="button" onClick={() => mset(key, 'direction', dir)}
                      className={`px-3 py-1.5 text-xs rounded-md border ${m.direction === dir ? 'bg-bronze-600 text-cream border-bronze-600' : 'border-black/15 hover:bg-cream'}`}>
                      {dir === 'left' ? '← Left' : 'Right →'}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-ink-700/50 mt-3">Tip: "Made for You" is off by default (it shows a centered grid). Turn it on to make it scroll too.</p>
      </Card>

      <div className="flex items-center gap-3">
        <button className={btnPrimary} onClick={save}>Save all changes</button>
        <span className={'text-xs ' + (msg.startsWith('✓') ? 'text-green-700' : msg.startsWith('Error') ? 'text-red-600' : 'text-ink-700/60')}>{msg}</span>
      </div>
    </div>
  );
}

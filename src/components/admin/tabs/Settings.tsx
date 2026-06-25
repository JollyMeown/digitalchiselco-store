import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, btnPrimary, inputCls, labelCls } from '../ui';

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

  if (!s) return <div className="text-sm text-ink-700/60">Loading…</div>;
  return (
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
      <div className="mt-5 flex items-center gap-3 border-t border-black/10 pt-4">
        <button className={btnPrimary} onClick={save}>Save changes</button>
        <span className={'text-xs ' + (msg.startsWith('✓') ? 'text-green-700' : msg.startsWith('Error') ? 'text-red-600' : 'text-ink-700/60')}>{msg}</span>
      </div>
    </Card>
  );
}

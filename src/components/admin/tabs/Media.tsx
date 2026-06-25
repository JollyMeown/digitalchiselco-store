import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, btnPrimary, inputCls, labelCls } from '../ui';
import ImageUpload from '../ImageUpload';

export default function Media() {
  const [s, setS] = useState<any>(null);
  const [cats, setCats] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [products, setProducts] = useState<any[]>([]);

  useEffect(() => { load(); }, []);
  async function load() {
    const [{ data: ss }, { data: cs }, { data: ps }] = await Promise.all([
      supabase.from('site_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('categories').select('id,name,slug,image_url,sort_order').order('sort_order').order('name'),
      supabase.from('products').select('id,title,image_url').eq('active', true).not('image_url', 'is', null).limit(60),
    ]);
    setS(ss); setCats(cs ?? []); setProducts(ps ?? []);
  }

  async function saveHero() {
    setMsg('Saving…');
    const { error } = await supabase.from('site_settings').update({
      hero_image_url: s.hero_image_url || null,
      hero_headline: s.hero_headline || null,
      hero_subhead: s.hero_subhead || null,
      featured_product_id: s.featured_product_id || null,
    }).eq('id', 1);
    setMsg(error ? 'Error: ' + error.message : '✓ Hero saved');
  }
  async function saveCategoryImage(id: string, url: string) {
    const { error } = await supabase.from('categories').update({ image_url: url || null }).eq('id', id);
    if (error) alert(error.message);
    else setCats((c) => c.map((x) => x.id === id ? { ...x, image_url: url } : x));
  }

  if (!s) return <div className="text-sm text-ink-700/60">Loading…</div>;

  return (
    <div className="space-y-5">
      <Card title="Homepage hero">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Headline</label>
              <input value={s.hero_headline || ''} onChange={(e) => setS({ ...s, hero_headline: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Subhead</label>
              <textarea value={s.hero_subhead || ''} onChange={(e) => setS({ ...s, hero_subhead: e.target.value })} rows={3} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Featured product <span className="text-ink-700/40">(fallback hero image)</span></label>
              <select value={s.featured_product_id || ''} onChange={(e) => setS({ ...s, featured_product_id: e.target.value || null })} className={inputCls}>
                <option value="">— None / use first available —</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.title.slice(0, 60)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Hero image <span className="text-ink-700/40">(overrides featured product image)</span></label>
            <ImageUpload value={s.hero_image_url} onChange={(url) => setS({ ...s, hero_image_url: url })} folder="hero" />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3 border-t border-black/10 pt-4">
          <button className={btnPrimary} onClick={saveHero}>Save hero</button>
          <span className={'text-xs ' + (msg.startsWith('✓') ? 'text-green-700' : msg.startsWith('Error') ? 'text-red-600' : 'text-ink-700/60')}>{msg}</span>
        </div>
      </Card>

      <Card title="Category images">
        <p className="text-xs text-ink-700/60 mb-3">Each collection page uses its image on listings + collection cards. Upload from your computer or paste a URL.</p>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
          {cats.map((c) => (
            <div key={c.id} className="border border-black/10 rounded-lg p-3">
              <div className="text-sm font-medium mb-2">{c.name}</div>
              <ImageUpload value={c.image_url} onChange={(url) => saveCategoryImage(c.id, url)} folder="categories" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

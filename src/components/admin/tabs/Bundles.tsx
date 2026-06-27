// Bundle Composer — assemble a "bundle" product from existing products.
// Auto-pulls the first image from each source product into the bundle gallery,
// auto-aggregates their Drive download links, and lets the admin override the
// hero image, title, and description. Export button generates a CSV with the
// bundle info + every member product + its download link.
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnDanger, btnPrimary, inputCls, labelCls, Toast } from '../ui';
import ImageUpload from '../ImageUpload';
import ProductSearchPicker, { type PickerProduct } from '../ProductSearchPicker';

type SourceProduct = { id: string; title: string; slug: string; image_url: string | null; price_usd: number };
type BundleRow = {
  id: string; title: string; slug: string; price_usd: number; image_url: string | null;
  description: string | null; active: boolean;
  bundle_items: { source_product_id: string; sort_order: number; products: SourceProduct | null }[];
  product_downloads?: { download_link: string }[];
};

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

export default function Bundles() {
  const [bundles, setBundles] = useState<BundleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<BundleRow | 'new' | null>(null);

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    // bundle_items has two FKs to products (bundle_product_id, source_product_id),
    // so Supabase needs explicit hints to disambiguate the join. We use the
    // bundle side as the outer link and the source side as the nested embed.
    // bundle_items has two FKs to products (bundle_product_id, source_product_id),
    // so Supabase needs explicit hints to disambiguate the join. We use the
    // bundle side as the outer link and the source side as the nested embed.
    // (We no longer pre-fetch all candidate products here — the picker
    // searches the catalog server-side as the user types.)
    const { data: bs, error: bErr } = await supabase.from('products')
      .select(
        'id,title,slug,price_usd,image_url,description,active,' +
        'bundle_items!bundle_items_bundle_product_id_fkey(source_product_id,sort_order,products:source_product_id(id,title,slug,image_url,price_usd)),' +
        'product_downloads(download_link)'
      )
      .eq('is_bundle', true).order('created_at', { ascending: false });
    if (bErr) console.error('Bundles load failed:', bErr);
    (bs || []).forEach((b: any) => { b.bundle_items = b.bundle_items || []; });
    setBundles((bs ?? []) as any);
    setLoading(false);
  }

  async function del(b: BundleRow) {
    if (!confirm(`Delete bundle "${b.title}"? This removes the bundle product and its composition.`)) return;
    await supabase.from('products').delete().eq('id', b.id);
    load();
  }

  // Toggle the is_bundle flag off — "un-bundles" a product back to a regular
  // catalog item. Useful when a product was wrongly classified as a bundle.
  // We don't delete it; the product just disappears from Bundle Composer's
  // list and re-appears in the regular Products tab.
  async function unbundle(b: BundleRow) {
    if (!confirm(`Mark "${b.title}" as a regular product?\n\nIt will be removed from the Bundle Composer (and from the PREMIUM BUNDLES section) but kept in the catalog. Its bundle composition will be deleted; the product itself stays.`)) return;
    // Wipe bundle_items first so the product can later be re-bundled cleanly.
    await supabase.from('bundle_items').delete().eq('bundle_product_id', b.id);
    const { error } = await supabase.from('products').update({ is_bundle: false }).eq('id', b.id);
    if (error) { alert('Failed: ' + error.message); return; }
    load();
  }

  function exportCsv(b: BundleRow) {
    const items = (b.bundle_items || []).sort((a, c) => a.sort_order - c.sort_order);
    const head = 'bundle_title,bundle_slug,bundle_price_usd,item_position,item_title,item_slug,item_price_usd\n';
    const lines = items.map((it, i) => {
      const p = it.products;
      return [b.title, b.slug, b.price_usd, i + 1, p?.title || '', p?.slug || '', p?.price_usd ?? ''].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
    });
    download(`${b.slug}.csv`, head + lines.join('\n'));
  }

  // Export bundle info + every member's full Drive download link. Drive links
  // live in product_downloads (server-only RLS), so we fetch them via the
  // service role through the existing admin path: select via supabase using the
  // logged-in admin session (is_admin policy allows it).
  async function exportFullManifest(b: BundleRow) {
    const items = (b.bundle_items || []).sort((a, c) => a.sort_order - c.sort_order);
    const ids = items.map((it) => it.source_product_id);
    if (!ids.length) { alert('This bundle has no items.'); return; }
    const { data: dls } = await supabase.from('product_downloads').select('product_id,download_link,file_name').in('product_id', ids);
    const byProduct: Record<string, string[]> = {};
    (dls ?? []).forEach((d: any) => { (byProduct[d.product_id] ||= []).push(d.download_link); });
    const head = 'bundle_title,bundle_slug,item_position,product_title,product_slug,drive_download_link\n';
    const lines: string[] = [];
    items.forEach((it, i) => {
      const p = it.products;
      const links = byProduct[it.source_product_id] || [''];
      links.forEach((link) => {
        lines.push([b.title, b.slug, i + 1, p?.title || '', p?.slug || '', link].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
      });
    });
    download(`${b.slug}-manifest.csv`, head + lines.join('\n'));
  }

  function download(name: string, body: string) {
    const blob = new Blob([body], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  }

  // Fetch a tiny JSON manifest from the server (admin-auth required for the
  // Drive URLs), then build the ZIP in the browser. Earlier server-side
  // packaging tripped Netlify's "usage_exceeded" because images were being
  // proxied through the function.
  async function downloadZip(b: BundleRow) {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { alert('Sign in expired — refresh the page.'); return; }

    const res = await fetch(`/api/admin/bundle-zip?id=${encodeURIComponent(b.id)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      let msg = 'Could not load bundle manifest.';
      try { msg = (await res.json()).error || msg; } catch {}
      alert(msg); return;
    }
    const m = await res.json();
    const safe = (s: string) => String(s || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 120);
    const folder = safe(m.slug || m.id || 'bundle');

    const { ZipBuilderBrowser } = await import('../../../lib/zip-browser');
    const zip = new ZipBuilderBrowser();

    // 1) gallery images — fetched directly from public Supabase Storage URLs
    const allImages: string[] = [];
    if (m.image_url && !m.gallery.includes(m.image_url)) allImages.push(m.image_url);
    allImages.push(...m.gallery);
    let okImgs = 0, failedImgs = 0;
    for (let i = 0; i < allImages.length; i++) {
      const url = allImages[i];
      try {
        const r = await fetch(url, { credentials: 'omit' });
        if (!r.ok) { failedImgs++; continue; }
        const buf = new Uint8Array(await r.arrayBuffer());
        const extMatch = url.match(/\.([a-z0-9]{2,5})(?:\?|#|$)/i);
        const ext = (extMatch?.[1] || 'jpg').toLowerCase();
        zip.add(`${folder}/images/${String(i + 1).padStart(2, '0')}.${ext}`, buf);
        okImgs++;
      } catch { failedImgs++; }
    }

    // 2) README.txt
    const lines: string[] = [];
    lines.push(`Bundle: ${m.title}`);
    lines.push(`Slug:   ${m.slug}`);
    lines.push(`Price:  $${Number(m.price_usd).toFixed(2)} USD`);
    lines.push(`Items:  ${m.items.length}`);
    lines.push(`Images: ${okImgs}${failedImgs ? ` (${failedImgs} failed to fetch)` : ''}`);
    lines.push('');
    lines.push('Description');
    lines.push('-----------');
    lines.push(m.description || '(no description)');
    lines.push('');
    lines.push('Source products');
    lines.push('---------------');
    (m.items || []).forEach((it: any, i: number) => {
      const p = it.product;
      lines.push(`${i + 1}. ${p?.title || '(unknown)'} — $${Number(p?.price_usd || 0).toFixed(2)}`);
      lines.push(`   slug: ${p?.slug || ''}`);
      const ls = (p?.drive_links || []) as { name?: string | null; url: string }[];
      if (ls.length === 0) lines.push('   drive: (no link attached)');
      else ls.forEach((l) => lines.push(`   drive: ${l.url}`));
      lines.push('');
    });
    if ((m.bundle_downloads || []).length) {
      lines.push('Direct bundle download URLs');
      lines.push('---------------------------');
      for (const d of m.bundle_downloads) lines.push(`- ${d.url}`);
      lines.push('');
    }
    zip.add(`${folder}/README.txt`, lines.join('\r\n'));

    // 3) manifest.json
    zip.add(`${folder}/manifest.json`, JSON.stringify(m, null, 2));

    // 4) drive-urls.tsv
    const driveLines: string[] = [];
    (m.items || []).forEach((it: any) => {
      const p = it.product;
      const ls = (p?.drive_links || []) as { url: string }[];
      for (const l of ls) driveLines.push(`${p?.title || ''}\t${l.url}`);
    });
    zip.add(`${folder}/drive-urls.tsv`, driveLines.join('\r\n') || '(no Drive URLs attached)');

    const blob = zip.build();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${folder}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm">Compose multi-product bundles. Pick source products from any category, and the bundle automatically inherits their first image (as gallery) and Drive download links. You can override the hero image, title, and description.</p>
          </div>
          <button onClick={() => setOpen('new')} className={btnPrimary}>+ New bundle</button>
        </div>
      </Card>

      {/* Heads-up if any bundle has no source mapping (e.g. legacy Etsy-imported bundles) */}
      {bundles.some((b) => !(b.bundle_items || []).length) && (
        <Card>
          <div className="flex items-start gap-3">
            <div className="text-2xl flex-shrink-0" aria-hidden="true">🔗</div>
            <div className="flex-1">
              <p className="text-sm font-medium text-ink-800">{bundles.filter((b) => !(b.bundle_items || []).length).length} bundle{bundles.filter((b) => !(b.bundle_items || []).length).length === 1 ? '' : 's'} need source products attached</p>
              <p className="text-xs text-ink-700/70 mt-1">Legacy bundles (imported from Etsy before the Bundle Composer existed) have no source products yet — so customers won't receive any Drive download links. Click <strong>Edit</strong> on each row marked <code>0 items</code> and tick the products that belong in that bundle.</p>
            </div>
          </div>
        </Card>
      )}

      {loading ? <div className="text-sm text-ink-700/60">Loading…</div> : (
        <div className="bg-white border border-black/10 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-700/60 text-left bg-cream/40">
              <tr>
                <th className="p-2 w-14 text-center" title="Include as bundle">Bundle?</th>
                <th className="p-2">Bundle</th>
                <th className="p-2">Items</th>
                <th className="p-2">Price</th>
                <th className="p-2">Slug</th>
                <th className="p-2">Status</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bundles.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-ink-700/60 text-sm">No bundles yet. Click "+ New bundle" to compose one.</td></tr>
              ) : bundles.map((b) => (
                <tr key={b.id} className="border-t border-black/5">
                  <td className="p-2 text-center">
                    <input type="checkbox" checked={true}
                      title="Uncheck to mark this as a regular product (no longer a bundle)."
                      onChange={() => unbundle(b)}
                      className="accent-bronze-600" />
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      {b.image_url && <img src={b.image_url} alt="" className="w-10 h-10 rounded object-cover" />}
                      <span>{b.title}</span>
                    </div>
                  </td>
                  <td className="p-2">{(b.bundle_items || []).length === 0
                    ? <span className="text-red-600 font-medium">0 ⚠</span>
                    : (b.bundle_items || []).length}</td>
                  <td className="p-2">${Number(b.price_usd).toFixed(2)}</td>
                  <td className="p-2 text-xs text-ink-700/60">{b.slug}</td>
                  <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded ${b.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>{b.active ? 'active' : 'inactive'}</span></td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <button className={btnGhost} onClick={() => setOpen(b)}>Edit</button>
                    <button className={btnGhost + ' ml-1'} onClick={() => downloadZip(b)} title="Download ZIP with images, manifest and Drive URLs">ZIP</button>
                    <button className={btnGhost + ' ml-1'} onClick={() => exportCsv(b)}>CSV</button>
                    <button className={btnGhost + ' ml-1'} onClick={() => exportFullManifest(b)} title="Includes Drive download links">Manifest</button>
                    <a className={btnGhost + ' ml-1'} href={`/product/${b.slug}`} target="_blank">View ↗</a>
                    <button className={btnDanger + ' ml-1'} onClick={() => del(b)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open === 'new' ? 'New bundle' : open ? `Edit: ${(open as BundleRow).title}` : ''} wide>
        {open && <BundleForm bundle={open === 'new' ? null : (open as BundleRow)} onDone={() => { setOpen(null); load(); }} />}
      </Modal>
    </div>
  );
}

function BundleForm({ bundle, onDone }: { bundle: BundleRow | null; onDone: () => void }) {
  const [title, setTitle] = useState(bundle?.title || '');
  const [slug, setSlug] = useState(bundle?.slug || '');
  const [price, setPrice] = useState<number | string>(bundle?.price_usd ?? '');
  const [description, setDescription] = useState(bundle?.description || '');
  const [heroImage, setHeroImage] = useState(bundle?.image_url || '');
  const [pickedIds, setPickedIds] = useState<string[]>(() =>
    (bundle?.bundle_items || []).sort((a, b) => a.sort_order - b.sort_order).map((it) => it.source_product_id)
  );
  // External Drive URL — saved when the bundle has no source products (e.g. a
  // single pre-packaged ZIP in Drive). On load, pre-fill from the existing
  // download row if and only if the bundle has no items (so we don't tempt
  // anyone into overwriting an aggregated source list).
  const [externalDownloadUrl, setExternalDownloadUrl] = useState(() => {
    const items = bundle?.bundle_items || [];
    const dls = bundle?.product_downloads || [];
    return items.length === 0 && dls.length > 0 ? dls[0].download_link : '';
  });
  const [active, setActive] = useState(bundle?.active ?? true);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>({ kind: 'info', text: '' });
  const [saving, setSaving] = useState(false);

  // Details for picked products (image, title, price). Seeded from the
  // bundle's source products (when editing) and topped up whenever the user
  // picks a new one from the search picker.
  const [picked, setPicked] = useState<Record<string, PickerProduct>>(() => {
    const seed: Record<string, PickerProduct> = {};
    (bundle?.bundle_items || []).forEach((it) => {
      const p = it.products;
      if (p) seed[p.id] = { id: p.id, title: p.title, slug: p.slug, image_url: p.image_url, price_usd: p.price_usd };
    });
    return seed;
  });

  function addPicked(p: PickerProduct) {
    if (pickedIds.includes(p.id)) {
      setPickedIds(pickedIds.filter((id) => id !== p.id));
    } else {
      setPickedIds([...pickedIds, p.id]);
      setPicked((prev) => ({ ...prev, [p.id]: p }));
    }
  }

  const pickedList = pickedIds.map((id) => picked[id]).filter(Boolean) as PickerProduct[];
  const gallery = pickedList.map((p) => p.image_url).filter(Boolean) as string[];
  const sumPrice = pickedList.reduce((s, p) => s + Number(p.price_usd || 0), 0);

  async function save() {
    if (!title.trim()) { setMsg({ kind: 'error', text: 'Title is required.' }); return; }
    const externalUrl = externalDownloadUrl.trim();
    const useExternal = externalUrl.length > 0;
    if (!useExternal && !pickedIds.length) {
      setMsg({ kind: 'error', text: 'Pick at least one source product OR provide an external Drive link.' });
      return;
    }
    if (useExternal && !/drive\.google\.com\/(uc\?|file\/d\/|folders\/)/.test(externalUrl)) {
      setMsg({ kind: 'error', text: 'External link must be a Google Drive URL.' });
      return;
    }
    const finalSlug = slug || slugify(title);
    const finalPrice = Number(price) || Math.round(sumPrice * 0.7 * 100) / 100;
    const finalGallery = heroImage ? [heroImage, ...gallery] : gallery;
    const mainImage = heroImage || gallery[0] || null;

    setSaving(true);
    try {
      let bundleId = bundle?.id;
      if (!bundleId) {
        const { data, error } = await supabase.from('products').insert({
          title, slug: finalSlug, price_usd: finalPrice, image_url: mainImage,
          description, gallery: finalGallery, is_bundle: true, active, link_status: 'verified',
        }).select('id').single();
        if (error) throw error;
        bundleId = data.id;
      } else {
        const { error } = await supabase.from('products').update({
          title, slug: finalSlug, price_usd: finalPrice, image_url: mainImage,
          description, gallery: finalGallery, active,
        }).eq('id', bundleId);
        if (error) throw error;
        // wipe existing bundle_items + product_downloads (we'll re-create from picked sources)
        await supabase.from('bundle_items').delete().eq('bundle_product_id', bundleId);
        await supabase.from('product_downloads').delete().eq('product_id', bundleId);
      }

      // Insert bundle_items in pick order
      const items = pickedIds.map((sid, i) => ({ bundle_product_id: bundleId!, source_product_id: sid, sort_order: i }));
      if (items.length) {
        const { error } = await supabase.from('bundle_items').insert(items);
        if (error) throw error;
      }

      // Attach download links. External-link mode wins when provided — the
      // single Drive URL replaces any source aggregation. Without it, we
      // aggregate Drive links from each picked source product.
      let downloadCount = 0;
      if (useExternal) {
        const { error } = await supabase.from('product_downloads').insert({
          product_id: bundleId!,
          download_link: externalUrl,
          file_name: title.trim(),
          sort_order: 0,
          verified_at: new Date().toISOString(),
        });
        if (error) throw error;
        downloadCount = 1;
      } else if (pickedIds.length) {
        const { data: srcDls } = await supabase.from('product_downloads').select('product_id,download_link,file_name').in('product_id', pickedIds);
        const downloads = (srcDls ?? []).map((d: any, i: number) => ({
          product_id: bundleId!, download_link: d.download_link, file_name: d.file_name || null, sort_order: i,
        }));
        if (downloads.length) {
          const { error } = await supabase.from('product_downloads').insert(downloads);
          if (error) throw error;
        }
        downloadCount = downloads.length;
      }

      const summary = useExternal
        ? `external Drive link${pickedIds.length ? ` · ${pickedIds.length} source product${pickedIds.length === 1 ? '' : 's'} kept for gallery` : ''}`
        : `${pickedIds.length} items, ${downloadCount} download link${downloadCount === 1 ? '' : 's'}`;
      setMsg({ kind: 'success', text: `✓ Bundle saved (${summary})` });
      setTimeout(onDone, 700);
    } catch (e: any) {
      setMsg({ kind: 'error', text: e.message || String(e) });
    }
    setSaving(false);
  }

  function move(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= pickedIds.length) return;
    const next = pickedIds.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    setPickedIds(next);
  }

  return (
    <div className="space-y-5">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Title</label>
            <input value={title} onChange={(e) => { setTitle(e.target.value); if (!bundle && !slug) setSlug(slugify(e.target.value)); }} className={inputCls} placeholder="e.g. Cowboy & Western 10-Pack Bundle" />
          </div>
          <div>
            <label className={labelCls}>Slug <span className="text-ink-700/40">(URL)</span></label>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} className={inputCls} placeholder="cowboy-western-10-pack-bundle" />
          </div>
          <div>
            <label className={labelCls}>Price (USD)</label>
            <input value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} placeholder={`Default: $${(sumPrice * 0.7).toFixed(2)} (30% bundle discount)`} />
            {sumPrice > 0 && <p className="text-xs text-ink-700/60 mt-1">Sum of source prices: ${sumPrice.toFixed(2)}. Customers expect a discount on bundles.</p>}
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} className={inputCls} placeholder="Describe the bundle (themes, what's included, who it's for...)" />
          </div>
          <label className="flex items-center gap-2 text-sm pt-1">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (visible in catalog)
          </label>
        </div>
        <div>
          <label className={labelCls}>Hero bundle image <span className="text-ink-700/40">(shown as main product image; overrides auto)</span></label>
          <ImageUpload value={heroImage} onChange={setHeroImage} folder="bundles" />
          <p className="text-xs text-ink-700/60 mt-2">If left empty, the bundle uses the first image of the first source product. Either way, all picked source products' first images make up the bundle's gallery.</p>

          {gallery.length > 0 && (
            <div className="mt-4">
              <div className="text-xs text-ink-700/60 mb-2">Auto gallery preview ({gallery.length})</div>
              <div className="grid grid-cols-5 gap-1">
                {gallery.slice(0, 10).map((g, i) => <img key={i} src={g} alt="" className="w-full aspect-square object-cover rounded" />)}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-black/10 pt-4">
        <div className="mb-4 rounded-md border border-bronze-600/20 bg-bronze-50/40 p-3">
          <label className={labelCls}>External Drive download link <span className="text-ink-700/40">(optional — for pre-packaged ZIP bundles)</span></label>
          <input
            type="url"
            value={externalDownloadUrl}
            onChange={(e) => setExternalDownloadUrl(e.target.value)}
            placeholder="https://drive.google.com/uc?export=download&id=…"
            className={inputCls}
          />
          <p className="text-xs text-ink-700/60 mt-1.5">
            {externalDownloadUrl.trim()
              ? '✓ External link will be used as this bundle\'s only download. Source products below are kept only for the gallery.'
              : 'Leave blank to use the aggregated Drive links from the picked products below.'}
          </p>
        </div>

        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-sm font-medium">{externalDownloadUrl.trim() ? 'Picked products (gallery only)' : 'Picked products'} <span className="text-ink-700/60">({pickedIds.length})</span></div>
            <div className="text-xs text-ink-700/60">
              {externalDownloadUrl.trim()
                ? 'These contribute their first image to the bundle gallery. Their Drive links are not used because the external link above takes precedence.'
                : 'Each source\'s first image goes into the bundle gallery; all source Drive links are auto-attached to this bundle.'}
            </div>
          </div>
          {pickedIds.length > 0 && <button className={btnGhost} onClick={() => setPickedIds([])}>Clear all</button>}
        </div>
        {pickedList.length > 0 && (
          <div className="border border-black/10 rounded mb-3 max-h-44 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody>
                {pickedList.map((p, i) => (
                  <tr key={p.id} className="border-t border-black/5 first:border-t-0">
                    <td className="p-2 w-8 text-ink-700/60">#{i + 1}</td>
                    <td className="p-2 w-10">{p.image_url && <img src={p.image_url} alt="" className="w-8 h-8 rounded object-cover" />}</td>
                    <td className="p-2">{p.title.slice(0, 70)}</td>
                    <td className="p-2 text-right w-16">${Number(p.price_usd || 0).toFixed(2)}</td>
                    <td className="p-2 w-24 text-right whitespace-nowrap">
                      <button className="px-1.5 text-bronze-700" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                      <button className="px-1.5 text-bronze-700" onClick={() => move(i, 1)} disabled={i === pickedList.length - 1}>↓</button>
                      <button className="px-1.5 text-red-600" onClick={() => setPickedIds(pickedIds.filter((id) => id !== p.id))}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ProductSearchPicker
          selectedIds={pickedIds}
          onPick={addPicked}
          showPrice
          placeholder="Search the full catalog by title…"
          compact
          showFilters
        />
      </div>

      <div className="flex items-center gap-3 border-t border-black/10 pt-4">
        <button disabled={saving} onClick={save} className={btnPrimary}>{saving ? 'Saving…' : (bundle ? 'Save changes' : 'Create bundle')}</button>
        <Toast message={msg.text} kind={msg.kind} />
      </div>
    </div>
  );
}

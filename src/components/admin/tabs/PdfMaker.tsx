// PDF Maker — build the branded customer "download links" PDF straight from
// the catalog: pick products (or load a whole bundle), choose each product's
// hero picture, and generate a themed PDF with one clickable Google-Drive
// DOWNLOAD button per product + a thank-you note from Jolly. Everything runs
// in the browser (jsPDF) — nothing is uploaded; the PDF downloads to your PC.
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, btnPrimary, btnGhost, btnDanger, inputCls, labelCls } from '../ui';
import ProductSearchPicker, { type PickerProduct } from '../ProductSearchPicker';

type Sel = {
  id: string; title: string; slug: string;
  label: string;             // editable name shown under the product IN THE PDF
  images: string[];          // all catalog pictures (image_url + gallery)
  chosen: string;            // the picture that goes in the PDF
  link: string;              // Drive download link ('' = missing)
};

// the catalog title minus any SEO tail after the first pipe
const cleanName = (t: string) => (t || '').split('|')[0].trim();

const W = 612, H = 792;      // US-Letter in points
const BRONZE: [number, number, number] = [133, 79, 11];
const BRONZE_D: [number, number, number] = [107, 63, 9];
const CREAM: [number, number, number] = [250, 238, 218];
const CREAM_L: [number, number, number] = [251, 244, 230];
const GOLD: [number, number, number] = [250, 199, 117];
const INK: [number, number, number] = [43, 32, 19];
const INK_SOFT: [number, number, number] = [90, 74, 51];
const SITE = 'https://www.digitalchiselco.com';
const EMAIL = 'jolly@digitalchiselco.com';

async function fetchAsCanvas(url: string, maxPx: number): Promise<HTMLCanvasElement> {
  const blob = await (await fetch(url, { credentials: 'omit' })).blob();
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
  cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv;
}

function rounded(cv: HTMLCanvasElement, radiusFrac = 0.08): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = cv.width; out.height = cv.height;
  const ctx = out.getContext('2d')!;
  const r = cv.width * radiusFrac;
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.arcTo(cv.width, 0, cv.width, cv.height, r);
  ctx.arcTo(cv.width, cv.height, 0, cv.height, r);
  ctx.arcTo(0, cv.height, 0, 0, r); ctx.arcTo(0, 0, cv.width, 0, r);
  ctx.closePath(); ctx.clip();
  ctx.drawImage(cv, 0, 0);
  return out;
}

export default function PdfMaker() {
  const [sel, setSel] = useState<Sel[]>([]);
  const [bundles, setBundles] = useState<{ id: string; title: string }[]>([]);
  const [bundleId, setBundleId] = useState('');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    supabase.from('products').select('id,title').eq('is_bundle', true).eq('active', true)
      .order('created_at', { ascending: false })
      .then(({ data }) => setBundles((data ?? []) as any));
  }, []);

  async function hydrate(rows: { id: string; title: string; slug: string; image_url: string | null; gallery: any }[]): Promise<Sel[]> {
    const ids = rows.map((r) => r.id);
    const { data: dls } = await supabase.from('product_downloads')
      .select('product_id,download_link,sort_order').in('product_id', ids).order('sort_order');
    const linkBy: Record<string, string> = {};
    (dls ?? []).forEach((d: any) => { if (!linkBy[d.product_id]) linkBy[d.product_id] = d.download_link; });
    return rows.map((r) => {
      const gallery: string[] = Array.isArray(r.gallery) ? r.gallery : [];
      const images = [...new Set([r.image_url, ...gallery].filter(Boolean))] as string[];
      return { id: r.id, title: r.title, slug: r.slug, label: cleanName(r.title),
               images, chosen: images[0] || '', link: linkBy[r.id] || '' };
    });
  }

  async function addProduct(p: PickerProduct) {
    if (sel.some((s) => s.id === p.id)) { setSel(sel.filter((s) => s.id !== p.id)); return; }
    const { data } = await supabase.from('products')
      .select('id,title,slug,image_url,gallery').eq('id', p.id).maybeSingle();
    if (!data) return;
    setSel([...sel, ...(await hydrate([data as any]))]);
  }

  async function loadBundle() {
    if (!bundleId) return;
    setMsg('Loading bundle members…');
    const { data } = await supabase.from('bundle_items')
      .select('sort_order,products:source_product_id(id,title,slug,image_url,gallery)')
      .eq('bundle_product_id', bundleId).order('sort_order');
    const rows = (data ?? []).map((d: any) => d.products).filter(Boolean);
    setSel(await hydrate(rows));
    const b = bundles.find((x) => x.id === bundleId);
    if (b && !title) setTitle(b.title.split('|')[0].trim());
    setMsg(`Loaded ${rows.length} bundle member(s).`);
  }

  const ready = sel.filter((s) => s.link && s.chosen);

  async function generate() {
    if (!ready.length) return;
    setBusy(true); setMsg('Building PDF — fetching pictures…');
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'pt', format: 'letter' });
      const n = ready.length;
      // single product → its (editable) name on the cover, never the word "Bundle"
      const t = (title || (n === 1 ? (ready[0].label || cleanName(ready[0].title)) : 'Bundle Downloads')).trim();
      const sub = (subtitle ||
        (n > 1 ? `${n} Premium Bas-Relief STL Files for CNC Routers`
               : 'Premium Bas-Relief STL File for CNC Routers')).trim();

      // logo (site settings) + product images, compressed like the desktop tool
      const { data: st } = await supabase.from('site_settings').select('logo_image_url').eq('id', 1).maybeSingle();
      let logo: HTMLCanvasElement | null = null;
      try { if (st?.logo_image_url) logo = rounded(await fetchAsCanvas(st.logo_image_url, 400)); } catch {}
      const imgs: Record<string, string> = {};
      for (let i = 0; i < ready.length; i++) {
        setMsg(`Fetching picture ${i + 1} of ${n}…`);
        const cv = await fetchAsCanvas(ready[i].chosen, 900);
        imgs[ready[i].id] = cv.toDataURL('image/jpeg', 0.8);
      }

      const perPage = 4;
      const batches: Sel[][] = [];
      for (let i = 0; i < ready.length; i += perPage) batches.push(ready.slice(i, i + perPage));
      const totalPages = batches.length + 1;

      const footer = (pageNo: number) => {
        doc.setDrawColor(...GOLD); doc.setLineWidth(1); doc.line(54, 746, W - 54, 746);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...INK_SOFT);
        doc.text('www.digitalchiselco.com', 54, 759);
        doc.link(54, 750, 136, 14, { url: SITE });
        doc.text(EMAIL, W / 2, 759, { align: 'center' });
        doc.link(W / 2 - 80, 750, 160, 14, { url: 'mailto:' + EMAIL });
        doc.text(`Page ${pageNo} of ${totalPages}`, W - 54, 759, { align: 'right' });
      };
      const button = (cx: number, yTop: number, w: number, h: number, url: string, label: string) => {
        doc.setFillColor(...BRONZE);
        doc.roundedRect(cx - w / 2, yTop, w, h, h / 2, h / 2, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(253, 246, 236);
        doc.text(label, cx, yTop + h / 2 + 3.4, { align: 'center' });
        doc.link(cx - w / 2, yTop, w, h, { url });
      };

      // ------------------------------ cover -------------------------------
      doc.setFillColor(...CREAM_L); doc.rect(0, 0, W, H, 'F');
      doc.setFillColor(...CREAM); doc.rect(0, 0, W, 330, 'F');
      doc.setDrawColor(...GOLD); doc.setLineWidth(2); doc.line(0, 330, W, 330);
      if (logo) doc.addImage(logo.toDataURL('image/png'), 'PNG', W / 2 - 80, 90, 160, 160);
      doc.setFont('times', 'normal'); doc.setFontSize(12.5); doc.setTextColor(...INK_SOFT);
      doc.text('DIGITALCHISELCO', W / 2, 282, { align: 'center', charSpace: 4 });
      let fs = 30;
      doc.setFont('times', 'bold');
      while (doc.getTextWidth(t) * (fs / doc.getFontSize()) > W - 120 && fs > 16) fs -= 1;
      doc.setFontSize(fs); doc.setTextColor(...BRONZE_D);
      doc.text(t, W / 2, 378, { align: 'center' });
      doc.setFont('times', 'normal'); doc.setFontSize(14); doc.setTextColor(...INK);
      doc.text(sub, W / 2, 402, { align: 'center' });
      doc.setDrawColor(...[169, 116, 31] as any); doc.setLineWidth(1);
      doc.line(W / 2 - 90, 418, W / 2 + 90, 418);

      doc.setFillColor(255, 255, 255); doc.setDrawColor(...GOLD); doc.setLineWidth(1.2);
      doc.roundedRect(92, 422, W - 184, 185, 12, 12, 'FD');
      doc.setFont('times', 'italic'); doc.setFontSize(15); doc.setTextColor(...BRONZE);
      doc.text('A note of thanks', W / 2, 456, { align: 'center' });
      const note = n === 1
        ? ['Dear Maker,',
           'Thank you so much for choosing DigitalChiselCo! This design was sculpted',
           'with real care, and it means the world to me that it will now take shape',
           'on your machine. Carve it, gift it, sell it — and if you ever need the',
           'file re-sent or a hand with the toolpaths, I am only one email away.']
        : ['Dear Maker,',
           `Thank you so much for choosing DigitalChiselCo! Every one of these ${n}`,
           'designs was sculpted with real care, and it means the world to me that',
           'they will now take shape on your machine. Carve them, gift them, sell them —',
           'and if you ever need a file re-sent or a hand with the toolpaths, I am only',
           'one email away.'];
      doc.setFont('times', 'normal'); doc.setFontSize(11); doc.setTextColor(...INK);
      note.forEach((ln, i) => doc.text(ln, W / 2, 482 + i * 16.5, { align: 'center' }));
      doc.setFont('times', 'italic'); doc.setFontSize(13); doc.setTextColor(...BRONZE_D);
      doc.text('Happy carving!  —  Jolly', W / 2, 585, { align: 'center' });

      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK);
      doc.text('HOW TO DOWNLOAD', W / 2, 644, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...INK_SOFT);
      doc.text('On the following pages, click the bronze button under any design — your STL file downloads instantly from Google Drive.', W / 2, 661, { align: 'center' });
      doc.text('Files are yours forever: unlimited re-downloads, personal & commercial-use licence.', W / 2, 676, { align: 'center' });
      button(W / 2 - 110, 695, 190, 27, SITE, 'VISIT  THE  STORE');
      button(W / 2 + 110, 695, 190, 27, 'mailto:' + EMAIL, 'EMAIL  JOLLY');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK_SOFT);
      doc.text('www.digitalchiselco.com', W / 2 - 110, 735, { align: 'center' });
      doc.text(EMAIL, W / 2 + 110, 735, { align: 'center' });
      footer(1);

      // -------------------------- product pages ---------------------------
      batches.forEach((batch, pi) => {
        doc.addPage();
        doc.setFillColor(...CREAM); doc.rect(0, 0, W, 64, 'F');
        if (logo) doc.addImage(logo.toDataURL('image/png'), 'PNG', 54, 10, 36, 36);
        doc.setFont('times', 'bold'); doc.setFontSize(14); doc.setTextColor(...BRONZE_D);
        doc.text('DigitalChiselCo', 100, 40);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK_SOFT);
        doc.text(`${t} — ${n === 1 ? 'STL Download' : 'STL Bundle'}`, 100, 53);
        doc.setFontSize(8.5); doc.setTextColor(...BRONZE);
        doc.text('Instant digital downloads', W - 54, 46, { align: 'right' });
        doc.setDrawColor(...GOLD); doc.setLineWidth(1.4); doc.line(0, 64, W, 64);

        const colW = (W - 108 - 24) / 2, rowH = 305;
        batch.forEach((it, k) => {
          const row = Math.floor(k / 2), col = k % 2;
          const x = 54 + col * (colW + 24);
          const yTop = 92 + row * (rowH + 18);
          doc.setFillColor(255, 255, 255); doc.setDrawColor(234, 217, 189); doc.setLineWidth(1);
          doc.roundedRect(x, yTop, colW, rowH, 10, 10, 'FD');
          const box = Math.min(colW - 28, 205);
          const props = doc.getImageProperties(imgs[it.id]);
          const s = Math.min(box / props.width, box / props.height);
          const dw = props.width * s, dh = props.height * s;
          doc.addImage(imgs[it.id], 'JPEG', x + (colW - dw) / 2, yTop + 14 + (box - dh) / 2, dw, dh);
          doc.setFont('times', 'bold'); doc.setTextColor(...INK);
          const full = (it.label || cleanName(it.title)).trim();
          let nm = full; let nfs = 12;
          doc.setFontSize(nfs);
          if (doc.getTextWidth(nm) > colW - 20) { nfs = 10.5; doc.setFontSize(nfs); }
          while (doc.getTextWidth(nm) > colW - 20 && nm.length > 8) nm = nm.slice(0, -2);
          if (nm !== full) nm += '…';
          doc.text(nm, x + colW / 2, yTop + rowH - 52, { align: 'center' });
          button(x + colW / 2, yTop + rowH - 42, 176, 26, it.link, 'DOWNLOAD  STL  FILE');
        });
        footer(pi + 2);
      });

      const fname = `${t.replace(/[\\/:*?"<>|]+/g, '')} - Download Links - DigitalChiselCo.pdf`;
      doc.save(fname);
      setMsg(`✅ ${fname} — ${totalPages} pages, ${n} download buttons. Check your Downloads folder.`);
    } catch (e: any) {
      setMsg('❌ ' + (e?.message || 'PDF build failed'));
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      {/* ------------------------- instructions ------------------------- */}
      <Card>
        <h2 className="font-serif text-lg text-bronze-700 mb-2">📄 What this tool does</h2>
        <p className="text-sm text-ink-700/90 mb-3">
          It builds the <b>branded customer PDF</b> — a cream-and-bronze document with your logo on the
          cover, a personal thank-you note signed <i>Jolly</i>, and <b>one clickable
          "DOWNLOAD STL FILE" button per product</b> that downloads straight from Google Drive.
          Attach it to an Etsy digital listing or email it to a customer. Nothing is uploaded anywhere —
          the PDF is generated in your browser and lands in your Downloads folder.
        </p>
        <div className="grid md:grid-cols-2 gap-3 text-xs text-ink-700/80">
          <div className="border border-black/10 rounded-md p-3 bg-cream/40">
            <b className="text-ink-800">Requirements (per product)</b>
            <ul className="list-disc ml-4 mt-1 space-y-1">
              <li><b>A Google Drive download link</b> — the tool reads it from the product's
                Download Links. Products without one show a red warning and are skipped
                (add the link in the <i>Download Links</i> tab first).</li>
              <li><b>At least one catalog picture</b> — you'll pick which of the product's
                pictures appears in the PDF (its thumbnails are shown below).</li>
            </ul>
          </div>
          <div className="border border-black/10 rounded-md p-3 bg-cream/40">
            <b className="text-ink-800">How to use — 3 steps</b>
            <ol className="list-decimal ml-4 mt-1 space-y-1">
              <li><b>Pick products</b>: load a whole bundle from the dropdown, and/or search and
                click individual products (click again to remove).</li>
              <li><b>Edit each product's title</b> (the box under every row — this exact text
                prints under the product in the PDF) and <b>click a thumbnail</b> to choose its
                picture, then set the cover title / subtitle.</li>
              <li>Press <b>Generate PDF</b>. Pictures are auto-compressed (900&nbsp;px JPEG), so the
                file stays far under Etsy's <b>20&nbsp;MB</b> attachment limit.</li>
            </ol>
          </div>
        </div>
        <p className="text-[11px] text-ink-700/60 mt-3">
          Tip: the desktop Bundle Relief Studio has the same tool (📄 Download PDF) for folders on your
          PC — this one works anywhere from the live catalog.
        </p>
      </Card>

      {/* --------------------------- pick source ------------------------ */}
      <Card>
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <label className="text-xs">
            <span className={labelCls}>Load a bundle's members</span>
            <select value={bundleId} onChange={(e) => setBundleId(e.target.value)} className={inputCls + ' mt-1 min-w-[260px]'}>
              <option value="">— choose a bundle —</option>
              {bundles.map((b) => <option key={b.id} value={b.id}>{b.title.slice(0, 70)}</option>)}
            </select>
          </label>
          <button onClick={loadBundle} disabled={!bundleId} className={btnGhost}>Load bundle</button>
          <span className="text-[11px] text-ink-700/50">…or search below and click products to add them one by one.</span>
        </div>
        <ProductSearchPicker selectedIds={sel.map((s) => s.id)} onPick={addProduct} showFilters compact={false} />
      </Card>

      {/* ------------------------- selected rows ------------------------ */}
      {sel.length > 0 && (
        <Card>
          <h3 className="font-serif text-bronze-700 mb-2">Selected products ({sel.length}) — edit each title and click a thumbnail to choose the PDF picture</h3>
          <div className="space-y-3">
            {sel.map((s, i) => (
              <div key={s.id} className="border border-black/10 rounded-md p-2.5">
                <div className="flex items-center gap-2 text-sm mb-1.5">
                  <span className="text-ink-700/40 text-xs w-5">{i + 1}.</span>
                  <input
                    value={s.label}
                    onChange={(e) => setSel(sel.map((x) => x.id === s.id ? { ...x, label: e.target.value } : x))}
                    placeholder={cleanName(s.title)}
                    title={`Title shown under this product in the PDF (catalog name: ${s.title})`}
                    className={inputCls + ' flex-1 !py-1 text-sm'} />
                  {s.link
                    ? <span className="text-[10px] text-green-700 bg-green-100 px-1.5 py-0.5 rounded whitespace-nowrap">🔗 Drive link ✓</span>
                    : <span className="text-[10px] text-red-700 bg-red-100 px-1.5 py-0.5 rounded whitespace-nowrap" title="Add one in the Download Links tab — this product will be SKIPPED">⚠ no Drive link — skipped</span>}
                  <button onClick={() => setSel(sel.filter((x) => x.id !== s.id))} className={btnDanger + ' !py-0.5 !px-2 text-xs'}>remove</button>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {s.images.map((u) => (
                    <button key={u} onClick={() => setSel(sel.map((x) => x.id === s.id ? { ...x, chosen: u } : x))}
                      className={`rounded overflow-hidden border-2 ${s.chosen === u ? 'border-bronze-600' : 'border-transparent hover:border-black/20'}`}
                      title={s.chosen === u ? 'Used in the PDF' : 'Use this picture'}>
                      <img src={u} alt="" className="w-16 h-16 object-cover" loading="lazy" />
                    </button>
                  ))}
                  {s.images.length === 0 && <span className="text-[11px] text-red-600">no pictures on this product</span>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* --------------------------- generate --------------------------- */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs flex-1 min-w-[220px]">
            <span className={labelCls}>Cover title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Serving Trays Bundle" className={inputCls + ' mt-1'} />
          </label>
          <label className="text-xs flex-1 min-w-[220px]">
            <span className={labelCls}>Cover subtitle (blank = auto "N Premium Bas-Relief STL Files…")</span>
            <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className={inputCls + ' mt-1'} />
          </label>
          <button onClick={generate} disabled={busy || !ready.length} className={btnPrimary}>
            {busy ? 'Building…' : `📄 Generate PDF (${ready.length} product${ready.length === 1 ? '' : 's'})`}
          </button>
        </div>
        {msg && <p className="text-xs text-ink-700/80 mt-2">{msg}</p>}
      </Card>
    </div>
  );
}

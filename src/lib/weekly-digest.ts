// Weekly "fresh designs" lookbook PDF — built server-side with pdf-lib inside
// the Monday cron, uploaded to the public site-media bucket, and linked from the
// weekly digest email. Every design cell links to its PRODUCT PAGE (never raw
// file links — those are paid downloads).
import { PDFDocument, PDFName, PDFString, rgb, StandardFonts } from 'pdf-lib';

const SITE = (process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
const LOGO_URL = process.env.EMAIL_LOGO_URL
  || 'https://tutalnieozbngrsfywes.supabase.co/storage/v1/object/public/site-media/brand/1782452499676-lgzcu7.png';

export type DigestProduct = { title: string; slug: string; price_usd: number | null; image_url: string | null };

/** ISO week key like '2026-W32' (UTC). */
export function isoWeekKey(d = new Date()): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);                    // nearest Thursday
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((x.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${x.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function addLink(pdfDoc: PDFDocument, page: any, rect: number[], url: string) {
  const ann = pdfDoc.context.register(pdfDoc.context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
  }));
  const key = PDFName.of('Annots');
  const existing = page.node.lookup(key);
  if (existing) (existing as any).push(ann);
  else page.node.set(key, pdfDoc.context.obj([ann]));
}

async function fetchImage(pdfDoc: PDFDocument, url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`image ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  try { return await pdfDoc.embedJpg(bytes); } catch { return await pdfDoc.embedPng(bytes); }
}

const BRONZE = rgb(0.522, 0.31, 0.043), BRONZE_D = rgb(0.369, 0.22, 0.039);
const CREAM = rgb(0.98, 0.933, 0.855), INK = rgb(0.165, 0.125, 0.075), SOFT = rgb(0.35, 0.29, 0.2);

/** Build the branded weekly lookbook. Products with unloadable images are skipped. */
export async function buildWeeklyPdf(products: DigestProduct[], weekLabel: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const serif = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const serifIt = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const sansB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  pdfDoc.setTitle(`Fresh This Week - DigitalChiselCo (${weekLabel})`);
  pdfDoc.setAuthor('DigitalChiselCo');

  let logo: any = null;
  try { logo = await fetchImage(pdfDoc, LOGO_URL); } catch { /* logo optional */ }

  const W = 612, H = 792;
  const COLS = 2, ROWS = 3, PER = COLS * ROWS;
  const cellW = (W - 108 - 24) / COLS, cellH = 196;

  const usable: { p: DigestProduct; img: any }[] = [];
  for (const p of products) {
    if (!p.image_url) continue;
    try { usable.push({ p, img: await fetchImage(pdfDoc, p.image_url) }); } catch { /* skip */ }
    if (usable.length >= 60) break;   // every design of the week (6 per page)
  }
  if (!usable.length) throw new Error('no products with loadable images');

  const pages = Math.ceil(usable.length / PER);
  for (let pg = 0; pg < pages; pg++) {
    const page = pdfDoc.addPage([W, H]);
    // header band
    page.drawRectangle({ x: 0, y: H - 110, width: W, height: 110, color: CREAM });
    if (logo) page.drawImage(logo, { x: 54, y: H - 96, width: 72, height: 72 });
    page.drawText('DIGITALCHISELCO', { x: 140, y: H - 52, size: 10, font: sans, color: SOFT });
    page.drawText('Fresh This Week', { x: 140, y: H - 76, size: 26, font: serif, color: BRONZE_D });
    page.drawText(`${usable.length} brand-new bas-relief designs - straight from the workshop`, { x: 140, y: H - 93, size: 10, font: serifIt, color: SOFT });
    page.drawLine({ start: { x: 0, y: H - 110 }, end: { x: W, y: H - 110 }, thickness: 1.5, color: rgb(0.98, 0.78, 0.46) });

    const batch = usable.slice(pg * PER, pg * PER + PER);
    for (let k = 0; k < batch.length; k++) {
      const { p, img } = batch[k];
      const row = Math.floor(k / COLS), col = k % COLS;
      const x = 54 + col * (cellW + 24);
      const yTop = H - 130 - row * (cellH + 14);
      const y = yTop - cellH;
      page.drawRectangle({ x, y, width: cellW, height: cellH, color: rgb(1, 1, 1), borderColor: rgb(0.918, 0.851, 0.741), borderWidth: 1 });
      // image, contain-fit into a box
      const box = 128;
      const s = Math.min(box / img.width, box / img.height);
      const dw = img.width * s, dh = img.height * s;
      page.drawImage(img, { x: x + (cellW - dw) / 2, y: yTop - 10 - box + (box - dh) / 2, width: dw, height: dh });
      // title (ellipsized)
      let name = p.title.split('|')[0].trim();
      while (sansB.widthOfTextAtSize(name, 10) > cellW - 20 && name.length > 6) name = name.slice(0, -2);
      if (name !== p.title.split('|')[0].trim()) name += '...';
      page.drawText(name, { x: x + (cellW - sansB.widthOfTextAtSize(name, 10)) / 2, y: y + 40, size: 10, font: sansB, color: INK });
      if (p.price_usd != null) {
        const priceTxt = `$${Number(p.price_usd).toFixed(2)} - instant download`;
        page.drawText(priceTxt, { x: x + (cellW - sans.widthOfTextAtSize(priceTxt, 9)) / 2, y: y + 26, size: 9, font: sans, color: BRONZE });
      }
      const cta = 'VIEW ON DIGITALCHISELCO.COM';
      page.drawText(cta, { x: x + (cellW - sansB.widthOfTextAtSize(cta, 8)) / 2, y: y + 11, size: 8, font: sansB, color: BRONZE_D });
      addLink(pdfDoc, page, [x, y, x + cellW, yTop], `${SITE}/product/${p.slug}`);
    }

    // footer
    page.drawLine({ start: { x: 54, y: 46 }, end: { x: W - 54, y: 46 }, thickness: 1, color: rgb(0.98, 0.78, 0.46) });
    page.drawText('www.digitalchiselco.com', { x: 54, y: 33, size: 8.5, font: sans, color: SOFT });
    addLink(pdfDoc, page, [54, 28, 240, 44], SITE);
    const pn = `Page ${pg + 1} of ${pages}`;
    page.drawText(pn, { x: W - 54 - sans.widthOfTextAtSize(pn, 8.5), y: 33, size: 8.5, font: sans, color: SOFT });
  }

  return pdfDoc.save();
}

/* guide-pdf.js — dependency-free professional PDF writer for the print guide.
 * Builds a real multi-page A4 PDF (core Helvetica fonts, colored bands, ruled
 * tables) entirely offline and returns a Blob.
 */

const A4W = 595.28, A4H = 841.89;
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  .replace(/[^\x20-\x7E]/g, c => ({ 'Ø': 'O', '×': 'x', '÷': '/', '·': '-', '—': '-', '–': '-', '≈': '~', '°': ' deg', '✓': '', '⚠': '!' }[c] ?? ''));

/* rough Helvetica width table for wrapping (avg widths per char @1pt) */
function tw(s, size, bold) { return s.length * size * (bold ? 0.53 : 0.5); }
function wrap(s, size, maxW, bold) {
  const words = String(s).split(/\s+/), lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (tw(t, size, bold) > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

const C = {
  ink: [0.10, 0.13, 0.19], dim: [0.42, 0.47, 0.55], faint: [0.62, 0.66, 0.72],
  line: [0.84, 0.87, 0.92], panel: [0.957, 0.969, 0.988],
  acc: [0.70, 0.42, 0.03], accSoft: [0.984, 0.945, 0.874],
  steel: [0.18, 0.37, 0.75], warnSoft: [0.984, 0.937, 0.867], warn: [0.66, 0.38, 0.05],
  dark: [0.043, 0.059, 0.09], cream: [0.914, 0.847, 0.651], white: [1, 1, 1],
  good: [0.11, 0.55, 0.31],
};

export function buildGuidePDF(sections, meta) {
  const pages = [];                 // each page = array of content-stream ops
  let ops = [], y = 0;
  const LM = 54, RM = 54, CW = A4W - LM - RM;

  const rg = c => c.map(v => v.toFixed(3)).join(' ');
  const rect = (x, yy, w, h, c) => ops.push(`${rg(c)} rg ${x.toFixed(1)} ${yy.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`);
  const line = (x1, y1, x2, y2, c, lw = 0.7) => ops.push(`${rg(c)} RG ${lw} w ${x1.toFixed(1)} ${y1.toFixed(1)} m ${x2.toFixed(1)} ${y2.toFixed(1)} l S`);
  const text = (x, yy, s, size, c, bold, mono) => {
    const f = mono ? (bold ? 'F4' : 'F3') : (bold ? 'F2' : 'F1');
    ops.push(`BT /${f} ${size} Tf ${rg(c)} rg ${x.toFixed(1)} ${yy.toFixed(1)} Td (${esc(s)}) Tj ET`);
  };

  function pageStart(first) {
    ops = []; pages.push(ops);
    if (first) {
      // dark cover band
      rect(0, A4H - 150, A4W, 150, C.dark);
      rect(0, A4H - 150, A4W, 4, C.acc);
      text(LM, A4H - 52, 'VASE LAMPSHADE STUDIO', 9, C.cream, false, true);
      text(LM, A4H - 84, meta.title, 24, C.white, true);
      text(LM, A4H - 106, meta.subtitle, 11, [0.67, 0.71, 0.78]);
      text(LM, A4H - 132, meta.date, 9, C.faint, false, true);
      y = A4H - 178;
    } else {
      text(LM, A4H - 40, 'VASE LAMPSHADE STUDIO', 7.5, C.faint, false, true);
      text(A4W - RM - tw('PRINT GUIDE', 7.5, false) * 1.08, A4H - 40, 'PRINT GUIDE', 7.5, C.faint, false, true);
      line(LM, A4H - 47, A4W - RM, A4H - 47, C.line);
      line(LM, A4H - 47, LM + 40, A4H - 47, C.acc, 1.6);
      y = A4H - 72;
    }
  }
  function footer(n) {
    line(LM, 42, A4W - RM, 42, C.line);
    text(LM, 31, 'Vase Lampshade Studio - Print Guide', 8, C.dim);
    text(A4W - RM - 12, 31, String(n), 9, C.ink, true, true);
  }
  function need(h) { if (y - h < 60) { pageStart(false); } }

  pageStart(true);

  for (const sec of sections) {
    if (sec.type === 'h1') {
      need(46);
      y -= 14;
      text(LM, y, sec.n || '', 8.5, C.acc, true, true); y -= 15;
      text(LM, y, sec.text, 15.5, C.ink, true); y -= 8;
      line(LM, y, A4W - RM, y, C.acc, 1.3); y -= 14;
    } else if (sec.type === 'h2') {
      need(26); y -= 6;
      text(LM, y, sec.text, 11, C.steel, true); y -= 15;
    } else if (sec.type === 'p') {
      const lines = wrap(sec.text, 9.6, CW);
      need(lines.length * 13 + 4);
      for (const l of lines) { text(LM, y, l, 9.6, C.dim); y -= 13; }
      y -= 4;
    } else if (sec.type === 'kv') {
      // settings table: [label, value]
      const rows = sec.rows, rh = 19, h = rows.length * rh + 6;
      need(h + 8);
      const labW = sec.labW || 170;
      rect(LM, y - h + 10, CW, h, C.panel);
      let yy = y - 4;
      for (const [k, v] of rows) {
        text(LM + 10, yy - 9, k, 8.4, C.dim, false, true);
        const vLines = wrap(v, 9.4, CW - labW - 24, true);
        text(LM + labW, yy - 9, vLines[0] || '', 9.4, C.ink, true);
        yy -= rh;
        if (rows.indexOf([k, v]) !== rows.length - 1) line(LM + 8, yy + 4, A4W - RM - 8, yy + 4, C.line, 0.4);
      }
      y = y - h + 2; y -= 12;
    } else if (sec.type === 'call') {
      const lines = wrap(sec.text, 9.2, CW - 30);
      const h = lines.length * 12.5 + 30;
      need(h + 8);
      const bg = sec.kind === 'warn' ? C.warnSoft : C.accSoft;
      const bar = sec.kind === 'warn' ? C.warn : C.acc;
      rect(LM, y - h + 12, CW, h, bg);
      rect(LM, y - h + 12, 2.6, h, bar);
      text(LM + 14, y - 3, sec.label.toUpperCase(), 7.6, bar, true, true);
      let yy = y - 18;
      for (const l of lines) { text(LM + 14, yy, l, 9.2, C.ink); yy -= 12.5; }
      y = y - h + 4; y -= 12;
    } else if (sec.type === 'big') {
      // the calculated formula block
      need(58);
      rect(LM, y - 44, CW, 50, C.dark);
      text(LM + 14, y - 12, sec.label, 7.6, C.cream, true, true);
      text(LM + 14, y - 33, sec.text, 14, C.white, true, true);
      y -= 56;
    } else if (sec.type === 'steps') {
      for (let i = 0; i < sec.items.length; i++) {
        const lines = wrap(sec.items[i], 9.6, CW - 26);
        need(lines.length * 13 + 6);
        text(LM + 2, y, String(i + 1) + '.', 9.6, C.acc, true, true);
        for (let j = 0; j < lines.length; j++) { text(LM + 22, y, lines[j], 9.6, C.dim); y -= 13; }
        y -= 3;
      }
      y -= 4;
    } else if (sec.type === 'gap') { y -= sec.h || 8; }
  }
  footerAll();

  function footerAll() { /* placeholder replaced below */ }
  // add footers now that page count is known
  pages.forEach((p, i) => { const keep = ops; ops = p; footer(i + 1); ops = keep; });

  // ---- assemble PDF ----
  const enc = new TextEncoder();
  const objs = [];
  const fontDefs = [
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Courier>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Courier-Bold>>',
  ];
  const nPages = pages.length;
  // object numbering: 1 catalog, 2 pages-tree, 3..6 fonts, then per page: page obj + stream obj
  const fontIds = [3, 4, 5, 6];
  let next = 7;
  const pageIds = [], streamIds = [];
  for (let i = 0; i < nPages; i++) { pageIds.push(next++); streamIds.push(next++); }
  const parts = [];
  const offsets = [0];
  let pos = 0;
  const push = s => { const b = enc.encode(s); parts.push(b); pos += b.length; };
  push('%PDF-1.4\n');
  const objStart = [];
  function obj(id, body) { objStart[id] = pos; push(`${id} 0 obj\n${body}\nendobj\n`); }
  obj(1, `<</Type/Catalog/Pages 2 0 R>>`);
  obj(2, `<</Type/Pages/Kids[${pageIds.map(id => id + ' 0 R').join(' ')}]/Count ${nPages}>>`);
  fontIds.forEach((id, i) => obj(id, fontDefs[i]));
  for (let i = 0; i < nPages; i++) {
    const content = pages[i].join('\n');
    obj(pageIds[i], `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${A4W} ${A4H}]/Resources<</Font<</F1 3 0 R/F2 4 0 R/F3 5 0 R/F4 6 0 R>>>>/Contents ${streamIds[i]} 0 R>>`);
    obj(streamIds[i], `<</Length ${enc.encode(content).length}>>\nstream\n${content}\nendstream`);
  }
  const xrefPos = pos;
  const maxId = next - 1;
  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id++) xref += String(objStart[id]).padStart(10, '0') + ' 00000 n \n';
  push(xref);
  push(`trailer\n<</Size ${maxId + 1}/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}

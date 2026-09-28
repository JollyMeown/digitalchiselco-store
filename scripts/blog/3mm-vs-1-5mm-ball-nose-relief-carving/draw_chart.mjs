// Diagram 3: the finishing-time dumbbell, drawn from ../ball-nose-3mm-vs-1-5mm/
// results.json (the same run the article quotes). Owner, 2026-09-28: "be
// artistic". Colours validated with the dataviz palette checker on #faf6ef:
// walnut rust #a0521d (1.5 mm everywhere) and teal #0a8bb0 (3 mm + rest pass),
// CVD deltaE 19, both >= 3:1. Every mark is also direct-labelled.
import fs from 'node:fs';
import sharp from 'sharp';

const OUT = 'D:/000 DIGITAL CHISEL WEBSITE/.mockups/blog-3mm-vs-1-5mm-ball-nose-relief-carving/';
const env = fs.readFileSync('D:/000 DIGITAL CHISEL WEBSITE/.env', 'utf8');
const cfg = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const U = cfg('PUBLIC_SUPABASE_URL'), K = cfg('SUPABASE_SERVICE_ROLE_KEY');
const R = JSON.parse(fs.readFileSync(new URL('../ball-nose-3mm-vs-1-5mm/results.json', import.meta.url)));
const SLUG = {
  'Leaping largemouth bass': 'leaping-largemouth-bass-fishing-cnc-relief-stl-rustic-lake-house-wall-art-outdoo',
  'Feathered fishing lure': 'ornate-feathered-fishing-lure-cnc-relief-stl-rustic-angler-wall-art-fly-fishing',
  'Coiled dragon medallion': 'coiled-medieval-dragon-medallion-cnc-relief-stl-fantasy-wall-art-panel-mythical',
  'Mallard duck arch': 'mallard-duck-landing-arch-keystone-cnc-relief-stl-wildlife-hunting-decor-backcou',
  'Rustic cross wreath': 'rustic-cross-wreath-cnc-relief-stl-christian-wall-art-panel-religious-wood-carvi',
};
const rows = R.results.filter((r) => r.size === 300).map((r) => ({
  name: r.name, slow: r.minutes.finish_1_5_10 / 60, rest: r.rest.finish_rest / 60, three: r.minutes.finish_3_10 / 60,
  zone: r.rest.restAreaPct, saved: Math.round(100 * (1 - r.rest.finish_rest / r.minutes.finish_1_5_10)),
}));
const avg = Math.round(rows.reduce((s, r) => s + r.saved, 0) / rows.length);

const W = 1600, ROW = 150, TOP = 330, H = TOP + rows.length * ROW + 150;
const X0 = 520, X1 = W - 90, HMAX = 12, xs = (hrs) => X0 + (hrs / HMAX) * (X1 - X0);
const INK = '#2e1d10', INK2 = '#6d5540', MUTED = '#9c8670', RUST = '#a0521d', TEAL = '#0a8bb0', SURF = '#faf6ef';

// round thumbnails of the real carvings
const thumbs = [];
for (const [i, r] of rows.entries()) {
  const p = (await fetch(`${U}/rest/v1/products?select=image_url&slug=eq.${SLUG[r.name]}`, { headers: { apikey: K, authorization: `Bearer ${K}` } }).then((x) => x.json()))[0];
  const src = p.image_url.replace('/object/public/', '/render/image/public/') + '?width=400&height=400&resize=cover&quality=80';
  const buf = Buffer.from(await (await fetch(src, { headers: { accept: 'image/jpeg' } })).arrayBuffer());
  const D = 108, mask = Buffer.from(`<svg width="${D}" height="${D}"><circle cx="${D / 2}" cy="${D / 2}" r="${D / 2}" fill="#fff"/></svg>`);
  const round = await sharp(buf).resize(D, D, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  thumbs.push({ input: round, left: 70, top: TOP + i * ROW + (ROW - D) / 2 - 6 });
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const h1 = (v) => `${v.toFixed(1)} h`;
let body = '';
// grid + axis
for (let t = 0; t <= HMAX; t += 2) {
  body += `<line x1="${xs(t)}" y1="${TOP - 18}" x2="${xs(t)}" y2="${TOP + rows.length * ROW - 20}" stroke="#e6dccb" stroke-width="${t === 0 ? 2 : 1}"/>`;
  body += `<text x="${xs(t)}" y="${TOP + rows.length * ROW + 14}" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="${MUTED}">${t} h</text>`;
}
rows.forEach((r, i) => {
  const cy = TOP + i * ROW + ROW / 2 - 6;
  const name = r.name.replace(/^./, (c) => c.toUpperCase());
  body += `<text x="200" y="${cy - 6}" font-family="Georgia, serif" font-size="30" fill="${INK}">${esc(name)}</text>`;
  body += `<text x="200" y="${cy + 28}" font-family="Arial, sans-serif" font-size="20" fill="${INK2}">small bit needed on ${r.zone.toFixed(1)}% of the panel</text>`;
  // dumbbell bar
  body += `<line x1="${xs(r.rest)}" y1="${cy}" x2="${xs(r.slow)}" y2="${cy}" stroke="#d9c7ae" stroke-width="10" stroke-linecap="round"/>`;
  // 3 mm only tick (ink, not a series colour)
  body += `<line x1="${xs(r.three)}" y1="${cy - 22}" x2="${xs(r.three)}" y2="${cy + 22}" stroke="${INK2}" stroke-width="3" stroke-linecap="round"/>`;
  body += `<circle cx="${xs(r.slow)}" cy="${cy}" r="17" fill="${RUST}" stroke="${SURF}" stroke-width="3"/>`;
  body += `<circle cx="${xs(r.rest)}" cy="${cy}" r="17" fill="${TEAL}" stroke="${SURF}" stroke-width="3"/>`;
  body += `<text x="${xs(r.slow) + 30}" y="${cy + 9}" font-family="Arial, sans-serif" font-size="25" font-weight="bold" fill="${INK}">${h1(r.slow)}</text>`;
  body += `<text x="${Math.min(xs(r.rest), xs(r.three)) - 28}" y="${cy + 9}" text-anchor="end" font-family="Arial, sans-serif" font-size="25" font-weight="bold" fill="${INK}">${h1(r.rest)}</text>`;
  // saving pill, centred on the bar
  const mid = (xs(r.rest) + xs(r.slow)) / 2;
  body += `<rect x="${mid - 58}" y="${cy - 52}" width="116" height="36" rx="18" fill="#e3f1f5"/>`;
  body += `<text x="${mid}" y="${cy - 26}" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="#075e78">${r.saved}% less</text>`;
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf7f0"/><stop offset="1" stop-color="#f4ece0"/></linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <text x="70" y="98" font-family="Georgia, serif" font-size="54" fill="${INK}">Rest machining nearly halves the fine finish</text>
  <text x="70" y="146" font-family="Arial, sans-serif" font-size="25" fill="${INK2}">Finishing time on a 300 mm (12 in) panel, 10% stepover, mid-size hobby CNC.</text>
  <text x="70" y="180" font-family="Arial, sans-serif" font-size="25" fill="${INK2}">Roughing takes the same time in every case and is not shown.</text>
  <text x="${W - 90}" y="112" text-anchor="end" font-family="Georgia, serif" font-size="110" fill="${TEAL}">${avg}%</text>
  <text x="${W - 90}" y="150" text-anchor="end" font-family="Arial, sans-serif" font-size="22" fill="${INK2}">less finishing time, on average</text>
  <!-- legend, always present for two series -->
  <circle cx="84" cy="252" r="13" fill="${RUST}"/><text x="108" y="260" font-family="Arial, sans-serif" font-size="23" fill="${INK}">1.5 mm ball nose over the whole panel</text>
  <circle cx="560" cy="252" r="13" fill="${TEAL}"/><text x="584" y="260" font-family="Arial, sans-serif" font-size="23" fill="${INK}">3 mm everywhere + 1.5 mm rest pass</text>
  <line x1="1040" y1="238" x2="1040" y2="266" stroke="${INK2}" stroke-width="3" stroke-linecap="round"/><text x="1056" y="260" font-family="Arial, sans-serif" font-size="23" fill="${INK}">3 mm only, for comparison</text>
  ${body}
  <text x="70" y="${H - 40}" font-family="Arial, sans-serif" font-size="20" fill="${MUTED}">Simulated from the real STL files with the DigitalChiselCo Will it cut? engine. Estimates, not stopwatch times: your machine and feeds will differ.</text>
</svg>`;
await sharp(Buffer.from(svg)).composite(thumbs).jpeg({ quality: 90 }).toFile(OUT + 'timechart.jpg');
console.log('wrote timechart.jpg', rows.map((r) => `${r.name}: ${r.saved}%`).join(', '), 'avg', avg);

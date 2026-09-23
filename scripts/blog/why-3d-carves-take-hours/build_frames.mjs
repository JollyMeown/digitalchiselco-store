// Image brief for the carve-time guide: ONE PANEL, ONE WORKSHOP, SIX FRAMES.
//
// The subject of this article is an abstract one, time, so the pictures have to
// carry the argument rather than decorate it. Every frame is the SAME carved
// panel in the SAME workshop under the SAME light, so that when two frames
// differ the reader knows the difference is the thing being explained and not
// the photography. That is the pattern that made the colouring guide and the
// tray guide work.
//
// The two comparison frames are the article's whole point: identical panels,
// one run at a fine stepover and one run coarse, so "ridges you can see" stops
// being an abstraction.
//
// House rules that must not be lost:
//   - Wood needs RAKING light, 20 to 30 degrees off the surface, or the relief
//     flattens and the ridges this article is about become invisible.
//   - Lock the OBJECT and the ROOM, state the light once, plainly. A heavy
//     camera spec makes it look like a stock render.
//   - The tool must match the cut. A ball nose leaves scallops and fine dust.
import fs from 'node:fs';

const env = fs.readFileSync('D:/000 DIGITAL CHISEL WEBSITE/.env', 'utf8');
const cfg = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const URL_BASE = cfg('PUBLIC_SUPABASE_URL');
const SERVICE = cfg('SUPABASE_SERVICE_ROLE_KEY');

// A deer relief: the article's running example, and the shop's most productive
// subject per design, so the picture sells something real.
const rows = await fetch(`${URL_BASE}/rest/v1/products?select=slug,title,image_url,mockup_url&slug=like.*whitetail*&order=etsy_sales_365.desc&limit=1`,
  { headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` } }).then((r) => r.json());
const ref = rows?.[0]?.mockup_url || rows?.[0]?.image_url;
if (!ref) { console.error('no reference design found'); process.exit(1); }
console.log('reference:', rows[0].title.split('|')[0].trim());

const LOOK = `THE SERIES LOOK, IDENTICAL IN EVERY IMAGE OF THIS ARTICLE: the SAME single object throughout, one rectangular wall panel of American black walnut, 300 mm wide, 220 mm tall and 25 mm thick, with a plain square edge. Carved into its face in deep 3D relief is the EXACT scene from image 1 and no other: the same whitetail buck in the same pose with the same antlers, the same head angle, the same forest ground behind it, every single time. The carving stands proud with about 9 mm of real depth. The walnut is warm chocolate brown with straight grain running the LONG way. Same maple workbench, same warm window light from the LEFT, same camera height just above bench level looking down at about 25 degrees, in every frame. ABSOLUTELY NO LETTERS, WORDS, NUMBERS, LABELS, LOGOS OR CARVED TEXT anywhere in the picture.`;

const REAL = `HYPER REALISTIC, A PHOTOGRAPH OF A REAL WORKSHOP, NOT A RENDER:
- Raking light. The key skims ACROSS the carved surface at about 25 degrees so every ridge and every recess throws its own shadow. Flat frontal light is forbidden: it hides exactly what these pictures exist to show.
- The walnut is real timber: colour varies across the board, a paler sapwood streak near one edge, open pores catching light, never a uniform plastic brown.
- Dust behaves like dust: fine pale particles settle in the carved hollows and cling downwind of the cutter, heavier grains sit loose on the flats.
- Light is real window light: it falls off across the bench, warmer where it lands, cooler in shadow, never even.
- Nothing is perfectly aligned and the dust is not artfully arranged.
NEVER: no CGI sheen, no plastic wood, no spotless machine, no symmetrical scattered dust, no glowing edges, no lens flare, no text or logos.`;

const HOLD = `WORKHOLDING, VISIBLE AND CORRECT: the walnut sits on a used MDF spoilboard and is held by FOUR low-profile cast-iron step clamps, one near each corner, each bolted into a T-slot, pads pressing on the waste margin clear of the carving. Nothing floats.`;

const FRAMES = [
  ['cover', '16:9', 'A carved whitetail deer relief panel on a workbench in raking window light',
   `THE COVER: the finished carved panel lying on the maple bench, photographed so the raking light rips across the antlers and the shoulder and every carved surface shows its depth. A 3 mm ball nose cutter and a folded sheet of abrasive lie beside it, not arranged. Quiet, warm, and unmistakably a real carved object. The story is: this took hours, and it did not have to.`],

  ['finishing', '16:9', 'A ball nose cutter part way through the finishing pass, half the deer smooth and half still stepped',
   `${HOLD}\n\nTHE FINISHING PASS, MID JOB: the spindle holds a small round-tipped BALL NOSE and is tracing across the deer. The half it has already passed is SMOOTH and fully modelled, fur and antler detail soft and rounded. The far half still shows the stacked stepped terraces left by the roughing cutter, with no detail at all. Because this is a finishing pass the waste is FINE PALE DUST, not curls, lifting off the cutter and settling into the hollows. The story is: this one pass is the entire job, and everything else is rounding error.`],

  ['fine', '4:5', 'Close detail of the deer carved at a fine stepover, the surface smooth and even',
   `EXTREME CLOSE DETAIL, FINE STEPOVER: fill the frame with the buck's shoulder and the base of the antlers, seen from close range in hard raking light. This piece was cut at a FINE stepover, so the surface is SMOOTH and even: the curve reads as one continuous form and any tool marks are far too small to see at this distance. The wood grain is the only texture. The story is: this is what the extra hours bought.`],

  ['coarse', '4:5', 'The identical detail carved at a coarse stepover, showing visible parallel ridges',
   `EXTREME CLOSE DETAIL, COARSE STEPOVER, THE SAME SHOULDER AND ANTLER BASE FROM THE SAME DISTANCE AND THE SAME ANGLE AS THE PREVIOUS FRAME: identical composition, identical light, identical crop. The ONE difference is the surface: this piece was cut at a coarse stepover, so it carries clear PARALLEL RIDGES marching across the curved surface like the grooves of a record, catching the raking light along every crest. The ridges are obvious but shallow. The story is: this is what you can see, and this is what sanding has to remove.`],

  ['bits', '16:9', 'Two carbide ball nose cutters lying side by side on the workbench',
   `TOOLS ONLY. There is NO wooden panel and NO carving anywhere in this frame: the bench top is bare. Two solid carbide CNC router cutters lie side by side on the maple bench in raking light, large and close in the frame, each about the size of a pencil. Each has a bright ground steel shank at one end and a fluted cutting end with a small ROUNDED hemispherical tip. Real used tooling: fine grinding marks, faint spiral flutes, a dusting of pale wood dust, a soft shadow under each. Shot from just above bench level so both silhouettes read clearly against the wood. The story is: two cutters, two different jobs.`],
  ['sanding', '16:9', 'A sanding block and folded abrasive on the carved panel, ridges partly removed',
   `SANDING, HALF DONE: the carved panel on the bench with a flat cork sanding block wrapped in abrasive resting on one part of the open ground area, and a folded strip of worn 220 grit beside it. Where the block has worked, the surface is clean and even; the untouched area beside it still shows faint parallel ridges. Fine pale sanding dust sits in the carved hollows. A soft brass brush lies nearby. The story is: this is how small a ridge has to be before sanding beats waiting.`],
];

// The shared SERIES LOOK insists the carved panel appears in every frame, which
// is right for five of the six and wrong for the tools frame: it kept dragging
// the panel back in however firmly the scene said "tools only". The bench and
// the light still come from REAL, so the frame still belongs to the set.
const NO_PANEL = new Set(['bits']);

const frames = FRAMES.map(([key, aspect, alt, stage]) => ({
  key, aspect, alt,
  scene: [NO_PANEL.has(key) ? null : LOOK, REAL, stage].filter(Boolean).join('\n\n'),
  finish: false,
  hands: false,
  bench: true,
  // ref:null drops the "image 1 is the product" preamble entirely. With the
  // deer photo attached, the model put the carving back into the tools frame
  // every time, whatever the words said. The picture wins over the prose.
  ref: NO_PANEL.has(key) ? null : ref,
}));

fs.writeFileSync(new URL('./frames.json', import.meta.url), JSON.stringify(frames, null, 1));
console.log(`frames.json written: ${frames.length} frames`);
frames.forEach((f, i) => console.log(`  ${i + 1}. ${f.key}  (${f.aspect})`));

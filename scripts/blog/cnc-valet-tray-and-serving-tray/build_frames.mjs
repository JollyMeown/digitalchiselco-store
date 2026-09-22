// Image brief for the tray guide: ONE TRAY, EIGHT STAGES.
//
// Owner, 2026-09-22: "we will show transition from 3d model to gradual
// different steps to the finishing". That is the structure that made
// how-to-color-a-cnc-relief-carving work: the same object photographed
// through its stages, not five unrelated views of a finished thing.
//
// It also solves the hardest rendering problem. Showing "half roughed, half
// finished" inside one frame is unreliable; showing roughing in one frame and
// finishing in the next is both easier to generate and clearer to read.
//
// What was learned the hard way and must not be lost:
//   - A heavy camera spec (90mm macro, f/5.6, fill ratios) makes it look like
//     a stock render. Lock the OBJECT and the ROOM instead, and state the
//     light once, plainly. That is what the colouring post did.
//   - Workholding must be visible and correct. A board being pocketed is held.
//   - The TOOL must match the CUT. A flat end mill leaves stepped terraces and
//     throws big curls. A ball nose leaves smooth 3D form and throws fine dust.
//     Mixing them is the error a CNC owner spots first.
import fs from 'node:fs';

const env = fs.readFileSync('D:/000 DIGITAL CHISEL WEBSITE/.env', 'utf8');
const cfg = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const URL_BASE = cfg('PUBLIC_SUPABASE_URL');
const SERVICE = cfg('SUPABASE_SERVICE_ROLE_KEY');

const slugs = [
  'highland-cow-tray-stl-file-for-cnc-router',
  'largemouth-bass-fishing-lure-valet-tray-cnc-relief-stl-rustic-cabin-decor-wood-c',
];
const rows = await fetch(`${URL_BASE}/rest/v1/products?select=slug,image_url,mockup_url&slug=in.(${slugs.join(',')})`,
  { headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` } }).then((r) => r.json());
const pick = (f) => { const r = rows.find((x) => x.slug.includes(f)); return r?.mockup_url || r?.image_url; };
const bass = pick('largemouth'), cow = pick('highland');
if (!bass || !cow) { console.error('reference images not found'); process.exit(1); }

const LOOK = `THE SERIES LOOK, IDENTICAL IN EVERY IMAGE OF THIS ARTICLE: the SAME single object throughout, a shallow rectangular VALET TRAY machined from one solid board of American black walnut, 23 cm long, 15 cm wide and 25 mm thick, with softly radiused corners. It has ONE main recessed pocket 14 mm deep with the carving in its floor, and TWO smaller plain rounded wells along the right-hand end for keys and coins. THE RIM IS NOT PLAIN: a broad hand-hewn border runs right around the outside of the tray, carved with overlapping chisel facets, fish-scale texture and water-ripple lines, exactly as in image 1. Inside the main pocket is the EXACT carved scene from image 1 and no other: the same largemouth bass standing proud as a deep relief carving in the same pose, the same fishing lure above it, the same water rings behind it, every single time. The walnut is warm chocolate brown with straight grain running the LONG way along the tray. Same maple workbench, same warm window light coming from the LEFT, same camera height just above bench level looking down at about 25 degrees, in every frame. ABSOLUTELY NO LETTERS, WORDS, NUMBERS, LABELS, LOGOS OR CARVED TEXT anywhere in the picture.`;

const HOLD = `WORKHOLDING, VISIBLE AND CORRECT: the walnut board sits on a used MDF spoilboard and is held by FOUR low-profile cast-iron step clamps, one near each corner, each bolted into a T-slot, their pads pressing on the waste margin well clear of the tray outline. The board is visibly larger than the tray so the clamps have material to sit on. Nothing floats.`;

const REAL = `HYPER REALISTIC, A PHOTOGRAPH OF A REAL WORKSHOP, NOT A RENDER:
- The MDF spoilboard is used, not new: faint older toolpath scars, stray screw holes, dust ground into the T-slot edges.
- The cast-iron clamps are worn tools: casting texture, faint surface rust, bright polished wear where the pad meets wood.
- The walnut is real timber: colour varies across the board, a paler sapwood streak near one edge, open pores catching light, never a uniform plastic brown.
- Dust behaves like dust: fine particles cling in the carved hollows, heavier grains sit loose on flats, more downwind of the cutter than upwind.
- Light is real window light: it falls off across the bench, warmer where it lands, cooler in shadow, never even.
- Nothing is perfectly aligned and the dust is not artfully arranged.
NEVER: no CGI sheen, no plastic wood, no spotless machine, no symmetrical scattered dust, no glowing edges, no text or logos.`;

// Owner, 2026-09-22: "make the pictures real pixel perfect". Added AFTER the
// model and roughing frames were approved, so it is deliberately ADDITIVE: it
// sharpens what a real camera would resolve and says nothing about lighting or
// camera position, which stay exactly as the two approved frames set them.
const SHARP = `PIXEL-LEVEL REALISM, RESOLVE THE DETAIL A REAL CAMERA WOULD RECORD:
- Focus sits on the carving in the pocket and is genuinely crisp there. The far end of the bench falls gently out of focus. Nothing is soft where it should be sharp.
- Walnut pores read as actual open pores at this distance, not a texture: fine dark flecks in rows following the grain, catching light on the raked side.
- Every machined surface carries its own tool signature. Scallop ridges are fine but countable where light rakes across them, never a smooth polished shell.
- Edges are real edges: microscopic chipping along sharp arrises, a hair of tearout where the grain runs out, never a clean vector line.
- Metal is used metal: fingerprints, faint scratches, dulled corners, never showroom chrome.
- Dust sits at true scale: individual coarse grains readable on the flats, a fine even film over everything else.
- Shadows have soft edges that spread with distance, and a warm bounce lifts the shadow side off the bench. No crushed blacks, no glow.
- The faint grain of a real photograph is present in the shadows. Not digital noise, not a clean render.`;

// ── the eight stages, in order ───────────────────────────────────────────
const STAGES = [
  ['model', 'The 3D model on screen before a single chip is cut',
   `THIS FRAME, STAGE 1 OF 8: THE MODEL, BEFORE ANY CUTTING. NOTHING HAS BEEN CUT YET, so the bench is CLEAN: no chips, no shavings, no sawdust anywhere, a swept maple benchtop. A plain black-bezel computer monitor with NO brand badge stands on the bench beside the idle CNC machine, showing ONLY a full-screen 3D view of this exact tray as a shaded grey digital relief on a dark background, with the toolpath lines visible as fine coloured tracks over the model. The screen shows the model and the toolpaths and NOTHING ELSE: no menus, no toolbars, no taskbar, no icons, no windows, no readable interface of any kind, just the model filling the display. In the foreground, softer, lies the RAW UNCUT walnut board, plain, blank and untouched, with the two cutters resting on it side by side so their tips can be compared: a square-tipped flat end mill and a smaller round-tipped ball nose. The story is: this is all that exists so far, a file and a plank. Warm window light from the left, the screen glow cool against it.`],

  ['roughing', 'A flat end mill roughing out the pocket, leaving stepped terraces and heavy curls',
   `THIS FRAME, STAGE 2 OF 8: ROUGHING. The spindle holds a FLAT END MILL, square-tipped, and it is hogging out the main pocket. The pocket is part cleared and the cut surface is visibly STEPPED: shallow terraces stacked like contour lines where the flat cutter has taken the material in layers, and the shape of the bass is only just readable as a blocky stepped mass with no detail at all. Because this is a roughing cut with a flat cutter, the waste is BIG CURLED CHIPS, thick pale walnut shavings springing off the cutter and piling on the spoilboard. Nothing is smooth yet. The story is: the shape is there, the carving is not.`],

  ['finishing', 'A ball nose running the 3D finishing pass, the carving turning smooth behind the cutter',
   `THIS FRAME, STAGE 3 OF 8: FINISHING. CRITICAL: THE TRAY HAS NOT BEEN CUT OUT YET. It is still buried in the middle of the big rectangular walnut board, with a wide flat margin of uncut waste wood all around it and no free rounded outside edge anywhere. The outside profile is not cut until stage 4, so the tray must NOT look like a loose finished object sitting on the bench. The spindle holds a small round-tipped BALL NOSE cutter, clearly different from the flat end mill, which lies set down on the spoilboard beside the work so the two tools can be compared. The ball nose is tracing across the bass and the hewn border, and the carving is becoming SMOOTH and fully modelled where it has passed: scales, fins and chisel facets crisp and rounded on the near half. The FAR half is still raw stage-2 work, stacked stepped terraces with no detail at all, so the two halves are obviously different. Because this is a finishing pass, the waste is FINE PALE DUST, not curls: a light plume lifting off the cutter and settling into the carved hollows. The four step clamps are bolted down on that waste margin with their pads pressing hard on the wood. The story is: this is the pass that makes it a carving.`],

  ['tabs', 'The finished tray still joined to the waste board by small tabs, a flush saw beside it',
   `THIS FRAME, STAGE 4 OF 8: CUTTING IT FREE. The machine is stopped and the spindle parked aside. The tray is fully carved but still attached to the surrounding waste board by six small TABS, thin bridges of walnut about 6 mm wide left in the profile cut, clearly visible around the outside edge. A Japanese flush-cut saw lies across the board ready to sever them. Sawdust everywhere, the clamps still in place. The story is: it is cut but not yet free.`],

  ['sanding', 'The freed tray sanded raw and pale, a sanding block and folded paper beside it',
   `THIS FRAME, STAGE 5 OF 8: SANDED RAW. The tray is now free of the waste, off the machine, sitting on the bare maple workbench. It is sanded but UNFINISHED: the walnut looks pale, dry, dusty and flat, noticeably lighter and duller than it will be once oiled, with fine sanding dust in the carved recesses. Beside it lie a flat cork sanding block with paper wrapped around it, a folded strip of 220 grit, and a soft brass brush for the carving. The story is: this is the dullest it will ever look.`],

  ['oiling', 'Oil going onto one half of the tray, the walnut turning deep brown where the cloth has passed',
   `THIS FRAME, STAGE 6 OF 8: THE OIL, MID-APPLICATION. This is the money shot of the whole sequence and the split must be obvious: one half of the tray has been oiled and is DEEP RICH CHOCOLATE BROWN with the grain blazing and the carving popping into depth, while the other half is still RAW, pale and dry from stage 5. The line between wet and dry runs across the tray. A cloth darkened with oil rests where the application stopped, a small open tin of mineral oil and beeswax beside it, one fingerprint in the wax. The story is: this is the moment walnut becomes walnut.`],

  ['hero', 'The finished tray on a bedside table at dusk holding a watch, keys and a folding knife',
   `THIS FRAME, STAGE 7 OF 8: IN USE. The finished, fully oiled tray now sits on a walnut bedside table at dusk, holding a mechanical wristwatch on a tan leather strap, a small bunch of brass keys in one of the small wells, and a closed folding knife in the other, dropped in as if just emptied from a pocket rather than arranged neatly. The carved bass stays clearly visible in the main pocket. A warm bedside lamp just out of frame on the left, cool blue evening light through a window behind, a corner of soft linen bedding out of focus in the near foreground. The story is: this is what it was for.`],

  ['serving', 'The larger compartment serving tray holding olives, nuts and cheese on linen',
   `THIS FRAME, STAGE 8 OF 8: WHERE IT LEADS. The larger COMPARTMENT SERVING TRAY, about 38 cm long, in the same walnut and the same hand: several separate SMOOTH-FLOORED wells divided by generous walnut ribs about 10 mm thick, with the carved scene from image 1 worked into the surface between the wells. The wells hold green olives, almonds, small cubes of hard cheese and a few dark grapes, filled casually rather than styled. It rests on a rumpled natural linen cloth on a pale oak table in late evening light, a glass of red wine soft behind. The story is: once you can cut one pocket, you can cut five.`],
];

// The article template prints meta.cover as a 16:9 banner ABOVE the body, so
// the cover cannot be one of the eight or the reader meets the same photograph
// twice on one page. Same tray, same hand, different room and different hour
// from the stage 7 dusk bedside shot.
STAGES.push(['cover', 'A finished walnut valet tray on a hall console by the front door, keys just dropped in',
  `NOT A STAGE, THE COVER PHOTOGRAPH: the finished, fully oiled tray sits on a dark walnut hall console beside a front door in flat clear MORNING light, not dusk. A set of keys has just been dropped into one of the small wells and still lies where it fell. The light rakes low across the tray so the hewn border and the carved bass throw real shadow and the grain reads all the way across. Composition is wide and calm with the tray sitting off to one side and quiet empty space beside it: a folded newspaper and a pair of reading glasses far back and well out of focus, a plain wall above. The story is: this is the finished object, and this is where it lives.`]);

// Machine stages need the workholding; bench and room stages do not.
const ON_MACHINE = new Set(['roughing', 'finishing', 'tabs']);
const IN_ROOM = new Set(['hero', 'serving', 'cover']);

const frames = STAGES.map(([key, alt, stage]) => ({
  key,
  aspect: '16:9',
  alt,
  scene: [LOOK, ON_MACHINE.has(key) ? HOLD : null, REAL, SHARP, stage].filter(Boolean).join('\n\n'),
  finish: false,
  hands: false,
  bench: !IN_ROOM.has(key),
  ref: key === 'serving' ? cow : bass,
}));

fs.writeFileSync(new URL('./frames.json', import.meta.url), JSON.stringify(frames, null, 1));
console.log(`frames.json written: ${frames.length} stages`);
frames.forEach((f, i) => console.log(`  ${i + 1}. ${f.key}`));

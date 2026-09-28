// Image brief for the stepover guide: ONE LEAPING BASS PANEL, the real
// catalogue design `leaping-largemouth-bass-fishing-cnc-relief-stl...`,
// carried through every frame. Owner, 2026-09-28: hyper realistic, pro model,
// shown ONE BY ONE; frames are added to STAGES as they are approved.
//
// The ridge heights and times in the article come from sim.mjs (results.json).
// The ridge comparison is DRAWN from the simulation, never generated.
// Photography brief per [[product-photography-standard]].
import fs from 'node:fs';

// g2: the raw, unfinished render of the whole panel, square-on
const BASS = 'https://tutalnieozbngrsfywes.supabase.co/storage/v1/object/public/site-media/products/leaping-largemouth-bass-fishing-cnc-relief-stl-rustic-lake-house-wall-art-outdoo-g2-jj9dxvoz.jpg';

const LOOK = `THE SERIES LOOK, IDENTICAL IN EVERY IMAGE OF THIS ARTICLE: the SAME single object throughout, the carved panel in image 1 and no other. A SQUARE panel about 30 cm across with a raised flat border frame all round. Inside it, carved in relief, is the EXACT scene from image 1 in the EXACT same layout: a largemouth bass LEAPING from the water, body arched, mouth wide open, head at the UPPER LEFT reaching toward a small fishing lure at the top left corner, tail and fins lower right; rippling water and a splash across the lower third; lily pads and a water-lily flower at the LOWER LEFT. Every scale, fin ray, ripple and lily pad where image 1 has it. LAYOUT COPIED FROM IMAGE 1 AS IF TRACED (take 1 re-posed the fish): the fish's body runs DIAGONALLY from the tail at the lower RIGHT up to the open mouth at the UPPER LEFT; the lure hangs in the top-left corner just in front of the mouth; the lily pads and flower sit in the LOWER LEFT corner; the splash and ripples fill the bottom edge. The fish never points straight up and the lily pads are never at the top. The wood is pale HARD MAPLE, creamy white with faint grain running top to bottom. ABSOLUTELY NO LETTERS, WORDS, NUMBERS, LABELS, LOGOS OR ENGRAVED TEXT anywhere.`;

const REAL = `HYPER REALISTIC, A PHOTOGRAPH, NOT A RENDER:
- The maple is real timber: faint colour variation, fine grain, the odd tiny fleck, never plastic.
- Edges are real edges: the odd tiny chip along a sharp arris, never a clean vector line.
- Dust behaves like dust: fine pale powder in the deepest hollows, never artfully arranged.
- Light is real light: it falls off across the frame, warmer where it lands, cooler in shadow.
NEVER: no CGI sheen, no plastic wood, no perfect symmetry, no lens flare, no bokeh balls, no glow, no HDR halos, no oversharpening, no text or logos.`;

const HOLD = `ON THE MACHINE, WORKHOLDING VISIBLE AND CORRECT: the maple board sits on a hobby gantry CNC router, on a used MDF spoilboard with faint older toolpath scars, held by FOUR low-profile black step clamps, one at EACH CORNER, every clamp's nose RESTING ON TOP OF the maple board's corner and its bolt going into the spoilboard just outside the board. No clamp sits loose beside the board. The spindle is a plain matte grey cylinder in a plain aluminium mount: NO brand, NO label, NO sticker, NO writing anywhere on the machine or anything else in frame.`;

const CUTTER = `THE CUTTER: a 3 mm BALL NOSE end mill: a dark gunmetal 6 mm shank in the collet, stepping down to a short straight BRONZE / COPPER coated cutting section 3 mm wide with TWO clean evenly spaced spiral flutes, ending in a round tip. Real, used, no markings.`;

const GRADE = `GRADE: filmic, gentle highlight roll-off, open blacks that never crush, restrained saturation, the fine grain of a real photograph in the shadows.`;

const STAGES = [
  // APPROVED 2026-09-28 (take 2: layout traced, ridges only on the carved surface)
  ['hero', 'A freshly machined maple bass relief under low raking light, fine parallel tool ridges visible across the smooth water',
   `THIS FRAME, THE COVER: THE RIDGES. THE STORY IS: every CNC carving comes off the machine covered in fine parallel ridges, and the stepover decides how big they are.
WHAT IS IN FRAME: the panel lies FLAT on a workbench, just off the machine, NOT sanded, NOT finished: raw pale maple with a little fine dust in the deepest hollows. Across the CARVED surfaces INSIDE the frame, most clearly the calm water background and the smooth flank of the fish, run FINE, EVENLY SPACED PARALLEL RIDGES left by a ball nose cutter, like the lines of a vinyl record or corduroy fabric, all running in ONE direction, LEFT TO RIGHT across the panel, about three quarters of a millimetre apart. The grazing light makes each ridge throw a hair-fine shadow so the texture is unmistakable, strongest on the calm water around the fish, softer on its curved body. The raised FRAME BORDER'S top and the board's four OUTER SIDES are plain flat sawn wood with NO ridges and NO grooves at all (take 1 wrongly fluted the outer edges; a finishing pass never touches them).
COMPOSITION: camera LOW, only about 15 degrees above the bench, close, from the lower right corner of the panel looking across it, so the ridges on the water in the foreground are sharp and large and the leaping bass rises behind them in the upper middle. The WHOLE fish is in frame; the near corner of the frame border is in the foreground.
LIGHT: ONE hard, low light: a warm 3200 K lamp from the LEFT at only 5 to 10 degrees above the surface, GRAZING across it so every ridge and every scale throws a shadow. No fill at all on the right: the far side falls into deep shadow. The workshop behind is dark, about four stops under.
CAMERA: full-frame, 100 mm macro lens at f/11 for depth, ISO 200, tripod. Focus on the ridges of the calm water just in front of the fish. AVOID any frontal or overhead light: it hides the ridges, which are the whole point.
STYLING: a dark oiled workbench; the only prop, soft and to one side, is a 3 mm ball nose end mill (dark gunmetal shank, bronze-coated fluted end with spiral flutes, round tip) lying on the bench. Nothing else.`],
  // APPROVED 2026-09-28 (take 4, camera steep per the owner)
  ['passes', 'A 3 mm ball nose laying down parallel finishing passes across the maple bass, the stepover visible as evenly spaced lines',
   `THIS FRAME: THE PASSES. THE STORY IS: the cutter lays the surface down one straight line at a time, and the stepover is simply the distance between those lines.
WHAT IS HAPPENING: the spindle holds the 3 mm ball nose described above, lowered into the carving and cutting, part way along ONE straight pass running LEFT TO RIGHT across the panel. Everywhere the cutter has already been, the surface is fully carved and covered in FINE, STRAIGHT, EVENLY SPACED PARALLEL LINES running left to right, one per pass, clearly visible in the raking light on the water and the flat of the fish, about three quarters of a millimetre apart, like a vinyl record's grooves. A faint wisp of very fine pale dust at the tip, NO chips, NO curls.
COMPOSITION (owner, take 2: 'move the camera a bit high and closer'): camera HIGH, at 70 DEGREES above the board (owner, take 3: 'camera to be at 70 degree'), looking steeply DOWN onto it, and CLOSE: the carved panel fills most of the frame, only a thin margin of the clamps and spoilboard visible around it, the cutter large and sharp. Seen from the FRONT, slightly to the left, the board the RIGHT WAY UP exactly as image 1 is drawn: lure top left, open mouth reaching for it, body diagonal down to the tail at lower right, lily pads lower left. The cutter and the fish's head sit on the upper-left third, sharp. The parallel pass lines on the water fill the lower half of the frame, large enough to count. The clamps may be partly cut off by the frame edge, but any clamp in view rests on the board's corner.
LIGHT: because the camera looks steeply down, the light must do all the modelling: warm 3000 K work light from the LEFT and VERY LOW, about 10 degrees above the board, raking ACROSS the lines so each one throws a hair-fine shadow; cool 5500 K window light from the far right as fill at a quarter of the key; the machine frame behind two stops under.
CAMERA: full-frame, 100 mm macro lens at f/11, ISO 400, 1/250 s, close: the spinning cutter shows a faint blur ring, the lines are crisp across the whole panel. Focus on the cutter tip and the lines just behind it.
STYLING: a real, used hobby workshop, soft behind: the gantry, a dust boot raised on its bracket, a plain grey dust hose. No people, no appliances.`],
  // APPROVED 2026-09-28 (take 3: a real brass wire brush, sandpaper grit side up)
  ['brush', 'Hands brushing the tool ridges off the maple bass carving with a brass brush, one half smooth and one half still ridged',
   `THIS FRAME: TAKING THE RIDGES OFF. THE STORY IS: the ridges the stepover leaves are not permanent; a brass brush and a little sanding take them off, and how much work that is decides how big a stepover you can use.
WHAT IS IN FRAME: the panel is OFF the machine now, lying flat on a plain maple workbench, the same raw pale maple, the RIGHT WAY UP exactly as image 1 (lure top left, open mouth reaching for it, body diagonal down to the tail at lower right, lily pads lower left). A pair of real adult working hands holds a small BRASS WIRE BRUSH: a flat, slightly curved plain wooden block handle about 18 cm long with rows of short, stiff, golden BRASS WIRE bristles set straight into its underside, like a suede or detail wire brush. NOT a paint brush, NO metal ferrule, NO printing anywhere (take 2 wrongly drew a paint brush with lettering on its ferrule). The hand brushes it along the calm water just below the fish. The water on the LEFT of the brush, where it has already been, is SMOOTH and soft-looking, the ridges gone; the water on the RIGHT, still to do, shows the fine, straight, evenly spaced parallel ridges running left to right, so the before and after sit side by side in one glance. A light haze of fine pale dust lifts from the bristles.
BESIDE THE PANEL ON THE BENCH: a strip of 220 grit sandpaper lying FLAT with its GRITTY ABRASIVE SIDE UP, a plain uniform sandy surface; its paper back is NOT visible at all (take 1 showed printed numbers on the back), a small pale grey foam sanding sponge, and a soft dusting brush. Nothing else.
COMPOSITION: camera about 45 degrees above the bench, close, from the front; the brush, the hands and the smooth/ridged boundary on the water sit on the lower-right third, sharp; the fish rises behind them, slightly soft. Hands never hide the fish's head.
LIGHT: warm 3000 K light from the LEFT and LOW, about 12 degrees above the bench, raking across the ridges so they read clearly on the unbrushed side and vanish on the brushed side; soft cool daylight fill from the right at a quarter of the key.
CAMERA: full-frame, 85 mm lens at f/8, ISO 400, tripod. Focus on the brush bristles and the boundary between smooth and ridged water.
STYLING: a quiet, clean corner of the workshop after the machine is off; the bench lightly dusty.`],
  // APPROVED 2026-09-28 (take 1)
  ['lakehouse', 'The finished maple bass relief hanging on a cabin wall at golden hour, the lake glowing through the window',
   `THIS FRAME: WHERE IT LEADS. THE STORY IS: the ridges are gone, the carving is finished, and it lives by the water.
WHAT IS IN FRAME: the SAME panel, now FINISHED: the maple oiled to a warm HONEY tone, with a darker brown glaze settled into every recess so the scales, fins, ripples and lily pads read crisply. SMOOTH: no tool ridges anywhere. The WHOLE panel is visible with a margin of wall around it, NOTHING cut off, hanging upright the RIGHT WAY UP exactly as image 1 (lure top left, open mouth reaching for it, body diagonal down to the tail at lower right, lily pads lower left) on a weathered grey-green BOARD-AND-BATTEN cabin wall.
BELOW IT: a low rustic pine console with an old wicker fishing creel and a small tarnished brass lantern, both plain, NO labels, NO brand, NO lettering.
TO THE RIGHT: part of a window with a simple wooden frame, through which a calm lake glows at golden hour, soft and out of focus.
LIGHT: warm 3000 K golden-hour sun from the window on the RIGHT, low, raking ACROSS the carving from the side so every scale and ripple throws a small shadow; the room's cooler 6000 K shade on the left; the lantern unlit. Expose for the carving; the window's brightest sky may bloom softly but the panel never clips.
CAMERA: full-frame, 50 mm lens at f/4, ISO 400, tripod, at the height of the panel's centre, about 20 degrees to its LEFT so the side light reads as depth. Focus on the fish's eye. The panel sits on the LEFT third, the window on the right.
MOOD: calm, warm, evening quiet at a lake cabin. NO text anywhere, no people.`],
];

const ON_MACHINE = new Set(['passes']);


// Owner, 2026-09-28: "use gemini image to make it real". The ridge study stays
// SIMULATED: draw_surface.mjs renders the real bass surface (eye and gill) at
// each stepover from the engine, and Gemini only photographs THAT surface as
// maple. Composed into one labelled grid by compose_surfaces.mjs; these four are
// not published on their own.
const SURF = (pct, s, h) => ({
  key: `ph${pct}`,
  aspect: '1:1',
  alt: `Photo-real rendering of the simulated bass surface at ${pct} percent stepover`,
  scene: `IMAGE 1 IS A PRECISE HEIGHT-MAP RENDER OF A REAL CNC-CARVED SURFACE, NOT INSPIRATION: a close-up of the eye and gill area of a carved largemouth bass, about 46 mm across, finished with a 3 mm ball nose at ${pct} percent stepover (passes ${s} mm apart, ridges ${h} mm high). Photograph THIS EXACT SURFACE as a real macro photograph of freshly machined, UNSANDED raw hard maple.
FIDELITY, HARD RULE: keep every contour exactly where image 1 has it: the round eye with its rings, the gill cover curves, the scale texture, the fin edges at the left. Keep EVERY straight horizontal TOOL RIDGE exactly as image 1 shows it: the same spacing, the same horizontal direction, the SAME STRENGTH. Do NOT add ridges, remove ridges, straighten, soften or exaggerate them, and do not invent any texture image 1 does not have. Only the material and the light change. THE RIDGES ARE THE SUBJECT OF THIS PICTURE (take 1 softened them until every stepover looked the same): wherever image 1 shows a line, the photograph shows a real machined ridge of the SAME contrast, across the WHOLE patch, over the eye, the scales and the flat areas alike, never only in one corner.
MATERIAL: pale creamy hard maple, faint fine grain running left to right, the dry matte surface of wood straight off the machine, a trace of fine dust in the deepest recess only.
LIGHT: the same direction as image 1: a warm 3200 K light from the UPPER LEFT and low, raking across the surface so the ridges read exactly as strongly as in image 1; no other light.
CAMERA: square 1:1 frame filled edge to edge with the surface, full-frame 100 mm macro at f/11, ISO 100, the whole patch sharp.
NEVER: no text, no labels, no numbers, no frame, no background, no tools, no hands.`,
  finish: false, hands: false, bench: false,
  ref: `D:/000 DIGITAL CHISEL WEBSITE/.mockups/blog-cnc-relief-stepover-guide/surf_${pct}.jpg`,
});

const frames = STAGES.map(([key, alt, stage]) => ({
  key,
  aspect: '16:9',
  alt,
  scene: [LOOK, ON_MACHINE.has(key) ? HOLD : null, ON_MACHINE.has(key) ? CUTTER : null, REAL, stage, GRADE].filter(Boolean).join('\n\n'),
  finish: false,
  hands: key === 'brush',
  bench: false,
  ref: BASS,
}));

frames.push(SURF(8, '0.24', '0.005'), SURF(15, '0.45', '0.017'), SURF(25, '0.75', '0.048'), SURF(40, '1.20', '0.125'));
// Published set: the four approved photographs plus the three DRAWN diagrams
// (approved 2026-09-28). The ph* tiles only feed compose_surfaces.py; pass
// --all to list them for regeneration.
if (!process.argv.includes('--all')) {
  for (let i = frames.length - 1; i >= 0; i--) if (frames[i].key.startsWith('ph')) frames.splice(i, 1);
  frames.push(
    { key: 'scallop', alt: 'Diagram of how a 3 mm ball nose leaves ridges at 10 and 25 percent stepover, magnified against what 220 grit removes', scene: 'DRAWN by draw_scallop.mjs' },
    { key: 'surfaces', alt: 'The eye of the carved bass straight off the machine at 8, 15, 25 and 40 percent stepover', scene: 'COMPOSED by compose_surfaces.py from the simulation and a Gemini material photo' },
    { key: 'timeridge', alt: 'Chart of finishing time against ridge height for 1.5, 3 and 6 mm ball nose bits', scene: 'DRAWN by draw_chart.mjs' },
  );
}
fs.writeFileSync(new URL('./frames.json', import.meta.url), JSON.stringify(frames, null, 1));
console.log(`frames.json written: ${frames.map((f) => f.key).join(', ')}`);

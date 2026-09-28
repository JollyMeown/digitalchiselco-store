// Image brief for "3 mm vs 1.5 mm ball nose": ONE DRAGON MEDALLION, the real
// catalogue design `coiled-medieval-dragon-medallion...`, carried through
// every frame (the standard the owner set on the colouring guide).
//
// Owner, 2026-09-28: hyper realistic, high-end Gemini model, shown ONE BY ONE,
// the next only after the previous is approved. So frames are added to STAGES
// as they are approved; run with --only <key>.
//
// The numbers in the article come from the simulation (../ball-nose-3mm-vs-1-5mm/
// results.json), and the side-by-side detail comparison is DRAWN from that
// simulation, never generated: a generated "3 mm result vs 1.5 mm result" would
// be a fake test. These photographs illustrate; they prove nothing.
//
// Photography brief per [[product-photography-standard]]: light plan, colour
// temperature contrast, camera, composition, styling, grade + negative list.
import fs from 'node:fs';

// g1: the whole medallion on its board, square-on, the clearest reference
const DRAGON = 'https://tutalnieozbngrsfywes.supabase.co/storage/v1/object/public/site-media/products/coiled-medieval-dragon-medallion-cnc-relief-stl-fantasy-wall-art-panel-mythical-g1-scg4l98a.jpg';

const LOOK = `THE SERIES LOOK, IDENTICAL IN EVERY IMAGE OF THIS ARTICLE: the SAME single object throughout, the carved panel in image 1 and no other. A rectangular board, a little taller than wide, about 30 cm tall, with a deep ROUND recessed medallion taking up most of it. The medallion's rim is a hand-hewn border of small overlapping chisel facets, a scalloped ring of tool marks exactly as in image 1, never a smooth machined step. Inside it, carved in deep relief, is the EXACT dragon from image 1 in the EXACT same pose: head top-left in profile facing left, both wings raised and curving round the inside of the circle, the scaled neck and chest, the tail coiling into a tight spiral at lower left and sweeping round the bottom of the medallion, the clawed foot lower right. Every scale, wing rib and claw where image 1 has it. The wood is warm mid-brown oiled walnut with its grain running top to bottom, exactly the colour and satin sheen of image 1. ABSOLUTELY NO LETTERS, WORDS, NUMBERS, LABELS, LOGOS OR ENGRAVED TEXT anywhere, including on the cutters.`;

// Take 1 (2026-09-28) drew the small cutter as a flute-less needle and put the
// bigger tip on the thicker shank. Both now share ONE shank size so the only
// difference is the cutting end, which is what the article is about.
// Owner, 2026-09-28, sent a photo of real bits "for better rendering
// reference": bronze-coated tapered ball noses on dark gunmetal shanks. The
// pasted image never reached disk, so it is described here as it appears.
const CUTTERS = `THE CUTTERS LOOK EXACTLY LIKE REAL COATED SOLID-CARBIDE BALL NOSE END MILLS: the plain round SHANK is dark GUNMETAL grey carbide, smooth and satin, and the whole FLUTED cutting part is coated in a warm BRONZE / COPPER coating (the AlTiN-type coating on quality carving bits), with a clean crisp line where the dark shank ends and the bronze begins. TWO tight SPIRAL FLUTES wind up the bronze part, each with a sharp bright cutting edge catching a thin line of light, and the flutes end in a perfectly HALF-ROUND BALL tip, also bronze.
(1) the 3 mm BALL NOSE: a 6 mm (1/4 inch) gunmetal shank stepping down through a short bronze neck to a straight CYLINDRICAL bronze fluted section 3 mm wide and about 12 mm long, ending in a round tip 3 mm across.
(2) the 1.5 mm TAPERED BALL NOSE: a 6 mm (1/4 inch) gunmetal shank flowing into a long slender bronze CONE about 20 mm long. THE CONE IS NEVER SMOOTH (owner rejected a smooth, flute-less cone on 2026-09-28): TWO DEEP SPIRAL FLUTES twist around it like the thread of a screw or the twist of a drill bit, at least FOUR full turns along the taper, the grooves dark and the sharp cutting edges between them bright, clearly readable from the shank all the way down to a TINY round tip only 1.5 mm across, half the size of the first tip. It must look like the tapered carving bits in a tool catalogue photograph.
Used tools, not new: a faint dulling of the bronze near the tip, a trace of fine walnut dust caught in the flutes. NO printed or etched markings, NO rings, NO labels.`;

// Owner, 2026-09-28, on rest15 take 3: "very thick bit, use thin tip bit for
// rest machining". The shared CUTTERS text (6 mm shanks) kept pulling it
// thick, so the rest-machining frame gets its own cutter description.
// Take 4 (thin but a plain needle, "not taper bit like attached"): the owner
// then sent a catalogue photo of a real tapered ball nose, saved beside this
// file as tapered_bit_ref.png and attached as IMAGE 2.
const CUTTER_REST = `THE ONLY CUTTER IN THIS FRAME IS THE TAPERED BALL NOSE SHOWN IN IMAGE 2. IMAGE 2 is a catalogue photograph of the real cutter: copy its SHAPE exactly. A plain round 6 mm (1/4 inch) shank enters the collet. Below the shank the coated cutting part begins at full shank width and forms a LONG CONE, about 25 mm long, that narrows STEADILY and EVENLY along its whole length, exactly like image 2, down to a TINY half-round ball tip only 1.5 mm across. Two deep SPIRAL FLUTES wind down the entire cone to the tip, exactly as in image 2, and they are PRECISION-GROUND: a constant helix angle of about 30 degrees, the two flutes perfectly evenly spaced and parallel, each groove smooth and continuous from the shank to the ball, the pitch tightening naturally as the cone narrows. Crisp bright cutting edges, clean dark grooves, no wobble, no irregular or melted-looking twists, no uneven gaps. It must look machined by a precision grinder, like the product photograph in image 2 (owner, 2026-09-28: 'more perfect spirals'). It is a CONE: wide at the top, needle-fine at the bottom. NOT a straight thin needle, NOT a straight cylinder, NOT a drill bit. The coated cone is the same warm BRONZE / COPPER colour as the cutters elsewhere in this article (the shape follows image 2, the colour follows the series); the shank is plain gunmetal grey. Copy NOTHING else from image 2: NO white background, NO printing, NO markings, NO text on the cutter.`;

const REAL = `HYPER REALISTIC, A PHOTOGRAPH, NOT A RENDER:
- The walnut is real timber: colour varies across the board, open pores catching the light, never a uniform plastic brown.
- Every machined surface carries its tool signature: fine countable scallop ridges where the light rakes across the smooth areas, never a polished shell.
- Edges are real edges: the odd tiny chip along a sharp arris, never a clean vector line.
- Carbide reads as carbide: dull grey, matte, micro-scratches, sharp edges catching one thin line of light. Not chrome, not mirror.
- A little fine dust sits in the deepest hollows of the carving, as it does after sanding. Not artfully arranged.
NEVER: no CGI sheen, no plastic wood, no perfect symmetry, no lens flare, no bokeh balls, no glow, no HDR halos, no oversharpening, no text or logos.`;

const HOLD = `ON THE MACHINE, WORKHOLDING VISIBLE AND CORRECT: the walnut board is still on a hobby gantry CNC router, sitting on a used MDF spoilboard with faint older toolpath scars, held by FOUR low-profile black step clamps, one at EACH CORNER OF THE WALNUT BOARD. CRITICAL, take 1 got this wrong: every clamp's nose must REST ON TOP OF THE WALNUT BOARD, pressing down on its flat corner margin, with its bolt going into the spoilboard just outside the board. NO clamp sits loose on the spoilboard beside the board, NO clamp points away from it. The spindle is a plain matte grey cylinder in a plain aluminium mount, NO brand, NO label, NO sticker, NO writing anywhere on the machine. Nothing floats.`;

const GRADE = `GRADE: filmic, gentle highlight roll-off, open blacks that never crush, restrained saturation, the fine grain of a real photograph in the shadows.`;

const STAGES = [
  // APPROVED 2026-09-28: the bronze-bit take, top cropped 160 px to drop a numbered bit
  // block (hero_approved_grey.jpg kept as the earlier approved version)
  ['hero', 'A 3 mm ball nose and a 1.5 mm tapered ball nose lying on a finished walnut dragon medallion under low raking light',
   `THIS FRAME, THE COVER: THE QUESTION. THE STORY IS: two cutters, one carving, which one earns its time?
COMPOSITION: the WHOLE panel is in frame with a clear margin of bench on ALL four sides, NOTHING of the board or the round medallion cut off by the image edge. It lies FLAT on the bench, occupying the right two-thirds of the frame, seen from a low camera about 25 degrees above the bench so the relief stands up in depth. The dragon's head and upper wing sit on the right-hand third line, sharp. The two cutters lie side by side on the flat walnut margin at the lower LEFT of the panel, parallel, about 2 cm apart, tips pointing toward the dragon, the 3 mm one nearer the camera. They are close enough to the lens, and large enough in the frame (together about a quarter of the frame width), that the spiral flutes on BOTH cutters and the difference in tip size are obvious at a glance. The far edge of the panel and the bench behind fall softly out of focus.
LIGHT: one warm key light, 3000 K, from the upper LEFT and LOW, only 20 to 25 degrees above the bench, so it RAKES across the carving: every scale and wing rib throws its own small shadow and the deep medallion rim is half in shade. Fill from the right at about a quarter of the key, so the shadow side still shows detail. The cooler ambient of a workshop at dusk, about 5500 K, sits in the background. Expose for the lit scales: the brightest highlights on the carbide and the raised scales keep detail and never clip; the background sits about two stops under.
CAMERA: full-frame camera, 100 mm macro lens at f/8, ISO 100, on a tripod. Focus locks on the two cutter tips and the dragon's head, which are at about the same distance. AVOID shooting from directly overhead: it flattens the relief, which is the only thing worth showing.
STYLING: a working maple bench with honest use marks, slightly dusty. Behind the panel, well out of focus: a folded canvas shop apron and the edge of a wooden bit tray. Nothing else. Props stay behind the panel and never touch or cover the carving.`],
  // APPROVED 2026-09-28 (take 3: clamps on the board, no branded vacuum)
  ['finish3', 'A 3 mm ball nose running the finishing pass across the walnut dragon medallion, smooth behind the cutter, stepped roughing ahead of it',
   `THIS FRAME: THE 3 MM FINISHING PASS. THE STORY IS: this is the pass that turns a stepped block into a carving, and it covers the whole panel.
WHAT IS HAPPENING: the spindle holds the 3 mm BALL NOSE described above (plain 6 mm shank, short fluted section, round tip), lowered INTO the carving and cutting. The pass runs in straight parallel lines left to right across the medallion. Everything the cutter has ALREADY passed over, the upper part of the dragon (head, neck, the top of both wings), is SMOOTH and fully modelled, scales and wing ribs rounded and readable. Everything it has NOT reached yet, the LOWER HALF of the medallion (the whole coiled tail, the clawed foot and the lower wings), is still raw ROUGHING from a flat end mill and must look UNFINISHED: the shapes only blocked in as FLAT STACKED TERRACES 1.5 mm high, like the contour lines of a topographic map, square-edged steps with flat tops, NO scales, NO claws, NO feather lines, NO smooth curves at all in that half. Take 1 wrongly showed the tail already finished; the two halves must look like two different stages of work. The boundary between finished and rough runs horizontally just below the cutter. Because this is a finishing cut with a small ball nose, the waste is FINE PALE DUST, not curls: a thin haze lifting off the tip and settling into the carved hollows, a fine film on the flat margin.
COMPOSITION: camera low and close, about 30 degrees above the board, from the front left, so the cutter tip and the dragon's head sit on the upper-right third, sharp, and the rough terraces fill the soft foreground. The whole round medallion is in frame; the clamps at the corners are visible.
LIGHT: the workshop's warm 3000 K work light from the upper LEFT and low, raking across the board so the terraces throw hard little steps of shadow and the finished scales throw fine ones. Cooler 5500 K daylight from a window far right as fill at about a quarter of the key. Expose for the lit walnut; the brightest dust and the carbide never clip; the machine frame behind sits two stops under.
CAMERA: full-frame, 85 mm lens at f/5.6, ISO 400, 1/250 s so the dust is crisp but the spinning cutter shows a faint blur ring. Focus locks on the cutter tip.
STYLING: a real hobby workshop, used, not showroom. Out of focus behind: the machine's gantry and a dust boot hanging raised on its bracket, a plain grey flexible dust hose running off frame. NO vacuum cleaner body, NO coloured appliances, NO brand or lettering on anything. No people.`],
  // APPROVED 2026-09-28 (take 7, after the owner's tapered-bit photo became image 2)
  ['rest15', 'A 1.5 mm tapered ball nose rest-machining only the dragon head inside a boundary, the rest of the medallion already finished by the 3 mm',
   `THIS FRAME: THE 1.5 MM REST-MACHINING PASS. THE STORY IS: the small bit only goes where the big one could not, so it is a short job, not a ten-hour one.
WHAT IS HAPPENING: the WHOLE medallion is already FINISHED by the 3 mm bit: every part of the dragon smooth and fully modelled, clean, no terraces anywhere. The spindle now holds the TAPERED BALL NOSE from image 2, described above: a long bronze cone with spiral flutes narrowing to a 1.5 mm tip. It is lowered into the carving and cutting ONLY around the dragon's HEAD: between the horns, around the eye and in the open jaw. Just there, the detail is visibly CRISPER and freshly cut, only a SHADE paler than the surrounding oiled walnut (fresh walnut is still mid brown, NEVER white or chalky, take 5 looked powdered), and a faint wisp of VERY FINE powder-like dust, like flour, hangs at the tip and settles only in that area. NO chips, NO coarse sawdust spray, NO flying particles across the board: a 1.5 mm cutter taking a light finishing pass makes almost nothing. Everywhere else is clean and untouched by this pass.
NO MONITOR, NO SCREEN, NO COMPUTER anywhere in the frame (take 1 showed a branded monitor with a software window; the boundary is shown in a drawn diagram instead).
ORIENTATION, HARD RULE (take 2 turned the carving round): the board sits in front of the camera the RIGHT WAY UP, exactly as image 1 is drawn: the dragon's HEAD at the TOP-LEFT of the medallion, in profile, FACING LEFT; both wings raised along the top and sides; the tail coiling at the LOWER LEFT; the clawed foot at the LOWER RIGHT. Do not rotate, mirror or re-pose the carving.
COMPOSITION, A TIGHT MACRO (takes 1-6 showed the whole panel and the cutter came out small or on the wrong spot): the frame shows ONLY the upper-left part of the medallion: the dragon's HEAD in profile facing LEFT with its horns, eye and open jaw, a little of the scaled neck and the top of the near wing, plus a sliver of the hewn medallion rim. The TAPERED CUTTER comes down from the top of the frame and its tiny ball tip is touching the wood RIGHT BESIDE THE DRAGON'S EYE, between the horns. The cutter is LARGE in the frame, about half the frame height, so its precision spiral flutes are crisp and countable and the taper from full width down to the 1.5 mm ball is obvious. The collet nut is just visible at the top edge. The dragon's head and the cutter tip are both on the right-hand third, sharp; the neck and wing fall softly out of focus toward the bottom left. No clamps need to be in this close-up.
LIGHT: the same warm 3000 K work light from the upper LEFT and low, raking across the carving; cooler 5500 K daylight from a window far right as fill at a quarter of the key;  Expose for the lit walnut; the carbide and the dust never clip.
CAMERA: full-frame, 100 mm macro lens at f/8, ISO 400, 1/250 s, very close: the dust crisp, the flutes sharp (the spindle is shown just stopping, so the cutter is still and its spirals are readable). Focus locks on the cutter tip and the dragon's eye.
STYLING: the same used hobby workshop. No people, no appliances, no lettering anywhere.`],
  ['wall', 'The finished walnut dragon medallion hanging on a limewashed wall at dusk, a warm sconce raking across the carving',
   `THIS FRAME: WHERE IT LEADS. THE STORY IS: this is what the detail was for. The finished, oiled carving now HANGS ON A WALL, and the raking light shows every scale, wing rib and the crisp head the small bit cleaned up.
WHAT IS IN FRAME: the finished panel, oiled walnut exactly as in image 1, hung upright the RIGHT WAY UP (dragon's head top-left facing left, tail coiling lower left, clawed foot lower right) on a warm off-white LIMEWASHED plaster wall with a soft mottled texture. NO cutters, NO machine, NO tools anywhere in this frame.
LIGHT: a single warm 2700 K brass picture-light or wall sconce mounted just ABOVE the panel and slightly to the LEFT, grazing DOWN across the carving at a low angle so every raised scale throws a small shadow below it and the medallion's hewn rim is half in shade; that light falls off down the wall. Cool 6000 K blue-hour daylight from a window out of frame on the right fills the room at about a quarter of the sconce, so the warm panel glows against a cooler room. Expose for the lit walnut: the brightest highlights on the scales keep detail; the room corners sit about two stops under.
CAMERA: full-frame, 85 mm lens at f/4, ISO 800, tripod, camera at the height of the panel's centre and a little to the RIGHT, about 25 degrees off square, so the raking light reads as depth. Focus on the dragon's head. AVOID shooting square-on with flat light: it turns the relief into a flat picture.
COMPOSITION: the panel sits on the LEFT third of the frame, NOT centred, the whole panel and a margin of wall around it in frame. In the soft right side of the frame, out of focus: the corner of a worn cognac leather armchair and a small walnut side table holding ONLY a low glass of amber whisky and a folded undyed wool throw. NO books, NO papers, NO objects that could carry printing (take 1 put gold lettering on a book spine). Nothing overlaps the panel.
STYLING: a lived-in study at dusk, not a showroom: the chair leather creased, the wall with the faint unevenness of real limewash.`],
  // Owner, 2026-09-28, after the wall frame: "I need new picture with beautiful
  // setting closeup". The wall take stays as a spare.
  ['closeup', 'Close-up of the finished walnut dragon medallion on a stone mantel in warm firelight, every scale and wing rib crisp',
   `THIS FRAME: THE DETAIL, UP CLOSE, IN A BEAUTIFUL ROOM. THE STORY IS: this is the detail the small bit saved, seen the way a guest sees it by the fire.
WHAT IS IN FRAME: the finished, oiled walnut panel exactly as in image 1, the WHOLE PANEL VISIBLE with a little margin on every side, NOTHING of it cut off by the image edge (owner rejected take 1, which cropped the panel in half). It stands upright the RIGHT WAY UP (head top-left facing left, tail coiling lower left, clawed foot lower right), its bottom edge RESTING FIRMLY ON TOP OF a thick old oak mantel shelf, leaning back slightly against a rough dry-stacked grey stone chimney breast. The panel is the hero and is LARGE: it fills about three quarters of the frame height, sitting just right of centre, so every scale, horn ridge, wing rib and the hewn chisel-faceted medallion rim is crisp and readable. The mantel's front edge runs across the bottom of the frame.
SETTING, BEHIND AND BESIDE, ALL SOFT: to the LEFT on the same mantel, a little behind and softer than the panel, two ivory pillar candles of different heights burning in a black iron holder, and a small sprig of dried eucalyptus. The stone wall behind glows warm where the candlelight touches it and falls into deep shadow above.
LIGHT: the key is warm FIRELIGHT and CANDLELIGHT, about 2200 K, from LOW on the LEFT, raking UP and ACROSS the carving at a shallow angle so every scale throws a small shadow and the horns and eye catch bright edges. A faint cool 6000 K moonlit window glow from the far right just separates the right edge of the panel from the dark stone. The brightest highlights on the scales keep their texture; the background stone sits about three stops under.
CAMERA: full-frame, 85 mm lens at f/5.6, ISO 1600, tripod, at the height of the panel's centre, close enough that the panel fills most of the frame but ALL of it is in frame, about 25 degrees to its RIGHT, so the raking light reads as depth. Focus locks precisely on the dragon's eye; the depth of field falls off gently along the neck. AVOID a square-on view with flat light.
MOOD AND GRADE: intimate, warm, quiet, the feel of a winter evening in a stone lodge. Rich amber and deep brown against cool grey stone.
NO text, labels, logos or writing anywhere; no people.`],
];

const ON_MACHINE = new Set(['finish3', 'rest15']);

const frames = STAGES.map(([key, alt, stage]) => ({
  key,
  aspect: '16:9',
  alt,
  scene: [LOOK, key === 'rest15' ? CUTTER_REST : CUTTERS, ON_MACHINE.has(key) ? HOLD : null, REAL, stage, GRADE].filter(Boolean).join('\n\n'),
  finish: false,
  hands: false,
  bench: false,
  ref: DRAGON,
  ...(key === 'rest15' ? { extraRefs: ['tapered_bit_ref.png'] } : {}),
}));

// The owner approved the fireplace close-up (take 2) in place of the wall
// frame, which stays in .mockups as a spare and is not published.
const published = frames.filter((f) => f.key !== 'wall');

// DRAWN diagrams, made by draw_sim.mjs / draw_chart.mjs from the simulation and
// approved one by one on 2026-09-28. Listed so --upload-existing pushes them;
// the "DRAWN" scene makes the generator skip them.
published.push(
  { key: 'reach', alt: 'Simulation of the dragon head as the model and as a 6 mm, 3 mm and 1.5 mm ball nose can cut it', scene: 'DRAWN by draw_sim.mjs reach 100 230 70' },
  { key: 'restmap', alt: 'Map of the dragon medallion showing in red the only areas a 1.5 mm rest-machining pass needs to cut after a 3 mm finish', scene: 'DRAWN by draw_sim.mjs restmap' },
  { key: 'timechart', alt: 'Chart of finishing time for five relief designs: 1.5 mm everywhere against 3 mm plus a 1.5 mm rest pass, 46 percent less on average', scene: 'DRAWN by draw_chart.mjs' },
);

fs.writeFileSync(new URL('./frames.json', import.meta.url), JSON.stringify(published, null, 1));
console.log(`frames.json written: ${published.map((f) => f.key).join(', ')}`);

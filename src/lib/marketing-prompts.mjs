// FROZEN marketing image prompts. Single source of truth.
//
// Owner instruction (2026-09-03): "keep all the prompts and formats intact so
// that in future no variation happens". Both the local batch scripts and the
// admin regenerate button import THIS file, so a change here changes every
// image the shop produces, and nothing else can drift.
//
// The four staging styles below were specified by the owner from reference
// photographs they chose. Do not invent new ones or soften these:
//
//   PANELS (wall plaques, portraits, signs)
//     gift_box : the panel nested in an open kraft gift box, tissue paper,
//                dried flowers, linen, a "Handmade" tag on a ribboned lid.
//     stand    : the panel upright on an ornate golden wire easel on a wooden
//                table, dried flowers in turned wooden vases, lace, warm light.
//
//   TRAYS, BOARDS, COASTERS (never on a wall, never on a stand)
//     cnc_bed  : the piece still on the CNC router bed, spindle above, clamps,
//                fresh sawdust on the spoilboard.
//     food     : the tray filled with chocolates, nuts, cheese and dried fruit,
//                styled with a dark gift box, gold ribbon and a gift card.
//     gift_box : trays may ALSO use the gift box above (owner, 2026-09-03), a
//                boxed tray reads instantly as a present.
//
// Fidelity rules that never relax: compositing not illustration, the reference
// carving reproduced 1:1 element for element, nothing cropped or hidden, and
// true real-world scale.
//
// Plain .mjs so the Astro/TypeScript site and the Node scripts share one copy.

const FIDELITY =
  'THIS IS COMPOSITING, NOT ILLUSTRATION: the attached image shows the actual physical product, a wooden '
  + 'CNC-carved piece. Place THIS EXACT object into a new scene. Do NOT redraw, reinterpret, restyle, '
  + 'simplify or "improve" it in any way. The carving\'s composition, every individual element AND its count '
  + '(figures, motifs, horns, ears, border repeats, compartments), its outline shape, proportions, aspect '
  + 'ratio, relief depth, wood tone and grain must match the reference 1:1, as if the product were cut out '
  + 'of the reference photo and photographed again in the new setting. Only the surroundings, lighting and '
  + 'shadows may change.\n';

const NO_FRAMES =
  'NO PICTURE FRAME: the piece is a bare carved wooden panel. Do NOT add a picture frame, mat, mount or '
  + 'glass around it, and do not paint or stain it. Its own carved edge is the only border.\n';

const FRAMING =
  'FRAMING (hard rules): the ENTIRE product is fully visible, no edge, corner or carved detail cut off by '
  + 'the image border or hidden behind a prop. Keep a clear margin of setting on every side. The product is '
  + 'the unmistakable hero, tack sharp, filling roughly 55-70% of the frame. Respect the reference\'s own '
  + 'orientation: landscape stays landscape, square stays square, portrait stays portrait.\n'
  + 'TRUE SCALE: believable real-world size (a wall plaque is roughly 25-45 cm, a serving tray 30-40 cm '
  + 'across) against every prop and surface.\n'
  + 'No people, no text on the product, no watermark, no logos.\n';

// ── the four owner-specified styles ────────────────────────────────────────
export const STYLES = {
  gift_box: {
    label: 'Gift box',
    forFlat: 'both',        // panels AND trays: a boxed piece reads as a gift
    text:
      'SETTING: the piece lies inside an open natural kraft gift box sized to it, lined with soft crumpled white tissue '
      + 'paper, photographed from directly above at a slight angle. The box sits on a crumpled oatmeal linen '
      + 'cloth. Beside it: a closed kraft gift box with a soft olive-green satin ribbon tied in a bow and a '
      + 'small round kraft tag reading "Handmade" with a little heart, sprigs of dried baby\'s breath and a '
      + 'few dried pale roses.\n'
      + 'LIGHT: soft diffused natural daylight from a window to one side, gentle directional shadows that '
      + 'reveal the carving depth, warm neutral palette of kraft brown, cream and sage. Calm, tactile, '
      + 'artisanal, the feeling of a beautiful handmade gift about to be given. Shallow depth of field so '
      + 'the props soften while the carving stays sharp.\n',
  },
  stand: {
    label: 'Golden stand',
    forFlat: false,
    text:
      'SETTING: the piece stands upright on an ornate antique-gold wire easel display stand with fine '
      + 'scrollwork, on a rustic dark wooden table, seen straight on at eye level. Behind and to the sides: '
      + 'turned wooden vases holding dried baby\'s breath and wheat, a cream crocheted lace throw spilling '
      + 'to one side, weathered wood panelling in the background.\n'
      + 'LIGHT: warm soft directional light from the front left, rich golden-brown tones, deep but gentle '
      + 'shadows in the carving\'s undercuts, softly blurred background. Cosy, antique, heirloom feeling.\n',
  },
  cnc_bed: {
    label: 'On the CNC bed',
    forFlat: true,
    text:
      'SETTING: the piece is shown still clamped on the bed of a CNC router, just finished. The machine '
      + 'spindle and cutting bit are directly above it, black cam clamps hold the workpiece at the corners, '
      + 'fine fresh sawdust is scattered across the MDF spoilboard, the machine gantry and rails frame the '
      + 'shot. Seen from a high three-quarter angle looking down into the piece.\n'
      + 'LIGHT: clean bright workshop daylight, crisp and honest, true wood colour, sharp detail across the '
      + 'whole carving so the machining quality is obvious. Proud maker-workshop feeling.\n',
  },
  food: {
    label: 'Styled with food',
    forFlat: true,
    text:
      'SETTING: the piece is a serving tray on a dark wooden table, its compartments filled generously and '
      + 'neatly: assorted chocolate truffles in one, mixed nuts and dried cranberries in another, cubed '
      + 'cheese with a sprig of rosemary in another, dried apricots and figs in the last. Around it: a dark '
      + 'gift box with a gold satin ribbon, loose gold ribbon curling on the table, a small kraft card '
      + 'reading "Especially For You", a glass of cream roses softly out of focus. Seen from above at a '
      + 'slight angle.\n'
      + 'LIGHT: warm low golden light with soft highlights on the gold ribbon and a gently darkened '
      + 'background, luxurious and inviting. Food styled appetisingly but never covering the carved '
      + 'decoration, which stays fully visible.\n',
  },
};

/** Trays, boards and coasters are used flat: never on a wall, never on a stand. */
export const FLAT_RE = /\b(tray|board|coaster|platter|plate|bowl|lazy susan|charcuterie|serving|dish)\b/i;
export const isFlatProduct = (title) => FLAT_RE.test(String(title || ''));

const hash = (s) => [...String(s || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);

/**
 * Which style a product gets. Flat pieces alternate between the CNC bed and the
 * food styling; panels alternate between the gift box and the golden stand.
 * Deterministic per slug, so a product always regenerates in the same style
 * unless the owner asks for another.
 */
export function styleForProduct(title, slug) {
  const flat = isFlatProduct(title);
  // Trays rotate through the workshop shot, the food styling and the gift box;
  // panels alternate between the gift box and the golden stand.
  const options = flat ? ['cnc_bed', 'food', 'gift_box'] : ['gift_box', 'stand'];
  return options[Math.abs(hash(slug || title)) % options.length];
}

/** One product, staged in the owner's chosen style. */
export function mockupPrompt(styleKey, opts = {}) {
  const { flat = false, extra = '' } = typeof opts === 'string' ? { extra: opts } : opts;
  const style = STYLES[styleKey] || STYLES.gift_box;
  return 'You are a world-top product photographer shooting a premium handmade wooden product for a '
    + 'marketplace listing and Pinterest.\n'
    + FIDELITY
    + style.text
    + (flat ? '' : NO_FRAMES)
    + FRAMING
    + (extra ? `EXTRA DIRECTION: ${extra}\n` : '')
    + 'Square 1:1 composition, photorealistic, magazine quality.';
}

/** Several products staged together, for a collection Pin. */
export function groupPrompt(n, room, flat) {
  return 'You are a world-top interior and product photographer creating ONE photorealistic advertising '
    + 'photograph for a premium wood-carving studio.\n'
    + `THIS IS COMPOSITING, NOT ILLUSTRATION. The ${n} attached images are ${n} DIFFERENT real carved wooden `
    + 'pieces. Place THESE EXACT pieces, all of them, into a single new scene. Do NOT redraw, reinterpret, '
    + 'restyle, merge, simplify or invent any carving. Each keeps its own composition, every element and its '
    + 'count, its outline shape, proportions, relief depth, wood tone and grain, exactly as in its reference.\n'
    + (flat
      ? `ARRANGEMENT: lay the pieces on a large rustic wooden table in ${room}, in a natural styled flat-lay `
        + 'seen from above at a slight angle, none overlapping enough to hide any carving. Never hang them on '
        + 'a wall and never put them on stands.\n'
      : `ARRANGEMENT: display the pieces together in ${room}, some upright on ornate antique-gold wire easel `
        + 'stands and the rest leaning naturally against the wall or propped on the surface, arranged in a '
        + 'balanced group at a natural viewing height.\n')
    + (flat ? '' : NO_FRAMES)
    + 'LIGHT: warm soft directional daylight from one side, rich golden-brown tones, gentle shadows that '
    + 'reveal the relief depth, softly blurred background. Cosy, artisanal, heirloom feeling, never flat '
    + 'overhead lighting and never an HDR look.\n'
    + 'HARD RULES: every piece is FULLY visible with its whole outline inside the photograph, none cropped by '
    + 'the image border and none hidden behind furniture or another piece. Leave a clear margin around the '
    + 'whole arrangement. Believable real-world scale.\n'
    + 'Portrait orientation, 2:3. No people, no text, no watermark, no logos.';
}

/** Extreme close-up of one product's own surface. */
export const macroPrompt = () =>
  'You are a world-class macro product photographer shooting a premium advertising campaign. Analyze the '
  + 'attached image of a carved wooden product, then create an extreme close-up macro photograph of ITS OWN '
  + 'surface: same carving, same details, nothing invented.\n'
  + 'CAMERA & OPTICS: full-frame body with a 100mm f/2.8 macro lens at 1:1 magnification, f/5.6 for a '
  + 'razor-thin but usable depth of field, ISO 100, tripod-locked, focus stacked on the most beautiful carved '
  + 'detail so the tool marks and wood grain are tack sharp while the background melts into creamy bokeh.\n'
  + 'LIGHTING: warm and tactile, one low raking key light skimming across the relief at about 15 degrees to '
  + 'carve micro-shadows into every chisel mark, a soft warm fill from the opposite side, and a faint rim to '
  + 'separate the piece from the background. Softly darkened background with a gentle vignette.\n'
  + 'MOOD: luxurious, tactile, heirloom quality, the viewer should almost feel the wood. Professional '
  + 'advertising finish, physically accurate grain, zero plastic look, no text, no watermark.';

/** Rooms used only by the collection group shot. */
export const THEME_ROOM = {
  'hunting-lodge-decor': 'a warm log hunting lodge with a stone fireplace and firelight',
  'fish-fly-fishing-stl': 'a lakeside cabin room with fly rods and morning light off the water',
  'flying-ducks-owl-birds': 'a rustic country study with a leather chair and a brass lamp',
  'pet-lover-carvings': 'a bright family living room with a dog bed and a soft throw',
  'cowboy-western': 'a western ranch room with worn leather and a saddle blanket',
  'bald-eagle-patriotic': 'a patriotic den with dark wood panelling and a cased folded flag',
  'religious-christian': 'a serene chapel-like corner with candles, linen and soft daylight',
  'wildlife-wall-art-stl': 'a modern mountain lodge living room with big windows and pine',
  'farmhouse-country': 'a farmhouse dining room with white shiplap and enamelware',
  'native-american': 'a southwestern room with woven textiles and terracotta pottery',
  'gothic-skull-art': 'a moody dark study with candles and old books',
  'floral-botanical': 'a light-filled sunroom with trailing plants and rattan',
  'coastal-nautical': 'a coastal cottage hallway with rope and driftwood',
  'memorial-tribute': 'a quiet hallway with a console table and fresh flowers',
  'vintage-wwii-planes': 'an aviation-themed study with vintage maps, a propeller and warm lamp light',
  'funny-animal-series': 'a cheerful family kitchen nook with bright morning light',
  'turkish-morrocon-arabic-and-eastern': 'an elegant eastern room with patterned tiles, lanterns and warm light',
  'valentine-love': 'a romantic corner with candles, soft textiles and warm light',
  '3d-map-relief': 'a modern study with a globe, leather-bound atlases and warm lamp light',
  'unique-3d': 'a contemporary room with clean plaster walls and soft daylight',
};
export const DEFAULT_ROOM = 'a warm rustic room with a wooden table, dried flowers and soft natural light';
export const roomForCategory = (slug) => THEME_ROOM[slug] || DEFAULT_ROOM;

/** Back-compat for callers that still ask for a scene string. */
export function sceneForCategory(slug, flat = false) {
  return flat ? `${roomForCategory(slug)}, pieces laid flat on the table` : roomForCategory(slug);
}

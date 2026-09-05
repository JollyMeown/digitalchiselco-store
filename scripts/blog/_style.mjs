// FROZEN visual standard for every blog image. Single source of truth.
//
// Owner instruction (2026-09-05): the finished letter-R panel is the reference
// for wood, texture and staining in all blog imagery. That look is described
// below and the photograph itself sits beside this file as
// _style-reference.jpg, attached to every generation as image 2 so the model
// copies a real finish rather than interpreting words.
//
// This is deliberately separate from src/lib/marketing-prompts.mjs, which is
// frozen for the shop's product mockups and must not gain editorial variants.
//
// The fidelity, photography and no-brand rules are the ones proven on the
// finishing guide. Do not soften them.

// The swatch is a CROP of the reference (chip-carved ground + a slice of plain
// border, no letter, no flower). The full panel was tried first and the model
// copied it as the subject, ignoring the product entirely (2026-09-05). A
// material-only swatch cannot be mistaken for an object.
export const FINISH =
  'THE HOUSE FINISH (match the MATERIAL SWATCH, which is the LAST attached image: it is a close-up '
  + 'sample of wood and finish ONLY, not an object, and nothing from it may appear as a shape in the '
  + 'result): warm mid-brown cherry with amber and honey undertones, '
  + 'a soft satin sheen and never gloss. Raised surfaces are clean warm wood with the grain visible; '
  + 'every recess and the whole chip-carved or textured ground is antiqued several shades darker, '
  + 'almost black-brown in the deepest hollows, so the relief reads by contrast. Edges crisp. The '
  + 'panel border, where present, is cut from the same board and finished the same way. No paint, no '
  + 'gold, no colour tint other than this wood tone.\n';

export const FIDELITY =
  'THIS IS COMPOSITING, NOT ILLUSTRATION: image 1 shows an actual carved wooden product. Photograph '
  + 'THIS EXACT object in the situation described. Do NOT redraw, reinterpret, restyle, simplify or '
  + '"improve" it. Every element and its count, the outline, proportions and relief depth must match '
  + 'image 1 exactly, as if the piece were cut out of image 1 and photographed again. Only its surface '
  + 'finish (which must follow the house finish), the light and the surroundings may change.\n';

export const SHOT =
  'PHOTOGRAPHY: real photograph, professional woodworking magazine quality, full frame camera, 50mm '
  + 'lens at f5.6. Raking light from the left so the relief casts real shadows and its depth reads. '
  + 'Honest depth of field, the carving tack sharp. Natural colour, no HDR, no over-saturation, no '
  + 'vignette, no text, no watermark, no logos.\n';

export const NO_BRAND =
  'UNBRANDED, HARD RULE: every tin, can, jar, bottle, tool, screen and package in frame is plain and '
  + 'generic. NO brand name, NO logo, NO legible label, NO writing of any kind anywhere in the image. '
  + 'Never imitate or invent a real manufacturer\'s packaging or a real software\'s interface.\n';

export const BENCH =
  'SETTING: a working woodworker bench, solid maple top with honest use marks. Props stay behind the '
  + 'piece and never cover it.\n';

export const HANDS =
  'HANDS: real adult hands, unmanicured working hands, natural skin, correct anatomy with five '
  + 'fingers. Hands never hide the carving\'s main subject.\n';

export const FRAMING =
  'FRAMING: the ENTIRE product is visible, nothing cut off by the image edge or hidden behind a prop. '
  + 'Respect the product\'s own orientation and true real-world size (a wall panel is roughly 25-45 cm, '
  + 'a serving tray 30-40 cm across). No people\'s faces.\n';

/** Assemble a frame prompt. `scene` is the only part that changes per frame. */
export const framePrompt = (scene, { hands = false, bench = true } = {}) =>
  `${FIDELITY}${FINISH}\n${scene}\n\n${SHOT}${NO_BRAND}${FRAMING}${bench ? BENCH : ''}${hands ? HANDS : ''}`;

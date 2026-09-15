// Writes frames.json for the colouring guide.
//
// One design carried through every stage (owner, 2026-09-16: "all the images
// in the series/stages must be consistent"): the Northern Cardinal on a
// blossom branch. The RAW render is the reference for every stage before
// colour goes on, the finished product photo for every stage after, and the
// LOOK paragraph below is prefixed to every scene so the panel, the palette,
// the bench and the light never drift between frames.
//
// All frames are finish:false. The house finish forbids colour; this
// article's subject is colour, so each scene owns its finish in words.
//
//   node scripts/blog/how-to-color-a-cnc-relief-carving/build_frames.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const B = 'https://tutalnieozbngrsfywes.supabase.co/storage/v1/object/public/site-media/products/cardinal-with-blossoms-relief-stl-cnc-router-3d-carving-model-northern-cardinal-';
export const RAW = `${B}-g2-mqujdzx2.jpg`;        // uncoloured render, bare wood
export const DONE = `${B}-mqujdz1w.jpg`;          // finished, tinted

const LOOK =
  'THE SERIES LOOK, IDENTICAL IN EVERY IMAGE OF THIS ARTICLE: the SAME carved panel throughout, a square panel '
  + 'about 30 cm of pale close-grained basswood whose centre is carved down into a soft wavy-edged recess, with '
  + 'the EXACT cardinal-on-a-blossom-branch design from image 1 in the same pose, same crest, same beak, same '
  + 'branch and the same blossom clusters top-left and bottom-right. Wherever a stage calls for colour, the '
  + 'colour is TRANSLUCENT TINTED WASH, never opaque paint: the cardinal a rich cardinal red with the wood grain '
  + 'faintly visible through it, a black mask around the beak and eye, an orange beak; the blossoms warm white '
  + 'with pale yellow centres; the buds and berries a dull brick red; the leaves a muted sage green; the branch '
  + 'raw-umber brown. The carved ground inside the recess and the flat rim around it stay NATURAL PALE HONEY '
  + 'WOOD with no colour at all, and once glazed the carved texture of the ground is antiqued a few shades '
  + 'darker brown in its hollows. Soft matte sheen, never gloss. Same maple bench, same warm window light from '
  + 'the left, same camera height, in every frame. ABSOLUTELY NO LETTERS, WORDS, NUMBERS, LABELS OR CARVED TEXT '
  + 'anywhere in the picture.\n';

const BARE =
  'AT THIS STAGE THE PANEL HAS NO COLOUR ON IT AT ALL: it is the raw pale carved wood exactly as image 1 shows '
  + 'it, no red, no green, no white, no glaze. ';

// Close-ups drifted: the model turned the panel on its side twice (blossoms,
// cleanup, first run). Macro frames now pin the orientation explicitly.
const UPRIGHT =
  'ORIENTATION, HARD RULE: the panel lies in its NORMAL UPRIGHT orientation exactly as in image 1, the '
  + 'bird\'s crest toward the top of the frame and the branch rising from lower-left to upper-right, '
  + 'photographed from directly above with the camera square to the panel. Do NOT rotate, turn or tilt '
  + 'the panel. ';

const F = (key, aspect, ref, alt, scene, o = {}) => ({ key, aspect, ref, alt, scene: LOOK + (o.upright ? UPRIGHT : '') + scene, finish: false, hands: !!o.hands, bench: o.bench !== false });

const frames = [
  F('hero', '16:9', DONE,
    'The finished tinted cardinal relief carving standing on the workbench with the palette, washes and brushes used to colour it',
    'HERO, MAGAZINE COVER QUALITY. The FINISHED, fully coloured panel stands upright on the bench, angled slightly '
    + 'toward the camera and tack sharp, the red bird glowing against the natural wood. Arranged in front of it, '
    + 'lower in the frame and softer: a white ceramic palette holding small translucent puddles of thin red, sage '
    + 'green, warm white and umber wash, three slim synthetic brushes, a folded cream rag, and a small square test '
    + 'tile of the same pale wood carrying a few colour swatches. Warm window light from the left.'),

  F('three-looks', '16:9', DONE,
    'The same cardinal design finished three ways: natural glazed wood, tinted washes, and opaque paint',
    'THREE SMALL PANELS OF THE SAME DESIGN SIDE BY SIDE on the bench, each about 18 cm, identical carving, '
    + 'three different finishes, evenly spaced and all fully visible. LEFT: natural wood only, no colour, warm '
    + 'honey wood with the recesses antiqued dark brown so the bird reads by shadow alone. MIDDLE: the series '
    + 'look, translucent tinted washes with the grain showing through the red and the ground left natural. RIGHT: '
    + 'fully opaque folk-art paint, flat solid red, solid green, solid white, a solid dark blue painted ground, no '
    + 'wood grain visible anywhere on it. Shot straight on so the three can be compared. Nothing else in frame.'),

  F('materials', '4:3', null,
    'The materials for colouring a relief carving: thinned washes in jars, artist acrylics, synthetic brushes, sealer, cotton buds and rags',
    'STILL LIFE ON THE BENCH, NO CARVING IN FRAME. Neatly arranged: four small clear glass jars of thinned wash, '
    + 'pink-red, sage green, warm white and umber brown, each translucent like coloured water; three plain '
    + 'unlabelled tubes of artists\' acrylic paint with a little colour showing at the nozzle; a white ceramic '
    + 'palette with dry mixing wells; five synthetic brushes, three small rounds with fine points, one narrow flat '
    + 'and one old stubby flat for dry brushing; a small plain tin of pale amber sealer with a natural-bristle '
    + 'brush across it; a handful of cotton buds in a small jar; a folded lint-free cream rag; a jar of clean '
    + 'water. Everything plain and unbranded. Soft window light from the left.',
    { bench: true }),

  F('seal', '4:3', RAW,
    'Brushing a thin sealer coat onto the raw uncoloured cardinal carving before any colour goes on',
    BARE + 'The raw panel lies flat on the bench. A hand brushes a thin, water-clear sealer over it with a soft '
    + 'natural-bristle brush: the LEFT half, already sealed, has woken up slightly warmer with a faint satin '
    + 'sheen; the RIGHT half is still dry, chalky and pale. A small plain open tin of sealer and a folded rag '
    + 'beside the panel. Raking light from the left so the carving\'s depth shows.',
    { hands: true }),

  F('test-tile', '4:3', RAW,
    'A small test tile carved with one blossom cluster from the same design, with trial washes on it',
    BARE + 'In front of the raw panel, a hand holds a small square TEST TILE about 8 cm, cut from an offcut of the '
    + 'same pale wood, carved with ONLY the top-left blossom cluster and a few leaves from the design, on which '
    + 'trial washes have been tried: one leaf sage green, one petal warm white, and two thin stripes of red of '
    + 'different strength on the tile\'s plain border. The raw uncoloured panel lies out of focus behind it. '
    + 'A white palette at the edge of the frame.',
    { hands: true }),

  F('mix', '4:3', null,
    'Mixing a thin translucent red wash on a white ceramic palette from a red, a brown and a white',
    'MACRO ON THE BENCH, NO CARVING IN FRAME. A white ceramic palette fills most of the frame: a small blob of '
    + 'deep red, a smaller blob of raw umber brown and a touch of white sit in three wells, and in the large '
    + 'centre well a wet round synthetic brush is drawing them together with water into a thin, translucent, '
    + 'skimmed-milk consistency red wash, so thin the white of the palette shows through it. A jar of water, a '
    + 'glass dropper and a small offcut of pale wood with a single test stripe of the wash lie beside the '
    + 'palette. Soft window light from the left.',
    { hands: true, bench: true }),

  F('first-wash', '4:3', RAW,
    'The first thin red wash going onto the cardinal, the head and back tinted while the tail and breast are still bare wood',
    'THE FIRST WASH. The sealed panel lies flat on the bench, everything on it still bare pale wood EXCEPT where '
    + 'the brush has been: a hand with a small round synthetic brush is laying the first thin translucent red '
    + 'wash onto the cardinal, working from the crest down the back; the head, crest and upper back are now a '
    + 'delicate see-through red with the wood grain visible through it, while the breast, wing tips and tail are '
    + 'still bare pale wood. The blossoms, leaves, branch and ground have no colour yet. A white palette with the '
    + 'thin red wash and a folded rag beside the panel.',
    { hands: true }),

  F('leaves', '4:3', DONE,
    'Sage green wash going onto the leaves while the blossoms are still bare wood',
    'The panel lies flat on the bench, the cardinal already fully tinted red. A hand with a fine round brush is '
    + 'laying a muted sage-green wash on the leaves: the leaves of the top-left cluster are done and green, the '
    + 'leaves of the bottom-right cluster are still bare pale wood. ALL THE BLOSSOMS, BUDS AND THE BRANCH ARE '
    + 'STILL BARE PALE WOOD with no colour, and the ground is bare. The brush tip sits on a half-painted leaf. '
    + 'Palette with the green wash in the corner of the frame.',
    { hands: true }),

  F('shading', '4:3', DONE,
    'Close-up of a second darker red wash being laid into the shadows between the cardinal\'s feather rows',
    'MACRO. Close on the cardinal\'s breast, wing and the base of the crest, filling the frame, the rest of the '
    + 'panel soft. A fine round brush is laying a second, deeper and cooler red into the shadows: under the wing, '
    + 'between the rows of feathers and under the crest, so the tops of the feathers stay lighter and the bird '
    + 'gains form. Every stroke follows the direction of the feathers. Wood grain still faintly visible through '
    + 'the red. The black mask and orange beak are crisp.',
    { hands: true, bench: false }),

  F('blossoms', '4:3', DONE,
    'A fine brush touching pale yellow into the centres of the white blossoms',
    'MACRO on the bottom-right blossom cluster. The petals are already tinted warm white, the buds dull brick '
    + 'red, the leaves sage green, the branch umber brown. A very fine pointed brush is touching a dot of pale '
    + 'yellow into the centre of one open blossom; two blossoms beside it already have their yellow centres, one '
    + 'still has a bare centre. The pale wood ground around the cluster is clean and uncoloured.',
    { hands: true, bench: false, upright: true }),

  F('cleanup', '4:3', DONE,
    'Lifting a stray smear of green off the bare wood ground beside a leaf with a damp cotton bud',
    'MACRO. A damp cotton bud held in a hand is lifting a small stray smear of sage-green wash off the bare pale '
    + 'wood ground right beside a green leaf; where the bud has passed, the ground is clean natural wood again. '
    + 'The leaf itself is crisp and untouched. The cardinal\'s red wing is soft in the background.',
    { hands: true, bench: false, upright: true }),

  F('glaze', '4:3', DONE,
    'The coloured panel flooded with brown glaze and half wiped back, the wiped half glowing with darker recesses',
    'THE KEY FRAME, SPLIT DOWN THE MIDDLE. The fully coloured panel lies flat on the bench, flooded edge to edge '
    + 'with a thin dark-brown glaze. A hand drags a folded cotton rag across it, wiping the glaze back OFF the '
    + 'raised surfaces. The wiped LEFT half is transformed: the red, white and green washes glow again, richer '
    + 'and warmer, the pale ground is clean honey wood, and only the hollows of the carved texture and every '
    + 'recess around the bird and branch stay dark brown. The unwiped RIGHT half is still a flat muddy brown '
    + 'film over everything, the colours dulled beneath it. The contrast between the halves must be striking. A '
    + 'small plain open tin of glaze and a blue shop towel beside the panel.',
    { hands: true }),

  F('topcoat', '4:3', DONE,
    'Wiping a thin matte clear topcoat over the finished coloured carving with a folded pad',
    'The finished, glazed and coloured panel lies flat on the bench. A hand wipes a thin, water-clear matte '
    + 'topcoat over it with a small folded lint-free pad: the LEFT half, already coated, has a soft even satin '
    + 'sheen that deepens the colours slightly; the RIGHT half is still dull and dry. A small plain tin of clear '
    + 'finish and a second clean pad beside the panel. Raking light from the left.',
    { hands: true }),

  F('gold', '4:3', DONE,
    'A fingertip rubbing a trace of antique-gold metallic wax onto the beak and a few feather tips of the finished cardinal',
    'MACRO, THE OPTIONAL LAST TOUCH. Close on the cardinal\'s head. A fingertip is rubbing the faintest trace of '
    + 'antique-gold metallic wax onto the very tips of three crest feathers and the ridge of the orange beak, '
    + 'so they catch the light; the rest of the bird stays matte red. A tiny plain open tin of gold wax beside '
    + 'the panel. Raking light so the gold glints.',
    { hands: true, bench: false }),

  F('final', '4:3', DONE,
    'The finished tinted cardinal relief hanging on a pale wall in a home, daylight from a window',
    'THE FINISHED PIECE IN A HOME. The finished coloured panel hangs on a pale warm-white plaster wall in soft '
    + 'daylight from a window at the left, shot slightly from below so it reads as wall art, tack sharp and '
    + 'fully visible, the red bird vivid against the natural wood, the recesses dark. Below it a narrow oak '
    + 'shelf with a small green plant in a plain clay pot. Nothing else. Calm, beautiful, the kind of photograph '
    + 'a buyer saves.',
    { bench: false }),

  {
    key: 'palette', aspect: '3:2', ref: null, finish: false, bench: false, hands: false,
    alt: 'A drawn palette chart: ten natural wash colours for carved subjects, each with its mixing recipe',
    scene: 'DRAWN locally by palette_chart.mjs; do not render.',
  },

  F('email', '16:9', DONE,
    'Flat lay of the finished tinted cardinal carving with the palette, washes, brushes and test tile around it',
    'FLAT LAY, SHOT FROM DIRECTLY ABOVE. The finished, fully coloured panel lies square in the centre of the '
    + 'bench. Arranged neatly around it, none of them touching the carving: the white palette with the four thin '
    + 'washes, the small jars of red, sage, white and umber wash, three brushes laid parallel, the small test '
    + 'tile with its swatches, a folded cream rag, cotton buds, and the small tin of glaze. Soft even window '
    + 'light. The finished bird is the star; everything else supports it.'),
];

// Pinterest: same subject, portrait, subject high and a quiet lower third for the title.
const VERTICAL = 'PORTRAIT 2:3 COMPOSITION FOR A PINTEREST PIN. Put the subject in the UPPER TWO THIRDS of the frame, large and clear, and keep the LOWER THIRD quiet and darker (plain bench surface or soft shadow, nothing important there) because a title will be printed over it later. ';
const email = frames.find((f) => f.key === 'email');
frames.push({ ...email, key: 'pin', aspect: '2:3', alt: email.alt + ', portrait Pin',
  scene: VERTICAL + LOOK + 'The finished, fully coloured panel stands upright at the back of the bench, large, '
  + 'tack sharp and fully visible, the red bird glowing against natural wood. In front of it, lower and softer: '
  + 'the white palette with thin red, sage, white and umber washes, three brushes and a folded rag. The lower '
  + 'third of the frame is plain bench in soft shadow.' });

for (const f of frames) for (const v of [f.alt, f.scene]) if (v.includes('—')) throw new Error('em dash in ' + f.key);
fs.writeFileSync(path.join(HERE, 'frames.json'), JSON.stringify(frames, null, 2) + '\n');
console.log(frames.length, 'frames written');

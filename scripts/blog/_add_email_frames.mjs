// One purpose-built "email" frame per article: the inside photograph of the
// article email, made for the email rather than borrowed from the article
// (owner, 2026-09-05: "we can generate a separate high quality Gemini image,
// more relevant to the subject, for all email blogs, we are professional").
//
// Each scene shows the article's SUBJECT with the article's own hero design
// in the house finish. Landscape, because the email column is 544 px wide.
//
//   node scripts/blog/_add_email_frames.mjs        # writes frames.json + meta.json
//   then per slug: gen_blog_frames --only email, --upload-existing, publish_post
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SCENES = {
  'first-cnc-relief-carving-step-by-step': {
    alt: 'The finished first relief carving on the workbench with the three cutters, the test tile and a keyhole hanger laid out in front of it',
    scene: 'THE WHOLE GUIDE IN ONE FRAME. The finished panel from image 1, in the house finish, stands propped against the wall at the back of the maple bench. Laid out neatly in front of it, left to right: three plain unmarked router cutters lying loose on the bench (a flat end mill and two tapered ball noses of different tip sizes), a small square test tile of raw cherry carved with just the head of the same design, a soft brass brush, a folded cotton rag, and a brass keyhole hanger with two screws. Warm window light from the left, the mood of a job well done. NO labels, NO printed sizes, NO letters or numbers anywhere in the picture.',
    hands: false, bench: true,
  },
  'selling-cnc-relief-carvings': {
    alt: 'A finished relief carving wrapped for sale with a kraft box, tissue paper, twine and a small hand-cut card, on a market table',
    scene: 'READY TO SELL. The finished panel from image 1, in the house finish, lies on a linen-covered market table half wrapped in cream tissue paper, a folded kraft gift box and a length of natural twine beside it, and a small blank kraft card tucked under the twine. Soft daylight, a blurred craft-fair marquee in the background, no people, no writing anywhere.',
    hands: false, bench: false,
  },
  '3d-printing-bas-relief-stl': {
    alt: 'The relief design being printed flat on an FDM printer bed, the layers visible, with a finished print beside the printer',
    scene: 'ON THE PRINTER. The design from image 1 is being 3D printed FLAT on the bed of a plain unbranded desktop FDM printer, about two thirds complete, the fine layer lines visible on the raised parts and the nozzle paused just above it. Beside the printer on the bench sits a finished print of the same design in matte grey filament, next to a small tin of primer and a brush. Clean workshop light. The finish swatch applies only to the wooden bench, not the prints.',
    hands: false, bench: true,
  },
  'cnc-relief-carving-looks-flat': {
    alt: 'The same design carved twice, one shallow and pale that looks flat, one deep and glazed that reads with real depth',
    scene: 'SIDE BY SIDE, THE PROBLEM AND THE FIX. Two carvings of the design from image 1 lie together on the bench. LEFT: carved shallow in pale wood with no finish, the forms soft and flat-looking under even light. RIGHT: the same design carved at full depth in the house finish, the recesses dark, the high points warm and crisp, reading with dramatic depth. Raking light from the left so the difference is obvious. Nothing else in frame.',
    hands: false, bench: true,
  },
  'tapered-ball-nose-bits-relief-carving': {
    alt: 'A tapered ball nose cutter finishing the relief, the fine scallop texture visible in raking light',
    scene: 'MACRO, ON THE MACHINE. A 1/16 inch tapered ball nose cutter is in the collet, resting just above the surface of the design from image 1 in raw pale cherry, no finish yet. The finished two thirds of the surface show the fine even scallop texture of a finishing pass; the last third still shows the coarser stair-step terraces from roughing. Fine sawdust in the recesses. Raking light from the left so the scallops glint. No writing, no brand.',
    hands: false, bench: false, finish: false,
  },
  'best-wood-for-cnc-relief-carving': {
    alt: 'The same relief design carved in four different woods, cherry, walnut, maple and oak, fanned on the bench',
    scene: 'FOUR WOODS, ONE DESIGN. Four small panels of the design from image 1, each about 20 cm, carved identically and finished with the house finish, fanned in a row on the maple bench: cherry (warm salmon-red), black walnut (deep chocolate), hard maple (pale cream) and red oak (open golden grain). The grain and colour of each wood are clearly different; the carving is the same. Soft even daylight, shot from slightly above.',
    hands: false, bench: true,
  },
  'cnc-relief-carving-time': {
    alt: 'A relief panel mid-carve on the machine, half smooth and half still roughed, with the cutter at the boundary',
    scene: 'WHERE THE HOURS GO. The design from image 1, EXACTLY as shown and nothing added to it, on the machine bed in raw cherry, no finish: the LEFT half already smooth from the finishing pass, the RIGHT half still in coarse roughing terraces, a tapered ball nose cutter in the collet exactly at the boundary, sawdust piled on the spoilboard. Bright workshop light. ABSOLUTELY NO LETTERS, WORDS, NUMBERS OR CARVED TEXT anywhere on the panel or in the picture; no timer, no clock, no dial.',
    hands: false, bench: false, finish: false,
  },
  'carved-wood-gift-guide': {
    alt: 'A finished relief carving being gift wrapped in kraft paper with twine and a sprig of pine',
    scene: 'A GIFT. The finished panel from image 1, in the house finish, lies on the bench half wrapped in brown kraft paper, a length of natural twine tied in a bow across one corner, a small sprig of pine tucked under the twine, and a blank kraft tag. Two hands are smoothing the paper down. Warm evening light, festive but restrained. No writing anywhere.',
    hands: true, bench: true,
  },
  'how-to-finish-cnc-relief-carvings': {
    alt: 'Dark glaze being wiped back off the finished relief carving with a rag, the wiped half showing the finished contrast',
    scene: 'THE STEP THAT MATTERS, SPLIT DOWN THE MIDDLE. The panel from image 1 lies flat on the bench, sealed and flooded with dark brown glaze. A hand drags a folded cotton rag across it, wiping the glaze back OFF the raised surfaces. The wiped LEFT half is transformed into the house finish, high points warm and clean, recesses near black. The unwiped RIGHT half is still flat muddy brown. An open plain tin of glaze and a blue shop towel beside it. No labels, no writing.',
    hands: true, bench: true,
  },
  'stl-files-for-laser-engraving-guide': {
    alt: 'The relief design laser engraved as a grayscale burn on pale maple, lying beside the carved wooden version of the same design',
    scene: 'TWO MACHINES, ONE FILE. On the bench, side by side: LEFT, a flat panel of pale maple plywood on which the design from image 1 has been LASER ENGRAVED as a smooth sepia-brown tonal burn with no carved depth, like a photograph burned into wood. RIGHT, the same design carved in real relief in the house finish. Shot from directly above in bright even light so the two readings of one design can be compared. Nothing else in frame.',
    hands: false, bench: true,
  },
  'what-makes-a-good-bas-relief-stl-file': {
    alt: 'Extreme close-up of crisp carved detail on the finished relief under raking light',
    scene: 'CLOSE-UP OF QUALITY. A close-up of the most detailed and RECOGNISABLE part of the finished panel from image 1 in the house finish, the face and eyes, filling about two thirds of the frame with the rest of the carving falling softly out of focus around it: crisp clean edges, fine overlapping detail, no tearing, no fuzz, the surface catching hard raking light from the left so every ridge throws a small shadow. The subject must be clearly identifiable as the design in image 1, not an abstract texture.',
    hands: false, bench: false,
  },
  '10-beginner-cnc-bas-relief-projects': {
    alt: 'Four small beginner relief carvings laid out on the bench, a heart, a feather, a leaf and a small animal',
    scene: 'A WEEKEND OF FIRSTS. Four small finished relief carvings, each about 12 to 15 cm, laid out in a loose grid on the maple bench in the house finish: the design from image 1, plus a simple heart panel, a single feather and a maple leaf. Simple, bold forms suited to a first machine. A soft brass brush and a folded rag at the edge of the frame. Warm window light, shot from slightly above.',
    hands: false, bench: true,
  },
  'aspire-vcarve-carveco-fusion-360-comparison': {
    alt: 'The finished relief carving on the bench beside a closed laptop, two router cutters and a coiled USB cable',
    scene: 'THE FILE AND THE RESULT. The finished panel from image 1, in the house finish, stands on the maple bench. Beside it a plain closed laptop, its lid shut so there is no screen visible at all, two router cutters standing in a small wooden block, a coiled black USB cable and a mug of coffee. Warm workshop light. No screens, no logos, no writing anywhere.',
    hands: false, bench: true,
  },
  'how-to-scale-stl-files-for-cnc-routers': {
    alt: 'The same relief design carved at three sizes, small, medium and large, nested on the bench',
    scene: 'ONE FILE, THREE SIZES. Three carvings of the design from image 1, all in the house finish, arranged in a row on the maple bench: a small one about 10 cm, a medium one about 20 cm, a large one about 40 cm. The detail on all three is equally crisp; only the size changes. A steel rule lies along the front edge of the bench. Soft even daylight, shot from slightly above.',
    hands: false, bench: true,
  },
};

let n = 0;
for (const [slug, s] of Object.entries(SCENES)) {
  const dir = path.join(HERE, slug);
  const fp = path.join(dir, 'frames.json');
  if (!fs.existsSync(fp)) { console.log('no frames.json for', slug); continue; }
  const frames = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const ref = (frames.find((f) => f.ref) || {}).ref || null;
  const frame = { key: 'email', aspect: '16:9', ref, alt: s.alt, scene: s.scene, hands: !!s.hands, bench: s.bench !== false, ...(s.finish === false ? { finish: false } : {}) };
  const i = frames.findIndex((f) => f.key === 'email');
  if (i >= 0) frames[i] = frame; else frames.push(frame);
  fs.writeFileSync(fp, JSON.stringify(frames, null, 2) + '\n');
  const mp = path.join(dir, 'meta.json');
  const meta = JSON.parse(fs.readFileSync(mp, 'utf8'));
  meta.email = { ...(meta.email || {}), image: 'email' };
  fs.writeFileSync(mp, JSON.stringify(meta, null, 2) + '\n');
  for (const v of [s.alt, s.scene]) if (v.includes('—')) throw new Error('em dash in ' + slug);
  console.log('email frame set:', slug, '(ref', ref + ')');
  n++;
}
console.log(n, 'articles updated');

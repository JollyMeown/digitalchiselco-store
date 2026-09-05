// Add a "pin" frame (2:3 portrait, Pinterest's format) to every article,
// derived from its email scene but composed vertically with quiet space in the
// lower third where the title is set later by compose_pins.mjs.
//
//   node scripts/blog/_add_pin_frames.mjs
//   then: node scripts/gen_blog_frames.mjs <slug> --only pin --force
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERTICAL = 'PORTRAIT 2:3 COMPOSITION FOR A PINTEREST PIN. Put the subject in the UPPER TWO THIRDS of the frame, large and clear, and keep the LOWER THIRD quiet and darker (plain bench surface or soft shadow, nothing important there) because a title will be printed over it later. ';

// The finishing guide has no frames.json (its photographs came from an
// earlier pipeline), so it gets one with just the pin frame.
const FINISHING = {
  key: 'email', aspect: '16:9', ref: 'howling-wolf-moon-3d-relief-stl',
  alt: 'Dark glaze being wiped back off a relief carving, the wiped half showing the finished contrast',
  scene: 'THE STEP THAT MATTERS, SPLIT DOWN THE MIDDLE. The panel from image 1 lies flat on the bench, sealed and flooded with dark brown glaze. A hand drags a folded cotton rag across it, wiping the glaze back OFF the raised surfaces. The wiped half is transformed into the house finish, high points warm and clean, recesses near black. The unwiped half is still flat muddy brown. An open plain tin of glaze and a blue shop towel beside it. No labels, no writing.',
  hands: true, bench: true,
};

let n = 0;
for (const d of fs.readdirSync(HERE, { withFileTypes: true })) {
  if (!d.isDirectory() || d.name.startsWith('_')) continue;
  const dir = path.join(HERE, d.name);
  const fp = path.join(dir, 'frames.json');
  let frames = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : null;
  if (!frames) {
    if (d.name !== 'how-to-finish-cnc-relief-carvings') { console.log('skip (no frames.json):', d.name); continue; }
    frames = [FINISHING];
  }
  const email = frames.find((f) => f.key === 'email');
  if (!email) { console.log('skip (no email frame):', d.name); continue; }
  const pin = { ...email, key: 'pin', aspect: '2:3', scene: VERTICAL + email.scene, alt: email.alt + ', portrait Pin' };
  const i = frames.findIndex((f) => f.key === 'pin');
  if (i >= 0) frames[i] = pin; else frames.push(pin);
  fs.writeFileSync(fp, JSON.stringify(frames, null, 2) + '\n');
  console.log('pin frame set:', d.name);
  n++;
}
console.log(n, 'articles updated');

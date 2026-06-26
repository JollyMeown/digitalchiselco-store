// Seeds the blog with 5 long-form SEO posts. Idempotent — uses upsert on slug.
// Usage: node scripts/seed_blog_posts.mjs
//
// Each post body is HTML (rendered via Astro `set:html`) and styled by the
// Tailwind `prose` class on /blog/[slug].astro.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const now = new Date();
const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const posts = [
  {
    slug: 'how-to-scale-stl-files-for-cnc-routers',
    title: 'How to Scale STL Files for CNC Routers Without Ruining the Detail',
    excerpt: 'Scaling a bas-relief STL sounds simple, but the difference between a crisp carve and a muddy panel is often one setting most makers never touch. The practical workflow, with depth math and CAM-software notes for Aspire, VCarve and Fusion 360.',
    seo_description: 'Practical guide to scaling bas-relief STL files for CNC routers without losing carving detail. Covers X/Y vs Z scaling, step-down strategy, bit choice, and software settings for Aspire, VCarve, Carveco and Fusion 360.',
    cover_image_url: null,
    author: 'DigitalChiselCo',
    published_at: daysAgo(28),
    body: `
<p class="lead">Scaling a bas-relief STL down by 50% sounds harmless. Carve it though, and the result is often a muddy panel where every face has the same expression and every petal looks like a thumbprint. The geometry is fine. The scaling math was wrong.</p>

<p>This post is the version of "how to scale STL files" we wish existed when we first started shipping bas-relief files for CNC routers, 3D printers, and laser engravers. It covers what actually changes when you scale an STL, the three independent dimensions you control, and the depth-and-bit math that decides whether a 9-inch panel will carry the same detail as the 24-inch original.</p>

<h2>STL scaling is not image scaling</h2>

<p>When you scale a JPG, every pixel shrinks together and the picture stays readable down to a point. STL files are different in two important ways.</p>

<p>First, an STL is a mesh of triangles describing a 3D surface, not a flat image. Scaling X and Y down while leaving Z (depth) constant makes the relief look <em>deeper</em> relative to the panel. Scaling Z down without changing X and Y flattens the carving until details vanish. Most makers scale uniformly, which is the right answer 80% of the time — but recognising the 20% case is what separates a clean carve from a disappointing one.</p>

<p>Second, your CNC router cannot reproduce features smaller than the diameter of its smallest bit. A 1mm tapered ball-nose can hold detail down to roughly 0.4mm wide. Anything finer in the STL — an eyebrow, a leaf vein, a strand of hair — gets averaged out, no matter how good the file is. That's a hardware limit, not a file limit.</p>

<h2>The three axes you control</h2>

<h3>X and Y (panel size)</h3>

<p>This is the easy one. Set your final panel width and the CAM software fills in the height to match the file's native aspect ratio. We design every <a href="/catalog">DigitalChiselCo file</a> to a standard 16:9 or 4:3 ratio that fits a typical hobby router bed (300mm × 200mm and up). If you want a wider or narrower panel than the file ships at, crop in your CAM software rather than stretching the mesh — stretched relief faces always look uncanny.</p>

<h3>Z (relief depth)</h3>

<p>Z controls how proud the carving stands off the background. Our files ship at a depth tuned for the source artwork — usually 8–14mm of total relief in the original Z extent. Halving X and Y but leaving Z untouched makes the carving look almost like a sculpture in shallow profile. Halving Z to match preserves the visual proportion you saw in the product preview.</p>

<p>Quick rule: if you scale X and Y uniformly, scale Z by the same factor. If you scale them differently, scale Z by the smaller of the two factors.</p>

<h3>Mesh density</h3>

<p>Every STL has a finite number of triangles. Scaling down doesn't reduce triangle count, which sounds harmless but can slow your CAM software to a crawl on a 200,000-poly file. If your CAM is freezing, run the file through a decimator (Meshmixer, MeshLab, or built-in tools in Aspire and Carveco) and target 80,000 polys — enough for crisp toolpaths, fast enough to preview in real time.</p>

<h2>The practical workflow (Aspire, VCarve and Fusion 360)</h2>

<p>The steps are nearly identical across software; the menus move around.</p>

<ol>
  <li><strong>Set the panel size first.</strong> Define your stock width and height before importing the STL. This is the single most common mistake — importing the file, eyeballing it, then trying to resize after toolpaths are calculated.</li>
  <li><strong>Import as Component (Aspire / VCarve) or Mesh (Fusion).</strong> Position with the bottom of the mesh aligned to the panel surface. The lowest Z point in the STL is your background depth.</li>
  <li><strong>Scale uniformly until X matches your panel width.</strong> Lock the X/Y/Z proportions. In Aspire this is the "lock aspect ratio" tick under the scale dialog; in Fusion you hold Shift while dragging the manipulator.</li>
  <li><strong>Override Z only if you need to.</strong> Thinner panels (¾" stock) sometimes need Z capped to leave enough material for cleat tabs on the back.</li>
  <li><strong>Preview with the Z view shaded.</strong> Aspire's "render with material" view will tell you immediately whether your details are about to disappear into a noise floor.</li>
</ol>

<h2>Step-down strategy: matching depth to your bit</h2>

<p>Depth alone doesn't determine detail — the ratio of depth to bit diameter does. A 6mm-deep panel cut with a 1.5mm tapered ball gives you wildly different fidelity than the same panel cut with a 3mm ball.</p>

<p>Our rule of thumb for bas-relief:</p>

<ul>
  <li><strong>Roughing pass:</strong> 6mm or 1/4" end mill, 50% stepover, 3mm step-down. Clears bulk material fast.</li>
  <li><strong>Finishing pass:</strong> tapered ball-nose, tip diameter no larger than 1/3 of your smallest visible feature. For most of our files, that's a 1mm or 0.5mm tip.</li>
  <li><strong>Stepover for the finish pass:</strong> 8% of bit diameter for showroom finish, 12–15% for "good enough to oil and hang." Smaller stepover = longer cut time. We size for 12% as a default.</li>
</ul>

<p>The smaller-bit-with-tighter-stepover combo costs you machine time, but it's the only honest way to preserve the detail in the STL. Trying to rush a fine-detail carving with a 3mm ball and a 30% stepover is the most common cause of "the file looks blurry."</p>

<h2>Diagnosing "the carving looks flat"</h2>

<p>If your first carve is finished and the relief looks softer than the preview image, walk through this list before blaming the file:</p>

<ul>
  <li>Was Z scaled with X and Y? Look at the panel from the side and measure the deepest point — it should match what your CAM said it would.</li>
  <li>Was the finishing bit smaller than your smallest visible feature? Probably not, in 90% of "flat" results.</li>
  <li>Stepover under 15%? If you went to 25% to save time, that's the cause.</li>
  <li>Wood grain interfering? Walnut and cherry hold detail far better than soft pine or poplar — the soft fibres collapse under fine bits.</li>
</ul>

<p>If all four check out and it still looks flat, the file probably is too aggressively low-poly or was authored at a smaller original size. That's where buying from a specialist like DigitalChiselCo matters: every file we ship is authored at a real-world panel size and re-tested at 50%, 75% and 100% scale before it goes on the site.</p>

<h2>When NOT to scale (and use a different file instead)</h2>

<p>Some STL files don't scale gracefully. Specifically:</p>

<ul>
  <li><strong>Faces under 100mm.</strong> Human likeness depends on micro-features (lash lines, lip transitions) that exist below your bit's resolution at small sizes. If you want a 60mm portrait, look for a file <em>designed</em> for ornament scale rather than scaling a wall-art file down 70%.</li>
  <li><strong>Text panels under 200mm wide.</strong> Letterforms have stroke widths that need to stay readable. Scale a quote panel too far and you'll fight chip-out on every serif.</li>
  <li><strong>Layered scenes</strong> (mountains-behind-trees, foreground-against-background). When you compress Z, the layers stack visually instead of receding. Look for the file in a single-subject variant instead.</li>
</ul>

<p>If you're unsure whether a file will hold up at your target size, we list every <a href="/catalog">file's recommended size range</a> on its product page. When the listing says "best between 250mm and 600mm wide," that's the result of our test pass, not a marketing line.</p>

<h2>Putting it together</h2>

<p>A clean carve is the sum of small decisions: lock the aspect ratio, scale Z with X/Y, pick a finishing bit smaller than the smallest visible feature, and don't push stepover past 15% on detail work. None of these are exotic. All of them are easy to skip when you're in a hurry.</p>

<p>If you want files that have already been pressure-tested across the size range you actually carve, browse the <a href="/collections">DigitalChiselCo collections</a> or grab the <a href="/free">free 5-file starter pack</a> to test your workflow before committing to a paid file. Either way, scaling is a tool, not a free pass — use it like one and your carvings will show it.</p>
`,
  },

  {
    slug: 'aspire-vcarve-carveco-fusion-360-comparison',
    title: 'Aspire vs VCarve vs Carveco vs Fusion 360: Which CAM Software for STL Carving in 2026',
    excerpt: 'A maker-honest breakdown of the four most common CAM packages for bas-relief STL files. What each does well, where each falls short, what they cost, and which one to pick for your kind of work.',
    seo_description: 'Aspire vs VCarve vs Carveco vs Fusion 360 — honest 2026 comparison for CNC bas-relief STL carving. Pricing, STL handling, toolpaths, learning curve, and recommendations by use case.',
    cover_image_url: null,
    author: 'DigitalChiselCo',
    published_at: daysAgo(21),
    body: `
<p class="lead">Which CAM software should you buy for carving bas-relief STL files? The internet will tell you "Aspire is the standard." The internet is right about half the time. Here's the practical version, written by a studio that ships STLs to thousands of carvers across all four packages.</p>

<p>This isn't a feature-checklist comparison. It's a working maker's view of where each package earns its money — and where you'd be smarter spending less.</p>

<h2>The TL;DR</h2>

<ul>
  <li><strong>Vectric Aspire</strong> — the de facto standard for bas-relief work. Best STL preview and toolpath generation. Expensive (~$2,000). Buy if you carve bas-relief weekly.</li>
  <li><strong>Vectric VCarve Pro</strong> — Aspire's smaller sibling, ~$700. Handles STLs perfectly fine for finishing toolpaths but lacks the modelling features. Buy if you're a buyer-and-carver, not a modeller-and-carver.</li>
  <li><strong>Carveco Maker / Maker Plus</strong> — subscription ($15/mo Maker, $45/mo Maker Plus). Strong feature parity with Aspire's modelling tools at the Plus tier. Best for hobbyists who want pro features without a $2k up-front hit.</li>
  <li><strong>Fusion 360 (free for personal use)</strong> — the technically-strongest STL handler of the four, but the bas-relief workflow is unnatural. Use it if you already know Fusion or need parametric mechanical work alongside carving.</li>
</ul>

<p>The rest of this post explains why.</p>

<h2>What "good at STLs" actually means</h2>

<p>A CAM package handles a bas-relief STL well when it does three things:</p>

<ol>
  <li><strong>Imports without choking.</strong> A 150,000-poly mesh shouldn't grind the app to 0.5 fps.</li>
  <li><strong>Generates clean finishing toolpaths.</strong> Tapered-ball, scallop-tracking, contour finishing — these should be one-click operations with sane defaults.</li>
  <li><strong>Previews the result honestly.</strong> If the preview looks crisp but the carve looks flat, the software lied to you. The good ones don't.</li>
</ol>

<p>Every package below clears bar #1 in 2026. The differences are mostly in #2 and #3 — and in how much time you spend fighting the UI to get there.</p>

<h2>Vectric Aspire</h2>

<p><strong>Cost:</strong> ~$2,000 one-time, plus optional upgrade plan (~$400/year).<br>
<strong>Platform:</strong> Windows (Mac via Parallels works fine).<br>
<strong>Free trial:</strong> 30 days, full-featured.</p>

<p>Aspire is the package most professional bas-relief carvers settle on after trying everything else. The reason isn't that it does any one thing dramatically better — it's that the workflow from "drop in an STL" to "post G-code" is shorter than any other tool, and the modelling features for creating your own reliefs from photographs are best-in-class.</p>

<p>For finishing bas-relief toolpaths specifically, Aspire's "3D Finishing" with a tapered ball produces results indistinguishable from Carveco at the same settings. So if you're a buyer who never plans to model your own relief, you're paying $1,400 over VCarve Pro for the modelling tools, the 3D component library, and slightly faster preview. Worth it if you carve weekly; overkill if you carve monthly.</p>

<p><strong>Best for:</strong> Anyone who carves bas-relief as a steady part of their work, especially if you'll occasionally model your own from a photo.</p>

<h2>Vectric VCarve Pro</h2>

<p><strong>Cost:</strong> ~$700 one-time.<br>
<strong>Platform:</strong> Windows.<br>
<strong>Free trial:</strong> 30 days.</p>

<p>VCarve Pro is the package most makers should actually buy. It handles imported STLs identically to Aspire — same toolpaths, same preview, same G-code output. What it can't do is create or sculpt new relief geometry inside the app. If you're buying finished STLs from sites like ours and just need to carve them, you don't need that.</p>

<p>The one practical limit: VCarve caps the project size to 4-foot panels. If you regularly carve doors or 6-foot tabletops, Aspire's lifted cap matters. For 95% of bas-relief makers, 4 feet is more than enough.</p>

<p><strong>Best for:</strong> Buyers who carve files from specialist studios. Saves $1,400 vs Aspire with zero downside if you don't model.</p>

<h2>Carveco (Maker and Maker Plus)</h2>

<p><strong>Cost:</strong> $15/mo Maker, $45/mo Maker Plus. (Annual plans cheaper.)<br>
<strong>Platform:</strong> Windows.<br>
<strong>Free trial:</strong> 14 days.</p>

<p>Carveco came out of the old ArtCAM team after Autodesk discontinued ArtCAM in 2018. That heritage shows: the relief modelling tools at the Maker Plus tier are arguably the strongest in the industry, with sculpting brushes that feel closer to ZBrush than to a CAM package.</p>

<p>The subscription model is the key trade-off. At $15/mo the Maker tier handles imported STLs and basic toolpathing fine, but you can't model your own relief. Maker Plus at $45/mo unlocks the sculpting suite. After three years, you've paid more than Aspire's one-time cost — but you're always on the latest version.</p>

<p>One quiet superpower: Carveco's "smart finishing" toolpath does an excellent job picking efficient cutting patterns automatically. On complex multi-subject reliefs, it can save 20–30% of cut time vs a hand-tuned Aspire pass. That adds up quickly if you're carving for sale.</p>

<p><strong>Best for:</strong> Sculptors and modellers who want pro features without the up-front capital hit, or anyone who values "always current" over "buy once."</p>

<h2>Fusion 360</h2>

<p><strong>Cost:</strong> Free for personal use (under $1k/yr revenue from your work), ~$60/mo for commercial.<br>
<strong>Platform:</strong> Windows, Mac.<br>
<strong>Free trial:</strong> Free indefinitely for hobby use.</p>

<p>Fusion 360 is the technically-strongest STL handler in this list. It opens million-poly files smoothly, generates flawless adaptive finishing toolpaths, and has full Mac support — which none of the others have.</p>

<p>The catch: bas-relief is not the workflow Fusion is designed for. To carve an STL panel, you're either using the Manufacturing workspace's 3D Adaptive Clearing strategy (which works but assumes parametric stock) or wrapping the STL as a body and using contour finishing (which works but feels like fighting the app). Aspire and Carveco understand "this is a relief panel for a router" out of the box; Fusion treats it as "an arbitrary mesh body in a mechanical project."</p>

<p>For makers who already use Fusion for mechanical or maker-space work, the free tier is genuinely useful — you can carve bas-relief without learning a second tool. For makers whose entire CNC use case is relief carving, Fusion is the long way around the block.</p>

<p><strong>Best for:</strong> Makers who already know Fusion, Mac-only users, or hobbyists carving occasionally where free matters more than workflow polish.</p>

<h2>Which one should you buy?</h2>

<p>Three honest recommendations based on what you actually carve:</p>

<ul>
  <li><strong>Buy bas-relief STLs every month and carve them:</strong> VCarve Pro. The $1,400 you save over Aspire buys a lot of stock walnut.</li>
  <li><strong>Model your own reliefs from photos and sculpts:</strong> Aspire if you want one-time cost; Carveco Maker Plus if subscription works for your cash flow.</li>
  <li><strong>Already use Fusion for something else:</strong> Stay in Fusion. The bas-relief workflow isn't elegant, but adding a second CAM package is rarely worth it.</li>
</ul>

<p>One last note: every file in our <a href="/catalog">catalog</a> is tested in Aspire, VCarve, Carveco and Fusion 360 before release. If you carve a DigitalChiselCo file and it doesn't post clean toolpaths in your chosen CAM, that's our bug and we'll fix it — email <a href="mailto:jolly@digitalchiselco.com">jolly@digitalchiselco.com</a> with the file and we'll get a working version back to you the same day. Workflow questions about any of these packages: same offer.</p>
`,
  },

  {
    slug: '10-beginner-cnc-bas-relief-projects',
    title: '10 Beginner CNC Bas-Relief Projects to Carve This Weekend',
    excerpt: 'New to carving relief panels? Ten beginner-friendly project ideas with the bit list, stock recommendations, and rough carve time for each. Start with confidence instead of starting with frustration.',
    seo_description: 'Ten beginner-friendly CNC bas-relief project ideas with stock recommendations, bit lists and carve-time estimates. Build skills without burning a $40 board on a failed first project.',
    cover_image_url: null,
    author: 'DigitalChiselCo',
    published_at: daysAgo(14),
    body: `
<p class="lead">The first ten bas-relief carvings you make decide whether you'll fall in love with the craft or quietly resell your router on Facebook Marketplace. This is the list we hand to new customers — ten projects sized for "a Saturday and one piece of stock," not "three weekends and an oak slab."</p>

<p>Each project is paired with a stock recommendation, the minimum bit set you need, and a realistic carve-time range. They're sorted roughly by difficulty: start at the top and work down. By project ten you'll have the muscle memory to take on anything.</p>

<h2>1. A single botanical leaf</h2>

<p><strong>Stock:</strong> A scrap of poplar or basswood, 150×100mm, ¾".<br>
<strong>Bits:</strong> 1/4" end mill (roughing) + 2mm tapered ball (finishing).<br>
<strong>Carve time:</strong> 25–40 min.</p>

<p>A single magnolia or fern leaf is the perfect first carve because the geometry is forgiving — there are no faces or hands that have to look "right." Set your stepover at 12% on the finish pass and let the machine do the work. When it's done, sand to 220 and rub in a coat of Danish oil. You now own a tiny piece of art and have learned half of what bas-relief carving is.</p>

<h2>2. A small heart panel for a gift</h2>

<p><strong>Stock:</strong> Cherry or walnut scrap, 200×200mm, ¾".<br>
<strong>Bits:</strong> 1/4" end mill, 2mm tapered ball.<br>
<strong>Carve time:</strong> 40–60 min.</p>

<p>Hearts are everywhere on this site for a reason — they're a forgiving shape that looks great in almost any wood. Choose a single-subject heart panel rather than a complex "heart with roses inside" file for your first one. The simpler the surface, the more you'll learn about finish quality.</p>

<h2>3. A small animal portrait (single subject)</h2>

<p><strong>Stock:</strong> Walnut, 250×200mm, 1".<br>
<strong>Bits:</strong> 1/4" end mill, 1mm tapered ball.<br>
<strong>Carve time:</strong> 1–2 hours.</p>

<p>A single deer head, fox, or bear face panel is the next step up. The fur details push your finishing pass into "you can see the bit marks" territory if your stepover is too aggressive. Tighten it to 10% and the result will surprise you. We recommend browsing the <a href="/collections/wildlife-wall-art-stl">wildlife collection</a> for files that have been specifically tested at small sizes.</p>

<h2>4. A floral wreath</h2>

<p><strong>Stock:</strong> Cherry, 300×300mm, ¾" or 1".<br>
<strong>Bits:</strong> 1/4" end mill, 1.5mm tapered ball.<br>
<strong>Carve time:</strong> 1.5–2.5 hours.</p>

<p>Wreaths teach you how Z-depth interacts with overlapping elements. The way the leaves cross under each other is the file's job; the way they read after carving is yours. Use a slightly slower feed rate (3,000 mm/min instead of your usual 4,500) on the finish pass and the cross-overs stay crisp.</p>

<h2>5. A coastal scene (lighthouse, sailboat, or whale tail)</h2>

<p><strong>Stock:</strong> Walnut or sapele, 400×300mm, 1".<br>
<strong>Bits:</strong> 1/4" end mill, 1mm tapered ball, 0.5mm tapered ball for the optional ultra-fine pass.<br>
<strong>Carve time:</strong> 2.5–4 hours.</p>

<p>Multi-element scenes (foreground subject, mid-ground water, sky background) are where bas-relief starts to feel like sculpture instead of decoration. Pick a file with clear depth separation between elements — the <a href="/collections/coastal-nautical">coastal collection</a> has several beginner-friendly options where the lighthouse stands clearly in front of the water.</p>

<h2>6. A name sign with a single decorative element</h2>

<p><strong>Stock:</strong> Cherry, sized to your text (typically 400×150mm), ¾".<br>
<strong>Bits:</strong> 60° V-bit for the text, 2mm tapered ball for any relief detail.<br>
<strong>Carve time:</strong> 30 min – 1 hour.</p>

<p>Personalisation sells. A name + a small relief element (a heart, a star, a small floral motif) is one of the most commonly-ordered custom items on commission. Practice this combo on scrap until you can knock one out in under an hour.</p>

<h2>7. A pet portrait panel</h2>

<p><strong>Stock:</strong> Walnut or cherry, 300×250mm, 1".<br>
<strong>Bits:</strong> 1/4" end mill, 1mm tapered ball, 0.5mm tapered ball for the eyes.<br>
<strong>Carve time:</strong> 3–4 hours.</p>

<p>The first time you carve a dog portrait that actually looks like a dog, you'll understand why people get into this craft. The trick is the eye area — that's where 0.5mm bits earn their keep. Don't try to do a custom photo-to-relief conversion as your first portrait; start with a designed file from the <a href="/collections/pet-lover-carvings">pet lover collection</a> that's already been tuned for carving.</p>

<h2>8. A gothic / dark-themed panel</h2>

<p><strong>Stock:</strong> Sapele or dark-stained walnut, 300×400mm, 1".<br>
<strong>Bits:</strong> 1/4" end mill, 1mm tapered ball.<br>
<strong>Carve time:</strong> 2–4 hours.</p>

<p>Dark-aesthetic files (skulls, ravens, anatomical hearts, gothic motifs) are a popular niche. They're particularly satisfying to carve because the contrast between the carved relief and the dark background reads dramatically even before finishing. Skip the oil and use a satin matte topcoat to keep the wood reading dark.</p>

<h2>9. A faith / religious panel</h2>

<p><strong>Stock:</strong> Cherry or walnut, 400×500mm, 1".<br>
<strong>Bits:</strong> 1/4" end mill, 0.8mm tapered ball.<br>
<strong>Carve time:</strong> 4–6 hours.</p>

<p>Crosses, scripture panels and angel motifs are the single highest-selling category for woodworkers who carve for sale. The faces in religious bas-relief have to be technically correct — work up to this category, don't start with it. Browse the <a href="/collections/religious-christian">religious collection</a> for files specifically authored with shallow facial relief so smaller bits can hold the detail.</p>

<h2>10. A large landscape or detailed scene</h2>

<p><strong>Stock:</strong> Walnut, 600×400mm, 1".<br>
<strong>Bits:</strong> 1/4" end mill (roughing), 6mm ball (semi-finishing), 1mm tapered ball (finishing), 0.5mm tapered ball (detail pass).<br>
<strong>Carve time:</strong> 6–12 hours, sometimes overnight.</p>

<p>By project ten you should be ready for a multi-pass, overnight carve. Mountain scenes, wildlife landscapes, and architectural reliefs all live here. Plan your toolpath carefully: a 600×400mm walnut blank is a serious piece of stock, and you don't want to discover at hour 9 that you set the wrong Z origin.</p>

<h2>The cheapskate's bit kit (the one you actually need)</h2>

<p>You don't need a $400 set of carbide. You need exactly four bits to do every project above:</p>

<ul>
  <li>1/4" (6mm) two-flute end mill — roughing. ~$15.</li>
  <li>2mm tapered ball-nose. ~$20.</li>
  <li>1mm tapered ball-nose. ~$25.</li>
  <li>0.5mm tapered ball-nose. ~$35.</li>
</ul>

<p>Total: about $95 from a reputable brand (Amana, Whiteside, IDC Woodcraft). Buy two of each so a broken bit at hour four doesn't end your weekend.</p>

<h2>What to do after project 10</h2>

<p>If you've made it through all ten, you're in the top 5% of CNC owners by skill. From here, three useful directions: customise files for specific commissions, learn relief modelling in Carveco or Aspire so you can author your own, or focus on volume and finish quality so you can sell at craft fairs. Whichever path, you've built the foundation that most owners never do.</p>

<p>If you want to skip the "find a beginner-friendly file" step, the <a href="/free">free 5-file starter pack</a> is the same files we hand to new customers — tested at small sizes, low risk, easy to print success on your first weekend.</p>
`,
  },

  {
    slug: 'what-makes-a-good-bas-relief-stl-file',
    title: 'What Makes a Good Bas-Relief STL File (and the Mistakes to Watch For)',
    excerpt: 'Half the bas-relief files on the internet were never carved by the person who designed them. Here\'s how to spot the difference — and the signs of a file that\'s going to carve cleanly.',
    seo_description: 'How to identify high-quality bas-relief STL files: depth grading, mesh density, watertight geometry, and the seven red flags that point to a file that will carve poorly. Independent guide from a studio that ships STLs.',
    cover_image_url: null,
    author: 'DigitalChiselCo',
    published_at: daysAgo(7),
    body: `
<p class="lead">There's a quiet truth in the digital-download world: most of the bas-relief STL files for sale on the major marketplaces have never been carved by the person who made them. They look fine in a 3D viewer. They look great in the marketing image. They fall apart on a real router.</p>

<p>Here's how to tell the difference before you spend $8 — or worse, before you spend three hours on a piece of walnut on a file that was never going to work.</p>

<h2>What "good" actually looks like</h2>

<p>A bas-relief STL file is doing its job when:</p>

<ol>
  <li>It opens in your CAM software without errors or warnings.</li>
  <li>The preview matches the marketing image — same proportions, same depth profile, same level of detail.</li>
  <li>It carves cleanly at the listed size range with the bits the seller recommends.</li>
  <li>The geometry is "watertight" — no gaps, no flipped normals, no internal artifacts that show up as weird machine moves at hour two.</li>
</ol>

<p>That's it. Four conditions. Most files that come from generic marketplaces fail at least one. Here's what each looks like up close, and how to spot trouble before buying.</p>

<h2>Depth grading: the single most important quality signal</h2>

<p>Open a great bas-relief STL in a viewer (3D Builder, Meshmixer, or your CAM's preview). Rotate it to a 3/4 view. The depth should grade smoothly from background to foreground in clear, identifiable layers — sky behind mountains behind trees behind subject, for example. Each layer should be visibly distinct in Z.</p>

<p>A bad file has muddy depth. Subject and background blend into each other. The "deepest" point is only 2mm below the "highest" point on a panel that should have 10mm of relief. When you carve it, the result will look flat no matter what you do — because the geometry itself is flat.</p>

<p>Quick test: look at the side profile in your viewer. You should be able to count distinct depth levels with the naked eye. If it looks like a smooth bump rather than a layered scene, that's your warning.</p>

<h2>Mesh density: not "more is better"</h2>

<p>Triangle count matters, but it's not a quality metric on its own. A 50,000-poly file authored by someone who understands the form will carve better than a 500,000-poly file that's a noisy mess.</p>

<p>That said, very low poly counts (under 20,000 triangles) are a red flag. You can't represent the curves of a face or a flower with that few triangles without polygonal artifacts becoming visible at any reasonable carve size. A good file for wall-art carving sits in the 60,000–180,000 range.</p>

<p>Files over 500,000 polys can also be problematic — they're slow to preview, slow to toolpath, and the extra detail is usually below your bit's resolution anyway. Good studios decimate intelligently before release.</p>

<h2>Watertight geometry</h2>

<p>STL files describe surfaces, not solids. The CAM software treats them as solids when it generates toolpaths, which only works if the mesh is closed ("watertight"). A watertight mesh has no holes, no internal walls, and no flipped triangles.</p>

<p>When a file is not watertight, your CAM software will either refuse it outright or — worse — generate toolpaths that include strange dives through the stock at unexpected places. Hours into a carve, your bit drops 8mm where it shouldn't have and tears a chunk out of your panel.</p>

<p>You can check this in Meshmixer (Analysis → Inspector). Holes and non-manifold edges glow red. A good studio runs every file through this check before release; the bad ones never check.</p>

<h2>The seven red flags before you buy</h2>

<p>You can usually tell a bad file from its listing page, without downloading:</p>

<ol>
  <li><strong>The "preview" is a Photoshop render, not a CAM screenshot.</strong> Sellers who actually carve their files show preview images from Aspire or VCarve, not glossy 3D renders that hide depth flaws.</li>
  <li><strong>No size range recommendation.</strong> A studio that's actually tested its file knows what size it carves cleanly at. "Scale to any size" usually means "we never tested it."</li>
  <li><strong>Generic AI art at 4K resolution.</strong> The boom in AI-generated bas-relief listings is real and the quality is usually poor. The geometry tends to be one smooth blob rather than layered relief.</li>
  <li><strong>No mention of testing on real machines.</strong> If the listing doesn't say which CAM packages or routers it was tested on, it probably wasn't.</li>
  <li><strong>Marketing copy heavy on adjectives ("Premium! Stunning! Exclusive!"), light on technical detail.</strong> Real makers describe geometry, depth, and recommended bits.</li>
  <li><strong>Pricing too low.</strong> A bas-relief file authored to professional standards takes 8–20 hours of design and test time. Anyone selling at $1–2 either didn't do the work or stole the file.</li>
  <li><strong>No customer support or response promise.</strong> If something carves wrong, who's going to help you debug? Marketplace sellers are often gone before your CAM crashes.</li>
</ol>

<h2>What you're paying for at a specialist studio</h2>

<p>When you buy a file from a specialist like DigitalChiselCo (or any studio that takes the craft seriously), the extra $5 over a marketplace listing is buying you these things:</p>

<ul>
  <li><strong>A file that's been through CAM in at least one machine.</strong> Often two or three — we test in Aspire, VCarve, Carveco, and Fusion before release.</li>
  <li><strong>A documented size range.</strong> "Carves cleanly between 250mm and 600mm wide" is a useful sentence; "any size" is a useless one.</li>
  <li><strong>A documented bit recommendation.</strong> Knowing what bit to use is half the battle.</li>
  <li><strong>A real human on the other end of an email.</strong> When something goes wrong, you want a reply within 24 hours, not silence.</li>
  <li><strong>A consistent style across a collection.</strong> So your sequence of carvings reads like a coherent body of work, not a thrift-store grab bag.</li>
</ul>

<h2>How to inspect a file you've already bought</h2>

<p>If you have a file in hand and want to assess it before committing a piece of stock, follow this checklist:</p>

<ol>
  <li>Open in your CAM. Note any errors or warnings on import.</li>
  <li>Rotate to a side view. Can you see distinct depth layers, or is it a smooth bump?</li>
  <li>Generate a finishing toolpath at the listed size. Preview it. Does the cut look reasonable?</li>
  <li>Drop into Meshmixer's Inspector tool. Are there glowing-red areas?</li>
  <li>If all four checks pass, carve a 100×80mm test cut on scrap with cheaper stock. If that looks crisp, the file is good for your full panel.</li>
</ol>

<p>A 100×80mm scrap test on a $2 piece of pine costs you 20 minutes and saves you 4 hours on the real stock if the file has problems.</p>

<h2>The standard we hold ourselves to</h2>

<p>Every <a href="/catalog">file in our catalog</a> goes through the following before release:</p>

<ul>
  <li>Designed and refined in our chosen sculpting suite, with reference photography.</li>
  <li>Decimated to a target poly count (60k–180k depending on subject complexity).</li>
  <li>Mesh-checked for watertightness in Meshmixer.</li>
  <li>Test-toolpathed in Aspire and VCarve.</li>
  <li>Test-carved at small (200mm) and medium (400mm) sizes on at least one of our shop machines.</li>
  <li>Photographed under carve-side lighting (not Photoshop renders) for the product listing.</li>
</ul>

<p>If a file fails any of those steps, it goes back to the queue. That's the difference between "we put it on the site" and "we ship it to a customer."</p>

<p>If you want to test our standards against your machine without spending money, the <a href="/free">free 5-file pack</a> includes designs from across our collections — they're the easiest way to see whether our files carve well on your specific setup before committing to a paid purchase.</p>
`,
  },

  {
    slug: 'stl-files-for-laser-engraving-guide',
    title: 'STL Files for Laser Engraving: How They Work and Where to Start',
    excerpt: 'STL files are designed for CNC routers and 3D printers, but most modern laser engravers can use them too — once you understand the conversion. The practical guide for fibre, CO2 and diode lasers.',
    seo_description: 'Guide to using STL files for laser engraving. How relief depth converts to grayscale power maps, which laser types work best, settings for LightBurn and xTool Creative Space, and the workflow most makers miss.',
    cover_image_url: null,
    author: 'DigitalChiselCo',
    published_at: daysAgo(3),
    body: `
<p class="lead">If you searched for "STL files for laser engraving" expecting to find files designed specifically for lasers, you'd be forgiven for thinking they don't exist. They mostly don't — and they don't need to. Most modern laser engravers can use a bas-relief STL with one preparation step, and the results are stunning on the right materials.</p>

<p>This is the practical guide we wish existed when laser-owning customers started asking us "can I use these on my xTool / Glowforge / Ortur?" The answer is yes, but the workflow is different, and a few of the things that work great on a router will fail on a laser.</p>

<h2>STLs vs. lasers: what's actually happening</h2>

<p>A CNC router carves a bas-relief by physically removing material to different depths — high points stay tall, low points get cut deeper. A laser engraver can't carve depth directly (with some exceptions for fibre lasers on metal). Instead, it varies the <em>intensity</em> of the burn across the surface, creating a shaded image where dark areas read as "low" and light areas read as "high."</p>

<p>This is why STL files work on lasers: a bas-relief STL has a depth map, and a depth map can be converted to a grayscale image where Z height becomes brightness. Your laser then engraves the grayscale image at varying power, and the human eye reads the result as relief — even though physically it's a shaded burn.</p>

<p>The conversion step is what most tutorials skip. Done right, it produces gorgeous engravings. Done wrong, it produces muddy burns that look nothing like the source file.</p>

<h2>Which laser types work with STL bas-relief?</h2>

<h3>Diode lasers (xTool D1, Ortur, Atomstack)</h3>

<p>Diode lasers are the most accessible for bas-relief work. They burn well on bare wood, leather, and many slate/stone surfaces. The optical resolution of modern 10–40W diodes is more than enough to render a fine grayscale gradient.</p>

<p>Best materials: light hardwoods (birch ply, maple), bamboo, leather, slate coasters, dark cardstock. Avoid anything reflective or anything where the grain pattern is louder than the engraving (heavily figured walnut tends to fight the burn).</p>

<h3>CO2 lasers (Glowforge, OMTech, Boss Laser)</h3>

<p>CO2 wattage gives you faster engravings and the ability to work on acrylic, leather, anodised aluminium, and a wider range of woods. The grayscale gradient on a CO2 burn is typically smoother than a diode — you get more "tones" per burn pass.</p>

<p>Best materials: walnut, cherry, maple plywood, hardboard (Masonite), full-grain leather, etched acrylic, anodised aluminium.</p>

<h3>Fibre lasers</h3>

<p>Fibre lasers can actually carve depth into metals via deep engraving / annealing, which technically reproduces a bas-relief STL three-dimensionally. The workflow here is closer to CNC than to standard laser engraving and is outside the scope of this post — but yes, it works, and the results on stainless steel can be remarkable.</p>

<h2>The depth-to-grayscale conversion</h2>

<p>Two tools make this conversion easy, and both are free:</p>

<h3>Option 1: ChiTuBox / 3D-print slicers (1 step, fast)</h3>

<p>Most resin 3D-print slicers can export a depth map as a grayscale PNG. Import your STL, orient it flat (carving surface facing up), and use the "export depth map" feature. The result is a grayscale image where bright = high relief, dark = background.</p>

<h3>Option 2: Meshmixer + LightBurn (2 steps, more control)</h3>

<p>Open the STL in Meshmixer. Position it on the X-Y plane with the carving face up. Use Edit → Project → Image Stamp to render a depth-map PNG at your target resolution. Then import the PNG into LightBurn as a grayscale image and use "Image" mode with "Pass-through" or "Stucki" dithering at 254 lines per inch.</p>

<p>The second workflow gives you control over the resolution of the depth map — higher resolution captures more detail at the cost of longer engrave time.</p>

<h2>Settings to start with</h2>

<p>Materials vary wildly, but these are sensible starting points for testing on a 5×5cm scrap. Always test before committing to a full panel.</p>

<h3>Diode laser (10W) on birch plywood</h3>

<ul>
  <li>Speed: 3,000 mm/min</li>
  <li>Max power: 100%</li>
  <li>Min power: 0%</li>
  <li>Lines per inch: 200</li>
  <li>Image mode: Grayscale, Stucki dithering</li>
</ul>

<h3>CO2 laser (40W Glowforge / equivalent) on cherry</h3>

<ul>
  <li>Speed: 1,000 (Glowforge "Convert: Engrave: HD Photo" works as a baseline)</li>
  <li>Power: 70%</li>
  <li>Lines per inch: 270</li>
  <li>Image mode: 3D engrave or photo engrave</li>
</ul>

<h3>CO2 laser on full-grain leather</h3>

<ul>
  <li>Speed: 2,500</li>
  <li>Power: 25–35% (leather burns aggressively)</li>
  <li>Lines per inch: 220</li>
  <li>Image mode: Grayscale, Jarvis dithering</li>
</ul>

<p>The "lines per inch" setting matters more than most people realise. Going too high (300+) on a diode laser produces overburn — the edges blur and detail disappears. Going too low (under 150) leaves visible scan lines. 200–270 is the sweet spot.</p>

<h2>Mistakes to avoid</h2>

<ul>
  <li><strong>Burning before testing.</strong> Always burn a 50×50mm test before committing to a 300mm panel. Depth maps look different on every material.</li>
  <li><strong>Using "vector" or "line" mode.</strong> A depth map is a raster image. Use grayscale / image / photo modes only.</li>
  <li><strong>Dirty optics.</strong> A grayscale gradient amplifies any flaw in your beam. Clean your lens before any serious engrave.</li>
  <li><strong>Wood with strong grain.</strong> Cherry and maple read grayscale well. Heavily-figured walnut and oak fight the burn. If you only have figured stock, sand to 320 and apply a clear sanding sealer before burning.</li>
  <li><strong>Skipping rotation.</strong> If your engraving is going to be 400mm wide, the workpiece needs to be flat to within 0.5mm across that entire span. Use a hold-down or a flat reference surface — a warped board will produce a faded engraving on the high spots.</li>
</ul>

<h2>Which DigitalChiselCo files work best on lasers?</h2>

<p>Not every file in our catalog is ideal for laser conversion. The ones that work best have:</p>

<ul>
  <li>Strong contrast between subject and background (so the grayscale gradient reads cleanly).</li>
  <li>A single dominant subject rather than busy multi-element scenes (busy scenes get muddy on burns).</li>
  <li>Bold shapes — wildlife portraits, religious symbols, name signs, single floral subjects.</li>
</ul>

<p>The <a href="/collections/religious-christian">religious panels</a>, <a href="/collections/wildlife-wall-art-stl">wildlife portraits</a>, and <a href="/collections/floral-botanical">floral collection</a> generally convert well. Architectural scenes and multi-element landscapes are harder — possible, but you'll spend more time tuning your engrave settings.</p>

<p>If you want to test the workflow without buying first, grab the <a href="/free">free 5-file starter pack</a>. Five files, depth-graded, grayscale-friendly — exactly the kind of starting set you want for working out your laser settings.</p>

<h2>The honest summary</h2>

<p>Lasers and CNC routers solve the same visual problem from opposite directions. A router carves real depth into wood; a laser fakes depth through grayscale shading. Both can produce stunning bas-relief work from the same source STL files, as long as you do the conversion step properly and match your file to the medium.</p>

<p>If you're a laser-only maker, this is the most flexible STL workflow you can build into your shop: one library of files, two output paths, infinite project ideas. We're rooting for you.</p>
`,
  },
];

// --- upsert ----------------------------------------------------------------
console.log(`Seeding ${posts.length} blog posts…`);
let ok = 0, fail = 0;
for (const p of posts) {
  const { error } = await db
    .from('posts')
    .upsert({
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt,
      body: p.body.trim(),
      cover_image_url: p.cover_image_url,
      author: p.author,
      status: 'published',
      published_at: p.published_at,
      seo_description: p.seo_description,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'slug' });
  if (error) {
    console.error(`  ✗ ${p.slug}: ${error.message}`);
    fail++;
  } else {
    console.log(`  ✓ ${p.slug}`);
    ok++;
  }
}
console.log(`\nDone. Upserted ${ok}, failed ${fail}.`);

// Collection page copy: title, meta description, intro and FAQ for every
// collection. Written 2026-09-05 after the first Search Console readout showed
// the collection pages sitting at positions 18 to 22 with no copy at all.
//
//   node --env-file=.env scripts/seo/seed_collection_copy.mjs [--dry]
//
// House rules: no em dashes, no brand names for finishes, sign nothing, speak
// as the studio. Every intro says what the designs are, what they carve on,
// and links to the guide that answers the obvious next question.
const DRY = process.argv.includes('--dry');
const H = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY, 'content-type': 'application/json', prefer: 'return=minimal' };
const U = process.env.PUBLIC_SUPABASE_URL + '/rest/v1/';

const G = {
  finish: '/blog/how-to-finish-cnc-relief-carvings',
  wood: '/blog/best-wood-for-cnc-relief-carving',
  time: '/blog/cnc-relief-carving-time',
  scale: '/blog/how-to-scale-stl-files-for-cnc-routers',
  quality: '/blog/what-makes-a-good-bas-relief-stl-file',
  first: '/blog/first-cnc-relief-carving-step-by-step',
  bits: '/blog/tapered-ball-nose-bits-relief-carving',
  flat: '/blog/cnc-relief-carving-looks-flat',
  print: '/blog/3d-printing-bas-relief-stl',
  laser: '/blog/stl-files-for-laser-engraving-guide',
  sell: '/blog/selling-cnc-relief-carvings',
  gift: '/blog/carved-wood-gift-guide',
  beginner: '/blog/10-beginner-cnc-bas-relief-projects',
  software: '/blog/aspire-vcarve-carveco-fusion-360-comparison',
};
const a = (href, text) => `<a href="${href}">${text}</a>`;

// The standard FAQ every collection shares, worded once.
const COMMON_FAQ = [
  { q: 'What do I get when I buy a file?', a: 'A high-resolution STL of the relief, supplied at full depth so it scales cleanly, with an instant download link by email and in your account. Every file includes a commercial licence: carve and sell as many finished pieces as you like. Reselling or sharing the file itself is the only thing the licence does not allow.' },
  { q: 'Which software and machines do these work with?', a: 'Any CAM package that imports STL: Vectric VCarve and Aspire, Carveco, Fusion 360, Easel Pro, Carbide Create Pro and others. They carve on any CNC router, slice for resin or FDM printers, and convert to grayscale for laser engravers. ' + a(G.software, 'Our software comparison') + ' explains what each package does with a relief.' },
];

const COPY = {
  'wildlife-wall-art-stl': {
    seo_title: 'Wildlife Relief STL Files for CNC Carving: Deer, Elk, Bear, Wolf | DigitalChiselCo',
    seo_description: 'Wildlife bas-relief STL files for CNC routers, 3D printers and laser engravers: deer, elk, moose, bears, wolves and big cats in full scenes. Instant download, commercial use.',
    intro: `<p>Wildlife is the category people carve most, and for a simple reason: a stag stepping out of the trees or a bear with her cubs reads from across a room in a way few subjects do. These are full scenes rather than cut-out animals. The deer stands in front of pines, the wolf howls under a moon, the elk has a mountain behind him, so the finished panel looks composed, not pasted on.</p>
<p>Every file is sculpted at full depth with fur, antlers and foliage that survive a 1/32 inch finishing pass. Carve them at 300 to 600 mm wide in cherry, walnut or oak, or scale them down for a tray insert. Mid-scene depth means they also print well on a resin or FDM printer. If a carving comes out looking flatter than the render, ${a(G.flat, 'this guide')} explains the seven causes, and ${a(G.finish, 'the finishing guide')} shows the glaze step that makes fur read as fur.</p>`,
    faq: [
      { q: 'What size should I carve a wildlife panel?', a: 'Most of these were designed for 300 to 450 mm across. Larger reads better on a wall; below 200 mm the fine fur starts to blur. ' + a(G.scale, 'The scaling guide') + ' shows how to resize without losing detail.' },
      { q: 'How long does a 400 mm wildlife panel take to carve?', a: 'Three to five hours of machine time with a 1/4 inch roughing pass and a 1/16 inch tapered ball nose finish, plus a day or two of finishing. ' + a(G.time, 'The carve-time guide') + ' has the real numbers.' },
    ],
  },
  'religious-christian': {
    seo_title: 'Religious & Christian Relief STL Files: Jesus, Last Supper, Crosses, Saints | DigitalChiselCo',
    seo_description: 'Christian bas-relief STL files for CNC carving and 3D printing: the Last Supper, Jesus, the Crucifixion, Mary, the saints, crosses and the Sacred Heart. Instant download, commercial use.',
    intro: `<p>Devotional carving is the oldest use of the relief, and it is still the one buyers respond to most strongly: these pieces are given at baptisms, confirmations, weddings and funerals, hung in churches and home altars, and rarely negotiated on price. The collection covers the Last Supper in several compositions, the life and Passion of Christ, the Sacred Heart, the Virgin Mary, the saints, crosses and angels, in styles from Byzantine flatness to full Renaissance depth.</p>
<p>Faces are the hard part of a religious relief, so every face here is sculpted at full depth with the eyes, lips and hands cleanly defined, and every file is tested at 300 mm with a 1/32 inch finishing cutter. Carve them in cherry, walnut or basswood, print them for a home shrine, or engrave them in grayscale on a laser. ${a(G.finish, 'The finishing guide')} covers the dark glaze that gives these pieces their depth, and ${a(G.sell, 'the selling guide')} explains why devotional work commands the highest prices in this craft.</p>`,
    faq: [
      { q: 'Are these suitable for church commissions?', a: 'Yes. The licence covers commissioned pieces, and the files are supplied at a resolution that holds up at 600 mm and above for altar and wall installations.' },
      { q: 'Which wood suits religious carvings?', a: 'Cherry and walnut for warmth, basswood or maple for a painted or gilded finish. ' + a(G.wood, 'The wood guide') + ' carves one design in eight species so you can compare.' },
    ],
  },
  'gothic-skull-art': {
    seo_title: 'Gothic & Skull Relief STL Files for CNC Carving and 3D Printing | DigitalChiselCo',
    seo_description: 'Gothic and skull bas-relief STL files: skulls, reapers, ravens, biker and motorcycle art, dark ornament. For CNC routers, resin printers and laser engravers. Instant download.',
    intro: `<p>Skulls, reapers, ravens, engine-and-piston skulls for the garage, and ornament borrowed from cathedrals and old tattoo flash. This is the collection people carve for bikers, bar walls, man caves and anyone who finds a deer a bit polite. The designs are deliberately deep-cut with strong shadow lines, because a skull that reads as a shallow print is a wasted board.</p>
<p>They carve beautifully in walnut and dark-glazed oak, and because the forms are bold they are also the most forgiving files in the catalogue for a first machine or a smaller cutter. Most print exceptionally well in resin, where the fine cracks and teeth come out sharp. See ${a(G.bits, 'the tapered ball nose guide')} for which tip size the detail needs, and ${a(G.finish, 'the finishing guide')} for the black-glaze-over-stain look that suits this work.</p>`,
    faq: [
      { q: 'Do skull reliefs need a very small cutter?', a: 'No. Most were designed to finish with a 1/16 inch tapered ball nose; the teeth and cracks are drawn wide enough for it. A 1/32 inch tip is only worth the time on pieces under 200 mm.' },
      { q: 'Can I print these in resin?', a: 'Yes, and they are among the best files for it. ' + a(G.print, 'The 3D printing guide') + ' covers orientation, layer height and supports for a relief.' },
    ],
  },
  'cowboy-western': {
    seo_title: 'Cowboy & Western Relief STL Files: Horses, Rodeo, Ranch Scenes | DigitalChiselCo',
    seo_description: 'Western bas-relief STL files for CNC carving: cowboys, cowgirls, horses, bucking broncs, longhorns, ranch and rodeo scenes. Instant download, commercial licence.',
    intro: `<p>Horses at full gallop, a cowboy leaning on a fence at dusk, a bronc mid-buck, longhorns and ranch gates. Western pieces sell in every state, not just the ones with cattle, because the subject carries a mood of open country that suits cabins, tack rooms, restaurants and gifts for people who ride. Horses are notoriously hard to sculpt, so every one here has correct anatomy and a mane and tail that carve clean.</p>
<p>The scenes were composed for panels of 300 to 500 mm and for barn-door and headboard inserts. They carve well in oak and pine, where a rustic grain suits the subject, and they take a dark glaze beautifully. ${a(G.wood, 'The wood guide')} shows how the same design looks across eight species, and ${a(G.gift, 'the gift guide')} has ideas for who buys western work and when.</p>`,
    faq: [
      { q: 'Are the horses anatomically right?', a: 'Yes. Riders and horse owners notice a bad hock instantly, so the horses were sculpted from reference and checked by people who ride.' },
      { q: 'What wood suits western carvings?', a: 'Oak, pine and reclaimed barn wood for rustic pieces, walnut for a finer gift. Softwoods need a sharp cutter and a slower finishing pass; ' + a(G.wood, 'the wood guide') + ' explains why.' },
    ],
  },
  'farmhouse-country': {
    seo_title: 'Farmhouse & Country Relief STL Files: Barns, Tractors, Highland Cows, Harvest | DigitalChiselCo',
    seo_description: 'Farmhouse bas-relief STL files for CNC routers: barns and silos, vintage tractors, highland cows, roosters, harvest wheat and country kitchen signs. Instant download, commercial use.',
    intro: `<p>Barns and silos, a vintage tractor in the field, highland cows with their fringe over their eyes, roosters, milk cans and harvest wheat. Farmhouse is the style of the modern kitchen and the gift shop alike, and these designs are made to sit in it: warm, a little nostalgic, and carved with enough depth to look hand-made rather than printed.</p>
<p>They were drawn for signs, serving trays, cabinet inserts and wall panels from 200 to 500 mm. Maple and cherry suit the kitchen pieces; oak and pine suit the barn scenes. Trays in this collection are designed food-safe with a flat base and a shallow rim. If you sell at markets, ${a(G.sell, 'the selling guide')} covers pricing, and ${a(G.finish, 'the finishing guide')} covers the food-safe oil finish for anything that touches food.</p>`,
    faq: [
      { q: 'Are the tray designs food safe?', a: 'The geometry is; the finish is up to you. Use a food-safe oil or hardwax on trays. ' + a(G.finish, 'The finishing guide') + ' lists which finishes qualify.' },
      { q: 'Can I add a family name to a farmhouse sign?', a: 'Yes. Import the relief into your CAM software and add the text as a v-carve or raised lettering; every file leaves a clean border for it.' },
    ],
  },
  'fish-fly-fishing-stl': {
    seo_title: 'Fish & Fly Fishing Relief STL Files: Bass, Trout, Pike, Marlin | DigitalChiselCo',
    seo_description: 'Fishing bas-relief STL files for CNC carving: largemouth bass, trout, pike, walleye, marlin, fly fishing scenes and tackle. Instant download, commercial licence.',
    intro: `<p>A largemouth bass breaking the surface, a brook trout in a mountain stream, a pike coming out of the reeds, marlin and sailfish for the coast, and fly-fishing scenes with rod, creel and river. Fishing panels are the most reliable gift in the catalogue: every angler has a wall, a cabin or a boat, and the person buying knows exactly which fish they chase.</p>
<p>Scales are the test of a fish relief. Every fish here has individually sculpted scales and fin rays that carve clean with a 1/16 inch tapered ball nose at 300 mm and up, and the water is modelled with real ripple depth so a glaze finish brings it alive. Cherry and walnut suit them best. ${a(G.finish, 'The finishing guide')} shows how a dark glaze turns carved scales into a fish, and ${a(G.gift, 'the gift guide')} covers who buys fishing work.</p>`,
    faq: [
      { q: 'What size should I carve a fish panel?', a: 'Most were designed for 300 to 450 mm wide. Scales stay crisp down to about 250 mm; below that use a 1/32 inch finishing cutter or accept softer scales.' },
      { q: 'Do these work on a laser engraver?', a: 'Yes, as grayscale depth maps. ' + a(G.laser, 'The laser engraving guide') + ' explains the conversion and which materials show it best.' },
    ],
  },
  'flying-ducks-owl-birds': {
    seo_title: 'Bird Relief STL Files: Flying Ducks, Owls, Cardinals, Hummingbirds | DigitalChiselCo',
    seo_description: 'Bird bas-relief STL files for CNC carving and 3D printing: mallards in flight, great horned owls, cardinals, hummingbirds, herons and songbirds. Instant download, commercial use.',
    intro: `<p>Mallards landing on a lake at sunset, a great horned owl on a branch, cardinals on a snowy twig, hummingbirds at a flower. Birds are the second-largest wildlife subject and the one with the widest audience, from hunters who want ducks to grandmothers who want a cardinal. Feathers are what make or break a bird relief, so each one is sculpted with layered, overlapping feathers rather than a texture stamp.</p>
<p>The duck scenes were drawn for hunting lodges and trays; the owls and songbirds for smaller wall pieces and gifts, down to 150 mm for the simpler ones. They carve well in cherry, maple and basswood, and the crisp feather edges make them among the best files for laser grayscale engraving. ${a(G.bits, 'The cutter guide')} explains why feathers need a tapered ball nose, and ${a(G.laser, 'the laser guide')} covers the conversion.</p>`,
    faq: [
      { q: 'Which bird designs suit a small board?', a: 'The single-bird pieces such as cardinals, hummingbirds and owls carve cleanly at 150 to 250 mm. The flying-duck scenes want 300 mm and up.' },
      { q: 'Can I carve these on a tray?', a: 'Several are designed as tray inserts already, and any single-bird design can be placed into a tray blank in your CAM software.' },
    ],
  },
  'hunting-lodge-decor': {
    seo_title: 'Hunting Lodge Relief STL Files: Deer, Ducks, Retrievers, Elk, Cabin Scenes | DigitalChiselCo',
    seo_description: 'Hunting lodge bas-relief STL files for CNC routers: whitetail bucks, elk, duck hunting dogs, retrievers with pheasants, cabin and lake scenes. Instant download, commercial licence.',
    intro: `<p>The whitetail buck at first light, a labrador coming out of the water with a mallard, a pheasant flushed by a spaniel, elk bugling in the meadow. This is the wall art of the cabin, the lodge, the garage and the office of anyone who hunts, and it is the collection that sells most steadily to men who are otherwise impossible to buy for.</p>
<p>Designs were composed for 350 to 600 mm panels and for mantel and gun-cabinet inserts, with the depth to read across a lodge room. Walnut and oak with a dark glaze suit them; so does reclaimed pine for a rustic piece. The dogs have correct coat and posture, and the antlers carve clean with a 1/16 inch cutter. ${a(G.gift, 'The gift guide')} lists what to carve for hunters, and ${a(G.time, 'the carve-time guide')} shows how to keep a big panel under four hours on the machine.</p>`,
    faq: [
      { q: 'Are these good for a large panel over 600 mm?', a: 'Yes. Files are supplied at full depth and resolution, so scaling up keeps detail; only the toolpath time grows. ' + a(G.scale, 'The scaling guide') + ' explains the depth rule.' },
      { q: 'Which finish suits lodge decor?', a: 'A warm stain under a dark glaze, wiped back off the high points. ' + a(G.finish, 'The finishing guide') + ' walks through it step by step.' },
    ],
  },
  'pet-lover-carvings': {
    seo_title: 'Dog & Cat Relief STL Files: Labrador, Shepherd, Spaniel, Pet Memorials | DigitalChiselCo',
    seo_description: 'Pet bas-relief STL files for CNC carving: labradors, german shepherds, australian shepherds, spaniels, terriers, cats, paw prints and pet memorial plaques. Instant download.',
    intro: `<p>Labradors, german and australian shepherds, spaniels, retrievers, terriers, huskies, cats, paw prints and memorial plaques with a place for a name. Pet pieces are bought with more emotion than anything else we make, often as memorials, so the breeds here are drawn to be recognisable at a glance: the right ears, the right coat, the right expression.</p>
<p>Most are portrait-style busts or head-and-shoulders designed for 200 to 350 mm, which makes them quick to carve and easy to gift. Cherry and maple show the coat well; walnut suits the darker breeds. Every memorial design leaves clean space for a name and dates in v-carved lettering. ${a(G.finish, 'The finishing guide')} shows how to bring out fur with a glaze, and ${a(G.sell, 'the selling guide')} explains why personalised pet work carries a premium.</p>`,
    faq: [
      { q: 'Can I add a pet\'s name and dates?', a: 'Yes. The memorial designs have a flat band for lettering; on portraits, add text in the border with a v-bit in your CAM software.' },
      { q: 'How long does a 250 mm dog portrait take?', a: 'About two hours on the machine plus finishing. ' + a(G.first, 'The first-carving guide') + ' walks a beginner through a piece of exactly this size.' },
    ],
  },
  'bald-eagle-patriotic': {
    seo_title: 'Bald Eagle & Patriotic Relief STL Files: Eagles, Flags, Military, Veteran Plaques | DigitalChiselCo',
    seo_description: 'Patriotic bas-relief STL files for CNC carving: bald eagle heads and full eagles, American flags, military and veteran tribute plaques, first responder designs. Instant download, commercial use.',
    intro: `<p>Eagle heads in profile, eagles landing with the flag behind them, waving flags, military branch tributes, first-responder and veteran plaques. Patriotic pieces sell year round and spike hard before Memorial Day, Independence Day and Veterans Day, and they are the standard gift for retirements from service.</p>
<p>Feathers and flag folds are sculpted at full depth so they carve clean at 300 mm with a 1/16 inch cutter, and the eagle heads work down to 150 mm for plaques and coasters. Oak and walnut suit them; a flag carved in maple and stained in two tones is a classic. Many designs leave a flat field for a name, rank and dates. ${a(G.gift, 'The gift guide')} lists the occasions, and ${a(G.finish, 'the finishing guide')} covers two-tone staining.</p>`,
    faq: [
      { q: 'Can I add a name and service dates?', a: 'Yes. The plaque designs are built with a lettering field; use a v-bit or raised lettering in your CAM software.' },
      { q: 'What size do the eagle heads carve at?', a: 'From 150 mm coasters to 600 mm wall pieces. The feather detail is drawn for a 1/16 inch finishing cutter at 300 mm.' },
    ],
  },
  'native-american': {
    seo_title: 'Native American Relief STL Files: Chiefs, Warriors, Wolves, Buffalo, Dreamcatchers | DigitalChiselCo',
    seo_description: 'Native American themed bas-relief STL files for CNC carving: chief portraits in headdress, warriors on horseback, wolf and eagle spirit scenes, buffalo, dreamcatchers. Instant download.',
    intro: `<p>Chief portraits in full headdress, warriors on horseback, spirit scenes with wolves and eagles, buffalo on the plains and dreamcatchers. These are among the most detailed reliefs in the catalogue, because a headdress is hundreds of individual feathers and beads, and the faces are sculpted with real character rather than a generic profile.</p>
<p>They are best carved large, 350 mm and up, in walnut, cherry or mahogany, where a dark glaze brings out every feather. The dreamcatchers and single-animal pieces work smaller. ${a(G.bits, 'The cutter guide')} explains why this detail wants a tapered ball nose, and ${a(G.flat, 'the "looks flat" guide')} shows how to keep the depth in a portrait when you scale it.</p>`,
    faq: [
      { q: 'What cutter do the headdress designs need?', a: 'A 1/16 inch tapered ball nose at 300 mm and up; a 1/32 inch for the face and beadwork if you carve below that.' },
      { q: 'Which wood suits these portraits?', a: 'Walnut, cherry and mahogany for a rich, dark result. ' + a(G.wood, 'The wood guide') + ' compares eight species on one design.' },
    ],
  },
  'floral-botanical': {
    seo_title: 'Floral & Botanical Relief STL Files: Roses, Wildflowers, Leaves, Trees of Life | DigitalChiselCo',
    seo_description: 'Floral bas-relief STL files for CNC carving and 3D printing: roses, wildflowers, crocus, sunflowers, botanical panels, leaf borders and trees of life. Instant download, commercial use.',
    intro: `<p>Roses, crocus and sunflowers, wildflower meadows, acanthus and leaf scrollwork, and trees of life in several styles. Floral relief is the classic ornament of furniture and it still sells in every direction: door panels, cabinet inserts, jewellery boxes, round wall pieces, and the borders around a name on a wedding or anniversary plaque.</p>
<p>Petals are carved with real thickness and overlap, so they finish clean and take a glaze without filling. The botanical panels are drawn to tile and to mirror for a matching pair. They carve beautifully in maple, cherry and basswood, and the shallower designs are ideal first projects. ${a(G.beginner, 'The beginner projects guide')} starts with a rose, and ${a(G.finish, 'the finishing guide')} covers the pale, natural finishes that suit botanical work.</p>`,
    faq: [
      { q: 'Are floral designs a good first carving?', a: 'Yes, the shallower ones especially. They forgive small errors and finish fast. ' + a(G.first, 'The first-carving guide') + ' takes a beginner through the whole process.' },
      { q: 'Can I use these as furniture inserts?', a: 'Yes. Most panels are rectangular with a clean border and scale to drawer fronts and door panels without losing detail.' },
    ],
  },
  'coastal-nautical': {
    seo_title: 'Coastal & Nautical Relief STL Files: Anchors, Lighthouses, Sea Turtles, Ships | DigitalChiselCo',
    seo_description: 'Nautical bas-relief STL files for CNC carving: anchors wrapped in rope, lighthouses, tall ships, sea turtles, whales, crabs, lobsters and coastal trays. Instant download, commercial licence.',
    intro: `<p>An anchor wrapped in rope on weathered planks, lighthouses in a storm, tall ships, sea turtles, whales, crabs and lobsters for the serving trays, shipwreck scenes and compass roses. Coastal pieces sell in beach towns, on boats, and to everyone who wishes they lived near the water, which is most people.</p>
<p>Rope, scales and shell are the details that matter here and they are sculpted, not stamped, so they carve clean at 250 mm and up. The trays in this collection are designed food-safe with a flat base. Maple and cherry suit the trays; weathered oak and driftwood-toned pine suit the wall pieces. ${a(G.finish, 'The finishing guide')} shows a white-washed coastal finish, and ${a(G.gift, 'the gift guide')} covers the beach-house market.</p>`,
    faq: [
      { q: 'Are the tray designs food safe?', a: 'The geometry is, with a flat base and shallow rim. Finish with a food-safe oil or hardwax as ' + a(G.finish, 'the finishing guide') + ' describes.' },
      { q: 'What size are the anchor and lighthouse panels?', a: 'Designed for 250 to 450 mm. The rope detail on the anchor holds up down to 200 mm with a 1/16 inch cutter.' },
    ],
  },
  'funny-animal-series': {
    seo_title: 'Funny Animal Relief STL Files: Moose, Donkeys, Goats, Cows with Character | DigitalChiselCo',
    seo_description: 'Funny animal bas-relief STL files for CNC carving: grinning moose, laughing donkeys, goats, cows, dogs and bears with real expressions. Instant download, commercial use.',
    intro: `<p>A moose with a grin, a donkey mid-laugh, a goat that looks like it is up to something, cows, bears and dogs with expressions people stop and photograph. These are the pieces that sell themselves at a market table, because a laugh is the fastest way to get someone to pick up a carving, and they make gifts for the people who already have everything serious.</p>
<p>Expression lives in the eyes and mouth, so those are sculpted deep and clean and carve well from 150 mm up, which makes this an easy collection for smaller machines, coasters and trays. Cherry and maple show the character best. ${a(G.beginner, 'The beginner projects guide')} includes a funny animal as a weekend project, and ${a(G.sell, 'the selling guide')} covers what sells at fairs.</p>`,
    faq: [
      { q: 'Do these work on small machines?', a: 'Yes. Most are single-subject designs that carve well at 150 to 250 mm with a 1/16 inch cutter.' },
      { q: 'Which finish keeps the expression readable?', a: 'A light stain and a dark glaze wiped off the high points; the eyes and teeth need the contrast. ' + a(G.finish, 'The finishing guide') + ' shows the step.' },
    ],
  },
  'vintage-wwii-planes': {
    seo_title: 'Vintage & WWII Aircraft Relief STL Files: Spitfire, Mustang, Bombers, Biplanes | DigitalChiselCo',
    seo_description: 'Vintage aircraft bas-relief STL files for CNC carving: Spitfire, P-51 Mustang, B-17 and Lancaster bombers, biplanes and warbirds in flight. Instant download, commercial licence.',
    intro: `<p>Spitfires, Mustangs, heavy bombers, biplanes and warbirds banking through cloud. Aviation pieces have a dedicated audience: pilots, veterans and their families, museum shops and anyone with a hangar or a den, and they are a rare category where the buyer knows the exact aircraft and will check the details.</p>
<p>So the details are right: panel lines, cowlings, canopies and propellers are sculpted from reference, and the cloud and ground beneath give a real sense of altitude. They carve best at 300 to 500 mm in cherry, walnut or maple, and they make excellent laser grayscale engravings because the metal surfaces read well as tone. ${a(G.laser, 'The laser guide')} covers the conversion, and ${a(G.gift, 'the gift guide')} lists aviation occasions.</p>`,
    faq: [
      { q: 'Are the aircraft accurate?', a: 'Yes. Each was modelled from reference for the specific type, so the markings, canopy and wing shapes are right.' },
      { q: 'Do these engrave well on a laser?', a: 'Very well. Aircraft surfaces convert cleanly to grayscale. ' + a(G.laser, 'The laser guide') + ' explains the process and materials.' },
    ],
  },
  'memorial-tribute': {
    seo_title: 'Memorial & Tribute Relief STL Files: Angels, Veteran Plaques, Remembrance | DigitalChiselCo',
    seo_description: 'Memorial bas-relief STL files for CNC carving: angels, praying hands, veteran and first-responder tributes, remembrance plaques with space for a name. Instant download, commercial use.',
    intro: `<p>Grieving angels, praying hands, veteran and first-responder tributes, remembrance plaques with room for a name and dates, and pieces for the loss of a pet. Memorial work is quiet, personal and never argued over on price; it is often the most meaningful thing a maker produces in a year.</p>
<p>Every design here leaves a clean, flat field for lettering, and the figures are sculpted with restraint so they suit a home, a church or a garden. Walnut and cherry suit indoor pieces; for outdoor memorials use white oak or cedar and an exterior finish. ${a(G.finish, 'The finishing guide')} covers exterior finishes, and ${a(G.sell, 'the selling guide')} explains how to price commissioned memorials.</p>`,
    faq: [
      { q: 'Can these be used outdoors?', a: 'Yes, carved in white oak, cedar or teak and sealed with an exterior finish. ' + a(G.finish, 'The finishing guide') + ' lists suitable products.' },
      { q: 'Is there space for names and dates?', a: 'Every memorial design includes a flat lettering field. Add text with a v-bit in your CAM software.' },
    ],
  },
  'unique-3d': {
    seo_title: 'Unique 3D Relief STL Files: Trays, Bundles, Custom Portraits and One-of-a-Kind Designs | DigitalChiselCo',
    seo_description: 'One-of-a-kind bas-relief STL files: serving tray sets, custom portrait reliefs, mixed bundles and designs that fit no other category. For CNC routers, 3D printers and laser engravers.',
    intro: `<p>The pieces that do not fit a shelf: serving tray sets, custom portrait reliefs made from your own photograph, multi-design bundles, and the designs we made because a customer asked and nobody else had one. If you are looking for something you have not seen at every craft fair, start here.</p>
<p>Everything follows the same rule as the rest of the catalogue: sculpted at full depth, tested at the machine, supplied with a commercial licence. ${a(G.quality, 'What makes a good relief file')} explains what to look for in any STL, and ${a(G.print, 'the 3D printing guide')} covers the designs here that were made with printers in mind.</p>`,
    faq: [
      { q: 'How does the custom portrait relief work?', a: 'You send a clear, front-lit photograph after purchase and receive a sculpted STL of the subject, ready to carve or print. Details are on the product page.' },
      { q: 'What is in a bundle?', a: 'Several related designs at a lower price than buying them singly, delivered together. Each bundle page lists every file it contains.' },
    ],
  },
  '3d-map-relief': {
    seo_title: '3D Map Relief STL Files: Topographic Terrain, Lakes, Mountains and Coastlines | DigitalChiselCo',
    seo_description: 'Topographic map bas-relief STL files for CNC carving and 3D printing: mountain ranges, lakes, coastlines and terrain models with real elevation. Instant download, commercial use.',
    intro: `<p>Mountain ranges, lake basins, coastlines and terrain models with real elevation data, ready to carve as a wall map or print as a desk piece. Map reliefs are a favourite of cabin owners, hikers, sailors and anyone with a place they love, and they are among the most-searched STL subjects there is.</p>
<p>Elevation is exaggerated just enough to read in wood without turning peaks into spikes, and the water is left flat and low so it can be stained or resin-filled. Carve them in maple or cherry for a clean modern look, or walnut for a classic one; they also print well on FDM at any size. ${a(G.scale, 'The scaling guide')} explains how depth changes with size, and ${a(G.print, 'the 3D printing guide')} covers printing a terrain model flat.</p>`,
    faq: [
      { q: 'Can I get a map of a specific place?', a: 'Ask through the design request board or the contact page. Custom terrain models are made to order for a specific area.' },
      { q: 'Can I fill the water with resin?', a: 'Yes. The water is a flat, lower plane on every map, so a tinted epoxy pour sits cleanly against the shoreline.' },
    ],
  },
  'valentine-love': {
    seo_title: 'Valentine & Love Relief STL Files: Hearts, Couples, Wedding and Anniversary Plaques | DigitalChiselCo',
    seo_description: 'Romantic bas-relief STL files for CNC carving: hearts with roses, entwined couples, wedding rings, anniversary plaques and Valentine gifts with space for names. Instant download.',
    intro: `<p>Hearts wrapped in roses, couples entwined, wedding rings and bows, and anniversary plaques with a field for two names and a date. Romantic pieces sell in two waves, February and wedding season, and steadily in between as anniversary gifts, which makes them one of the easiest categories to plan a year around.</p>
<p>They are designed small on purpose, 150 to 300 mm, so they carve in an hour or two and suit a gift box. Cherry and maple suit them; a pale finish with a little glaze in the recesses is the classic look. ${a(G.gift, 'The gift guide')} covers occasions and timing, and ${a(G.beginner, 'the beginner projects guide')} starts with a heart panel.</p>`,
    faq: [
      { q: 'Can I add two names and a date?', a: 'Yes. The plaque designs include a lettering field, and the heart panels leave a clean border for v-carved text.' },
      { q: 'How quickly can I carve one for a deadline?', a: 'A 200 mm heart panel is about an hour on the machine plus a day for finish to cure. ' + a(G.time, 'The carve-time guide') + ' has the numbers.' },
    ],
  },
  'turkish-morrocon-arabic-and-eastern': {
    seo_title: 'Arabic, Turkish & Eastern Relief STL Files: Islamic Geometry, Calligraphy, Ornament | DigitalChiselCo',
    seo_description: 'Eastern ornament bas-relief STL files for CNC carving: Islamic geometric patterns, arabesque, Turkish and Moroccan motifs, calligraphy panels and mihrab-style arches. Instant download.',
    intro: `<p>Islamic geometric patterns, arabesque scrollwork, Turkish and Moroccan tile motifs, calligraphy panels and arches in the style of a mihrab. This ornament has been carved into wood and stone for a thousand years, and it suits CNC work better than almost any other tradition because it is built on precise repeating geometry.</p>
<p>The patterns tile and mirror cleanly, so a single file becomes a door, a screen or a full wall panel. Depth is shallow and even, which makes them fast to carve and ideal for laser grayscale engraving as well. Maple, walnut and mahogany suit them. ${a(G.laser, 'The laser guide')} covers engraving ornament, and ${a(G.scale, 'the scaling guide')} explains how to tile a pattern to a larger panel.</p>`,
    faq: [
      { q: 'Do the patterns repeat seamlessly?', a: 'Yes. The geometric panels are drawn on a true repeat so they tile edge to edge for screens and large panels.' },
      { q: 'Is the calligraphy accurate?', a: 'The calligraphy panels were checked by native readers so the letterforms and phrases are correct.' },
    ],
  },
  'premium-bundle-offer': {
    seo_title: 'Premium STL Bundle Offers: Relief File Packs for CNC at a Lower Price | DigitalChiselCo',
    seo_description: 'Bundle packs of bas-relief STL files for CNC carving and 3D printing at a lower price than buying singly: wildlife, religious, fishing, farmhouse and mixed collections. Instant download.',
    intro: '',
    faq: [
      { q: 'How much do bundles save?', a: 'Typically 40 to 60 percent against the single prices of the files inside. Each bundle page lists every design it contains.' },
    ],
  },
  'subscription-plans': {
    seo_title: 'STL Membership Plans: Monthly Relief File Drops for CNC Makers | DigitalChiselCo',
    seo_description: 'Membership plans that deliver a curated pack of new bas-relief STL files every month, with member pricing on the catalogue. For CNC routers, 3D printers and laser engravers.',
    intro: `<p>A membership delivers a curated pack of new relief files every month, chosen to sell, plus member pricing across the catalogue. It suits makers who carve to sell and want a steady stream of fresh designs without buying one at a time.</p>`,
    faq: [
      { q: 'Can I keep the files after I cancel?', a: 'Yes. Every file delivered during your membership is yours to keep, with its commercial licence.' },
    ],
  },
};

const res = await fetch(U + 'categories?select=id,slug,name', { headers: H });
const cats = await res.json();
let n = 0;
for (const c of cats) {
  const copy = COPY[c.slug];
  if (!copy) { console.log('  (no copy for', c.slug + ')'); continue; }
  const body = { seo_title: copy.seo_title, seo_description: copy.seo_description, intro_html: copy.intro || null, faq: [...copy.faq, ...COMMON_FAQ] };
  for (const v of [body.seo_title, body.seo_description, body.intro_html || '', JSON.stringify(body.faq)]) {
    if (v.includes('—')) throw new Error('em dash in copy for ' + c.slug);
  }
  if (DRY) { console.log(c.slug, '|', body.seo_title, '|', (body.intro_html || '').replace(/<[^>]+>/g, '').split(/\s+/).length, 'words'); continue; }
  const r = await fetch(U + 'categories?id=eq.' + c.id, { method: 'PATCH', headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(c.slug + ': ' + r.status + ' ' + (await r.text()).slice(0, 200));
  n++;
}
console.log(DRY ? 'dry run complete' : `updated ${n} collections`);

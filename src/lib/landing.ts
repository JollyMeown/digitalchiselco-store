// Intent-targeted SEO landing pages. Each topic renders a curated grid of
// matching designs + unique copy at /designs/<slug>, targeting long-tail
// searches makers actually type. Keyword matching is against the product title.
export type LandingTopic = {
  slug: string;
  h1: string;
  title: string;          // <title> / meta
  intro: string;          // unique intro copy (SEO + human)
  keywords: string[];     // title ILIKE ANY of these; empty = show bestsellers
  faqs?: { q: string; a: string }[];
};

export const LANDING_TOPICS: LandingTopic[] = [
  // ── Machine / use-case intent ──────────────────────────────────────
  { slug: 'for-cnc-router', h1: 'Bas-Relief STL Files for CNC Routers', title: 'CNC Router STL Files — Bas-Relief Designs for Carving',
    intro: 'Ready-to-carve 3D relief STL files built for CNC routers. Clean geometry and smooth toolpaths in Aspire, VCarve Pro, Carveco and Fusion 360. Instant download, carve on wood, acrylic or MDF.', keywords: [] },
  { slug: 'for-laser-engraver', h1: 'STL & Relief Designs for Laser Engravers', title: 'Laser Engraving Files — Relief & Grayscale Designs',
    intro: 'Detailed relief designs suited to laser engraving and 3D laser carving. Grayscale-friendly depth and crisp edges. Download instantly and burn or carve on wood, slate and more.', keywords: [] },
  { slug: 'for-3d-printing', h1: 'Bas-Relief STL Files for 3D Printing', title: '3D Printing STL Files — Relief Wall Art & Plaques',
    intro: 'Watertight relief STL files that print beautifully on FDM and resin printers. Perfect for wall art, plaques and decor. Instant download, no supports headaches on flat-backed reliefs.', keywords: [] },

  // ── Theme intent ───────────────────────────────────────────────────
  { slug: 'skull-designs', h1: 'Skull CNC Relief STL Files', title: 'Skull STL Files for CNC & Laser — Bas-Relief Designs',
    intro: 'Bold skull relief designs for CNC routers and laser engravers, from biker and western skulls to gothic and reaper art. Instant STL download, carve on wood or acrylic.',
    keywords: ['skull', 'reaper', 'skeleton', 'grim'],
    faqs: [{ q: 'What software opens these skull STL files?', a: 'Any CAM software that imports STL, including Aspire, VCarve Pro, Carveco, ArtCAM and Fusion 360.' }] },
  { slug: 'religious-christian', h1: 'Christian & Religious Relief STL Files', title: 'Christian STL Files — Jesus, Cross & Faith CNC Designs',
    intro: 'Faith-inspired relief designs: Jesus portraits, crosses, praying hands, scripture and church art. Ready to carve for gifts and home decor. Instant STL download.',
    keywords: ['jesus', 'cross', 'christ', 'faith', 'prayer', 'praying', 'religious', 'church', 'angel', 'bible', 'psalm'] },
  { slug: 'wildlife-animals', h1: 'Wildlife & Animal Relief STL Files', title: 'Animal STL Files — Wildlife CNC Relief Designs',
    intro: 'Wildlife and animal relief designs, from deer, bears and wolves to birds, horses and pets. High-detail carving files for hunters, nature lovers and gifts.',
    keywords: ['deer', 'bear', 'wolf', 'eagle', 'horse', 'lion', 'elephant', 'bird', 'fox', 'owl', 'buffalo', 'elk', 'animal', 'wildlife'] },
  { slug: 'western-cowboy', h1: 'Western & Cowboy Relief STL Files', title: 'Western STL Files — Cowboy & Rustic CNC Designs',
    intro: 'Western and cowboy relief designs with rustic character: horses, boots, hats, cattle and frontier scenes. Perfect for ranch decor and country gifts.',
    keywords: ['cowboy', 'western', 'horse', 'rodeo', 'cattle', 'bull', 'ranch', 'boot'] },
  { slug: 'fishing-nautical', h1: 'Fishing & Nautical Relief STL Files', title: 'Fishing & Nautical STL Files — CNC Relief Designs',
    intro: 'Fishing and nautical relief designs: trout, bass, anchors, ships and coastal scenes. Great for cabins, docks and gifts for anglers.',
    keywords: ['fish', 'trout', 'bass', 'nautical', 'anchor', 'ship', 'ocean', 'marine', 'fishing', 'kraken', 'whale', 'shark'] },
  { slug: 'floral-botanical', h1: 'Floral & Botanical Relief STL Files', title: 'Floral STL Files — Flowers & Botanical CNC Designs',
    intro: 'Elegant floral and botanical relief designs: roses, mandalas, trees of life and vines. Timeless carving files for signs, panels and gifts.',
    keywords: ['floral', 'flower', 'rose', 'mandala', 'tree', 'botanical', 'leaf', 'vine', 'bloom'] },
  { slug: 'memorial-pet', h1: 'Pet Memorial & Remembrance STL Files', title: 'Pet Memorial STL Files — Paw & Remembrance CNC Designs',
    intro: 'Heartfelt pet memorial and remembrance relief designs: paw prints, portraits and keepsake plaques. Carve a lasting tribute. Instant STL download.',
    keywords: ['memorial', 'paw', 'pet', 'remembrance', 'dog', 'cat', 'in loving memory'] },
  { slug: 'patriotic-military', h1: 'Patriotic & Military Relief STL Files', title: 'Patriotic STL Files — Flag & Military CNC Designs',
    intro: 'Patriotic and military relief designs: flags, eagles, service tributes and memorials. Meaningful carving files for veterans and gifts.',
    keywords: ['flag', 'patriotic', 'military', 'veteran', 'eagle', 'soldier', 'army', 'usa', 'american'] },
  { slug: 'gothic-dark', h1: 'Gothic & Dark Art Relief STL Files', title: 'Gothic STL Files — Dark Art CNC Relief Designs',
    intro: 'Gothic and dark-art relief designs with dramatic depth: skulls, ravens, celtic knotwork and haunted themes. Bold pieces for statement carvings.',
    keywords: ['gothic', 'raven', 'celtic', 'dark', 'haunted', 'demon', 'dragon', 'grim'] },
];

export const topicBySlug = (slug: string) => LANDING_TOPICS.find((t) => t.slug === slug);

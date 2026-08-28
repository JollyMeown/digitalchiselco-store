# Changes — 2026-08-28 · Vase Lampshade Studio launch (product + landing + playground)

Second software product on the store (after Laser Studio): **Vase Lampshade Studio**, a
parametric 3D-printable lampshade generator with built-in E27/E14 fitters and one-piece
vase-mode printing. Sold ONLY on the website (no Etsy for this one); a free demo funnels
in from Cults3D and from an in-browser playground on the site itself.

## New pages & routes

| Route | What it is |
|---|---|
| `/lamp-studio` | Product landing page (`src/pages/lamp-studio.astro`), mirrors laser-studio.astro patterns: `Shell` + `Breadcrumbs` + `getSettings`, reveal animations, admin-overridable images & buy URL |
| `/lamp-studio-app/` | The FREE in-browser playground (`public/lamp-studio-app/` — static copy of the studio app, ~1.4 MB incl. vendored three.js). Full designer works; exports open an upsell modal → the product page |
| `/product/vase-lampshade-studio` | Normal store product (row in `products`), $14.99 |

### Landing page sections
Hero (AI marketing poster) → six benefit cards → **live playground iframe**
(`/lamp-studio-app/index.html?demo=1&buy=…`) → **"Inside the studio"** (4 balloon-annotated
UI screenshots, click to open full size) → **sample print guide** (page-1 preview +
downloadable PDF) → feature poster + checklist → facts → CTA.

### SEO
- Title/description keyword-set: *3D printable lampshade generator, vase mode STL, E27/E14 fitter, lithophane*.
- `Shell` product OG props (`image`, `ogType="product"`, `price`, `currency`, `availability`).
- `SoftwareApplication` JSON-LD with `Offer` ($14.99) inline on the page.
- Keyword-rich image `alt`s throughout.

## Admin-managed settings (all optional, static fallbacks shipped)
- `vls_hero_url`, `vls_poster_url` — landing images (fallback `/lamp-studio/hero.jpg`, `/poster.jpg`)
- `vls_buy_url` — buy-button target (fallback `/product/vase-lampshade-studio`)

## Product row (created directly via service key)
- `products`: slug `vase-lampshade-studio`, id `8991e8de-d036-420d-87e6-c4e2d6edfc0f`,
  price_usd 14.99, `gallery` = 7 site-hosted marketing posters
  (`/lamp-studio/gallery-1..7.jpg`), SEO description, `link_status='certain'`, active.
- `product_downloads`: Google Drive buyer ZIP (Setup.exe + illustrated manual + checksums
  + quick-start), file id `1pxTZTtblDw-w4l4ohipd-u87Psq2wm_f` — delivery rides the normal
  Paddle webhook → order email flow, zero new plumbing.
- Helper: `scripts/finish-lamp-studio.mjs "<drive-link>"` re-points the download link.

## Product page template change (`src/pages/product/[slug].astro`)
The benefit bullets are now **conditional**: `p.slug === 'vase-lampshade-studio'` renders
software bullets (Windows installer + manual, works with Orca/Cura/Prusa/Bambu, 105
designs/fitter/vase-mode, free v1.x updates, commercial licence) **plus a
"▶ Try the live demo in your browser first" button** → `/lamp-studio#playground`.
All other products keep the original STL bullets. Extend the same branch for future
software products.

## Playground app (public/lamp-studio-app/) — notable behaviours
- Demo gating: `?demo=1` (or `window.VLS_DEMO=true`) keeps the full designer usable but
  exports + PDF guide open the "Get the full studio →" modal; `&buy=` sets the target.
  No Etsy mention anywhere (sells on-site).
- **Fitter auto-fit** (added this session): the Fitter step shows Bottom/Top radius
  sliders, warns when the selected holder's ring doesn't fit through the opening
  (the fitter is auto-omitted in that case), and a one-click
  **"⚡ Fit opening to <holder>"** button widens the mounting opening to the computed
  minimum (`bore/2 + hubWall + rimClearance + 4`, scaled against the current ring
  minimum). Fixes "why is there no fitter?" in the demo.
- App source of truth lives at `D:\LAMP SHADE OGEE\studio\` — copy changed files into
  `public/lamp-studio-app/` when it evolves (js/main.js, js/ui.js, styles/app.css…).

## Navigation
`src/components/Header.astro`: added `{ href: '/lamp-studio', label: 'Lamp Studio' }`
(desktop row + mobile menu), next to Laser Studio.

## Cults3D free-demo funnel
- FREE listing (Home category) created via `scripts/cults3d_lamp_studio_demo.mjs`
  (one-off reuse of the batch uploader's `createCreation`):
  <https://cults3d.com/en/3d-model/home/vase-lampshade-studio-free-lamp-shade-generator-105-designs-built-in-e27-e1>
- File = demo installer ZIP on Drive (`1Q6X8w_D6BKCpIr5AbyK8hX7SAZE-eO-j`), images = the
  site gallery URLs, description links to `/lamp-studio`.
- **API gotchas (remember):** image URLs MUST be apex domain — `www.` 301-redirects and
  Cults returns an opaque `"Unexpected error!"`; a free listing needs `downloadPrice: 0`
  (`null` → `"Price must be filled"`).

## Assets added (`public/lamp-studio/`)
`hero.jpg`, `poster.jpg`, `gallery-1..7.jpg` (AI marketing posters), `ui-1..4.jpg`
(annotated app screenshots), `guide-preview.jpg` + `sample-print-guide.pdf`
(app-generated per-design print guide, downloadable from the landing page).

## Repo gotchas fixed
- `.gitignore` has a global `*.html` rule → `public/lamp-studio-app/index.html` had to be
  `git add -f`'d (any future public HTML needs the same).
- New `.gitattributes` with `*.pdf -text`: the app's raw-written PDFs look like text to
  git and autocrlf conversion would corrupt them on checkout.

## Deliverables outside the repo (dev machine)
- Desktop app + installers: `D:\LAMP SHADE OGEE\desktop\` (electron-builder NSIS;
  `dist/` = paid Setup.exe, `dist-demo/` = free demo; `DISTRIBUTION.md` = security
  playbook, `PRODUCT-COPY.md`, `CHECKSUMS.txt`).
- Reference manual PDF + poster/hero art: `D:\LAMP SHADE OGEE\studio\`.
- Drive uploads go through BRS: `D:\000 BUNDLE RELIEF STUDIO\venv\Scripts\python.exe
  drive_upload_file.py <file>` (prints the public direct-download link).

## Open / next
- Rebuild the demo installer (picks up the ⚡ fit-opening button) next version bump and
  refresh the Cults3D file.
- One end-to-end test purchase of the $14.99 product (delivery email with Drive link).
- Optional later: code-signing cert to remove the SmartScreen prompt; $4.99 web
  single-export credit tier (needs server-side metering — deliberately deferred).

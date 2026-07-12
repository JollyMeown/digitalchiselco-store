# Changes — 2026-07-12: PDF Maker tab + gallery drag-reorder

## 1. New admin tab: ⎙ PDF Maker (`src/components/admin/tabs/PdfMaker.tsx`)

Builds the branded customer "download links" PDF entirely in the browser (jsPDF,
new dependency) — nothing is uploaded; the file lands in the admin's Downloads
folder. Registered in `AdminApp.tsx` under key `pdfmaker`, right below Bundle
Composer.

**What the PDF contains** (mirrors the desktop Bundle Relief Studio generator):
- Cover: site logo (fetched live from `site_settings.logo_image_url`), title,
  subtitle, thank-you note signed *Jolly*, HOW-TO-DOWNLOAD explainer,
  VISIT-THE-STORE + EMAIL-JOLLY buttons.
- One card per product: chosen picture, name, clickable bronze
  **DOWNLOAD STL FILE** button pointing at the product's Google Drive link.
- Footers with clickable site + email links, page numbers.
- Theme constants: bronze `#854F0B`, bronze-dark `#6b3f09`, cream `#FAEEDA` /
  `#fbf4e6`, gold `#FAC775`; Times (serif) + Helvetica (jsPDF built-ins).

**Data sources**: `products` (title/slug/image_url/gallery),
`product_downloads` (first link by `sort_order`), `bundle_items` (when loading
a bundle's members), `site_settings.logo_image_url` (logo).

**Rules**:
- A product without a Drive link shows a red badge and is **skipped**.
- Admin picks each product's PDF picture from its catalog thumbnails.
- Pictures are compressed client-side to 900 px JPEG q0.8 → the PDF stays far
  under Etsy's 20 MB digital-file cap.
- Cover title default: single product → the product's own title (up to the
  first `|`); multiple products → "Bundle Downloads". Never shows the word
  "Bundle" for a one-product PDF (fix after owner feedback).
- Product-page header suffix: `— STL Download` (1 product) / `— STL Bundle`.

## 2. Products tab: drag gallery pictures to reposition / set the hero

In the product edit form (`src/components/admin/tabs/Products.tsx`), gallery
thumbnails are now **draggable** (HTML5 drag & drop, no new dependency):

- Drag any thumbnail and drop it on another to reorder.
- The **first** picture is the hero — it carries a ⭐ HERO badge, and dropping
  a picture into first place also updates the product's `image_url`, keeping
  the site convention **`image_url` = `gallery[0]`** (catalog card and product
  page main photo stay in sync).
- Delete (×) buttons unchanged; tooltips explain the behaviour.

## Dependency added

- `jspdf` (client-side PDF generation; dynamically imported so it only loads
  when the admin presses Generate).

## Related (outside this repo)

The desktop Bundle Relief Studio app (`D:\000 BUNDLE RELIEF STUDIO`) has the
same generator for local folders (`make_download_pdf.py`, "📄 Download PDF"
button) plus an auto-mode that builds the PDF the moment a design folder
receives its `GoogleDriveDownloadLink.txt`.

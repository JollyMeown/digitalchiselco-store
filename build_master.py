import csv, re, json

def slugify(s):
    s = s.lower().split("|")[0]
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return re.sub(r"-+", "-", s)[:80]

links = {r["etsy_listing_id"]: r for r in csv.DictReader(open("products_with_links.csv", encoding="utf-8"))}
web = {r["etsy_listing_id"]: r for r in csv.DictReader(open(r"D:/MOBILE WEBSITE/products_master.csv", encoding="utf-8"))}

conf_color = {"certain": "green", "likely": "yellow", "REVIEW": "red"}

out = []
slugs = set()
for lid, p in links.items():
    w = web.get(lid, {})
    slug = w.get("url_slug") or slugify(p["title"])
    base = slug; i = 2
    while slug in slugs:
        slug = f"{base}-{i}"; i += 1
    slugs.add(slug)
    conf = p["confidence"]
    color = "red" if conf.startswith("BUNDLE") else conf_color.get(conf, "yellow")
    out.append({
        "etsy_listing_id": lid,
        "title": p["title"],
        "slug": slug,
        "price_usd": p["price_usd"],
        "primary_category": p["primary_category"],
        "all_categories": p.get("all_categories", p["primary_category"]),
        "image_url": w.get("image_url", ""),            # clean il_794xN where available
        "download_link": p["download_link"],
        "n_links": p["n_links"],
        "drive_file_id": p["drive_file_id"],
        "matched_stl_name": p["matched_stl_name"],
        "link_status": conf,                            # certain/likely/REVIEW/BUNDLE-MANUAL
        "link_color": color,                            # green/yellow/red for admin
        "has_image": "yes" if w.get("image_url") else "no",
    })

cols = list(out[0].keys())
with open("master_products.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(out)

from collections import Counter
print("rows:", len(out))
print("link_color:", dict(Counter(r["link_color"] for r in out)))
print("has clean image:", sum(1 for r in out if r["has_image"] == "yes"), "/", len(out))
print("missing image (need re-fetch):", sum(1 for r in out if r["has_image"] == "no"))

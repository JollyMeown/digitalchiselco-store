import csv, json, re
from collections import Counter, defaultdict
from rapidfuzz import process, fuzz

def norm(s):
    s = s.lower()
    s = re.sub(r"\.(stl|zip|rar|3dm|obj)$", "", s)
    s = re.sub(r"\bfinal\b|\bcopy\b|\bv\d\b", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()

DL = "https://drive.google.com/uc?export=download&id="
products = list(csv.DictReader(open("etsy_master.csv", encoding="utf-8")))
stls_all = json.load(open("drive_stls.json", encoding="utf-8"))
folders = json.load(open("drive_folders.json", encoding="utf-8"))

stls = [f for f in stls_all if f["name"].lower().endswith((".stl", ".zip"))]
stl_norm = [norm(f["name"]) for f in stls]
file_tok = [set(n.split()) for n in stl_norm]
by_parent = defaultdict(list)
for f in stls:
    for par in f.get("parents", []):
        by_parent[par].append(f)
folder_norm = {f["id"]: norm(f["name"]) for f in folders}
folder_choices = list(folder_norm.values())
folder_byname = defaultdict(list)
for fid, nm in folder_norm.items():
    folder_byname[nm].append(fid)

BUNDLE = re.compile(r"\b(bundle|mega|membership|subscription)\b", re.I)

rows, buckets = [], Counter()
for p in products:
    title = p["title"]; tset = set(norm(title).split())
    base = {"etsy_listing_id": p["etsy_listing_id"], "title": title,
            "price_usd": p["price_usd"], "primary_category": p["primary_category"],
            "image_url": p.get("etsy_img", "")}
    if BUNDLE.search(title):
        # bundle folders don't lexically match product names -> require strong + 'bundle' in folder, else flag manual
        fm = process.extractOne(norm(title), folder_choices, scorer=fuzz.token_set_ratio)
        ok = fm and fm[1] >= 88 and ("bundle" in fm[0])
        fid = folder_byname[fm[0]][0] if ok else ""
        inside = by_parent.get(fid, []) if fid else []
        base.update({"match_score": round(fm[1],1) if fm else 0,
                     "confidence": f"BUNDLE({len(inside)})" if inside else "BUNDLE-MANUAL",
                     "n_links": len(inside),
                     "matched_stl_name": (" | ".join(x["name"] for x in inside))[:300] if inside else "",
                     "drive_file_id": fid,
                     "download_link": (" | ".join(DL + x["id"] for x in inside)) if inside else ""})
        buckets["BUNDLE" if inside else "BUNDLE-MANUAL"] += 1
    else:
        cands = process.extract(norm(title), stl_norm, scorer=fuzz.token_set_ratio, limit=15)
        best = None  # (containment, score, ntoks, idx)
        for _, sc, idx in cands:
            ft = file_tok[idx]
            if not ft: continue
            cont = len(ft & tset) / len(ft)
            key = (round(cont, 3), round(sc, 1), len(ft))
            if best is None or key > best[0]:
                best = (key, sc, cont, idx)
        idx = best[3]; sc = best[1]; cont = best[2]; f = stls[idx]
        if cont >= 0.85 and sc >= 80: conf = "certain"
        elif cont >= 0.7 and sc >= 72: conf = "likely"
        else: conf = "REVIEW"
        buckets[conf] += 1
        base.update({"match_score": round(sc,1), "confidence": conf, "n_links": 1,
                     "matched_stl_name": f["name"], "drive_file_id": f["id"],
                     "download_link": DL + f["id"], "containment": round(cont,2)})
    rows.append(base)

cols = ["etsy_listing_id","title","price_usd","primary_category","image_url",
        "match_score","confidence","n_links","matched_stl_name","drive_file_id","download_link"]
with open("products_with_links.csv","w",newline="",encoding="utf-8") as fo:
    w = csv.DictWriter(fo, fieldnames=cols, extrasaction="ignore"); w.writeheader(); w.writerows(rows)

print("buckets:", dict(buckets))
tot = sum(buckets.values())
solid = buckets.get("certain",0)+buckets.get("likely",0)+buckets.get("BUNDLE",0)
print(f"solid matches: {solid}/{tot}")
print("\nREVIEW samples (first 10):")
n=0
for r in rows:
    if r["confidence"]=="REVIEW":
        print(f"  [{r['match_score']}] {r['title'][:48]} -> {r['matched_stl_name'][:38]}"); n+=1
        if n>=10: break

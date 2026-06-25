import urllib.request, urllib.parse, json, sys, time

TOK = open("drive_token.txt").read().strip()

def api(q, page_token=None):
    params = {
        "q": q,
        "fields": "nextPageToken,files(id,name,mimeType,parents,size)",
        "pageSize": "1000",
        "supportsAllDrives": "true",
        "includeItemsFromAllDrives": "true",
    }
    if page_token:
        params["pageToken"] = page_token
    url = "https://www.googleapis.com/drive/v3/files?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + TOK})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

def collect(q, label):
    files, tok, pages = [], None, 0
    while True:
        d = api(q, tok)
        files.extend(d.get("files", []))
        tok = d.get("nextPageToken")
        pages += 1
        print(f"  {label}: page {pages}, total {len(files)}", flush=True)
        if not tok or pages > 60:
            break
        time.sleep(0.2)
    return files

stls = collect("name contains 'stl' and trashed = false", "stl-named")
# also grab folders to understand structure
folders = collect("mimeType = 'application/vnd.google-apps.folder' and trashed = false", "folders")

json.dump(stls, open("drive_stls.json", "w"), indent=0)
json.dump(folders, open("drive_folders.json", "w"), indent=0)

# quick breakdown
exts = {}
for f in stls:
    n = f["name"].lower()
    e = ".stl" if n.endswith(".stl") else (".zip" if n.endswith(".zip") else "other")
    exts[e] = exts.get(e, 0) + 1
print("-" * 50)
print("STL-named files:", len(stls), "| ext breakdown:", exts)
print("Folders:", len(folders))
print("Sample STL names:")
for f in stls[:5]:
    print("  -", f["name"][:70], "|", f.get("mimeType"))

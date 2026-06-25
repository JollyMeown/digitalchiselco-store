import csv, html, json, urllib.request, re

env = dict(l.strip().split('=', 1) for l in open('.env') if '=' in l and not l.startswith('#'))
URL = env['PUBLIC_SUPABASE_URL']; SRK = env['SUPABASE_SERVICE_ROLE_KEY']

web = {r['etsy_listing_id']: r for r in csv.DictReader(open(r'D:/MOBILE WEBSITE/products_master.csv', encoding='utf-8'))}
links = {r['etsy_listing_id']: r for r in csv.DictReader(open('products_with_links.csv', encoding='utf-8'))}
empty = [(lid, p) for lid, p in links.items() if not p['title'].strip()]

def patch(lid, title, price):
    body = json.dumps({'title': title, 'price_usd': price}).encode()
    req = urllib.request.Request(
        f"{URL}/rest/v1/products?etsy_listing_id=eq.{lid}",
        data=body, method='PATCH',
        headers={'apikey': SRK, 'Authorization': f'Bearer {SRK}',
                 'Content-Type': 'application/json', 'Prefer': 'return=minimal'})
    urllib.request.urlopen(req).read()

for lid, p in empty:
    w = web.get(lid)
    if w and w['title'].strip():
        title = html.unescape(w['title']).strip()
        price = float(w['price_usd']) if w.get('price_usd') else 0
        src = 'website'
    else:
        # fallback: clean the matched STL filename
        title = re.sub(r'\.(stl|zip)$', '', p['matched_stl_name'], flags=re.I).replace('  ', ' ').strip() or 'Untitled design'
        price = 6.50  # default single-file price
        src = 'stl-name/default'
    patch(lid, title, price)
    print(f"  {lid} <- [{src}] {title[:50]} | ${price}")

print(f"Patched {len(empty)} products.")

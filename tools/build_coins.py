# Справочник всех активных монет CoinGecko для поиска в приложении.
# Выход: out/coins.json — [[ТИКЕР, название, id, место по капитализации или 0, путь картинки], ...] по убыванию капитализации
import json, os, time, gzip, urllib.request, urllib.error
API = 'https://api.coingecko.com/api/v3'

def get(url, tries=8):
    for i in range(tries):
        try:
            rq = urllib.request.Request(url, headers={'User-Agent': 'moneylife-coins/1.0', 'Accept': 'application/json'})
            with urllib.request.urlopen(rq, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(30 * (i + 1)); continue  # лимит запросов — ждём и повторяем
            raise
        except Exception:
            time.sleep(15)
    raise RuntimeError('не скачалось: ' + url)

PFX = 'https://coin-images.coingecko.com/coins/images/'
rows, seen, page = [], set(), 1
while True:
    body = json.loads(get(f'{API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page={page}'))
    if not body: break
    for c in body:
        if c['id'] in seen: continue
        seen.add(c['id'])
        img = c.get('image') or ''
        if img.startswith(PFX) and 'missing' not in img:
            p = img[len(PFX):]                     # 1/large/bitcoin.png?1696501400
            parts = p.split('/', 2)
            img = parts[0] + '/' + parts[2] if len(parts) == 3 else p   # 1/bitcoin.png?1696501400
        else:
            img = ''
        rows.append([str(c.get('symbol') or '').upper(), c.get('name') or '', c['id'], c.get('market_cap_rank') or 0, img])
    print('страница', page, 'всего', len(rows), flush=True)
    if len(body) < 250: break
    page += 1
    time.sleep(7)

os.makedirs('out', exist_ok=True)
raw = json.dumps(rows, ensure_ascii=False, separators=(',', ':')).encode()
open('out/coins.json', 'wb').write(raw)
stats = {'coins': len(rows), 'ranked': sum(1 for r in rows if r[3]), 'with_img': sum(1 for r in rows if r[4]),
         'raw_kb': round(len(raw) / 1024), 'gzip_kb': round(len(gzip.compress(raw, 9)) / 1024)}
json.dump(stats, open('out/coins-stats.json', 'w'), indent=1)
print(stats)

# Справочник монет CoinGecko для поиска в приложении Money Life.
# Запуск: еженедельно в GitHub Actions (.github/workflows/coins.yml) или вручную:
#   python3 tools/build_coins.py               — скачать с CoinGecko и обновить data/
#   python3 tools/build_coins.py --from F.json — собрать из готового списка [[ТИКЕР, название, id, место, картинка], ...]
# Результат в data/:
#   coins.json            — оглавление: версия, число монет, имена двух частей
#   coins-a.<хэш>.json    — 3000 крупнейших по капитализации (грузится первой)
#   coins-b.<хэш>.json    — все остальные активные монеты
# Строка справочника: [ТИКЕР, название, id или "" (если id = слаг названия), место или 0, картинка]
# Картинка: "номер.расш" (файл = id) или "номер/файл"; полный адрес — coin-images.coingecko.com/coins/images/номер/large/файл
import json, os, re, sys, time, glob, hashlib, unicodedata, urllib.request, urllib.error

API = 'https://api.coingecko.com/api/v3'
PFX = 'https://coin-images.coingecko.com/coins/images/'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
TOP = 3000
GAP = 7                 # пауза между запросами, с
DEADLINE = time.time() + 60 * 60

def get(url, tries=8):
    for i in range(tries):
        try:
            rq = urllib.request.Request(url, headers={'User-Agent': 'moneylife-coins/1.3', 'Accept': 'application/json'})
            with urllib.request.urlopen(rq, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(30 * (i + 1)); continue      # лимит бесплатного API — ждём и повторяем
            raise
        except Exception:
            time.sleep(15)
    raise RuntimeError('не скачалось: ' + url)

def fetch_rows():
    rows, seen, page = [], set(), 1
    while True:
        if time.time() > DEADLINE:
            raise RuntimeError('не успели за час — справочник не меняем')
        body = json.loads(get(f'{API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page={page}'))
        if not body: break
        for c in body:
            if c['id'] in seen: continue
            seen.add(c['id'])
            img = c.get('image') or ''
            if img.startswith(PFX) and 'missing' not in img:
                p = img[len(PFX):].split('?')[0].split('/', 2)        # номер / large / файл
                img = p[0] + '/' + p[2] if len(p) == 3 else ''
            else:
                img = ''
            rows.append([str(c.get('symbol') or '').upper(), c.get('name') or '', c['id'], c.get('market_cap_rank') or 0, img])
        print('страница', page, 'монет', len(rows), flush=True)
        if len(body) < 250: break
        page += 1
        time.sleep(GAP)
    return rows

def slug(name):
    # то же правило, что в приложении (index.html → dirSlug)
    a = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', a).strip('-')

def compact(r):
    sym, name, cid, rank, img = r
    img = img.split('?')[0]
    num, _, f = img.partition('/')
    if f and '.' in f and f.rsplit('.', 1)[0] == cid:
        img = num + '.' + f.rsplit('.', 1)[1]                      # файл картинки = id → храним только номер и расширение
    return [sym, name, '' if slug(name) == cid else cid, rank, img]

def write_part(prefix, rows):
    raw = json.dumps(rows, ensure_ascii=False, separators=(',', ':')).encode()
    h = hashlib.sha1(raw).hexdigest()[:10]
    name = f'{prefix}.{h}.json'
    with open(os.path.join(OUT, name), 'wb') as f:
        f.write(raw)
    return name

def main():
    if '--from' in sys.argv:
        rows = json.load(open(sys.argv[sys.argv.index('--from') + 1]))
    else:
        rows = fetch_rows()
    # защита от неполной выгрузки: не затираем хороший справочник урезанным
    meta_p = os.path.join(OUT, 'coins.json')
    old_n = json.load(open(meta_p)).get('n', 0) if os.path.exists(meta_p) else 0
    if len(rows) < 10000 or (old_n and len(rows) < 0.9 * old_n):
        print(f'подозрительно мало монет ({len(rows)}, было {old_n}) — справочник не меняем'); return
    rows = [r for r in rows if r[0] and r[2]]
    a = sorted([r for r in rows if 0 < r[3] <= TOP], key=lambda r: r[3])
    b = sorted([r for r in rows if r[3] > TOP], key=lambda r: r[3]) + sorted([r for r in rows if not r[3]], key=lambda r: (r[0], r[1]))
    os.makedirs(OUT, exist_ok=True)
    na = write_part('coins-a', [compact(r) for r in a])
    nb = write_part('coins-b', [compact(r) for r in b])
    meta = {'v': time.strftime('%Y-%m-%d'), 'n': len(a) + len(b), 'a': na, 'b': nb}
    with open(meta_p, 'w') as f:
        json.dump(meta, f, ensure_ascii=False)
    for p in glob.glob(os.path.join(OUT, 'coins-[ab].*.json')):     # старые части больше не нужны
        if os.path.basename(p) not in (na, nb):
            os.remove(p)
    print('готово:', meta)

main()

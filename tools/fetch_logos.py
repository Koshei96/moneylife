# Скачивает официальные логотипы монет с CoinGecko (размер large) — запускается в GitHub Actions.
# Вход: tools/logos-request.txt (строки «ТИКЕР [id CoinGecko]»). Выход: out/ТИКЕР.png и out/report.json
import json, os, time, urllib.request, urllib.error
API = 'https://api.coingecko.com/api/v3'

def get(url, tries=6):
    for i in range(tries):
        try:
            rq = urllib.request.Request(url, headers={'User-Agent': 'moneylife-logos/1.0', 'Accept': '*/*'})
            with urllib.request.urlopen(rq, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(20 * (i + 1)); continue  # лимит запросов — ждём и повторяем
            raise
        except Exception:
            time.sleep(10)
    raise RuntimeError('не скачалось: ' + url)

def markets(ids):
    out = {}
    for i in range(0, len(ids), 100):
        part = ','.join(ids[i:i + 100])
        for c in json.loads(get(f'{API}/coins/markets?vs_currency=usd&ids={part}&per_page=250')):
            out[c['id']] = c
        time.sleep(5)
    return out

req = [l.split() for l in open('tools/logos-request.txt', encoding='utf-8') if l.strip()]
allc = json.loads(get(API + '/coins/list')); time.sleep(5)
bysym = {}
for c in allc:
    bysym.setdefault(c['symbol'].upper(), []).append(c['id'])

# все кандидаты по тикеру + заданные id → рыночные данные (там ссылка на картинку и место по капитализации)
want = set()
for p in req:
    want.update(p[1:2] or bysym.get(p[0], [])[:40])
mk = markets(sorted(want))

os.makedirs('out', exist_ok=True)
rep = {}
for p in req:
    sym = p[0]
    cid = p[1] if len(p) > 1 else None
    cands = bysym.get(sym, [])
    if not cid:
        ranked = sorted((x for x in cands if x in mk and mk[x].get('market_cap_rank')), key=lambda x: mk[x]['market_cap_rank'])
        cid = ranked[0] if ranked else None
    r = {'id': cid, 'cands': [(x, mk.get(x, {}).get('market_cap_rank')) for x in cands[:15]]}
    c = mk.get(cid) if cid else None
    if cid and not c:
        # монеты без рыночных данных (например, после переименования) — берём картинку из карточки монеты
        try:
            j = json.loads(get(f'{API}/coins/{cid}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false'))
            c = {'name': j.get('name'), 'image': (j.get('image') or {}).get('large'), 'market_cap_rank': j.get('market_cap_rank')}
        except Exception as e:
            r['err'] = str(e)
        time.sleep(5)
    if c and c.get('image'):
        url = c['image'].replace('/small/', '/large/').replace('/thumb/', '/large/')
        r.update(name=c['name'], rank=c.get('market_cap_rank'), image=url)
        try:
            data = get(url)
            ext = url.split('?')[0].rsplit('.', 1)[-1].lower()[:4]
            open(f'out/{sym}.{ext}', 'wb').write(data)
            r.update(file=f'{sym}.{ext}', bytes=len(data))
        except Exception as e:
            r['err'] = str(e)
        time.sleep(0.3)
    rep[sym] = r
json.dump(rep, open('out/report.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('готово:', sum(1 for v in rep.values() if v.get('file')), 'из', len(rep))

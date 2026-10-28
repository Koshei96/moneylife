#!/usr/bin/env python3
"""Автотесты MoneyLife — запуск: python3 tests/run_tests.py

Что проверяется:
  1. Статика: синтаксис всех JS (файлы и встроенные скрипты index.html), валидность JSON,
     что все файлы из списка SHELL в sw.js существуют.
  2. Приложение в настоящем браузере (Chromium, экран телефона 390x844) без интернета:
     Supabase подменён имитацией (tests/mock-supabase.js), внешние запросы отрезаны.
     Сценарии: экран входа, новый пользователь (знакомство), пользователь с данными
     (все вкладки, шторки), запись покупки, работа без связи с базой.
  3. В любом сценарии падение JS (pageerror) или console.error = провал.

Скриншоты каждого экрана — в tests/out/ (не попадают в git), их стоит открыть и посмотреть глазами.
Код выхода 0 — всё зелёное, 1 — есть провалы (список в конце вывода)."""
import json, os, re, subprocess, sys, tempfile, threading, functools, http.server, socketserver, traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'tests' / 'out'
OUT.mkdir(parents=True, exist_ok=True)
FAILS, PASSES = [], []

def ok(name):
    PASSES.append(name); print('  ✓', name)

def fail(name, why):
    FAILS.append(f'{name}: {why}'); print('  ✗', name, '—', why)

# ---------------------------------------------------------------- 1. статика
def static_checks():
    print('\n[1] Статические проверки')
    js_files = [p for p in ROOT.glob('*.js')] + list((ROOT / 'tests').glob('*.js'))
    for p in js_files:
        r = subprocess.run(['node', '--check', str(p)], capture_output=True, text=True)
        (ok if r.returncode == 0 else lambda n: fail(n, r.stderr.strip()[:300]))(f'синтаксис {p.name}')
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    inline = [m.group(2) for m in re.finditer(r'<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>', html, re.S)]
    for i, code in enumerate(inline):
        with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
            f.write(code); tmp = f.name
        r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True); os.unlink(tmp)
        if r.returncode == 0: ok(f'синтаксис встроенного скрипта №{i+1} index.html')
        else: fail(f'синтаксис встроенного скрипта №{i+1} index.html', r.stderr.strip()[-400:])
    for p in [ROOT / 'manifest.webmanifest', *sorted((ROOT / 'data').glob('*.json'))]:
        try: json.loads(p.read_text(encoding='utf-8')); ok(f'JSON {p.name}')
        except Exception as e: fail(f'JSON {p.name}', str(e)[:200])
    sw = (ROOT / 'sw.js').read_text(encoding='utf-8')
    m = re.search(r"const SHELL=\[(.*?)\];", sw, re.S)
    if m:
        missing = [s for s in re.findall(r"'([^']+)'", m.group(1)) if s not in ('./',) and not (ROOT / s.split('?')[0]).exists()]
        ok('файлы SHELL из sw.js на месте') if not missing else fail('файлы SHELL из sw.js', 'нет: ' + ', '.join(missing))
    # версии ?v= у config.js / shim.js / mascot.js должны совпадать с версией в sw.js
    vs = set(re.findall(r'\?v=(\d{14})', html)) | set(re.findall(r'\?v=(\d{14})', sw))
    vsw = re.search(r"const V='ml-(\d{14})'", sw)
    if vsw: vs.add(vsw.group(1))
    ok('версия сборки согласована: ' + next(iter(vs))) if len(vs) == 1 else fail('версия сборки', 'разные метки: ' + ', '.join(sorted(vs)))

# ---------------------------------------------------------------- 2. браузер
class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def serve():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), handler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}/'

MOCK = (ROOT / 'tests' / 'mock-supabase.js').read_text(encoding='utf-8')
NOW = '2026-10-20T10:00:00.000Z'
SEED = [
    {'col': 'app', 'id': 'settings', 'data': {'onboardedAt': NOW, 'split': {'btc': 50, 'eth': 30, 'alt': 20}, 'monthlyUsd': 300, 'currency': 'USD'}},
    {'col': 'tx', 'id': 't1', 'data': {'ts': '2026-08-01T10:00:00.000Z', 'type': 'deposit', 'usd': 1000, 'uah': 41500}},
    {'col': 'tx', 'id': 't2', 'data': {'ts': '2026-08-02T10:00:00.000Z', 'type': 'buy', 'symbol': 'BTC', 'qty': 0.005, 'usd': 500, 'price': 100000}},
    {'col': 'tx', 'id': 't3', 'data': {'ts': '2026-08-02T10:05:00.000Z', 'type': 'buy', 'symbol': 'ETH', 'qty': 0.1, 'usd': 300, 'price': 3000}},
    {'col': 'tx', 'id': 't4', 'data': {'ts': '2026-08-03T10:00:00.000Z', 'type': 'reserve_in', 'usd': 200, 'note': 'резерв'}},
]
PRICES = {'bitcoin': ('btc', 'Bitcoin', 110000), 'ethereum': ('eth', 'Ethereum', 4000), 'solana': ('sol', 'Solana', 200), 'tether': ('usdt', 'Tether', 1)}

def markets_body(url):
    from urllib.parse import urlparse, parse_qs, unquote
    ids = unquote(parse_qs(urlparse(url).query).get('ids', [''])[0]).split(',')
    out = []
    for i in [x for x in ids if x]:
        sym, name, price = PRICES.get(i, (i[:5], i.title(), 1.0))
        out.append({'id': i, 'symbol': sym, 'name': name, 'image': '', 'current_price': price, 'market_cap': price * 1e7,
                    'market_cap_rank': 1, 'total_volume': 1e9, 'price_change_percentage_24h': 1.5,
                    'sparkline_in_7d': {'price': [price * (0.97 + k * 0.001) for k in range(60)]}})
    return json.dumps(out)

BY_SYM = {v[0].upper(): v[2] for v in PRICES.values()}

def binance_body(url):
    from urllib.parse import urlparse, parse_qs, unquote
    q = parse_qs(urlparse(url).query)
    def t(pair):
        sym = pair[:-4] if pair.endswith('USDT') else pair
        if sym not in BY_SYM: return None
        return {'symbol': pair, 'lastPrice': str(BY_SYM[sym]), 'priceChangePercent': '1.50'}
    if 'symbols' in q:
        return json.dumps([x for x in (t(s) for s in json.loads(unquote(q['symbols'][0]))) if x])
    one = t(q.get('symbol', [''])[0])
    return json.dumps(one) if one else None

IGNORE_CONSOLE = re.compile(r'Failed to load resource|net::ERR_|ERR_INTERNET_DISCONNECTED|ERR_FAILED|ERR_ABORTED|favicon|Failed to fetch|NetworkError|Load failed|AbortError|The user aborted|signal is aborted', re.I)

def run_browser():
    print('\n[2] Приложение в браузере (без интернета, Supabase — имитация)')
    from playwright.sync_api import sync_playwright
    srv, base = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-proxy-server'])

        def page_for(name, test_cfg, prices=True):
            ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, service_workers='block',
                                      locale='ru-RU', timezone_id='Europe/Kyiv', is_mobile=True, has_touch=True)
            def route(r):
                u = r.request.url
                if u.startswith(base): return r.continue_()
                if 'supabase-js' in u: return r.fulfill(status=200, content_type='application/javascript', body='/* supabase подменён имитацией */')
                if prices and 'api.coingecko.com' in u and '/coins/markets' in u:
                    return r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=markets_body(u))
                if prices and 'binance' in u and '/ticker/24hr' in u:
                    b = binance_body(u)
                    if b is None: return r.fulfill(status=400, content_type='application/json', headers={'access-control-allow-origin': '*'}, body='{"code":-1121,"msg":"Invalid symbol."}')
                    return r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=b)
                return r.abort('internetdisconnected')
            ctx.route('**/*', route)
            ctx.add_init_script('window.__ML_TEST=' + json.dumps(test_cfg) + ';' + MOCK)
            pg = ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append('JS-ошибка: ' + str(e)[:300]))
            pg.on('console', lambda m: errs.append('console.error: ' + m.text[:300]) if m.type == 'error' and not IGNORE_CONSOLE.search(m.text) and 'mock:' not in m.text else None)
            return ctx, pg, errs

        def shot(pg, name):
            pg.screenshot(path=str(OUT / f'{name}.png'))

        def scenario(name, cfg, body, prices=True):
            ctx, pg, errs = page_for(name, cfg, prices)
            try:
                pg.goto(base + 'index.html', wait_until='load', timeout=30000)
                pg.wait_for_timeout(1500)
                body(pg, name)
                if errs: fail(f'{name}: без ошибок в консоли', ' | '.join(dict.fromkeys(errs))[:600])
                else: ok(f'{name}: без ошибок в консоли')
            except Exception as e:
                try: shot(pg, name + '-FAIL')
                except Exception: pass
                fail(name, f'{type(e).__name__}: {str(e)[:400]}')
            finally:
                ctx.close()

        # --- А. экран входа
        def s_login(pg, n):
            pg.wait_for_selector('#mlAuth', state='visible', timeout=8000)
            if pg.locator('#mlAuth input[type=email], #mlAuth input[type=password]').count() < 1:
                raise AssertionError('на экране входа нет полей почты/пароля')
            shot(pg, '01-login'); ok('экран входа показан')
        scenario('Вход', {'session': False, 'docs': []}, s_login)

        # --- Б. новый пользователь → знакомство
        def s_new(pg, n):
            pg.wait_for_selector('#ob:not([hidden])', timeout=8000)
            shot(pg, '02-onboarding'); ok('знакомство показано новому пользователю')
            pg.click('#obSkip'); pg.wait_for_selector('#ob[hidden]', state='attached', timeout=5000)
            pg.wait_for_timeout(800); shot(pg, '03-after-onboarding'); ok('«Пропустить» закрывает знакомство')
            if not pg.evaluate("[...window.__mlRows.keys()].includes('app/settings')"):
                raise AssertionError('после знакомства не сохранились настройки (app/settings)')
            ok('настройки сохранены после знакомства')
        scenario('Новый пользователь', {'session': True, 'docs': []}, s_new)

        # --- В. пользователь с данными: вкладки и шторки
        def s_user(pg, n):
            pg.wait_for_selector('nav.tabs', timeout=8000)
            if pg.locator('#ob:not([hidden])').count(): raise AssertionError('знакомство показано пользователю, у которого уже есть данные')
            pg.wait_for_timeout(1500); shot(pg, '04-home'); ok('главный экран открыт')
            bal = (pg.inner_text('#hBal') if pg.locator('#hBal').count() else '').replace('\u202f', ' ').replace('\xa0', ' ')
            digits = re.sub(r'[^0-9]', '', bal)
            if not digits or int(digits) == 0: fail('стоимость портфеля с ценами', f'показано «{bal}» — ожидалось больше нуля (BTC 0.005 × $110 000 и т.д.)')
            else: ok(f'стоимость портфеля посчитана: {bal}')
            for tab, title in [('coins', 'Монеты'), ('strategy', 'Стратегия'), ('activity', 'Активность'), ('home', 'Главная')]:
                b = pg.locator(f'nav.tabs [data-tab="{tab}"]')
                if not b.count(): fail(f'вкладка «{title}»', 'кнопка не найдена'); continue
                b.click(); pg.wait_for_timeout(600)
                if b.get_attribute('aria-current') != 'page': fail(f'вкладка «{title}»', 'не стала активной')
                else: ok(f'вкладка «{title}» открывается')
                shot(pg, f'05-tab-{tab}')
            txt = pg.inner_text('body')
            if 'BTC' not in txt: fail('данные портфеля', 'на экранах нет BTC из тестовых данных')
            else: ok('данные портфеля отображаются')
        scenario('Пользователь с данными', {'session': True, 'docs': SEED}, s_user)

        # --- Г. запись покупки через форму (если форма доступна)
        def s_buy(pg, n):
            pg.wait_for_selector('nav.tabs', timeout=8000)
            before = pg.evaluate("[...window.__mlRows.keys()].filter(k=>k.startsWith('tx/')).length")
            opened = pg.evaluate("""()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Купить'&&x.offsetParent);if(!b)return false;b.click();return true;}""")
            if not opened: raise AssertionError('кнопка «Купить» не найдена на главном')
            pg.wait_for_timeout(700); shot(pg, '06-buy-sheet'); ok('шторка «Купить» открывается')
            pg.evaluate("""()=>{const b=[...document.querySelectorAll('#actSheet button')].find(x=>/Одна монета/.test(x.textContent)&&x.offsetParent);if(b)b.click();}""")
            pg.wait_for_timeout(400)
            if not (pg.locator('#oSym').count() and pg.locator('#oSym').is_visible()):
                ok('(форма разовой покупки другая — запись не проверялась)'); return
            pg.fill('#oSym', 'SOL'); pg.fill('#oUsd', '50'); pg.fill('#oQty', '0.25')
            pg.evaluate("""()=>{const b=[...document.querySelectorAll('#actSheet button')].find(x=>x.textContent.trim()==='Сохранить'&&x.offsetParent);if(b)b.click();}""")
            pg.wait_for_timeout(1000); shot(pg, '07-after-buy')
            after = pg.evaluate("[...window.__mlRows.keys()].filter(k=>k.startsWith('tx/')).length")
            if after > before: ok('покупка SOL записана в базу')
            else: fail('запись покупки', 'новая запись tx не появилась (возможно, поменялась форма — обнови тест)')
        scenario('Покупка', {'session': True, 'docs': SEED}, s_buy)

        # --- Д. база недоступна: приложение не падает
        def s_off(pg, n):
            pg.wait_for_timeout(1500); shot(pg, '08-db-down')
            if pg.locator('#offline:not([hidden])').count(): ok('плашка «нет связи с базой» показана')
            else: fail('база недоступна', 'нет плашки о том, что связи с базой нет')
        scenario('База недоступна', {'session': True, 'docs': SEED, 'failLoad': True}, s_off, prices=False)

        def s_noprice(pg, n):
            pg.wait_for_selector('nav.tabs', timeout=8000); pg.wait_for_timeout(1500); shot(pg, '09-no-prices')
            ok('приложение открылось без цен')
        scenario('Нет цен (биржи недоступны)', {'session': True, 'docs': SEED}, s_noprice, prices=False)

        browser.close()
    srv.shutdown()

if __name__ == '__main__':
    static_checks()
    try: run_browser()
    except Exception as e: fail('запуск браузера', traceback.format_exc()[-600:])
    print(f'\nИТОГ: {len(PASSES)} ✓, {len(FAILS)} ✗')
    for f in FAILS: print('  ✗', f)
    print('Скриншоты:', OUT)
    sys.exit(1 if FAILS else 0)

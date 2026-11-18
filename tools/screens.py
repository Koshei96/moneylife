#!/usr/bin/env python3
"""Скриншоты всех экранов MoneyLife на тестовых данных — для VISUAL_GUIDE и «до/после» в PR.

Запуск: python3 tools/screens.py [папка]   (по умолчанию ai-ops/screens)
Только демо-портфель и имитация Supabase (tests/mock-supabase.js): реальные данные пользователей не используются.
Интернета не нужно: цены — тестовые, внешние запросы отрезаны.
Снимает: темы dark/light × ширина 390 и 360 px. Имена: <экран>-<тема>-<ширина>.webp (без Pillow — .png)
"""
import functools, http.server, json, socketserver, sys, threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'ai-ops' / 'screens'
OUT.mkdir(parents=True, exist_ok=True)
MOCK = (ROOT / 'tests' / 'mock-supabase.js').read_text(encoding='utf-8')
PRICES = {'bitcoin': ('btc', 'Bitcoin', 110000), 'ethereum': ('eth', 'Ethereum', 4000), 'solana': ('sol', 'Solana', 200), 'tether': ('usdt', 'Tether', 1)}


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


def serve():
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f'http://127.0.0.1:{srv.server_address[1]}/'


def markets(url):
    from urllib.parse import urlparse, parse_qs, unquote
    ids = unquote(parse_qs(urlparse(url).query).get('ids', [''])[0]).split(',')
    out = []
    for i in [x for x in ids if x]:
        sym, name, p = PRICES.get(i, (i[:5], i.title(), 1.0))
        out.append({'id': i, 'symbol': sym, 'name': name, 'image': '', 'current_price': p, 'market_cap': p * 1e7, 'market_cap_rank': 1,
                    'total_volume': 1e9, 'price_change_percentage_24h': 1.5,
                    'sparkline_in_7d': {'price': [p * (0.97 + k * 0.001) for k in range(60)]}})
    return json.dumps(out)


def main():
    from playwright.sync_api import sync_playwright
    base = serve()
    made = []
    with sync_playwright() as p:
        br = p.chromium.launch(args=['--no-proxy-server'])
        for th in ('dark', 'light'):
            for w in (390, 360):
                ctx = br.new_context(viewport={'width': w, 'height': 844}, device_scale_factor=2, service_workers='block',
                                     locale='ru-RU', timezone_id='Europe/Kyiv', is_mobile=True, has_touch=True)

                def route(r):
                    u = r.request.url
                    if u.startswith(base): return r.continue_()
                    if 'supabase-js' in u: return r.fulfill(status=200, content_type='application/javascript', body='/* mock */')
                    if 'api.coingecko.com' in u and '/coins/markets' in u:
                        return r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=markets(u))
                    return r.abort('internetdisconnected')
                ctx.route('**/*', route)
                ctx.add_init_script('window.__ML_TEST=' + json.dumps({'session': False, 'docs': []}) + ';' + MOCK)
                ctx.add_init_script("try{localStorage.setItem('ml-intro','{\"seen\":\"screens\"}');localStorage.setItem('cp-prefs2',JSON.stringify({theme:%s}))}catch(e){}" % json.dumps(th))
                pg = ctx.new_page()
                pg.goto(base + 'index.html', wait_until='load', timeout=30000)
                pg.wait_for_timeout(1500)

                def shot(name, full=False):
                    f = OUT / f'{name}-{th}-{w}.png'
                    pg.screenshot(path=str(f), full_page=full)
                    try:   # webp в 4–6 раз легче png — для репозитория и отчётов
                        from PIL import Image
                        Image.open(f).save(f.with_suffix('.webp'), quality=82); f.unlink(); f = f.with_suffix('.webp')
                    except ImportError: pass
                    made.append(f.name)

                pg.wait_for_selector('#mlaDemo', state='visible', timeout=10000)
                shot('00-vhod')
                pg.click('#mlaDemo')
                pg.wait_for_selector('nav.tabs', state='visible', timeout=20000); pg.wait_for_timeout(3500)
                for n, tab in (('01-glavnaya', 'home'), ('02-monety', 'coins'), ('03-strategiya', 'strategy'), ('04-aktivnost', 'activity')):
                    pg.click(f'nav.tabs .tab[data-tab="{tab}"]'); pg.wait_for_timeout(1200)
                    pg.evaluate('window.scrollTo(0,0)'); pg.wait_for_timeout(300)
                    shot(n)
                    if w == 390: shot(n + '-celikom', full=True)
                pg.click('nav.tabs .tab[data-tab="home"]'); pg.wait_for_timeout(800)
                pg.click('#plusBtn'); pg.wait_for_timeout(1000); shot('05-novaya-zapis')
                pg.keyboard.press('Escape'); pg.wait_for_timeout(600)
                pg.evaluate("document.getElementById('scrim')&&document.getElementById('scrim').click()"); pg.wait_for_timeout(600)
                pg.click('#setBtn'); pg.wait_for_timeout(1000); shot('06-nastroyki')
                ctx.close()
        br.close()
    print(f'{len(made)} скриншотов → {OUT}')


if __name__ == '__main__':
    main()

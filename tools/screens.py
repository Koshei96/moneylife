#!/usr/bin/env python3
"""Скриншоты всех экранов MoneyLife на тестовых данных — для VISUAL_GUIDE и «до/после» в PR.

Запуск: python3 tools/screens.py [папка]   (по умолчанию ai-ops/screens)
Только демо-портфель и имитация Supabase (tests/mock-supabase.js): реальные данные пользователей не используются.
Интернета не нужно: цены — тестовые, внешние запросы отрезаны.
Снимает: темы dark/light × ширина 390 и 360 px (основные экраны); на 390 — ещё ролик, знакомство, шторки,
Орион с субтитрами и украинский язык. Имена: <экран>-<тема>-<ширина>.webp (без Pillow — .png)
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
                if w == 390:   # остальные экраны и шторки — на основной ширине, обе темы (Этап 1, 18.11)
                    def sheet(name, js, wait=1100):
                        pg.evaluate("typeof closeSheets=='function'&&closeSheets()"); pg.wait_for_timeout(500)
                        pg.evaluate(js); pg.wait_for_timeout(wait); shot(name)
                    sheet('09-moneta', "openCoin('BTC')")
                    sheet('10-lichnyy-plan', "MLX.openPlan()")
                    sheet('11-znaniya', "MLX.openLearn()")
                    sheet('12-dostizheniya', "MLX.openAch()")
                    sheet('13-itog-mesyaca', "MLX.openStory()", 1600)
                    pg.evaluate("(document.querySelector('#mlStory [data-win=\"sclose\"]')||{click(){}}).click()"); pg.wait_for_timeout(600)
                    pg.evaluate("typeof closeSheets=='function'&&closeSheets()"); pg.wait_for_timeout(500)
                    pg.click('nav.tabs .tab[data-tab="home"]'); pg.wait_for_timeout(800); pg.evaluate('window.scrollTo(0,0)')
                    pg.evaluate("Mascot.debug.say('Биткоин сегодня спокоен: плюс полтора процента. До первой ступени лестницы ещё двадцать процентов.')")
                    pg.wait_for_timeout(1800); shot('14-orion-subtitry')
                    pg.evaluate("localStorage.setItem('ml-lang','uk'); location.reload()")
                    pg.wait_for_timeout(2500)
                    if pg.locator('#mlaDemo').is_visible(): pg.click('#mlaDemo')
                    pg.wait_for_selector('nav.tabs', state='visible', timeout=20000); pg.wait_for_timeout(3000)
                    pg.evaluate('window.scrollTo(0,0)'); shot('15-ukrainskiy')
                ctx.close()
                if w == 390:   # новичок: ролик «MoneyLife за минуту» и знакомство — пустой аккаунт имитации, без реальных данных
                    ctx = br.new_context(viewport={'width': w, 'height': 844}, device_scale_factor=2, service_workers='block',
                                         locale='ru-RU', timezone_id='Europe/Kyiv', is_mobile=True, has_touch=True)
                    ctx.route('**/*', route)
                    ctx.add_init_script('window.__ML_TEST=' + json.dumps({'session': True, 'docs': []}) + ';' + MOCK)
                    ctx.add_init_script("try{localStorage.setItem('cp-prefs2',JSON.stringify({theme:%s}))}catch(e){}" % json.dumps(th))
                    pg = ctx.new_page()
                    pg.goto(base + 'index.html', wait_until='load', timeout=30000)
                    pg.wait_for_selector('#mlIntro', state='visible', timeout=15000); pg.wait_for_timeout(900)
                    shot('07-rolik-oblozhka')
                    pg.click('#miWatch'); pg.wait_for_timeout(9000); shot('07-rolik-slayd')
                    pg.click('#miSkip'); pg.wait_for_timeout(1200)
                    pg.wait_for_selector('#ob:not([hidden])', timeout=8000); pg.wait_for_timeout(700)
                    shot('08-znakomstvo')
                    ctx.close()
        br.close()
    print(f'{len(made)} скриншотов → {OUT}')


if __name__ == '__main__':
    main()

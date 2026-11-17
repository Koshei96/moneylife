#!/usr/bin/env python3
"""Охота на ошибки: кадры экранов MoneyLife для просмотра глазами (Вера, 17.11.2026).

Запуск: python3 tools/hunt_shots.py [папка_для_кадров] [фильтр_сцены]
Поднимает тот же локальный сервер и имитацию Supabase/цен, что tests/run_tests.py (импортирует оттуда),
берёт «богатый» портфель со всеми типами записей и лестницей, снимает кадры при deviceScaleFactor 1,
390 и 360 px, тёмная/светлая, ru/uk, без цен. Код приложения не меняет. Автопоиск: NaN/undefined/null,
горизонтальная прокрутка, обрезанные многоточием тексты — в report.json рядом с кадрами.
В автотесты не входит (tests/run_tests.py его не вызывает)."""
import json, os, sys, re, datetime as dt
from pathlib import Path

ROOT = Path(os.environ.get('ML_ROOT') or Path(__file__).resolve().parent.parent)
sys.path.insert(0, str(ROOT / 'tests'))
import run_tests as T  # noqa: E402  (сервер, имитация, цены)

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'tests' / 'out' / 'hunt'
ONLY = sys.argv[2] if len(sys.argv) > 2 else ''
OUT.mkdir(parents=True, exist_ok=True)
NOW = dt.datetime.now(dt.timezone.utc)
def iso(days): return (NOW - dt.timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%S.000Z')

RICH = [
    {'col': 'app', 'id': 'settings', 'data': {'template': 'author', 'onboardedAt': iso(120), 'split': {'BTC': 50, 'ETH': 30, 'ALT': 20},
        'capPct': 20, 'depositSplit': {'dca': 87}, 'ladder': True, 'key2Pct': 5, 'key2Days': 60, 'altCapPct': 20, 'altOfMonth': 'SOL',
        'budget': {'amount': 300, 'cur': 'USD'}, 'depositDay': 5, 'currency': 'USD'}},
    {'col': 'app', 'id': 'cycle', 'data': {'ath': 160000, 'athDate': '2026-10-06', 'startedAt': '2026-07-20',
        'levels': [{'n': i + 1, 'drop': d, 'pct': p, 'status': 'pending'} for i, (d, p) in enumerate([[30, 20], [40, 25], [50, 33], [60, 50], [70, 100]])]}},
    {'col': 'tx', 'id': 'r01', 'data': {'ts': iso(110), 'type': 'deposit', 'usd': 1000, 'uah': 41500, 'dcaUsd': 870, 'reserveUsd': 130}},
    {'col': 'tx', 'id': 'r02', 'data': {'ts': iso(109), 'type': 'buy', 'symbol': 'BTC', 'qty': 0.005, 'usd': 500, 'price': 100000}},
    {'col': 'tx', 'id': 'r03', 'data': {'ts': iso(80), 'type': 'dca', 'symbol': 'ETH', 'qty': 0.1, 'usd': 300, 'price': 3000}},
    {'col': 'tx', 'id': 'r04', 'data': {'ts': iso(79), 'type': 'dca', 'symbol': 'SOL', 'qty': 0.35, 'usd': 70, 'price': 200}},
    {'col': 'tx', 'id': 'r05', 'data': {'ts': iso(60), 'type': 'reserve_in', 'usd': 200, 'note': 'резерв'}},
    {'col': 'tx', 'id': 'r06', 'data': {'ts': iso(50), 'type': 'deposit', 'usd': 300, 'uah': None, 'dcaUsd': 261, 'reserveUsd': 39}},
    {'col': 'tx', 'id': 'r07', 'data': {'ts': iso(40), 'type': 'airdrop', 'symbol': 'ARB', 'qty': 50, 'usd': 0}},
    {'col': 'tx', 'id': 'r08', 'data': {'ts': iso(35), 'type': 'start', 'symbol': 'DOGE', 'qty': 1000, 'usd': None, 'note': 'добавлено при знакомстве'}},
    {'col': 'tx', 'id': 'r09', 'data': {'ts': iso(20), 'type': 'sell', 'symbol': 'ETH', 'qty': 0.03, 'usd': 122.15, 'price': 4071.6667}},
    {'col': 'tx', 'id': 'r10', 'data': {'ts': iso(12), 'type': 'reserve_adj', 'usd': -15, 'note': 'комиссия биржи'}},
    {'col': 'tx', 'id': 'r11', 'data': {'ts': iso(10), 'type': 'reserve_adj', 'usd': 3.2, 'note': 'Проценты стейкинга', 'earn': True}},
    {'col': 'tx', 'id': 'r12', 'data': {'ts': iso(6), 'type': 'income', 'uah': 20000}},
    {'col': 'tx', 'id': 'r13', 'data': {'ts': iso(3), 'type': 'dip', 'level': 1, 'symbol': 'BTC', 'qty': 0.00045, 'usd': 50, 'price': 111111}},
]

SCAN = r"""(W)=>{const bad=[],cut=[],seen=new Set();
 const vis=e=>{const r=e.getBoundingClientRect();if(r.width<1||r.height<1)return false;const s=getComputedStyle(e);return s.visibility!=='hidden'&&s.display!=='none'&&!e.closest('[hidden],[inert]')};
 const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const t=n.textContent.trim();if(!t||!n.parentElement||!vis(n.parentElement))continue;
  if(/\bNaN\b|\bundefined\b|\bnull\b|Infinity|\[object/.test(t))bad.push(t.slice(0,90));}
 for(const e of document.querySelectorAll('body *')){if(!vis(e)||e.children.length>2)continue;const s=getComputedStyle(e);
  if(e.scrollWidth>e.clientWidth+1&&(s.textOverflow==='ellipsis'||s.overflow==='hidden'||s.overflowX==='hidden')&&e.textContent.trim()){const t=e.textContent.trim().slice(0,70);if(!seen.has(t)){seen.add(t);cut.push(t)}}}
 return {bad,cut:cut.slice(0,25),hscroll:document.documentElement.scrollWidth>W+1?document.documentElement.scrollWidth:0}}"""

REPORT = {}

def main():
    from playwright.sync_api import sync_playwright
    srv, base = T.serve()
    with sync_playwright() as p:
        br = p.chromium.launch(args=['--no-proxy-server'])

        def scene(name, steps, docs=RICH, width=390, theme='dark', lang='ru', prices=True, demo=False):
            if ONLY and ONLY not in name: return
            ctx = br.new_context(viewport={'width': width, 'height': 800}, device_scale_factor=1, service_workers='block',
                                 locale='uk-UA' if lang == 'uk' else 'ru-RU', timezone_id='Europe/Kyiv', is_mobile=True, has_touch=True)
            def route(r):
                u = r.request.url
                if u.startswith(base): return r.continue_()
                if 'supabase-js' in u: return r.fulfill(status=200, content_type='application/javascript', body='/**/')
                if prices and 'api.coingecko.com' in u and '/coins/markets' in u:
                    return r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=T.markets_body(u))
                if prices and 'binance' in u and '/ticker/24hr' in u:
                    b = T.binance_body(u)
                    if b is None: return r.fulfill(status=400, content_type='application/json', headers={'access-control-allow-origin': '*'}, body='{}')
                    return r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=b)
                return r.abort('internetdisconnected')
            ctx.route('**/*', route)
            ctx.add_init_script('window.__ML_TEST=' + json.dumps({'session': not demo, 'docs': [] if demo else docs}) + ';' + T.MOCK)
            ctx.add_init_script("try{localStorage.setItem('cp-prefs2',JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('cp-prefs2')||'{}'),{theme:%s,name:'Андрей'})));localStorage.setItem('ml-lang',%s)}catch(e){}" % (json.dumps(theme), json.dumps(lang)))
            pg = ctx.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append('JS: ' + str(e)[:200]))
            pg.on('console', lambda m: errs.append('console: ' + m.text[:200]) if m.type == 'error' and not T.IGNORE_CONSOLE.search(m.text) and 'mock:' not in m.text else None)
            pg.goto(base + 'index.html', wait_until='load', timeout=30000); pg.wait_for_timeout(2500)
            if demo: pg.click('#mlaDemo'); pg.wait_for_timeout(2500)
            rep = REPORT.setdefault(name, {'shots': {}, 'errs': errs})
            def shot(tag, scan=True):
                f = f'{name}-{tag}.png'; pg.screenshot(path=str(OUT / f))
                if scan: rep['shots'][f] = pg.evaluate(SCAN, width)
            try: steps(pg, shot)
            except Exception as e: errs.append('СЦЕНАРИЙ: ' + str(e)[:300]); pg.screenshot(path=str(OUT / f'{name}-FAIL.png'))
            ctx.close()

        J = lambda pg, js, t=600: (pg.evaluate(js), pg.wait_for_timeout(t))
        def close(pg): J(pg, "closeSheets()", 450)
        def scroll(pg, y): J(pg, f"window.scrollTo(0,{y})", 450)
        def sheet_scroll(pg, sel, y): J(pg, f"(()=>{{const b=document.querySelector('{sel} .sh-body');if(b)b.scrollTop={y}}})()", 350)
        def edit(pg, txid): J(pg, f"openTx('{txid}')", 700)
        def brief(pg, fng=None):
            pre = f"MLX.fng=()=>({{v:{fng},w:'x'}});" if fng is not None else ''
            J(pg, pre + "Mascot.debug.say(Mascot.debug.brief())", 1500)
        def dip_over(pg):
            J(pg, "openAct('dip')", 800); pg.fill('#dTotal', '5000'); pg.wait_for_timeout(300)
            J(pg, "document.getElementById('saveBtn').click()", 700)
        def neg_dep(pg):
            J(pg, "openAct('deposit')", 800); pg.fill('#depUsd', '-50'); pg.wait_for_timeout(300)
            J(pg, "document.getElementById('saveBtn').click()", 600)
        def quiz(pg):
            J(pg, "MLX.openPlan()", 800)
            for k in range(12):
                if not pg.locator('#xSheet [data-qa]').count(): break
                pg.locator('#xSheet [data-qa]').nth(1 if k % 2 else 0).click(); pg.wait_for_timeout(450)

        # A. портфель, RU, тёмная, 390
        def a(pg, shot):
            shot('home'); scroll(pg, 650); shot('home-today'); scroll(pg, 1300); shot('home-low'); scroll(pg, 0)
            J(pg, "document.getElementById('hInfo').click()", 900); shot('total'); sheet_scroll(pg, '#xSheet', 600); shot('total-2'); close(pg)
            J(pg, "show('activity')", 900); shot('activity'); scroll(pg, 700); shot('activity-2'); scroll(pg, 1400); shot('activity-3')
            for t in ['r09', 'r12', 'r11', 'r13', 'r07', 'r08', 'r10']: edit(pg, t); shot('edit-' + t); close(pg)
            edit(pg, 'r08'); pg.fill('#eQty', ''); J(pg, "document.getElementById('eSave').click()", 500); shot('edit-r08-empty'); close(pg)
            J(pg, "show('strategy')", 900); shot('strategy')
            for y in (700, 1400, 2100, 2800, 99999): scroll(pg, y); shot(f'strategy-{y}')
            J(pg, "openSettings()", 900)
            for y in (700, 1500, 2300, 3100): sheet_scroll(pg, '#setSheet', y); shot(f'settings-{y}')
            close(pg); quiz(pg); shot('plan'); sheet_scroll(pg, '#xSheet', 700); shot('plan-2'); close(pg)
            J(pg, "MLX.openLearn()", 800); shot('learn'); pg.locator('#xSheet [data-les]').nth(2).click(); pg.wait_for_timeout(700); shot('lesson'); close(pg)
            J(pg, "show('home')", 800); brief(pg); shot('orion-brief'); brief(pg, 12); shot('orion-fear'); brief(pg, 85); shot('orion-greed')
            J(pg, "document.querySelector('.or-cap').click()", 300)
            neg_dep(pg); shot('neg-deposit'); close(pg); dip_over(pg); shot('dip-over'); close(pg)
        scene('a-ru-dark-390', a)

        def b(pg, shot):
            shot('home'); J(pg, "document.getElementById('hInfo').click()", 900); shot('total'); close(pg)
            J(pg, "show('activity')", 900); shot('activity'); edit(pg, 'r09'); shot('edit-r09'); close(pg)
            J(pg, "show('strategy')", 900); shot('strategy'); scroll(pg, 1400); shot('strategy-1400')
            J(pg, "show('home')", 800); brief(pg, 12); shot('orion-fear'); J(pg, "document.querySelector('.or-cap').click()", 300)
            dip_over(pg); shot('dip-over'); close(pg); neg_dep(pg); shot('neg-deposit')
        scene('b-ru-light-390', b, theme='light')

        def c(pg, shot):
            shot('home'); scroll(pg, 650); shot('home-today'); scroll(pg, 0)
            J(pg, "document.getElementById('hInfo').click()", 900); shot('total'); close(pg)
            J(pg, "show('activity')", 900); shot('activity'); scroll(pg, 700); shot('activity-2')
            for t in ['r09', 'r12', 'r11']: edit(pg, t); shot('edit-' + t); close(pg)
            J(pg, "show('strategy')", 900); shot('strategy'); scroll(pg, 1400); shot('strategy-1400'); scroll(pg, 99999); shot('strategy-end')
            J(pg, "openSettings()", 900); sheet_scroll(pg, '#setSheet', 1500); shot('settings-1500'); close(pg)
            quiz(pg); shot('plan'); close(pg); J(pg, "MLX.openLearn()", 800); shot('learn'); close(pg)
            J(pg, "show('home')", 800); brief(pg); shot('orion-brief'); brief(pg, 12); shot('orion-fear'); J(pg, "document.querySelector('.or-cap').click()", 300)
            dip_over(pg); shot('dip-over'); close(pg); neg_dep(pg); shot('neg-deposit')
        scene('c-uk-dark-360', c, width=360, lang='uk')

        def d(pg, shot):
            shot('home'); J(pg, "show('activity')", 900); shot('activity'); edit(pg, 'r13'); shot('edit-r13'); close(pg)
            J(pg, "show('strategy')", 900); shot('strategy'); scroll(pg, 700); shot('strategy-700')
            J(pg, "document.getElementById('hInfo').click()", 900); shot('total'); close(pg)
            J(pg, "openSettings()", 900); sheet_scroll(pg, '#setSheet', 2300); shot('settings-2300')
        scene('d-ru-dark-360', d, width=360)

        def e(pg, shot):
            shot('home'); scroll(pg, 650); shot('home-today'); scroll(pg, 0)
            J(pg, "show('strategy')", 900); shot('strategy')
            J(pg, "document.getElementById('hInfo').click()", 900); shot('total'); close(pg)
            pg.context.set_offline(True); pg.wait_for_timeout(800)
            J(pg, "show('activity')", 700); edit(pg, 'r12'); pg.fill('#eUah', '21000'); J(pg, "document.getElementById('eSave').click()", 900); shot('offline-save')
            close(pg); J(pg, "show('home')", 700); brief(pg); shot('offline-orion')
        scene('e-ru-dark-390-noprice', e, prices=False)

        def f(pg, shot):
            shot('home'); J(pg, "show('strategy')", 900); shot('strategy'); J(pg, "show('activity')", 900); shot('activity')
            edit(pg, 'r10'); shot('edit-r10')
        scene('f-uk-light-390', f, theme='light', lang='uk')

        br.close()
    srv.shutdown()
    (OUT / 'report.json').write_text(json.dumps(REPORT, ensure_ascii=False, indent=1), encoding='utf-8')
    n = sum(len(v['shots']) for v in REPORT.values())
    print(f'кадров: {n}, папка: {OUT}')
    for k, v in REPORT.items():
        if v['errs']: print(k, 'ОШИБКИ:', v['errs'])

if __name__ == '__main__':
    main()

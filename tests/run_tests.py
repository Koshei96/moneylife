#!/usr/bin/env python3
"""Автотесты MoneyLife — запуск: python3 tests/run_tests.py

Что проверяется:
  1. Статика: синтаксис всех JS (файлы и встроенные скрипты index.html), валидность JSON,
     манифест PWA (id, категория, иконки any/maskable, ярлыки), шаблон assetlinks.json,
     что все файлы из списка SHELL в sw.js существуют; страница удаления аккаунта delete.html
     (RU/UK, ссылка из privacy.html) и SQL-функция supabase/delete_my_account.sql;
     публичные страницы: почта поддержки ссылкой mailto, нет заполнителей и TODO, а тексты про кнопку
     «Удалить аккаунт» соответствуют флагу accountDelete в config.js (выключена → «появится»).
  2. Приложение в настоящем браузере (Chromium, экран телефона 390x844) без интернета:
     Supabase подменён имитацией (tests/mock-supabase.js), внешние запросы отрезаны.
     Сценарии: экран входа, новый пользователь (знакомство), пользователь с данными
     (все вкладки, шторки), запись покупки, работа без связи с базой, удаление аккаунта
     (удаляются только свои записи, чужие целы, повторное удаление не ломает приложение).
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
    # без сети приложение не должно открываться страницей политики: под index.html кэшируется только само приложение
    nav = re.search(r"mode==='navigate'\)\{(.*?)return;\}", sw, re.S)
    if nav and "x.put('index.html'" in nav.group(1) and re.search(r"if\(app&&r\.ok\)", nav.group(1)): ok('sw.js: privacy.html/delete.html не подменяют приложение в кэше')
    else: fail('sw.js: кэш переходов', 'страницы кладутся в кэш под именем index.html')
    manifest_checks(html)
    deletion_checks()

def deletion_checks():
    """Удаление аккаунта (требование Google Play): веб-страница и серверная функция."""
    d = ROOT / 'delete.html'
    if not d.exists(): fail('delete.html', 'нет файла'); return
    dh = d.read_text(encoding='utf-8')
    ru = re.search(r'<article lang="ru"[^>]*>(.*?)</article>', dh, re.S)
    uk = re.search(r'<article lang="uk"[^>]*>(.*?)</article>', dh, re.S)
    if ru and 'Удаление аккаунта Money Life' in ru.group(1) and uk and 'Видалення акаунта Money Life' in uk.group(1): ok('delete.html: текст на русском и украинском')
    else: fail('delete.html: языки', 'нет русского или украинского раздела с заголовком')
    for name, part in (('RU', ru), ('UK', uk)):
        t = part.group(1) if part else ''
        miss = [x for x in ['#delete', 'Удалить аккаунт', 'УДАЛИТЬ', 'Удалить навсегда', 'privacy.html'] if x not in t]
        ok(f'delete.html ({name}): шаги в приложении, ссылка #delete и политика') if not miss else fail(f'delete.html ({name})', 'нет: ' + ', '.join(miss))
    pv = (ROOT / 'privacy.html').read_text(encoding='utf-8')
    support_mail_checks({'delete.html': dh, 'privacy.html': pv})
    public_pages_checks()
    n = pv.count('href="delete.html"')
    ok('privacy.html: ссылка на delete.html (RU и UK)') if n >= 2 else fail('privacy.html: ссылка на delete.html', f'нужна в обоих языках, найдено {n}')
    q = ROOT / 'supabase' / 'delete_my_account.sql'
    if not q.exists(): fail('delete_my_account.sql', 'нет файла'); return
    sql = re.sub(r'\s+', ' ', re.sub(r'--[^\n]*', '', q.read_text(encoding='utf-8'))).lower()   # без комментариев
    shim = (ROOT / 'shim.js').read_text(encoding='utf-8')
    called = re.search(r"\.rpc\('(\w+)'\)", shim[shim.find('mlDeleteAccount'):])
    if called and f'function public.{called.group(1)}()' in sql: ok(f'SQL: функция public.{called.group(1)}() — та, что вызывает shim.js, без параметров')
    else: fail('SQL: имя функции', f'shim.js вызывает {called and called.group(1)!r}, в файле её нет')
    uidvar = re.search(r'(\w+) uuid := auth\.uid\(\)', sql)
    me = [r'auth\.uid\(\)'] + ([re.escape(uidvar.group(1))] if uidvar else [])
    me_re = '(' + '|'.join(me) + ')'
    for name, cond in [('security definer', 'security definer' in sql),
                       ("set search_path = ''", "set search_path = ''" in sql),
                       ('отказ без входа (auth.uid() пустой → ошибка)', bool(re.search(r'if ' + me_re + r' is null then raise exception', sql)))]:
        ok(f'SQL: {name}') if cond else fail(f'SQL: {name}', 'не найдено')
    # каждое удаление — только по вошедшему пользователю
    dels = re.findall(r'delete from ([\w.]+) where ([^;]+);', sql)
    alls = re.findall(r'delete from ([\w.]+)', sql)
    good = {t: w.strip() for t, w in dels if re.fullmatch(r'(owner|id) = ' + me_re, w.strip())}
    if len(dels) == len(alls) == len(good) and good.get('public.docs', '').startswith('owner') and good.get('auth.users', '').startswith('id '):
        ok('SQL: удаляет только public.docs по owner = auth.uid() и auth.users по id = auth.uid()')
    else: fail('SQL: условия удаления', f'найдено {dels or alls}')
    grants = re.findall(r'grant execute on function public\.delete_my_account\(\) to ([\w, ]+);', sql)
    if grants == ['authenticated'] and 'revoke all on function public.delete_my_account() from public, anon;' in sql:
        ok('SQL: вызывать может только authenticated (у public и anon права отозваны)')
    else: fail('SQL: права', f'grant → {grants}')
    if 'create or replace function' in sql and 'drop ' not in sql: ok('SQL: повторный запуск файла безопасен (create or replace, без drop)')
    else: fail('SQL: повторный запуск', 'нужен create or replace без drop')

SUPPORT_MAIL = 'moneylife.ap@gmail.com'   # почта поддержки — выбрал владелец 02.11.2026
SUBJECTS = {'ru': 'Удалить аккаунт', 'uk': 'Видалити акаунт'}

def articles(html):
    return {m.group(1): m.group(2) for m in re.finditer(r'<article lang="(\w+)"[^>]*>(.*?)</article>', html, re.S)}

def support_mail_checks(pages):
    """Почта поддержки на privacy.html и delete.html: настоящий адрес ссылкой mailto в обоих языках,
    тема письма закодирована правильно (%D0…, пробел = %20), чужих/придуманных адресов нет."""
    from urllib.parse import unquote, urlsplit, parse_qs
    for page, html in pages.items():
        others = sorted(set(re.findall(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+', html)) - {SUPPORT_MAIL})
        if others: fail(f'{page}: почта поддержки', 'на странице другие адреса: ' + ', '.join(others))
        for lang, body in articles(html).items():
            hrefs = re.findall(r'href="(mailto:[^"]*)"', body)
            bad = [h for h in hrefs if re.search(r'[^\x21-\x7e]', h) or urlsplit(h).path != SUPPORT_MAIL]
            subj = [unquote(parse_qs(urlsplit(h).query).get('subject', [''])[0]) for h in hrefs if 'subject=' in h]
            if not hrefs: fail(f'{page} ({lang}): почта поддержки', f'нет ссылки mailto:{SUPPORT_MAIL}')
            elif bad: fail(f'{page} ({lang}): ссылка mailto', 'незакодированные символы или чужой адрес: ' + ', '.join(bad))
            elif not subj or any(s != SUBJECTS[lang] for s in subj): fail(f'{page} ({lang}): тема письма', f'после раскодирования {subj}, ожидалось «{SUBJECTS[lang]}»')
            else: ok(f'{page} ({lang}): почта {SUPPORT_MAIL} ссылкой mailto, тема «{SUBJECTS[lang]}» закодирована верно')

PLACEHOLDERS = [(r'\[[^\]\n]{0,80}выберет владелец[^\]\n]{0,40}\]', '[… выберет владелец]'), (r'\bTODO\b', 'TODO'),
                (r'\bFIXME\b', 'FIXME'), (r'class="[^"]*\btodo\b', 'class="todo"')]
DEL_BUTTON = re.compile(r'#delete|«Удалить аккаунт»|«Удалить навсегда»')   # кнопка/окно удаления в приложении
SOON = re.compile(r"появ\w*ся|з['’]яв\w*ся")                               # «появится / появятся», «з'явиться / з'являться»

def delete_button_claims(html):
    """Абзацы и пункты списков, где упомянута кнопка удаления в приложении (или ссылка #delete).
    Возвращает [(язык, текст, есть_ли_пометка_«появится»)]. Пометка засчитывается в самом абзаце/пункте
    или в заголовке h2 той же карточки. Тема письма («тема «Удалить аккаунт»») кнопкой не считается."""
    out = []
    for lang, body in articles(html).items():
        for card in re.findall(r'<div class="card">(.*?)</div>', body, re.S):
            h2 = re.search(r'<h2>(.*?)</h2>', card, re.S)
            h2 = h2.group(1) if h2 else ''
            for _, el in re.findall(r'<(p|li)\b[^>]*>(.*?)</\1>', card, re.S):
                text = re.sub(r'тем\w*\s+«[^»]*»', '', el)
                if DEL_BUTTON.search(text):
                    plain = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', el)).strip()
                    out.append((lang, plain, bool(SOON.search(el) or SOON.search(h2))))
    return out

def public_pages_checks():
    """Публичные страницы (их видит Google Play и пользователи): нет заполнителей и TODO;
    тексты про удаление аккаунта честно соответствуют флагу accountDelete в config.js."""
    for page in ['privacy.html', 'delete.html', 'index.html']:
        html = (ROOT / page).read_text(encoding='utf-8')
        found = [label for rx, label in PLACEHOLDERS if re.search(rx, html)]
        ok(f'{page}: нет заполнителей «[… выберет владелец]» и TODO') if not found else fail(f'{page}: заполнители', 'найдено: ' + ', '.join(found))
    flag = re.search(r'"accountDelete"\s*:\s*(true|false)', (ROOT / 'config.js').read_text(encoding='utf-8'))
    if not flag: fail('config.js: флаг accountDelete', 'не найден — проверка честности текстов не выполнена'); return
    enabled = flag.group(1) == 'true'
    for page in ['privacy.html', 'delete.html']:
        claims = delete_button_claims((ROOT / page).read_text(encoding='utf-8'))
        langs = {c[0] for c in claims}
        if langs != {'ru', 'uk'}: fail(f'{page}: упоминание кнопки удаления', f'не найдено в обоих языках (есть: {sorted(langs)}) — проверка не сработала бы'); continue
        if not enabled:
            bad = [f'{l}: «{t[:70]}…»' for l, t, soon in claims if not soon]
            if not bad: ok(f'{page}: при accountDelete: false кнопка удаления описана как «появится в ближайшем обновлении» ({len(claims)} мест)')
            else: fail(f'{page}: обещает кнопку удаления, а она выключена (accountDelete: false)', '; '.join(bad)[:600])
        else:
            left = [f'{l}: «{t[:70]}…»' for l, t, soon in claims if soon]
            if not left: ok(f'{page}: кнопка удаления включена — пометок «появится» не осталось')
            else: fail(f'{page}: кнопку удаления включили — уберите пометки «появится»', '; '.join(left)[:600])

def manifest_checks(html):
    """Манифест PWA — паспорт приложения для Google Play (TWA через Bubblewrap/PWABuilder)."""
    from PIL import Image
    try: m = json.loads((ROOT / 'manifest.webmanifest').read_text(encoding='utf-8'))
    except Exception as e: fail('манифест', f'не читается: {e}'); return
    # id не менять: от него зависит, узнает ли телефон уже установленное приложение
    if m.get('id') == '/moneylife/': ok('манифест: постоянный id «/moneylife/»')
    else: fail('манифест: id', f'ожидалось "/moneylife/", в файле {m.get("id")!r} — смена id «раздвоит» установленное приложение')
    ok('манифест: категория finance') if 'finance' in (m.get('categories') or []) else fail('манифест: categories', 'нет "finance"')
    ok('манифест: язык ru') if m.get('lang') == 'ru' else fail('манифест: lang', f'{m.get("lang")!r}')
    def png(src, what):
        p = ROOT / src
        if not p.exists(): fail(what, f'нет файла {src}'); return None
        try: return Image.open(p).size
        except Exception as e: fail(what, f'{src} не картинка: {e}'); return None
    icons = m.get('icons') or []
    for ic in icons:
        size = png(ic.get('src', ''), f'манифест: иконка {ic.get("src")}')
        if size and ic.get('sizes') != f'{size[0]}x{size[1]}':
            fail(f'манифест: иконка {ic["src"]}', f'в манифесте {ic.get("sizes")}, а на деле {size[0]}x{size[1]}')
    if any('any' in (ic.get('purpose') or 'any').split() and ic.get('sizes') == '512x512' for ic in icons): ok('манифест: обычная иконка 512×512')
    else: fail('манифест: иконка any', 'нет обычной иконки 512×512')
    mask = [ic for ic in icons if 'maskable' in (ic.get('purpose') or '').split()]
    sizes = [png(ic['src'], 'манифест: maskable-иконка') for ic in mask]
    if mask and all(s and s[0] == s[1] and s[0] >= 512 for s in sizes): ok('манифест: maskable-иконка на месте и квадратная')
    else: fail('манифест: maskable-иконка', f'нужна квадратная от 512 px, найдено {sizes or "ничего"}')
    # ярлыки ведут на вкладки, которые index.html умеет открывать по #хэшу
    tabs = re.search(r"const startTab=.*?\.includes\(startTab\)", html)
    allowed = re.findall(r"'(\w+)'", tabs.group(0)) if tabs else []
    for sc in m.get('shortcuts') or []:
        h = (sc.get('url') or '').partition('#')[2]
        name = sc.get('name')
        if not (sc.get('url', '').startswith('./') and h in allowed):
            fail(f'манифест: ярлык «{name}»', f'адрес {sc.get("url")!r} не открывает вкладку'); continue
        # значки ярлыка необязательны; если указаны — файлы должны быть (png() сам пишет провал)
        icons_ok = [png(i.get('src', ''), f'манифест: значок ярлыка «{name}»') for i in sc.get('icons') or []]
        if all(icons_ok): ok(f'манифест: ярлык «{name}» → #{h}')
    try:
        al = json.loads((ROOT / '.well-known' / 'assetlinks.json').read_text(encoding='utf-8'))
        t = al[0]['target']
        ok('шаблон assetlinks.json: ' + t['package_name']) if t.get('namespace') == 'android_app' and t.get('package_name') else fail('assetlinks.json', 'нет пакета')
    except Exception as e: fail('шаблон assetlinks.json', str(e)[:200])

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

IGNORE_CONSOLE = re.compile(r'Failed to load resource|net::ERR_|ERR_INTERNET_DISCONNECTED|ERR_FAILED|ERR_ABORTED|favicon|Failed to fetch|NetworkError|Load failed|AbortError|The user aborted|signal is aborted|Blocked call to navigator\.vibrate', re.I)

def run_browser():
    print('\n[2] Приложение в браузере (без интернета, Supabase — имитация)')
    from playwright.sync_api import sync_playwright
    srv, base = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-proxy-server'])

        def page_for(name, test_cfg, prices=True, dsf=2, theme=None):
            ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=dsf, service_workers='block',
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
            if theme: ctx.add_init_script("try{localStorage.setItem('cp-prefs2',JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('cp-prefs2')||'{}'),{theme:%s})))}catch(e){}" % json.dumps(theme))
            pg = ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append('JS-ошибка: ' + str(e)[:300]))
            pg.on('console', lambda m: errs.append('console.error: ' + m.text[:300]) if m.type == 'error' and not IGNORE_CONSOLE.search(m.text) and 'mock:' not in m.text else None)
            return ctx, pg, errs

        def wait_app(pg, timeout=20000):
            # Ждём нижнее меню через опрос по таймеру, а не по кадрам анимации: в тестовом браузере
            # 3D-маскот рисуется без видеокарты (~4 кадра/с), и обычное ожидание Playwright не успевает.
            pg.wait_for_function("""()=>{const n=document.querySelector('nav.tabs');if(!n)return false;
                const r=n.getBoundingClientRect(),s=getComputedStyle(n);
                return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!n.closest('[hidden]')}""",
                polling=250, timeout=timeout)

        def shot(pg, name):
            pg.screenshot(path=str(OUT / f'{name}.png'))

        def scenario(name, cfg, body, prices=True, path='index.html', dsf=2, theme=None):
            ctx, pg, errs = page_for(name, cfg, prices, dsf, theme)
            try:
                pg.goto(base + path, wait_until='load', timeout=30000)
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

        # --- А2. вид форм для новичка (Вера 03–04.11), обе темы: поля входа ≥ 48 px, «Создать аккаунт» видна без прокрутки,
        #     подсказки-образцы в полях приглушены (не цвет текста), галочка — цветом приложения, значок календаря по теме
        PH = "(id)=>{const e=document.getElementById(id);return [getComputedStyle(e).color,getComputedStyle(e,'::placeholder').color,getComputedStyle(e,'::placeholder').fontStyle]}"
        for th in ('light', 'dark'):
            def s_login_look(pg, n, th=th):
                pg.wait_for_selector('#mlaPass', state='visible', timeout=8000)
                if pg.evaluate("document.documentElement.dataset.theme") != th: raise AssertionError('тема не включилась: ' + th)
                hs = pg.evaluate("['mlaEmail','mlaPass'].map(i=>Math.round(document.getElementById(i).getBoundingClientRect().height))")
                ok(f'вход ({th}): поля почты и пароля ≥ 48 px {hs}') if min(hs) >= 48 else fail(f'вход ({th}): высота полей', str(hs))
                up = pg.evaluate("(()=>{const b=document.querySelector('#mlAuth [data-to=up]');if(!b)return null;const r=b.getBoundingClientRect();return [r.top,r.bottom,r.height,innerHeight,b.textContent.trim()]})()")
                if up and up[1] <= up[3] and up[2] >= 47.5: ok(f'вход ({th}): «{up[4]}» видна без прокрутки, {round(up[2])} px')
                else: fail(f'вход ({th}): кнопка регистрации', str(up))
                pg.screenshot(path=str(OUT / f'fix-login-{th}.png'))
            scenario(f'Вид входа ({th})', {'session': False, 'docs': []}, s_login_look, dsf=1, theme=th)

            def s_forms_look(pg, n, th=th):
                wait_app(pg)
                if pg.evaluate("document.documentElement.dataset.theme") != th: raise AssertionError('тема не включилась: ' + th)
                pg.evaluate("""()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Купить'&&x.offsetParent);b.click()}""")
                pg.wait_for_timeout(700)
                pg.click('#buyMode [data-m=dca]'); pg.wait_for_timeout(300)
                for i in ('bTotal', 'bAlt'):
                    c, ph, st = pg.evaluate(PH, i)
                    ok(f'«Купить» ({th}): подсказка в #{i} приглушена') if c != ph and st == 'italic' else fail(f'«Купить» ({th}): подсказка #{i}', f'текст {c}, подсказка {ph}, {st}')
                pg.screenshot(path=str(OUT / f'fix-buy-plan-{th}.png'))
                pg.click('#buyMode [data-m=one]'); pg.wait_for_timeout(300)
                c, ph, st = pg.evaluate(PH, 'oSym')
                ok(f'«Купить» ({th}): подсказка в #oSym приглушена') if c != ph else fail(f'«Купить» ({th}): подсказка #oSym', f'{c} = {ph}')
                cb = pg.evaluate("(()=>{const s=getComputedStyle(document.getElementById('oDca'));return [s.appearance,s.borderTopColor]})()")
                acc = pg.evaluate("(()=>{const d=document.createElement('i');d.style.color='var(--accent)';document.body.appendChild(d);const c=getComputedStyle(d).color;d.remove();return c})()")
                ok(f'«Купить» ({th}): галочка DCA — цветом приложения') if cb[0] == 'none' and cb[1] == acc else fail(f'«Купить» ({th}): галочка DCA', f'{cb} ≠ {acc}')
                pg.screenshot(path=str(OUT / f'fix-buy-one-{th}.png'))
                bg = pg.evaluate("(()=>{const e=document.getElementById('oDca'),was=e.checked;e.checked=true;const c=getComputedStyle(e).backgroundColor;e.checked=was;return c})()")
                ok(f'«Купить» ({th}): отмеченная галочка залита цветом приложения') if bg == acc else fail(f'«Купить» ({th}): отмеченная галочка', f'{bg} ≠ {acc}')
                cs = pg.evaluate("getComputedStyle(document.getElementById('fDate')).colorScheme")
                ok(f'дата ({th}): значок календаря по теме ({cs})') if cs == th else fail(f'дата ({th}): color-scheme', cs)
                pg.evaluate("document.getElementById('dateField').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300)
                pg.screenshot(path=str(OUT / f'fix-date-{th}.png'))
            scenario(f'Вид форм ({th})', {'session': True, 'docs': SEED}, s_forms_look, dsf=1, theme=th)

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

        # --- Б2. путь новичка (Вера 03.11): шаг 4 знакомства — видимая «Пропустить» ≥ 48 px, подсказка «например, BTC»,
        #     подсказки .ob-note с контрастом ≥ 4,5:1 в обеих темах; первая покупка без записей — «Одна монета»
        CONTRAST = """(sel)=>{const lum=c=>{const m=c.match(/[\\d.]+/g).map(Number);return m.slice(0,3).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0)};
            const bgOf=e=>{for(;e;e=e.parentElement){const b=getComputedStyle(e).backgroundColor;if(b&&!/rgba\\(.*,\\s*0\\)$/.test(b)&&b!=='transparent')return b;}return 'rgb(0,0,0)'};
            return [...document.querySelectorAll(sel)].map(e=>{const a=lum(getComputedStyle(e).color),b=lum(bgOf(e.closest('.ob-card')||e));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})}"""
        def s_newbie(pg, n):
            norm = lambda t: t.replace('\u202f', ' ').replace('\xa0', ' ').strip()
            pg.wait_for_selector('#ob:not([hidden])', timeout=8000)
            low = []
            for i in range(3):
                if i == 1: pg.click('[data-tpl="simple"]'); pg.wait_for_timeout(200)   # новичок выбирает «Простой»
                for th in ['dark', 'light']:
                    pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(80)
                    low += [f'{th}: {r:.2f}' for r in pg.evaluate(CONTRAST, '#ob .ob-note') if r < 4.5]
                pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
                pg.click('#obNext'); pg.wait_for_timeout(300)
            if low: fail('знакомство: контраст подсказок ≥ 4,5:1', ', '.join(low))
            else: ok('знакомство: подсказки читаются (контраст ≥ 4,5:1 в обеих темах)')
            if 'Что у тебя уже есть' not in pg.inner_text('#obTitle'): raise AssertionError('не дошли до шага 4 знакомства')
            bad = pg.evaluate("[...document.querySelectorAll('#ob button')].filter(b=>!b.closest('[hidden]')&&!(b.textContent||'').trim()&&!b.getAttribute('aria-label')).map(b=>b.id||b.className)")
            if not pg.locator('#obSkip').count() and not bad: ok('шаг 4 знакомства: нет «Пропустить» и нет кнопок без названия')
            else: fail('шаг 4 знакомства: лишние кнопки', f'obSkip={pg.locator("#obSkip").count()}, без названия: {bad}')
            ph = pg.get_attribute('#obCoins .ob-sym', 'placeholder') or ''
            if ph.startswith('например') and pg.input_value('#obCoins .ob-sym') == '': ok('шаг 4: поле монеты пустое, подсказка «например, BTC»')
            else: fail('шаг 4: подсказка в поле монеты', repr(ph))
            for th in ['dark', 'light']:
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(300)
                shot(pg, f'newbie-ob-step4-{th}')
            pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
            pg.click('#obNext'); pg.wait_for_selector('#ob[hidden]', state='attached', timeout=5000)
            st = pg.evaluate("((window.__mlRows.get('app/settings')||{}).data||{}).template")
            if st == 'simple': ok('«Готово» на шаге 4 сохраняет выбранный шаблон («Простой»)')
            else: fail('«Готово» на шаге 4', f'template = {st!r}, ожидался simple')
            wait_app(pg); pg.wait_for_timeout(4500)
            # №4 (Вера 03.11): подсказка после знакомства живёт ~7 с, пустой график и строка под суммой ведут к «Купить»
            tt = norm(pg.inner_text('#toastMsg')) if pg.locator('#toast.show').count() else ''
            if 'Купить' in tt: ok('после знакомства подсказка «Нажми «Купить»…» ещё видна через 4,5 с')
            else: fail('подсказка после знакомства держится ~7 с', repr(tt))
            ge, hs = norm(pg.inner_text('#gChart')), norm(pg.inner_text('#hSub'))
            if 'Нажми «Купить» и запиши первую покупку' in ge: ok('пустой график: «Нажми «Купить» и запиши первую покупку…»')
            else: fail('пустой график: подсказка новичку', repr(ge))
            if hs == 'Начни с кнопки «Купить»': ok('пустой портфель: под суммой «Начни с кнопки «Купить»»')
            else: fail('пустой портфель: строка под суммой', repr(hs))
            pg.wait_for_function("!document.querySelector('#toast.show')", polling=250, timeout=6000)
            opened = pg.evaluate("""()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Купить'&&x.offsetParent);if(!b)return false;b.click();return true;}""")
            if not opened: raise AssertionError('кнопка «Купить» не найдена на главном')
            pg.wait_for_timeout(700)
            mode = pg.evaluate("document.querySelector('#buyMode [aria-pressed=\"true\"]').dataset.m")
            if mode == 'one' and pg.locator('#oSym').is_visible(): ok('первая покупка без записей открывается в режиме «Одна монета»')
            else: fail('первая покупка без записей', f'выбран режим {mode!r}')
            for th in ['dark', 'light']:
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(300)
                shot(pg, f'newbie-first-buy-{th}')
            pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
            pg.evaluate("document.querySelector('#buyMode [data-m=\"one\"]').click()"); pg.wait_for_timeout(300)
            if pg.inner_text('#oHint').strip() == '': ok('«Одна монета» с пустым полем: под формой нет подсказки-ошибки')
            else: fail('«Одна монета» с пустым полем', repr(pg.inner_text('#oHint')))
            # №9: подсказка у «Получил монет» и понятная строка итога (расчёт прежний)
            if 'истории сделок биржи' in pg.inner_text('#oQtyHint'): ok('«Одна монета»: у «Получил монет» подсказка «смотри в истории сделок биржи»')
            else: fail('«Одна монета»: подсказка у «Получил монет»', repr(pg.inner_text('#oQtyHint')))
            pg.fill('#oSym', 'BTC'); pg.fill('#oUsd', '50'); pg.fill('#oQty', '0.00045'); pg.wait_for_timeout(300)
            oh = norm(pg.inner_text('#oHint'))
            if oh.replace('.', ',').startswith('всего будет 0,00045 BTC · средняя цена покупки $111 111'): ok(f'«Одна монета»: строка итога понятна («{oh}»)')
            else: fail('«Одна монета»: строка итога', repr(oh))
            # №5 (Вера 03.11): первая запись не выглядит провалом — расчёты те же, меняется только вид
            pg.evaluate("""()=>{const b=[...document.querySelectorAll('#actSheet button')].find(x=>x.textContent.trim()==='Сохранить'&&x.offsetParent);if(b)b.click();}""")
            pg.wait_for_function("!document.querySelector('#actSheet.open')", polling=250, timeout=6000); pg.wait_for_timeout(1500)
            hs = norm(pg.inner_text('#hSub')).replace('−', '-')
            if hs == '-$0 · -1,0% результат сейчас' or hs == '-$1 · -1,0% результат сейчас': ok(f'первая покупка в минусе: под суммой «{hs}» (число прежнее, подпись «результат»)')
            else: fail('первая покупка: строка под суммой', repr(hs))
            al = pg.evaluate("[...document.querySelectorAll('#alloc .arow')].map(r=>[r.querySelector('.d').innerText.replace(/\\u00a0|\\u202f/g,' '),getComputedStyle(r.querySelector('.adev')).color,getComputedStyle(r.querySelector('.d')).color])")
            want = ['цель 70% · выше цели на 30,0%', 'цель 30% · ниже цели на 30,0%', 'цель 0% · в цели']   # шаблон «Простой» 70/30/0
            if [a[0] for a in al] == want and all(a[1] == a[2] for a in al): ok('распределение: отклонение от цели словами и нейтральным цветом')
            else: fail('распределение: отклонение от цели', repr(al))
            gx = pg.evaluate("(()=>{const t=[...document.querySelectorAll('#gChart svg text')].map(e=>e.textContent),y=t.filter(s=>/\\$/.test(s)).map(s=>+s.replace(/[^0-9]/g,''));return {x:t.filter(s=>!/\\$/.test(s)),y}})()")
            if gx['x'] == ['сегодня']: ok('график за один день: по оси X одна подпись «сегодня»')
            else: fail('график за один день: подписи оси X', repr(gx['x']))
            if gx['y'] and max(gx['y']) - min(gx['y']) >= 5: ok(f'график: шкала не уже ±5% от суммы ({gx["y"]})')
            else: fail('график: шкала Y', repr(gx['y']))
            for th in ['dark', 'light']:
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(300)
                pg.evaluate("window.scrollTo(0,0)"); pg.wait_for_timeout(200); shot(pg, f'first-record-top-{th}')
                pg.evaluate("document.getElementById('alloc').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300); shot(pg, f'first-record-alloc-{th}')
            pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
        scenario('Путь новичка', {'session': True, 'docs': []}, s_newbie)

        # --- В. пользователь с данными: вкладки и шторки
        def s_user(pg, n):
            wait_app(pg)
            if pg.locator('#ob:not([hidden])').count(): raise AssertionError('знакомство показано пользователю, у которого уже есть данные')
            pg.wait_for_timeout(1500); shot(pg, '04-home'); ok('главный экран открыт')
            bal = (pg.inner_text('#hBal') if pg.locator('#hBal').count() else '').replace('\u202f', ' ').replace('\xa0', ' ')
            digits = re.sub(r'[^0-9]', '', bal)
            if not digits or int(digits) == 0: fail('стоимость портфеля с ценами', f'показано «{bal}» — ожидалось больше нуля (BTC 0.005 × $110 000 и т.д.)')
            else: ok(f'стоимость портфеля посчитана: {bal}')
            sub = pg.inner_text('#hSub').replace('\u202f', ' ').replace('\xa0', ' ')
            if '+$150' in sub: ok('прибыль с ценами посчитана: +$150 (950 − 800)')
            else: fail('прибыль с ценами', f'показано «{sub}», ожидалось +$150')
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

        # --- В2. ярлык с главного экрана телефона (shortcuts в манифесте) открывает нужную вкладку
        def s_shortcut(pg, n):
            wait_app(pg); pg.wait_for_timeout(800)
            if pg.get_attribute('nav.tabs [data-tab="strategy"]', 'aria-current') == 'page' and pg.locator('#v-strategy:not([hidden])').count():
                ok('ярлык #strategy открывает вкладку «Стратегия»')
            else: fail('ярлык #strategy', 'вкладка «Стратегия» не открылась')
            shot(pg, '05b-shortcut-strategy')
        scenario('Ярлык «Стратегия»', {'session': True, 'docs': SEED}, s_shortcut, path='index.html#strategy')

        # --- В3. ярлык, когда приложение уже открыто: меняется только #хэш — вкладка должна переключиться
        def s_hash(pg, n):
            wait_app(pg); pg.wait_for_timeout(800)
            if pg.get_attribute('nav.tabs [data-tab="home"]', 'aria-current') != 'page': raise AssertionError('при запуске открыта не «Главная»')
            pg.evaluate("location.hash='#strategy'"); pg.wait_for_timeout(800)
            if pg.get_attribute('nav.tabs [data-tab="strategy"]', 'aria-current') == 'page' and pg.locator('#v-strategy:not([hidden])').count():
                ok('открытое приложение: #strategy переключает на «Стратегию»')
            else: fail('открытое приложение: смена #хэша', 'вкладка «Стратегия» не открылась')
            pg.evaluate("location.hash='#coins'"); pg.wait_for_timeout(800)
            if pg.get_attribute('nav.tabs [data-tab="coins"]', 'aria-current') == 'page': ok('открытое приложение: #coins переключает на «Монеты»')
            else: fail('открытое приложение: смена #хэша', 'вкладка «Монеты» не открылась')
        scenario('Ярлык в открытом приложении', {'session': True, 'docs': SEED}, s_hash)

        # --- Г. запись покупки через форму (если форма доступна)
        def s_buy(pg, n):
            wait_app(pg)
            before = pg.evaluate("[...window.__mlRows.keys()].filter(k=>k.startsWith('tx/')).length")
            opened = pg.evaluate("""()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Купить'&&x.offsetParent);if(!b)return false;b.click();return true;}""")
            if not opened: raise AssertionError('кнопка «Купить» не найдена на главном')
            pg.wait_for_timeout(700); shot(pg, '06-buy-sheet'); ok('шторка «Купить» открывается')
            if pg.evaluate("document.querySelector('#buyMode [aria-pressed=\"true\"]').dataset.m") == 'dca': ok('есть покупки — шторка открывается в режиме «По плану»')
            else: fail('шторка «Купить» с покупками', 'режим по умолчанию не «По плану»')
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

        # --- Г2. шторки форм: большие, по высоте содержимого (решение владельца 2026-10-29: видна вся форма, Слиток может быть закрыт),
        #     «Сохранить» всегда видна внизу, длинная форма прокручивается; кнопки не меньше 48 px
        GEOM = """()=>{const s=document.getElementById('actSheet').getBoundingClientRect(),f=document.getElementById('saveBtn').getBoundingClientRect(),
            b=document.querySelector('#actSheet .sh-body');return {top:s.top,h:s.height,bottom:s.bottom,vh:innerHeight,save:[f.top,f.bottom,f.height],sh:b.scrollHeight,ch:b.clientHeight}}"""
        # зона касания: сама кнопка или её невидимый ::after/::before (так увеличены маленькие кнопки)
        HIT = """(where)=>{const out=[];document.querySelectorAll('button,[role=button],[role=switch],summary,.check,a').forEach(b=>{
            const r=b.getBoundingClientRect();if(!r.width||!r.height||getComputedStyle(b).visibility==='hidden'||b.closest('[hidden]'))return;
            const sh=b.closest('.sheet');if(sh&&!sh.classList.contains('open'))return;
            if(b.tagName==='A'&&b.closest('p'))return; /* ссылка внутри текста — по правилам доступности исключение */
            let w=r.width,h=r.height;for(const p of ['::after','::before']){const s=getComputedStyle(b,p);
              if(s.content&&s.content!=='none'&&s.position==='absolute'){w=Math.max(w,parseFloat(s.width)||0);h=Math.max(h,parseFloat(s.height)||0);}}
            if(w<47.5||h<47.5)out.push(where+': '+(b.id||b.getAttribute('aria-label')||(b.textContent||'').trim().slice(0,14)||b.className)+' '+Math.round(w)+'×'+Math.round(h));
            if(!(b.textContent||'').trim()&&!b.getAttribute('aria-label')&&!b.getAttribute('aria-labelledby'))out.push(where+': кнопка без текста и без aria-label '+(b.id||b.className));});return out}"""
        def s_sheets(pg, n):
            wait_app(pg); pg.wait_for_timeout(800)
            hb = pg.evaluate("[...document.querySelectorAll('header.top button')].map(b=>{const r=b.getBoundingClientRect();return [b.id,Math.round(r.width),Math.round(r.height),b.getAttribute('aria-label')||'']})")
            bad = [h for h in hb if h[1] < 48 or h[2] < 48 or not h[3]]
            if hb and not bad: ok(f'кнопки шапки не меньше 48×48 и с подписью для экранного диктора ({len(hb)} шт.)')
            else: fail('кнопки шапки ≥48 px', f'{bad or "кнопок нет"}')
            small = []
            for tab in ['home', 'coins', 'strategy', 'activity']:
                pg.evaluate(f"document.querySelector('nav.tabs [data-tab=\"{tab}\"]').click()"); pg.wait_for_timeout(400)
                small += pg.evaluate(HIT, tab)
            pg.evaluate("document.querySelector('nav.tabs [data-tab=\"home\"]').click()"); pg.wait_for_timeout(500)
            pg.evaluate("scrollTo(0,0)")
            g = {}
            pg.evaluate("document.getElementById('plusBtn').click()"); pg.wait_for_timeout(700)
            for m, title in [('menu', 'Новая запись'), ('deposit', 'Пополнить биржу'), ('sell', 'Продать'), ('buy', 'Купить')]:
                if m != 'menu':
                    pg.evaluate("(()=>{const b=document.getElementById('actBack');if(!b.hidden)b.click();})()"); pg.wait_for_timeout(200)
                    pg.evaluate(f"document.querySelector('#f-menu [data-go=\"{m}\"]').click()"); pg.wait_for_timeout(600)
                g[title] = pg.evaluate(GEOM)
                small += pg.evaluate(HIT, title)
                for th in ['dark', 'light']:
                    pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(150)
                    shot(pg, f'11-sheet-{m}-{th}')
                pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
            b = g['Купить']
            # большая шторка: не меньше 75% окна — или вся форма видна целиком без обрезки
            if b['h'] >= 0.75 * b['vh'] - 0.5 or b['sh'] <= b['ch'] + 1: ok(f'«Купить»: шторка большая — {round(b["h"])} px из {b["vh"]} ({round(100 * b["h"] / b["vh"])}% окна), форма {b["sh"]} px')
            else: fail('«Купить»: шторка большая (≥75% окна или вся форма видна)', f'высота {round(b["h"])} px из {b["vh"]}, форма {b["sh"]} px в окне {b["ch"]} px')
            if b['bottom'] <= b['vh'] + 1 and b['h'] <= 0.92 * b['vh'] + 1: ok(f'«Купить»: шторка в пределах экрана (до 92% окна, верх {round(b["top"])} px)')
            else: fail('«Купить»: шторка в пределах экрана', str(b))
            if b['save'][2] > 0 and b['save'][0] >= b['top'] and b['save'][1] <= b['vh'] and b['save'][1] >= b['bottom'] - 120: ok('«Купить»: кнопка «Сохранить» видна внизу шторки')
            else: fail('«Купить»: «Сохранить» видна внизу', str(b))
            short = {t: round(v['h']) for t, v in g.items() if not ((v['save'][2] == 0 or v['save'][1] <= v['vh']) and (v['sh'] <= v['ch'] + 1 or v['h'] >= 0.75 * v['vh'] - 0.5))}
            if not short: ok('шторки «Новая запись», «Пополнить биржу», «Продать», «Купить»: форма видна целиком или шторка большая, «Сохранить» на экране')
            else: fail('шторки форм: видна вся информация', str(short))
            # длинная форма (маленький телефон, окно 640 px): тело шторки прокручивается, «Сохранить» остаётся внизу
            pg.set_viewport_size({'width': 390, 'height': 640}); pg.wait_for_timeout(600)
            sm = pg.evaluate(GEOM)
            if sm['sh'] > sm['ch'] + 20:
                st = pg.evaluate("(()=>{const x=document.querySelector('#actSheet .sh-body');x.scrollTop=9999;return x.scrollTop})()")
                sv = pg.evaluate("(()=>{const f=document.getElementById('saveBtn').getBoundingClientRect(),s=document.getElementById('actSheet').getBoundingClientRect();return f.bottom<=innerHeight&&f.height>0&&f.top>=s.top})()")
                shot(pg, '11-sheet-buy-640')
                if st > 0 and sv and sm['bottom'] <= sm['vh'] + 1: ok(f'«Купить» на окне 640 px: длинная форма прокручивается внутри шторки ({sm["sh"]} px в окне {sm["ch"]} px), «Сохранить» видна')
                else: fail('«Купить»: прокрутка внутри шторки', f'scrollTop={st}, «Сохранить» видна={sv}, {sm}')
            else: fail('«Купить»: прокрутка внутри шторки', f'форма не длиннее окна шторки ({sm["sh"]} / {sm["ch"]}) — проверка не сработала')
            pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(500)
            # экранная клавиатура: окно сжимается до 520 px, поле в фокусе и «Сохранить» должны остаться видны
            pg.evaluate("document.querySelector('#actSheet .sh-body').scrollTop=0")
            pg.focus('#bu_ALT'); pg.wait_for_timeout(400)
            pg.set_viewport_size({'width': 390, 'height': 520}); pg.wait_for_timeout(1200)
            k = pg.evaluate("""()=>{const s=document.getElementById('actSheet').getBoundingClientRect(),f=document.getElementById('saveBtn').getBoundingClientRect(),
                i=document.getElementById('bu_ALT').getBoundingClientRect(),b=document.querySelector('#actSheet .sh-body').getBoundingClientRect();
                return {kb:document.documentElement.classList.contains('kb'),top:s.top,bottom:s.bottom,vh:innerHeight,save:f.bottom,fld:[i.top,i.bottom],body:[b.top,b.bottom]}}""")
            shot(pg, '11-sheet-keyboard')
            if k['top'] >= 0 and k['bottom'] <= k['vh'] + 1 and k['save'] <= k['vh'] + 1 and k['fld'][0] >= k['body'][0] - 1 and k['fld'][1] <= k['body'][1] + 1:
                ok('с клавиатурой: поле в фокусе и «Сохранить» видны (окно 520 px)')
            else: fail('с клавиатурой поля не перекрыты', str(k))
            pg.evaluate("document.activeElement&&document.activeElement.blur()")
            pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(500)
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(400)
            for js, nm in [("openSettings()", 'Настройки'), ("openCoin('BTC')", 'Монета')]:
                pg.evaluate(js); pg.wait_for_timeout(600); small += pg.evaluate(HIT, nm)
            small = list(dict.fromkeys(small))
            if not small: ok('зоны нажатия не меньше 48×48 (вкладки, шторки форм, настройки, монета)')
            else: fail('зоны нажатия ≥48 px', '; '.join(small)[:600])
        scenario('Шторки форм', {'session': True, 'docs': SEED}, s_sheets)

        # --- Г3. Слиток на главной один: заглушка .ms-still прячется, когда рисует 3D, и после потери WebGL-контекста
        #     (Android уводит приложение в фон) не остаётся видна рядом с ожившим 3D
        MS = """()=>{const h=document.getElementById('mascot'),st=h&&h.querySelector('.ms-still'),d=window.Mascot&&Mascot.debug&&Mascot.debug.state();
            return {cv:h?h.querySelectorAll('canvas').length:-1,mscv:document.querySelectorAll('.ms-cv').length,live:!!(h&&h.classList.contains('ms-live')),
              still:st?+getComputedStyle(st).opacity:-1,frame:!!(d&&d.frame)}}"""
        def s_mascot(pg, n):
            wait_app(pg)
            if not pg.evaluate("(()=>{try{const c=document.createElement('canvas');return !!(c.getContext('webgl2')||c.getContext('webgl'))}catch(e){return false}})()"):
                ok('(Слиток: в тестовом браузере нет WebGL — проверки 3D пропущены)'); return
            try: pg.wait_for_function("()=>{const h=document.getElementById('mascot');return h&&h.classList.contains('ms-live')}", polling=250, timeout=25000)
            except Exception: raise AssertionError('3D-Слиток не ожил за 25 с (нет класса ms-live)')
            pg.wait_for_timeout(700)
            a = pg.evaluate(MS)
            if a['cv'] == 1 and a['mscv'] == 1 and a['still'] == 0: ok('на главной ровно один Слиток: один canvas .ms-cv, заглушка скрыта')
            else: fail('на главной ровно один Слиток', str(a))
            for th in ['dark', 'light']:
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(400)
                shot(pg, f'15-mascot-home-{th}')
            pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
            has = pg.evaluate("""()=>{const c=document.querySelector('#mascot .ms-cv');if(!c)return false;const g=c.getContext('webgl2')||c.getContext('webgl');
                const x=g&&g.getExtension('WEBGL_lose_context');if(!x)return false;window.__msLC=x;return true}""")
            if not has: ok('(Слиток: WEBGL_lose_context недоступно в тестовом браузере — проверка потери контекста пропущена)'); return
            pg.evaluate("window.__msLC.loseContext()"); pg.wait_for_timeout(1500)
            b = pg.evaluate(MS)
            if not b['live'] and b['still'] == 1 and not b['frame']: ok('потеря WebGL-контекста: 3D спрятан, видна только заглушка')
            else: fail('потеря WebGL-контекста', str(b))
            pg.evaluate("window.__msLC.restoreContext()")
            try: pg.wait_for_function("()=>document.getElementById('mascot').classList.contains('ms-live')", polling=250, timeout=8000)
            except Exception: pass
            pg.wait_for_timeout(2000)
            c = pg.evaluate(MS)
            shot(pg, '15-mascot-after-restore')
            both = c['frame'] and c['still'] > 0          # 3D уже рисует, а заглушка всё ещё видна — «два Слитка»
            if c['cv'] != 1 or c['mscv'] != 1: fail('после восстановления контекста — один canvas', str(c))
            elif both or c['live'] != c['frame']: fail('после восстановления контекста — не видно двух Слитков', str(c))
            elif c['live'] and c['still'] == 0: ok('после восстановления контекста: 3D-Слиток ожил, заглушка скрыта, canvas один')
            elif not c['live'] and c['still'] == 1: ok('после восстановления контекста: 3D не ожил, видна только заглушка (двух Слитков нет)')
            else: fail('после восстановления контекста', str(c))
        scenario('Слиток один', {'session': True, 'docs': SEED}, s_mascot)

        # --- Г4. карточка докупки «ждём ключ 2» (владелец 05.11): в чипе «BTC $38,39» сумму покупки приняли за цену BTC —
        #     теперь «BTC на $… · когда цена ≤ $…»: видно, что $ — сумма, а порог — цена монеты
        import datetime as _dt
        recent = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=10)).strftime('%Y-%m-%dT10:00:00.000Z')
        HOLD = SEED + [
            {'col': 'app', 'id': 'cycle', 'data': {'ath': 200000, 'athDate': '2026-10-06', 'levels': [
                {'n': i + 1, 'drop': d, 'pct': p, 'status': 'pending'} for i, (d, p) in enumerate([(30, 20), (40, 25), (50, 33), (60, 50), (70, 100)])]}},
            {'col': 'tx', 'id': 't5', 'data': {'ts': recent, 'type': 'buy', 'symbol': 'BTC', 'qty': 0.001, 'usd': 112, 'price': 112000}},
            {'col': 'tx', 'id': 't6', 'data': {'ts': recent, 'type': 'buy', 'symbol': 'ETH', 'qty': 0.01, 'usd': 41, 'price': 4100}},
        ]
        for th in ('dark', 'light'):
            def s_hold(pg, n, th=th):
                wait_app(pg)
                pg.wait_for_function("()=>!!document.querySelector('#signal .signal.soft .chip:not(.warn)')", polling=250, timeout=10000)
                chips = [c.replace(' ', ' ').replace('\xa0', ' ') for c in pg.eval_on_selector_all('#signal .chips .chip', 'es=>es.map(e=>e.textContent.trim())')]
                btc = next((c for c in chips if c.startswith('BTC')), '')
                if re.match(r'^BTC на \$[\d ,]+ · когда цена ≤ \$[\d ,]+$', btc): ok(f'докупка ({th}): чип «{btc}» — сумма и цена не путаются')
                else: fail(f'докупка ({th}): текст чипа BTC', repr(chips))
                bad = [c for c in chips if re.match(r'^\S+ \$', c)]
                ok(f'докупка ({th}): ни один чип не читается как «монета $цена»') if not bad else fail(f'докупка ({th}): двусмысленный чип', repr(bad))
                pg.evaluate("document.getElementById('signal').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300)
                pg.locator('#signal').screenshot(path=str(OUT / f'fix-ladder-chip-{th}.png'))
            scenario(f'Карточка докупки ({th})', {'session': True, 'docs': HOLD}, s_hold, theme=th)

        # --- Д. база недоступна: приложение не падает
        def s_off(pg, n):
            pg.wait_for_timeout(1500); shot(pg, '08-db-down')
            if pg.locator('#offline:not([hidden])').count(): ok('плашка «нет связи с базой» показана')
            else: fail('база недоступна', 'нет плашки о том, что связи с базой нет')
        scenario('База недоступна', {'session': True, 'docs': SEED, 'failLoad': True}, s_off, prices=False)

        def norm(t): return t.replace('\u202f', ' ').replace('\xa0', ' ').replace('\u2212', '-')
        def s_noprice(pg, n):
            wait_app(pg); pg.wait_for_timeout(1500); shot(pg, '09-no-prices')
            ok('приложение открылось без цен')
            sub, gr = norm(pg.inner_text('#hSub')), norm(pg.inner_text('#gRead'))
            if 'нет актуальных цен' in sub: ok('без цен: под суммой честно написано «нет актуальных цен»')
            else: fail('без цен: подпись под суммой', f'показано «{sub}»')
            if '-100' in sub + gr or '-$800' in sub + gr: fail('без цен: нет пугающего убытка', f'показано «{sub}» / «{gr}»')
            else: ok('без цен: нет пугающего «−100%» убытка')
        scenario('Нет цен (биржи недоступны)', {'session': True, 'docs': SEED}, s_noprice, prices=False)

        # --- Е. нет цен, но есть сохранённый снимок стоимости — показываем его
        SNAP = SEED + [{'col': 'history', 'id': '2026-10-19', 'data': {'date': '2026-10-19', 'value': 1234}},
                       {'col': 'history', 'id': '2026-10-10', 'data': {'date': '2026-10-10', 'value': 999}}]
        def s_noprice_snap(pg, n):
            wait_app(pg); pg.wait_for_timeout(2500); shot(pg, '10-no-prices-snapshot')
            bal, sub = norm(pg.inner_text('#hBal')), norm(pg.inner_text('#hSub'))
            if '1 234' in bal or '1234' in bal: ok(f'без цен: показана последняя известная стоимость {bal}')
            else: fail('без цен: последняя известная стоимость', f'показано «{bal}», ожидалось $1 234 из снимка 19 окт.')
            if 'нет актуальных цен' in sub and '19 окт' in sub: ok('без цен: подписана дата снимка')
            else: fail('без цен: дата снимка', f'подпись «{sub}»')
        scenario('Нет цен, есть снимок', {'session': True, 'docs': SNAP}, s_noprice_snap, prices=False)

        # --- Ж. страница удаления аккаунта (для Google Play) и ссылка на неё из политики
        def s_delpage(pg, n):
            pg.wait_for_selector('article[data-lang="ru"]:not([hidden]) h1', timeout=5000)
            if 'Удаление аккаунта Money Life' not in pg.inner_text('article[data-lang="ru"] h1'): raise AssertionError('нет заголовка на русском')
            shot(pg, '11-delete-page-ru'); ok('delete.html открывается (RU)')
            pg.click('.lang [data-l="uk"]'); pg.wait_for_timeout(200)
            if pg.locator('article[data-lang="uk"]:not([hidden])').count() and 'Видалення' in pg.inner_text('article[data-lang="uk"] h1'):
                shot(pg, '12-delete-page-uk'); ok('delete.html: переключение на украинский')
            else: fail('delete.html: украинский', 'не переключился')
        scenario('Страница удаления', {'session': False, 'docs': []}, s_delpage, path='delete.html')

        def s_priv2del(pg, n):
            pg.click('article[data-lang="ru"] a[href="delete.html"]'); pg.wait_for_load_state('load')
            if pg.url.endswith('/delete.html') and pg.locator('article[data-lang="ru"] h1').count(): ok('privacy.html → ссылка ведёт на delete.html')
            else: fail('privacy.html → delete.html', f'открылось {pg.url}')
        scenario('Политика → удаление', {'session': False, 'docs': []}, s_priv2del, path='privacy.html')

        # --- З. удаление аккаунта из приложения: свои записи удалены, чужие целы, повтор не ломает
        OTHER = [{'col': 'tx', 'id': 't1', 'data': {'ts': NOW, 'type': 'buy', 'symbol': 'BTC', 'qty': 1, 'usd': 1, 'price': 1}},
                 {'col': 'app', 'id': 'settings', 'data': {'onboardedAt': NOW}}]
        def s_delete(pg, n):
            wait_app(pg)
            pg.click('#setBtn'); pg.wait_for_selector('#setSheet.open', timeout=5000)
            if pg.get_attribute('#delBtn', 'hidden') is not None: raise AssertionError('кнопка «Удалить аккаунт» скрыта при accountDelete: true')
            pg.locator('#delBtn').scroll_into_view_if_needed(); pg.click('#delBtn'); pg.wait_for_selector('#delSheet.open', timeout=5000)
            if not pg.is_disabled('#delGo'): raise AssertionError('«Удалить навсегда» активна без слова УДАЛИТЬ')
            pg.fill('#delWord', 'удалить')
            if pg.is_disabled('#delGo'): raise AssertionError('«Удалить навсегда» не включилась после слова УДАЛИТЬ')
            pg.wait_for_timeout(400); shot(pg, '13-delete-sheet'); ok('окно удаления: кнопка включается только после слова УДАЛИТЬ')
            with pg.expect_navigation(timeout=10000):
                pg.evaluate("()=>{const b=document.getElementById('delGo');b.click();b.click();}")   # двойное нажатие
            pg.wait_for_selector('#mlAuth', state='visible', timeout=8000); pg.wait_for_timeout(500)
            shot(pg, '14-after-delete')
            if 'Аккаунт и все записи удалены' in pg.inner_text('#mlAuth'): ok('после удаления — экран входа «Аккаунт и все записи удалены»')
            else: fail('после удаления: сообщение', pg.inner_text('#mlAuth')[:200])
            st = pg.evaluate("""()=>({mine: window.__mlRows.size, other: window.__mlForeign.size, gone: window.__mlDeletedUsers.has('test-user-0001'),
                calls: +(sessionStorage.getItem('__mlDelCalls')||0), local: Object.keys(localStorage).filter(k=>k.startsWith('ml-docs:')||k==='ml-last-uid')})""")
            if st['mine'] == 0 and st['gone']: ok('удалены все записи и аккаунт этого пользователя')
            else: fail('удаление своих данных', f'осталось записей {st["mine"]}, аккаунт удалён: {st["gone"]}')
            if st['other'] == len(OTHER): ok('записи другого пользователя целы')
            else: fail('чужие записи', f'было {len(OTHER)}, стало {st["other"]}')
            if st['calls'] == 1: ok('двойное нажатие «Удалить навсегда» — одно удаление')
            else: fail('двойное нажатие', f'вызовов delete_my_account: {st["calls"]}')
            if not st['local']: ok('копия данных на телефоне стёрта')
            else: fail('копия на телефоне', 'остались ключи ' + ', '.join(st['local']))
            # повторное удаление после выхода: аккуратный отказ, приложение живо
            r = pg.evaluate("()=>window.mlDeleteAccount().then(()=>'ok',e=>'отказ: '+(e&&e.message))")
            if r.startswith('отказ'): ok('повторное удаление после выхода — аккуратный отказ (' + r + ')')
            else: fail('повторное удаление', 'не отказало')
            # вход удалённым аккаунтом не пускает и не роняет приложение
            pg.fill('#mlaEmail', 'tester@example.com'); pg.fill('#mlaPass', 'secret123'); pg.click('#mlaGo'); pg.wait_for_timeout(800)
            msg = pg.inner_text('#mlaErr').strip() if pg.locator('#mlaErr').count() else ''
            if pg.locator('#mlAuth').is_visible() and msg: ok('вход удалённым аккаунтом — ошибка «' + msg + '»')
            else: fail('вход удалённым аккаунтом', 'экран входа пропал или нет сообщения')
        scenario('Удаление аккаунта', {'session': True, 'docs': SEED, 'otherDocs': OTHER, 'accountDelete': True, 'persist': True}, s_delete)

        # --- З2. сама функция (имитация повторяет SQL): повторный вызов не падает, без входа — отказ
        def s_delete_rpc(pg, n):
            wait_app(pg)
            r = pg.evaluate("""async()=>{const c=window.supabase.createClient();const a=await c.rpc('delete_my_account');const b=await c.rpc('delete_my_account');
                await c.auth.signOut();const z=await c.rpc('delete_my_account');return {a:a.error,b:b.error,z:z.error&&z.error.message,other:window.__mlForeign.size}}""")
            if r['a'] is None and r['b'] is None: ok('delete_my_account: повторный вызов без ошибки')
            else: fail('delete_my_account: повтор', str(r))
            if r['z'] == 'not signed in': ok('delete_my_account: без входа — отказ «not signed in»')
            else: fail('delete_my_account: без входа', str(r))
            if r['other'] == len(OTHER): ok('delete_my_account: чужие записи целы после двух вызовов')
            else: fail('delete_my_account: чужие записи', str(r))
        scenario('Функция удаления', {'session': True, 'docs': SEED, 'otherDocs': OTHER}, s_delete_rpc)

        # --- З3. ссылка …/#delete без входа → «Войти через Google» → возврат с токеном: окно удаления открывается само
        GKEY = 'ml-after-login'
        def s_delete_google(pg, n):
            pg.wait_for_selector('#mlAuth', state='visible', timeout=8000)
            if 'Войди, чтобы удалить аккаунт' not in pg.inner_text('#mlAuth'): raise AssertionError('нет подсказки «Войди, чтобы удалить аккаунт»')
            with pg.expect_navigation(timeout=10000):
                pg.click('#mlaG')
            wait_app(pg)
            try: pg.wait_for_selector('#delSheet.open', timeout=6000); ok('#delete + вход через Google: после возврата окно удаления открыто')
            except Exception: fail('#delete + вход через Google', 'окно удаления не открылось после возврата'); return
            st = pg.evaluate(f"()=>({{hash: location.hash, flag: localStorage.getItem('{GKEY}'), ph: document.getElementById('delWord').placeholder, go: document.getElementById('delGo').disabled}})")
            if not st['hash'] and st['flag'] is None: ok('после открытия окна: адрес чистый, намерение «удалить» стёрто')
            else: fail('после открытия окна', str(st))
            if st['ph'] == 'УДАЛИТЬ': ok('поле подтверждения: подсказка-образец «УДАЛИТЬ»')
            else: fail('поле подтверждения: подсказка', f'placeholder = {st["ph"]!r}')
            if st['go']: ok('«Удалить навсегда» выключена, пока слово не вписано (подсказка — не значение)')
            else: fail('кнопка «Удалить навсегда»', 'включена с пустым полем')
            pg.wait_for_timeout(500)
            for th in ['dark', 'light']:
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(300)
                shot(pg, f'delete-modal-{th}')
            pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
            if pg.evaluate("window.__mlRows.size") > 0 and pg.evaluate("+(sessionStorage.getItem('__mlDelCalls')||0)") == 0: ok('окно только открыто — ничего не удалено без подтверждения')
            else: fail('окно удаления', 'записи удалены без подтверждения')
        scenario('Удаление после входа через Google', {'session': False, 'docs': SEED, 'accountDelete': True, 'persist': True, 'oauthReturn': True}, s_delete_google, path='index.html#delete')

        # --- З4. обычный вход через Google (без #delete), даже со старым намерением в памяти — окно удаления НЕ открывается
        def s_google_plain(pg, n):
            pg.wait_for_selector('#mlAuth', state='visible', timeout=8000)
            pg.evaluate(f"localStorage.setItem('{GKEY}', JSON.stringify({{go:'delete', ts: Date.now() - 31*60*1000}}))")   # просроченное
            with pg.expect_navigation(timeout=10000):
                pg.click('#mlaG')
            wait_app(pg); pg.wait_for_timeout(1500)
            if pg.locator('#delSheet.open').count(): fail('вход через Google без #delete', 'открылось окно удаления')
            else: ok('вход через Google без #delete: окно удаления не открывается (просроченное намерение не учтено)')
            if pg.evaluate(f"localStorage.getItem('{GKEY}')") is None: ok('просроченное намерение «удалить» стёрто')
            else: fail('просроченное намерение', 'осталось в памяти')
        scenario('Вход через Google без #delete', {'session': False, 'docs': SEED, 'accountDelete': True, 'persist': True, 'oauthReturn': True}, s_google_plain)

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

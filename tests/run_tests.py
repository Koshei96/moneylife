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
    signal_checks()

def signal_checks():
    """Фоновые сигналы (sw.js, 10.11.2026): ступень лестницы и цель BTC — событие один раз, повтор не шлём."""
    js = r"""const fs=require('fs'),vm=require('vm');const ctx={self:{addEventListener(){},registration:{}},caches:{},location:{origin:'x'},URL,Response:function(){},fetch(){}};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1],'utf8')+';this.mlEvents=mlEvents;',ctx);
const cfg={ath:126000,athDate:'2025-10-06',levels:[{n:1,drop:30,price:88200},{n:2,drop:40,price:75600}],goal:150000,seen:{}};
const a=ctx.mlEvents(cfg,100000).length,b=ctx.mlEvents(cfg,88000).map(e=>e.k),c=ctx.mlEvents(cfg,75000).length,d=ctx.mlEvents(cfg,151000).map(e=>e.k);
cfg.seen['lv:2025-10-06:1:k1']=1;cfg.seen['goal:150000']=1;const e=ctx.mlEvents(cfg,88000).length+ctx.mlEvents(cfg,151000).length;
const al={alerts:[{id:'x1',sym:'SOL',price:150,dir:'up'},{id:'x2',sym:'ETH',price:3000,dir:'down'}],seen:{}};
const f=ctx.mlEvents(al,100000,{SOL:151,ETH:3500}).map(e=>e.k);al.seen['al:x1']=1;const g=ctx.mlEvents(al,100000,{SOL:160,ETH:2900}).map(e=>e.k);
console.log(JSON.stringify([a,b,c,d,e,f,g]));"""
    try:
        out = subprocess.run(['node', '-e', js, str(ROOT / 'sw.js')], capture_output=True, text=True, timeout=30)
        got = json.loads(out.stdout.strip() or 'null')
        if got == [0, ['lv:2025-10-06:1:k1'], 2, ['goal:150000'], 0, ['al:x1'], ['al:x2']]: ok('сигналы в фоне: ступень, цель и оповещение о цене монеты — событие один раз, выше ступеней — тишина')
        else: fail('сигналы в фоне (sw.js)', (out.stdout + out.stderr)[:300])
    except Exception as e: fail('сигналы в фоне (sw.js)', str(e)[:200])
    sw = (ROOT / 'sw.js').read_text(encoding='utf-8')
    ok('сигналы: настройки сигналов переживают обновление версии (кэш ml-cfg не стирается)') if "k!==CFGC" in sw and "const CFGC='ml-cfg'" in sw else fail('сигналы: кэш настроек', 'ml-cfg стирается при обновлении')

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

        def page_for(name, test_cfg, prices=True, dsf=2, theme=None, extra=None, tz='Europe/Kyiv', motion=None):
            ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=dsf, service_workers='block',
                                      locale='ru-RU', timezone_id=tz, is_mobile=True, has_touch=True,
                                      reduced_motion=motion or 'no-preference')
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
                if extra and extra(r, u): return
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

        def scenario(name, cfg, body, prices=True, path='index.html', dsf=2, theme=None, extra=None, tz='Europe/Kyiv', clock=None, motion=None):
            if os.environ.get('ML_ONLY') and os.environ['ML_ONLY'] not in name: return
            ctx, pg, errs = page_for(name, cfg, prices, dsf, theme, extra, tz, motion)
            try:
                if clock: pg.clock.install(time=clock)   # подменённые часы телефона (идут дальше сами)
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

        # --- А3. нижняя панель (Вера 04.11, 07.11), обе темы: подписи неактивных вкладок цветом --mute (≥ 4,5:1),
        #     значки неактивных — по-прежнему --dim, активная вкладка — как была (--fg)
        NAV = """()=>{const v=n=>{const e=document.createElement('i');e.style.color='var('+n+')';document.body.appendChild(e);const c=getComputedStyle(e).color;e.remove();return c};
            const t=[...document.querySelectorAll('nav.tabs .tab')],off=t.filter(b=>!b.hasAttribute('aria-current')),on=t.find(b=>b.hasAttribute('aria-current'));
            return {mute:v('--mute'),dim:v('--dim'),fg:v('--fg'),lab:off.map(b=>getComputedStyle(b).color),ico:off.map(b=>getComputedStyle(b.querySelector('svg')).color),on:getComputedStyle(on).color}}"""
        for th in ('light', 'dark'):
            def s_nav_look(pg, n, th=th):
                wait_app(pg)
                if pg.evaluate("document.documentElement.dataset.theme") != th: raise AssertionError('тема не включилась: ' + th)
                r = pg.evaluate(NAV)
                if len(r['lab']) == 3 and all(c == r['mute'] for c in r['lab']): ok(f'нижняя панель ({th}): подписи неактивных вкладок цветом --mute')
                else: fail(f'нижняя панель ({th}): подписи', f"{r['lab']} ≠ {r['mute']}")
                ok(f'нижняя панель ({th}): значки неактивных — --dim, активная — --fg') if all(c == r['dim'] for c in r['ico']) and r['on'] == r['fg'] else fail(f'нижняя панель ({th}): значки/активная', str(r))
                # Вера 07.11: сквозь полупрозрачный фон панели просвечивал текст карточек — фон непрозрачный (альфа ≥ 0,98; прежние 0,95–0,96 просвечивали)
                bg = pg.evaluate("getComputedStyle(document.querySelector('nav.tabs')).backgroundColor")
                m = re.match(r'rgba?\(([^)]*)\)', bg); parts = [x.strip() for x in m.group(1).split(',')] if m else []
                a = float(parts[3]) if len(parts) == 4 else (1.0 if len(parts) == 3 else 0.0)
                ok(f'нижняя панель ({th}): фон плотный, альфа {a:g}') if a >= 0.98 else fail(f'нижняя панель ({th}): фон просвечивает', bg)
                shot(pg, f'nav-{th}')
            scenario(f'Нижняя панель ({th})', {'session': True, 'docs': SEED}, s_nav_look, dsf=1, theme=th)

        # --- А4. смена вкладок (08.11, «анимация вкладок»): содержимое проявляется 160–220 мс только через opacity/transform,
        #     полоска над активной вкладкой; при «уменьшить движение» в системе — без анимаций и переходов
        TABCLICK = """t=>{document.querySelector('nav.tabs [data-tab="'+t+'"]').click();const v=document.getElementById('v-'+t);
            const a=v.getAnimations().map(x=>{const k=x.effect.getKeyframes();return {name:x.animationName||'',dur:x.effect.getTiming().duration,
                props:[...new Set(k.flatMap(f=>Object.keys(f).filter(p=>!['offset','easing','composite','computedOffset'].includes(p))))]}});
            return {a,shown:!v.hidden,others:[...document.querySelectorAll('.view')].filter(x=>x!==v&&!x.hidden).length,
                cur:document.querySelector('nav.tabs [aria-current="page"]').dataset.tab,td:getComputedStyle(document.querySelector('nav.tabs .tab')).transitionDuration}}"""
        BAR = """()=>[...document.querySelectorAll('nav.tabs .tab')].map(b=>[b.dataset.tab,+getComputedStyle(b,'::before').opacity])"""
        for th in ('dark', 'light'):
            def s_tab_anim(pg, n, th=th):
                wait_app(pg); pg.wait_for_timeout(600)
                if pg.evaluate("document.documentElement.dataset.theme") != th: raise AssertionError('тема не включилась: ' + th)
                r = pg.evaluate(TABCLICK, 'coins')
                vin = [a for a in r['a'] if a['name'] == 'vin']
                if r['shown'] and not r['others'] and r['cur'] == 'coins' and vin and 160 <= vin[0]['dur'] <= 220 and set(vin[0]['props']) <= {'opacity', 'transform'}:
                    ok(f'смена вкладки ({th}): «Монеты» видна одна, проявление {vin[0]["dur"]:g} мс только opacity/transform')
                else: fail(f'смена вкладки ({th}): анимация', str(r))
                if th == 'dark':  # кадр середины перехода: все анимации и переходы — на паузу на половине
                    pg.evaluate(TABCLICK, 'strategy')
                    fin = "document.getAnimations().filter(a=>isFinite(a.effect.getComputedTiming().endTime))"
                    pg.evaluate(f"()=>{fin}.forEach(a=>{{a.pause();a.currentTime=90}})")
                    shot(pg, 'tab-mid-dark')
                    pg.evaluate(f"()=>{fin}.forEach(a=>a.finish())")
                    pg.evaluate(TABCLICK, 'coins')
                pg.wait_for_timeout(700)
                left = pg.evaluate("document.getElementById('v-coins').getAnimations().length")
                tr = pg.evaluate("getComputedStyle(document.getElementById('v-coins')).transform")
                ok(f'смена вкладки ({th}): после перехода анимация закончилась, сдвига нет') if left == 0 and tr == 'none' else fail(f'смена вкладки ({th}): после перехода', f'{left} анимаций, transform {tr}')
                bar = pg.evaluate(BAR)
                if [b[0] for b in bar if b[1] > 0.99] == ['coins'] and all(b[1] < 0.01 for b in bar if b[0] != 'coins'): ok(f'смена вкладки ({th}): полоска только над активной вкладкой')
                else: fail(f'смена вкладки ({th}): полоска', str(bar))
                shot(pg, f'tab-coins-{th}')
                pg.evaluate(TABCLICK, 'activity'); pg.wait_for_timeout(700)
                shot(pg, f'tab-activity-{th}')
            scenario(f'Смена вкладок ({th})', {'session': True, 'docs': SEED}, s_tab_anim, dsf=1, theme=th)

        def s_tab_reduced(pg, n):
            wait_app(pg); pg.wait_for_timeout(600)
            if not pg.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"): raise AssertionError('«уменьшить движение» не включилось')
            res = [pg.evaluate(TABCLICK, t) for t in ('coins', 'strategy', 'activity', 'home')]
            if all(r['shown'] and not r['others'] and not r['a'] for r in res) and all(float(x.strip().rstrip('s') or 0) == 0 for x in res[0]['td'].split(',')):
                ok('«уменьшить движение»: вкладки переключаются сразу, без анимации и переходов (длительность 0)')
            else: fail('«уменьшить движение»: вкладки', str(res))
            bar = pg.evaluate(BAR)
            ok('«уменьшить движение»: полоска сразу над активной вкладкой') if [b[0] for b in bar if b[1] > 0.99] == ['home'] else fail('«уменьшить движение»: полоска', str(bar))
        scenario('Смена вкладок: уменьшить движение', {'session': True, 'docs': SEED}, s_tab_reduced, motion='reduce')

        # --- Б. новый пользователь → знакомство
        def s_new(pg, n):
            pg.wait_for_selector('#ob:not([hidden])', timeout=8000)
            shot(pg, '02-onboarding'); ok('знакомство показано новому пользователю')
            pg.click('#obSkip'); pg.wait_for_selector('#ob[hidden]', state='attached', timeout=5000)
            pg.wait_for_timeout(800); shot(pg, '03-after-onboarding'); ok('«Пропустить» закрывает знакомство')
            if not pg.evaluate("[...window.__mlRows.keys()].includes('app/settings')"):
                raise AssertionError('после знакомства не сохранились настройки (app/settings)')
            ok('настройки сохранены после знакомства')
            pg.evaluate("document.querySelector('nav.tabs [data-tab=\"coins\"]').click()"); pg.wait_for_timeout(400)
            if pg.locator('#coinRanges').is_hidden() and 'Монет пока нет' in pg.inner_text('#coinList'): ok('«Монеты» без монет: переключатель периода скрыт, подсказка «Монет пока нет»')
            else: fail('«Монеты» без монет', 'виден переключатель периода или нет подсказки')
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
            # Вера 05.11: первая покупка моложе суток — рядом с «результат сейчас» нет плашки «24ч» (расчёт прежний)
            hc = norm(pg.inner_text('#hChips'))
            if '24ч' not in hc: ok(f'первая покупка моложе суток: плашки «24ч» нет ({hc!r})')
            else: fail('первая покупка моложе суток: плашка «24ч»', repr(hc))
            for th in ['dark', 'light']:
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(300)
                pg.evaluate("window.scrollTo(0,0)"); pg.wait_for_timeout(200); shot(pg, f'newbie-24h-{th}')
            pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
            al = pg.evaluate("[...document.querySelectorAll('#alloc .arow')].map(r=>[r.querySelector('.d').innerText.replace(/\\u00a0|\\u202f/g,' '),getComputedStyle(r.querySelector('.adev')).color,getComputedStyle(r.querySelector('.d')).color])")
            want = ['цель 70% · выше цели на 30,0%', 'цель 30% · ниже цели на 30,0%', 'цель 0% · в цели']   # шаблон «Простой» 70/30/0
            if [a[0] for a in al] == want and all(a[1] == a[2] for a in al): ok('распределение: отклонение от цели словами и нейтральным цветом')
            else: fail('распределение: отклонение от цели', repr(al))
            gx = pg.evaluate("(()=>{const s=document.querySelector('#gChart svg'),c=document.getElementById('gCard'),h=document.querySelector('.hero'),q=document.querySelector('.qa');return {txt:s?s.querySelectorAll('text').length:-1,lo:s?+s.dataset.lo:0,hi:s?+s.dataset.hi:0,under:!!(c&&h&&q&&c.getBoundingClientRect().top>=h.getBoundingClientRect().bottom-1&&c.getBoundingClientRect().bottom<=q.getBoundingClientRect().top+1)}})()")
            if gx['txt'] == 0 and gx['under']: ok('график — сразу под суммой, без осей и подписей')
            else: fail('график под суммой', repr(gx))
            if gx['hi'] - gx['lo'] >= 5: ok(f'график: шкала не уже ±5% от суммы ({gx["lo"]}–{gx["hi"]})')
            else: fail('график: шкала Y', repr(gx))
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
            hc = pg.inner_text('#hChips').replace('\u202f', ' ').replace('\xa0', ' ')
            if '24ч +' in hc: ok(f'покупки старше суток: плашка «24ч» на месте ({hc.split(chr(10))[0]!r})')
            else: fail('покупки старше суток: плашка «24ч»', repr(hc))
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

        # --- В4. редизайн, этап 1 (часть 1): «Монеты» — таблица из трёх колонок и переключатель периода 24ч · 1Н · Всё.
        #     Имитация цен: BTC $110 000, ETH $4000, за 24ч +1,5%, 7-дневный график начинается с 0,97 × цены (за неделю +3,1%).
        #     Покупки SEED: BTC 0,005 за $500, ETH 0,1 за $300. Расчёты денег не меняются — проверяем только показ.
        # история цен CoinGecko отвечает «нет данных» (не сбой сети) — тогда CoinGecko не уходит на паузу и цены с 7-дневным графиком
        # приходят обычным путём, как у владельца; без этого в тестах цены всегда идут с биржи, без графика
        def cg_chart_404(r, u):
            if 'api.coingecko.com' in u and '/market_chart' in u:
                r.fulfill(status=404, content_type='application/json', headers={'access-control-allow-origin': '*'}, body='{"error":"not found"}'); return True
            return False
        def cnorm(t): return t.replace(' ', ' ').replace('\xa0', ' ').replace('−', '-')
        ROWS = """()=>[...document.querySelectorAll('#coinList .row[data-coin]')].map(r=>{const c=r.querySelectorAll('.c');const t=e=>[...e.querySelectorAll('.b,.s')].map(x=>x.textContent);
            return {s:r.dataset.coin,h:Math.round(r.getBoundingClientRect().height),cols:c.length,a:t(c[0]),p:t(c[1]),v:t(c[2])}})"""
        def coin_state(pg):
            rows = {r['s']: r for r in pg.evaluate(ROWS)}
            for r in rows.values():
                for k in ('a', 'p', 'v'): r[k] = [cnorm(x) for x in r[k]]
            return {'per': pg.evaluate("[...document.querySelectorAll('#coinRanges [data-per]')].map(b=>[b.textContent,b.getAttribute('aria-pressed')])"),
                    'head': [cnorm(x) for x in pg.evaluate("[...document.querySelectorAll('#coinList .thead [data-sortcol]')].map(b=>b.textContent)")],
                    'tot': cnorm(pg.inner_text('#coinsTot')), 'lbl': cnorm(pg.inner_text('#coinsLbl')), 'rows': rows}
        for th in ('dark', 'light'):
            def s_coins_table(pg, n, th=th):
                wait_app(pg)
                if pg.evaluate("document.documentElement.dataset.theme") != th: raise AssertionError('тема не включилась: ' + th)
                try: pg.wait_for_function("Object.keys(S.live.spark).length>0", polling=250, timeout=10000)
                except Exception: pass   # не пришёл график — проверка 1Н ниже честно покажет «—»
                pg.evaluate("document.querySelector('nav.tabs [data-tab=\"coins\"]').click()"); pg.wait_for_timeout(700)
                st = coin_state(pg)
                if [b[0] for b in st['per']] == ['24ч', '1Н', 'Всё'] and [b[1] for b in st['per']] == ['true', 'false', 'false']:
                    ok(f'«Монеты» ({th}): переключатель периода 24ч · 1Н · Всё, выбран 24ч')
                else: fail(f'«Монеты» ({th}): переключатель периода', str(st['per']))
                hh = pg.evaluate("Math.round(document.getElementById('coinRanges').getBoundingClientRect().height)")
                ok(f'«Монеты» ({th}): переключатель 48 px') if hh >= 48 else fail(f'«Монеты» ({th}): высота переключателя', str(hh))
                if st['head'] == ['Актив', 'Цена · 24ч', 'Портфель▾']: ok(f'«Монеты» ({th}): шапка таблицы «Актив · Цена · 24ч · Портфель ▾»')
                else: fail(f'«Монеты» ({th}): шапка таблицы', str(st['head']))
                b = st['rows'].get('BTC')
                if b and b['cols'] == 3 and b['h'] == 60 and b['a'][0] == 'BTC' and b['a'][1] == '0,005' and b['p'] == ['$110 000', '+1,5%'] and b['v'] == ['$550', '+$8,13']:
                    ok(f'«Монеты» ({th}): строка BTC 60 px, три колонки: 0,005 · $110 000 +1,5% · $550 +$8,13 за 24ч')
                else: fail(f'«Монеты» ({th}): строка BTC за 24ч', str(b))
                order = list(st['rows'])
                if order[:2] == ['BTC', 'ETH']: ok(f'«Монеты» ({th}): сортировка «По стоимости» осталась (BTC, затем ETH)')
                else: fail(f'«Монеты» ({th}): сортировка', str(order))
                # этап 1, часть 2: ряда чипов сортировки нет — сортировка по подписям колонок (зона ≥ 48 px, стрелка у активной)
                if pg.locator('#sortChips, #coinsTab .fchip[data-sort], section .fchip[data-sort]').count() == 0: ok(f'«Монеты» ({th}): ряда чипов сортировки нет')
                else: fail(f'«Монеты» ({th}): ряд чипов сортировки', 'ещё на странице')
                hz = pg.evaluate("[...document.querySelectorAll('#coinList .thead [data-sortcol]')].map(b=>{const r=b.getBoundingClientRect();return [Math.round(r.height),Math.round(r.width)]})")
                if len(hz) == 3 and all(h >= 48 and w >= 48 for h, w in hz): ok(f'«Монеты» ({th}): подписи колонок — кнопки, зона нажатия ≥ 48 px ({hz})')
                else: fail(f'«Монеты» ({th}): зона нажатия подписей', str(hz))
                # итог: «АКТИВЫ · 2» слева, справа сумма и прибыль за период
                if st['lbl'] == 'Активы · 2' and st['tot'].startswith('$950 · за 24ч +$'): ok(f'«Монеты» ({th}): итог «{st["lbl"]}» слева, «{st["tot"]}» справа')
                else: fail(f'«Монеты» ({th}): итог над таблицей', f'{st["lbl"]!r} | {st["tot"]!r}')
                shot(pg, f'stage1-coins-app-{th}')
                # неделя: из 7-дневного графика (0,97 × цены → +3,1%); прибыль = стоимость сейчас − кол-во × цена неделю назад
                pg.click('#coinRanges [data-per="1w"]'); pg.wait_for_timeout(400)
                st = coin_state(pg); b = st['rows'].get('BTC'); e = st['rows'].get('ETH')
                if st['head'][1] == 'Цена · 1Н' and b and b['p'][1] == '+3,1%' and b['v'][1] == '+$16,50' and e and e['v'][1] == '+$12':
                    ok(f'«Монеты» ({th}): 1Н — BTC +3,1% / +$16,50, ETH +$12 (из 7-дневного графика)')
                else: fail(f'«Монеты» ({th}): период 1Н', f'{st["head"]} {b} {e}; графики 7 дней: ' + pg.evaluate("JSON.stringify(Object.keys(S.live.spark))"))
                pill = pg.evaluate("document.querySelector('#coinRanges .pill').style.transform")
                ok(f'«Монеты» ({th}): пилюля переехала к 1Н') if pill == 'translateX(100%)' else fail(f'«Монеты» ({th}): пилюля', pill)
                # всё время: к средней цене покупки — как было раньше (BTC +10%, +$50; ETH +33,3%, +$100; итог +$150)
                pg.click('#coinRanges [data-per="all"]'); pg.wait_for_timeout(400)
                st = coin_state(pg); b = st['rows'].get('BTC'); e = st['rows'].get('ETH')
                if st['head'][1] == 'Цена · к покупке' and b and b['p'][1] == '+10,0%' and b['v'][1] == '+$50' and e and e['p'][1] == '+33,3%' and e['v'][1] == '+$100' and 'всего +$150' in st['tot']:
                    ok(f'«Монеты» ({th}): «Всё» — к средней цене покупки: BTC +10,0% / +$50, ETH +33,3% / +$100, всего +$150')
                else: fail(f'«Монеты» ({th}): период «Всё»', f'{st["head"]} {b} {e} {st["tot"]}')
                saved = pg.evaluate("JSON.parse(localStorage.getItem('cp-prefs2')||'{}').cper")
                ok(f'«Монеты» ({th}): выбор периода запомнен в настройках вида') if saved == 'all' else fail(f'«Монеты» ({th}): запоминание периода', repr(saved))
                if th == 'dark':
                    # «скрыть суммы»: стоимость и прибыль спрятаны, цена и % видны
                    pg.click('#eyeBtn'); pg.wait_for_timeout(300)
                    b = coin_state(pg)['rows'].get('BTC')
                    if b and b['v'] == ['••••', '••••'] and b['p'][0] == '$110 000' and b['a'][1].startswith('••••'): ok('«Монеты»: «скрыть суммы» прячет стоимость, прибыль и количество, цена видна')
                    else: fail('«Монеты»: «скрыть суммы»', str(b))
                    pg.click('#eyeBtn'); pg.wait_for_timeout(300)
                    # сортировка по подписям колонок (период «Всё»: BTC +10%, ETH +33,3%) — те же 4 способа, что были у чипов
                    def sort_after(col):
                        pg.click(f'#coinList .thead [data-sortcol="{col}"]'); pg.wait_for_timeout(250)
                        on = pg.evaluate("[...document.querySelectorAll('#coinList .thead [data-sortcol][aria-pressed=\"true\"]')].map(b=>b.dataset.sortcol+':'+b.textContent)")
                        return pg.evaluate("P.sort"), list(coin_state(pg)['rows']), [cnorm(x) for x in on]
                    r1 = sort_after('a'); r2 = sort_after('p'); r3 = sort_after('v'); r4 = sort_after('v'); r5 = sort_after('v'); r6 = sort_after('v')
                    if r1 == ('name', ['BTC', 'ETH'], ['a:Актив▴']) and r2 == ('chg', ['ETH', 'BTC'], ['p:Цена · к покупке▾']) \
                       and r3 == ('value', ['BTC', 'ETH'], ['v:Портфель▾']) and r4 == ('pnl', ['ETH', 'BTC'], ['v:Прибыль▾']) \
                       and r5 == ('pnlUp', ['BTC', 'ETH'], ['v:Прибыль▴']) and r6[0] == 'value':
                        ok('«Монеты»: сортировка по подписям — «Актив» А–Я ▴, «Цена» по изменению ▾, «Портфель» по стоимости ▾, ещё раз — по прибыли ▾, ещё раз — обратно ▴')
                    else: fail('«Монеты»: сортировка по подписям колонок', f'{r1} {r2} {r3} {r4} {r5} {r6}')
                    if pg.evaluate("JSON.parse(localStorage.getItem('cp-prefs2')||'{}').sort") == 'value': ok('«Монеты»: выбор сортировки запомнен, как раньше')
                    else: fail('«Монеты»: запоминание сортировки', pg.evaluate("localStorage.getItem('cp-prefs2')"))
                    # суммы в таблице от $1 000 — без копеек (и при округлении 999,996 → 1 000); мелкое — как было; money() не тронут
                    tm = [cnorm(x) for x in pg.evaluate("[tmoney(1234.56),tmoney(999.996),tmoney(950.5),tmoney(-1500.4,{sign:true}),tmoney(12.34,{sign:true}),tmoney(0.2,{price:true,show:true}),tmoney(110000,{price:true,show:true}),money(999.996),money(1234.56),tmoney(200),tmoney(199.996),tmoney(-8,{sign:true}),tmoney(0.001,{sign:true}),tmoney(0),tmoney(200,{price:true,show:true}),money(200)]")]
                    if tm == ['$1 235', '$1 000', '$950,50', '-$1 500', '+$12,34', '$0,2000', '$110 000', '$1 000,00', '$1 235', '$200', '$200', '-$8', '+$0,00', '$0', '$200', '$200,00']:
                        ok('«Монеты»: один формат сумм — от $1 000 и целые без копеек ($1 235, $200, 199,996 → $200), нецелые — с копейками ($950,50), DOGE $0,2000; общий money() не изменён')
                    else: fail('«Монеты»: суммы без копеек', str(tm))
                    # нет графика за неделю (цены с биржи) — «—», а не ошибка
                    r = pg.evaluate("[coinPer('ZZZ',{usd:10,qty:1},5,5,'1w'),coinPer('ZZZ',{usd:0,qty:1},5,5,'all'),coinPer('ZZZ',{usd:10,qty:1},0,null,'24h')]")
                    if all(x['ch'] is None and x['pf'] is None for x in r): ok('«Монеты»: нет данных за период (нет графика, монета без затрат, нет цены) — «—»')
                    else: fail('«Монеты»: нет данных за период', str(r))
                    # старое содержимое на месте: нажатие на строку открывает карточку монеты с действиями
                    pg.click('#coinList .row[data-coin="BTC"]'); pg.wait_for_timeout(700)
                    if pg.locator('#coinSheet.open').count(): ok('«Монеты»: нажатие на строку открывает карточку монеты (действия на месте)')
                    else: fail('«Монеты»: карточка монеты', 'не открылась по нажатию на строку')
                    pg.evaluate("closeSheets()"); pg.wait_for_timeout(400)
                    pg.reload(wait_until='load'); wait_app(pg); pg.wait_for_timeout(800)
                    pg.evaluate("document.querySelector('nav.tabs [data-tab=\"coins\"]').click()"); pg.wait_for_timeout(500)
                    pr = pg.evaluate("document.querySelector('#coinRanges [aria-pressed=\"true\"]').dataset.per")
                    ok('«Монеты»: после перезапуска выбран тот же период («Всё»)') if pr == 'all' else fail('«Монеты»: период после перезапуска', repr(pr))
            scenario(f'Монеты: таблица и период ({th})', {'session': True, 'docs': SEED}, s_coins_table, theme=th, extra=cg_chart_404)

        # --- В5. редизайн, этап 1 (часть 2): кадры «Монет» для Веры — обычный список, монета без цены, DOGE $0,2000,
        #     монета в минусе, пустая вкладка; обе темы, 390 px. Цены свои: ETH и SOL за сутки в минусе, HMSTR без цены.
        SHOW_PX = {'bitcoin': ('btc', 'Bitcoin', 110000, 1.5), 'ethereum': ('eth', 'Ethereum', 4000, -2.3), 'solana': ('sol', 'Solana', 200, -4.1),
                   'dogecoin': ('doge', 'Dogecoin', 0.2, 5.0)}
        def show_prices(r, u):
            if 'api.coingecko.com' in u and '/market_chart' in u: return cg_chart_404(r, u)
            if 'api.coingecko.com' in u and '/coins/markets' in u:
                from urllib.parse import urlparse, parse_qs, unquote
                ids = unquote(parse_qs(urlparse(u).query).get('ids', [''])[0]).split(',')
                out = [{'id': i, 'symbol': v[0], 'name': v[1], 'image': '', 'current_price': v[2], 'price_change_percentage_24h': v[3],
                        'sparkline_in_7d': {'price': [v[2] * (1.05 - k * 0.001) for k in range(60)]}} for i in ids if i in SHOW_PX for v in [SHOW_PX[i]]]
                r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps(out)); return True
            return False
        def tx(i, sym, q, usd): return {'col': 'tx', 'id': i, 'data': {'ts': '2026-08-02T10:00:00.000Z', 'type': 'buy', 'symbol': sym, 'qty': q, 'usd': usd, 'price': usd / q}}
        SHOW = [SEED[0], {'col': 'tx', 'id': 'd1', 'data': {'ts': '2026-08-01T10:00:00.000Z', 'type': 'deposit', 'usd': 6000, 'uah': 249000}},
                tx('s1', 'BTC', 0.02, 1800), tx('s2', 'ETH', 0.5, 2250), tx('s3', 'SOL', 3, 750), tx('s4', 'DOGE', 1000, 150), tx('s5', 'HMSTR', 50000, 100)]
        for th in ('dark', 'light'):
            def s_coins_show(pg, n, th=th):
                wait_app(pg)
                try: pg.wait_for_function("S.live.prices.DOGE>0&&S.live.prices.ETH>0", polling=250, timeout=10000)
                except Exception: pass
                pg.evaluate("document.querySelector('nav.tabs [data-tab=\"coins\"]').click()"); pg.wait_for_timeout(800)
                st = coin_state(pg); rw = st['rows']
                b, e, d, h = rw.get('BTC'), rw.get('ETH'), rw.get('DOGE'), rw.get('HMSTR')
                if b and b['v'] == ['$2 200', '+$32,51'] and b['p'][0] == '$110 000': ok(f'кадры «Монет» ({th}): BTC $2 200 — без копеек')
                else: fail(f'кадры «Монет» ({th}): BTC от $1 000', str(b))
                if e and e['v'] == ['$2 000', '-$47,08'] and e['p'] == ['$4 000', '-2,3%']: ok(f'кадры «Монет» ({th}): ETH в минусе за 24ч — $2 000 −$47,08, −2,3%')
                else: fail(f'кадры «Монет» ({th}): монета в минусе', str(e))
                if d and d['p'] == ['$0,2000', '+5,0%'] and d['v'][0] == '$200': ok(f'кадры «Монет» ({th}): DOGE $0,2000 — 4 знака у мелкой цены, стоимость $200 без «,00»')
                else: fail(f'кадры «Монет» ({th}): DOGE', str(d))
                if h and h['p'] == ['нет цены', '—'] and h['v'] == ['—', '—']: ok(f'кадры «Монет» ({th}): HMSTR без цены — «нет цены» и «—»')
                else: fail(f'кадры «Монет» ({th}): монета без цены', str(h))
                # часть 3: один формат — целые без «,00» и в строках, и в итоге (SOL $200 / $600)
                s_ = rw.get('SOL')
                if s_ and s_['p'][0] == '$200' and s_['v'][0] == '$600': ok(f'кадры «Монет» ({th}): SOL $200 · $600 — целые без «,00», как в итоге')
                else: fail(f'кадры «Монет» ({th}): формат целых сумм', str(s_))
                # часть 3: строка под таблицей о монете без цены (--warn-soft)
                npn = pg.evaluate("(()=>{const e=document.getElementById('npNote');return e&&!e.hidden?[e.textContent,getComputedStyle(e).backgroundColor,getComputedStyle(e).getPropertyValue('--warn-soft').trim()]:null})()")
                if npn and cnorm(npn[0]) == 'HMSTR — нет цены: биржи не ответили. Количество сохранено, в итог и прибыль не входит.' and npn[1] != 'rgba(0, 0, 0, 0)':
                    ok(f'кадры «Монет» ({th}): под таблицей «HMSTR — нет цены: биржи не ответили…» на фоне --warn-soft')
                else: fail(f'кадры «Монет» ({th}): строка «нет цены» под таблицей', str(npn))
                shot(pg, f'coins3-{th}')
                # часть 4: цены нет только у части монет — плашка с перечнем тикеров остаётся, «нет цены» — один раз в ячейке и один в плашке
                cnt = pg.evaluate("(document.getElementById('v-coins').innerText.match(/нет цены/gi)||[]).length")
                ok(f'цены нет у части монет ({th}): «нет цены» на экране {cnt} раза (ячейка HMSTR и плашка)') if cnt == 2 else fail(f'цены нет у части ({th}): число «нет цены»', str(cnt))
                shot(pg, f'coins4-noprice-part-{th}')
                # часть 3: «Прибыль» сортирует по тому, что видно в ячейке, — за выбранный период (24ч), а не за всё время.
                # За 24ч: BTC +$32,51, DOGE +$9,52, SOL −$25,65, ETH −$47,08; за всё время порядок другой (DOGE, BTC, ETH, SOL). Без цены — в конце.
                pg.click('#coinList .thead [data-sortcol="v"]'); pg.wait_for_timeout(250)
                o1 = (pg.evaluate("P.sort"), list(coin_state(pg)['rows']), cnorm(pg.evaluate("document.querySelector('#coinList .thead [data-sortcol=v]').textContent")))
                if o1 == ('pnl', ['BTC', 'DOGE', 'SOL', 'ETH', 'HMSTR'], 'Прибыль▾'): ok(f'кадры «Монет» ({th}): «Прибыль ▾» — по прибыли за 24ч, как в ячейке: BTC, DOGE, SOL, ETH, без цены в конце')
                else: fail(f'кадры «Монет» ({th}): «Прибыль ▾» за период', str(o1))
                shot(pg, f'coins3-profit-desc-{th}')
                pg.click('#coinList .thead [data-sortcol="v"]'); pg.wait_for_timeout(250)
                o2 = (pg.evaluate("P.sort"), list(coin_state(pg)['rows']), cnorm(pg.evaluate("document.querySelector('#coinList .thead [data-sortcol=v]').textContent")))
                if o2 == ('pnlUp', ['ETH', 'SOL', 'DOGE', 'BTC', 'HMSTR'], 'Прибыль▴'): ok(f'кадры «Монет» ({th}): «Прибыль ▴» — обратно: ETH, SOL, DOGE, BTC, без цены всё равно в конце')
                else: fail(f'кадры «Монет» ({th}): «Прибыль ▴»', str(o2))
                shot(pg, f'coins3-profit-asc-{th}')
                pg.click('#coinList .thead [data-sortcol="v"]'); pg.wait_for_timeout(250)
                if pg.evaluate("P.sort") == 'value': ok(f'кадры «Монет» ({th}): третье нажатие — снова «Портфель ▾»')
                else: fail(f'кадры «Монет» ({th}): возврат к сортировке по стоимости', pg.evaluate("P.sort"))
                if st['lbl'] == 'Активы · 5' and st['tot'].startswith('$5 000 · за 24ч'): ok(f'кадры «Монет» ({th}): итог «{st["lbl"]}» · «{st["tot"]}»')
                else: fail(f'кадры «Монет» ({th}): итог', f'{st["lbl"]!r} | {st["tot"]!r}')
                fits = pg.evaluate('''()=>{const L=document.getElementById('coinList').getBoundingClientRect();return [...document.querySelectorAll('#coinList .thead [data-sortcol], #coinList .row .b, #coinList .row .s, #coinsTot, #coinsLbl')].every(x=>{const r=x.getBoundingClientRect();return x.scrollWidth<=x.clientWidth+1&&r.left>=L.left-1&&r.right<=L.right+1||x.id==='coinsTot'||x.id==='coinsLbl'})&&document.documentElement.scrollWidth<=390}''')
                ok(f'кадры «Монет» ({th}): подписи и цифры не обрезаны, без сдвига вбок') if fits else fail(f'кадры «Монет» ({th}): обрезанный текст', 'есть многоточие или выход за таблицу')
                shot(pg, f'stage1-list-{th}')
                pg.click('#coinRanges [data-per="all"]'); pg.wait_for_timeout(400)
                st = coin_state(pg); s_ = st['rows'].get('SOL')
                if s_ and s_['p'][1] == '-20,0%' and s_['v'] == ['$600', '-$150'] and st['tot'].endswith('всего +$50'): ok(f'кадры «Монет» ({th}): «Всё» — SOL −20,0% / −$150 к покупке, всего +$50')
                else: fail(f'кадры «Монет» ({th}): минус к покупке', f'{s_} {st["tot"]}')
                shot(pg, f'stage1-minus-{th}')
                pg.click('#coinRanges [data-per="24h"]'); pg.wait_for_timeout(300)
                pg.fill('#coinSearch', 'HMSTR'); pg.wait_for_timeout(300); shot(pg, f'stage1-noprice-{th}'); shot(pg, f'coins3-noprice-{th}')
                tt = cnorm(pg.inner_text('#coinsTot'))
                ok(f'кадры «Монет» ({th}): в поиске только монета без цены — итог «—», а не «$0»') if tt == '—' else fail(f'кадры «Монет» ({th}): итог без цены', repr(tt))
                pg.fill('#coinSearch', 'DOGE'); pg.wait_for_timeout(300); shot(pg, f'stage1-doge-{th}')
                pg.fill('#coinSearch', ''); pg.wait_for_timeout(200)
            scenario(f'Монеты: кадры для Веры ({th})', {'session': True, 'docs': SHOW}, s_coins_show, prices=False, theme=th, extra=show_prices)
            # часть 4 (поправка Веры): нет цен ни у одной монеты — «нет цены» только в колонке «Цена», остальное «—» (--mute),
            # в итоге «—», под таблицей одна общая плашка без перечня тикеров
            def s_coins_noall(pg, n, th=th):
                wait_app(pg); pg.wait_for_timeout(1500)
                pg.evaluate("document.querySelector('nav.tabs [data-tab=\"coins\"]').click()"); pg.wait_for_timeout(700)
                rw = coin_state(pg)['rows']
                if len(rw) == 5 and all(r['p'] == ['нет цены', '—'] and r['v'] == ['—', '—'] for r in rw.values()):
                    ok(f'нет цен ни у одной монеты ({th}): «нет цены» только в колонке «Цена», в остальных ячейках «—»')
                else: fail(f'нет цен ни у одной монеты ({th}): ячейки', str(rw)[:400])
                cnt = pg.evaluate("(document.getElementById('v-coins').innerText.match(/нет цены/gi)||[]).length")
                ok(f'нет цен ни у одной монеты ({th}): «нет цены» на экране {cnt} раз — не больше числа монет (5)') if 0 < cnt <= 5 else fail(f'нет цен ({th}): «нет цены» слишком часто', str(cnt))
                col = pg.evaluate("[getComputedStyle(document.querySelector('#coinList .row .c3 .b')).color,getComputedStyle(document.querySelector('.ctab .s.q')).color,getComputedStyle(document.querySelector('#coinsTot b')).color,document.querySelector('#coinsTot b').textContent]")
                ok(f'нет цен ни у одной монеты ({th}): в ячейках и в итоге «—» приглушённым цветом --mute') if col[0] == col[1] == col[2] and col[3] == '—' else fail(f'нет цен ({th}): цвет и текст итога', str(col))
                lbl = cnorm(pg.inner_text('#coinsLbl'))
                ok(f'нет цен ни у одной монеты ({th}): «{lbl}»') if lbl == 'Активы · 5' else fail(f'нет цен ({th}): подпись итога', repr(lbl))
                npn = pg.evaluate("(()=>{const e=document.getElementById('npNote');return e&&!e.hidden?[e.textContent,getComputedStyle(e).backgroundColor]:null})()")
                if npn and cnorm(npn[0]) == 'Цен пока нет — проверьте связь. Количества сохранены, итог появится, когда цены придут.' and npn[1] != 'rgba(0, 0, 0, 0)':
                    ok(f'нет цен ни у одной монеты ({th}): под таблицей одна общая плашка «Цен пока нет — проверьте связь…», без тикеров')
                else: fail(f'нет цен ни у одной монеты ({th}): общая плашка', str(npn))
                fits = pg.evaluate("document.documentElement.scrollWidth<=390")
                ok(f'нет цен ни у одной монеты ({th}): без сдвига вбок на 390 px') if fits else fail(f'нет цен ({th}): сдвиг вбок', 'scrollWidth > 390')
                shot(pg, f'coins3-noprice-all-{th}'); shot(pg, f'coins4-noprice-all-{th}')
            scenario(f'Монеты: нет ни одной цены ({th})', {'session': True, 'docs': SHOW}, s_coins_noall, prices=False, theme=th)
            def s_coins_empty(pg, n, th=th):
                wait_app(pg)
                pg.evaluate("document.querySelector('nav.tabs [data-tab=\"coins\"]').click()"); pg.wait_for_timeout(700)
                lbl, txt = cnorm(pg.inner_text('#coinsLbl')), pg.inner_text('#coinList')
                if lbl == 'Активы' and 'Монет пока нет' in txt and pg.locator('#coinRanges').is_hidden(): ok(f'пустая вкладка «Монеты» ({th}): «Активы» без счётчика, подсказка, переключатель периода скрыт')
                else: fail(f'пустая вкладка «Монеты» ({th})', f'{lbl!r} | {txt[:80]!r}')
                shot(pg, f'stage1-empty-{th}')
            scenario(f'Монеты: пустая вкладка ({th})', {'session': True, 'docs': [SEED[0]]}, s_coins_empty, theme=th)

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

        # --- Г3. Голосовой помощник «Орион»: одна сфера рядом с суммой, кнопка ≥ 48 px, цвет по настроению, знакомство по имени,
        #     сводка и доклады о событиях субтитрами (в тестовом браузере русского голоса нет — Орион говорит субтитрами)
        MS = """()=>{const h=document.getElementById('mascot'),b=h&&h.querySelector('.ms-hit'),r=b&&b.getBoundingClientRect(),d=window.Mascot&&Mascot.debug&&Mascot.debug.state();
            return {cv:h?h.querySelectorAll('canvas').length:-1,mscv:document.querySelectorAll('.ms-cv').length,live:!!(h&&h.classList.contains('ms-live')),
              hit:r?[Math.round(r.width),Math.round(r.height)]:null,label:b?b.getAttribute('aria-label'):'',three:!!window.THREE,d:d,
              ink:(()=>{const c=h&&h.querySelector('.ms-cv');if(!c)return 0;const x=c.getContext('2d').getImageData(c.width/2-4,c.height/2-4,8,8).data;let a=0;for(let i=3;i<x.length;i+=4)a+=x[i];return a})()}}"""
        def s_mascot(pg, n):
            wait_app(pg)
            try: pg.wait_for_function("()=>{const h=document.getElementById('mascot');return h&&h.classList.contains('ms-live')}", polling=250, timeout=25000)
            except Exception: raise AssertionError('Орион не ожил за 25 с (нет класса ms-live)')
            pg.wait_for_timeout(3200)
            a = pg.evaluate(MS)
            if a['cv'] == 1 and a['mscv'] == 1 and a['ink'] > 0 and not a['three']: ok('Орион: одна сфера на главной, нарисована, three.js не грузится')
            else: fail('Орион на главной', str(a))
            if a['hit'] and min(a['hit']) >= 48 and 'Орион' in a['label']: ok(f"Орион: кнопка {a['hit'][0]}×{a['hit'][1]} с подписью для скринридера")
            else: fail('Орион: кнопка', str(a))
            pg.evaluate("Mascot.debug.mood('rocket')"); pg.wait_for_timeout(2500); up = pg.evaluate("Mascot.debug.state()")
            pg.evaluate("Mascot.debug.mood('down')"); pg.wait_for_timeout(2500); dn = pg.evaluate("Mascot.debug.state()")
            if up['mood'] == 'rocket' and up['pal'][1] > up['pal'][0] and dn['mood'] == 'down' and dn['pal'][0] > dn['pal'][2]: ok('Орион: цвет меняется по настроению (прибыль — зелёный, просадка — янтарный)')
            else: fail('Орион: цвет по настроению', f'{up} | {dn}')
            pg.evaluate("Mascot.debug.mood('calm')"); pg.evaluate("document.querySelector('.or-cap').click()"); pg.wait_for_timeout(300)
            # первое нажатие без имени — шторка «Как к вам обращаться?»; имя хранится только на телефоне
            pg.click('#mascot .ms-hit'); pg.wait_for_timeout(700)
            if pg.evaluate("document.getElementById('xSheet').classList.contains('open')") and pg.locator('#xName').count(): ok('Орион: первое нажатие — шторка «Как к вам обращаться?»')
            else: fail('Орион: шторка имени', pg.inner_text('#xTitle'))
            pg.fill('#xName', 'Андрей'); pg.click('[data-x="namesave"]'); pg.wait_for_timeout(1200)
            st = pg.evaluate("Mascot.debug.state()")
            if st['name'] == 'Андрей' and 'Андрей' in st['said'] and st['cap'] and pg.evaluate("JSON.parse(localStorage.getItem('cp-prefs2')).name") == 'Андрей': ok('Орион: знакомится по имени, субтитры видны, имя — в настройках телефона')
            else: fail('Орион: знакомство', str(st))
            for th in ['dark', 'light']:
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(400)
                shot(pg, f'15-mascot-home-{th}')
            pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
            pg.click('#mascot .ms-hit'); pg.wait_for_timeout(300)
            if not pg.evaluate("Mascot.debug.state().talking"): ok('Орион: нажатие во время речи — тишина')
            else: fail('Орион: остановка речи', str(pg.evaluate("Mascot.debug.state()")))
            pg.click('#mascot .ms-hit'); pg.wait_for_timeout(600)
            said = pg.evaluate("Mascot.debug.state().said").replace('\u00a0', ' ')
            if said.startswith('Добр') and 'Андрей' in said and 'Портфель' in said and 'Биткоин' in said: ok('Орион: сводка — приветствие по имени, портфель, биткоин')
            else: fail('Орион: сводка', said)
            if not any(w in said for w in ['купи', 'продай', 'советую']): ok('Орион: в сводке нет советов купить или продать')
            else: fail('Орион: советы в сводке', said)
            pg.evaluate("document.querySelector('.or-cap').click()"); pg.wait_for_timeout(200)
            pg.evaluate("Mascot.debug.event('coinMove',{sym:'SOL',neg:true,ch:-12.4})")
            ev = pg.evaluate("Mascot.debug.state().said")
            if ev.startswith('SOL за сутки минус 12 процентов'): ok('Орион: доклад о сильном движении монеты')
            else: fail('Орион: доклад о монете', ev)
            pg.evaluate("document.querySelector('.or-cap').click()")
            # вопросы голосом (зажать сферу): ответы по данным человека
            R = lambda q: pg.evaluate("q=>Mascot.debug.reply(q)", q).replace('\u00a0', ' ')
            a1, a2, a3 = R('сколько у меня биткоина'), R('сколько стоит эфир'), R('абракадабра')
            if a1.startswith('У вас ') and 'биткоина' in a1 and a2.startswith('Эфир — ') and 'не понял' in a3: ok('Орион: отвечает на вопросы — сколько монеты у меня, цена монеты, непонятное — с подсказкой')
            else: fail('Орион: ответы на вопросы', f'{a1} | {a2} | {a3}')
            a4 = R('сообщи когда эфир будет 5000')
            al = pg.evaluate("(()=>{const k=Object.keys(localStorage).find(k=>k.startsWith('ml-x:'));return k?(JSON.parse(localStorage.getItem(k)).alerts||[]):[]})()")
            if a4.startswith('Готово') and any(x['sym'] == 'ETH' and x['price'] == 5000 and x['dir'] == 'up' for x in al): ok('Орион: «сообщи, когда эфир будет 5000» — оповещение поставлено')
            else: fail('Орион: оповещение голосом', f'{a4} | {al}')
            # оповещение срабатывает один раз и снимается
            pg.evaluate("(()=>{const k=Object.keys(localStorage).find(k=>k.startsWith('ml-x:'));const o=JSON.parse(localStorage.getItem(k));o.alerts=[{id:'t1',sym:'ETH',price:99999,dir:'down',at:Date.now()}];localStorage.setItem(k,JSON.stringify(o));MLX.alertsCheck(derive())})()")
            pg.wait_for_timeout(300)
            left = pg.evaluate("(()=>{const k=Object.keys(localStorage).find(k=>k.startsWith('ml-x:'));return JSON.parse(localStorage.getItem(k)).alerts.length})()")
            tt = pg.inner_text('#toastMsg') if pg.locator('#toast.show').count() else ''
            if left == 0 and 'оповещение сработало' in tt: ok('оповещение о цене: сработало, показан тост, оповещение снято')
            else: fail('оповещение о цене: срабатывание', f'осталось {left}, тост «{tt}»')
            sk = pg.evaluate("MLX.streak()")
            if isinstance(sk.get('n'), int) and 'thisMonth' in sk: ok(f"серия дисциплины считается ({sk['n']} мес.)")
            else: fail('серия дисциплины', str(sk))
            # карточка монеты: кнопка «Оповещение о цене» открывает шторку с полем цены
            pg.evaluate("openCoin('BTC')"); pg.wait_for_timeout(900); pg.click('#cvAlert'); pg.wait_for_timeout(700)
            if pg.locator('#xSheet.open #alIn').count() and 'BTC' in pg.inner_text('#xTitle'): ok('карточка монеты: «Оповещение о цене» — шторка с полем цены')
            else: fail('карточка монеты: оповещение', pg.inner_text('#xTitle'))
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(300)
            # живой голос (ElevenLabs через функцию orion-voice) — имитация функции: звук, обработка, память; ошибка → голос телефона
            tone = (ROOT / 'tests' / 'orion-tone.wav').read_bytes(); calls = []
            def fn(route):
                calls.append(1)
                if len(calls) == 1: route.fulfill(status=200, headers={'content-type': 'audio/wav', 'access-control-allow-origin': '*'}, body=tone)
                else: route.fulfill(status=503, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body='{"error":"not_configured"}')
            pg.route('**/functions/v1/orion-voice', fn)
            pg.mouse.click(5, 5); pg.evaluate("Mascot.debug.premium(true)")
            pg.evaluate("Mascot.debug.say('Проверка живого голоса.')"); pg.wait_for_timeout(1200)
            v1 = pg.evaluate("Mascot.debug.state()")
            if v1['engine'] == 'premium' and v1['talking'] and v1['lvl'] > 0.3: ok('Орион: живой голос — звук через обработку, сфера в такт громкости')
            else: fail('Орион: живой голос', str(v1))
            pg.wait_for_timeout(2600)
            pg.evaluate("Mascot.debug.say('Другая фраза.')"); pg.wait_for_timeout(900)
            v2 = pg.evaluate("Mascot.debug.state()")
            if v2['engine'] == 'phone' and v2['err'] == 'not_configured' and v2['cap']: ok('Орион: функция голоса недоступна — говорит голосом телефона, субтитры на месте')
            else: fail('Орион: запасной голос', str(v2))
            pg.evaluate("document.querySelector('.or-cap').click()"); pg.unroute('**/functions/v1/orion-voice')
            # «мозг»: вопрос → функция orion-ask (имитация). Уходят вопрос, тикер, начало разговора и портфель только долями; ответ звучит
            asks = []
            def fa(route):
                asks.append(json.loads(route.request.post_data or '{}'))
                if len(asks) <= 2: route.fulfill(status=200, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body=json.dumps({'text': 'Биткоин за сутки плюс 3%. По новостям, рынок реагирует на приток денег в биржевые фонды, пишет Cointelegraph.' if len(asks) == 1 else 'Эфир идёт следом за биткоином, отдельной новости нет.', 'sources': ['Cointelegraph']}))
                else: route.fulfill(status=429, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body='{"error":"day_limit"}')
            pg.route('**/functions/v1/orion-ask', fa)
            pg.evaluate("Mascot.debug.ask('Почему биткоин растёт?')"); pg.wait_for_timeout(1500)
            cap = pg.evaluate("(document.querySelector('.or-cap')||{}).textContent||''")
            b1 = asks[0] if asks else {}
            ctx = b1.get('ctx') or {}
            flat = json.dumps(ctx)
            no_sums = set(b1) <= {'q', 'sym', 'hist', 'ctx'} and all(0 < v <= 100 for v in (ctx.get('shares') or {}).values()) and 'total' not in flat and '@' not in flat
            if b1.get('sym') == 'BTC' and 'растёт' in b1.get('q', '') and ctx.get('shares') and no_sums and 'Cointelegraph' in cap: ok('Орион: «почему биткоин растёт» — ответ «мозга»; портфель уходит только долями в %, без сумм')
            else: fail('Орион: вопрос «мозгу»', str(b1) + ' | ' + cap)
            pg.evaluate("document.querySelector('.or-cap') && document.querySelector('.or-cap').click()")
            pg.evaluate("Mascot.debug.ask('А эфир?')"); pg.wait_for_timeout(1200)
            h2 = (asks[1].get('hist') if len(asks) > 1 else None) or []
            if h2 and 'биткоин' in h2[-1]['q'].lower() and 'Cointelegraph' in h2[-1]['a']: ok('Орион: помнит начало разговора — «а эфир?» уходит вместе с прошлым вопросом и ответом')
            else: fail('Орион: память разговора', str(h2))
            pg.evaluate("document.querySelector('.or-cap') && document.querySelector('.or-cap').click()")
            pg.evaluate("Mascot.debug.ask('Что такое халвинг?')"); pg.wait_for_timeout(1200)
            cap = pg.evaluate("(document.querySelector('.or-cap')||{}).textContent||''")
            if len(asks) == 3 and 'закончились' in cap: ok('Орион: общий вопрос идёт «мозгу»; лимит — понятная фраза')
            else: fail('Орион: лимит вопросов', str(len(asks)) + ' ' + cap)
            pg.evaluate("document.querySelector('.or-cap') && document.querySelector('.or-cap').click()")
            pg.evaluate("Mascot.debug.ask('сколько у меня биткоина')"); pg.wait_for_timeout(800)
            cap = pg.evaluate("(document.querySelector('.or-cap')||{}).textContent||''")
            if len(asks) == 3 and 'У вас' in cap: ok('Орион: вопросы о своём портфеле отвечаются на телефоне, без сервера')
            else: fail('Орион: портфель без сервера', str(len(asks)) + ' ' + cap)
            pg.evaluate("document.querySelector('.or-cap') && document.querySelector('.or-cap').click()"); pg.unroute('**/functions/v1/orion-ask')
        scenario('Орион', {'session': True, 'docs': SEED}, s_mascot)

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

        # --- Г2. «Бюджет DCA» (жалоба владельца 06.11): копейка перерасхода от округления не показывается как «−$0,01»,
        #     а настоящий перерасход (−$12,00) виден как есть. Расчёт D.dcaBudget не меняется — только показ.
        def dca_seed(spent):
            return [
                {'col': 'app', 'id': 'settings', 'data': {'onboardedAt': NOW, 'split': {'btc': 50, 'eth': 30, 'alt': 20}, 'monthlyUsd': 300, 'currency': 'USD'}},
                {'col': 'tx', 'id': 'd1', 'data': {'ts': '2026-08-01T10:00:00.000Z', 'type': 'deposit', 'usd': 1000, 'uah': 41500, 'dcaUsd': 300, 'reserveUsd': 700}},
                {'col': 'tx', 'id': 'd2', 'data': {'ts': '2026-08-02T10:00:00.000Z', 'type': 'dca', 'symbol': 'BTC', 'qty': 0.00150005, 'usd': spent[0], 'price': 100000}},
                {'col': 'tx', 'id': 'd3', 'data': {'ts': '2026-08-02T10:05:00.000Z', 'type': 'dca', 'symbol': 'ETH', 'qty': 0.05, 'usd': spent[1], 'price': 3000}},
            ]
        def dnorm(t): return t.replace('\u202f', ' ').replace('\xa0', ' ').replace('\u2212', '-')
        def dca_read(pg):
            wait_app(pg)
            pg.wait_for_function("()=>document.getElementById('tDcaS').textContent.length>0", polling=250, timeout=10000)
            pg.wait_for_timeout(1000)   # countTo доигрывает анимацию
            return (dnorm(pg.inner_text('#tDca')), dnorm(pg.inner_text('#tDcaS')), dnorm(pg.evaluate("resInfo(derive()).dv")), pg.evaluate("derive().dcaBudget"))
        for th in ('dark', 'light'):
            def s_dca_cent(pg, n, th=th):
                v, sub, dv, raw = dca_read(pg)
                if raw < 0 and abs(raw) < 0.02: ok(f'DCA-копейка ({th}): расчёт не тронут, остаток {raw:.4f}')
                else: fail(f'DCA-копейка ({th}): расчёт', f'dcaBudget={raw}')
                if v == '$0,00' and 'всё куплено' in sub: ok(f'DCA-копейка ({th}): плитка «{v} · {sub}» без минуса')
                else: fail(f'DCA-копейка ({th}): плитка', f'«{v}» · «{sub}»')
                ok(f'DCA-копейка ({th}): в «Резерв и DCA» тоже {dv}') if dv == '$0,00' else fail(f'DCA-копейка ({th}): resInfo', dv)
                tile = pg.locator('#tDca').locator('xpath=ancestor::div[contains(@class,"tile")][1]/..')
                tile.scroll_into_view_if_needed(); pg.wait_for_timeout(300)
                tile.screenshot(path=str(OUT / f'dca-cent-{th}.png'))
            scenario(f'Бюджет DCA: копейка округления ({th})', {'session': True, 'docs': dca_seed([150.01, 150])}, s_dca_cent, theme=th)
        def s_dca_over(pg, n):
            v, sub, dv, raw = dca_read(pg)
            if v == '-$12,00' and dv == '-$12,00' and 'всё куплено' in sub: ok(f'DCA-перерасход: виден как есть «{v}» (и в «Резерв и DCA»)')
            else: fail('DCA-перерасход: показ', f'плитка «{v}» · «{sub}», resInfo «{dv}», расчёт {raw}')
        scenario('Бюджет DCA: настоящий перерасход', {'session': True, 'docs': dca_seed([162, 150])}, s_dca_over)

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

        # --- И. «14 дней с MoneyLife» (спецификация Льва 08.11): карточка дня на главной, прогресс только в localStorage
        D14K = "'ml-14d:'+window.mlUser.id"
        def d14(pg):
            return pg.evaluate("()=>{const e=document.getElementById('d14');return {vis:!e.hidden&&e.getBoundingClientRect().height>0,mode:e.dataset.mode||'',n:+(e.dataset.n||0),txt:e.innerText.replace(/\\s+/g,' ').trim()}}")
        def d14_wait(pg, mode, n=None, t=6000):
            pg.wait_for_function("([m,n])=>{const e=document.getElementById('d14');return e&&e.dataset.mode===m&&(n==null||+e.dataset.n===n)}", arg=[mode, n], polling=200, timeout=t)
        def d14_tick(pg):   # «вернулся в приложение»: как visibilitychange → visible
            pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_timeout(200)
        def d14_rows(pg):
            return pg.evaluate("JSON.stringify([...window.__mlRows.entries()].sort())")
        BAD = re.compile(r'купи\b|пора\b|вырастет|доход|подряд|серия|не пропусти', re.I)

        # И1. чистая функция дня: подставленные даты, без браузерных часов
        def s_d14_pure(pg, n):
            wait_app(pg)
            r = pg.evaluate("""()=>{const V=d14View,R=d14Read,out={};
              let v=V(null,'2026-11-10',true);out.first=[v.mode,v.st.n,v.st.start];
              let st=R(v.st,'2026-11-10');out.same=V(st,'2026-11-10',true).mode;
              v=V(st,'2026-11-11',true);out.next=[v.mode,v.st.n];
              st=R(v.st,'2026-11-11');v=V(st,'2026-11-14',true);out.skip=[v.mode,v.st.n];   /* пропуск 3 дней → 3, не 5 */
              out.back=V(st,'2026-11-09',true).mode;                                          /* часы назад: ничего не меняем */
              v=V(st,'2026-11-21',true);out.fwd=[v.mode,v.st.n];                              /* вперёд на 10 дней: только одна */
              out.unread=V({v:1,n:4,read:false,last:'2026-11-01',start:'2026-10-28'},'2026-11-30',true).st.n;
              out.old=V(null,'2026-11-10',false).mode;out.oldHid=V({v:1,hid:true},'2026-11-10',false).mode;
              let s14=R({v:1,n:14,read:false,last:'2026-11-22',start:'2026-11-09'},'2026-11-23');
              out.d14=[s14.done,V(s14,'2026-11-23',true).mode,V(s14,'2026-11-24',true).mode,V(s14,'2026-12-30',true).mode];
              out.junk=[V('мусор','2026-11-10',true).st.n,V({v:1,n:99,read:'да'},'2026-11-10',true).st.n,V({v:2,n:5},'2026-11-10',true).st.n];
              out.twice=R(R({v:1,n:2,read:false},'2026-11-10'),'2026-11-10').n;
              return out;}""")
            exp = {'first': ['card', 1, '2026-11-10'], 'same': 'read', 'next': ['card', 2], 'skip': ['card', 3], 'back': 'read', 'fwd': ['card', 3],
                   'unread': 4, 'old': 'invite', 'oldHid': 'off', 'd14': [True, 'done', 'gone', 'gone'], 'junk': [1, 1, 1], 'twice': 2}
            for k, e in exp.items():
                ok(f'14 дней, логика: {k} = {e}') if r[k] == e else fail(f'14 дней, логика: {k}', f'{r[k]} вместо {e}')
            # местный день — по часам телефона, не по UTC; переход на зимнее время 25.10 не даёт двух дней
            dd = pg.evaluate("['2026-11-10T21:59:59Z','2026-11-10T22:00:01Z','2026-10-24T21:30:00Z','2026-10-25T21:59:00Z','2026-10-25T22:00:30Z'].map(t=>isoDay(new Date(t)))")
            if dd == ['2026-11-10', '2026-11-11', '2026-10-25', '2026-10-25', '2026-10-26']: ok('14 дней: день по местной полуночи Киева (UTC+2), 25.10 при смене времени — один день')
            else: fail('14 дней: местный день Киева', str(dd))
        scenario('14 дней: логика дня', {'session': True, 'docs': SEED}, s_d14_pure)

        def s_d14_tz(pg, n):
            wait_app(pg)
            dd = pg.evaluate("['2026-11-11T04:30:00Z','2026-11-11T05:00:30Z'].map(t=>isoDay(new Date(t)))")
            if dd == ['2026-11-10', '2026-11-11']: ok('14 дней: телефон в UTC−5 — день меняется в местную полночь, не в киевскую')
            else: fail('14 дней: UTC−5', str(dd))
            pg.evaluate(f"localStorage.setItem({D14K},JSON.stringify({{v:1,n:1,read:true,last:'2026-11-10',start:'2026-11-10',done:false,hid:false}}));renderD14()")
            d14_wait(pg, 'read', 1)
            ok('14 дней, UTC−5: в 23:30 местного (06:30 по Киеву) новая карточка ещё не открыта')
            pg.clock.set_system_time('2026-11-11T05:00:30Z'); d14_tick(pg)
            d14_wait(pg, 'card', 2); ok('14 дней, UTC−5: в 00:00:30 местного — карточка 2')
        scenario('14 дней: часовой пояс UTC−5', {'session': True, 'docs': SEED}, s_d14_tz, tz='America/New_York', clock='2026-11-11T04:30:00Z')

        # И2. новичок: карточка 1 → «Понятно» → свёрнута до завтра → полночь → карточка 2 → пропуск → 3, Слиток на 3/14
        def s_d14_new(pg, n):
            wait_app(pg)
            d14_wait(pg, 'card', 1)
            st = d14(pg)
            if 'День 1 из 14' in st['txt'] and 'Первая запись' in st['txt']: ok('14 дней: новичок видит «День 1 из 14 · Первая запись»')
            else: fail('14 дней: карточка 1', st['txt'][:160])
            box = pg.evaluate("(()=>{const r=document.getElementById('d14').getBoundingClientRect(),s=document.getElementById('signal').getBoundingClientRect(),g=document.getElementById('gChart').getBoundingClientRect();return {top:r.top,bottom:r.bottom,afterSignal:r.top>=s.bottom-1,afterChart:r.top>=g.bottom}})()")
            if box['afterSignal'] and box['afterChart']: ok('14 дней: карточка — после графика и сигнала')
            else: fail('14 дней: место карточки', str(box))
            small = pg.evaluate("[...document.querySelectorAll('#d14 button')].map(b=>{const r=b.getBoundingClientRect();return [b.innerText||b.getAttribute('aria-label'),Math.round(r.height),Math.round(r.width)]}).filter(x=>x[1]<48||x[2]<48)")
            ok('14 дней: все кнопки карточки ≥ 48 px') if not small else fail('14 дней: кнопки < 48 px', str(small))
            for th in ('dark', 'light'):
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(250)
                pg.locator('#d14').screenshot(path=str(OUT / f'14d-{th}.png'))
                pg.screenshot(path=str(OUT / f'14d-home-{th}.png'))
            pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
            rows0 = d14_rows(pg)
            # открыл и не нажал — день не засчитан
            pg.reload(wait_until='load'); wait_app(pg); d14_wait(pg, 'card', 1)
            pg.clock.set_system_time('2026-11-11T21:59:30Z'); d14_tick(pg); d14_wait(pg, 'card', 1)
            ok('14 дней: открыл и закрыл без нажатия — на следующий день всё ещё карточка 1')
            pg.click('#d14 [data-d14="ok"]'); d14_wait(pg, 'read', 1)
            st = d14(pg)
            if 'День 1 из 14 · завтра — день 2' in ' '.join(st['txt'].split()): ok('14 дней: «Понятно» в 23:59:30 → «День 1 из 14 · завтра — день 2»')
            else: fail('14 дней: свёрнутая', st['txt'])
            for th in ('dark', 'light'):
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(200)
                pg.locator('#d14').screenshot(path=str(OUT / f'14d-read-{th}.png'))
            pg.reload(wait_until='load'); wait_app(pg); d14_wait(pg, 'read', 1)
            ok('14 дней: перезапуск в тот же день — новая карточка не появилась')
            pg.clock.set_system_time('2026-11-11T21:59:59Z'); d14_tick(pg)
            ok('14 дней: 23:59:59 — ещё свёрнута') if d14(pg)['mode'] == 'read' else fail('14 дней: 23:59:59', d14(pg)['mode'])
            pg.clock.set_system_time('2026-11-11T22:00:30Z'); d14_tick(pg); d14_wait(pg, 'card', 2)
            ok('14 дней: 00:00:30 после возврата в приложение — карточка 2')
            if 'Твои доли: 50/30/20' in d14(pg)['txt']: ok('14 дней: карточка 2 — доли из настроек человека')
            else: fail('14 дней: карточка 2', d14(pg)['txt'][:120])
            pg.click('#d14 [data-d14="go"]'); pg.wait_for_timeout(600)
            if pg.evaluate("(()=>{const r=document.getElementById('alloc').getBoundingClientRect();return r.top<innerHeight&&r.bottom>0})()"): ok('14 дней: «Показать» прокручивает к «Распределению»')
            else: fail('14 дней: «Показать»', 'блок «Распределение» не на экране')
            if d14(pg)['mode'] == 'read': ok('14 дней: кнопка-действие тоже засчитывает день')
            else: fail('14 дней: кнопка-действие', d14(pg)['mode'])
            pg.evaluate('window.scrollTo(0,0)')
            # пропуск 3 дней → карточка 3, не 5; Слиток празднует 3/14 один раз
            pg.clock.set_system_time('2026-11-15T09:00:00Z'); d14_tick(pg); d14_wait(pg, 'card', 3)
            ok('14 дней: пропуск 3 дней → карточка 3, а не 5')
            pg.evaluate("window.__msEv=[];(function w(){if(window.Mascot){const f=window.Mascot.event;window.Mascot.event=(a,b)=>{window.__msEv.push([a,b&&b.label]);try{return f(a,b);}catch(e){}};}else setTimeout(w,100);})()")
            try: pg.wait_for_function("!!window.Mascot", timeout=10000, polling=250)
            except Exception: pass
            pg.wait_for_timeout(300)
            pg.click('#d14 [data-d14="ok"]'); pg.wait_for_timeout(500); d14_tick(pg); pg.wait_for_timeout(300)
            ev = pg.evaluate("window.__msEv")
            if ev == [['milestone', '3/14']]: ok('14 дней: на 3/14 Слиток празднует ровно один раз')
            else: fail('14 дней: Слиток 3/14', str(ev))
            # Слиток выключен → на 7/14 праздника нет
            pg.evaluate(f"P.mascot=false;window.__msEv=[];localStorage.setItem({D14K},JSON.stringify({{v:1,n:7,read:false,last:'2026-11-14',start:'2026-11-10',done:false,hid:false}}));renderD14()")
            d14_wait(pg, 'card', 7); pg.click('#d14 [data-d14="ok"]'); pg.wait_for_timeout(400); d14_tick(pg)
            ev = pg.evaluate(f"[window.__msEv,JSON.parse(localStorage.getItem({D14K})).party||'']")
            ok('14 дней: персонаж выключен — праздника нет и он не ждёт') if ev == [[], ''] else fail('14 дней: Слиток выключен', str(ev))
            pg.evaluate("P.mascot=true")
            # день 14 → «14 из 14 ✓» → на следующий день блока нет
            pg.evaluate(f"localStorage.setItem({D14K},JSON.stringify({{v:1,n:14,read:false,last:'2026-11-14',start:'2026-11-01',done:false,hid:false}}));renderD14()")
            d14_wait(pg, 'card', 14)
            if 'Копия и вид' in d14(pg)['txt']: ok('14 дней: карточка 14 «Копия и вид»')
            else: fail('14 дней: карточка 14', d14(pg)['txt'][:100])
            pg.click('#d14 [data-d14="ok"]'); d14_wait(pg, 'done', 14)
            if '14 из 14 · все карточки пройдены' in ' '.join(d14(pg)['txt'].split()): ok('14 дней: после 14-й — «14 из 14 · все карточки пройдены»')
            else: fail('14 дней: 14 из 14', d14(pg)['txt'])
            pg.clock.set_system_time('2026-11-16T09:00:00Z'); d14_tick(pg); d14_wait(pg, 'gone')
            ok('14 дней: на следующий день после 14-й блока нет') if not d14(pg)['vis'] else fail('14 дней: после 14', 'блок виден')
            if d14_rows(pg) == rows0: ok('14 дней: в базу не записано ничего (документы те же)')
            else: fail('14 дней: база', 'документы изменились от карточки')
            # тексты всех вариантов: без запретных слов, длины по спецификации
            tx = pg.evaluate("""()=>{const o=[],s0=S.settings;for(const lad of [true,false]){S.settings=Object.assign({},s0,{ladder:lad,depositSplit:{dca:lad?50:100}});for(let n=1;n<=14;n++){const c=d14Card(n);o.push([n,lad,c.t,c.x,c.b,c.go]);}}S.settings=s0;return o;}""")
            bad = [f'{t[0]}{"" if t[1] else "S"}: {m.group(0)}' for t in tx for m in [BAD.search(t[2] + ' ' + t[3])] if m]
            ok('14 дней: тексты 28 карточек без «купи/пора/вырастет/доход/подряд»') if not bad else fail('14 дней: запретные слова', ', '.join(bad))
            longt = [f'{t[0]}: {len(t[2])}/{len(t[3])}' for t in tx if len(t[2]) > 30 or len(t[3]) > 130]
            ok('14 дней: заголовки ≤ 30, тексты ≤ 130 знаков') if not longt else fail('14 дней: длина текстов', ', '.join(longt))
            simple = [t[2] for t in tx if not t[1]][2:10]
            if simple[0] == 'Пополнение — в DCA' and simple[2] == 'Суммы под замком' and simple[7] == 'Орион': ok('14 дней: шаблон «Простой» — карточки 3S, 5S–10S')
            else: fail('14 дней: «Простой»', str(simple))
            gos = sorted({t[5] for t in tx if t[5]})
            miss = pg.evaluate("g=>g.filter(k=>typeof D14_GO[k]!=='function')", gos)
            ok(f'14 дней: у всех кнопок есть существующий экран ({len(gos)} действий)') if not miss else fail('14 дней: кнопки без экрана', str(miss))
        scenario('14 дней: новичок', {'session': True, 'docs': SEED}, s_d14_new, clock='2026-11-10T08:00:00Z')

        # И3. давний аккаунт (нет onboardedAt): строка-приглашение, «Скрыть» держится после перезапуска, переключатель возвращает
        OLD = [{'col': 'app', 'id': 'settings', 'data': {'split': {'BTC': 50, 'ETH': 30, 'ALT': 20}, 'capPct': 20}}] + SEED[1:]
        def s_d14_old(pg, n):
            wait_app(pg); d14_wait(pg, 'invite')
            st = d14(pg)
            if 'Новое: 14 карточек' in ' '.join(st['txt'].split()) and 'по одной в день' in st['txt'] and 'Начать' in st['txt'] and 'Скрыть' in st['txt']: ok('14 дней: давний аккаунт видит приглашение «Начать / Скрыть»')
            else: fail('14 дней: приглашение', st['txt'])
            for th in ('dark', 'light'):
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(250)
                pg.locator('#d14').screenshot(path=str(OUT / f'14d-invite-{th}.png'))
            pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
            pg.click('#d14 [data-d14="hide"]'); pg.wait_for_timeout(300)
            ok('14 дней: «Скрыть» убирает приглашение') if not d14(pg)['vis'] else fail('14 дней: «Скрыть»', 'видно')
            pg.reload(wait_until='load'); wait_app(pg); pg.wait_for_timeout(800)
            ok('14 дней: скрыто и после перезапуска') if not d14(pg)['vis'] else fail('14 дней: после перезапуска', 'снова видно')
            pg.click('#setBtn'); pg.wait_for_selector('#setSheet.open', timeout=4000); pg.wait_for_timeout(400)
            if pg.get_attribute('#swD14', 'aria-checked') == 'false': ok('14 дней: в «Настройках» переключатель «Карточка „14 дней“» выключен')
            else: fail('14 дней: переключатель', pg.get_attribute('#swD14', 'aria-checked'))
            pg.click('#swD14'); pg.wait_for_timeout(200); pg.click('#setSheet [data-close]'); pg.wait_for_timeout(500)
            d14_wait(pg, 'invite'); ok('14 дней: переключатель вернул приглашение')
            pg.click('#d14 [data-d14="start"]'); d14_wait(pg, 'card', 1); ok('14 дней: «Начать» → карточка 1')
            pg.click('#d14 [data-d14="go"]'); pg.wait_for_selector('#actSheet.open', timeout=4000)
            ok('14 дней: «Записать покупку» открывает форму покупки') if pg.is_visible('#buyOne') or pg.is_visible('#buyDca') else fail('14 дней: «Записать покупку»', 'нет формы покупки')
            pg.click('#actSheet [data-close]'); pg.wait_for_timeout(400)
            # крестик в карточке — тоже «Скрыть»; номер сохраняется
            pg.clock.set_system_time('2026-11-11T09:00:00Z'); d14_tick(pg); d14_wait(pg, 'card', 2)
            pg.click('#d14 [data-d14="x"]'); pg.wait_for_timeout(300)
            hid = not d14(pg)['vis']
            pg.evaluate("d14Hide(false)"); d14_wait(pg, 'card', 2)
            ok('14 дней: крестик скрывает, возврат — с тем же номером') if hid else fail('14 дней: крестик', 'не скрыл')
            # сломанные данные в ключе — начать сначала (давний: снова приглашение), приложение живо
            pg.evaluate(f"localStorage.setItem({D14K},'{{мусор');renderD14()"); d14_wait(pg, 'invite')
            ok('14 дней: мусор в ключе — начать сначала, без ошибок')
            k = pg.evaluate(D14K)
            ok('14 дней: ключ по аккаунту ' + k) if k == 'ml-14d:test-user-0001' else fail('14 дней: ключ', k)
        scenario('14 дней: давний аккаунт', {'session': True, 'docs': OLD}, s_d14_old, clock='2026-11-10T08:00:00Z')

        # И4. знакомство открыто — карточки нет; после «Пропустить» — карточка 1
        def s_d14_ob(pg, n):
            wait_app(pg)
            pg.wait_for_selector('#ob:not([hidden])', timeout=8000)
            ok('14 дней: пока открыто знакомство — карточки нет') if not d14(pg)['vis'] else fail('14 дней: при знакомстве', 'карточка видна')
            pg.click('#obSkip'); pg.wait_for_selector('#ob', state='hidden', timeout=8000)
            d14_wait(pg, 'card', 1, 8000); ok('14 дней: после знакомства («Пропустить») — карточка 1')
        scenario('14 дней: после знакомства', {'session': True, 'docs': []}, s_d14_ob)

        # --- MoneyLife 3.0 (10.11.2026): знак, «Сегодня» со шкалой, «Из чего итог», личный план и знания, цена покупки вручную,
        #     демо без регистрации, вход без анимаций при «уменьшить движение»
        CYC = {'ath': 126000, 'athDate': '2025-10-06', 'startedAt': '2026-01-01',
               'levels': [{'n': i + 1, 'drop': d, 'pct': p, 'status': 'pending'} for i, (d, p) in enumerate([(30, 20), (40, 25), (50, 33), (60, 50), (70, 100)])]}
        SEED3 = SEED + [{'col': 'app', 'id': 'cycle', 'data': CYC}]
        def s_v3_home(pg, n):
            wait_app(pg); pg.wait_for_timeout(1500)
            r = pg.evaluate("""()=>{const q=s=>document.querySelector(s);
              return {logo:!!q('.mark use[href="#mlLogo"]'),ink:q('#tabInk').classList.contains('on'),today:!q('#xToday').hidden,mk:document.querySelectorAll('#xToday .xs-mk').length,
                cap:(q('#xToday .xs-cap')||{}).innerText||'',plan:!q('#xPlan').hidden&&/Собери личный план/.test(q('#xPlan').innerText),path:!q('#xPath').hidden,learn:!q('#xLearn').hidden}}""")
            ok('3.0: новый знак в шапке, «капля» под активной вкладкой') if r['logo'] and r['ink'] else fail('3.0: знак и капля', str(r))
            if r['today'] and r['mk'] == 6 and '−12,7%' in r['cap'] and 'до ступени 1' in r['cap'] and '−19,8%' in r['cap']: ok('3.0: «Сегодня» — шкала: 5 ступеней и максимум, BTC −12,7%, до ступени 1 −19,8%')
            else: fail('3.0: шкала лестницы', str(r))
            ok('3.0: приглашение в личный план на главной, карточки плана и знаний в «Стратегии»') if r['plan'] and r['path'] and r['learn'] else fail('3.0: карточки плана', str(r))
            shot(pg, 'v3-home')
            pg.click('#hInfo'); pg.wait_for_timeout(800)
            t = pg.evaluate("document.getElementById('xTitle').textContent+' | '+document.getElementById('xBody').innerText")
            if t.startswith('Из чего итог') and all(x in t for x in ('посчитано 2 из 2', 'Резерв USDT — отдельно', 'Вложено в монеты', 'Монеты и резерв вместе')): ok('3.0: «Из чего итог» — монеты, вложено, резерв отдельно')
            else: fail('3.0: из чего итог', t[:300])
            shot(pg, 'v3-total')
        scenario('3.0: главная и итог', {'session': True, 'docs': SEED3}, s_v3_home)

        def s_v3_plan(pg, n):
            wait_app(pg); pg.wait_for_timeout(800)
            pure = pg.evaluate("""()=>{const r=a=>{const x=MLX.planResult({v:1,a:{inc:a[0],cus:a[1],debt:a[2],save:a[3],hor:a[4],drop:a[5],exp:a[6],dep:a[7]}});return [x.stage,x.prof,x.ceil,x.preset.name]};
              return {a:r([0,0,3,0,0,0,0,0]),b:r([1,2,2,1,2,1,1,0]),c:r([2,3,0,2,3,2,2,1]),d:r([2,4,0,3,3,3,3,1]),e:r([2,4,0,3,0,3,3,1]),
                fi:[MLX.fiMonths(1000,2000,0,4),MLX.fiMonths(1000,0,0,4),MLX.fiMonths(12000,0,1000,0)],les:MLX.LESSONS.length,src:MLX.LESSONS.every(l=>l.src&&l.x&&l.t)}}""")
            want = {'a': [0, 'calm', 0, 'Простой'], 'b': [2, 'bal', 5, 'Взвешенный'], 'c': [3, 'bold', 10, 'Как у автора'], 'd': [4, 'bold', 10, 'Как у автора'], 'e': [4, 'calm', 0, 'Простой']}
            ok('3.0: личный план — этап, профиль и потолок крипты для пяти разных людей') if all(pure[k] == v for k, v in want.items()) else fail('3.0: расчёт плана', str(pure))
            ok('3.0: число свободы — срок: уже есть / недостижимо без взносов / 12 месяцев; 18 уроков с источниками') if pure['fi'] == [0, None, 12] and pure['les'] == 18 and pure['src'] else fail('3.0: число свободы и уроки', str(pure))
            pg.evaluate("MLX.openPlan()"); pg.wait_for_timeout(700)
            for a in (1, 2, 2, 1, 2, 1, 1, 0):
                pg.evaluate(f"document.querySelector('#xBody [data-qa=\"{a}\"]').click()"); pg.wait_for_timeout(200)
            pg.wait_for_timeout(900)
            t = pg.inner_text('#xBody')
            st = pg.evaluate("(()=>{const p=JSON.parse(localStorage.getItem('ml-plan:'+mlUser.id)||'null'),c=JSON.stringify(window.__mlCalls||[]);return {saved:!!(p&&p.a&&p.a.cus===2),leak:/\"cus\"|ml-plan/.test(c)}})()")
            if 'Этап 3 из 5' in t and 'Полная подушка' in t and 'до 5%' in t and 'Взвешенный' in t and st['saved'] and not st['leak']: ok('3.0: анкета из 8 вопросов → этап 3, потолок до 5%; ответы только на телефоне, в базу не уходят')
            else: fail('3.0: анкета плана', str(st) + ' ' + t[:200])
            pg.evaluate("document.querySelector('#xBody [data-step]').click()"); pg.wait_for_timeout(1300)
            pg.fill('#fiExp', '800'); pg.fill('#fiSav', '6000'); pg.fill('#fiAdd', '300'); pg.wait_for_timeout(800)
            r = pg.evaluate("""()=>({ck:document.querySelector('#xBody [data-step]').getAttribute('aria-checked'),fi:document.getElementById('fiOut').innerText,
                card:document.getElementById('xPlan').innerText,today:document.getElementById('xToday').innerText})""")
            r = {k: v.replace('\xa0', ' ') for k, v in r.items()}
            if r['ck'] == 'true' and '$316 800' in r['fi'] and '$480 000' in r['fi'] and 'этап 3 из 5' in r['card'] and 'при потолке 5%' in r['today']: ok('3.0: шаг отмечен, число свободы ×33 = $316 800, главная показывает этап и долю крипты выше потолка')
            else: fail('3.0: шаги и число свободы', str(r)[:400])
            shot(pg, 'v3-plan')
            pg.evaluate("document.querySelector('#xBody [data-x=learn]').click()"); pg.wait_for_timeout(600)
            rows = pg.evaluate("document.querySelectorAll('#xBody [data-les]').length")
            pg.evaluate("document.querySelector('#xBody [data-les=spec]').click()"); pg.wait_for_timeout(600)
            t = pg.inner_text('#xBody')
            ok('3.0: «Знания» — 18 уроков, урок открывается с источником из книг') if rows == 18 and 'Источник:' in t and 'Грэхем' in t and 'не инвестиционный совет' in t else fail('3.0: знания', f'{rows} {t[:200]}')
            shot(pg, 'v3-lesson')
        scenario('3.0: личный план и знания', {'session': True, 'docs': SEED3}, s_v3_plan)

        def s_v3_price(pg, n):
            wait_app(pg); pg.wait_for_timeout(600)
            pg.evaluate("openAct('buy');setBuyMode('one')"); pg.wait_for_timeout(700)
            pg.fill('#oSym', 'BTC'); pg.fill('#oUsd', '100'); pg.fill('#oPrice', '100000'); pg.wait_for_timeout(250)
            auto = pg.evaluate("document.getElementById('oQty').value")
            pg.fill('#oQty', '0.0011'); pg.fill('#oPrice', '90000'); pg.wait_for_timeout(250)
            manual = pg.evaluate("document.getElementById('oQty').value")
            ok('3.0: цена покупки вручную → количество считается само; вписанное человеком не затирается') if auto == '0.001' and manual == '0.0011' else fail('3.0: цена покупки', f'{auto} / {manual}')
            shot(pg, 'v3-price')
        scenario('3.0: цена покупки вручную', {'session': True, 'docs': SEED}, s_v3_price)

        def s_v3_demo(pg, n):
            pg.wait_for_selector('#mlaDemo', state='visible', timeout=8000)
            pg.click('#mlaDemo'); wait_app(pg); pg.wait_for_timeout(3500)
            r = pg.evaluate("""()=>({auth:!!document.getElementById('mlAuth'),bar:!!document.getElementById('mlDemoBar'),tx:S.tx.length,syms:derive().syms.join(','),tot:derive().total,del:document.getElementById('delBtn').hidden})""")
            if not r['auth'] and r['bar'] and r['tx'] >= 20 and r['syms'] == 'BTC,ETH,SOL' and r['tot'] > 0 and r['del']: ok('3.0: демо без регистрации — пример портфеля из трёх монет, полоса «Демо», удаление аккаунта скрыто')
            else: fail('3.0: демо', str(r))
            shot(pg, 'v3-demo')
            pg.evaluate("openAct('buy');setBuyMode('one')"); pg.wait_for_timeout(600)
            pg.fill('#oSym', 'BTC'); pg.fill('#oUsd', '100'); pg.fill('#oPrice', '100000'); pg.wait_for_timeout(200)
            pg.evaluate("document.querySelector('#actSheet .sh-foot .btn:not(.ghost)').click()"); pg.wait_for_timeout(1200)
            w = pg.evaluate("""()=>({tx:S.tx.length,calls:JSON.stringify(window.__mlCalls||[]),ls:Object.keys(localStorage).filter(k=>k.startsWith('ml-docs')).length})""")
            if w['tx'] == r['tx'] + 1 and not re.search(r'upsert|doc_merge|delete', w['calls']) and w['ls'] == 0: ok('3.0: демо — запись живёт только в памяти: в базу и на телефон ничего не сохраняется')
            else: fail('3.0: демо, запись', str(w)[:300])
            pg.click('#mlDemoGo'); pg.wait_for_selector('#mlAuth .mla-sub', state='visible', timeout=8000); pg.wait_for_timeout(900)
            sub = pg.inner_text('#mlAuth .mla-sub')
            ok('3.0: демо — «Создать аккаунт» открывает регистрацию, пример стёрт') if sub == 'Новый аккаунт' and pg.evaluate("S.tx.length") == 0 else fail('3.0: демо, выход', sub)
        scenario('3.0: демо без регистрации', {'session': False, 'docs': []}, s_v3_demo)

        def s_v3_auth_calm(pg, n):
            pg.wait_for_selector('#mlaPass', state='visible', timeout=8000)
            a = pg.evaluate("""()=>{const c=document.querySelector('.mla-card');document.querySelector('#mlAuth [data-to=up]').click();
                return {first:c.classList.contains('first'),sub:document.querySelector('#mlAuth .mla-sub').textContent,cur:document.querySelectorAll('.mla-curtain').length,logo:!!document.querySelector('.mla-logo use')}}""")
            ok('3.0: вход при «уменьшить движение» — экран меняется сразу, без шторки; знак на месте') if not a['first'] and a['sub'] == 'Новый аккаунт' and a['cur'] == 0 and a['logo'] else fail('3.0: вход без анимаций', str(a))
        scenario('3.0: вход, уменьшить движение', {'session': False, 'docs': []}, s_v3_auth_calm, motion='reduce')

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

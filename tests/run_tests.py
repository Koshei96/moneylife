#!/usr/bin/env python3
"""Автотесты MoneyLife — запуск: python3 tests/run_tests.py

Что проверяется:
  1. Статика: синтаксис всех JS (файлы и встроенные скрипты index.html), валидность JSON,
     манифест PWA (id, категория, иконки any/maskable, ярлыки), шаблон assetlinks.json,
     что все файлы из списка SHELL в sw.js существуют; страница удаления аккаунта delete.html
     (RU/UK, ссылка из privacy.html) и SQL-функция supabase/delete_my_account.sql; ночной бэкап supabase/backup_docs.sql
     (только добавление, RLS, откат рядом, срок копий 7 дней на privacy.html/delete.html);
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
    backup_sql_checks()
    client_errors_sql_checks()
    signal_checks()
    sw_nav_checks()
    orion_cut_checks()
    orion_tool_cut_checks()

def orion_cut_checks():
    """Н4 (25.11.2026): обрезка ответа Ориона в supabase/functions/orion-ask/index.ts — кусок cut:begin…cut:end запускается в node
    (типы TypeScript убираются): 900 знаков — целиком; 2000 — по концу предложения ≤ 1500; поток кусками — text() ровно то, что ушло."""
    name = 'orion-ask: длинный ответ режется по концу предложения, не посреди слова (и в потоке)'
    try:
        src = (ROOT / 'supabase' / 'functions' / 'orion-ask' / 'index.ts').read_text(encoding='utf-8')
        m = re.search(r'/\* cut:begin \*/(.*?)/\* cut:end \*/', src, re.S)
        if not m: fail(name, 'нет куска cut:begin…cut:end'); return
        code = re.sub(r':\s*(?:string|number|boolean|unknown|Ev|Put|Rd)\b', '', m.group(1))
        js = code + r"""
const w='Биткоин растёт на притоке денег в биржевые фонды, пишет Cointelegraph. ',mk=n=>{let s='';while(s.length<n)s+=w;return s.slice(0,n);};
const a=mk(899).trim()+'.',b=mk(2000),noend='слово '.repeat(400),o={};
o.a=cutText(a)===a;const rb=cutText(b);o.bl=rb.length<=1500&&rb.length>1400;o.be=/Cointelegraph\.$/.test(rb)&&b.indexOf(rb)===0;
const c=streamCut();let sent='';for(let i=0;i<b.length;i+=7)sent+=c.push(b.slice(i,i+7));sent+=c.end();o.s=sent.replace(/\s+/g,' ').trim()===c.text()&&c.text()===rb;
const c2=streamCut();let s2='';for(let i=0;i<a.length;i+=5)s2+=c2.push(a.slice(i,i+5));s2+=c2.end();o.s2=s2===a&&c2.text()===a;
const rn=cutText(noend);o.n=rn.length<=1500&&/ слово…$/.test(rn);o.m=cutText('Цена 3.5 тысячи. Хорошо.',12)==='Цена 3.5…'&&cutText('Да. Нет.',100)==='Да. Нет.';
const rm=cutText(b+'\nПАМЯТЬ: копит на квартиру');o.memo=rm.endsWith('Cointelegraph. ПАМЯТЬ: копит на квартиру')&&rm.length<=1500+40;
const sse=(evs,fail)=>{const L=evs.map(e=>'event: x\ndata: '+JSON.stringify(e)+'\n\n');let i=0;const en=new TextEncoder();return{read:async()=>{if(i<L.length)return{done:false,value:en.encode(L[i++])};if(fail)throw new TypeError('network');return{done:true}}}};
const td=t=>({type:'content_block_delta',delta:{type:'text_delta',text:t}}),stop={type:'message_delta',delta:{stop_reason:'end_turn'}};
const run=async(evs,fail)=>{const p=[];const r=await pumpReply(sse(evs,fail),x=>p.push(x));return{r,p}};
(async()=>{
const S1='Если коротко — по новостям, рынок растёт на притоке денег в биржевые фонды. ';
let x=await run([td(S1),td('Пишет Cointelegraph.'),stop]);o.okDone=x.r.kind==='done'&&x.r.text===(S1+'Пишет Cointelegraph.').trim()&&x.p.map(z=>z.t).join('').trim()===x.r.text;
x=await run([td(S1),td('Пишет Cointele')],true);o.brokeNet=x.r.kind==='broke'&&x.p.length>0&&x.p.every(z=>z.t&&!z.done&&!z.error);
x=await run([td(S1),td('Пишет Cointele'),{type:'error',error:{type:'overloaded_error'}}]);o.brokeEv=x.r.kind==='broke';
x=await run([td(S1),td('Пишет Cointele')]);o.brokeNoStop=x.r.kind==='broke';
x=await run([{type:'content_block_start',content_block:{type:'tool_use',name:'add_note'}},{type:'content_block_delta',delta:{type:'input_json_delta',partial_json:'{"text":"x"}'}},{type:'message_delta',delta:{stop_reason:'tool_use'}}]);o.act=x.r.kind==='act'&&x.r.tName==='add_note';
console.log(JSON.stringify(o));})();"""
        out = subprocess.run(['node', '-e', js], capture_output=True, text=True, timeout=30)
        got = json.loads(out.stdout.strip() or 'null')
        if got and all(got.values()) and len(got) == 13: ok(name)
        else: fail(name, (out.stdout + out.stderr)[:300])
        # обрыв потока Anthropic: ответ {error}, без done, без записи в кэш и без счётчика (ветка kind === 'broke' — до save)
        st = src[src.index('pumpReply(rd, put)'):src.index('cache-control')]
        bb = re.search(r"if \(kind === 'broke'\) \{(.*?)\n        \}", st, re.S)
        if bb and "put({ error: 'llm' })" in bb.group(1) and 'return' in bb.group(1) and 'save(' not in bb.group(1) and 'done' not in bb.group(1) and st.index("kind === 'broke'") < st.index('await save(res)'):
            ok('orion-ask: поток Anthropic оборвался («Cointele», событие error, нет stop_reason) — ответ {error}, без done, в кэш не пишется')
        else: fail('orion-ask: обрыв потока Anthropic', 'нет ветки broke до save')
    except Exception as e: fail(name, str(e)[:200])
    ok('orion-ask: ключ кэша поднят до v11 (старые обрезанные ответы не отдаются)') if "sha256('v11|'" in src else fail('orion-ask: ключ кэша', 'не v11')

def orion_tool_cut_checks():
    """Н4.2 (25.11.2026, Глеб): обрыв потока посреди вызова инструмента. pumpReply из orion-ask запускается в node: действие отдаётся,
    только если поток дошёл до stop_reason «tool_use» и JSON входа разобрался в объект; неполный JSON, обрыв сети, событие error, max_tokens — kind 'broke'
    (раньше неполный JSON превращался в input={} и действие всё равно исполнялось). Ответ клиенту при этом — {error:'cut'}, без done."""
    name = 'orion-ask: оборванный вызов инструмента (неполный JSON, обрыв сети, error, max_tokens) — действие не отдаётся; целый — отдаётся с разобранным входом'
    try:
        src = (ROOT / 'supabase' / 'functions' / 'orion-ask' / 'index.ts').read_text(encoding='utf-8')
        m = re.search(r'/\* cut:begin \*/(.*?)/\* cut:end \*/', src, re.S)
        if not m: fail(name, 'нет куска cut:begin…cut:end'); return
        code = re.sub(r':\s*(?:string|number|boolean|unknown|Ev|Put|Rd)\b', '', m.group(1))
        js = code + r"""
const sse=(evs,fail)=>{const L=evs.map(e=>'event: x\ndata: '+JSON.stringify(e)+'\n\n');let i=0;const en=new TextEncoder();return{read:async()=>{if(i<L.length)return{done:false,value:en.encode(L[i++])};if(fail)throw new TypeError('network');return{done:true}}}};
const run=async(evs,fail)=>{const p=[];const r=await pumpReply(sse(evs,fail),x=>p.push(x));return{r,p}};
const st={type:'content_block_start',content_block:{type:'tool_use',name:'add_note'}},js=j=>({type:'content_block_delta',delta:{type:'input_json_delta',partial_json:j}}),
  bs={type:'content_block_stop'},tu={type:'message_delta',delta:{stop_reason:'tool_use'}},o={};
(async()=>{
let x=await run([st,js('{"text":"оплатить нал')]);o.halfEnd=x.r.kind==='broke'&&!x.r.input;
x=await run([st,js('{"text":"оплатить нал')],true);o.halfNet=x.r.kind==='broke'&&!x.r.input;
x=await run([st,js('{"text":"оплатить нал'),{type:'error',error:{type:'overloaded_error'}}]);o.halfErr=x.r.kind==='broke';
x=await run([st,js('{"text":"оплатить нал'),bs,{type:'message_delta',delta:{stop_reason:'max_tokens'}}]);o.maxTok=x.r.kind==='broke';
x=await run([st,js('{"text":"x"}'),bs],true);o.noStop=x.r.kind==='broke';
x=await run([st,js('{"text":"x"}'),bs,{type:'error',error:{type:'overloaded_error'}}]);o.errAfter=x.r.kind==='broke';
x=await run([st,js('[1,2]'),bs,tu]);o.notObj=x.r.kind==='broke';
x=await run([st,js('{"text":'),js('"оплатить налоги"}'),bs,tu]);o.whole=x.r.kind==='act'&&x.r.tName==='add_note'&&!!x.r.input&&x.r.input.text==='оплатить налоги';
x=await run([st,bs,tu]);o.empty=x.r.kind==='act'&&!!x.r.input&&Object.keys(x.r.input).length===0;
console.log(JSON.stringify(o));})();"""
        out = subprocess.run(['node', '-e', js], capture_output=True, text=True, timeout=30)
        got = json.loads(out.stdout.strip() or 'null')
        if got and all(got.values()) and len(got) == 9: ok(name)
        else: fail(name, (out.stdout + out.stderr)[:300])
        st = src[src.index('pumpReply(rd, put)'):src.index('cache-control')]
        bb = re.search(r"if \(kind === 'broke'\) \{(.*?)\n        \}", st, re.S)
        if ("if (kind === 'act')" in st and 'JSON.parse' not in st and bb and "if (tName) put({ error: 'cut' })" in bb.group(1) and 'done' not in bb.group(1)
                and st.index("kind === 'act'") < st.index("kind === 'broke'") and "if (tu && out.stop_reason !== 'tool_use') return json({ error: 'cut' }, 502);" in src
                and src.index("out.stop_reason !== 'tool_use'") < src.index('act: { name: tu.name')):
            ok("orion-ask: оборванный инструмент — клиенту {error:'cut'} без done (и без потока при max_tokens); вход берётся только разобранный в pumpReply")
        else: fail('orion-ask: оборванный инструмент', "нет ветки {error:'cut'} или вход разбирается мимо pumpReply")
    except Exception as e: fail(name, str(e)[:200])

def sw_nav_checks():
    """Открытие приложения при ошибке сервера (13.11.2026). В тест-браузере service worker выключен (service_workers='block'),
    поэтому обработчик fetch из sw.js запускается в node с подменёнными fetch/caches: 404/5xx на открытие приложения → копия index.html."""
    js = r"""const fs=require('fs'),vm=require('vm');let H=null,cache=null,put=0;
const res=(st,type)=>({status:st,ok:st>=200&&st<300,type:type||'basic',tag:'net'+st,clone(){return this}});
const ctx={self:{addEventListener(t,f){if(t==='fetch')H=f},registration:{}},location:{origin:'https://x.test'},URL,Response:{error:()=>({tag:'err'})},
  caches:{match:async k=>k==='index.html'?cache:undefined,open:async()=>({put(){put++},match:async()=>undefined})},fetch:null};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),ctx);
const go=async(path,net,c)=>{cache=c;ctx.fetch=async()=>{if(net==='off')throw new TypeError('Failed to fetch');return net};let p=null;
  H({request:{url:'https://x.test'+path,method:'GET',mode:'navigate'},respondWith(x){p=x}});const r=await p;return r&&r.tag};
const C={tag:'cache'};(async()=>{const o=[];
  o.push(await go('/moneylife/',res(404),C));o.push(await go('/moneylife/index.html',res(503),C));o.push(await go('/moneylife/',res(404),undefined));
  o.push(await go('/moneylife/privacy.html',res(404),C));put=0;o.push(await go('/moneylife/',res(200),C));o.push(put);
  o.push(await go('/moneylife/','off',C));o.push(await go('/moneylife/',res(0,'opaqueredirect'),C));console.log(JSON.stringify(o));})();"""
    try:
        out = subprocess.run(['node', '-e', js, str(ROOT / 'sw.js')], capture_output=True, text=True, timeout=30)
        got = json.loads(out.stdout.strip() or 'null')
        if got == ['cache', 'cache', 'net404', 'net404', 'net200', 1, 'cache', 'net0']:
            ok('при 404 на открытие страницы приложение открывается из кэша (и при 5xx; без копии и для privacy.html — ответ сервера; без сети — копия)')
        else: fail('sw.js: 404 на открытие приложения', (out.stdout + out.stderr)[:300])
    except Exception as e: fail('sw.js: 404 на открытие приложения', str(e)[:200])

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

def backup_sql_checks():
    """Ночной бэкап базы (И3): supabase/backup_docs.sql только добавляет своё в схеме moneylife_backup и не трогает
    public.docs, очистка — отдельной задачей; рядом откат по именам; на privacy.html и delete.html — срок копий (RU и UK)."""
    q = ROOT / 'supabase' / 'backup_docs.sql'
    if not q.exists(): fail('backup_docs.sql', 'нет файла'); return
    sql = re.sub(r'\s+', ' ', re.sub(r'--[^\n]*', '', q.read_text(encoding='utf-8'))).lower()   # без комментариев
    S = 'moneylife_backup'
    for name, cond in [('enable row level security', f'alter table {S}.docs_snapshots enable row level security' in sql),
                       ('security definer', sql.count('security definer') == 2),
                       ("set search_path = ''", sql.count("set search_path = ''") == 2),
                       ('своя схема moneylife_backup; чужую с тем же именем не трогает',
                            f'create schema {S};' in sql and 'create schema if not exists' not in sql and 'raise exception' in sql
                            and not re.search(r'\bbackup\.', sql.replace(f'{S}.', ''))),
                       ('права anon и authenticated отозваны', f'revoke all on schema {S} from public, anon, authenticated' in sql
                            and f'revoke execute on function {S}.snapshot_docs() from public, anon, authenticated' in sql
                            and f'revoke execute on function {S}.prune_docs_snapshots() from public, anon, authenticated' in sql),
                       ('снимок и очистка — две свои задачи pg_cron', f"cron.schedule('moneylife-backup-docs', '17 0 * * *', $$select {S}.snapshot_docs()$$)" in sql
                            and f"cron.schedule('moneylife-backup-docs-prune', '47 */6 * * *', $$select {S}.prune_docs_snapshots()$$)" in sql),
                       ('порог очистки 5 суток 12 часов (копии живут < 7 дней)', "interval '5 days 12 hours'" in sql)]:
        ok(f'backup_docs.sql: {name}') if cond else fail(f'backup_docs.sql: {name}', 'не найдено')
    bad = [x for x in ['drop table public', 'delete from public', 'update public', 'alter table public', 'truncate', 'drop ']
           if x in sql]
    dels = re.findall(r'delete from ([\w.]+)', sql)
    jobs = {"'moneylife-backup-docs'", "'moneylife-backup-docs-prune'"}
    unsched = re.findall(r"cron\.unschedule\(([^)]*)\)", sql)
    if not bad and set(dels) == {f'{S}.docs_snapshots'} and set(unsched) <= jobs:
        ok('backup_docs.sql: public.docs и чужие задачи pg_cron не меняются (удаляет только старые снимки)')
    else: fail('backup_docs.sql: только добавление', f'найдено {bad} delete {dels} unschedule {unsched}')
    r = ROOT / 'supabase' / 'backup_docs_rollback.sql'
    rs = re.sub(r'\s+', ' ', re.sub(r'--[^\n]*', '', r.read_text(encoding='utf-8'))).lower() if r.exists() else ''
    drops = re.findall(r'drop (\w+) if exists ([\w.()]+)', rs)
    want = [('function', f'{S}.snapshot_docs()'), ('function', f'{S}.prune_docs_snapshots()'), ('table', f'{S}.docs_snapshots'), ('schema', S)]
    if (drops == want and len(re.findall(r'\bdrop\b', rs)) == 4 and 'cascade' not in rs and 'public.' not in rs
            and set(re.findall(r"cron\.unschedule\(([^)]*)\)", rs)) == jobs):
        ok('backup_docs_rollback.sql: откат по именам (задачи, функции, таблица, схема без cascade), public не трогает')
    else: fail('backup_docs_rollback.sql', f'нет файла или откат не тот: {drops}')
    for page, words in [('privacy.html', {'ru': 'Резервные копии базы хранятся не дольше 7 дней', 'uk': 'Резервні копії бази зберігаються не довше 7 днів'}),
                        ('delete.html', {'ru': 'Резервные копии базы</b> (на случай сбоя) — хранятся не дольше 7 дней', 'uk': 'Резервні копії бази</b> (на випадок збою) — зберігаються не довше 7 днів'})]:
        arts = articles((ROOT / page).read_text(encoding='utf-8'))
        miss = [l for l, w in words.items() if w not in arts.get(l, '')]
        ok(f'{page}: срок хранения резервных копий (7 дней) — RU и UK') if not miss else fail(f'{page}: резервные копии', 'нет строки: ' + ', '.join(miss))

def client_errors_sql_checks():
    """Мониторинг ошибок (И4, 24.11.2026): supabase/client_errors.sql только добавляет public.client_errors (RLS без политик,
    без user_id/почты/IP) и функцию public.log_client_error (security definer, search_path = '', лимит в сутки, срок < 30 дней);
    откат рядом — только наши объекты по имени; на privacy.html — строка RU и UK с теми же обещаниями."""
    q = ROOT / 'supabase' / 'client_errors.sql'
    if not q.exists(): fail('client_errors.sql', 'нет файла'); return
    sql = re.sub(r'\s+', ' ', re.sub(r'--[^\n]*', '', q.read_text(encoding='utf-8'))).lower()   # без комментариев
    T, F = 'public.client_errors', 'public.log_client_error'
    tbl = re.search(r'create table if not exists public\.client_errors \((.*?)\);', sql)
    cols = re.findall(r'(?:^|, )(\w+) ', tbl.group(1).strip()) if tbl else []
    for name, cond in [('enable row level security', f'alter table {T} enable row level security' in sql),
                       ('нет политик (create policy) — читать и писать напрямую нельзя', 'create policy' not in sql and 'alter policy' not in sql),
                       ('права на таблицу у anon и authenticated отозваны', f'revoke all on table {T} from public, anon, authenticated' in sql),
                       ('столбцы только id, ts, msg, src, ver, lang — без user_id, почты и IP', cols == ['id', 'ts', 'msg', 'src', 'ver', 'lang']
                            and not re.search(r'user_id|owner|auth\.uid|inet|\bip\b|\bemail\b(?!>)', sql)),
                       ('ограничения длины 200 / 80 / 20 / 5', all(x in sql for x in ['char_length(msg) between 1 and 200', 'char_length(src) <= 80', 'char_length(ver) <= 20', 'char_length(lang) <= 5'])),
                       ('security definer и search_path у обеих функций', sql.count('security definer') == 2 and sql.count("set search_path = ''") == 2),
                       ('запись: execute только у anon и authenticated', f'revoke execute on function {F}(text, text, text, text) from public, anon, authenticated' in sql
                            and f'grant execute on function {F}(text, text, text, text) to anon, authenticated' in sql
                            and 'revoke execute on function public.prune_client_errors() from public, anon, authenticated' in sql
                            and 'grant execute on function public.prune_client_errors' not in sql),
                       ('защита от засорения: не больше 2000 строк за сутки', "interval '1 day'" in sql and 'if n >= 2000 then return;' in sql),
                       ('обезличивание и на сервере: цифры → #, почта → <email>', "'[0-9]', '#', 'g'" in sql and "'<email>'" in sql),
                       ('срок < 30 дней: порог 29 суток 12 часов в функции и задаче pg_cron каждые 6 часов', sql.count("interval '29 days 12 hours'") == 2
                            and "cron.schedule('moneylife-client-errors-prune', '37 */6 * * *', $$select public.prune_client_errors()$$)" in sql),
                       ('чужие объекты с тем же именем — стоп с ошибкой', sql.count('raise exception') == 2)]:
        ok(f'client_errors.sql: {name}') if cond else fail(f'client_errors.sql: {name}', 'не найдено')
    bad = [x for x in ['drop ', 'truncate', 'alter table public.docs', 'update public', 'public.docs', 'create or replace function public.doc', 'delete_my_account'] if x in sql]
    dels = set(re.findall(r'delete from ([\w.]+)', sql))
    unsched = set(re.findall(r"cron\.unschedule\(([^)]*)\)", sql))
    if not bad and dels == {T} and unsched <= {"'moneylife-client-errors-prune'"}: ok('client_errors.sql: только добавление — нет drop, чужие таблицы, функции и задачи pg_cron не меняются')
    else: fail('client_errors.sql: только добавление', f'найдено {bad} delete {dels} unschedule {unsched}')
    r = ROOT / 'supabase' / 'client_errors_rollback.sql'
    rs = re.sub(r'\s+', ' ', re.sub(r'--[^\n]*', '', r.read_text(encoding='utf-8'))).lower() if r.exists() else ''
    drops = re.findall(r'drop (\w+) if exists ([\w.]+(?:\([^)]*\))?)', rs)
    want = [('function', f'{F}(text, text, text, text)'), ('function', 'public.prune_client_errors()'), ('table', T)]
    if (drops == want and len(re.findall(r'\bdrop\b', rs)) == 3 and 'cascade' not in rs and 'docs' not in rs
            and set(re.findall(r"cron\.unschedule\(([^)]*)\)", rs)) == {"'moneylife-client-errors-prune'"}):
        ok('client_errors_rollback.sql: полный откат по именам (задача, 2 функции, таблица; без cascade), остальное не трогает')
    else: fail('client_errors_rollback.sql', f'нет файла или откат не тот: {drops}')
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    ok('index.html и shim.js: приложение вызывает именно public.log_client_error') if "c.rpc('log_client_error', p)" in (ROOT / 'shim.js').read_text(encoding='utf-8') and 'mlErrRpc' in html else fail('вызов log_client_error', 'нет в shim.js/index.html')
    arts = articles((ROOT / 'privacy.html').read_text(encoding='utf-8'))
    words = {'ru': 'сообщения о технических сбоях (без сумм, имён и почты) автоматически сохраняются у нас до 30 дней',
             'uk': 'повідомлення про технічні збої (без сум, імен і пошти) автоматично зберігаються в нас до 30 днів'}
    miss = [l for l, w in words.items() if w not in arts.get(l, '')]
    ok('privacy.html: сбои приложения хранятся до 30 дней, без сумм, имён и почты — RU и UK') if not miss else fail('privacy.html: сбои приложения', 'нет строки: ' + ', '.join(miss))

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

        def page_for(name, test_cfg, prices=True, dsf=2, theme=None, extra=None, tz='Europe/Kyiv', motion=None, intro=False):
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
            # обучающий ролик (17.11): во всех сценариях, кроме своих, считается уже показанным — иначе он закрыл бы знакомство
            if not intro: ctx.add_init_script("try{if(!localStorage.getItem('ml-intro'))localStorage.setItem('ml-intro','{\"seen\":\"test\"}')}catch(e){}")
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

        def drag_buy(pg):
            # ползунок «Купить» (12.11.2026): провести пальцем вправо
            b = pg.evaluate("(()=>{const r=document.getElementById('saveBtn').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
            y = b[1] + b[3] / 2
            pg.mouse.move(b[0] + 30, y); pg.mouse.down()
            for k in range(1, 11): pg.mouse.move(b[0] + 30 + (b[2] - 50) * k / 10, y); pg.wait_for_timeout(16)
            pg.mouse.up()
        def scenario(name, cfg, body, prices=True, path='index.html', dsf=2, theme=None, extra=None, tz='Europe/Kyiv', clock=None, motion=None, intro=False):
            if os.environ.get('ML_ONLY') and os.environ['ML_ONLY'] not in name: return
            ctx, pg, errs = page_for(name, cfg, prices, dsf, theme, extra, tz, motion, intro)
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

        # --- А3б. метка сборки внизу «Настроек» (12.11, для тестировщиков): «Версия <метка из sw.js>», приглушённая, контраст ≥ 4,5:1
        SW_V = re.search(r"const V='ml-(\d+)'", (ROOT / 'sw.js').read_text(encoding='utf-8')).group(1)
        VER = """()=>{const lum=c=>{const m=c.match(/[\\d.]+/g).map(Number);return m.slice(0,3).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0)};
            const e=document.getElementById('appVer');let p=e,b='rgb(0,0,0)';for(;p;p=p.parentElement){const c=getComputedStyle(p).backgroundColor;if(c&&c!=='transparent'&&!/rgba\\(.*,\\s*0\\)$/.test(c)){b=c;break}}
            const x=lum(getComputedStyle(e).color),y=lum(b),r=e.getBoundingClientRect();
            return {txt:e.textContent.trim(),vis:!e.hidden&&r.height>0,cr:(Math.max(x,y)+.05)/(Math.min(x,y)+.05),fg:getComputedStyle(e).color===getComputedStyle(document.getElementById('setTitle')).color}}"""
        # 13.11: читаемая дата сборки из той же метки (день.месяц, часы:минуты), не по часам телефона;
        # 14.11 (Вера): новичку понятнее дата первой — «Версия 14.11, 03:00 · сборка 20261114030000»
        VER_TXT = f'Версия {SW_V[6:8]}.{SW_V[4:6]}, {SW_V[8:10]}:{SW_V[10:12]} · сборка {SW_V}'
        if re.fullmatch(r'Версия (0[1-9]|[12]\d|3[01])\.(0[1-9]|1[0-2]), ([01]\d|2[0-3]):[0-5]\d · сборка \d{14}', VER_TXT): ok(f'версия: сначала дата, потом номер сборки «{VER_TXT}»')
        else: fail('версия: формат даты сборки', VER_TXT)
        for th in ('dark', 'light'):
            def s_ver(pg, n, th=th):
                wait_app(pg)
                if pg.evaluate("document.documentElement.dataset.theme") != th: raise AssertionError('тема не включилась: ' + th)
                pg.click('#setBtn'); pg.wait_for_selector('#setSheet.open', timeout=5000); pg.wait_for_timeout(500)
                pg.evaluate("document.getElementById('appVer').scrollIntoView({block:'end'})"); pg.wait_for_timeout(300)
                r = pg.evaluate(VER)
                if r['vis'] and r['txt'] == VER_TXT: ok(f'«Настройки» ({th}): внизу «{r["txt"]}» — та же метка, что в sw.js, и дата сборки из неё')
                else: fail(f'«Настройки» ({th}): строка версии', f'{r} ≠ {VER_TXT}')
                ok(f'«Настройки» ({th}): версия приглушена, контраст {r["cr"]:.2f}:1') if r['cr'] >= 4.5 and not r['fg'] else fail(f'«Настройки» ({th}): цвет версии', str(r))
                lines = pg.evaluate("(()=>{const e=document.getElementById('appVer');return Math.round(e.getBoundingClientRect().height/parseFloat(getComputedStyle(e).lineHeight))})()")
                ok(f'«Настройки» ({th}): строка версии с датой — в одну строку на 390 px') if lines == 1 else fail(f'«Настройки» ({th}): строка версии переносится', str(lines))
                shot(pg, f'fix-version-{th}')
                (OUT / 'review').mkdir(exist_ok=True); pg.screenshot(path=str(OUT / 'review' / f'ver-date-settings-{th}.png'))
            scenario(f'Версия в настройках ({th})', {'session': True, 'docs': SEED}, s_ver, dsf=1, theme=th)

        # --- А3в. полоска жестов внизу телефона (13.11): низ шторок не уходит под неё. Полоску 34 px имитирует Chromium
        #     (Emulation.setSafeAreaInsetsOverride, viewport-fit=cover): «Настройки» — строка версии выше полоски,
        #     у шторки покупки с закреплённой «Сохранить» отступ под полоску один (у .sh-foot), без лишнего у тела шторки
        SAFE = 34
        for th in ('dark', 'light'):
            def s_safe(pg, n, th=th):
                wait_app(pg)
                if pg.evaluate("document.documentElement.dataset.theme") != th: raise AssertionError('тема не включилась: ' + th)
                pg.context.new_cdp_session(pg).send('Emulation.setSafeAreaInsetsOverride', {'insets': {'top': 0, 'bottom': SAFE, 'left': 0, 'right': 0}})
                pg.wait_for_timeout(200)
                pg.click('#setBtn'); pg.wait_for_selector('#setSheet.open', timeout=5000); pg.wait_for_timeout(500)
                pg.evaluate("(()=>{const b=document.querySelector('#setSheet .sh-body');b.scrollTop=b.scrollHeight})()"); pg.wait_for_timeout(400)
                r = pg.evaluate("(()=>{const b=document.querySelector('#setSheet .sh-body'),v=document.getElementById('appVer').getBoundingClientRect();return {pb:parseFloat(getComputedStyle(b).paddingBottom),vb:v.bottom,h:innerHeight}})()")
                if r['pb'] == 18 + SAFE and r['vb'] <= r['h'] - SAFE: ok(f'полоска жестов ({th}): низ «Настроек» с версией выше полоски, отступ {r["pb"]:g} px')
                else: fail(f'полоска жестов ({th}): «Настройки»', str(r))
                pg.screenshot(path=str(OUT / f'fix-safe-settings-{th}.png'))
                pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
                pg.evaluate("""()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Купить'&&x.offsetParent);b.click()}""")
                pg.wait_for_timeout(700)
                pg.click('#buyMode [data-m=one]'); pg.wait_for_timeout(400)
                r = pg.evaluate("""(()=>{const s=document.getElementById('actSheet'),b=s.querySelector('.sh-body'),f=document.getElementById('actFoot'),k=document.getElementById('saveBtn').getBoundingClientRect();
                    return {foot:!f.hidden,pb:parseFloat(getComputedStyle(b).paddingBottom),fb:parseFloat(getComputedStyle(f).paddingBottom),kb:k.bottom,h:innerHeight}})()""")
                if r['foot'] and r['pb'] == 18 and r['fb'] == 12 + SAFE and r['kb'] <= r['h'] - SAFE: ok(f'полоска жестов ({th}): шторка покупки — «Купить» выше полоски, отступ один (у кнопки {r["fb"]:g} px, у тела {r["pb"]:g} px)')
                else: fail(f'полоска жестов ({th}): шторка покупки', str(r))
                pg.screenshot(path=str(OUT / f'fix-safe-buy-{th}.png'))
            scenario(f'Полоска жестов ({th})', {'session': True, 'docs': SEED}, s_safe, dsf=1, theme=th)

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
                if i == 2:   # 12.11: шаг суммы — подсказка «можно примерную, потом поправить» видна (только текст, без обещаний доходности)
                    rt = pg.evaluate("(()=>{const e=document.getElementById('obRough');if(!e)return '';const r=e.getBoundingClientRect();return r.height>0&&r.bottom<=innerHeight?e.textContent.trim():'скрыта: '+e.textContent.trim()})()")
                    if rt.startswith('Точной суммы нет — впиши примерную') and 'легко поправить' in rt: ok(f'знакомство, шаг суммы: видна подсказка «{rt}»')
                    else: fail('знакомство, шаг суммы: подсказка про примерную сумму', repr(rt))
                    for th in ['dark', 'light']:
                        pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(400)
                        shot(pg, f'fix-demo-{th}')
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
            wait_app(pg)
            # №4 (Вера 03.11): пустой график и строка под суммой ведут к «Купить».
            # №4 (охота 15.11): подсказка после знакомства — спокойная, без «!», и живёт обычные ~2,6 с, а не 7:
            # она лежала поверх карточки «Первая запись» на Главной, а то же самое уже сказано на самом экране
            tt = norm(pg.inner_text('#toastMsg')) if pg.locator('#toast.show').count() else ''
            if tt == 'Готово. Нажми «Купить» и запиши покупку': ok('после знакомства подсказка «Готово. Нажми «Купить» и запиши покупку» — без восклицания')
            else: fail('подсказка после знакомства', repr(tt))
            try:
                pg.wait_for_function("!document.querySelector('#toast.show')", polling=200, timeout=3500)
                ok('подсказка после знакомства уходит за ~2,6 с и не закрывает карточки Главной')
            except Exception: fail('подсказка после знакомства уходит за ~2,6 с', 'через 3,5 с ещё на экране')
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
            drag_buy(pg)
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

        # --- Б3. обучающий ролик «MoneyLife за минуту» (17.11.2026): один раз для нового пользователя, поверх знакомства;
        #     7 слайдов, субтитры, «Пропустить» всегда видна, кнопки ≥ 48 px, «Назад»/«Далее», смахивание, пауза при сворачивании,
        #     «Уменьшить движение», украинский, пересмотр из «Настроек», события ml-intro-log
        IST = "(()=>window.MLIntro&&MLIntro.debug.state())()"
        ILOG = "(()=>{try{return JSON.parse(localStorage.getItem('ml-intro-log')||'[]').map(e=>e.e+(e.n!=null?':'+e.n:''))}catch(e){return []}})()"
        def intro_sizes(pg):
            return pg.evaluate("""()=>[...document.querySelectorAll('#mlIntro button')].filter(b=>b.offsetParent&&getComputedStyle(b).visibility!=='hidden').map(b=>{const r=b.getBoundingClientRect();return [b.id||b.className,Math.round(r.width),Math.round(r.height),b.getAttribute('aria-label')||b.textContent.trim()]})""")
        def s_intro_first(pg, n):
            pg.wait_for_selector('#mlIntro', state='visible', timeout=10000); pg.wait_for_timeout(600)
            pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
            if pg.evaluate("!document.getElementById('ob').hidden"): ok('ролик: открыт поверх знакомства (знакомство ждёт под ним)')
            else: fail('ролик: знакомство под роликом', 'знакомство скрыто')
            small = [x for x in intro_sizes(pg) if min(x[1], x[2]) < 48 or not x[3]]
            ok('ролик, обложка: кнопки ≥ 48 px и с названием') if not small else fail('ролик, обложка: кнопки', str(small))
            shot(pg, 'intro-0-cover-dark')
            pg.click('#miWatch'); pg.wait_for_timeout(900)
            st = pg.evaluate(IST)
            if st['i'] == 0 and not st['paused']: ok(f"ролик: «Смотреть» запускает слайд 1 (голос: {st['kind']})")
            else: fail('ролик: старт', str(st))
            pg.wait_for_timeout(1200)
            cap = pg.evaluate(IST)['cap']
            ok(f'ролик: субтитры идут — «{cap[:40]}…»') if cap.startswith('Привет, я Орион') else fail('ролик: субтитры', repr(cap))
            # автоматический переход после длительности слайда (8 с)
            pg.wait_for_function("()=>MLIntro.debug.state().i===1", polling=250, timeout=12000); ok('ролик: слайд 1 сам сменился слайдом 2')
            pg.wait_for_timeout(5200); shot(pg, 'intro-2-home-dark')
            for i in range(2, 7):
                pg.click('#miNext'); pg.wait_for_timeout(300)
                st = pg.evaluate(IST)
                if st['i'] != i: raise AssertionError(f'«Далее» не перешёл на слайд {i+1}: {st}')
                pg.wait_for_timeout(5000 if i in (2, 3, 4) else 1600); shot(pg, f'intro-{i+1}-dark')
            ok('ролик: «Далее» проходит все 7 слайдов')
            bad = pg.evaluate("""()=>{const r=document.querySelector('#mlIntro .mi-sl.cur');const out=[];r.querySelectorAll('*').forEach(e=>{const b=e.getBoundingClientRect();if(b.width&&(b.right>innerWidth+1||b.left<-1))out.push(e.className||e.tagName)});return out.slice(0,5)}""")
            ok('ролик: последний слайд не вылезает за экран 390 px') if not bad else fail('ролик: вылезает за экран', str(bad))
            if pg.locator('#miCta').inner_text().strip() == 'Настроить мой план' and pg.locator('#miNext').count() == 0: ok('ролик: на последнем слайде — «Настроить мой план»')
            else: fail('ролик: последний слайд', pg.inner_text('#miNav'))
            pg.click('#miBack'); pg.wait_for_timeout(400)
            ok('ролик: «Назад» возвращает на слайд 6') if pg.evaluate(IST)['i'] == 5 else fail('ролик: «Назад»', str(pg.evaluate(IST)))
            # смахивание влево — вперёд
            b = pg.evaluate("(()=>{const r=document.getElementById('miBody').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
            y = b[1] + b[3] / 2; pg.mouse.move(b[0] + b[2] - 40, y); pg.mouse.down()
            for k in range(1, 8): pg.mouse.move(b[0] + b[2] - 40 - 30 * k, y); pg.wait_for_timeout(16)
            pg.mouse.up(); pg.wait_for_timeout(400)
            ok('ролик: смахивание влево — следующий слайд') if pg.evaluate(IST)['i'] == 6 else fail('ролик: смахивание', str(pg.evaluate(IST)))
            # светлая тема
            pg.evaluate("document.documentElement.setAttribute('data-theme','light')"); pg.wait_for_timeout(500); shot(pg, 'intro-7-light')
            pg.evaluate("MLIntro.debug.go(4)"); pg.wait_for_timeout(5600); shot(pg, 'intro-5-light')
            pg.evaluate("MLIntro.debug.go(1)"); pg.wait_for_timeout(3600); shot(pg, 'intro-2-light')
            pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
            pg.evaluate("MLIntro.debug.go(6)"); pg.wait_for_timeout(500)
            pg.click('#miCta'); pg.wait_for_selector('#mlIntro', state='detached', timeout=5000)
            if pg.evaluate("!document.getElementById('ob').hidden") and pg.evaluate("!!localStorage.getItem('ml-intro')"): ok('ролик: «Настроить мой план» — открыто знакомство, ролик отмечен показанным')
            else: fail('ролик: после «Настроить мой план»', 'знакомство скрыто или нет отметки ml-intro')
            log = pg.evaluate(ILOG)
            need = ['open', 'start', 'slide:1', 'slide:2', 'slide:7', 'complete:7', 'cta']
            miss = [x for x in need if x not in log]
            ok('ролик: события старт / слайды / завершение / нажатие кнопки записаны') if not miss else fail('ролик: события', f'нет {miss}: {log}')
            pg.reload(wait_until='load'); pg.wait_for_selector('#ob:not([hidden])', timeout=10000); pg.wait_for_timeout(1500)
            ok('ролик: при повторном запуске не показывается') if pg.locator('#mlIntro').count() == 0 else fail('ролик: повторный запуск', 'ролик показан снова')
        scenario('Ролик: первый запуск', {'session': True, 'docs': []}, s_intro_first, intro=True)

        def s_intro_skip(pg, n):
            pg.wait_for_selector('#mlIntro', state='visible', timeout=10000)
            pg.click('#miWatch'); pg.wait_for_timeout(500)
            pg.click('#miNext'); pg.wait_for_timeout(200); pg.click('#miNext'); pg.wait_for_timeout(300)
            # сворачивание приложения — пауза, «Продолжить» по центру
            pg.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});document.dispatchEvent(new Event('visibilitychange'))")
            pg.wait_for_timeout(300); t1 = pg.evaluate(IST)
            pg.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'visible'});document.dispatchEvent(new Event('visibilitychange'))")
            pg.wait_for_timeout(1200); t2 = pg.evaluate(IST)
            if t1['paused'] and t2['paused'] and abs(t2['t'] - t1['t']) < 0.05 and pg.locator('#miResume').is_visible(): ok('ролик: свернули приложение — пауза, время стоит, видна «Продолжить»')
            else: fail('ролик: пауза при сворачивании', f'{t1} → {t2}')
            shot(pg, 'intro-paused-dark')
            pg.click('#miResume'); pg.wait_for_timeout(800)
            t3 = pg.evaluate(IST)
            ok('ролик: «Продолжить» — показ идёт дальше') if not t3['paused'] and t3['t'] > t2['t'] else fail('ролик: продолжить', str(t3))
            # звук: кнопка переключает и подписана
            lab0 = pg.get_attribute('#miSnd', 'aria-label'); pg.click('#miSnd'); pg.wait_for_timeout(150)
            lab1 = pg.get_attribute('#miSnd', 'aria-label')
            ok(f'ролик: кнопка звука «{lab0}» → «{lab1}»') if pg.evaluate(IST)['muted'] and lab0 != lab1 else fail('ролик: кнопка звука', f'{lab0} / {lab1}')
            v0 = pg.is_visible('#miCap'); pg.click('#miCc'); pg.wait_for_timeout(150)
            v1 = pg.evaluate("getComputedStyle(document.getElementById('miCap')).visibility"); pr = pg.get_attribute('#miCc', 'aria-pressed')
            ok('ролик: субтитры включены сразу, кнопка «CC» их скрывает') if v0 and v1 == 'hidden' and pr == 'false' else fail('ролик: субтитры вкл/выкл', f'{v0} {v1} {pr}')
            pg.click('#miCc'); pg.wait_for_timeout(100)
            pg.click('#miSkip'); pg.wait_for_selector('#mlIntro', state='detached', timeout=5000)
            log = pg.evaluate(ILOG)
            ok('ролик: «Пропустить» на 3-м слайде — открыто знакомство, событие skip:3') if 'skip:3' in log and pg.evaluate("!document.getElementById('ob').hidden") else fail('ролик: пропуск', str(log))
            pg.click('#obSkip'); pg.wait_for_selector('#ob[hidden]', state='attached', timeout=6000)
            ok('ролик → знакомство → «Пропустить»: приложение открылось') if pg.evaluate("!!localStorage.getItem('ml-intro')") else fail('ролик: отметка', 'нет ml-intro')
        scenario('Ролик: пропуск и сворачивание', {'session': True, 'docs': []}, s_intro_skip, intro=True)

        def s_intro_calm(pg, n):
            pg.wait_for_selector('#mlIntro', state='visible', timeout=10000)
            pg.click('#miWatch'); pg.wait_for_timeout(400)
            moves = []
            for i in range(1, 7):
                pg.evaluate(f"MLIntro.debug.go({i})"); pg.wait_for_timeout(2500 if i in (1, 2, 4) else 900)
                moves += pg.evaluate("""()=>document.getAnimations().filter(a=>a.effect&&a.effect.target&&a.effect.target.closest&&a.effect.target.closest('#mlIntro .mi-sl.cur')).map(a=>a.effect.getKeyframes().filter(k=>k.transform&&k.transform!=='none').length).filter(x=>x>0)""")
                if pg.evaluate("[...document.querySelectorAll('#mlIntro .mi-sl.cur .mi-fg')].some(f=>getComputedStyle(f).opacity!=='0')"): moves.append('палец')
                if i == 4: shot(pg, 'intro-5-reduced')
            st = pg.evaluate(IST)
            ok('ролик, «Уменьшить движение»: без сдвигов и «пальца», только плавное появление') if st['rm'] and not moves else fail('ролик: уменьшить движение', f"rm={st['rm']} {moves[:5]}")
        scenario('Ролик: уменьшить движение', {'session': True, 'docs': []}, s_intro_calm, intro=True, motion='reduce')

        def s_intro_uk(pg, n):
            pg.wait_for_selector('#mlIntro', state='visible', timeout=10000)
            t0 = pg.inner_text('#mlIntro')
            pg.click('#miWatch'); pg.wait_for_timeout(1500)
            t1 = pg.inner_text('#mlIntro')
            pg.evaluate("MLIntro.debug.go(6)"); pg.wait_for_timeout(600); t2 = pg.inner_text('#mlIntro')
            ru = [w for w in ['Пропустить', 'Смотреть', 'Далее', 'Настроить', 'Привет', 'Выключить'] if w in t0 + t1 + t2]
            if not ru and 'Пропустити' in t0 and 'Налаштувати мій план' in t2 and 'Привіт, я Оріон' in pg.evaluate("MLIntro.debug.text.uk.slides[0].vo"): ok('ролик по-украински: обложка, слайды и кнопки без русских слов')
            else: fail('ролик по-украински', f'русское: {ru}')
            shot(pg, 'intro-7-uk')
        scenario('Ролик: украинский', {'session': True, 'docs': []}, lambda pg, n: (pg.evaluate("localStorage.setItem('ml-lang','uk')"), pg.reload(wait_until='load'), pg.wait_for_timeout(1500), s_intro_uk(pg, n)), intro=True)

        def s_intro_replay(pg, n):
            wait_app(pg)
            if pg.locator('#mlIntro').count(): raise AssertionError('у давнего пользователя ролик показался сам')
            ok('ролик: давнему пользователю сам не показывается')
            pg.evaluate("openSheet('setSheet');fillSettings()"); pg.wait_for_timeout(500)
            r = pg.evaluate("(()=>{const b=document.getElementById('introBtn');const r=b.getBoundingClientRect();return [b.textContent.trim(),Math.round(r.height)]})()")
            ok(f'«Настройки»: строка «Как пользоваться MoneyLife», {r[1]} px') if r[0].startswith('Как пользоваться MoneyLife') and r[1] >= 48 else fail('«Настройки»: строка ролика', str(r))
            pg.evaluate("P.msVoice=false")   # «Голос Ориона» выключен → ролик без звука, только субтитры
            pg.evaluate("document.getElementById('introBtn').click()")
            pg.wait_for_selector('#mlIntro', state='visible', timeout=8000); pg.wait_for_timeout(400)
            st = pg.evaluate(IST)
            ok('ролик из «Настроек»: открыт в режиме пересмотра, без звука при выключенном «Голосе Ориона»') if st['mode'] == 'replay' and st['muted'] else fail('ролик из настроек', str(st))
            ok('ролик: остальное приложение недоступно скринридеру, пока идёт ролик') if pg.evaluate("!!document.querySelector('nav.tabs').closest('[inert]')") else fail('ролик: inert', 'нижнее меню доступно')
            pg.click('#miWatch'); pg.wait_for_timeout(300); pg.evaluate("MLIntro.debug.go(6)"); pg.wait_for_timeout(1300)
            cta = pg.inner_text('#miCta').strip(); cap = pg.evaluate(IST)['cap']
            ok('пересмотр: в конце «Готово» и подсказка, где найти ролик') if cta == 'Готово' and 'Настройках' in cap else fail('пересмотр: конец', f'{cta} / {cap}')
            pg.click('#miCta'); pg.wait_for_selector('#mlIntro', state='detached', timeout=5000)
            ok('пересмотр: «Готово» закрывает ролик, знакомство не открывается') if pg.evaluate("document.getElementById('ob').hidden") else fail('пересмотр: закрытие', 'открылось знакомство')
            pg.wait_for_timeout(500)
            ok('после ролика приложение снова доступно (inert снят)') if pg.evaluate("!document.querySelector('[inert]')") else fail('после ролика: inert', 'остался')
            # пауза → «Далее»: звук не остаётся выключенным (AudioContext возобновлён)
            pg.evaluate("document.getElementById('introBtn').click()"); pg.wait_for_selector('#mlIntro', state='visible', timeout=8000); pg.wait_for_timeout(300)
            pg.click('#miWatch'); pg.wait_for_timeout(400); pg.click('#miPause'); pg.wait_for_timeout(200); pg.click('#miNext'); pg.wait_for_timeout(500)
            st = pg.evaluate(IST)
            ok('пауза → «Далее»: показ продолжается со следующего слайда') if st['i'] == 1 and not st['paused'] else fail('пауза → «Далее»', str(st))
            pg.click('#miSkip'); pg.wait_for_selector('#mlIntro', state='detached', timeout=5000)
        scenario('Ролик: пересмотр из настроек', {'session': True, 'docs': SEED}, s_intro_replay, intro=True)

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
                    if tm == ['$1 235', '$1 000', '$950,50', '-$1 500', '+$12,34', '$0,2000', '$110 000', '$1 000,00', '$1 235', '$200', '$200', '-$8', '$0,00', '$0', '$200', '$200,00']:   # 0,001 со знаком → «$0,00» без «+» (№5 охоты 16.11: ноль без знака)
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

        # --- Н2 (24.11.2026): график монеты — сохранённая копия сразу, свежие данные в фоне; заранее подгрузка через 3 с.
        #     Сеть имитируется в странице: свечи Binance для BTC/ETH отвечают с задержкой; все запросы истории цены считаются.
        def chart_net(delay, seed=None):
            s = """(()=>{const real=window.fetch.bind(window),T0=performance.now(),D=%d,now=Date.now();window.__chReq=[];
              /* свежие свечи: 365 дней, цена закрытия 100000 + 50·день (другие числа, чем в копии) */
              const KL=Array.from({length:365},(_,i)=>{const t=now-(364-i)*864e5;return [t,0,0,0,String(100000+50*i),0,t+864e5-1];});
              window.fetch=(u,o)=>{const s=String(u&&u.url||u);
                if(/klines|candlesticks|market_chart/.test(s)){window.__chReq.push({u:s,t:performance.now()-T0});
                  if(/klines\\?symbol=(BTC|ETH)USDT/.test(s))return new Promise(r=>setTimeout(()=>r(new Response(JSON.stringify(KL),{status:200,headers:{'content-type':'application/json'}})),D));}
                return real(u,o);};
              %s})();""" % (delay, seed or '')
            return s
        # копия: 120 точек 90000…90119, сохранена 7 ч назад (год: срок 6 ч) и 2 ч назад (3 месяца: срок 1 ч)
        CH_SEED = """try{const now=Date.now(),cp=(days,age)=>{const end=now-age,st=end-days*864e5;
            localStorage.setItem('cg3:ch:bitcoin|'+days,JSON.stringify({body:{prices:Array.from({length:120},(_,i)=>90000+i),startTs:st,endTs:end,src:'binance'},at:end}));};
          cp('365',7*3600e3);cp('90',2*3600e3);}catch(e){}"""
        OPEN_MS = """async(js)=>{const t=performance.now();eval(js);
            while(!document.querySelector('#cvChart svg path.main')&&performance.now()-t<5000)await new Promise(r=>setTimeout(r,4));
            return Math.round(performance.now()-t)}"""
        def s_chart_swr(pg, n):
            pg.add_init_script(chart_net(1200, CH_SEED)); pg.reload(wait_until='load'); wait_app(pg)
            pg.wait_for_function("S.ready&&S.live.prices.BTC>0", polling=100, timeout=10000)
            ms1 = pg.evaluate(OPEN_MS, "openCoin('BTC')")
            st1 = pg.evaluate("[MK['bitcoin|365']&&MK['bitcoin|365'].slice(-1)[0].v,document.getElementById('cvNote').textContent]")
            print(f'    замер: шторка BTC, «1Г», копия 7 ч, сеть 1,2 с — график через {ms1} мс')
            if ms1 <= 300 and st1[0] == 90119 and not st1[1]: ok(f'Н2: график монеты из копии старше срока — {ms1} мс ≤ 300, без «Загружаю…»')
            else: fail('Н2: график монеты из копии', f'{ms1} мс, {st1}')
            d1 = pg.evaluate("document.querySelector('#cvChart path.main').getAttribute('d')")
            pg.wait_for_timeout(1700)
            st2 = pg.evaluate("""[MK['bitcoin|365'].slice(-1)[0].v,document.querySelector('#cvChart path.main').getAttribute('d'),
                JSON.parse(localStorage.getItem('cg3:ch:bitcoin|365')).at>Date.now()-60000,__chReq.filter(r=>/BTCUSDT&interval=1d/.test(r.u)).length,
                document.querySelectorAll('#cvChart svg').length,document.getElementById('cvNote').textContent]""")
            if st2[0] == 100000 + 50 * 364 and st2[1] != d1 and st2[2] and st2[3] == 1 and st2[4] == 1 and not st2[5]:
                ok('Н2: свежие данные пришли в фоне — график перерисован на месте, копия обновлена, запрос один')
            else: fail('Н2: фоновое обновление графика', str([st2[0], st2[1] != d1] + st2[2:]))
            # 3 месяца: копия 2 ч (срок 1 ч) — тоже сразу; ушли на «1Г» до ответа сети — свежие данные «3М» не перерисовывают «1Г»
            ms2 = pg.evaluate(OPEN_MS.replace("!document.querySelector('#cvChart svg path.main')", "!(document.querySelector('#cvChart svg path.main')&&cvRange==='90'&&MK['bitcoin|90'])"),
                              "document.querySelector('#cvRanges [data-r=\"90\"]').click()")
            print(f'    замер: тот же график, «3М», копия 2 ч — {ms2} мс')
            d90 = pg.evaluate("document.querySelector('#cvChart path.main').getAttribute('d')")
            pg.evaluate("document.querySelector('#cvRanges [data-r=\"365\"]').click()"); pg.wait_for_timeout(50)
            d365 = pg.evaluate("document.querySelector('#cvChart path.main').getAttribute('d')")
            pg.wait_for_timeout(1700)
            st3 = pg.evaluate("[cvRange,document.querySelector('#cvChart path.main').getAttribute('d'),MK['bitcoin|90'].slice(-1)[0].v]")
            if ms2 <= 300 and d90 != d365 and st3[0] == '365' and st3[1] == d365 and st3[2] == 100000 + 50 * 364:
                ok(f'Н2: «3М» из копии за {ms2} мс; свежие «3М» пришли после ухода на «1Г» — легли в кэш, «1Г» не перерисован')
            else: fail('Н2: период сменили до ответа сети', f'{ms2} мс, {st3[0]}, {st3[1] == d365}, {st3[2]}')
            # закрыли и открыли снова — из памяти, в сеть не ходит
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(400)
            ms3 = pg.evaluate(OPEN_MS, "openCoin('BTC')"); pg.wait_for_timeout(300)
            k = pg.evaluate("__chReq.filter(r=>/BTCUSDT&interval=1d/.test(r.u)).length")
            ok(f'Н2: повторное открытие — {ms3} мс, без нового запроса') if ms3 <= 300 and k == 1 else fail('Н2: повторное открытие', f'{ms3} мс, запросов {k}')
        scenario('Н2: график монеты — копия сразу, обновление в фоне', {'session': True, 'docs': SEED}, s_chart_swr)

        def s_chart_nocopy(pg, n):
            # нет копии и нет сети (свечи и CoinGecko недоступны) — как раньше: понятное сообщение, цены сделок
            wait_app(pg); pg.evaluate("openCoin('BTC')"); pg.wait_for_timeout(200)
            a = pg.inner_text('#cvNote')
            pg.wait_for_function("document.getElementById('cvNote').textContent.includes('не загрузилась')", polling=200, timeout=60000)
            b = pg.inner_text('#cvNote')
            ok('Н2: без копии и без сети — «Загружаю…», затем «История цены не загрузилась»') if 'Загружаю' in a and 'не загрузилась' in b and not pg.locator('#cvChart path.main').count() else fail('Н2: без копии и сети', f'{a!r} → {b!r}')
        scenario('Н2: график монеты — нет копии и нет сети', {'session': True, 'docs': SEED}, s_chart_nocopy)

        def s_chart_warm(pg, n):
            pg.add_init_script(chart_net(300)); pg.reload(wait_until='load'); wait_app(pg)
            pg.wait_for_timeout(6500)
            r = pg.evaluate("""[__chReq.filter(r=>/interval=1d|days=365/.test(r.u)).map(r=>[r.u.replace(/^.*symbol=|&.*$/g,''),Math.round(r.t)]),
                !!MK['bitcoin|365'],!!MK['ethereum|365'],!!localStorage.getItem('cg3:ch:bitcoin|365'),!!localStorage.getItem('cg3:ch:ethereum|365')]""")
            reqs = r[0]; syms = [x[0] for x in reqs]
            if sorted(syms) == ['BTCUSDT', 'ETHUSDT'] and reqs[0][1] >= 2500 and reqs[1][1] - reqs[0][1] >= 300 and all(r[1:]):
                ok(f'Н2: через ~3 с графики монет портфеля в кэше — по одной ({reqs[0][1]} и {reqs[1][1]} мс от запуска)')
            else: fail('Н2: заранее подгрузка графиков', str(r))
            ms = pg.evaluate(OPEN_MS, "openCoin('ETH')"); pg.wait_for_timeout(300)
            pg.evaluate("closeSheets()"); pg.evaluate("cvWarm();cvWarmOn=false;cvWarm()"); pg.wait_for_timeout(1500)
            k = pg.evaluate("__chReq.filter(r=>/interval=1d|days=365/.test(r.u)).length")
            ok(f'Н2: после подгрузки шторка ETH — {ms} мс; повторная подгрузка запросы не дублирует') if ms <= 300 and k == 2 else fail('Н2: дубли запросов', f'{ms} мс, запросов {k}')
        scenario('Н2: заранее подгрузка графиков', {'session': True, 'docs': SEED}, s_chart_warm)

        def s_chart_warm_none(pg, n):
            pg.add_init_script(chart_net(300)); pg.reload(wait_until='load'); wait_app(pg)
            pg.wait_for_timeout(6000)
            r = pg.evaluate("[__chReq.filter(r=>/interval=1d|days=365|candlesticks/.test(r.u)).length,cvWarmOn,S.ready]")
            ok('Н2: монет нет — заранее подгрузка в сеть не ходит') if r[0] == 0 and r[2] else fail('Н2: подгрузка без монет', str(r))
        scenario('Н2: заранее подгрузка — монет нет', {'session': True, 'docs': [SEED[0]]}, s_chart_warm_none)

        def s_chart_warm_off(pg, n):
            # телефон без сети: navigator.onLine = false (страница и имитация базы — локальные)
            pg.add_init_script(chart_net(300, "Object.defineProperty(Navigator.prototype,'onLine',{configurable:true,get:()=>false});"))
            pg.reload(wait_until='load'); wait_app(pg); pg.wait_for_timeout(6000)
            r = pg.evaluate("[__chReq.filter(r=>/interval=1d|days=365/.test(r.u)).length,navigator.onLine]")
            ok('Н2: без сети заранее подгрузка не запускается') if r == [0, False] else fail('Н2: подгрузка без сети', str(r))
        scenario('Н2: заранее подгрузка — нет сети', {'session': True, 'docs': SEED}, s_chart_warm_off)

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
            drag_buy(pg)
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
            pg.evaluate("openAct('menu')"); pg.wait_for_timeout(700)
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
            # 18.11.2026: нажатие — слушает вопрос (зажимать не нужно); во время речи — замолкает и слушает; молчание — сводка
            LST = "(()=>{const c=document.querySelector('.or-cap');return {listen:!!(c&&c.classList.contains('listen')),text:c?c.innerText:'',talking:Mascot.debug.state().talking}})()"
            pg.click('#mascot .ms-hit'); pg.wait_for_timeout(300)
            a1 = pg.evaluate(LST)
            if not a1['talking'] and a1['listen']: ok('Орион: нажатие во время речи — замолкает и сразу слушает (перебивание)')
            else: fail('Орион: перебивание нажатием', str(a1))
            pg.click('#mascot .ms-hit'); pg.wait_for_timeout(250)
            a2 = pg.evaluate(LST)
            if not a2['listen'] and not a2['talking']: ok('Орион: нажатие во время слушания — отмена')
            else: fail('Орион: отмена слушания', str(a2))
            pg.click('#mascot .ms-hit'); pg.wait_for_timeout(300); pg.click('#mascot .ms-hit'); pg.wait_for_timeout(4200)
            s0 = pg.evaluate("Mascot.debug.state().said")
            if not s0.startswith('Добр') and not pg.evaluate(LST)['listen']: ok('Орион: передумали — второе нажатие отменяет вопрос без сводки')
            else: fail('Орион: отмена вопроса', s0)
            pg.click('#mascot .ms-hit'); pg.wait_for_timeout(300)
            a3 = pg.evaluate(LST)
            if a3['listen'] and 'помолчите' in a3['text']: ok('Орион: нажатие — слушает вопрос, подсказка «спросите или помолчите»')
            else: fail('Орион: нажатие — слушает', str(a3))
            try: pg.wait_for_function("()=>Mascot.debug.state().said.startsWith('Добр')", polling=200, timeout=9000)
            except Exception: pass
            said = pg.evaluate("Mascot.debug.state().said").replace('\u00a0', ' ')
            if said.startswith('Добр') and 'Андрей' in said and 'Портфель' in said and 'Биткоин' in said: ok('Орион: промолчали после нажатия — сводка: приветствие по имени, портфель, биткоин')
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
            # цена голосом: «63 тыс.», «63.000», «шестьдесят три тысячи», «63к», просто «63» у биткоина — это 63 000 (жалоба владельца 12.11)
            bad = []
            for q in ['сообщи когда биткоин будет 63 тыс.', 'сообщи когда биткоин будет 63.000', 'сообщи когда биткоин будет шестьдесят три тысячи', 'сообщи когда биткоин упадет до 63к', 'сообщи когда биткоин будет 63', 'поставь уведомление на 63 тыс', 'поставь оповещение на биткоин 63 тысячи']:
                r = R(q); al = pg.evaluate("(()=>{const k=Object.keys(localStorage).find(k=>k.startsWith('ml-x:'));return k?(JSON.parse(localStorage.getItem(k)).alerts||[]):[]})()")
                if not any(x['sym'] == 'BTC' and x['price'] == 63000 for x in al): bad.append(q + ' → ' + r)
                pg.evaluate("(()=>{const k=Object.keys(localStorage).find(k=>k.startsWith('ml-x:'));const o=JSON.parse(localStorage.getItem(k));o.alerts=(o.alerts||[]).filter(a=>a.sym!=='BTC');localStorage.setItem(k,JSON.stringify(o));})()")
            if not bad: ok('Орион: цена голосом — «63 тыс.», «63.000», «шестьдесят три тысячи», «63к», «63» у биткоина = $63 000')
            else: fail('Орион: цена голосом', ' | '.join(bad))
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
            # живой голос: не больше двух запросов одновременно (ElevenLabs отказывает при большем числе — Орион уходил на голос телефона, 12.11)
            pg.evaluate("""(()=>{window.__vq={n:0,max:0,calls:0};const o=window.mlVoice;window.__mlVoiceOrig=o;window.mlVoice=async(t,c)=>{const q=window.__vq;q.n++;q.calls++;q.max=Math.max(q.max,q.n);await new Promise(r=>setTimeout(r,250));q.n--;return {error:'net'};};})()""")
            pg.evaluate("Mascot.debug.premium(true)")
            pg.evaluate("Mascot.debug.say('Первая фраза для проверки очереди живого голоса, она нарочно длинная. Вторая фраза подлиннее для проверки, чтобы весь текст был больше трёхсот пятидесяти знаков. Третья фраза тоже длинная для проверки и тоже про очередь запросов. Четвёртая фраза в конце для проверки. Пятая фраза добавлена, чтобы ответ точно разделился на две части. Шестая и последняя фраза.')"); pg.wait_for_timeout(2500)
            vq = pg.evaluate("window.__vq")
            if vq['max'] <= 2 and vq['calls'] >= 3: ok(f"Орион: запросы живого голоса — не больше двух одновременно ({vq['calls']} запросов)")
            else: fail('Орион: одновременные запросы голоса', str(vq))
            pg.evaluate("window.mlVoice=window.__mlVoiceOrig; document.querySelector('.or-cap')&&document.querySelector('.or-cap').click()")
            # 18.11.2026: ответ в разговоре озвучивается по предложениям (первый звук быстрее), сводка — целиком
            LT = 'Если коротко, рынок нервничает. По новостям, из биржевых фондов ушли деньги, пишет Cointelegraph. Индекс страха опустился до двенадцати. Рассказать, что это значит для вашего портфеля?'
            sp2 = pg.evaluate("t=>[Mascot.debug.split(t,true),Mascot.debug.split(t,false)]", LT)
            if len(sp2[0]) >= 3 and sp2[0][0] == 'Если коротко, рынок нервничает.' and len(sp2[1]) == 1: ok(f"Орион: ответ в разговоре — по предложениям ({len(sp2[0])} части, первая короткая), сводка до 350 знаков — целиком")
            else: fail('Орион: разбиение ответа', str(sp2))
            # 18.11.2026: ударения для живого голоса — знак над гласной (Eleven v4 его слышит, проверка владельца)
            st = pg.evaluate("Mascot.debug.stress('Халвинг прошёл. Средства на бирже, договор подписан, в этом квартале волатильность выше.')")
            if all(w in st for w in ['Ха\u0301лвинг', 'Сре\u0301дства', 'догово\u0301р', 'кварта\u0301ле', 'волати\u0301льность']): ok('Орион: словарь ударений — ха́лвинг, сре́дства, догово́р, кварта́ле, волати́льность')
            else: fail('Орион: словарь ударений', st)
            # живой голос: числа словами в нужном падеже («до семидесяти четырёх тысяч», «к … тысячам»), «тыс.», «млн»
            sp = pg.evaluate("[Mascot.debug.spoken('Биткоин держится около 74 тысяч долларов.'), Mascot.debug.spoken('Упал до $74 тыс. и отскочил к 76 000 $.'), Mascot.debug.spoken('Оборот 1,2 млн долларов, рост более 2%.'), Mascot.debug.spoken('Серия 21 месяц, 41 покупка, 2 тысячи гривен.')]")
            want = ['около семидесяти четырёх тысяч долларов.', 'до семидесяти четырёх тысяч долларов и отскочил к семидесяти шести тысячам долларов.', 'одна целая две десятых миллиона долларов, рост более двух процентов.', 'двадцать один месяц, сорок одна покупка, две тысячи гривен.']
            if all(w in x for w, x in zip(want, sp)): ok('Орион: числа в живом голосе — словами и в нужном падеже')
            else: fail('Орион: числа в живом голосе', ' | '.join(sp))
            pr = pg.evaluate("Mascot.debug.spoken('На OKX и Binance приток в ETF, пишет Cointelegraph; ОКХ, ФРС.')")
            if all(w in pr for w in ['о-кей-икс', 'Бинанс', 'и-ти-эф', 'Коинтелеграф', 'эф-эр-эс']) and 'ОКХ' not in pr: ok('Орион: биржи, бренды и аббревиатуры произносятся правильно (OKX — «о-кей-икс», ETF — «и-ти-эф»)')
            else: fail('Орион: произношение', pr)
            # 18.11.2026: подготовка текста к голосу — набор фраз из этапа 2 (деньги, проценты, даты, порядковые, тикеры, разметка)
            PH = [('Биткоин — $110K.', 'Биткоин — сто десять тысяч долларов.'), ('Портфель — $1 250.', 'Портфель — тысяча двести пятьдесят долларов.'),
                  ('Резерв — 300 €.', 'Резерв — триста евро.'), ('Комиссия $0,15.', 'Комиссия пятнадцать центов.'), ('PEPE стоит $0.0000123.', 'пепе стоит доли цента.'),
                  ('За сутки +3,5%.', 'За сутки плюс три с половиной процента.'), ('Доля крипты 0,5%.', 'Доля крипты полпроцента.'), ('до 1,5%', 'до полутора процентов'),
                  ('С 1 января.', 'С первого января.'), ('Пополнение 15.12.', 'Пополнение пятнадцатого декабря.'), ('Халвинг был в 2024 году.', 'Халвинг был в две тысячи двадцать четвёртом году.'),
                  ('Заседание 17 декабря.', 'Заседание семнадцатого декабря.'), ('Напомню в 9:30.', 'Напомню в девять тридцать.'), ('Обновлено 3 ч назад.', 'Обновлено три часа назад.'),
                  ('До 3-й ступени — 8%.', 'До третьей ступени — восемь процентов.'), ('Вы на 2-м этапе плана.', 'Вы на втором этапе плана.'),
                  ('Колебания 5–10% за день.', 'Колебания от пяти до десяти процентов за день.'), ('Через 2-3 недели', 'Через две или три недели'), ('Объём x3 за неделю.', 'Объём в три раза за неделю.'),
                  ('BTC растёт, ETH стоит на месте.', 'биткоин растёт, эфир стоит на месте.'), ('Цена BTC упала.', 'Цена биткоина упала.'), ('У вас 5 BTC.', 'У вас пять биткоинов.'),
                  ('У вас 5 SOL.', 'У вас пять монет соланы.'), ('Купили ONDO и NEAR.', 'Купили ондо и нир.'), ('Стейкинг даёт 4% APY.', 'Стейкинг даёт четыре процента годовых.'),
                  ('Spot ETF одобрили.', 'спотовые и-ти-эф одобрили.'), ('Все упало.', 'Всё упало.'), ('**Важно:** рынок падает 🚀', 'Важно: рынок падает'),
                  ('- первое\n- второе', 'Первое. Второе'), ('Подробнее: https://forklog.com/news', 'Подробнее.'), ('Лестница (5 ступеней) готова.', 'Лестница — пять ступеней — готова.')]
            got = pg.evaluate("a=>a.map(x=>Mascot.debug.spoken(x))", [x[0] for x in PH])
            bad = [f'{a!r} → {g!r} (нужно {w!r})' for (a, w), g in zip(PH, got) if g.replace('\u00a0', ' ') != w]
            if not bad: ok(f'Орион: подготовка текста к голосу — {len(PH)} фраз (деньги, центы, «с половиной», даты, время, порядковые, диапазоны, тикеры в падеже, разметка)')
            else: fail('Орион: подготовка текста к голосу', ' | '.join(bad))
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
            no_sums = set(b1) <= {'q', 'sym', 'hist', 'ctx', 'lang', 'stream'} and b1.get('lang') == 'ru' and all(0 < v <= 100 for v in (ctx.get('shares') or {}).values()) and 'total' not in flat and '@' not in flat
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
            # 18.11.2026: ответ «мозга» потоком — первое предложение звучит сразу, остальное следом; в истории — ответ целиком
            S1 = 'Если коротко — по новостям, рынок растёт на притоке денег в биржевые фонды.'
            S2 = 'Пишет Cointelegraph. Рассказать про эфир?'
            sb = []
            def fs(route):
                sb.append(json.loads(route.request.post_data or '{}'))
                lines = [{'t': S1[:30]}, {'t': S1[30:] + ' '}, {'t': 'Пишет '}, {'t': 'Cointelegraph. Рассказать про эфир?'}, {'done': True, 'text': S1 + ' ' + S2, 'sources': ['Cointelegraph']}]
                route.fulfill(status=200, headers={'content-type': 'application/x-ndjson; charset=utf-8', 'access-control-allow-origin': '*'}, body='\n'.join(json.dumps(x, ensure_ascii=False) for x in lines) + '\n')
            pg.route('**/functions/v1/orion-ask', fs)
            pg.evaluate("Mascot.debug.ask('Почему растёт рынок?')")
            try: pg.wait_for_function("t=>Mascot.debug.sayLog().includes(t)", arg=S2, polling=200, timeout=15000)
            except Exception: pass
            log = pg.evaluate("Mascot.debug.sayLog()"); la = pg.evaluate("(Mascot.debug.lastAsk()||{}).text||''"); hh = pg.evaluate("Mascot.debug.hist()")
            if sb and sb[0].get('stream') is True and S1 in log and S2 in log and log.index(S1) < log.index(S2) and la == S1 + ' ' + S2 and hh and hh[-1]['a'] == S1 + ' ' + S2:
                ok('Орион: ответ «мозга» потоком — первое предложение звучит сразу, остальное следом; в памяти разговора ответ целиком')
            else: fail('Орион: поток ответа', f'{sb[:1]} | {log} | {la}')
            # Н4 (25.11.2026): связь оборвалась после первого куска (done не пришёл) — Орион договаривает и честно говорит «Связь прервалась.», а не замолкает
            pg.evaluate("document.querySelector('.or-cap') && document.querySelector('.or-cap').click()")
            def fb_(route):
                route.fulfill(status=200, headers={'content-type': 'application/x-ndjson; charset=utf-8', 'access-control-allow-origin': '*'}, body='\n'.join(json.dumps(x, ensure_ascii=False) for x in [{'t': S1 + ' '}, {'t': 'Пишет Cointele'}]) + '\n')
            pg.unroute('**/functions/v1/orion-ask'); pg.route('**/functions/v1/orion-ask', fb_)
            pg.evaluate("Mascot.debug.ask('Что с рынком сегодня?')")
            try: pg.wait_for_function("()=>Mascot.debug.sayLog().includes('Связь прервалась.')", polling=200, timeout=15000)
            except Exception: pass
            lb = pg.evaluate("Mascot.debug.sayLog()")
            if S1 in lb and 'Связь прервалась.' in lb and lb.index(S1) < lb.index('Связь прервалась.') and not any('Cointele' in x and 'Cointelegraph' not in x for x in lb):
                ok('Орион: связь оборвалась посреди ответа — договаривает целое и говорит «Связь прервалась.», обрывка слова нет')
            else: fail('Орион: обрыв потока', str(lb))
            pg.unroute('**/functions/v1/orion-ask'); pg.route('**/functions/v1/orion-ask', fs)
            # Н4: продолжение ответа в очереди старше 40 с не выбрасывается; обычная устаревшая фраза — выбрасывается, как раньше
            pg.evaluate("document.querySelector('.or-cap') && document.querySelector('.or-cap').click()")
            qa = pg.evaluate("(()=>{const d=Mascot.debug;d.say('Первая фраза ответа.');d.sayLow('Старая обычная фраза.');d.sayMore('Продолжение ответа.');const n=d.qAge(50);d.next();return n})()")
            pg.wait_for_timeout(400)
            q1 = pg.evaluate("Mascot.debug.state().said")
            pg.evaluate("Mascot.debug.next()"); pg.wait_for_timeout(1000)
            q2 = pg.evaluate("Mascot.debug.state().said")
            if qa == 2 and q1 == 'Продолжение ответа.' and q2 == 'Продолжение ответа.': ok('Орион: продолжение ответа старше 40 с звучит; устаревшая обычная фраза — нет')
            else: fail('Орион: очередь продолжений', f'{qa} | {q1} | {q2}')
            pg.evaluate("document.querySelector('.or-cap') && document.querySelector('.or-cap').click()")
            # Н4 (круг 3, Глеб): «стоп» нажатием на субтитр посреди ответа — ни хвост, ни «Связь прервалась.» потом не звучат (и при {text}, и при {error})
            stop_bad = []
            for fin in ({'text': S1 + ' Хвост ответа, который уже не нужен.', 'sources': []}, {'error': 'llm'}):
                pg.evaluate("document.querySelector('.or-cap') && document.querySelector('.or-cap').click()")
                pg.evaluate("s=>{window.__mlAskOrig=window.__mlAskOrig||window.mlAsk;window.mlAsk=(q,y,x,onPart)=>new Promise(res=>{window.__mlRel=res;setTimeout(()=>{onPart(s+' ');onPart('Пишет Cointele');},50);});Mascot.debug.ask('Почему растёт рынок сегодня?')}", S1)
                try: pg.wait_for_function("t=>{const l=Mascot.debug.sayLog();return l[l.length-1]===t}", arg=S1, polling=100, timeout=8000)
                except Exception: pass
                pg.evaluate("document.querySelector('.or-cap').click()"); pg.wait_for_timeout(200)
                pg.evaluate("v=>window.__mlRel&&window.__mlRel(v)", fin); pg.wait_for_timeout(1500)
                ls_ = pg.evaluate("Mascot.debug.sayLog()")
                if not ls_ or ls_[-1] != S1 or any('Хвост' in x for x in ls_): stop_bad.append(str(ls_[-3:]))
            pg.evaluate("window.mlAsk=window.__mlAskOrig||window.mlAsk")
            cs35 = pg.evaluate("Mascot.debug.chunks('Цена 3.5 тысячи долларов. Дальше спокойно.')")
            if not stop_bad and cs35 == ['Цена 3.5 тысячи долларов. Дальше спокойно.']: ok('Орион: «стоп» посреди ответа — хвост и «Связь прервалась.» не звучат; «3.5» не режется на куски')
            else: fail('Орион: стоп посреди ответа', f'{stop_bad} | {cs35}')
            # Н4.1 (25.11.2026, Глеб): нажатие на субтитр в паузу между кусками длинного ответа (~90 мс, текущей фразы нет) — следующий кусок не звучит, очередь пуста
            pg.evaluate("document.querySelector('.or-cap') && document.querySelector('.or-cap').click()"); pg.wait_for_timeout(300)
            PW = 'Кардано держится у прошлогодних уровней, а покупатели осторожничают перед отчётами фондов. Рипл стоит на месте третью неделю подряд. '
            PT = (PW * 6).strip()
            gap = pg.evaluate("t=>{const d=Mascot.debug;d.sayLong(t);const c=d.chunks(t),a=d.state().said,n=d.qTexts().length;d.next();const g=!d.state().talking;document.querySelector('.or-cap').click();return {c,a,n,g,q:d.qTexts().length}}", PT)
            pg.wait_for_timeout(800)
            gl = pg.evaluate("Mascot.debug.sayLog()")
            if len(gap['c']) >= 2 and gap['a'] == gap['c'][0] and gap['n'] >= 1 and gap['g'] and gap['q'] == 0 and gap['c'][1] not in gl:
                ok('Орион: нажатие на субтитр в паузу между кусками ответа — очередь очищена, следующий кусок не звучит')
            else: fail('Орион: нажатие в паузу между кусками', f"{gap} | {gl[-3:]}")
            # Н4.2 (25.11.2026, Глеб): оборвался вызов инструмента — сервер отдаёт {error:'cut'}: Орион ничего не исполняет и честно говорит «Связь прервалась.»
            pg.evaluate("document.querySelector('.or-cap') && document.querySelector('.or-cap').click()"); pg.wait_for_timeout(300)
            def fcut(route):
                route.fulfill(status=200, headers={'content-type': 'application/x-ndjson; charset=utf-8', 'access-control-allow-origin': '*'}, body=json.dumps({'error': 'cut'}) + '\n')
            pg.unroute('**/functions/v1/orion-ask'); pg.route('**/functions/v1/orion-ask', fcut)
            c0 = pg.evaluate("[Mascot.tasks.notes().length, Mascot.tasks.rem().length, document.getElementById('actSheet').classList.contains('open'), Mascot.debug.sayLog().length]")
            pg.evaluate("Mascot.debug.ask('Что думаешь про рынок на этой неделе?')")
            try: pg.wait_for_function("()=>{const l=Mascot.debug.sayLog();return l[l.length-1]==='Связь прервалась.'}", polling=200, timeout=15000)
            except Exception: pass
            pg.wait_for_timeout(500)
            c1 = pg.evaluate("[Mascot.tasks.notes().length, Mascot.tasks.rem().length, document.getElementById('actSheet').classList.contains('open'), Mascot.debug.sayLog()]")
            pg.unroute('**/functions/v1/orion-ask'); pg.route('**/functions/v1/orion-ask', fs)
            if c1[:3] == c0[:3] and c1[3] and c1[3][-1] == 'Связь прервалась.' and not any('не могу связаться' in x for x in c1[3][-3:]):
                ok("Орион: вызов инструмента оборвался ({error:'cut'}) — действие не исполнено, звучит «Связь прервалась.»")
            else: fail('Орион: оборванный вызов инструмента', f'{c0[:3]} → {c1[:3]} | {c1[3][-3:]}')
            # Н4 (круг 2, Вера): длинный ответ ~1400 знаков — кусками ≤ 400 знаков по целым предложениям, субтитр не вылезает за верх экрана 390×844
            pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(300)
            LW = 'Биткоин растёт на притоке денег в биржевые фонды, пишет Cointelegraph. Эфир держится рядом с прошлой неделей, а Солана немного отстаёт. '
            LT = (LW * 12)[:1440].rsplit('.', 1)[0] + '.'
            lg = pg.evaluate("t=>{const d=Mascot.debug;d.sayLong(t);const r=document.querySelector('.or-cap').getBoundingClientRect();return {said:d.state().said,q:d.qTexts(),ch:d.chunks(t)}}", LT)
            pg.wait_for_timeout(300)
            top1 = pg.evaluate("Math.round(document.querySelector('.or-cap').getBoundingClientRect().top)")
            pg.evaluate("document.querySelector('.or-cap').click()"); pg.wait_for_timeout(300)
            pg.evaluate("t=>Mascot.debug.say(t)", LT); pg.wait_for_timeout(300)
            top2 = pg.evaluate("Math.round(document.querySelector('.or-cap').getBoundingClientRect().top)")
            pg.evaluate("document.querySelector('.or-cap').click()"); pg.wait_for_timeout(300)
            parts = [lg['said']] + lg['q']
            if len(lg['ch']) >= 4 and max(len(x) for x in lg['ch']) <= 400 and ' '.join(lg['ch']) == LT and all(re.search(r'[.!?…]$', x) for x in lg['ch']) and parts[:len(lg['ch'])] == lg['ch'] and top1 >= 0 and top2 >= 0:
                ok(f'Орион: длинный ответ ({len(LT)} знаков) — {len(lg["ch"])} кусков ≤ 400 знаков по целым предложениям; субтитр в экране 390×844 (верх {top1} px, без деления — {top2} px)')
            else: fail('Орион: длинный ответ кусками', f'{[len(x) for x in lg["ch"]]} | {[len(x) for x in parts]} | top {top1} / {top2}')
            # 18.11.2026: переспросы к ответу телефона — «а биткоин?», «а в гривнах?» — считаются на телефоне, без сервера; имя подставляется вместо метки
            pg.evaluate("document.querySelector('.or-cap') && document.querySelector('.or-cap').click()")
            n0 = len(sb)
            pg.evaluate("S.settings.usdUah=41.5"); pg.evaluate("Mascot.debug.ask('сколько у меня эфира')"); pg.wait_for_timeout(400)
            e1 = pg.evaluate("Mascot.debug.state().said").replace('\u00a0', ' ')
            pg.evaluate("Mascot.debug.ask('а биткоин?')"); pg.wait_for_timeout(400)
            e2 = pg.evaluate("Mascot.debug.state().said").replace('\u00a0', ' ')
            pg.evaluate("Mascot.debug.ask('а в гривнах?')"); pg.wait_for_timeout(400)
            e3 = pg.evaluate("Mascot.debug.state().said").replace('\u00a0', ' ')
            if 'эфир' in e1 and 'У вас' in e2 and 'биткоин' in e2 and 'У вас' in e3 and ('гривн' in e3 or 'гривен' in e3) and len(sb) == n0: ok('Орион: переспросы «а биткоин?» и «а в гривнах?» — понимает по прошлому ответу, считает на телефоне')
            else: fail('Орион: переспросы', f'{e1} | {e2} | {e3} | {len(sb) - n0}')
            pg.evaluate("Mascot.debug.ask('Почему рынок растёт?')"); pg.wait_for_timeout(1500)
            hs = (sb[-1].get('hist') if sb else None) or []
            mine = [x['a'] for x in hs if 'У вас' in x['a']]
            if mine and all(not any(c.isdigit() for c in a) for a in mine): ok('Орион: ответы про ваши деньги уходят «мозгу» без чисел — суммы и количества остаются на телефоне')
            else: fail('Орион: приватность истории', str(hs))
            nf = pg.evaluate("[Mascot.debug.nameFill('Смотрите, {ИМЯ}, рынок спокоен.'), Mascot.debug.nameFill('{ИМЯ}, всё по плану.')]")
            if nf[0] == 'Смотрите, Андрей, рынок спокоен.' and nf[1] == 'Андрей, всё по плану.': ok('Орион: имя подставляется в телефоне вместо метки {ИМЯ} — на сервер не уходит')
            else: fail('Орион: имя вместо метки', str(nf))
            # 18.11.2026: долгая память — «запомни, что…», согласие на предложение «мозга», запрет сумм и долгов, копия в аккаунте, «забудь всё»
            pg.evaluate("document.querySelector('.or-cap') && document.querySelector('.or-cap').click()")
            pg.evaluate("Mascot.debug.ask('запомни, что я коплю на квартиру')"); pg.wait_for_timeout(300)
            m1 = pg.evaluate("Mascot.debug.state().said"); l1 = pg.evaluate("Mascot.mem.list().map(x=>x.t)")
            pg.evaluate("Mascot.debug.ask('запомни, что мой долг 5000 долларов')"); pg.wait_for_timeout(300)
            m2 = pg.evaluate("Mascot.debug.state().said"); l2 = pg.evaluate("Mascot.mem.list().map(x=>x.t)")
            if m1.startswith('Запомнил') and 'я коплю на квартиру' in l1 and 'не запоминаю' in m2 and len(l2) == len(l1): ok('Орион: «запомни, что…» — запоминает; суммы и долги — отказывается')
            else: fail('Орион: запомни', f'{m1} | {l1} | {m2} | {l2}')
            MEMO_T = 'Эфир — второй по размеру после биткоина. Рассказать подробнее? ПАМЯТЬ: интересуется эфиром'
            def fm(route):
                sb.append(json.loads(route.request.post_data or '{}'))
                route.fulfill(status=200, headers={'content-type': 'application/x-ndjson; charset=utf-8', 'access-control-allow-origin': '*'}, body='\n'.join(json.dumps(x, ensure_ascii=False) for x in [{'t': MEMO_T}, {'done': True, 'text': MEMO_T, 'sources': []}]) + '\n')
            pg.unroute('**/functions/v1/orion-ask'); pg.route('**/functions/v1/orion-ask', fm)
            pg.evaluate("Mascot.debug.ask('Что такое эфир? Мне он интересен')")
            try: pg.wait_for_function("()=>Mascot.debug.sayLog().some(x=>x.startsWith('Запомнить'))", polling=200, timeout=15000)
            except Exception: pass
            lg = pg.evaluate("Mascot.debug.sayLog()"); ctxm = (sb[-1].get('ctx') or {}).get('mem') if sb else None
            spoke_memo = any('ПАМЯТЬ' in x for x in lg)
            pg.evaluate("Mascot.debug.ask('да')"); pg.wait_for_timeout(300)
            l3 = pg.evaluate("Mascot.mem.list().map(x=>x.t)")
            if 'Запомнить: интересуется эфиром?' in lg and not spoke_memo and 'интересуется эфиром' in l3 and ctxm and 'я коплю на квартиру' in ctxm: ok('Орион: «мозг» предлагает запомнить — строка не звучит, Орион спрашивает «Запомнить?», после «да» — запомнил; память уходит «мозгу» строками')
            else: fail('Орион: согласие на память', f'{lg} | {l3} | {ctxm}')
            bk = pg.evaluate("(async()=>{const db=await window.claude.use('db');const d=await db.doc('app/orion-mem').get();return d.exists?(d.data().items||[]).map(x=>x.t):null})()")
            if bk and 'интересуется эфиром' in bk and 'я коплю на квартиру' in bk: ok('Орион: резервная копия памяти — в аккаунте (app/orion-mem)')
            else: fail('Орион: копия памяти в аккаунте', str(bk))
            pg.evaluate("MLX.memOpen()"); pg.wait_for_timeout(500)
            sh = pg.evaluate("[document.getElementById('xTitle').textContent, document.getElementById('xBody').innerText]")
            if sh[0] == 'Что помнит Орион' and 'я коплю на квартиру' in sh[1] and 'никогда' in sh[1]: ok('Настройки: «Что помнит Орион» — список с кнопкой «Забыть»')
            else: fail('Настройки: память Ориона', str(sh))
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(300)
            pg.evaluate("Mascot.debug.ask('забудь всё')"); pg.wait_for_timeout(300)
            if pg.evaluate("Mascot.mem.list().length") == 0 and 'забыл' in pg.evaluate("Mascot.debug.state().said"): ok('Орион: «забудь всё» — память очищена')
            else: fail('Орион: забудь всё', pg.evaluate("Mascot.debug.state().said"))
            pg.unroute('**/functions/v1/orion-ask')
            # 18.11.2026 (этап 4): голосовые действия — переходы и заметки без сервера, напоминания и покупка через инструменты «мозга», журнал
            n0 = len(sb)
            pg.evaluate("Mascot.debug.ask('открой стратегию')"); pg.wait_for_timeout(500)
            v1 = pg.evaluate("[Mascot.debug.state().said, (document.querySelector('.view:not([hidden])')||{}).dataset.view]")
            pg.evaluate("Mascot.debug.ask('открой настройки')"); pg.wait_for_timeout(600)
            v2 = pg.evaluate("[Mascot.debug.state().said, document.getElementById('setSheet').classList.contains('open')]")
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(300)
            if v1[1] == 'strategy' and 'стратег' in v1[0] and v2[1] and len(sb) == n0: ok('Орион: «открой стратегию», «открой настройки» — открывает сам, без сервера')
            else: fail('Орион: переходы голосом', f'{v1} | {v2} | {len(sb) - n0}')
            pg.evaluate("Mascot.debug.ask('запиши заметку: проверить комиссию на бирже')"); pg.wait_for_timeout(300)
            nt = pg.evaluate("Mascot.tasks.notes().map(x=>x.t)")
            pg.evaluate("Mascot.debug.ask('прочитай заметки')"); pg.wait_for_timeout(300)
            rd = pg.evaluate("Mascot.debug.state().said")
            if 'проверить комиссию на бирже' in nt and 'комиссию' in rd and len(sb) == n0: ok('Орион: «запиши заметку…» и «прочитай заметки» — на телефоне')
            else: fail('Орион: заметки', f'{nt} | {rd}')
            ACTS = {'rem': {'name': 'add_reminder', 'input': {'text': 'проверить портфель', 'when': ''}}, 'buy': {'name': 'record_purchase', 'input': {'sym': 'ETH', 'usd': 200, 'price': 2500}}}
            cur = {'k': 'rem'}
            def fa(route):
                sb.append(json.loads(route.request.post_data or '{}'))
                route.fulfill(status=200, headers={'content-type': 'application/x-ndjson; charset=utf-8', 'access-control-allow-origin': '*'}, body=json.dumps({'done': True, 'text': '', 'act': ACTS[cur['k']], 'sources': []}, ensure_ascii=False) + '\n')
            ACTS['rem']['input']['when'] = pg.evaluate("(()=>{const d=new Date(Date.now()+864e5);d.setHours(9,0,0,0);const p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T09:00'})()")
            pg.route('**/functions/v1/orion-ask', fa)
            pg.evaluate("Mascot.debug.ask('напомни завтра в девять проверить портфель')")
            try: pg.wait_for_function("()=>Mascot.tasks.rem().length>0", polling=200, timeout=8000)
            except Exception: pass
            rs = pg.evaluate("[Mascot.tasks.rem().map(x=>x.t), Mascot.debug.state().said]"); cx = (sb[-1].get('ctx') or {}).get('now') if len(sb) > n0 else None
            if 'проверить портфель' in rs[0] and 'завтра в 9:00' in rs[1] and cx: ok('Орион: «напомни завтра в девять…» — «мозг» вызывает инструмент, телефон ставит напоминание и называет время')
            else: fail('Орион: напоминание', f'{rs} | {cx}')
            cur['k'] = 'buy'
            nb = len(pg.evaluate("S.tx")) if pg.evaluate("typeof S!=='undefined'&&!!S.tx") else -1
            pg.evaluate("Mascot.debug.ask('запиши покупку эфира на 200 долларов по 2500')")
            try: pg.wait_for_function("()=>document.getElementById('actSheet').classList.contains('open')", polling=200, timeout=8000)
            except Exception: pass
            pg.wait_for_timeout(300)
            fb = pg.evaluate("[document.getElementById('actSheet').classList.contains('open'), document.getElementById('oSym').value, document.getElementById('oUsd').value, document.getElementById('oPrice').value, document.getElementById('oQty').value, Mascot.debug.sayLog().slice(-3).join(' | ')]")
            na = len(pg.evaluate("S.tx")) if nb >= 0 else -1
            if fb[0] and fb[1] == 'ETH' and fb[2] == '200' and fb[3] == '2500' and fb[4] in ('0.08', '0.080') and 'Сохранить' in fb[5] and na == nb: ok('Орион: «запиши покупку…» — открывает форму с цифрами, сам не сохраняет (ждёт кнопку)')
            else: fail('Орион: запись покупки', f'{fb} | {nb} → {na}')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(300)
            pg.evaluate("Mascot.debug.remDue('выпить воды', 30*60e3); Mascot.debug.remTick()"); pg.wait_for_timeout(300)
            rt = pg.evaluate("[Mascot.debug.sayLog().slice(-2).join(' | '), Mascot.tasks.rem().filter(x=>x.t==='выпить воды'&&x.done).length]")
            if 'Пропущенное напоминание: выпить воды' in rt[0] and rt[1] == 1: ok('Орион: пропущенное напоминание звучит при открытии и отмечается выполненным')
            else: fail('Орион: срабатывание напоминания', str(rt))
            pg.unroute('**/functions/v1/orion-ask')
            pg.evaluate("MLX.tasksRow && MLX.tasksRow(); MLX.go('tasks')"); pg.wait_for_timeout(700)
            sh = pg.evaluate("[document.getElementById('xTitle').textContent, document.getElementById('xBody').innerText]")
            if sh[0] == 'Дела Ориона' and 'проверить портфель' in sh[1] and 'проверить комиссию' in sh[1] and 'Открыл запись покупки ETH' in sh[1] and 'Открыл: стратегию' in sh[1]: ok('«Дела Ориона»: напоминания, заметки и журнал всех действий по голосу')
            else: fail('«Дела Ориона»', str(sh))
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(300)
            bk = pg.evaluate("(async()=>{const db=await window.claude.use('db');const a=await db.doc('app/orion-notes').get(),b=await db.doc('app/orion-rem').get();return [a.exists?(a.data().items||[]).map(x=>x.t):null,b.exists?(b.data().items||[]).map(x=>x.t):null]})()")
            if bk[0] and 'проверить комиссию на бирже' in bk[0] and bk[1] and 'проверить портфель' in bk[1]: ok('Орион: копия заметок и напоминаний — в аккаунте')
            else: fail('Орион: копия дел в аккаунте', str(bk))
            pg.evaluate("Mascot.debug.ask('сколько у меня биткоина')"); pg.wait_for_timeout(300)
            rq = pg.evaluate("[Mascot.debug.remQ('напомни завтра в девять проверить портфель'), Mascot.debug.remQ('напомни, когда биткоин будет 120000'), Mascot.debug.act('add_reminder', {text:'x', when:'вчера'})]")
            if rq[0] and not rq[1] and 'Не понял' in rq[2]: ok('Орион: «напомни, когда биткоин…» — оповещение о цене, а не напоминание; непонятное время — переспрашивает')
            else: fail('Орион: напоминание или оповещение', str(rq))
            # 18.11.2026: уведомления на телефон — подписка уходит в аккаунт (app/push-subs); без разрешения Орион подсказывает включить
            pg.route('**/functions/v1/orion-push', lambda route: route.fulfill(status=200, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body=json.dumps({'pub': 'BFYQuME9hn7VOtlUCyCLoctugRyAFldcLQMKpvbML5LDX65Qv0JPo0RoPcayQNf-WHZf-on_Bvfw6kgUpL3Feew'})))
            pon = pg.evaluate("[MLX.pushOn(), typeof Notification!=='undefined'&&Notification.permission]")
            tip = pg.evaluate("Mascot.debug.act('add_reminder', {text:'позвонить в банк', when: new Date(Date.now()+3*3600e3).toISOString().slice(0,16)})")
            ps = pg.evaluate("""(async()=>{
              try{Object.defineProperty(Notification,'permission',{configurable:true,get:()=>'granted'});}catch(e){}
              const fake={endpoint:'https://push.example/abc',toJSON(){return{endpoint:this.endpoint,keys:{p256dh:'P',auth:'A'}}},unsubscribe:async()=>true};
              let n=0;const pm={getSubscription:async()=>n?fake:null,subscribe:async()=>{n++;return fake;}};try{Object.defineProperty(navigator.serviceWorker,'getRegistration',{configurable:true,value:async()=>({pushManager:pm})});}catch(e){return ['nosw',String(e)];}
              const ok=await Promise.race([window.mlPushSub(true),new Promise(r=>setTimeout(()=>r('timeout'),5000))]);
              const db=await window.claude.use('db');const d=await db.doc('app/push-subs').get();
              return [ok, d.exists?(d.data().items||[]).map(x=>x.endpoint+'|'+x.keys.auth):null];})()""")
            pg.unroute('**/functions/v1/orion-push')
            if 'Сигналы на телефоне' in rs[1] and 'Сигналы' not in tip and ps[0] is True and ps[1] == ['https://push.example/abc|A']: ok('Уведомления: подписка телефона сохраняется в аккаунте; без уведомлений Орион подсказывает их включить — не чаще раза в 6 часов')
            else: fail('Уведомления: подписка', f'{pon} | {tip} | {ps}')
            # 18.11.2026 (BACKLOG №1): «удали заметку про X» / «отмени напоминание про X» — снимается ровно одна подходящая запись, без совпадения — ничего.
            # 24.11.2026 (решение директора после 4 кругов ревью PR №12): Орион сначала называет запись и спрашивает «Удалить …? Скажите «да» или «нет».» — удаляет только после «да»
            try: pg.wait_for_function("()=>!Mascot.debug.state().talking", polling=200, timeout=20000)   # ответы ниже — не в очередь за напоминанием
            except Exception: pass
            dn = pg.evaluate("""(async()=>{const M=Mascot.debug,T=Mascot.tasks,said=()=>M.state().said,keep=new Set(T.notes().map(x=>x.id)),keepR=new Set(T.rem().map(x=>x.id));
              for(const n of ['купить ETH в пятницу','оплатить налоги до 15-го','позвонить брокеру']) await M.ask('запиши заметку: '+n);
              const n0=T.notes().map(x=>x.t); await M.ask('удали заметку про налоги'); const a1=T.notes().map(x=>x.t), q1=said(); await M.ask('да'); const n1=T.notes().map(x=>x.t), s1=said();
              await M.ask('удали заметку про отпуск'); const n2=T.notes().map(x=>x.t), s2=said(), p2=M.pendDel();
              await M.ask('запиши заметку: временная'); await M.ask('удали заметку'); const n3=T.notes().map(x=>x.t), s3=said();
              const w=h=>new Date(Date.now()+h*3600e3).toISOString().slice(0,16);
              M.act('add_reminder',{text:'зайти на биржу и проверить ордера',when:w(5)}); M.act('add_reminder',{text:'купить подарок маме',when:w(6)}); M.act('add_reminder',{text:'полить цветы',when:w(7)});
              const r0=T.rem().filter(x=>!x.done).map(x=>x.t); await M.ask('отмени напоминание про биржу'); const ra=T.rem().filter(x=>!x.done).map(x=>x.t), q4=said(); await M.ask('да'); const r1=T.rem().filter(x=>!x.done).map(x=>x.t), s4=said();
              await M.ask('отмени напоминание про отпуск'); const r2=T.rem().filter(x=>!x.done).map(x=>x.t), s5=said();
              T.notes().filter(x=>!keep.has(x.id)).forEach(x=>T.delNote(x.id)); T.rem().filter(x=>!keepR.has(x.id)).forEach(x=>T.delRem(x.id));
              return {n0,a1,q1,n1,s1,n2,s2,p2,n3,s3,r0,ra,q4,r1,s4,r2,s5,after:[T.notes().map(x=>x.t),T.rem().map(x=>x.t)]};})()""")
            gone = lambda a, b: [x for x in a if x not in b]
            if (dn['a1'] == dn['n0'] and dn['q1'] == 'Удалить заметку «оплатить налоги до 15-го»? Скажите «да» или «нет».'
                    and gone(dn['n0'], dn['n1']) == ['оплатить налоги до 15-го'] and len(dn['n1']) == len(dn['n0']) - 1 and 'проверить комиссию на бирже' in dn['n1'] and dn['s1'] == 'Удалил: «оплатить налоги до 15-го».'
                    and dn['n2'] == dn['n1'] and dn['s2'] == 'Не нашёл заметку про отпуск.' and dn['p2'] is None and dn['n3'] == dn['n1'] and dn['s3'] == 'Удалил: временная.'
                    and dn['ra'] == dn['r0'] and dn['q4'] == 'Отменить напоминание «зайти на биржу и проверить ордера»? Скажите «да» или «нет».'
                    and gone(dn['r0'], dn['r1']) == ['зайти на биржу и проверить ордера'] and len(dn['r1']) == len(dn['r0']) - 1 and 'проверить портфель' in dn['r1'] and 'позвонить в банк' in dn['r1']
                    and dn['s4'] == 'Отменил напоминание: «зайти на биржу и проверить ордера».' and dn['r2'] == dn['r1'] and dn['s5'] == 'Не нашёл напоминание про отпуск.'
                    and 'проверить комиссию на бирже' in dn['after'][0] and 'позвонить в банк' in dn['after'][1]):
                ok('Орион: «удали заметку про налоги», «отмени напоминание про биржу» — Орион называет запись и ждёт «да», после «да» из трёх снята ровно одна нужная; нет совпадения — ничего не удалено; без «про» — как раньше')
            else: fail('Орион: удаление по теме', str(dn))
            # 24.11.2026 (BACKLOG №1, решение директора): «про X» только выбирает кандидата. «да» в течение 20 с — снимается ровно названная запись по id;
            # «нет», молчание 20 с, другой вопрос, «да» без вопроса — ничего не удалено. «Чужие» случаи из ревью («про прибыль» → «прибыл ли перевод», «про сталь» → «стал дороже»)
            cf = pg.evaluate("""(async()=>{const M=Mascot.debug,T=Mascot.tasks,said=()=>M.state().said,keep=new Set(T.notes().map(x=>x.id)),keepR=new Set(T.rem().map(x=>x.id)),out={};
              const mine=()=>T.notes().filter(x=>!keep.has(x.id)).map(x=>x.t), act=()=>T.rem().filter(x=>!x.done&&!keepR.has(x.id)).map(x=>x.t), w=h=>new Date(Date.now()+h*3600e3).toISOString().slice(0,16);
              for(const n of ['прибыл ли перевод от Саши','BTC стал дороже','купить банки огурцов','зафиксировать прибыль по SOL']) await M.ask('запиши заметку: '+n);
              let b=mine(); await M.ask('удали заметку про прибыль'); let q=said(), mid=mine(), pd=M.pendDel(); await M.ask('да'); out.p=[b,q,mid,said(),mine(),pd&&pd.t];
              b=mine(); await M.ask('удали заметку про сталь'); q=said(); mid=mine(); await M.ask('нет'); out.stal=[b,q,mid,said(),mine(),M.pendDel()];
              await M.ask('запиши заметку: оплатить налоги до 15-го');
              b=mine(); await M.ask('удали заметку про налоги'); q=said(); await M.ask('нет'); out.no=[b,q,said(),mine(),M.pendDel()];
              b=mine(); await M.ask('удали заметку про налоги'); q=said(); await M.ask('не надо'); out.no2=[b,q,said(),mine()];
              b=mine(); await M.ask('удали заметку про налоги'); q=said(); M.pendAge(21); await M.ask('да'); out.wait=[b,q,mine(),M.pendDel()];
              b=mine(); await M.ask('удали заметку про налоги'); M.pendAge(21); await M.ask('удали'); out.wait2=[b,mine()];
              b=mine(); await M.ask('удали заметку про налоги'); M.pendAge(21); await M.ask('удали заметку'); out.wait3=[b,mine(),said()];
              b=mine(); await M.ask('удали заметку про налоги'); M.pendAge(90); await M.ask('да'); out.wait4=[b,mine()];
              b=mine(); await M.ask('да'); out.yes0=[b,mine(),M.pendDel()];
              b=mine(); await M.ask('удали заметку про налоги'); await M.ask('какие у меня заметки'); const s6=said(); await M.ask('да'); out.other=[b,mine(),s6,M.pendDel()];
              b=mine(); await M.ask('удали заметку про налоги'); q=said(); M.pendAge(18); await M.ask('давай'); out.late=[b,q,said(),mine()];
              M.act('add_reminder',{text:'позвонить брокеру про комиссию',when:w(5)}); M.act('add_reminder',{text:'BTC стал дороже — проверить ступени',when:w(6)});
              let r=act(); await M.ask('отмени напоминание про сталь'); q=said(); await M.ask('ні'); out.rn=[r,q,said(),act()];
              r=act(); await M.ask('отмени напоминание про сталь'); M.pendAge(21); await M.ask('отмени напоминание'); out.rlate=[r,act(),said()];
              r=act(); await M.ask('отмени напоминание про сталь'); await M.ask('убери напоминание'); out.rub=[r,act(),said()];
              r=act(); await M.ask('отмени напоминание про сталь'); M.pendAge(21); await M.ask('отмени напоминания'); out.rmn=[r,act(),said()];
              b=mine(); await M.ask('удали заметку про сталь'); await M.ask('удали последнюю заметку'); out.wlast=[b,mine(),said()];
              r=act(); await M.ask('отмени напоминание про брокера'); q=said(); await M.ask('да, отмени'); out.ry=[r,q,said(),act()];
              // ревью Глеба 24.11, круг 3: «отмени» на вопрос про заметку, ответ с названием записи другого вида, другой вопрос между вопросом и «голой» командой
              const both=()=>[mine(),act()];
              let z=both(); await M.ask('удали заметку про сталь'); await M.ask('отмени'); out.g1=[z,both()];
              z=both(); await M.ask('удали заметку про сталь'); await M.ask('отмени напоминание'); out.g2=[z,both(),said()];
              z=both(); await M.ask('отмени напоминание про сталь'); await M.ask('удали заметку'); out.g3=[z,both(),said()];
              z=both(); await M.ask('удали заметку про сталь'); await M.ask('какие у меня заметки'); await M.ask('удали заметку'); out.g4=[z,both(),said()];
              z=both(); await M.ask('отмени напоминание про сталь'); await M.ask('какие у меня напоминания'); await M.ask('отмени напоминание'); out.g5=[z,both(),said()];
              z=both(); await M.ask('отмени напоминание про сталь'); await M.ask('скасуй'); out.g6=[z,both(),said()];
              z=both(); await M.ask('удали заметку про сталь'); await M.ask('не понял'); await M.ask('удали заметку'); out.g8=[z,both(),said()];
              z=both(); await M.ask('удали заметку про сталь'); await M.ask('не слышу, повтори'); await M.ask('удали последнюю заметку'); out.g9=[z,both(),said()];
              z=both(); await M.ask('удали заметку про сталь'); await M.ask('нет'); await M.ask('удали заметку'); out.g10=[z,both(),said()];
              await M.ask('удали заметку про сталь'); await M.ask('нет, не удаляй'); M.pendAge(121); await M.ask('запиши заметку: временная2'); z=mine(); await M.ask('удали заметку'); out.g7=[z,mine(),said()];
              T.notes().filter(x=>!keep.has(x.id)).forEach(x=>T.delNote(x.id)); T.rem().filter(x=>!keepR.has(x.id)).forEach(x=>T.delRem(x.id)); return out;})()""")
            askm = lambda q: (re.match(r'^(?:Удалить заметку|Отменить напоминание) «(.+)»\? Скажите «да» или «нет»\.$', q or '') or [None, None])[1]
            p = cf['p']; named = askm(p[1])
            cbad = []
            if not (named and p[2] == p[0] and p[5] == named and gone(p[0], p[4]) == [named] and len(p[4]) == len(p[0]) - 1 and p[3] == f'Удалил: «{named}».'): cbad.append(('прибыль+да', p))
            if named != 'зафиксировать прибыль по SOL': cbad.append(('прибыль: назван не тот кандидат', named))
            st = cf['stal']
            if not (st[1] == 'Удалить заметку «BTC стал дороже»? Скажите «да» или «нет».' and st[2] == st[0] and st[3] == 'Хорошо, оставил.' and st[4] == st[0] and st[5] is None): cbad.append(('сталь+нет', st))
            no = cf['no']
            if not (no[1] == 'Удалить заметку «оплатить налоги до 15-го»? Скажите «да» или «нет».' and no[2] == 'Хорошо, оставил.' and no[3] == no[0] and no[4] is None): cbad.append(('налоги+нет', no))
            if not (cf['no2'][2] == 'Хорошо, оставил.' and cf['no2'][3] == cf['no2'][0]): cbad.append(('налоги+не надо', cf['no2']))
            wt = cf['wait']
            if not (wt[1].startswith('Удалить заметку «оплатить налоги') and wt[2] == wt[0] and wt[3] is None): cbad.append(('20 с молчания, потом «да»', wt))
            if cf['wait2'][1] != cf['wait2'][0]: cbad.append(('20 с молчания, потом «удали»', cf['wait2']))
            if not (cf['wait3'][1] == cf['wait3'][0] and cf['wait3'][2].startswith('Я уже не жду ответа')): cbad.append(('21 с, потом «удали заметку» — последняя не снята', cf['wait3']))
            if cf['wait4'][1] != cf['wait4'][0]: cbad.append(('90 с, потом «да»', cf['wait4']))
            for k, nm in (('rub', 'сразу «убери напоминание»'), ('rmn', '21 с, потом «отмени напоминания»'), ('wlast', 'сразу «удали последнюю заметку»')):
                if not (cf[k][1] == cf[k][0] and cf[k][2].startswith('Я уже не жду ответа')): cbad.append((nm + ' — ничего не снято', cf[k]))
            if not (cf['rlate'][1] == cf['rlate'][0] and len(cf['rlate'][1]) >= 2 and cf['rlate'][2].startswith('Я уже не жду ответа')): cbad.append(('21 с, потом «отмени напоминание» — все напоминания целы', cf['rlate']))
            if not (cf['yes0'][1] == cf['yes0'][0] and cf['yes0'][2] is None): cbad.append(('«да» без вопроса', cf['yes0']))
            ot = cf['other']
            if not (ot[1] == ot[0] and ot[2].startswith('Последние заметки') and ot[3] is None): cbad.append(('другой вопрос, потом «да»', ot))
            lt = cf['late']
            if not (lt[2] == 'Удалил: «оплатить налоги до 15-го».' and gone(lt[0], lt[3]) == ['оплатить налоги до 15-го'] and len(lt[3]) == len(lt[0]) - 1): cbad.append(('«давай» через 18 с', lt))
            rn = cf['rn']
            if not (rn[1] == 'Отменить напоминание «BTC стал дороже — проверить ступени»? Скажите «да» или «нет».' and rn[2] == 'Хорошо, оставил.' and rn[3] == rn[0]): cbad.append(('напоминание+ні', rn))
            ry = cf['ry']
            if not (ry[1] == 'Отменить напоминание «позвонить брокеру про комиссию»? Скажите «да» или «нет».' and ry[2] == 'Отменил напоминание: «позвонить брокеру про комиссию».' and gone(ry[0], ry[3]) == ['позвонить брокеру про комиссию'] and len(ry[3]) == len(ry[0]) - 1): cbad.append(('напоминание+да', ry))
            for k in ('g1', 'g2', 'g3', 'g4', 'g5'):
                if cf[k][1] != cf[k][0] or not cf[k][0][0] or not cf[k][0][1]: cbad.append((k + ': ничего не должно быть снято', cf[k]))
            for k in ('g8', 'g9', 'g10'):
                if cf[k][1] != cf[k][0] or not str(cf[k][2]).startswith('Я уже не жду ответа'): cbad.append((k + ': «не понял» / «нет», потом «голая» команда — ничего не снято', cf[k]))
            for k in ('g2', 'g3', 'g4', 'g5'):
                if not str(cf[k][2]).startswith('Я уже не жду ответа'): cbad.append((k + ': нет «Я уже не жду ответа»', cf[k][2]))
            g6 = cf['g6']
            if not (g6[2] == 'Отменил напоминание: «BTC стал дороже — проверить ступени».' and gone(g6[0][1], g6[1][1]) == ['BTC стал дороже — проверить ступени'] and g6[1][0] == g6[0][0]): cbad.append(('напоминание+«скасуй» — снято ровно одно', g6))
            g7 = cf['g7']
            if not (g7[2] == 'Удалил: временная2.' and gone(g7[0], g7[1]) == ['временная2']): cbad.append(('после «нет» «удали заметку» — как раньше', g7))
            if not cbad: ok('Орион: «удали заметку про прибыль» → «Удалить заметку «…»?» → «да» — снята ровно названная, остальные целы; «про сталь» назвал «BTC стал дороже» → «нет» — цела; «нет», «не надо», 20 с молчания, другой вопрос, «да» без вопроса — ничего не удалено; напоминания — так же')
            else: fail('Орион: удаление с переспросом', str(cbad)[:1500])
            fr = pg.evaluate("""(async()=>{const M=Mascot.debug,T=Mascot.tasks,keep=new Set(T.notes().map(x=>x.id));
              for(const n of ['налоги за прошлый год','сверить налоговую декларацию','купить SOL','заплатить налог за квартиру']) await M.ask('запиши заметку: '+n);
              await M.ask('удали заметку про налоги'); const q=M.state().said; await M.ask('да'); const r=T.notes().filter(x=>!keep.has(x.id)).map(x=>x.t); T.notes().filter(x=>!keep.has(x.id)).forEach(x=>T.delNote(x.id)); return [q,r];})()""")
            if fr == ['Удалить заметку «заплатить налог за квартиру»? Скажите «да» или «нет».', ['налоги за прошлый год', 'сверить налоговую декларацию', 'купить SOL']]: ok('Орион: подходят несколько заметок — называет и после «да» снимает самую свежую («налог» по слову «налоги»), «налоговую декларацию» не трогает')
            else: fail('Орион: удаление самой свежей подходящей', str(fr))
            # ревью Глеба (PR №12): короткие слова не обрезаются — «про долг» не снимает «долларов», «про план» — не «оплатить платеж», «банк» — не «банан», «газ» — не «газета»
            sw = pg.evaluate("""(async()=>{const M=Mascot.debug,T=Mascot.tasks,said=()=>M.state().said,keep=new Set(T.notes().map(x=>x.id)),keepR=new Set(T.rem().map(x=>x.id)),out={};
              for(const n of ['купить на 100 долларов BTC','оплатить платеж за квартиру','купить банан','почитать газету']) await M.ask('запиши заметку: '+n);
              const n0=T.notes().map(x=>x.t);
              for(const w of ['долг','план','банк','газ']){await M.ask('удали заметку про '+w); out[w]=[said(), T.notes().length===n0.length];}
              await M.ask('запиши заметку: вернуть долги Саше'); await M.ask('удали заметку про долг'); const qd=said(), kd=T.notes().some(x=>x.t==='вернуть долги Саше'); await M.ask('да'); out.dolgi=[qd, kd, said(), T.notes().some(x=>x.t==='вернуть долги Саше')];
              const w=h=>new Date(Date.now()+h*3600e3).toISOString().slice(0,16), r0=T.rem().filter(x=>!x.done).length;
              M.act('add_reminder',{text:'оплатить платеж за квартиру',when:w(5)}); await M.ask('отмени напоминание про план'); out.rem=[said(), T.rem().filter(x=>!x.done).length===r0+1];
              T.notes().filter(x=>!keep.has(x.id)).forEach(x=>T.delNote(x.id)); T.rem().filter(x=>!keepR.has(x.id)).forEach(x=>T.delRem(x.id)); return out;})()""")
            if (all(sw[k] == [f'Не нашёл заметку про {k}.', True] for k in ['долг', 'план', 'банк', 'газ']) and sw['dolgi'] == ['Удалить заметку «вернуть долги Саше»? Скажите «да» или «нет».', True, 'Удалил: «вернуть долги Саше».', False]
                    and sw['rem'] == ['Не нашёл напоминание про план.', True]):
                ok('Орион: короткие слова — целиком: «про долг» не снимает заметку про доллары, «про план» — про платёж, «банк» — не «банан», «газ» — не «газета»; «долг» находит «долги»')
            else: fail('Орион: удаление по короткому слову', str(sw))
            # ревью Глеба (PR №12, второй круг): после основы длинного слова — только окончание; «почти», «долго» — никогда не совпадение
            ln = pg.evaluate("""(async()=>{const M=Mascot.debug,T=Mascot.tasks,said=()=>M.state().said,keep=new Set(T.notes().map(x=>x.id)),keepR=new Set(T.rem().map(x=>x.id)),out={neg:{},pos:{}};
              const NEG=[['почту','почти закончил отчёт'],['карты','купить картошку'],['долги','долгосрочный план'],['банки','заказать банкет'],['налог','наложенный платёж'],['долг','долго ждал перевод']];
              for(const [,n] of NEG) await M.ask('запиши заметку: '+n);
              const n0=T.notes().length;
              for(const [w] of NEG){await M.ask('удали заметку про '+w); out.neg[w]=[said(), T.notes().length===n0];}
              const w=h=>new Date(Date.now()+h*3600e3).toISOString().slice(0,16), r0=T.rem().filter(x=>!x.done).length;
              M.act('add_reminder',{text:'составить долгосрочный план',when:w(5)}); await M.ask('отмени напоминание про долги'); out.rem=[said(), T.rem().filter(x=>!x.done).length===r0+1];
              T.notes().filter(x=>!keep.has(x.id)).forEach(x=>T.delNote(x.id));
              const POS=[['налоги','заплатить налогов'],['налоги','налоги до 1 мая'],['биржу','проверить комиссию на бирже'],['карты','заблокировать карту monobank'],['долг','вернуть долги'],['почту','сходить на почту']];
              for(const [q,n] of POS){await M.ask('запиши заметку: '+n); const c=T.notes().length; await M.ask('удали заметку про '+q); const a=said(), k=T.notes().length===c; await M.ask('да'); out.pos[q+'|'+n]=[a, k, said(), T.notes().length===c-1 && !T.notes().some(x=>!keep.has(x.id)&&x.t===n)];}
              M.act('add_reminder',{text:'зайти на биржу',when:w(6)}); const r1=T.rem().filter(x=>!x.done).length; await M.ask('отмени напоминание про биржу'); const qa=said(), ka=T.rem().filter(x=>!x.done).length===r1; await M.ask('да'); out.rem2=[qa, ka, said(), T.rem().filter(x=>!x.done).length===r1-1];
              T.notes().filter(x=>!keep.has(x.id)).forEach(x=>T.delNote(x.id)); T.rem().filter(x=>!keepR.has(x.id)).forEach(x=>T.delRem(x.id)); return out;})()""")
            NEG = ['почту', 'карты', 'долги', 'банки', 'налог', 'долг']
            if (all(ln['neg'].get(k) == [f'Не нашёл заметку про {k}.', True] for k in NEG) and ln['rem'] == ['Не нашёл напоминание про долги.', True]
                    and len(ln['pos']) == 6 and all(v == [f"Удалить заметку «{k.split('|')[1]}»? Скажите «да» или «нет».", True, f"Удалил: «{k.split('|')[1]}».", True] for k, v in ln['pos'].items())
                    and ln['rem2'] == ['Отменить напоминание «зайти на биржу»? Скажите «да» или «нет».', True, 'Отменил напоминание: «зайти на биржу».', True]):
                ok('Орион: «про почту» не снимает «почти…», «карты» — «картошку», «долги» — «долгосрочный», «банки» — «банкет», «налог» — «наложенный», «долг» — «долго»; «налоги» — «налогов», «биржу» — «на бирже», «карты» — «карту»')
            else: fail('Орион: удаление по длинному слову', str(ln))
            # ревью Глеба (PR №12, третий круг): после основы — только окончание существительного (прилагательное — лишь через «-ов/-ев»); «стало» — не «сталь»; «про» без слова — переспрос
            l3 = pg.evaluate("""(async()=>{const M=Mascot.debug,T=Mascot.tasks,said=()=>M.state().said,keep=new Set(T.notes().map(x=>x.id)),keepR=new Set(T.rem().map(x=>x.id)),out={neg:{},pos:{}};
              const NEG=[['долг','долгий звонок брокеру'],['долги','долгая очередь в банке'],['долг','долгое ожидание вывода'],['газ','постричь газон'],['дом','продлить домен'],['сало','записаться в салон'],['рис','снизить риск портфеля'],['сталь','стало лучше']];
              for(const [,n] of NEG) await M.ask('запиши заметку: '+n);
              const n0=T.notes().length;
              for(const [q,n] of NEG){await M.ask('удали заметку про '+q); out.neg[q+'|'+n]=[said(), T.notes().length===n0];}
              await M.ask('удали заметку про'); out.empty=[said(), T.notes().length===n0];
              const w=h=>new Date(Date.now()+h*3600e3).toISOString().slice(0,16), r0=T.rem().filter(x=>!x.done).length;
              M.act('add_reminder',{text:'долгий звонок брокеру',when:w(5)}); await M.ask('отмени напоминание про долги'); out.rem=[said(), T.rem().filter(x=>!x.done).length===r0+1];
              await M.ask('отмени напоминание про'); out.remEmpty=[said(), T.rem().filter(x=>!x.done).length===r0+1];
              T.notes().filter(x=>!keep.has(x.id)).forEach(x=>T.delNote(x.id));
              const POS=[['газ','оплатить газ'],['долги','вернуть долги'],['налоги','заплатить налогов'],['налоговую','сверить налоговую декларацию'],['биржу','проверить комиссию на бирже'],['карты','заблокировать карту monobank'],['почту','сходить на почту']];
              for(const [q,n] of POS){await M.ask('запиши заметку: '+n); const c=T.notes().length; await M.ask('удали заметку про '+q); const a=said(), k=T.notes().length===c; await M.ask('да'); out.pos[q+'|'+n]=[a, k, said(), T.notes().length===c-1 && !T.notes().some(x=>!keep.has(x.id)&&x.t===n)];}
              T.notes().filter(x=>!keep.has(x.id)).forEach(x=>T.delNote(x.id)); T.rem().filter(x=>!keepR.has(x.id)).forEach(x=>T.delRem(x.id)); return out;})()""")
            if (len(l3['neg']) == 8 and all(v == [f"Не нашёл заметку про {k.split('|')[0]}.", True] for k, v in l3['neg'].items())
                    and l3['empty'] == ['Про что удалить заметку?', True] and l3['rem'] == ['Не нашёл напоминание про долги.', True] and l3['remEmpty'] == ['Про что отменить напоминание?', True]
                    and len(l3['pos']) == 7 and all(v == [f"Удалить заметку «{k.split('|')[1]}»? Скажите «да» или «нет».", True, f"Удалил: «{k.split('|')[1]}».", True] for k, v in l3['pos'].items())):
                ok('Орион: «долг» не снимает «долгий/долгая/долгое…», «газ» — «газон», «дом» — «домен», «сало» — «салон», «рис» — «риск», «сталь» — «стало»; «удали заметку про» без слова — переспрос, ничего не удалено; «газ» находит «оплатить газ»')
            else: fail('Орион: удаление по теме — окончания', str(l3))
            # О.2 (25.11.2026, Глеб): «о налогах», «об отпуске», «насчёт банка», укр. «щодо / стосовно» — как «про»: Орион называет нужную запись и ждёт «да»;
            # нет совпадения — ничего не удалено (раньше без «про» удалялась последняя заметка / снимались ВСЕ напоминания)
            o2 = pg.evaluate("""(async()=>{const M=Mascot.debug,T=Mascot.tasks,said=()=>M.state().said,keep=new Set(T.notes().map(x=>x.id)),keepR=new Set(T.rem().map(x=>x.id)),out={n:{},r:{}};
              const clean=()=>{T.notes().filter(x=>!keep.has(x.id)).forEach(x=>T.delNote(x.id)); T.rem().filter(x=>!keepR.has(x.id)).forEach(x=>T.delRem(x.id));};
              const mine=()=>T.notes().filter(x=>!keep.has(x.id)).map(x=>x.t), act=()=>T.rem().filter(x=>!x.done).map(x=>x.t), w=h=>new Date(Date.now()+h*3600e3).toISOString().slice(0,16);
              const NC=[['удали заметку о налогах','оплатить налоги до 15-го'],['удали заметку об отпуске','взять отпуск в марте'],['удали заметку насчёт налогов','оплатить налоги до 15-го'],['удали заметку насчет отпуска','взять отпуск в марте'],
                ['удали заметку щодо податків','сплата податків за рік'],['удали заметку стосовно податків','сплата податків за рік'],['Удали заметку О налогах.','оплатить налоги до 15-го']];
              for(const [q,n] of NC){for(const x of ['купить ETH в пятницу','оплатить налоги до 15-го','взять отпуск в марте','сплата податків за рік','позвонить брокеру']) await M.ask('запиши заметку: '+x);
                const b=mine(); await M.ask(q); const a=said(), mid=mine(); await M.ask('да'); out.n[q]=[a, mid.length===b.length, said(), JSON.stringify(b.filter(x=>!mine().includes(x)))===JSON.stringify([n]) && mine().length===b.length-1]; clean();}
              for(const x of ['купить ETH в пятницу','позвонить брокеру']) await M.ask('запиши заметку: '+x);
              let b=mine(); await M.ask('удали заметку о машине'); out.nmiss=[said(), JSON.stringify(mine())===JSON.stringify(b), M.pendDel()];
              b=mine(); await M.ask('удали заметку насчёт отпуска'); out.nmiss2=[said(), JSON.stringify(mine())===JSON.stringify(b)];
              b=mine(); await M.ask('удали заметку о'); out.ncut=[said(), JSON.stringify(mine())===JSON.stringify(b)];
              clean(); M.pendAge(200);
              const RC=[['отмени напоминание насчёт банка','позвонить в банк насчёт карты'],['отмени напоминание о цветах','полить цветы'],['отмени напоминание щодо податків','сплата податків'],['отмени напоминание стосовно цветов','полить цветы']];
              for(const [q,n] of RC){for(const x of ['позвонить в банк насчёт карты','полить цветы','сплата податків']) M.act('add_reminder',{text:x,when:w(5)});
                const r=act(); await M.ask(q); const a=said(), mid=act(); await M.ask('да'); const r2=act(); out.r[q]=[a, mid.length===r.length, said(), r2.length===r.length-1 && r.filter(x=>x===n).length-r2.filter(x=>x===n).length===1]; clean();}
              for(const x of ['позвонить в банк насчёт карты','полить цветы']) M.act('add_reminder',{text:x,when:w(5)});
              let r=act(); await M.ask('отмени напоминание насчёт отпуска'); out.rmiss=[said(), act().length===r.length, act().length>=2, M.pendDel()];
              r=act(); await M.ask('отмени напоминание о'); out.rcut=[said(), act().length===r.length];
              clean(); M.pendAge(200); return out;})()""")
            o2bad = []
            for q, v in o2['n'].items():
                n = 'сплата податків за рік' if ('щодо' in q or 'стосовно' in q) else ('взять отпуск в марте' if 'отпуск' in q else 'оплатить налоги до 15-го')
                if v != [f'Удалить заметку «{n}»? Скажите «да» или «нет».', True, f'Удалил: «{n}».', True]: o2bad.append((q, v))
            for q, v in o2['r'].items():
                n = 'позвонить в банк насчёт карты' if 'банка' in q else ('сплата податків' if 'щодо' in q else 'полить цветы')
                if v != [f'Отменить напоминание «{n}»? Скажите «да» или «нет».', True, f'Отменил напоминание: «{n}».', True]: o2bad.append((q, v))
            if len(o2['n']) != 7 or len(o2['r']) != 4: o2bad.append(('число случаев', len(o2['n']), len(o2['r'])))
            if o2['nmiss'] != ['Не нашёл заметку о машине.', True, None]: o2bad.append(('нет совпадения «о машине»', o2['nmiss']))
            if o2['nmiss2'] != ['Не нашёл заметку насчёт отпуска.', True]: o2bad.append(('нет совпадения «насчёт отпуска»', o2['nmiss2']))
            if o2['ncut'] != ['Про что удалить заметку?', True]: o2bad.append(('«удали заметку о» без слова', o2['ncut']))
            if o2['rmiss'] != ['Не нашёл напоминание насчёт отпуска.', True, True, None]: o2bad.append(('напоминание «насчёт отпуска» — все целы', o2['rmiss']))
            if o2['rcut'] != ['Про что отменить напоминание?', True]: o2bad.append(('«отмени напоминание о» без слова', o2['rcut']))
            if not o2bad: ok('Орион: «удали заметку о налогах / об отпуске / насчёт …», «щодо / стосовно …», «отмени напоминание насчёт банка / о цветах» — как «про»: называет нужную, после «да» снята ровно она; нет совпадения — ничего не удалено, напоминания все целы')
            else: fail('Орион: удаление по теме с «о / об / насчёт / щодо / стосовно»', str(o2bad)[:1500])
            # О.3 (25.11.2026, Глеб): после «Не нашёл заметку про …» / «Про что…?» «голая» «удали заметку» не удаляет последнюю сразу — Орион называет её и ждёт «да»;
            # «отмени напоминания» после «Не нашёл напоминание…» все не снимает. Защита — 2 минуты по времени; после них — как раньше
            o3 = pg.evaluate("""(async()=>{const M=Mascot.debug,T=Mascot.tasks,said=()=>M.state().said,keep=new Set(T.notes().map(x=>x.id)),keepR=new Set(T.rem().map(x=>x.id)),out={};
              const clean=()=>{T.notes().filter(x=>!keep.has(x.id)).forEach(x=>T.delNote(x.id)); T.rem().filter(x=>!keepR.has(x.id)).forEach(x=>T.delRem(x.id));};
              const mine=()=>T.notes().filter(x=>!keep.has(x.id)).map(x=>x.t), act=()=>T.rem().filter(x=>!x.done).map(x=>x.t), w=h=>new Date(Date.now()+h*3600e3).toISOString().slice(0,16);
              M.pendAge(200);
              for(const x of ['купить ETH в пятницу','позвонить брокеру','сверить ступени','продлить домен']) await M.ask('запиши заметку: '+x);
              let b=mine(); await M.ask('удали заметку про отпуск'); const s0=said(); await M.ask('удали заметку'); let q=said(), mid=mine(); await M.ask('да'); out.miss=[s0,q,JSON.stringify(mid)===JSON.stringify(b),said(),JSON.stringify(b.filter(x=>!mine().includes(x)))];
              b=mine(); await M.ask('удали заметку про'); const s1=said(); await M.ask('удали заметку'); q=said(); mid=mine(); await M.ask('да'); out.empty=[s1,q,JSON.stringify(mid)===JSON.stringify(b),said(),JSON.stringify(b.filter(x=>!mine().includes(x)))];
              b=mine(); await M.ask('удали заметку про отпуск'); await M.ask('удали последнюю заметку'); q=said(); await M.ask('нет'); out.last=[q,said(),JSON.stringify(mine())===JSON.stringify(b)];
              M.pendAge(121);
              b=mine(); await M.ask('удали заметку о машине'); M.pendAge(121); await M.ask('удали заметку'); out.late=[said(),JSON.stringify(b.filter(x=>!mine().includes(x)))];
              clean(); M.pendAge(200);
              for(const x of ['позвонить в банк насчёт карты','полить цветы']) M.act('add_reminder',{text:x,when:w(5)});
              let r=act(); await M.ask('отмени напоминание про отпуск'); await M.ask('отмени напоминания'); out.rall=[said(),JSON.stringify(act())===JSON.stringify(r),r.length>=2];
              r=act(); await M.ask('отмени напоминание про отпуск'); await M.ask('убери напоминание'); out.rall2=[said(),JSON.stringify(act())===JSON.stringify(r)];
              clean(); M.pendAge(200);
              // круг 2 (Глеб): промах по напоминанию не снимает защиту после промаха по заметке — и наоборот
              for(const x of ['купить ETH в пятницу','позвонить брокеру']) await M.ask('запиши заметку: '+x);
              for(const x of ['полить цветы','купить подарок маме']) M.act('add_reminder',{text:x,when:w(5)});
              b=mine(); r=act(); await M.ask('удали заметку о даче'); await M.ask('отмени напоминание о даче'); await M.ask('удали заметку'); q=said(); const pk=(M.pendDel()||{}).kind; await M.ask('нет'); out.mix=[q,pk,said(),JSON.stringify(mine())===JSON.stringify(b),JSON.stringify(act())===JSON.stringify(r)];
              M.pendAge(200); b=mine(); r=act(); await M.ask('отмени напоминание о даче'); await M.ask('удали заметку о даче'); await M.ask('отмени напоминания'); out.mix2=[said(),JSON.stringify(mine())===JSON.stringify(b),JSON.stringify(act())===JSON.stringify(r)];
              clean(); M.pendAge(200); return out;})()""")
            o3bad = []
            if o3['miss'] != ['Не нашёл заметку про отпуск.', 'Удалить заметку «продлить домен»? Скажите «да» или «нет».', True, 'Удалил: «продлить домен».', '["продлить домен"]']: o3bad.append(('«Не нашёл» → «удали заметку» → переспрос → «да»', o3['miss']))
            if o3['empty'] != ['Про что удалить заметку?', 'Удалить заметку «сверить ступени»? Скажите «да» или «нет».', True, 'Удалил: «сверить ступени».', '["сверить ступени"]']: o3bad.append(('«Про что…?» → «удали заметку» → переспрос → «да»', o3['empty']))
            if o3['last'] != ['Удалить заметку «позвонить брокеру»? Скажите «да» или «нет».', 'Хорошо, оставил.', True]: o3bad.append(('«Не нашёл» → «удали последнюю заметку» → «нет» — цела', o3['last']))
            if o3['late'] != ['Удалил: позвонить брокеру.', '["позвонить брокеру"]']: o3bad.append(('через 2 минуты — как раньше', o3['late']))
            if o3['rall'] != ['Все напоминания не отменяю. Скажите: «отмени напоминание про …».', True, True]: o3bad.append(('«Не нашёл напоминание» → «отмени напоминания» — все целы', o3['rall']))
            if o3['rall2'] != ['Все напоминания не отменяю. Скажите: «отмени напоминание про …».', True]: o3bad.append(('«Не нашёл напоминание» → «убери напоминание» — все целы', o3['rall2']))
            if o3['mix'] != ['Удалить заметку «позвонить брокеру»? Скажите «да» или «нет».', 'notes', 'Хорошо, оставил.', True, True]: o3bad.append(('промах по заметке, затем по напоминанию → «удали заметку» — переспрос, ничего не снято', o3['mix']))
            if o3['mix2'] != ['Все напоминания не отменяю. Скажите: «отмени напоминание про …».', True, True]: o3bad.append(('промах по напоминанию, затем по заметке → «отмени напоминания» — все целы', o3['mix2']))
            if not o3bad: ok('Орион: после «Не нашёл заметку про …» / «Про что…?» «удали заметку» не удаляет последнюю сразу — называет её и ждёт «да»; «отмени напоминания» все не снимает; через 2 минуты — как раньше')
            else: fail('Орион: защита после «Не нашёл…»', str(o3bad)[:1500])
            # О.5 (25.11.2026, правило Глеба): слова после «заметку / напоминание» без «про / о / насчёт» — цель, а не «последнюю / все»:
            # «удали заметку по налогам / купить eth», «отмени напоминание на завтра / по квартплате / позвонить маме» — сразу ничего не снимают:
            # одна подходящая — переспрос и после «да» снята ровно она; ни одной — «Не нашёл…»; несколько — «какую?»; «удали последнюю заметку», «отмени все напоминания» — как раньше
            o5 = pg.evaluate("""(async()=>{const M=Mascot.debug,T=Mascot.tasks,said=()=>M.state().said,keep=new Set(T.notes().map(x=>x.id)),keepR=new Set(T.rem().map(x=>x.id)),out={};
              const clean=()=>{T.notes().filter(x=>!keep.has(x.id)).forEach(x=>T.delNote(x.id)); T.rem().filter(x=>!keepR.has(x.id)).forEach(x=>T.delRem(x.id));};
              const all=()=>JSON.stringify(T.notes().map(x=>x.t)), mine=()=>T.notes().filter(x=>!keep.has(x.id)).map(x=>x.t), acts=()=>JSON.stringify(T.rem().filter(x=>!x.done).map(x=>x.t)), act=()=>T.rem().filter(x=>!x.done&&!keepR.has(x.id)).map(x=>x.t), w=h=>new Date(Date.now()+h*3600e3).toISOString().slice(0,16);
              const step=async(k,q,ans,get)=>{M.pendAge(200); const b=get(); await M.ask(q); const a=said(), mid=get(), pd=M.pendDel(); let s2=null; if(ans){await M.ask(ans); s2=said();} out[k]=[a,mid===b,pd&&pd.t,s2,b,get()];};
              for(const x of ['купить ETH в пятницу','оплатить налоги до 15-го','позвонить брокеру']) await M.ask('запиши заметку: '+x);
              await step('nal','удали заметку по налогам','да',all);
              await step('eth','удали заметку купить ETH','да',all);
              for(const x of ['купить ETH в пятницу','купить ETH на падении']) await M.ask('запиши заметку: '+x);
              await step('many','удали заметку купить eth','да',all);
              await step('miss','удали заметку по отпуску','да',all);
              await step('miss2','удали заметку купить машину','да',all);
              await step('miss3','удали заметку купить машину','удали заметку',all);
              M.pendAge(200); let b=mine(); await M.ask('удали последнюю заметку'); out.last=[said(),b,mine()];
              clean();
              for(const [x,h] of [['позвонить маме',5],['оплатить квартплату',6],['проверить ордера на бирже',7]]) M.act('add_reminder',{text:x,when:w(h)});
              await step('zav','отмени напоминание на завтра','да',acts);
              await step('zav2','отмени напоминание на завтра','отмени напоминания',acts);
              await step('kv','отмени напоминание по квартплате','да',acts);
              await step('mama','отмени напоминание позвонить маме','да',acts);
              M.act('add_reminder',{text:'позвонить маме',when:w(8)}); M.act('add_reminder',{text:'позвонить маме вечером',when:w(9)});
              await step('rmany','убери напоминание позвонить маме','да',acts);
              /* «отмени все напоминания» — как раньше снимает все; чужие (из прошлых проверок) на время помечены выполненными, потом возвращены */
              const old=T.rem().filter(x=>!x.done&&keepR.has(x.id)); old.forEach(x=>{x.done=true;});
              M.pendAge(200); const r=act(); await M.ask('отмени все напоминания'); out.all=[said(),r.length,act().length];
              old.forEach(x=>{x.done=false;}); out.back=old.every(x=>T.rem().some(y=>y.id===x.id&&!y.done));
              clean(); M.pendAge(200); return out;})()""")
            o5bad = []
            def o5chk(k, a, kept, pd, s2, gone):
                v = o5[k]; g = [x for x in json.loads(v[4]) if x not in json.loads(v[5])]
                if not (v[0] == a and v[1] is kept and v[2] == pd and (s2 is None or v[3] == s2) and g == gone): o5bad.append((k, v))
            o5chk('nal', 'Удалить заметку «оплатить налоги до 15-го»? Скажите «да» или «нет».', True, 'оплатить налоги до 15-го', 'Удалил: «оплатить налоги до 15-го».', ['оплатить налоги до 15-го'])
            o5chk('eth', 'Удалить заметку «купить ETH в пятницу»? Скажите «да» или «нет».', True, 'купить ETH в пятницу', 'Удалил: «купить ETH в пятницу».', ['купить ETH в пятницу'])
            o5chk('many', 'Подходят несколько заметок: «купить ETH на падении», «купить ETH в пятницу». Какую удалить? Скажите точнее: «удали заметку про …».', True, None, None, [])
            o5chk('miss', 'Не нашёл заметку по отпуску.', True, None, None, [])
            o5chk('miss2', 'Не нашёл заметку «купить машину».', True, None, None, [])
            o5chk('miss3', 'Не нашёл заметку «купить машину».', True, None, None, [])
            if not (o5['miss3'][3] or '').startswith('Удалить заметку «'): o5bad.append(('после промаха «удали заметку» — только переспрос', o5['miss3']))
            if not (o5['last'][1] and o5['last'][0] == 'Удалил: ' + o5['last'][1][-1] + '.' and o5['last'][2] == o5['last'][1][:-1]): o5bad.append(('удали последнюю заметку — как раньше', o5['last']))
            o5chk('zav', 'Не нашёл напоминание на завтра.', True, None, None, [])
            o5chk('zav2', 'Не нашёл напоминание на завтра.', True, None, 'Все напоминания не отменяю. Скажите: «отмени напоминание про …».', [])
            o5chk('kv', 'Отменить напоминание «оплатить квартплату»? Скажите «да» или «нет».', True, 'оплатить квартплату', 'Отменил напоминание: «оплатить квартплату».', ['оплатить квартплату'])
            o5chk('mama', 'Отменить напоминание «позвонить маме»? Скажите «да» или «нет».', True, 'позвонить маме', 'Отменил напоминание: «позвонить маме».', ['позвонить маме'])
            o5chk('rmany', 'Подходят несколько напоминаний: «позвонить маме вечером», «позвонить маме». Какое отменить? Скажите точнее: «отмени напоминание про …».', True, None, None, [])
            if not (o5['all'][0] == 'Отменил.' and o5['all'][1] >= 3 and o5['all'][2] == 0 and o5['back'] is True): o5bad.append(('отмени все напоминания — как раньше', o5['all'], o5['back']))
            if not o5bad: ok('Орион (О.5): «удали заметку по налогам / купить eth», «отмени напоминание на завтра / по квартплате / позвонить маме» — без «да» ничего не снято; после «да» — ровно названная; нет совпадения — «Не нашёл…», несколько — «какую?»; «удали последнюю заметку», «отмени все напоминания» — как раньше')
            else: fail('Орион (О.5): слова после «заметку / напоминание»', str(o5bad)[:1500])
            # ревью PR №12, круг 4 (24.11.2026; урок 19.11 — набор пар сразу): совпадение — то же слово в другой форме существительного, а не однокоренное.
            # Запрос-существительное не находит прилагательное («ключи» — не «ключевые», «фонд» — не «фондовый», «налоги» — не «налоговую»); «-ой/-ом» не берём («долгой», «дорогой»).
            # Каждая пара — отдельно: заметка записана, «удали заметку про …», заметка на месте и ответ «Не нашёл…»; затем убираем её, чтобы пары не мешали друг другу.
            # 24.11 (переспрос): «чужая» пара — нет вопроса, и даже следом сказанное «да» её не снимает; «нужная» — Орион называет именно её, до «да» цела, после «да» снята.
            P4 = {'neg': [["почту", "почти закончил отчёт"], ["карты", "купить картошку"], ["долги", "составить долгосрочный план"], ["банки", "заказать банкет"], ["налог", "наложенный платёж"], ["долг", "долгий звонок брокеру"], ["газ", "постричь газон"], ["дом", "продлить домен"], ["сало", "записаться в салон"], ["ключи", "ключевые уровни BTC: 60 и 72"], ["фонд", "фондовый рынок"], ["ключ", "ключевая ставка"], ["налоги", "сверить налоговую декларацию"], ["долг", "после долгой паузы позвонить"], ["дорогу", "дорогой подарок маме"], ["золото", "золотой браслет"], ["банк", "купить банку краски"], ["рис", "снизить риск портфеля"], ["сталь", "стало лучше"], ["долги", "долгая очередь в банке"], ["план", "оплатить платёж"], ["банк", "купить бананы"], ["газ", "купить газету"], ["кредит", "кредитная карта на 50 дней"], ["счёт", "поменять счётчик воды"], ["рынок", "рыночная цена SOL"], ["курс", "курсовая разница"], ["мир", "мирный договор"], ["пароль", "пар в бане"], ["кот", "котировки BTC"], ["доход", "доходный дом"], ["долг", "разговор о долгом проекте"], ["дом", "поехать домой"], ["ключи", "ключевой момент недели"], ["фонд", "фондовая биржа"], ["налоги", "налоговая проверка"], ["налоговую", "заплатить налогов"], ["карту", "картина в гостиной"], ["банки", "купить банку огурцов"], ["почту", "почтальон принёс"], ["ключі", "ключові рівні BTC"], ["вклад", "закрыть вкладку"], ["акции", "акционерное собрание"], ["цель", "целый день отдыха"], ["долги", "надолго уехать"], ["пол", "вспахать поле"], ["дом", "работать дома"]],
                  'pos': [["налоги", "заплатить налог"], ["ключи", "ключ от сейфа"], ["карта", "пополнить карту"], ["биржа", "сравнить комиссии биржи"], ["налоги", "налоги до 1 мая"], ["биржу", "проверить комиссию на бирже"], ["карты", "заблокировать карту monobank"], ["долг", "вернуть долги Саше"], ["почту", "сходить на почту"], ["газ", "оплатить газ"], ["налоги", "заплатить налогов"], ["ключи", "сделать дубликат ключей"], ["банк", "позвонить в банк"], ["банки", "сравнить банки"], ["кредит", "закрыть кредиты"], ["налоговую", "сверить налоговую декларацию"], ["золото", "продать золото"], ["ключі", "ключі від сейфа"], ["отчёт", "отчёт за ноябрь"], ["депозит", "открыть депозит в банке"]],
                  'remn': [["ключи", "проверить ключевые уровни"], ["фонд", "почитать про фондовый рынок"], ["долг", "долгий звонок брокеру"], ["карты", "купить картошку"]],
                  'remp': [["ключи", "забрать ключи у мастера"], ["налоги", "заплатить налог за квартиру"]]}
            l4 = pg.evaluate("""(async(P)=>{const M=Mascot.debug,T=Mascot.tasks,said=()=>M.state().said,keep=new Set(T.notes().map(x=>x.id)),keepR=new Set(T.rem().map(x=>x.id)),out={neg:[],pos:[],remn:[],remp:[]};
              const clean=()=>{T.notes().filter(x=>!keep.has(x.id)).forEach(x=>T.delNote(x.id)); T.rem().filter(x=>!keepR.has(x.id)).forEach(x=>T.delRem(x.id));};
              const w=h=>new Date(Date.now()+h*3600e3).toISOString().slice(0,16), act=()=>T.rem().filter(x=>!x.done);
              for(const [q,n] of P.neg){await M.ask('запиши заметку: '+n); const c=T.notes().length; await M.ask('удали заметку про '+q); const a=said(), pd=M.pendDel(); await M.ask('да'); out.neg.push([q,n,a,pd===null && T.notes().length===c && T.notes().some(x=>x.t===n)]); clean();}
              for(const [q,n] of P.pos){await M.ask('запиши заметку: '+n); const c=T.notes().length; await M.ask('удали заметку про '+q); const a=said(), k=T.notes().length===c && T.notes().some(x=>x.t===n); await M.ask('да'); out.pos.push([q,n,a,k,said(),T.notes().length===c-1 && !T.notes().some(x=>!keep.has(x.id)&&x.t===n)]); clean();}
              for(const [q,n] of P.remn){M.act('add_reminder',{text:n,when:w(5)}); const c=act().length; await M.ask('отмени напоминание про '+q); const a=said(), pd=M.pendDel(); await M.ask('да'); out.remn.push([q,n,a,pd===null && act().length===c && act().some(x=>x.t===n)]); clean();}
              for(const [q,n] of P.remp){M.act('add_reminder',{text:n,when:w(5)}); const c=act().length; await M.ask('отмени напоминание про '+q); const a=said(), k=act().length===c; await M.ask('да'); out.remp.push([q,n,a,k,said(),act().length===c-1 && !act().some(x=>!keepR.has(x.id)&&x.t===n)]); clean();}
              return out;})""", P4)
            bad4 = ([x for x in l4['neg'] if x[2:] != [f'Не нашёл заметку про {x[0]}.', True]] + [x for x in l4['pos'] if x[2:] != [f'Удалить заметку «{x[1]}»? Скажите «да» или «нет».', True, f'Удалил: «{x[1]}».', True]]
                    + [x for x in l4['remn'] if x[2:] != [f'Не нашёл напоминание про {x[0]}.', True]] + [x for x in l4['remp'] if x[2:] != [f'Отменить напоминание «{x[1]}»? Скажите «да» или «нет».', True, f'Отменил напоминание: «{x[1]}».', True]])
            if [len(l4[k]) for k in ('neg', 'pos', 'remn', 'remp')] == [len(P4[k]) for k in ('neg', 'pos', 'remn', 'remp')] and len(P4['neg']) >= 30 and len(P4['pos']) >= 10 and not bad4:
                ok(f"Орион: {len(P4['neg'])} чужих заметок не снимаются и после «да» («ключи» — не «ключевые уровни», «фонд» — не «фондовый», «долг» — не «долгой паузы», «дорогу» — не «дорогой подарок», украинские «ключові»), {len(P4['pos'])} нужных — Орион называет именно их и снимает только после «да» («налоги» — «налог», «ключи» — «ключ», «карта» — «карту», «ключі»); напоминания — так же")
            else: fail('Орион: удаление по теме — набор пар (круг 4)', str(bad4 or l4))
            # 18.11.2026 (этап 5): утренний брифинг, антипаника, оповещения о цене через сервер
            mb = pg.evaluate("""(()=>{const D=Mascot.debug.state&&window.MSC&&MSC.last?null:null;
              const tot=(window.derive?derive():{}).total||0, inv=(window.derive?derive():{}).invPriced||0;
              Mascot.debug.snapPrev({day:'x',at:Date.now()-20*3600e3,total:tot||1000,pnl:(tot-inv)-150});
              return [Mascot.debug.brief2({morning:true,calm:false}), Mascot.debug.brief2({morning:false,calm:false})];})()""")
            if 'Со вчера портфель вырос на' in mb[0] and 'Сегодня напоминание' in mb[0] and 'позвонить в банк' in mb[0] and 'Со вчера' not in mb[1]: ok('Орион: утренний брифинг — что изменилось со вчера и напоминания на сегодня; днём — обычная сводка')
            else: fail('Орион: утренний брифинг', str(mb))
            cm = pg.evaluate("[Mascot.debug.brief2({calm:true,morning:false}), Mascot.debug.calmDue()]")
            if cm[0].startswith('Спокойно') and 'Хаузел' in cm[0] and 'Резких решений сегодня не нужно' in cm[0] and not any(w in cm[0] for w in ['купите', 'продайте', 'докупите']) and cm[1] is False: ok('Орион: антипаника при падении на 10% — правило из книги и план, без советов купить или продать; в обычный день молчит')
            else: fail('Орион: антипаника', str(cm))
            aa = pg.evaluate("""(async()=>{const a=MLX.addAlert('ETH', 99999); const db=await window.claude.use('db');
              await new Promise(r=>setTimeout(r,300)); const d=await db.doc('app/orion-alerts').get(); const c=d.exists?(d.data().items||[]).map(x=>x.sym+':'+x.price):null;
              await db.doc('app/orion-alerts').set({v:1,at:Date.now(),items:[],fired:[{id:a.id,at:Date.now(),now:100000}]});
              await MLX.alPull(true); const left=(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>{try{return 'alerts' in (JSON.parse(localStorage.getItem(k))||{})}catch(e){return false}}))||'{}').alerts||[]).map(x=>x.id);
              const d2=await db.doc('app/orion-alerts').get();
              return [c, left.includes(a.id), (d2.data().fired||[]).length, document.getElementById('toastMsg').textContent];})()""")
            if aa[0] and 'ETH:99999' in aa[0] and aa[1] is False and aa[2] == 0 and 'пока приложение было закрыто' in aa[3]: ok('Оповещения о цене: копия в аккаунте для сервера; сработавшее на сервере снимается в телефоне и звучит «пока приложение было закрыто»')
            else: fail('Оповещения через сервер', str(aa))
            # 18.11.2026 (этап 5, часть 2): копия сигналов для сервера (ступени, цель, план месяца, серия) и возврат отправленного сервером
            sg = pg.evaluate("""(async()=>{MLX.sigCopy(); await new Promise(r=>setTimeout(r,300)); const db=await window.claude.use('db');
              const d=(await db.doc('app/orion-signals').get()).data()||{}; const k='lv:test:9:k1';
              await db.doc('app/orion-signals').set(Object.assign({},d,{sent:{[k]:Date.now()}})); await MLX.sigPull();
              const xs=Object.keys(localStorage).map(x=>{try{return JSON.parse(localStorage.getItem(x))}catch(e){return null}}).find(o=>o&&typeof o==='object'&&o.seen&&o.seen[k]);
              return [Array.isArray(d.levels), !!d.plan&&'need' in d.plan&&'hasPlan' in d.plan, !!d.streak&&'n' in d.streak, d.tz, JSON.stringify(d).match(/\\d{4,}\\.\\d/)?'':'ok', !!xs];})()""")
            if sg[0] and sg[1] and sg[2] and sg[3] and sg[5]: ok('Сигналы через сервер: копия ступеней, цели, плана месяца и серии — в аккаунте; отправленное сервером телефон не повторяет')
            else: fail('Сигналы через сервер', str(sg))
            # 18.11.2026 (этап 5, часть 3): «что вы пропустили», потолок доли крипты, урок к ситуации
            aw = pg.evaluate("""(()=>{const D=derive(),tot=D.total||1000,inv=D.invPriced||0,b=(S.live&&S.live.prices&&S.live.prices.BTC)||100000;
              Mascot.debug.snapPrev({day:'x',at:Date.now()-5*864e5-3600e3,total:tot,pnl:(tot-inv)+80,btc:b/1.1});
              return Mascot.debug.brief2({morning:true,calm:false});})()""")
            if 'Вас не было 5 дней' in aw and 'снизился на' in aw and 'биткоин — плюс' in aw: ok('Орион: после перерыва 3+ дня — «вас не было 5 дней», что изменилось за это время')
            else: fail('Орион: что вы пропустили', aw)
            ct = pg.evaluate("Mascot.debug.ceilText({sh:14,ceil:10})")
            if '14 процентов' in ct and 'потолке 10' in ct and 'решаете вы' in ct and not any(w in ct for w in ['продайте', 'продать']): ok('Орион: крипта выше потолка из личного плана — говорит и объясняет ребалансировку, без совета продать')
            else: fail('Орион: потолок доли', ct)
            ls = pg.evaluate("""(()=>{const o=MLX.fng;MLX.fng=()=>({v:15,w:'сильный страх'});localStorage.removeItem('or-lesAt');const r=Mascot.debug.lessonPick();MLX.fng=o;return r;})()""")
            pg.evaluate("Mascot.debug.lessonOffer('emo'); Mascot.debug.ask('открой урок')"); pg.wait_for_timeout(700)
            try: pg.wait_for_function("()=>Mascot.debug.sayLog().some(x=>x.indexOf('Открываю урок')===0)", polling=200, timeout=8000)
            except Exception: pass
            lo = pg.evaluate("[Mascot.debug.sayLog().join(' | '), document.getElementById('xBody').innerText.slice(0, 300), document.getElementById('xSheet') ? document.getElementById('xSheet').classList.contains('open') : null]")
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(300)
            if ls and ls.get('id') == 'emo' and 'открой урок' in ls.get('say', '') and 'Эмоции' in lo[0] and 'Эмоции' in lo[1]: ok('Орион: при страхе предлагает урок «Эмоции — главный враг»; «открой урок» — открывает')
            else: fail('Орион: урок к ситуации', f'{ls} | {lo}')
            # 18.11.2026 (этап 5, часть 4): цифры плашками, заголовок новости в утренней сводке, день пополнения для сервера
            # 18.11.2026 (владелец): «биткоин 64 149, а Орион говорит 64 тысячи» — цену монеты говорит до доллара
            pw = pg.evaluate("[Mascot.debug.priceW(64149), Mascot.debug.priceW(110000), Mascot.debug.priceW(2501.4), Mascot.debug.figs('Биткоин — 64 тысячи 149 долларов.').map(x=>x.t), Mascot.debug.spoken('Биткоин — 64 тысячи 149 долларов.')]")
            if pw[0] == '64 тысячи 149 долларов' and pw[1] == '110 тысяч долларов' and pw[2] == '2 тысячи 501 доллар' and pw[3] == ['64 тысячи 149 долларов'] and 'шестьдесят четыре тысячи сто сорок девять долларов' in pw[4]: ok('Орион: цена монеты — до доллара («64 тысячи 149 долларов»), плашка — целиком')
            else: fail('Орион: точная цена', str(pw))
            # 18.11.2026 (BACKLOG №7): «поставь оповещение DOGE по 12 центов» — «0,12 доллара», а не «0 долларов»; крупные цены — как раньше
            al = pg.evaluate("""(()=>{const o=MLX.addAlert,got=[];MLX.addAlert=(s,v)=>{got.push(s+':'+v);return {id:'t'+got.length,sym:s,price:v,dir:'up'};};
              try{const D=Mascot.debug;return [D.reply('поставь оповещение DOGE по 12 центов'), D.act('set_price_alert',{sym:'DOGE',price:0.12}), D.act('set_price_alert',{sym:'BTC',price:64149}), D.act('set_price_alert',{sym:'XRP',price:5}), D.act('set_price_alert',{sym:'XRP',price:2.5}), D.reply('сообщи, когда биткоин будет 12 процентов'), got];}finally{MLX.addAlert=o;}})()""")
            if ('до отметки 0,12 доллара' in al[0] and al[1] == 'Поставил оповещение: DOGE, 0,12 доллара.' and al[2] == 'Поставил оповещение: BTC, 64 тысячи 149 долларов.'
                    and al[3] == 'Поставил оповещение: XRP, 5 долларов.' and al[4] == 'Поставил оповещение: XRP, 2,5 доллара.' and al[6][:2] == ['DOGE:0.12', 'DOGE:0.12'] and 'BTC:64149' in al[6] and not any(x.startswith('BTC:0.12') for x in al[6])):
                ok('Орион: оповещение «DOGE по 12 центов» — ставит 0,12 и говорит «0,12 доллара»; BTC 64149 — «64 тысячи 149 долларов»')
            else: fail('Орион: цена в ответе об оповещении', str(al))
            fg = pg.evaluate("Mascot.debug.figs('Биткоин — 110 тысяч долларов, за сутки плюс 2 процента. Портфель минус 3%.')")
            if [x['t'] for x in fg] == ['110 тысяч долларов', 'плюс 2 процента', 'минус 3%'] and fg[1]['c'] == 'up' and fg[2]['c'] == 'dn': ok('Орион: цифры из ответа — плашками под текстом (рост зелёным, падение красным)')
            else: fail('Орион: плашки с цифрами', str(fg))
            hd = pg.evaluate("""(()=>{const d=new Date(),k=d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();Mascot.debug.headline({day:k,text:'Из новостей, ForkLog: «Биткоин обновил максимум».'});const t=Mascot.debug.brief2({morning:true,calm:false});Mascot.debug.headline(null);return t;})()""")
            if 'Из новостей, ForkLog: «Биткоин обновил максимум».' in hd: ok('Орион: в утренней сводке — один свежий заголовок по вашим монетам, с источником')
            else: fail('Орион: заголовок в сводке', hd)
            dp = pg.evaluate("""(async()=>{MLX.sigCopy();await new Promise(r=>setTimeout(r,300));const db=await window.claude.use('db');const d=(await db.doc('app/orion-signals').get()).data()||{};const a=(await db.doc('app/orion-alerts').get()).data()||{};return [d.dep||null, a.tz||null];})()""")
            if dp[0] is not None and 'day' in dp[0] and 'last' in dp[0] and dp[1]: ok('Сигналы через сервер: день пополнения и часовой пояс — для уведомления в день пополнения и тихих часов')
            else: fail('Сигналы: день пополнения', str(dp))
            pg.evaluate("document.querySelector('.or-cap') && document.querySelector('.or-cap').click()"); pg.unroute('**/functions/v1/orion-ask')
        scenario('Орион', {'session': True, 'docs': SEED}, s_mascot)

        # --- достижения и «Итог месяца» (12.11.2026): первая проверка — тихо, новое — праздник; «истории» и картинка без сумм
        def s_wins(pg, errs):
            pg.wait_for_timeout(2500)
            pg.evaluate("show('strategy')"); pg.wait_for_timeout(600)
            card = pg.evaluate("(document.getElementById('winCard')||{}).textContent||''")
            toast0 = pg.inner_text('#toastMsg') if pg.locator('#toast.show').count() else ''
            if 'Достижения' in card and 'из 17' in card and 'Достижение' not in toast0: ok('достижения: карточка в «Стратегии», уже заслуженные отмечены тихо, без салюта задним числом')
            else: fail('достижения: карточка', card + ' | ' + toast0)
            pg.evaluate("(()=>{const k=Object.keys(localStorage).find(k=>k.startsWith('ml-win:'));const o=JSON.parse(localStorage.getItem(k));delete o.got.first;localStorage.setItem(k,JSON.stringify(o));MLX.achCheck();})()")
            pg.wait_for_timeout(400)
            t1 = pg.inner_text('#toastMsg') if pg.locator('#toast.show').count() else ''
            if 'Первый шаг' in t1: ok('достижения: новое — тост «Достижение: Первый шаг» и праздник')
            else: fail('достижения: новое', t1)
            pg.evaluate("MLX.openAch()"); pg.wait_for_timeout(700)
            n = pg.locator('#xSheet.open .win-cell').count(); on = pg.locator('#xSheet.open .win-cell.on').count()
            if n == 17 and on >= 1: ok(f'достижения: шторка — 17 значков, получено {on}')
            else: fail('достижения: шторка', f'{n} {on}')
            # №5 и №7 (охота 15.11): «Графит» — полоса ровным акцентом, у значков и круга «Итог месяца» нет градиентов и свечения
            look = pg.evaluate("""(()=>{const c=s=>getComputedStyle(document.querySelector(s));
                const d=document.createElement('span');d.className='win-inv-g';document.body.appendChild(d);const g=getComputedStyle(d);
                const r={bar:c('.win-bar i').backgroundImage,b:c('#xSheet.open .win-cell.on .win-b').backgroundImage,sh:c('#xSheet.open .win-cell.on .win-b').boxShadow,
                    inv:g.backgroundImage,anim:g.animationName};d.remove();return r})()""")
            if look['bar'] == 'none' and look['b'] == 'none' and look['sh'] == 'none' and look['inv'] == 'none' and look['anim'] == 'none':
                ok('достижения: «Графит» — полоса без градиента, значки и круг «Итог месяца» без свечения и радуги')
            else: fail('достижения: вид «Графит»', str(look))
            # замечание Веры 16.11: круг «Итог месяца» не пустой — контурный значок 40 px на нейтральном фоне с рамкой 1 px
            ws = (ROOT / 'wins.js').read_text(encoding='utf-8')
            m = re.search(r'class="win-inv-g"[^>]*>(<svg[^>]*>.*?</svg>)</span>', ws)
            gi = pg.evaluate("""(svg=>{const d=document.createElement('span');d.className='win-inv-g';d.innerHTML=svg;document.body.appendChild(d);
                const g=getComputedStyle(d),v=d.querySelector('svg'),r={w:g.width,bw:g.borderTopWidth,img:g.backgroundImage,sh:g.boxShadow,svg:!!v,
                    sw:v?getComputedStyle(v).strokeWidth:'',fill:v?v.getAttribute('fill'):'',st:v?v.getAttribute('stroke'):''};d.remove();return r})""", m.group(1) if m else '')
            if m and gi['svg'] and gi['w'] == '40px' and gi['bw'] == '1px' and gi['img'] == 'none' and gi['sh'] == 'none' \
                    and gi['fill'] == 'none' and gi['st'] == 'currentColor' and 1.6 <= float((gi['sw'] or '0').replace('px', '')) <= 1.8:
                ok('достижения: круг «Итог месяца» — контурный значок 40 px, нейтральный фон, рамка 1 px')
            else: fail('достижения: значок «Итог месяца»', f'{bool(m)} {gi}')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(300)
            pg.evaluate("MLX.openStory()"); pg.wait_for_timeout(700)
            bars = pg.locator('#mlStory .st-bars i').count(); h = pg.inner_text('#mlStory .st-in')
            pg.mouse.click(330, 500); pg.wait_for_timeout(500); h2 = pg.inner_text('#mlStory .st-in')
            if bars == 6 and 'MONEYLIFE' in h.upper() and 'ПОКУПКИ' in h2.upper(): ok('итог месяца: 6 слайдов, листаются нажатием')
            else: fail('итог месяца: слайды', f'{bars} | {h[:60]} | {h2[:60]}')
            size = pg.evaluate("(()=>{const r=MLX.monthRecap(new Date().toISOString().slice(0,7));const c=MLX.storyCanvas(r,'Итог',r.ch==null?'—':'+1%');return c.width+'x'+c.height})()")
            if size == '1080x1920': ok('итог месяца: картинка для «историй» 1080×1920')
            else: fail('итог месяца: картинка', size)
            # «Графит» 16.11: фон слайдов и картинки — ровный, без фиолетово-розового свечения и градиентов
            bg = pg.evaluate("""(()=>{const s=getComputedStyle(document.querySelector('#mlStory .st-bg')),b=getComputedStyle(document.body);
                const r=MLX.monthRecap(new Date().toISOString().slice(0,7)),g=MLX.storyCanvas(r,'Итог','—').getContext('2d');
                const px=[[20,20],[860,260],[160,1500],[1060,1900],[540,1000]].map(([x,y])=>g.getImageData(x,y,1,1).data.slice(0,3).join(','));
                return {img:s.backgroundImage,col:s.backgroundColor,bodyBg:b.backgroundColor,px}})()""")
            if bg['img'] == 'none' and bg['col'] == bg['bodyBg'] and len(set(bg['px'])) == 1:
                ok('итог месяца: «Графит» — фон слайдов и картинки ровный, без свечения')
            else: fail('итог месяца: фон без свечения', str(bg))
            # замечания Веры 16.11: подписи «нажмите…» и сноски — контраст не меньше 4,5:1 в обеих темах; огоньки серии — акцент темы без свечения
            th0 = pg.evaluate("document.documentElement.getAttribute('data-theme')")
            look = {}
            for th in ('dark', 'light'):
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(120)
                look[th] = pg.evaluate("""(()=>{const st=document.querySelector('#mlStory');const t=document.createElement('div');
                    t.innerHTML='<span class="st-tap">x</span><span class="st-note">x</span><div class="st-flames"><i class="on"></i></div>';st.appendChild(t);
                    const rgb=v=>v.match(/[0-9.]+/g).slice(0,3).map(Number),L=c=>{const a=c.map(x=>{x/=255;return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4)});return .2126*a[0]+.7152*a[1]+.0722*a[2]};
                    const bg=rgb(getComputedStyle(st.querySelector('.st-bg')).backgroundColor),cr=s=>{const a=L(rgb(getComputedStyle(t.querySelector(s)).color)),b=L(bg);return Math.round((Math.max(a,b)+.05)/(Math.min(a,b)+.05)*100)/100};
                    const f=getComputedStyle(t.querySelector('.st-flames i.on')),acc=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
                    const p=document.createElement('i');p.style.color=acc;document.body.appendChild(p);const accRgb=getComputedStyle(p).color;p.remove();
                    const r={tap:cr('.st-tap'),note:cr('.st-note'),filter:f.filter,flame:f.color,acc:accRgb};t.remove();return r})()""")
            if th0: pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th0}')")
            else: pg.evaluate("document.documentElement.removeAttribute('data-theme')")
            pg.wait_for_timeout(120)
            if all(v['tap'] >= 4.5 and v['note'] >= 4.5 and v['filter'] == 'none' and v['flame'] == v['acc'] for v in look.values()):
                ok(f"итог месяца: подписи читаются (контраст {look['dark']['tap']}:1 и {look['light']['tap']}:1), огоньки серии — акцент без свечения")
            else: fail('итог месяца: подписи и огоньки', str(look))
            pg.click('#mlStory .st-x'); pg.wait_for_timeout(500)
            if pg.locator('#mlStory').count() == 0 and not pg.evaluate("document.body.classList.contains('lock')"): ok('итог месяца: закрывается, страница снова листается')
            else: fail('итог месяца: закрытие', 'осталось')
        scenario('Достижения', {'session': True, 'docs': SEED}, s_wins)

        # --- украинский язык (12.11.2026): весь интерфейс и Орион по-украински, переключатель в настройках, русский не меняется
        RU_ONLY = r"""() => { const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
          while ((n = w.nextNode())) { const p = n.parentElement; if (!p || p.closest('script,style,[translate="no"],[hidden]')) continue; const r = p.getBoundingClientRect(); if (!r.width || !r.height) continue;
            const t = n.nodeValue.trim(); if (/[ыэъё]/i.test(t)) out.push(t.slice(0, 80)); }
          document.querySelectorAll('[placeholder],[aria-label]').forEach(e => { if (e.closest('[translate="no"]')) return; for (const a of ['placeholder', 'aria-label']) { const v = e.getAttribute(a) || ''; if (/[ыэъё]/i.test(v)) out.push('@' + v.slice(0, 60)); } });
          return out; }"""
        def s_uk(pg, n):
            pg.evaluate("localStorage.setItem('ml-lang','uk'); location.reload()"); pg.wait_for_timeout(2500)
            tabs = pg.evaluate("[...document.querySelectorAll('[data-tab]')].map(b=>b.textContent.trim()).join('|')")
            if pg.evaluate("document.documentElement.lang") == 'uk' and 'Головна' in tabs and 'Монети' in tabs and 'Стратегія' in tabs and 'Активність' in tabs: ok('украинский: язык страницы uk, вкладки по-украински')
            else: fail('украинский: вкладки', tabs)
            left = []
            for tab in ['home', 'coins', 'strategy', 'activity']:
                pg.evaluate(f"show('{tab}')"); pg.wait_for_timeout(500); left += pg.evaluate(RU_ONLY)
            for js in ["openSettings()", "openAct('menu')", "openAct('buy')", "openAct('sell')", "openAct('deposit')", "MLX.openLearn()", "MLX.openAch()", "MLX.openPlan()"]:
                pg.evaluate("closeSheets()"); pg.wait_for_timeout(250); pg.evaluate(js); pg.wait_for_timeout(600); left += pg.evaluate(RU_ONLY)
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(300)
            left = list(dict.fromkeys(left))
            if not left: ok('украинский: на вкладках, в настройках, формах, уроках и достижениях нет русских букв ы/э/ъ/ё')
            else: fail('украинский: остался русский текст', ' | '.join(left[:12]))
            shot(pg, 'uk-home')
            M = 'window.Mascot.debug'
            cases = [('до 74 тисяч доларів', 'до сімдесяти чотирьох тисяч доларів'), ('мінус 2,5%', "мінус дві цілих п'ять десятих відсотка"), ('21 гривня, 2 гривні, 5 гривень', "двадцять одна гривня, дві гривні, п'ять гривень"),
                     ('OKX і ETF', 'о-кей-ікс і і-ті-еф'), ('$950', "дев'ятсот п'ятдесят доларів")]
            bad = [(a, pg.evaluate(f"{M}.spokenUk({json.dumps(a)})")) for a, b in cases if b not in pg.evaluate(f"{M}.spokenUk({json.dumps(a)})")]
            if not bad: ok('Орион по-украински: числа словами в нужном падеже, аббревиатуры по буквам')
            else: fail('Орион по-украински: числа', str(bad))
            # 17.11.2026 (владелец): «страх и жадность 12», а следом «рынок спокоен» — нелогично. При страхе/жадности «спокоен» не говорим
            fg = pg.evaluate(f"""(()=>{{const o=MLX.fng,lv=S.live.change,r={{}};S.live.change=Object.assign({{}},lv,{{BTC:0.2}});
              for(const v of [12,50,85]){{MLX.fng=()=>({{v,w:'x'}});r[v]={M}.lx({M}.brief());}}MLX.fng=o;S.live.change=lv;return r}})()""")
            calm = lambda t: 'спокійний' in t or 'спокоен' in t
            if not calm(fg['12']) and 'страх' in fg['12'] and calm(fg['50']) and not calm(fg['85']) and 'жадібн' in fg['85']:
                ok('Орион: при страхе (12) и жадности (85) не говорит «рынок спокоен», при 50 и тихой цене — говорит')
            else: fail('Орион: страх и «спокоен»', str(fg)[:300])
            br = pg.evaluate(f"{M}.lx({M}.brief())"); r1 = pg.evaluate(f"{M}.lx({M}.reply('скільки в мене біткоїна'))")
            if br and not re.search('[ыэъё]', br + r1) and 'біткоїна' in r1: ok('Орион по-украински: сводка и ответ на украинский вопрос')
            else: fail('Орион по-украински: сводка', br[:120] + ' | ' + r1[:120])
            ux = pg.evaluate(f"['Не нашёл заметку про отпуск.', 'Не нашёл напоминание про биржу.', 'Отменил напоминание: x.'].map(t=>{M}.lx(t))")
            if ux == ['Не знайшов нотатку про відпустку.', 'Не знайшов нагадування про біржу.', 'Скасував нагадування: x.'] or (all('знайшов' in x or 'Скасував' in x for x in ux) and not re.search('[ыэъё]', ''.join(ux))): ok('Орион по-украински: «Не знайшов нотатку / нагадування про …», «Скасував нагадування»')
            else: fail('Орион по-украински: удаление по теме', str(ux))
            ux2 = pg.evaluate(f"['Про что удалить заметку?', 'Про что отменить напоминание?'].map(t=>{M}.lx(t))")
            if ux2 == ['Про що видалити нотатку?', 'Про що скасувати нагадування?']: ok('Орион по-украински: «Про що видалити нотатку?», «Про що скасувати нагадування?»')
            else: fail('Орион по-украински: переспрос «про що»', str(ux2))
            # 24.11.2026 (BACKLOG №1): по-украински — переспрос «Видалити нотатку «…»? Скажіть «так» або «ні».», «так» — снимает ровно её, «ні» — ничего; текст заметки словарь не трогает
            uy = pg.evaluate(f"""(async()=>{{const M={M},T=Mascot.tasks,said=()=>M.state().said,keep=new Set(T.notes().map(x=>x.id)),keepR=new Set(T.rem().map(x=>x.id)),out={{}};
              const mine=()=>T.notes().filter(x=>!keep.has(x.id)).map(x=>x.t), act=()=>T.rem().filter(x=>!x.done&&!keepR.has(x.id)).map(x=>x.t);
              for(const n of ['сплатити податки до 15-го','купить ETH и SOL']) await M.ask('запиши нотатку: '+n);
              let b=mine(); await M.ask('видали нотатку про податки'); let q=said(), mid=mine(); await M.ask('так'); out.yes=[b,q,mid,said(),mine()];
              b=mine(); await M.ask('видали нотатку про ETH'); q=said(); await M.ask('ні'); out.no=[b,q,said(),mine()];
              M.act('add_reminder',{{text:'зателефонувати брокеру',when:new Date(Date.now()+5*3600e3).toISOString().slice(0,16)}});
              let r=act(); await M.ask('скасуй нагадування про брокера'); q=said(); await M.ask('так, скасуй'); out.rem=[r,q,said(),act()];
              T.notes().filter(x=>!keep.has(x.id)).forEach(x=>T.delNote(x.id)); T.rem().filter(x=>!keepR.has(x.id)).forEach(x=>T.delRem(x.id)); return out;}})()""")
            uyb = []
            y = uy['yes']
            if not (y[1] == 'Видалити нотатку «сплатити податки до 15-го»? Скажіть «так» або «ні».' and y[2] == y[0] and y[3] == 'Видалив: «сплатити податки до 15-го».' and y[4] == ['купить ETH и SOL']): uyb.append(('так', y))
            y = uy['no']
            if not (y[1] == 'Видалити нотатку «купить ETH и SOL»? Скажіть «так» або «ні».' and y[2] == 'Добре, залишив.' and y[3] == y[0]): uyb.append(('ні', y))
            y = uy['rem']
            if not (y[1] == 'Скасувати нагадування «зателефонувати брокеру»? Скажіть «так» або «ні».' and y[2] == 'Скасував нагадування: «зателефонувати брокеру».' and [x for x in y[0] if x not in y[3]] == ['зателефонувати брокеру']): uyb.append(('нагадування', y))
            if not uyb: ok('Орион по-украински: «видали нотатку про податки» → «Видалити нотатку «…»? Скажіть «так» або «ні».» → «так» — снята ровно она; «ні» — «Добре, залишив.»; напоминание — «скасуй …» → «так»; текст «купить ETH и SOL» не переведён')
            else: fail('Орион по-украински: удаление с переспросом', str(uyb)[:1200])
            # PR №23 круг 3 (Вера): по-украински промахи — «щодо / стосовно …» повторяем как сказано, после «о / насчёт» — «Не знайшов такої нотатки / такого нагадування» (без чужого падежа), без русских слов;
            # «Все напоминания не отменяю» и «Напоминаний и так нет.» — тоже по-украински
            um = pg.evaluate(f"""(async()=>{{const M={M},T=Mascot.tasks,said=()=>M.state().said,keep=new Set(T.notes().map(x=>x.id)),keepR=new Set(T.rem().map(x=>x.id)),out=[];
              M.pendAge(200); for(const n of ['купити ETH у пʼятницю']) await M.ask('запиши нотатку: '+n);
              for(const n of ['полити квіти','купити подарунок']) M.act('add_reminder',{{text:n,when:new Date(Date.now()+5*3600e3).toISOString().slice(0,16)}});
              for(const q of ['видали нотатку щодо машини','видали нотатку стосовно відпустки','видали нотатку о машині','видали нотатку насчёт дачі','скасуй нагадування щодо відпустки','скасуй нагадування стосовно машини','скасуй нагадування о дачі']){{await M.ask(q); out.push([q,said()]);}}
              await M.ask('скасуй нагадування'); out.push(['скасуй нагадування',said()]);
              out.push(['lx',M.lx('Напоминаний и так нет.')]);
              T.notes().filter(x=>!keep.has(x.id)).forEach(x=>T.delNote(x.id)); T.rem().filter(x=>!keepR.has(x.id)).forEach(x=>T.delRem(x.id)); M.pendAge(200); return out;}})()""")
            EXP = ['Не знайшов нотатку щодо машини.', 'Не знайшов нотатку стосовно відпустки.', 'Не знайшов такої нотатки.', 'Не знайшов такої нотатки.',
                   'Не знайшов нагадування щодо відпустки.', 'Не знайшов нагадування стосовно машини.', 'Не знайшов такого нагадування.',
                   'Усі нагадування не скасовую. Скажіть: «скасуй нагадування про …».', 'Нагадувань і так немає.']
            if [x[1] for x in um] == EXP and not re.search('[ыэъё]|Не нашёл|заметк|напоминан', ''.join(x[1] for x in um)):
                ok('Орион по-украински: промахи «щодо / стосовно …» — как сказано, «о / насчёт …» — «Не знайшов такої нотатки / такого нагадування»; «Усі нагадування не скасовую», «Нагадувань і так немає.» — без русских слов')
            else: fail('Орион по-украински: промахи с другими предлогами', str(um)[:1200])
            # О.5 / О.6 (25.11.2026) по-украински: «видали нотатку по податках / купити eth», «скасуй нагадування на завтра / по квартплаті / зателефонувати мамі» —
            # без «так» ничего не снято, после «так» — ровно названная; ответы — только по-украински; «Нотаток немає.», «Скасував.»
            u5 = pg.evaluate(f"""(async()=>{{const M={M},T=Mascot.tasks,said=()=>M.state().said,keep=new Set(T.notes().map(x=>x.id)),keepR=new Set(T.rem().map(x=>x.id)),out={{}};
              const clean=()=>{{T.notes().filter(x=>!keep.has(x.id)).forEach(x=>T.delNote(x.id)); T.rem().filter(x=>!keepR.has(x.id)).forEach(x=>T.delRem(x.id));}};
              const all=()=>JSON.stringify(T.notes().map(x=>x.t)), acts=()=>JSON.stringify(T.rem().filter(x=>!x.done).map(x=>x.t)), w=h=>new Date(Date.now()+h*3600e3).toISOString().slice(0,16);
              const step=async(k,q,ans,get)=>{{M.pendAge(200); const b=get(); await M.ask(q); const a=said(), mid=get(), pd=M.pendDel(); let s2=null; if(ans){{await M.ask(ans); s2=said();}} out[k]=[a,mid===b,pd&&pd.t,s2,b,get()];}};
              for(const x of ['сплатити податки до 15-го','купити ETH у пʼятницю','зателефонувати брокеру']) await M.ask('запиши нотатку: '+x);
              await step('nal','видали нотатку по податках','так',all);
              await step('eth','видали нотатку купити ETH','так',all);
              for(const x of ['купити ETH у пʼятницю','купити ETH на просадці']) await M.ask('запиши нотатку: '+x);
              await step('many','видали нотатку купити eth','так',all);
              await step('miss','видали нотатку по відпустці','так',all);
              for(const [x,h] of [['зателефонувати мамі',5],['сплатити квартплату',6]]) M.act('add_reminder',{{text:x,when:w(h)}});
              await step('zav','скасуй нагадування на завтра','так',acts);
              await step('kv','скасуй нагадування по квартплаті','так',acts);
              await step('mama','скасуй нагадування зателефонувати мамі','ні',acts);
              /* «Скасував.» — голое «скасуй нагадування» снимает все (чужие на время помечены выполненными); «Нотаток немає.» — заметок нет (чужие убраны и возвращены) */
              clean(); M.act('add_reminder',{{text:'полити квіти',when:w(5)}}); const old=T.rem().filter(x=>!x.done&&keepR.has(x.id)); old.forEach(x=>{{x.done=true;}});
              M.pendAge(200); await M.ask('скасуй нагадування'); out.all=[said(),T.rem().filter(x=>!x.done).length]; old.forEach(x=>{{x.done=false;}});
              const on=T.notes().map(x=>x.t); T.notes().forEach(x=>T.delNote(x.id)); M.pendAge(200); await M.ask('видали нотатку'); out.none=said();
              for(const x of on) M.act('add_note',{{text:x}}); out.back=JSON.stringify(T.notes().map(x=>x.t))===JSON.stringify(on);
              clean(); M.pendAge(200); return out;}})()""")
            u5bad = []
            def u5chk(k, a, kept, pd, s2, gone):
                v = u5[k]; g = [x for x in json.loads(v[4]) if x not in json.loads(v[5])]
                if not (v[0] == a and v[1] is kept and v[2] == pd and (s2 is None or v[3] == s2) and g == gone): u5bad.append((k, v))
            u5chk('nal', 'Видалити нотатку «сплатити податки до 15-го»? Скажіть «так» або «ні».', True, 'сплатити податки до 15-го', 'Видалив: «сплатити податки до 15-го».', ['сплатити податки до 15-го'])
            u5chk('eth', 'Видалити нотатку «купити ETH у пʼятницю»? Скажіть «так» або «ні».', True, 'купити ETH у пʼятницю', 'Видалив: «купити ETH у пʼятницю».', ['купити ETH у пʼятницю'])
            u5chk('many', 'Підходять кілька нотаток: «купити ETH на просадці», «купити ETH у пʼятницю». Яку видалити? Скажіть точніше: «видали нотатку про …».', True, None, None, [])
            u5chk('miss', 'Не знайшов такої нотатки.', True, None, None, [])
            u5chk('zav', 'Не знайшов такого нагадування.', True, None, None, [])
            u5chk('kv', 'Скасувати нагадування «сплатити квартплату»? Скажіть «так» або «ні».', True, 'сплатити квартплату', 'Скасував нагадування: «сплатити квартплату».', ['сплатити квартплату'])
            u5chk('mama', 'Скасувати нагадування «зателефонувати мамі»? Скажіть «так» або «ні».', True, 'зателефонувати мамі', 'Добре, залишив.', [])
            if not (u5['all'] == ['Скасував.', 0] and u5['none'] == 'Нотаток немає.' and u5['back'] is True): u5bad.append(('Скасував. / Нотаток немає.', u5['all'], u5['none'], u5['back']))
            said5 = ''.join(str(u5[k][0]) + str(u5[k][3] or '') for k in ('nal', 'eth', 'many', 'miss', 'zav', 'kv', 'mama')) + str(u5['all'][0]) + str(u5['none'])
            if re.search('[ыэъё]|Не нашёл|заметк|напоминан|Отменил|Удалил', said5): u5bad.append(('русские слова', said5))
            if not u5bad: ok('Орион по-украински (О.5/О.6): «видали нотатку по податках / купити eth», «скасуй нагадування на завтра / по квартплаті / зателефонувати мамі» — без «так» ничего не снято, после «так» — ровно названная; «Не знайшов…», «Підходять кілька…», «Скасував.», «Нотаток немає.» — без русских слов')
            else: fail('Орион по-украински (О.5/О.6): слова после «нотатку / нагадування»', str(u5bad)[:1500])
            # 18.11.2026 (BACKLOG №2): «Справи Оріона» — текст, который записал человек, словарь перевода не переписывает
            pg.evaluate(f"{M}.act('add_note', {{text: 'Купить BTC після зарплати'}}); {M}.act('add_reminder', {{text: 'Перевірити портфель и купить эфир', when: new Date(Date.now()+5*3600e3).toISOString().slice(0,16)}})")
            pg.evaluate("closeSheets(); MLX.go('tasks')"); pg.wait_for_timeout(900)
            tk = pg.evaluate("""(()=>{const b=document.getElementById('xBody'),nm=[...b.querySelectorAll('.nm')].map(x=>x.textContent),bt=[...b.querySelectorAll('button[data-x="notedel"],button[data-x="remdel"]')];
              return [document.getElementById('xTitle').textContent, nm, bt.map(x=>x.textContent.trim()), bt.map(x=>x.getAttribute('aria-label'))];})()""")
            shot(pg, 'uk-dela-oriona')
            pg.evaluate("closeSheets(); Mascot.tasks.notes().filter(x=>x.t==='Купить BTC після зарплати').forEach(x=>Mascot.tasks.delNote(x.id)); Mascot.tasks.rem().filter(x=>x.t==='Перевірити портфель и купить эфир').forEach(x=>Mascot.tasks.delRem(x.id))"); pg.wait_for_timeout(300)
            if (tk[0] == 'Справи Оріона' and 'Купить BTC після зарплати' in tk[1] and 'Перевірити портфель и купить эфир' in tk[1] and 'Видалити' in tk[2] and 'Скасувати' in tk[2]
                    and 'Видалити: Купить BTC після зарплати' in tk[3] and 'Скасувати: Перевірити портфель и купить эфир' in tk[3]):
                ok('украинский: «Справи Оріона» — заметка «Купить BTC після зарплати» и напоминание показаны ровно как записаны, кнопки — по-украински')
            else: fail('украинский: «Справи Оріона» портят текст человека', str(tk))
            pg.evaluate("window.__askX=null; window.mlAsk=async(q,s,x)=>{window.__askX=x;return {text:'Схоже, біткоїн зростає через новини про ETF.'};}")
            pg.evaluate(f"{M}.ask('чому біткоїн росте')"); pg.wait_for_timeout(1200)
            lang = pg.evaluate("window.__askX&&window.__askX.lang"); said = pg.evaluate(f"{M}.state().said")
            if lang == 'uk' and said == 'Схоже, біткоїн зростає через новини про ETF.': ok('Орион по-украински: «мозг» получает язык uk, ответ звучит без переделки')
            else: fail('Орион по-украински: мозг', f'{lang} | {said}')
            pg.evaluate("openSettings()"); pg.wait_for_timeout(500)
            vu = pg.evaluate("document.getElementById('appVer').textContent.trim()")
            if vu == VER_TXT.replace('Версия', 'Версія').replace('сборка', 'збірка'): ok(f'украинский: внизу настроек «{vu}» — дата и номер збірки те же')
            else: fail('украинский: строка версии', f'{vu} ≠ {VER_TXT}')
            pg.evaluate("document.getElementById('appVer').scrollIntoView({block:'end'})"); pg.wait_for_timeout(300)
            (OUT / 'review').mkdir(exist_ok=True); pg.screenshot(path=str(OUT / 'review' / 'ver-date-settings-uk.png'))
            pg.click('#langSeg [data-lang="ru"]'); pg.wait_for_timeout(2500)
            tabs = pg.evaluate("[...document.querySelectorAll('[data-tab]')].map(b=>b.textContent.trim()).join('|')")
            if pg.evaluate("document.documentElement.lang") == 'ru' and 'Главная' in tabs and pg.evaluate("window.L('Главная')") == 'Главная': ok('украинский: переключатель «Мова / Язык» возвращает русский')
            else: fail('украинский: возврат к русскому', tabs)
        scenario('Украинский язык', {'session': True, 'docs': SEED}, s_uk)

        # 18.11 (охота 17.11, P2 #5): «Проверка рынка — 8:41 и 20:41 по Киеву» и «Подбор альткоинов — 1-го числа, 10:13» в «Правилах»
        #     и «Проверка рынка» в «Данных» видел каждый, хотя это задачи владельца (app/market с source). Теперь — только при ownerFeeds()
        OWN_KV = """()=>{const k=id=>[...document.querySelectorAll('#'+id+'>div')].map(d=>(d.firstElementChild||{}).textContent);return {own:ownerFeeds(),rules:k('rules'),data:k('dataInfo'),hint:document.getElementById('stHint').textContent}}"""
        # 18.11, второй круг (Вера): «Последняя проверка» в «Данных» и подсказка «Изменить правила» про «проверку рынка 2 раза в день» — тоже только у владельца
        T = {'ru': {'rules': ('Проверка рынка', 'Подбор альткоинов'), 'last': 'Последняя проверка', 'common': ('Распределение', 'Новый максимум BTC', 'Курс доллара', 'Записей'),
                    'hint_own': 'Эти правила общие для приложения и для проверки рынка 2 раза в день.', 'hint_user': 'Эти правила — для расчётов в приложении.'},
             'uk': {'rules': ('Перевірка ринку', 'Добір альткоїнів'), 'last': 'Остання перевірка', 'common': ('Розподіл', 'Новий максимум BTC', 'Курс долара', 'Записів'),
                    'hint_own': 'Ці правила спільні для застосунку й для перевірки ринку 2 рази на день.', 'hint_user': 'Ці правила — для розрахунків у застосунку.'}}
        def s_owner_rows(owner, lang='ru'):
            def body(pg, n):
                wait_app(pg)
                if lang == 'uk': pg.evaluate("localStorage.setItem('ml-lang','uk'); location.reload()"); pg.wait_for_timeout(2500); wait_app(pg)
                pg.wait_for_timeout(1200)
                pg.evaluate("openSettings()"); pg.wait_for_timeout(800)
                t = T[lang]; r = pg.evaluate(OWN_KV); who = ('владелец' if owner else 'не владелец') + (', укр.' if lang == 'uk' else ''); bad = []
                if r['own'] != owner: raise AssertionError(f'ownerFeeds()={r["own"]} — сценарий не тот')
                if owner:
                    if not (r['rules'][-2:] == list(t['rules']) and t['rules'][0] in r['data'] and t['last'] in r['data']): bad.append('у владельца пропали строки: ' + str(r))
                    if r['hint'] != t['hint_own']: bad.append('подсказка владельца: ' + r['hint'])
                else:
                    if any(x in r['rules'] + r['data'] for x in t['rules'] + (t['last'],)): bad.append('строки владельца видны: ' + str(r))
                    if r['hint'] != t['hint_user']: bad.append('подсказка не владельца: ' + r['hint'])
                if not all(x in r['rules'] + r['data'] for x in t['common']): bad.append('пропали общие строки: ' + str(r))
                if not bad: ok(f'«Правила», «Данные», «Изменить правила» ({who}): «Проверка рынка», «Подбор альткоинов», «Последняя проверка» и подсказка про проверку ' + ('на месте' if owner else 'не показаны — это задачи владельца') + ', остальные строки на месте')
                else: fail(f'«Правила», «Данные», «Изменить правила» ({who})', '; '.join(bad))
                for th in ('dark', 'light'):
                    pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(300)
                    for blk, el in (('rules', 'rules'), ('dataInfo', 'dataInfo'), ('edit', 'stHint')):
                        pg.evaluate(f"document.getElementById('{el}').scrollIntoView({{block:'center'}})"); pg.wait_for_timeout(300)
                        shot(pg, f"fix-owner-feeds-{'owner' if owner else 'user'}-{blk}-{lang + '-' if lang == 'uk' else ''}{th}")
                if not owner and lang == 'ru':
                    # app/market приходит позже загрузки: у владельца подсказка и строки должны появиться без перезагрузки
                    r2 = pg.evaluate("""()=>{const was=S.market;S.market={source:'agent',updatedAt:Date.now()};render();openSettings();
                        const k=id=>[...document.querySelectorAll('#'+id+'>div')].map(d=>(d.firstElementChild||{}).textContent);
                        const a={hint:document.getElementById('stHint').textContent,data:k('dataInfo'),rules:k('rules')};
                        S.market=was;render();openSettings();a.back=document.getElementById('stHint').textContent;a.dataBack=k('dataInfo');return a;}""")
                    if r2['hint'] == t['hint_own'] and t['last'] in r2['data'] and t['rules'][0] in r2['rules'] and r2['back'] == t['hint_user'] and t['last'] not in r2['dataBack']:
                        ok('«Изменить правила»: проверка рынка пришла позже — подсказка и строки владельца появились без перезагрузки и ушли обратно')
                    else: fail('«Изменить правила»: поздний app/market', str(r2))
            return body
        MARKET = [{'col': 'app', 'id': 'market', 'data': {'source': 'agent', 'updatedAt': NOW}}]
        scenario('Настройки: строки владельца — не владелец', {'session': True, 'docs': SEED}, s_owner_rows(False), dsf=1)
        scenario('Настройки: строки владельца — владелец', {'session': True, 'docs': SEED + MARKET}, s_owner_rows(True), dsf=1)
        scenario('Настройки: строки владельца — не владелец, укр.', {'session': True, 'docs': SEED}, s_owner_rows(False, 'uk'), dsf=1)
        scenario('Настройки: строки владельца — владелец, укр.', {'session': True, 'docs': SEED + MARKET}, s_owner_rows(True, 'uk'), dsf=1)

        # --- складки (12.11.2026): разделы настроек и вкладок сложены, одно нажатие раскрывает; состояние запоминается
        def s_folds(pg, n):
            pg.evaluate("localStorage.setItem('ml-fold-real','1'); localStorage.removeItem('ml-fold'); location.reload()"); pg.wait_for_timeout(2500)
            keys = pg.evaluate("mlFolds.list()"); stt = pg.evaluate("mlFolds.state()")
            need = ['view', 'plan', 'rules', 'edit', 'data', 'acc', 'alloc', 'levels', 'market']
            if all(k in keys for k in need) and not any(stt.values()): ok('складки: настройки (6 разделов) и вкладки сложены по умолчанию')
            else: fail('складки: по умолчанию', f'{keys} {stt}')
            pg.evaluate("openSettings()"); pg.wait_for_timeout(700)
            h = pg.evaluate("document.querySelector('[data-fkey=\"view\"] .fold-b').getBoundingClientRect().height")
            s1 = pg.evaluate("document.querySelector('[data-fkey=\"rules\"] .fold-s').textContent")
            if h < 2 and 'BTC' in s1 and pg.evaluate("document.querySelector('[data-fkey=\"view\"] .fold-b').inert===true"): ok('складки: закрытая — без содержимого, в заголовке сводка («' + s1[:30] + '»)')
            else: fail('складки: закрытая', f'{h} | {s1}')
            shot(pg, 'folds-closed')
            pg.click('[data-fkey="view"] .fold-h'); pg.wait_for_timeout(1300)
            h2 = pg.evaluate("document.querySelector('[data-fkey=\"view\"] .fold-b').getBoundingClientRect().height")
            exp = pg.evaluate("document.querySelector('[data-fkey=\"view\"] .fold-h').getAttribute('aria-expanded')")
            if h2 > 300 and exp == 'true' and pg.locator('#swHide').is_visible(): ok('складки: одно нажатие — раздел раскрылся, переключатели доступны')
            else: fail('складки: раскрытие', f'{h2} {exp}')
            pg.click('#swHide'); pg.wait_for_timeout(300); pg.click('#swHide'); pg.wait_for_timeout(300)
            shot(pg, 'folds-open')
            pg.click('[data-fkey="view"] .fold-h'); pg.wait_for_timeout(900)
            if pg.evaluate("document.querySelector('[data-fkey=\"view\"] .fold-b').getBoundingClientRect().height") < 2: ok('складки: повторное нажатие — сложилась')
            else: fail('складки: сворачивание', 'не сложилась')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(400)
            pg.evaluate("openSettings(true)"); pg.wait_for_timeout(1200)
            if pg.evaluate("mlFolds.state().edit") and pg.locator('#stB').is_visible(): ok('складки: «Изменить правила» из подсказок открывает свою складку сама')
            else: fail('складки: переход к правилам', str(pg.evaluate("mlFolds.state()")))
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(400)
            pg.evaluate("show('strategy')"); pg.wait_for_timeout(600)
            pg.click('[data-fkey="market"] .fold-h'); pg.wait_for_timeout(1200)
            if pg.locator('#stMenu').is_visible(): ok('складки: «Подбор и рынок» во вкладке раскрывается')
            else: fail('складки: вкладка', 'не видно')
            pg.evaluate("location.reload()"); pg.wait_for_timeout(2500)
            st2 = pg.evaluate("mlFolds.state()")
            if st2.get('market') and st2.get('edit') and not st2.get('view'): ok('складки: открытые разделы запоминаются после перезапуска')
            else: fail('складки: запоминание', str(st2))
        scenario('Складки', {'session': True, 'docs': SEED}, s_folds)

        # --- ширина складок (24.11.2026, жалоба владельца, BACKLOG Н3): у .fold-b не было ширины колонки — сетка растягивалась
        #     под содержимое (лента 19 месяцев «Плана альткоинов» = 2272 px), лента не листалась, правое и текст под ней обрезались
        ALT_SYMS = ['ARB', 'FET', 'AAVE', 'LINK', 'IMX', 'FIL', 'ONDO', 'DOGE', 'XRP', 'OP', 'RNDR', 'UNI', 'PYTH', 'SAND', 'AR', 'MKR', 'SHIB', 'XLM', 'TIA']
        ALT_KEYS = [f'2026-{m:02d}' for m in range(6, 13)] + [f'2027-{m:02d}' for m in range(1, 13)]
        ALTPLAN = [{'col': 'app', 'id': 'altplan', 'data': {'approved': True,
                    'months': {k: {'sym': s, 'theme': 'Тема ' + s} for k, s in zip(ALT_KEYS, ALT_SYMS)},
                    'note': 'Тестовый план: одна монета в месяц, сумма — доля альткоинов из DCA. Длинная строка пояснения, чтобы проверить перенос под лентой.'}}]
        FOLD_W = """(()=>{const vw=innerWidth,bad=[];
            for(const f of document.querySelectorAll('.fold')){const fr=f.getBoundingClientRect();if(!fr.width)continue;
              for(const e of [f,f.querySelector(':scope>.fold-b'),f.querySelector(':scope>.fold-b>.fold-in')]){if(!e)continue;const r=e.getBoundingClientRect();
                if(r.width&&(r.left<-0.5||r.right>vw+0.5||r.width>fr.width+0.5))bad.push(f.dataset.fkey+'.'+e.className.split(' ')[0]+'='+Math.round(r.width));}}
            return {bad,n:document.querySelectorAll('.fold').length,doc:document.documentElement.scrollWidth,vw}})()"""
        for fw in (360, 390):
            def s_fold_width(pg, n, fw=fw):
                pg.set_viewport_size({'width': fw, 'height': 844}); wait_app(pg); pg.wait_for_timeout(800)
                bad, seen = [], 0
                for tab in ('home', 'coins', 'strategy', 'activity', 'settings'):
                    if tab == 'settings': pg.evaluate("openSettings()")
                    else: pg.evaluate(f"closeSheets();show('{tab}')")
                    pg.wait_for_timeout(900)
                    r = pg.evaluate(FOLD_W); seen += r['n']
                    bad += [f'{tab}: {x}' for x in r['bad']] + ([f'{tab}: страница {r["doc"]} px'] if r['doc'] > r['vw'] else [])
                if not bad and seen: ok(f'складки: ни одна не шире экрана ({fw} px, вкладки и настройки, складки раскрыты)')
                else: fail(f'складки: ширина на {fw} px', '; '.join(bad)[:500] or 'складок не найдено')
            scenario(f'Складки: ширина {fw} px', {'session': True, 'docs': SEED + ALTPLAN}, s_fold_width, clock='2026-11-24T10:00:00Z')

            def s_alt_scroll(pg, n, fw=fw):
                pg.set_viewport_size({'width': fw, 'height': 844}); wait_app(pg)
                pg.evaluate("show('strategy')"); pg.wait_for_timeout(900)
                pg.evaluate("mlFolds.open('altplan',true)"); pg.wait_for_timeout(900)
                pg.evaluate("document.getElementById('planCard').scrollIntoView({block:'center'})"); pg.wait_for_timeout(500)
                G = """(()=>{const b=document.getElementById('planMonths'),c=document.getElementById('planCard'),t=document.getElementById('planNote'),
                    cur=b.querySelector('.mo.cur'),R=e=>e.getBoundingClientRect(),br=R(b),cr=R(c),tr=R(t),ur=cur?R(cur):null;
                    return {n:b.children.length,cw:b.clientWidth,sw:b.scrollWidth,sl:b.scrollLeft,bl:br.left,brr:br.right,cl:cr.left,crr:cr.right,vw:innerWidth,
                      cur:cur?cur.textContent:'',ul:ur?ur.left:-1,ur:ur?ur.right:-1,tl:tr.left,tr:tr.right,tw:t.clientWidth,tsw:t.scrollWidth,txt:t.textContent}})()"""
                a = pg.evaluate(G)
                # 1) лента внутри карточки и экрана, и при этом шире видимой области — есть что листать
                if a['n'] == 19 and a['cl'] - 0.5 <= a['bl'] and a['brr'] <= min(a['crr'], a['vw']) + 0.5 and a['sw'] > a['cw'] + 300:
                    ok(f'план альткоинов ({fw} px): 19 месяцев, лента в пределах карточки ({a["cw"]} px), содержимое шире ({a["sw"]} px)')
                else: fail(f'план альткоинов ({fw} px): ширина ленты', str({k: a[k] for k in ('n', 'cw', 'sw', 'bl', 'brr', 'cl', 'crr', 'vw')}))
                # 2) карточка текущего месяца (ноябрь 2026) видна сразу — лента сама подкручена к ней
                if 'FIL' in a['cur'] and a['ul'] >= a['bl'] - 0.5 and a['ur'] <= a['brr'] + 0.5 and a['sl'] > 0:
                    ok(f'план альткоинов ({fw} px): текущий месяц (FIL) виден сразу, лента подкручена к нему')
                else: fail(f'план альткоинов ({fw} px): текущий месяц', str({k: a[k] for k in ('cur', 'ul', 'ur', 'bl', 'brr', 'sl')}))
                # 3) пальцем/колесом лента листается: в начало (июнь) и до конца (декабрь 2027)
                pg.evaluate("document.getElementById('planMonths').scrollLeft=0"); pg.wait_for_timeout(200)
                box = pg.evaluate("(()=>{const r=document.getElementById('planMonths').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()")
                pg.mouse.move(box[0], box[1]); pg.mouse.wheel(260, 0); pg.wait_for_timeout(700)
                s1 = pg.evaluate("document.getElementById('planMonths').scrollLeft")
                pg.evaluate("(()=>{const b=document.getElementById('planMonths');b.style.scrollSnapType='none';b.scrollLeft=b.scrollWidth})()"); pg.wait_for_timeout(300)
                e = pg.evaluate("""(()=>{const b=document.getElementById('planMonths'),l=b.lastElementChild,br=b.getBoundingClientRect(),lr=l.getBoundingClientRect();
                    b.style.scrollSnapType='';return {sl:b.scrollLeft,max:b.scrollWidth-b.clientWidth,lr:lr.right,brr:br.right,ll:lr.left,last:l.textContent}})()""")
                if s1 > 0 and e['sl'] > 0 and abs(e['sl'] - e['max']) <= 1 and e['ll'] >= 0 and e['lr'] <= e['brr'] + 0.5 and 'TIA' in e['last']:
                    ok(f'план альткоинов ({fw} px): лента листается (колесо → {round(s1)} px), последний месяц (TIA, дек 2027) доступен')
                else: fail(f'план альткоинов ({fw} px): прокрутка', f'колесо {s1}, конец {e}')
                # 4) текст под лентой — в карточке, с переносом, не обрезан справа
                if a['tl'] >= a['cl'] - 0.5 and a['tr'] <= min(a['crr'], a['vw']) + 0.5 and a['tsw'] <= a['tw'] + 1 and 'Альткоин месяца сейчас: FIL' in a['txt']:
                    ok(f'план альткоинов ({fw} px): текст под лентой целиком в карточке')
                else: fail(f'план альткоинов ({fw} px): текст под лентой', str({k: a[k] for k in ('tl', 'tr', 'tw', 'tsw', 'cl', 'crr')}))
                pg.evaluate("scrollPlan()"); pg.wait_for_timeout(300)
                shot(pg, f'alt-plan-{fw}')
            scenario(f'План альткоинов: прокрутка {fw} px', {'session': True, 'docs': SEED + ALTPLAN}, s_alt_scroll, clock='2026-11-24T10:00:00Z')

        # --- панель вкладок (12.11.2026): у активной вкладки значок поднимается в круге, подпись видна только у неё
        def s_orb(pg, n):
            pg.click('[data-tab="coins"]'); pg.wait_for_timeout(1000)
            r = pg.evaluate("""(()=>{const a=document.querySelector('.tab[data-tab="coins"] .tab-orb').getBoundingClientRect(),b=document.querySelector('.tab[data-tab="home"] .tab-orb').getBoundingClientRect(),
              la=getComputedStyle(document.querySelector('.tab[data-tab="coins"] .tab-lbl')).opacity,lb=getComputedStyle(document.querySelector('.tab[data-tab="home"] .tab-lbl')).opacity,
              nav=document.querySelector('nav.tabs').getBoundingClientRect();return {up:b.top-a.top,la:+la,lb:+lb,above:nav.top-a.top}})()""")
            if r['up'] > 15 and r['la'] > .9 and r['lb'] < .1 and r['above'] > 5: ok('панель вкладок: значок активной вкладки поднят в круге над панелью, подпись только у неё')
            else: fail('панель вкладок: шар', str(r))
            shot(pg, 'tabs-orb')
        scenario('Панель вкладок', {'session': True, 'docs': SEED}, s_orb)

        # --- переключатель темы (12.11.2026): луна/голубое ↔ солнце/оранжевое, надпись «Тёмная/Светлая», «Как в телефоне»
        def s_theme(pg, n):
            pg.evaluate("openSettings()"); pg.wait_for_timeout(700)
            pg.evaluate("document.getElementById('thSw').scrollIntoView({block:'center'})")
            pg.evaluate("P.theme='dark';savePrefs();applyTheme();fillSettings()"); pg.wait_for_timeout(300)
            pg.click('#thSw'); pg.wait_for_timeout(1600)
            r1 = pg.evaluate("[document.documentElement.dataset.theme,P.theme,document.getElementById('thSw').getAttribute('aria-checked'),document.getElementById('thName').textContent]")
            pg.click('#thSw'); pg.wait_for_timeout(1600)
            r2 = pg.evaluate("[document.documentElement.dataset.theme,P.theme,document.getElementById('thSw').getAttribute('aria-checked'),document.getElementById('thName').textContent]")
            if r1 == ['light', 'light', 'true', 'Светлая'] and r2 == ['dark', 'dark', 'false', 'Тёмная'] and not pg.locator('#thAuto, #thLbl').count(): ok('тема: переключатель меняет тёмную ↔ светлую, без надписи снизу и «Как в телефоне»')
            else: fail('тема: переключатель', f'{r1} {r2}')
            pg.click('#thSw'); pg.wait_for_timeout(250)
            sx = pg.evaluate("(()=>{const m=new DOMMatrix(getComputedStyle(document.querySelector('.thsw-knob')).transform);return Math.abs(m.a-1)<0.01})()")
            if sx: ok('тема: кружок переезжает без растяжения')
            else: fail('тема: растяжение', 'кружок растягивается')
            sc = pg.evaluate("[getComputedStyle(document.querySelector('.thsw-sun')).color,getComputedStyle(document.querySelector('.thsw-moon')).color]")
            if sc == ['rgb(255, 154, 60)', 'rgb(63, 169, 255)']: ok('тема: солнце всегда оранжевое, луна всегда голубая (солнце не синеет при уходе)')
            else: fail('тема: цвета значков', str(sc))
            shot(pg, 'theme-switch')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(400)
            pg.evaluate("document.querySelector('.ms-cv').getContext('2d').resetTransform()"); pg.wait_for_timeout(700)
            mt = pg.evaluate("document.querySelector('.ms-cv').getContext('2d').getTransform().a===Math.min(devicePixelRatio||1,2)")
            if mt: ok('Орион возвращает свой размер, если телефон сбросил холст, пока приложение было свёрнуто')
            else: fail('Орион: размер после сброса холста', 'масштаб не восстановлен')
            pg.evaluate("openCoin('BTC')"); pg.wait_for_timeout(600)
            pg.go_back(); pg.wait_for_timeout(600)
            b1 = pg.evaluate("typeof S!=='undefined'&&!document.querySelector('.sheet.open')")
            pg.evaluate("openSettings()"); pg.wait_for_timeout(400); pg.evaluate("closeSheets()"); pg.wait_for_timeout(500)
            b2 = pg.evaluate("!(history.state&&history.state.mlSheet)")
            if b1 and b2: ok('«Назад» на телефоне закрывает открытое окно, а не приложение; крестик не оставляет лишней записи в истории')
            else: fail('«Назад» и окна', f'{b1} {b2}')
        scenario('Тема', {'session': True, 'docs': SEED}, s_theme)

        # --- 12.11.2026: «+» → покупка, ползунок «Купить», смахнуть запись, Орион называет пополненные монеты, шестерёнка
        def s_slide(pg, n):
            pg.click('#plusBtn'); pg.wait_for_timeout(800)
            if pg.evaluate("mode") == 'buy' and pg.evaluate("document.getElementById('saveBtn').classList.contains('slide')"): ok('«+» сразу открывает покупку; внизу ползунок «Купить»')
            else: fail('«+» → покупка', pg.evaluate("mode"))
            before = pg.evaluate("[...window.__mlRows.keys()].filter(k=>k.startsWith('tx/')).length")
            pg.evaluate("document.querySelector('#buyMode [data-m=\"one\"]').click()"); pg.wait_for_timeout(300)
            pg.fill('#oSym', 'BTC'); pg.fill('#oUsd', '50'); pg.fill('#oQty', '0.0005')
            pg.click('#saveBtn'); pg.wait_for_timeout(900)
            mid = pg.evaluate("[...window.__mlRows.keys()].filter(k=>k.startsWith('tx/')).length")
            drag_buy(pg); pg.wait_for_timeout(1500)
            after = pg.evaluate("[...window.__mlRows.keys()].filter(k=>k.startsWith('tx/')).length")
            if mid == before and after == before + 1: ok('ползунок: простое нажатие не покупает, провести вправо — покупка записана')
            else: fail('ползунок «Купить»', f'{before} {mid} {after}')
            line = pg.evaluate("Mascot.debug.buyLine([{sym:'BTC',usd:5},{sym:'ETH',usd:3},{sym:'SOL',usd:2}])").replace(' ', ' ')
            if line.startswith('Биткоин пополнен на 5 долларов, эфир — на 3 доллара, солана — на 2 доллара.') and 'Портфель теперь стоит' in line: ok('Орион о покупке: «' + line[:90] + '…»')
            else: fail('Орион о покупке', line)
            pg.evaluate("show('activity')"); pg.wait_for_timeout(700)
            n0 = pg.evaluate("document.querySelectorAll('#histList .row[data-tx]').length")
            r = pg.evaluate("(()=>{const e=document.querySelector('#histList .row[data-tx]').getBoundingClientRect();return [e.left,e.top,e.width,e.height]})()")
            y = r[1] + r[3] / 2; pg.mouse.move(r[0] + r[2] - 30, y); pg.mouse.down()
            for k in range(1, 10): pg.mouse.move(r[0] + r[2] - 30 - 25 * k, y); pg.wait_for_timeout(20)
            pg.mouse.up(); pg.wait_for_timeout(1500)
            n1 = pg.evaluate("document.querySelectorAll('#histList .row[data-tx]').length"); t = pg.inner_text('#toastMsg')
            if n1 == n0 - 1 and 'удалена' in t: ok('смахнуть запись влево — удалена, в подсказке «Отменить»')
            else: fail('смахивание записи', f'{n0} → {n1} | {t}')
            if pg.locator('#setBtn svg.gear').count(): ok('настройки — значок шестерёнки')
            else: fail('шестерёнка', 'нет')
        scenario('Ползунок и смахивание', {'session': True, 'docs': SEED}, s_slide)

        # --- потянуть вниз (жалоба владельца 12.11): жест обновляет цены и сообщает итог
        def s_ptr(pg, n):
            pg.wait_for_timeout(1500)
            pg.evaluate("window.__inv=0; window.claude.use('mcp').then(m=>{const o=m.invalidate.bind(m);m.invalidate=async(...a)=>{window.__inv++;return o(...a);};})"); pg.wait_for_timeout(200)
            cdp = pg.context.new_cdp_session(pg)
            def t(type, y): cdp.send('Input.dispatchTouchEvent', {'type': type, 'touchPoints': [] if type == 'touchEnd' else [{'x': 200, 'y': y}]})
            t('touchStart', 300)
            for k in range(1, 16): t('touchMove', 300 + k * 15); pg.wait_for_timeout(16)
            t('touchEnd', 0); pg.wait_for_timeout(2500)
            inv = pg.evaluate("window.__inv"); msg = pg.inner_text('#toastMsg'); spin = pg.evaluate("document.querySelector('.ptr').classList.contains('spin')")
            if inv >= 1 and 'Цены обновлены' in msg and not spin: ok('потянуть вниз: цены обновляются, в конце подсказка «Цены обновлены»')
            else: fail('потянуть вниз', f'{inv} | {msg} | spin={spin}')
        scenario('Потянуть вниз', {'session': True, 'docs': SEED}, s_ptr)

        # --- надёжность интерфейса (12.11.2026): ошибки, найденные владельцем на телефоне, не должны вернуться
        def s_ui(pg, errs):
            pg.wait_for_timeout(2500)
            # 1) панель вкладок стоит на месте во время перехода, страница не шире экрана (снимок 11.11 23:35)
            moves, wide = [], []
            for tab in ['coins', 'strategy', 'activity', 'home', 'activity', 'coins', 'home']:
                r = pg.evaluate("""(t)=>new Promise(res=>{const n=document.querySelector('nav.tabs'),a=n.getBoundingClientRect(),out={dy:0,dx:0,w:0};
                  show(t);let k=0;const f=()=>{const b=n.getBoundingClientRect();out.dy=Math.max(out.dy,Math.abs(b.top-a.top));out.dx=Math.max(out.dx,Math.abs(b.left-a.left));
                  out.w=Math.max(out.w,document.documentElement.scrollWidth-innerWidth);if(++k<30)requestAnimationFrame(f);else res(out);};requestAnimationFrame(f);})""", tab)
                moves.append(max(r['dy'], r['dx'])); wide.append(r['w'])
            if max(moves) < 0.5 and max(wide) <= 0: ok('интерфейс: нижняя панель не сдвигается при смене вкладок, страница не шире экрана во время перехода')
            else: fail('интерфейс: панель вкладок', f'сдвиг {max(moves):.1f}px, лишняя ширина {max(wide)}px')
            # 2) на каждой вкладке в обеих темах ничего не вылезает вбок
            bad = []
            for th in ['dark', 'light']:
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')")
                for tab in ['home', 'coins', 'strategy', 'activity']:
                    pg.evaluate(f"show('{tab}')"); pg.wait_for_timeout(450)
                    w = pg.evaluate("document.documentElement.scrollWidth-innerWidth")
                    if w > 0: bad.append(f'{th}/{tab}: +{w}px')
            if not bad: ok('интерфейс: ни на одной вкладке (тёмная и светлая тема) нет прокрутки вбок')
            else: fail('интерфейс: прокрутка вбок', ', '.join(bad))
            # 3) при прокрутке главной сумма не наезжает на карточки ниже (снимок 11.11 23:27)
            pg.evaluate("show('home')"); pg.wait_for_timeout(500)
            over = []
            for y in (120, 300, 600):
                pg.evaluate(f"scrollTo(0,{y})"); pg.wait_for_timeout(250)
                o = pg.evaluate("""(()=>{const h=document.querySelector('#v-home .hero');if(!h)return 0;const hb=h.getBoundingClientRect();let n=h.nextElementSibling;while(n&&!n.getBoundingClientRect().height)n=n.nextElementSibling;if(!n)return 0;return Math.max(0,hb.bottom-n.getBoundingClientRect().top);})()""")
                if o > 1: over.append(f'{y}px: {o:.0f}')
            pg.evaluate("scrollTo(0,0)")
            if not over: ok('интерфейс: при прокрутке главной сумма не наезжает на карточки ниже')
            else: fail('интерфейс: наезд суммы', ', '.join(over))
            # 4) шапка прилипает и не меняет высоту при прокрутке
            h0 = pg.evaluate("document.querySelector('.top').getBoundingClientRect().height")
            pg.evaluate("show('strategy')"); pg.wait_for_timeout(500); h0 = pg.evaluate("document.querySelector('.top').getBoundingClientRect().height")
            pg.evaluate("scrollTo(0,400)"); pg.wait_for_timeout(400)
            h1 = pg.evaluate("document.querySelector('.top').getBoundingClientRect().height"); t1 = pg.evaluate("document.querySelector('.top').getBoundingClientRect().top")
            sy = pg.evaluate("scrollY"); sc = pg.evaluate("document.body.classList.contains('scrolled')")
            pg.evaluate("scrollTo(0,0)")
            if sy > 8 and sc and abs(h1 - h0) < 0.5 and abs(t1) < 1: ok('интерфейс: шапка прилипает к верху и не меняет высоту при прокрутке')
            else: fail('интерфейс: шапка', f'прокрутка {sy}, стекло {sc}, высота {h0:.1f}→{h1:.1f}, верх {t1:.1f}')
            # 5) журнал ошибок и «Сообщить об ошибке»: сбой попадает в отчёт, сумм портфеля в отчёте нет
            pg.evaluate("dispatchEvent(new ErrorEvent('error',{message:'проверка журнала',filename:'https://x/app.js',lineno:7}))"); pg.wait_for_timeout(200)
            rep = pg.evaluate("bugReport()"); tot = pg.evaluate("String(Math.round(derive().total))")
            bh = pg.evaluate("document.getElementById('bugBtn').getBoundingClientRect().height") if pg.evaluate("!!document.getElementById('bugBtn')") else 0
            if 'проверка журнала' in rep and VER_TXT in rep.split('\n') and tot not in rep.replace(' ', '') and bh >= 44: ok('журнал ошибок: сбой попадает в «Сообщить об ошибке», версия есть, сумм портфеля нет, кнопка ≥44 px')
            else: fail('журнал ошибок', rep[-200:] + f' | сумма {tot} | кнопка {bh}')
        scenario('Интерфейс', {'session': True, 'docs': SEED}, s_ui)

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
              /* 18.11: новый телефон, а записи уже есть — «Первая запись» засчитана, начинаем с карточки 2 */
              v=V(null,'2026-11-10',true,true);out.rec=[v.mode,v.st.n,v.st.start,v.st.last];
              st=R(v.st,'2026-11-10');out.recNext=[V(st,'2026-11-10',true,true).mode,V(st,'2026-11-11',true,true).st.n];
              out.recOld=V(null,'2026-11-10',false,true).mode;
              out.recKeep=V({v:1,n:1,read:false,last:'2026-11-09',start:'2026-11-09'},'2026-11-10',true,true).st.n;   /* начатое — не трогаем */
              return out;}""")
            exp = {'first': ['card', 1, '2026-11-10'], 'same': 'read', 'next': ['card', 2], 'skip': ['card', 3], 'back': 'read', 'fwd': ['card', 3],
                   'unread': 4, 'old': 'invite', 'oldHid': 'off', 'd14': [True, 'done', 'gone', 'gone'], 'junk': [1, 1, 1], 'twice': 2,
                   'rec': ['card', 2, '2026-11-10', '2026-11-10'], 'recNext': ['read', 3], 'recOld': 'invite', 'recKeep': 1}
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
            # 13.11 (цель «12 × 14»): новичку прямо сказано, что для пробы можно примерные цифры — запись правится и удаляется в «Активности»
            TRY_RU, TRY_UK = 'Для пробы можно примерные цифры — потом поправишь или удалишь.', 'Для проби можна приблизні цифри — потім виправиш або видалиш.'
            if TRY_RU in st['txt']: ok('14 дней: карточка 1 — «для пробы можно примерные цифры, потом поправишь или удалишь»')
            else: fail('14 дней: карточка 1 без фразы про пробу', st['txt'][:200])
            (OUT / 'review').mkdir(exist_ok=True)
            pg.evaluate("document.getElementById('d14').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300)
            for th in ('dark', 'light'):
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(250)
                pg.screenshot(path=str(OUT / 'review' / f'd14-day1-{th}.png'))
            pg.evaluate("localStorage.setItem('ml-lang','uk'); location.reload()"); wait_app(pg); d14_wait(pg, 'card', 1)
            tu = d14(pg)['txt']
            if TRY_UK in tu and 'Перший запис' in tu and not re.search('[ыэъё]', tu): ok('14 дней, по-украински: карточка 1 с фразой «Для проби можна приблизні цифри…»')
            else: fail('14 дней: карточка 1 по-украински', tu[:200])
            pg.evaluate("document.getElementById('d14').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300)
            pg.screenshot(path=str(OUT / 'review' / 'd14-day1-uk.png'))
            pg.evaluate("localStorage.setItem('ml-lang','ru'); location.reload()"); wait_app(pg); d14_wait(pg, 'card', 1)
            pg.evaluate("window.scrollTo(0,0)")
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
        NEWB = [{'col': 'app', 'id': 'settings', 'data': dict(SEED[0]['data'], onboardedAt='2026-11-10T07:00:00.000Z')}]   # знакомство сегодня, записей нет
        scenario('14 дней: новичок', {'session': True, 'docs': NEWB}, s_d14_new, clock='2026-11-10T08:00:00Z')

        # И2б (охота 17.11 №4). Новый телефон (ключа ml-14d нет), а записи в базе уже есть — карточка не зовёт «Первая запись»
        REC = [{'col': 'app', 'id': 'settings', 'data': dict(SEED[0]['data'], onboardedAt='2026-11-08T10:00:00.000Z')}] + SEED[1:]
        def s_d14_rec(pg, n):
            wait_app(pg); d14_wait(pg, 'card', 2)
            st = d14(pg)
            if 'День 2 из 14' in st['txt'] and 'Первая запись' not in st['txt'] and 'Твои доли' in st['txt']: ok('14 дней, новый телефон с записями: сразу «День 2 из 14», без «Первая запись»')
            else: fail('14 дней: новый телефон с записями', st['txt'][:160])
            segs = pg.evaluate("[...document.querySelectorAll('#d14 .d14-seg i')].slice(0,2).map(i=>i.className)")
            ok('14 дней: шаг 1 отмечен выполненным') if segs == ['on', 'cur'] else fail('14 дней: отметки шагов', str(segs))
            saved = pg.evaluate(f"JSON.parse(localStorage.getItem({D14K})||'null')")
            if saved and saved.get('n') == 2 and saved.get('start') == '2026-11-10': ok('14 дней: на телефоне сохранено «карточка 2», старт сегодня')
            else: fail('14 дней: сохранённое', str(saved))
            r = pg.evaluate("(()=>{const t=S.tx,o=S.settings.onboardedAt;S.tx=[{type:'start',ts:o,symbol:'BTC',qty:1}];const a=d14Rec();S.tx=[];const b=d14Rec();S.tx=t;return [a,b,d14Rec()]})()")
            ok('14 дней: остатки из знакомства — не «свои записи», покупки — да') if r == [False, False, True] else fail('14 дней: d14Rec', str(r))
            pg.evaluate("document.getElementById('d14').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300)
            for th in ('dark', 'light'):
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(250)
                pg.screenshot(path=str(OUT / f'fix-d14-{th}.png'))
            pg.evaluate("document.documentElement.setAttribute('data-theme','dark');localStorage.setItem('ml-lang','uk'); location.reload()"); wait_app(pg); d14_wait(pg, 'card', 2)
            tu = d14(pg)['txt']
            if 'День 2 з 14' in tu and 'Перший запис' not in tu and not re.search('[ыэъё]', tu): ok('14 дней, по-украински: новый телефон с записями — «День 2 з 14»')
            else: fail('14 дней: новый телефон, украинский', tu[:160])
            pg.evaluate("document.getElementById('d14').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300)
            pg.screenshot(path=str(OUT / 'fix-d14-uk.png'))
            pg.evaluate("localStorage.setItem('ml-lang','ru')")
        scenario('14 дней: новый телефон, есть записи', {'session': True, 'docs': REC}, s_d14_rec, clock='2026-11-10T08:00:00Z')

        # И2в. давний пользователь (знакомство 21 день назад) на новом телефоне — приглашение, «Начать» → карточка 2
        def s_d14_vet(pg, n):
            wait_app(pg); d14_wait(pg, 'invite')
            st = d14(pg)
            ok('14 дней: давний пользователь на новом телефоне — приглашение, не «День 1»') if 'Первая запись' not in st['txt'] and 'Начать' in st['txt'] else fail('14 дней: давний на новом телефоне', st['txt'][:160])
            pg.click('#d14 [data-d14="start"]'); d14_wait(pg, 'card', 2)
            ok('14 дней: давний с записями — «Начать» → карточка 2') if 'Первая запись' not in d14(pg)['txt'] else fail('14 дней: «Начать» с записями', d14(pg)['txt'][:120])
        scenario('14 дней: давний на новом телефоне', {'session': True, 'docs': SEED}, s_d14_vet, clock='2026-11-10T08:00:00Z')

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
            pg.click('#d14 [data-d14="start"]'); d14_wait(pg, 'card', 2); ok('14 дней: «Начать» при записях → карточка 2 (первая запись уже есть)')
            pg.click('#d14 [data-d14="ok"]'); d14_wait(pg, 'read', 2)
            # крестик в карточке — тоже «Скрыть»; номер сохраняется
            pg.clock.set_system_time('2026-11-11T09:00:00Z'); d14_tick(pg); d14_wait(pg, 'card', 3)
            pg.click('#d14 [data-d14="x"]'); pg.wait_for_timeout(300)
            hid = not d14(pg)['vis']
            pg.evaluate("d14Hide(false)"); d14_wait(pg, 'card', 3)
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
            pg.click('#d14 [data-d14="go"]'); pg.wait_for_selector('#actSheet.open', timeout=4000)
            ok('14 дней: «Записать покупку» открывает форму покупки') if pg.is_visible('#buyOne') or pg.is_visible('#buyDca') else fail('14 дней: «Записать покупку»', 'нет формы покупки')
            pg.click('#actSheet [data-close]'); pg.wait_for_timeout(400)
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
            if t.startswith('Из чего итог') and all(x in t for x in ('посчитано 2 из 2', 'Резерв USDT — отдельно', 'Вложено в монеты', 'Монеты и резерв вместе')) and 'с ценой' not in t and 'Без цены' not in t: ok('3.0: «Из чего итог» — монеты, вложено, резерв отдельно; цены у всех — «Вложено в монеты» как было')
            else: fail('3.0: из чего итог', t[:300])
            shot(pg, 'v3-total')
        scenario('3.0: главная и итог', {'session': True, 'docs': SEED3}, s_v3_home)

        # 18.11 (охота 17.11, P2 #3): у части монет нет цены — раньше «Вложено в монеты» было по всем ($870), а прибыль — только по монетам
        #     с ценой ($800), и 950 − 870 ≠ 150. Теперь «Вложено в монеты с ценой $800» и «Без цены (не в итоге) $70»; когда цены есть у всех —
        #     как было (проверка выше: «Вложено в монеты» без «с ценой»). ZZQX в тестах — без цены
        TOTNP = SEED3 + [{'col': 'tx', 'id': 'tz', 'data': {'ts': '2026-08-04T10:00:00.000Z', 'type': 'buy', 'symbol': 'ZZQX', 'qty': 1000, 'usd': 70, 'price': 0.07}}]
        TOT_KV = """()=>[...document.querySelectorAll('#xBody .kv>div')].map(d=>[...d.children].map(c=>c.textContent.replace(/\\s+/g,' ').trim()))"""
        def s_total_np(pg, n):
            wait_app(pg); pg.wait_for_timeout(1500)
            d = pg.evaluate("(()=>{const D=derive();return {inv:D.inv,ip:D.invPriced,tot:D.total,zz:+D.prices.ZZQX||0}})()")
            if d['zz'] or abs(d['inv'] - 870) > .01 or abs(d['ip'] - 800) > .01: raise AssertionError('сценарий не воспроизводит находку: ' + str(d))
            pg.click('#hInfo'); pg.wait_for_timeout(800)
            kv = dict((r[0], r[1]) for r in pg.evaluate(TOT_KV) if len(r) == 2); bad = []
            if 'Вложено в монеты' in kv: bad.append('осталось «Вложено в монеты» по всем монетам: ' + kv['Вложено в монеты'])
            if kv.get('Вложено в монеты с ценой') != '$800,00': bad.append(f"«Вложено в монеты с ценой» = {kv.get('Вложено в монеты с ценой')!r}")
            if kv.get('Без цены (не в итоге)') != '$70,00': bad.append(f"«Без цены (не в итоге)» = {kv.get('Без цены (не в итоге)')!r}")
            if not (kv.get('Прибыль сейчас') or '').startswith('+$150,00'): bad.append(f"прибыль {kv.get('Прибыль сейчас')!r} (нужно +$150,00 = $950 − $800)")
            if abs(d['tot'] - 950) > .01: bad.append(f"итог {d['tot']} (нужно 950 — расчёт не должен меняться)")
            keys = [r[0] for r in pg.evaluate(TOT_KV)]
            if keys[:3] != ['Вложено в монеты с ценой', 'Без цены (не в итоге)', 'Прибыль сейчас']: bad.append('порядок строк: ' + str(keys))
            if not bad: ok('«Как посчитано»: у части монет нет цены — «Вложено в монеты с ценой $800», «Без цены (не в итоге) $70», прибыль +$150 сходится ($950 − $800)')
            else: fail('«Как посчитано»: монеты без цены', '; '.join(bad))
            for th in ('dark', 'light'):
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(300)
                pg.evaluate("(document.querySelector('#xBody .kv')||document.body).scrollIntoView({block:'center'})"); pg.wait_for_timeout(300); shot(pg, f'fix-total-priced-{th}')
            pg.evaluate("localStorage.setItem('ml-lang','uk'); location.reload()"); pg.wait_for_timeout(2500); wait_app(pg); pg.wait_for_timeout(800)
            pg.click('#hInfo'); pg.wait_for_timeout(800)
            t = pg.evaluate("document.getElementById('xBody').innerText")
            if 'Вкладено в монети з ціною' in t and 'Без ціни (не в підсумку)' in t and 'Вложено' not in t and 'Без цены' not in t: ok('«Як пораховано» (UA): «Вкладено в монети з ціною», «Без ціни (не в підсумку)»')
            else: fail('«Як пораховано» (UA): новые строки', t[:400])
            for th in ('dark', 'light'):
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(300)
                pg.evaluate("(document.querySelector('#xBody .kv')||document.body).scrollIntoView({block:'center'})"); pg.wait_for_timeout(300); shot(pg, f'fix-total-priced-uk-{th}')
        scenario('Итог: часть монет без цены', {'session': True, 'docs': TOTNP}, s_total_np, dsf=1)

        # --- 13.11.2026 (владелец): ступени тратят долю от ВСЕГО резерва цикла (10/15/20/25/30%), а выполненная ступень
        #     снова открывается после отскока BTC на 10% выше её цены (прошлые траты копятся в spentPrev)
        def s_ladder_total(pg, n):
            wait_app(pg); pg.wait_for_timeout(800)
            pg.evaluate("""db.doc('app/cycle').set({ath:200000,athDate:'2025-10-06',levels:[
                {n:1,drop:30,pct:20,status:'done',spent:50,doneAt:'2026-10-30T10:00:00Z',amt:50},
                {n:2,drop:40,pct:25,status:'pending'},{n:3,drop:50,pct:33,status:'pending'},{n:4,drop:60,pct:50,status:'pending'},{n:5,drop:70,pct:100,status:'pending'}]})""")
            pg.wait_for_timeout(1500)
            r = pg.evaluate("""()=>{const D=derive(),b=lvBase(D);return {res:+D.reserve.toFixed(2),b:+b.toFixed(2),lv:S.cycle.levels.map(l=>[l.status,lvPct(l),+lvPlan(l,D).amt.toFixed(2)])}}""")
            b = r['b']; exp = [round(b * p / 100, 2) for p in (15, 20, 25)]
            if abs(b - (r['res'] + 50)) < 0.01 and [x[1] for x in r['lv']] == [10, 15, 20, 25, 30] and all(abs(r['lv'][i + 1][2] - exp[i]) < 0.02 for i in range(3)) and r['lv'][0][0] == 'done':
                ok('лестница: суммы ступеней — доля от всего резерва цикла (свободный + уже потраченный), старые доли 20/25/33/50/100 читаются как 10/15/20/25/30')
            else: fail('лестница: доля от всего резерва', str(r))
            # BTC в тестах 110000 < 140000·1,1 — ступень 1 ещё не открывается; поднимаем максимум ниже, чтобы цена была «после отскока»
            pg.evaluate("""db.doc('app/cycle').update({ath:126000})"""); pg.wait_for_timeout(2000)
            r2 = pg.evaluate("""()=>({l1:S.cycle.levels[0],al:(S.alerts||[]).filter(a=>a.kind==='rearm').length,base:+lvBase(derive()).toFixed(2)})""")
            l1 = r2['l1']
            if l1['status'] == 'pending' and l1.get('rounds') == 1 and abs(l1.get('spentPrev', 0) - 50) < 0.01 and r2['al'] == 1 and abs(r2['base'] - b) < 0.02:
                ok('лестница: после отскока BTC на 10% выше ступени она снова активна, круг 2, прошлые $50 учтены в резерве цикла, запись в событиях')
            else: fail('лестница: повтор после отскока', str(r2))
            ev = pg.evaluate("""MLX.sigEvents({ath:126000,athDate:'2025-10-06',levels:[{n:1,drop:30,price:88200,r:1}],seen:{'lv:2025-10-06:1:k1':1}},80000)""")
            ok('лестница: сигнал второго круга ступени не глушится прошлым') if len(ev) == 1 and ':r1:' in ev[0]['k'] else fail('лестница: сигнал второго круга', str(ev))
            pg.evaluate("document.querySelector('nav.tabs [data-tab=\"strategy\"]').click()"); pg.wait_for_timeout(600)
            pg.evaluate("document.getElementById('levels').scrollIntoView({block:'start'})"); pg.wait_for_timeout(300)
            shot(pg, 'ladder-total')
        scenario('Лестница: доля и отскок', {'session': True, 'docs': SEED}, s_ladder_total)

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

        # 15.11 (скриншот владельца): «Монет 0.0000930 · $58.59» дало «цена покупки $630 000» — опечатка в количестве;
        # теперь подсказка предупреждает, а первое сохранение останавливается с объяснением (повтор с теми же цифрами сохраняет)
        def s_odd_price(pg, n):
            wait_app(pg); pg.wait_for_timeout(600)
            txn = "[...window.__mlRows.keys()].filter(k=>k.startsWith('tx/')).length"
            pg.evaluate("openAct('buy');setBuyMode('dca')"); pg.wait_for_timeout(700)
            pg.fill('#bq_BTC', '0.00093'); pg.fill('#bu_BTC', '58.59'); pg.wait_for_timeout(250)
            h0 = norm(pg.inner_text('#bh_BTC'))
            pg.fill('#bq_BTC', '0.0000930'); pg.wait_for_timeout(250)
            h1 = norm(pg.inner_text('#bh_BTC'))
            ok('цена покупки сильно выше рынка → подсказка «проверь количество монет»; обычная цена — без предупреждения') if 'рынка' not in h0 and 'сильно выше рынка ($110 000): проверь количество монет' in h1 and '$630 000' in h1 else fail('подсказка о подозрительной цене', f'{h0!r} / {h1!r}')
            for th in ['dark', 'light']:
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(300)
                pg.evaluate("document.getElementById('bh_BTC').scrollIntoView({block:'center'})"); shot(pg, f'odd-price-{th}')
            pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
            a = pg.evaluate(txn); pg.evaluate("saveForm()"); pg.wait_for_timeout(600)
            e1, b = norm(pg.inner_text('#fErr')), pg.evaluate(txn)
            ok('первое сохранение с ценой $630 000 остановлено и объяснено, запись не создана') if b == a and 'Цена покупки BTC $630 000 — сильно выше рынка ($110 000)' in e1 and 'сохрани ещё раз' in e1 else fail('остановка при подозрительной цене', f'{a}->{b} {e1!r}')
            pg.evaluate("saveForm()"); pg.wait_for_timeout(1200)
            c = pg.evaluate(txn)
            ok('повторное сохранение с теми же цифрами записывает покупку как есть (выбор человека)') if c == a + 1 else fail('повторное сохранение', f'{a}->{c}')
        scenario('Цена покупки: опечатка в количестве', {'session': True, 'docs': SEED}, s_odd_price)

        # 15.11 (Глеб к 6b02fe6): «повтор сохраняет» живёт только в той же шторке — закрыл и открыл снова, предупреждение опять есть;
        # та же проверка в «Одна монета» и «Докупке по уровню»; текст предупреждения по-украински
        def s_odd_reset(pg, n):
            wait_app(pg); pg.wait_for_timeout(600)
            txn = "[...window.__mlRows.keys()].filter(k=>k.startsWith('tx/')).length"
            def save(): pg.evaluate("saveForm()"); pg.wait_for_timeout(700); return norm(pg.inner_text('#fErr')), pg.evaluate(txn)
            def plan():
                pg.evaluate("openAct('buy');setBuyMode('dca')"); pg.wait_for_timeout(600)
                pg.fill('#bq_BTC', '0.0000930'); pg.fill('#bu_BTC', '58.59'); pg.wait_for_timeout(250)
            a = pg.evaluate(txn); plan(); e1, b1 = save()
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(500); plan(); e2, b2 = save()
            ok('закрыл и снова открыл «Купить» с теми же цифрами — предупреждение снова, запись не создана') if b1 == b2 == a and 'сильно выше рынка' in e1 and 'сильно выше рынка' in e2 else fail('сброс «повтор сохраняет» при новом открытии', f'{a}->{b1}->{b2} {e2!r}')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(500)
            pg.evaluate("openAct('buy');setBuyMode('one')"); pg.wait_for_timeout(600)
            pg.fill('#oSym', 'BTC'); pg.fill('#oQty', '0.0000930'); pg.fill('#oUsd', '58.59'); pg.wait_for_timeout(300)
            h = norm(pg.inner_text('#oHint')); e3, b3 = save(); e4, b4 = save()
            ok('«Одна монета»: подсказка, остановка, повтор сохраняет') if 'сильно выше рынка' in h and b3 == a and 'Цена покупки BTC $630 000 — сильно выше рынка' in e3 and b4 == a + 1 else fail('«Одна монета»: предупреждение', f'{h!r} {e3!r} {a}->{b3}->{b4}')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(500)
            pg.evaluate("openAct('dip')"); pg.wait_for_timeout(700)
            pg.fill('#du_BTC', '58.59'); pg.fill('#dq_BTC', '0.0000930'); pg.fill('#du_ETH', ''); pg.fill('#du_ALT', ''); pg.wait_for_timeout(300)
            h = norm(pg.inner_text('#dh_BTC')); e5, b5 = save()
            ok('«Докупка по уровню»: подсказка и остановка при цене $630 000') if 'сильно выше рынка' in h and b5 == b4 and 'Цена покупки BTC $630 000 — сильно выше рынка' in e5 else fail('«Докупка по уровню»: предупреждение', f'{h!r} {e5!r} {b4}->{b5}')
            for th in ['dark', 'light']:
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(300)
                pg.evaluate("document.getElementById('fErr').scrollIntoView({block:'center'})"); shot(pg, f'odd-dip-{th}')
            pg.evaluate("document.documentElement.setAttribute('data-theme','dark');closeSheets()")
            pg.evaluate("localStorage.setItem('ml-lang','uk'); location.reload()"); pg.wait_for_timeout(2500); wait_app(pg); pg.wait_for_timeout(600)
            plan(); h = norm(pg.inner_text('#bh_BTC')); e6, _ = save()
            ok('по-украински: «значно вище ринку… перевір кількість монет… збережи ще раз»') if 'значно вище ринку' in h and 'перевір кількість монет' in h and 'Ціна покупки BTC' in e6 and 'Перевір кількість монет.' in e6 and 'Якщо все правильно — збережи ще раз.' in e6 and 'рынка' not in e6 else fail('украинский текст предупреждения', f'{h!r} {e6!r}')
            pg.evaluate("document.getElementById('fErr').scrollIntoView({block:'center'})"); shot(pg, 'odd-uk-dark')
        scenario('Цена покупки: сброс при новом открытии, «Одна монета», «Докупка»', {'session': True, 'docs': SEED + [{'col': 'app', 'id': 'cycle', 'data': CYC}]}, s_odd_reset)

        # P1 #3 охоты 16.11: «Докупка по уровню» больше резерва USDT — первое сохранение останавливается и объясняет, повтор сохраняет;
        # докупка в пределах резерва — сразу; вместе со «странной ценой» — сначала одно предупреждение, потом другое, третье нажатие сохраняет
        def s_dip_reserve(pg, n):
            wait_app(pg); pg.wait_for_timeout(600)
            txn = "[...window.__mlRows.keys()].filter(k=>k.startsWith('tx/')).length"
            def save(): pg.evaluate("saveForm()"); pg.wait_for_timeout(900); return norm(pg.inner_text('#fErr')), pg.evaluate(txn)
            def dip(u, q):
                pg.evaluate("closeSheets()"); pg.wait_for_timeout(500); pg.evaluate("openAct('dip')"); pg.wait_for_timeout(700)
                pg.fill('#du_BTC', u); pg.fill('#dq_BTC', q); pg.fill('#du_ETH', ''); pg.fill('#du_ALT', ''); pg.wait_for_timeout(300)
            a = pg.evaluate(txn); dip('100', '0.000909'); e0, b0 = save()
            ok('докупка $100 при резерве $200 — сохраняется сразу, без предупреждения') if b0 == a + 1 and 'Резерв сейчас' not in e0 else fail('докупка в пределах резерва', f'{a}->{b0} {e0!r}')
            dip('5000', '0.04545'); e1, b1 = save()
            ok('докупка $5 000 при резерве $100 — первое сохранение остановлено, понятный текст') if b1 == b0 and 'Резерв сейчас $100,00 — докупка на $5 000 уведёт его в минус.' in e1 and '(докупал с другого счёта) — сохрани ещё раз.' in e1 else fail('остановка: докупка больше резерва', f'{b0}->{b1} {e1!r}')
            for th in ['dark', 'light']:
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(300)
                pg.evaluate("document.getElementById('fErr').scrollIntoView({block:'center'})"); shot(pg, f'dip-reserve-{th}')
            pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
            e2, b2 = save()
            ok('повтор с теми же цифрами — докупка записана как раньше') if b2 == b1 + 1 and not e2 else fail('повтор: докупка больше резерва', f'{b1}->{b2} {e2!r}')
            dip('58.59', '0.0000930'); e3, b3 = save(); e4, b4 = save(); e5, b5 = save()
            ok('странная цена и нехватка резерва вместе: сначала про цену, потом про резерв, третье нажатие сохраняет') if b3 == b4 == b2 and 'сильно выше рынка' in e3 and 'Резерв сейчас' not in e3 and 'Резерв сейчас -$4 900' in e4 and 'рынка' not in e4 and b5 == b2 + 1 else fail('два предупреждения подряд', f'{b2}->{b3}->{b4}->{b5} {e3!r} {e4!r} {e5!r}')
            dip('', '0.0001'); eq, bq = save()
            ok('резерв уже в минусе, докупка только количеством (без суммы) — сохраняется сразу, без «докупка на $0»') if bq == b5 + 1 and 'Резерв сейчас' not in eq else fail('докупка без суммы при минусовом резерве', f'{b5}->{bq} {eq!r}')
            dip('5000', '0.04545'); e6, b6 = save(); pg.evaluate("closeSheets()")
            pg.evaluate("localStorage.setItem('ml-lang','uk'); location.reload()"); pg.wait_for_timeout(2500); wait_app(pg); pg.wait_for_timeout(600)
            a7 = pg.evaluate(txn); dip('5000', '0.04545'); e7, b7 = save()
            ok('закрыл и открыл шторку — предупреждение снова; по-украински «Резерв зараз… виведе його в мінус… збережи ще раз»') if b6 == bq and 'Резерв сейчас' in e6 and b7 == a7 and 'Резерв зараз' in e7 and 'виведе його в мінус.' in e7 and '(докупав з іншого рахунку) — збережи ще раз.' in e7 and not re.search('[ыэъё]', e7) else fail('сброс и украинский текст', f'{b5}->{b6} {a7}->{b7} {e7!r}')
            pg.evaluate("document.getElementById('fErr').scrollIntoView({block:'center'})"); shot(pg, 'dip-reserve-uk-dark')
        scenario('Докупка больше резерва USDT: предупреждение', {'session': True, 'docs': SEED + [{'col': 'app', 'id': 'cycle', 'data': CYC}]}, s_dip_reserve)

        # №2 охоты 16.11: формы не сохраняют сумму или количество с минусом — понятная подпись над «Сохранить», запись не создаётся;
        # законные случаи как были: пополнение без гривны, «Остаток» без суммы
        def s_neg(pg, n):
            wait_app(pg); pg.wait_for_timeout(600)
            txn = "[...window.__mlRows.keys()].filter(k=>k.startsWith('tx/')).length"
            def save(): pg.evaluate("saveForm()"); pg.wait_for_timeout(700); return norm(pg.inner_text('#fErr')), pg.evaluate(txn)
            def snap(tag):
                for th in ['dark', 'light']:
                    pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(300)
                    pg.evaluate("document.getElementById('fErr').scrollIntoView({block:'center'})"); shot(pg, f'neg-{tag}-{th}')
                pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
            a = pg.evaluate(txn); bad = []
            pg.evaluate("openAct('deposit')"); pg.wait_for_timeout(600); pg.fill('#depUah', ''); pg.fill('#depUsd', '-50'); pg.wait_for_timeout(200)
            e, b = save()
            if not (b == a and 'Впиши сумму больше нуля' in e): bad.append(f'пополнение: {e} {b}')
            snap('dep')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(500)
            pg.evaluate("openAct('sell')"); pg.wait_for_timeout(600); pg.select_option('#sSym', 'BTC'); pg.fill('#sQty', '0.001'); pg.fill('#sUsd', '-10'); pg.wait_for_timeout(200)
            e, b = save()
            if not (b == a and 'Впиши сумму больше нуля' in e): bad.append(f'продажа: {e} {b}')
            snap('sell')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(500)
            pg.evaluate("openAct('buy');setBuyMode('one')"); pg.wait_for_timeout(600); pg.fill('#oSym', 'BTC'); pg.fill('#oUsd', '-100'); pg.wait_for_timeout(200)
            e, b = save()
            if not (b == a and 'Впиши сумму больше нуля' in e): bad.append(f'«Одна монета»: {e} {b}')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(500)
            pg.evaluate("openAct('start')"); pg.wait_for_timeout(600); pg.fill('#nsSym', 'BTC'); pg.fill('#nsQty', '-1'); pg.wait_for_timeout(200)
            e, b = save()
            if not (b == a and 'Впиши количество больше нуля' in e): bad.append(f'«Остаток»: {e} {b}')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(500)
            pg.evaluate("openTx('t2')"); pg.wait_for_timeout(600); pg.fill('#eQty', '-0.001'); pg.evaluate("saveTx()"); pg.wait_for_timeout(700)
            e, q = norm(pg.inner_text('#eErr')), pg.evaluate("S.tx.find(t=>t.id==='t2').qty")
            if not (q == 0.005 and 'Впиши количество больше нуля' in e): bad.append(f'правка записи: {e} {q}')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(500)
            if not bad: ok('минус не сохраняется: пополнение, продажа, «Одна монета», «Остаток» и правка записи — подпись «больше нуля», записи нет')
            else: fail('минус в формах', ' | '.join(bad))
            pg.evaluate("openAct('deposit')"); pg.wait_for_timeout(600); pg.fill('#depUah', ''); pg.fill('#depUsd', '50'); pg.wait_for_timeout(200)
            e, b = save()
            pg.evaluate("openAct('start')"); pg.wait_for_timeout(600); pg.fill('#nsSym', 'SOL'); pg.fill('#nsQty', '2'); pg.fill('#nsUsd', ''); pg.wait_for_timeout(200)
            e2, c = save()
            if b == a + 1 and c == a + 2: ok('законные случаи как были: пополнение без гривны и «Остаток» без суммы сохраняются')
            else: fail('законные случаи', f'{a}->{b}->{c} {e} {e2}')
        scenario('Формы: сумма с минусом', {'session': True, 'docs': SEED}, s_neg)

        # №4 охоты 16.11: «1,5» с запятой в поле суммы молча становилось 15 (ошибка в 10 раз). Теперь запятая — десятичный разделитель
        # во всех полях денег и количеств; набираем с клавиатуры, как человек; минус в «Поправке резерва» вводится как раньше
        def s_comma(pg, n):
            wait_app(pg); pg.wait_for_timeout(600); bad = []
            def typ(sel, text): pg.click(sel); pg.keyboard.type(text, delay=30); pg.wait_for_timeout(250)
            pg.evaluate("openAct('deposit')"); pg.wait_for_timeout(600); pg.fill('#depUah', '')
            typ('#depUsd', '1,5'); v = pg.input_value('#depUsd')
            exp = pg.evaluate("[usd(1.5*depShare()),usd(1.5*(1-depShare()))]"); calc = pg.inner_text('#depCalc')
            if v != '1.5': bad.append(f'«Пришло, USDT»: {v!r}')
            if not all(x in calc for x in exp): bad.append(f'подсказка пополнения: {calc!r}, ждали {exp}')
            for th in ['dark', 'light']:
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(300); shot(pg, f'comma-dep-{th}')
            pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(500)
            pg.evaluate("openAct('buy');setBuyMode('one')"); pg.wait_for_timeout(600); pg.fill('#oSym', 'BTC'); pg.fill('#oUsd', '150')
            typ('#oQty', '1,5'); v = pg.input_value('#oQty'); h = pg.inner_text('#oHint')
            if v != '1.5': bad.append(f'«Получил монет»: {v!r}')
            if pg.evaluate("usd(100)") not in h: bad.append(f'подсказка «Одна монета» не от 1,5: {h!r}')
            pg.fill('#oQty', ''); typ('#oQty', '15'); pg.keyboard.press('ArrowLeft'); pg.keyboard.type(','); pg.keyboard.type('2'); pg.wait_for_timeout(200)
            v = pg.input_value('#oQty')
            if v != '1.25': bad.append(f'запятая посреди числа: {v!r} (курсор должен остаться на месте)')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(500)
            pg.evaluate("openAct('reserve',{kind:'reserve_adj'})"); pg.wait_for_timeout(600)
            typ('#resAmt', '-12,5'); v = pg.input_value('#resAmt')
            if v != '-12.5': bad.append(f'поправка резерва с минусом: {v!r}')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(500)
            if not bad: ok('запятая в дробях: «1,5» = 1.5 в «Пришло, USDT» и «Получил монет», подсказки от 1,5; курсор на месте; минус в поправке резерва вводится')
            else: fail('запятая в дробях', ' | '.join(bad))
        scenario('Формы: запятая в дробях', {'session': True, 'docs': SEED}, s_comma, dsf=1)
        # №5 охоты 16.11: после «Продать → всё» остаток монеты — копейка округления (0,1 + 0,123456789 − «всё» 0,22345679 ≈ −1e-9), и карточка показывала
        # «−0 ETH», «−$0,00», «−0,0% портфеля». Ноль при показе — без минуса и без знака; расчёты не меняются
        def s_minus_zero(pg, n):
            wait_app(pg); pg.wait_for_timeout(600)
            pg.evaluate("openAct('sell')"); pg.wait_for_timeout(600); pg.select_option('#sSym', 'ETH'); pg.click('#sAll'); pg.fill('#sUsd', '1200')
            pg.evaluate("saveForm()"); pg.wait_for_timeout(900)
            left = pg.evaluate("derive().h.ETH.qty")
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(400); pg.evaluate("openCoin('ETH')"); pg.wait_for_timeout(900)
            txt = pg.evaluate("[document.getElementById('cvStats').innerText,document.getElementById('cvMeta').innerText,document.getElementById('cvSub').innerText].join(' | ')")
            fmt = pg.evaluate("[qty(-2e-11),qtyS(-2e-11),usd(-0.004),money(-0.001,{sign:true}),money(0.001,{sign:true}),pct(-0.04),pct(0.04),nf(-1e-9,1),usd(-0.5),pct(-1.26),qty(-0.5)]")
            for th in ['dark', 'light']:
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(300); shot(pg, f'minus-zero-coin-{th}')
                pg.evaluate("setFlip(true)"); pg.wait_for_timeout(700); shot(pg, f'minus-zero-coin-back-{th}')
                txt += ' | ' + pg.evaluate("document.getElementById('cvStats').innerText"); pg.evaluate("setFlip(false)"); pg.wait_for_timeout(500)
            pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
            t = norm(txt); bad = [s for s in ['-0 ', '-0,0', '-$0,00', '+0,0%', '+$0,00'] if s in t]
            want = ['0', '0', '$0,00', '$0,00', '$0,00', '0,0%', '0,0%', '0,0', '-$0,50', '-1,3%', '-0,5']
            if not left < 0: bad.append(f'остаток не отрицательный ({left}) — сценарий не воспроизводит находку')
            if not bad and [norm(x) for x in fmt] == want: ok(f'ноль без минуса: после «Продать всё» (остаток {left:.1e}) в карточке нет «−0», «−$0,00», «−0,0%»; минус у настоящих сумм на месте')
            else: fail('ноль без минуса', f'{bad} {fmt} {t[:300]!r}')
        scenario('Карточка монеты: ноль без минуса', {'session': True, 'docs': SEED + [{'col': 'tx', 'id': 't5', 'data': {'ts': '2026-08-04T10:00:00.000Z', 'type': 'buy', 'symbol': 'ETH', 'qty': 0.123456789, 'usd': 500, 'price': 4050}}]}, s_minus_zero, dsf=1)

        # 17.11 (охота 17.11, P1 #2): ступень открыта, у альткоина месяца нет цены — раньше в «Ступенях лестницы» зелёное «$0,000000»
        #     (зелёный = «можно сейчас»), на Главной в «Можно докупить» — зелёный чип. Теперь — серое «нет цены» (--mute);
        #     правило ключа 2 не менялось: статус «можно» и сумма те же. Монета ZZQX — без цены
        LADNP = [dict(SEED[0], data=dict(SEED[0]['data'], altOfMonth='ZZQX'))] + SEED[1:] + [{'col': 'app', 'id': 'cycle', 'data': dict(CYC, ath=200000)}]
        STEP_NP = """()=>{const mute=(()=>{const e=document.createElement('i');e.style.color='var(--mute)';document.body.appendChild(e);const c=getComputedStyle(e).color;e.remove();return c})();
            const r=[...document.querySelectorAll('#levels .lvc-r')].find(x=>(x.querySelector('b')||{}).textContent==='ZZQX'),px=r&&r.querySelector('.px'),
              ch=[...document.querySelectorAll('#signal .chip')].find(x=>/^ZZQX/.test(x.textContent)),btc=[...document.querySelectorAll('#signal .chip')].find(x=>/^BTC/.test(x.textContent));
            return {mute,st:r&&r.className,px:px&&px.textContent.trim(),pxc:px&&getComputedStyle(px.querySelector('.np')||px).color,
              ch:ch&&ch.textContent.trim(),chc:ch&&getComputedStyle(ch).color,chPos:!!ch&&ch.classList.contains('pos'),btcPos:!!btc&&btc.classList.contains('pos'),
              lv:document.getElementById('levels').innerText,sig:document.getElementById('signal').innerText}}"""
        def s_step_noprice(pg, n):
            wait_app(pg); pg.wait_for_timeout(1200)
            if pg.evaluate("+derive().prices.ZZQX||0"): raise AssertionError('у ZZQX есть цена — сценарий не воспроизводит находку')
            for th in ['dark', 'light']:
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(300)
                pg.evaluate("document.getElementById('signal').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300); shot(pg, f'step-noprice-home-{th}')
            pg.evaluate("document.querySelector('nav.tabs [data-tab=\"strategy\"]').click()"); pg.wait_for_timeout(900)
            for th in ['dark', 'light']:
                pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(300)
                pg.evaluate("document.getElementById('levels').scrollIntoView({block:'start'})"); pg.wait_for_timeout(300); shot(pg, f'step-noprice-strategy-{th}')
                r = pg.evaluate(STEP_NP); bad = []
                if not r['st'] or 'go' not in r['st']: bad.append(f"ступень ZZQX не «можно» ({r['st']}) — правило ключа 2 должно остаться как было")
                if r['px'] != 'нет цены' or r['pxc'] != r['mute']: bad.append(f"ступень: {r['px']!r} цветом {r['pxc']} (нужно --mute {r['mute']})")
                if not r['ch'] or 'нет цены' not in r['ch'] or r['chPos'] or r['chc'] != r['mute'] or not r['btcPos']: bad.append(f"«Можно докупить»: {r['ch']!r} pos={r['chPos']} {r['chc']} BTC pos={r['btcPos']}")
                if re.search(r'\$0,0{4}', r['lv'] + r['sig']): bad.append('где-то осталось «$0,0000…»')
                if not bad: ok(f'монета без цены на ступени ({th}): «нет цены» серым вместо зелёного «$0,000000»; в «Можно докупить» чип ZZQX серый, BTC — зелёный; статус «можно» как был')
                else: fail(f'монета без цены на ступени ({th})', ' | '.join(bad))
            pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
        scenario('Ступень: монета без цены', {'session': True, 'docs': LADNP}, s_step_noprice)

        # хвост #2 (после 3113f81): подсказки расчёта под полями не считают по минусу — «Зафиксируешь −$110», «Резерв станет $175» были бредом;
        # с минусом — прежняя подсказка «Впиши…» или «—», с обычной суммой — расчёт как был
        def s_neg_hints(pg, n):
            wait_app(pg); pg.wait_for_timeout(600)
            T = lambda sel: norm(pg.inner_text(sel))
            def snap(tag, sel):
                for th in ['dark', 'light']:
                    pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(300)
                    pg.evaluate(f"document.querySelector('{sel}').scrollIntoView({{block:'center'}})"); shot(pg, f'neg-hint-{tag}-{th}')
                pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
            bad = []
            pg.evaluate("openAct('sell')"); pg.wait_for_timeout(600); pg.select_option('#sSym', 'BTC'); pg.fill('#sQty', '0.001'); pg.fill('#sUsd', '-10'); pg.wait_for_timeout(200)
            h = T('#sCalc'); snap('sell', '#sCalc')
            if '-$' in h or 'Зафиксируешь' in h or 'Цена продажи' in h: bad.append(f'продажа, сумма с минусом: {h!r}')
            pg.fill('#sUsd', '120'); pg.wait_for_timeout(200); h = T('#sCalc')
            if 'Зафиксируешь' not in h or '+$20' not in h: bad.append(f'продажа, обычная сумма: {h!r}')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(500); pg.evaluate("openAct('sell')"); pg.wait_for_timeout(600); pg.select_option('#sSym', 'BTC')
            pg.fill('#sQty', '-0.001'); pg.wait_for_timeout(200); h = T('#sCalc'); v = pg.input_value('#sUsd')
            if '-$' in h or 'Себестоимость' in h or 'Впиши количество' not in h or v.startswith('-'): bad.append(f'продажа, количество с минусом: {h!r} {v!r}')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(500)
            pg.evaluate("openAct('deposit')"); pg.wait_for_timeout(600); pg.fill('#depUah', ''); pg.fill('#depUsd', '-50'); pg.wait_for_timeout(200)
            h = T('#depCalc'); snap('dep', '#depCalc')
            if '-$' in h or 'Резерв станет' in h or 'Впиши сумму пополнения' not in h: bad.append(f'пополнение, $ с минусом: {h!r}')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(500); pg.evaluate("openAct('deposit')"); pg.wait_for_timeout(600)
            pg.fill('#depUah', '-2000'); pg.wait_for_timeout(200); h = T('#depCalc'); v = pg.input_value('#depUsd')
            if '-$' in h or 'Резерв станет' in h or v.startswith('-'): bad.append(f'пополнение, гривна с минусом: {h!r} {v!r}')
            pg.fill('#depUah', ''); pg.fill('#depUsd', '50'); pg.wait_for_timeout(200); h = T('#depCalc')
            if 'Резерв станет' not in h: bad.append(f'пополнение, обычная сумма: {h!r}')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(500)
            pg.evaluate("openAct('income')"); pg.wait_for_timeout(600); pg.fill('#incUah', '-1000'); pg.wait_for_timeout(200); h = T('#incCalc')
            if '-' in h.replace('—', '') or 'Впиши сумму' not in h: bad.append(f'доход: {h!r}')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(500)
            pg.evaluate("openAct('buy');setBuyMode('one')"); pg.wait_for_timeout(600); pg.fill('#oSym', 'BTC'); pg.fill('#oUsd', '-100'); pg.wait_for_timeout(200); h = T('#oHint')
            if h != '—': bad.append(f'«Одна монета»: {h!r}')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(500)
            pg.evaluate("openAct('dip')"); pg.wait_for_timeout(700); pg.fill('#dTotal', '-100'); pg.wait_for_timeout(200)
            v = [pg.input_value(f'#du_{k}') for k in ['BTC', 'ETH', 'ALT']]
            pg.fill('#du_BTC', '-50'); pg.wait_for_timeout(200); h = T('#dh_BTC')
            if any(x.startswith('-') for x in v) or h != '—': bad.append(f'докупка: {v} {h!r}')
            pg.evaluate("closeSheets()"); pg.wait_for_timeout(500)
            pg.evaluate("openAct('earn')"); pg.wait_for_timeout(600); pg.fill('#erBal', '-5'); pg.wait_for_timeout(200); h = T('#erCalc')
            if 'Разница' in h or 'Впиши сумму' not in h: bad.append(f'стейкинг: {h!r}')
            pg.evaluate("closeSheets()")
            if not bad: ok('подсказки с минусом: «Продать», «Пополнить биржу», «Доход», «Купить», «Докупка», «Стейкинг» — без расчёта и без «−$»; с обычной суммой расчёт как был')
            else: fail('подсказки с минусом', ' | '.join(bad))
        scenario('Формы: подсказки при минусе', {'session': True, 'docs': SEED + [{'col': 'app', 'id': 'cycle', 'data': CYC}]}, s_neg_hints)

        # 17.11 (охота 17.11, P1 #1): монета без цены и в строке только сумма в $ — раньше эта часть молча не записывалась
        #     (из $100 записалось ETH $60, SOL $40 пропал). Теперь: сохранение останавливается целиком, в строке и внизу — «нет цены»;
        #     вписал количество — записываются все строки, как раньше. Монета ZZQX — без цены (нет в справочнике и на биржах)
        CYC_OPEN = dict(CYC, ath=200000)   # BTC $110 000 — −45% от максимума: уровни 1 и 2 открыты
        NOP = SEED + [{'col': 'app', 'id': 'cycle', 'data': CYC_OPEN}]
        NOP[0] = dict(NOP[0], data=dict(NOP[0]['data'], altOfMonth='ZZQX'))
        def s_topup_noprice(pg, n):
            wait_app(pg); pg.wait_for_timeout(800)
            T = lambda sel: norm(pg.inner_text(sel)); bad = []
            ntx = lambda: pg.evaluate("S.tx.length")
            def save(): pg.evaluate("saveForm()"); pg.wait_for_timeout(900)
            def snap(tag, sel):
                for th in ['dark', 'light']:
                    pg.evaluate(f"document.documentElement.setAttribute('data-theme','{th}')"); pg.wait_for_timeout(300)
                    pg.evaluate(f"document.querySelector('{sel}').scrollIntoView({{block:'center'}})"); pg.wait_for_timeout(200); shot(pg, f'topup-noprice-{tag}-{th}')
                pg.evaluate("document.documentElement.setAttribute('data-theme','dark')")
            # «Купить → По плану»
            pg.evaluate("openAct('buy');setBuyMode('dca')"); pg.wait_for_timeout(600)
            pg.fill('#bAlt', 'ZZQX'); pg.fill('#bTotal', '100'); pg.wait_for_timeout(300)
            if pg.evaluate("+derive().prices.ZZQX||0"): raise AssertionError('у ZZQX есть цена — сценарий не воспроизводит находку')
            u = [pg.input_value(f'#bu_{k}') for k in ['BTC', 'ETH', 'ALT']]; h = T('#bh_ALT'); t0 = ntx()
            if 'нет цены' not in h: bad.append(f'«По плану»: подсказка в строке ZZQX {h!r}')
            save(); e = T('#fErr')
            if ntx() != t0 or 'Нет цены ZZQX' not in e: bad.append(f'«По плану», без количества: записей {ntx() - t0}, ошибка {e!r}, суммы {u}')
            snap('buy', '#bh_ALT')
            pg.fill('#bq_ALT', '5'); pg.wait_for_timeout(200); save()
            new = pg.evaluate(f"S.tx.slice().sort((a,b)=>String(a.ts).localeCompare(String(b.ts))).filter(x=>x.type==='dca').map(x=>[x.symbol,x.qty,x.usd])")
            z = [x for x in new if x[0] == 'ZZQX']
            if ntx() != t0 + 3 or not z or z[0][1] != 5 or z[0][2] != 20: bad.append(f'«По плану», с количеством: записей {ntx() - t0}, {new}')
            # «Докупка по уровню»
            pg.evaluate("openAct('dip')"); pg.wait_for_timeout(700)
            if not pg.input_value('#du_ALT'): pg.fill('#du_ALT', '8')
            if not pg.input_value('#du_BTC'): pg.fill('#du_BTC', '10')   # BTC с ценой — раньше записывался один, ZZQX пропадал
            pg.fill('#dq_ALT', ''); pg.wait_for_timeout(200)
            t1 = ntx(); cyc0 = pg.evaluate("JSON.stringify(S.cycle.levels)"); save(); e = T('#fErr')
            if ntx() != t1 or pg.evaluate("JSON.stringify(S.cycle.levels)") != cyc0 or 'Нет цены ZZQX' not in e or 'нет цены' not in T('#dh_ALT'):
                bad.append(f'«Докупка», без количества: записей {ntx() - t1}, ошибка {e!r}')
            snap('dip', '#dh_ALT')
            pg.fill('#dq_ALT', '2'); pg.wait_for_timeout(200); save()
            if ntx() == t1 and 'Резерв' in T('#fErr'): save()   # предупреждение о резерве — повтор сохраняет, как раньше
            d = pg.evaluate("S.tx.filter(x=>x.type==='dip').map(x=>[x.symbol,x.qty,x.level])")
            if not any(x[0] == 'ZZQX' and x[1] == 2 for x in d) or not any(x[0] == 'BTC' for x in d): bad.append(f'«Докупка», с количеством: {d} {T("#fErr")!r}')
            if not bad: ok('монета без цены и только сумма: «По плану» и «Докупка» не сохраняют ничего, в строке и внизу «Нет цены ZZQX — впиши количество»; с количеством записываются все строки')
            else: fail('монета без цены и только сумма', ' | '.join(bad))
        scenario('Формы: монета без цены, только сумма', {'session': True, 'docs': NOP}, s_topup_noprice)

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

        # 15.11 (Вера, охота #3): в демо аккаунта нет — после открытия «Настроек» «Скачать мои данные», «Выйти» и «Удалить аккаунт» скрыты,
        #     «Создать аккаунт» на полосе «Демо» на месте; у обычного входа все три кнопки видны, как раньше
        ACC = """()=>{const v=id=>{const e=document.getElementById(id);return !!e&&!e.hidden&&e.getBoundingClientRect().height>0};
            return {exp:v('expBtn'),out:v('outBtn'),del:v('delBtn'),go:v('mlDemoGo'),acc:document.getElementById('accInfo').textContent.trim()}}"""
        for th in ('dark', 'light'):
            def s_demo_acc(pg, n, th=th):
                pg.wait_for_selector('#mlaDemo', state='visible', timeout=8000)
                pg.click('#mlaDemo'); wait_app(pg); pg.wait_for_timeout(2500)
                pg.click('#setBtn'); pg.wait_for_timeout(900)
                pg.evaluate("document.getElementById('accInfo').scrollIntoView({block:'center'})"); pg.wait_for_timeout(500)
                r = pg.evaluate(ACC)
                if not r['exp'] and not r['out'] and not r['del'] and r['go']: ok(f'демо ({th}): в «Настройках → Аккаунт» нет «Скачать мои данные», «Выйти», «Удалить аккаунт»; «Создать аккаунт» на полосе')
                else: fail(f'демо ({th}): кнопки аккаунта', str(r))
                pg.screenshot(path=str(OUT / f'fix-demo-account-{th}.png'))
            scenario(f'Демо — кнопки аккаунта скрыты ({th})', {'session': False, 'docs': []}, s_demo_acc, dsf=1, theme=th)
            def s_user_acc(pg, n, th=th):
                wait_app(pg); pg.wait_for_timeout(500)
                pg.click('#setBtn'); pg.wait_for_timeout(900)
                pg.evaluate("document.getElementById('accInfo').scrollIntoView({block:'center'})"); pg.wait_for_timeout(500)
                r = pg.evaluate(ACC); d = pg.evaluate("!!(window.ML_CONFIG&&ML_CONFIG.accountDelete)")
                if r['exp'] and r['out'] and r['del'] == d and not r['go']: ok(f'обычный вход ({th}): «Скачать мои данные», «Выйти из аккаунта» видны, «Удалить аккаунт» — по флагу ({d})')
                else: fail(f'обычный вход ({th}): кнопки аккаунта', str(r))
                pg.screenshot(path=str(OUT / f'fix-user-account-{th}.png'))
            scenario(f'Обычный вход — кнопки аккаунта на месте ({th})', {'session': True, 'docs': SEED}, s_user_acc, dsf=1, theme=th)

        # --- 14.11 (разбор Льва, «12 × 14»): подсказка «На главный экран» — один раз после знакомства. Android Chrome: событие
        #     beforeinstallprompt (имитация с фиктивным prompt()), iPhone Safari: строка «Поделиться → На экран „Домой“».
        #     Закрыл/поставил — флаг ml-inst на телефоне, больше не показываем; в установленном приложении и в демо — нет
        BIP = """()=>{const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=()=>{window.__pr=(window.__pr||0)+1;return Promise.resolve({outcome:'accepted'})};
            e.userChoice=Promise.resolve({outcome:'accepted'});dispatchEvent(e);return e.defaultPrevented}"""
        INST = """()=>{const el=document.getElementById('inst'),r=el.getBoundingClientRect(),hit=id=>{const x=document.getElementById(id);if(!x||x.hidden)return false;const q=x.getBoundingClientRect();return q.height>0&&q.bottom>r.top+.5&&q.top<r.bottom-.5};
            return {vis:!el.hidden&&r.height>0,txt:el.innerText.replace(/\\s+/g,' ').trim(),btn:[...el.querySelectorAll('button')].map(b=>[b.textContent.trim(),Math.round(b.getBoundingClientRect().height)]),
            lab:(el.querySelector('[role=region]')||{getAttribute:()=>null}).getAttribute('aria-label'),
            bp:[...el.querySelectorAll('button')].map(b=>{const c=getComputedStyle(b),q=b.getBoundingClientRect(),g=document.createRange();g.selectNodeContents(b);const t=g.getBoundingClientRect(),ln=g.getClientRects().length;
              return {pl:parseFloat(c.paddingLeft),pr:parseFloat(c.paddingRight),l:Math.round(t.left-q.left),r:Math.round(q.right-t.right),one:ln===1&&b.scrollWidth<=b.clientWidth+.5}}),
            ic:[...el.querySelectorAll('small svg')].map(s=>{const r=s.getBoundingClientRect(),c=getComputedStyle(s);return {w:Math.round(r.width),h:Math.round(r.height),hid:s.getAttribute('aria-hidden'),fill:s.getAttribute('fill'),
              paint:[...s.querySelectorAll('*')].some(x=>x.getAttribute('fill')||x.getAttribute('style')||(x.getAttribute('stroke')&&x.getAttribute('stroke')!=='currentColor')),stroke:s.getAttribute('stroke'),col:c.color===getComputedStyle(s.parentElement).color}}),
            wide:el.scrollWidth>el.clientWidth+.5||[...el.querySelectorAll('*')].some(x=>{const q=x.getBoundingClientRect();return q.width>0&&(q.right>innerWidth+.5||q.left<-.5)}),
            over:hit('signal')||hit('d14'),below:['signal','d14'].every(id=>{const x=document.getElementById(id);return !x||x.hidden||x.getBoundingClientRect().bottom<=r.top+.5}),flag:localStorage.getItem('ml-inst'),pr:window.__pr||0}}"""
        for th in ('dark', 'light'):
            def s_inst(pg, n, th=th):
                wait_app(pg); pg.wait_for_timeout(500)
                if pg.evaluate("document.documentElement.dataset.theme") != th: raise AssertionError('тема не включилась: ' + th)
                r0 = pg.evaluate(INST)
                prev = pg.evaluate(BIP); pg.wait_for_timeout(300); r = pg.evaluate(INST)
                if not r0['vis'] and prev and r['vis'] and r['btn'] == [['Установить', r['btn'][0][1]], ['Не сейчас', r['btn'][1][1]]] and min(b[1] for b in r['btn']) >= 48 and 'Поставь на главный экран' in r['txt'] and r['lab'] == 'Поставь на главный экран' and not r['ic']:
                    ok(f'«На главный экран» ({th}): без события браузера не видна; с beforeinstallprompt — карточка «Установить» / «Не сейчас», кнопки ≥ 48 px')
                else: fail(f'«На главный экран» ({th}): Android', f'{r0} | {prev} | {r}')
                ok(f'«На главный экран» ({th}): под сигналом и «14 днями», не перекрывает их') if r['below'] and not r['over'] else fail(f'«На главный экран» ({th}): место', str(r))
                pg.evaluate("document.getElementById('inst').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300); shot(pg, f'inst-android-{th}')
                pg.click('#inst [data-inst=go]'); pg.wait_for_timeout(300); r = pg.evaluate(INST)
                ok(f'«На главный экран» ({th}): «Установить» вызывает системное окно, карточка прячется') if r['pr'] == 1 and not r['vis'] and r['flag'] == '1' else fail(f'«На главный экран» ({th}): «Установить»', str(r))
                pg.evaluate("localStorage.removeItem('ml-inst')"); pg.evaluate(BIP); pg.wait_for_timeout(300)
                pg.click('#inst [data-inst=no]'); pg.wait_for_timeout(300); r = pg.evaluate(INST)
                pg.reload(wait_until='load'); wait_app(pg); pg.wait_for_timeout(800); pg.evaluate(BIP); pg.wait_for_timeout(300); r2 = pg.evaluate(INST)
                if not r['vis'] and r['pr'] == 1 and r['flag'] == '1' and not r2['vis']: ok(f'«На главный экран» ({th}): «Не сейчас» прячет навсегда — после перезапуска не показывается')
                else: fail(f'«На главный экран» ({th}): «Не сейчас»', f'{r} | {r2}')
                pg.evaluate("localStorage.removeItem('ml-inst');Object.defineProperty(navigator,'standalone',{value:true,configurable:true})"); pg.evaluate(BIP); pg.wait_for_timeout(300); r = pg.evaluate(INST)
                pg.evaluate("delete navigator.standalone"); pg.evaluate(BIP); pg.wait_for_timeout(300); r2 = pg.evaluate(INST)
                pg.evaluate("dispatchEvent(new Event('appinstalled'))"); pg.wait_for_timeout(300); r3 = pg.evaluate(INST)
                if not r['vis'] and r2['vis'] and not r3['vis'] and r3['flag'] == '1': ok(f'«На главный экран» ({th}): в установленном приложении не показывается; после appinstalled — прячется навсегда')
                else: fail(f'«На главный экран» ({th}): установлено', f'{r} | {r2} | {r3}')
            scenario(f'На главный экран — Android ({th})', {'session': True, 'docs': SEED}, s_inst, dsf=1, theme=th)

            def s_inst_ios(pg, n, th=th):
                pg.add_init_script("Object.defineProperty(navigator,'userAgent',{get:()=>'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'})")
                pg.reload(wait_until='load'); wait_app(pg); pg.wait_for_timeout(800)
                r = pg.evaluate(INST)
                if r['vis'] and r['btn'] == [['Скрыть', r['btn'][0][1]]] and r['btn'][0][1] >= 48 and 'Нажми «Поделиться» → «На экран „Домой“»' in r['txt'] and r['below'] and not r['over']:
                    ok(f'«На главный экран» ({th}): iPhone — строка «Поделиться → На экран „Домой“» и «Скрыть» ≥ 48 px, под карточками')
                else: fail(f'«На главный экран» ({th}): iPhone', str(r))
                # 15.11 (Вера): кнопка «Скрыть» — не «Понятно», как у соседней карточки «14 дней»; поля по бокам как у .btn.sm (12 px), текст в одну строку
                bp = r['bp']
                if len(bp) == 1 and bp[0]['pl'] >= 12 and bp[0]['pr'] >= 12 and min(bp[0]['l'], bp[0]['r']) >= 12 and bp[0]['one']:
                    ok(f'«На главный экран» ({th}): iPhone — у «Скрыть» поля по бокам {bp[0]["l"]}/{bp[0]["r"]} px (как у .btn.sm), текст в одну строку')
                else: fail(f'«На главный экран» ({th}): iPhone поля кнопки', str(bp))
                ic = r['ic']
                if len(ic) == 1 and ic[0]['w'] == 14 and ic[0]['h'] == 14 and ic[0]['hid'] == 'true' and ic[0]['fill'] == 'none' and ic[0]['stroke'] == 'currentColor' and not ic[0]['paint'] and ic[0]['col'] and not r['wide']:
                    ok(f'«На главный экран» ({th}): iPhone — значок «Поделиться» 14 px, цвет текста, без заливки, скрыт от чтеца; карточка в 390 px без выхода за край')
                else: fail(f'«На главный экран» ({th}): значок «Поделиться»', str(r))
                pg.evaluate("document.getElementById('inst').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300); shot(pg, f'inst-ios-{th}')
                pg.click('#inst [data-inst=no]'); pg.wait_for_timeout(300); r = pg.evaluate(INST)
                pg.reload(wait_until='load'); wait_app(pg); pg.wait_for_timeout(800); r2 = pg.evaluate(INST)
                ok(f'«На главный экран» ({th}): iPhone — «Скрыть» прячет навсегда') if not r['vis'] and r['flag'] == '1' and not r2['vis'] else fail(f'«На главный экран» ({th}): iPhone «Скрыть»', f'{r} | {r2}')
            scenario(f'На главный экран — iPhone ({th})', {'session': True, 'docs': SEED}, s_inst_ios, dsf=1, theme=th)

            # iPad на iPadOS 13+ выдаёт себя за Mac (MacIntel + сенсорный экран) — подсказка как на iPhone; настоящий Mac (без касаний),
            # Google (GSA), Chrome, Firefox, Edge на iOS — без подсказки (там нет «На экран „Домой“»)
            UA_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
            UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) {} Mobile/15E148 Safari/604.1'
            def s_inst_ua(pg, n, th=th):
                res = {}
                for key, ua, plat, tp in (('ipad', UA_MAC, 'MacIntel', 5), ('mac', UA_MAC, 'MacIntel', 0), ('gsa', UA_IOS.format('GSA/330.0.661178421'), 'iPhone', 5),
                                          ('crios', UA_IOS.format('CriOS/131.0.6778.73'), 'iPhone', 5), ('fxios', UA_IOS.format('FxiOS/133.0'), 'iPhone', 5), ('edgios', UA_IOS.format('EdgiOS/131.0.2903.68'), 'iPhone', 5)):
                    c = pg.context.new_page()
                    c.add_init_script(f"Object.defineProperty(navigator,'userAgent',{{get:()=>{ua!r}}});Object.defineProperty(navigator,'platform',{{get:()=>{plat!r}}});Object.defineProperty(navigator,'maxTouchPoints',{{get:()=>{tp}}})")
                    c.goto(pg.url, wait_until='load', timeout=30000); wait_app(c); c.wait_for_timeout(800)
                    res[key] = c.evaluate(INST); c.close()
                ip = res['ipad']
                if ip['vis'] and 'Нажми «Поделиться» → «На экран „Домой“»' in ip['txt'] and [b[0] for b in ip['btn']] == ['Скрыть'] and len(ip['ic']) == 1:
                    ok(f'«На главный экран» ({th}): iPad, который представляется Mac (MacIntel, касания) — подсказка как на iPhone')
                else: fail(f'«На главный экран» ({th}): iPad как Mac', str(ip))
                hid = [k for k in ('mac', 'gsa', 'crios', 'fxios', 'edgios') if not res[k]['vis']]
                ok(f'«На главный экран» ({th}): Mac без касаний, Google (GSA), Chrome, Firefox, Edge на iOS — подсказки нет') if len(hid) == 5 else fail(f'«На главный экран» ({th}): лишняя подсказка', str({k: res[k]['txt'] for k in res}))
            scenario(f'На главный экран — iPad и другие браузеры ({th})', {'session': True, 'docs': SEED}, s_inst_ua, dsf=1, theme=th)

            # «Написать отзыв» внизу «Настроек» (над «Сообщить об ошибке», хвосты Веры и Глеба 14.11): письмо на публичную почту, тема «Отзыв MoneyLife», внизу версия и экран
            def s_fb(pg, n, th=th):
                wait_app(pg)
                if pg.evaluate("document.documentElement.dataset.theme") != th: raise AssertionError('тема не включилась: ' + th)
                pg.click('#setBtn'); pg.wait_for_selector('#setSheet.open', timeout=5000); pg.wait_for_timeout(500)
                pg.evaluate("document.getElementById('fbBtn').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300)
                r = pg.evaluate("""(()=>{const b=document.getElementById('fbBtn'),g=document.getElementById('bugBtn'),l=b.closest('[data-fkey]'),acc=document.getElementById('accInfo').closest('.card'),
                  rb=b.getBoundingClientRect(),rg=g.getBoundingClientRect();return {t:b.textContent.trim(),h:rb.height,hg:rg.height,gap:rg.top-rb.bottom,next:b.nextElementSibling===g,inAcc:acc.contains(b),
                  fold:l&&l.dataset.fkey,ver:document.getElementById('appVer').textContent.trim(),href:fbHref()}})()""")
                from urllib.parse import urlsplit, parse_qs
                u = urlsplit(r['href']); q = parse_qs(u.query); body = q.get('body', [''])[0].split('\n')
                if r['t'] == 'Написать отзыв' and r['h'] >= 48 and r['hg'] >= 48 and r['next'] and abs(r['gap'] - 10) < 0.6 and not r['inAcc'] and not r['fold']:
                    ok(f'«Написать отзыв» ({th}): внизу «Настроек», над «Сообщить об ошибке» (зазор {r["gap"]:.0f} px), вне складки «Аккаунт», {round(r["h"])} px')
                else: fail(f'«Написать отзыв» ({th}): место', str(r))
                if u.scheme == 'mailto' and u.path == 'moneylife.ap@gmail.com' and q.get('subject') == ['Отзыв MoneyLife'] and body[0].startswith('Ваш отзыв') and r['ver'] in body and r['ver'].startswith('Версия') and any(x.startswith('Экран: ') for x in body):
                    ok(f'«Написать отзыв» ({th}): письмо на moneylife.ap@gmail.com, тема «Отзыв MoneyLife», внизу версия сборки и экран')
                else: fail(f'«Написать отзыв» ({th}): письмо', r['href'][:300])
                pg.evaluate("document.getElementById('appVer').scrollIntoView({block:'end'})"); pg.wait_for_timeout(300)
                shot(pg, f'feedback-{th}')
            scenario(f'Написать отзыв ({th})', {'session': True, 'docs': SEED}, s_fb, dsf=1, theme=th)

        def s_inst_demo(pg, n):
            pg.wait_for_selector('#mlaDemo', state='visible', timeout=8000)
            pg.click('#mlaDemo'); wait_app(pg); pg.wait_for_timeout(2500)
            prev = pg.evaluate(BIP); pg.wait_for_timeout(300); r = pg.evaluate(INST)
            ok('«На главный экран»: в демо без регистрации не показывается') if prev and not r['vis'] and pg.evaluate("!!window.mlDemo") else fail('«На главный экран»: демо', str(r))
        scenario('На главный экран — демо', {'session': False, 'docs': []}, s_inst_demo)

        def s_inst_uk(pg, n):
            pg.evaluate("localStorage.setItem('ml-lang','uk'); location.reload()"); pg.wait_for_timeout(2500); wait_app(pg)
            pg.evaluate(BIP); pg.wait_for_timeout(300); r = pg.evaluate(INST)
            pg.evaluate("openSettings()"); pg.wait_for_timeout(500)
            f = pg.evaluate("[document.getElementById('fbBtn').textContent.trim(),decodeURIComponent(fbHref())]")
            if 'Додай на головний екран' in r['txt'] and 'іконка на телефоні, перевірка ціни у фоні' in r['txt'] and [b[0] for b in r['btn']] == ['Встановити', 'Не зараз'] and f[0] == 'Написати відгук' and 'subject=Відгук MoneyLife' in f[1] and 'Ваш відгук' in f[1] and r['lab'] == 'Додай на головний екран':
                ok('украинский: «На головний екран» / «Встановити» / «Не зараз» и «Написати відгук» с темой «Відгук MoneyLife»')
            else: fail('украинский: установка и отзыв', f'{r} | {f}')
        scenario('На главный экран и отзыв — украинский', {'session': True, 'docs': SEED}, s_inst_uk)

        for th in ('dark', 'light'):
            def s_inst_ios_uk(pg, n, th=th):
                pg.add_init_script("localStorage.setItem('ml-lang','uk');Object.defineProperty(navigator,'userAgent',{get:()=>'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'})")
                pg.reload(wait_until='load'); wait_app(pg); pg.wait_for_timeout(1000); r = pg.evaluate(INST)
                if r['vis'] and 'Натисни «Поділитися» → «На початковий екран»' in r['txt'] and r['lab'] == 'Додай на головний екран' and [b[0] for b in r['btn']] == ['Приховати'] and len(r['ic']) == 1 and not r['wide']:
                    ok(f'украинский ({th}): iPhone — «Натисни «Поділитися» → «На початковий екран»», значок на месте, подпись области переведена, кнопка «Приховати»')
                else: fail(f'украинский ({th}): iPhone', str(r))
                bp = r['bp']
                if len(bp) == 1 and min(bp[0]['l'], bp[0]['r']) >= 12 and bp[0]['one']:
                    ok(f'украинский ({th}): iPhone — у «Приховати» поля по бокам {bp[0]["l"]}/{bp[0]["r"]} px, текст в одну строку')
                else: fail(f'украинский ({th}): iPhone поля кнопки', str(bp))
                pg.evaluate("document.getElementById('inst').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300); shot(pg, f'inst-ios-uk-{th}')
                pg.click('#inst [data-inst=no]'); pg.wait_for_timeout(300); r = pg.evaluate(INST)
                ok(f'украинский ({th}): iPhone — «Приховати» прячет подсказку') if not r['vis'] and r['flag'] == '1' else fail(f'украинский ({th}): iPhone «Приховати»', str(r))
            scenario(f'На главный экран — iPhone, украинский ({th})', {'session': True, 'docs': SEED}, s_inst_ios_uk, dsf=1, theme=th)

        # 15.11 (Вера, охота #1): пополнение без суммы в гривне (uah пустое) — в «Истории» и «Отчёте за месяц» нет «0 грн»;
        #     пополнение с гривной показывает её как раньше. Только показ — суммы не меняются.
        UAH_DOCS = SEED + [{'col': 'tx', 'id': 'u1', 'data': {'ts': '2026-09-10T10:00:00.000Z', 'type': 'deposit', 'usd': 115, 'uah': None, 'dcaUsd': 100, 'reserveUsd': 15}},
                           {'col': 'tx', 'id': 'u2', 'data': {'ts': '2026-09-12T10:00:00.000Z', 'type': 'deposit', 'usd': 50, 'uah': ''}},
                           {'col': 'tx', 'id': 'u3', 'data': {'ts': '2026-10-05T10:00:00.000Z', 'type': 'deposit', 'usd': 0, 'uah': 0, 'note': 'ноль'}}]
        UAH_Q = """()=>{const row=id=>{const e=document.querySelector('#histList [data-tx="'+id+'"] .r');return e?e.textContent.replace(/[\\u202f\\xa0]/g,' '):null};
            return {u1:row('u1'),u2:row('u2'),u3:row('u3'),t1:row('t1'),hist:document.getElementById('histList').textContent.replace(/[\\u202f\\xa0]/g,' ')}}"""
        REP_Q = "(m)=>{rep=m;renderReport();return document.getElementById('repTiles').textContent.replace(/[\\u202f\\xa0]/g,' ')}"
        # отдельные надписи «0 грн» (склейка текста «$115,00» + «0 грн» спрятала бы ноль среди цифр)
        ZERO_Q = """()=>[...document.querySelectorAll('#histList span,#repTiles div')].filter(e=>!e.children.length&&/^0\\s*грн$/.test(e.textContent.replace(/[\\u202f\\xa0]/g,' ').trim())).map(e=>e.outerHTML.slice(0,80))"""
        for th in ('dark', 'light'):
            def s_uah_empty(pg, n, th=th):
                wait_app(pg); pg.wait_for_timeout(500)
                if pg.evaluate("document.documentElement.dataset.theme") != th: raise AssertionError('тема не включилась: ' + th)
                pg.click('nav.tabs .tab[data-tab="activity"]'); pg.wait_for_timeout(800)
                r = pg.evaluate(UAH_Q)
                if r['u1'] and r['u2'] and r['u3'] and 'грн' not in r['u1'] + r['u2'] + r['u3'] and '$115' in r['u1'] and r['t1'] and '41 500 грн' in r['t1'] and '0 грн' not in r['hist'].replace('41 500 грн', ''):
                    ok(f'«0 грн» ({th}): пополнение без гривны в «Истории» — только доллары; с гривной — «41 500 грн» как раньше')
                else: fail(f'«0 грн» ({th}): «История»', str(r)[:400])
                pg.evaluate("document.querySelector('#histList [data-tx=\"u1\"]').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300)
                pg.screenshot(path=str(OUT / f'fix-uah-hist-{th}.png'))
                pg.click('#actSeg [data-s="rep"]'); pg.wait_for_timeout(500)
                e = pg.evaluate(REP_Q, [2026, 8]); f = pg.evaluate(REP_Q, [2026, 7])
                if 'Внесено на биржу' in e and '$165' in e and 'грн' not in e and '41 500 грн' in f:
                    ok(f'«0 грн» ({th}): «Отчёт за месяц» — без гривны нет «0 грн», с гривной «41 500 грн»')
                else: fail(f'«0 грн» ({th}): отчёт', f'{e[:200]!r} | {f[:200]!r}')
                pg.evaluate(REP_Q, [2026, 8]); pg.evaluate("scrollTo(0,0)"); pg.wait_for_timeout(300)
                pg.screenshot(path=str(OUT / f'fix-uah-report-{th}.png'))
            scenario(f'Пополнение без гривны — без «0 грн» ({th})', {'session': True, 'docs': UAH_DOCS}, s_uah_empty, dsf=1, theme=th)
            def s_uah_demo(pg, n, th=th):
                pg.wait_for_selector('#mlaDemo', state='visible', timeout=8000)
                pg.click('#mlaDemo'); wait_app(pg); pg.wait_for_timeout(2500)
                pg.click('nav.tabs .tab[data-tab="activity"]'); pg.wait_for_timeout(800)
                h = pg.evaluate("document.getElementById('histList').textContent.replace(/[\\u202f\\xa0]/g,' ')")
                m = pg.evaluate("(()=>{const d=new Date();return [d.getFullYear(),d.getMonth()]})()")
                pg.screenshot(path=str(OUT / f'fix-uah-demo-hist-{th}.png'))
                pg.click('#actSeg [data-s="rep"]'); pg.wait_for_timeout(500)
                e = pg.evaluate(REP_Q, m)
                z = pg.evaluate(ZERO_Q)
                if 'Пополнение биржи' in h and 'Внесено на биржу' in e and not z:
                    ok(f'«0 грн» ({th}): демо — у пополнений нет «0 грн» ни в «Истории», ни в отчёте')
                else: fail(f'«0 грн» ({th}): демо', f'{z} | {h[:300]!r} | {e[:200]!r}')
                pg.screenshot(path=str(OUT / f'fix-uah-demo-report-{th}.png'))
            scenario(f'Демо — пополнения без «0 грн» ({th})', {'session': False, 'docs': []}, s_uah_demo, dsf=1, theme=th)

        # 15.11 «Графит» (правило 10): полоска прокрутки под шапкой и метка «День N из 14» — без фиолетово-розового и без градиента;
        #     полоска по-прежнему показывает, сколько прокручено
        HUE = """(c)=>{const m=/rgba?\\(([^)]+)\\)/.exec(c||'');if(!m)return {c,h:0,s:0,a:0};const v=m[1].split(/[ ,\\/]+/).filter(Boolean).map(parseFloat),[r,g,b]=v.map(x=>x/255),a=v.length>3?v[3]:1,
            mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn,l=(mx+mn)/2,s=d?d/(1-Math.abs(2*l-1)):0;let h=0;if(d){h=mx===r?((g-b)/d)%6:mx===g?(b-r)/d+2:(r-g)/d+4;h=(h*60+360)%360;}
            return {c,h:Math.round(h),s:+s.toFixed(2),a}}"""
        GRAPH = """()=>{const hue=""" + HUE + """,t=document.querySelector('.top'),a=getComputedStyle(t,'::after'),ch=document.querySelector('#d14 .d14-h .chip'),cc=ch&&getComputedStyle(ch);
            return {sc:document.body.classList.contains('scrolled'),sp:parseFloat(t.style.getPropertyValue('--sp')||0),tr:a.transform,op:parseFloat(a.opacity),img:a.backgroundImage,bar:hue(a.backgroundColor),
              chip:ch&&ch.textContent.trim(),cimg:cc&&cc.backgroundImage,cbg:cc&&hue(cc.backgroundColor),cfg:cc&&hue(cc.color),csh:cc&&cc.boxShadow}}"""
        # знакомство «только что»: давнему аккаунту без ключа ml-14d карточка «14 дней» показывает приглашение без метки «День N»
        import time as _t
        SEED_D14 = [{'col': 'app', 'id': 'settings', 'data': dict(SEED[0]['data'], onboardedAt=_t.strftime('%Y-%m-%dT%H:%M:%S.000Z', _t.gmtime()))}] + SEED[1:]
        def violet(x): return x['a'] > 0 and x['s'] > 0.2 and 235 <= x['h'] <= 345
        for th in ('dark', 'light'):
            def s_graphite(pg, n, th=th):
                wait_app(pg); pg.wait_for_timeout(500)
                if pg.evaluate("document.documentElement.dataset.theme") != th: raise AssertionError('тема не включилась: ' + th)
                pg.evaluate("document.getElementById('d14').scrollIntoView({block:'center'})"); pg.wait_for_timeout(700)
                r = pg.evaluate(GRAPH)
                if r['sc'] and r['sp'] > 0 and r['tr'] not in ('none', 'matrix(0, 0, 0, 1, 0, 0)') and r['op'] > 0.5 and r['img'] == 'none' and not violet(r['bar']) and r['bar']['s'] <= 0.2:
                    ok(f'«Графит» ({th}): полоска прокрутки под шапкой — ровная серая {r["bar"]["c"]}, без градиента, по-прежнему показывает прокрутку')
                else: fail(f'«Графит» ({th}): полоска под шапкой', str(r))
                if r['chip'] and r['chip'].startswith('День ') and r['cimg'] == 'none' and r['csh'] == 'none' and not violet(r['cbg']) and not violet(r['cfg']) and r['cfg']['s'] <= 0.2:
                    ok(f'«Графит» ({th}): метка «{r["chip"]}» нейтральная — текст {r["cfg"]["c"]}, фон {r["cbg"]["c"]}')
                else: fail(f'«Графит» ({th}): метка «День N из 14»', str(r))
                shot(pg, f'graphite-head-{th}')
                pg.evaluate("scrollTo(0,0)"); pg.wait_for_timeout(500)
                r0 = pg.evaluate(GRAPH)
                ok(f'«Графит» ({th}): вверху страницы полоски нет') if not r0['sc'] and r0['op'] < 0.05 else fail(f'«Графит» ({th}): полоска вверху', str(r0))
            scenario(f'Графит — шапка и «14 дней» ({th})', {'session': True, 'docs': SEED_D14}, s_graphite, dsf=1, theme=th)

        # 15.11 «Графит», остатки: шаг «14 дней», полоски и отметки — ровный цвет без градиента (вычисленный background-image);
        #     метки .chip.acc («твой», «советую») — нейтральный фон, акцент только текстом
        GRAD_SEL = ['.meter i', '.fchip[aria-pressed="true"]', '.switch[aria-checked="true"]', '.gauge .cur span', '.cd-bar>i', '.rep-row .bar i',
                    '.d14-bar.full', '.d14-seg i.cur', '.mi.main i', '.xq-prog i.cur', '.xf-r>i>i']
        PROBE = """()=>{const h=document.createElement('div');h.id='gProbe';h.setAttribute('aria-hidden','true');h.style.cssText='position:fixed;left:-999px;top:0;width:300px';
            h.innerHTML='<div class="tile"><div class="meter"><i></i></div></div><button class="fchip" aria-pressed="true">a</button><button class="switch" aria-checked="true"></button>'
              +'<div class="gauge"><div class="cur"><span>x</span></div></div><i class="cd-bar"><i></i></i><div class="rep-row"><span>a</span><span>b</span><div class="bar"><i></i></div></div>'
              +'<div class="card d14 d14-min"><i class="d14-bar full"></i></div><div class="card d14"><div class="d14-seg"><i class="on"></i><i class="cur"></i></div></div>'
              +'<div class="mi main"><i></i></div><div class="xq-prog"><i class="cur"></i></div><div class="xf-r"><i><i></i></i></div><span class="chip acc">твой</span>';
            document.body.appendChild(h);return null}"""
        GCHK = """(sel)=>{const hue=""" + HUE + """,out=[];
            for(const s of sel){const el=[...document.querySelectorAll(s)];if(!el.length){out.push([s,'нет элемента']);continue;}
              for(const e of el){const c=getComputedStyle(e);if(/gradient/.test(c.backgroundImage))out.push([s,c.backgroundImage.slice(0,60)]);}}
            const chips=[...document.querySelectorAll('.chip.acc')].filter(e=>!e.closest('.d14-h')&&!e.closest('.xp-hero')).map(e=>{const c=getComputedStyle(e);const v=(c.backgroundColor.match(/[\d.]+/g)||[]).slice(0,3).map(Number),k=v.some(x=>x>1)?255:1;return {t:e.textContent.trim(),img:c.backgroundImage,bg:c.backgroundColor,neu:v.length===3&&(Math.max(...v)-Math.min(...v))/k<0.06,fg:hue(c.color)}});
            return {bad:out,chips}}"""
        for th in ('dark', 'light'):
            def s_graphite_rest(pg, n, th=th):
                wait_app(pg); pg.wait_for_timeout(500)
                if pg.evaluate("document.documentElement.dataset.theme") != th: raise AssertionError('тема не включилась: ' + th)
                pg.evaluate("document.getElementById('d14').scrollIntoView({block:'center'})"); pg.wait_for_timeout(600)
                shot(pg, f'graphite-rest-d14-{th}')
                cur = pg.evaluate("(()=>{const e=document.querySelector('#d14 .d14-seg i.cur');return e?getComputedStyle(e).backgroundImage:null})()")
                pg.evaluate(PROBE)
                r = pg.evaluate(GCHK, GRAD_SEL)
                if cur == 'none' and not r['bad']: ok(f'«Графит» ({th}): шаг «14 дней», полоски, отметка шкалы, переключатель, фильтры — ровный цвет, без градиента')
                else: fail(f'«Графит» ({th}): остатки градиента', f'шаг 14 дней: {cur}; ' + str(r['bad']))
                c = [x for x in r['chips'] if x['t'] == 'твой']
                if c and c[0]['img'] == 'none' and c[0]['neu'] and violet(c[0]['fg']): ok(f'«Графит» ({th}): метка «твой» — нейтральный фон {c[0]["bg"]}, текст акцентом {c[0]["fg"]["c"]}')
                else: fail(f'«Графит» ({th}): метка «твой»', str(c))
                pg.evaluate("document.getElementById('gProbe').remove()")
                for tab in ('strategy', 'coins'):
                    pg.click(f'nav.tabs .tab[data-tab="{tab}"]'); pg.wait_for_timeout(900)
                    shot(pg, f'graphite-rest-{tab}-{th}')
            scenario(f'Графит — остатки градиента ({th})', {'session': True, 'docs': SEED_D14 + [{'col': 'app', 'id': 'cycle', 'data': CYC}]}, s_graphite_rest, theme=th)
            def s_graphite_ob(pg, n, th=th):
                pg.wait_for_selector('#ob', state='visible', timeout=10000); pg.wait_for_timeout(500)
                pg.click('#obNext'); pg.wait_for_timeout(500)
                c = [x for x in pg.evaluate(GCHK, [])['chips'] if x['t'] == 'советую']
                if c and c[0]['img'] == 'none' and c[0]['neu'] and violet(c[0]['fg']): ok(f'«Графит» ({th}): метка «советую» в знакомстве — нейтральный фон {c[0]["bg"]}, текст акцентом {c[0]["fg"]["c"]}')
                else: fail(f'«Графит» ({th}): метка «советую»', str(c))
                shot(pg, f'graphite-rest-ob-{th}')
            scenario(f'Графит — метка «советую» ({th})', {'session': True, 'docs': []}, s_graphite_ob, theme=th)

        # 15.11 (Вера, охота #2): в демо полоса «Демо / Создать аккаунт» не закрывает конец страницы — прокрутить вкладку до конца,
        #     низ последнего элемента выше верхнего края полосы (Главная — «Отчёт за ноябрь», Стратегия — «Знания», Активность — последняя запись)
        LOWEST = """()=>{const v=document.querySelector('.view:not([hidden])'),bar=document.getElementById('mlDemoBar').getBoundingClientRect();let lo=null,b=-1e9;
            for(const e of v.querySelectorAll('*')){const r=e.getBoundingClientRect();if(!r.height||!r.width||e.children.length)continue;
              let p=e,fx=false;while(p&&p!==v){const c=getComputedStyle(p);if(c.position==='fixed'||c.visibility==='hidden'||c.display==='none'){fx=true;break;}p=p.parentElement;}
              if(!fx&&r.bottom>b){b=r.bottom;lo=String(e.textContent||e.getAttribute("class")||e.tagName).trim().slice(0,40);}}
            return {bottom:Math.round(b),barTop:Math.round(bar.top),last:lo,cls:document.documentElement.classList.contains('ml-demo'),y:Math.round(scrollY),max:Math.round(document.documentElement.scrollHeight-innerHeight)}}"""
        for th in ('dark', 'light'):
            def s_demo_pad(pg, n, th=th):
                pg.wait_for_selector('#mlaDemo', state='visible', timeout=8000)
                pg.click('#mlaDemo'); wait_app(pg); pg.wait_for_timeout(2500)
                for tab in ('home', 'strategy', 'activity'):
                    pg.click(f'nav.tabs .tab[data-tab="{tab}"]'); pg.wait_for_timeout(900)
                    pg.evaluate("scrollTo(0,document.documentElement.scrollHeight)"); pg.wait_for_timeout(700)
                    r = pg.evaluate(LOWEST)
                    if r['cls'] and r['bottom'] <= r['barTop'] and r['y'] >= r['max'] - 2: ok(f'демо ({th}): «{tab}» — конец страницы «{r["last"]}» над полосой «Демо» ({r["bottom"]} ≤ {r["barTop"]} px)')
                    else: fail(f'демо ({th}): «{tab}» — полоса закрывает конец страницы', str(r))
                    pg.screenshot(path=str(OUT / f'fix-demo-pad-{tab}-{th}.png'))
            scenario(f'Демо — полоса не закрывает конец страницы ({th})', {'session': False, 'docs': []}, s_demo_pad, dsf=1, theme=th)
            def s_demo_pad_off(pg, n, th=th):
                wait_app(pg); pg.wait_for_timeout(500)
                pad = pg.evaluate("[document.documentElement.classList.contains('ml-demo'),getComputedStyle(document.querySelector('.app')).paddingBottom]")
                ok(f'обычный вход ({th}): отступ снизу прежний {pad[1]}') if not pad[0] and pad[1] == '112px' else fail(f'обычный вход ({th}): отступ снизу', str(pad))
            scenario(f'Обычный вход — отступ снизу прежний ({th})', {'session': True, 'docs': SEED}, s_demo_pad_off, dsf=1, theme=th)

        def s_v3_auth_calm(pg, n):
            pg.wait_for_selector('#mlaPass', state='visible', timeout=8000)
            a = pg.evaluate("""()=>{const c=document.querySelector('.mla-card');document.querySelector('#mlAuth [data-to=up]').click();
                return {first:c.classList.contains('first'),sub:document.querySelector('#mlAuth .mla-sub').textContent,cur:document.querySelectorAll('.mla-curtain').length,logo:!!document.querySelector('.mla-logo use')}}""")
            ok('3.0: вход при «уменьшить движение» — экран меняется сразу, без шторки; знак на месте') if not a['first'] and a['sub'] == 'Новый аккаунт' and a['cur'] == 0 and a['logo'] else fail('3.0: вход без анимаций', str(a))
        scenario('3.0: вход, уменьшить движение', {'session': False, 'docs': []}, s_v3_auth_calm, motion='reduce')

        # --- И4 (24.11.2026): мониторинг ошибок — сбой JS уходит в имитацию базы вызовом rpc('log_client_error') обезличенным.
        #     Сбой вызываем событием error/unhandledrejection (тот же путь, что у настоящего): брошенное исключение провалило бы
        #     проверку «без ошибок в консоли» самого сценария.
        ERRCALLS = "(()=>(window.__mlCalls||[]).filter(c=>c.op==='rpc:log_client_error').map(c=>c.a))()"
        def fire(pg, msg, file='plus.js', line=321):
            pg.evaluate("([m,f,l])=>dispatchEvent(new ErrorEvent('error',{message:m,filename:location.origin+'/'+f+'?v=20990101000000',lineno:l}))", [msg, file, line])
        SECRET = 'TypeError: Сумма 12345.67 для "Мой кошелёк" и \'Ledger Nano\' не сошлась, почта tester@example.com, «Заметка про BTC» 0.005 `abc`'
        def s_err_one(pg, n):
            wait_app(pg)
            if not pg.evaluate("typeof window.mlErrRpc==='function'"): raise AssertionError('shim.js не подключил window.mlErrRpc')
            fire(pg, SECRET); pg.wait_for_timeout(400)
            c = pg.evaluate(ERRCALLS)
            want = 'TypeError: Сумма #####.## для <…> и <…> не сошлась, почта <email>, <…> #.### `abc`'
            ver = re.search(r"const V='ml-(\d{14})'", (ROOT / 'sw.js').read_text(encoding='utf-8')).group(1)
            if (len(c) == 1 and c[0]['p_msg'] == want and c[0]['p_src'] == 'plus.js:321' and c[0]['p_ver'] == ver and c[0]['p_lang'] == 'ru'
                    and not re.search(r'\d|кошел|Ledger|tester|Заметка', c[0]['p_msg'])):
                ok('ошибки: сбой → ровно один вызов log_client_error, текст обезличен (цифры → #, кавычки → <…>, почта → <email>), файл:строка, сборка, язык')
            else: fail('ошибки: один обезличенный вызов', str(c)[:400])
            loc = pg.evaluate("mlErrLog().slice(-1)[0]")
            ok('ошибки: журнал на телефоне для «Сообщить об ошибке» работает как раньше') if loc and loc['m'] == SECRET[:240] else fail('ошибки: журнал ml-err', str(loc)[:200])
            fire(pg, 'TypeError: Failed to fetch'); fire(pg, 'ResizeObserver loop limit exceeded')
            pg.evaluate("dispatchEvent(new ErrorEvent('error',{}))")   # ошибка загрузки картинки/скрипта — без текста
            pg.wait_for_timeout(300)
            k = len(pg.evaluate(ERRCALLS))
            ok('ошибки: обрывы сети, шум ResizeObserver и пустые события не отправляются') if k == 1 else fail('ошибки: лишние отправки', f'{k} вызовов')
            pg.evaluate("dispatchEvent(new PromiseRejectionEvent('unhandledrejection',{promise:Promise.resolve(),reason:new Error('Не найден \"секретный\" ключ 42')}))")
            pg.wait_for_timeout(300)
            c = pg.evaluate(ERRCALLS)
            ok('ошибки: отклонённое обещание тоже уходит, обезличенным') if len(c) == 2 and c[1]['p_msg'] == 'Не найден <…> ключ ##' and c[1]['p_src'] == 'promise' else fail('ошибки: unhandledrejection', str(c)[-300:])
            pg.evaluate("window.__keep=window.mlErrRpc;window.mlErrRpc=undefined")   # как до загрузки shim.js: сбой ждёт в очереди
            fire(pg, 'ReferenceError: early is not defined', 'index.html', 9); pg.wait_for_timeout(200)
            a = len(pg.evaluate(ERRCALLS)); pg.evaluate("window.mlErrRpc=window.__keep;mlErrFlush()"); pg.wait_for_timeout(300)
            c = pg.evaluate(ERRCALLS)
            ok('ошибки: сбой до загрузки shim.js ждёт в очереди и уходит после') if a == 2 and len(c) == 3 and c[2]['p_msg'] == 'ReferenceError: early is not defined' else fail('ошибки: очередь до shim.js', f'{a} → {c[-1:]}')
            pg.screenshot(path=str(OUT / 'err-monitor-one.png'))
        scenario('Мониторинг ошибок — один обезличенный вызов', {'session': True, 'docs': SEED}, s_err_one)

        def s_err_limit(pg, n):
            wait_app(pg)
            for _ in range(10): fire(pg, 'TypeError: x is null at "renderTotal" 77')
            pg.wait_for_timeout(400)
            a = len(pg.evaluate(ERRCALLS))
            ok('ошибки: 10 одинаковых сбоев → 1 вызов') if a == 1 else fail('ошибки: 10 одинаковых', f'{a} вызовов')
            for i in range(20): fire(pg, f'TypeError: сбой модуля {chr(65 + i)}{chr(97 + i)}', 'wins.js', 10 + i)
            pg.wait_for_timeout(500)
            c = pg.evaluate(ERRCALLS)
            ok(f'ошибки: 20 разных сбоев → всего {len(c)} вызовов за сессию (не больше 5)') if len(c) == 5 and len({x['p_msg'] for x in c}) == 5 else fail('ошибки: лимит 5 за сессию', f'{len(c)} вызовов')
            pg.reload(wait_until='load'); wait_app(pg); pg.wait_for_timeout(500)
            fire(pg, 'TypeError: после перезагрузки'); pg.wait_for_timeout(300)
            k = len(pg.evaluate(ERRCALLS))
            ok('ошибки: после перезагрузки вкладки лимит сессии сохраняется (0 новых вызовов)') if k == 0 else fail('ошибки: лимит после перезагрузки', f'{k} вызовов')
        scenario('Мониторинг ошибок — без повторов, не больше 5', {'session': True, 'docs': SEED}, s_err_limit)

        for mode in ('error', 'reject', 'throw'):
            def s_err_down(pg, n, mode=mode):
                wait_app(pg)
                fire(pg, 'TypeError: база недоступна'); fire(pg, 'TypeError: вторая ошибка', 'shim.js', 5)
                pg.wait_for_timeout(600)
                k = len(pg.evaluate(ERRCALLS))
                pg.click('nav.tabs .tab[data-tab="activity"]'); pg.wait_for_timeout(600)
                pg.click('nav.tabs .tab[data-tab="home"]'); wait_app(pg)
                vis = pg.evaluate("!document.querySelector('.view:not([hidden])')?.closest('[hidden]')")
                ok(f'ошибки: база отвечает «{mode}» — приложение работает, без повторных попыток ({k} вызова)') if k == 2 and vis else fail(f'ошибки: база «{mode}»', f'{k} вызовов, экран {vis}')
            scenario(f'Мониторинг ошибок — база недоступна ({mode})', {'session': True, 'docs': SEED, 'errLogFail': mode}, s_err_down)

        def s_err_offline(pg, n):
            wait_app(pg)
            pg.context.set_offline(True); pg.wait_for_timeout(300)
            fire(pg, 'TypeError: нет сети'); pg.wait_for_timeout(400)
            k = len(pg.evaluate(ERRCALLS)); pg.context.set_offline(False)
            ok('ошибки: без сети ничего не отправляется и приложение не падает') if k == 0 and pg.evaluate("!!document.querySelector('nav.tabs')") else fail('ошибки: без сети', f'{k} вызовов')
        scenario('Мониторинг ошибок — без сети', {'session': True, 'docs': SEED}, s_err_offline)

        def s_err_demo(pg, n):
            pg.wait_for_selector('#mlaDemo', state='visible', timeout=8000)
            pg.click('#mlaDemo'); wait_app(pg); pg.wait_for_timeout(800)
            fire(pg, 'TypeError: в демо'); pg.wait_for_timeout(400)
            k = len(pg.evaluate(ERRCALLS))
            ok('ошибки: в демо-режиме в базу не отправляются') if k == 0 and pg.evaluate("window.mlDemo===true") else fail('ошибки: демо', f'{k} вызовов')
        scenario('Мониторинг ошибок — демо', {'session': False, 'docs': []}, s_err_demo)

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

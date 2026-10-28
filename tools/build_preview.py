#!/usr/bin/env python3
"""Сборка «Превью MoneyLife» — рабочей копии приложения для страницы в Claude (Artifact).

Запуск: python3 tools/build_preview.py [папка-результат]   (по умолчанию /tmp/ml-preview)

Что делает:
  - берёт текущую версию приложения из этой копии репозитория (обычно ветка agent);
  - убирает подключение config.js, Supabase и shim.js — в Claude приложение работает на «родных»
    возможностях страницы: claude.use('db') (своя отдельная база страницы) и claude.use('mcp') (цены CoinGecko);
  - убирает обёртку <!doctype>/<html>/<head>/<body> (Artifact добавляет её сам);
  - добавляет плашку «Превью» с датой сборки;
  - копирует картинки, маскота, голос и справочник монет.

Публикация (делает агент инструментом Artifact):
  file_path = <папка>/index.html, files = из <папка>/files.json, capabilities — из <папка>/capabilities.json.
Настоящая база Supabase в превью не используется: записи в превью не попадают в живое приложение."""
import json, re, shutil, sys, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/ml-preview')
ASSETS = ['three.min.js', 'mascot.js', 'voice-slitok.js', 'voice-slitok-n.js', 'manifest.webmanifest']
ASSET_GLOBS = ['*.bin', 'logos/*', 'icons/*', 'data/*.json']

def main():
    if OUT.exists(): shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    # 1. убрать самостоятельный режим (Supabase + shim) — в Claude работают claude.use('db'/'mcp')
    html = re.sub(r'<script src="config\.js[^"]*"></script>\s*', '', html)
    html = re.sub(r'<script src="https://cdn\.jsdelivr\.net/npm/@supabase/[^"]*"></script>\s*', '', html)
    html = re.sub(r'<script src="shim\.js[^"]*"></script>\s*', '', html)
    # 2. снять обёртку документа
    html = re.sub(r'^\s*<!doctype html>\s*', '', html, flags=re.I)
    html = re.sub(r'<html[^>]*>', '', html, count=1, flags=re.I)
    html = re.sub(r'</?head>', '', html, flags=re.I)
    html = re.sub(r'</body>\s*</html>\s*$', '', html, flags=re.I)
    m = re.search(r'<body([^>]*)>', html, flags=re.I)
    body_attrs = m.group(1) if m else ''
    html = re.sub(r'<body[^>]*>', '', html, count=1, flags=re.I)
    cls = re.search(r'class="([^"]*)"', body_attrs)
    # 3. заголовок страницы и плашка «Превью»
    html = re.sub(r'<title>[^<]*</title>', '<title>Превью MoneyLife</title>', html, count=1)
    stamp = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=2))).strftime('%d.%m.%Y %H:%M')
    banner = ('<div id="mlPreviewBar" style="position:fixed;left:0;right:0;bottom:0;z-index:9999;'
              'padding:4px max(12px,env(safe-area-inset-left,0px)) calc(4px + env(safe-area-inset-bottom,0px));'
              'font:600 11px/1.3 system-ui,sans-serif;text-align:center;color:#1a0d02;background:#ff8a2a;pointer-events:none">'
              f'ПРЕВЬЮ · версия команды агентов от {stamp} · записи здесь не попадают в настоящее приложение</div>')
    boot = ('<script>(function(){try{' + (f"document.body.className+={json.dumps(' ' + cls.group(1))};" if cls else '') +
            '}catch(e){}})();</script>')
    html = html.rstrip() + '\n' + banner + '\n' + boot + '\n'
    (OUT / 'index.html').write_text(html, encoding='utf-8')
    # 4. файлы
    files = {}
    def add(p: Path):
        rel = p.relative_to(ROOT).as_posix()
        dst = OUT / rel; dst.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(p, dst)
        files[rel] = rel
    for a in ASSETS:
        if (ROOT / a).exists(): add(ROOT / a)
    for g in ASSET_GLOBS:
        for p in sorted(ROOT.glob(g)):
            if p.is_file(): add(p)
    (OUT / 'files.json').write_text(json.dumps(files, ensure_ascii=False, indent=1), encoding='utf-8')
    caps = {'db': {}, 'mcp': {'servers': [{'server': 'CoinGecko', 'tools': ['get-coin-markets', 'get-coin-market-chart']}]}}
    (OUT / 'capabilities.json').write_text(json.dumps(caps, ensure_ascii=False), encoding='utf-8')
    total = sum((OUT / f).stat().st_size for f in files) + (OUT / 'index.html').stat().st_size
    print(f'Превью собрано: {OUT}/index.html, файлов {len(files)}, всего {total/1e6:.1f} МБ, метка {stamp}')

if __name__ == '__main__':
    main()

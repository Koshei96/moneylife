#!/usr/bin/env python3
"""Распаковка архива владельца для разбора в смену.

Запуск:  python3 tools/unpack_archive.py <файл> [папка]   (по умолчанию /tmp/ml-archive)

<файл> — то, что скачано с пульта (Artifact read {url: пульт, path: <archive.raw>}): это сам архив,
записанный текстом base64 (так пульт хранит zip — другой тип файла он сохранить не может).
Подходит и обычный архив: .zip, .tar, .tar.gz/.tgz, .gz.

Что делает: распознаёт base64, распаковывает (имена в кодировке Windows cp866 тоже читаются), защищает от
путей вида «../» и слишком больших архивов, печатает дерево файлов и сводку по типам, а для Word, Excel и
PowerPoint складывает рядом текст (<файл>.txt). Дальше: тексты читать, музыку — tools/analyze_audio.py,
картинки — Read. Временные файлы после разбора удалить; содержимое архива в репозиторий не класть.
"""
import base64, binascii, collections, gzip, html, io, os, re, sys, tarfile, zipfile

LIMIT = 500 * 1024 * 1024
KINDS = {'audio': 'mp3 wav m4a aac ogg oga opus flac weba', 'image': 'png jpg jpeg gif webp bmp', 'pdf': 'pdf',
         'video': 'mp4 webm mov mkv avi', 'office': 'docx xlsx pptx doc xls ppt odt ods',
         'archive': 'zip rar 7z tar gz tgz'}
TEXT = set('txt md markdown csv tsv json js mjs ts tsx jsx html htm css scss xml yml yaml ini cfg conf log srt vtt lrc py sh bat sql toml env rtf tex java kt swift c h cpp cs go rs php rb lua dart gradle properties svg'.split())


def kind(name):
    e = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    if e in TEXT:
        return 'text'
    for k, v in KINDS.items():
        if e in v.split():
            return k
    return 'other'


def load(path):
    raw = open(path, 'rb').read()
    head = raw[:64].strip()
    if head and re.fullmatch(rb'[A-Za-z0-9+/=\s]+', raw[:4096]) and not raw.startswith(b'PK'):
        try:
            raw = base64.b64decode(re.sub(rb'\s+', b'', raw), validate=True)
        except binascii.Error:
            pass
    return raw


def safe(out, name):
    base = os.path.abspath(out)
    p = os.path.abspath(os.path.join(base, name))
    if not p.startswith(base + os.sep):
        raise ValueError('опасный путь в архиве: ' + name)
    return p


def office_text(path):
    ext = path.rsplit('.', 1)[-1].lower()
    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        return ''
    strip = lambda s: html.unescape(re.sub(r'<[^>]+>', '', s))
    rd = lambda n: z.read(n).decode('utf-8', 'replace') if n in z.namelist() else ''
    if ext == 'docx':
        x = rd('word/document.xml').replace('<w:tab/>', '\t')
        x = re.sub(r'<w:br[^>]*/>', '\n', x).replace('</w:p>', '\n')
        return re.sub(r'\n{3,}', '\n\n', strip(x)).strip()
    if ext == 'pptx':
        sl = sorted([n for n in z.namelist() if re.match(r'ppt/slides/slide\d+\.xml$', n)], key=lambda n: int(re.sub(r'\D', '', n)))
        return '\n\n'.join(f'— Слайд {i + 1} —\n' + strip(rd(n).replace('</a:p>', '\n')).strip() for i, n in enumerate(sl))
    if ext == 'xlsx':
        S = [strip(m) for m in re.findall(r'<si>([\s\S]*?)</si>', rd('xl/sharedStrings.xml'))]
        out = []
        for n in sorted(n for n in z.namelist() if re.match(r'xl/worksheets/sheet\d+\.xml$', n)):
            rows = []
            for r in re.findall(r'<row[^>]*>([\s\S]*?)</row>', rd(n))[:1000]:
                cells = []
                for attrs, body in re.findall(r'<c([^>]*?)(?:/>|>([\s\S]*?)</c>)', r):
                    v = re.search(r'<v>([\s\S]*?)</v>', body or '')
                    is_ = re.search(r'<is>([\s\S]*?)</is>', body or '')
                    cells.append(S[int(v.group(1))] if 't="s"' in attrs and v else strip(is_.group(1)) if is_ else (v.group(1) if v else ''))
                rows.append(' | '.join(cells))
            out.append(f'— Лист {re.sub(r"\D", "", n)} —\n' + '\n'.join(rows))
        return '\n\n'.join(out)
    return ''


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    src, out = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else '/tmp/ml-archive')
    os.makedirs(out, exist_ok=True)
    data = load(src)
    files = []
    if data[:2] == b'PK':
        z = zipfile.ZipFile(io.BytesIO(data))
        if sum(i.file_size for i in z.infolist()) > LIMIT:
            sys.exit('архив больше 500 МБ в распакованном виде — разберите его частями')
        for i in z.infolist():
            name = i.filename
            if not (i.flag_bits & 0x800):
                try:
                    name = name.encode('cp437').decode('cp866')
                except (UnicodeEncodeError, UnicodeDecodeError):
                    pass
            if i.is_dir() or '__MACOSX/' in name:
                continue
            if i.flag_bits & 1:
                files.append((name, i.file_size, 'под паролем')); continue
            p = safe(out, name); os.makedirs(os.path.dirname(p), exist_ok=True)
            with z.open(i) as f, open(p, 'wb') as g:
                g.write(f.read())
            files.append((name, i.file_size, ''))
    else:
        try:
            t = tarfile.open(fileobj=io.BytesIO(data), mode='r:*')
            members = [m for m in t.getmembers() if m.isfile()]
            if sum(m.size for m in members) > LIMIT:
                sys.exit('архив больше 500 МБ в распакованном виде')
            for m in members:
                p = safe(out, m.name); os.makedirs(os.path.dirname(p), exist_ok=True)
                open(p, 'wb').write(t.extractfile(m).read()); files.append((m.name, m.size, ''))
        except tarfile.TarError:
            try:
                d = gzip.decompress(data)
            except OSError:
                sys.exit('не похоже на zip, tar или gz')
            name = os.path.basename(src).removesuffix('.gz') or 'file'
            open(safe(out, name), 'wb').write(d); files.append((name, len(d), ''))
    by = collections.Counter(kind(n) for n, _, _ in files)
    print(f'Распаковано в {out}: {len(files)} файлов, {sum(s for _, s, _ in files) / 1e6:.1f} МБ')
    print('Типы: ' + ', '.join(f'{k} {v}' for k, v in by.most_common()))
    dirs = collections.defaultdict(list)
    for n, s, note in files:
        dirs[os.path.dirname(n)].append((os.path.basename(n), s, note))
    for d in sorted(dirs):
        print(f'\n{d or "(корень)"}/')
        for n, s, note in dirs[d][:300]:
            print(f'  {n}  ·  {s / 1024:.0f} КБ{"  · " + note if note else ""}')
        if len(dirs[d]) > 300:
            print(f'  …и ещё {len(dirs[d]) - 300}')
    for n, _, note in files:
        if not note and kind(n) == 'office' and n.lower().endswith(('.docx', '.xlsx', '.pptx')):
            p = safe(out, n); t = office_text(p)
            if t:
                open(p + '.txt', 'w').write(t); print(f'\nТекст документа: {p}.txt')


if __name__ == '__main__':
    main()

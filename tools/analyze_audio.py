#!/usr/bin/env python3
"""Подробный разбор музыкального трека для команды MoneyLife (в смену).

Запуск:  python3 tools/analyze_audio.py <файл> [папка-результат]   (по умолчанию /tmp/ml-audio)

Нужны только ffmpeg и numpy (Pillow — для картинки спектрограммы). Понимает всё, что открывает ffmpeg:
webm/opus из пульта, mp3, wav, m4a, flac, ogg.

Что считает:
  - громкость по EBU R128 (фильтр ffmpeg ebur128): интегральная LUFS, диапазон LRA, истинный пик;
  - темп (спектральный поток + автокорреляция), тональность (хрома + профили Крумхансла);
  - баланс частот, яркость, стерео (корреляция каналов), тишина в начале и в конце;
  - громкость по ходу трека и части трека (где меняется звучание: вступление, куплет/припев и т. п. —
    это границы по звуку, а не по смыслу), «хук» — самые громкие 10 секунд;
  - картинку спектрограммы (spectrogram.png).

Результат: report.md (по-русски, для владельца и команды), analysis.json, spectrogram.png.
Звук на слух скрипт не оценивает: вкус, вокал и слова — дело людей; слова песни лучше попросить у владельца.
"""
import json, os, re, subprocess, sys
import numpy as np

KEYN = ['до', 'до-диез', 'ре', 'ми-бемоль', 'ми', 'фа', 'фа-диез', 'соль', 'соль-диез', 'ля', 'си-бемоль', 'си']
MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
SR = 22050


def mmss(s):
    s = int(round(max(0, s)))
    return f'{s // 60}:{s % 60:02d}'


def decode(path, ch, sr):
    out = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', str(ch), '-ar', str(sr), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(out, dtype='<f4').astype(np.float64)
    return x.reshape(-1, ch) if ch > 1 else x


def ebur128(path):
    r = subprocess.run(['ffmpeg', '-nostats', '-v', 'info', '-i', path, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'],
                       capture_output=True, text=True).stderr
    tail = r[r.rfind('Summary:'):] if 'Summary:' in r else r
    get = lambda pat: (lambda m: float(m.group(1)) if m else None)(re.search(pat, tail))
    return {'lufs': get(r'I:\s+(-?[\d.]+) LUFS'), 'lra': get(r'LRA:\s+(-?[\d.]+) LU'), 'true_peak': get(r'Peak:\s+(-?[\d.]+) dBFS')}


def stft_mag(x, n, hop):
    w = np.hanning(n)
    frames = max(1, (len(x) - n) // hop + 1)
    idx = np.arange(n)[None, :] + hop * np.arange(frames)[:, None]
    return np.abs(np.fft.rfft(x[idx] * w, axis=1))


def tempo(mono):
    S = np.log1p(100 * stft_mag(mono, 1024, 512))
    flux = np.maximum(0, np.diff(S, axis=0)).sum(1)
    flux -= flux.mean()
    fps = SR / 512
    best, bpm = -1e18, 0
    for b in np.arange(60, 200.25, 0.25):
        lag = fps * 60 / b
        l0 = int(lag); fr = lag - l0
        s = np.sum(flux[:-l0 - 1] * (flux[l0:-1] * (1 - fr) + flux[l0 + 1:] * fr)) / len(flux)
        v = s * np.exp(-0.5 * (np.log2(b / 120) / 0.9) ** 2)
        if v > best:
            best, bpm = v, b
    return round(bpm)


def key_and_spectrum(mono):
    N = 4096
    M = stft_mag(mono, N, N // 2)
    f = np.arange(M.shape[1]) * SR / N
    sel = (f >= 65) & (f <= 2100)
    pc = (np.round(12 * np.log2(f[sel] / 440)).astype(int) + 69) % 12
    chroma_t = np.zeros((M.shape[0], 12))
    for k in range(12):
        chroma_t[:, k] = M[:, sel][:, pc == k].sum(1)
    chroma = chroma_t.sum(0)
    cands = []
    for t in range(12):
        for maj, prof in ((True, MAJ), (False, MIN)):
            p = np.roll(prof, t)
            cands.append((np.corrcoef(chroma, p)[0, 1], t, maj))
    cands.sort(reverse=True)
    P = M ** 2
    edges = [0, 60, 250, 2000, 6000, SR / 2 + 1]
    bands = [P[:, (f >= edges[i]) & (f < edges[i + 1])].sum() for i in range(5)]
    tot = sum(bands) or 1
    cen = float((P.sum(0) * f).sum() / (P.sum() or 1))
    return cands, [round(100 * b / tot) for b in bands], cen, M, f, chroma_t


def sections(mono, chroma_t, hop_s):
    # признаки по секундам: хрома + громкость; новизна по матрице сходства (ядро «шахматная доска»)
    per = max(1, int(round(1.0 / hop_s)))
    n = chroma_t.shape[0] // per
    if n < 16:
        return []
    C = chroma_t[:n * per].reshape(n, per, 12).mean(1)
    C = C / (np.linalg.norm(C, axis=1, keepdims=True) + 1e-9)
    e = np.array([np.sqrt(np.mean(mono[int(i * SR):int((i + 1) * SR)] ** 2) + 1e-12) for i in range(n)])
    E = 20 * np.log10(e)
    F = np.hstack([C, ((E - E.mean()) / (E.std() + 1e-9))[:, None] * 0.5])
    F = F / (np.linalg.norm(F, axis=1, keepdims=True) + 1e-9)
    S = F @ F.T
    K = 8
    g = np.outer(np.r_[-np.ones(K), np.ones(K)], np.r_[-np.ones(K), np.ones(K)])
    nov = np.zeros(n)
    for i in range(K, n - K):
        nov[i] = -(S[i - K:i + K, i - K:i + K] * g).sum()
    nov = np.maximum(nov, 0)
    peaks = [i for i in range(K, n - K) if nov[i] == nov[max(0, i - 6):i + 7].max() and nov[i] > nov.mean() + 0.5 * nov.std()]
    bounds = [0] + peaks + [n]
    segs = []
    for a, b in zip(bounds[:-1], bounds[1:]):
        if b - a < 4:
            continue
        segs.append({'from': a, 'to': b, 'loud': round(float(E[a:b].mean()), 1), 'vec': F[a:b].mean(0)})
    # одинаковые по звучанию части — одной буквой
    labels, protos = [], []
    for s in segs:
        v = s['vec'] / (np.linalg.norm(s['vec']) + 1e-9)
        for j, p in enumerate(protos):
            if float(v @ p) > 0.97:
                labels.append(chr(65 + j)); break
        else:
            protos.append(v); labels.append(chr(64 + len(protos)))
    out = []
    lo = np.median([s['loud'] for s in segs]) if segs else 0
    for s, l in zip(segs, labels):
        out.append({'part': l, 'from': mmss(s['from']), 'to': mmss(s['to']), 'loudness_db': s['loud'],
                    'energy': 'громче' if s['loud'] > lo + 2 else ('тише' if s['loud'] < lo - 2 else 'средне')})
    return out


def spectrogram_png(M, f, dur, path):
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return False
    cols, rows, fmin, fmax = 720, 240, 40, SR / 2
    T = M.shape[0]
    tb = np.minimum(cols - 1, (np.arange(T) * cols // max(T, 1)))
    rb = np.full(len(f), -1)
    ok = f >= fmin
    rb[ok] = np.minimum(rows - 1, (np.log(f[ok] / fmin) / np.log(fmax / fmin) * rows).astype(int))
    G = np.zeros((cols, rows))
    for t in range(T):
        np.maximum.at(G[tb[t]], rb[ok], M[t, ok])
    for c in range(cols):
        last = 0
        for r in range(rows):
            if G[c, r] <= 0: G[c, r] = last
            else: last = G[c, r]
    db = 20 * np.log10(G / (G.max() + 1e-12) + 1e-12)
    v = np.clip((db + 72) / 72, 0, 1)
    pal = np.array([[11, 14, 19], [52, 26, 88], [168, 38, 92], [255, 138, 42], [255, 226, 140]], float)
    xi = v * (len(pal) - 1); i0 = np.minimum(len(pal) - 2, xi.astype(int)); fr = (xi - i0)[..., None]
    rgb = (pal[i0] + (pal[i0 + 1] - pal[i0]) * fr).astype(np.uint8)
    img = Image.fromarray(np.flipud(rgb.transpose(1, 0, 2)), 'RGB').resize((cols, rows + 30))
    canvas = Image.new('RGB', (cols, rows + 30), (11, 14, 19)); canvas.paste(img.crop((0, 0, cols, rows)), (0, 0))
    d = ImageDraw.Draw(canvas)
    for fq, lb in ((100, '100 Hz'), (1000, '1 kHz'), (10000, '10 kHz')):
        y = rows * (1 - np.log(fq / fmin) / np.log(fmax / fmin)); d.line([(0, y), (cols, y)], fill=(70, 74, 90)); d.text((5, y - 12), lb, fill=(200, 205, 220))
    step = 60 if dur > 240 else 30 if dur > 90 else 15
    for t in np.arange(0, dur, step):
        x = t / dur * cols; d.line([(x, rows), (x, rows + 5)], fill=(150, 155, 170)); d.text((x + 3, rows + 10), mmss(t), fill=(200, 205, 220))
    canvas.save(path)
    return True


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    src = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else '/tmp/ml-audio'
    os.makedirs(out, exist_ok=True)
    st = decode(src, 2, 44100)
    mono = decode(src, 1, SR)
    dur = len(mono) / SR
    lo = ebur128(src)
    L, R = st[:, 0], st[:, 1]
    corr = float(np.corrcoef(L[::8], R[::8])[0, 1]) if np.std(L) > 0 and np.std(R) > 0 else 1.0
    peak = float(np.max(np.abs(st))) if len(st) else 0
    clip = int(np.sum(np.abs(st) >= 0.999))
    nz = np.nonzero(np.abs(mono) > 0.001)[0]
    sil0 = nz[0] / SR if len(nz) else 0; sil1 = (len(mono) - 1 - nz[-1]) / SR if len(nz) else 0
    bpm = tempo(mono)
    cands, bands, cen, M, f, chroma_t = key_and_spectrum(mono)
    k = cands[0]; key = f"{KEYN[k[1]]} {'мажор' if k[2] else 'минор'}"; kconf = round(cands[0][0] - cands[1][0], 2)
    seg = 10 * SR
    rms = lambda a: 20 * np.log10(np.sqrt(np.mean(a ** 2)) + 1e-12)
    hook = max(range(0, max(1, len(mono) - seg), SR), key=lambda s: np.mean(mono[s:s + seg] ** 2)) / SR if len(mono) > seg else 0
    curve = [round(rms(mono[int(len(mono) * i / 20):int(len(mono) * (i + 1) / 20)]), 1) for i in range(20)]
    parts = sections(mono, chroma_t, (4096 // 2) / SR)
    has_png = spectrogram_png(M, f, dur, os.path.join(out, 'spectrogram.png'))
    A = {'file': os.path.basename(src), 'duration': round(dur, 1), 'bpm': bpm, 'key': key, 'key_confidence': kconf,
         'lufs': lo['lufs'], 'lra': lo['lra'], 'true_peak_dbfs': lo['true_peak'], 'sample_peak_dbfs': round(20 * np.log10(peak + 1e-12), 1),
         'clipped_samples': clip, 'bands_pct': dict(zip(['sub_до60', 'bass_60_250', 'lowmid_250_2k', 'highmid_2k_6k', 'high_6k+'], bands)),
         'centroid_hz': round(cen), 'stereo_corr': round(corr, 2), 'silence_start_s': round(sil0, 1), 'silence_end_s': round(sil1, 1),
         'loudness_curve_db': curve, 'hook_start': mmss(hook), 'parts': parts}
    json.dump(A, open(os.path.join(out, 'analysis.json'), 'w'), ensure_ascii=False, indent=1)
    lufs = lo['lufs']
    lt = ('очень громко — стриминги сделают тише, а пережатость останется' if lufs is not None and lufs > -9 else
          'громко, как многие современные треки' if lufs is not None and lufs > -12 else
          'нормальная громкость для стримингов' if lufs is not None and lufs > -16 else 'тихо')
    tp = lo['true_peak']
    pt = 'есть перегруз — цифровые искажения' if clip else ('выше −1 dBTP: при сжатии в mp3/соцсетях возможны искажения' if tp is not None and tp > -1 else 'запас есть')
    md = [f"# Разбор трека «{A['file']}»", '',
          '| Что | Значение | Что значит |', '|---|---|---|',
          f"| Длительность | {mmss(dur)} | |",
          f"| Темп | ≈ {bpm} BPM | может ошибаться вдвое |",
          f"| Тональность | ≈ {key} | {'неуверенно' if kconf < 0.05 else ''} |",
          f"| Громкость | {lufs} LUFS | {lt} |",
          f"| Истинный пик | {tp} dBTP | {pt} |",
          f"| Динамика (LRA) | {lo['lra']} LU | {'плотно сжат' if (lo['lra'] or 0) < 4 else 'нормально' if (lo['lra'] or 0) <= 10 else 'большие перепады'} |",
          f"| Стерео | корреляция {A['stereo_corr']} | {'очень широко — на одном динамике телефона часть звука может пропасть' if corr < 0.2 else 'почти моно' if corr > 0.95 else 'нормально'} |",
          f"| Тишина | в начале {A['silence_start_s']} с, в конце {A['silence_end_s']} с | |",
          f"| Самые громкие 10 с («хук») | с {A['hook_start']} | кандидат на фрагмент для коротких видео |", '',
          '## Баланс частот', '', ' · '.join(f'{k}: {v}%' for k, v in A['bands_pct'].items()) + f" · яркость ≈ {A['centroid_hz']} Гц", '',
          '## Части трека (по звучанию)', '']
    md += [f"- {p['from']}–{p['to']}: часть {p['part']}, {p['energy']} ({p['loudness_db']} дБ)" for p in parts] or ['- трек слишком короткий для деления на части']
    md += ['', 'Одинаковые буквы — похожее звучание (например, повтор припева). Это границы по звуку, не по смыслу.',
           '', f"Спектрограмма: {'spectrogram.png' if has_png else 'не создана (нет Pillow)'}.", '',
           'Скрипт не слышит вкус, вокал и слова — это оценивают люди; слова песни лучше попросить у владельца.']
    open(os.path.join(out, 'report.md'), 'w').write('\n'.join(md) + '\n')
    print('\n'.join(md))


if __name__ == '__main__':
    main()

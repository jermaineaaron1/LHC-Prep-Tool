# A deliberately small optical reader for clean engraved hymn pages.
#
# Filled noteheads: binary erosion -- staff lines, stems and beams are all
# thinner than a head's minor axis, so a disk erosion leaves head-seeds only.
# Hollow heads (halves/wholes): found by the white HOLE they enclose; a staff
# line through an on-line head splits its hole in two, so vertically adjacent
# holes are merged. Pitch comes from geometry against the measured staff lines.
# Rhythm and accidentals are supplied and checked by hand.
import sys
import numpy as np
import fitz
from PIL import Image
from scipy import ndimage
import io as _io

DPI = 300

def load(path):
    doc = fitz.open(path)
    pix = doc[0].get_pixmap(dpi=DPI)
    img = Image.open(_io.BytesIO(pix.tobytes('png'))).convert('L')
    return np.array(img) < 128

def staff_lines(ink):
    w = ink.shape[1]
    rowfrac = ink.sum(axis=1) / w
    rows = np.where(rowfrac > 0.35)[0]
    groups = []
    for r in rows:
        if groups and r - groups[-1][-1] <= 2: groups[-1].append(r)
        else: groups.append([r])
    centers = [sum(g) / len(g) for g in groups]
    thick = int(np.median([len(g) for g in groups]))
    staves, cur = [], [centers[0]]
    gaps = np.diff(centers)
    typical = np.median([g for g in gaps if g < 60])
    for c, g in zip(centers[1:], gaps):
        if g < typical * 1.8: cur.append(c)
        else: staves.append(cur); cur = [c]
    staves.append(cur)
    return [s for s in staves if len(s) == 5], typical, thick

def disk(r):
    y, x = np.ogrid[-r:r+1, -r:r+1]
    return (x*x + y*y) <= r*r

def filled_heads(ink, gap):
    r = max(4, int(gap * 0.24))
    seeds = ndimage.binary_erosion(ink, structure=disk(r))
    lab, n = ndimage.label(seeds)
    out = []
    for sl in ndimage.find_objects(lab):
        ys, xs = sl
        h, w = ys.stop - ys.start, xs.stop - xs.start
        # a head seed after erosion: small and roundish; beams erode to long slivers
        if w > gap * 1.8 or h > gap * 1.3: continue
        out.append({'y': (ys.start + ys.stop) / 2, 'x': (xs.start + xs.stop) / 2, 'kind': 'q'})
    return out

def hollow_heads(ink, gap, thick):
    holes = ndimage.binary_fill_holes(ink) & ~ink
    lab, n = ndimage.label(holes)
    cand = []
    for sl in ndimage.find_objects(lab):
        ys, xs = sl
        h, w = ys.stop - ys.start, xs.stop - xs.start
        area = h * w
        if not (gap * 0.5 <= w <= gap * 1.9): continue
        if not (gap * 0.18 <= h <= gap * 1.25): continue
        if area < gap * gap * 0.12: continue
        # notehead holes are clearly wider than tall; lyric letters are round
        if w / h < 1.25: continue
        cand.append({'y': (ys.start + ys.stop) / 2, 'x': (xs.start + xs.stop) / 2, 'h': h, 'w': w})
    # A hollow head ON a line has its hole cut in two by that line. The
    # half-holes are measurably SHORT (under half a gap); full holes of
    # in-space heads are not. Pair the halves back together at the line
    # between them; a lone half (its partner eaten by a beam or ledger)
    # still snaps to the line it hugs.
    full = [c for c in cand if c['h'] >= gap * 0.5]
    halves = sorted([c for c in cand if c['h'] < gap * 0.5], key=lambda c: (c['x'], c['y']))
    merged = [{'y': c['y'], 'x': c['x'], 'kind': 'h'} for c in full]
    used = [False] * len(halves)
    for i, c in enumerate(halves):
        if used[i]: continue
        partner = None
        for j in range(i + 1, len(halves)):
            d = halves[j]
            if used[j] or abs(d['x'] - c['x']) > gap * 0.8: continue
            if 0 < d['y'] - c['y'] <= gap * 0.95: partner = j; break
        if partner is not None:
            used[i] = used[partner] = True
            merged.append({'y': (c['y'] + halves[partner]['y']) / 2, 'x': (c['x'] + halves[partner]['x']) / 2, 'kind': 'h'})
        else:
            used[i] = True
            merged.append({'y': c['y'], 'x': c['x'], 'kind': 'h', 'snap': True})
    return merged

LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
def pitch_of(step, clef):
    base = ('B', 4) if clef == 'treble' else ('D', 3)
    idx = LETTERS.index(base[0]) + step
    return LETTERS[idx % 7] + str(4 if clef == 'treble' else 3 + (idx // 7) if False else (4 if clef == 'treble' else 3) + idx // 7)

def name_of(step, clef):
    base_letter, base_oct = ('B', 4) if clef == 'treble' else ('D', 3)
    idx = LETTERS.index(base_letter) + step
    return LETTERS[idx % 7] + str(base_oct + (idx // 7) - (1 if idx < 0 and idx % 7 != 0 else 0)) if idx >= 0 else LETTERS[idx % 7] + str(base_oct + ((idx - 6) // 7 + 0))

def spelled(step, clef):
    base_letter, base_oct = ('B', 4) if clef == 'treble' else ('D', 3)
    idx = LETTERS.index(base_letter) + step
    octave = base_oct + (idx // 7)
    return LETTERS[idx % 7] + str(octave)

def main(path, xmin):
    ink = load(path)
    staves, gap, thick = staff_lines(ink)
    fh = filled_heads(ink, gap)
    hh = hollow_heads(ink, gap, thick)
    print(f'# {path}: {len(staves)} staves, gap {gap:.1f}, thick {thick}')
    for i, lines in enumerate(staves):
        clef = 'treble' if i % 2 == 0 else 'bass'
        mid = lines[2]
        top, bottom = lines[0], lines[-1]
        heads = []
        for o in fh + hh:
            if not (top - 2.6 * gap < o['y'] < bottom + 2.6 * gap): continue
            if o['x'] < xmin: continue
            raw = 2 * (mid - o['y']) / gap
            if o.get('snap'):
                step = round(raw / 2) * 2  # a lone half-hole belongs to the line it hugs
                tag = o['kind'] + '~'
            else:
                step = round(raw)
                tag = o['kind'] + ('?' if abs(raw - step) > 0.3 else '')
            heads.append({'x': o['x'], 'p': spelled(int(step), clef), 'k': tag})
        heads.sort(key=lambda h: h['x'])
        cols = []
        for h in heads:
            if cols and h['x'] - cols[-1][-1]['x'] < gap * 1.15: cols[-1].append(h)
            else: cols.append([h])
        parts = []
        for col in cols:
            seen = {}
            for p in col: seen.setdefault(p['p'] + p['k'], p)
            names = sorted(seen.values(), key=lambda q: (-int(q['p'][-1]), -LETTERS.index(q['p'][0])))
            parts.append(f"{int(col[0]['x'])}:" + '/'.join(q['p'] + q['k'] for q in names))
        print(f'staff{i+1}({clef}): ' + '  '.join(parts))

if __name__ == '__main__':
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 320)

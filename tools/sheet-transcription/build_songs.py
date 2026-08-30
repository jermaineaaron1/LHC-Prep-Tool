# Builds the three songs transcribed from the user's sheets into vh_songs rows.
# Pitch spellings verified note-by-note against the engraved pages via the
# optical reader + zoom passes; rhythm read by eye from the same pages.
import json, math

# ---------------------------------------------------------------- helpers
NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
def m(name):
    # e.g. 'Eb4', 'F#3', 'A2'
    letter = name[0]; rest = name[1:]
    acc = 0
    if rest.startswith('b'): acc = -1; rest = rest[1:]
    elif rest.startswith('#'): acc = 1; rest = rest[1:]
    return 12 * (int(rest) + 1) + NOTE[letter] + acc

def build(slug, voices, bpm, lead=2.0, gap=0.96):
    """voices: {part_index: [(pitch, beats, lyric_or_None), ...]} sequential."""
    beat = 60.0 / bpm
    notes, ends = [], []
    for part, seq in voices.items():
        t = lead
        for i, (pitch, dur, lyric) in enumerate(seq):
            if pitch is not None:
                notes.append({
                    'id': f'{slug}-{max(part,0)}-{i}',
                    'midi': m(pitch), 'part': part,
                    'start': round(t, 3), 'end': round(t + dur * beat * gap, 3),
                    'lyric': lyric or '', 'velocity': 96,
                })
                ends.append(t + dur * beat)
            t += dur * beat
    notes.sort(key=lambda n: (n['start'], n['part']))
    return notes, max(ends)

def hz(midi): return round(440 * 2 ** ((midi - 69) / 12))

def parts_meta(notes, names):
    out = []
    for i, name in enumerate(names):
        mids = [n['midi'] for n in notes if n['part'] == i or n['part'] == -1]
        out.append({'name': name, 'aiGen': False, 'curve': [], 'edits': 0,
                    'rangeMin': hz(min(mids)), 'rangeMax': hz(max(mids))})
    return out

def lyric_lines(notes, breaks):
    """timed_lyrics rows from the soprano/unison line, split at given note indices."""
    line_notes = [n for n in notes if (n['part'] in (0, -1)) and n['lyric']]
    rows, start = [], 0
    for end in breaks + [len(line_notes)]:
        chunk = line_notes[start:end]
        if not chunk: break
        rows.append({'start': chunk[0]['start'], 'end': round(chunk[-1]['end'] + 0.4, 3),
                     'primary': ' '.join(n['lyric'] for n in chunk), 'translation': ''})
        start = end
    return rows

# ---------------------------------------------------------------- ABIDE WITH ME
# EVENTIDE, Eb major, 4/4, 16 bars. Transcribed from Abide-With-Me-Full-Score.pdf.
S = [('G4',2,'A'),('G4',1,'bide'),('F4',1,'with'), ('Eb4',2,'me!'),('Bb4',2,'Fast'),
     ('C5',1,'falls'),('Bb4',1,'the'),('Bb4',1,'e'),('Ab4',1,'ven'), ('G4',4,'tide.'),
     ('G4',2,'The'),('Ab4',1,'dark'),('Bb4',1,'ness'), ('C5',2,'deep'),('Bb4',2,'ens:'),
     ('Ab4',1,'Lord,'),('F4',1,'with'),('G4',1,'me'),('A4',1,'a'), ('Bb4',4,'bide!'),
     ('G4',2,'When'),('G4',1,'oth'),('F4',1,'er'), ('Eb4',2,'help'),('Bb4',2,'ers'),
     ('Bb4',1,'fail'),('Ab4',1,'and'),('A4',1,'com'),('G4',1,'forts'), ('F4',4,'flee,'),
     ('F4',2,'Help'),('G4',1,'of'),('Ab4',1,'the'),
     ('G4',1,'help'),('F4',1,'less,'),('Eb4',1,'oh,'),('Ab4',1,'a'),
     ('G4',2,'bide'),('F4',2,'with'), ('Eb4',4,'me!')]
A = [('Eb4',2,None),('D4',1,None),('D4',1,None), ('C4',2,None),('Eb4',2,None),
     ('Eb4',1,None),('D4',1,None),('Eb4',1,None),('F4',1,None), ('Eb4',4,None),
     ('Eb4',2,None),('Eb4',1,None),('Eb4',1,None), ('Eb4',2,None),('Eb4',2,None),
     ('Eb4',1,None),('F4',1,None),('Eb4',1,None),('Eb4',1,None), ('D4',4,None),
     ('Eb4',2,None),('D4',1,None),('D4',1,None), ('C4',2,None),('Eb4',2,None),
     ('Eb4',1,None),('Eb4',1,None),('Eb4',1,None),('Eb4',1,None), ('C4',4,None),
     ('D4',2,None),('Eb4',1,None),('D4',1,None),
     ('Eb4',1,None),('D4',1,None),('C4',1,None),('F4',1,None),
     ('Eb4',2,None),('D4',2,None), ('Bb3',4,None)]
T = [('Bb3',2,None),('Bb3',1,None),('Ab3',1,None), ('G3',2,None),('Eb3',2,None),
     ('Eb3',1,None),('Bb3',1,None),('Bb3',1,None),('Bb3',1,None), ('Bb3',4,None),
     ('Bb3',2,None),('Ab3',1,None),('G3',1,None), ('Ab3',2,None),('G3',2,None),
     ('C4',1,None),('Bb3',1,None),('Bb3',1,None),('F3',1,None), ('F3',4,None),
     ('G3',1,None),('Ab3',1,None),('Bb3',1,None),('Ab3',1,None), ('G3',2,None),('Eb4',1,None),('D4',1,None),
     ('C4',1,None),('C4',1,None),('C4',1,None),('Bb3',1,None), ('Ab3',4,None),
     ('Bb3',2,None),('Bb3',1,None),('Bb3',1,None),
     ('Bb3',1,None),('Ab3',1,None),('G3',1,None),('C4',1,None),
     ('Bb3',3,None),('Ab3',1,None), ('G3',4,None)]
B = [('Eb3',2,None),('Bb2',1,None),('Bb2',1,None), ('C3',2,None),('G2',2,None),
     ('Ab2',1,None),('Bb2',1,None),('C3',1,None),('D3',1,None), ('Eb3',4,None),
     ('Eb3',1,None),('D3',1,None),('C3',1,None),('Bb2',1,None), ('Ab2',2,None),('Eb3',2,None),
     ('F3',1,None),('D3',1,None),('Eb3',1,None),('C3',1,None), ('Bb2',4,None),
     ('Eb3',2,None),('Bb2',1,None),('Bb2',1,None), ('C3',2,None),('G2',2,None),
     ('Ab2',1.5,None),('Bb2',0.5,None),('C3',1,None),('C3',1,None), ('F3',4,None),
     ('Ab3',2,None),('G3',1,None),('F3',1,None),
     ('Eb3',1,None),('Bb2',1,None),('C3',1,None),('Ab2',1,None),
     ('Bb2',2,None),('Bb2',2,None), ('Eb3',4,None)]
abide_notes, abide_len = build('abide-satb', {0: S, 1: A, 2: T, 3: B}, 76)
abide = {
    'title': 'Abide With Me',
    'artist': 'Henry F. Lyte / William H. Monk (EVENTIDE, 1861)',
    'arranged_by': 'Transcribed note-for-note from the provided full score (Kravchuk edition)',
    'tags': 'hymn, evening, comfort, public domain, SATB',
    'bpm': 76, 'time_sig': 4, 'duration': math.ceil(abide_len + 1),
    'notes': abide_notes,
    'parts': parts_meta(abide_notes, ['Soprano', 'Alto', 'Tenor', 'Bass']),
    'timed_lyrics': lyric_lines(abide_notes, [10, 20, 30]),
    'status': 'ready', 'prim_lang': 'en', 'trans_lang': 'none',
}

# ---------------------------------------------------------------- HARK! THE HERALD
# Mendelssohn, F major, 4/4, 20 bars. From Hark-The-Herald-Angels-Sings-F-Major.pdf.
S = [('C4',1,'Hark!'),('F4',1,'the'),('F4',1.5,'her'),('E4',0.5,'ald'),
     ('F4',1,'an'),('A4',1,'gels'),('A4',1.5,'sing,'),('G4',0.5,'"Glo'),
     ('C5',1,'ry'),('C5',1,'to'),('C5',1.5,'the'),('Bb4',0.5,'new'),
     ('A4',1,'born'),('G4',1,'King:'),('A4',2,''),
     ('C4',1,'peace'),('F4',1,'on'),('F4',1.5,'earth,'),('E4',0.5,'and'),
     ('F4',1,'mer'),('A4',1,'cy'),('G4',1,'mild,'),('F4',1,''),
     ('C5',1,'God'),('G4',1,'and'),('G4',1.5,'sin'),('E4',0.5,'ners'),
     ('E4',1,'re'),('D4',1,'con'),('C4',2,'ciled!"'),
     ('C5',1,'Joy'),('C5',1,'ful,'),('C5',1,'all'),('F4',1,'ye'),
     ('Bb4',1,'na'),('A4',1,'tions,'),('A4',1,'rise,'),('G4',1,''),
     ('C5',1,'join'),('C5',1,'the'),('C5',1,'tri'),('F4',1,'umph'),
     ('Bb4',1,'of'),('A4',1,'the'),('A4',1,'skies;'),('G4',1,''),
     ('D5',1,'with'),('D5',1,"th'an"),('D5',1,'gel'),('C5',1,'ic'),
     ('Bb4',1,'hosts'),('A4',1,'pro'),('Bb4',2,'claim,'),
     ('G4',1,'"Christ'),('A4',0.5,'is'),('B4',0.5,''),('C5',1.5,'born'),('F4',0.5,'in'),
     ('F4',1,'Beth'),('G4',1,'le'),('A4',2,'hem!"'),
     ('D5',1.5,'Hark!'),('D5',0.5,'the'),('D5',1,'her'),('C5',1,'ald'),
     ('Bb4',1,'an'),('A4',1,'gels'),('B4',2,'sing,'),
     ('G4',1,'"Glo'),('A4',0.5,'ry'),('Bb4',0.5,''),('C5',1.5,'to'),('F4',0.5,'the'),
     ('F4',1,'new'),('G4',1,'born'),('F4',2,'King."')]
A = [('C4',1,None),('C4',1,None),('C4',1.5,None),('C4',0.5,None),
     ('C4',1,None),('F4',1,None),('F4',1.5,None),('E4',0.5,None),
     ('F4',1,None),('E4',1,None),('D4',1.5,None),('D4',0.5,None),
     ('F4',1,None),('E4',1,None),('F4',2,None),
     ('C4',1,None),('C4',1,None),('C4',1.5,None),('C4',0.5,None),
     ('F4',1,None),('F4',1,None),('F4',2,None),
     ('E4',1,None),('D4',1,None),('E4',1.5,None),('C4',0.5,None),
     ('C4',1,None),('B3',1,None),('C4',2,None),
     ('C4',1,None),('C4',1,None),('C4',1,None),('C4',1,None),
     ('G4',1,None),('F4',1,None),('F4',1,None),('E4',1,None),
     ('C4',1,None),('C4',1,None),('C4',1,None),('C4',1,None),
     ('G4',1,None),('F4',1,None),('F4',1,None),('E4',1,None),
     ('Bb4',1,None),('Bb4',1,None),('Bb4',1,None),('A4',1,None),
     ('G4',1,None),('F#4',1,None),('G4',2,None),
     ('E4',1,None),('E4',1,None),('F4',1.5,None),('C4',0.5,None),
     ('C4',1,None),('E4',1,None),('F4',2,None),
     ('Bb4',1.5,None),('Bb4',0.5,None),('Bb4',1,None),('A4',1,None),
     ('G4',1,None),('F#4',1,None),('G4',2,None),
     ('C4',1,None),('E4',1,None),('F4',1.5,None),('C4',0.5,None),
     ('C4',1,None),('C4',1,None),('C4',2,None)]
T = [('A3',1,None),('A3',1,None),('A3',1.5,None),('G3',0.5,None),
     ('F3',1,None),('C4',1,None),('C4',2,None),
     ('C4',1,None),('C4',1,None),('D4',1.5,None),('D4',0.5,None),
     ('C4',1,None),('C4',1,None),('C4',2,None),
     ('A3',1,None),('A3',1,None),('A3',1.5,None),('G3',0.5,None),
     ('C4',1,None),('C4',1,None),('D4',2,None),
     ('C4',1,None),('D4',1,None),('C4',1.5,None),('G3',0.5,None),
     ('A3',1,None),('F3',1,None),('E3',2,None),
     ('C4',1,None),('C4',1,None),('C4',1,None),('C4',1,None),
     ('C4',1,None),('C4',1,None),('C4',2,None),
     ('C4',1,None),('C4',1,None),('C4',1,None),('C4',1,None),
     ('C4',1,None),('C4',1,None),('C4',2,None),
     ('D4',1,None),('D4',1,None),('D4',1,None),('D4',1,None),
     ('D4',1,None),('C4',1,None),('Bb3',2,None),
     ('C4',1,None),('C4',1,None),('C4',1.5,None),('A3',0.5,None),
     ('A3',1,None),('C4',1,None),('C4',2,None),
     (None,3,None),('C4',1,None),
     ('Bb3',1,None),('A3',1,None),('B3',2,None),
     ('C4',1,None),('B3',1,None),('C4',1.5,None),('A3',0.5,None),
     ('A3',1,None),('Bb3',1,None),('A3',2,None)]
B = [('F3',1,None),('F3',1,None),('F3',1.5,None),('C3',0.5,None),
     ('A2',1,None),('F2',1,None),('C3',2,None),
     ('A2',1,None),('A2',1,None),('Bb2',1.5,None),('Bb2',0.5,None),
     ('C3',1,None),('C3',1,None),('F3',2,None),
     ('F3',1,None),('F3',1,None),('F3',1.5,None),('C3',0.5,None),
     ('C3',1,None),('D3',1,None),('E3',1.5,None),('F3',0.5,None),
     ('A2',1,None),('B2',1,None),('C3',1.5,None),('C3',0.5,None),
     ('F2',1,None),('G2',1,None),('C3',2,None),
     ('C4',1,None),('C4',1,None),('C4',1,None),('A3',1,None),
     ('E3',1,None),('F3',1,None),('C3',2,None),
     ('C4',1,None),('C4',1,None),('C4',1,None),('A3',1,None),
     ('E3',1,None),('F3',1,None),('C3',2,None),
     ('Bb2',1,None),('Bb2',1,None),('Bb2',1,None),('Bb2',1,None),
     ('Bb2',1,None),('D3',1,None),('G3',1,None),('F3',1,None),
     ('Bb3',1,None),('Bb3',1,None),('A3',1.5,None),('F3',0.5,None),
     ('C3',1,None),('C3',1,None),('F3',2,None),
     ('Bb2',3,None),('A3',1,None),
     ('Bb2',1,None),('D3',1,None),('G3',1,None),('F3',1,None),
     ('E3',1,None),('E3',1,None),('A3',1.5,None),('F3',0.5,None),
     ('C3',1,None),('C3',1,None),('F3',2,None)]
hark_notes, hark_len = build('hark-herald', {0: S, 1: A, 2: T, 3: B}, 104)
hark = {
    'title': 'Hark! The Herald Angels Sing',
    'artist': 'Charles Wesley / Felix Mendelssohn (MENDELSSOHN)',
    'arranged_by': 'Transcribed note-for-note from the provided F-major full score (Kravchuk edition)',
    'tags': 'hymn, christmas, public domain, SATB',
    'bpm': 104, 'time_sig': 4, 'duration': math.ceil(hark_len + 1),
    'notes': hark_notes,
    'parts': parts_meta(hark_notes, ['Soprano', 'Alto', 'Tenor', 'Bass']),
    'timed_lyrics': lyric_lines(hark_notes, [8, 14, 22, 29, 37, 45, 51, 56, 59, 66]),
    'status': 'ready', 'prim_lang': 'en', 'trans_lang': 'none',
}

# ---------------------------------------------------------------- SING WE NOW OF CHRISTMAS
# NOEL NOUVELET, E minor (dorian), 2/4, from the page-193 scan read at 4x
# through omr.py (PNG variant) + annotated zoom passes. The AUTHENTIC tune:
# eighth-note pickup, the leap to B4, the raised sixth C#5 under A/E, the
# A4->B4 sixteenth turn, and the low answering refrain. Accompaniment from
# the page's own lines (bass staff walks, treble second voice).
def _verse_S(w):
    return [('E4',.5,w[0]),
            ('E4',.5,w[1]),('B4',.5,w[2]),('C#5',.5,w[3]),('A4',.5,w[4]),
            ('B4',1,w[5]),('G4',1,w[6]),
            ('A4',.5,w[7]),('A4',.25,''),('B4',.25,''),('G4',.5,w[8]),('F#4',.5,w[9]),
            ('E4',1.5,w[10])]   # written a half; released at the printed eighth rest
_R_S = [('G4',1,'Sing'),('F#4',.5,'we'),('E4',.5,'No'),
        ('F#4',1.5,'el,'),('G4',.5,'the'),
        ('G4',.5,'King'),('G4',.5,'is'),('F#4',.5,'born,'),('E4',.5,'No'),
        ('F#4',1.5,'el!')]
_F_S = [('E4',.5,'Sing'),
        ('E4',.5,'we'),('B4',.5,'now'),('C#5',.5,'of'),('A4',.5,'Christ'),
        ('B4',1,'mas,'),('G4',1,'sing'),
        ('A4',.5,'we'),('D5',.25,'now'),('B4',.25,''),('G4',.5,'No'),('F#4',.5,'el!'),
        ('E4',2,'')]
U = (_verse_S(['Sing','we','now','of','Christ','mas,','No','el,','sing','we','here!'])
     + _verse_S(['Hear','our','grate','ful','prais','es','to','the','Babe','so','dear.'])
     + _R_S + _F_S)
_rest = (None,.5,None)
_AV = [('E4',2,None),('D4',2,None),('C#4',1,None),('B3',1,None),('B3',2,None)]
_TV = [('E3',.5,None),('G3',.5,None),('A3',.5,None),('C#4',.5,None),('B3',2,None),
       ('A3',1,None),('D#3',1,None),('G3',2,None)]
_BV = [('E3',2,None),('G3',1,None),('E3',1,None),
       ('A2',.5,None),('E3',.5,None),('B2',1,None),('E3',2,None)]
_AR = [('B3',1,None),('B3',1,None),('B3',1.5,None),('B3',.5,None),('B3',2,None),('D#4',2,None)]
_TR = [('E3',2,None),('D#3',2,None),('E3',2,None),('F#3',2,None)]
_BR = [('E3',.5,None),('F#3',.5,None),('G3',.5,None),('E3',.5,None),('B2',2,None),
       ('E3',1,None),('F#3',.5,None),('G3',.5,None),('B2',2,None)]
A_line = [_rest] + _AV + _AV + _AR + _AV
T_line = [_rest] + _TV + _TV + _TR + _TV
B_line = [_rest] + _BV + _BV + _BR + _BV
sing_notes, sing_len = build('sing-we-now', {0: U, 1: A_line, 2: T_line, 3: B_line}, 92, lead=2.283)
# every voice carries its words: a harmony note takes the syllable the
# soprano sings at its onset, hymnal-style
_sop_ly = sorted([n for n in sing_notes if n['part'] == 0 and n['lyric']], key=lambda n: n['start'])
for _n in sing_notes:
    if _n['part'] == 0 or _n['lyric']: continue
    for _s0 in _sop_ly:
        if abs(_s0['start'] - _n['start']) < 0.05: _n['lyric'] = _s0['lyric']; break
# the four voices release together on the soprano's final note
_send = max(n['end'] for n in sing_notes if n['part'] == 0)
for _p in (1, 2, 3):
    _ln = max((n for n in sing_notes if n['part'] == _p), key=lambda n: n['start'])
    _ln['end'] = _send
sing = {
    'title': 'Sing We Now of Christmas',
    'artist': 'French carol, 15th c. (NOEL NOUVELET)',
    'arranged_by': 'Re-transcribed note-for-note from the page-193 scan at 4x zoom via the optical reader: the authentic tune with the page own accompaniment lines',
    'tags': 'carol, christmas, public domain, SATB',
    'bpm': 92, 'time_sig': 2, 'duration': math.ceil(sing_len + 1),
    'notes': sing_notes,
    'parts': parts_meta(sing_notes, ['Soprano', 'Alto', 'Tenor', 'Bass']),
    'timed_lyrics': lyric_lines(sing_notes, [11, 22, 32]),
    'status': 'ready', 'prim_lang': 'en', 'trans_lang': 'none',
}

# ---------------------------------------------------------------- validate
def validate(name, song, expect_parts):
    notes = song['notes']
    problems = []
    for p in expect_parts:
        seq = sorted([n for n in notes if n['part'] == p], key=lambda n: n['start'])
        for a, b in zip(seq, seq[1:]):
            if b['start'] < a['end'] - 1e-6: problems.append(f'part {p}: overlap at {a["start"]}')
        if not seq: problems.append(f'part {p}: empty')
    lows = {0: 55, 1: 53, 2: 45, 3: 38}; highs = {0: 84, 1: 79, 2: 69, 3: 62}
    for n in notes:
        p = n['part']
        if p >= 0 and not (lows[p] - 3 <= n['midi'] <= highs[p] + 3):
            problems.append(f'part {p}: {n["midi"]} out of range at {n["start"]}')
    print(f'{name}: {len(notes)} notes, duration {song["duration"]}s, '
          + ('OK' if not problems else 'PROBLEMS: ' + '; '.join(problems[:8])))
    return not problems

ok = True
ok &= validate('abide', abide, [0, 1, 2, 3])
ok &= validate('hark', hark, [0, 1, 2, 3])
ok &= validate('sing', sing, [0, 1, 2, 3])

# bar-alignment: every voice of the SATB songs must end at the same time
for name, song in [('abide', abide), ('hark', hark), ('sing', sing)]:
    finals = {p: max(n['end'] for n in song['notes'] if n['part'] == p) for p in range(4)}
    spread = max(finals.values()) - min(finals.values())
    print(f'{name}: final-note ends spread {spread:.3f}s', 'OK' if spread < 0.05 else 'MISALIGNED ' + str(finals))
    ok &= spread < 0.05

def parallels(song, name):
    from collections import defaultdict
    onsets = defaultdict(dict)
    for n in song['notes']:
        if n['part'] < 0: continue
        onsets[round(n['start'], 3)][n['part']] = n['midi']
    times = sorted(onsets)
    state, hits = {}, []
    prev = None
    for t in times:
        cur = dict(state); cur.update(onsets[t])
        if prev and len(cur) == 4 and len(prev) == 4:
            for a in range(4):
                for b in range(a + 1, 4):
                    iv_now = abs(cur[a] - cur[b]) % 12
                    iv_was = abs(prev[a] - prev[b]) % 12
                    moved = cur[a] != prev[a] and cur[b] != prev[b]
                    if moved and iv_now == iv_was and iv_now in (0, 7):
                        hits.append(f'{t}s parts {a}/{b} parallel {"8ve" if iv_now == 0 else "5th"}')
        prev = cur; state = cur
    print(name, 'parallels:', hits if hits else 'none')
parallels(sing, 'sing')

json.dump({'abide': abide, 'hark': hark, 'sing': sing}, open('songs_payload.json', 'w'), indent=None)
print('payload written, all valid:', ok)

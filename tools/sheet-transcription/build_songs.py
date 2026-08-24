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
# NOEL NOUVELET, E minor, 2/4, unison melody from the hymnal page (No. 193).
U = [('E4',0.5,'Sing'),('E4',0.5,'we'),('F#4',0.5,'now'),('G4',0.5,'of'),
     ('B4',0.5,'Christ'),('B4',0.5,'mas,'),('A4',0.5,'No'),('G4',0.5,'el,'),
     ('F#4',0.5,'sing'),('G4',0.5,'we'),('E4',1,'here!'),
     ('E4',2,''),
     ('E4',0.5,'Hear'),('E4',0.5,'our'),('F#4',0.5,'grate'),('G4',0.5,'ful'),
     ('B4',0.5,'prais'),('B4',0.5,'es'),('A4',0.5,'to'),('G4',0.5,'the'),
     ('F#4',0.5,'Babe'),('G4',0.5,'so'),('E4',1,'dear.'),
     ('E4',2,''),
     ('B4',0.5,'Sing'),('B4',0.5,'we'),('A4',0.5,'No'),('G4',0.5,'el,'),
     ('F#4',0.5,'the'),('G4',0.5,'King'),('A4',0.5,'is'),('F#4',0.5,'born,'),
     ('G4',1,'No'),('F#4',1,'el!'),
     ('F#4',2,''),
     ('E4',0.5,'Sing'),('E4',0.5,'we'),('F#4',0.5,'now'),('G4',0.5,'of'),
     ('B4',0.5,'Christ'),('B4',0.5,'mas,'),('A4',0.5,'sing'),('G4',0.5,'we'),
     ('F#4',0.5,'now'),('G4',0.5,'No'),('E4',1,'el!'),
     ('E4',2,'')]
# SATB on the hymnal page's own chord symbols (Em, A/E, B/D#, B), with the
# melody as soprano. Voiced for the cadences: E-pedal bars, V6/5 -> i at each
# phrase end, half cadence on B at the refrain's midpoint.
phrA_A = [('B3',2,None),('E4',1,None),('C#4',1,None),('B3',1,None),('B3',1,None),('B3',2,None)]
phrA_T = [('G3',2,None),('G3',1,None),('A3',1,None),('F#3',1,None),('G3',1,None),('G3',2,None)]
phrA_B = [('E3',2,None),('E3',1,None),('E3',1,None),('D#3',1,None),('E3',1,None),('E3',2,None)]
ref_A  = [('B3',1,None),('E4',1,None),('D#4',2,None),('B3',1,None),('D#4',1,None),('D#4',2,None)]
ref_T  = [('G3',1,None),('G3',1,None),('B3',2,None),('G3',1,None),('B3',1,None),('B3',2,None)]
ref_B  = [('E3',1,None),('C3',1,None),('D#3',2,None),('E3',1,None),('B2',1,None),('B2',2,None)]
A_line = phrA_A + phrA_A + ref_A + phrA_A
T_line = phrA_T + phrA_T + ref_T + phrA_T
B_line = phrA_B + phrA_B + ref_B + phrA_B
sing_notes, sing_len = build('sing-we-now', {0: U, 1: A_line, 2: T_line, 3: B_line}, 92)
sing = {
    'title': 'Sing We Now of Christmas',
    'artist': 'French carol, 15th c. (NOEL NOUVELET)',
    'arranged_by': 'Melody from the provided hymnal page (No. 193); SATB voiced on its chord symbols (Em, A/E, B/D#, B) — check bars 9-12 against your book',
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

# Sheet transcription tools

Used to add songs to the Vocal Hero library from engraved sheet music
(PDF), note-for-note. First used Aug 2026 for Abide With Me, Hark! The
Herald Angels Sing, and Sing We Now of Christmas.

## omr.py — a deliberately small optical reader

    python omr.py <score.pdf> [xmin]

Renders page 1 at 300 dpi and prints, per staff, the noteheads it finds as
`x:pitch` columns. Filled heads come from binary erosion (staff lines,
stems and beams are all thinner than a head), hollow heads from the white
hole they enclose. It reads PITCH ONLY — rhythm and accidentals are read
by eye — and it has known artifact patterns worth recognising:

- an on-line hollow head's hole is split in two by the line; the halves are
  re-paired, and a lone half is snapped to the line it hugs
- the white box between a barline and the first stem reads as a stack of
  fake "hollow heads", one per staff space, ~17px after every barline
- two hollow heads a third apart enclose a phantom hole between their rims
- an interlocked second (two heads touching across a line) sprouts a fake
  filled head at the contact point

When a cell stays ambiguous, crop that bar at 600 dpi and look at it.
Needs: pymupdf, scipy, numpy, PIL.

## build_songs.py — transcription to vh_songs rows

Voices are written as `(pitch, beats, lyric)` tuples per part; the script
computes note timings, validates (no overlaps, singable ranges, all voices
ending together, no parallel fifths/octaves), and writes a JSON payload
that is inserted into `vh_songs` via the REST API. See the three songs in
the file for the format.

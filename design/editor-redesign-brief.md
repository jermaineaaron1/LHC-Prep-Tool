# VocalHero Song Editor — redesign brief

Paste this whole document into ChatGPT. Ask it for (in this order):
1. a **layout wireframe** of the note-editor screen (zones and hierarchy),
2. a **high-fidelity concept image** (DALL·E) of that layout in the visual
   direction below,
3. an **HTML/CSS mockup** of the same screen (this is the most useful
   deliverable — a picture shows mood, an HTML mockup shows spacing and
   real component states),
4. concepts for the three secondary surfaces: Rendition, Harmony dialog,
   and the entry palette states.

Everything produced comes back to Claude Code, which implements it with
all functionality intact.

---

## Product context

VocalHero is a church-choir practice game (think Guitar Hero for SATB
singing) inside the LHC Worship Prep app. The **Song Editor** is its
arrangement workshop: songs are transcribed from sheet music, arranged
into performance renditions, and edited note-by-note on a real music
staff. Users are church musicians — they read sheet music; they are not
audio engineers. Desktop-first (1280 px and up), always dark.

## The problem (see attached screenshot)

The current editor works but reads as **five stacked toolbars above a
squeezed score**. Roughly 45% of the vertical space is chrome; the music
— the reason the screen exists — gets what is left. Specific pains:

- Four control rows + a notice banner + an info bar + a help paragraph
  + a palette row + a view-toggle row, all full-width, all equal visual
  weight. Play (used constantly) has the same prominence as Import MIDI
  (used once per song).
- The same concept appears twice: a "Draw note" value picker lives in
  the transport row AND a richer value palette lives lower down.
- Mixed button styles: pill, rounded-rect, outline, coloured borders —
  no system.
- The left sidebar (voice strips + part mixer) duplicates voice
  selection that also happens in the score itself.
- Notices (amber banner) push all content down when they appear.

## What the redesign must deliver

- **The score is the hero.** 70%+ of the viewport height in normal use.
- **Three modes as one clear top-level switch**: `Rendition` (arrange
  passes of the song), `Score` (engraved SATB staves — the default),
  `Grid` (piano roll, for surgery). Today Rendition is a separate page
  and Score/Grid a small toggle lost mid-screen.
- **Progressive disclosure**: constant controls always visible; frequent
  ones one click away; rare ones behind a menu. Suggested tiers below.
- **One visual system**: consistent button shapes, consistent use of the
  four voice colours, one accent for primary actions.
- Notices as floating toasts, not layout-shifting banners.

## Visual direction

- Background #020510 (near-black blue). Panel surfaces slightly lighter
  (#080b1d). White engraving on dark staves is established and loved.
- Voice identity colours (used for lanes, chips, meters — keep):
  Soprano #ff60bc · Alto #a965ff · Tenor #22d3ee · Bass #ffbd45
- Accent for primary action: fuchsia→cyan gradient (existing brand,
  "VOCALHero" logotype).
- Type: bold condensed labels, small-caps section headers, tabular
  numerals for times. Music symbols use real engraving glyphs (𝅝 𝅗𝅥 ♩ ♪).
- Mood: a concert stage at night — deep, focused, a little theatrical —
  not a DAW. Avoid grey-on-grey utility panels.

## Complete functional inventory — nothing may be lost

Tier 1 — always visible:
- Mode switch: Rendition / Score / Grid
- Transport: play from cursor, play from start, pause/stop, −5s/+5s,
  clock readout
- Tool switch: Select / Draw / Erase
- Undo / Redo · Save · Close
- Voice selector: S/A/T/B (also selects which voice new notes enter);
  per-voice colour identity everywhere

Tier 2 — one click / always visible in a compact form:
- Note-entry palette: value buttons (whole…sixteenth) with keyboard
  numbers 7–3, dot toggle, **Step entry** mode toggle, the caret readout
  ("Alto · next entry bar 3 beat 1½ · 1½ beats left"), bar-fill meter,
  "auto ♪ completes the beat" suggestion chip, Fill rest of bar, Rest →
- Selected-note inspector: note name, lyric, bar·beat, on-beat chip,
  rhythm value, hold length, exact seconds, copy/paste
- ＋ bar / − bar (insert/delete bar at the entry caret)
- Zoom (Grid view)
- Align to melody (snap harmony rhythms to the soprano)
- Harmony (copy a voice into another at an interval — opens dialog)
- Type lyrics (type a line of words onto notes — opens dialog)
- Duplicate / Copy / Paste / Remove selection

Tier 3 — occasional (menu or collapsible panel is fine):
- Import MusicXML · Import MIDI (opens preview/assign dialog)
- Upload backing track (opens the backing-track editor: clips, trim,
  volume, speed, skip regions)
- Record a take · play take · convert take to notes (with
  "transcription snap" toggle and a which-voice picker)
- Musical timeline: BPM at cursor, time signature, key, snap grid
  selector, default drawn length + "Latch all", tempo/meter/key change
  markers
- Part mixer (per-voice level/mute)
- Timeline full screen toggle
- Rename song (inline title edit)

Score view interactions (must all survive):
- Click a notehead → select (syncs the inspector and voice)
- Drag a head vertically = diatonic staff-position moves; horizontally
  = beat moves (live cyan preview)
- Draw tool: click any staff position → enter a note at the palette's
  value, in the selected voice
- Erase tool: click removes
- Lyrics under the melody line; bar numbers; key signature; meter;
  ties; accidentals; playback cursor sweeping the systems
- Step entry keyboard: letters A–G enter pitches in the song's key,
  R rests, ↑↓ nudge, numbers switch values, · dots

Rendition view (its own calm screen, numbered 1-2-3 flow):
- Sections of the song as tappable chips (labelled by their lyrics)
- Passes as cards: who sings (Unison / S·A·T·B toggles), key ±,
  tempo (broader/as-written/brighter), feel (soft/steady/full),
  reorder/duplicate/remove
- "Start me off: classic three-verse shape" empty-state button
- Live totals (passes · duration · notes)
- "Hear & fine-tune in the note editor" and "Save as a new song" (title
  field) — the original song is never modified

Grid view (piano roll — keep as-is functionally):
- Per-voice collapsible lanes, bars-and-beats ruler with BPM/meter/key
  labels, backing-track lane, lasso select, drag to move/resize,
  right-click…none. Zoom slider applies here.

Dialogs to restyle but keep: Harmony, Type-lyrics, MIDI/XML import
preview, backing-track editor, note glossary.

## Constraints for the mockups

- 1280×800 minimum target; the score area must show at least two full
  systems (~430 px) at that size.
- Dark only. No pure white surfaces.
- Real text in mockups where possible ("Hark! The Herald Angels Sing",
  "Alto · next entry 3.1+½ · 1½ beats left in the bar") — placeholder
  lorem hides layout truth.
- Buttons must be text-labelled (this user base does not guess icons);
  icons may accompany text.
- No new features. Rearranging, grouping, restyling only.

## Handoff

Return: the wireframe, 1–2 DALL·E concept images, and ideally the HTML
mockup. Claude Code translates the accepted direction into the live
Next.js/Tailwind app, keeping every behaviour listed above, and verifies
each function still works before merging.

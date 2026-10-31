# LHC Worship Prep - Claude Code Context

## Project Overview

**LHC Worship Prep** is a comprehensive worship preparation web application for Luther House Chapel (a Lutheran church). It helps manage song libraries, worship rosters, and service planning.

- **Stack**: Single-file HTML/CSS/JavaScript frontend + Supabase (Postgres) + Next.js API routes
- **Database**: Supabase
- **Deployment**: Vercel, automatically on push to `master`

> **The Google Apps Script backend is no longer live.** `server.gs` is still in
> the repository, but the deployed app never calls it: `callGAS()` rejects
> unless `google.script.run` exists, and on Vercel it never does. Treat
> `server.gs`, `callGAS()` and anything mentioning Google Sheets as history,
> not as the running system.

## Architecture

```
                    Vercel
  +--------------------+        +----------------------+
  |  dist/index.html   |        |  app/api/*           |
  |  the whole app     |------->|  Next.js routes      |
  |  (one file)        |        |  (PDF, Bible, ESV,   |
  +--------------------+        |   calendar, slides)  |
            |                   +----------------------+
            |  supabase-js / REST          |
            v                              v
  +-------------------------------------------------+
  |              Supabase (Postgres)                |
  |   songs, orders, order_items, roster, ...       |
  +-------------------------------------------------+
```

The browser talks to Supabase directly with the anon key, which is embedded in
the page. The `app/api/*` routes exist for the things a browser cannot do on
its own -- server-side Chrome rendering, third-party APIs with secret keys,
the calendar feed.

### Supabase Tables

The ones worth knowing; there are around 29 in all.

| Table | Purpose |
|-------|---------|
| `songs` | Song library: metadata, lyrics, youtube, attachments |
| `orders` | Worship orders (service and song orders) |
| `order_items` | Everything inside an order. `customizations` holds the lyric fields; `slides` holds what actually gets projected |
| `roster` | Monthly duty assignments, one row per role per date. **Also the readings**: role ids `reading1`, `psalm`, `reading2`, `gospel` |
| `roster_changes` | Change log behind the sidebar updates and cell history |
| `songbooks`, `songbook_entries` | Songbook documents and their pages |
| `song_voice_lines` | A choir arrangement's words. One row per part per passage. A LAYER over an ordinary song -- `songs.lyrics` is the song's own and is never generated from these |
| `song_recordings` | Practice takes. `line_id` attaches one to a `song_voice_lines` row; `section` (added 2026-10-30, `migrations/2026-10-30_song_recordings_section.sql`) names the whole section a take is of; both null means a run-through of the whole song. The part or category is the slot in the file name (`melody__<ts>.wav`), not a column; an instrument is a slot too (`instrumental` is Instrument 1, then `instrument-2`...), and how many a song offers is `songs.display_style.recInstruments` (default 3). Written by TWO recorders -- see gotcha 21 |
| `song_marks` | Remarks DRAWN on a song in the reading view (added 2026-10-30, `migrations/2026-10-30_song_marks.sql`). One row per stroke, kept against an anchor -- a moment of the score or a line of the lyrics -- as fractions of that anchor's box. See gotcha 31 |
| `liturgy_items`, `liturgy_folders`, `liturgy_occasion_data` | Liturgy library, its folders, per-occasion notes |
| `projection_media`, `projection_settings` | Backgrounds and projection state |
| `lectionary_readings` | Cached passage TEXT per date. NOT where the references live |

Run `npm run audit` to check the live data for duplicates, orphans, damaged
lyrics and slides with nothing on them.

## File Structure

```
/
|-- Index.html       # The entire app in one file (~96,000 lines)
|                    # Edit THIS one, then copy it to dist/
|-- dist/index.html  # What Vercel serves. Must stay byte-identical
|-- app/api/*        # Next.js routes: render-roster-pdf, bible-passage,
|                    # calendar, convert-pptx, parse-song-sheet, ...
|-- tools/           # Test harnesses and the data audit
|-- migrations/      # SQL for the Supabase schema
|-- server.gs        # LEGACY Apps Script backend. Not called by the
                     # deployed app. Kept for reference only.
```

**`Index.html` and `dist/index.html` must always match.** After every edit:

```bash
cp Index.html dist/index.html
```

The file is CRLF throughout. Patch it with Python using `newline=''` rather
than a bash heredoc, which quietly eats a level of backslashes.

## Main Features

### 1. Song Finder
- Search songs by title (prefix matching)
- Filter by Theme, Key, Style, Tempo, Season
- Multiple YouTube links per song
- Multiple document attachments per song
- Inline lyrics editor with section markers
- Chord transposition in preview
- Song statistics (most used, recent, newest)

### 2. Worship Roster
- Monthly calendar view with service dates
- Editable cells (double-click to edit)
- Role categories: Worship Enablers, Scripture, Communion, Music, Tech
- Liturgical day tracking with altar colors
- Context menu with change history
- WhatsApp sharing per service date
- CSV export

### 3. Worship Orders (Partial)
- Create orders from roster dates
- Template selection
- Full-screen presentation mode (planned)

## Known Issues (Fixed)

### Issue 1: Song Card Display Problems ✅ FIXED (2025-01-17)
**Symptoms**: Songs may not display correctly in the list view
**Root Causes Found**:
- `normalizeSong()` looked for `song.category` but backend returns `style`
- `normalizeSong()` looked for `song.usageCount` but backend returns `useCount`
- `youtube` field returned as array but `renderSongs()` called `.split()` on it
- `attachments` array from backend was not mapped

**Fixes Applied**:
1. Updated `normalizeSong()` (~line 1065) to:
   - Map `song.style || song.category` to `category`
   - Map `song.useCount || song.usageCount` to `useCount`
   - Handle `youtube` as array (convert string to array if needed)
   - Map `attachments` array from backend
2. Updated `renderSongs()` (~line 1207) to:
   - Use array `.filter()` instead of `.split()` for youtube links
   - Use `song.attachments` array instead of splitting `lyricsUrl`

### Issue 2: Roster Updates Not Loading in Sidebar ✅ FIXED (2025-01-17)
**Symptoms**: "Loading updates..." shows indefinitely or shows mock data
**Root Causes Found**:
- `renderRosterUpdates()` function was called but never defined
- HTML elements `songStatsSection`, `rosterUpdatesSection`, `songStatsContainer`, `rosterUpdatesContainer` were missing

**Fixes Applied**:
1. Added `window.renderRosterUpdates()` function (~line 1098) that:
   - Renders updates with duty, date, and change visualization
   - Shows relative timestamps (e.g., "2h ago")
   - Adds `data-role` and `data-date` attributes for highlighting
2. Added HTML sidebar sections (lines 9-46):
   - `songStatsSection` with stat tabs (Most Used, Recent, Newest)
   - `rosterUpdatesSection` with updates container
   - Supporting CSS for styling and animations
3. Added helper functions: `getTimeAgo()`, `escapeUpdateHtml()`

**Note**: the change log now lives in the Supabase table `roster_changes`. The old `setupRosterChangesSheet()` instruction no longer applies.

## Key Functions Reference

### Frontend (Index.html)

These signatures were checked against the source, not remembered.

```javascript
// View Management
setActiveView(viewId)              // Switch between views
renderSongs(forceShow)             // Render song list. NOTE: forceShow, not
                                   // hideEmptyState -- the sense is inverted
renderSongStats()                  // Render sidebar statistics

// Song Operations
openEditSongModal(song)            // Takes the song OBJECT, not an id.
                                   // Passing an id opens an EMPTY form and
                                   // says nothing -- every field comes out
                                   // blank, because it reads song.id off a
                                   // string.
saveEditSong()                     // Save edited song. Sends the WHOLE row,
                                   // lyrics included, carried through from
                                   // the loaded song.
saveNewSong()                      // Create new song
deleteSong()                       // Delete song

// Roster
RosterEngine.init()                // Initialize roster view
RosterEngine.render()              // Render roster table
RosterEngine.editCell(td)          // Edit a cell
RosterEngine.saveChanges(silent)   // Save; silent suppresses the toast

// Utilities
showToast(message, type, opts)     // opts carries the action button:
                                   // { actionLabel, onAction }. Any wrapper
                                   // around showToast MUST forward the third
                                   // argument -- one that did not silently
                                   // swallowed every Undo button it was given.
showLoader(show)                   // Show/hide loading indicator
```

### Data layer (Supabase, in Index.html)

Every read and write goes through one of the `SBQ_*` modules.

**Pick the narrowest write that does the job.** `update()` sends the whole
row, so any column missing from the object you hand it is blanked.

```javascript
// SBQ_SONGS -- 10 methods; these are the ones worth knowing
SBQ_SONGS.getAll()                       // Every song
SBQ_SONGS.create(song)                   // Insert
SBQ_SONGS.update(song)                   // FULL-ROW write. Columns missing
                                         // from the object are BLANKED.
                                         // Rarely what you want.
SBQ_SONGS.updateFields(id, patch)        // Partial write -- the safe default
SBQ_SONGS.updateLyrics(id, lyrics)       // Lyrics only, AND announces the
                                         // change so open orders pick it up.
                                         // Use this for lyrics, not update().
SBQ_SONGS.updateDisplayStyle(id, style)  // Appearance only
SBQ_SONGS.incrementUseCount(id)          // Bump use_count
SBQ_SONGS.delete(id)                     // Note: .delete, a reserved word --
                                         // call it as SBQ_SONGS.delete(id)

// SBQ_ROSTER -- 29 methods. Beyond the two below there is a lot:
// names, unavailability, duty settings, duty pairings, member metadata,
// merges, frequency and per-person history. Read the module before adding
// anything; most of what you want already exists.
SBQ_ROSTER.getData(month, year)          // month is 0-indexed
SBQ_ROSTER.saveEdits(edits)              // Save roster changes
SBQ_ROSTER.getUpdates()                  // Recent changes for the sidebar
SBQ_ROSTER.getCellHistory(roleId, date)  // Who changed one cell, and when
SBQ_ROSTER.confirmPending(month, year)   // Confirm auto-suggested picks
```

```javascript
// SBQ_READINGS -- the lectionary readings. Inside the LiturgyModule IIFE.
//
// There is ONE store for readings and it is the `roster`: four role rows
// per service date. `lectionary_readings` holds cached passage text, not
// references -- it had a single row while the roster held 142 readings,
// which is why the Liturgy page used to show four empty cards.
SBQ_READINGS.getRange(fromIso, toIso)    // { iso: { role: reference } }
SBQ_READINGS.getServiceMeta(from, to)    // { iso: { day, color, serviceType } }
SBQ_READINGS.getServiceDates(year)       // every date the roster knows
SBQ_READINGS.setReference(iso, slot, ref)// writes the roster + roster_changes
SBQ_READINGS.isoToRoster(iso)            // -> { year, month, serviceDate }
SBQ_READINGS.rosterToIso(svcDate, year)  // "Oct 4" + 2026 -> "2026-10-04"
```

```javascript
// SBQ_VOICE_LINES -- two-part (Women / Men) songs. The pure functions over
// the rows live in `window.lhcVoiceLines`, outside the module, so the
// harness can slice them.
SBQ_VOICE_LINES.forSong(songId)          // the lines, in reading order
SBQ_VOICE_LINES.replaceAll(songId, [])   // delete-then-insert. Writes ONLY
                                         // songs.voice_layout -- never the
                                         // song's lyrics. See gotcha 9.
SBQ_VOICE_LINES.clear(songId)            // drops the lines, keeps the lyrics

window.lhcVoiceLines.group(lines)        // rows -> paired display groups
window.lhcVoiceLines.html(lines, opts)   // the stacked score. Women above
                                         // men, time left to right.
                                         // opts.record adds a microphone per
                                         // line; opts.compact is the
                                         // songbook's print variant
window.lhcVoiceLines.leadIn(mine, other) // how far to indent a part that
                                         // joins mid-phrase, so its words
                                         // sit under the ones it shares
window.lhcVoiceLines.toPlainLyrics(lines)// a STARTING POINT for songs.lyrics,
                                         // used once at creation and never
                                         // again. Not a mirror.
window.lhcVoiceLines.fromLyrics(txt, f)  // seed a NEW arrangement from the
                                         // song's lyrics -- every line
                                         // unison, chord lines dropped. f is
                                         // the chord detector, injected.
window.lhcVoiceLines.toVoiceText(lines)  // the EDITOR source. Round-trips.
window.lhcVoiceLines.parseVoiceText(txt) // ...and back again
```

**A song with choir parts is an ORDINARY song.** The parts are a layer: they
get their own `Choir parts` tab in the preview and their own editor, and
every other tab, view and feature behaves exactly as it does for any other
song. `songs.lyrics` belongs to the song, is edited in the normal lyrics
editor, and is never written by anything in this module after the song is
created.

The parts editor (the Edit button while the `Choir parts` tab is open) is a
textarea over `toVoiceText` / `parseVoiceText`, with a live preview drawn by
the same `html()` the saved song uses. Its format:

```
[Verse 1]
1-3    Said the night wind to the little lamb   <- no prefix = unison
4      M: Do you see what I see
10     W: ~oh......                             <- ~ = held note
       M: A star a star                         <- no bars = SAME MOMENT
```

**The no-bars line is the placement rule.** A line without a bar spec joins
the group above it, which is what puts the two parts at the same moment.
Bars always open a new group. A part left out entirely rests.

Others follow the same shape: `SBQ_LITURGY`, `SBQ_SONGBOOKS`,
`SBQ_SB_ENTRIES`, `SBQ_THEMES`, `SBQ_PROJECTION`, `SBQ_LECTIONARY`,
`SBQ_OCC_DATA`, `SBQ_INBOX`.

### Legacy backend (server.gs) -- NOT in use

Listed only so it is recognised as dead on sight.

```javascript
// Songs
getSongs()                         // Get all songs
createSong(song)                   // Create new song
updateSong(song)                   // Update existing song
deleteSong(songId)                 // Delete song
updateSongLyrics(songId, lyrics)   // Update lyrics only

// Roster
getRosterData(month, year)         // Get roster for month
saveRosterEdits(editsArray)        // Save roster changes
getRosterUpdates()                 // Get recent changes for sidebar
getRosterHistory(roleId, date)     // Get cell history

// Utilities
getSheet_(name)                    // Get sheet by name
buildHeaderIndex_(headerRow)       // Map headers to indices
findColumn_(idx, possibleNames)    // Find column with fallbacks
```

## Data Structures

### Song Object
```javascript
{
  id: "song_1234567890",
  title: "Amazing Grace",
  artist: "John Newton",
  theme: "Grace, Salvation",           // Comma-separated
  key: "G",
  tempo: "Slow",
  category: "Traditional Hymn",        // Note: backend uses 'style'
  season: "All Seasons",
  youtube: ["https://youtube.com/..."], // Array of URLs
  attachments: [{url, name, type}],    // Array of objects
  lyricsUrl: "https://...",            // Legacy: first attachment URL
  lyrics: "[Verse 1]\nAmazing grace...",
  useCount: 5,
  lastUsed: "2025-01-15T...",
  dateAdded: "2024-06-01T...",
  lastEdited: "2025-01-10T..."
}
```

### Roster Edit Object
```javascript
{
  roleId: "preacher",
  date: "Jan 18",
  value: "Pastor Ashley",
  month: 0,                            // 0-indexed
  year: 2025,
  timestamp: "2025-01-17T..."
}
```

### Roster Update Object
```javascript
{
  duty: "Preacher",
  roleId: "preacher",
  serviceDate: "Jan 18",
  oldValue: "Rev Benedict",
  newValue: "Pastor Ashley",
  timestamp: "2025-01-17T...",
  prevTimestamp: "2025-01-03T..."
}
```

## CSS Design System

```css
/* Brand Colors */
--brand: #4a6da7;
--brand-2: #6b9ac4;
--ink: #1f2933;
--paper: #f4f5fb;
--accent: #f2e4c7;

/* Roster Theme */
--roster-teal: #14b8a6;
--roster-teal-dark: #0d9488;
--roster-teal-light: #2dd4bf;

/* Fonts */
font-family: "Lato" (body)
font-family: "Cinzel" (headings)
font-family: "Playfair Display" (accent)
font-family: "Poppins" (UI elements)
```

## Development Workflow

### Checks

```bash
npm run check     # offline test harnesses -- run before every commit
npm run audit     # reads the LIVE database and reports damaged data
npm run links     # opens every document and video link in the library
```

Three rings, and each is kept out of the one before it on purpose.

`npm run check` is offline and deterministic, so it can be run before every
commit without thinking. `npm run audit` talks to production, which is why it
is not in `check`. `npm run links` makes a request per link to Google, YouTube
and whatever chord sites the songs point at -- about seventy-five of them --
so it is not in `audit` either: an audit that is slow and chatty with other
people's servers is an audit people stop running.

Run `links` when it matters rather than routinely: before Advent, before a big
service, after somebody tidies the shared Drive folder. `npm run links -- docs`
or `-- videos` narrows it.

Harnesses in `tools/` slice the real function out of `Index.html` and run it
against `tools/minidom.js`. Each takes `--expect-broken` as a negative control,
so a new harness can be proved to fail on pre-fix source before it is trusted.

### Debugging Frontend
1. Open web app URL
2. Open browser DevTools (F12)
3. Check Console for errors
4. Check Network tab for failed requests
5. Use `console.log()` in JavaScript

### Making Changes

1. Edit `Index.html` (the real file, capital I).
2. `cp Index.html dist/index.html` -- the two must stay byte-identical.
3. `npm run check`.
4. Commit and push. Vercel deploys from `master` on push.

Schema changes go in `migrations/` and are applied in the Supabase SQL editor.
A table created there gets RLS with no policy, so it reads as EMPTY through
the anon key -- verify as `postgres`, not as the app.

## Future Development Plans

1. **Fix Current Issues**
   - Song card display problems
   - Roster updates loading

2. **Enhance Rosters Page**
   - Better change tracking UI
   - Bulk editing
   - Print-friendly view

3. **Enhance Songs Page**
   - Batch import from spreadsheet
   - SongSelect integration
   - Key/chord detection from lyrics

4. **Worship Orders**
   - Full Canva-designed template integration
   - Expandable liturgical sections
   - Full-screen presentation mode for projection
   - Song queue management

5. **Migration** -- DONE
   - ~~Move from Apps Script to standalone web app~~ now Supabase on Vercel
   - Still open: authentication / admin controls, and a public site with
     restricted editing. Today the anon key in the page is the only gate.

## Common Gotchas

1. **Field name mismatch**: Backend returns `style`, frontend expects `category` - `normalizeSong()` should handle this but verify mapping

2. **Roster keys**: an edit is keyed `roleId__Oct_4` -- the date string with
   spaces turned into underscores (`dateKeySuffix`). A deliberately empty cell
   holds the sentinel `__BLANK__`, which is NOT the same as missing.

3. **A month must be loaded before it can be read**: `STATE.rosterEdits` only
   holds months that were actually fetched. Anything needing the roster
   without the operator having opened it has to call `loadRosterData()` first
   -- skipping that is what once produced a shared card with every row blank.

4. **JSON in cells**: Multiple attachments/YouTube URLs stored as JSON strings in cells

5. **Readings are roster rows, not lectionary rows**: the Liturgy page is a
   front end onto `roster` role ids `reading1`/`psalm`/`reading2`/`gospel`.
   Writing one through `SBQ_READINGS.setReference` logs to `roster_changes`
   like any other roster edit, because that is what it is.

6. **Liturgy notes hide in unnamed folders**: `liturgy_occasion_data.data`
   holds notes both at `planningNotes` and inside `folders.<id>.planningNotes`,
   and those folder objects have NO name key. The Memories view reads both
   and ignores the folder layer; anything else that reads notes must do the
   same or it will silently show none.

7. **The anon key is in the page**, so running the app locally writes to REAL production data. There is no separate dev database.

8. **Full-row writes**: `SBQ_SONGS.update()` sends the whole row. Use `updateFields()` for a partial save, or the columns left out are blanked.

9. **The choir parts are a LAYER, not a different kind of song.**
   `songs.voice_layout = 'two-part'` means "this song also has a choir
   arrangement", nothing more. `songs.lyrics` is the song's own, edited
   normally, and `SBQ_VOICE_LINES.replaceAll` writes only the flag -- saving
   the choir parts must never rewrite the song's words. The two are separate
   documents and are allowed to differ, the way the congregation's words and
   the choir's parts differ in real life. Anything that makes a song with
   parts behave differently from any other song in the library is a bug.

10. **A rest is the absence of a row**, not a row with empty text. Pair rows
    by `sort_order`, never by bar number: bars are nullable and are for
    display. Drop the rest cell when rendering and the singing part slides
    into the other lane, on a page that still looks entirely normal --
    `tools/voice-lines-harness.js` exists for that one failure.

11. **The part label is the whole signal.** The "Women and men in
    together" banners were struck off the design and `annotate()` went
    with them: the coloured chip -- ALL, WOMEN, MEN -- already says who
    sings, and the banner said it twice. A silent part shows `(—)`
    rather than a rest mark, because most of them are echoes and a singer
    wants to see at a glance that the moment is not theirs.

12. **The parts are STACKED, not side by side.** Women above men, with time
    running left to right across both -- the arrangement a score uses.
    Columns put *who* on the horizontal axis, which is why reading them
    meant crossing the page. A part whose words are a word-suffix of the
    other's is indented by `leadIn()` so they sit under the words they
    share; a part that rests still keeps its line, or the singing part
    slides into the slot the reader has learnt is theirs.

13. **Recordings are keyed by song, not held one at a time.**
    `lhcVoiceRec` stores `_takes[songId][lineId]` and `_drafts[songId]`,
    and each container remembers its own song via `bind(root, songId)`.
    A songbook is a stack of songs; with a single store the second one to
    load wiped the first's takes. A take with `line_id` set is a
    reference for that line, one without is a draft of the whole song, and
    one read loads both.

14. **The songbook gives the arrangement its OWN pages**, after the song's
    lyrics, in all three paths (editing view, print, book mode). It does
    not render into a lyrics page, because `_sbComputePageStarts`
    paginates from the lyrics TEXT and would not break a rendered view at
    all. Those pages are read-only and carry no microphones. Book mode
    and print are synchronous, so the lines are prefetched into
    `_sbVoiceLines` on render -- a songbook that has not prefetched yet
    silently has no choir pages.

15. **A standalone songbook saves against a pseudo-order, and that row
    has to exist.** `order_items.order_id` is a foreign key into
    `orders`, and a standalone songbook writes under
    `standalone_<songbookId>`. For a long time the only thing creating
    that row was `_sbPersistStandaloneTemplate`, which returns early
    unless there is a projection deck worth keeping -- so any songbook
    nobody had used Project mode on silently saved NOTHING: every
    autosave came back 409 / 23503 and annotations, transposition,
    custom lyrics and notes were lost on reload.
    `_sbEnsureStandaloneOrder` now inserts it before the first write,
    with `ignoreDuplicates` so it can never write `template: {}` over a
    real projection deck.

16. **Which pages a song shows in a songbook is SHARED, not per-browser.**
    `choirView` (`choir` | `lyrics` | `both`, defaulting to `choir` when
    an arrangement exists) is written onto the songbooks row so every
    caroler opening it sees the same book. `sbAutoSave` carries it for an
    order-backed songbook; a STANDALONE one has no order, so that path
    returns early and `_sbPersistChoirView` writes the songbook row
    directly. Note every OTHER per-song setting in a standalone songbook
    still does not persist -- that is pre-existing, not fixed here.

17. **Grouping is the blank line.** Bars are displayed nowhere and the
    editor no longer carries them, so what used to be signalled by an
    EMPTY bar column is now signalled by whitespace you can see: lines
    that touch sound together, a blank line starts the next moment.
    Consequence, stated rather than left to be discovered: saving through
    the FULL editor clears `bar_start`/`bar_end`, and with them the
    "N bars -- both parts rest" notice for that song. A typed bar spec is
    still parsed, so text written under the old format still reads right.

18. **Editing one line uses `updateLine`, never `replaceAll`.**
    Double-clicking a line's words, or its part chip, writes one column of
    one row. `replaceAll` deletes and re-inserts everything, which clears
    the bars on rows nobody was editing. Inline edits preserve them; the
    full editor is for restructuring, and pays the price above.

19. **A practice take follows its line by its WORDS, not by its id.**
    `replaceAll` gives every row a new id, and `song_recordings.line_id`
    is `ON DELETE SET NULL`, so without help every take in a song comes
    loose on every save -- including a save where nothing was typed, which
    is how a song's line recordings silently became unlabelled drafts.
    `lhcVoiceLines.rematch` re-points them: same part, same place, same
    words; failing that, same part and same words if those pick out ONE
    line on each side. So a take survives a reorder, a bar change and an
    edit to any OTHER line, and detaches only when its own words change --
    deliberately, because it is a recording of the old words. Repeated
    words that all move (this carol has "Lis-ten to what I say" twice) are
    ambiguous and are left detached rather than guessed at.

20. **A songbook item's `id` is not a song id.** It is
    `sbsong_<songId>_<idx>` in a standalone songbook and
    `<songId>--<suffix>` in one built from a Worship Order. Neither
    survives being chopped at `--`. Use the item's `songId` field.

21. **TWO recorders write to `song_recordings`, and they must not count
    each other.** The choir view records one line at a time and sets
    `line_id`; the songbook panel records whole run-throughs and leaves it
    null. The panel LISTS both on purpose -- a singer wants every take for
    a song in one place -- so it marks the choir's with
    `data-line-take="1"` and counts only `.sb-rec-item:not([data-line-take])`
    against its limit of ten. Before that, ten line takes stopped the panel
    recording at all, and it only said so after the take had been sung.
    Deleting from either panel calls `lhcVoiceRec.forget(id)`, or the other
    one keeps drawing a chip whose file has gone.

22. **A view that holds recordings must be told when line ids change.**
    `lhcVoiceRec._loaded[songId]` is set once and both render paths are
    `if (loaded) paint else load().then(paint)`, so after `replaceAll`
    renumbers every row the store is about rows that no longer exist and
    the chips vanish -- the database correct, the screen wrong. `replaceAll`
    now drops that flag. Anything else that renumbers lines must too.

23. **Playback needs three ways back to rest, not one.** `onended` is the
    one everybody writes. A file that has gone fires `onerror`, and a
    blocked autoplay rejects `play()` while firing nothing at all -- miss
    either and the button sits on STOP over silence, with no way back.
    Closing a view calls `lhcVoiceRec.stopPlayback()`, because the audio
    element outlives the markup and the button that would have stopped it.

24. **A song in choir view still has a lyrics page, and it measures as
    zero.** `sbPage-<sid>` is rendered with `display:none` rather than
    skipped, because pagination, the annotation canvas and the lyrics
    editor all look it up by id. `getBoundingClientRect()` on it is all
    zeros, so anything positioning from it quietly resolves to the top of
    the book -- which is why tapping the first two songs in the contents
    appeared to do nothing while the other three worked. Go through
    `_sbVisiblePage(songId)`, which falls through to `sbChoirPage-<sid>`.

25. **The phone folds a song by CLIPPING it, never `display:none`.**
    `sbPaginateAll` places the A4 page-break markers from the live
    children's `offsetTop`, and inside a hidden page every one of those
    reads 0, so the markers pile up at the top of the song and nobody
    notices until the next time they print. `max-height:0; overflow:hidden`
    leaves the children laid out exactly where they were. Note
    `max-height` cannot shrink a border-box below its own padding, so the
    rule zeroes the sheet's 48px too. Fold state (`_sbFolded`) survives a
    re-render and is cleared on each open: closed by default, and an edit
    does not slam every other song shut.

26. **Which part a reader is shown is PER VIEWER; which pages are
    SHARED.** `choirView` (gotcha 16) goes on the songbooks row because
    everyone opening the book should get the same pages. The part filter
    -- the chips above the score, `lhcVoiceLines.filterPart` and
    `localStorage.lhc_sb_mypart` -- is the opposite: which of those lines
    you sing is a property of you, not of the book, and it reaches
    nobody else. Filtering keeps unison lines (they are everybody's) and
    the chosen part's RESTS, because `(—)` is how a singer sees the
    moment is not theirs; dropping them makes the song appear to skip.
    It filters by CLASS on the rows, never by re-rendering: the score
    carries open editors, recording chips and the reader's place in it.

27. **The songbook control bar lays out at ~357px on a phone, not
    794px.** `sbApplyZoom` counter-scales it by 1/zoom so its buttons
    stay finger-sized, which means its layout box is a phone's width
    while everything in it is at desktop size. Consequences, all of them
    found the hard way: it must wrap like a phone (clipping it cut
    Liturgist Notes and Reset Layout in half); only the four controls you
    use while singing stay out, the rest behind `.sb-ctrl-more`; and
    **`position: fixed` inside it does not mean the viewport** -- the
    transform is its containing block, which put the media badge's menu
    at y=1150 for a pill at y=609. Anchor to the bar, which the phone
    sheet keeps `position: relative`.

28. **`dblclick` is not a gesture a phone has.** The page declares
    `user-scalable=yes, maximum-scale=4`, so on iOS a double tap is a
    zoom and Safari keeps it — `ondblclick` never fires. Every roster
    cell opened its editor from `ondblclick` alone while the touch shim
    that existed (`_bindDoubleTap`, once `_bindScriptureTap`) was wired
    to the four scripture cells only, so a PIC on an iPhone could sign
    in, see the roster, and find that no duty cell answered. It failed
    silently and totally: no error, no toast, and the PIC concludes they
    have been locked out. Anything reachable only by `dblclick`,
    `:hover`, right-click or a <10px control is unreachable on the
    phones this app is mostly used on. `tools/roster-touch-edit-harness.js`
    guards the binding — and the check that matters is "is there a cell
    a double tap cannot reach", not "does this cell work".

29. **`window.STATE` is NOT the roster module's `STATE`.** The module
    closed over its own. Setting `window.STATE.picMode` from the console
    changes nothing the roster reads, so a console probe of anything
    behind that gate silently proves nothing. `RosterEngine.updatePicUI()`
    is the accessor that settles it: it reads the module's `STATE` and
    stamps `body.pic-mode`.

30. **A section take is keyed by its section's NAME.** `song_recordings.section`
    holds the text of the badge it was recorded under, and nothing re-points
    it when the lines are rewritten -- `rematch` follows LINE takes by their
    words, and a section has no words of its own. `replaceAll` carries the
    takes of ONE renamed section along (`lhcVoiceLines.sectionRename`: one
    name gone, one name new); two renamed in the same save cannot be told
    apart and stay under the old name, listed in Practice Tracks but on no
    badge. Until the column exists the carry is a write that fails quietly.

31. **A drawn remark is anchored to WORDS, not to a page.** `song_marks`
    keeps each stroke (tool `w`) as offsets from its anchor's origin in
    widths of the word or chord, BOTH ways, so the drawing scales as a
    whole and its shape is exact (the desk sets the choir's words in a
    monospace face and the phone in a proportional one, so the word is
    narrower there and the drawing shrinks with it). Tool `em`, the round
    before, was widths across and ems down and drew rings as eggs; it is
    still read that way, as `pen` (fractions of the box) is read as that.
    Strokes drawn within eight seconds and 40px of each other are ONE
    DRAWING (`_sbmMarkAnchorFor`): they share the first stroke's anchor,
    with `@g<id>` on the end of the key naming the drawing, so a word's
    letters stay a word and are fitted by one scale. A closed stroke is
    anchored to the token it RINGS, not to whatever lies nearest its
    centre. An open stroke of three ems or more whose ends each reach a
    token -- the nearest chord or word to that end in ANY row, because an
    arrow's tip stops short of what it points at, often just inside the
    top of the row under a chord -- the two in different rows, is kept
    BETWEEN them
    (`keyA>keyB@g..`): along the line between their centres, in lengths
    of it, so an arrow from a word to a chord runs from that word to that
    chord on every screen, at whatever angle and distance they sit there;
    its head, drawn next and lying along the shaft, joins it, while
    handwriting beside the shaft goes to the nearer end. On paper a link
    is an SVG over the whole block that the printed page's own script
    (`_sbMarkLinkPrintJs`) lays between its two named ends. Strokes that
    would still run off the card -- handwriting in the empty room a
    desk's row has to the right of its words -- are shrunk about their
    anchor until they fit, all of one drawing's strokes by one scale
    (`_sbmMarkFit`), never below 0.3. A section sung twice under one name
    gets `#2` on its second run's key (`s:2nd CHORUS#2|3`). The moment a
    stroke lands, what it is attached to GLOWS for about two seconds with
    a caption ("On the chord F", "From “story” · 2nd Part to the chord F"),
    drawn on the canvas from the same frame every screen places it by
    (`_sbmGlowDraw`); a repaint during a stroke redraws the stroke being
    drawn, or the fading glow would wipe it.
    The anchor is the NEAREST chord or word to the stroke's centre, among
    the words of the row the centre is in: a chord (`s:Verse 1|3/c:2`, the
    third chord token of that moment), a word of one part's row
    (`/w:men:4`); failing any word, the row (`/r:men`) or the moment itself
    (`s:<section>|<n>`, the margin's count); on a lyrics card a word of a
    line (`l:12/w:4`) or the line (`l:<index>`, a block child of
    `#sbmLyrics`). A token's origin is its centre, a row's or block's its
    top left. Strokes from before (tool `pen`) are read as fractions of
    their box and look stretched on a phone; redraw them. Chords and words are counted as tokens
    of the TEXT, so a desk's chord row and a phone's chords riding on the
    words count the same, and a word found by Range on either. A moment's
    box was tried first and is wrong: on a desk it runs past the words to
    the buttons, on a phone the words wrap, so fractions of it put a ring
    round one chord over somebody else's words. The canvas over each card
    is repainted from the live boxes (`_sbmMarkBox`); a stroke centred in
    a gap belongs to the nearest line above or below; the table is probed
    once per page -- without it there is no Draw chip at all; and the A4
    Page view keeps its own, older, page-coordinate annotations. PRINT
    carries the drawn remarks when the print dialog's box is ticked: as
    SVG stretched over the block or moment that holds their words
    (`_sbMarkSvg`, a 1x1 viewBox with `non-scaling-stroke`). A printed
    lyrics block may hold several source lines, so a mark is squeezed into
    its line's share of the block; a song shown as rich lyrics has no
    source lines to match and its lyric marks stay on the screen.

32. **The reading view learns of other devices' changes by nudge and by
    poll.** `sbm-live-<songbook>` is a Supabase BROADCAST channel (no
    publication to set up, like the songbook's `sb-<orderId>` channel):
    a device that writes a mark, a take or the lines sends `changed`, and
    every 30s while shown -- and the moment the tab is shown again -- each
    device compares a fingerprint (count + newest of `song_marks`,
    `song_recordings`, `song_voice_lines`; a hash of the songs' rows and
    of the songbook row) with the one it last drew. Marks and takes are
    reloaded quietly in place; lines, words, settings and the book raise
    the pulsing banner, whose Refresh refetches the songs' rows and lines
    and opens the book again. A device's OWN write (`_sbmLiveOwnAt`) is
    adopted, not announced to itself; a change undone before the refresh
    takes the banner away with it; Not now adopts the state as seen.

33. **The Phone view is a SECOND COPY of the whole app, on production
    data, and the head of the page makes it read-only.** In Draw mode on
    a desk, "Phone view" opens `?sbmPreview=<songbook key>&sbmSong=...` in
    a panel beside the song (`_sbmPhone*`), drawn at a phone's or tablet's
    true width and scaled to fit, so the phone's layout is the phone's
    layout, not an imitation. That copy runs everything -- its boot, its
    autosaves, `WO.saveImmediately` on pagehide (fired when the panel
    closes), presence on `sb-presence-*`, edit locks -- so before any of
    the app runs, the script after the supabase-js tag
    (`window.__SBM_PREVIEW`) wraps `createClient`: insert / upsert /
    update / delete / rpc / storage writes return a chainable error that
    sends nothing, channels listen but `send`/`track`/`untrack` do
    nothing; `fetch` lets only GET and HEAD out (plus storage list/sign);
    `BroadcastChannel.postMessage` and `sendBeacon` are dead; and
    `localStorage`/`sessionStorage` writes go to memory, so the copy reads
    the desk's settings and never changes them. `tools/songbook-phone-harness.js`
    proves each. The desk pushes what to show (`WO.sbmPhoneApply`, as
    JSON): the song (matched by id, else by which copy of which song --
    an order's item ids are its own), its fields, lines, marks and the
    part chosen, and each new stroke's anchor, which it scrolls to and
    glows. Inside, `#sbmRoot *` takes no pointer events (the wheel falls
    through to the scroller) and no scrollbar is drawn, because a desk
    scrollbar steals width a phone's does not and every line would wrap
    early. Anything new that WRITES must be reachable only through
    `_supabase`/`fetch`, or it must check `window.__SBM_PREVIEW` itself.

## Quick Commands for Claude Code

```bash
# Find a function (never cat the whole file -- it is ~96,000 lines)
grep -n "function renderSongs" Index.html
sed -n '1200,1260p' Index.html

# Check the two copies have not drifted apart
cmp Index.html dist/index.html

# Tests, then the live data
npm run check
npm run audit
```

## Contact & Resources

- **Live app**: https://lhc-prep-tool.vercel.app
- **Repository**: https://github.com/jermaineaaron1/LHC-Prep-Tool
- **Database**: Supabase project dashboard (URL and anon key are in `Index.html`)
- **Legacy Apps Script** (not in use): https://script.google.com

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
| `song_recordings` | Practice takes. `line_id` attaches one to a `song_voice_lines` row; null means a take for the whole song. Written by TWO recorders -- see gotcha 21 |
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

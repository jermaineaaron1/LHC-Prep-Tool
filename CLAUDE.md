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
| `roster` | Monthly duty assignments, one row per role per date |
| `roster_changes` | Change log behind the sidebar updates and cell history |
| `songbooks`, `songbook_entries` | Songbook documents and their pages |
| `liturgy_items`, `liturgy_folders`, `liturgy_occasion_data` | Liturgy library, its folders, per-occasion notes |
| `projection_media`, `projection_settings` | Backgrounds and projection state |
| `lectionary_readings` | Psalm / Gospel / reading references per date |

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
```

`npm run check` is offline and deterministic. `npm run audit` talks to
production, which is why it is deliberately kept out of `check`.

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

5. **The anon key is in the page**, so running the app locally writes to REAL production data. There is no separate dev database.

6. **Full-row writes**: `SBQ_SONGS.update()` sends the whole row. Use `updateFields()` for a partial save, or the columns left out are blanked.

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

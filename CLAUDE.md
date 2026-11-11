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
| `song_recordings` | Practice takes. `line_id` attaches one to a `song_voice_lines` row; `section` (added 2026-10-30, `migrations/2026-10-30_song_recordings_section.sql`) names the whole section a take is of; both null means a run-through of the whole song. The part or category is the slot in the file name (`melody__<ts>.wav`), not a column; an instrument is a slot too (`instrumental` is Instrument 1, then `instrument-2`...), and how many a song offers is `songs.display_style.recInstruments` (default 3, up to 30), each named in `display_style.recInstrumentNames` (by slot: Piano, Guitar...). Written by TWO recorders -- see gotcha 21. `order_id` is the service (or songbook) a take was made for, written by every recorder since 2026-11-08: plain text, NO foreign key, so deleting a service leaves its takes (gotcha 72) |
| `song_marks` | Remarks DRAWN on a song in the reading view (added 2026-10-30, `migrations/2026-10-30_song_marks.sql`). One row per stroke, kept against an anchor -- a moment of the score or a line of the lyrics -- as fractions of that anchor's box. See gotcha 31. `version_id` (added by `migrations/2026-11-01_song_versions.sql`) says which version of the song a remark is on; null is Standard. `owner`, `owner_name`, `part`, `shared` (`migrations/2026-11-01_song_marks_layers.sql`) say whose it is and whether others see it; see gotcha 50 |
| `song_versions` | Versions of a song: a name, a key (`transpose_steps`), the words exactly as the service that saved it had them (`lyrics`, `rich_lyrics`). A service's copy of a song names the one it sings in `order_items.customizations.versionId`. `made_from = 'library'` marks an EARLIER MAIN VERSION: the library song as it was before it was replaced, restorable. See gotcha 46 |
| `liturgy_items`, `liturgy_folders`, `liturgy_occasion_data` | Liturgy library, its folders, per-occasion notes |
| `liturgy_occ_folders` | The Liturgy Library's YEAR folders, per occasion (`occasion_id`, `name` -- "2026"); a library item names one in `occasionFolderId`. A save from the Liturgy page deletes only folders removed on that device. See gotcha 51 |
| `projection_media`, `projection_settings` | Backgrounds and projection state |
| `lectionary_readings` | Cached passage TEXT per date. NOT where the references live |
| `saved_medleys` | Medleys kept to be sung again: `songs` [{ songId, title, transposeSteps }] in sung order, one row per sequence (`song_key`, the ids joined by `>`). `migrations/2026-11-01_saved_medleys.sql`. See gotcha 42 |
| `bulletins` | The weekly Sunday bulletin, one row per service (`service_date` + `year`, uniquely indexed -- the upsert needs it). `data` holds ONLY what somebody types: verse, prayer, `notices[]`, `giving.entries[]` (one per purpose: what it is for, account name, bank, number, and `qr`, a data: image the congregation scans -- an older bulletin's two loose `giving.lines` are carried over on open), attendance, `offering[]`, `contacts[]`, `manual` (Acolyte and Flower Offering) and `hidden`. **No duty is stored** -- both Sundays' duties and the four readings are read from `roster` on every open. `migrations/2026-11-10_bulletins.sql`. See gotchas 76-77 |
| `service_liturgies` | A whole order of worship kept for an occasion (`occasion_id`: the Liturgy page's ids, `pentecost`...) and a `year`; `data` holds its sections, items, songs and notes; `order_type` is the kind of service it is for. `migrations/2026-11-01_service_liturgies.sql`. See gotcha 51 |
| `drawer_prefs` | The parts of the band a drawer plays or sings (Drawings > For a group), kept with their NAME: `owner` (folded, as `song_marks.owner`), `owner_name`, `parts` text[]. `migrations/2026-11-07_drawer_prefs.sql`. See gotcha 50 |

Run `npm run audit` to check the live data for duplicates, orphans, damaged
lyrics and slides with nothing on them.

## File Structure

```
/
|-- Index.html       # The entire app in one file (~113,000 lines)
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

### 1. Songs / Songbooks (once "Song Finder")
- Search songs by the FIRST letters of the title, and only those
  (`_sfTitleStarts`, used by the list and the suggestions alike); theme,
  feel, season and scripture are filters of their own. A five-second hint
  under the box shows how, as the page opens (`_sfSearchHint`). Gotcha 70.
- The Songbooks tab lists each book as one row, its buttons on the name's
  line (a row of six -- one of My Songbooks -- puts them under the name on
  a narrow phone, `.sb-list-item--many`). The home cards are each faintly
  their own colour: Songs / Songbooks green, the Roster blue, the Liturgy
  Library purple. `tools/home-look-harness.js` checks both.
- Filter by Theme, Key, Style, Tempo, Season
- Multiple YouTube links per song
- Multiple document attachments per song
- Inline lyrics editor with section markers
- Chord transposition in preview
- Song statistics (most used, recent, newest)

### 2. Sunday Bulletin

- The weekly bulletin, as one A4 sheet edited in place (Home > Sunday
  Bulletin, `bulletinView`, the `BLT` module).
- The masthead is FIXED furniture -- the gold circle, the grey sweep, the
  Luther Rose (`public/lhc-luther-rose.png`), the church name, address and
  service time. Everything below it is typed on the sheet itself.
- The duty table is the roster: this Sunday and the next, side by side,
  seventeen rows read live from `roster` every time the page opens.
- Typed: theme verse, prayer of the day, numbered announcements, online
  giving, attendance figures, offering lines, the two footer contacts, and
  the two duties the roster has no role for (Acolyte, Flower Offering).
  Every one of those lists can be added to and taken from; **Rows** in the
  toolbar says which duty rows the bulletin carries.
- A new bulletin opens from the most recent one, because the giving
  details, contacts and theme verse are the same most weeks.
- Out: **Print**, **PDF**, and **Share**, which sends the PDF itself to
  WhatsApp through `navigator.share({files})` where the device allows it.
  Drawn on the device (html-to-image into jsPDF) -- never through
  `/api/render-roster-pdf`, whose quota is the church's and nearly spent.

### 3. Worship Roster
- Monthly calendar view with service dates
- Editable cells (double-click to edit)
- Role categories: Worship Enablers, Scripture, Communion, Music, Tech
- Liturgical day tracking with altar colors
- Context menu with change history
- WhatsApp sharing per service date
- CSV export
- **Worship Enablers** (the Team chip): All Enablers, By Duty, By Individual,
  Calendar, Duplicates. Anyone -- not only a PIC -- adds a missing phone or
  email on a card (+ Add) or changes one (the pen, asked first). **Calendar**
  is a month: the roster's services with their liturgical day and altar
  colour, and the duties of the name(s) chosen (kept on the device), then
  the same services as a list, then each name's contacts and calendar link
  (Add to Google Calendar, Apple / Outlook, copy, send). **Duty card** opens
  the WhatsApp message to check before sending, a month at a time. See
  gotcha 68.

### 4. Worship Orders
- Create orders from roster dates, from a template (Traditional, Contemporary, Special)
- The Orders menu lists the latest ten orders, the most recently edited first
  (`_woOrderTime`); **See more** lists the rest under an Archived heading
  (`WO_ORDERS_SHOWN`, `_woShowArchive`). A search looks through all of them.
  Each card keeps its index into the whole `savedOrders`, which every handler
  on it uses -- never its place on screen.
- One order, three numbered steps, as tabs under the editor header, each in a
  colour of its own on the order's landing and on the tabs' numbers: the
  builder green, the Songbook blue, LCD Projection a light red:
  1. **Liturgy Builder** (order of worship) -- the sections, and in each the
     songs, liturgy, readings and the liturgist's notes, as a word processor.
     On a desk, three columns: the Order Outline (numbered sections, drag a
     grip to reorder), the page under a formatting bar (Speaker L:/P:/C:/All:,
     size, bold, italic, underline, colour), and Add to Order (the library by
     category, your own items, the service templates; click to add where you
     are, or drag onto a section). The ribbon's **Add Item** holds what
     there is to add -- a song, liturgy (the library, what suits the section,
     or your own), a reading, a prayer, a sacrament, a text slide, a slide
     break at the cursor, a note, a new section (a blank one, the type's
     missing sections back, or one from a template -- `_lbdNewSectionItems`,
     once the Templates button's) -- and no row of buttons sits beside it any
     more (2026-11-08); the formatting bar keeps its own Slide break. Sections are
     heading bars with move, duplicate and remove; the words are typed on the
     page with "Slide 2, 3" marks between slides (Ctrl/Shift+Enter breaks a
     slide, Backspace at its start joins it back); notes are margin
     comments. On a phone it works like Google Docs: a bottom bar with Add
     in the middle, the outline and the library as sheets from below, and
     the formatting keys over the keyboard; its top bar is the section (at
     most half the bar) then WhatsApp (the order's link), Save (green), Load
     (light blue), undo and redo (`_lbdMbarHtml`, 2026-11-09). Load asks:
     "Load Liturgy for <occasion>" (the ones SAVED in the Liturgy Library)
     or "Load Liturgy from Past Services". Compact shows one line per part;
     Full text shows every word. Import takes a Word .docx or text pasted
     from Word: headings become sections, the words under them liturgy.
     **Save** (green) and **Load** (light blue), two ribbon buttons since
     2026-11-09 (More / Add on a phone: Save liturgy, Load liturgy, Past
     services): Save This Liturgy keeps the whole liturgy for its occasion of
     the church year and a year, and a later year's order loads it whole,
     then saves over it or keeps a copy; Load offers "Load Liturgy for <this
     service's occasion>" (Contemporary Service, Traditional Service, Advent,
     Maundy Thursday...) and "Load Liturgy from Past Services", an earlier
     liturgist's order; the window filters by service (Good Friday,
     Traditional, Contemporary...) and year (gotcha 51). The Templates button
     is gone: it opened the same window, and its section tools are in Add
     Item › New section.
     A liturgy saved for a year is filed in the Liturgy Library: the
     occasion gets that year's folder if it has none, and its page lists
     the whole liturgies kept for it, a year folder those of its year.
     Add Item's Liturgy opens a menu: the library, what suits
     this section, or your own written as liturgy (kept in the Liturgy Book's
     liturgy style); Text is a plain slide for this service only. Add to
     Order starts closed (`_lbdLibOn` false; a saved "open" counts only from
     `libV` 2), and Shift/Ctrl+Enter starts a new slide at the cursor -- in a
     text slide, a new text slide -- which the leave-a-slide tidy now spares
     while the cursor is in it (`_lbdFocusIn`). Add a song has **New song**
     (in its head, and offered with the search as its title when nothing
     matches): the library's Add Song form opens, and once it is saved the
     song goes into the section Add a song was opened on, after the part the
     cursor was on (`_lbdNewSong`). The hand-over is `window._lhcNewSongThen`,
     taken by `saveNewSong` before the form closes and run once `loadSongs`
     has the song; `closeModal('addSongModal')` forgets it, so a cancelled form
     adds nothing and a song saved later from the Songs page goes nowhere
     else, and it adds only while the same order is still in the builder. A phone's keyboard has no
     Shift+Enter, so on a touch screen (`_lbdTouchKeys`: no hover, a coarse
     pointer) plain Enter is the slide break, and a line is the New line key
     (first in the keys over the keyboard, beside Slide break; on the
     formatting bar too, shown only on a touch screen) or Shift+Enter with a
     keyboard attached. Android keyboards often send Enter and Backspace to
     keydown as key 229; what they would do is caught again at `beforeinput`
     (`_lbdOnBeforeInput`: `insertParagraph` breaks the slide,
     `deleteContentBackward` at a slide's start joins it), never twice for
     one key (`_lbdKeyDoneAt`). **WhatsApp** (ribbon, after Save and Load; a
     phone's More; the Liturgy Book's Share) sends a link to the order of
     service -- the title, the date and a link that opens the order in the
     Liturgy Builder (`?order=<id>&view=builder`), so whoever opens it sees
     the order as it is then, not as it was sent -- or every word of the
     liturgy: each section with its songs in the key sung, its readings by
     reference and its liturgy word for word, built by the pure
     `_lbdShareMessage` from `_lbdShareSections` (the page's order), with a
     link that opens its Liturgy Book (`&view=liturgy`).
     A waiting autosave goes first, so the link opens what was shared. Over
     3,500 characters the message is not put in a wa.me link: a phone's share
     sheet takes it whole, and a desk copies it and opens WhatsApp to paste
     (`_lbdSendWhatsApp`). **Export** (beside it; a phone's More) downloads
     the whole liturgy as a PDF or a Word .docx, both from one model
     (`_lbdExportModel`, over `_lbdSecOrder`, the page's order): the title,
     date and occasion, each section a heading, and in it its songs (their
     words, chords taken out), readings (verse numbers raised), liturgy and
     text, with the liturgist's notes. Who speaks is set in its own column and
     carries on to the lines after, into the next slide, until somebody else
     is named -- except into a slide that names its own speakers, and never
     from an empty "C :" (`_lbdExportParas`); the people's lines are bold. The
     PDF is laid out line by line with jsPDF's Times (`_lbdExportPdf`); its
     fonts know only the Windows Latin set, so `_lbdPdfText` changes or drops
     the rest. The .docx is built with JSZip (`_lbdExportDocx`) on Word's own
     Heading 1 / Heading 2, A4, with a numbered footer; Word rejects a
     formatting block whose settings are out of the schema's order, and the
     harness checks every one. Edits the order's data directly; see gotchas 34-37,
     39-41 and 45.
  2. **Songbook** (music team) -- every song as the service runs: key, words
     and chords, markings, recordings, links. It opens over whichever step
     is showing and closes back to it. It also has the order's **inbox**
     (links and files shared to the service from a phone's share sheet, the
     share picker, or pasted -- put each on a song), **Add a song** (into a
     section), **Move to section** (More: `sbmMoveToSectionPick`, the
     Builder's own move through `_woSongsChange`; a medley moves as one; a
     section that already sings the song, or an open LCD schedule, refuses), each song's links hidden for this service or removed,
     **medleys** (gotchas 42-44; a standalone songbook has them too), and
     **versions** of a song -- a key, words and drawings a later service can
     sing it with, saved from the Versions sheet's "Save as a version", and
     "Save as the main song", which writes the service's way into the song
     library and keeps what it replaced as an earlier main song, restorable
     there or from the song's History in the song library -- and Share ›
     This song, a link that opens the book at that song (gotchas 46, 72).
     Drawings are everyone's unless their drawer says otherwise; the
     **Drawings** tile (after Book Mode) lists every drawing kept on the
     song -- yours, everyone's, each group's and other people's private
     ones, which stay off until switched on -- with Show all and Only mine
     (gotcha 50). The key's flat and sharp are large blue buttons, and a
     key moved on one device redraws every other device's view at once, with
     a word saying so; the A- / 100% / A+ size buttons are gone (a Font
     picker sits where Reset Layout was, gotcha 74), and so is
     the notice under a song sung twice. A gold floater at the foot of the
     screen points to the words while they are out of sight below and goes
     once you are there; a double-tap (or double-click) anywhere on the
     words draws; and Practice Tracks' timeline is dragged to any point of a
     take, with ten seconds back and on (gotcha 69). The choir score reads like a chord sheet: the words and
     the chords over them as Chords + Lyrics sets them, no rules between
     moments, a part's label only where that part takes over, and a purple
     bar joining the parts that sing at the same time (gotcha 59).
     Every line of it with words records on its own: at its
     end a takes badge and a microphone, the badge listing that line's takes
     to play or delete, with an audio file to add (gotcha 52). Between the
     sections run the band's moments -- an Intro, the way into each section,
     an Ending -- each recorded one instrument at a time, by name, as many
     as the song needs (gotcha 53). The song's tiles are one row -- Record,
     Tracks, YouTube, Book Mode, Drawings, Edit, a purple Save / Load
     Versions, and More at its end; Links, Browse online and Medley are in
     More, every icon there in a colour of its own (gotchas 69, 72). A song's videos are the red YouTube tile
     (`sbmVideos`: one plays at once, several are listed; a song with none is
     offered Add a link), not a chip in its header. A green
     WhatsApp button -- first of the desk top bar's buttons, before the
     Inbox; under the book's name on a phone -- shares the whole songbook at
     once (`sbShareWhatsApp`): each section by its name alone, as the builder
     names it (`_sbmSectionLabel(song, true)`), every song its own number --
     a medley's under a `_Medley_` line, with a gap after it -- the
     Songbook's link, a blank line, then the "Song Playlist (YouTube)"
     (gotcha 57); one song is under Share.
     The reading view's modes are Choir (the score alone), Lyrics (the words
     without chords), Chords + Lyrics (`'both'`: the words with chords, no
     score -- it once had the score under them) and 2 Col. Choir is offered
     for EVERY song: one with no parts yet shows its words with every line
     sung by All (`lhcVoiceLines.fromLyrics`), and Set up choir parts
     (`sbmChoirStart`) writes that as its arrangement through the parts
     editor's own save (`_sbVoiceWrite`) and shows it in Choir; Edit there is
     Edit Parts. The printed pages keep their own Choir / Lyrics / Both
     (`_sbChoirViewToggleHtml`), where Both is both sets of pages.
     **A few lines transposed on their own** (a last verse up a tone): select
     them in the words, and a bar at the bottom (`#sbmXpSel`) moves their
     chords a semitone a press (`sbmXpSel`), with Undo and Done; the lines
     stay tinted (`.sbm-xp-on`), since a phone's selection does not outlive the
     redraw. It is the COPY's words that change (`_sbmXpShift` on the chord
     lines, saved through `_sbSetCopyWords`, the Lyrics editor's own save), so
     the whole-song key still moves everything on top, and print, other devices
     and the Lyrics editor all see it. The lines are read from what the card
     is drawn from -- its `richLyrics` when it has them, else its words --
     one block per line (`_sbmXpSource`); a card that is not refuses rather
     than guesses. Lyrics card only: the choir score's chords are the song's.
     A take's delete asks in the app's own look (`window.lhcAskDelete`,
     z-index 10060: the take, its part, time and length, Keep it or a red
     Delete take), never the browser's `confirm()`.
     A song the service sings twice is listed in both sections, each copy
     its own, and **Own drawings** is in the Drawings window while the
     copies share their drawings (gotcha 55). **Versions** (the purple
     Save / Load Versions tile, the "Past versions" badge under the song's
     title, and More; it was Earlier versions and Versions of this song,
     two sheets) is one sheet: This
     service with Save as a version / Save as the main song, then Past
     versions newest first -- the main song, this service's other copies,
     earlier services with their drawings and recordings, saved versions,
     earlier main songs -- each a row to open read-only and a Use button,
     then the medleys, with Save this medley. A name saved again replaces
     the version of that name, after a warning toast. A song new to a service that
     was sung before pulses its badge, and a finger shows where to tap
     (once a device); every take says which service it was made for,
     another service's marked (gotcha 72).
     **Book Mode** (a tile after YouTube, `sbmBookMode`) opens the songbook
     full screen at the song in front. A double-click -- a double tap on a
     phone -- on a song's words starts drawing, the song view's own drawings
     shown and drawn on (gotcha 64); holding the words about half a second
     makes the whole song a notepad. Holding a CHOIR page does the same for
     the arrangement: every line with who sings it ("Women:", "Melody:",
     "Vocals 2:" -- typed labels are recognised), its chords over it in the
     key sung, the lines sung at once on a purple bar, and Sing together /
     Take turns on the bar for the lines highlighted (gotcha 67). **Type** (a chip beside Draw on the
     lyrics card, `sbmType`) does the same in the song view: type straight
     onto the words and chords, Enter saves, Shift+Enter or the bar's New
     line starts a line, Esc puts it back (gotcha 65) -- no Edit window.
  3. **LCD Projection** -- the slides, drawn from the same data. The rail
     down the left is chunked: a heading row per song, liturgy item, reading
     and presentation, and under it a coloured heading wherever a part
     begins -- a song's own `[Verse 1]` markers, carried down the slides
     that finish the verse, or a heading the operator types on any slide
     (the tag on a row; the pen and cross on the heading). Never projected.
     See gotcha 73.
- An upcoming order fills in the roster's readings it is missing when it is
  opened in the builder or LCD Projection, and remembers what it had, so a
  reading taken out stays out (gotcha 48).
- **Song Order**, step 2 until November 2026, is retired: it is under More
  as "Song Order (old view)" with a note pointing to the Songbook, and its
  code is to be deleted once nobody has missed it for a few services.
- The **Liturgy Book** (More menu, or the builder's button) is the builder's
  printable form and edits the same order.
- Notes: per section (`sectionLayout[i].notes`), per song (`liturgistNotes`)
  and for the whole service (`template.serviceNotes`). Never projected; shown
  in the builder, the Liturgy Book, the Songbook index and the LCD rail.

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
                                   // { action, onAction, duration }. Any wrapper
                                   // around showToast MUST forward the third
                                   // argument -- one that did not silently
                                   // swallowed every Undo button it was given.
showLoader(show)                   // Show/hide loading indicator

// Worship Orders (inside the WO module; a few are exported on WO)
WO.selectOrder(mode)               // 'liturgy' | 'service' -- steps 1 and 3.
                                   // 'liturgy' takes the LCD schedule's DOM
                                   // down (gotcha 35). 'songbook' opens step
                                   // 2 (WO.openSongbook) over the step showing;
                                   // 'song' is the retired Song Order list
WO.openSongbookInbox()             // where a shared link lands: takes
                                   // window._pendingShareItem into the order's
                                   // inbox and opens the Songbook on it (gotcha 43)
_woInboxAdd(ps)                    // into currentOrderData.mediaLinks ONCE
                                   // (_woInboxKey), saved at once
_woAttachInboxItem(item, song)     // an inbox link onto a song's customYoutube /
                                   // customDocs, marked with item.id. Caller saves
_woMedleys()                       // the order's medleys, checked against the
                                   // order and in sung order (gotcha 42)
_woSaveMedley(id, ids)             // make, change or (ids < 2) break up one
_woRunWithMedleys(list, medleys)   // a song list with each medley together
_woStepInSeq / _woDropInSeq        // moving songs a place / by drag, a medley
                                   // as one; _woWriteSeq puts a section's new
                                   // order back into the whole list
_woAddSongToSection(secId, lib)    // a library song into a section from outside
                                   // the builder, with or without the LCD
_woSongsChange(fn)                 // a change to the songs from outside the
                                   // builder: _lbdChange, or straight onto the
                                   // data when the LCD is in the page (gotcha 44)
WO.sbmVersions()                   // the Versions sheet for the song in front
                                   // of you; _sbVerApply puts one on a copy
_sbmMarksOf(base, versionId)       // a song's drawn remarks on ONE version --
                                   // the only way to read them (gotcha 46)
WO.sbShareSongWhatsApp()           // one song: its key, version and a link that
                                   // opens the book at it (&sbSong=)
_woSectionList()                   // THE order's sections: [{id, title,
                                   // serviceSectionId, notes}], titles
                                   // without "4. " ordinals
_woSongSectionIds(song, list)      // which of those sections a song is in
_woSectionItems(sectionId)         // a section's non-song items, deduped
_woEnsureLayout()                  // make sectionLayout real before editing it
_woUniqueItems(list)               // one entry per id, one liturgy per
                                   // section: the save's own rule (gotcha 40)
_lbdChange(fn)                     // one undoable Liturgy Builder edit:
                                   // snapshot, fn(), then _lbdCommit (dedupe,
                                   // rebuild serviceSectionItems, redraw, save)
_lbdInsert(kind, secId)            // the ribbon's Insert: into the section the
                                   // cursor is in, after the part it is on
WO.lbdFillReadings()               // the roster's readings into the order's
                                   // data, no LCD schedule needed
_woScriptureSlides(sub, title, text, alleluia)
                                   // a NEW reading's slides (psalm L:/C:,
                                   // two lines a slide, Alleluia, response)
_woScriptureFromSaved(slides)      // a SAVED reading's slides, verbatim
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
    The chip says WHO, not WHEN: once the score became a chord sheet
    (gotcha 59), two parts taking turns and two parts singing at once read
    the same. So a moment where two parts or more have words is marked
    `vl-sys--together` and the reading view draws it as a bar on a soft
    panel with a small "Sing together" badge on its top edge (the key above
    the score that explained it went on 2026-11-07). The badge is the reading view's
    CSS (`::after`), not a banner in the markup, which stays gone
    (`voice-lines-harness.js` checks both).

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
    one row -- on the printed pages and the song library's Choir parts tab;
    in the Songbook's song view a double-tap draws instead (gotcha 69). `replaceAll` deletes and re-inserts everything, which clears
    the bars on rows nobody was editing. Inline edits preserve them; the
    full editor is for restructuring, and pays the price above.
    The editors (Edit Parts, Overview Edit) READ the arrangement before
    they open (`_sbLinesReady`): opened on lines not loaded yet they took
    the song for one without parts, seeded it from the lyrics, and the
    save replaced the real arrangement. A song marked two-part that reads
    as no lines is a failed read (`forSong` answers [] on an error) and
    the editor refuses to open. In both editors a section sung twice is
    TWO sections, by run not by name: `_sbmEdFromRows` starts a section
    whenever the name changes, and a section's Overview pen carries its
    run (`sbmOverview(name, run)`, `_sbmPadText(..., run)`,
    `_sbmPadReplaceSection(..., run)`) -- by name alone the second chorus
    was merged into the first and the save dropped it.

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
    A section sung twice under one name SHARES its takes -- deliberately,
    it is the same music: both badges list them and both show STOP while
    one is recorded (`_setSecBtn` marks every matching mic on the page as
    it is now, and a badge redrawn mid-take reads `lhcVoiceRec._recSec`).
    Line takes are by line id and do not share; the cutter marks a second
    run's lines "(2nd time)". The reading view's held takes (`_sbmRecs`)
    are reread on `lhc:lines-changed`, because a save re-points them.

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
    gets `#2` on its second run's key (`s:2nd CHORUS#2|3`). A key is read
    by its SHAPE (`_sbmKeyParts`), never split on a character: a section's
    name is the song writer's and may hold '/', '>' or '@'. The moment a
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
    device compares a fingerprint (count + newest of `song_marks` and
    `song_recordings`; hashes of what a READER SEES of the choir lines, the
    songs and the book -- gotcha 58) with the one it last drew. Marks and takes are
    reloaded quietly in place; lines, words, settings and the book raise
    the pulsing banner, whose Refresh refetches the songs' rows and lines
    and opens the book again. A device's OWN write (`_sbmLiveOwnAt`) is
    adopted, not announced to itself -- so every write path the fingerprint
    covers must call `_sbmLiveSend()` (or, for lines, dispatch
    `lhc:lines-changed`), or the writer banners itself 30s later; a change
    undone before the refresh takes the banner away with it; Not now adopts
    the state as seen. The live layer runs only while the songbook modal is
    open (`_sbmBookOpen`). Refresh forgets `_sbVoiceWanted` along with
    `_sbVoiceLines`, or the prefetch never asks for the parts again.

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

34. **An order's sections are `currentOrderData.sectionLayout`, read one
    way.** Until something touches them they are the order TYPE's template
    (`orderStructures`); after that, the layout -- with sections added,
    renamed, moved or removed. Every view reads them through
    `_woSectionList()` and places songs through `_woSongSectionIds()`: an
    exact section id wins; a bare KIND (`'preparation'`, from before songs
    were kept against ids) goes to the first section of that kind; an id for
    a section that is gone places the song nowhere, which is what the LCD
    does. Song Order, the Songbook and the Liturgy Book each used to resolve
    against the template by kind, four slightly different ways, and listed a
    song under BOTH sections of a kind that appears twice. Anything new that
    groups songs by section goes through these two. A section's notes are a
    `notes` key on its layout entry; `_captureCurrentLayout` carries extra
    keys over from the entry it replaces, or every capture would drop them.

35. **The Liturgy Builder edits data with the LCD schedule taken down, and
    must.** A save serialises the schedule's DOM whenever a
    `.wo-worship-section` is on the page, so an edit to the order's data made
    with the schedule present is written over by the schedule as it was.
    `_lbdSetActive(true)` empties `#woWorshipOrder`, and the LCD redraws from
    the data when its step is chosen. Away from the schedule a save collects
    `serviceSectionItems` plus a safety net that re-adds any `allItems` entry
    it did not see -- so the two copies must agree after every change
    (`_lbdSyncSSI`), or a removed item comes back or an edited one is doubled.
    The Liturgy Book opens over the builder for the same reason.

36. **A saved reading is redrawn from its saved slides, verbatim.** The
    LCD used to rebuild a reading from its joined text with
    `insertScriptureIntoBox`, which re-split it and appended the response
    again -- one more per rebuild. A stored Gospel had collected 26.
    `_woScriptureFromSaved` draws the slides as stored and drops a response
    repeated word for word, so a damaged order heals the next time it is
    opened in LCD Projection and saved. `_woScriptureSlides` is only for a
    reading being added; the LCD's insert and the builder's both use it, so
    a reading lands identical either way.

37. **The LCD draws a liturgy once per ORDER and a reading once per SECTION
    per title.** A second copy of either is dropped from the schedule and so
    from the next save. The builder therefore turns a library liturgy placed
    in a second section into a copy with its own source id (`lbd_<uid>`),
    and refuses a reading twice in one section. Removing a liturgy records
    `clearedSections`, or the template's gap-fill puts the default back.

38. **A lyrics card's chords are placed by COLUMN, so chords and words share
    one monospaced grid.** A chord line sits over the lyric line under it
    by character column -- the editor's grid -- so in the reading view the
    two share one monospaced face at one size and keep their spaces
    (`white-space: break-spaces`), on every screen; the phone held upright
    keeps its own 1rem rule. A proportional face, or collapsed spaces,
    bunched every chord at the left of its line. A pair too long for the
    row is set smaller, both lines by the same factor (`--sbm-fit`,
    `_sbmFitChordPairs`, floor 11px), because wrapped words and an unwrapped
    chord line put the chords over the wrong row. The Lyrics view, which
    shows no chords, keeps its proportional face. The card stays one block
    per source line, which the drawn remarks' `l:<i>` anchors depend on --
    the inline chord-pair renderer would merge a chord line and its words
    into one block and move every remark on the card.

39. **`position: sticky` does not stick under the app's `<body>`.** `html`
    and `body` both carry `overflow-x: hidden` (lines ~785), which makes
    `<body>` a scroll container of its own that never scrolls -- `<html>`
    does -- and a sticky element sticks to its nearest scroll container. So
    `#topNavBar`'s `sticky` (even the phone's `!important` one) has never
    stuck. The builder's ribbon and status bar need it to, so while the
    builder is on screen `body.wo-lbd-on` switches `<body>` to
    `overflow-x: clip` (it clips the same but is no scroll container) and
    keeps `#topNavBar` `relative`, scrolling away as everywhere else.
    `wo-lbd-on` is set by `_lbdSetActive` and kept in step by
    `setActiveView`: the builder stays open behind other views, and the
    class must not follow the user there. A dialog that locks the page sets
    `body.style.overflow`, which still wins.

40. **A save made away from the LCD schedule used to list every item
    twice.** With no schedule on screen, `collectOrderItems()` returns the
    songs AND the non-song items (from `serviceSectionItems`), and
    `saveCurrentOrder` added the snapshot's non-song items to that -- so
    after every autosave from the builder or Song Order, `allItems` and
    `serviceSectionItems` held two of everything. The database kept one
    (`SBQ.saveOrder` de-duplicates by id), and the LCD hid the repeat for
    liturgy and readings, but drew a text box twice and then saved both.
    Both lists now go through `_woUniqueItems`, and the LCD draws a text
    box once per id. Build any new item list the same way.

41. **The builder's words are plain-text editables, except a slide's,
    which keep the LCD's formatting.** Titles, notes and text slides are
    `contenteditable="plaintext-only"` (plain `true` plus paste and Enter
    handling where a browser lacks it), read through `_lbdVal` /
    `_lbdTextOf` -- text, `<br>` and block elements to `'\n'` -- never
    `innerHTML`. The words of a liturgy or reading slide
    (`data-field="slide"`) are `contenteditable="true"` and written as a
    PAIR: `content` (the words, from `_lbdTextOf`) and `richHtml` (the same
    lines as inline HTML joined by `<br>`, from `_lbdRichOf`, or `null` when
    nothing is formatted) -- the form the LCD's own editor saves and redraws.
    The two walks treat text, `<br>` and blocks alike, so their lines always
    agree; change one, change both. `_lbdRichOf` is also the sanitiser:
    stored `richHtml` is parsed and walked again (`_lbdRichClean`) before it
    is drawn, keeping only b/i/u/s/sup/sub and spans with colour, size,
    weight, style, decoration or family. A slide break or join goes through
    `_lbdSplitField` / the merge in `_lbdMergeAt` so each half keeps its
    formatting; `_lbdSetSlide` (words only) still drops it. Enter in a slide
    is `insertLineBreak` (a `<div>` would be a paragraph) on a desk, and the
    slide break on a touch screen; paste is still plain text. Typing writes the data as it goes and never redraws;
    anything that does redraw (`lbdRender`) hands the cursor back where it
    was (`_lbdFocusKey` / `_lbdRestoreFocus`), and a run of typing is one
    undo step, pushed by `_lbdFlushTyping` before any other change -- it
    compares the slide's `innerHTML` too, so Ctrl+B alone is a step. The
    formatting bar and its menus keep the cursor in the words
    (`mousedown`/`pointerdown` prevented, `keepFocus` menus). Work that
    redraws after a field loses focus waits a tick (`setTimeout 0`), or the
    redraw swallows the click that moved the cursor.

42. **A medley is a SET; the running order says how it is sung.**
    `currentOrderData.template.medleys = [{ id, songs: [entry id] }]` is saved
    with the template. Read it only through `_woMedleys()`
    (`_woMedleyList`): a song that left the order leaves its medley, a song
    is in one medley only, members share the section most of them are in (a
    member moved elsewhere drops out), a medley of one is none, and the songs
    come back in their `songOrderSections` order -- the stored list's order
    means nothing. `_woSaveMedley` writes that order: it moves the songs into
    the section the FIRST is sung in and stands them together there. Every
    list a person reads goes through `_woRunWithMedleys` (`_sbmSongs` does),
    every move through `_woStepInSeq` / `_woDropInSeq`, which carry a medley
    as one unit -- a plain splice drops a song into the middle of a medley
    and the list shows it split. Each song keeps its own key, words and
    marks; the medley only groups them (Songbook list and ribbon, the
    builder's chip, the shared list's one line, the playlist's order).
    A STANDALONE songbook has medleys too, kept in its pseudo-order's
    template (`_sbPersistStandaloneTemplate` counts them as worth keeping).
    Its entries are numbered by place (`sbsong_<songId>_<n>`, gotcha 20) and
    renumbered on the next open after any reorder, so each medley there also
    keeps `songIds`, the library ids, and `_woMedleys` reads it back through
    `_woMedleysByLibId`. With no builder and no sections, `_woSongsChange`
    changes its songs directly and keeps its own undo (`_woSbUndo`).
    In the Songbook's reading view a medley is READ STRAIGHT THROUGH: under
    the song in front come the rest of its medley (`_sbmFollowHtml`), each
    with its words and chords in its sung key (or its choir parts), its
    drawings and an Open button. Those cards carry `data-sbm-song`, and
    everything about drawings goes by the card's song (`_sbmCardSong`):
    painting, a new stroke, the rubber (`cv.__base`), and undo, which takes
    the last stroke on any song on the page (`_sbmShownBases`). A drawing
    group never spans two cards. The reading view's lyric styles therefore
    target `:is(#sbmLyrics, .sbm-card--follow > .sbm-lyrics)` -- one id
    alone left the following songs in a proportional face with their chords
    bunched -- and the chord fit runs over every `.sbm-lyrics`.
    Every medley saved in the editor is also KEPT in `saved_medleys`
    (`_mdsKeep`, an upsert on `song_key`, so the same songs in the same
    order are one row that comes back to the top). The editor lists the
    latest five and See more the rest, filtered in place (`mdsFind`, never
    a redraw, which would take the cursor out of the box). Use
    (`mdsUse`) matches each saved song to a copy the book already has
    (`_mdsMatch`, a song twice taking two copies), adds the rest as Add a
    song does -- into the section the medley is sung in, or onto a
    standalone book's list -- and leaves them in the editor; Save medley
    then makes it, and puts each song in its saved key if the box says so
    (`_mdsApplyKeys`). Removing a saved medley leaves every book's medley
    as it is.

43. **A shared link reaches an order through `window._pendingShareItem`.**
    Every route sets it and then loads the order -- the share picker's Send,
    the inbox overlay, the orders list's confirm sheet, the older share
    modal -- except a share arriving with the order already open, which calls
    `openSongbookInbox` directly. Otherwise the end of `openOrderInEditor`
    hands it to `openSongbookInbox`, which takes it into the inbox and opens
    the Songbook on it. Several
    routes ALSO write the localStorage copy (`ShareInbox.addToOrder`) that
    the load reads into `mediaLinks`, so `_woInboxAdd` matches by
    `_woInboxKey` (address, or a file's name, size and type) or the link
    arrives twice. `SharePickerModal.close()` clears the pending item, as a
    cancel should: the picker's Send used to set it BEFORE closing, so a
    link sent from the picker never arrived at all.

44. **The Songbook may be open over LCD Projection, so changes it makes to
    the order's SONGS have two paths.** `_lbdChange` rebuilds
    `serviceSectionItems` from `allItems`, which the schedule has moved past,
    so it must not run while a `.wo-worship-section` is on the page
    (`_woLcdInPage`). `_woSongsChange` uses it otherwise, and with the
    schedule present edits the data and saves; songs are always collected
    from `songOrderSections`, so that is safe. The schedule is kept in step
    by hand: `addSongToServiceSection` for a song added, `_woLcdDropSong`
    (`removeSongFromSection(..., {remote:true})`) for one removed, and a
    medley needing a song from another section is refused until the LCD is
    closed. Do NOT redraw the schedule with `selectOrder('service')` to
    catch up: its init calls `_clearPreviewToBlank`, which sends an empty
    slide to the projector -- mid-service, a blank screen.

45. **The builder's layout is a class set in script, not a size
    container.** `_lbdModeFor(width of #woLiturgyBuilder)` picks `lbw--xl`
    (>= 1280: outline | page | Add to Order), `lg` (outline | page, Add to
    Order a drawer), `md` (>= 700: both panes drawers) or `sm` (a phone:
    top bar, bottom bar with Add in the middle, both panes sheets from
    below, and formatting keys pinned over the keyboard by
    `visualViewport`). A ResizeObserver re-picks it and `_lbdApplyShell`
    swaps the classes without redrawing. It is not a `container-type` on
    the builder because that would become the containing block of the
    drawers, sheets and keys, which are `position: fixed`; the page column
    (`.lbw-canvas`) is a size container, for the margin notes and the
    formatting bar, and holds nothing fixed. On a phone the builder owns
    the screen: `body.wo-lbd-on.wo-lbd-phone` hides the app's
    `#lhcBottomNav` and the 68px kept for it (needing `wo-lbd-on`, which
    `setActiveView` takes away with the view, so the bar comes back
    elsewhere), and the top bar names the section scrolled to, which is
    where Add adds. Entering the builder on a desk drops the app sidebar to
    its icon rail through `_lcdAutoCollapseSidebar`, as LCD Projection
    does, without touching the saved preference. Testing in the browser
    pane while it is hidden: transitions freeze at their start value and
    animation frames never come, so the sidebar's grid and the sheets look
    stuck -- inject `*{transition:none!important}` into the test page
    before measuring.

46. **A drawn remark belongs to a VERSION of its song, and a version keeps
    its words whole.** `song_versions` holds named versions; Standard (the
    song's own key and words, remarks with `version_id` null) needs no row.
    A service's copy names the version it sings in `versionId` ('' =
    Standard), which every path a copy takes must carry: `_absorbOrderItem`,
    `collectOrderItems` (left out for Standard), `SBQ.syncItems` (written
    when there is one or when there WAS one, so going back to Standard
    clears it), `sbBuildSongSnapshot` / `sbApplyBroadcast`, both polls,
    `sbRefresh` and the standalone songbook's load and save. Every view that
    shows remarks reads them through `_sbmMarksOf(base, versionId)` -- the
    card, the printed page, the Phone view -- and a stroke is saved with the
    copy's `version_id`, but only once `_sbVerSupport()` has found the table
    AND the column: until the migration is run the insert would be refused
    whole, and Versions is simply not offered in More. Choosing a version
    copies its key and words onto the copy (`_sbVerApply`); after that they
    are the service's own again, and a version changes only by Update. The
    words are kept EXACTLY as the saving service had them (`customLyrics`
    and `richLyrics`), never "only if changed": Song Order's transposition
    stored the transposed text as the copy's own words, so against the
    library song nearly every transposed copy looks re-worded. "Changed
    since" (`_sbVerDrift`) is therefore asked only against a named version;
    against Standard only the key is. A new version COPIES the remarks of
    the one the service sang, so that one stays as it was. A save is READ
    BACK before it is reported (`sbVerCreate`): a row the next service cannot
    read has not been kept.
    **Making a service's way the song's MAIN version** (`sbVerMakeMain`)
    writes the library song's `lyrics` and `key` only (`updateFields`, then
    read back, then `_announceSongChange`), in the key it is SUNG in: the
    chord lines are moved by the copy's steps (`_sbVerMainOf`, over
    `_transposeChordLinesOnly`), so nothing is left to transpose. What the
    song was is kept first, as a version named "Before <date>", and every
    other version is written again from the new key (`_sbVerRebase`: steps
    down by as much as the key went up, chords up by as much), because a
    version's steps are counted from the song's key. They sound as they
    did, and `_sbVerDrift` compares the SOUND when the steps differ
    (`_sbVerSung`), or every service already on one would be told it had
    changed. Drawn remarks stay where they are; services already planned
    keep their own copies; the toast's Undo puts back the song, the
    versions and the copy, and deletes the kept one.
    What was replaced is an EARLIER MAIN VERSION: a version with
    `made_from = 'library'` (`_sbVerIsKept`; one kept before that marker
    is known by its "Before <date>" name), named "Main until <date, time>",
    and the oldest is labelled the Original. The Versions sheet lists them
    apart from a service's saved versions, and the song library's History
    panel lists them too (`WO.sbVerKept`), each with a Restore
    (`sbVerRestoreMain`). A restore goes through the same
    `_sbVerReplaceMain` as Make main -- so the song as it is is kept first
    and a restore can itself be restored -- but changes no service's copy.
    Both ask through `_sbVerAsk` (the songbook's labelled confirm, raised
    to z-index 10002 so it shows over the song library's preview). A
    version's key is always shown counted from the SONG's key
    (`_sbVerKeyText(song, steps, libKey)`), never the copy's, which a
    Make main may have moved.

47. **In the WO module, text and attributes take `escapeHtml`; a value in
    an inline handler's JS string takes `escapeJsArg`.** WO has its own
    `escapeHtml` (~line 83,000). It used to go through `textContent` /
    `innerHTML` alone, which escapes `&`, `<` and `>` and leaves quotes, so
    a name with a `"` in it ended its `title=` / `value=` / `data-*=`
    attribute and could start one of its own -- and names (songs, liturgy,
    orders, files) and link addresses (shared from phones) are anyone's to
    type. It now escapes both quotes too. That does NOT make a handler safe:
    in `onclick="WO.f('X')"` the attribute is decoded before the script
    runs, so `&#39;` arrives as `'` and ends the string (an order called
    "Mother's Day" broke its own Add Songs button). Such a value goes
    through `escapeJsArg`, which escapes for the JS string first and then
    for the attribute. Never post-process either (`escapeHtml(x).replace(/'/g,
    "\\'")` stopped working the day `escapeHtml` began escaping `'`), never
    hand `showToast` escaped text (it escapes its message itself, so the
    reader sees `&#39;`), and remember `customConfirm` writes its TITLE as
    HTML (escaped there now) but its message as text.
    `tools/wo-escape-harness.js` checks all of this against the source.
    Elsewhere: the global `escapeHtml` escapes all five; the `esc()` helpers
    (~lines 19,700 and 20,100) and `escOrAttr` escape `"` but not `'`, so they
    are safe in double-quoted attributes and not in a JS string; the
    notifications drawer's `_esc` (`LHC_Notif`) escapes neither, and its
    only attribute is a notification's generated id.

48. **An upcoming order fills in the roster's readings by itself, and
    remembers what it had.** New orders were always given the date's
    readings when they were made; one made before the roster had them, or
    while the passage service was down, kept four empty slots for good.
    Now opening an order in the builder or LCD Projection
    (`_woAutoReadings`, once per order and step a session) fills what is
    missing, each step by its own path: the builder's `_lbdFillReadings`
    on the data, the LCD's `fillReadingsFromRoster` on its schedule, once
    the schedule is in the page (gotcha 35; the data path also gives up if
    the LCD appears while it fetches). Only an order whose service is today
    or later (`_woOrderIsUpcoming`), only into a section it already has for
    readings. `template.rosterReadings = { role: reference }` notes every
    role an order has had or already held, and `_woReadingsTodo` leaves a
    noted role out -- so a reading somebody took out stays out -- unless the
    roster now names a different passage. The ribbon's Roster readings
    button still fills everything missing.

49. **A standalone songbook must take the editor over from the order before
    it, and give it back.** `saveCurrentOrder` refuses any save while
    `#woWorshipOrder` is stamped (`data-order-id`) for an order other than
    the one saving -- the guard that stops one service's slides being saved
    into another. Opening a standalone songbook after any order had been in
    the builder or the LCD left that stamp behind, so every save the
    songbook made -- its song order, medleys, settings -- was refused,
    silently. `openSongbookStandalone` now saves the outgoing order if an
    autosave is waiting (`_autoSaveTimer`, nulled when it fires), remembers
    it (`_sbPrevOrderId`), takes the builder down, clears the editor and its
    stamp, and hides the editor (`_woHideEditor`). The other half: while it
    is open the songbook IS `currentOrderData` (`standalone_<id>`), and it
    used to stay so after closing. The order editor then showed the last
    service's header over the songbook's data, the builder drew its carols
    "not yet in a section" and filled the service template's liturgy into
    it, and the next save wrote all that under the pseudo-order (the Caroling
    book's carries 14 such liturgy rows and a 19-section layout from
    2026-11-01; the songbook ignores them, since it reads only song rows).
    `closeSongbook` now makes the songbook's last save while
    `_sbStandaloneId` still says what it is, then `_sbLeaveStandalone` drops
    it -- no order, no songs, editor hidden -- and reopens the order from
    before: at once if Orders is showing, otherwise the next time
    `showSavedOrders` runs (`_woReopenOrderId`). And `saveCurrentOrder`
    refuses a `standalone_` id outright when `_sbStandaloneId` is not set,
    so a songbook is never saved as a service. Also: "New Songbook"
    with a service's name ("Service 1 Nov 2026") is refused with a toast
    that opens that service's songbook (`_sbServiceOrderNamed`) -- every
    order is already a songbook, and the hand-made copy sat empty under
    My Songbooks beside it.

50. **A drawing is everyone's when it is drawn; its drawer then says who
    sees it.** `song_marks` carries `owner` (the drawer's name folded to
    lower case and single spaces, `_sbmMeKey`), `owner_name`, `shared` and
    `part`. Nobody signs in, so the drawer is a NAME kept on the device
    (`lhc_sbm_me`), asked the first time someone draws ("Who's drawing?",
    the names already drawing in the book first, then the roster's, and a
    name with drawings welcomed back with their count); the same name on
    another device is the same person, and their drawings -- private ones
    included -- come back there. "Only me" is about what is SHOWN, not a
    lock: every row is still readable through the page's key. A stroke goes
    in for everyone (`shared` true, `part` null). On Done, the strokes of
    that sitting (`_sbmSessionStrokes`) are offered to the drawer
    (`_sbmAskAudience`): Everyone (the default), Only me (`shared` false),
    or one part of the band (`part`: leader, vocals, guitar, bass, keys,
    drums -- `_SBM_PARTS`), saved by `sbmAudience` on exactly those ids.
    Every view reads drawings through `_sbmMarksOf`, which filters by
    `_sbmLayerKeep`: your own, whoever they are for (unless you hid them);
    anybody else's when they are for everyone, or for a part the READER
    has switched on under Drawings > For a group (`lhc_sbm_parts`);
    anybody else's PRIVATE ones only when the reader has switched that
    person's private drawings on (`lhc_sbm_priv_on`, `_sbmPrivOn`,
    `sbmPrivToggle`) -- asked on 2026-11-07, the operator chose "Show
    everyone's, private too", so "Only me" keeps a drawing off everybody
    else's song until they choose to see it, and the drawer is told so
    when they choose it; the rows from before layers, which have no owner,
    stay everybody's ("Earlier drawings", hidden as one under the key '').
    What a reader hides, and which parts and private ones they switched
    on, are theirs alone. The parts FOLLOW
    THE NAME (`drawer_prefs`, `_sbmPrefs*`): giving a name (`sbmWhoSave` ->
    `_sbmPrefsNamed`) brings back the parts kept for it, a tick
    (`sbmLayerPart` -> `_sbmPrefsTicked`) is kept for it too, and the name's
    parts are read back after the layers probe and when Drawings opens
    (`_sbmPrefsPull`, not twice in 30s). Two marks on the device decide how
    a read meets the device (`_sbmPartsJoin`, pure, by `mode`):
    `lhc_sbm_parts_of` says whose the device's parts are, and
    `lhc_sbm_parts_dirty` names the name they hold a change for that has not
    been saved (set by a tick, cleared once a write of what the device holds
    lands, `_sbmPartsClean`). Nobody's ('') -> `join`, the union, said in the
    one welcome toast (`_sbmWelcome`); the same name's with nothing waiting
    -> `saved`, the NAME's win, so a part unticked on one phone stays
    unticked on the others ("as chosen on another device"); the same name's
    with a change waiting, or a name with no row -> `mine`, the device's win
    and are written; somebody else's -- a phone changing hands -> `theirs`,
    the new name's own alone, and what the device held for the old name is
    kept with THAT name first (`_sbmPrefsNamed`), so one person's parts never
    follow another person around. A tick made while a read was out counts as
    waiting (`_sbmPrefsTicks`), so a read that left before it cannot undo it.
    A device with no name, and every device until the migration is run
    (`_sbmPrefsOk`, probed once), works from `lhc_sbm_parts` alone.
    The Drawings window (`sbmLayers` -> `_sbmDrawings`, from the tile after
    Book Mode or the chip beside Draw; it was the Layers sheet) lists them
    all through `_sbmDrawingsOf` (pure): yours by who sees them, others'
    shared ones by person (a row says how many are for a group the reader
    has off), the six groups with counts, and others' private ones by
    person; Show all / Only mine (`sbmLayersAll`) set those same switches
    for everybody on the song in front, and Draw on this song
    (`sbmLayersDraw`) goes to the words with the pen out. It also changes
    who sees all of one's drawings on the song (on the version the service
    sings), and says when a copy shares its drawings with the song's other
    copy (`_sbmSharedDrawingsNote`, with Own drawings). The rubber takes only one's own strokes and the earlier
    ones. Copies of drawings made for a new version read the UNFILTERED
    list (`_sbVerMarks`) and keep whose each is and who it is for, and a
    delete's count is of all of them. Print and the Phone view show what
    the reader is shown. None of this applies until
    `migrations/2026-11-01_song_marks_layers.sql` has been run
    (`_sbmLayersOk`, probed with the marks). `part` meant the DRAWER's part
    for the first hour of layers; no row had one when it changed meaning.
    `tools/songbook-layers-harness.js` checks the rules.

51. **A service liturgy is a whole liturgy, used whole.** The builder saves
    an order's sections, its non-song items (liturgy, readings, text), its
    songs (by library id, section, key and notes) and its service notes in
    `service_liturgies`, against an occasion -- the Liturgy page's
    `OCCASIONS`, through `LiturgyModule.getOccasions()` -- and a year. The
    occasion is guessed from the roster's liturgical day
    (`_svlOccasionFor`: "Day of Pentecost" is Pentecost, "5th Sunday after
    Pentecost" an ordinary Sunday). Using one REPLACES the order's sections
    and non-song items in one `_lbdChange`, each item given an id of THIS
    order (`_lbdPfx() + 'svl_'`); its songs come only when asked (added,
    never replacing the order's), and its readings only when asked --
    otherwise this date's come from the roster through `_lbdFillReadings`,
    folded into the SAME undo step, and the toast with its Undo waits for
    them, or one Undo would take back only the readings. A liturgy is used
    only by an order of the type it was made for: a section's place in the
    type's template (`wo-section-<n>`) is what gives it its reading slots.
    The order notes where its liturgy came from
    (`template.serviceLiturgy`, in the builder's undo snapshot too), which
    is what offers "Save over" beside "Save as a new copy"; both read the
    row back before they report it. Until the migration is run the menu
    says so and nothing is saved.
    **Past services too** (the operator's team, 2026-11-08: load a past
    order made by an earlier liturgist -- similar, never quite the same --
    and reuse it; and Templates loads a WHOLE liturgy for a service and a
    year, not one item). "Load a whole liturgy" (`lbdServiceLiturgies(occ,
    kind)`, from Load -- `_lbdOpenLoadMenu`, Templates and Save / Load
    before 2026-11-09 -- a phone's Load liturgy and Past services tiles and
    More) lists the saved liturgies and every service's order
    (`_lldLoadOrders`: not a songbook's `standalone_` pseudo-order, nor this
    order) as one list (`_svlSources`, pure: newest year first, a year's
    saved ones before its services), filtered by where from (All / Saved
    liturgies / Past services), the service (the occasion) and the year
    (`_svlFilter`, pure), and searched in place by name, date or liturgist
    (`lbdSvlFind`, never a redraw). A past service shows its date, year
    (from its title, as `_yearForOrder` reads it, else when it was made),
    liturgical day, kind and liturgist -- the last two the roster's cells
    for that date (roles `liturgical` and `liturgist`, one read for its
    years, `_lldRosterMap`), and its occasion is that day's
    (`_svlOccasionFor`), as a saved liturgy is filed. It is read whole
    (`SBQ.loadOrder`) only when previewed or loaded, and kept
    (`_lldOrderData`), into a saved liturgy's shape
    (`_lldSnapshotFromOrder`: its sections -- its type's template if it kept
    no layout -- its liturgy, text and readings, never that day's sermon
    slides, videos or notes pages; its songs; its service notes). Both kinds
    load through `_svlApply`: the same one Undo, the same type rule, songs
    and readings only when asked. The order then notes `serviceLiturgy =
    { fromOrder }` for a past service (no Save over: there is no saved row)
    or `{ id }` for a saved one. A read that lands after the window has
    closed does not reopen it. In the window a past service's liturgist
    sits beside its name and the line under it (date, day, kind, counts) is
    2px larger, only its date bold (a saved liturgy's date is its year).
    `tools/builder-load-liturgy-harness.js` checks it. A preview's PARTS are
    buttons (`_svlOutlineHtml`, the outline's `ref`: 'i:<n>' into the
    liturgy's items, 's:<n>' into its songs): a click shows the part's words
    under its section, in place and one at a time (`_svlItemToggle`), set as
    the Export sets them (`_svlItemHtml` over `_lbdExportParas`: who speaks,
    the people's lines bold, verse numbers raised; a song's words from the
    song library, chords out). The part kept open (`_svlTx`) survives a
    redraw, a preview opened keeps the window's scroll (`_svlDrawList(true)`),
    and the window is taller than the builder's other sheets
    (`lbd-sheet--svl`; `_lbdSheet` gives a sheet its kind's class). The
    Liturgy Library's outline of a saved liturgy uses the same
    (`LiturgyModule.occSvlItem`). `tools/svl-item-text-harness.js` checks it.
    **Filed by year in the Liturgy Library** (the operator, 2026-11-08). A
    liturgy saved for an occasion and a year gets that year's folder under
    the occasion -- a `liturgy_occ_folders` row named "2026", the folders
    the occasion's page shows as Add Year cards -- made if there is none
    (`LiturgyModule.ensureOccYearFolder`, read from the database, written as
    one row and read back, called by `_svlYearFolder` after the liturgy is
    read back; a folder that cannot be made never fails the save), and the
    toast says where. The occasion's page lists its whole liturgies
    (`#litOccSvlStrip`, `renderOccSvl` from `renderOccasionItems`, read by
    `_occSvlLoad` on opening and on Sync): all of them under All, a year
    folder's under that folder (by its NAME, `_occSvlInYear`), each opening
    to its outline (`WO.svlOutline`), read only when opened; a folder card
    counts them beside its files. To USE one, an order loads it from the
    builder. The Liturgy page's `saveOccFolders` used to delete every row it
    did not hold, so a device that loaded at nine wiped a year folder made
    since on another device or by the builder (Good Friday once lost all of
    its year folders, `tools/refile-occasion-years.js`), and removing the
    last folder a device held emptied the table. It now deletes only the
    folders removed on that device (`_occFoldersGone`, set by
    `deleteOccFolder`). `tools/svl-year-folder-harness.js` checks it.

52. **A line's takes are a badge and a list, on every line with words.**
    A line with none -- left empty, or a dash (`lhcVoiceLines._hasWords`) --
    has no badge and no microphone, like a rest. In the
    reading view each line of the choir score ends in two boxes
    (`lhcVoiceLines._recSlot`): a badge, a play mark, "Playback" and the
    line's count of takes (`.vl-rec-list`, the count teal once it has one;
    a phone's score drops the word, `.vl-rec-lbl`), then the microphone. The
    badge opens `lhcVoiceRec.openList`, ONE line's takes, newest first, each
    to play or delete (`R.del`, which asks first) with a timeline under it
    (`.vl-pop-range`, as long as the take): it follows the take playing
    (`au.ontimeupdate` -> `_tickList`, which leaves alone a range being
    dragged, `R._seeking`), dragged it moves the take playing, and let go on
    another take it plays that one from there (`R.play(root, id, path,
    from)`); `_paintSeek` fills it and writes the time. And "Add an audio file"
    (`R.pickFile`) -- so the import button and the inline take chips are
    hidden there. Other views that draw the slot keep their chips and never
    show the badge. The list lives on `<body>` at z-index 2400, over the
    songbook (2200) and under the confirm (10001); it is a sheet from the
    bottom under 640px wide. It is painted from the store with the badge
    (`paint` calls `paintList`), so a take recorded, played or deleted
    shows in both; a redraw makes a new badge and root, found again by the
    line's id (`_listAnchor`), and the list closes when the line is gone,
    with `stopPlayback`, on Escape (unless the confirm is up) and on a tap
    elsewhere (the confirm is not elsewhere). A phone carries chords inside
    the words (`.vl-w__c`), so the list quotes a copy without them. The
    "Line mics" switch that once hid the microphones is gone.

53. **The band's moments are section takes with names of their own.** The
    intro, the way into each section and the ending are strips in the song
    in front (`_sbmInstStrips`): between the sections of its score, or -- a
    song shown as lyrics -- between the section headers of `#sbmLyrics`
    (the reading view's `.wo-lyrics-section-header`; `.wo-lyrics-section-label`
    is the editor's). `_sbmStampAnchors` passes over `.sbm-inst`, because the
    drawn remarks' `l:<i>` anchors count the lyrics' block children; a strip
    counted as a line would move every remark under it. Each moment is a
    `song_recordings.section` value, so no migration: "Intro (instruments)",
    "Into Verse 2 (instruments)" (`#2` on a section's second time, shown "2nd
    time"), "Ending (instruments)" (`_sbmInstKey`, `_sbmIsInstKey`,
    `_sbmInstLabel`); matched lower-case, so the score's "Verse 2" and the
    lyrics' "VERSE 2" share their takes. A strip is the line's two boxes: a
    badge (`data-rec-sec`) opening that moment's list in `lhcVoiceRec`
    (`openList(..., section)`, its takes from the drafts store, counted by
    `paintSecBadges`, which `paintDrafts` calls), and a microphone
    (`.sbm-sec-mic.sbm-inst__mic`, so `_setSecBtn` shows STOP on it) that asks
    which instrument first (`_sbmInstPick`) and then records into that slot
    (`toggleSection`), or, from the list, gives it a file (`pickFile(root,
    null, { section, part, name })`). Instruments go by name: "A new
    instrument" takes the first slot nobody has named or recorded on, else
    one more, up to 30 (`_sbRecInstrumentAdd`); the pen renames one
    (`_sbRecInstrumentRename`); both write `display_style` whole through
    `_sbRecDsWrite`. Names show wherever a slot is labelled (`_sbRecCatsFor`,
    so Practice Tracks too), and a take of a moment is placed as the moment
    ("Intro"), not as "(whole section)". The lyrics card binds a recorder of
    its own; in the Both view only the score has strips. A medley's follow
    cards are another song's, so neither strips nor the section badges' pen,
    microphone and takes are drawn on them (`:not(.sbm-score--follow)`).

42. **A new function in these IIFEs can silently steal an old one's
    name.** `function foo(){}` twice in one scope is not an error in
    JavaScript: the later declaration wins and every existing caller of
    the first is rerouted to it. In a 113,000-line file that is easy to
    do by accident -- a `_sbmLinkView` added for shared links was first
    called `_sbmLinkFrame`, which was already the drawn remarks'
    two-anchor helper, so remark links began being handed URLs.
    `node --check` is happy with it and no harness covered that call, so
    the suite stayed green. **Grep the name before you add a function.**
    A mechanical check was tried and dropped: without real scope
    analysis it cannot tell one IIFE's top level from another's, and it
    reports 11 existing pairs (`sbIsChordLine`, `prevSlide`,
    `updatePreview`...) that are almost certainly harmless.

43. **A website cannot be shown inside the app unless it allows it.**
    `_sbmLinkView(url)` is the one place that decides: YouTube and
    Spotify by their embed address, Google documents and Drive through
    `sbBuildEmbedUrl`, any PDF or Office file through Google's viewer,
    an image as an image -- and **everything else as a card naming the
    site that refused, with a button to open the tab**. Most sites
    (Ultimate Guitar among them) send `X-Frame-Options`/`frame-ancestors`
    and will never frame. `sbBuildProxyUrl` was the old answer and is
    retired to `return null`: it built `<this app's own URL>?proxy=...`,
    which under Apps Script was a server that fetched the page and on
    Vercel is THIS APP, so the panel loaded a second songbook inside
    itself. Framing a page that forbids it needs a server that fetches
    it; there isn't one.

44. **`sbm-live-<key>` carries two events, not one.** `changed` means
    "go and look" (gotcha 32). `show` carries `{url, title, from}` and
    every open book OPENS it -- except a screen that is projecting
    (`_sbLiveFullscreen` or `_sbmPageView`), which gets a toast with an
    Open action instead, because a panel across the words mid-verse is
    the one place this must not barge in. The channel is
    `broadcast: { self: false }`, so a sender never hears its own and
    opens its copy directly.

54. **The builder's All Slides is the words as one text, held to the parts
    by their headings.** The ribbon's All Slides (a phone's More) opens the
    whole liturgy; a part's own button, or its options, opens just that part
    (`lbdAllSlides(itemId)`). `# 1. Invocation` is a section, `## Liturgy:
    Invocation` a part (`## Text` a text part, `## Song: <title>` a song,
    whose words stay in the Songbook), and a line of `---` starts a slide
    (`_lbdAsText` / `_lbdAsParse`, pure). The k-th `##` heading is the k-th
    part, so a heading added or taken out, words under a song, or words
    under a section but no part are REFUSED with a message rather than
    guessed at; the parts never move. Apply is one `_lbdChange` (one Undo),
    and none when nothing changed. `_lbdAsPut` keeps each unchanged slide as
    the same object wherever it moved -- formatting (`richHtml`) and
    background with it -- and a changed slide keeps the background of the
    slide in its place and becomes plain words, as `_lbdSetSlide` does; a
    heading's new name becomes the title; a text part given more slides
    becomes that many text parts. Words differing only by trailing spaces
    are not a change. Closing with changes not applied asks first, through
    the Songbook's labelled confirm (`_sbVerAsk`): the app's `customConfirm`
    is a delete dialog and says Delete. It is not LCD Projection's All Slides,
    which reads that step's DOM (gotcha 35).

55. **A song sung in two sections is two copies.** It used to be ONE
    entry whose `serviceSections` named both, so the Songbook -- which lists
    each entry once -- showed it only under the first, and a key or a word
    changed for one moment changed the other. Adding a song the order already
    sings in another section (`_lbdAddSong`, `_woAddSongToSection`) now makes
    a copy for that section (`_woSongCopy`: the same key, words, version, page
    marks, links and slides, but not the liturgist's note, which was about
    the other moment); one waiting in no section is still placed. A section
    duplicated copies its songs. An entry stored the old way is split as the
    order opens (`_woSplitSharedSongs`, in `openOrderInEditor` and in the
    shared Songbook link's `openSongbookByOrderId`): it keeps its id -- and
    with it its medley -- and its first section, and each other section gets
    a copy with the id `<entry id>_in_<section id>`, so two devices opening
    it make the same copy and either save writes one row; a section that
    already has a copy only loses the shared entry. Find a song in a section
    with `_woSongCopyIn(libId, secId)`, never by one entry per library id.
    The copies' DRAWINGS are still their version's (gotcha 46): two copies on
    Standard share them, which the Drawings window says (the notice under
    the song's title that said it, and where else it was sung, went on
    2026-11-07), and **Own drawings**
    (`sbmOwnVersion`) saves the copy as a version named for its section and
    service through the Versions sheet's own save (`_sbVerSaveAs`), copying
    the drawings it shows, so what is drawn after stays on it. **Earlier
    versions** (`sbmArrangements`; Copy an arrangement until gotcha 72)
    lists the other copies in this service and the song's copies in earlier
    services (`_sbArrEarlier`,
    newest first, standalone songbooks left out) and puts one's key, words,
    version (if it still exists) and page marks on this copy, with Undo
    (`sbArrCopy`). The playlist plays a video once however many copies carry
    it. The shared Songbook link now loads each copy's `versionId` -- without
    it any change made there wrote every copy back to Standard -- and the
    order's own `sectionLayout`.

56. **A copy's library links are the library's, read again whenever the
    library is known.** An order's copy of a song carries `youtube` and
    `attachments` -- the library song's links, copied when it was added and
    saved in `order_items.content` -- and about twenty-five views read them
    there (the Songbook's links and YouTube tile, the playlist, LCD
    Projection, print). Nothing refreshed them in the Songbook, and the old
    refresh in Song Order and the LCD took the library's videos only when
    there were MORE of them, so a video replaced in the Edit Song form never
    reached a service already planned. `_woSyncLibLinks()` puts the library
    song's current links on every copy: as an order opens, as the Songbook
    opens and on every `renderSongbookLive`, and when the library reloads
    (`loadSongs` calls `WO.lcdRefreshLibrary`, which also redraws an open
    Songbook). With the library not loaded yet it does nothing, rather than
    empty every copy. What the service did with those links is kept apart and
    never touched: hidden ones (`removedLibraryYoutubeUrls`,
    `removedLibraryDocUrls`, by address) and its own (`customYoutube`,
    `customDocs`, `sbLinks`). The stored copy catches up on the next full
    save; `SBQ.syncItems` does not write `content.youtube`.

57. **A playlist is played by ONE YouTube player, and its link carries the
    list.** The player (`#plPlayerOverlay`, its own IIFE near the end of the
    page; `?playlist=` opens it) used to build a new `YT.Player` for every
    song, and a phone will not start a new player's sound without a tap, so
    a list "on autoplay" stopped after its first song. Now the next YouTube
    video goes into the player already there (`loadVideoById`, once
    `onReady` has said it can), with `playsinline` for the iPhone; only a
    track of another kind tears it down. A video that will not play
    (`onError`) is passed over after a moment, but not round a list where
    none will (`_plErrors`), and while it plays the screen is kept on
    (`navigator.wakeLock`), let go when paused or closed: a phone that
    sleeps stops the video. A list opened from a link still needs one tap
    to start -- no browser lets a page start sound by itself -- so it says
    so (`#plHint`) until it plays. A link is made by
    `window.lhcPlaylistLink(items, name)`: `{ n: service, i: [{ u: 'y:<id>',
    t: song }] }` as escaped base64 (a bare `+` reads back as a space), and
    read by `_plReadLink`, which still reads the old bare list of tracks.
    The list is IN the link, so a link already sent never changes; the
    player's bar shares it on WhatsApp (`plShare`: the songs by name, the
    link, and the same videos as a YouTube-app queue,
    `window.lhcYouTubeQueue` -> `youtube.com/watch_videos?video_ids=...`,
    which keeps going in a car where a browser tab will not), and opens
    that queue (`plOpenYouTube`).

58. **A songbook edited from several devices: what changed, who may edit,
    and what gets saved.** The banner's fingerprint hashes CONTENT, never
    rows as stored (`_sbmLiveBookOf`, `_sbmLiveSongsOf`, `_sbmLiveLinesOf`,
    pure): the book's song order and each item's words (`customLyrics`, the
    text of `richLyrics` through `_sbmLiveText`), key and version; the songs'
    title, key, words and `voice_layout`; the choir lines' song, place, part,
    section and words. It once hashed the book's whole `items` (each device's
    page breaks, margins, fonts and slides), the songs' `last_edited` and
    `display_style`, and the newest line's `updated_at`, so a save that
    changed no word -- or a word typed and taken out again -- raised the
    banner, and Refresh showed nothing new. A change also has to last
    (`L.pendingAt`, about eight seconds) before the banner shows.
    **Save Lyrics** in the Lyrics & Chords editor is the song form's
    (`saveLyricsEditor`); the Songbook borrows the editor in mode `'__sb__'`
    (`sbOpenLyricsEditor`), and until 2026-11-04 nothing handed the words
    back -- the July commit that said it patched the save never did -- so it
    saved nothing, ever. Now that mode goes to `WO.sbSaveLyricsFromModal`:
    the copy's `customLyrics` and `richLyrics`, the transposition baseline,
    `sbAutoSave` AND `autoSaveOrder` (a standalone book reads its words from
    the full save), `_sbmLiveSend`, a redraw. **One editor at a time**:
    the Lyrics & Chords editor, the choir parts editor and the Overview each
    save a song whole, so each holds `sbedit:<library song id>` on the
    app-wide song lock channel, `ed-lock-songs` (a song is edited from every
    book that sings it; slide and item keys stay on the order's channel,
    whose section ids recur in every order -- `_edSend` routes by key)
    (`edTryClaim`: broadcast locks with an 8s TTL)
    from open to close (`_sbEditClaim` / `_sbEditRelease`; the Overview on top
    of the parts editor shares its hold, and a failed read lets it go). A
    claim carries when it began (`since`), and two at once go to the EARLIER,
    a tie to the client ids -- it used to be the ids alone. Whoever is
    refused is told who has the song (the device's drawer name, `_sbmMe`),
    the Edit tile shows a lock (`_sbmMarkEditTile`, from `_edApplyLockUI` and
    each render), and a save from a device that lost the song is refused
    with its editor left open (`_sbEditMayWrite`). The phone's old inline
    parts editor on the printed page takes no hold. **The chord fit**
    (`_sbmFitChordPairsIn`, gotcha 38) measures a pair's words at full size
    from their font on a canvas (`_sbmTextPx`), never the line as laid out:
    that width moved with the factor being decided, an iPhone rounds it
    differently at each size, and the line flipped between two sizes every
    24ms -- shaking. It moves a line only by 0.01 or more, at most three times
    in two seconds, and `#sbmRoot` turns off iOS text autosizing
    (`-webkit-text-size-adjust: 100%`). `tools/songbook-live-edit-harness.js`
    checks all four.

59. **Choir is drawn as a chord sheet, by the reading view's styles over
    the same markup.** `lhcVoiceLines.html` still draws systems and lanes;
    what changed in it is small and applies to every view that draws the
    score. A line whose part is the part of the line before it, in the same
    section and with no whole-choir rest between, carries `vl-ln--same`
    (put AFTER the family class: `vl-ln vl-ln--women` is matched as it
    stands); a moment's chord row is placed straight before its LEAD line
    (`leadLine`), not at the top of the moment -- over the men's words when
    the women rest above them -- and opens the moment only when no lane is
    the lead (everybody holding). Everything else is CSS under
    `#sbmRoot .sbm-score .vl-score`, so the printed pages, the song
    library's Choir parts tab and the editors' previews keep their look: no
    rule, brace or band; Chords + Lyrics' size (18px x the lyric scale),
    weight and chord colour (`#04756f`); an empty chord row has no height
    and its "+ chords" hint is hidden there (a double-tap draws, gotcha 69).
    A desk keeps label | words | recorder, the repeated label
    `visibility: hidden` in its column; a phone floats the label in at the start of its line,
    drops a repeated one (`display: none`) so the words use the full width,
    and puts the recorder at the top right (absolute) with a float in the
    words making room on their first line only. A part filter can leave a
    label showing that the line above already said -- never one missing,
    since a part's lines are all shown or all hidden. `_sbmEvenRows` skips a
    label with no height, or every unlabelled line voted to stack.
    Parts singing AT ONCE -- two lanes or more with words in one moment, a
    held note counting -- are marked `vl-sys--together` and drawn on a
    purple bar and a soft panel; parts taking turns (one sings, the rest
    `(—)`) stay plain. Every moment keeps the bar's 12px, so the labels stay
    in one column; a "Sing together" badge sits over the panel's top edge
    (16px kept above it). What makes a moment "together" is how
    the parts are grouped: in Edit Parts each box is one moment -- a box
    whose parts have words is marked `is-together` and badged as it is
    typed (`_sbmEdTogether`, `_sbmEdTogetherMark`), and its "+ Part
    singing with this" (`.sbm-ed__here`, `sbmEdAddPart(sec, moment)`)
    shows outside Reorder too, except on a box everyone sings; in Overview
    edit, lines that touch are one moment and a blank line starts the next.
    "Add Part to <section>" joins the section's LAST box unless that part
    is already in it. A run is joined with the boxes' ticks (`ed.sel`, kept
    across repaints): **Sing together** (`sbmEdSingTogether`, two or more
    boxes next to each other in one section) joins them through
    `_sbmEdJoin` -- a box joins the one before it unless a part would sing
    twice at once or either is All, and a box is never split to make
    another pair -- and **Take turns** (`sbmEdTakeTurns`, `_sbmEdSplit`)
    gives each part of a ticked box a box of its own. Each is one Undo on
    its toast (a snapshot of `ed.sections`); nothing is kept until Save
    Parts. The bar (`#sbmEdSel`) sits in the desk's footer and spans the
    phone's two-column sticky bar (`grid-column: 1 / -1`).
    `tools/choir-chord-sheet-harness.js` checks it.

60. **The LCD Slide Editor's pad holds its words until they are saved.**
    Typing changes the pad alone (`_lcdEditDirty`); the slide, the
    projector and the order move on Apply (`_lcdApplySlideEdit`) or on Save
    in the question a click away asks. It used to commit itself 0.5s after
    typing stopped and again on blur, so a half-typed line reached the
    screen mid-service -- and a toolbar press is a blur, so nothing can be
    saved on blur. A click away (`_lcdOnAwayMouseDown`, a capture listener
    bound with the double-click openers) shuts the pad when nothing changed
    and lets the click carry on; with words held it asks "Save your changes
    to this slide?" (`_lcdAskDraft`: Save / Discard / Keep editing; Esc
    keeps, Enter saves) and swallows the click that asked
    (`_lcdOnAwayClick`, one click within a second) -- never a click in the
    question, or the press that made no click of its own would eat Save.
    "Away" (`_lcdClickIsAway`) is anything outside `.lcd-lyrics-panel`
    except a scrollbar and anything under a `position: fixed` ancestor:
    the Text, Background and Barrier dialogs, menus and toasts float, and
    belong to what opened them. Preview asks the same question. Paths that
    do not ask -- a redraw loading a slide, the console reopening -- still
    save what was held, with its Undo step (`_lcdFlushAutoApply`), rather
    than drop it. The panel shows "Unsaved" while words are held
    (`lcd-draft-dirty`). Anything that would redraw, reload or replace the
    slide asks first through `_lcdDraftGuard(then)` -- All Slides, Open in
    Songbook, the "changed on another device" reload (`_orderSyncReload`,
    whose banner floats and so is never "away"), `loadOrder`, `selectOrder`
    -- and `then` runs after Save or Discard, never after Keep editing.
    While the question is up `selectSlideBox` does nothing and a clicker's
    keys are swallowed, or the words would be saved under it. A save is
    refused while another device holds the slide's edit claim, and the
    words stay held. The slide is held by reference (`_lcdActiveSlide.box`):
    a reading's slides carry no `data-slide-idx`, so the lookup by index
    never found one and edits to readings were never saved -- before the
    pad held its words this failed silently. A slide rebuilt elsewhere
    (`_lcdSyncEditorIfShowing`, `_lcdWriteLibTextToSlide`) leaves held words
    in the pad alone. `loadOrder` empties the LCD undo stacks: a snapshot of
    one schedule restored into another (or into the same one reloaded) put
    back the wrong slides. "Away" walks ancestors only up to
    `#worshipOrderView`, which is itself `position: fixed` in Full Screen.
    Closing the tab with words held raises the browser's own question.
    `tools/lcd-edit-away-harness.js` checks it.

61. **Songbook saves check what is stored before they write over it.**
    From a review of #375-#385 (2026-11-05), each a way data was lost:
    - The shared Songbook link (`openSongbookByOrderId`, also what
      `sbmLiveRefresh` reopens) builds `currentOrderData` itself, and a full
      save writes back `mediaLinks`, `clearedSections` and the slide
      backgrounds from it. It now loads them as `openOrderInEditor` does;
      before, any save from the link emptied the inbox for good
      (`_inbox: []` with `_inboxPresent`), brought removed liturgy back and
      dropped the backgrounds. Anything new that builds `currentOrderData`
      must load every key `saveCurrentOrder` writes.
    - Every write of an arrangement goes through `_sbVoiceWrite`, which
      reads the stored lines first: `onlyIfEmpty` (Set up choir parts,
      decided on this device's copy) refuses when the song has parts;
      `openSig` (`_sbLinesSig` of what the editor opened on -- Edit Parts,
      Overview, the page view's text editor) refuses when they changed
      since. A refusal is an Error with `code` 'has-parts' / 'changed'; the
      editor stays open with its version in it.
    - After the write, `_sbmRekeyMarks` moves the drawn remarks with their
      lines: a regrouping renumbers the moments, and `s:<section>|<n>` keys
      (gotcha 31) pointed at the wrong ones. Lines are followed by their
      words (`rematch`); a part's word or row goes with that part's line, a
      chord or the moment with its first line; lyrics `l:` keys untouched.
    - `display_style` is written whole, so `_sbDsFresh` re-reads it first
      (instrument add, rename and count, part colours): the change banner
      does not watch it, and a stale cache put back what another device had
      named or coloured.
    - A device whose lock timer skipped past the TTL slept: its claims lose
      their head start and are marked `lapsed`. Save Lyrics refuses when the
      copy's words changed in memory since it opened (`_sbLyrOpened`), and
      after a sleep reads `order_items.customizations.customLyrics` first.
    - The transpose bar's Undo undoes only its own change: words changed
      since its last move (`X.after`) are left alone, with a message.
    `tools/songbook-review-harness.js` checks them.

62. **The Slide Editor is rolled up to its title bar unless it is in use.**
    `_lcdApplyEditorRoll` puts `.lcd-editor-rolled` on `.lcd-lyrics-panel`
    while the pad is shut (`_lcdEditorUnlocked` false) and Preview is not
    showing; `_lcdApplyEditorLock` and `lcdSetEditorMode` both call it, so
    any new path that opens or shuts the pad gets the roll by going through
    them. Rolled, the panel is its header alone (Apply hidden; All Slides
    and Delete stay, they act on the slide), `align-self: flex-start`
    instead of stretching to the row. A second press on Preview rolls it
    back up. The row keeps its height: `_lcdSizeWorkspaceColumns` adds the
    pad's overflow to it, and a rolled body has none, so it takes the class
    off for that one reading and puts it back before any paint -- without
    that, the first open pushed the Media Tray down. In the same change: in
    Fixed layout the Song Library's reopen tab (`#lcdLibReopen`) shows only
    with `.lcd-library-hidden`; beside an open library it was a fourth grid
    item in three tracks and squeezed Program / Live to a 180px strip.
    `tools/lcd-editor-rollup-harness.js` checks it.

63. **An editor opens with its cursor on the FIRST character.** A textarea
    filled from script keeps its cursor at the end of what it was given, and
    `focus()` scrolls to it: Overview Edit opened on a song's last line.
    `window.lhcCaretToStart(el)` (the first global script, so every module
    has it) puts the cursor before the first character and scrolls the box
    to its top -- for a contenteditable, before the first text or line break,
    skipping the formatting whitespace between blocks. Call it right after
    `focus()` in anything new that opens on words already written: Overview
    Edit (`_sbmPadOpen`), Lyrics & Chords (`openLyricsEditor`,
    `sbOpenLyricsEditor`), the LCD pad (`lcdUnlockEditor`) and All Slides
    (`openAllSlidesModal`, the builder's `_lbdSheet` for a textarea, the
    Liturgy page's two), the notes editors, and the rest
    `tools/editor-caret-start-harness.js` lists. The schedule's slide box
    used to SELECT the whole slide, so one key replaced it; it starts at
    the top too. One-line fields -- a name, a search, one choir line or its
    chords -- keep the cursor at the end, as any field does.

64. **Book Mode's pages are the song view's words, and drawing cards.**
    `_sbFsBuildPages` draws each song's pages from `_sbBkLyricsHtml(song)`:
    `_sbmLyricsSource` -- the one source the song view, the A4 page view and
    the book now share -- in the key sung (`_sbmStepsOf`), every block
    stamped `data-anchor="l:<i>"`. It used to take the A4 page view's DOM, or
    the words in the song's OWN key when that page had not been drawn. So a
    page's lines are the song view's lines, and the drawn remarks
    (gotcha 31) anchor the same on both. Each page's content is a
    `.sbm-bk-card` with `data-sbm-song` (the whole song shifted and clipped
    on a one-column page; the page itself on a two-column one; and each
    CHOIR page, `.sbm-bk-card--choir`, whose moments carry the song view's
    score anchors -- `s:<section>|<n>` from `lhcVoiceLines.html`, compact
    or not -- so the score's drawings show there and land there), included
    in `_sbmMarkCards()` while the overlay is open -- so painting, the pen,
    the glow, the rubber, Undo, layers and versions need nothing new.
    The page is scaled by a TRANSFORM, so a card is measured on the screen:
    `_sbmCardScale(card)` (rect width / offsetWidth, exactly 1 within 1%)
    scales the ems in `_sbmMarkBox` and `_sbmMarkTokensAt`, and
    `_sbmMarksPaint` lays its canvas out in the card's pixels and draws in
    the screen's, capped at 16M backing pixels (a whole song at a book's
    zoom; iOS refuses past 16.7M) -- `cv.__dpr` is what `_sbmDrawDown`
    draws at. `_sbFsRenderPage` ends in `_sbBkMount` (canvas, pen state,
    paint, `_sbmLoadMarks` per song).
    Gestures (`_sbBkInit`, on `#sbFsPage`): a double-click (the overlay's
    `dblclick`, which used to CLOSE the book; X and Esc still do) or two
    touch taps within 350ms and 32px (`_sbBkUp`) call `_sbBkDouble`, which
    takes the pen out (`sbmDraw(true)`, "Who's drawing?" first) and marks it
    `_sbBk.penHere`, so closing the book or Esc puts away only a pen taken
    out there. Holding the words 550ms without moving 10px (`_sbBkDown`)
    opens the notepad on the whole song (`_sbBkHold`, gotcha 65). The
    book's swipe, pinch and keys stand down while drawing or typing. A
    swipe turns like a book: right to left is the next page, left to right
    the one before (it was the other way until 2026-11-07). A zoom set on a
    page carries on to the pages after it until one of them is zoomed, and
    that zoom carries on in turn (`_sbFsZoomAt`, pure, over
    `_sbFsPageZooms`, which `_sbFsSaveZoom` keeps per order in localStorage
    and per song in the cloud); the pages before any zoom fit the screen.
    The book asks for real browser FULL SCREEN, in which only the overlay
    is drawn: anything appended to `<body>` -- the draw bar, sheets, the
    toast, a confirm -- would be invisible. While it is open a
    MutationObserver moves new `<body>` children into the overlay
    (`_sbBkAdoptOn` / `_sbBkTake`, not scripts, iframes or media, and not
    what was removed in the same task), and closing gives them back
    (`_sbBkAdoptOff`). The hidden browser pane never runs animation
    frames, and `sbOpenFullscreen` draws its first page and binds its
    gestures in one: replace `requestAnimationFrame` with a timer in the
    test page. `tools/songbook-book-mode-harness.js` checks it.

65. **The sheet is a notepad: the whole song typed on at once, Enter to
    keep it.** One engine for the song view's Type chip (`sbmType`, on
    `#sbmLyrics`, Chords + Lyrics and 2 Col only) and Book Mode's hold
    (`_sbBkHold`, on the page's `.sbm-bk-lyrics`; a two-column song is
    refused there): `_sbNpStart` / `_sbNpEnd`, state `_sbNp` (`where`
    'view' | 'book'). It makes the lyrics element `contenteditable="true"`
    (the instrument strips `false`), holds the song (`_sbEditClaim`), puts
    the cursor where the words were held or on the first LINE -- not in the
    Intro strip that comes before it -- and shows `#sbNpBar` (New line,
    Cancel, Save; its buttons keep the focus by `pointerdown`
    preventDefault), placed above a phone's keyboard from `visualViewport`.
    Enter (keydown, or `beforeinput` `insertParagraph` for a phone's 229)
    saves; Shift+Enter is the browser's own line break; the bar's New line
    is `execCommand('insertParagraph')` with `_sbNp.adding` set so it is not
    taken for Return; Esc cancels; a tap elsewhere (blur, then a tick) saves.
    Lines are read back by `_sbNpLines` -- a block a line, an empty block an
    empty line, a `<br>` a line unless it is the block's own trailing one,
    strips, buttons and old page drawings skipped -- which is also how the
    sheet is read at the start, so shown and typed are compared like for
    like. `_sbNpMap` stores a line found in both (by their longest common
    run) as the STORED line it showed, exactly, so a song shown in another
    key comes back untouched; a typed or changed chord line goes back by
    `sbTransposeChordLine(t, -steps)`. Saved through `_sbSetCopyWords`, with
    Undo; refused when the words changed underneath or another device has
    the song. NOTHING may redraw the sheet while it is typed on:
    `_sbmRender` and `_sbFsRenderPage` return early (`renderAfter`), and the
    redraw runs when the notepad ends -- a window resize, which a phone's
    keyboard opening is, used to rebuild the book page and wipe the typing.
    Draw ends the notepad first (saving), and the line-transpose bar stands
    down while it is open. `tools/songbook-notepad-harness.js` checks it.

66. **Book Mode's pages break between stanzas, never inside one.** They were
    cut every 1,123px wherever that fell, so a chord line sat at the foot of
    a page with its words on the next, or a line was sliced in half.
    `_sbFsBreaksFromDiv` (Book Mode's one-column pages, and the print
    preview's page count) now measures the song's lines (`_sbFsItemsOf`:
    header, chord, lyric, empty, from the classes -- `wo-lyrics-empty-line`
    holds the word "lyric", so test `lyric-line`, never `lyric`) and asks
    `_sbFsPageStarts`, which ends each page at the last STANZA that starts
    on it (`_sbFsStanzaBreakAt`: a line after a blank line, or a label, and
    never straight after a label); failing that, between chord-and-words
    pairs; failing that, between lines. A break dragged in the A4 page view
    is kept when it fits. Each one-column page is cut at the next page's
    first line (`.sbm-bk-clip`, height = next start - this start), or the
    stanza carried over would show half at the foot; the pages after the
    first keep `_SB_FS_PAD_TOP` (20px) at the top -- the blank lines and a
    label's own margin are already room at the foot, and a larger margin
    tipped two 500px stanzas off one page and made the book a third longer.
    A two-column song's columns use the same rule (`tcBreak`). Print and the
    PDF already broke only between sections (`_sbComputePageStarts`).
    `tools/book-stanza-pages-harness.js` checks it.

67. **A part's label is read by `lhcVoiceLines.labelOf`, everywhere, and a
    choir page in Book Mode is typed on as Overview Edit's text.** From the
    operator (2026-11-06): the choir pages typeable, the part labels people
    type recognised ("Vocals 1, 2, 3, Men, Women, Melody, etc."), a way to
    mark highlighted lines as sung together, and the chords typeable.
    `labelOf(line, parts)` returns `{ part, len }` or null: `[Name]` (colon
    optional) as before; `W:` `M:` `B:`; `Women:` `Men:`; `All:` `Everyone:`
    `Unison:` `Tutti:` `Both:` for everybody; and `Name:` when the name is
    one parts are called by (`_PART_NAMES`: Melody, Vocals 2, Soprano, Alto,
    Descant, Lead, Solo, 1st Part, Harmony, Women 2...) or one the song
    already has (`parts`, from `V.lanes(rows)`). Anything else is words --
    "Lord: have mercy" is sung -- so a new name needs brackets the first
    time. A new name typed in lower case gets capitals; a known one keeps the
    song's spelling, and `parseVoiceText(text, { parts })` keeps one
    spelling per lane within a text. Every reader goes through it:
    `parseVoiceText`, the pad's `_sbmPadIndent` / `_sbmPadWords` (so a chord
    over "Melody: words" is indented past the label) and `_sbmPadHighlight`.
    The other way, a line everyone sings that opens like a label is written
    `[All] ...` (`V._needsAll`, used by `toVoiceText` and `_sbmAllPrefix`),
    or it would come back as that part.
    Holding a choir page (`_sbBkDown` on `.sbm-bk-card--choir .vl-score`,
    `_sbBkHold` -> `_sbChNpStart`) claims the song, reads its lines, and
    puts the whole arrangement on the page in place of the score
    (`_sbChNpOpen`): `_sbmPadText` with a line writer (`_sbChNpLine`:
    "Women: ", "Melody: ", nothing for everyone), the chords moved by the
    copy's steps (`opts.chord`), and `opts.at` giving each moment's line, so
    the cursor lands on the moment held (found by its `s:` anchor through
    `lineNumbers`). The notepad is `_sbNp` with `kind: 'choir'`, so the
    book's redraw, gestures, swipe and keys wait for it as for the words;
    `_sbNpEnd` hands it to `_sbChNpEnd`. One block a line: a typed newline
    (Chrome types Shift+Enter as `\n` in a pre-wrap page), a paste, or a span
    from joined lines is rebuilt as blocks with the cursor kept
    (`_sbChNpFlat` / `_sbChNpRebuild`, a marker character at the caret). As
    it is typed, `_sbChNpInfo` (pure: the parser itself, over the text
    without its chord lines) marks each line section / chord / blank / words,
    with who sings it (the chip on the right, in the part's colour) and the
    moments whose parts sing at once (`is-tg`, the purple bar and "Sing
    together" badge). The bar's **Sing together** (`_sbChNpJoin`) takes the
    blank lines out between the highlighted moments, refusing a section
    between them, a part singing twice or a line for everyone; **Take
    turns** (`_sbChNpSplit`) puts a blank line before each line that joined
    the one above, its chord line going with it. Enter saves through
    `_sbmPadSaveSong` (`openSig`, `parts`, `quiet`, and `mapChords`:
    `_sbChNpChords` stores a chord line left as shown exactly as it was
    stored, and moves a typed one back by the steps), keeping `_sbNp` while
    it saves so the book does not redraw under it; a failed save leaves the
    page typeable, except when the parts changed elsewhere. Undo writes the
    rows it opened on back (`toVoiceText` -> `parseVoiceText`) and the lyrics
    if nothing else changed them. The score's drawings are hidden while it is
    typed on (`.sbm-chnp-card .sbm-marks`) and come back with the redraw.
    `tools/songbook-choir-notepad-harness.js` checks it.

68. **The Enablers directory is self-service, and nobody signs in to it.**
    From the operator (2026-11-07): anyone may add their own phone and
    email, reach their own calendar link, and the Calendar tab became a
    month of services and one's own duties. So a contact is anyone's to add:
    a card with none shows + Add (`_enCtHtml`, opened by `_enCtOpen`), and
    changing or removing one somebody saved asks first (`_enAsk`) unless a
    PIC is signed in -- the app cannot know whose card is whose, the same
    "visibility, not security" as drawings (gotcha 50). A PIC keeps the
    card's two fields and Save. Every save goes through `_enContactWrite`,
    which upserts ONLY the fields it is given (saving a phone must not blank
    the email), under the row's own spelling of the name (`_enMetaKey`: the
    picker's "Ada Example" may be the row's "Ada  Example", and writing
    under the picker's would make a second row nothing reads), and reads the
    row back -- the old Save reported "saved" whatever the database said.
    An email saved is where the calendar sync sends each duty's invitation.
    A person's duties for any month come from the YEAR's rows
    (`SBQ_ROSTER.getAllForYear`, through `_enRowsForYear`, kept while the
    modal is open) by `_enDutiesIn`: earliest first by `_enDateOf` ("Nov 15"
    sorted as text came before "Nov 8"; "Dec 31 PM", the Watchnight, after
    that morning), a lead/trainee cell for both, a group cell ("All
    Teachers") for its members. Never from `STATE.rosterEdits`, which holds
    every month opened this session under keys with no year -- that is how
    October's duties reached November's card. The month's services are
    `getServiceDays` named by the saved liturgical cells (`_enLitMonth`), as
    the roster's own header row names them -- matched by DATE (`_enDateOf`
    key, so an old ISO-dated row counts), and only when the cell is the JSON
    the roster writes; anything else ("__BLANK__") gets the roster's own
    name for the day, as the roster shows it. Only the newest
    `_loadEnablersData` fills the caches (`_enLoadTok`): a year's rows landing
    after the next year's were kept as the next year's. A PIC's Save checks
    only a field that changed, so an old value the checks would refuse does
    not block the other. Send All opens its windows from the click (a window
    opened after a network wait is blocked), so with the year's rows not yet
    read it reads them and asks to be pressed again. **Every WhatsApp share
    in the app goes by `api.whatsapp.com/send`** -- `window.lhcWhatsAppUrl(text)`
    (the first global script), or the roster's `_enWaUrl`, which adds a
    phone -- never `wa.me`: wa.me redirects there, and an emoji outside the
    Basic Multilingual Plane did not survive the trip (the duty card's
    U+1F64F reached the chat as U+FFFD; the song, playlist and planning-notes
    shares carried U+1F3B5 and U+1F4CB the same way). What the app writes
    into a message keeps to BMP characters as well; the helper covers what
    people type. The names chosen on Calendar are this device's
    (`lhc_en_cal_names`); a card's Calendar button replaces them with that
    person. `tools/enablers-calendar-harness.js` checks it.

69. **The reading view, as the operator marked it up on 2026-11-07.** On a
    phone the words started more than a screen below the controls, and
    singers lost them. Taken away: the notice under a song sung twice
    (gotcha 55) and the A- / 100% / A+ that sized the words (`sbmScale` is
    gone; `_sbmScale` stays 1 and a size kept from before is not read, as
    nobody could change it back; Reset Layout still resets it). The key's
    flat and sharp are `sbm-xp-step` buttons, blue and 24px, styled after
    the phone's smaller rule so they win. **A key moved on another device is
    drawn at once**: `sbApplyBroadcast` always took the new `transposeSteps`
    (the quick sync within a fifth of a second, the 2s poll otherwise), but
    the reading view redrew only for a version, so a singer's chords stayed
    in the old key until something else redrew them. Now `p.key` (only when
    the steps really moved -- a 0 arriving for a copy never moved is not a
    move), `p.words` (its words) and `p.version` go to `_sbmRemoteRedraw`,
    which redraws the reading view and an open Book Mode (`_sbBkRebuild`)
    120ms after the last of a burst and, for the song in front, says "Key
    changed on another device: now B (+4)". **The floater** (`#sbmGuide`, a
    button on `#songbookLiveModal`, not inside `#sbmRoot`, which every render
    rewrites) points to the words card (`#sbmWordsCard`: the lyrics, the
    score, or a song with no parts yet). `_sbmGuideWant(top, bottom, h, was)`
    (pure) measures the WORDS (`#sbmLyrics` or `.sbm-score`), not the card's
    heading: shown while less than 160px of them is in sight, gone once
    they start in the top 40%, as it was in between, never when the whole
    song is in sight -- a phone opens with the heading in sight and no line
    of the song, a desk with three lines in sight. A tap scrolls `#sbmRoot`
    past the desk's sticky `.sbm-top` and keeps it away for 2s while the
    smooth scroll runs. It stands down while drawing, in Book Mode and in
    Page view; `_sbmRender` schedules `_sbmGuideUpdate` on every render.
    Testing in a hidden browser pane: smooth scrolling does not move, so
    measure with the pane shown.
    **A second pass the same day**, from a second marked-up screenshot. The
    floater says what to do: "Scroll down for lyrics / chords" ("...for
    lyrics" in the Lyrics view). The key above the choir score is gone; the
    badge on each such moment says it. **A double-tap anywhere on a card of
    words draws** (`_sbmDblBind`, on `#sbmRoot` at every render; mouse
    `dblclick`, or two touch taps within 350ms and 32px; `_sbmDblCard` is
    any `.sbm-card` holding `.sbm-lyrics, .sbm-score`, not its heading row
    of chips, a button, a field or an instrument strip; `_sbmDblDraw`
    brings the pen out once however it arrives). Asked, the operator chose
    this over the double-click that edited a choir line where it sat, so
    `sbBindChoirRecorders` no longer binds `lhcVoiceEdit` inside `#sbmRoot`
    (the printed pages and the song library keep it), the score's "+ chords"
    hint is hidden there, and `#sbmRoot .sbm-card` is `touch-action:
    manipulation`, or two taps zoom. **Practice Tracks' timeline** is a
    range input (`.sbm-player__range`): dragged, its time follows and a take
    playing follows the finger; let go, the take is there; set while paused,
    the take starts there. Ten seconds back and on (`sbmSkip`). The length
    is the file's once known, else `song_recordings.duration_sec`
    (`_sbmPlayerDur`): a recorded .webm reports none, and seeks fine anyway.
    `_sbmScrub` holds off the file's own time while the thumb is held, and
    lets go once the range loses the focus, for a drag a scroll cancelled.
    **A third pass the same day.** The tiles are one row, More at its end:
    Record, Tracks (Practice renamed), YouTube, Book Mode, Drawings, Edit,
    More; Links, Browse, Versions and Medley went into More, where Links and
    Browse online took the places of Read in full screen and Edit choir parts
    (the Book Mode and Edit tiles do those), and every icon has a colour of
    its own (`rows[i][3]`; Playlist's `fa-list-music` is not in Font
    Awesome's free set, so it had no icon -- `fa-circle-play` now). The
    floater is bright yellow (`#ffd60a`) and 10px taller (56px). **The first
    songbook opened on a device** (first asked "First time per device"; then
    "only at the initial opening of a songbook when the app is first opened"
    -- held in memory -- and phones reopen the app all day, so singers met it
    again and again; 2026-11-08, "only the first time the songbook is
    accessed": kept on the device, `lhc_sbm_intro_seen_v2` (`_v2` the same day: the first key had been used up by the card's older versions, so every device was given it once more) through
    `_sbmSeenHere` / `_sbmSeenMark`, the page's `_sbmIntroDone` standing in
    where the browser keeps nothing) a flash of 2.5 seconds (it was five)
    comes whenever the words are not yet up the screen
    (`_sbmIntroWant`: a desk with a few lines in sight too, the floater after
    it) (`_sbmIntroShow`, on `#songbookLiveModal`): half the screen tall and a
    cartoon -- a yellow card with a thick outline and a hard shadow,
    wobbling, rays turning behind it, "Scroll down!" in bubble letters, a
    phone whose song scrolls up for ever under a white-gloved finger
    (`_sbmIntroArt`, the lines drawn twice and slid up one set's height,
    `--sbm-set`), falling arrows and a bar emptying over the 2.5 seconds,
    the card flashing three times; a tap anywhere or Got it ends it, and
    the floater takes over (`_sbmIntroEnd` -> `_sbmGuideCheck`). It is
    never shown in the desk's Phone view. The floater does NOT wait for the
    flash: every song opened -- the book opened or reopened, another song
    chosen (`_sbmGuideUpdate` arms `_sbmGuideSong` / `_sbmGuideFresh`,
    `closeSongbook` clears it) -- with its words not yet up the screen
    (`_sbmIntroWant`) gets it, asked for a second and a half after the
    render. Once the flash became once a device (#409), a desk -- words
    halfway down, the band where `_sbmGuideWant` keeps what it was -- had
    stopped showing the floater after any reload.
    Testing in a hidden browser pane: its animations sit at their first
    frame, so turn them off in the test page to see it.
    `tools/songbook-reading-view-harness.js` checks all of it.
    **Coach marks** (the operator, the same day, "both for mobile and desktop
    users"), the recordings sheet's and Tracks' once each time the app is
    opened, the drawing hint once on each device (`_SBM_COACH_ONCE`:
    `lhc_sbm_draw_hint_seen_v2`; More > Show the tips again, `sbmReplayTips`, plays the card from the song's top and then the drawing hint on the words, whatever the device has seen), none in the Phone view (`_sbmCoachDue`,
    `_sbmCoachSeen`): a layer on `<body>` at z-index
    3800, over the recordings sheet (3750), that lets taps through except on
    its own buttons, follows what it points at (`__place` every 200ms -- the
    sheet's list loads under it) and goes by itself (`_sbmCoachOpen` /
    `_sbmCoachClose`). The recordings sheet (`_sbmCoachRecord`, from
    `sbOpenRecordings`): four seconds, a ring numbered 1 on the kind of take
    (`#sbRecCategory`: whole song, an instrument, a voice part; a section has
    its own mic in the song) and 2 on Record, a gloved finger pressing it;
    gone when Record is pressed or the sheet closed. A take stopped
    (`sbToggleRecording`, which the floating Stop pill also calls):
    `_sbmCoachTracks`, five seconds, the Tracks tile brought into sight above
    the sheet, a ring on it that opens Tracks and arrows up to it. Ten
    seconds into a songbook (2026-11-08; it was two minutes:
    `_SBM_DRAW_HINT_AFTER`, `_sbmCoachClock`, a 1s tick from
    `_sbmGuideUpdate` counting only while the book is open, in front and not
    hidden, at most 2s a tick, waiting while `_sbmCoachBusy`, until drawing
    is known to be there and the song's words are in sight,
    `_sbmCoachDrawAt`): `_sbmCoachDraw`, seven seconds and NO CARD -- a
    finger double-tapping a word of the first line of the song wholly on the
    screen (`_sbmCoachWordBox`: a `.wo-lyrics-lyric-line` or a `.vl-words`,
    the word found by Range), a red ring drawing itself round it, "Double-tap
    the words to draw" under it, and while the Draw chip is in sight a ring
    round it, arrows up to it and "or tap Draw"; the captions stay over the
    words card. It follows the words as they scroll and hides while they are
    out of sight (`is-away`); every tap goes through it and takes it away
    (a capture `pointerdown` listener, which `_sbmCoachClose` removes).
    `closeSongbook` closes any coach mark.
    `tools/songbook-coach-harness.js` checks them.
    **On a phone (2026-11-07, measured, every browser).** The tiles stay one
    row, but at 10px on one line "Book Mode" was wider than its tile on every
    phone up to 430px and "YouTube" / "Drawings" up to 390-412px, so each ran
    into the next: between 360 and 600px a label may break at its space, the
    tile has no side padding, and the size is `clamp(8.5px, 2.45vw, 10px)`.
    The four view modes were cut to "Ch...", "Lyri...", "Chords + Ly...",
    "2 ..." beside the key: under 600px the short ones share a row and
    Chords + Lyrics (`data-view="both"`) takes the next, in the room the
    key's hint leaves, so the card is no taller.

70. **The home page's two cards with chips are not buttons, and search is
    by the start of the title.** From the operator (2026-11-07). "Songs /
    Songbooks" (was Song Finder) shows the three songbooks OPENED last on
    this device, a service's book (8 Nov's, say) as much as one of My
    Songbooks -- `openSongbook()`, which every way in ends in, records it
    (`_sbRememberOpened`, `lhc_recent_songbooks`), and `_homeRecentBooks`
    merges that with the newest of My Songbooks to fill in, leaving out an
    order deleted (`STATE.orders`) or a songbook the database says is gone
    (but not one merely opened since the last read). A service's chip opens
    its Songbook (`openSongbookFromOrder`). Worship Orders shows the three
    orders edited last (`renderHomeRecent`, from `renderHomeNavStats`; an
    order named "Service - <date>" shows its date, `_homeOrderChipName`).
    A button may not hold buttons, so those two cards are a `<div
    data-view>` with a transparent `.home-nav-hit` button over the whole
    card -- the card's click still opens its page -- and the chips sit
    above it (`z-index: 1`) and stop their click reaching the card. The
    songbooks are read lightly (id, name, date: the newest three and the
    ones opened here, by id; at most once a minute; kept in
    `lhc_home_recent_songbooks`), not by
    `SBQ_SONGBOOKS.loadAll`, which reads every row whole. Where they go
    depends on room: beside the words on a 600-768px screen only if every
    name fits there whole (`_homeRecentFit`, again on resize), else a row
    under the words; on a narrow phone that row scrolls sideways; on a desk
    they take the place of the description and count, or the five cards'
    row grows 85px. The Roster card's "N services this month" came only
    from the retired Apps Script (`HOME_STATE.rosterCurrent`) and always
    said 0; it is now set from the Supabase read Upcoming Services makes
    (`_homeRosterStat`). The Songs page finds a song by the first letters of
    its title only (`_sfTitleKey`: case, accents, spacing and a leading
    quote ignored), in the list (`applyFiltersAndSort`) and the suggestions
    (`renderSearchSuggestions`) alike; `highlightMatch` marks those letters.
    `_sfSearchHint` shows a bubble under the empty, visible box for five
    seconds as the page opens, gone on focus, typing or a tap; it lifts the
    field to z-index 60 while it shows, because `#sfCommandHeader > *` puts
    every child of the search header at 1 and the filters come later.
    From the review of #401 (2026-11-07): what a title's front is stripped
    of is `_SF_LEAD` -- spaces, punctuation and symbols, by Unicode class
    (built at run time, with an ASCII fallback) -- never a letter of any
    script: "anything but a-z0-9" took a Chinese or Tamil title away whole,
    and typing one listed every song. A box of only punctuation or an emoji
    matches titles that begin with exactly that. Only the name the app gives
    an order, "Service - <a date>", is shown as its date ("Service of Lessons
    and Carols" keeps itself), and two chips that would read alike add the
    service type (`_homeTellApart`). `loadOrders` draws the home cards again
    when Home is showing: Home draws them before that read returns. A second
    `_sfSearchHint` ends the first (`_sfHintEnd`) -- its timer used to take
    the glow and the z-index lift off the next one. The chips' icon and name
    sizes are `.home-nav-card .home-recent-chip ...`: the phone rules for a
    card's every `i` and `span` overrode them.
    `tools/home-songs-search-harness.js` checks it.

71. **Every phone and browser, not only Chrome.** Every iOS browser is
    Safari underneath (Chrome on an iPhone included), and Samsung, Xiaomi
    and Honor phones ship their own browser on an older Chromium. A review
    on 2026-11-07 rendered the app in WebKit beside Chromium (Playwright,
    with every non-GET request to Supabase refused at the network) and
    found what Chrome forgives and they do not:
    - **No regex lookbehind**, `(?<=` / `(?<!`: a SyntaxError on Safari
      before 16.4, and a syntax error takes its whole `<script>` block
      down. The one in `highlightChordsInLine` sat in a block of about
      8,000 lines. Match the character and offset by its group instead.
    - `.at()` (Chrome 92, Safari 15.4) is polyfilled by the FIRST script on
      the page, ahead of Tailwind's runtime, which calls it too. Treat any
      API from after about 2021 the same way.
    - **Prefixes Safari still needs**, written beside the standard property:
      `-webkit-backdrop-filter` (no blur at all before Safari 18),
      `-webkit-user-select` (every Safari), `-webkit-mask-image` (Chrome
      before 120), `-webkit-appearance`. `dvh` / `svh` need a `vh` line
      before them, `color-mix()` a plain colour before it.
    - **`getBoundingClientRect()` inside a CSS `zoom`** is what is on screen
      in Chrome 128+, but the element's own pre-zoom px in Safari and in
      Chromium before 128; `offsetWidth` is pre-zoom everywhere. Measure the
      ratio, never assume either: the roster's pinned date header
      (`_stickyScrollHandler`'s `syncAll`) was 21% too wide over the table
      on iPhones. It is also on `<body>`, outside `#worshipRosterView`, so it
      sets its widths `!important` in a fixed layout and checks them against
      the real header on screen. LCD Projection's Fixed layout has the same
      ratio (`_k`, `_screenTop`, `_ownRect`).
    - `webkitRequestFullscreen` returns nothing, so `.catch` on its result
      threw and stopped Book Mode before it laid out its pages. An iPhone has
      no element fullscreen at all.
    - The first script also, on iOS only: holds the viewport's
      `maximum-scale` at 1 while a field is touched or focused, which stops
      Safari zooming in on any field under 16px and leaving the page zoomed;
      and gives a home-screen install `viewport-fit=cover`, without which iOS
      reports every `env(safe-area-inset-*)` as 0 and the top bar sat under
      the clock. `html.lhc-ios`, `html.lhc-standalone` say which.
    - `color-scheme: only light` keeps the forced dark modes of Samsung,
      Xiaomi, Honor and Chrome off a page that has no dark design.
    - If jsDelivr cannot be reached, supabase-js comes from unpkg instead;
      without it the whole app stopped at its first line.
    - Icons come from Font Awesome's FREE set (6.5.1). A Pro name draws
      nothing: the bottom bar's More was `fa-grid-2`, an empty square.
    - Firefox could not be run on the review machine (Windows blocks the
      Playwright build), so it was checked from the source only.
    `tools/check-inline-scripts.py` cannot see any of this: Node parses what
    Safari 15 cannot. `tools/browser-compat-harness.js` can.
    Still open, by choice: `:has()` (13 rules) and `@container` (8) are
    dropped by Chromium before 105 and Safari before 16; what they style
    falls back to the plain layout.

72. **Earlier versions: how a song was sung before, and which service each
    take was made for.** From the operator (2026-11-08): singers asked
    whether what a service does to a song overwrites the song in the Songs
    page. It does not: a service's key, words and chords and the version it
    sings are its copy's own, and only Overwrite the Master Copy (once Make
    this the song's main version, gotcha 46) writes the song. What IS shared by every service: the choir
    parts (`song_voice_lines`), the drawings on a version (Standard too) and
    the recordings. The sheet says exactly that, first.
    **Every take says which service it was made for.** `song_recordings.order_id`
    (plain text, no foreign key -- checked: PostgREST finds no relation, and
    `deleteOrder` leaves takes alone, so a deleted service's takes stay and
    say "a service since deleted"). The Record sheet always wrote it; now the
    line and section recorder does through `lhcVoiceRec.orderId` (a hook set
    by `_sbRecHooks`, from `_sbmLoadRecs` and `_sbmInstHooks`), answering
    `_sbRecOrderNow` -- the order or standalone songbook in front, ONLY while
    the songbook is open, so a take recorded from the song library's Choir
    parts tab is nobody's service. A cut (`sbmCutSave`) keeps the service of
    the recording it was cut from. `_sbRecFrom(rec, hereId, names)` (pure)
    says what a take shows: `here` (teal, "Made for this service" / "in this
    songbook"), `other` (amber background and bar, "Made for <service> · not
    this service", by name once `_sbRecOrdersLoad` has read it, each id
    once, a failed read retried) or `none` (grey, "Earlier take · the service
    was not noted" -- the takes from before 2026-11-08, never passed off as
    this service's). Tracks (`_sbmPaintPractice`) and a line's takes
    (`lhcVoiceRec.paintList`, through `R.fromLabel`) show it;
    `_sbRecFromNow` answers null while the songbook is shut.
    **One Versions sheet** (the operator, 2026-11-08: "make it more clearer
    how we can save a version ... and how to load", "less words", "not too
    many words and buttons"). `sbmVersions` / `_sbVerRender`; `sbmArrangements`
    (once Copy an arrangement, then Earlier versions) opens the same sheet,
    and `_sbArrRender` is gone. On top, **This service**: what it sings now
    (key, version, drawings), "Changes here stay here unless you save them",
    and two big buttons -- **Save as a version** (`sbVerSaveAsk`: one
    `customPrompt` for the name, the service's title offered, then
    `_sbVerSaveNamed`) and **Save as the main song** (`sbVerMakeMain`), which
    reads "Same as the main song" instead when the service's way already is
    (`_sbVerMainOf` against the library song); Update it appears only when
    the copy has drifted from the version it chose. Then **Past versions**,
    one list (`_sbVerOrder`, pure): the main song first, this service's
    other copies, then everything else newest first -- earlier services,
    saved versions, earlier main songs (kind `kept`, the oldest called
    Original). A row opens it read-only (`sbEvOpen`); its one button is
    Use (`sbArrCopy`: `main` -> `sbVerUse('')`, `version`/`kept` ->
    `sbVerUse(vid)`); the one being sung says Singing now. Rename and
    Delete (a version) and Make it the main song again (a kept one) are in
    the read-only view, not the list (`sbVerRename` is `sbVerRenameAsk`, a
    prompt). Then **Medleys**: Save this medley (`sbVerSaveMedley`,
    `_mdsKeep`) when the song is in one, and the medleys it was sung in.
    A saved medley keeps each song's VERSION as well as its key
    (`_mdsRowOf` writes `versionId`); `mdsUse` collects them and Save medley
    puts each song on its version (`_mdsApplyVersions`) before its key.
    It opens from a purple **Save / Load Versions** tile between Edit and
    More (`vTile` in `_sbmRender`, `.sbm-tile--ver`; 2026-11-09, the
    operator: "for easier access"), offered wherever More offers it
    (`_sbmOrderBook() || _sbVerOk === true`), and from More's row of the
    same name. Eight tiles on a phone measured 1-4px too narrow for
    "Drawings" and "YouTube" at 375px, so an eight-tile row closes its gap
    to 2px and sets its labels at `clamp(7.5px, 2.2vw, 10px)` between 360
    and 600px; under 360px it is two rows of four, as before. The read-only
    preview (`data-sheet="earlier-open"`) is 470px on a desk, 10px wider
    than any other sheet.
    **A name saved twice REPLACES** (the operator, 2026-11-09). Two saves
    called "Service - Nov 8" of Unto Thee O Lord sat side by side looking
    the same, and were: the first had been sung since it was saved, so the
    16 drawings made after it went onto it, and the second copied them.
    `_sbVerSaveNamed` (both saves, `sbVerSaveAsk` and `sbVerCreate`) reads
    the versions again (`_sbVerLoad`) and looks for the name
    (`_sbVerSameName`, pure: case and spacing ignored, an earlier main song
    never counts, the one this copy sings first, else the newest). None ->
    `_sbVerSaveAs`. One -> a warning toast (`_sbVerWarnToast`: amber, from
    the foot of the screen, z-index 10003 over the sheet; "<name> is already
    saved", "Replace it with this service's key, words and drawings?", how
    many OTHER services sing it; Cancel has the focus, Esc cancels,
    `closeSongbook` cancels one left open), and Replace runs
    `_sbVerReplace`: the row written over in place -- same id, so every
    service on it stays on it -- with this copy's key and words, read back;
    when the copy sings another version, that version's drawings are copied
    onto it FIRST and its own old ones (by the ids this device knew) taken
    off after. When the copy sings it already, its drawings are its own and
    only the key and words are written. Rename does not check names.
    **Recall hints.** A copy is NEW to its service (`_sbEvFresh`) while it
    is on no version, in the song's own key and has no words of its own --
    words the same as `masterLyrics` are none, and formatting alone
    (`richLyrics`) is not a way of its own, since the Songbook writes it by
    itself. A new copy of a song with past versions pulses its badge
    (`is-pulsing`, `data-ev-fresh`, set by `_sbEvBadge` and kept by
    `_sbEvCount`), and the first time on a device (`_SBM_COACH_ONCE.recall`)
    a finger taps the badge with "Sung before -- tap to use a past version"
    (`_sbmCoachRecall`, asked again every 1.5s for a while by
    `_sbmCoachRecallSoon` while something else is up). The first time the
    sheet opens with past rows (`recallPick`), a finger points at the newest
    one's Use: "Newest first. Tap Use to sing it that way"
    (`_sbmCoachRecallPick`). Both are drawn by `_sbmCoachTapHtml` /
    `_sbmCoachTapPlace`, let every tap through, and go by themselves; More >
    Show the tips again plays the badge hint after the drawing hint
    (`_sbmReplayRecall`).
    What the sheet reads: the song's other copies in this service, its copies in
    earlier services (`_sbArrEarlier`, standalone songbooks left out as
    before, each row with its `orderId`, `entryId` and the medleys of that
    order containing it), its saved versions (`_sbVers`, not the kept main
    ones) and the medleys it was sung in -- an earlier service's, rebuilt
    from `template.medleys` entry ids, which ARE `order_items` ids
    (`_sbEvMedleys`), and saved medleys holding it (`_sbEvSavedMedleys`).
    Each card counts the drawings on its version (`_sbmMarksOf`, so the
    reader's layers apply) and, for an earlier service, the recordings made
    for it; each row opens (**Open**) and has **Use**. Use is `sbArrCopy` --
    key, words, version, page marks, one step with Undo -- or, for a saved
    version, `sbVerUse`; for a medley, `sbEvUseMedley` opens the medley
    editor and runs its own Use (`mdsUse`) on a row made from the medley, so
    the songs the book lacks are added and Save medley puts each in its key.
    **Open** is read-only (`_sbEvSongOpen`): the words and chords in its key
    (`_sbBkLyricsHtml` of a stand-in song, `_sbEvTemp`, id `__sbev__`), on a
    card of the sheet that carries that stand-in (`card.__sbmSong`, which
    `_sbmCardSong` reads first), so the reading view's own painter
    (`_sbmMarksPaint`) draws the drawings of THAT version -- on a canvas made
    by hand, without `_sbmMarkCanvas`'s pointer handlers, so it cannot be
    drawn on. A song with choir parts gets a second tab, Choir parts
    (`sbEvTab`): Book Mode's read-only score (`_sbChoirBodyHtml` +
    `_sbChoirCss`, in the version's key, once `_sbLinesReady` has the parts)
    on its own card, whose moments carry the score's `s:` anchors, so the
    same painter draws the score's drawings there (`_sbEvMountOne` per card;
    each tab counts its drawings, `_sbEvViewSplit`). The parts are the
    song's as they are now -- not stored per service -- and the card says
    so. Under the words, the recordings made for that service,
    each marked (`_sbEvRecRow`), playable by one player (`sbEvPlay`) with
    the three ways back to rest (gotcha 23); closing any sheet stops it. A
    medley opens as its songs (`_sbEvMedleyOpen`), each to open in turn.
    **The badge** under the song's title (`_sbEvBadge`, in a service's
    songbook only, like More's entry): earlier services (never this one or a
    songbook) plus saved versions, counted once a song every five minutes
    (`_sbEvCount`) and drawn into the badge in place, hidden at nought.
    `tools/songbook-earlier-versions-harness.js` checks it, the Versions
    sheet, the recall hints, the tile and the replace too.

73. **A slide's PART is carried down, never written -- and a heading is
    never projected.** From the operator (2026-11-08), on a marked-up
    screenshot of the LCD rail: the eighteen slides of one song were a flat
    run of rows with the song's title on every one, and nothing said where
    Verse 1 ended and the Chorus began. They wrote "Verse 1" and "Chorus" on
    it by hand and asked for chunks, coloured badges for a song's parts, and
    headings they could add themselves to liturgy, which has no markers.
    - `parseLyricsIntoSlides` hangs `[Verse 1]` on the slide the marker
      opened and leaves the two or three that finish the verse with nothing.
      `_lcdSlideParts(headers)` (pure) fills that run in and returns the runs
      the rail chunks by. It is a READING of the slides: writing the label
      onto each slide would be the obvious fix and is the wrong one, because
      of the next point.
    - **A heading lives in `.wo-slide-section-header`, a SIBLING of
      `.wo-slide-content`, and `selectSlideBox` projects the text of
      `.wo-slide-content` and nothing else.** That is the whole reason a
      heading can be added to any slide at all. Put one INSIDE
      `.wo-slide-content` and "VERSE 1" goes up in front of the
      congregation. `_lcdWriteSlideHeader` inserts before, always.
    - `collectOrderItems` already saved `slides[].header` for songs AND for
      liturgy, and `addSongToServiceSection` already restored a song's. Only
      the liturgy LOAD never did, so a heading added to liturgy lived until
      the next load and then quietly vanished. No new column, no migration.
    - `_lcdPartKind` is a LIST, not a chain of `indexOf`, because order
      decides the answer: "pre-chorus" contains "chorus".
      `getSectionTypeClass` asked about chorus first and so could never
      return `prechorus` -- that class had never once been applied. Fixed
      there; the same mis-ordered chain is written out three more times
      (`getSectionType` twice, `getSectionClass`) for the song preview and
      the Lyrics Editor, and those are left alone as outside this path.
    - **The rail does not hold its place by itself.** Replacing its markup
      clamps its scroller to the top, and `_lcdWatchSelectedRow` then reveals
      the SELECTED row -- the slide on the screen. Measured at 1158px:
      labelling slide 4.8 sent the rail from 2072 to 214. Anything that edits
      the schedule from somewhere other than the projecting slide calls
      `_lcdRailHoldScroll()` FIRST (the position is only right before the
      change) and the watcher stands down for a window, not for one reveal:
      one edit brings several rebuilds -- the render, then the save's own
      120ms refresh. Revealing the labelled row instead was tried and does
      not work: at 80ms it is still in view, so the reveal is a no-op.
    - A row under a heading row shows the WORDS, and drops the item title
      and the icon that the heading row already carries -- the same "said
      twice" rule as gotcha 11. A row with no part is unchanged. Measured at
      the operator's 1158px, where the rail is 252px: the words get 111px,
      which is tight, and is the width the column has.
    - **The rows that carry a TITLE are black with white text** (the
      operator, 2026-11-09): the section band (`#13161b`, keeping its gold
      left edge) and, a shade lighter, the song / liturgy / reading /
      presentation it holds (`#1b1f26`), each keeping the icon that says
      which kind it is. The VERSE / CHORUS badges are NOT in this — asked
      directly, the operator chose to keep them coloured, and they are the
      one thing on this rail that is colour-coded on purpose. All of it is
      scoped by `#lcdCompactRail`, an id, because every one of those
      selectors is also set by a class-only rule elsewhere in the sheet and
      source order would otherwise decide it.
    - **All Slides is on the console, UNDER the projection, not in the
      controls row.** Asked for "here too" on a screenshot of that toolbar;
      measured at 1536, the controls row is one line of 44px with 490 of its
      517px already spent, so a seventh labelled button made it two lines —
      44px taken out of a 291px projection, on the panel the same operator
      asked to be the main view two changes before. It sits beside
      "+ Add Slide" instead, which has the width and is the same kind of
      action, in a deeper blue than Project: Project is the one control on
      that panel that puts something in front of the congregation and must
      not have a twin.
    `tools/lcd-rail-parts-harness.js` checks all of it.

74. **The songbook's font is the reader's, and a chord sheet only takes a
    fixed-width one.** From the operator (2026-11-09): a font toolbar in
    place of Reset Layout (still in More), for the songbook and Book Mode.
    It is a picker (`_sbmFontPickerHtml`, `sbmFont`) kept on THIS DEVICE
    (`lhc_sbm_font`), never in the songbook or the order -- one singer's
    choice must not change another's screen, as the part a singer follows
    (gotcha 26). A chord sheet places its chords by character column
    (gotcha 38), so the fonts are two kinds (`_SBM_FONTS`, `mono`): a
    FIXED-WIDTH one (Roboto Mono, Courier Prime) changes everything --
    the chord and lyric lines, the choir score's chord rows and a desk's
    choir words, Book Mode's chord lines -- and any other (Atkinson,
    Merriweather, Georgia, Lato, Poppins) changes only the words shown
    without chords: the Lyrics view, a phone's choir words, Book Mode's
    words. The styles read two variables set on `#songbookLiveModal` at
    every render (`_sbmFontApply`, after the notepad's guard): `--sbm-words-
    font` (any font chosen) and `--sbm-grid-font` (a fixed-width one only);
    every chord grid rule is `font-family: var(--sbm-grid-font, <the
    standard stack>)` -- the desk's, a phone held upright's late rule, the
    inline chords, `--vl-mono` -- and Book Mode's styles are built with
    `_sbmFontWords()` / `_sbmFontGrid()`. A phone held upright set even the
    Lyrics view in the fixed-width grid; a chosen font for words now
    reaches it (`.sbm-lyrics--nochords .wo-lyrics-lyric-line`), and with
    none chosen it is as it was. Web fonts are fetched from Google Fonts
    the first time they are chosen (`_sbmFontLoad`) and the view drawn again
    once they are in. Anything new that draws a chord grid must read
    `--sbm-grid-font` or `_sbmFontGrid()`. **The master copy:** Versions'
    two saves are "Save this Version" and "Overwrite the Master Copy"; the
    library's own song is "Master (From Song Library)"; overwriting it --
    or putting an earlier one back -- first asks through `_sbVerMasterWarn`
    (`lhcAskDelete` with a warning sign, the song and its key before and
    after, Keep the master first; `okIcon` lets it carry a crown).
    `tools/phone-bar-font-master-harness.js` checks all three.

75. **Projected words WRAP; they never shrink to fit a line.** From the
    operator (2026-11-10), on a screenshot of the full-screen presenter view:
    the projection should read like that view, and "if the words can't fit in
    the same line, then push it to the line below automatically, don't shrink
    the fonts just to fit the line". It was not subtle. Measured in the real
    projection document at a true 1920x1080, with the default 5vw:
    "L: Almighty God, to whom all hearts are open, ..." came out at **38.4px**
    and "C: Amen." at **96px** — two slides of the same prayer, two and a
    half times apart, because `_fitProjectionText` shrank the whole slide
    whenever ANY line was too wide.
    - The fit loop now tests the HEIGHT alone. That test STAYS:
      `.projection-content` is `overflow: hidden` and a wall has nothing to
      scroll, so a slide with more lines than the screen holds would otherwise
      lose its last lines in front of everybody. Slides are broken by hand and
      rarely reach it, so the size is steady across a service.
    - **`.projection-text` needs `max-width: 100%`, and that is the piece that
      is silent when it is lost.** It is a flex item in a centred flex
      container, so without a cap it sizes to MAX-CONTENT and `overflow-wrap`
      never gets a line box to break against. Measured, with the shrink
      removed and before the cap went in: a 75-character word with no space
      came out 3374px wide in a 1728px safe zone, 823px clipped off the left
      and the rest off the right — the word simply gone from the wall. The
      old shrink-to-fit had been hiding that.
    - The presenter overlay follows the same rule (`_fitFullscreenText`),
      because it is the view the operator reads from and the two must not
      disagree on exactly the long line that prompted this. Its safe-zone
      width goes to the element as a `max-width`, which also keeps the words
      inside the barrier: `.wofs-inner`'s own max-width is 90% of the overlay,
      a different boundary. With the default 5% barriers the two coincide, so
      that part is a no-op until somebody sets an uneven safe zone.
    - The base size is unchanged and still the operator's: `5vw`, the Text
      settings slider (2—10vw), scaling with whatever projector is plugged
      in. Asked directly, the operator chose to keep the size on the wall and
      fix only the shrinking — matching the presenter view's fixed 44.8px
      would have roughly halved the words on a 1080p projector. Only the line
      spacing was matched to it (1.5 -> 1.6). The projector keeps its heavier
      text-shadow, which is for legibility over a lit background.
    - The small Program / Live preview is NOT in this: it has no fit function
      (it already wraps) and its sizing is tuned per phone width. Leave it.
    - **The projected size is 6.5vw** (2026-11-10, "please increase it to
      125px"): 124.8px on a 1080p projector, and one exact stop of the
      dialog's 2—10vw slider. Said in vw rather than px because the operator
      chose the day before to keep the projected words scaling with the
      screen, so a bigger projector gives bigger letters rather than the same
      ones further off; 6.5vw is both answers at once. It is the DEFAULT only:
      the dialog saves per device under `TEXT_SETTINGS_KEY`, so a machine that
      has already stored a size keeps it until the slider moves or Reset is
      pressed. At 125px a four-line slide is the most that fits a 1080p safe
      zone at full size; more than that still shrinks on height.
    - **Nothing of the app's own goes on a screen the room can see.** The
      operator projects through the Project button's own window, which carries
      no chrome — but `goFullscreen` falls back to the presenter OVERLAY
      whenever that window cannot be opened (no extension, popups blocked),
      and then the operator's working view IS the output, with the app header
      over the words and the filmstrip under them. So in true browser
      fullscreen — the one state this view is put into to BE a display — the
      nav arrows, the filmstrip, its hover strip, the close button and the
      mouse pointer all go. Windowed it is unchanged, chrome on hover as
      before. `display: none !important` is needed, not laziness:
      `.wofs-filmstrip` sets `display: flex` of its own. Esc still exits, so
      hiding the close button strands nobody. Both the standard and
      `-webkit-full-screen` forms are written, per gotcha 71.
    `tools/projection-text-wrap-harness.js` checks it, and lifts the
    projector's fit loop out of the HTML string it is written into so the loop
    itself is run, not just matched.

76. **The bulletin stores no duties, and that is the whole design.**
    `bulletins.data` holds only what somebody types. Both Sundays' duties
    and the four readings come out of `roster` on every open, through the
    same role ids the roster itself defines -- a bulletin keeping its own
    copy would quietly disagree with the roster the week a reader swapped,
    and nobody proof-reads a printed bulletin against the roster on a
    Sunday morning. The two exceptions are **Acolyte** and **Flower
    Offering**, which have no roster role at all and so are typed
    (`data.manual[rowKey][dateStr]`). `tools/bulletin-harness.js` checks
    every role id the bulletin names against the roster's own list, which
    is the check that catches a renamed role before it prints blank.

77. **The liturgical cell is JSON, as a STRING.** `roster` keeps
    `liturgical` as `{"day":"25th Sunday after Pentecost","color":"Green"}`
    -- text, not an object -- so unwrapping `v.day` alone leaves the braces
    on the page, which is exactly what the bulletin's masthead printed the
    first time. Read it with `_litDay`: parse when it parses, keep the raw
    text when it does not, because a cell typed by hand is plain text and
    has to show what it says (the same rule `enablers-calendar-harness.js`
    already guards elsewhere). Two more things the page itself taught:
    an A4 sheet does not grow, so the bulletin CLIPS and says "Too long
    for one page" rather than pushing its footer off in silence; and the
    scale that fits the sheet to the screen goes on the WRAPPER, never on
    `.blt-sheet` -- html-to-image captures the node at its own size, so a
    transform on the sheet is baked into the PDF. A third: a PLACEHOLDER
    belongs to the editor, not to the page -- `.blt-ed:empty::before`
    unscoped printed the words "The theme verse" and "REFERENCE" across
    the masthead of any bulletin whose verse had not been typed yet, so
    it is scoped `.blt-sheet:not(.blt-capturing)` like the hover outline
    and the add/remove controls. The sheet is scaled to fit and the
    toolbar zooms it; the stage is centred by AUTO MARGINS, never
    `justify-content`, because centred overflow runs off both sides and
    the left of a zoomed page could then never be scrolled to. The
    announcements are numbered by a CSS counter, not `list-style`:
    something in the app's own CSS strips list markers, so the `<ol>`
    numbered nothing.

78. **`.claude/preview-server.js` serves the app READ-ONLY, and fails
    closed.** The Supabase URL and anon key are in the page, so a local
    run talks to production (a "throwaway" order once created a real row
    and six storage files). The server now forces the Phone-view write
    guard on and strips the SECOND supabase-js tag, which would otherwise
    replace the wrapped `createClient`; both anchors are matched by REGEX
    because Index.html is CRLF and a literal with `\n` silently matches
    nothing. If either anchor moves it refuses to serve rather than
    serving a writable page. It also falls back to `public/`, since Vercel
    serves that at the root. `LHC_ALLOW_WRITES=1` turns all of it off --
    only for work that really is meant to write to production.

79. **The bulletin's prose fields hold sanitised HTML; everything else
    holds words.** The theme verse, the prayer and both halves of an
    announcement are `contenteditable="true"` with `data-rich="1"`, read
    by `_richOf` and drawn through `_richClean`. Only `b/strong/i/em/u/s`,
    `<br>` and a `<span>` carrying colour, family, weight, style or
    decoration survive; everything else keeps its WORDS and loses its
    markup, so a pasted table becomes its text and a `<script>` becomes
    nothing. Stored HTML is walked again before it is drawn, so a row
    written by anything but this page still cannot put markup on a
    bulletin. Every other field stays plain and is read by `_textOf`, and
    a PASTE is inserted as plain text even into a rich field: formatting
    is applied here, never inherited from whatever site the words came
    off. `tools/bulletin-harness.js` parses real HTML into real nodes to
    run the sanitiser rather than matching its source -- minidom has no
    text nodes or sibling walks, and a sanitiser asserted on by regex is
    a sanitiser nobody has tested.

    **Undo is the bulletin's own**, because `render()` replaces the
    sheet's HTML and takes the browser's stack with it: whole snapshots
    of the stored data, 60 deep, read back through `_sane` so an undo can
    never put a shape on the page that a load could not. A RUN of typing
    is one step (1.4s apart starts a new one), and the snapshot is taken
    BEFORE the keystroke is written. `execCommand` fires an `input` event
    of its own, which reached the typing handler and opened a second,
    typing-shaped step on top of the formatting one -- so undoing a
    single Bold took two presses. `_applying` stands the handler down
    while a command runs; `_applyCmd` writes the field itself the moment
    it returns.

    **The page is centred by a wrapper.** `.blt-stage__box` carries the
    scaled footprint and `margin: 0 auto`; `.blt-stage__inner` carries
    the transform. Doing both on one element meant `_fit` setting a
    negative `marginRight` to size it, which cancelled the centring --
    an auto LEFT margin against a fixed RIGHT one pushes a box right,
    and the bulletin sat off-centre at every zoom.

    **The QR takes a picture three ways** -- clicked, dropped, or pasted
    (one copied out of a banking app is on the clipboard, not in a file;
    paste reaches the document, so the slot with FOCUS is the one it
    lands on). All three go through `_qrAccept`, which turns anything
    that is not an image away and scales the rest to 512px through
    `_qrShrink`: PNG first, so a plain QR keeps its edges, then JPEG at
    0.85 and 0.6, because a QR PHOTOGRAPHED against anything patterned
    is photographic content that PNG cannot compress -- a 512px noisy
    square is about a megabyte, and refusing it was the old behaviour.
    Always drawn on a WHITE ground: a transparent PNG over the gold
    block has no quiet zone and will not scan, and JPEG has no alpha at
    all.

    **The sheet is READ; the dialogue is where it changes.** Nothing on
    the page is `contenteditable` any more -- `_ed` / `_edRich` /
    `_edBlock` render `.blt-view` spans, and only `_dlgField` makes an
    editable one. Two ways to write one field meant two code paths for
    it, and the in-place one was 10px type nobody could aim at on a
    phone. A block opens on a double click AND on a double TAP: the page
    allows zooming, so a double tap is a zoom and the browser keeps it
    (gotcha 28), which is the same wall the roster hit --
    `_bindOpeners` is the two-taps-inside-400ms shim, bound per block,
    `passive: false` so the second tap can be stopped from zooming, and
    re-bound after every draw. The controls inside a block (the QR slot,
    the +/x, the pencil) are excluded, or tapping them would open the
    form over what was just pressed. The pencil is `opacity: .9` under
    `@media (hover: none)`, since a touch screen never hovers and that
    is the one place the double tap most needs announcing. The dialogue
    opens CENTRED at every width.

    **Every block opens a DIALOGUE** (`SECTIONS`, one spec per block;
    `openSection`). An A4 page set at 10px can be typed on, but it is
    squinting work, so a double tap on each block opens the same fields
    at a readable size with the formatting bar inside the dialogue
    rather than in the toolbar -- undo and redo stay there, being about the
    whole bulletin. A dialogue's fields carry the SAME `.blt-ed` classes
    as the sheet's, so `_applyCmd` and `_noteSelection` reach them
    unchanged, and its lists add and remove through the same `addItem` /
    `removeItem` the sheet uses, so there is one definition of what an
    item is. Typing in it redraws the sheet behind, debounced -- the
    page is what is being edited, not a separate preview.

    **The duty table declares its columns** (`<colgroup>` 28/36/36).
    `table-layout: fixed` with no colgroup splits three columns evenly,
    so short duty labels had as much room as cells holding three names.

    **A phone opens the bulletin at 87%, not fitted.** Fitting A4 to a
    phone lands near 45%, which is a picture of a bulletin rather than
    something anybody can read or correct; 87% shows the left-hand
    column legibly with the duty table starting beside it, and the page
    scrolls from there. Set only on arrival (`_zoom == null`), so a size
    the reader chose is not taken off them, and the stage is scrolled to
    its LEFT edge once -- centred, a phone would open in the middle of
    the duty table.

80. **A reading that skips verses comes from the ESV in pieces, and every
    piece is read.** From the operator (2026-11-11): "Isaiah 61:1-4, 8-11"
    was put into the service as verses 1-4. The ESV answers a reference in
    pieces ("Isaiah 61:1–4; Isaiah 61:8–11") with ONE PASSAGE PER PIECE, and
    `app/api/bible-passage` read only `passages[0]`; it now reads them all,
    in order (`esvVerseLines`), a line a verse, the verse numbers showing
    where it skips. The free WEB service already answered such a reference
    whole, and a reading that runs into the next chapter ("Isaiah
    61:10–62:3") was always one piece. Readings saved cut short before the
    fix (four upcoming on 2026-11-11: Zephaniah 1:7, 12-18; Ezekiel 34:11-16,
    20-24; Isaiah 61:1-4, 8-11; John 1:6-8, 19-28) mend themselves: an
    upcoming order opened in the builder checks each reading's words against
    its reference (`_woRefPieces`, `_woReadingGaps`: each piece's first
    verse among the "[n]" numbers; it cannot tell for one piece, a psalm --
    whose numbers `_woScriptureSlides` takes out -- or a numbering that
    matches nothing, and then leaves it alone), fetches again any that lack
    a piece, and puts the passage in only when it is WHOLE
    (`_woReadingWhole`) -- through `_woScriptureSlides`, keeping its title,
    slot, Alleluia and each slide's background by place -- in one
    `_lbdChange` with Undo (`_woMendReadings`, after the roster fill in
    `_woAutoReadings('liturgy')`; once an order a session, and not while
    LCD Projection is in the page, gotcha 35). A past order is a record of
    what was read and is never touched. `tools/reading-pieces-harness.js`
    checks the route and all of it.

81. **A change made on one device reaches a projection already running
    on another, at once.** The operator asked for it (2026-11-11) and,
    asked directly, chose that the words change in front of the
    congregation rather than wait to be advanced past. Four things were
    in the way, and only the first is obvious:
    - `_orderSyncScreenBusy` returned true while PROJECTING, so the one
      state the operator cares about was the one state last-minute
      changes never reached. It no longer asks. The other guards stay --
      a slide being edited here, held unsaved words, an open slide
      editor, the Liturgy Builder -- because those are about not
      destroying words somebody is typing, which is a different thing
      from not interrupting a service.
    - Applying a change redraws the SCHEDULE; nothing re-sent the slide.
      The operator's list would have updated while the wall kept the old
      words -- worse than not updating, because the screen they read from
      would say it was done. `_lcdReproject()` runs after every applied
      delta: it re-sends the SELECTED slide (the one on the wall), does
      nothing when the words have not changed (`_lcdProjected`), and
      nothing when that slide is being typed on HERE.
    - "On air" is NOT `document.fullscreenElement`. The operator
      projects through the Project button's own WINDOW, which leaves
      this page out of fullscreen entirely, so the old guard answered
      "no" during most real services. `_lcdOnAir()` asks about
      `projectionWindow` first (in a try, since a closed cross-origin
      window throws), then fullscreen, then the presenter overlay.
    - The realtime channel (`sb-<orderId>`) was started only by the
      songbook's open paths, so a device sitting in LCD Projection was
      never subscribed. `_orderSyncStart` now starts it too -- an open
      ORDER is the condition; the songbook is one way in -- and every
      save sends `order_touch` from inside `SBQ.saveOrder`, the one
      place every path goes through. A receiver ticks TWICE (now, then
      700ms): a tick must see a difference on two passes before it
      trusts it, since a save is upsert-then-prune, so one nudge alone
      would only ever arm the check. The 4-second poll stays as the
      fallback when the channel is down.
    What a congregation sees is still protected in two ways: the sync
    BANNER still refuses to draw over a projection (`_orderSyncShowBanner`
    keeps its `_orderSyncProjecting()` guard), and the editor's own
    placeholder cannot reach the wall -- `_lcdIsSlideLine` is the one
    test for whether a line of a slide is something a congregation should
    see, called by both the projector (`_lcdSlideText`) and the rail's
    preview, which previously each had their own copy of it.
    `tools/live-projection-harness.js` checks it.

## Quick Commands for Claude Code

```bash
# Find a function (never cat the whole file -- it is ~113,000 lines)
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

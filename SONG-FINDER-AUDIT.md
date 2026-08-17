# Song Finder — audit and safety map

_Branch: `feature/song-finder-premium-redesign`. Written before any markup changed._

## The headline finding

**Most of the premium redesign brief is already built and already on `master`.**
The `sf-*` design system, the portalled Theme dropdown, the mobile primary-filter
row, the "More filters" sheet, suggestion-to-card scrolling and the promoted
resource-preview layer are all present and working. This was verified by driving
the live app at `localhost:3000` against 51 real songs, not by reading code.

So this branch is **not** a rebuild. It closes the specific gaps the existing
implementation still has, listed at the end. Rewriting what already passes would
risk the Orders/Songbook pipelines for no gain.

---

## 1. Routes and view entry

| Thing | Where |
|---|---|
| View section | `Index.html:5586` `<section id="songFinderView">` |
| Activated by | `setActiveView('songFinderView')` — sidebar `navSongFinderBtn`, topnav `topNavSongs` |
| Mobile tab bar | `#mobileSongsTabBar` → `switchMobileSongsTab(tab)` (`:17281`) — Songs / Songbooks |

## 2. Data load and normalisation

| Function | Line | Note |
|---|---|---|
| `normalizeSong(s)` | `15847` | Maps `style`↔`category`, `useCount`↔`usageCount`, joins `youtube` array to a **string**, flattens `attachments[]` to a comma URL string in `lyricsUrl` while keeping `attachments` as the array |
| `normalizeSongFromSupabase(row)` | `21999` | Supabase row → same shape |
| `populateFilterDropdowns()` | `15920` | Themes/tempos derived from data; `FIXED_KEYS` (12) and `FIXED_SEASONS` are hardcoded lists |

**Trap:** `song.youtube` is a *string* after normalisation but an *array* in
several order payloads. Every consumer splits on `/[,\s]+/`. Do not "fix" one
side in isolation.

## 3. Search, filter, sort

- `applyFiltersAndSort()` `:15961` — single filter pipeline. Searches
  `title, artist, theme, scripture, style, season`.
- `renderSongs(forceShow)` `:16050` — caps at **50 rows**; `showAllSongs()`
  `:16086` renders the full list with A–Z dividers using the *same*
  `renderSongListItem()` + `bindSongItemEvents()`.
- `clearSongSearch()` `:16936` — resets every filter and re-populates dropdowns.
- Search input bound at `:20160`, **debounced 200ms**, assigned via `si.oninput =`
  (assignment, not `addEventListener`) so it cannot double-register.
- Suggestions: `renderSearchSuggestions()` `:17427`,
  `focusSongCardFromSuggestion(songId, retries)` `:17408` — retries 4× at 70ms,
  matches on **`data-song-id`**, scrolls `block:'center'`, adds
  `.sf-suggestion-target` for 2200ms, honours `prefers-reduced-motion`.

## 4. Filter controls

| Filter | Control | Handler |
|---|---|---|
| Theme | portalled custom dropdown | `toggleFilterThemeDropdown()` `:10362`, `populateThemeFilterDropdown()` `:10378` |
| Scripture | Bible picker modal | `openBiblePickerModal()` |
| Feel/Tempo | native `<select#filterTempo>` | `:20201` |
| Key / Style / Season | custom dropdowns | `toggleFilterKeyDropdown` etc. |
| Sort | native `<select#sortBy>` | `:20201` |

**Theme storage.** Themes are plain comma-separated strings on the song row,
plus a localStorage custom list (`_getCustomThemes` / `_saveCustomThemes`).
`addFilterCustomTheme()` `:10401` already does case-insensitive dedupe against
the merged option list. **No schema change is needed for theme creation** — this
is confirmed, so the brief's "stop and explain the migration" branch does not
apply.

## 5. Cards, detail, editor

- `renderSongListItem(song)` `:16965` — monogram + resource count, title, artist,
  scripture, pills, `.sf-resource-status` availability row, action cluster.
- `bindSongItemEvents()` `:17033` — card click opens the dossier but **bails if
  the click landed on a `button` or `.song-title-link`** (`:17038`), which is what
  keeps resource buttons from double-firing.
- `openLyricsPreviewModal(song)` `:18056`. On ≥1080px the same
  `#lyricsPreviewModal` element renders **inline** inside `#sfWorkspacePanel`;
  below that it is portalled to `<body>` as a full overlay. One element, two
  presentations — do not fork it.
- Modes: `switchLyricsPreviewMode('lyrics'|'chords'|'resources')`.
- Inline editor: `lyricsPreviewToggleInlineEdit()` `:11671`,
  `lyricsPreviewSaveInlineEdit()` `:11689` → `SBQ_SONGS.updateLyrics(id, lyrics)`
  (lyrics column only), then writes back into `song.lyrics` **and** the matching
  `STATE.songs` entry. No second copy of the lyrics is kept.
- The edit textarea's `input` listener re-renders a **separate preview div**, not
  the textarea, which is why the caret is stable. Verified: caret stays at 21.

## 6. Resource preview stack

- `promoteSongResourceModal(modal)` `:18164` — re-appends the doc/YouTube modal
  to `<body>` as the last child and adds `.song-resource-modal` (z-index
  **120000**, versus `.modal-overlay`'s 10000). This is what puts a preview above
  the song workspace. Verified live at 390px: doc z=120000, YouTube z=120000.
- `openDocPreviewModal` `:18175` — three paths: Google Docs (text extraction with
  a thumbnail fallback), Drive `/preview` iframe, plain URL iframe.
- `openYoutubePreviewModal` `:18282` — `extractYoutubeId()`, autoplay on explicit
  click, `aspect-video` wrapper (measured 1.78).
- `showLinkSelectorPopup()` `:17299` — the multi-link chooser.

## 7. Orders / Songbook integration — DO NOT BREAK

- `showAddToSongbookPicker(event, songId)` `:16607` — lists Orders + standalone
  Songbooks, loads via `SBQ_SONGBOOKS.loadAll()`.
- `addSongToOrderFromFinder(orderId)` `:16709` — loads the order, **checks for a
  duplicate on `sourceId`/`content.songId`**, computes `sortOrder` as max+1,
  builds the item with `songId`, `masterLyrics`, `youtube[]`, `attachments[]`,
  `customizations.transposeSteps`, then `SBQ.saveOrder()`. The success toast
  fires **inside `.then()`**, so it is a real confirmation, not decoration.
- `addSongToStandaloneSongbook(sbId)` `:16788` — same duplicate guard on
  `songIds`, Supabase save with a localStorage fallback.
- Songbook → Song Order → LCD propagation is unchanged by this branch; nothing
  here touches `collectOrderItems` or the slide pipeline.

**`sectionId` is deliberately `''` when adding from Song Finder.** The song lands
unsectioned at the end of the order. That is existing behaviour, not a
regression, and is left alone.

## 8. Shared CSS — blast radius

Almost all Songs styling is scoped to `#songFinderView` or an `sf-`/`sb-` prefix.
The exceptions, which must not be restyled from this branch:

- `.modal-overlay` / `.modal-content` (`:2974`) — used by **every** modal in the app.
- `.lhc-card`, `.lhc-pill-button`, `.form-input`, `.form-label`, `.meta-pill` — global.
- The inline lyrics-edit textarea rule at `:1800` carries a comment explaining it
  is deliberately **unscoped**; scoping it breaks mobile sizing.

## 9. Verified live — what already passes

Tests 1–26, 28–37 and 39–40 of the brief's acceptance list pass as shipped.
Evidence gathered against 51 songs at 1536×864 and 390×844:

- 51 songs load; title search "holy" → 8; artist search "tomlin" → 2 correct songs.
- Suggestion click scrolls to the right card by id and applies the highlight class.
- Theme 31 options, portalled to `<body>`, `position:fixed`, z 100050, scrollable,
  fully inside the viewport, with a working add-a-theme box and dedupe.
- Key→8, hymn→10, contemporary→36, Christmas→2, Upbeat→7, combined→6,
  scripture "Luke 2"→1 (matches the expected count), clear→51.
- Mobile: Theme/Scripture/Feel all read exactly **"All"**; "More filters" is
  labelled correctly and holds Key/Style/Season/Sort By; stats sit **below** the
  filters; no page-level horizontal overflow at 390px.
- Doc and YouTube previews both open **above** the song workspace with Close
  on-screen; multi-link songs show a chooser.
- Transpose G#→A# at +2 and restores at 0. Caret stable while typing.

## 10. Gaps this branch will close

| # | Gap | Brief |
|---|---|---|
| A1 | **Escape closes nothing** — not the song overlay, not the Theme dropdown (outside-click works) | G, Accessibility |
| A2 | **`aria-expanded` absent** on every custom filter dropdown trigger | Accessibility |
| A3 | **No "Reset filters"** in the More filters sheet | E |
| A4 | **No unsaved-change protection** — Cancel silently discards edited lyrics | J |
| A5 | **Resource cards show no domain/source** and offer no external-open action beside preview | K |
| A6 | **Link chooser sits at z-index 10000**, the same band as `.modal-overlay`, relying only on DOM order | L, M |

Everything else in the brief is already satisfied and is left untouched.

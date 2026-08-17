# Song Finder — audit and safety map

_Originally written for the premium-redesign branch; extended 2026-08-17 for the
complete-redesign brief (Song Details workspace, dedicated editor, resource
previews, Orders/Songbook/Share flows, themes, mobile screens)._

## Read this first

The catalogue redesign, the bright repalette and the density pass are **already
on `master`**. This branch extends that design system into the remaining
surfaces; it does not restart. What follows is what must not break.

---

## 1. Names that must not be renamed

Every one of these is referenced from inline `onclick=` in the markup, from
another module, or from a `google.script.run` bridge. Renaming any of them
breaks a call site that a find-and-replace will not catch.

**View / render**
`setActiveView`, `renderSongs`, `showAllSongs`, `renderSongListItem`,
`bindSongItemEvents`, `updateResultCounts`, `renderSearchSuggestions`,
`focusSongCardFromSuggestion`, `renderSongStats`, `switchMobileSongsTab`

**Filters** `applyFiltersAndSort`, `clearSongSearch`, `resetMobileSheetFilters`,
`toggleMobileFilterSheet`, `syncMobileSongFilterPriority`,
`toggleFilterThemeDropdown`, `closeFilterThemeDropdown`,
`_positionFilterThemeDropdown`, `populateThemeFilterDropdown`,
`addFilterCustomTheme`, `updateFilterTheme`, `_sfSyncFilterAria`,
`_sfCloseAllFilterMenus`, `toggleFilterKeyDropdown`, `toggleFilterStyleDropdown`,
`toggleFilterSeasonDropdown`, `setStyleFilter`, `_msChange`

**Detail / editor** `openLyricsPreviewModal`, `closeLyricsPreviewModal`,
`switchLyricsPreviewMode`, `renderLyricsPreviewContent`, `applyTranspose`,
`toggleLyricsPreviewTwoCol`, `lyricsPreviewToggleInlineEdit`,
`lyricsPreviewCancelInlineEdit`, `lyricsPreviewSaveInlineEdit`,
`lyricsPreviewHasUnsavedEdits`, `lyricsPreviewInsertSection`,
`_lpRenderEditLivePreview`, `printLyricsPreview`, `_sfApplyAppearance`

**Resources** `openDocPreviewModal`, `closeDocPreview`, `docPreviewZoom`,
`openYoutubePreviewModal`, `closeYoutubePreview`, `openSpotifyPreviewModal`,
`showLinkSelectorPopup`, `promoteSongResourceModal`, `_sfRenderResourcesPanel`,
`_sfBindResourceActions`, `_sfClassifyResource`, `_sfExpandAttachments`,
`_sfExpandMedia`, `parseFileUrl`, `detectMediaType`

**Orders / Songbook** `showAddToSongbookPicker`, `closeAddToSongbookPicker`,
`addSongToOrderFromFinder`, `addSongToStandaloneSongbook`,
`createNewOrderFromSongFinder`, `renderSongbooksList`, `openCreateSongbookModal`

**CRUD** `openEditSongModal`, `saveEditSong`, `saveNewSong`, `deleteSong`,
`normalizeSong`, `normalizeSongFromSupabase`, `songToRow`

**Element ids** `songFinderView`, `sfSearchCard`, `sfCommandHeader`,
`sfFilterBar`, `sfFilterGrid`, `sfResultsRow`, `sfResultsGrid`,
`sfSongListCard`, `songListContainer`, `songEmptyState`, `sfWorkspacePanel`,
`lyricsPreviewModal`, `lyricsPreviewContent`, `addSongModal`, `editSongModal`,
`docPreviewModal`, `youtubePreviewModal`, `spotifyPreviewModal`,
`searchInput`, `searchSuggestions`, `filterThemeDisplay`/`Dropdown` (+ Key,
Style, Season, Scripture), `filterTempo`, `sortBy`, `sfMobilePrioritySlot`,
`sfStatsMobileSlot`, `sfMobileFiltersBtn`, `sfMobileFilterApplyBtn`,
`sfFilterSheetHome`, `sfFilterDesktopHome`, `sfMetricsDesktopHome`.

The four `*Home` span ids are **anchors, not decoration**: the filter grid, the
metrics strip and the More-filters button are physically reparented between the
page and `<body>` on resize, and those spans are the only record of where they
came from. Deleting one strands its element.

---

## 2. The three pipelines that carry data out of this page

**A. Lyrics → Orders / Songbooks / LCD Projection.**
`SBQ_SONGS.updateLyrics(id, lyrics)` writes the `lyrics` column **and then calls
`SBQ_SONGS._announceSongChange(id, lyrics)`**, which broadcasts
`song-lyrics-changed` on the Supabase realtime channel `lhc-song-library`. That
broadcast is what makes an open Order or LCD Projection pick the change up live.

> **Any new editor must save through `SBQ_SONGS.updateLyrics` (or call
> `_announceSongChange` itself). Writing the `lyrics` column directly saves the
> words and silently kills live sync** — nothing errors, it just stops updating.

`refreshSongSlidesInOrder(songId, newLyrics)` is the in-page counterpart for an
Order already open in this tab.

**B. Song → Order.** `addSongToOrderFromFinder(orderId)` → `SBQ.loadOrder` →
duplicate check on `sourceId`/`content.songId` → `sortOrder = max+1` → item
carrying `songId`, `masterLyrics`, `youtube[]`, `attachments[]`,
`customizations.transposeSteps` → `SBQ.saveOrder`. Success toast fires **inside**
`.then()`. `sectionId` is currently always `''` — the brief's section/position
picker is genuinely new work, not a restoration.

**C. Song → Songbook.** `addSongToStandaloneSongbook(sbId)` → `SBQ_SONGBOOKS.loadAll`
→ dedupe on `songIds` → `SBQ_SONGBOOKS.save`. Layout (lyrics/chords/two-column)
is **not** currently stored per songbook entry — see blockers below.

## 3. Chords and transposition — do not reimplement

`formatLyricsWithTranspose(text, showChords, steps)` is the single renderer, used
by the preview, the live edit preview and print. It calls `buildInlineChordHtml`
(word-atomic chord placement, not monospace columns) and `transposeChord(chord,
semitones)`. `transposeChordLinePrint` handles the above-the-line form.
Chord *detection* has been tuned repeatedly (see the 2026-08-14 "Am on its own"
and "lone capital" entries in HANDOFF) — treat it as load-bearing.

## 4. Storage

- **Songs**: `songs` table; `attachments` and `youtube` are `jsonb` arrays.
- **Themes**: comma-separated string on `songs.theme` **plus** a localStorage
  custom list (`_getCustomThemes`/`_saveCustomThemes`). No schema change needed
  to create a theme. Theme *colour* and *description* (reference image 5) have
  nowhere to live — see blockers.
- **Scripture**: comma/semicolon string on `songs.scripture`; picked via
  `openBiblePickerModal(mode)`; chips rendered by `_updateScriptureDisplay()`.
- **Uploads**: `sb.storage.from(LHC_SUPABASE_BUCKET).upload()` → `getPublicUrl()`
  → pushed into the `attachments` array.

## 5. Shared infrastructure

`openModal(id)` / `closeModal(id)` toggle `.show` on `.modal-overlay`
(z-index 10000). `promoteSongResourceModal` re-parents a viewer to `<body>` and
gives it z-index 120000 — that is what keeps a preview above the song workspace.
`showToast(msg, type, opts)`, `showLoader(bool)`, `customConfirm(title, msg)`.

`document.onkeydown` (single global assignment) routes Escape through
`_sfEscapeCloseTopLayer()`, which peels one layer at a time.

---

## 6. Blockers found — these need a decision before the matching chunk

None of these blocks the visual work; each blocks one *specific* feature the
reference images show. Flagged rather than invented, per the brief.

| # | Reference shows | Reality | Options |
|---|---|---|---|
| B1 | "Used 28 times in Orders • Added to 12 Songbooks", and a **Recent usage** rail listing dates | `songs.use_count` and `last_used` exist, but there is **no per-order usage history table**. The counts cannot be derived without scanning every order. | Omit the rail, or label it honestly from `use_count`/`last_used` only. A real history needs a new table (migration). |
| B2 | **History** tab on Song Details | No per-song change log exists (`RosterChanges` is roster-only). | Omit the tab rather than ship an empty one. |
| B3 | Theme **colour** and **description** | Themes are bare strings. | Either drop those two fields, or migrate themes to their own table. |
| B4 | Songbook **layout** (Lyrics only / + chords / Two column) persisted per entry | `SBQ_SONGBOOKS` stores `songIds` only. | Needs a schema change to persist; otherwise the control is decorative. |
| B5 | Add to Order **Section** and **Position in section** | `addSongToOrderFromFinder` always writes `sectionId:''` and appends. Sections **do** exist on orders, so this is buildable without a migration. | Build it — no blocker, just work. |
| B6 | Time signature, BPM, alternate title, copyright/CCLI, service suitability | **No columns exist** for any of them. | Each needs a migration, or the field is dropped from the form. |

**Recommendation:** build B5 (no migration), omit B1/B2 honestly, and bring me a
single reviewed migration covering B3/B4/B6 if you want those fields real. I have
not written that migration yet because the brief says to obtain approval first.

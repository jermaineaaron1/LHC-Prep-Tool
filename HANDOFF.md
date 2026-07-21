# HANDOFF.md — LHC Worship Prep

_Last updated: 2026-07-20 by Codex_

---

## Project Identity

| Field | Value |
|-------|-------|
| **Project name** | LHC Worship Prep |
| **Purpose** | Worship preparation tool for Luther House Chapel — manages songs, rosters, liturgy, and worship orders |
| **GitHub repo** | `https://github.com/jermaineaaron1/LHC-Prep-Tool.git` |
| **Current branch** | `master` |
| **Default branch** | `master` |
| **Vercel deployment branch** | `master` (auto-deploys on push; production URL is `lhc-prep-tool.vercel.app`) |
| **Version** | 2.8 (per CLAUDE.md) |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Monolithic `Index.html` (~18 000 lines of HTML/CSS/JS, no build step) |
| Static build | `dist/index.html` — copy of `Index.html` deployed via Vercel |
| Next.js layer | `app/` directory — API routes + `practice-game/` route linking to Vocal Hero |
| Backend (legacy) | Google Apps Script (`server.gs`) — reads/writes Google Sheets |
| Backend (current) | Supabase (PostgreSQL) via `@supabase/supabase-js` |
| Deployment | Vercel (Next.js framework preset) |
| Secondary app | Vocal Hero (separate repo: `github.com/jermaineaaron1/Vocal-Hero`) |

---

## Install / Dev / Build Commands

```bash
npm install          # install dependencies
npm run dev          # local Next.js dev server (API routes only — Index.html is static)
npm run build        # Next.js build
npm run start        # start production server locally
npm run lint         # ESLint

# Deploy to Vercel production
vercel --prod
```

> Note: `Index.html` is a standalone static file. It does not go through the Next.js build pipeline. Editing `Index.html` and `dist/index.html` are separate steps (dist is the deployed copy).

---

## Environment Variables

Defined in `.env.local` (not committed). Template at `.env.local.example`.

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key (browser-safe) |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (server-side only) |
| `PIPELINE_URL` | Optional — Vocal Hero AI pipeline server |
| `PIPELINE_SECRET` | Optional — Vocal Hero pipeline auth secret |

---

## Supabase Tables

| Table | Purpose |
|-------|---------|
| `songs` | Song library (title, key, lyrics, themes, attachments) |
| `orders` | Worship order headers |
| `order_items` | Per-item rows inside each order (songs, liturgy, content) |
| `songbooks` | Song groupings/collections |
| `roster` | Monthly duty assignments |
| `roster_changes` | Audit log of roster edits |
| `roster_names` | Canonical name list for roster members |
| `roster_member_meta` | Per-member metadata |
| `roster_unavailability` | Member unavailability windows |
| `liturgy_items` | Liturgy content library |
| `liturgy_folders` | Folder structure for liturgy library |
| `liturgy_occasion_data` | Per-occasion notes and special elements |
| `liturgy_occ_folders` | Occasion-specific folder overrides |
| `song_layouts` | Per-song slide/projection layout overrides |
| `order_media_links` | Media links attached to orders |
| `idea_inbox` | Idea/feedback inbox |
| `announcements` | Announcement items |

---

## Important Files and Folders

```
/
├── Index.html              # PRIMARY source — all app code lives here (~18k lines)
├── dist/index.html         # Deployed copy of Index.html (edit both together)
├── server.gs               # Google Apps Script backend (legacy Google Sheets)
├── server.js               # Older Node.js backend (largely superseded)
├── CLAUDE.md               # Project context for Claude Code
├── AGENTS.md               # This project's multi-agent working rules
├── HANDOFF.md              # This file — session state summary
├── supabase-schema.sql     # Reference schema (may lag behind live DB)
├── .env.local.example      # Environment variable template
├── vercel.json             # Vercel config (minimal — relies on Next.js defaults)
├── app/
│   ├── api/                # Next.js API routes (songs, score, pipeline, etc.)
│   └── practice-game/      # Route linking to Vocal Hero game
├── migrations/             # SQL migration files (create new ones here for schema changes)
├── pwa-shell/              # Progressive Web App shell
├── lhc-projection-ext/     # Chrome extension for worship projection
└── Screenshot/             # Design reference screenshots (numbered, used in comments)
```

---

## Major JS Modules (inside Index.html)

| Object | Purpose |
|--------|---------|
| `SBQ` | Supabase query helper — all DB reads/writes go through here |
| `WO` | Worship Orders module (IIFE) |
| `LiturgyModule` | Liturgy editor and library (IIFE) |
| `STATE` | Global app state object |
| `SBQ_ROSTER` | Roster-specific Supabase queries |

---

## What Is Already Working

- **Song Finder** — search, filter by theme/key/style/tempo/season, inline lyrics editor, chord transposition, YouTube links, file attachments
- **Worship Roster** — monthly calendar view, double-click editing, change history, WhatsApp sharing, CSV export, liturgical day/colour tracking
- **Worship Orders** — create orders from roster dates, add songs/liturgy/content, per-slide editing, Shift+Enter to split slides, save to Supabase cloud (multi-device sync)
- **Liturgy Module** — occasion-based navigation, season strip, three-tab per-occasion view (order / notes / special elements), content library with folders, Bible browser (api.bible proxy), scripture insertion into orders
- **Supabase backend** — all major CRUD operations migrated from Google Sheets to Supabase; RLS enabled with public-access policies
- **Vercel deployment** — `lhc-prep-tool.vercel.app` auto-deploys from `master`

---

## What Is Unfinished

### Vocal Hero modern multiplayer integration — branch `feature/vocal-hero-multiplayer`

- The Worship Prep Practice iframe now redirects from `/practice-game` to the modern React host at `/vocal-hero`; `/vocal-hero/phone?room=ABCDE` is the mobile player route, and the host can open the active room in a dedicated full-screen browser window.
- Added host QR lobby, unlimited SATB membership, ready/microphone indicators, scheduled five-second count-in plus lead-in, host-only individual analytics, normalised section-score display, mobile personal pitch/score view, phone full-board toggle, and persisted round-stat calls.
- Added `migrations/2026-07-20_vocal_hero_multiplayer_foundation.sql`. **It has not been run.** Review it, then execute it manually in the Supabase SQL Editor before using the new lobby/start/stat features. It only adds columns/tables/functions/policies; it does not remove or alter existing data.
- New runtime dependencies are not required. Production build passes when the three existing Supabase variables are present. `npm run lint` remains blocked because ESLint 9 has no `eslint.config.*` in this repository.
- Current privacy/security limitation: anonymous Supabase policies remain fully public, as in the existing game. Before public internet exposure, replace these with signed room/player tokens or authenticated RLS policies. The approved no-login user experience can remain unchanged.
- Compatibility follow-up: Worship Prep was still hard-coded to the separate `lhc-vocal-hero.vercel.app` deployment, which explains why the legacy screen appeared after the initial merge. Both `Index.html` and `dist/index.html` now load local `/practice-game?release=20260720-2`; the route is explicitly `no-store`. Older `game_notes` songs are converted to a melody-guide timeline for the new lanes. The note lanes now use DOM elements instead of canvases, avoiding the blank iframe/mobile canvas rendering failure; desktop keeps a ten-second view while mobile uses a clearer four-second, lyric-free note rail beneath the main lyric cue.
- Legacy note follow-up: `game_notes` often contains simultaneous piano-chord tones. The adapter now reduces each shared onset to the highest melody target and renders one clearly labelled shared-guide lane rather than inventing four cloned SATB lanes. Separate S/A/T/B targets only appear after an arrangement is saved in `song.notes`. Scheduling now originates on the Vercel server; host/phones compensate for measured server-clock offset, prime phone microphones before live notes, and run the phone UI at 30fps. This reduces—but cannot eliminate—acoustic speaker-to-microphone delay; Bluetooth should still be avoided.
- Arrangement editor follow-up: the Vocal Hero song picker now has an **Edit** action. It saves lyrics, MIDI pitch, start/end time, and shared-guide/SATB assignment to `vh_songs.notes`; users can add or remove targets. This is the required path to author true independent choir lanes. No migration is required because `notes` is already part of the Vocal Hero song model.
- Arrangement editor visual redesign: `app/vocal-hero/ArrangementEditor.tsx` is now a responsive dark DAW-style workspace rather than a table modal. It retains the same `vh_songs.notes` save contract, adds selectable piano-roll note targets, double-click-to-add, an inspector for voice/pitch/timing/lyrics/velocity, duplicate/remove actions, transport and zoom controls, plus compact behaviour on smaller screens. The desktop part strip, piano roll and inspector are visual editing surfaces over the existing song target data; no migration is required. The default timeline scale is 36px/second and the control now reaches 160px/second (10x the old default) for dense arrangements.
- Arrangement editor controls: Select, Draw, and Erase are now explicit editing modes; Duplicate copies the selected target; Play audibly previews the first twenty seconds of target pitches with a moving playhead; and Record requests microphone access and creates a playable local guide take. The recorded take is intentionally browser-session-only because `vh_songs` has no audio asset field or storage integration yet.
- Arrangement editor playback and resizing: drag a target's visible right-edge handle in Select or Draw mode to set its duration. Playback now supports all active voices, a selected note, or a range entered in the toolbar / created by shift-clicking a second note, with SATB toggles for any combination. The old sine-wave preview was replaced by a piano-like Web Audio instrument (harmonics, percussive attack and decay); there are no licensed piano samples or soundfont assets in the repo, so exact recorded-piano playback needs a vetted audio asset/source before it can be added.
- Arrangement editor timing follow-up: preview scheduling and the moving playhead now both use the song's original seconds (the prior implementation incorrectly divided them by two). The active note is outlined/glowed while it plays. Users can now drag across an empty Select-mode lane to highlight a time range; Play automatically switches to that isolation, audibly clipping notes to the selected boundaries, until **Clear range** is pressed.
- Arrangement editor audition UX: controls are split into a top editing/voice-audition row and a separate playback/status row. A normal SATB button click auditions that voice alone from the timeline start; shift-click retains multi-voice selection; **All SATB** and **Clear selection** reset to the beginning with all voices. A one-click empty-lane interaction clears range, voice and note selections, while an actual empty-lane drag creates the isolated range.
- Arrangement editor edit history: the top toolbar now has **Remove**, **Undo**, and **Redo**. Shift-click supports multi-note selection, and a range drag selects all targets within the range; Remove applies to the whole selection. The in-memory history retains the latest 100 snapshots and covers note additions, removal, lyric/pitch/timing/velocity edits, and one drag-resize gesture. It intentionally resets when the editor is closed or refreshed; it is not a replacement for Save.
- Arrangement editor ripple resize: changing a note's right edge now shifts every target at or after that note's original end by the same duration delta. This applies across the SATB arrangement to preserve aligned harmony and lyrics; lengthening moves later targets forward, shortening pulls them back. The whole ripple remains one undoable resize action.
- Arrangement editor 2D lasso selection: an empty-space drag now forms a rectangle. Its horizontal span determines the time range and its vertical span determines the included SATB rows; every target inside that rectangle becomes selected and only those voice rows are auditioned. A same-lane drag remains the one-voice case.
- Premium VocalHero presentation follow-up: the React host and phone player now share a neon dark visual system for song library, QR lobby/voice rosters, count-in, and live score views. It uses existing session/player/microphone/score data; room chat, audience count, profile photos, and crowd reactions from the visual concept are deliberately not fabricated because they need separate persistence/realtime features. `app/globals.css` owns the reusable visual tokens, while the host and phone routes own the state-specific layouts.

- **Worship Orders — full-screen presentation/projection mode** — planned but not built
- **Song queue management** — planned
- **SongSelect integration** — planned
- **Batch song import from spreadsheet** — planned
- **`lhc-projection-ext`** — Chrome extension for projection; partially built, not integrated end-to-end
- **Google Apps Script (`server.gs`)** — still used by some legacy paths; full migration to Supabase is incomplete
- **`pwa-shell/`** — PWA wrapper exists but offline/install behaviour is not fully validated

---

## Known Bugs and Risks

- **`order_items.created_at` column doesn't exist** — `getSongUsageStats` was querying this column causing 400 errors. Fixed 2026-07-02 by switching to `last_edited`. Both `Index.html` and `dist/index.html` were patched.
- **Supabase Realtime unreliable** — WebSocket connections drop intermittently (Supabase reported an outage 2026-07-02). All real-time features fall back to polling.
- **`dist/index.html` must be kept in sync with `Index.html` manually** — there is no automated build step that copies one to the other. If an agent edits one, it must edit the other too.
- **Screenshot reference numbers in comments** — comments like `// per screenshot 133` refer to files in `Screenshot/`. Do not delete or renumber them.
- **`order_items.backgrounds` column** — added after the original schema; code guards with `if (item.backgrounds && ...)` for backward compat. Verify column exists in live DB before relying on it.

---

## Database / Schema Concerns

- `supabase-schema.sql` in the repo root may not reflect the live database exactly — migrations have been applied manually via SQL Editor.
- Always create a file in `migrations/` before running any schema change.
- Realtime is enabled on `vh_session_players` and `vh_score_events` (Vocal Hero tables). The main worship app tables do not use Supabase Realtime — they use polling.

---

## Recent Session Notes (2026-07-04)

### Songbook annotation palette and header overflow — branch `fix/songbook-annotation-header`

- Restored the floating `#sbAnnotPalette` lost during the 3-panel redesign merge, with Pen, Highlighter, Eraser, Undo/Redo, Fine/Medium/Bold stroke sizes, six ink colors, and Clear all controls.
- Removed the obsolete `#sbDrawExtras` strip. Palette controls reuse the existing annotation engine and remain available in fullscreen.
- Palette dismissal now hides only the tools; drawing remains active. Clicking Annotate reopens a dismissed palette, while clicking Annotate again with the palette open disables draw mode normally.
- Forced the Songbook header and control groups to remain on one row, compacted icon controls, and collapse right-side labels at narrow desktop widths.
- Browser verification at 1440×900 and 1100×800 confirmed no header overflow, correct compact-label behavior, palette open/dismiss/reopen behavior, and fullscreen palette visibility. Console errors: 0. Inline scripts in both HTML copies parse successfully. `npm run lint` remains unavailable because the repository has ESLint 9 but no `eslint.config.*` file.

## Previous Session Notes (2026-07-03)

### Worship Songbook Redesign — branch `feature/songbook-redesign`

Full 3-panel songbook layout implemented in both `Index.html` and `dist/index.html`:

**HTML** (`#songbookLiveModal`):
- Background changed from `#f4f5fb` → `#141e2e` (dark navy)
- Header split into `.sb-header-brand` / `.sb-header-center` / `.sb-header-right`
- Center controls: Annotate, Undo/Redo, font A−/100%/A+ buttons
- Right controls: Share, Playlist, Full Screen, More dropdown, Saved button, Close
- Draw extras moved to a separate `.sb-draw-bar` strip (shown/hidden below header)
- Full 3-panel layout: left `#sbSidebar` (220px), center `.sb-center` / `#sbBody`, right `#sbRightPanel` (240px)
- Right panel: Selection tab (font size, annotation colors, transpose, Copy with chords, Duplicate below) + Media tab

**CSS** (new `.sb-*` classes):
- `.sb-layout`, `.sb-sidebar`, `.sb-center`, `.sb-right-panel` — 3-panel flex row
- `.sb-song-page { background:#faf9f0 }` — cream manuscript paper
- `.sb-song-page::before` — binder holes via CSS box-shadow
- `.sb-panel-*` — right panel tabs, sections, buttons
- `.sb-draw-bar` — secondary draw tools strip
- Fullscreen: hides sidebar and right panel; responsive: hides panels below 900px

**JavaScript** (new WO module functions, all exported):
- `sbFontInc()` / `sbFontDec()` — alias `sbZoomIn`/`sbZoomOut`; updates `#sbFontPct` display
- `sbToggleMore()` — More dropdown with auto-close on outside click
- `sbPanelTab(tab, btn)` — Selection/Media tab switcher
- `sbRenderSidebar()` — populates left sidebar song list from `songOrderSections`
- `sbScrollTo(songId)` / `sbUpdateSidebarActive(songId)` — scroll manuscript to song
- `sbUpdateFontPct()` — updates `#sbFontPct` and `#sbFontSizeDisplay`; called from `sbApplyZoom`
- `sbUpdateSaveBtn(dirty)` — manages the Saved/Save status button appearance
- `sbSelTranspose(delta)` / `sbSelTransposeReset()` — partial transposition on text selection
- `sbCopyWithChords()` — copies selected lyric+chord lines to clipboard
- `sbDuplicateBelow()` — clones selected lyric lines and inserts after
- `selectionchange` listener — collects chord nodes in selection, updates right panel

**WhatsApp share fix** (committed earlier, also on this branch):
- `shareSongbookWhatsApp` now builds `?sb=<id>` direct link instead of encoded playlist URL

## Recent Session Notes (2026-07-02)

- 2026-07-03: Fixed responsive Songbook chord-label collisions on `codex/songbook-chord-collision-fix`. `.wo-chord-token` now uses a two-row inline grid so each label reserves its own rendered width instead of absolutely overlapping adjacent labels above narrow lyric placeholders. Browser checks found 0 collisions among 120 chord labels at desktop and 390×844 portrait widths, with no console errors or mobile horizontal overflow.
- 2026-07-03: Reworked Songbook navigation and chord layout on `codex/songbook-layout-and-chord-reflow`. Sidebar and index clicks now calculate positions relative to `#sbBody`, native editable CSS columns replace the clipped fixed-height clone renderer, and the desktop toolbar is a stable grouped row.
- Chord/lyric pairs are enhanced only inside the Songbook into responsive word-level anchors. Chords travel with their designated lyric word across desktop columns and portrait wrapping, and editing/backspacing preceding lyric chunks moves later chord anchors naturally. Chord labels remain directly editable. Saves are serialized back to canonical chord-line/lyric-line markup before LCD slide refresh, so projection data is not polluted by Songbook-only HTML.
- Browser verification covered 1900×1000 desktop and 390×844 portrait. Both sidebar/index navigation landed about 18px below the scroll viewport top, two-column mode retained the real contenteditable element with no horizontal clipping, portrait `#sbBody` had equal client/scroll widths, and browser console errors were empty.
- 2026-07-03: Fixed fullscreen annotation activation in both HTML variants. Double-click/double-tap now works directly on `.sb-page-lyrics` and the surrounding notebook page, while buttons, links, form controls, embedded media, the palette, and the fullscreen exit control remain protected from accidental activation. Any focused lyric editor is blurred before drawing mode opens so pen input does not compete with the text caret.

- 2026-07-03: Fixed the mobile Songbook layout on `codex/songbook-mobile-scroll-fix`. At ≤820px the 794px A4 canvas now reflows to the phone width at native scale rather than being transformed down, so lyrics render at 17.28px/1.75 line-height and remain readable.
- Mobile `#sbBody` is now the explicit full-height vertical scroll container (`overflow-y:auto`, `touch-action:pan-y`, momentum scrolling). Browser verification at 390×844 confirmed an 8,097px scroll range and a successful scrollTop change from 0 to 1,236px.
- Rebuilt the phone header into a compact, fully reachable icon row and made Scroll/Page Flip plus Auto-scroll/2 Columns into two fitted rows. Song controls remain locally horizontally scrollable when needed, while the page itself no longer overflows the viewport.
- 2026-07-03: Added a notebook-style floating annotation palette with Pen, translucent Highlighter, Eraser, Undo/Redo, stroke widths, six ink colours, and Clear All. The palette is outside the hidden fullscreen header so it remains usable over lyric pages.
- Fullscreen lyric pages now treat a double-click or double-tap as an intent to annotate: the palette opens and drawing mode activates. The previous double-click-to-exit behavior was removed; fullscreen still exits through the hover/reveal Exit Full Screen control. Closing fullscreen also safely closes annotation mode.
- 2026-07-03: Completed the stronger Songbook structural makeover on `codex/songbook-structural-makeover` in both HTML variants. The global header is compact, annotation controls sit in a centered tool palette, the desktop listening rail is 420px wide, Contents/Media rails can be collapsed, and default lyric/chord typography is larger.
- Per the design decision, `.sb-page-controls-bar` is explicitly `position: static !important`; browser verification confirmed that each song header scrolls fully away with its own page and never follows the reader.
- Desktop browser checks covered the 1900x1000 composition, side-panel toggles, and notebook page typography. Mobile CSS keeps the oversized tool groups inside a horizontally scrollable header tray to prevent them from widening the app. Inline JavaScript syntax checks and `git diff --check` pass; lint remains blocked by the repository's missing ESLint 9 flat config.
- Added a second Songbook visual-polish pass on `codex/songbook-visual-polish`: two-row desktop toolbar, tactile pen/eraser palette, clearer pen colours and weights, larger media rail, stronger notebook/page hierarchy, and larger migrated default lyric typography. Existing custom font choices and all songbook behavior remain intact.
- Browser-verified the 1900px desktop layout, lyrics pages, right media rail, and active annotation palette. Inline JavaScript syntax checks pass for both HTML variants.
- Implemented the Conductor's Notebook redesign for the Worship Songbook in both `Index.html` and the newer deployed `dist/index.html` without changing the song/order schema.
- Added continuous-scroll/page-flip navigation, notebook contents rail, global two-column control, auto-scroll, docked YouTube listening, decluttered Save/More actions, and content-only fullscreen with hover exit plus double-click/double-tap exit.
- Preserved the existing editable lyrics trigger: `sbOnLyricsChange()` still calls `refreshSongSlidesInOrder(songId, song.lyrics)`, so LCD Projection slides update from songbook edits as before.
- Verification: all inline scripts in both HTML variants compile; local Next dev served the app and the redesigned songbook opened from a service order. Production build compiles but cannot finish page-data collection without the required Supabase environment variables. `npm run lint` is currently unusable because the repo has ESLint 9 but no `eslint.config.*`.
- Important: `dist/index.html` contains substantial deployed-only functionality not present in `Index.html`; do not overwrite it by copying `Index.html`. Apply future shared changes independently until these files are reconciled.
- Fixed `getSongUsageStats` 400 error (`created_at` → `last_edited` on `order_items`).
- Vocal Hero (separate repo): added cross-device Pause/Reset, piano countdown preview, countdown brightness fix (Phase 7).
- Vocal Hero: Supabase Realtime WebSocket was failing (Supabase outage). Added 1-second polling fallback on both host and phone so pause/restart works regardless. Mobile lag is now ~1 second.
- Vocal Hero Supabase SQL run manually: added `paused` and `restart_seq` columns to `vh_game_sessions` + `vh_bump_restart` RPC.

---

## Recent Session Notes (2026-07-20)

### Vocal Hero arrangement editor — MIDI import and reachable controls

- Added `src/lib/vocal-hero/midi.ts`: a dependency-free browser parser for Standard MIDI format 0/1 files with PPQN timing, tempo-map support, note-on/off pairing, and meaningful import errors.
- The Song Editor now has a visible **Import MIDI** action. It accepts `.mid` / `.midi` exports from piano, guitar, or vocal MIDI sources, previews the detected events, and imports them as normal editable SongNote targets.
- Import review supports replace/append, automatic SATB placement with editable Bass/Tenor/Alto pitch ceilings, or placing every note in a manually chosen voice. Imported targets remain editable by existing selection, resizing, lyric, pitch, undo/redo, and save tools.
- Brought lower arrangement functions into a visible expandable strip above the piano roll (dynamics, breath, and part selection). The editor frame itself can now scroll when viewport height is limited, so the part mixer is no longer trapped below the screen.
- Reordered the editor so MIDI and backing-track functions are compact collapsible strips above the piano roll; the timeline is no longer displaced by the automation/mixer panel.
- Added `BackingTrackPanel.tsx` with audio/video upload, preview, volume, speed, clean/warm/bright effects, trim bounds, split markers, skip regions, selected-section looping, and non-destructive repeat controls. Settings save against the song with its backing-track URL.
- Backing tracks now follow the SATB editor transport: piano-roll preview begins media at the selected timeline range, and the backing speed controls both media and note-preview time. `timeline_offset` is persisted for fine beat-to-note alignment.
- Added a permanent synchronized backing-track lane directly above the four SATB lanes. It shares the ruler/playhead and visualizes trim, skip, split, loop, speed, and offset settings. The detailed media editor is height-bounded so expanding it no longer pushes the SATB timeline out of view.
- Added `app/api/vocal-hero/media/route.ts`, which creates a short-lived signed Storage upload URL. Large media uploads go directly from the browser to Supabase Storage instead of through Vercel.
- **Manual database step required:** run `migrations/2026-07-20_vocal_hero_backing_tracks.sql` in Supabase before using uploads. It creates the public-read `vocal-hero-media` bucket and the `vh_songs` backing media/settings fields. Public read is necessary for connected singers to retrieve a shared backing track; uploads remain service-signed.
- Verified with `npm.cmd run build` using placeholder Supabase build values. No new npm package is required.

## Recommended Next Steps

1. **Worship Orders — presentation mode** — build a full-screen projection view for orders (slides fill the screen, keyboard/remote navigation, altar-colour theming). This is the most requested unfinished feature.
2. **Sync `dist/index.html` automation** — add a simple npm script or git hook that copies `Index.html` → `dist/index.html` on commit, eliminating the manual dual-edit risk.
3. **Supabase schema snapshot** — run a fresh `pg_dump --schema-only` from the Supabase dashboard and replace `supabase-schema.sql` so future agents have an accurate reference.

---

## Files / Folders Future Agents Must Handle Carefully

| Path | Why |
|------|-----|
| `Index.html` | 18 000+ lines — any edit must also be mirrored in `dist/index.html` |
| `dist/index.html` | Deployed file — changes go live immediately on next Vercel deploy |
| `server.gs` | Google Apps Script — changes here require manual copy-paste into the GAS Editor at script.google.com |
| `supabase-schema.sql` | Reference only — may be out of date; do not treat as authoritative |
| `migrations/` | All schema changes should be recorded here before running in Supabase |
| `.env.local` | Never commit; update `.env.local.example` when adding a new variable |
| `Screenshot/` | Reference images used by numbered comments in code — do not rename or delete |

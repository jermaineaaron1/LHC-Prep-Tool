# HANDOFF.md — LHC Worship Prep

_Last updated: 2026-08-12 by Claude Code_

---

## 2026-08-12 — Songbook edits highlight the exact changed lyric line, with a two-look lifetime

Requested: when lyrics change in the songbook, the affected slide should be flagged (every change, without limit), and opening it should show the specific changed lyric highlighted — visible for the first two looks, gone from the third.

### What was built on

The detection machinery already existed: `_lcdChangedSlides` (per-slide diff of order vs library), `_lcdAckedSlides` (per-version acknowledgement, so each new edit re-flags — "unlimited" was already true), the rail's `lcd-lyric-flag`, and the banner with Use-library / Keep-order.

### What was added

- **Line-level highlight in the Slide Editor** (`span.lcd-line-changed`, gold wash) and **in the banner's library preview** (`mark.lcd-diff-line`). The diff is computed between the two slide texts, which align positionally, and the changed lines are then found in the editor **by text, not by index** — the slide text carries the `[Verse 1]` header line and the editor does not, which is exactly the misalignment that made a first cut highlight every line.
- **Two-look lifetime.** `_lcdChangeViews`, keyed `entryId|slideIdx|<normalised library text>`. Opening the slide counts as a look; re-selecting the slide already open does not; the glow shows for looks 1–2 and stops from look 3. The banner itself stays until the operator chooses Use-library or Keep-order. A new songbook edit changes the version key, so everything re-arms.
- **Leak-proofing.** `_getEditorHtml` — the one choke point commit, projection, and the live editors all read through — unwraps the highlight spans from its clone. Verified path: type inside a highlighted line, apply, project: no markup escapes.

### Two real bugs found while building it

1. **Machine selections counted as looks and acked flags.** Order load auto-selects a slide through the same `selectSlideBox` path as a click; that machine selection cleared the rail flag and burned a look before the operator saw anything — a reload was enough to half-consume every pending notice. Gated by `_lcdServiceInitAt`, stamped at the **start of `initializeServiceOrder()`** (not only in `selectOrder` — `loadOrder` rebuilds through it before `selectOrder` ever runs) plus `_loadingOrder`; a look only counts 1200ms after the last rebuild.
2. **Rail flags never appeared after a reload.** The lyric-status caches were filled at LCD init, before the song library had loaded — the lookup found nothing, "no change" was cached, and nothing invalidated it. The realtime receiver resets these caches itself, which is why live pings flagged correctly while reloads did not. Fixed in `WO.lcdRefreshLibrary` (called by `loadSongs()` whenever the library arrives): it now resets the caches and re-renders the rail, instead of only repainting the library panel.

### Verified live (two clients, six successive edits to the same song)

- Title-only edits stay silent; each lyrics edit re-flags — six for six.
- The flag survives a full reload and sits on the correct slide.
- Look 1: rail flag clears; the one changed line glows in the editor ("Steady words line two") and the one changed library line is marked in the banner ("SIXTH EDITION line two") — the two unchanged lines are untouched.
- Look 2 (leave and return): still glowing. Re-selecting the already-open slide does not burn a look.
- Look 3: glow and marks gone; the banner still offers Use-library / Keep-order.

### Harness note

Scripts in the hidden browser pane kept executing but timed out returning results (~30s limit) — three "zombie" runs completed their side effects with the output lost. Verify by writing to `window.__r` and reading it back in a second short call; and remember those zombie runs consume look-counts.

---

## 2026-08-12 — Slide Editor bottom now lands exactly on the Program Output's; interrupted saves replay at boot

### 1. Editor/output alignment (reported: "the output height is jarring out")

The old "editor 20px taller" pairing never aligned anything the eye sees. The Program screen's 16:9 height comes from the **column width**, not the row, so the output box carried invisible slack below the screen at wide sizes and the screen jutted past the editor at narrow ones — the two bottom edges only coincided by luck.

`_lcdSizeWorkspaceColumns()` now sizes the outputs row to the Program Output's **measured natural content height** (controls + label + 16:9 screen + padding), both boxes are `height: 100%`, and the overflow pass takes from the **tray only** — shrinking the row would break the very alignment this exists to hold. Measured: editorBottom == progBoxBottom == progContentBottom (577 == 577 == 577 at 1920; 562 == 562 at 1366), zero slack, zero section scroll, stable across tray collapse/expand cycles.

Consequence to know: the editor's height is now **driven by the output's content height**, so it can be shorter than before at very wide viewports (the row no longer absorbs all remaining band; the surplus sits below the tray). That is the price of the requested alignment.

### 2. Songs vanishing on reload — root cause found and fixed

Reported: "added songs don't stick... vanish when the app or order is reloaded."

**All the ordinary paths were fine.** Add via Song Order, add via LCD Projection, explicit save, debounced autosave — every one persisted and survived a cache-cleared reload in both modes. The loss lives in a race:

- The local orders snapshot is updated **only inside the success `.then()`** of the Supabase write. Nothing persists anything synchronously.
- `loadOrder` (correctly, for multi-device) always restores content from Supabase, never localStorage.
- So: add a song → reload/F5/the app's own Refresh/close the tab within the 2s autosave debounce **or while the write is in flight** → `beforeunload` fires `saveImmediately`, whose network write dies with the page → the state existed nowhere → next load restores the pre-add cloud copy. On a slow connection that window is several seconds after every edit.

**Fix — a crash journal.** `saveCurrentOrder` now writes its payload to `localStorage['lhc_pending_order_save']` **synchronously** before calling `SBQ.saveOrder`, and clears it in the success `.then()` (only if the journal still belongs to that order — a newer save may have rewritten it). At boot, `_replayPendingOrderSave()` (runs at +1.2s, before `silentPreloadOrders`) pushes a surviving journal to Supabase, guarded four ways:

1. never replays an empty-items payload (wipe protection);
2. drops journals older than 7 days;
3. drops the journal if the order was deleted from the cloud;
4. **drops the journal if cloud `last_edited` is newer than the journal's `savedAt`** — an edit made after the crash, by anyone, beats the stale journal.

Verified live: simulated a mid-flight death (SBQ.saveOrder stubbed to reject once) → journal survived with the new song in it → stripped the song from the cloud and rewound `last_edited` → reload → replay restored the song to `order_items` and cleared the journal, with a "Recovered unsaved changes" toast. Conflict branch: a crafted stale journal with a poison payload was dropped without touching the cloud.

Note: journals are cleared when the save lands, so during normal operation the key exists only for the milliseconds a write is in flight.

### Test-data note

"Service - Aug 9" now has **16** `order_items`, not the 15 recorded in earlier entries — the 16th is the **user's own** "Slide" item in the Absolution section, added from production during this session (visible in their screenshot). Do not "fix" the count back to 15.

---

## 2026-08-12 — Audit round: stage bar removed, regression sweep of the recent layout work

### Change: the stage bar is gone, the Slide Editor took its height

Once Blank and Project moved into the Program Output column, `.lcd-stage-bar` held **only** a "Arrow keys navigate slides" hint — a full-width 34px row (44px with its margin) for one line of static text. Removed, along with its `.lcd-stage-bar` / `.lcd-stage-hint` / `.lcd-stage-spacer` rules; nothing else referenced them.

`_lcdSizeWorkspaceColumns()` measures the panel's chrome rather than assuming it, so the freed height passed to the outputs row with no JS change.

| | 1920x1080 | 1366x768 |
|---|---|---|
| Slide Editor | 474 → **518** | 222 → **252** |
| editor canvas | 236 → **280** | 118 |
| tray row | 259 | 181 → **195** |
| tray body scroll | 0 | 163 → **119** |

Editor stays exactly 20px taller than the output; zero section scroll at both sizes. Panel children are now just topbar / outputs row / tray. Collapsing the tray at 1920 gives the editor 726px with a 488px canvas.

### Regression sweep of the last two rounds — clean

- **Workspace fullscreen round-trips correctly.** Entering clears the inline height/flex (outputs row 421, canvas 220, tray at its 210 cap, controls on one 40px line); leaving restores the windowed sizing. Ran **four** enter/exit cycles: settles at 226/183 and holds, section scroll 0. No feedback loop from measuring rendered heights.
- **275 inline handlers all resolve** after the controls moved into the Program Output column. No duplicate ids, no orphaned elements (`woPreviewZoomLabel`, `woBlankLabel`, `lcdProgramLiveDot`, `lcdAllSlidesBtn` all intact).
- **Mobile CSS still wins.** The `@media (max-width: 768px)` block sets `position: fixed !important` and friends, and `!important` beats the ID specificity of the new `#woPreviewPanel` rule — confirmed `position: fixed`, `max-height: 812px`, no inline overrides leaking.

### Minor: stale inline sizing survives a switch to Song Order

`outputs.style.height`, `flex` and the tray's `max-height` are **not** cleared when switching to Song Order — `_lcdSizeWorkspaceColumns()` only runs from the service branch, so its `else` never fires there. Inert today because the preview panel is `display: none` in Song Order and re-entering service recomputes. It would matter if the panel were ever shown in that mode.

### Harness limitation — record this, it nearly produced a false bug report

**This browser pane does not apply CSS transforms.** The mobile panel carries `wo-preview-collapsed` and a matching `transform: translateX(100%) !important` rule, yet computes to `matrix(1,0,0,1,0,0)` at `left: 0`. Disabling the transition did not change it, and **even an inline `transform: translateX(100%) !important` computed to identity** — which is impossible for a real render.

So the mobile slide-in drawer cannot be verified in this pane, and a "the panel covers the whole screen on mobile" finding here means nothing. Test transforms in a real browser.

### Environment noise, not app faults

`supabaseUrl is required` plus 500s come from the Next.js route bundle with no local `.env.local`. Repeated Supabase realtime WebSocket failures also appear; realtime itself works — the two-client lyric-ping test passed earlier in the same session — so these are reconnect attempts accumulated across many reloads.

---

## 2026-08-12 — Workspace controls moved into the Program Output column; Slide Editor taller; All Slides button (branch `feature/premium-mobile-roster`)

### Controls relocated, editor gains the height

The workspace controls (preview zoom, order-level undo/redo, Blank, Project) sat in a **full-width strip above both columns**, so the Slide Editor started below it. They now live inside `.lcd-program-box`, above the Program Output label — the editor column starts at the top of the outputs row and takes that strip's height.

Ids and `onclick` handlers are unchanged; this is a DOM move plus CSS, no rewiring. Verified all five still resolve: `zoomPreview`, `lcdUndo`, `lcdRedo`, `blankProjection`, `goFullscreen`.

`.lcd-program-box .lcd-controls-row` right-aligns, drops the flex spacer (nothing to push apart in a column), and — **at every width, not just under 1700px** — compacts the Project button. Its 170px `min-width` for ~99px of content wrapped it to a second line even at 1920, and that wrap was 44px the editor did not get: the in-column row went 84px → 40px.

| | before | after |
|---|---|---|
| 1920 editor panel | 420 | **474** |
| 1366 editor panel | 200 | **222** |
| 1366 tray row | 150 | **181** |

Zero section scroll at both sizes; Program Output still measures a true 16:9 (ratio 1.778).

At 1366 the column is 287px wide so the in-column controls wrap to two lines (82px). The Program Output box absorbs it — its screen is 161px of the 222px row — so nothing else is squeezed.

### "All Slides" button in the Slide Editor header

`openSectionAllSlides(sectionId)` had existed since the section-menu work **with no call site**. It now has one: a new `All Slides` button in `.lcd-lyrics-actions`, wired to a thin resolver `lcdOpenSectionAllSlides()` that works out which section the operator is in from `currentSectionId`, falling back to the selected slide's `data-section`, and warns rather than throwing when nothing is selected.

Opens every slide in the **section** — not just the selected slide's own song or liturgy item — as one editable text block. Verified on section 1 (23 slides across two liturgy items): the modal opened with 919 characters of that section's content.

---

## 2026-08-12 — 1366x768 now fits with no scrolling (branch `feature/premium-mobile-roster`)

Follow-on from the entry below, which left 1366 with 42px of section scroll and the tray body clipped by 167px. The cause was chrome, not the tray: the workspace column's own header rows wrapped, and every wrapped row is height the tray does not get.

### Why the rows wrapped

Measured at 1366, where the workspace column is 470px wide: the controls row's content came to 467px, so **Project fell to a second line for want of 3px** and the row went 48 → 92px. Fixing that alone took chrome from 170 → 120px.

### The change

A `@media (max-width: 1699px)` tier tightens both rows — smaller gaps and padding, and `min-width: 0` on the Project button, which was reserving 170px for ~99px of content. Nothing is removed; the buttons stop reserving space they were not using.

Then, in `_lcdSizeWorkspaceColumns()`, the overflow pass got a third step: whatever the editor's 200px floor cannot absorb now comes off the **tray**, whose grid scrolls inside itself. On a short screen the content genuinely exceeds the space — this decides where that shows up, and a scrollbar inside the media grid beats the whole workspace sliding under the fold.

### Verified

**1366x768** — zero section scroll in every state, tray fully in view, and toggling returns to identical values:

| state | chrome | editor / output | tray row | tray body scroll | section scroll |
|---|---|---|---|---|---|
| expanded (as opened) | 119 | 200 / 180 | 150 | 163 | **0** |
| collapsed | 119 | 300 / 280 | 50 | — | 0 |
| re-expanded | 119 | 200 / 180 | 150 | 163 | 0 |

**1920x1080** — untouched by the media query, still 420/400 expanded, 629/609 collapsed, tray unclipped, zero scroll.

### Still wrapping at 1280 and below

At 1280 the workspace column is only **384px** wide and both rows still wrap: topbar 83px (title 177 + two 106-109px buttons = 408 against 384), controls 88px (line one comes to 366 of 368 available, so Project wraps by ~10px). Chrome is 204px there and the tray keeps 226px of body scroll plus 110px of section scroll.

Closing that would need a tighter tier below 1366 — 4px gaps and an ellipsising panel title — or icon-only buttons. Not done: 1366 is the stated design floor and the request was for that size. The tier already exists as `@media (max-width: 1699px)`, so a nested narrower tier is the natural place to add it.

---

## 2026-08-12 — Media Tray is on screen when LCD Projection opens, and expands into the empty space (branch `feature/premium-mobile-roster`)

Correction to the previous entry. Letting the workspace column grow to its content height did stop the tray being *clipped*, but it pushed the tray **below the fold**: on opening LCD Projection you had to scroll to find it, and expanding it grew further down, away from view. Meanwhile the Slide Editor was left holding a large empty region.

### What changed

`_lcdSizeWorkspaceColumns()` now splits the band between the outputs row and the tray instead of letting the editor take all of it:

1. Measure the chrome actually on screen (topbar + controls + stage bar) — it is not a constant; the toolbars wrap at narrow widths, going from 45+48 at 1920 to 91+92 at 1280.
2. Read the tray's **natural** height from `lower.scrollHeight`, having first cleared the previous pass's `maxHeight` — see the trap below.
3. Give the tray up to **42% of the band**, the editor and output the rest, with a 200px floor so a big media library cannot squeeze them out.
4. **Second pass:** measure what still overflows and take it off the editor, down to that floor. The panel's own padding and the margins between its rows are not in the measured chrome, and guessing them with a constant left 37px of the tray below the fold. Self-correcting, so it holds whatever those margins are.

### The trap worth remembering

`lower.scrollHeight` must be read **after** clearing `lower.style.maxHeight`, or the reading is of the constrained box rather than the content. Re-expanding after a collapse measured 128px instead of 354px, and the tray came back at half size with its body clipped — while collapse itself looked fine, so it only showed up on the second toggle.

Also: the collapse toggle re-runs the sizing through `_enterServiceOrderLayout()`, which schedules on `requestAnimationFrame` + `setTimeout(0)`. **rAF never fires in the browser-pane harness**, so any measurement taken synchronously after a `.click()` reads the pre-resize layout. Wait ~400ms before asserting.

### Verified

At **1920x1080**, the size the request came from — everything fits with **zero scrolling** in every state, and repeated toggling returns to identical values with no drift:

| state | tray row | tray clipped | editor / output | section scroll |
|---|---|---|---|---|
| expanded (as opened) | 258 | 0 | 420 / 400 | **0** |
| collapsed | 50 | — | 629 / 609 | 0 |
| re-expanded | 258 | 0 | 421 / 401 | 0 |

The editor picks up the tray's space on collapse (420 → 629) and gives it back on expand.

At **1366x768** the tray header is on screen when the view opens and the editor/output pair holds at its 200/180 floor, but there is genuinely not room for everything: the tray body scrolls by 167px and 42px of section scroll remains. The toolbars wrap at that width, so chrome alone costs 183px more than at 1920. Collapsing the tray clears it completely (0 scroll).

---

## 2026-08-12 — Media Tray flows below the workspace instead of fighting it (branch `feature/premium-mobile-roster`)

Requested: expand the LCD Projection frame's height so the Media Tray runs downward rather than clashing with the Slide Editor and Program Output above it.

### What was actually squeezing it

Two nested clips, at 1280x720:

- `.wo-preview-panel { max-height: calc(100vh - 32px); overflow-y: auto; }` — 688px. The editor, output and tray all shared that one band, so **105px of the column was clipped into the panel's own scrollbar**.
- `.lcd-lower-row { max-height: 172px; }` — inside that, the tray body showed **122px of 300px** of tiles.

`applyLayout()` also writes an inline `maxHeight`/`overflowY` on the panel, and inline beats the stylesheet, so the CSS cap only becomes reachable once `_lcdSizeWorkspaceColumns()` hands those properties back.

### The change

- The two long lists (Library, Schedule) stay capped to the viewport band and scroll internally — that is what they are for.
- The **workspace column is no longer capped**. `.wo-main-content:not(.wo-song-order) #woPreviewPanel` sets `max-height: none; overflow-y: visible`, and `_lcdSizeWorkspaceColumns()` clears the matching inline properties (`applyLayout()` writes them, and inline beats the stylesheet).
  - It stays `position: sticky`, but anchored to its **bottom**: `top: auto; bottom: 8px`. Top-anchored sticky on a box taller than its scroll container pins the top edge, so everything below the fold — the tray — can never be scrolled into view. Bottom-anchored inverts that. `top: auto` is required or the top anchor wins.
  - **Honest note on what sticky buys here:** measured across the scroll range the panel tracks the scroll 1:1 (panelTop 206 → 59 → −87 as scrollTop goes 0 → 147 → 293) and only reaches its pin point at maximum scroll. That is because the section's scroll range is driven *solely* by this column's overflow — the Schedule and Library columns scroll internally, so nothing else lengthens the section. Sticky is correct and harmless, but in this layout it has no observable effect. It would only start mattering if the Schedule column stopped being internally capped.
- `.lcd-lower-row` cap raised from `172px` to `60vh`, so the tray grows to its tiles with a ceiling for a very large library.
- The editor and output keep the band they always had: `_lcdSizeWorkspaceColumns()` gives `.lcd-outputs-row` a definite height of *band − (topbar + controls + stage bar) − 24*. Only the tray extends past the fold.

### Two traps hit on the way

1. **`max-height` was not enough on the outputs row.** The Program Output carries `height: calc(100% - 20px)`, and a percentage cannot resolve against a `max-height` — it fell back to content size and sat *125px* shorter than the editor instead of 20px. It needs a definite `height`.
2. **`height` alone did nothing.** The row is `flex: 1 1 0%`, and on the main axis flex-basis beats height, so the row stayed content-sized at 524px. `flex` has to be pinned to `0 0 auto` alongside the height.

### Verified

| | 1280x720 | 1366x768 | 1920x1080 |
|---|---|---|---|
| panel clipped | **0** (was 105) | 0 | 0 |
| tray body clipped | **0** (was 178) | 0 | 0 |
| editor / output | 241 / 221 | 335 / 315 | 713 / 693 |
| editor taller by | 20 | 20 | 20 |
| gap editor → tray | 54px | — | — |
| scroll to tray bottom | 397px | 352px | 297px |

Program Output screen measured at ratio 1.778 — a true 16:9. Collapsing the tray still hands the space back (row 259 → 51, section scroll 297 → 89 at 1920) and re-expanding returns to identical values.

---

## 2026-08-12 — Assigning sections from LCD Projection no longer destroys the Service Schedule (branch `feature/premium-mobile-roster`)

Found by a Song Order ↔ LCD Projection interaction test. **Worse than it first looked** — the initial diagnosis was "the schedule does not repaint"; it actually wipes.

### The defect

`confirmSectionAssignment`'s existing-song branch — the green "assign sections" button, which is how a song gets moved between sections — called `initializeSongOrder()` unconditionally. That renderer writes the Song Order list into `#woWorshipOrder`, **the same container the Service Schedule lives in**. Called from LCD Projection it replaced all 19 service sections with a `.wo-song-order-compact` list.

Measured on the broken build: sections 19 → 0, rail rows 98 → 0, `#woWorshipOrder` left holding a single `div.wo-song-order-compact`. The data was fine — `serviceSections` updated correctly — but the operator's schedule was gone until a mode toggle rebuilt it.

The first repro read as a no-op only because the rail's 120ms MutationObserver debounce had not fired when the measurement was taken, so a stale count of 98 was captured.

### The fix

Pick the renderer that matches the mode actually on screen:

```js
var _mcAssign = document.querySelector('.wo-main-content');
if (_mcAssign && !_mcAssign.classList.contains('wo-song-order')) {
  initializeServiceOrder();
} else {
  initializeSongOrder();
}
```

Plus `_lcdPushUndo()` at the top of the branch — moving a song between sections is a schedule mutation like any other.

**A first attempt was wrong and was backed out.** It added a `_woSyncSongToServiceSections` helper that removed and re-added the song's DOM per section. That treated the symptom: `initializeSongOrder()` had already destroyed the container before the helper ran, so the rail still went to 0. The helper was deleted; the mode check is the whole fix.

### Verified

Throwaway song and orders, deleted afterwards. No mode toggle between the action and the measurement.

| | before | after |
|---|---|---|
| service sections | 19 | **19** (was 0 on the broken build) |
| song banners | 0 | 1 |
| song slides | 0 | 2 |
| rail rows | 98 | 100 |

- **Re-assigning to a different section moves it**: section 0 → section 4 left exactly one banner, in section 4 only.
- **Song Order branch untouched**: the same action performed from Song Order mode kept 1 row before and after and updated `serviceSections` correctly.

---

## 2026-08-12 — Song Order ↔ LCD Projection: lyric-change ping verified

Not a change. A record of behaviour confirmed against the requirement that the LCD slide pings **only** when the songbook lyrics change.

Tested with two real browser clients, since `broadcast: { self: false }` means one tab cannot prove this.

| Edit in the other client | LCD Projection tab |
|---|---|
| Title only, lyrics untouched | silent — no toast, no flag |
| Lyrics changed | toast *"…" was just updated in the library*, flag appears |

The flag is `lcd-lyric-flag library` and it landed on rail row **1.1**, the slide whose words actually changed — not on 1.2, whose chorus was untouched. Clicking that slide opens a banner reading "Library lyrics updated for this slide / The library now reads: …" with **Use the library version** / **Keep this order's version**, and the flag clears once acknowledged. The scheduled slide text does not change until the operator chooses.

**How "lyrics only" is achieved matters for future edits:** the *sender* (`SBQ_SONGS.update`) broadcasts on every song save, title-only edits included. The *receiver* suppresses it with `if (s.lyrics === p.lyrics) return`. So the behaviour depends on the receiving client's copy being current — if their local lyrics are already stale, a title-only edit will ping them. That is arguably correct (their copy *is* out of date); do not "fix" it by removing the receiver-side guard, which is what actually implements the requirement.

---

## 2026-08-12 — Deleting media now clears the slides that point at it (branch `feature/premium-mobile-roster`)

Closes the root cause behind the entry below. That change made a dangling reference *safe* (it projects black instead of holding the previous slide); this one stops the dangling reference being created.

### Why it was needed

Deleting media is **global** — the row leaves the shared `lhc_backgrounds` table, so it disappears for every order and every user — but nothing swept `sectionBackgrounds`. Every other order stayed pinned to media that no longer existed.

### What happens now

`deleteBackground` runs a three-layer purge, local first so the screen is right immediately:

1. `_lcdPurgeMediaFromOpenOrder` — goes through `setBackgroundForSlideInSection`, **not** a direct mutation of `sectionBackgrounds`, so the `songOrderSections` mirror, the editor canvas and the save path all stay in step. Batched inside `_withBulkBackgroundWrites`.
2. `_lcdPurgeMediaFromCachedOrders` — every `lhc_section_backgrounds_*` key in this browser except the open order's, which layer 1 already handled.
3. `_lcdPurgeMediaFromCloudOrders` — every order row in Supabase. For the open order it writes the **in-memory** map rather than the fetched one, since the fetched copy is older than the purge that just ran.

`_lcdStripMediaFromMap` drops sections left empty, so no `{}` husks remain.

### The prompt now states the cost

`_lcdFindMediaUsage` scans all cloud orders before asking. Real output from the test:

```
Remove purge-test.png from the media library?

It is shared by every order, so this deletes it for everyone.

It is currently used on 6 slides across 2 orders:
  • ZZ PURGE A (delete me) (3)
  • ZZ PURGE B (delete me) (3)

Those slides will lose their background.

This cannot be undone.
```

The Add-BG modal's × was routed through `lcdDeleteMedia` too. It previously called `deleteBackground` directly with **no confirmation at all**, which mattered much more once deleting also strips slides.

The follow-up toast counts only the orders the operator cannot see, so slides they just watched go black are not double-reported.

### Verified

On throwaway media and throwaway orders, all deleted afterwards.

- **Other orders (cloud branch).** Two orders each pinning the test media on 3 slides plus one unrelated video. After deleting: media row gone, all 6 test pins gone, **both unrelated video pins survived**, and the section that held only the test media was dropped entirely. Selective, not wholesale.
- **Open order (in-memory branch).** Slides 0 and 2 on the test media, slide 1 on an unrelated video. After deleting: in-memory map `0=-, 1=keep, 2=-`, the order's cloud row reduced to just the kept pin, media row gone, local library entry gone.
- **Prompt** named the file correctly once the item was in `savedBackgrounds` (it falls back to "this media" when the library has not hydrated).

Afterwards, all real data confirmed untouched: "Service - Aug 9" 6 pins / 15 items, "Service - 28 Jun 2026" 2 pins, "Service - Jun 21" 1 pin, media library back to its two real items, no stray test orders.

`Index.html` and `dist/index.html` byte-identical; all 12 inline `<script>` blocks pass `node --check`.

---

## 2026-08-12 — Unresolvable background media now projects black (branch `feature/premium-mobile-roster`)

Second audit round of the LCD Projection page. One serious finding, fixed here.

### The defect

A slide can point at media that is no longer resolvable. Two routes, both realistic:

- **The Media Tray's ×** deletes from the shared `lhc_backgrounds` table — for every order and every user — and **nothing sweeps `sectionBackgrounds`**. Every other order still pinned to that media is left with dangling references.
- **The hydration window.** `savedBackgrounds` is empty until media loads from the cloud; a slide selected in that window resolves to nothing. (Reasoned from the code — the timing was not reproduced.)

Every applier did `if (found) { …render… }` with **no else**, having already set the background element visible. So a miss left the **previous slide's** background on screen. Worse, `_sendBgToProjection` sent *no message at all* on a miss, so the external projector held its last frame.

The `null` case had been fixed at some point — there is even a comment about it — but "found nothing" took a different path and was never covered. Reproduced live: slide 0 real video, slide 1 a missing id → slide 1 still showed slide 0's video; slide 2 with no background at all cleared correctly.

This was not one missing `else`. There are 22 `savedBackgrounds.find()` sites, and the convention throughout was that "not found" means "change nothing".

### The fix

One rule instead of 22 patches. `_lcdBgUnresolvable(background)` + `_lcdBgOrNull(background)` (~30235) convert an unresolvable background to `null` at the **top** of the three appliers, so it flows down the existing, already-correct null path:

- `_applyBgToDivEl` — drives the fullscreen overlay
- `_sendBgToProjection` — now sends an explicit `background: null`
- `applyEffectiveBackgroundToPreview` — the per-slide preview

Only the id-resolved types (`image`, `video`, `audio`) are judged; anything else is passed through untouched so an unrecognised-but-working type can never be blanked by this check. A `console.warn` names the missing id — deliberately not a toast, which would be noise mid-service.

`applyBackgroundToPreview` and `sendBackgroundToProjection` were checked and **already safe** — the first clears `innerHTML` before its type dispatch, the second defaults `bgData` to `null` and sends unconditionally. Left alone.

### Verified

On a throwaway order, deleted afterwards.

| Slide | Background | Before | After |
|---|---|---|---|
| 0 | real video | video | video |
| 1 | missing video id | **slide 0's video** | empty |
| 0 | real video again | — | video (working case intact) |
| 2 | missing image id | **stale** | empty |
| 3 | none | empty | empty |

`#lcdProgramBg`, the in-app mirror fed by the same message that reaches the external projector, cleared to black on a miss and showed the video on a hit. Console carried both warnings with the offending ids.

**Video continuity regression-checked** (the "video restarts from the beginning" fix from an earlier round): same video on two slides, `currentTime` set to 3.5s on the first — moving to the second reused the same element with `currentTime` still 3.5. Not broken.

### Also found, not fixed

The schedule header reads **"98 slides" when 94 exist**. The four unfilled Scripture Readings slots (First / Psalm / Second / Gospel) are `.wo-content-box` placeholders that the rail lists as slide rows. Clicking one projects **blank**, which is correct, so nothing bad reaches the screen — it is only the count that is wrong, and the rows are arguably useful as reminders that the readings are unfilled.

### Checked and sound

- **Save/reload round-trip is exact.** Backgrounds set, saved, local caches cleared so the order had to come purely from Supabase: `0=550192, 1=-, 2=031541, 3=-`, 94 slides, 19 sections, all reproduced.
- `escapeHtml` escapes both quote characters, so names with apostrophes cannot break generated `onclick`/`title` attributes.
- The `visibilitychange` listener added by `startSyncPolling` looked like a leak, but `stopSyncPolling` is never called, so it cannot accumulate. Worth knowing if anyone wires up the stop.
- The song live-sync realtime channel is singleton-guarded and has a teardown path.

---

## 2026-08-12 — CLOSED: uncommitted Slide Editor work found, recorded, then discarded

Not a change. A record of work that no longer exists, kept because it was never committed anywhere and this is the only trace of it.

Found while fast-forwarding local `master` from `a4b550c` (PR #41) to `56fb5cb` (PR #44): the main worktree `C:\Users\Admin\LHC-Worship-Prep` had **uncommitted edits to `Index.html`** sitting on a base four PRs old, which blocked the fast-forward. They were stashed to unblock it, and then **dropped on the user's explicit instruction** once recorded here.

**The code is gone.** What follows is a description, not a copy — this entry never contained the diff. The dropped stash commit was `eea6e13097750e511efaae240fbbde095d52a6af`; a dangling commit survives until `git gc` prunes it, so `git show eea6e13` may still work for a while and will stop working without warning. Do not plan around it.

26 insertions / 24 deletions, three changes:

1. **`_lcdUpdateEditorCanvas` stops painting the real background** — the editor canvas becomes a plain dark surface. The reasoning in its replacement comment: text sat on a photograph while being typed, looping video pulled the eye off the cursor, and pale-on-pale was unreadable; Program Output beside it already shows the true projection. Alignment is still mirrored.
2. **The empty-slide hint is excluded from projected text** — `.wo-slide-empty-hint` is filtered out of the `.wo-slide-line` collection, so "Double-click to add content" can no longer reach the wall.
3. **An empty slide actively clears the screen** — sends `{type:'text', text:''}` instead of leaving the previous slide's words up, so a deliberate blank slide reads as blank.

**Why it was checked carefully before being discarded:**

- It was genuinely unique. Those comment strings appeared in **no commit in the repository** — not in `origin/master`, and not in `fe6de6f` ("plain Slide Editor canvas, blank slides project nothing"), whose message describes the same three behaviours. Upstream solved the same problems **independently and differently**, so this was divergent work, not a stale duplicate.
- Its base was four PRs behind and `Index.html` had since gained 442 changed lines in exactly these regions, so reapplying it would have conflicted badly.

**If any of the three behaviours above turn out to be missing from the app**, treat this entry as the specification and reimplement against current `Index.html` — that will be cleaner than recovering the original, which targeted code that no longer exists. Check the current behaviour first: PR #45 and `fe6de6f` covered overlapping ground, so some or all of it may already be live.

---

## 2026-08-12 — LCD Projection audit: four fixes (branch `feature/premium-mobile-roster`)

A rough audit of the LCD Projection page turned up four defects, all fixed here. It also corrected an overclaim in the entry below: the background re-pin fix was **not** complete — three more paths renumbered slides without re-pinning.

### 1. The per-slide × was the unfixed twin of the rail's ×

Deleting a slide has two implementations. The rail row's × goes through `_lcdDeleteRailRow` → `_lcdDeleteSlideBox`, which pushes undo and re-pins. The × on the slide's own header goes through `removeSlideBox`, which did neither — and it autosaves, so the damage persisted. It now brackets its mutation the same way, with `_lcdPushUndo()` placed **after** the "cannot remove the last slide" guard so a refused click leaves no no-op step on the stack.

### 2. Inserting a slide had the same hole

`addSlideBoxAfter` is the funnel for all three insert paths — the Add Slide button, the editor's Shift+Enter split, and `editSlideBox`'s own split — so the capture/restore lives there rather than in each caller. `_lcdAddSlideAfter` (used only by `_lcdSplitSlideAtCursor`) got the same treatment. Undo is pushed by the callers, one push per user action: `addSlideToGroup` and the `editSlideBox` split branch each push, `_lcdSplitSlideAtCursor` already did.

**`WO.addSlideToGroup(this)` was also a dead button.** Scripture groups call it with a single element, but the signature is `(type, groupId, sectionId)`, so it resolved `$(undefined + '-boxes')` → null → silent return. Scripture slides carry `data-source="scripture"` and no group id, so they could not be addressed by the existing selector anyway. The function now accepts an element and walks back from the Add Slide row to find the group's last slide.

### 3. Slide Editor overlapped the stage bar at 1366x768

`.lcd-outputs-row` had `min-height: 0` while `.lcd-lyrics-panel` held `min-height: 200px`. At 1366 the row got only the 118px of vertical slack left over, the editor refused to shrink past 200px, and with `overflow: visible` it spilled 72px onto the stage bar. Correct at 1920, broken at the documented 1366 floor.

The row's floor now matches the editor's. A `@media (max-height: 820px)` block drops both to 150px so short laptops do not pay for it in page scroll — placed **after** the 200px rule, since a media query adds no specificity and source order is what decides here.

| Viewport | Before | After |
|---|---|---|
| 1920x1080 | editor 414x496, output 414x476, clears by 10px | unchanged |
| 1366x768 | editor 283x200, output 190x98, **overlaps by 72px** | editor 272x150, output 186x130, clears by 10px |

Page overflow stayed at 24px at both sizes.

### 4. Media that was neither picture nor video became invisible and undeletable

The Backgrounds tab filtered on `type === 'image'` / `type === 'video'`; the other tabs filter by category. Anything else filed as a background matched no tab at all — it uploaded, said "added", then vanished along with its × . `_lcdIngestTrayFile` accepted `audio/*`, which nothing in the tray can play or project, so that was the easiest way in.

Both halves fixed. Ingest now refuses audio outright and refuses a file the active drawer cannot render, naming the drawer that can. And the Pictures sub-tab now also lists any orphan already in the library, muted and non-draggable with no apply affordances, purely so it can be deleted.

### Verified

On a **throwaway order** created for the purpose and deleted afterwards — no live order was mutated.

- Backgrounds A B A B on four slides, delete slide 1 with the header × → `A A B`: each background followed its own slide, the deleted one dropped out. Ctrl+Z restored both the slide and the full A B A B map.
- Mid-section insert in a 13-slide section with two groups, marks at 0/8/9/10 → after inserting at index 9, `0, 8, 10, 11`. The two slides below the insert carried their backgrounds; the new slide has none. Ctrl+Z returned it to 13 slides and the original map.
- `WO.addSlideToGroup(buttonEl)` (the scripture form): 13 → 14 slides, undo back to 13.
- Audio and a `.pptx` offered to the Backgrounds tab: both refused with the specific toast, nothing uploaded, library count unchanged.
- A seeded orphan rendered with `lcd-media-orphan`, `draggable="false"`, no apply click, no ALL, a working × , and its × removed it.

Afterwards: temp order and its 14 `order_items` deleted, no stray rows; "Service - Aug 9" still 15 items with its six original background pins; media library back to its two real items.

`Index.html` and `dist/index.html` byte-identical; all 12 inline `<script>` blocks pass `node --check`.

**Note on `window.confirm`:** the browser-pane harness returns `false` for it, so any delete gated on a native confirm silently no-ops during automated testing. Stub it before asserting on those paths.

---

## 2026-08-12 — Removing a whole song or liturgy item now re-pins backgrounds and is undoable (branch `claude/inspiring-goodall-bde986`, merged to master via PR #44 `56fb5cb`)

Fixes the background re-pin bug recorded at the bottom of the drag-layer entry below, and a second instance of it that had not been noticed.

### The defect

`sectionBackgrounds` is keyed by section id then **local slide index**, so anything that removes slides renumbers every pin after it. `removeLiturgyFromSection` (now ~47673) pulled the banner, every `.wo-slide-box[data-liturgy-id=...]` and the add-slide row straight out of the DOM and went to `autoSaveOrder()`, never touching the map. Backgrounds below the removed item stayed on their old indices and showed up on the wrong slides. It also never called `_lcdPushUndo()`, so removing an item was the one rail mutation Ctrl+Z could not take back.

**`removeSongFromSection` (~47622) had both omissions too** — the task asked me to check it, and it is the same code shape one function up. Same fix applied.

Four paths were already correct; post-fix line numbers: single-slide delete (48267/48277), slide insert (49209/49215), the drag-layer insert (50011/50035) and the rail reorder (50826/50829). The helpers themselves are at 49977 and 49985.

**Correction (added later, see the audit entry above):** this entry originally claimed "every other path already had this right." That was an overclaim. Those four were the paths named in the task brief as known-good, and I confirmed them without auditing the rest of the file — so `removeSlideBox`, `addSlideBoxAfter` and `_lcdAddSlideAfter` went unchecked and turned out to have the same defect. Read the scope of this entry as the two remove paths it actually changed, not as a clean bill of health for slide renumbering generally.

### The fix

Both functions now bracket their DOM mutations exactly as `_lcdDeleteSlideBox` does:

1. `_lcdPushUndo()` first, before anything is touched. It self-guards on `#woWorshipOrder` being present, so it is safe on either code path regardless of which view is active.
2. `var _rmBgs = sectionId ? _lcdCaptureSectionBgs(sectionId) : null;` before the removals.
3. `if (sectionId) _lcdRestoreSectionBgs(sectionId, _rmBgs);` after the removals *and* after the empty-section placeholder rewrite, so both branches are covered.

The capture/restore pair works on **node identity**, not index, so pins follow their own slide however far it shifts. Entries whose slide is gone drop out on their own — `_lcdRestoreSectionBgs` only re-pins boxes still in the container — and when nothing is left it deletes the section key rather than leaving an empty object. It writes once via `saveSlideBackgrounds()` instead of per-slide, which is why it is used in place of `setBackgroundForSlideInSection` (that fires `autoSaveOrder()` on every iteration).

### Verified

No live order was touched — nothing was created in Supabase and no existing order was opened, so there was no opportunity to repeat the earlier data-loss incident. Instead the **real source text** of all four functions is sliced out of `Index.html` by brace balance and executed against a small DOM shim, so the code under test is the shipped code rather than a restatement of it.

18 checks over 5 scenarios, all passing on both `Index.html` and `dist/index.html`:

| Scenario | Result |
|---|---|
| The reported repro — 6 slides, pins on #2 and #5, remove the last item (owns #5) | 5 slides left, map re-pinned to `{2}`, stale #5 gone |
| Remove a **middle** liturgy group | pin travels 5 → 3 with its slide; `{2, 3}` |
| Remove a **middle song** group | pin travels 5 → 3; song also dropped from `serviceSectionSongs` |
| Remove the only group | section empties, section key deleted outright, placeholder restored, `clearedSections` recorded |
| Section with no backgrounds | no section key invented; undo still pushed |

The same harness run against the pre-fix source (`git show`) fails 9 of those 18 — including reproducing the exact reported symptom, a map holding both #2 and #5 against only 5 remaining slides, and `_lcdPushUndo` never firing. That negative control is what makes the passes meaningful.

All 12 inline `<script>` blocks pass `node --check`; `Index.html` and `dist/index.html` confirmed byte-identical with `cmp`.

### Note for whoever picks this up

This branch was cut from PR #42 but the bug and the line numbers in the report belong to PR #43, so it was fast-forwarded to `origin/master` (`293a408`) before the fix was applied — the drag-layer commit adds 110 lines above these functions, which is the whole of the line-number discrepancy. Nothing was pushed or merged.

---

## 2026-08-12 — Drag layer for Presentations and Announcements (branch `feature/premium-mobile-roster`)

The Media Tray's three drawers now behave differently on drop, because the user's model is that a picture *is* a slide and a document *is many* slides — neither is wallpaper.

### Images (Presentations / Announcements drawers)

Routed by `_lcdDropTrayItem(bg, t)` → `_lcdDropImageAsSlide(bg, t, sectionId)`:

- Dropped on an **empty** slide (`_lcdBoxIsEmpty`, which ignores the `.wo-slide-empty-hint` placeholder), the image fills that slide in place — no new slide.
- Dropped on a slide that **already has content**, or between two slides, or on a section header, it inserts a **new** slide at that position.

Backgrounds are keyed by section id then **local slide index**, so any insert shifts every pin after it. Every path here brackets the mutation with `_lcdCaptureSectionBgs` / `_lcdRestoreSectionBgs`, the same pair the rail reorder uses.

### Documents (PPTX / PDF / DOCX)

`_lcdExpandDocIntoSection(sectionId, bg)` never fills a single slide. It rehydrates the stored file (`fetch(bg.url)` → `Blob` → `new File(...)`) and hands it to the existing `addSlidesFromFiles` path, which produces one slide per page. Dropped anywhere in a section, the whole deck lands in that section.

### Two drop-routing bugs found while building this

- **Whole-section test was too loose.** It checked `t.sectionEl`, which is truthy for *any* drop inside a section container — so dropping a picture on one slide wallpapered all 23 in that section. It now requires the drop to miss both a rail row and a slide box: `!t.railRow && !t.slideBox && !!(t.railSection || t.sectionEl)`.
- **A second `drop` listener was overwriting the first.** `_woSetupBgDropZone` is a separate listener on the same `#woWorshipOrder` container that splits the raw `text/plain` payload on `:`. Given a bare tray id it produced `{type: <id>, value: ''}` and, because it runs *after* the tray handler, it overwrote the correct value. It now returns early when the payload has no `:`. The tray handler also calls `stopImmediatePropagation()`.

There are now **six** native HTML5 drag systems sharing that one container (rail row reorder, section reorder, library song, media tray, OS file drop, legacy bg drop). Any new one must decide its precedence against all five others explicitly — ordering is not implicit.

### Verified live

- Announcement image on an empty slide → `"ZZANNOUNCE.png" fills this slide`, section stayed at 5 slides, background written as `{type:"image", value:"bg_..."}`.
- Same image on a slide with content → `"ZZANNOUNCE.png" added as a new slide`, section 0 went 5 → 6 with the new slide at index 2, and all other backgrounds re-pinned to their original slides.

### Test data cleaned up afterwards

The test slide and both test background pins were removed from "Service - Aug 9" via the app's own `removeLiturgyFromSection`, and the test media deleted from the shared `lhc_projection_backgrounds` library (it is shared across **all** orders). Verified from Supabase: 15 `order_items`, zero rows containing either test id, `sectionBackgrounds` back to exactly the six original video pins, 95 slide boxes, 19 sections.

**Bug found during cleanup — fixed 2026-08-12, see the entry at the top of this file:** `removeLiturgyFromSection` did **not** re-pin `sectionBackgrounds` after removing an item. Delete a liturgy item from the middle of a section and every background below it stayed on its old index, so it visually jumped to the wrong slide. The insert paths do this correctly via `_lcdCaptureSectionBgs`/`_lcdRestoreSectionBgs`; the remove path now gets the same treatment (as does `removeSongFromSection`, which had the identical defect).

---

## 2026-08-11 — LCD Projection audit: two bugs found, one of them data loss (branch `feature/premium-mobile-roster`)

Requested audit of slides / content / features / visuals / artwork / adding items / drag-and-drop / rearrangement.

### Incident: an order's cloud content was wiped during testing, and repaired

An undo call during testing popped a step past the baseline and removed a slide; the autosave that followed wrote "Service - Aug 9" to Supabase with **zero `order_items`**, deleting all 14 liturgy references. Comparable orders carry 14–15. The screen still looked correct because the content was still in the DOM — that is exactly what makes this failure mode dangerous.

Repaired: re-added the slide and its background, saved (15 rows written back), then **deleted the local caches and reloaded** so the order had to come purely from Supabase. Verified whole: 95 slide boxes, 99 rail rows, 19 sections, both video backgrounds on the right slides. Confirmed twice, because a later bare-payload test call flattened `template` and the app's 2-second cloud poll pulled that back into memory, so the next save persisted an empty `sectionLayout` — rebuilt from the live page and re-saved.

### FIX 1 — an empty item payload can no longer delete an order's content

There was already a wipe guard (~line 24352) but it only fired for **silent** saves and only counted **songs**, so a liturgy-only order sailed past it and so did every explicit save.

Two guards, at both layers:

1. **`SBQ.saveOrder`** — the point of destruction. `sb.from('order_items').delete()` ran unconditionally and `if (!items.length) return null` came *after* it, so an empty payload erased everything and reinserted nothing. Now an empty payload only clears stored rows when the caller sets `allowEmptyItems`; otherwise it counts the existing rows, leaves them alone, and returns `itemsPreserved`. The order row still saves, so title/template/layout/backgrounds are not held back.
2. **`saveCurrentOrder`** — before the payload is built. If collection returned no items but the page is showing content boxes (or, on the Song Order tab, the last snapshot held items), the collection failed: save nothing and toast, rather than persisting a result already known to be wrong. Covers all item types, silent and explicit.

An order the user genuinely emptied is distinguished by evidence: sections on screen holding zero content boxes sets `allowEmptyItems`, so it still clears.

Verified: the exact payload that caused the loss now returns `itemsSaved: 0, itemsPreserved: 15`; a normal save is unaffected (15 items, `allowEmptyItems: false`, normal toasts). Guard 2's blocking branch is verified by construction and the shared code path — a collection failure cannot be induced from outside the module — while Guard 1, the one that actually prevents loss, is verified end-to-end.

### FIX 2 — invalid slide drags no longer eat an undo step

`lcdRailDrop` called `_lcdPushUndo()` on its first line, before any validity check. Slides can only be reordered inside their own song/liturgy item, so every cross-item or abandoned drag pushed a no-op entry and bailed; the next Ctrl+Z appeared to do nothing. Moved the push to after the checks, matching `lcdSectionDrop` which already got this right. Reproduced before the fix: drop changed nothing, following undo also changed nothing.

### Clean

| Area | Result |
|---|---|
| Handler wiring | 437 `WO.*` references vs 591 exports — 2 unresolved (`promptNewOrder`, `addLiturgyItem`), both feature-detected, **zero** reachable from markup |
| Duplicate element IDs | none |
| Rail integrity | numbering monotonic, no gaps, no orphan rows (99 rows / 95 boxes; the 4 extra are ESV and PowerPoint rows) |
| Backgrounds on add | append at index 5, existing stay on their own slides |
| Backgrounds on delete | deleted index 1 → background on 4 correctly moved to 3, same content |
| Backgrounds on reorder | slide 0 → position 2, background travelled with it |
| Undo/redo | restored add, delete and reorder exactly |
| Save → reload round-trip | reproduced state exactly through Supabase |
| Section menu / collapse | all seven actions fire, chevron reachable, no console errors |

### Known limitation, not a defect

Slides reorder only **within** their own song or liturgy item. `lcdRailDrop` bails on `!_lcdSameGroup`, and `lcdRailDragOver` does not `preventDefault()` across items so the cursor shows "no drop" — at least it is discoverable, but moving a slide between two hymns is not possible today.

### Lesson for future testing on live orders

Do not call `WO.lcdUndo()` speculatively — the stack persists across test steps and popping past the baseline mutates real data, and the autosave that follows persists it. Snapshot first, and prefer restoring by explicit re-application over undo.

---

## 2026-08-11 — Section menu, media-to-all, video autostart, matched editor/output, desktop file drop (branch `feature/premium-mobile-roster`)

### 1. Section header: seven overlaid buttons → one actions menu

`.lcd-rail-add-btns` was `position: absolute` over the header and, at the schedule column's real width, its seven 28px buttons plus the 24px gradient came to ~244px in a ~250px header — **covering the title and the collapse chevron**, which is why the section could not be collapsed at all.

Replaced with a single always-visible `.lcd-rail-menu-btn` (30px) plus `#lcdSectionMenu`, a popup parented to `<body>` so the schedule column's own scrolling cannot clip it. Seven 38px labelled rows (Add song / Add liturgy / Add presentation / All Slides editor / Add blank slide / Rename / Delete, plus the readings template on scripture sections). Same handlers, dispatched through `lcdRunSectionAction()`. Verified: title now 137px wide, chevron returns itself from `elementFromPoint`, collapse works (99 → 94 → 99 rows).

### 2. Media: "apply to every slide", and video that actually starts

- **ALL button** on each Media Tray thumbnail → `lcdApplyMediaToAllSlides()`, which walks every section through the same `_setBgAllSlidesInSection()` writer the section drop already uses, so the storage shape and the undo entry are identical. Verified 2 → 95 of 95 slides.
- **Video autostart.** A freshly inserted `<video autoplay muted>` does not reliably start when its container was hidden or zero-sized at insert time — which is exactly the Slide Editor canvas and the Program Output mirror at the moment of a drop. `autoplay` is never retried once the element becomes visible, so the clip sat on frame 0 until the slide was re-selected. New `_kickVideo(el)` rewinds to 0 and calls `play()` explicitly, once immediately and once on `loadeddata`. Wired into both `_applyBgToDivEl()` branches; `applyBackgroundToPreview()` additionally resumes an element that was left paused rather than restarting it.

### 3. Slide Editor and Program Output as a matched pair

Equal widths (50/50) with the editor exactly 20px taller. Measured: editor 364x361, output 364x341, delta 20.

The screen needed `flex: 0 0 auto` — with `1 1 auto` the flex column stretched it to fill and the resulting definite height silently beat `aspect-ratio`, giving 364x268 instead of a true 16:9. It now measures 364x205, ratio 1.778. `.lcd-program-actions { margin-top: auto }` keeps the projection buttons pinned to the bottom of the box.

### 4. Drag files straight in from the desktop

`_lcdSetupMediaDropZone`'s drop handler now checks `e.dataTransfer.files` first:
- **pictures / video / audio** → `_lcdIngestDroppedFile()` makes a saved background (same record shape as `handleBackgroundUploadLocal`, written out because that function has no callback) and applies it to whatever was dropped on — one slide, or the whole section if the drop landed on a section header.
- **.pptx / .ppt / .pdf / .docx / .key / .odp** → opens the existing Add Presentation modal for that section with the file already queued (`addPowerPointSlides()` then `handleSlidesFileSelect([file])`, in that order because the first resets the pending list).

**Bug caught in my own new code during verification:** `wholeSection` was `!!(t.railSection || t.sectionEl)`, but `sectionEl` matches for *any* drop inside a section container — including one aimed at a single slide. Dropping a picture on one slide wallpapered all 23 slides in that section. Now uses the same precedence the tray-thumbnail path does: `!t.railRow && !t.slideBox && ...`. Verified after the fix: slide drop → 1 slide, header drop → 23 of 23.

### Verification note worth remembering

The first re-test after that fix still showed the bug. The page had been reloaded **before** `dist/index.html` was synced, so the running build predated the fix even though `fetch('/')` showed the new code. Always reload *after* the sync, not before.

### Cleanup

All test artefacts removed and confirmed against the database: `template.sectionBackgrounds` back to exactly the two original `video:bg_1783769031541` entries on section-0 slides 0 and 4, five test media items deleted, 2 media items remain, 99 rail rows. Density pass intact (banner 103px, no page scroll, only the song list and schedule scroll). `node --check` clean on all 12 blocks; `dist/index.html` byte-identical.

---

## 2026-08-11 — Song preview window + two full-screen bugs (branch `feature/premium-mobile-roster`)

Three items from live use of LCD Projection.

### 1. Song preview — double-click a Song Library card

`#lcdSongPreviewModal`. Read, project or edit a song **without adding it to the schedule**. The slide split is `parseLyricsIntoSlides()` and projection goes through `sendToProjectionWindow()` — the funnel the Program Output mirror and the real projector already share — so this is a new window onto existing machinery, not a second rendering path.

- **Project This Slide** pushes the selected slide straight to the projection output. Verified: selecting slide 4 and projecting put that slide's text (and not its `Verse 4` header) into `#lcdProgramOutput`.
- **Edit Lyrics** → two saves, deliberately named for what they touch:
  - **Save for This Order** — stores the wording on `currentOrderData.template.songLyricOverrides`, the same field `sectionBackgrounds` and `sbFontSettings` already persist through, so it survives a reload and travels with the order in Supabase **with no schema change**.
  - **Save to Song Library** — goes through `SBQ_SONGS.updateLyrics()`, the songbook's own path, so it also fires the existing broadcast and other operators' LCD Projection is notified live. A library save clears any per-order override for that song; leaving it would silently keep showing the old words.
- **Use Library Version** appears only once the order's wording has diverged. Without it "Save for This Order" would have been one-way — a gap found while testing, not in the spec.
- A flag in the header says which copy is on screen (library / this order's / already in the service), so nobody edits the wrong one by accident.
- **Both insert paths honour a pending override.** `addSongDirectly()` has two builders: the section-scoped one goes through `_woBuildSongSectionEntry()` (also used by drag-to-position) and the no-section one builds its own `songEntry`. Only patching the second would have meant the override applied from the picker but not from a drag. The re-add branch was also clobbering `lyrics` with the library copy, which would have discarded an order override whenever a song was re-added to another section.
- Esc closes (or cancels the edit); arrows walk the slides; both stand down while the textarea has focus.

### 2. Barrier / BG "not opening" in full screen — a z-index problem, not a modal problem

`body.lcd-workspace-fullscreen #worshipOrderView` was `z-index: 9000`. **Every overlay below 9000 opened behind it** — Barrier (2500), the Liturgy library (2210), the Songbook (2200), Media (3000), song links (2800). Measured before the fix: the Barrier modal was `display: flex` and full-size, but `elementFromPoint` at its centre returned `.lcd-topbar`.

Fixed at the source rather than by raising modals one at a time: `position: fixed; inset: 0` already covers the page geometrically, so the workspace only has to beat the app chrome. Dropped to **500** — below the lowest overlay in the app (the notification backdrop at 600) — so every dialog now wins by default and nothing has to be listed. Verified after: Barrier, BG and Text all return themselves from `elementFromPoint`.

### 3. No way back to LCD Projection from full-screen Song Order

In full screen the Orders banner (which carries the two mode buttons) is hidden, and the LCD top bar belongs to the preview panel, which Song Order hides. The Song Order toolbar's buttons are Add Songs / Playlist / Songbook / Share — no Service Order button. So the operator was stuck until they left full screen.

Added `#lcdFsModeBar`, shown only in that exact combination (`body.lcd-workspace-fullscreen.wo-mode-song`), with **LCD Projection** and **Exit Full Screen**. Verified: bar appears top-right, clickable, and returning to LCD Projection **keeps full screen on**. `showOrderModeLanding()` now also leaves full screen, since the landing screen is hidden by the full-screen CSS and would otherwise be a blank viewport.

### Bug found and fixed during verification

`showLoader()` lives in a different `<script>` block and is **not in the `WO` IIFE's scope** — calling it threw `ReferenceError` and stranded the modal mid-save (this is why a first test run hung). Replaced with `_lcdPrevSetSaving()`, which disables the footer locally. An audit of every identifier the new block calls against the WO scope found no others. Worth remembering: the codebase already guards this elsewhere with `typeof showLoader === 'function'`.

### Verification

- Order-only round trip: edit → save → flag flips → reopen shows the order's wording → revert → back to library wording. Library object untouched throughout.
- Library save exercised with `SBQ_SONGS.updateLyrics` **stubbed**, so the wiring was proven without writing to Supabase; captured call carried the right id and edited text.
- Pending-override-then-add: saved an order-only edit for a song **not** in the service, added it to a section, and the 5 slides that landed carried the order's wording, not the library's. Rail 98 → 103.
- **Test data removed and confirmed against the database**: song removed from the section and from Song Order, rail back to 98, order saved. Supabase shows `template.songLyricOverrides: {}`, 14 order_items, 0 song items, no "Alas" anywhere, and the library song's lyrics byte-unchanged at 778 chars.
- Density pass from the previous entry still intact: banner 103px, no page scroll, only the song list and schedule scroll. All LCD controls fire with no console errors.
- `node --check` clean on all 12 blocks; `dist/index.html` byte-identical.

---

## 2026-08-11 — LCD Projection density pass: the windowed workspace fits on one screen (branch `feature/premium-mobile-roster`)

Feedback on the non-full-screen workspace: nearly every panel had its own scrollbar — the library's filter chips, the schedule, the Slide Editor body, the format toolbar sideways, the Media Tray — inside a page that also scrolled. Ask: smaller type (~5px off the display sizes) and make it fit without scrolling, "while maintaining readability".

**Three causes, not one.**
1. **The Orders banner was 337px** of mostly decoration sitting above the workspace — the single biggest space thief, and the reason Full Screen (which hides it) felt so much better.
2. **Only the workspace column was capped to the viewport.** The Service Schedule stretched `#worshipOrderView` to the height of the whole service — **9,362px** for a 98-slide order — so everything below the fold needed page scrolling to reach.
3. Type scale and control heights were tuned for full-screen.

**What changed**
- **`lcd-mode` marker** on `#worshipOrderView`, set in `selectOrder()` and cleared in `showOrderModeLanding()`. Scopes the banner slimming to LCD Projection: Song Order and the landing screen keep the full banner. Desktop only (`min-width: 1201px`).
- **Slim banner, 337 → 103px.** Title and order pill share one row, the italic tagline hides, the order controls and the two mode buttons share a row. **Every control is still present and visible** (Menu, Save, Save As, Undo/Redo, Zoom, Liturgy, Songbook, both mode buttons) — verified by measuring each one.
- **`_lcdSizeWorkspaceColumns()`** caps all three columns to the same band below the banner, measured from `.wo-main-content`'s real top so it adapts to whatever height the banner ends up. It also flips the workspace column from `align-self: flex-start` to `stretch`, which is what lets the editor canvas take the slack rather than leaving it empty below the panel.
- **`applyLayout` now runs on a `setTimeout` as well as `requestAnimationFrame`**, on entry and on resize. rAF is throttled in background tabs, so without it the workspace stayed unsized until the tab was focused.
- **Type/spacing pass** (last LCD block in the sheet, so it wins on source order): rail title 15.5→13.5px, section header 0.82→0.72rem, editor text 1.25→1.05rem, panel headers, library cards, media hint, control heights. **Full-screen keeps 1.2rem editor text** via its own later rule.
- **Format toolbar no longer scrolls sideways.** It wraps by group, and groups wrap internally — that second part is what guarantees no horizontal scroll at any width, since the Text group alone is wider than a narrow editor column. `overflow-y` had to go back to `visible` too: with one axis hidden the other computes to `auto` and the scrollbar returns.
- **Outputs 55/45 → 60/40.** At 55% the editor was too narrow for its own toolbar and header, which then wrapped to three and two rows and ate the canvas. The Program Output is still a full 16:9 preview.
- **1201–1699px:** the fixed 280/320 tracks left the workspace under 500px and the editor at ~170px. Narrowed to 196/286; the three secondary banner labels (which already mark themselves `wo-btn-lbl-secondary`) hide, keeping the banner on one row. Stacking the output under the editor was tried and is worse — a full-width 16:9 preview is taller than the whole outputs row.
- **`Apply Changes` → `Apply`** on the editor button (same handler, same tooltip) — worth ~29px of header height, which was the difference between one row and two.
- **Media Tray** thumbnails 104 → 76px and a smaller hint; the lower row gets a 128px floor so the flex column can't squeeze the tray into its own scrollbar. Below 1201px the outputs row gets its 340px floor back, otherwise the full-width output squeezed the editor panel to **zero height**.

**Measured, fresh load per width, order "Service - Aug 9" (98 slides):**

| Viewport | Page scrolls | Remaining scrollers | Editor canvas |
|---|---|---|---|
| 1920x1080 | no | song list, schedule | 354px |
| 1740x900 | no | song list, schedule | 196px |
| 1600x900 | no | song list, schedule | 148px |
| 1440x900 | no | song list, schedule | 119px |
| 1366x768 | no | + editor body | 118px |
| 1100x800 (tablet) | yes (pre-existing) | + editor body | 118px |
| 375x812 (mobile) | yes (pre-existing) | no horizontal overflow | — |

The two remaining scrollers are the inherently long lists (98 songs, 98 slides) — those will always scroll. At 1366x768 the editor body still scrolls a little; 768px of height genuinely cannot hold banner + toolbar + 16:9 output + editor + tray, and Full Screen is the answer there.

**Regression checks, all passing:** Song Order mode unwinds completely (`lcd-mode` off, banner back to 337px, inline column caps cleared, rail full-width, `display: block`). Full Screen still works and keeps its larger canvas (407px) and 1.2rem text; toggling back restores the windowed sizing. Align / Bold / undo / redo / zoom / library filter / Expand Schedule / Collapse Library all fire with no console errors. `node --check` clean on all 12 blocks; `dist/index.html` byte-identical.

**Pane caveat worth remembering:** `.wo-main-content` has `transition: grid-template-columns 200ms`, and this browser pane never advances transitions — after a resize the computed columns stay frozen at the old value, which looks exactly like a media query failing to match. Every width above was therefore measured on a **fresh page load**, not a resize.

---

## 2026-08-11 — Songbook edits now reach LCD Projection instantly (branch `feature/premium-mobile-roster`)

Closes the limitation recorded in the two entries below: the lyric notice previously only appeared on the operator's next song-list refresh, because a songbook edit never reached their browser.

**Mechanism: Supabase Realtime *broadcast*, not `postgres_changes`.** Deliberate choice — broadcast needs no table replication enabled in the Supabase dashboard, so it works on this project as-is, and it matches the channel pattern already used four times in this file (sermon remote, songbook presence). `postgres_changes` would additionally catch edits made outside the app, but silently does nothing unless replication is switched on server-side, which is exactly the kind of dead code this codebase has been avoiding. If replication is ever enabled, adding a `postgres_changes` subscription alongside this would be a small, purely additive change.

1. **Publisher — `SBQ_SONGS._announceSongChange(id, lyrics)`**, called from both `updateLyrics()` and `update()` (including its no-scripture-column retry branch) after a *successful* write. Putting it in the data layer rather than at each UI save site means every lyric-changing path is covered, including the Edit Song form. Wrapped in try/catch and fire-and-forget: a notification failure must never surface as a save failure.
2. **Subscriber — `_lcdStartSongLiveSync()` / `_lcdStopSongLiveSync()`**, started in `selectOrder('service')` and torn down in `selectOrder('song')` so the channel only lives while LCD Projection is on screen. On receipt it patches the incoming lyrics into `LHC_STATE.songs`, clears the status cache, re-renders the rail and the Library panel, and toasts. It ignores messages for unknown songs or lyrics it already has, so no redundant repaints.
3. Because the rail render refreshes the banner for the currently-open slide with `acknowledge=false`, a change arriving while the operator is working on that very slide surfaces in place and still cannot mark itself as read.
- **Verified across two real browser tabs.** Tab 1 in LCD Projection with the song in its schedule (0 badges). Tab 2 acting as the worship team, editing through the genuine `SBQ_SONGS.updateLyrics` path. Without any reload in tab 1: its in-memory lyrics updated, the badge appeared on **exactly slide 1.9**, and opening it showed the banner with the new wording and the refresh action. The song's lyrics were then restored **in the database** (this test wrote for real, unlike earlier in-memory ones) and confirmed byte-equal to the original.
- Test order removed by id; **21 real orders, both "Service - May 3" intact, 0 test orders.**

---

## 2026-08-11 — Fixed the liturgy edit-loss bug + two unexported Songbook handlers (branch `feature/premium-mobile-roster`, committed locally, not yet pushed)

Fixes for the bugs the previous entry documented. **It also corrects an overstatement in that entry** — see the last bullet.

1. **Liturgy slide edits no longer discarded on reload** (`Index.html` ~27478). The restore preferred `_litRecord.content` (the live library copy) unconditionally, so any edit the operator made to a liturgy slide was overwritten on the next load even though it had saved to Supabase correctly. Inverted the preference: **this order's saved slides win; the live module record is the fallback for when the order has none.** An order now owns its copy of a liturgy item exactly as it does for a song, which is also the assumption the new lyric-notice feature is built on. Verified with the same round trip that exposed the bug — edit a liturgy slide → save → delete the local caches → full page reload → reopen from the database: the edit is now present and rendered in the rail at 1.1. Before the fix it was provably absent from the DOM despite being in the cloud row.
2. **Exported `sbOpenAnnotPaletteFromPage` and `sbSetLinkZoom`.** Both are defined but were never on the `WO` object, and both are invoked *unguarded* from markup (`onclick="WO.sbOpenAnnotPaletteFromPage()"` on the Songbook fullscreen annotate FAB, and `onchange="WO.sbSetLinkZoom(...)"` on the per-link zoom selects), so every click threw "not a function". One-line export each; no logic touched.
3. **Correction to the previous entry.** It claimed four `WO.*` handlers "will throw when invoked". Only the two above actually do. `WO.addLiturgyItem` (~57307) and `WO.promptNewOrder` (~16611) are both **feature-detected before use** — `if (typeof WO !== 'undefined' && WO.addLiturgyItem)` and `if (window.WO && window.WO.promptNewOrder) … else showToast('Create a new order from the Orders page')`. They are optional integration points that degrade gracefully, not bugs. The earlier claim came from a static call-site scan that did not read the surrounding guard; reading the call sites corrected it. Left alone.
- `node --check` clean on all 12 blocks, byte-identical `dist/index.html`. Test order removed from Supabase by id; **21 real orders, both "Service - May 3" intact, 0 test orders.**

---

## 2026-08-11 — Final audit: Supabase round-trip verified; two pre-existing bugs found (NOT fixed) (branch `feature/premium-mobile-roster`, committed locally, not yet pushed)

Whole-page audit of LCD Projection: syntax, broken references, and a genuine end-to-end Supabase save → wipe local cache → full page reload → reopen-from-cloud round trip.

**Static checks — clean.** All 12 inline script blocks pass `node --check`. No duplicate element ids in LCD Projection (the ids a naive scan flags are template-literal patterns like `'sbPage-' + sid` that generate unique ids at runtime, plus three cases where a JS re-render string replaces the original markup — `woSongOrderSections`, `spmOrdersList`, `litDeleteConfirmOverlay` — all mutually exclusive render paths, not collisions).

**Supabase persistence — verified working.** A cloud save wrote the order plus 15 `order_items` rows. Then the local caches were deleted outright (`lhc_worship_orders` and the order-scoped `lhc_section_backgrounds_*` key), the page fully reloaded, and the order reopened from the database. Survived correctly: the drag-added song (all 5 slides, right section, `item_type: song`), the section's 9 slides, the rail's 103 rows, and the per-slide background. Worth knowing for future debugging: **per-slide backgrounds are not stored in the `order_items.backgrounds` column** — `saveSlideBackgrounds()` mirrors them into `currentOrderData.template`, so they persist on the **orders.template.sectionBackgrounds** field (confirmed in the cloud as `{"wo-section-0":{"2":{"type":"solid","value":"#7B241C"}}}`). Looking in the item column and finding it empty is a false alarm.

**BUG 1 (pre-existing, real data loss) — edits to a LITURGY slide are discarded on reload.** `Index.html` ~27478: when restoring a liturgy item the code does `if (_litRecord && _litRecord.content) { _litContent = _litRecord.content; } else if (item.slides…)`. The live LiturgyModule record therefore **always** wins over the order's saved slides. Its own comment says to "fall back to the Supabase-saved slides if the module isn't loaded yet **or the item was edited**" — but nothing ever tests whether the item was edited, so that branch is unreachable for any loaded item. Proven end-to-end: an edit typed into a liturgy slide saved correctly to Supabase (found in that item's `slides`, `item_type: liturgy`) yet was **absent from the DOM after reload**. Song slide edits are unaffected — they restore correctly. Not fixed: the correct behaviour is a product decision (should a liturgy item keep the order's copy the way songs do — which is what the new lyric-notice feature assumes — or keep auto-adopting the library version?), and it sits outside the redesign's scope.

**BUG 2 (pre-existing, outside LCD Projection) — four `WO.*` handlers referenced from markup/code that will throw when invoked.** `WO.addLiturgyItem` (called at ~57288) and `WO.promptNewOrder` (~16612) are **not defined anywhere** in the file. `WO.sbOpenAnnotPaletteFromPage` (Songbook fullscreen annotate FAB, ~9338) and `WO.sbSetLinkZoom` (Songbook link-zoom selects, ~35679/36076) **are defined but never exported** on the `WO` object, so those calls fail too. All four are in Liturgy/Songbook, none in LCD Projection, and none introduced by this redesign. The two unexported ones are a one-line fix each; the two undefined ones need someone to say what they were meant to do.

- Test data cleaned up as before: disposable order deleted from Supabase by id. **21 real orders, both "Service - May 3" intact, 0 test orders.**

---

## 2026-08-11 — Lyric notice becomes per-slide, acknowledge-on-view, with a refresh action (branch `feature/premium-mobile-roster`, committed locally, not yet pushed)

Reworked the awareness feature to the clarified spec: the badge belongs on the *slide carrying the changed lyric*, the operator must be able to see *what* changed, opening the slide clears the badge, and a change arriving while they are working on that slide must offer a way to pull it in.

1. **Per-slide, not per-song.** `_lcdChangedSlides(entryId)` splits both the order's copy and the library copy through the app's own `parseLyricsIntoSlides()` — the same splitter the projector uses, so a difference lands on the slide the operator actually sees — then compares each slide words-only via `_lcdLyricsOnly()`. Returns a map of slide index → `{libText, orderText, kind}` where kind is `changed` / `added` / `removed`. Verified on a real 5-slide hymn: editing one word of Verse 5 flags **exactly one slide (1.5)**, not all five.
2. **The banner shows the change.** It now renders the heading, the library's actual wording for that slide in a scrollable block, and two actions. Chord lines are excluded from that preview too, so the operator reads words, not a chord chart.
3. **Acknowledge on view, per version.** `_lcdAckedSlides` is keyed `entryId|slideIdx` and stores the library text that was seen. Opening the slide acknowledges it and the badge clears; if the worship team edits **that same slide again** the stored text no longer matches and the badge returns. Verified: flag → open → clears → second edit → flag returns.
4. **Live edit while the operator is on the slide.** `_lcdRenderCompactRail()` now refreshes the banner for the currently-open slide, passing `acknowledge=false` — passive refreshes must never self-acknowledge, or a change arriving mid-session would clear itself before being read. Verified by nudging the rail observer with the slide open: the banner appears in place, showing the new text, with the refresh offered.
5. **Two actions**: "Use the library version" (`lcdRefreshSlideFromLibrary`) writes the library wording into the slide via the existing `_lcdWriteSlideText` + `_lcdCommitEditorToSlide`, pushes undo first, and acknowledges; "Keep this order's version" (`lcdDismissLyricNotice`) just acknowledges. Both verified.
- **Subtlety worth recording**: after a refresh the banner is hidden outright rather than recomputed. The slide now carries the library wording, but the *entry's* stored `lyrics`/`masterLyrics` still hold the old text, so a recompute would keep reporting a difference the operator has already resolved. Per-version acknowledgement keeps the rail badge off as well, and a genuinely new library edit still raises both again.
- **Important limitation, unchanged by this work**: a songbook edit does not push to the LCD operator's browser. `LHC_STATE.songs` only refreshes when `loadSongs()` runs, so the notice appears on the next song-list refresh (page load, or any path that reloads songs) — not the instant the worship team saves. Making it truly live would need polling or a realtime subscription. The in-session behaviour above is what works today.
- Regression + cleanup: `node --check` clean, byte-identical `dist/index.html`, no new console errors. Test orders removed by id; **21 real orders, both "Service - May 3" intact, 0 test orders**; the library lyrics used for testing were restored (in-memory only, never written to the database).

---

## 2026-08-11 — Fourth audit: badge now reports lyric changes only, never chords (branch `feature/premium-mobile-roster`, committed locally, not yet pushed)

Per explicit instruction — the badge must inform on **lyric** changes only, not chord changes. That turned out to fix a false positive in the *other* direction too, which the previous round had not spotted: because comparison was on raw text, a **chord-only edit in the library** (a reharmonisation, or someone adding a chord line) would have raised "Library copy updated" even though not a single word had changed.

1. **New `_lcdLyricsOnly()` reduces a song to its words before any comparison.** It drops whole lines that are chord charts and strips inline chord brackets (`[G]`, `[Am7]`, `[Bb/D]`), while deliberately preserving structural markers like `[Verse 1]`/`[Chorus]` — those are part of the words' shape and a change to them is worth reporting. It reuses the app's own tuned detectors `isChordToken` / `isChordLineGlobal` (both top-level, so in scope from the WO module) rather than a new parser; those already handle the "Am" vs the English word "am" trap that is everywhere in worship lyrics.
2. **Both comparisons now run words-only**, which let the previous round's `transposeSteps === 0` guard be deleted entirely: if a transposition leaves the words untouched the two sides simply compare equal, so no special case is needed. **That also closes the blind spot flagged last round** — a song that is *both* transposed and reworded now flags correctly, because after chord-stripping the words genuinely differ.
3. Labels reworded to say what is actually being reported: "Lyrics edited for this service" / "Library lyrics updated", each ending "(Chord and key changes are not reported.)".
- **Safety property worth keeping in mind**: both sides of every comparison go through the identical normaliser, so a misjudged chord line can only ever *mask* a real difference — it can never invent one. The failure direction is false silence, never a false accusation.
- **Verified with a 9-case table** driven through the real global chord detectors: chord line above lyrics, inline bracket transposition, full reharmonisation, genuine word change, transposed-and-reworded, section markers preserved, section marker renamed, verse added, and "Great I Am" not misread as a chord line — **all 9 pass**.
- **Verified live end-to-end**: baseline 0 flags → chord-only library change **stays silent (0 flags)** → word change raises 5 flags with reason `library` → restore returns to 0.
- Regression after the change: rail 103 rows, schedule header, 51 library cards, editor canvas, 3 toolbar groups, Blank/Project in the Program Output box, banner present, no overflow, no new console errors. Background re-pinning still correct through a delete (slide moved to index 1, background followed). `node --check` clean, byte-identical `dist/index.html`. Test order removed by id; **21 real orders, both "Service - May 3" intact, 0 test orders**; the library lyrics used for testing were restored (in-memory only, never written to the database).
- **Remaining known limit**: a change consisting *only* of a renamed section marker inside an otherwise chord-heavy line could be missed, and lyrics deliberately written to look like a chord progression (a line of ≥50% chord-like tokens) are ignored on both sides. Both are the safe failure direction described above.

---

## 2026-08-11 — Third audit: undo interaction, slide delete, transpose false-positive (branch `feature/premium-mobile-roster`, committed locally, not yet pushed)

Third pass, targeting areas the first two did not reach: how the new code composes with undo/redo, the slide-delete path, and the correctness of the new lyric-divergence badge under transposition.

**Verified sound, no change needed — undo/redo composes correctly with the background remap.** `_lcdSnapshot()` already captures `sectionBackgrounds` (alongside the DOM, `songOrderSections` and `currentSermonSlides`), and `_lcdRestoreSnapshot()` restores it, persists via `saveSlideBackgrounds()`, and re-renders the rail — which also re-wires the Phase 4 library drop listeners that the `innerHTML` replace destroys. Because `_lcdPushUndo()` runs *before* the capture/remap, the snapshot holds pre-insert state. Proven live: background on slide 3 → drag-insert moves it to 8 → Ctrl+Z returns both the slides and the background to index 3.

**Fixed (pre-existing, same root cause as last round): deleting a slide misaligned backgrounds.** `_lcdDeleteSlideBox()` pushed undo but never touched `sectionBackgrounds`, so removing a slide shifted every later slide's background by one — each following slide inherited its neighbour's. Applied the same `_lcdCaptureSectionBgs`/`_lcdRestoreSectionBgs` pair around the removal. Entries whose slide is gone drop out naturally, since restore only re-pins boxes still in the container. Verified: background on slide 3, delete slide 1, slide moves to index 2 and its background follows; Ctrl+Z restores both. **All three slide-mutation paths — insert, reorder, delete — now re-pin correctly.**

**Fixed a flaw in the new badge: a transposed song was reported as having edited lyrics.** `collectOrderItems()` writes the transposed text into `customLyrics` whenever `transposeSteps !== 0`, so "has customLyrics" alone does not mean the words changed — merely changing key would have raised "Edited for this service". Two corrections: (a) only claim `custom` when `transposeSteps === 0`, since separating a transposition from a real edit would need chord parsing and a false accusation is worse than silence; (b) compare against `masterLyrics` (the authoritative untransposed text) in preference to `.lyrics`, which can itself hold transposed content and would otherwise false-positive as "Library copy updated". Validated with an 8-case table covering identical, whitespace-only noise, library-edited, genuinely-edited, transposed-only, transposed-plus-library-moved, transposed-`lyrics`-with-clean-master, and song-missing-from-library — **all 8 pass**, including the two the pre-fix rule got wrong.
- Live re-verification of the badge after the change: silent when the copies match, 5 flags with reason `library` on exactly the edited song, cleared again on restore.
- **Known limitation, stated plainly**: a song that is *both* transposed and has genuinely edited words will not raise the `custom` flag (it still raises `library` if the library copy differs). Detecting that case needs chord-aware comparison; the codebase has `isChordLine`/`isChordToken` heuristics that could support it, but wiring a fragile parser into a correctness signal was not worth it without a real need.
- Full regression after all three changes: rail 98 rows, schedule header, 51 library cards, editor canvas, 3 toolbar groups, Blank/Project in the Program Output box, lyric banner present, no page overflow, no new console errors. `node --check` clean, byte-identical `dist/index.html`. Three disposable orders removed from Supabase by id; **21 real orders, both "Service - May 3" entries intact, 0 test orders**.

---

## 2026-08-11 — Second audit (data integrity) + "lyrics differ from library" awareness (branch `feature/premium-mobile-roster`, committed locally, not yet pushed)

A second audit pass aimed at cross-order contamination, media/PowerPoint integrity and content consistency, plus a new operator-awareness feature.

**Audit: what was already safe.** Cross-order contamination is well guarded on the load path — `openOrderInEditor()` explicitly clears `sectionBackgrounds` and `currentSermonSlides` (uploaded PowerPoint/image slide data) with comments naming the exact risk, replaces `songOrderSections`/`serviceSectionSongs` wholesale from the loaded order, and re-reads backgrounds through an order-scoped `_slideBgKey()`. `createNewOrder`/`createOrderFromModal` reset the same state. Media in the tray (`savedBackgrounds`) is a shared library by design. No leakage found.

**Audit finding (MEDIUM-HIGH, introduced by Phase 4): drag-inserting a song silently moved other slides' backgrounds to the wrong slides.** `sectionBackgrounds` is keyed `[sectionId][localIdx]` where `localIdx` is the slide's *position among that section's slide boxes*. Inserting a song mid-section renumbers every later slide, but the background map was left untouched. Proven: a background pinned to slide 3 stayed on index 3 while its slide moved to index 8 — so it ended up on a completely different slide. Fixed with `_lcdCaptureSectionBgs()` / `_lcdRestoreSectionBgs()`, which capture the element→background pairing before the mutation and rewrite the map from the boxes' new positions afterwards (node identity survives a move, so the pairing holds however far things shift). Re-ran the exact failing case: the background now follows its slide 3 → 8. The **pre-existing** slide-reorder path (`lcdRailDrop`) had the same flaw and got the same treatment.
- **Still outstanding (pre-existing, not fixed):** deleting a slide mid-section renumbers the same way, so `_lcdDeleteRailRow` very likely misaligns backgrounds too. Not touched by this redesign, so left alone rather than widened scope — but it is the same root cause and worth a follow-up.

**New feature — "these lyrics are not the library default".** An order stores its own copy of a song's lyrics, taken when the song was added. `_lcdSongLyricsStatus(entryId)` compares that copy against the current library song and reports one of two states, on normalised text so whitespace/line-ending noise never trips it:
- `library` (amber) — the worship team edited the song in the library after it was added to this order. The order still projects its saved copy.
- `custom` (blue) — the lyrics were deliberately customised for this service (`hasCustomLyrics` + `customLyrics`).
Surfaced two ways: a small pen-nib flag on every affected rail row in the Service Schedule, and a full banner above the Slide Editor when such a slide is loaded, both carrying the explanation as tooltip/body text. A song with no library match (deleted or re-ided) is deliberately left unflagged rather than falsely reported. Status is cached per rail render and the cache is cleared on every render and on every editor load, so a library edit surfaces without reloading the order.
- **Verified live end-to-end**: silent when the order copy matches the library (0 flags, banner hidden); after simulating a worship-team library edit, exactly the affected song was flagged on all 5 of its slides with reason `library`, and clicking a flagged row showed the banner "Library copy updated — The worship team has changed this song…"; a liturgy slide correctly showed no banner; restoring the library lyrics cleared all flags again. Only the edited song was ever flagged. `node --check` clean, byte-identical `dist/index.html`, no new console errors.
- **Note on where lyrics live**, since this tripped me up: library edits write `STATE.songs[i].lyrics` (lines ~11442/18599), while an order entry keeps its own `lyrics` snapshot plus the `masterLyrics`/`customLyrics`/`hasCustomLyrics` trio used by the songbook/transpose system. The new check deliberately reads only `lyrics`/`customLyrics` and writes nothing, so it cannot disturb that model.
- **Test data**: three disposable orders were created during this round; all removed from Supabase **by id** (per the previous entry's lesson), leaving 21 real orders with both "Service - May 3" entries intact. The library lyric edit used for testing was an in-memory mutation only and was restored; it never reached the database.

---

## 2026-08-11 — LCD Projection redesign: post-implementation audit + 4 fixes (branch `feature/premium-mobile-roster`, committed locally, not yet pushed)

A deliberate audit pass over all 8 phases looking for bugs, dead code and broken connections between features. Four real issues found, all fixed.

1. **(HIGH — regression I introduced) The 3-column grid applied on phones and tablets.** Phase 2 converted `.wo-main-content:not(.wo-song-order)` to `display:grid` with no upper bound. The app's existing phone/tablet layouts are written as flex (`@media (max-width:768px)` and two tablet queries set `flex-direction: column !important`), and **`flex-direction` is inert against `display:grid`** — so the `!important` did nothing and the grid's fixed tracks forced ~966px of content into a 355px viewport. Measured **181px of horizontal page overflow at 375px**. Fixed by confining the grid to ≥1201px and restoring `display:flex` (plus the original `max-width`/`min-width` values, and hiding the Library panel and its tab, which have no place in the mobile flow) below that. Verified: 375px and 900px now flex with zero overflow; 1280px still grids correctly.
2. **(MEDIUM) Changing a background did not update the Slide Editor canvas.** Phase 5 painted the canvas only on slide load, so after using the BG button the editor kept showing the old background until you reselected the slide. `_lcdRefreshEditorCanvas()` had been written for exactly this and was **never called — dead code**. Wired it into `setBackgroundForSlideInSection()`, which is the single funnel every background write goes through (select, clear, and whole-section alike). Verified the canvas now repaints live without reselecting: transparent → green → red.
3. **(MEDIUM) The Song Library panel never refreshed after its first render.** `_lcdRenderLibraryPanel()` was only called from `selectOrder('service')`. Songs load asynchronously via `loadSongs()`, so opening LCD Projection before songs arrived left a permanently empty panel, and songs added or edited later never appeared. Exposed `WO.lcdRefreshLibrary` and called it from `loadSongs()` — the one place songs enter `STATE.songs`.
4. **(LOW) Orphaned `.lcd-fmt-sep` CSS** left behind when Phase 5 replaced the toolbar separators with grouped containers. Removed.
- Also checked and found clean: no duplicate ids across all relocated controls; no dangling function references (`_lcdBuildSongCardHtml` is passed by reference to `.map`, which a naive call-count grep flags as dead — it is not); Song Order mode still `display:block` with the Library hidden; expand/collapse, rail, schedule header, editor canvas, toolbar groups and the relocated Blank/Project all still correct after the fixes.

**Test-data incident, resolved — worth reading before doing cleanup this way again.** During cleanup a title-vs-index mismatch made it look like a real "Service - May 3" order had been deleted. It had not. The root cause is that **the saved-orders list rendered in the UI is a stale localStorage cache, not the database**: local held 15 entries while Supabase held 21 (the cloud also has "LHC Jubilee", "Luke's Songbook" and others the local list never showed). Diffing against the local list is therefore meaningless for judging data loss. Queried Supabase directly and confirmed **21 real orders intact, both "Service - May 3" entries present, 0 test orders remaining**. The last disposable order was removed by querying its real id from the database and deleting by id after verifying the title matched — not by list position. **Lesson: verify destructive cleanup against the database, and delete by id, never by rendered-list index** (`WO.deleteOrder(idx)` indexes the in-memory array, which is ordered differently from the sorted DOM list).

---

## 2026-08-11 — LCD Projection redesign, Phases 6 + 7: Program Output prominence + full regression pass (branch `feature/premium-mobile-roster`, committed locally, not yet pushed)

Final two phases of the LCD Projection redesign. **All 8 phases (0-7) are now complete.**

**Phase 6 — Program Output prominence (priority #9).** `#woBlankBtn` and `#woFullscreenBtn` moved out of the top toolbar into a `.lcd-program-actions` strip directly beneath the Program Output screen, so the projection actions sit with the output they affect. Ids and onclick handlers unchanged. The Program Output box got a framed treatment (bordered, shadowed screen; uppercase tracked label beside the existing live dot). `_setGoLiveDot`/`#lcdProgramLiveDot` and `openProjectionWindow()` were not touched.
- **A gotcha worth noting for any future control relocation**: the Phase 0 button sizing for these two was written as `.lcd-controls-row .wo-blank-btn` / `.wo-live-present-btn`. Moving them out of that container silently dropped their height, radius and gold glow. Restated the sizing scoped to `.lcd-program-actions` (Blank 42px fixed-width, Project 46px and `flex:1` so it reads as the primary action). Verified 42/46px and the glow are back.
- With this move the top bar is now genuinely workspace-level and nothing else: preview zoom + order-level undo/redo.

**Phase 7 — Media Tray + full cross-phase regression pass.** The Media Tray needed no work: its CSS was already fully tokenised by Phase 0 (`.lcd-media-*` uses `var(--lcd-*)` throughout). The only hardcoded colours left are the `.lcd-media-vid-badge` and `.lcd-media-del` overlay chips, which are deliberately black/white overlays rather than theme colours. So this phase was the regression pass.
- **Regression results, all passing**: three consecutive Song Order <-> Service round-trips leave the rail (98 rows), schedule header, and Library panel all correctly present; Media Tray renders its grid and items; keyboard handlers (Ctrl+Z, arrow nav) fire without throwing; Library search still filters (7 hits for "grace", 51 back on clear); editor canvas, its three toolbar groups and the relocated align buttons all intact; Blank/Project confirmed inside the Program Output box. No page overflow at 1366 or 1920, program-actions strip fits its column at both. No new console errors beyond the standing `supabaseUrl`/500 noise.
- **Environment limitation identified and ruled out as a regression**: after the round-trips, `_enterServiceOrderLayout()`'s *inline* sticky sizing (`position`/`top`/`maxHeight` on the preview panel, `height`/`overflowY` on the section) reads as empty. Probed directly and confirmed **`requestAnimationFrame` never fires in this browser pane** while `setTimeout` does -- the pane does not composite frames. `_enterServiceOrderLayout` is rAF-driven and was never modified by this redesign, so its inline sizing simply cannot apply *here*; the CSS-level `position:sticky` still resolves. This is the same root cause as the Phase 1 finding that CSS transitions never advance, and as screenshots being unavailable. **Anything rAF-driven in this app cannot be verified in this pane and needs a real browser.**

---

## 2026-08-11 — LCD Projection redesign, Phase 5: Slide Editor canvas + grouped toolbar (branch `feature/premium-mobile-roster`, committed locally, not yet pushed)

User priority #7. Two changes: make the editing surface resemble the projected slide, and move every slide-level control into the editor's own toolbar, grouped.

1. **Canvas-like editor.** The contenteditable now sits inside `#lcdEditorCanvas` over a `#lcdEditorCanvasBg` layer that is painted with the slide's *real* background by `_lcdUpdateEditorCanvas()`, which reuses `getBackgroundForSlideInSection()` + `_applyBgToDivEl()` -- the exact pair the Program Output mirror uses, so there is one background-resolution path, not two. Typography moved off monospace to Lato/serif at 1.05rem with a text shadow for legibility over imagery, and the editor mirrors the projection's text alignment. Called from `_lcdLoadSlideIntoEditor()` (paint), `_lcdClearEditor()` (reset), and `setSlideAlign()` (live alignment).
2. **Toolbar regrouped as Text / Layout / Background**, matching the approved mockup. The align buttons, Barrier, Text settings and BG moved out of the workspace bar into the Slide Editor toolbar -- ids and onclick handlers untouched, so every one still calls its original function from its new home. What remains in the workspace bar is genuinely workspace-level: preview zoom, order-level undo/redo, Blank and Project.
3. **Deviation from the plan, deliberate**: the plan put Undo/Redo in a "More" group inside the editor. They are *order*-level (they undo schedule changes such as a Phase 4 drag-insert), not slide-level, so putting them inside the Slide Editor would misrepresent what they do. They stay in the workspace bar. Delete and "Open in Song Order" -- which *are* slide-level -- were already grouped in the editor header alongside Apply Changes, so that header serves as the "More" cluster. "Effects" remains dropped per the earlier confirmed decision.
- **Verified live**: toolbar renders as three labelled groups (Text 10 controls, Layout 1, Background 1); no duplicate ids after the move (checked all seven relocated/anchor ids programmatically -- exactly one each). Every relocated control still works from its new location: align buttons drive `setSlideAlign` *and* update the canvas alignment live (left -> `text-align:left`, center -> `center`); Barrier opens `#woBarrierModal` (it uses `style.display='flex'`, not a `.show` class -- worth knowing, my first probe looked like a failure because of that); BG opens the background modal; `lcdFmtCmd` does not throw. `lcdEditorKeydown`'s Ctrl+Enter split still fires and is `defaultPrevented`. **Background mirroring confirmed by direct comparison**: applying `solid:#8B0000` to a slide paints the editor canvas `rgb(139,0,0)`, exactly matching `#lcdProgramBg`. No new console errors, byte-identical `dist/index.html`, `node --check` clean.
- **Caught during verification**: at 1366px the editor column is only ~380px, and the Text group's 10 controls overflowed it (514px of content). Fixed by letting `.lcd-fmt-group` wrap internally and capping the font/size selects; re-measured at 1366 and 1920 with no page or toolbar overflow.
- **Two false alarms worth recording** (both my test harness, not the code): `WO.selectBackground()` takes a `'type:value'` string, so passing a bare `'#8B0000'` silently stores `{type:'#8B0000', value:''}`, which `_applyBgToDivEl` cannot paint -- it looked like the canvas mirror was broken until the argument form was corrected to `'solid:#8B0000'`. And `_lcdRelocateActiveSlideBox` is closure-private, not on `WO`, so probing through it returns null.
- **Test data cleaned up**: one disposable "Traditional Worship Order" identified by diffing against the 15-title baseline and deleted; list back to the baseline 15.

---

## 2026-08-11 — LCD Projection redesign, Phase 4: drag a Library song to a schedule position (branch `feature/premium-mobile-roster`, committed locally, not yet pushed)

User priority #5, and the phase the plan flagged as highest regression risk because it shares drop targets with two existing drag systems (rail slide reorder and whole-section reorder). Phase 3 was already completed as part of Phase 2 (the `confirmSectionAssignment` service-render fix), so this closes the add-to-schedule work.

1. **Third drag system, deliberately isolated.** Library cards are now `draggable` and set their own `_lcdDragSongId` state var. Every existing rail/section handler bails unless `_lcdDragRowId`/`_lcdDragSectionId` is set, and every new handler bails unless `_lcdDragSongId` is set, so the three systems share the same rows and section headers as drop targets without ever contending. New handlers are added as *additional* listeners in a `_lcdWireLibraryDrop(rail)` that runs alongside `_lcdWireRailDrag`/`_lcdWireSectionDrag` on every rail render (the rail replaces its innerHTML, taking all listeners with it).
2. **Drops land at group boundaries, never inside another song.** `_lcdGroupRunFor(box)` walks out from the hovered slide box to the contiguous run that makes up its whole group (banner + slides + trailing add-slide row); the dropped song is inserted before that run or after it. Dropping on the upper half of the third slide of a liturgy therefore puts the song *before the whole liturgy*, not spliced into the middle of it. Dropping on a section header appends at that section's end.
3. **Reuses the existing insertion-marker vocabulary verbatim** -- `.lcd-rail-drop-above`/`.lcd-rail-drop-below` plus `_lcdClearDropMarkers()` -- and calls `_lcdPushUndo()` before mutating, matching every existing rail action's convention.
4. **`_woBuildSongSectionEntry(song, sectionId)` extracted** from `addSongDirectly`'s inline object literal and now shared by the section-scoped add path and the drag path, so both produce identical entries.
5. **Two guards that were genuinely needed.** (a) The media drop zone is wired on the *whole* `#woWorshipOrder` column and its dragover only skipped when `_lcdDragRowId || _lcdDragSectionId`; during a song drag it would have painted media-style `.lcd-drop-target` highlights over the insertion markers and forced `dropEffect:copy`. Added `_lcdDragSongId` to that guard (dragover + dragleave). (b) The drag payload is prefixed `libsong:` so the media drop handler's `savedBackgrounds` lookup can never mistake it for a background id -- it already returns early on an unknown id, verified by reading it rather than assuming. `#woPreviewScreen`'s drop zone needed nothing: it is `display:none` and guards the same way.
6. The Add button on each card is `draggable="false"` so grabbing it never starts a card drag -- and it remains the full no-drag equivalent of the drag path, per card rather than only at panel level.
- **Verified live with real `DragEvent` + `DataTransfer` sequences (dragstart -> dragover -> drop -> dragend), not by calling handlers directly.** Drop above a row: song landed at 1.1-1.3 *before* the whole Invocation liturgy group (98 -> 101 rows). Drop below: landed at 1.5-1.8 *after* the group. Drop on a section header: appended at that section's end (2.24-2.31). Ctrl+Z cleanly reverted a whole insert (101 -> 98, song gone, ordering restored). Cancelled drag (dragend with no drop) left the schedule untouched at 115 rows with all markers cleared. **Regression checks both passed**: existing slide reorder within a song still works (slide 1 moved to position 3, total unchanged), and existing whole-section reorder still works (Invocation moved from position 1 to 3, row count unchanged). No new console errors. `node --check` on all inline script blocks, byte-identical `dist/index.html`.
- **Test data cleaned up.** Rather than trust the saved-orders list's unreliable relative-time labels (see the Phase 1 note), the disposable order was identified by diffing the full list against the known 15-title baseline: exactly one unaccounted-for entry, nothing missing. Deleted after the confirm dialog named it; list back to the baseline 15.

---

## 2026-08-11 — LCD Projection redesign, Phase 2: 3-column workspace + Song Library panel (branch `feature/premium-mobile-roster`, committed locally, not yet pushed)

Phase 2 of the LCD Projection redesign (user priorities #2 and #3) -- the largest phase. Turns `.wo-main-content` into a 3-column grid (Song Library | Service Schedule | Workspace) and adds the persistent Song Library panel the mockup calls for.

1. **Grid restructure.** `.wo-main-content:not(.wo-song-order)` is now `display:grid` instead of flex. Two inherited flex-era rules had to be neutralised in grid mode or they fight the tracks: `.wo-worship-order`'s `max-width:302px` (would clamp the schedule column narrower than its own track) and `.wo-preview-panel`'s `min-width:640px` (would force overflow once a third column exists). Song Order mode still gets `display:block` and is entirely unaffected.
2. **Song Library panel** (`#lcdLibraryPanel`, static HTML): search, dynamically-derived category chips, and a scrolling card list with a per-card Add button. It reads the same `window.LHC_STATE.songs` the `#woSongPopup` modal uses and routes adds through the existing `addSongDirectly()` -- one song source, one add path, no parallel implementation. The modal stays as both the section-scoped quick-add and the full 6-filter surface, reachable from the panel's "Advanced filters" icon. Category chips are derived from the real freeform `style`/`category` values via the same `uniq()` idiom as `woPopupPopulateFilters()`, never hardcoded (live data yields Contemporary / Contemporary Hymn / Traditional Hymn).
3. **"Recent" chip deliberately not shipped.** The plan called for a recently-used strip driven by `useCount`/`lastUsed`. Checked the live data first: all 51 songs have `useCount:0` and `lastUsed:""`, and `dateAdded`/`lastEdited` are empty too -- there is no recency signal in this deployment at all, so the chip could only ever render empty. Rather than delete the capability, `_lcdHasRecencyData()` gates it: the chip appears by itself if usage tracking ever starts populating those fields. Same reasoning the user already approved for the Effects button -- don't ship a control with no feature behind it.
4. **Expand Schedule + Library toggles**, both persisted to localStorage like `toggleSidebar()` does, both re-running `_enterServiceOrderLayout()` because the sticky preview panel's measured max-height depends on the layout that just changed. When the library is collapsed a slim 44px tab takes its grid cell.
5. **Responsive compromises.** Usable width is viewport minus 352px of fixed sidebar/gap/padding, so the tracks step down at 1800/1440 breakpoints, and `.lcd-outputs-row` stacks Editor above Output once the workspace drops below roughly 560px. Below 1600px an expanded schedule cannot also fit the library and a usable workspace, so the library yields to the tab -- its own hidden/shown flag is left untouched. That created a trap: in that auto-hidden state the tab's normal "toggle the library flag" action would do nothing visible, because the media query overrides it. `lcdToggleLibrary()` therefore detects that specific state and un-expands instead, so the tab is never dead.
- **Bug found and fixed (pre-existing, but Phase 2 makes it visible).** The plan assumed `addSongDirectly()` -> `openSectionModal()` was a working non-drag fallback. It is not, in LCD Projection mode: for a *new* song `confirmSectionAssignment()` pushes to `songOrderSections` and calls `renderSongOrderSection()`, which only populates the **Song Order** list. Nothing renders into the service sections, so the song lands in the order data but the Service Schedule shows nothing until the next full `initializeServiceOrder()` -- i.e. the user clicks Add and apparently nothing happens. Proven by adding a song (rail stayed at 98 rows), then forcing a Song<->Service round-trip, after which it appeared correctly as 5 slides at 4.1-4.5. Fixed by having `confirmSectionAssignment()` also call `addSongToServiceSection()` for each selected section when not in Song Order mode -- mirroring exactly what `addSongDirectly()` already does on its section-scoped path. This is Phase 3's scope pulled forward, since Phase 2's panel makes Add its primary action.
- **Verified live at 1920/1600/1440/1366, normal *and* expanded, with zero horizontal overflow in all eight combinations.** Tracks measured: 1920 `320|360|873` (expanded `280|783|490`); 1600 `280|320|633` (expanded `280|493|460`); 1440 `280|320|480` (expanded `44|599|430`, library yields, outputs stack); 1366 `250|296|453` (expanded `44|525|430`). The 1366 expanded case -- the compromise the plan required demoing -- behaves as designed, and clicking the re-open tab there correctly un-expands rather than dead-toggling. Add now renders immediately (98 -> 103 rows, 5 slides under "4. Entrance Hymn", header count updated) with **no duplication after a Song<->Service round-trip** (still 103/5). Song Order mode re-checked after the `confirmSectionAssignment` change: its own add path still opens the picker and appends a row (1 -> 2) with no error, panel correctly hidden, `display:block` intact. Toggle state survives a full page reload. Search (7 hits for "grace", including lyrics matches), category chips (10 Traditional Hymns), combined chip+search, and the empty state all correct. No new console errors. `node --check` on all inline script blocks, byte-identical `dist/index.html`.
- **Test data cleaned up**: this phase's testing added songs, which triggers `autoSaveOrder()`, so two disposable "Traditional Worship Order" entries did persist (unlike Phase 0's, which never did). Both deleted after confirming the delete dialog named the test order each time; the saved-orders list is back to exactly the original 15, same titles in the same order.

---

## 2026-08-11 — LCD Projection redesign, Phase 1: Service Schedule readability (branch `feature/premium-mobile-roster`, committed locally, not yet pushed)

Phase 1 of the 8-phase LCD Projection redesign (plan: `C:\Users\Admin\.claude\plans\wise-fluttering-moore.md`) -- the user's stated priority #1. The compact slide rail (`#lcdCompactRail`, built by `_lcdRenderCompactRail()`) was still styled for a light background even after Phase 0 reskinned the dark shell beside it, and its section headers were so crowded by 7 icon buttons that section titles got ~76px of a 270px row.

1. **Schedule column converted to the dark theme.** `.wo-main-content:not(.wo-song-order) .wo-worship-order` now gets `--lcd-navy-900`, a shade lighter than the preview panel's `--lcd-navy-950` so the two columns read as distinct surfaces. All `.lcd-rail-*` colors retargeted to the Phase 0 tokens; the old indigo accents (`#6366f1`/`#4338ca`/`#4f46e5`) are now gold (`--lcd-gold-500`/`--lcd-gold-400`), including the section header's left border, the selected-row highlight, and the drag drop-indicator lines that Phase 4 will reuse. The 7 semantic action-button hues were re-picked for a dark background (e.g. song `#2563eb` -> `#60a5fa`).
2. **Readability hierarchy via the tokens.** Item title `0.78rem` -> `--lcd-font-item-title` (16.5px), preview `0.7rem` -> `--lcd-font-item-meta` (12.5px), numbering `0.66rem` -> `--lcd-font-numbering` (12px). Numbering stays deliberately subordinate to the title, per the explicit "don't enlarge 1.1/1.2" constraint -- verified programmatically (title px > number px).
3. **Titles now clamp to two lines instead of one ellipsised line**, with the full text carried as a `title` tooltip so nothing is lost. Note WO's in-scope `escapeHtml()` serialises via `textContent` and so does *not* escape double quotes -- the tooltip attribute gets an explicit `.replace(/"/g,'&quot;')` on top of it.
4. **Section headers de-crowded.** The 7 action buttons went 22px -> 28px and moved into an absolutely-positioned overlay on the right of the header, revealed on `:hover`/`:focus-within`. At rest the section title now gets the full column width; because the overlay is absolutely positioned there is no layout shift on hover, and `pointer-events:none` at rest means hovering the button area still hovers the header underneath (no dead zone). `:focus-within` keeps them keyboard-reachable.
5. **Item counts**: a per-section slide-count pill (only rendered when the section has slides -- 19 zeroes down the rail would just be noise) plus a new static, sticky "Service Schedule" header bar showing the order's total slide count.
6. **Observer-loop guard extended** (`_lcdSetupCompactRailObserver`): the rail observer previously ignored only mutations inside `#lcdCompactRail`. The new header lives *outside* the rail, so rewriting its count text on every render would have re-triggered the observer in an unbounded loop. Added `#lcdScheduleHeader` to the same ignore filter, plus a no-op-write guard in `_lcdEnsureScheduleHeader()`. The header element is created once and only its count text is ever rewritten, so it never flickers on the 120ms-debounced re-render.
- **Verified live**: **no render loop** -- an instrumented probe recorded 0 rail re-renders across 14.7s idle, with the header and first-row nodes both surviving (proving no flicker/recreation). Row click still routes through to `selectSlideBox` (the hidden slide box gets `.selected`, and the rail row picks up the gold highlight after its 120ms debounce -- an immediate re-read looks like a failure and isn't). Section collapse/expand still works (98 -> 94 -> 98 rows). Song Order mode confirmed completely untouched (transparent bg, `max-width:100%`, `display:block`, no rail or header present), and the service -> song -> service round-trip restores the header as first child with the rail second. No horizontal overflow at 1920/1600/1440/1366, overlay fits inside the section header at every width. No new console errors (only the pre-existing `supabaseUrl`/500 noise). `node --check` on all inline script blocks, byte-identical `dist/index.html`.
- **Two findings worth recording.** (a) The `Grep` tool mangles forward slashes when displaying this file -- `'</div>'` renders as `'<\div>'` and `//` comments render as `\`. This looked exactly like a real malformed-tag bug; confirmed against raw bytes that the source is correct. Verify slash-related "bugs" in this file with `Read`/Python, not Grep output. (b) CSS transitions never advance in this browser pane (it doesn't composite frames -- the same reason screenshots fail here), so `getComputedStyle` on a transitioning property reads the start value forever. The hover/focus reveal was verified by disabling the transition and confirming the cascade resolves to `opacity:1`; `pointer-events` (untransitioned, same rule) flipping to `auto` was the tell that the rule was applying all along.
- **Known tradeoff, addressed next phase**: the rail is now ~9500px tall for this 98-slide order, up from ~6450px, because rows carry larger text and up to two title lines. That is the intended cost of priority #1 readability in a still-302px column; 27 of 98 titles (long formal liturgy names) still clamp. Measured shrinking the title to 15px/14px first -- it only drops the clamped count from 27 to 27 and 13.5px only reaches 23, so shrinking sacrifices readability for essentially nothing. Phase 2's column widening is the real fix.

---

## 2026-08-11 — LCD Projection redesign, Phase 0: CSS token system + visual reskin (branch `feature/premium-mobile-roster`, committed locally, not yet pushed)

First phase of an 8-phase, plan-mode-approved redesign of the "LCD Projection" workspace inside Worship Orders (`WO.selectOrder('service')`) -- a full premium/warm/church-oriented visual overhaul against an approved mockup, phased to ship and verify independently. Full plan lives at `C:\Users\Admin\.claude\plans\wise-fluttering-moore.md`. Phase 0 is CSS-only, strictly no-op behaviorally: zero HTML/JS changes, existing controls keep their exact classes/ids/onclick handlers.

1. **New scoped token system.** Added a `.wo-main-content:not(.wo-song-order)`-scoped CSS custom-property block (navy/ivory/gold palette, spacing scale, radius scale, 3-tier button-height scale, font sizes, shadows, motion durations) inserted just before the existing "LCD Projection slide-first shell (Chunk 2)" rule block. Deliberately *not* added to the global `:root` -- that token set belongs to the rest of the app's light theme, untouched by this redesign. The global `#playlistSidebar` app sidebar is likewise completely untouched (confirmed decision from plan mode).
2. **Full reskin of the `.lcd-*` shell** (`.lcd-topbar`, `.lcd-controls-row`, `.lcd-outputs-row`, `.lcd-panel*`, `.lcd-lyrics-*`, `.lcd-media-*`, `.lcd-drop-target*`, etc.): every hardcoded color and border-radius in that block retargeted to the new tokens. Every button-like control got explicit height sizing from the new 3-tier scale -- Project (46px, primary, plus a gold-glow box-shadow), Barrier/Text/BG/Blank (42px, secondary), Undo/Redo (38px, icon). Typography untouched beyond what naturally follows from the height increase -- the Slide Editor's canvas-like restyle is explicitly Phase 5's job, not Phase 0's.
3. **Follow-up fix caught during verification**: the alignment (L/C/R) and zoom in/out button groups turned out to live in a *different* part of the stylesheet (`.wo-align-btn`/`.wo-align-group`, `.wo-preview-zoom-btn`/`-group`, both exclusively used inside this LCD shell) and were missed by the Chunk-2-scoped retarget above -- they were still 26px/31px with a leftover indigo (`#6366f1`) active-state color that clashed with the new navy/gold palette. Brought both up to the 38px icon tier and retargeted their colors to the new tokens (active state now uses `--lcd-gold-500`).
- **Verified live**: computed-style checks confirm every token resolves correctly (panel bg `--lcd-navy-950`, controls/panel bg `--lcd-navy-800`, button heights exactly 46/42/38px including the two follow-up fixes, gold-glow shadow on Project, gold active-state on alignment buttons). Functional click-tests on align (3-way toggle), zoom in/out, undo, redo, and blank all confirmed still calling their original unchanged handlers with zero exceptions and correct before/after state. No horizontal overflow and consistent token resolution confirmed at all 4 required widths (1920/1600/1440/1366). No new console errors (only the pre-existing, unrelated `supabaseUrl`/500 noise this project has repeatedly confirmed is harmless). `dist/index.html` byte-identical to `Index.html`.
- **Note on test-order cleanup**: verification used a disposable order created via `WO.createNewOrder('traditional')` + `WO.selectOrder('service')`, but since no song/slide/schedule content was ever mutated (only transient toolbar toggles), `autoSaveOrder()` never fired and the order was never persisted to the cloud "Saved Orders" list -- confirmed by cross-checking all 15 real saved orders' embedded creation timestamps (`order_<epoch-ms>` id), none within days of this session. Nothing needed deleting. (Caught one near-miss along the way: the saved-orders list's "Edited Xh ago" relative-time label is unreliable -- the top-sorted entry read "Edited 1h ago" but its actual id timestamp decoded to 5+ days old. Did not investigate further as it's pre-existing and out of scope; worth a look if relative-time display elsewhere is ever in scope.)

---

## 2026-08-10 — Auto-Suggest dialog: duties box a further 30px shorter (branch `feature/premium-mobile-roster`, committed locally, not yet pushed)

Third iteration of the same request from the two entries below (5px, then 10px, now 30px) -- same mechanism, bigger number.
1. Duties checklist box `max-height`: `305px` -> `275px`. Dates box's own sizing (`min-height:280px;max-height:320px`) is still untouched, same as every round of this adjustment so far.
- **Verified live**: duties box now measures exactly `275px` (was `305px`), dates box still `280px`, no horizontal overflow, no new console errors. `node --check` on all 18 script blocks, byte-identical `dist/index.html`.

---

## 2026-08-10 — Auto-Suggest dialog: duties box another 10px shorter (branch `feature/premium-mobile-roster`, merged to master `fa2c6b9`)

Real-device screenshot follow-up on the entry below: the 5px trim wasn't enough on the user's actual phone -- their screenshot showed the visible viewport still only reaching "AUG 2 / AUG 9" (the first of 3 date rows) before hitting the Cancel/Auto-Suggest footer, annotated "shorten by 10px" (pointing at the duties box) and "bring higher" (pointing at the dates section). Same mechanism as last time, just a bigger number: shrink the duties box further, which pulls everything below it up in normal document flow.
1. Duties checklist box `max-height`: `315px` -> `305px` (10px less than its current live value, not 10px off the original 320px). Dates box untouched, same as the previous round.
- **Verified live**: duties box now measures exactly `305px` (was `315px`); dates box still `280px`; duties box's bottom edge -- and the dates section below it -- moved up by exactly 10px, confirmed via `getBoundingClientRect()`. No horizontal overflow, no new console errors, `node --check` on all 18 script blocks, byte-identical `dist/index.html`.

---

## 2026-08-10 — Auto-Suggest dialog: duties box 5px shorter, pulling dates box up (branch `feature/premium-mobile-roster`, merged to master `0d74a96`)

Follow-up on the two entries below. Rather than shrinking the dates box's own `min-height`/`max-height` (280px/320px, unchanged), the user asked to shrink the *duties* box above it by exactly 5px instead -- since these sit in normal document flow inside the dialog's scrollable body, a shorter duties box means everything below it (the "Dates to include" header and its box) starts 5px higher up, with less scrolling needed to reach it.
1. Changed the duties checklist box's `max-height` from `320px` to `315px`. The dates box's own sizing is untouched.
- **Verified live**: duties box now measures exactly `315px` (was `320px`); dates box still measures `280px` (unchanged); the duties box's bottom edge -- and everything below it -- moved up by exactly 5px, confirmed via `getBoundingClientRect()` before/after. No horizontal overflow, no new console errors, `node --check` on all 18 script blocks, byte-identical `dist/index.html`.

---

## 2026-08-10 — Fix Whole Month table swipe-snap cutting off the last date (branch `feature/premium-mobile-roster`, committed locally, not yet pushed)

User report: scrolling the mobile "Whole Month" table (the 2-week/2-up paginated table view) all the way to the last date wouldn't "latch" to fully reveal it. Root-caused in `snapMobileToNearest()` (Index.html, MOBILE 2-UP NAVIGATION section) -- after a swipe settles, this function snaps to the nearest 2-column "page" by testing candidate offsets `0, 2, 4, ...` up to `maxOffset` (`days.length - 2`). For an **odd-length month** (e.g. August 2026's 5 Sundays -> `maxOffset = 3`), that step-by-2 loop starting at 0 only ever produces `0, 2` -- it never tests `3`, the actual final valid page that puts the 5th/last date in view. So scrolling to the end always snapped back to offset 2, permanently hiding the last date behind/past the sticky labels column. The Prev/Next arrow buttons (`mobileShift`) never had this bug, since they clamp straight to `maxOffset` instead of iterating a fixed step -- which is exactly why this only showed up when *scrolling*, matching the user's report.
1. **Fix**: build the candidate list explicitly (`0, 2, 4, ...`), then append `maxOffset` if the loop didn't already land on it. For any even-length month this is a no-op (last stepped value already equals `maxOffset`); for odd-length months it adds the missing final candidate.
- **Verified live**: simulated a full swipe-to-end (`wrapper.scrollLeft = wrapper.scrollWidth` then `snapMobileToNearest()`) on August 2026 (5 dates, the exact buggy case) -- the last date's column now lands fully within the wrapper's visible bounds (previously would have snapped back to the middle pair). Re-tested September 2026 (4 dates, even -- never buggy) to confirm no regression there. `node --check` on all 18 script blocks, byte-identical `dist/index.html`, no new console errors.
- **Extended verification** (per follow-up ask: does this hold for months with more than 5 services, e.g. December with Christmas Eve + Christmas Day pushing it past the regular Sunday count?): confirmed real December already exceeds 5 dates most years -- `getServiceDays()` returns 6 dates for Dec 2025/2026/2027/2028 and 7 for Dec 2029 (Christmas Eve/Day get added as *extra* entries whenever they don't land on an existing Sunday). Re-ran the same swipe-to-end test against the real December 2029 (7 dates, odd) and confirmed the last date (Dec 30) fully reveals. Beyond that single case, mathematically verified the candidate-building logic itself for every date count from 1 to 15 -- `maxOffset` is included in the candidate list in all 15 cases, confirming the fix isn't specific to 5-date months at all; it holds for any count, odd or even. (Side note surfaced to the user, not acted on: there's currently no automatic "Watchnight" service for Dec 31 the way Christmas Eve/Day are auto-added -- Dec 31 only appears when it happens to fall on a Sunday. Flagged, not implemented -- out of scope for this fix.)

---

## 2026-08-10 — Auto-Suggest dialog: taller dates checklist box (branch `feature/premium-mobile-roster`, merged to master `fbc6cf4`)

Direct follow-up on the entry below: the dates checklist box now uses a 2-column grid, but for a normal month (5 dates = 3 rows) it only actually stretches to ~110-130px of content -- looked visually small/squat next to the "Duties to include" box above it (which fills close to its full 320px, since it holds 26 items). User asked to make the dates box taller so it reaches down closer to where the duties box's last visible rows are. Added `min-height:280px` (previously had none -- the box only ever grew to fit its content) and raised `max-height` from `300px` to `320px` to match the duties box's own cap exactly.
- **Verified live** on mobile (375px) and desktop (1280px): dates box now measures a fixed 280px regardless of how few dates a month has (vs. duties box's 320px, both capped identically) -- confirmed via `getBoundingClientRect()`, not just reading the CSS. The dialog's own scrollable body (`overflow-y:auto`, sits above the fixed Cancel/Auto-Suggest footer) absorbs the extra height on mobile without pushing the action buttons off-screen. `node --check` on all 18 script blocks, byte-identical `dist/index.html`, no page-level horizontal overflow.

---

## 2026-08-10 — Auto-Suggest dialog: dates checklist as a 2-column grid (branch `feature/premium-mobile-roster`, merged to master `e4c6bb9`)

Follow-up on the just-shipped Auto-Suggest dialog (entry below): a screenshot from the user's real phone showed the "Dates to include" checklist appearing to have only one date ("AUG 2") with a lot of empty space below it, annotated "please expand the dates section". Direct testing (both dev and live production, real synthetic taps) showed all 5 August dates were actually present in the DOM and technically reachable by scrolling within that box -- so this wasn't a missing-data bug, but the single-column list with a `max-height:220px` scroll area made a 5-item month barely fit, with no visible scrollbar affordance on mobile to hint there was more below. Changed the dates checklist to the same 2-column grid the "Duties to include" list above it already uses (`display:grid;grid-template-columns:1fr 1fr;align-content:start;`), plus a taller `max-height:300px`. A typical 4-6 date month now fits in 2-3 rows with zero scrolling needed, matching how the (much longer, 26-item) duties list already handles density.
- **Verified live** on both mobile (375px) and desktop (1280px), dev server and production: all 5 real August dates render in a 2-column grid, box `scrollHeight` no longer exceeds its visible height (previously right at the edge), no console errors beyond the pre-existing unrelated `vocal-hero` module noise, no horizontal overflow. `node --check` on all 18 script blocks, byte-identical `dist/index.html`.

---

## 2026-08-10 — Auto Suggest becomes a direct-apply dialog + colorless empty slots (branch `feature/premium-mobile-roster`, merged to master `12e0fed`)

The user's "Auto Suggest doesn't work" report (investigated in the entry below) turned out to be a stale-production symptom, not a real bug -- it started working once production caught up. But testing it prompted new, more specific feedback: the mobile flow's *design* wasn't what was wanted at all.

1. **Mobile Auto Suggest now behaves like desktop's.** The mobile "Auto Suggest" chip (`#rmpAutoSuggestChip`) used to open a separate dry-run preview panel (`openMobileAutoSuggest()` / `#rmpSuggestPanel`) requiring an individual "Use" tap per suggestion. The user wanted a popup dialog that lets them pick which duties/dates to fill, then writes the names straight in -- no per-suggestion confirmation, adjustable/clearable afterward. That flow **already existed** for desktop (`#rosterAutoSuggestBtn` → `confirmAutoSuggestPrompt()` → a duty+date checklist dialog → `runAutoSuggest()` writes directly into `STATE.rosterEdits`, marks each cell pending -- same yellow-highlight system as everywhere else), but was unreachable from the mobile "Whole Month" view. Rewired the mobile chip's onclick to call `confirmAutoSuggestPrompt()` instead -- reusing the existing, already-mobile-compatible dialog rather than building a parallel implementation. Removed the now-fully-unused `openMobileAutoSuggest`/`_renderMobileSuggestRows`/`applyOneMobileSuggestion`/`applyAllMobileSuggestions`/`closeMobileAutoSuggest` functions, the `#rmpSuggestPanel` HTML, and the `.rmp-suggest-*` CSS (confirmed zero remaining references before deleting). "Clear specific duty(ies)/date(s)" -- the other half of the ask -- already existed too, via `confirmClearServicesPrompt()` in the mobile "..." Tools sheet ("Clear Services"), so nothing new was needed there.
2. **Unassigned Service Card slots are now fully colorless**, not just textless (the entry below removed the "Not assigned" label but left the tan/gold background). Removed `.rmp-person.open`, `.rmp-person-slot.open`, and `.rmp-person-slot.open b` entirely (both the live CSS and the duplicate copy inside `_rmpCardShareCSS()` for the WhatsApp share image) -- an empty slot now falls through to the exact same neutral styling as a filled one. `.pending` (auto-suggested, awaiting confirmation) is untouched -- that yellow signal is still wanted.
- **Verified live on a disposable test month (Aug 2099)**: a real synthetic tap on the actual mobile chip opens the "Auto-Suggest This Month" dialog; running it against one scoped date wrote 18 cells directly (no "Use" clicks) and marked them `.rmp-person.pending` with an "Auto Suggest" badge, visible in both the Whole Month table and Service Cards view; computed styles confirm an unassigned slot's background/color now match a normal filled slot's exactly (previously a distinct tan gradient); `node --check` on all 18 script blocks, byte-identical `dist/index.html`, no console errors introduced, no horizontal overflow. Test data cleaned from year 2099, PIC session logged out.

---

## 2026-08-10 — Blank unassigned duty cells on Service Cards (branch `feature/premium-mobile-roster`, merged to master `8c5323e`)

Follow-up screenshot feedback: unfilled duties in the "Service Cards" view showed a literal "Not assigned" text label in every empty slot -- the user wants those fully blank, no label of any kind.

1. **`renderMobileMonthView()`** (two spots, Index.html ~67045/~67052): both the single-person row text and the multi-slot group chip text now fall back to `''` instead of `'Not assigned'` when a duty has no value. The duty label (left column) and, for group rows, the numbered slot badge (`<b>1</b>`, `<b>2</b>`...) are left untouched -- only the "what it says when nobody's assigned" text is removed. The `.open`/tan background styling from this round was itself removed by the entry above, per further feedback.
- **Verified live**: an unassigned single-duty row (`.rmp-person.open`) now renders with empty `textContent` and a normal-height, still-tappable row; an unassigned group slot (`.rmp-person-slot.open`) renders as just its number badge with nothing after it. `node --check` on all 18 script blocks, byte-identical `dist/index.html`.

**Also investigated this round**: user reported "Auto Suggest doesn't work" on the Whole Month table. Could not reproduce after extensive testing against the dev server -- direct function calls, real month navigation (Aug→Sep→Oct, each correctly re-rendering), and a fully synthetic real click-event sequence (pointerdown/mousedown/pointerup/mouseup/click) on the actual button all correctly opened the suggest panel with sensible, correctly month-scoped suggestions. Retested against live production too (same result). Turned out to be a real but unrelated symptom: production had been stuck serving stale code for hours due to the Vercel git-author block (see the deploy note at the end of the entry below) -- once that was fixed and the user did a fresh reload, Auto Suggest worked, which is what prompted the more specific redesign feedback captured in the entry above. One real thing found along the way (not a bug, just a note for future self): the roster script block is a `"use strict"` IIFE with its own private `STATE` object (Index.html ~65808), completely separate from the page's other top-level `STATE` (~15139) -- poking `window.STATE` from outside does nothing to the roster's actual state.

---

## 2026-08-10 — Whole Month table readability pass: thick gridlines, smaller options icon, smaller service-type badges, bigger centered date badge (branch `feature/premium-mobile-roster`, merged to master `e9bd8b0`)

Requested via an annotated screenshot of the live mobile "Whole Month" table (the 2-week/paginated table view, distinct from the "Service Cards" grouped view above). All four changes are scoped to the `@media (max-width: 768px)` mobile block only, except the centering fix which is a genuine layout bug also present on desktop and was fixed universally.

1. **Thick gridlines.** The table only ever had a faint `1px solid #e2e8f0` row divider and *no* column divider at all -- confirmed via a full audit of every `.roster-table`-related rule that no `border-right`/`border-left` existed anywhere. Added `border-bottom: 2px solid #334155 !important` and `border-right: 2px solid #334155 !important` to `.roster-table th, .roster-table td` inside the mobile block, so both rows and date columns now have a visible dark divider.
2. **Shrunk the "..." cell-options icon.** Every filled cell gets a small `.roster-cell-dropdown-icon` button (opens the cell's options menu -- history, confirm, clear) -- on desktop it's meant to only reveal on `:hover` (`opacity:0` at rest), but touch devices have no real hover, so on a phone it renders at full size/opacity on every populated cell, which is what the screenshot's circles were pointing at. Forced it to a fixed, unobtrusive `opacity: 0.35; font-size: 7px` on mobile instead of hover-gated, rather than removing it outright, since it's the only single-tap way to reach that options menu (double-tap still opens the editor directly) -- verified tapping it still opens `cellDropdown` correctly after the size change.
3. **Traditional/Contemporary badges 3px smaller.** `.roster-servicetype-btn`'s base font-size (`0.72rem` = 11.52px, applies at all widths) is now overridden to exactly `8.52px` on mobile only -- desktop keeps the original 11.52px.
4. **Bigger + genuinely centered date badge.** Two separate problems: the badge (`.roster-date-chip`, e.g. "AUG 2") was tiny on mobile (8px font) -- bumped to 13px with more padding. Separately, live measurement showed the chip sitting a consistent ~8px left of the column's true center on *every* date column, on both mobile and desktop: the chip and the WhatsApp share button both sat `inline-block` on one line, so `text-align:center` centered the *pair*, not the chip alone. Fixed by wrapping both in a new `.roster-date-header-inner` flex column (`display:flex; flex-direction:column; align-items:center`), so each centers independently on its own row -- re-measured afterward at exactly 0px offset on desktop and ~1px on mobile (down from ~8px).
- **Verified live against the actual dev server, not just by reading CSS text**: computed styles pulled directly from a rendered mobile (375px) and desktop (1280px) session confirmed every value lands exactly as declared (border color/width, icon opacity/size, badge font-size, chip font-size/padding, chip-to-column-center offset), and confirmed all four are correctly absent at desktop width except the universal centering fix. One red herring during verification: the table carries a persisted `zoom: 0.85` inline style from the existing pinch-to-zoom feature, which distorts raw computed pixel readings for anything geometric (border-width, table width) but not for font-size/opacity -- resolved by temporarily forcing `zoom:1` and re-measuring, which confirmed the border computes to the intended clean 2px.
- `node --check` on all 18 inline `<script>` blocks, byte-identical `dist/index.html`, no horizontal page overflow on mobile, cell-options dropdown still opens correctly after the icon-size change.

**Deploy note for future reference**: merging this PR did *not* produce a Vercel deployment -- not slow, genuinely never triggered, with zero commit-status entries on GitHub. Root cause: Vercel blocks any deployment whose git commit author isn't a verified member of the Vercel team, and every commit in this repo was authored as `Admin <admin@lhc.local>` (a local machine identity, not a real/verified address). Fixed in two parts: (1) `git config user.email`/`user.name` in this repo now point at the verified owner account (`jermaineaaron1991@gmail.com`) so future commits deploy normally; (2) to unblock the *already-merged* code (git authorship is baked into existing commits and can't be fixed retroactively without rewriting history), pushed one empty commit on top of the real `master` tip authored with the corrected identity -- `git commit-tree <master>^{tree} -p <master> -m "..."` then `git push origin <sha>:master`, which doesn't touch the worktree's checked-out branch at all. If a merge ever again sits with no deployment and no GitHub status, check this first before assuming it's just slow.

---

## 2026-08-10 — Share-image sharpness fix: 3x-scale the card CSS instead of relying on CloudConvert `zoom` (branch `feature/premium-mobile-roster`, merged to master `307f36c`)

Follow-up to the per-card WhatsApp picture share shipped earlier today (see entry immediately below, merged to master as `03a878d`). The user tested it for real -- an actual WhatsApp share of the Aug 2 service card -- and reported the image came back "really small and pixelated," asking for it to be enlarged 3x and made clearer.

1. **Root cause**: the original `_rmpCardShareCSS()` rendered the card at its normal on-screen mobile size (360px-wide frame) and asked CloudConvert's HTML-to-image conversion to upscale it via a `zoom: 2` task parameter. The real-world share proved that parameter isn't reliably doing what it looks like it should -- the result was small and soft rather than a genuinely larger, sharp render.
2. **Fix**: dropped `zoom` entirely and instead scaled every dimensional value in `_rmpCardShareCSS()` by exactly 3x at the source -- frame width 360px → **1080px**, and every font-size/padding/border-radius/border-width/box-shadow-offset/gap scaled proportionally along with it (e.g. header title 14px → 42px, avatar chips 17px → 51px). Chrome renders larger markup natively sharp; this isn't stretching a small screenshot, so the result is guaranteed large and crisp regardless of whether any particular CloudConvert scale parameter is honored. `app/api/render-roster-pdf/route.ts`'s image branch comment updated to explain why `zoom` was removed.
3. **Verified live-rendered, not just read as CSS text**: copied the exact HTML payload `shareServiceCardImage()` sends (captured via a temporary `fetch` interception against real Auto-Suggested data on disposable roster year 2099) into `public/_scratch-card-preview.html`, served it through the actual Next.js dev server (screenshots aren't available in this sandbox, so `getComputedStyle`/`getBoundingClientRect` were used instead), and confirmed the browser actually renders the frame at `1080px`, the header title at `42px`, avatar chips at `51x51px`, etc. -- an exact 3x match against the pre-fix values, with zero horizontal overflow across all 13 duty rows. Scratch file deleted afterward, never committed.
- `node --check` on all inline `<script>` blocks, byte-identical `dist/index.html`, `npx tsc --noEmit` on the API route, test data cleaned from year 2099, PIC test session logged out.

---

## 2026-08-10 — Whole-month view follow-ups: tab labels, subtitle fix, per-card WhatsApp picture share (branch `feature/premium-mobile-roster`, merged to master `03a878d`)

Small follow-up round on top of the already-merged premium mobile roster redesign (see the 2026-08-09 entry below — that work is live in production as of merge commit `a0e5ef0`; this round is also merged, as `03a878d`). Requested via an annotated screenshot of the live production view.

1. **Tab labels swapped**: `#rmpTabWeeks` ("2-week roster" → **"Whole Month"**) and `#rmpTabMonth` ("Whole month" → **"Service Cards"**). The 2-week table view genuinely shows the whole month (just paginated 2-at-a-time), while the grouped-card view is one card per service — the new names describe what each view actually is. IDs/onclick/`setMobileScheduleView` logic untouched, label text only.
2. **Fixed a real rendering bug + simplified the service-card subtitle.** The subtitle was built as `(day.name || day.displayName) + ' &middot; ' + serviceType` and then passed through `escapeHtml()`, which escaped the `&` in the literal `&middot;` string and rendered it as literal on-screen text `&middot;` instead of a middle dot -- visible in the screenshot as "AUG 2 &middot; Traditional". Since `day.name` is null for every ordinary Sunday (only genuinely special days like Christmas Eve carry one), the date-repeating fallback (`day.displayName`) meant the subtitle usually just duplicated the card's own header anyway. Fixed by leading with the service type ("Traditional"/"Contemporary"/"Service Type not set") and only prefixing a real day name when one exists, using an actual middle-dot character instead of an HTML entity string headed for double-escaping.
3. **New: per-card "share as picture" WhatsApp button.** Added a WhatsApp icon button to each service card's header. Tapping it clones that exact card's *live* DOM (current data, current styling -- never regenerated from scratch, so it can't drift from what's on screen), wraps it in a standalone HTML document with a hand-written, unwrapped copy of the card's CSS (the real `.rmp-*` rules live inside an `@media (max-width:768px)` block, which wouldn't necessarily apply at whatever viewport the server-side renderer defaults to -- see the code comment on `_rmpCardShareCSS()`), and POSTs it to `/api/render-roster-pdf` with a new `format:'png'` option, reusing the exact same CloudConvert-Chrome-engine server-side rendering this app already relies on for "Share PDF" (chosen over client-side html2canvas/SVG-foreignObject specifically because this codebase already tried and abandoned a client-side raster approach for reliability reasons -- see that route's own comments). The resulting PNG shares via the same deferred-user-gesture Web Share pattern as the existing PDF share (`_showShareReadyPrompt`, generalized with a `kindLabel` param so one function now serves both "PDF ready!" and "Image ready!" prompts -- the one existing caller doesn't pass the new param and is unaffected, verified).
- **Verified**: tab labels correct; subtitle shows "Traditional"/"Contemporary" cleanly with no broken entity, and "Service Type not set" for a date without one; the share button correctly builds a `format:'png'` request containing the cloned card's real data (spot-checked against a real "not assigned" state and the grouped Usher/Communion-Assistant chip rows), with the share button and all `onclick` attributes correctly stripped from the static copy; the extended API route's PDF branch (format omitted) is byte-for-byte unchanged in its error response, and the full desktop/mobile `sharePDFViaWhatsApp()` flow still works exactly as before; `_showShareReadyPrompt` verified directly for both the default ("PDF ready!") and new ("Image ready!") cases. Could not verify the actual CloudConvert-rendered picture's pixel output locally -- same pre-existing, accepted limitation as the desktop PDF share, since `CLOUDCONVERT_API_KEY` isn't configured in this sandbox; both the PDF and new PNG branches fail identically gracefully (clear error toast, no crash/hang) when it's missing, confirmed for both.
- **Process note**: this app's Next.js `app/` directory is *not* inside the git worktree by default in the way `Index.html`/`dist/` are -- the main repo checkout (on `master`) and this worktree (on `feature/premium-mobile-roster`) each have their own separate copy of `app/api/render-roster-pdf/route.ts`. First pass at this edit accidentally landed on the master checkout's copy (caught before committing anything, reverted cleanly with `git checkout --`, no stray changes left on master); the real edit is in the worktree's own copy, confirmed via `git status` showing it as a tracked change on this branch.
- `node --check` passes on all inline `<script>` blocks, byte-identical `dist/index.html`, `npx tsc --noEmit` passes on the extended API route, desktop unchanged at 1280px, no unexpected console errors, no mobile horizontal overflow, test data cleaned from year 2099 afterward.

---

## 2026-08-09 — Premium mobile-only Worship Roster redesign (branch `feature/premium-mobile-roster`, merged to master `a0e5ef0`)

Implemented the approved premium mobile redesign of the Worship Roster page (mobile only, ≤768px). This is an **additive layer** on top of the existing `RosterEngine`/`STATE`/Supabase `roster` data model — no schema changes, no desktop changes, no duplicated business logic. Full audit findings, design rationale, and verification are in the session transcript; summary below.

**What changed (all inside `Index.html` / `dist/index.html`, no other files touched):**
- New `#rosterMobilePremium` block: dark-emerald compact app bar (title, live Calendar-sync status, PIC status), a prominent month selector, a **2-week roster / Whole month** view toggle, and a compact command row (PIC, gold Auto Suggest, Undo, Redo, Enablers, Save) with a collapsible **Tools** sheet (Calendar, Export CSV, Print/PDF, Share Live, WhatsApp, Clear Services, Confirm Pending). Every control calls the *existing* `RosterEngine` method directly (`undo()`, `redo()`, `saveChanges()`, `showPicLoginModal()`, `openEnablersModal()`, `openEnablersCalendar()`, `downloadCSV()`, `downloadPDF()`, `shareLiveLink()`, `sharePDFViaWhatsApp()`, `confirmClearServicesPrompt()`, `confirmPendingPrompt()`) — no new handler logic, only presentation.
- Old desktop header/toolbar/mobile-pager-nav are CSS-hidden at ≤768px; the new block is CSS-hidden above it. Both read the same `STATE` — `render()` now also calls a new `_syncMobilePremiumHeader()`, and `updatePicUI()`/`_updateConfirmPendingButton()` now also drive the mobile elements, so there is a single source of truth.
- Two-week table view: readability-only CSS bump (larger font/padding). No markup or JS change — reuses the same table/pager fixed earlier this session.
- **New whole-month grouped view** (`renderMobileMonthView()`): every duty for a service date rendered together, read from the same `STATE.rosterEdits`/`ROLES`/`getServiceDays` the desktop table uses. Sticky date-jump bar scrolls to a service card. Multi-person duties (Ushers, Sunday School Teachers, Singers, Altar Guild, Communion Assistants) collapse into one row with numbered chips (`MOBILE_MULTI_PERSON_GROUPS`); Bible readers stay separate, each paired with its linked scripture passage via convention (`MOBILE_READER_PASSAGE`: Reader 1 ↔ 1st Reading, Reader 2 ↔ 2nd Reading).
- **Deliberate scoping decision:** the whole-month view is read-oriented. Tapping a duty slot in PIC mode calls `jumpToDateAndEdit()`, which switches to the 2-week view already scrolled to that date and opens the real `editCell()` control on the real `<td>` — editing always goes through the one existing edit path, never a second parallel write path. This was chosen deliberately over building an independent in-place editor for the month view, to avoid duplicating/forking the clash-detection, undo, pending-flag, and Supabase-write machinery that the desktop `<td>` editing already relies on.
- **Auto Suggest preview:** `runAutoSuggest()` gained a `previewOnly` parameter. It runs the *identical* scoring/eligibility logic (curated-team tiers, per-role rotation, 2×/month soft cap, back-to-back and cross-month guards, unavailability, the Liturgist↔Communion Assistant 1 cascade, the Flower Arrangement clash exemption) but resolves with a list instead of writing anything. The new mobile panel shows date/duty/name/reason/warning per suggestion — reason and warning text is derived from the real scoring signals (curated-tier membership, month duty count, back-to-back match), never fabricated — and supports applying one suggestion or all warning-free ("safe") ones; anything flagged with a warning requires an individual tap to apply.

**Testing performed:** verified against disposable roster year 2099 (never real data) — header sync, PIC-only visibility (logged out vs. logged in), whole-month grouping including completion counts, multi-person chip rows, reader/passage pairing, sticky date-jump, tap-to-jump-and-edit opening the real edit control, Auto Suggest preview scan/reason/warning/apply-one/apply-all, and full test-data cleanup. Confirmed no page-level horizontal overflow at 320/360/390/430px. Confirmed the original desktop header/toolbar/table render unchanged at 1280px (no regression). `node --check` passes on all 18 inline `<script>` blocks; `Index.html` and `dist/index.html` are byte-identical.

**Known limitations / remaining risks:**
- The whole-month view cannot edit in place — see the scoping decision above. If a future request wants true in-place month-view editing, that needs its own design pass (likely reusing `editCell`'s dropdown-panel builder against a non-`<td>` element, which currently assumes table-cell DOM).
- The Auto Suggest preview's "Use" button for a single suggestion re-runs the real algorithm scoped to that one date+role rather than literally replaying the previously-computed candidate; since nothing else changes between the scan and the click, this is deterministic and safe, but if a user applies suggestions **out of the natural role order** (e.g. taps a Communion Assistant 1 suggestion before its paired Liturgist suggestion), the mirror can silently no-op until the Liturgist is applied — the row's "Mirrors the Liturgist suggested above" reason text is the only hint. "Apply all safe suggestions" is unaffected since it batches by date+role and lets `runAutoSuggest`'s own internal ordering handle this correctly.
- No SQL migration, RLS change, or new environment variable was needed or made.
- **Branch not yet merged to master** — push this branch, do not merge until a further explicit review/request.

**Self-review pass (same day, before merge) — 3 real bugs found and fixed, empirically verified in-browser against disposable year 2099:**
1. **PIC-login-after-navigating-to-month-view left tap-to-edit dead.** `renderMobileMonthView()` bakes `STATE.picMode` into whether each duty slot's `onclick` attribute exists *at render time*, unlike the desktop table's `bindCellEvents()`, which always attaches the handler and checks `STATE.picMode` live at click-time. Since `updatePicUI()` (called after login/logout) never re-ran the month view, a user who opened Whole Month view before logging in found every duty slot inert after logging in, until something else forced a re-render. Fixed: `updatePicUI()` now calls `renderMobileMonthView()` when that view is active. Verified: logged out → switched to month view → confirmed no slot has the handler → logged in with no other action → confirmed the handler is now present immediately.
2. **Every mobile "Use"/"Apply all" tap popped the full desktop Auto Suggest summary modal.** `applyOneMobileSuggestion`/`applyAllMobileSuggestions` called the real (non-preview) `runAutoSuggest()`, whose success path unconditionally shows `_showAutoSuggestSummary()` — a 440–560px desktop modal — whenever anything was filled, on top of the mobile preview panel the user was already looking at. Fixed: added a `quiet` parameter to `runAutoSuggest()`; the two mobile call sites pass it, the desktop confirm-dialog caller does not (unchanged desktop behavior), and the mobile flow now shows its own toast instead. Verified: tapped "Use" on a real suggestion — no summary modal appeared, a toast confirmed the assignment, and the cell was actually written with the pending flag.
3. **Mobile preview panel silently dropped `couldNotFill`/`missingServiceType`.** Dates missing a Service Type, or duties with no eligible candidate, vanished from the list with no explanation — unlike the desktop summary modal, which already surfaces both. Also, the "N services scanned" label counted *every* service day in the month rather than `result.scannedCount` (the dates that actually had a Service Type set), overstating what was considered. Fixed: both lists now render as notice banners above the suggestion rows, and the scanned label uses `result.scannedCount`. Verified against a month with only one date carrying a Service Type: the panel correctly listed the other Sundays under "Set Service Type first" and reported "1 service ... scanned".

All three fixes: `node --check` passes on all 18 inline `<script>` blocks, `Index.html`/`dist/index.html` byte-identical, desktop table confirmed unchanged at 1280px, test data cleaned from year 2099 (0 rows remaining) after verification.

**Second self-review pass (same day, requested again before merge) — 1 more real bug found, plus a related hardening fix:**
4. **"Apply all safe suggestions" could silently apply a flagged suggestion anyway.** `applyAllMobileSuggestions` built its `runAutoSuggest` scope by collecting the set of *all* safe dates and the set of *all* safe roles, then called `runAutoSuggest(datesSet, rolesSet)` — but those two sets combine as a cross product, not as exact pairs. A flagged (warned) suggestion that merely shared its date with one unrelated safe suggestion and its role with another unrelated safe suggestion got swept into that cross product and silently applied, directly contradicting the code's own stated intent ("still get a human glance via the individual Use button rather than being silently batch-applied"). **Confirmed empirically**: built a real scenario (5 dates, all roles) where a flagged "Cynthia Chin — already serving 2+ times" suggestion shared its date and role with other safe suggestions, ran the pre-fix code, and watched it get written to the cell anyway. Fixed by batching **per date** instead — one `runAutoSuggest` call per date, scoped only to that date's own safe roles, which can't cross-contaminate since a date's call never sees another date's role set. Re-verified against the same reproduction: the flagged cell stayed blank, all 87 safe suggestions applied correctly (including the last one in the list), and DB row count matched exactly (87 fills + 5 service-type toggles = 92 non-blank rows).
5. **Hardening**: while fixing #4, noticed `saveChanges()` never returned its save promise, so nothing chaining multiple `runAutoSuggest` calls back-to-back (like the new per-date "Apply all" batch) actually waited for one upload to land before firing the next — the same un-awaited-save race already fixed for undo/redo earlier this session, just not yet closed for Auto Suggest. `saveChanges()` now returns the `SBQ_ROSTER.saveEdits(...)` promise chain, and `runAutoSuggest`'s real-apply path returns it too, so any caller that chains on `runAutoSuggest()` (desktop's existing single-batch call, mobile's individual "Use", and the new per-date "Apply all") now genuinely waits for the database write, not just the in-memory state update, before proceeding. All other call sites (`onclick="RosterEngine.saveChanges()"`, the debounced auto-save timer, etc.) already ignored the return value, so this is backward compatible. Verified: the same 87-suggestion batch persisted with the correct final row count in the database, confirmed by direct query.

Both fixes: `node --check` passes on all 18 script blocks, byte-identical `dist/index.html`, desktop unchanged at 1280px, test data cleaned from year 2099 afterward.

**WhatsApp audit (same day, requested separately: "make sure the whatsapp functions are working perfectly fine")** — walked every roster WhatsApp code path with `window.open`/`navigator.share`/`navigator.clipboard` spied so real messages/tabs never actually fired, using real Enablers data:
- `shareLiveLink()` (mobile "Share Live" tool) — correct title/message/deep-link, calls `navigator.share`. Working.
- `shareWeekly()` → per-date `.roster-share-btn` → `_showShareWarningModal` → "Share via WhatsApp" (reachable from the 2-week table, unaffected by the mobile redesign) — tested with blank and real assigned data; correctly shows an empty-state instead of a blank message, correctly renders every duty section (including the Liturgist→Communion Assistant 1 mirror), correctly omits empty sections, correct z-index (99999, no overlap with the new mobile header). Working.
- `sharePDFViaWhatsApp()` (mobile "WhatsApp" tool) — correctly wired, fails gracefully with a toast. The 500 it hits locally is `app/api/render-roster-pdf` (commits `01cf100`/`ef280d5`, predates this branch entirely) missing `CLOUDCONVERT_API_KEY` in this sandbox — not a regression, and desktop's identical pre-existing "Share PDF" button would fail the same way here. Could not verify the successful-render path without a real key; presumably configured in the actual Vercel deployment.
- **6. Bug found and fixed (pre-existing, not introduced by this branch): `sendDutyCardWhatsApp` / `sendSubscribeLinkWhatsApp` built `wa.me/<phone>` links from members' saved phone numbers with no normalization.** `wa.me` requires a full international number (digits only, no leading `0` or `+`). Members' saved numbers are a mix of `+60...` (already fine) and local Malaysian format `0...` (broken) — `submitPicLogin` already normalizes `0`→`+60` for its own login check, but that normalization was never applied here. **Confirmed against real saved Enablers data**: 4 of 5 real members tested had local-format numbers, so their Duty Card and Subscribe Link WhatsApp sends (single AND bulk) were opening an invalid `wa.me/0126239946`-style link that WhatsApp cannot resolve to a contact. Fixed with a shared `_waPhone()` helper (strips whitespace/dashes/parens, strips a leading `+`, converts a leading `0` to `60`) used by both functions. Re-verified against the same real numbers: all now produce correct `wa.me/60...` links, individually and via bulk send.
- `shareAvailabilityLink()` and the per-name inline WhatsApp icon in the Enablers Calendar tab both use the phone-less `wa.me/?text=...` form (opens WhatsApp's own contact picker) — not affected by the phone-format bug.

All fixes: `node --check` passes on all 18 script blocks, byte-identical `dist/index.html`, no real WhatsApp messages/tabs sent during testing (spied), year-2099 test data cleaned up afterward.

**Broader regression audit (same day, requested separately: "do further audit to make sure everything works well just as it did - PDF, share link, changing enablers, removing and adding autosuggested")** — no code changes this pass; every item verified working, no new bugs found:
- **Print/PDF** (`downloadPDF()`) — mocked `window.open` to capture the generated document instead of relying on a real popup (a synthetic/non-trusted JS call gets popup-blocked by the browser regardless of app code, which is expected and irrelevant to real user clicks). Confirmed the print HTML is well-formed: correct title, correct table structure (7 columns, service dates, role rows), correct liturgical-color styling. Working.
- **Share Live Link deep-link** (`?view=roster&rmonth=&ryear=`) — followed the generated URL and confirmed the roster view loads directly to the linked month/year via `STATE_OVERRIDE_MONTH`/`STATE_OVERRIDE_YEAR` (title and table both correctly showed the target month). The year `<select>` widget itself only lists a few real-world years (2025-2028) and doesn't grow an option for the disposable test year 2099 used throughout this session's testing, so the dropdown *widget* shows a mismatched value in that one synthetic case -- harmless, since no real share link ever targets a year that far outside the normal range. Working.
- **Changing Enablers** — added a real test enabler (`ZZTEST Person 2099`) via the roster cell dropdown's "New name..." input, confirmed it wrote to `roster_names` and immediately appeared in the Enablers "By Duty" list and profile view (Status/Team/Prayer Requests/Fun Facts editing panels all intact), then cleared/removed it and cleaned up the test row. Working.
- **Removing and re-adding auto-suggested duties** — full lifecycle exercised on one cell: Auto-Suggest fill (pending, ⏳) → clear via the cell dropdown's "Clear / Leave blank" → Auto-Suggest re-fill (pending again) → Undo (reverts to blank) → Redo (restores the pending fill) → Confirm Pending (clears the pending flag, keeps the value) → manual clear of the now-confirmed cell. Every step behaved correctly, confirming this session's earlier undo/redo and Auto-Suggest fixes hold up under a full add/remove/confirm cycle.
- **CSV export** (`downloadCSV()`) — spot-checked, correct header row and structure.

Test data (year 2099 roster rows + the test enabler) cleaned up after each check.

**New feature (same day, requested after the audit): duty-scoped Clear Services.** "Clear Services" previously only let a PIC narrow by date and by pending/confirmed status -- it always wiped *every* duty for the chosen date(s), so undoing a couple of unwanted Auto-Suggest picks meant either clearing everything and redoing the rest, or clearing cells one at a time in the table. Added a "Duties to clear" checklist to `confirmClearServicesPrompt()`, matching the same checklist pattern already used by Auto-Suggest's "Duties to include" and Confirm Pending's "Roles to confirm" (all checked by default, Select All/Select None, 2-column grid).
- `clearServices(selectedDates, filter, selectedRoleIds)` gained the third parameter. When every `type:'role'` duty is checked (the default, unchanged path), it clears role+scripture+service-type cells exactly as before. When the PIC has unchecked some duties, it clears **only** the checked role cells -- scripture and Service Type are left alone in that narrowed case, since picking "just these duties" shouldn't also reset date-level settings the PIC didn't select.
- Verified: Auto-Suggested Preacher/Liturgist/Usher 1/Usher 2 for one date, opened Clear Services, selected only Usher 1 + Usher 2 (Select None then check two), cleared just that date -- Ushers went blank, Preacher/Liturgist and Service Type were untouched. Undo restored both cleared Ushers (value + pending flag). Re-ran with every duty left checked (the default) and confirmed the original full-clear behavior (including Service Type) is unchanged.
- `node --check` passes on all 18 script blocks, byte-identical `dist/index.html`, no new console errors, test data cleaned from year 2099 afterward.

**Third self-review pass (same day, requested again before merge) — 1 real bug found and fixed in the brand-new duty-scoped Clear Services feature:**
7. **Scoped-clearing just the Liturgist left Communion Assistant 1 stale.** Communion Assistant 1 mirrors the Liturgist (same design as the Auto-Suggest cascade), but that mirroring was only ever applied on the *fill* side. With the new "Duties to clear" checklist, a PIC could uncheck everything except Liturgist and clear it -- Communion Assistant 1 kept showing the old Liturgist's name even though the Liturgist cell was now blank. **Confirmed empirically**: filled both via cascade, scoped-cleared just Liturgist, watched Communion Assistant 1 stay stuck on the stale name. Fixed by extending the mirror to clearing too: `clearServices()` now tracks what it clears per date, and afterward -- only when Liturgist was cleared, Communion Assistant 1 wasn't itself part of the selected duties, and Communion Assistant 1's current value still exactly matches the Liturgist value that was just cleared -- it clears Communion Assistant 1 too. A Communion Assistant 1 that's been independently confirmed as someone *different* is left untouched, exactly like the fill-side cascade already does. Re-verified both branches: (a) matching mirror value → both cells clear together, two `undo()` calls restore both; (b) a manually-set, genuinely different Communion Assistant 1 → correctly preserved when Liturgist alone is cleared.
- Also did a broader pass on the new feature: no ID/class collisions with the existing Auto-Suggest (`roster-as-role-cb`) or Confirm Pending (`roster-cp-role-cb`) checklists; the widened 560px modal fits without horizontal overflow at 390px and none of its 26 duty labels clip; a multi-date, multi-duty sequence (Auto-Suggest 2 dates × 5 duties → scoped-clear 2 duties × 2 dates → 4×undo → 4×redo) matched exactly between in-memory state and a direct database query, with nothing dropped or duplicated.
- `node --check` passes on all 18 script blocks, byte-identical `dist/index.html`, desktop unchanged at 1280px, test data cleaned from year 2099 afterward.

**Fourth pass (same day, requested as "check again for more bugs in the entire roster page and functions") — 2 significant real bugs found and fixed, both wider in scope than anything touched so far this branch:**
8. **The Liturgist↔Communion Assistant 1 mirror only ever applied inside `runAutoSuggest`'s cascade -- not the two functions a PIC actually uses for almost every manual edit.** `saveSelect()` (the save handler inside every cell's dropdown -- picking a name OR "Clear / Leave blank", used for essentially all day-to-day roster editing) and `clearCell()` (the right-click context menu's "Clear this cell") had zero awareness of the Liturgist/Communion Assistant 1 relationship. Hand-picking a new Liturgist, or clearing the Liturgist by hand -- the normal, everyday way most cells actually get filled, not just Auto-Suggest -- left Communion Assistant 1 silently pointing at whoever the Liturgist used to be. This is a materially bigger gap than the Clear-Services-specific one fixed in the pass above, since it affects the single most-used editing path in the whole page. Fixed by adding the identical mirror rule (blank/pending/exactly-matches-old-value → sync; confirmed different value → leave alone) to both functions, gated on `roleId === 'liturgist'` so every other role's editing is provably unaffected. Verified: manually picking a new Liturgist now correctly updates Communion Assistant 1 to match (and preserves a genuinely different, independently-set Communion Assistant 1); manually clearing the Liturgist (both via the cell dropdown and via the right-click context menu) now correctly clears Communion Assistant 1 too when it was mirroring; two `undo()` calls correctly restore both cells in every case; editing any *other* role (spot-checked Usher 1) has zero effect on Liturgist/Communion Assistant 1, confirming the guard is properly scoped.
9. **Hardening: closed a latent overlapping-save race in `saveChanges()` itself.** While chasing down an anomalous test result (a save that appeared to write a stale value despite the DOM showing the correct one), traced it to `saveChanges()` having no protection against two overlapping in-flight requests -- since it always uploads the *entire* current roster map (not a diff), if a second save's network request lands before an earlier, slower one, the earlier request's older, less-complete snapshot can overwrite the newer one when it finally arrives. This is the same race class already closed for `runAutoSuggest`'s chained calls earlier this branch, but it was never closed for the far more common path: every ordinary manual edit's debounced auto-save. Fixed by serializing every `saveChanges()` call (manual Save button, debounced auto-save, Auto-Suggest, Clear Services, Confirm Pending, everything) onto one shared promise chain (`_rSaveChain`) -- each call's upload only actually builds and fires once every save queued ahead of it has finished, so saves can never physically overlap and are guaranteed to land in the same order they were requested. **Proved with a deliberately engineered race**: mocked the save network call to delay an early save by 2 seconds, fired a second, faster save while the first was still artificially pending -- confirmed the two calls' actual network requests only ever fired one after the other (never concurrently), and the final database state correctly reflected both edits with nothing lost. Also confirmed the reverse: a naive version of this same test that properly awaited the first call's promise (relying on this branch's earlier `runAutoSuggest`-returns-its-save-promise fix) never even had a race to construct in the first place, since the two saves were already naturally serialized -- consistent, reinforcing evidence the two fixes work together correctly.
- `node --check` passes on all 18 script blocks, byte-identical `dist/index.html`, desktop unchanged at 1280px, no new console errors, all test data (including the mocked-race test) cleaned from year 2099 afterward.

**Fifth pass (same day, requested as "check the areas that you haven't yet dug into") — 1 more real bug fixed, plus a significant pre-existing dead-code finding that needs a product decision, not a unilateral fix:**
10. **A third, previously-missed cell-clear path bypassed both the undo stack and the Liturgist/Communion Assistant 1 mirror.** The cell dropdown's "Clear" action (`cellDdClear`, part of `showCellDropdown()` -- see the dead-code finding below for why this specific panel is currently unreachable) duplicated the clearing logic inline instead of calling the real `clearCell()`, and the duplicate was worse than just "missing the mirror fix": it never pushed an undo entry (this specific clear could never be undone), never cleared the pending flag/icon (a cell cleared this way could stay stuck showing pending), and incorrectly ADDED the `roster-cell-edited` highlight to a cell it was blanking (the opposite of correct). Fixed by deleting the duplicate and delegating to `self.clearCell(td)`, the same pattern `cellDdEdit` already used for editing. Currently unreachable in the live UI (see below), but correct now if that ever changes, and there's no reason to leave a worse duplicate sitting in the file.
- **Dead-code finding, not fixed pending a decision:** there are two entirely separate, fully-built "cell options" UI systems in this file that are both completely unreachable through the current UI, and have been since long before this branch (`showCellDropdown` from the original Roster PIC-auth commit; `showContextMenu` from an even earlier commit) -- confirmed via `git log -S` on both function names. (1) `showCellDropdown` (ellipsis-button panel: History/Edit/Clear/"Confirm my duty") can never open because `bindCellEvents()` only creates its trigger button `if (!td.querySelector('.roster-cell-dropdown-icon'))` -- but `render()` already puts a purely decorative `<span class="roster-cell-dropdown-icon">` (a caret icon, no click handler) into every role cell's HTML unconditionally, so that check is always false and the real button is never appended. (2) `showContextMenu` (a right-click menu with the same Edit/Clear/Confirm/History actions, plus its own separate History-fetching code) is never invoked anywhere in the codebase at all -- confirmed zero call sites -- `td.oncontextmenu` only does `e.preventDefault()` and stops there. **Practical impact:** the only way to edit or clear a cell today is the double-click-opens-the-name-picker flow (which does work correctly and is what every fix and test this whole branch has exercised) -- but the decorative caret icon visually suggests it's clickable when it isn't, and there is currently no way to view a cell's edit history anywhere in the app: both dead panels' History sections depend on `callGAS()`, a Google-Apps-Script bridge (`google.script.run`) that can't exist in this Supabase/Vercel deployment and always rejects with "GAS not available" -- gracefully (a "History unavailable"/hidden-section fallback, not a crash), but non-functional regardless of whether the panels themselves become reachable. This needs a product decision -- revive one of the two (and rewire its History to real Supabase data), remove both as legacy cruft, or leave as-is -- not a unilateral fix, so nothing beyond the `cellDdClear` correctness fix above was changed here.
- **Also verified, no bugs found:** unavailability correctly excludes a person from Auto-Suggest (marked a real member unavailable for the disposable test date via the roster-name-panel's "Mark unavailable" flow, confirmed Auto-Suggest picked someone else, removed only the test period afterward and confirmed via direct query that the member's one real pre-existing unavailability period was untouched); the mobile 2-week pager's scroll-to-column math (rebuilt earlier this session) still lands correctly with no page-level horizontal overflow after all of this branch's later changes.
- `node --check` passes on all 18 script blocks, byte-identical `dist/index.html`, desktop unchanged at 1280px, test data cleaned from year 2099 afterward, and confirmed a real member's actual unavailability record was left untouched.

---

## 2026-07-31 — High-resolution vocal transcription and expression capture

- Replaced the editor's normalized-autocorrelation vocal converter with a browser-local YIN/CMNDF analysis path. It uses roughly 10.7 ms pitch hops, adaptive recording noise-floor detection, confidence gating, three-frame median stabilization, and hysteretic pitch-change segmentation so genuine short notes remain separate while normal vibrato does not fragment into false semitones.
- Added envelope-based onset/offset refinement. Silent gaps between pitches are now located with 4 ms RMS windows, preserving both sides of a phrase break instead of forcing neighbouring notes to share one coarse pitch-frame boundary.
- Vocal conversion now preserves optional expression data in each existing `SongNote` JSON object: continuous cents contour, normalized intensity contour, confidence, mean tuning, pitch spread, detected vibrato rate/depth, attack character, and release character. This is backward-compatible and requires no SQL migration.
- Converted notes derive velocity from captured intensity rather than using a fixed value. Clicking or playing a converted note auditions its measured tuning movement, vibrato, dynamics, and exact hold duration; choosing grid-snapped timing remains an explicit optional treatment.
- Added transcription diagnostics to the editor and a selected-note expression inspector with pitch/dynamics curves. Resizing or rhythm-latching an expressive note scales its stored contour to the new duration; moving it preserves the performance shape.
- Corrected a pitch-transition bug that could discard the first analysis frames of a new sung note. Out-of-range frames continue to be rejected rather than being clamped into false SATB boundary pitches.
- Validation: `npx tsc --noEmit` passes. Deterministic synthetic audio checks pass for precise two-note boundaries, a rapid three-note sequence, 5.4 Hz vibrato remaining one note, low Bass E2, a 42-cent glide plus crescendo, and out-of-range rejection. Production build and final Git checks are recorded below before publishing.
- Accuracy boundary: this remains monophonic fundamental-frequency transcription, not voice cloning. A clean solo take can preserve pitch trajectory, timing, vibrato, and intensity, but consonants, breath timbre, formants, rasp, and polyphonic/backing-track audio cannot be represented by MIDI-like `SongNote` events and still require the original recording for exact vocal colour.

---

## 2026-07-30 — Vocal recording transcription, measure lyrics, and timeline focus

- Added browser-local monophonic vocal transcription. A take recorded from the song editor can now be reviewed and converted into editable SATB timeline notes. The conversion strip explicitly chooses Soprano (C4–A5), Alto (F3–D5), Tenor (C3–G4), or Bass (E2–E4), independent of the voice active when recording began.
- Accuracy follow-up: the detector now measures pitch beyond the destination range and rejects out-of-range frames instead of clamping them into false boundary notes. Its 2048-sample analysis window improves onset/offset precision while retaining synthetic E2 support; median smoothing, confidence filtering, cents drift, pitch span, voiced-frame, and rejected-frame diagnostics are reported after conversion.
- Recorded timing now defaults to **Exact performance**, preserving measured starts and durations. **Snap to editor grid** is an explicit optional conversion treatment rather than an automatic destructive quantization step. Same-voice collision protection remains active in either mode.
- Kept recordings on the device during analysis and reused the existing `SongNote` structure. No upload, package, environment variable, database schema, or SQL migration is required.
- Removed the exposed Gameplay Lyrics editor from the workflow. Live karaoke now reads only the chosen player voice's authored note lyrics and groups all of that voice's lyric-bearing notes by the active musical measure (for example, the four beats of a 4/4 measure), following saved tempo and meter changes.
- Added a dedicated **Timeline full screen** workspace that hides the surrounding editor chrome and side panels. Its compact toolbar keeps Select/Draw/Erase, rhythmic note value, on/off-beat placement, selected-note lyric editing, backing-track access, transport, zoom, Save, and a safe **Exit timeline** action visible above the piano roll.
- Exiting timeline focus returns to the complete editor without closing the app or discarding unsaved arrangement state.
- Accuracy boundary: audio transcription is intentionally optimized for one clean, unaccompanied vocal line. Background music, chords, room echo, vibrato near a semitone boundary, or multiple simultaneous singers can produce ambiguous pitches; the displayed diagnostics and take playback are review aids, not a guarantee, and results remain editable in the piano roll.
- Validation: `npx tsc --noEmit`, `git diff --check`, and the production Next.js build with placeholder Supabase build variables pass. Synthetic Web Audio checks resolve A4/C5 and low Bass E2 correctly, preserve onsets within roughly 25 ms at 44.1 kHz, and reject an out-of-range A2 rather than fabricating a Soprano boundary note. `npm run lint` remains unavailable because the repository uses ESLint 9 without an `eslint.config.*` file.

---

## 2026-07-29 — Stable Vocal Hero lyric phrases and readable pitch lane

- Removed the gameplay lyric-source handoff that caused a single syllable to appear first and a different concatenated phrase after refresh or tab navigation. Each performance now chooses one canonical authored/timed/note lyric source and keeps it for the entire song.
- Added per-song `Gameplay lyric phrases` controls in the editor's low-priority arrangement panel. Editors can choose 4–20 timed lyric targets per phrase and a one-line or two-line presentation; values persist inside the existing `backing_track_settings` JSON and require no SQL migration.
- Karaoke continues to reveal the full visible phrase with the blue character-progress overlay, while phrase grouping observes long rests, punctuation, and the saved target count.
- Replaced the crowded stack of every visible pitch name at the strike line with a three-point pitch ruler. Target bars use larger note labels and the active target remains stated prominently in the feedback header.
- Practice-game release cache key advanced to `20260729-1` in both `Index.html` and `dist/index.html`.
- Validation: `npx tsc --noEmit`, `git diff --check`, and the production `next build` pass (the build used placeholder Supabase variables, as required in this worktree). The repository's ESLint 9 script remains unconfigured (`eslint.config.*` is absent).

---

## 2026-07-28 — Vocal Hero live pitch coach and karaoke lyrics

- Rebuilt the host and phone gameplay lanes to display named target pitches, the active target at the strike line, the microphone's detected note, and immediate `ON PITCH`, `TOO HIGH`, `TOO LOW`, `GET READY`, and `ON TIME` guidance.
- Added a live singer-coach panel showing target versus detected note plus the completed note's timing, pitch, and hold percentages, so a score is explainable rather than just a number.
- Added phrase-level karaoke lyrics. The full sentence remains visible while a blue overlay advances through its characters using timed lyric sections where available and authored note/syllable timing as the fallback.
- Enlarged and clarified the SATB highway with pitch-name rails, denser pitch guides, active-note outlines, and note names inside every target bar. The compact full-choir board retains the same pitch vocabulary.
- Practice-game release cache key advanced to `20260728-3` in both `Index.html` and `dist/index.html`. No SQL migration, package, or environment-variable change is required.
- Validation: production Next.js build and TypeScript checks pass. Browser QA confirmed the local Vocal Hero route renders; live-session visual QA requires songs in the connected Supabase environment.

---

## 2026-07-28 — Vocal Hero single-player mode

- Added a prominent **Start solo practice** path inside every Vocal Hero lobby. The user selects Soprano, Alto, Tenor, or Bass directly on the host device; no QR scan or second device is required.
- Solo practice reuses the real multiplayer session pipeline: it creates a ready `Solo Singer`, requests the local microphone, schedules the existing synchronized countdown/lead-in, runs the shared pitch and score engines, and persists round statistics through the existing Supabase functions.
- Added focused solo countdown and gameplay screens with prominent lyrics, the chosen note lane, detected pitch, personal score, section accuracy, microphone status, and an optional full-choir board.
- The backing-track audio element now remains mounted across lobby, countdown, and gameplay, preventing it from disappearing when the lobby unmounts at session start. Headphone guidance is shown to avoid speaker bleed into solo pitch detection.
- Practice-game release cache key advanced to `20260728-2` in both `Index.html` and `dist/index.html`. No SQL migration, package, or environment-variable change is required.
- Validation: the production Next.js build completes successfully with the existing Vocal Hero and worship-app routes.

---

## 2026-07-23 — Fullscreen-safe Close and draw-note glossary

- The editor's `Close` button is now context-aware: while Vocal Hero is fullscreen it exits fullscreen only and keeps the arrangement editor open; outside fullscreen it retains the existing close-editor action.
- Draw mode now reveals a compact rhythmic-value badge in the transport row. Previous/next buttons cycle values without leaving the piano roll, and clicking or pressing-and-holding the badge opens the complete grouped note glossary.
- The glossary uses the persisted `musical_timeline.snap_value`, so its selection is identical to the main timeline control and determines the next drawn note's duration.
- Extended the supported notation set through sixty-fourth notes, including dotted, double-dotted and triplet sixty-fourth values and the required fine placement grids.
- Practice-game release cache key advanced to `20260723-8` in both `Index.html` and `dist/index.html`. No SQL migration or environment-variable change is required.
- Validation: `npm run build` passes with placeholder Supabase build variables.

---

## 2026-07-23 — Vocal Hero dotted, double-dotted and tuplet note values

- Replaced the editor's single rhythm divisor with independent `Default drawn length` and `Placement grid` controls. A dotted note can therefore end on its precise duration while a shorter quaver, semiquaver, rest, or syncopated note can follow it.
- Added written music symbols and named values for straight whole through thirty-second notes, dotted and double-dotted variants, and half/quarter/eighth/sixteenth/thirty-second triplets.
- Added contextual guidance for complementary dotted-note values, while preserving manual resizing so the DAW does not impose an invalid following pitch or note.
- Added an explicit `Latch all` action. Selecting a default value affects new notes only; rewriting the entire arrangement requires this intentional action and remains undoable.
- Selected notes now show their nearest written rhythm symbol/value alongside exact duration and bar/beat placement. Imported MIDI retains exact PPQN start/duration data for all non-conflicting notes; only same-voice overlaps are moved forward to uphold the monophonic SATB-lane rule.
- The new `snap_value` is stored inside the existing `backing_track_settings.musical_timeline` JSON object. No SQL migration or environment-variable change is required, and older arrangements default safely to a sixteenth note.
- Practice-game release cache key advanced to `20260723-7` in both `Index.html` and `dist/index.html`.
- Validation: `npm run build` passes with placeholder Supabase build variables and `git diff --check` passes.

---

## 2026-07-22 — Mobile primary filters

- Mobile Songs now keeps three decision-focused filters visible: Theme, Feel, and Scripture.
- Follow-up: the actual Theme/Feel/Scripture controls now occupy the high-visibility navy search panel, while the Songs/Lyrics ready/With media statistics have moved into the white information panel below. Desktop placement is unchanged.
- Renamed the mobile `Filters` trigger to `More filters`.
- The More filters bottom sheet now contains only Key, Style, Season, and Sort By; it reuses the original controls and state rather than duplicating filter logic.
- Rebuilt the Theme filter as a viewport-level, scrollable menu so the entire theme catalogue is accessible without being clipped by the Songs card. The menu shows the available-theme count and keeps its add-theme controls visible.
- New themes can be created from the filter menu, persist through the existing `lhc_custom_themes` local-storage mechanism, appear in Add/Edit Song theme choices, and become immediately selectable as a filter. No database schema change was required.
- Desktop retains all seven filters in its existing single row.
- Browser QA completed at 390×844 for the swapped hierarchy, full Theme list, custom-theme creation/selection, More filters sheet, and Apply/close interaction.
- No database changes were required; `Index.html` and `dist/index.html` remain synchronized.

---

## 2026-07-22 — Song card resource and WhatsApp actions

- Renamed each card's `Lyrics` readiness indicator to `Chords / Lyrics` so the stored chord-sheet resource is unambiguous.
- Added a dedicated WhatsApp Share action to every song card. It opens WhatsApp with the title, artist, and the app's existing `?song=<id>` deep link to that exact song dossier.
- Preserved the existing Open, Add to Order/Songbook, Edit, document, YouTube, and Spotify actions.
- Responsive behaviour: full `Share` label on wide cards and mobile card rows; compact WhatsApp icon at intermediate widths to avoid crowding.
- `Index.html` and `dist/index.html` remain synchronized. No database changes were required.

---

## 2026-07-21 — Premium Songs Library redesign

- Rebuilt the Songs page presentation as a premium navy/teal worship catalogue while retaining the existing song data model and event handlers.
- Added a prominent multi-field search experience (title, artist, theme, Scripture, style, and season), library readiness metrics, and the existing filter/sort controls in a clearer command area.
- Reworked each result into a resource-aware song card with lyrics, media, files, edit, Add to Order/Songbook, YouTube, Spotify, and document entry points.
- Added a responsive two-pane desktop workflow: catalogue on the left and a full song dossier on the right. Mobile uses focused full-screen song detail and a single-column Add/Edit Song form.
- Preserved the Add New Song workflow, metadata fields, Scripture picker, links/uploads, lyrics/chords editor, and existing Orders/Songbooks connections.
- `Index.html` and `dist/index.html` are synchronized. No database or environment-variable changes were required.
- Validation: inline JavaScript syntax checks pass, `git diff --check` passes, browser QA completed for desktop/detail/Add Song/mobile, and `npm run build` passes with placeholder Supabase build variables. `npm run lint` remains blocked by the repository's pre-existing ESLint 9 configuration gap (`eslint.config.*` is absent).

---

## Project Identity

| Field | Value |
|-------|-------|
| **Project name** | LHC Worship Prep |
| **Purpose** | Worship preparation tool for Luther House Chapel — manages songs, rosters, liturgy, and worship orders |
| **GitHub repo** | `https://github.com/jermaineaaron1/LHC-Prep-Tool.git` |
| **Current branch** | `feature/vocal-hero-live-feedback` |
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
- Compatibility follow-up: Worship Prep was still hard-coded to the separate `lhc-vocal-hero.vercel.app` deployment, which explains why the legacy screen appeared after the initial merge. Both `Index.html` and `dist/index.html` now load local `/practice-game?release=20260721-4`; the route is explicitly `no-store` and preserves the release query when redirecting to `/vocal-hero`, preventing stale iframe documents after editor deployments. Older `game_notes` songs are converted to a melody-guide timeline for the new lanes. The note lanes now use DOM elements instead of canvases, avoiding the blank iframe/mobile canvas rendering failure; desktop keeps a ten-second view while mobile uses a clearer four-second, lyric-free note rail beneath the main lyric cue.
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
- Backing tracks now use an always-mounted media transport, so pressing Play audibly starts the music alongside the selected SATB notes even when the backing editor overlay is closed. The cyan lane can be dragged left/right for direct visual synchronization; `timeline_offset` is persisted as the backing track's start position (positive starts later, negative advances into the source). Trim and skip edits are honored by combined playback, and backing speed controls both media and note-preview time.
- Added a permanent synchronized backing-track lane directly above the four SATB lanes. It shares the ruler/playhead and visualizes trim, skip, split, loop, speed, and start-offset settings. The detailed media editor opens in a dedicated overlay, while the low-priority dynamics/breath/part-mixer controls are collapsed below the piano roll.
- Backing-track editing is now directly on the cyan lane: left/right edge handles perform source-aware non-destructive trims; dragging moves a clip while rejecting overlaps; double-click splits at the pointer; right-click offers split, copy, duplicate, paste-at-time, delete, and advanced track settings. Copied clips are pasted into the next available gap when the requested point would overlap. Timeline clips persist inside the existing `backing_track_settings` JSON, so this enhancement requires no new database migration.
- Backing transport stop is guarded synchronously so pending animation/effect work cannot restart media after Stop. Split clips can be rejoined with the adjacent source-contiguous clip from the context menu, and track/clip badges show `current source time / total media duration` in minute:second format.
- Enlarged the backing-track metadata, elapsed/total badge, SATB lane names, and pitch labels by exactly 7px, with wider fixed timeline headers and a taller backing lane to prevent clipping. Added an in-editor **Full screen** control that requests browser fullscreen for the complete Vocal Hero editor, preserves editor state, reflects fullscreen state, and exits through the same control or Esc. The Worship app iframe release key is now `20260721-5`.
- Added a first-class **Create new song** flow to the Vocal Hero library. A modal collects title and optional artist, creates a real `vh_songs` draft through the existing `/api/songs` service route, and immediately opens the blank arrangement editor. Drafts remain visible with a status badge and cannot open a lobby until at least one note is saved; saving a non-empty arrangement promotes it to `ready`. Empty-library guidance and a secondary create CTA are included. No migration is required. The iframe release key is now `20260721-6`.
- Replaced the approximate Vocal Hero pitch positioning with an exact chromatic piano-roll grid. Every semitone in the natural Soprano (C4–A5), Alto (G3–D5), Tenor (C3–G4), and Bass (E2–E4) ranges was labelled and given a discrete 22px row. Drawing and imported MIDI use the identical MIDI-to-row coordinate function. The MIDI parser preserves source track/channel identity, keys overlapping notes by track+channel+pitch, and the import review can explicitly map each source to SATB before falling back to editable pitch ceilings. PPQN tempo conversion remains millisecond-precision; SMPTE-timed files remain intentionally unsupported. Verified with format-0 and format-1/tempo-map MIDI fixtures. No migration is required; iframe release key was `20260721-7`.
- Rebuilt the Vocal Hero editor transport so full-song playback is no longer capped at 20 seconds. The actual arrangement/backing-track/song duration now determines the transport end. Play/resume, pause, stop-and-return, play-from-start, and ±5-second seek are separate controls; pausing cancels scheduled WebAudio safely and resumes by rescheduling from the retained playhead. Clicking the ruler, an empty piano-roll point, or the backing-track lane seeks there and restarts immediately when playback was already running.
- Corrected the displayed natural SATB piano-roll bounds to Soprano C4–A5, Alto F3–D5, Tenor C3–G4, and Bass E2–E4. Each voice can be collapsed independently into a compact pitch contour while retaining timeline/playhead alignment, with Collapse all / Expand all shortcuts. The backing editor overlay now receives the live transport position. No migration is required; iframe release key is `20260721-8`.
- Added direct vertical pitch editing to the Vocal Hero piano roll. In Select mode, dragging a note up/down snaps it chromatically; dragging a member of a multi-selection transposes every selected target by the same semitone interval while preserving start time and duration. Each note is constrained to its own configured SATB range, the display updates live during the drag, and the entire gesture is one Undo/Redo history action. The right-edge duration handle remains independent. No migration is required; iframe release key is `20260721-9`.
- Added `app/api/vocal-hero/media/route.ts`, which creates a short-lived signed Storage upload URL. Large media uploads go directly from the browser to Supabase Storage instead of through Vercel.
- **Manual database step required:** run `migrations/2026-07-20_vocal_hero_backing_tracks.sql` in Supabase before using uploads. It creates the public-read `vocal-hero-media` bucket and the `vh_songs` backing media/settings fields. Public read is necessary for connected singers to retrieve a shared backing track; uploads remain service-signed.
- Verified with `npm.cmd run build` using placeholder Supabase build values. No new npm package is required.

### Vocal Hero piano-roll interaction and rhythm-grid upgrade (2026-07-23)

- On `feature/vocal-hero-piano-roll-interactions`, note bodies are directly selectable in both Select and Draw modes. Ctrl/Cmd/Shift-click builds or toggles a multi-selection, double-click activates a note without collapsing an existing multi-selection, and a real two-dimensional lasso selects every rendered note intersecting the cursor rectangle across any included SATB lanes.
- Dragging a selected note body now edits both dimensions: left/right moves the selected notes anywhere on the timeline with millisecond precision, while up/down transposes them chromatically within each voice's configured range. Multi-note timing, pitch, and durations remain relative, and the complete gesture is recorded as one Undo/Redo operation.
- Reworked the piano-roll visual hierarchy with a dedicated Bars & Beats ruler, numbered bars and beats, strong bar lines, beat lines, quarter-beat subdivisions, alternating measure shading, clearer chromatic rows, octave emphasis, improved note depth/selection states, and stronger sticky pitch headers. The grid is deliberately visual rather than quantized, so syncopated and freely timed notes remain possible.
- Updated the Worship app iframe release key to `20260723-1` in both `Index.html` and `dist/index.html` so the deployed shell requests the upgraded editor rather than a cached practice-game document.
- Verification: `next build` completes, including TypeScript and static generation. `npm run lint` remains blocked by the existing ESLint 9 setup having no `eslint.config.*`; no new package, database migration, or environment variable is required.
- Follow-up on `fix/vocal-hero-draw-notes`: fixed Draw-mode note creation after the lasso upgrade. The lasso container now waits until pointer movement exceeds the drag threshold before capturing the pointer, allowing a normal empty-lane click to reach the note-creation handler while genuine drag gestures still select notes. The iframe release key is `20260723-2`.
- On `feature/vocal-hero-musical-timeline`, upgraded the piano-roll presentation and musical ruler. Editor scrollbars now use slim navy/fuchsia/cyan styling, each chromatic pitch row has a piano-key gutter with a persistent note label, note blocks show their pitch alongside the lyric, and clicking any Soprano/Alto/Tenor/Bass card or part control expands and smoothly navigates to that lane.
- Added a backward-compatible musical timeline inside the existing `backing_track_settings` JSON. Songs can now carry multiple tempo, metre, and key events at arbitrary timeline positions; the ruler regenerates bar lengths, beat divisions, subdivisions, and labels for common or unusual signatures including 2/4, 3/4, 6/8, 9/8, and 7/4. No database migration is required, and legacy arrangements receive defaults from their current BPM/time-signature values.
- Draw-mode note creation now snaps its initial start/end to the active musical beat and fills exactly one beat. After creation, existing free movement, chromatic pitch dragging, edge resizing, and millisecond-precision save behavior remain available for pickups, syncopation, and notes longer than one beat. Musical-map edits participate in Undo/Redo history.
- Updated both Worship-shell iframe release keys to `20260723-3`. Verification: `next build` passes with TypeScript and static generation using placeholder Supabase build variables; `git diff --check` passes. A local in-app browser connection stalled during the visual smoke-test attempt, so production interaction should still receive a quick manual check after deployment.
- On `feature/vocal-hero-note-clipboard`, added a multi-note internal clipboard. Ctrl/Cmd+C copies every selected target while preserving SATB part, pitch, lyric, duration, velocity, and relative timing; after clicking a timeline destination, Ctrl/Cmd+V pastes the group with its earliest target anchored to the playhead. Toolbar and beat-precision actions expose the same commands, paste is one Undo/Redo action, and text/numeric inputs retain native clipboard behavior.
- Added persistent rhythmic placement feedback. Expanded voice lanes use alternating beat bands, stronger bar/beat/subdivision lines, and repeated `bar.beat` labels. Selected notes show a compact beat badge; the precision strip and inspector report exact bar, beat, on-beat/quarter/half/three-quarter/off-grid status, raw seconds, and hold duration integrated in musical beats across tempo or metre changes. The Worship iframe release key is `20260723-4`.
- On `feature/vocal-hero-quantized-notes`, made the Vocal Hero piano roll musically quantized instead of visually guided only. A persisted rhythmic latch supports whole, half/minim, quarter/crotchet, eighth, sixteenth, and thirty-second-note values; bar subdivisions now reflect the selected value and every draw, move, resize, duplicate, paste, inspector timing edit, and MIDI import adheres to it. Changing BPM, metre, or latch value re-quantizes the arrangement, while Undo/Redo snapshots retain the latch setting. No migration is required because the value lives in the existing `backing_track_settings.musical_timeline` JSON.
- Added monophonic collision enforcement per individual SATB voice. Soprano, Alto, Tenor, and Bass may overlap one another as harmony, but targets inside the same voice cannot overlap; interactive conflicts are rejected with an editor notice, while legacy/MIDI clashes are moved to the next available grid position. Resizing ripples subsequent notes only within the edited voice. Stop now halts all audio, returns to 0:00, clears note/range/voice selections, and makes the next Play start the full arrangement from the beginning. Backspace/Delete removes selected notes outside Erase mode while preserving native behavior in form fields. The Worship iframe release key is `20260723-5`.
- On `fix/vocal-hero-sticky-timeline-header`, removed the Musical Timeline “Draw behavior” instruction card and rebalanced the remaining BPM, metre, key, and rhythmic-latch controls. The Bars & Beats ruler and backing-track lane now form one sticky header inside a dedicated piano-roll scroll viewport, so musical position and accompaniment alignment remain visible while vertically reviewing any SATB lane. The Worship iframe release key is `20260723-6`; no migration or environment change is required.
- Verification: production `next build` passes TypeScript, page-data collection, and static generation using placeholder Supabase build variables. `git diff --check` passes. `npm run lint` remains blocked by the repository's pre-existing ESLint 9 setup without an `eslint.config.*` file.

## Recommended Next Steps

### Vocal Hero gameplay controls and pitch precision (2026-07-29)

- Added visible Pause/Resume and Back to menu controls to the host/solo gameplay header. Pause is synchronized through the existing `vh_game_sessions.paused` field; resume shifts the shared server-issued playback anchor by the pause duration, and connected phones show a dedicated paused screen instead of advancing their score clock.
- Rebuilt gameplay note lanes as exact chromatic piano rolls. Every semitone between the arrangement's displayed low/high pitches has its own horizontal row and persistent piano-key label; target blocks and the live detected-pitch marker now use the identical MIDI-to-row transform instead of a compressed three-label scale.
- Corrected the detector's autocorrelation refinement to use both neighboring samples, prefers the first strong period peak to reduce subharmonic/octave errors, uses a 2048-sample low-latency analysis window, and constrains desktop/mobile detection to the selected SATB voice range. Target-time feedback corrects common octave-harmonic locks without changing pitch class.
- Tightened scoring: ambient/backing-track sound no longer captures an entrance; onset requires the expected pitch, and a note earns points only when both timing and at least half of its voiced samples are in tune. Headphones remain recommended because browser pitch detection cannot fully isolate a singer from loudspeaker bleed in the same room.
- Added `/api/vocal-hero/control` and `setSessionPaused` for synchronized pause/resume using the already-installed session columns; no new migration or environment variable is required. Bumped both Worship-shell iframe release keys to `20260729-2`.
- Verification: `npx tsc --noEmit`, `next build` (with placeholder Supabase build values), and `git diff --check` pass. The existing ESLint 9/no-flat-config limitation remains unchanged.

### Vocal Hero note audition and exact live pitch comparison (2026-07-29)

- Manually drawing a note in the arrangement editor now auditions its actual MIDI pitch immediately through the existing piano-style Web Audio voice. The preview is gated to the generated target's exact duration, so whole, dotted, quarter, eighth, and other selected rhythmic values sound for their BPM/metre-derived length rather than a fixed preview length.
- Gameplay now keeps the microphone's raw detected pitch for visual feedback instead of silently octave-normalizing its displayed note. The singer sees **You sang** and **Target** note names, the number of semitones above/below the target, cents offset, and a live detected-pitch marker on the exact chromatic row. Octave/harmonic tolerance remains isolated to the scoring engine.
- The exact comparison appears in the desktop singing coach, the active pitch-lane header, and the compact mobile feedback card. The Worship iframe release key is `20260729-3`; no migration, package, or environment change is required.
- Follow-up on `feature/vocal-hero-note-click-audition`: clicking or pressing any existing note body in Select or Draw mode now auditions that note for its full authored duration. The editor uses a single monophonic preview channel: selecting a different note fades the previous preview within 18ms before sounding the new pitch, rapid suspended-audio callbacks are generation-guarded, and transport Play/Stop/Pause also cancels the preview. The Worship iframe release key is `20260729-4`.

### Vocal Hero gameplay-lyrics authoring (2026-07-29)

- Added a visible **Edit gameplay lyrics** workspace to the arrangement editor. Authors can explicitly choose the live lyric source: per-note piano-roll lyrics or complete phrase-timeline rows.
- Per-note lyric edits now automatically select the note-lyrics source instead of being silently hidden behind legacy `timed_lyrics`. Note lyrics are grouped into stable karaoke phrases using their authored timing, rests, punctuation, hyphenated syllables, and the configured targets-per-phrase limit.
- Phrase rows expose editable sentence text and start/end seconds, plus add/remove and **Build phrase timeline from note lyrics** actions. Their timing drives character-progress highlighting in gameplay. Phrase/source edits participate in the existing Undo/Redo snapshots.
- `timed_lyrics` and the selected lyric source now persist through the existing `vh_songs` update path. No migration is required: phrase rows use the existing `timed_lyrics` column and source selection lives in `backing_track_settings.karaoke_lyrics` JSON.
- Bumped both Worship-shell practice-game release keys to `20260729-5`. Verification: `npx tsc --noEmit`, production `next build` with placeholder Supabase build variables, and `git diff --check` pass.

### Vocal Hero gameplay lyric-lane alignment (2026-07-29)

- Phrase-authored gameplay now uses one normalized lyric timeline for both the large karaoke sentence and the words inside the note highway. Old per-note fragments and blank labels are replaced at render time by the words belonging to the phrase that overlaps each note; saved pitch, timing, and editor lyric data remain untouched.
- Phrase words are distributed in order across every overlapping note. Extra notes repeat the relevant word for melismatic passages, while fewer notes group adjacent words so the complete sentence remains represented.
- Adjacent duplicate phrase rows with the same text are collapsed for gameplay, preventing the same sentence from appearing as both the current and next cue while preserving legitimate repeated lyrics later in the song.
- The same alignment is applied on the host, solo, full-board, and phone gameplay views. Bumped both Worship-shell practice-game release keys to `20260729-6`; no migration, package, or environment change is required.

### Vocal Hero voice-aware gameplay lyrics (2026-07-30)

- Personal and phone gameplay now derive the lyric banner strictly from the singer's selected Soprano, Alto, Tenor, or Bass notes. A true SATB part never borrows words from another voice; an un-authored part receives an explicit wait/instrumental cue.
- The global phrase timeline is used only for a shared guide or when all four complete SATB lyric streams normalize to the same words. This keeps convenient shared worship lyrics while preserving contrapuntal or independent choir text.
- The host choir board now shows one compact shared karaoke banner when all parts match, or four colour-coded S/A/T/B lyric cards with independent progress when their words differ.
- Phrase-to-note label distribution is restricted by the same safety rule, so divergent per-voice lyrics are no longer overwritten visually by a song-wide phrase. Bumped both Worship-shell practice-game release keys to `20260730-1`; no migration, package, or environment change is required.

### Songs mobile interactions (2026-07-22)

- On `fix/mobile-song-interactions`, search suggestion selection now filters the catalogue, dismisses the mobile keyboard, scrolls the exact result card into the center of view, and briefly highlights it. Keyboard Enter follows the active suggestion through the same path.
- Theme, Feel, and Scripture are stronger 48px mobile filter targets with icons, chevrons, focus states, and the concise default label `All`; Theme and Scripture also support keyboard activation.
- Document and YouTube resource viewers are portalled to the end of `<body>` and raised above the mobile song workspace. Duplicate YouTube preview markup was removed, eliminating conflicting IDs.
- The mobile document viewer is constrained to the viewport. Its title truncates safely, zoom controls collapse on phones, and the open/close icon controls remain visible without horizontal scrolling.
- Mirrored the focused changes into both `Index.html` and `dist/index.html` without replacing deployed-only code. No schema or environment changes are required.
- Browser verification at 390x844 confirmed suggestion-to-card alignment, all three `All` defaults, document/video z-index `120000`, one YouTube modal, and a fully visible document close control.

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

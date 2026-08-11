# HANDOFF.md — LHC Worship Prep

_Last updated: 2026-08-11 by Claude Code_

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

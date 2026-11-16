# Brief for ChatGPT: redesign the visuals of a service's page

Copy everything below the line into ChatGPT.

---

You are a senior product designer. Redesign the **visual layer** of one page of a church web app, so a developer can apply your design by changing CSS (and, rarely, small pieces of markup) without rewriting any behaviour. Every component, button and state listed below already works in code. Your design must keep all of them, keep their names, and give each one a clear place.

## The app and the people using it

- **LHC Worship Prep** is the worship-planning app of Luther House Chapel, a Lutheran church. Volunteers use it to plan services: liturgies, readings, songs and the slides projected on Sunday.
- Most use is on **phones** (360–430px wide), often a few minutes before a meeting or during a service. Desktop is used for preparation (1280–1536px).
- Users are not technical. Labels are plain English, sentence case, with no jargon. Large tap targets (at least 40px) matter.

## The page

This is **a service's page** in the Liturgy Library, for example "Advent Sundays". It has:

1. **A slim banner** `header.pl-hero.pl-hero--slim`
   - `.pl-hero__back`: an "All Services" badge that goes back.
   - `.pl-hero__name`: a cross icon and the service's name (`h1`).
   - `.pl-hbtn.pl-hbtn--icon`: Projection. It only appears when the coming service's order exists.
2. **Tabs** `nav.pl-tabs > button.pl-tab` (`.is-on` = current): **Liturgy Order** · Planning Notes · Special Planning · Checklist · (Preparation Guide on some services). Only redesign **Liturgy Order**. The other tabs must keep working and only need to inherit the new tokens.
3. **The Liturgy Order tab** `.sp-lib`: two columns on a desk (`.sp-lib__main` flexible | `.sp-lib__side` 300–380px). On a phone they stack, main first.

### A. Left column: the Liturgy Library box `.ll-box.sp-res`

The church's documents for this service, by year. Past years' liturgies are kept here.

- **Header** `.sp-res__top`: the title "Liturgy Library" (Cinzel). Beside it, two buttons in `.sp-res__adds`: **Upload** (`.sp-btn-maroon`, gold) and **Google Doc**.
- **Kind chips** `.sp-rtabs > .sp-rtab` (`.is-on`), each with a count: Liturgies 8 · LCD 0 · Photos & Files 0 · Links 0.
- **Year chips** `.sp-years > .sp-year` (`.is-on`):
  - All years, then each year with its lectionary letter: `2026 B`, `2025 A`, `2023 B` (the letter is a `<small>`).
  - `.sp-year--add`: "+ Year".
  - A document row can be dragged onto a year chip on a desk (`.is-drop` while hovering).
- **Document rows** `ul.sp-docs > li.sp-doc`
  - Each row has a file badge (PDF / DOC / G for Google Doc) and `.sp-doc__t`: the name (`b`) and a meta line (`small`), e.g. "Word · 2025 · Year A · Added 16 Mar 2026".
  - Then its buttons in `.sp-doc__acts`:
    - `.sp-yearbtn`: the year, with a caret. Opens a menu to move it to another year.
    - Either **Convert** (`.sp-btn-maroon`, gold, wand icon), or, once converted, `.sp-convd` ("✓ Converted ▾", green tint, opens a menu) plus **Use** (`.sp-usebtn`, dark green).
    - Three icon buttons: Preview (eye), Rename (pen), Share.
  - States:
    - `.is-new`: highlighted gold. Used for "just converted" and when "Go to file" points at the row.
    - `.sp-doc--conv`: a converted row whose buttons take a second line.
  - Double-click or double-tap previews the document.
- **The tip** `.sp-tip`: "Double-tap a document to preview it. Its year button files it under a year."
- **Empty state** `.lf-muted`: "No liturgy documents for this service yet. Upload this year's, and it can be made the base of next year's."
- **The LCD tab** has cards instead of rows: `.sp-lcd > .sp-lcdcard`, each with a slide preview (`.sp-lcdcard__slide`) and meta (`.sp-lcdcard__meta`).

### B. Right column, card 1: "This year's liturgy" `section.pl-card.sp-make`

The most important card. It has three states.

**State C: no order yet for the coming service** (`.sp-make` alone)

- `.sp-make__when`: the date (bold) and "1st Sunday of Advent · Year B · Contemporary service".
- `.sp-fits > .sp-fit`: up to three Liturgy App Files that suit the Sunday. Each has a name, a meta line, Preview (eye) and **Use** (dark green).
- Or `.sp-make__none`: "No Liturgy App File for this Sunday yet."
- `.sp-tourbtn`: "Show me how", which starts a five-step guided walkthrough with a spotlight.
- `details.sp-how`: "How to make this year's from a past one", three numbered steps and a note about lectionary years.
- A full-width dark green button: "Open in the Liturgy Builder".

**State A: the liturgy is in use** (`.sp-make.sp-make--use`)

- **Header** `.pl-card__hd`: icon, "This year's liturgy", and a badge `.spi-badge` "✓ In use".
- **Where it came from**, then **where it is used**: `.spi-flow`, two blocks joined by an arrow `.spi-arrow`.
  - `.spi-node--from` (gold-tinted):
    - Label "THE LITURGY OF".
    - The file's name: "No Communion Liturgy Framework - Advent".
    - "2025 · Year A".
    - `.spi-docname`: "From 1st Sunday Advent (Communion)", the document it was converted from.
    - On the right, `.spi-orig`: a gold badge `.spi-orig__badge` "★ ORIGINAL", and `.spi-golink` "Go to file", which scrolls to and highlights that document's row in the left box.
  - `.spi-node--to` (green-tinted):
    - `.spi-date`: a date tile (big "29", small "NOV").
    - Label "USED FOR", "Sunday, 29 November 2026" and "1st Sunday of Advent · Year B · Special service".
    - On the right, `.spi-showbtn`: "Show liturgy" / "Hide liturgy" (`.is-on` when open).
- **Comparison line** `.spi-cmp`, one of:
  - `.spi-cmp--same`: "✓ Same as the original".
  - `.spi-cmp--diff`: "Modified: 2 parts changed · 1 section taken out · 1 section renamed", with **See** (`.spi-cmp__see`) and **Reset to original** (`.spi-cmp__back`, gold).
  - Plain `.spi-cmp`: "Comparing with the original…" or "Its Liturgy App File has been deleted…".
- `.spo-fill` (amber, only when the order has no readings): "No readings in it yet. Put in this date's readings from the Roster".
- **The liturgy** `.spo`, shown only when Show liturgy is on:
  - `.spo-tools`:
    - Counts "30 sections · 15 liturgy parts · 4 readings · 0 songs".
    - Small pill buttons: Expand all · Collapse all · Reorder (`.is-on` and "Done" while reordering) · Undo · Redo. Undo and Redo can be `disabled`.
  - `.spo-hint2`: a one-line hint.
  - `ol.spo-secs > li.spo-sec` (`.is-open`, `.is-editing`), one per section:
    - **Row** `.spo-sec__row`: a header button `.spo-sec__hd` with:
      - The section number (`b`).
      - The name `.spo-sec__name`.
      - Tags `.spo-tag`: "Renamed" or "Moved" (`.spo-tag--ch`, amber), or "Added" (grey).
      - A one-line summary `small`.
      - `.spo-sec__dot`: an amber dot, shown when a part inside changed.
      - A chevron.
    - **Its tools** `.spo-sec__tools`: icon buttons `.spo-ic`, Rename (pen) and Remove (`.spo-ic--rm`, red bin). While reordering, these are replaced by up and down arrows (the first and last are disabled).
    - **Renaming**: `.spo-sec__edit` replaces the row with the number, a text input `.spo-secname`, Cancel and Save.
    - **A section of the original that was taken out**: `.spo-sec.spo-sec--gone`. Dashed and struck through, with a "TAKEN OUT" tag (`.spo-tag--gone`, red) and **Put back** (`.spo-mini.spo-mini--back`).
    - **Open**: `.spo-parts`, the parts, each a `.spo-part`:
      - `.spo-part__hd`: a kind icon, the title (`b`), a tag ("CHANGED", "MOVED", "Not in the original") and **Edit** (`.spo-pen`) for liturgy parts.
      - `.spo-words`: the words, one paragraph per slide, separated by a dashed rule.
      - Readings and songs show a note instead (`.spo-note`): "From the Roster…" or "its words are in the Songbook".
      - **Editing** (`.spo-part.is-editing`): a textarea `.spo-text`, the hint "A line of three dashes (---) starts a new slide", then Cancel and Save.
      - **A changed part** (`.spo-part--changed`, amber left edge): buttons in `.spo-chg`, "See the original" and "Put back the original". The original's words can show under them in `.spo-orig` (dashed box, label "THE ORIGINAL").
      - **A part taken out**: `.spo-part--gone`, struck through, with Put back.
  - `.spo-more`: "Show all 30 sections" (dashed).
- **Actions** `.spi-acts`: a full-width dark green "Open in the Liturgy Builder" (`.spi-act--main`), then two equal buttons, **PDF** and **Share**.
- **Footer links** `.spi-more` (above a dashed rule): "Use another liturgy" (`.spi-link`, green), and "Remove from this service" (`.spi-link--rm`, red).
  - `.spi-change` (opens under them): the Liturgy App Files list with Use, and a hint.

**State B: the order was written in the Builder, not from a file.** This is the same as A, with "Its liturgy: Written in the Liturgy Builder", the badge "Order made" (`.spi-badge--plain`), and no Original, Go to file, comparison or Remove.

### C. Right column, card 2 (only sometimes): "Liturgy App Files" `.ll-box.sp-readybox`

This box only appears when there are Liturgy App Files that weren't converted from a document.

- Rows `.sp-ready__row`, each with:
  - A year (`.sp-ready__yr`), name and meta (`.sp-ready__t`).
  - Pills `.sp-pill`: "In use" (`--use`) and the Sundays it's for (`--days`).
  - Buttons: preview, Sundays, Use, share, delete.

### D. Things that open over the page

Keep these consistent with the new look. They don't need full mockups unless you have time.

- A preview window for documents. It can go full screen.
- The **Use** window (`.sp-usewin`): four steps with a stepper, Service → Readings → Add to it → Confirm.
- Confirmation dialogs (Remove, Reset to original, Remove from this service). They have an icon, a title, a detail chip, a message, a grey cancel button and a red or gold confirm button.
- Toasts with an Undo action.
- Small floating menus: the year menu and the Converted menu.
- A floating "Back to Advent Sundays" bar, shown at the foot of the Liturgy Builder.

## Constraints you must respect

1. **Keep every component above, its class names, and every label's meaning.** You may restyle anything, reorder things within a card, change spacing, colour, type and icons. If you want different wording, list it separately as "Proposed label changes". Don't put new wording straight into the mockup.
2. **No new features, and no removing any.** Every button listed must still be visible in the same state as today.
3. **Markup changes only when necessary.** If a layout truly needs a wrapper or a change of order, say so as a short numbered list ("Wrap `.spi-acts` buttons in…"), naming the component. Prefer CSS-only (flex, grid, order, gap).
4. **Fonts available:** Poppins (UI), Lato (body), Playfair Display (headings), Cinzel (small caps titles). No others.
5. **Icons:** Font Awesome 6.5.1 **Free** only (solid, regular, brands). Pro icons will not render.
6. **No libraries, no images to download, no web fonts beyond those.** Plain CSS. It must work in Safari 15+, Chrome and Samsung Internet: no `:has()`-only layouts, and add `-webkit-` prefixes for `backdrop-filter` and `user-select`.
7. **Colours.**
   - Current tokens: green `#1f4d36` (primary) and `#163b2a`, gold `#c9a24a`, cream `#fbf7ef`, line `#e8dfcd`, ink `#1d1a14`, muted `#6b5f50`, danger `#b42318`, amber for "changed" `#e0a526` / `#fde7b0`.
   - Keep green as primary and gold as "original / attention".
   - The page header can take the season's altar colour (Advent is purple or blue, Lent purple, Easter white or gold, ordinary time green). Design it to accept any of these.
   - **Light theme only.**
   - Text contrast must meet WCAG AA.
8. **Phone first.** At 375px:
   - Nothing may scroll sideways.
   - Every button stays at least 40px tall.
   - The "Used for" block holds the date tile, the words and Show liturgy on one row.
   - Section rows keep their two icon buttons on the right.
   - Long names wrap. They never cut off.
9. **Density.** The operator has asked, more than once, for "concise" and "more space for the documents and the liturgy". Banners and labels should be small, and the content large.

## What to deliver

1. **One self-contained HTML file** (inline `<style>`, no scripts needed) showing the Liturgy Order tab with realistic placeholder content. It should use **exactly the class names above**, so your CSS can be lifted into the app. Show it twice, side by side or one after the other:
   - **Phone, 390px wide:** State A with the liturgy open. Show one section renaming, one open section with a changed part showing its original, one section taken out, and the Undo button enabled.
   - **Desktop, 1366px wide:** the two columns, State A with the liturgy closed. Under it, a small State C card.
2. **A short design spec** for the developer:
   - Tokens (colours, radii, shadows, spacing scale, type scale).
   - For each component: its default, hover, pressed, focus-visible and disabled states.
3. **"Proposed label changes"** and **"Markup changes needed"** as two short lists, or "none".

## Sample content to use

- Service: Advent Sundays. Coming service: Sunday, 29 November 2026, 1st Sunday of Advent, Year B, Special service.
- Its liturgy: "No Communion Liturgy Framework - Advent", 2025 · Year A, from the Google Doc "1st Sunday Advent (Communion)".
- Documents, 2025:
  - 1st Sunday Advent (Communion), Google Doc, converted.
  - Advent Liturgy -- Communion, Google Doc.
  - Advent Liturgy -- No Communion, Google Doc.
  - LHC Advent Holy Communion, Word.
  - LHC Advent No Communion, Word.
- Documents, 2023: Advent Week 2 2023 (PDF), Week 3 (Word), Week 4 (Word).
- Sections: 1 Gather · 2 O Come O Come Emmanuel · 3 Invocation · 4 Confession · 5 Gathering Song - Come Thou Long Expected Jesus · 6 Greeting · 7 Kyrie · 8 Glory to God … (30 in all).
- A liturgy part's words, for example: "P: In the name of the Father, and of the Son, and of the Holy Spirit. C: Amen."

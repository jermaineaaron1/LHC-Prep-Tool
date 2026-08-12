# tools/

Checks for `Index.html`. There is no build step and no `node_modules`, so these
deliberately depend on nothing but a system `node` and `python3`.

Run both from the repo root after editing `Index.html`, before committing.

## check-inline-scripts.py — syntax-check every inline `<script>`

```
python tools/check-inline-scripts.py --check
```

Pulls each inline `<script>` block out of `Index.html` and runs `node --check`
over it. A syntax error in a single-file app is only discovered at runtime in
the browser, and a broken block silently kills every function defined in it, so
this is worth running on any edit. Exits non-zero if a block fails.

Blocks with `src=` are skipped. Point it at another file by passing a path.

## bg-repin-harness.js — per-slide background re-pinning

```
node tools/bg-repin-harness.js
```

`orders.template.sectionBackgrounds` is keyed by section id and then by **local
slide index**. Because that key is positional, any path that inserts, deletes or
reorders slides must re-pin the map — otherwise every background below the
change point silently lands on the wrong slide. Nothing looks wrong on screen,
which is exactly why it needs a test.

The harness does **not** reimplement the functions. It slices their real source
out of `Index.html` by brace balance and runs that text against `minidom.js`
with the module-level dependencies stubbed, so it always tests the shipped code.

Covers the two whole-item removal paths (`removeLiturgyFromSection`,
`removeSongFromSection`): a trailing removal, a middle removal for both songs
and liturgy, emptying a section entirely, and a section with no pins. It also
asserts each path pushes exactly one undo step.

### The negative control matters

```
git show <rev>:Index.html > /tmp/prefix.html
node tools/bg-repin-harness.js /tmp/prefix.html --expect-broken
```

`--expect-broken` asserts the fix is *absent*, for pointing at pre-fix source. A
harness that passes on broken code proves nothing — against the commit before
the fix this reports 9 of 18 checks failing. If you extend the harness, confirm
it still fails without the fix.

## minidom.js

The DOM shim the harness runs against — `querySelector`/`querySelectorAll`
(class and `[attr="value"]` selectors only), `closest`, `remove`,
`appendChild`, `isConnected`, and an `innerHTML` setter modelling the
placeholder rewrite. Extend it as the code under test reaches for more.

## Related paths

Other code touching this same background map, for when a change needs a wider
sweep than the two removal paths above: `_lcdDeleteSlideBox`, `removeSlideBox`,
`addSlideBoxAfter`, `_lcdAddSlideAfter`, `_lcdInsertSongIntoSection` and the
rail reorder in `lcdRailDrop`. All should bracket their mutations with
`_lcdCaptureSectionBgs` / `_lcdRestoreSectionBgs`.

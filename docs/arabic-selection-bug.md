# The Arabic selection-highlight bug

Reported as "highlighting misbehaving somewhat" with Arabic text. It was real,
but it was **not** an Arabic or bidi problem — it was a CodeMirror measurement
quirk triggered by the note's inline title.

## Symptom

Selecting a paragraph painted a pale block that ran ~24px below the last line of
text, sometimes swallowing the following blank line. Most visible on Arabic
paragraphs because the trailing "." punctuation leaves a visible gap, but the
same thing happened to an English paragraph in the same document.

Measured: CodeMirror's selection rect ended at y=406 while the browser's own
`Range.getClientRects()` for the identical range ended at y=382 — a 24px error,
exactly one line height.

## How it was found

1. Three Arabic test notes (pure RTL, mixed RTL/LTR, and a matched EN/AR pair).
2. For a given doc range, compared:
   - `document.querySelector('.cm-selectionBackground').getBoundingClientRect()`
   - a `Range` built over the same positions via `view.domAtPos()`
   Any difference is a painting bug, not a text-direction bug.
3. `view.coordsAtPos()` at both ends returned the CORRECT values (267–286 and
   291–310), so the error was in how the selection rects are *assembled*, not
   where the text is.
4. The rect structure gave it away: 3 pieces — top, a 77px "between" piece, and
   a 43px "bottom" piece. CodeMirror had promoted the paragraph's *second
   visual row* into the "bottom" block, counting one row twice.
5. Bisected the editor extensions. Removing the block-widget fields
   (`inlineTitleField`, `frontmatterField`, `tableField`, …) gave `diff: 0`.
   Restoring only `inlineTitleField` brought the 24px error straight back.
6. Reproduced in **plain CodeMirror** outside the app, with just a block widget
   at position 0 and `drawSelection()` — no app code involved.

## Upstream cause

`@codemirror/view@6.43.0`, `rectanglesForRange()`:

```js
if ((visualStart || startBlock).to < (visualEnd || endBlock).from - (visualStart && visualEnd ? 1 : 0) || ...)
    between.push(piece(leftSide, top.bottom, rightSide, bottom.top));
```

It decides "there are blocks between these two positions" by comparing
document offsets. A **block widget at offset 0** (the inline note title) sits
between the paragraph's start and end in block terms, so the branch fires and
the middle visual row becomes the "bottom" piece.

Compounding it, the `between` piece spans the full width from `top.bottom` to
`bottom.top` — with `lineWrapping`, `blockAt()` returns a whole *paragraph*
block, so that band crosses the wrapped rows and the blank line between
paragraphs. With `between` counted twice (the rect itself plus the `bottom`
piece), the overshoot is exactly one line height.

Verified independently: a block widget with **any vertical margin** at position
0 makes the first paragraph's selection overshoot by exactly that margin
(`margin: 0 0 0.5em` at 44px font → 22px error; `margin: 0` → 0 error).

## What was changed

`web/src/lib/livePreview.ts` — the `.cm-inline-title` theme entry:

```diff
-    margin: '0 0 0.5em',
-    padding: '0',
+    margin: '0',
+    padding: '0 0 0.5em',
```

The inline title is a block widget at offset 0, so its margin is what fed the
bug. Padding keeps the same visual gap below the title and is measured inside
the block box, so it cannot leak into the following paragraph's selection.

## Result

Arabic note, dark mode, selection spanning two wrapped paragraphs:

| check | before | after |
|---|---|---|
| top of selection vs text | 0px | 0px |
| bottom of selection vs text | **24px** | **0px** |
| pieces | 3 (one row counted twice) | 7 (one per visual row) |
| all 20 single-line samples, 3 files | — | dTop 0 / dBot 0 on every one |

Every line of all three Arabic test files, single-line selections:
`dTop: 0, dBot: 0`.

Two known residuals, both upstream and much less visible than the original:

- Selecting across **two wrapped paragraphs** still yields one full-width band
  for the inter-paragraph gap, painted from the last row of the first paragraph
  to ~2px before the first row of the second (it was 24px past *and* one row
  dropped). It reads as "the blank line is selected", which is roughly what the
  user selected on the way past.
- The band is full-width rather than text-width. Native selection does the same.

Both would need a patch to `rectanglesForRange` (a fork or a `patch-package`
override). Not worth carrying for a visual nuance; revisit if it ever bothers.

## Regression checks after the fix

| | result |
|---|---|
| dark caret vs text colour | `rgb(218,218,218)` == `rgb(218,218,218)` |
| font size 16 → 24 | body 24px, h1 38.83px |
| cursor scrolling (off) | wheel not hijacked |
| side padding | scroller 32px, content 0px (selection starts at the text edge) |

Also tried and ruled out: `perLineTextDirection`. Disabling it changed nothing
(the bug persisted), so the RTL feature itself is not implicated — it is a
`drawSelection` issue that RTL text made easier to notice.

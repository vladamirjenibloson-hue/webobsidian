import {
  EditorView,
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

/**
 * Text direction, matching Obsidian 1.6+.
 *
 * Obsidian detects direction **per line** using the editor's native per-line bidi
 * support, and isolates code and math so they keep their own direction inside
 * RTL prose. This module wires up the same CodeMirror primitives rather than
 * re-implementing bidi:
 *
 *  - `EditorView.perLineTextDirection` — without it CodeMirror assumes a single
 *    direction for the whole document, so its own bidi, cursor and click
 *    handling disagree with lines that render RTL.
 *  - A line decoration carrying `dir` — CodeMirror derives a line's bidi order
 *    from the *rendered* line's computed direction, so the attribute has to
 *    reach the DOM.
 *  - `EditorView.bidiIsolatedRanges` — inline code and math become explicit LTR
 *    isolates, so they are not reordered by surrounding Arabic text.
 *
 * The per-line rule is the Unicode bidi algorithm's P2/P3 — the first strong
 * directional character decides — which is what Obsidian documents ("the
 * language of the first word"). Markdown markers (`#`, `-`, `>`, `|`), digits
 * and punctuation are neutral/weak, so they never decide a line's direction.
 * Nothing here is script-specific: Persian, Urdu, Kurdish, Hebrew and any future
 * RTL script behave correctly.
 */

/** RTL (bidi class R/AL) strong ranges. */
const RTL_STRONG =
  /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
/** Only letters are "strong"; digits, spaces and punctuation are not. */
const STRONG = /\p{L}/u;

/** Unicode P2/P3: direction of the first strong character, LTR if none. */
export function lineDirection(text: string): 'rtl' | 'ltr' {
  for (const ch of text) {
    if (!STRONG.test(ch)) continue;
    return RTL_STRONG.test(ch) ? 'rtl' : 'ltr';
  }
  return 'ltr';
}

const FENCE = /^\s*(?:```|~~~)/;
const INDENTED = /^(?:\t| {4})/;
const FRONTMATTER_DELIM = /^(?:---|\.\.\.)\s*$/;

const rtlLine = Decoration.line({ attributes: { dir: 'rtl' } });
const ltrLine = Decoration.line({ attributes: { dir: 'ltr' } });

function lineDecorations(view: EditorView): DecorationSet {
  const { doc } = view.state;
  const ranges = view.visibleRanges;
  if (!ranges.length) return Decoration.none;

  const first = doc.lineAt(ranges[0].from).number;
  const last = doc.lineAt(ranges[ranges.length - 1].to).number;

  // Fence and frontmatter state is tracked from the top of the document: the
  // viewport may start in the middle of a code block or of the YAML header.
  let inFence = false;
  let inFrontmatter = false;
  const builder = new RangeSetBuilder<Decoration>();

  for (let n = 1; n <= last; n++) {
    const line = doc.line(n);
    const text = line.text;

    // Raw frontmatter stays LTR, like Obsidian's editor. It is only frontmatter
    // when the document opens with `---`, so a later `---` is a horizontal rule.
    if (n === 1 && /^---\s*$/.test(text)) inFrontmatter = true;

    const isFence = FENCE.test(text);
    // A closing fence belongs to the block, so test fence state before toggling.
    const codeLike = isFence || inFence || INDENTED.test(text);
    if (isFence && !inFrontmatter) inFence = !inFence;
    if (inFrontmatter && n > 1 && FRONTMATTER_DELIM.test(text)) inFrontmatter = false;

    if (n < first) continue;
    const dir = inFrontmatter || codeLike ? 'ltr' : lineDirection(text);
    builder.add(line.from, line.from, dir === 'rtl' ? rtlLine : ltrLine);
  }
  return builder.finish();
}

const lineDirectionPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = lineDecorations(view);
    }
    update(update: ViewUpdate) {
      // docChanged covers typing; viewportChanged covers scrolling. A fence or
      // frontmatter edit can change the reading of lines far from the caret, so
      // the visible range is rebuilt rather than incrementally mapped.
      if (update.docChanged || update.viewportChanged) {
        this.decorations = lineDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const isolateMark = Decoration.mark({
  class: 'cm-bidi-isolate',
  bidiIsolate: 1 /* Direction.LTR */,
  inclusive: true,
});

/** Inline code and math keep LTR order inside RTL prose. */
function isolatedRanges(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        // Lezer markdown: InlineCode spans; InlineMath for inline `$…$`.
        if (node.name === 'InlineCode' || node.name === 'InlineMath') {
          if (node.to > node.from) builder.add(node.from, node.to, isolateMark);
        }
      },
    });
  }
  return builder.finish();
}

const isolatePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = isolatedRanges(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = isolatedRanges(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * The facet alone only informs CodeMirror's own ordering; the DOM needs the
 * span as well, hence the plugin below. `unicode-bidi: isolate` then matches
 * what CodeMirror assumes for the range.
 */
const isolateTheme = EditorView.theme({
  '.cm-bidi-isolate': { unicodeBidi: 'isolate', direction: 'ltr' },
});

/** Register once in the editor's extension list. */
export const autoRtl = [
  EditorView.perLineTextDirection.of(true),
  lineDirectionPlugin,
  EditorView.bidiIsolatedRanges.of((view: EditorView) => isolatedRanges(view)),
  isolatePlugin,
  isolateTheme,
];

import { EditorView, ViewPlugin, type ViewUpdate, Decoration } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

// Determine direction per visual source line. Arabic-script lines become RTL;
// English/code-only lines remain LTR. Isolate the direction to each line so
// mixed-language notes and punctuation retain sensible browser bidi behavior.
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
// Opening/closing fenced-code marker, e.g. ```ts or ~~~.
const FENCE = /^\s*(?:```|~~~)/;
// Indented (4-space/tab) code block body.
const INDENTED = /^(?:\t| {4})/;
const lineDirection = Decoration.line({ attributes: { dir: 'rtl', class: 'cm-line-rtl' } });
const ltrDirection = Decoration.line({ attributes: { dir: 'ltr' } });

function decorations(view: EditorView) {
  const { doc } = view.state;
  const ranges = view.visibleRanges;
  if (!ranges.length) return Decoration.none;

  const firstVisible = doc.lineAt(ranges[0].from).number;
  const lastVisible = doc.lineAt(ranges[ranges.length - 1].to).number;

  const builder = new RangeSetBuilder<Decoration>();
  // Fence state has to be tracked from the top of the document: the visible
  // range can start in the middle of a fenced code block, and a fence line
  // itself must not be mistaken for prose.
  let inFence = false;
  for (let n = 1; n <= lastVisible; n++) {
    const line = doc.line(n);
    const isFence = FENCE.test(line.text);
    const codeLike = isFence || inFence || INDENTED.test(line.text);
    // The closing fence belongs to the block, so toggle only after testing.
    if (isFence) inFence = !inFence;
    if (n < firstVisible) continue;
    // Keep code-like lines LTR; prose containing Arabic gets RTL.
    builder.add(line.from, line.from, codeLike || !RTL.test(line.text) ? ltrDirection : lineDirection);
  }
  return builder.finish();
}

export const autoRtl = ViewPlugin.fromClass(
  class {
    decorations;
    constructor(view: EditorView) { this.decorations = decorations(view); }
    update(update: ViewUpdate) {
      // docChanged covers typing (and opening/closing a fence); viewportChanged
      // covers scrolling. Selection-only updates keep existing decorations.
      if (update.docChanged || update.viewportChanged) this.decorations = decorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

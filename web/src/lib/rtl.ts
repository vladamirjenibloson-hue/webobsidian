import { EditorView, ViewPlugin, type ViewUpdate, Decoration } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

// Determine direction per visual source line. Arabic-script lines become RTL;
// English/code-only lines remain LTR. Isolate the direction to each line so
// mixed-language notes and punctuation retain sensible browser bidi behavior.
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const lineDirection = Decoration.line({ attributes: { dir: 'rtl', class: 'cm-line-rtl' } });
const ltrDirection = Decoration.line({ attributes: { dir: 'ltr' } });

function decorations(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of view.visibleRanges) {
    let line = view.state.doc.lineAt(range.from);
    while (line.from <= range.to) {
      // Keep code-like lines LTR; prose containing Arabic gets RTL.
      const text = line.text;
      const codeLike = /^\s*(```|~~~)/.test(text) || /^\s{4,}\S/.test(text);
      const dir = !codeLike && RTL.test(text) ? lineDirection : ltrDirection;
      builder.add(line.from, line.from, dir);
      if (line.to >= range.to || line.number === view.state.doc.lines) break;
      line = view.state.doc.line(line.number + 1);
    }
  }
  return builder.finish();
}

export const autoRtl = ViewPlugin.fromClass(
  class {
    decorations;
    constructor(view: EditorView) { this.decorations = decorations(view); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = decorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

import type { Root, Element, Text, RootContent } from 'hast';

/**
 * Text direction for the server-rendered public share page.
 *
 * Keep in sync with web/src/lib/textDirection.ts — the share page cannot import
 * from web/src (separate tsconfig root), and the two must agree or a note reads
 * one way in the app and the other way when shared.
 *
 * Rule: the Unicode bidi algorithm's P2/P3 — the first strong directional
 * character of a block decides its direction, defaulting to LTR. Obsidian 1.6+
 * applies the same rule to the editor (per line) and reading view (per block).
 * Only block-level elements get `dir`; setting it inline would reorder the runs
 * inside a mixed Arabic/English sentence.
 */

/** RTL (bidi class R/AL) strong ranges, including the historic planes. */
const RTL_STRONG =
  /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
/** Only letters are "strong"; digits, spaces and punctuation are not. */
const STRONG = /\p{L}/u;

export type TextDirection = 'rtl' | 'ltr';

/** Unicode P2/P3 over the block's text: first strong character wins. */
export function textDirection(text: string): TextDirection {
  for (const ch of text) {
    if (!STRONG.test(ch)) continue;
    return RTL_STRONG.test(ch) ? 'rtl' : 'ltr';
  }
  return 'ltr';
}

const BLOCK_DIR_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'td', 'th',
  'dd', 'dt', 'figcaption', 'caption', 'summary',
]);

/** Text of a block, ignoring code and math: they never vote on direction. */
function textContent(node: Root | RootContent): string {
  if (node.type === 'text') return (node as Text).value;
  let out = '';
  const children = (node as Element).children ?? [];
  for (const child of children) {
    if (child.type === 'element' && (child.tagName === 'code' || child.tagName === 'pre')) continue;
    out += textContent(child) + ' ';
  }
  return out;
}

/**
 * rehype plugin: set `dir` on every block element from its own text.
 * Must run AFTER rehype-sanitize, which would otherwise strip the attribute.
 */
export function rehypeTextDirection() {
  return (tree: Root) => {
    const visit = (node: Root | RootContent) => {
      const el = node as Element;
      if (node.type === 'element' && el.tagName && BLOCK_DIR_TAGS.has(el.tagName)) {
        const text = textContent(node);
        if (text.trim()) el.properties = { ...el.properties, dir: textDirection(text) };
      }
      (node as Element).children?.forEach(visit);
    };
    visit(tree);
  };
}

/**
 * Text direction for rendered Markdown (reading view, split preview, and the
 * server-rendered public share pages).
 *
 * Obsidian 1.6+ resolves direction per block with the same rule its editor uses
 * per line: the Unicode bidi algorithm's P2/P3 — the first strong directional
 * character decides, defaulting to LTR when a block has none. Using one rule in
 * both places is what keeps the editor and reading view from disagreeing.
 *
 * Only block-level elements get `dir`. Setting it on an inline span would
 * re-scramble the runs inside a mixed Arabic/English sentence; inline code is
 * left to `unicode-bidi` in CSS instead.
 */

/** RTL (bidi class R/AL) strong ranges: Hebrew, Arabic, Syriac, Thaana, NKo…
 *  plus the historic planes, so Adlam and Phoenician resolve too. */
const RTL_STRONG =
  /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
/** Only letters are "strong"; digits, spaces, punctuation and marks are not. */
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

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** Text of a block, ignoring code and math: they never vote on direction. */
function textContent(node: HastNode): string {
  if (node.type === 'text') return node.value ?? '';
  let out = '';
  for (const child of node.children ?? []) {
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
  return (tree: HastNode) => {
    const visit = (node: HastNode) => {
      if (node.type === 'element' && node.tagName && BLOCK_DIR_TAGS.has(node.tagName)) {
        const text = textContent(node);
        if (text.trim()) node.properties = { ...node.properties, dir: textDirection(text) };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

/**
 * Cursor Scrolling + editor font size (ports of two Obsidian community
 * plugins, done natively instead of through the plugin shim).
 *
 * Cursor Scrolling — from `coignard/obsidian-scroller`, `onWheel`:
 * the wheel normally scrolls the viewport; here it walks the CARET up/down a
 * line per `sensitivity` px of deltaY, and the view follows the caret. The
 * plugin reached the CM6 view through Obsidian's `editor.cm` backdoor (and
 * `require`d @codemirror/commands, which our shim refuses) — we already own the
 * EditorView, so this is just an extension.
 *
 * Font Slider — from `ztrawhcs/obsidian-font-slider`, which only sets a CSS
 * custom property. `--font-text-size` is the token `.cm-content` already reads,
 * and headings are `em`-relative, so they scale with it for free.
 */
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { cursorLineDown, cursorLineUp } from '@codemirror/commands';

/** px of wheel delta per line, matching the plugin's default. */
export const CURSOR_SCROLL_SENSITIVITY = 20;

/**
 * True while cursor scrolling is switched on. Seeded synchronously from
 * localStorage so the very first wheel event after a reload already behaves
 * correctly — the server copy arrives with an async GET /api/settings, and
 * without this the first ~200ms of scrolling would scroll the viewport instead
 * of the caret.
 */
const CURSOR_SCROLL_KEY = 'webobsidian:cursor-scroll';
let cursorScrollEnabled = localStorage.getItem(CURSOR_SCROLL_KEY) === '1';
export function setCursorScrollEnabled(on: boolean) {
  cursorScrollEnabled = on;
  localStorage.setItem(CURSOR_SCROLL_KEY, on ? '1' : '0');
}
export function isCursorScrollEnabled() {
  return cursorScrollEnabled;
}

/**
 * Wheel handler shared by every editor view. Accumulates deltaY so a trackpad's
 * many small deltas still move exactly one line per `sensitivity` px, which is
 * what the original plugin does.
 */
function makeWheelHandler() {
  let acc = 0;
  return (event: WheelEvent, view: EditorView): boolean => {
    if (!cursorScrollEnabled) return false; // fall through to normal scrolling
    // Reading mode has no caret to walk.
    const state: any = view.state;
    if (state.readOnly) return false;
    // Vertical wheel only — let horizontal/shift-scroll behave normally.
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return false;
    // Ctrl/⌘+wheel is browser zoom; don't hijack it.
    if (event.ctrlKey || event.metaKey) return false;

    event.preventDefault();

    // deltaMode 1 = lines, 2 = pages. Normalise to px-ish units so sensitivity
    // means the same thing on every device.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    acc += event.deltaY * unit;

    const steps = Math.trunc(acc / CURSOR_SCROLL_SENSITIVITY);
    if (steps !== 0) {
      const command = steps > 0 ? cursorLineDown : cursorLineUp;
      for (let i = 0; i < Math.abs(steps); i++) command(view);
      acc %= CURSOR_SCROLL_SENSITIVITY;
      // Keep the caret comfortably in view as it walks — the plugin's
      // typewriter follow, without the smooth-scroll animation.
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'nearest' }) });
    }
    return true;
  };
}

const wheelHandler = makeWheelHandler();

/** CM6 extension: cursor scrolling on wheel. Inert unless enabled. */
export const cursorScroll = EditorView.domEventHandlers({
  wheel: (event, view) => wheelHandler(event, view),
});

/**
 * Also capture wheel on the scroller element: CM6's own scroll handling lives
 * there, and the plugin did the same (`view.scrollDOM.addEventListener`). Kept
 * as a ViewPlugin so it attaches/detaches with the view and only fires when the
 * pointer is over this editor (split view has two).
 */
export const cursorScrollWheelPlugin = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.view.scrollDOM.addEventListener('wheel', this.onWheel, { passive: false });
    }
    onWheel = (e: WheelEvent) => {
      // domEventHandlers may have already handled it.
      if (e.defaultPrevented) return;
      wheelHandler(e, this.view);
    };
    update(_u: ViewUpdate) {}
    destroy() {
      this.view.scrollDOM.removeEventListener('wheel', this.onWheel);
    }
  },
);

/* ---- Editor font size ---------------------------------------------------- */

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 32;
export const FONT_SIZE_DEFAULT = 16;
const FONT_SIZE_KEY = 'webobsidian:font-text-size';

export function clampFontSize(n: number): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return FONT_SIZE_DEFAULT;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, v));
}

/**
 * Apply the note font size. Only `--font-text-size` is touched: `.cm-content`
 * uses it directly and the `--h1-size … --h6-size` tokens are `em`-relative, so
 * headings and inline widgets (checkboxes size off the same token) follow.
 */
export function applyFontSize(n: number): number {
  const size = clampFontSize(n);
  document.documentElement.style.setProperty('--font-text-size', `${size}px`);
  return size;
}

/**
 * The font size currently in effect, read back from the CSS variable — same
 * reason as currentLineWidth(): the server's value is applied before the status
 * bar control mounts, and localStorage can be stale or empty.
 */
export function currentFontSize(): number {
  const applied = document.documentElement.style.getPropertyValue('--font-text-size').trim();
  const match = /^(\d+(?:\.\d+)?)px$/.exec(applied);
  return match ? clampFontSize(Number(match[1])) : readStoredFontSize();
}

export function readStoredFontSize(): number {
  const raw = localStorage.getItem(FONT_SIZE_KEY);
  return raw ? clampFontSize(Number(raw)) : FONT_SIZE_DEFAULT;
}

export function storeFontSize(n: number) {
  localStorage.setItem(FONT_SIZE_KEY, String(clampFontSize(n)));
}

/* ---- Text column width --------------------------------------------------- */

/**
 * How wide the note's text column is, in `ch` (the width of a "0" in the note's
 * own font). A `ch` measure keeps characters-per-line constant as the font size
 * changes, which is what Obsidian does — a px cap instead makes the column look
 * progressively narrower as the text grows.
 *
 * 45ch is a very narrow measure for a phone, 90ch is the stylesheet default and
 * about the widest that still reads comfortably; past that the eye has trouble
 * finding the start of the next line.
 */
export const WIDTH_MIN = 45;
export const WIDTH_MAX = 200;
export const WIDTH_DEFAULT = 90;
const WIDTH_KEY = 'webobsidian:line-width';

export function clampWidth(n: number): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return WIDTH_DEFAULT;
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, v));
}

/** Set `--file-line-width`; the `--file-line-width-max` px ceiling still applies. */
export function applyLineWidth(ch: number): number {
  const width = clampWidth(ch);
  document.documentElement.style.setProperty('--file-line-width', `${width}ch`);
  return width;
}

/**
 * The width currently in effect, read back from the CSS variable. App.tsx
 * applies the server's value before the control mounts, and localStorage may be
 * stale (another browser changed it), so the DOM is the source of truth.
 */
export function currentLineWidth(): number {
  const applied = document.documentElement.style.getPropertyValue('--file-line-width').trim();
  const match = /^(\d+(?:\.\d+)?)ch$/.exec(applied);
  return match ? clampWidth(Number(match[1])) : readStoredLineWidth();
}

export function readStoredLineWidth(): number {
  const raw = localStorage.getItem(WIDTH_KEY);
  return raw ? clampWidth(Number(raw)) : WIDTH_DEFAULT;
}

export function storeLineWidth(n: number) {
  localStorage.setItem(WIDTH_KEY, String(clampWidth(n)));
}

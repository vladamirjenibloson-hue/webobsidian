# Plugin feasibility: scroller + font-slider

Verdict up front: **Font Slider is realistic. Scroller is not, as a plugin.**

Both were cloned and read line by line. Neither works on the current shim.

---

## Why the current shim can't run either of them

`web/src/lib/plugins.ts` provides `require` with exactly one allowed module:

```ts
const require = (name: string) => {
  if (name === 'obsidian') return obsidianModule;
  throw new Error(`Plugin "${id}" required unsupported module: ${name}`);
};
```

**Scroller's main.js line 2–4:**

```js
const { Plugin, MarkdownView, PluginSettingTab, Setting, ... } = require('obsidian');
const { EditorView, ViewPlugin, Decoration } = require('@codemirror/view');   // throws
const { RangeSet } = require('@codemirror/state');                            // unreachable
const { cursorLineUp, cursorLineDown } = require('@codemirror/commands');     // unreachable
```

So it dies on the second require — before a single feature is registered.

**Font Slider** gets further (only needs `obsidian`) but uses Obsidian's DOM
prototype extensions in `onload`:

```ts
document.body.addClass("font-slider-on");                    // not a DOM method
this.statusItem.addClass("font-slider-status", "mod-clickable");
this.statusItem.setText(...)  /  .setAttribute  /  .isShown()
activeDocument.body.createDiv({ cls: ... })                  // not a DOM method
row.createEl("input", { type: "range", attr: {...} })
document.body.setCssProps({ "--font-slider-size": "16px" })
```

The shim polyfills **none** of these (`addClass`, `createDiv`, `createEl`,
`createSpan`, `setText`, `setCssProps`, `isShown`, `empty`) — grep confirms.
`onload` throws on the first line, so the plugin never registers anything.

Even with those polyfilled it would still render nothing useful:

| what Font Slider needs | present in WebObsidian? |
|---|---|
| `addStatusBarItem()` actually attached to the status bar | no — returns a detached `<div>` |
| `addRibbonIcon()` attached to a ribbon | no — detached `<div>` |
| `.status-bar-item` class hit by its CSS | no — `StatusBar.tsx` uses bare `<span>` |
| `.markdown-preview-view` / `.markdown-source-view` for the font size rule | only `.markdown-source-view` (Editor.tsx:353) |
| `--font-text-size` token | not the one in use |

---

## Scroller specifically

It is not really a plugin — it is a **CM6 extension set** wearing a plugin
wrapper. It registers `EditorView.updateListener`, `ViewPlugin`, `StateField`
decorations, `Prec.highest` keymaps, and reads the live editor via

```js
const editorView = editor.cm;   // Obsidian's Editor -> CM6 EditorView
```

WebObsidian keeps `EditorView` instances in React refs (`Editor.tsx`, ~line 250)
and never exposes them. The plugin also touches Obsidian internals that don't
exist here: `this.app.vault.config`, `this.app.internalPlugins.plugins`.

The *behaviour* is worth having though: typewriter scrolling, focus/paragraph
dimming, smooth scroll, scroll-to-top/bottom, hide scrollbars. The clean way is
to port ~40 lines of CSS/JS into the app itself, not to run 1068 lines of
plugin against a fake API.

---

## Recommendation

**Tier 1 — harden the shim (helps every plugin you bring later)**
- Polyfill the DOM helpers: `addClass/removeClass/toggleClass`, `createDiv`,
  `createEl`, `createSpan`, `setText`, `setCssProps`, `empty`, `isShown`.
- Make `require` resolve `@codemirror/*` from the app's own bundle (they are
  already installed — `Editor.tsx` imports `@codemirror/view` directly).
- Attach `addStatusBarItem` into the real `.status-bar` and `addRibbonIcon`
  into the left rail; give both the Obsidian class names plugins style against.
- Persist `loadData`/`saveData` per plugin (currently `{}` / no-op).
- Register `addCommand` into the existing Command Palette.

**Tier 1b — Font Slider**
After the above it should work almost as-is, though the cleanest result is to
add a font-size control to Settings > Appearance (a slider bound to
`--font-size`, matching whatever token `obsidian.css` actually uses) and skip
the plugin entirely. Same UX, ~30 lines, no shim risk.

**Tier 2 — Scroller**
Needs per-editor plumbing (`EditorView` registry + lifecycle) *and* a real
postprocessor/decorator bridge. Estimate 1–2 days. Porting its four behaviours
natively is less work and less fragile than that.

---

## Decision needed

1. Harden the shim + install both as plugins? (Scroller will throw; Font Slider
   will need the Font Slider-specific work anyway.)
2. Harden the shim, install Font Slider as a plugin, and **port Scroller's
   behaviours natively** into the app? ← recommended
3. Both natively, no plugin route at all?

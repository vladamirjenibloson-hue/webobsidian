import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import {
  applyFontSize,
  clampFontSize,
  readStoredFontSize,
  storeFontSize,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_DEFAULT,
} from '../lib/readingComfort';

/**
 * Status-bar font size control (like ztrawhcs/obsidian-font-slider).
 *
 * The slider lives in Settings > Appearance, but a size tweak is something you
 * do mid-read, so it also gets a one-click control in the status bar: click the
 * "Aa Npx" item for a popover with a slider, −/+, Reset, and the keyboard
 * shortcuts. Ctrl/Cmd + scroll over the popover resizes too, matching the
 * plugin's wheel behaviour.
 *
 * Applies live; writes are debounced because dragging fires many events.
 */
export default function FontSizeControl() {
  const [size, setSize] = useState<number>(() =>
    clampFontSize(Number(localStorage.getItem('webobsidian:font-text-size')) || readStoredFontSize()),
  );
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  const persist = useCallback((n: number) => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void api.putSettings({ ui: { fontSize: n } }), 400);
  }, []);

  const set = useCallback(
    (n: number) => {
      const next = applyFontSize(n);
      setSize(next);
      storeFontSize(next);
      persist(next);
      // Let Settings' slider follow along if it's open (and vice versa).
      window.dispatchEvent(new Event('webobsidian:font-size'));
      return next;
    },
    [persist],
  );

  /** Reset goes back to the stylesheet default, not to a magic number. */
  const reset = () => set(FONT_SIZE_DEFAULT);

  // Close on outside click and Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Ctrl/Cmd + wheel over the popover adjusts the size, like the plugin.
  useEffect(() => {
    const el = wrap.current;
    if (!el || !open) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      set(size + (e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open, size, set]);

  // Keep the label in sync when the size is changed somewhere else (the
  // Settings slider, or another tab). Note this component also fires this event
  // itself — setSize() to the value it just rendered is a no-op re-render.
  useEffect(() => {
    const onSync = () => setSize(readStoredFontSize());
    window.addEventListener('storage', onSync);
    window.addEventListener('webobsidian:font-size', onSync as EventListener);
    return () => {
      window.removeEventListener('storage', onSync);
      window.removeEventListener('webobsidian:font-size', onSync as EventListener);
    };
  }, []);

  return (
    <div className="font-size-ctl" ref={wrap}>
      <span
        className="clickable"
        title="Note font size"
        aria-label="Note font size"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-size-a">Aa</span>
        {size}px
      </span>
      {open && (
        <div className="font-size-popover" role="dialog" aria-label="Note font size">
          <div className="font-size-row">
            <button className="font-size-step" onClick={() => set(size - 1)} aria-label="Decrease font size">
              −
            </button>
            <span className="font-size-small">A</span>
            <input
              type="range"
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step={1}
              value={size}
              aria-label="Note font size"
              onChange={(e) => set(Number(e.target.value))}
            />
            <span className="font-size-big">A</span>
            <button className="font-size-step" onClick={() => set(size + 1)} aria-label="Increase font size">
              +
            </button>
          </div>
          <div className="font-size-foot">
            <span className="font-size-value">{size}px</span>
            <button className="text-button" onClick={reset}>
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

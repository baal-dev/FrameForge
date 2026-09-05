// Pinned Prime sets, shared across the app (and the popped-out Modular Window) via
// localStorage. Writes fire a same-window event; the browser's own "storage" event
// covers other windows, so every view stays in sync live.

const KEY = "ff-pinned-sets";
const TARGET_KEY = "ff-pin-targets";
const EVT = "ff-pins-changed";

export function loadPins(): string[] {
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : []; }
  catch { return []; }
}

/** Per-set farm target (how many full sets you want); defaults to 1. */
export function loadTargets(): Record<string, number> {
  try { const s = localStorage.getItem(TARGET_KEY); return s ? JSON.parse(s) : {}; }
  catch { return {}; }
}

export function setTarget(name: string, n: number): void {
  const t = loadTargets();
  if (n > 1) t[name] = n; else delete t[name]; // 1 is the default, don't store it
  try { localStorage.setItem(TARGET_KEY, JSON.stringify(t)); } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(EVT)); } catch { /* ignore */ }
}

export function savePins(list: string[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(EVT)); } catch { /* ignore */ }
}

export function togglePin(name: string): void {
  const p = loadPins();
  savePins(p.includes(name) ? p.filter(x => x !== name) : [...p, name]);
}

/** Subscribe to pin changes (same window + other windows). Returns an unsubscribe fn. */
export function onPinsChanged(cb: () => void): () => void {
  const h = () => cb();
  window.addEventListener(EVT, h);
  window.addEventListener("storage", h);
  return () => { window.removeEventListener(EVT, h); window.removeEventListener("storage", h); };
}

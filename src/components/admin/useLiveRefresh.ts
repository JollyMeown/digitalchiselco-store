// Shared "keep it live" hook for every admin tab.
//
// Calls `reload()` (a) every `everyMs` while the admin is actually watching
// and (b) the moment the window regains focus / the tab becomes visible again
// so a number never sits stale while the admin watches it (the owner's shopper
// actions test), and there's never a "did I forget to reload?" question.
//
// Safety: refreshes are SILENT (callers pass a flag to skip loading
// spinners) and are PAUSED while the admin is typing  any focused
// input/textarea/select or contenteditable, or an open modal
// ([data-modal-open])  so a background reload can never wipe a half-edited
// form. The paused refresh runs as soon as they click away.
//
// Cost control (2026-09-21): the database fell over at 98% CPU on 240,862 data
// API calls in 24 hours. A single admin tab left open on a second monitor was
// firing eight of these timers all day, forever. So a poll now also needs the
// admin to have touched the page in the last IDLE_MS; after that the tab goes
// quiet and wakes up on the first move, key, click, scroll or focus. Timers
// also start at a random offset so they don't all fire in the same second.
import { useEffect, useRef } from 'react';

/** No mouse, key, touch or scroll for this long and the page stops polling. */
const IDLE_MS = 4 * 60000;

let lastActivity = Date.now();
let wired = false;
/** Callbacks that want to know the admin came back. */
const wakers = new Set<() => void>();

function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  const touch = () => {
    const wasIdle = Date.now() - lastActivity > IDLE_MS;
    lastActivity = Date.now();
    if (wasIdle) wakers.forEach((w) => { try { w(); } catch { /* never surface */ } });
  };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove', 'scroll']) {
    window.addEventListener(ev, touch, { passive: true });
  }
}

/** True while the admin is present and looking at this tab. */
export function watching(): boolean {
  return document.visibilityState === 'visible' && Date.now() - lastActivity <= IDLE_MS;
}

export function useLiveRefresh(reload: () => void | Promise<void>, everyMs = 30000, deps: any[] = []) {
  const busy = useRef(false);
  useEffect(() => {
    wire();
    const editing = () => {
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return true;
      return !!document.querySelector('[data-modal-open="true"], [role="dialog"]');
    };
    const run = async () => {
      if (busy.current || !watching() || editing()) return;
      busy.current = true;
      try { await reload(); } catch { /* never surface */ } finally { busy.current = false; }
    };
    // spread the timers out so eight panels don't all hit the API on the same tick
    let t: any = 0;
    const start = setTimeout(() => { t = setInterval(run, everyMs); }, Math.random() * Math.min(everyMs, 5000));
    const onFocus = () => { lastActivity = Date.now(); run(); };
    const onVis = () => { if (document.visibilityState === 'visible') { lastActivity = Date.now(); run(); } };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    wakers.add(run);
    return () => {
      clearTimeout(start); clearInterval(t); wakers.delete(run);
      window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

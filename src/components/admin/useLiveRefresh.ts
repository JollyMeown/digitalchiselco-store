// Shared "keep it live" hook for every admin tab.
//
// Calls `reload()` (a) every `everyMs` while the tab is visible and (b) the
// moment the window regains focus / the tab becomes visible again — so a
// number never sits stale while the admin watches it (the owner's shopper
// actions test), and there's never a "did I forget to reload?" question.
//
// Safety: refreshes are SILENT (callers pass a flag to skip loading
// spinners) and are PAUSED while the admin is typing — any focused
// input/textarea/select or contenteditable, or an open modal
// ([data-modal-open]) — so a background reload can never wipe a half-edited
// form. The paused refresh runs as soon as they click away.
import { useEffect, useRef } from 'react';

export function useLiveRefresh(reload: () => void | Promise<void>, everyMs = 30000, deps: any[] = []) {
  const busy = useRef(false);
  useEffect(() => {
    const editing = () => {
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return true;
      return !!document.querySelector('[data-modal-open="true"], [role="dialog"]');
    };
    const run = async () => {
      if (busy.current || document.visibilityState !== 'visible' || editing()) return;
      busy.current = true;
      try { await reload(); } catch { /* never surface */ } finally { busy.current = false; }
    };
    const t = setInterval(run, everyMs);
    const onFocus = () => run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

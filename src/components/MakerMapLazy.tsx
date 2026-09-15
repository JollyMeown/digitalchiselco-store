// The homepage's maker map, loaded only when it scrolls into view.
//
// client:only stopped the map being rendered on the server (248 KB of SVG in
// every homepage), but it still downloaded the map code and the 185 KB world
// atlas the moment the page loaded, for a decorative panel below the fold.
// This wrapper is what the island hydrates; the real map is fetched with a
// dynamic import at that moment and not before. Mounted with client:visible,
// so "that moment" is when the visitor scrolls to it.
import { lazy, Suspense, useEffect, useState } from 'react';

const MakerMap = lazy(() => import('./MakerMap'));

export default function MakerMapLazy(props: { compact?: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);   // only ever true in the browser, after hydration
  return (
    <div style={{ minHeight: 300 }}>
      {ready && (
        <Suspense fallback={<div style={{ minHeight: 300 }} aria-hidden="true" />}>
          <MakerMap {...props} />
        </Suspense>
      )}
    </div>
  );
}

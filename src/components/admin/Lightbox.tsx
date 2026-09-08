// Full-size image viewer for the admin. Built for judging how a picture
// actually converted: it reports the real pixel dimensions and the transferred
// file size, offers 1:1 (100%) as well as fit-to-screen, and steps through a
// gallery with the arrow keys so a set can be compared quickly.
import { useEffect, useState, useCallback } from 'react';

export type LightboxProps = {
  images: string[];
  index: number;
  onClose: () => void;
  onIndex?: (i: number) => void;
  caption?: (i: number) => string | null;
};

const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${Math.round(n / 1024)} KB`);

export default function Lightbox({ images, index, onClose, onIndex, caption }: LightboxProps) {
  const [i, setI] = useState(index);
  const [full, setFull] = useState(false);            // false = fit to screen, true = 1:1 pixels
  const [meta, setMeta] = useState<{ w: number; h: number; bytes: number | null } | null>(null);
  const url = images[i];

  const go = useCallback((next: number) => {
    const n = (next + images.length) % images.length;
    setI(n); setFull(false); setMeta(null); onIndex?.(n);
  }, [images.length, onIndex]);

  useEffect(() => { setI(index); }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(i + 1);
      else if (e.key === 'ArrowLeft') go(i - 1);
      else if (e.key === ' ') { e.preventDefault(); setFull((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [i, go, onClose]);

  // transferred size, so a picture that converted badly (10 MB PNG) is obvious
  useEffect(() => {
    let alive = true;
    setMeta(null);
    if (!url) return;
    fetch(url, { method: 'HEAD' })
      .then((r) => { const len = Number(r.headers.get('content-length')); if (alive && len) setMeta((m) => ({ w: m?.w || 0, h: m?.h || 0, bytes: len })); })
      .catch(() => { /* CORS or no HEAD: dimensions still work */ });
    return () => { alive = false; };
  }, [url]);

  if (!url) return null;
  const cap = caption?.(i) || null;

  return (
    <div className="fixed inset-0 z-[80] bg-black/85 backdrop-blur-sm flex flex-col" onClick={onClose}>
      {/* top bar */}
      <div className="flex items-center gap-3 px-4 py-2 text-cream text-xs bg-black/40 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        <span className="font-medium">{i + 1} / {images.length}</span>
        {meta?.w ? <span className="text-cream/70">{meta.w} x {meta.h}px</span> : <span className="text-cream/40">reading size…</span>}
        {meta?.bytes ? <span className="text-cream/70">{fmtBytes(meta.bytes)}</span> : null}
        {meta?.w ? <span className="text-cream/50">{meta.w === meta.h ? 'square' : `${(meta.w / meta.h).toFixed(2)}:1`}</span> : null}
        {cap && <span className="text-cream/60 truncate max-w-[38%]">{cap}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button className="px-2 py-1 rounded border border-cream/30 hover:bg-cream/10" onClick={() => setFull((v) => !v)}>
            {full ? 'Fit to screen' : 'Actual size 1:1'}
          </button>
          <a href={url} target="_blank" rel="noreferrer" className="px-2 py-1 rounded border border-cream/30 hover:bg-cream/10" onClick={(e) => e.stopPropagation()}>Open original ↗</a>
          <button className="px-2 py-1 rounded border border-cream/30 hover:bg-cream/10" onClick={onClose}>Close ✕</button>
        </div>
      </div>

      {/* image */}
      <div className={`flex-1 min-h-0 flex items-center justify-center p-4 ${full ? 'overflow-auto' : 'overflow-hidden'}`} onClick={(e) => e.stopPropagation()}>
        <img
          src={url}
          alt=""
          onLoad={(e) => { const el = e.currentTarget; setMeta((m) => ({ w: el.naturalWidth, h: el.naturalHeight, bytes: m?.bytes ?? null })); }}
          className={full ? 'max-w-none' : 'max-w-full max-h-full object-contain'}
          style={{ imageRendering: full ? 'pixelated' : 'auto' }}
        />
      </div>

      {/* thumbnails */}
      {images.length > 1 && (
        <div className="flex gap-1.5 px-4 py-2 overflow-x-auto bg-black/40 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {images.map((u, n) => (
            <button key={u + n} onClick={() => go(n)}
              className={`w-12 h-12 rounded overflow-hidden flex-shrink-0 border-2 transition ${n === i ? 'border-bronze-400' : 'border-transparent opacity-60 hover:opacity-100'}`}>
              <img src={u} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="text-center text-cream/40 text-[11px] pb-2 flex-shrink-0">arrow keys to move · space for 1:1 · Esc to close</div>
    </div>
  );
}

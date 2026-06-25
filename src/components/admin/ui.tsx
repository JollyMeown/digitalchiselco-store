// Small shared UI primitives for the admin dashboard. Tailwind classes (Base loads global.css).
import { useEffect } from 'react';

export const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

export const inputCls =
  'w-full px-3 py-2 text-sm border border-black/15 rounded-md focus:outline-none focus:border-bronze-600 bg-white';
export const labelCls = 'block text-xs font-medium text-ink-800 mb-1';
export const btnPrimary =
  'inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-bronze-600 text-cream rounded-md hover:bg-bronze-700 transition disabled:opacity-50 disabled:cursor-not-allowed';
export const btnGhost =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-black/15 rounded-md hover:bg-cream transition';
export const btnDanger =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-red-300 text-red-600 rounded-md hover:bg-red-50 transition';

export function Card({ title, action, children }: any) {
  return (
    <div className="bg-white border border-black/10 rounded-lg p-5">
      {(title || action) && (
        <div className="flex justify-between items-center mb-4">
          {title && <h3 className="font-medium text-ink-800">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide = false }: any) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={cls('bg-white rounded-lg shadow-xl w-full overflow-hidden flex flex-col max-h-[92vh]', wide ? 'max-w-4xl' : 'max-w-lg')}
      >
        <div className="flex justify-between items-center px-5 py-3 border-b border-black/10">
          <h3 className="font-medium text-ink-800">{title}</h3>
          <button onClick={onClose} className="text-ink-700/60 hover:text-ink-800 text-xl leading-none">×</button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function Toast({ message, kind = 'info' }: { message: string; kind?: 'info' | 'success' | 'error' }) {
  if (!message) return null;
  const color = kind === 'success' ? 'text-green-700' : kind === 'error' ? 'text-red-600' : 'text-ink-700';
  return <span className={cls('text-xs', color)}>{message}</span>;
}

export function StatBox({ label, value, sub }: any) {
  return (
    <div className="bg-white border border-black/10 rounded-lg p-4">
      <div className="text-xs uppercase tracking-wide text-ink-700/60">{label}</div>
      <div className="text-2xl font-medium text-ink-800 mt-1">{value}</div>
      {sub && <div className="text-xs text-ink-700/60 mt-1">{sub}</div>}
    </div>
  );
}

export const linkColor: Record<string, string> = {
  certain: 'bg-green-500', verified: 'bg-green-500',
  likely: 'bg-yellow-500',
  review: 'bg-red-500', bundle_manual: 'bg-red-500', broken: 'bg-red-500',
};

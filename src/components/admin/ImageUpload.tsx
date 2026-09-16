import { useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { btnGhost, inputCls } from './ui';

interface Props {
  value?: string | null;
  onChange: (url: string) => void;
  folder?: string;          // subfolder inside the bucket (e.g. 'hero', 'categories')
}

const BUCKET = 'site-media';

// Resize BEFORE upload (owner, 2026-09-15: "whenever we upload any picture the
// resizer must take action first"). This uploader was storing whatever was
// picked, and that is exactly where the two 3 MB PNGs on the catalog page came
// from: a screenshot-sized original that then served into a 400px tile for
// every visitor. Nothing bigger than MAX px on its long side leaves the browser,
// and photos become JPEG. A small PNG is kept as PNG so a logo keeps its
// transparency; a large one is a photo wearing the wrong extension.
const MAX = 2000;
export async function shrink(f: File): Promise<File> {
  if (!/^image\//.test(f.type) || f.type === 'image/svg+xml' || f.type === 'image/gif') return f;
  const keepPng = f.type === 'image/png' && f.size <= 400 * 1024;
  try {
    const bmp = await createImageBitmap(f);
    const s = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    if (s === 1 && (keepPng || (f.type === 'image/jpeg' && f.size <= 600 * 1024))) { bmp.close(); return f; }   // already small enough
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const type = keepPng ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, type, 0.85));
    if (!blob) return f;
    return new File([blob], f.name.replace(/\.[^.]+$/, '') + (keepPng ? '.png' : '.jpg'), { type });
  } catch { return f; }   // a format this browser cannot decode goes up as-is
}

export default function ImageUpload({ value, onChange, folder = 'general' }: Props) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  async function upload(picked: File) {
    setBusy(true); setErr(''); setNote('');
    try {
      const f = await shrink(picked);
      if (f !== picked) setNote(`resized ${(picked.size / 1048576).toFixed(1)} MB → ${(f.size / 1024).toFixed(0)} KB`);
      const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, f, { upsert: false, contentType: f.type });
      if (error) throw error;
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      onChange(data.publicUrl);
    } catch (e: any) {
      setErr(e.message || 'Upload failed');
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="flex gap-3 items-start">
        <div className="w-24 h-24 bg-cream rounded-md overflow-hidden flex-shrink-0 border border-black/10">
          {value ? <img src={value} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xs text-ink-700/40">No image</div>}
        </div>
        <div className="flex-1 space-y-2">
          <input
            ref={file} type="file" accept="image/*"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
            className="text-xs"
          />
          <input
            placeholder="…or paste an image URL"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            className={inputCls}
          />
          {busy && <span className="text-xs text-ink-700/60">Uploading…</span>}
          {note && <span className="text-xs text-green-700">{note}</span>}
          {err && <span className="text-xs text-red-600">{err}</span>}
          {value && <button className={btnGhost} onClick={() => onChange('')}>Remove</button>}
        </div>
      </div>
    </div>
  );
}

import { useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { btnGhost, inputCls } from './ui';

interface Props {
  value?: string | null;
  onChange: (url: string) => void;
  folder?: string;          // subfolder inside the bucket (e.g. 'hero', 'categories')
}

const BUCKET = 'site-media';

export default function ImageUpload({ value, onChange, folder = 'general' }: Props) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function upload(f: File) {
    setBusy(true); setErr('');
    try {
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
          {err && <span className="text-xs text-red-600">{err}</span>}
          {value && <button className={btnGhost} onClick={() => onChange('')}>Remove</button>}
        </div>
      </div>
    </div>
  );
}

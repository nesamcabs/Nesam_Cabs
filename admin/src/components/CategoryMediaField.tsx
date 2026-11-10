import { useEffect, useId, useState } from 'react';
import { categoryMediaProblem, compressCategoryImage, formatBytes } from '../services/categoryMedia';

export default function CategoryMediaField({ label, kind, plateText, value, file, disabled, onChange }: {
  label: string;
  /** Decides how small the image is made: icons are tiny, car images a little larger. */
  kind: 'icon' | 'car';
  /** Car images: the category name that is written on the yellow number plate. */
  plateText?: string;
  value: string;
  file: File | null;
  disabled: boolean;
  onChange: (file: File | null, clear?: boolean) => void;
}) {
  const id = useId();
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [compressing, setCompressing] = useState(false);
  // The picked file as chosen. Every compression starts from this, so changing the name re-writes the plate cleanly
  // (never on top of an earlier compressed copy).
  const [original, setOriginal] = useState<File | null>(null);
  const plate = kind === 'car' ? (plateText ?? '').trim() : '';

  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Upload → (write the name on the number plate) → compress → store. Runs when a file is picked and again if the name changes.
  useEffect(() => {
    if (!original) return;
    let stale = false;
    const timer = window.setTimeout(async () => {
      setCompressing(true);
      try {
        const result = await compressCategoryImage(original, kind, plate || undefined);
        if (stale) return;
        setError('');
        const size = result.bytes < result.originalBytes
          ? `Compressed ${formatBytes(result.originalBytes)} → ${formatBytes(result.bytes)} (${result.width}×${result.height}).`
          : `Already small (${formatBytes(result.bytes)}), kept as is.`;
        const plateNote = result.plate === 'stamped' ? ` Number plate: “${plate.toUpperCase()}” added.`
          : result.plate === 'not-found' ? ' No yellow number plate was found in this image, so the name was not added.' : '';
        setNote(size + plateNote);
        onChange(result.file);
      } catch (err) {
        if (!stale) setError(err instanceof Error ? err.message : 'The image could not be compressed.');
      } finally {
        if (!stale) setCompressing(false);
      }
    }, 350);
    return () => { stale = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original, plate, kind]);

  // A car image that is already saved: write the name on it without uploading the picture again.
  const stampSaved = async () => {
    setError('');
    setNote('');
    setCompressing(true);
    try {
      const res = await fetch(value, { mode: 'cors' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : 'webp';
      setOriginal(new File([blob], `car.${ext}`, { type: blob.type || 'image/webp' }));
    } catch {
      setError('The saved image could not be read by the browser. Choose the car image file again to add the name.');
      setCompressing(false);
    }
  };

  const src = preview || value;
  return <div className="rounded-xl border border-line p-3 space-y-2">
    <label htmlFor={id} className="block text-xs font-bold text-ink">{label}</label>
    <div className="flex h-24 items-center justify-center rounded-lg bg-gray-50 border border-line">
      {compressing ? <span className="text-xs text-muted" role="status">Preparing image…</span>
        : src ? <img src={src} alt={`${label} preview`} className="max-w-full max-h-full object-contain p-2" /> : <span className="text-xs text-muted">No image selected</span>}
    </div>
    <input id={id} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || compressing}
      className="block w-full min-w-0 text-xs file:mr-2 file:rounded-lg file:border file:border-line file:bg-white file:px-2 file:py-1.5 file:font-semibold"
      onChange={e => {
        const chosen = e.target.files?.[0];
        e.target.value = '';
        if (!chosen) return;
        setNote('');
        const problem = categoryMediaProblem(chosen);
        setError(problem);
        if (!problem) setOriginal(chosen);
      }} />
    {kind === 'car' && plate && !file && value && !compressing ? (
      <button type="button" disabled={disabled} onClick={() => void stampSaved()} className="text-xs font-semibold text-blue-700 disabled:opacity-40">
        Write “{plate.toUpperCase()}” on the number plate of this image
      </button>
    ) : null}
    {src && !compressing ? <button type="button" disabled={disabled} onClick={() => { setError(''); setNote(''); setOriginal(null); onChange(null, true); }} className="block text-xs font-semibold text-red-600 disabled:opacity-40">Remove image</button> : null}
    <p className="text-[11px] text-muted">
      PNG, JPG or WebP · up to 25 MB. Compressed automatically{kind === 'car' ? ', and the category name is written on the yellow number plate' : ''}, then published when you save the category.
    </p>
    {note ? <p role="status" className="text-xs text-green-700">{note}</p> : null}
    {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
  </div>;
}

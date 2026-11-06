import { useEffect, useId, useState } from 'react';
import { categoryMediaProblem } from '../services/categoryMedia';

export default function CategoryMediaField({ label, value, file, disabled, onChange }: {
  label: string;
  value: string;
  file: File | null;
  disabled: boolean;
  onChange: (file: File | null, clear?: boolean) => void;
}) {
  const id = useId();
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const src = preview || value;
  return <div className="rounded-xl border border-line p-3 space-y-2">
    <label htmlFor={id} className="block text-xs font-bold text-ink">{label}</label>
    <div className="flex h-24 items-center justify-center rounded-lg bg-gray-50 border border-line">
      {src ? <img src={src} alt={`${label} preview`} className="max-w-full max-h-full object-contain p-2" /> : <span className="text-xs text-muted">No image selected</span>}
    </div>
    <input id={id} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled}
      className="block w-full min-w-0 text-xs file:mr-2 file:rounded-lg file:border file:border-line file:bg-white file:px-2 file:py-1.5 file:font-semibold"
      onChange={e => {
        const chosen = e.target.files?.[0];
        e.target.value = '';
        if (!chosen) return;
        const problem = categoryMediaProblem(chosen);
        setError(problem);
        if (!problem) onChange(chosen);
      }} />
    {src ? <button type="button" disabled={disabled} onClick={() => { setError(''); onChange(null, true); }} className="text-xs font-semibold text-red-600 disabled:opacity-40">Remove image</button> : null}
    <p className="text-[11px] text-muted">PNG, JPG or WebP · up to 5 MB. Published when you save the category.</p>
    {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
  </div>;
}

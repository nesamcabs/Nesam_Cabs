import React, { useRef, useState } from 'react';
import { Camera, CheckCircle2, Loader2, RefreshCw, Upload } from 'lucide-react';
import { uploadDriverImage, describeUploadError } from '../services/storageService';

interface PhotoUploadProps {
  label: string;
  hint?: string;
  value: string;
  folder: string;
  name: string;
  onChange: (url: string) => void;
  /** 'user' opens the front camera on phones, 'environment' the rear one. */
  capture?: 'user' | 'environment';
  required?: boolean;
  compact?: boolean;
  /** Set by the parent when a required photo is missing on submit. */
  showError?: boolean;
}

export const PhotoUpload: React.FC<PhotoUploadProps> = ({
  label,
  hint,
  value,
  folder,
  name,
  onChange,
  capture,
  required,
  compact,
  showError,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      const url = await uploadDriverImage(file, folder, name);
      onChange(url);
    } catch (err) {
      setError(describeUploadError(err));
    } finally {
      setUploading(false);
    }
  };

  const missing = showError && required && !value;

  return (
    <div
      className={`border rounded-xl p-3 bg-gray-50 flex flex-col ${
        missing ? 'border-red-400 bg-red-50/40' : 'border-gray-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <span className="text-xs font-bold text-gray-800 block">
            {label} {required && <span className="text-[#E21E26]">*</span>}
          </span>
          {hint && <span className="text-[10px] text-gray-500 block leading-snug">{hint}</span>}
        </div>
        {value && !uploading && (
          <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-bold flex items-center gap-1 shrink-0">
            <CheckCircle2 className="w-3 h-3" /> Uploaded
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => !uploading && inputRef.current?.click()}
        className={`relative w-full ${compact ? 'h-28' : 'h-36'} rounded-lg overflow-hidden border border-dashed border-gray-300 bg-white flex items-center justify-center hover:border-[#E21E26] transition-colors`}
      >
        {value ? (
          <img src={value} alt={label} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center text-gray-400 gap-1">
            {capture ? <Camera className="w-6 h-6" /> : <Upload className="w-6 h-6" />}
            <span className="text-[11px] font-semibold">Tap to {capture ? 'capture' : 'upload'}</span>
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 bg-white/80 flex flex-col items-center justify-center gap-1">
            <Loader2 className="w-6 h-6 text-[#E21E26] animate-spin" />
            <span className="text-[11px] font-bold text-gray-700">Uploading...</span>
          </div>
        )}
      </button>

      {value && !uploading && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-2 text-[11px] font-bold text-gray-600 hover:text-[#E21E26] flex items-center justify-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Replace photo
        </button>
      )}

      {error && <p className="mt-1.5 text-[11px] text-red-600 font-semibold">{error}</p>}
      {missing && !error && <p className="mt-1.5 text-[11px] text-red-600 font-semibold">This photo is required.</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        {...(capture ? { capture } : {})}
        onChange={handleFile}
        className="hidden"
      />
    </div>
  );
};

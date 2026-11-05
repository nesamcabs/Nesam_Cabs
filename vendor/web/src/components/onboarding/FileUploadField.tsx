import React, { useEffect, useRef, useState } from 'react';
import { FileText, Image as ImageIcon, Loader2, RotateCcw, Trash2, UploadCloud, X } from 'lucide-react';
import type { StoredFile } from '../../types';
import { ACCEPTED_UPLOAD_TYPES, MAX_FILES_PER_FIELD, type UploadCategory } from '../../config/onboarding';
import {
  deleteVendorFile,
  resolveFileUrl,
  uploadVendorFile,
  validateUploadFile,
  type UploadHandle,
} from '../../services/storageService';
import { describeDataError } from '../../utils/retry';

interface PendingUpload {
  id: string;
  file: File;
  progress: number;
  error: string;
  handle: UploadHandle | null;
}

interface FileUploadFieldProps {
  id: string;
  label: string;
  hint?: string;
  category: UploadCategory;
  files: StoredFile[];
  onChange: (updater: (prev: StoredFile[]) => StoredFile[]) => void;
  /** Paths already saved in Firestore — never deleted from Storage on remove,
   *  so the saved application never points at a missing object. */
  persistedPaths: Set<string>;
  onBusyChange?: (busy: boolean) => void;
  error?: string;
  required?: boolean;
  max?: number;
  disabled?: boolean;
}

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export const FileUploadField: React.FC<FileUploadFieldProps> = ({
  id,
  label,
  hint,
  category,
  files,
  onChange,
  persistedPaths,
  onBusyChange,
  error,
  required,
  max = MAX_FILES_PER_FIELD,
  disabled,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [localError, setLocalError] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const busy = pending.some((p) => !p.error);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  // Cancel in-flight uploads if the step unmounts.
  useEffect(() => () => pendingRef.current.forEach((p) => p.handle?.cancel()), []);

  const start = (item: PendingUpload) => {
    const handle = uploadVendorFile(category, item.file, (progress) =>
      setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, progress } : p))),
    );
    setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, handle, error: '', progress: 0 } : p)));
    handle.promise.then(
      (stored) => {
        setPending((prev) => prev.filter((p) => p.id !== item.id));
        onChange((prev) => [...prev, stored]);
      },
      (err) => {
        const code = (err as { code?: string })?.code;
        if (code === 'storage/canceled') {
          setPending((prev) => prev.filter((p) => p.id !== item.id));
          return;
        }
        setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, error: describeDataError(err), handle: null } : p)));
      },
    );
  };

  const handleSelect = (list: FileList | null) => {
    setLocalError('');
    if (!list || list.length === 0) return;
    const room = max - files.length - pending.length;
    const selected = Array.from(list);
    if (selected.length > room) {
      setLocalError(room <= 0 ? `You can upload up to ${max} files here.` : `Only ${room} more file(s) allowed here.`);
    }
    const errors: string[] = [];
    selected.slice(0, Math.max(room, 0)).forEach((file) => {
      const invalid = validateUploadFile(file);
      if (invalid) {
        errors.push(invalid);
        return;
      }
      const item: PendingUpload = { id: `${Date.now()}-${Math.random()}`, file, progress: 0, error: '', handle: null };
      setPending((prev) => [...prev, item]);
      start(item);
    });
    if (errors.length) setLocalError(errors.join(' '));
    if (inputRef.current) inputRef.current.value = '';
  };

  const removeStored = (file: StoredFile) => {
    onChange((prev) => prev.filter((f) => f.path !== file.path));
    // Unsaved uploads are orphans once removed — clean them up (best effort).
    if (!persistedPaths.has(file.path)) deleteVendorFile(file.path).catch(() => undefined);
  };

  const openFile = async (file: StoredFile) => {
    // Open synchronously to avoid popup blockers, then navigate once resolved.
    // ('noopener' would make window.open return null, so detach manually.)
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    setOpening(file.path);
    try {
      const url = await resolveFileUrl(file.path);
      if (win) win.location.href = url;
      else window.open(url, '_blank', 'noopener');
    } catch (err) {
      win?.close();
      setLocalError(describeDataError(err));
    } finally {
      setOpening(null);
    }
  };

  const shownError = localError || error;
  const canAdd = !disabled && files.length + pending.length < max;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label htmlFor={id} className="block text-[12px] font-semibold text-[#444]">
          {label}
          {required && <span className="text-[#E21B23]"> *</span>}
        </label>
        <span className="text-[10px] text-[#999]">
          {files.length}/{max}
        </span>
      </div>

      <button
        type="button"
        disabled={!canAdd}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (canAdd) handleSelect(e.dataTransfer.files);
        }}
        className={`w-full border-2 border-dashed rounded-xl px-4 py-4 flex items-center gap-3 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          shownError ? 'border-[#F5A5A8] bg-[#FFF8F8]' : 'border-[#E5E5E5] bg-[#FAFAFA] hover:border-[#E21B23]/50 hover:bg-[#FEF7F7]'
        }`}
      >
        <UploadCloud className="w-6 h-6 text-[#E21B23] shrink-0" />
        <span>
          <span className="block text-[12px] font-semibold text-[#111]">Click or drop files to upload</span>
          <span className="block text-[11px] text-[#999]">{hint || 'JPG, PNG, WEBP or PDF · max 10 MB each'}</span>
        </span>
      </button>
      <input
        ref={inputRef}
        id={id}
        type="file"
        multiple={max > 1}
        accept={ACCEPTED_UPLOAD_TYPES}
        className="hidden"
        onChange={(e) => handleSelect(e.target.files)}
      />

      {(files.length > 0 || pending.length > 0) && (
        <ul className="mt-2 space-y-1.5">
          {files.map((f) => (
            <li key={f.path} className="flex items-center gap-2.5 px-3 py-2 bg-white border border-[#E5E5E5] rounded-lg">
              {f.contentType === 'application/pdf' ? (
                <FileText className="w-4 h-4 text-[#E21B23] shrink-0" />
              ) : (
                <ImageIcon className="w-4 h-4 text-[#E21B23] shrink-0" />
              )}
              <button
                type="button"
                onClick={() => openFile(f)}
                className="flex-1 min-w-0 text-left text-[12px] font-medium text-[#111] truncate hover:underline"
                title="View file"
              >
                {f.name}
              </button>
              {opening === f.path && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#999]" />}
              <span className="text-[10px] text-[#999] shrink-0">{formatSize(f.size)}</span>
              {!disabled && (
                <button type="button" onClick={() => removeStored(f)} className="p-1 text-[#999] hover:text-[#E21B23]" aria-label={`Remove ${f.name}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.id} className={`px-3 py-2 border rounded-lg ${p.error ? 'bg-[#FFF8F8] border-[#FBD5D5]' : 'bg-white border-[#E5E5E5]'}`}>
              <div className="flex items-center gap-2.5">
                {p.error ? (
                  <X className="w-4 h-4 text-[#E21B23] shrink-0" />
                ) : (
                  <Loader2 className="w-4 h-4 animate-spin text-[#E21B23] shrink-0" />
                )}
                <span className="flex-1 min-w-0 text-[12px] font-medium text-[#111] truncate">{p.file.name}</span>
                {p.error ? (
                  <>
                    <button type="button" onClick={() => start(p)} className="p-1 text-[#E21B23]" aria-label="Retry upload">
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPending((prev) => prev.filter((x) => x.id !== p.id))}
                      className="p-1 text-[#999] hover:text-[#111]"
                      aria-label="Dismiss"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-[10px] font-semibold text-[#666]">{p.progress}%</span>
                    <button type="button" onClick={() => p.handle?.cancel()} className="p-1 text-[#999] hover:text-[#111]" aria-label="Cancel upload">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
              {p.error ? (
                <p className="mt-1 text-[11px] text-[#B4141B]">{p.error}</p>
              ) : (
                <div className="mt-1.5 h-1 rounded-full bg-[#F0F0F0] overflow-hidden">
                  <div className="h-full transition-all" style={{ width: `${p.progress}%`, background: '#E21B23' }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {shownError && (
        <p role="alert" className="mt-1 text-[11px] font-medium text-[#E21B23]">
          {shownError}
        </p>
      )}
    </div>
  );
};

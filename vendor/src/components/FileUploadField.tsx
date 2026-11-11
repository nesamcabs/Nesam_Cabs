// Multi-file upload field (native port of vendor/web
// components/onboarding/FileUploadField.tsx): pick a PDF/image or take a
// photo, upload with progress, cancel, retry, remove. Files already saved in
// Firestore are never deleted from Storage on remove (rules forbid it after
// submission, and the saved record still references them); unsaved uploads
// that are removed are cleaned up best-effort.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { StoredFile } from '../types/vendor';
import { MAX_FILES_PER_FIELD, type UploadCategory } from '../config/onboarding';
import { PickerError, deleteVendorFile, pickDocument, pickPhoto, uploadVendorFile, type LocalFile, type UploadHandle } from '../services/storageService';
import { describeDataError } from '../utils/retry';
import { colors, radius, space, type } from '../theme';

interface Pending {
  key: string;
  file: LocalFile;
  progress: number;
  error: string;
  handle: UploadHandle<StoredFile> | null;
}

const fmtSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

export function chooseFileSource(title: string): Promise<'document' | 'camera' | 'library' | null> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      'Upload a PDF or image, or take a photo.',
      [
        { text: 'Choose file (PDF/image)', onPress: () => resolve('document') },
        { text: 'Take photo', onPress: () => resolve('camera') },
        { text: 'Gallery', onPress: () => resolve('library') },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

export function FileUploadField({
  label,
  hint,
  required,
  category,
  files,
  onChange,
  persistedPaths,
  onBusyChange,
  error,
  max = MAX_FILES_PER_FIELD,
  disabled,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  category: UploadCategory;
  files: StoredFile[];
  onChange: (files: StoredFile[]) => void;
  persistedPaths: Set<string>;
  onBusyChange?: (busy: boolean) => void;
  error?: string;
  max?: number;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [localError, setLocalError] = useState('');
  // Latest values for async callbacks, synced after each commit.
  const filesRef = useRef(files);
  const pendingRef = useRef(pending);
  useEffect(() => {
    filesRef.current = files;
    pendingRef.current = pending;
  });

  const busy = pending.some((p) => !p.error);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  // Leaving the screen cancels uploads still in flight.
  useEffect(() => () => pendingRef.current.forEach((p) => p.handle?.cancel()), []);

  const start = (file: LocalFile, key: string) => {
    const handle = uploadVendorFile(category, file, (pct) => setPending((list) => list.map((p) => (p.key === key ? { ...p, progress: pct } : p))));
    setPending((list) => [...list.filter((p) => p.key !== key), { key, file, progress: 0, error: '', handle }]);
    handle.promise
      .then((stored) => {
        setPending((list) => list.filter((p) => p.key !== key));
        onChange([...filesRef.current, stored]);
      })
      .catch((e: unknown) => {
        const code = (e as { code?: string })?.code;
        if (code === 'storage/canceled') {
          setPending((list) => list.filter((p) => p.key !== key));
          return;
        }
        const msg = e instanceof PickerError ? e.message : describeDataError(e);
        setPending((list) => list.map((p) => (p.key === key ? { ...p, error: msg, handle: null } : p)));
      });
  };

  const add = async () => {
    setLocalError('');
    if (files.length + pending.length >= max) {
      setLocalError(`You can upload up to ${max} files here.`);
      return;
    }
    const source = await chooseFileSource(label);
    if (!source) return;
    try {
      const file = source === 'document' ? await pickDocument() : await pickPhoto(source);
      if (file) start(file, `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    } catch (e) {
      setLocalError(e instanceof PickerError ? e.message : 'Couldn’t open the picker.');
    }
  };

  const removeStored = (f: StoredFile) => {
    onChange(files.filter((x) => x.path !== f.path));
    // Unsaved uploads are orphans once removed — clean them up (best effort).
    if (!persistedPaths.has(f.path)) deleteVendorFile(f.path).catch(() => undefined);
  };

  const canAdd = !disabled && files.length + pending.length < max;
  const shownError = localError || error;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={[type.label, { flex: 1 }]}>
          {label}
          {required ? <Text style={{ color: colors.primary }}> *</Text> : null}
        </Text>
        <Text style={type.tiny}>
          {files.length}/{max}
        </Text>
      </View>
      <Pressable
        onPress={() => void add()}
        disabled={!canAdd}
        style={[styles.drop, !!shownError && { borderColor: colors.primary }, !canAdd && { opacity: 0.5 }]}
        accessibilityRole="button"
        accessibilityLabel={`Add file to ${label}`}
      >
        <Ionicons name="cloud-upload-outline" size={22} color={colors.muted} />
        <View style={{ flex: 1 }}>
          <Text style={styles.dropTitle}>Tap to upload</Text>
          <Text style={type.tiny}>{hint || 'JPG, PNG, WEBP or PDF · max 10 MB each'}</Text>
        </View>
      </Pressable>

      {files.map((f) => (
        <View key={f.path} style={styles.file}>
          <Ionicons name={f.contentType === 'application/pdf' ? 'document-text-outline' : 'image-outline'} size={20} color={colors.success} />
          <View style={{ flex: 1 }}>
            <Text style={styles.fileName} numberOfLines={1}>
              {f.name}
            </Text>
            <Text style={type.tiny}>{fmtSize(f.size)} · uploaded</Text>
          </View>
          {!disabled ? (
            <Pressable onPress={() => removeStored(f)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${f.name}`}>
              <Ionicons name="trash-outline" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
      ))}

      {pending.map((p) => (
        <View key={p.key} style={[styles.file, !!p.error && { borderColor: colors.primaryBorder }]}>
          {p.error ? <Ionicons name="alert-circle" size={20} color={colors.danger} /> : <ActivityIndicator size="small" color={colors.primary} />}
          <View style={{ flex: 1 }}>
            <Text style={styles.fileName} numberOfLines={1}>
              {p.file.name}
            </Text>
            {p.error ? <Text style={styles.err}>{p.error}</Text> : <Text style={type.tiny}>Uploading… {p.progress}%</Text>}
            {!p.error ? (
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${p.progress}%` }]} />
              </View>
            ) : null}
          </View>
          {p.error ? (
            <>
              <Text style={styles.action} onPress={() => start(p.file, p.key)} accessibilityRole="button">
                Retry
              </Text>
              <Text style={styles.action} onPress={() => setPending((list) => list.filter((x) => x.key !== p.key))} accessibilityRole="button">
                Dismiss
              </Text>
            </>
          ) : (
            <Text style={styles.action} onPress={() => p.handle?.cancel()} accessibilityRole="button">
              Cancel
            </Text>
          )}
        </View>
      ))}

      {shownError ? <Text style={styles.err}>{shownError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: space.lg },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  drop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    backgroundColor: colors.bg,
    minHeight: 56,
  },
  dropTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: space.sm,
    marginTop: space.sm,
    backgroundColor: colors.card,
  },
  fileName: { fontSize: 13, fontWeight: '700', color: colors.ink },
  bar: { height: 4, backgroundColor: colors.border, borderRadius: 2, marginTop: 4, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: colors.primary },
  action: { color: colors.primary, fontWeight: '700', fontSize: 12, paddingHorizontal: 4 },
  err: { color: colors.primaryDark, fontSize: 12, marginTop: 4 },
});

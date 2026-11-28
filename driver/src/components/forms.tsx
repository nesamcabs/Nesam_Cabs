// Form controls for KYC / pre-trip / tolls. PhotoField is the native port of
// driver/web/src/components/PhotoUpload.tsx (camera or gallery, preview,
// progress, replace, retry).
import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './nx/Text';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { NxIcon } from './nx/Icon';
import { choosePhotoSource } from './photoSource';
import { describeUploadError, pickImage, uploadDriverImage } from '../services/storageService';
import { colors, radius, space, type } from '../theme';

export function PhotoField({
  label,
  hint,
  value,
  folder,
  name,
  onChange,
  required,
  showError,
  onBusyChange,
  cameraOnly,
  tile,
}: {
  label: string;
  hint?: string;
  value: string;
  folder: string;
  name: string;
  onChange: (url: string) => void;
  required?: boolean;
  showError?: boolean;
  onBusyChange?: (busy: boolean) => void;
  /** Selfies: the live camera only, no gallery. */
  cameraOnly?: boolean;
  /** A small square for a grid of photos (registration): the same capture, upload, replace and retry. */
  tile?: boolean;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const uploading = progress != null;

  const pick = async () => {
    if (uploading) return;
    const source = cameraOnly ? 'camera' : await choosePhotoSource(label);
    if (!source) return;
    setError('');
    try {
      const asset = await pickImage(source);
      if (!asset) return;
      setProgress(0);
      onBusyChange?.(true);
      const url = await uploadDriverImage(asset, folder, name, setProgress);
      onChange(url);
    } catch (e) {
      setError(describeUploadError(e));
    } finally {
      setProgress(null);
      onBusyChange?.(false);
    }
  };

  const missing = showError && required && !value;
  if (tile) {
    const state = uploading ? `Uploading ${progress}%` : value ? 'Tap to replace' : required ? 'Required' : 'Optional';
    return (
      <View style={styles.tileWrap}>
        <Pressable
          onPress={() => void pick()}
          style={[styles.tile, !!value && styles.tileDone, missing && styles.tileMissing]}
          accessibilityRole="button"
          accessibilityLabel={`${value ? 'Replace' : 'Add'} ${label}`}
        >
          <View style={styles.tileMedia}>
            {value ? (
              <Image source={{ uri: value }} style={styles.photoImg} />
            ) : (
              <View style={styles.tileEmpty}>
                <NxIcon name="camera" size={20} color={missing ? colors.primary : colors.faint} />
                <Text style={[styles.tileCta, missing && { color: colors.primary }]}>{cameraOnly ? 'Take photo' : 'Add photo'}</Text>
              </View>
            )}
            {value && !uploading ? (
              <View style={styles.tileCheck}>
                <NxIcon name="check" size={11} color={colors.white} strokeWidth={2.6} />
              </View>
            ) : null}
            {uploading ? (
              <View style={styles.photoOverlay}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null}
          </View>
          <View style={styles.tileFoot}>
            <Text style={styles.tileLabel} numberOfLines={2}>
              {label}
            </Text>
            <Text style={[styles.tileState, !!value && !uploading && { color: colors.success }, missing && { color: colors.primaryDark }]} numberOfLines={1}>
              {state}
            </Text>
          </View>
        </Pressable>
        {error ? (
          <Text style={styles.err} onPress={() => void pick()} accessibilityRole="button">
            {error} Tap to retry.
          </Text>
        ) : null}
      </View>
    );
  }
  return (
    <View style={[styles.photo, missing && styles.photoMissing]}>
      <View style={styles.photoHead}>
        <View style={{ flex: 1 }}>
          <Text style={type.label}>
            {label}
            {required ? <Text style={{ color: colors.primary }}> *</Text> : null}
          </Text>
          {hint ? <Text style={type.tiny}>{hint}</Text> : null}
        </View>
        {value && !uploading ? (
          <View style={styles.okBadge}>
            <NxIcon name="check" size={12} color={colors.success} />
            <Text style={styles.okText}>Uploaded</Text>
          </View>
        ) : null}
      </View>
      <Pressable onPress={() => void pick()} style={styles.photoBox} accessibilityRole="button" accessibilityLabel={`${value ? 'Replace' : 'Add'} ${label}`}>
        {value ? (
          <Image source={{ uri: value }} style={styles.photoImg} />
        ) : (
          <View style={{ alignItems: 'center' }}>
            <NxIcon name="camera" size={26} color={colors.faint} />
            <Text style={type.tiny}>{cameraOnly ? 'Tap to take a photo' : 'Tap to capture or choose'}</Text>
          </View>
        )}
        {uploading ? (
          <View style={styles.photoOverlay}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.progress}>Uploading… {progress}%</Text>
          </View>
        ) : null}
      </Pressable>
      {value && !uploading ? (
        <Text style={styles.replace} onPress={() => void pick()} accessibilityRole="button">
          Replace photo
        </Text>
      ) : null}
      {error ? (
        <Text style={styles.err} onPress={() => void pick()} accessibilityRole="button">
          {error} Tap to retry.
        </Text>
      ) : missing ? (
        <Text style={styles.err}>This photo is required.</Text>
      ) : null}
    </View>
  );
}

function isoToDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function dateToIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function displayDate(iso: string): string {
  const d = isoToDate(iso);
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
}

export function DateField({
  label,
  value,
  onChange,
  minimumDate,
  maximumDate,
  error,
  required,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  error?: string;
  required?: boolean;
}) {
  const open = () =>
    DateTimePickerAndroid.open({
      value: isoToDate(value) ?? maximumDate ?? new Date(),
      mode: 'date',
      minimumDate,
      maximumDate,
      onChange: (event, date) => {
        if (event.type === 'set' && date) onChange(dateToIso(date));
      },
    });
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={[type.label, { marginBottom: 6 }]}>
        {label}
        {required ? <Text style={{ color: colors.primary }}> *</Text> : null}
      </Text>
      <Pressable onPress={open} style={[styles.date, !!error && { borderColor: colors.primary }]} accessibilityRole="button" accessibilityLabel={label}>
        <NxIcon name="calendar" size={18} color={colors.muted} />
        <Text style={[type.body, { flex: 1, color: value ? colors.ink : colors.faint }]}>{value ? displayDate(value) : 'Select date'}</Text>
      </Pressable>
      {error ? <Text style={styles.err}>{error}</Text> : null}
    </View>
  );
}

export function OptionChips<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
  required,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | '';
  onChange: (v: T) => void;
  error?: string;
  required?: boolean;
}) {
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={[type.label, { marginBottom: 6 }]}>
        {label}
        {required ? <Text style={{ color: colors.primary }}> *</Text> : null}
      </Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={styles.err}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, marginBottom: space.md, backgroundColor: colors.card },
  photoMissing: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  photoHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, marginBottom: space.sm },
  okBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.successSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  okText: { fontSize: 10, fontWeight: '800', color: colors.success },
  photoBox: {
    height: 140,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  photoImg: { width: '100%', height: '100%' },
  photoOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center' },
  progress: { marginTop: 6, fontWeight: '700', color: colors.ink, fontSize: 12 },
  replace: { textAlign: 'center', marginTop: space.sm, color: colors.muted, fontWeight: '700', fontSize: 12 },
  tileWrap: { flexBasis: 0, flexGrow: 1, minWidth: 0 },
  tile: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.card, overflow: 'hidden' },
  tileDone: { borderColor: colors.successBorder },
  tileMissing: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  tileMedia: { height: 82, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, overflow: 'hidden' },
  tileEmpty: { alignItems: 'center', gap: 4 },
  tileCta: { fontSize: 10.5, fontWeight: '700', color: colors.faint },
  tileCheck: { position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  tileFoot: { paddingHorizontal: 8, paddingTop: 7, paddingBottom: 8, gap: 2 },
  tileLabel: { fontSize: 11.5, lineHeight: 15, fontWeight: '700', color: colors.ink },
  tileState: { fontSize: 10, fontWeight: '600', color: colors.faint },
  err: { color: colors.primaryDark, fontSize: 12, marginTop: 4 },
  date: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 48,
    backgroundColor: colors.card,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  chipTextOn: { color: colors.primary, fontWeight: '800' },
});

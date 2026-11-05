import React, { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { chooseFileSource } from './FileUploadField';
import { PickerError, pickDocument, pickPhoto, uploadVehicleDocument } from '../services/storageService';
import { describeDataError } from '../utils/retry';
import { colors, radius, space, type } from '../theme';

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
export function todayIso(): string {
  return dateToIso(new Date());
}

export function DateField({
  label,
  value,
  onChange,
  minimumDate,
  error,
  required,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  minimumDate?: Date;
  error?: string;
  required?: boolean;
}) {
  const open = () =>
    DateTimePickerAndroid.open({
      value: isoToDate(value) ?? new Date(),
      mode: 'date',
      minimumDate,
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
      <Pressable onPress={open} style={[styles.field, !!error && { borderColor: colors.primary }]} accessibilityRole="button" accessibilityLabel={label}>
        <Ionicons name="calendar-outline" size={18} color={colors.muted} />
        <Text style={[type.body, { flex: 1, color: value ? colors.ink : colors.faint }]}>{value ? displayDate(value) : 'Select date'}</Text>
      </Pressable>
      {error ? <Text style={styles.err}>{error}</Text> : null}
    </View>
  );
}

/** One vehicle document (RC / insurance / permit / FC) uploaded to Storage; value is its download URL. */
export function SingleDocField({
  label,
  vehicleId,
  kind,
  value,
  onChange,
  required,
  error,
  onBusyChange,
}: {
  label: string;
  vehicleId: string;
  kind: string;
  value: string;
  onChange: (url: string) => void;
  required?: boolean;
  error?: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState('');

  const pick = async () => {
    if (progress != null) return;
    const source = await chooseFileSource(label);
    if (!source) return;
    setUploadError('');
    try {
      const file = source === 'document' ? await pickDocument() : await pickPhoto(source);
      if (!file) return;
      setProgress(0);
      onBusyChange?.(true);
      onChange(await uploadVehicleDocument(vehicleId, kind, file, setProgress));
    } catch (e) {
      setUploadError(e instanceof PickerError ? e.message : describeDataError(e));
    } finally {
      setProgress(null);
      onBusyChange?.(false);
    }
  };

  const shown = uploadError || error;
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={[type.label, { marginBottom: 6 }]}>
        {label}
        {required ? <Text style={{ color: colors.primary }}> *</Text> : null}
      </Text>
      <Pressable onPress={() => void pick()} style={[styles.field, !!shown && { borderColor: colors.primary }]} accessibilityRole="button" accessibilityLabel={`${value ? 'Replace' : 'Upload'} ${label}`}>
        {progress != null ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons name={value ? 'checkmark-circle' : 'cloud-upload-outline'} size={20} color={value ? colors.success : colors.muted} />
        )}
        <Text style={[type.body, { flex: 1 }]}>{progress != null ? `Uploading… ${progress}%` : value ? 'Uploaded — tap to replace' : 'Tap to upload (PDF or photo)'}</Text>
        {value && progress == null ? (
          <Text style={styles.view} onPress={() => void Linking.openURL(value)} accessibilityRole="link">
            View
          </Text>
        ) : null}
      </Pressable>
      {shown ? <Text style={styles.err}>{shown}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
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
  err: { color: colors.primaryDark, fontSize: 12, marginTop: 4 },
  view: { color: colors.primary, fontWeight: '800' },
});

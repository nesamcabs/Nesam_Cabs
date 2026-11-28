import React, { useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './kit/Text';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { chooseFileSource } from './FileUploadField';
import { PickerError, describePickerError, pickUploadFile, uploadVehicleDocument } from '../services/storageService';
import { describeDataError } from '../utils/retry';
import { colors, radius, space, type } from '../theme';
import { POPPINS, poppinsReady } from '../theme/fonts';

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
      {Platform.OS === 'web' ? (
        <WebDateInput label={label} value={value} onChange={onChange} minimumDate={minimumDate} invalid={!!error} />
      ) : (
        <Pressable onPress={open} style={[styles.field, !!error && { borderColor: colors.primary }]} accessibilityRole="button" accessibilityLabel={label}>
          <Ionicons name="calendar-outline" size={18} color={colors.muted} />
          <Text style={[type.body, { flex: 1, color: value ? colors.ink : colors.faint }]}>{value ? displayDate(value) : 'Select date'}</Text>
        </Pressable>
      )}
      {error ? <Text style={styles.err}>{error}</Text> : null}
    </View>
  );
}

/**
 * The browser's own date box, inside the page: type the date or pick it from the calendar. It must not open in a separate
 * dialog — a sheet (Modal) pulls focus back to itself, so a date input outside it could not be used.
 */
function WebDateInput({ label, value, onChange, minimumDate, invalid }: { label: string; value: string; onChange: (iso: string) => void; minimumDate?: Date; invalid: boolean }) {
  return (
    <View style={[styles.field, invalid && { borderColor: colors.primary }]}>
      {React.createElement('input', {
        type: 'date',
        value,
        min: minimumDate ? dateToIso(minimumDate) : undefined,
        'aria-label': label,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
        // A click anywhere in the box opens the calendar, not only the small icon at the end.
        onClick: (e: { currentTarget: { showPicker?: () => void } }) => {
          try {
            e.currentTarget.showPicker?.();
          } catch {
            /* typing still works */
          }
        },
        style: { flex: 1, width: '100%', minWidth: 0, height: 44, border: 'none', outline: 'none', background: 'transparent', fontFamily: poppinsReady() ? POPPINS.semibold : 'system-ui, sans-serif', fontSize: 14, color: value ? colors.ink : '#6F7785', cursor: 'pointer' },
      })}
    </View>
  );
}

/** Pick a file and upload it as one vehicle document; `onChange` receives its download URL. */
export function useDocUpload({ label, vehicleId, kind, onChange, onBusyChange, folder }: {
  label: string;
  vehicleId: string;
  kind: string;
  onChange: (url: string) => void;
  onBusyChange?: (busy: boolean) => void;
  folder?: 'vehicles' | 'drivers';
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState('');

  const pick = async () => {
    if (progress != null) return;
    setUploadError('');
    try {
      const file = await pickUploadFile(() => chooseFileSource(label));
      if (!file) return;
      setProgress(0);
      onBusyChange?.(true);
      onChange(await uploadVehicleDocument(vehicleId, kind, file, setProgress, folder));
    } catch (e) {
      setUploadError(e instanceof PickerError ? e.message : (e as { code?: string })?.code ? describeDataError(e) : describePickerError(e));
    } finally {
      setProgress(null);
      onBusyChange?.(false);
    }
  };

  return { progress, uploadError, pick };
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
  folder,
}: {
  label: string;
  vehicleId: string;
  kind: string;
  value: string;
  onChange: (url: string) => void;
  required?: boolean;
  error?: string;
  onBusyChange?: (busy: boolean) => void;
  /** Where in the vendor's storage it goes; vehicle documents by default. */
  folder?: 'vehicles' | 'drivers';
}) {
  const { progress, uploadError, pick } = useDocUpload({ label, vehicleId, kind, onChange, onBusyChange, folder });

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
        <Text style={[type.body, { flex: 1 }]}>{progress != null ? `Uploading… ${progress}%` : value ? 'Uploaded' : 'Upload'}</Text>
        {value && progress == null ? (
          <Text style={styles.view} onPress={() => void Linking.openURL(value)} accessibilityRole="link">
            View
          </Text>
        ) : null}      </Pressable>
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

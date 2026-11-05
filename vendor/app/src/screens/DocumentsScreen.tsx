// Company documents + fleet compliance (native port of vendor/web
// DocumentsVerificationScreen.tsx). Stored onboarding files are opened via
// short-lived download URLs resolved on demand (storage.rules stay in charge).
import React, { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVendorData } from '../context/VendorData';
import { Badge, Card, EmptyState, Notice, Screen } from '../components/ui';
import { resolveFileUrl } from '../services/storageService';
import { BUSINESS_REG_TYPES, IDENTITY_PROOF_TYPES } from '../config/onboarding';
import { EXPIRY_WARNING_DAYS } from '../config/constants';
import type { StoredFile } from '../types/vendor';
import { daysUntil } from '../utils/wallet';
import { displayDate } from '../components/fields';
import { describeDataError } from '../utils/retry';
import { colors, space, type } from '../theme';

function FileRow({ file, onError }: { file: StoredFile; onError: (msg: string) => void }) {
  const [opening, setOpening] = useState(false);
  const open = async () => {
    setOpening(true);
    try {
      await Linking.openURL(await resolveFileUrl(file.path));
    } catch (e) {
      onError(describeDataError(e));
    } finally {
      setOpening(false);
    }
  };
  return (
    <Pressable style={styles.file} onPress={() => void open()} disabled={opening} accessibilityRole="button" accessibilityLabel={`Open ${file.name}`}>
      <Ionicons name={file.contentType === 'application/pdf' ? 'document-text-outline' : 'image-outline'} size={18} color={colors.ink} />
      <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>
        {file.name}
      </Text>
      <Text style={styles.open}>{opening ? 'Opening…' : 'Open'}</Text>
    </Pressable>
  );
}

export function DocumentsScreen() {
  const { record, vehicles } = useVendorData();
  const [error, setError] = useState('');
  const d = record.documents;
  const f = record.fleet;

  const compliance = useMemo(
    () =>
      vehicles
        .flatMap((v) =>
          (
            [
              ['Insurance', v.insuranceExpiry],
              ['Permit', v.permitExpiry],
              ['Fitness (FC)', v.fitnessExpiry],
            ] as const
          ).map(([label, date]) => ({ key: `${v.id}-${label}`, vehicle: v.vehicleNumber, label, date, days: daysUntil(date) })),
        )
        .filter((x) => x.days != null)
        .sort((a, b) => (a.days ?? 0) - (b.days ?? 0)),
    [vehicles],
  );

  const group = (title: string, files: StoredFile[] | undefined, sub?: string) => (
    <Card>
      <Text style={type.h3}>{title}</Text>
      {sub ? <Text style={[type.small, { marginBottom: space.sm }]}>{sub}</Text> : null}
      {files?.length ? files.map((file) => <FileRow key={file.path} file={file} onError={setError} />) : <Text style={type.small}>No files.</Text>}
    </Card>
  );

  return (
    <Screen edges={[]}>
      <Notice message={error} />
      <Notice tone="info" message="Your application documents are locked after approval. To replace a company document, contact NESAM partner support. Vehicle documents can be updated from the Fleet tab." />
      <Text style={[type.h3, styles.section]}>Fleet compliance</Text>
      {compliance.length === 0 ? (
        <EmptyState title="No vehicle expiry dates yet" message="Add vehicles with insurance and permit dates in the Fleet tab." />
      ) : (
        compliance.map((c) => (
          <View key={c.key} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={type.body}>
                {c.vehicle} · {c.label}
              </Text>
              <Text style={type.tiny}>Valid till {displayDate(c.date)}</Text>
            </View>
            <Badge
              label={(c.days ?? 0) < 0 ? 'Expired' : (c.days ?? 0) <= EXPIRY_WARNING_DAYS ? `${c.days} days left` : 'Valid'}
              tone={(c.days ?? 0) < 0 ? 'danger' : (c.days ?? 0) <= EXPIRY_WARNING_DAYS ? 'warning' : 'success'}
            />
          </View>
        ))
      )}

      <Text style={[type.h3, styles.section]}>Application documents</Text>
      {d ? group(BUSINESS_REG_TYPES.find((t) => t.value === d.businessRegistration.type)?.label ?? 'Business registration', d.businessRegistration.files, d.businessRegistration.number) : null}
      {d ? group(IDENTITY_PROOF_TYPES.find((t) => t.value === d.identityProof.type)?.label ?? 'Identity proof', d.identityProof.files, d.identityProof.maskedNumber) : null}
      {group('Vehicle RCs (onboarding)', f?.rcFiles)}
      {group('Insurance (onboarding)', f?.insuranceFiles)}
      {group('Fitness certificates (onboarding)', f?.fcFiles)}
      {group('Permits (onboarding)', f?.permitFiles)}
      {group('Vehicle photos (onboarding)', f?.vehiclePhotos)}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: space.md, marginBottom: space.sm },
  file: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  open: { color: colors.primary, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: space.md, marginBottom: space.sm },
});

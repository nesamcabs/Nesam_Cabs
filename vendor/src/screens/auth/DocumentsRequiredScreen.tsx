// While a partner's business or vehicle documents are missing nothing in the workspace can be used (the duty functions
// refuse too) until the documents are uploaded and NESAM verifies them:
//   • VerificationLock — approved partner: the panel stays visible, view-only, with this card on top.
//   • DocumentsRequiredScreen — application submitted without documents: a full sign-in style screen.
import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AUTH, AuthCard, AuthFrame } from '../../components/shell/AuthFrame';
import { Btn, Feedback } from '../../components/kit/core';
import { reopenForDocuments, vehicleDocsMissing } from '../../services/onboardingService';
import type { VendorRecord } from '../../types/vendor';
import { displayPlate } from '../../utils/fleet';
import { describeDataError } from '../../utils/retry';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../../config/constants';
import { colors, fontFamily } from '../../theme';
import { useLayout } from '../../theme/responsive';

function Item({ done, title, sub }: { done: boolean; title: string; sub?: string }) {
  return (
    <View style={styles.item}>
      <View style={[styles.tick, done && styles.tickDone]}>
        <Ionicons name={done ? 'checkmark' : 'cloud-upload-outline'} size={14} color={done ? colors.white : AUTH.muted} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.itemTitle}>{title}</Text>
        {sub ? <Text style={[styles.itemSub, !done && { color: colors.primaryDark }]}>{sub}</Text> : null}
      </View>
    </View>
  );
}

function Checklist({ record }: { record: VendorRecord }) {
  const d = record.documents;
  const vehicles = record.fleet?.vehicles ?? [];
  return (
    <View style={styles.list}>
      <Item done={!!d?.businessRegistration?.files?.length} title="Business registration" sub={d?.businessRegistration?.files?.length ? 'Uploaded' : 'GST, registration or trade licence'} />
      <Item done={!!d?.identityProof?.files?.length} title="Identity proof" sub={d?.identityProof?.files?.length ? 'Uploaded' : 'Aadhaar, PAN or passport'} />
      {vehicles.length ? vehicles.map((v) => {
        const missing = vehicleDocsMissing(v);
        return <Item key={v.registrationNumber} done={!missing.length} title={displayPlate(v.registrationNumber)} sub={missing.length ? `Missing: ${missing.join(', ')}` : 'RC, insurance, FC, permit and photo uploaded'} />;
      }) : <Item done={false} title="Vehicle documents" sub="RC, insurance, FC, permit and vehicle photo" />}
    </View>
  );
}

function useReopen(record: VendorRecord) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const start = async () => {
    setBusy(true); setError('');
    try { await reopenForDocuments(record); /* the vendors/{uid} listener opens the upload wizard */ }
    catch (e) { setError(describeDataError(e)); setBusy(false); }
  };
  return { busy, error, start };
}

function Links({ onSignOut, short }: { onSignOut: () => void; short?: boolean }) {
  return (
    <View style={short ? styles.lockLinks : styles.links}>
      <Pressable onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} accessibilityRole="button" accessibilityLabel={`Call NESAM ${SUPPORT_PHONE_DISPLAY}`} hitSlop={8} style={styles.link}>
        <Ionicons name="call-outline" size={15} color={colors.primary} />
        <Text style={[styles.linkText, { color: colors.primary }]}>{short ? 'Help' : `Help · ${SUPPORT_PHONE_DISPLAY}`}</Text>
      </Pressable>
      <Pressable onPress={onSignOut} accessibilityRole="button" hitSlop={8} style={styles.link}>
        <Ionicons name="log-out-outline" size={15} color={AUTH.muted} />
        <Text style={[styles.linkText, { color: AUTH.muted }]}>Sign out</Text>
      </Pressable>
    </View>
  );
}

/** Card over the view-only workspace of an approved partner whose documents are missing. */
export function VerificationLock({ record, onSignOut }: { record: VendorRecord; onSignOut: () => void }) {
  const insets = useSafeAreaInsets();
  const { wide, height } = useLayout();
  const [open, setOpen] = useState(false);
  const { busy, error, start } = useReopen(record);
  const d = record.documents;
  const missingCount = (d?.businessRegistration?.files?.length ? 0 : 1) + (d?.identityProof?.files?.length ? 0 : 1)
    + (record.fleet?.vehicles ?? []).reduce((n, v) => n + vehicleDocsMissing(v).length, 0);
  return (
    <View pointerEvents="box-none" style={[styles.lockWrap, { paddingBottom: Math.max(insets.bottom, 12) + (wide ? 16 : 0) }]}>
      <View style={[styles.lockCard, { maxHeight: height * 0.8 }]} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={{ padding: wide ? 22 : 18 }} keyboardShouldPersistTaps="handled">
          <View style={styles.lockHead}>
            <View style={styles.lockIcon}><Ionicons name="lock-closed" size={20} color={colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.lockEyebrow}>VERIFICATION REQUIRED · VIEW ONLY</Text>
              <Text style={styles.lockTitle} accessibilityRole="header">Upload your documents to unlock the panel</Text>
            </View>
          </View>
          <Text style={styles.lockText}>
            You can look around, but duties, bids, fleet and wallet are locked until your business and vehicle documents are uploaded and verified by NESAM.
            {missingCount ? ` ${missingCount} item${missingCount === 1 ? '' : 's'} missing.` : ''}
          </Text>
          <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" hitSlop={6} style={styles.toggle}>
            <Text style={styles.toggleText}>{open ? 'Hide checklist' : 'See what is missing'}</Text>
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={colors.primary} />
          </Pressable>
          {open ? <Checklist record={record} /> : null}
          <View style={{ height: 12 }} />
          <Feedback tone="error" message={error} />
          <View style={[styles.lockActions, !wide && { flexDirection: 'column', alignItems: 'stretch' }]}>
            <Btn title="Upload documents" icon="cloud-upload-outline" busy={busy} onPress={() => void start()} style={[{ minHeight: 48, borderRadius: 12 }, wide ? { flex: 1 } : null]} />
            <Links onSignOut={onSignOut} short />
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

export function DocumentsRequiredScreen({ record, onSignOut }: { record: VendorRecord; onSignOut: () => void }) {
  const { busy, error, start } = useReopen(record);
  const approved = record.status === 'APPROVED';
  return (
    <AuthFrame>
      <AuthCard eyebrow="Verification required" title="Upload your documents"
        subtitle={approved
          ? 'Duties and bids unlock once your business and vehicle documents are uploaded and verified by NESAM.'
          : 'Complete your application with your business and vehicle documents. NESAM verifies them before you can take duties.'}>
        <Checklist record={record} />
        <View style={styles.note}>
          <Ionicons name="shield-checkmark-outline" size={16} color="#4F7A68" />
          <Text style={styles.noteText}>{approved ? 'Your account returns to NESAM for verification after you submit. Accepted duties stay with you.' : 'After you submit, NESAM reviews the documents and approves your account.'}</Text>
        </View>
        <Feedback tone="error" message={error} />
        <Btn title="Upload documents" icon="cloud-upload-outline" busy={busy} full onPress={() => void start()} style={{ minHeight: 50, borderRadius: 12 }} />
        <Links onSignOut={onSignOut} />
      </AuthCard>
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: 14, gap: 12, padding: 16, borderRadius: 14, backgroundColor: '#F8F9FB', borderWidth: 1, borderColor: AUTH.line },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  tick: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: AUTH.fieldLine, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  tickDone: { backgroundColor: colors.success, borderColor: colors.success },
  itemTitle: { fontFamily, fontSize: 13.5, fontWeight: '600', color: AUTH.ink },
  itemSub: { fontFamily, fontSize: 12, lineHeight: 18, color: AUTH.muted, marginTop: 2 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 16, marginBottom: 14, padding: 12, borderRadius: 10, backgroundColor: '#F0F8F2' },
  noteText: { flex: 1, fontFamily, fontSize: 12, lineHeight: 18, color: '#3D7559' },
  links: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, flexWrap: 'wrap', gap: 10 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32 },
  linkText: { fontFamily, fontSize: 13, fontWeight: '600' },
  lockWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingHorizontal: 12 },
  lockCard: { width: '100%', maxWidth: 580, backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: AUTH.line, shadowColor: '#162033', shadowOpacity: 0.18, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 14 },
  lockHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lockIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  lockEyebrow: { fontFamily, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.2, color: colors.primary },
  lockTitle: { fontFamily, fontSize: 16.5, fontWeight: '700', color: AUTH.ink, marginTop: 3, letterSpacing: -0.3 },
  lockText: { fontFamily, fontSize: 12.5, lineHeight: 19, color: AUTH.muted, marginTop: 12 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 10, minHeight: 30 },
  toggleText: { fontFamily, fontSize: 12.5, fontWeight: '600', color: colors.primary },
  lockActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  lockLinks: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 18 },
});

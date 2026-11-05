// Pending / rejected / suspended (native port of vendor/web AccountStatusScreen.tsx matching NESAM_Complete_UX).
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { VendorRecord } from '../../types/vendor';
import { SECTION_LABELS } from '../../config/onboarding';
import { Button, Card, Notice, Screen } from '../../components/ui';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../../config/constants';
import { colors, space, type } from '../../theme';

export function AccountStatusScreen({
  record,
  onSignOut,
  onReapply,
}: {
  record: VendorRecord;
  onSignOut: () => void;
  onReapply?: () => void;
}) {
  const [lang, setLang] = useState<'ta' | 'en'>('ta');
  const ta = lang === 'ta';
  const businessName = record.business?.businessName || record.fleet?.plates?.[0] || 'your fleet';

  if (record.status === 'SUSPENDED') {
    return (
      <Screen>
        <Card style={styles.card}>
          <View style={{ alignItems: 'center' }}>
            <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name="ban" size={32} color={colors.primary} />
            </View>
            <Text style={[type.h1, { textAlign: 'center' }]}>
              {ta ? 'கணக்கு தற்காலிகமாக நிறுத்தப்பட்டுள்ளது' : 'Account suspended'}
            </Text>
            <Text style={[type.small, { textAlign: 'center', marginTop: space.sm }]}>
              {ta
                ? 'உங்கள் கணக்கு NESAM நிர்வாகத்தால் நிறுத்தப்பட்டுள்ளது. தொடர ஆதரவை அணுகவும்.'
                : `Operations for ${businessName} are paused by the NESAM team. Contact partner support to resolve this.`}
            </Text>
          </View>
          {record.review?.note ? (
            <Notice tone="warning" message={record.review.note} style={{ marginTop: space.lg }} />
          ) : null}
          <Footer onSignOut={onSignOut} />
        </Card>
      </Screen>
    );
  }

  if (record.status === 'REJECTED') {
    return (
      <Screen>
        <Card style={styles.card}>
          <View style={{ alignItems: 'center' }}>
            <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name="close-circle" size={32} color={colors.primary} />
            </View>
            <Text style={[type.h1, { textAlign: 'center' }]}>
              {ta ? 'விண்ணப்பம் ஏற்கப்படவில்லை' : 'Application not approved'}
            </Text>
            <Text style={[type.small, { textAlign: 'center', marginTop: space.sm }]}>
              {ta
                ? 'சமர்ப்பிக்கப்பட்ட விவரங்களில் சில திருத்தங்கள் தேவைப்படுகின்றன.'
                : `We couldn’t approve ${businessName} with the information provided.`}
            </Text>
          </View>
          {record.review?.note ? (
            <Notice message={`Reason: ${record.review.note}`} style={{ marginTop: space.lg }} />
          ) : null}
          {record.review?.flaggedSections.length ? (
            <Text style={[type.small, { marginTop: space.sm }]}>
              Sections to fix: {record.review.flaggedSections.map((s) => SECTION_LABELS[s]).join(', ')}
            </Text>
          ) : null}
          {onReapply ? (
            <Button
              title={ta ? 'விவரங்களை திருத்தி மீண்டும் விண்ணப்பிக்கவும்' : 'Correct details & reapply'}
              onPress={onReapply}
              style={{ marginTop: space.lg }}
            />
          ) : null}
          <Footer onSignOut={onSignOut} />
        </Card>
      </Screen>
    );
  }

  // PENDING_REVIEW matching reference prototype
  return (
    <Screen>
      <Card style={styles.card}>
        {/* Language switch */}
        <View style={styles.langRow}>
          <Text style={styles.brandTag}>NESAM PARTNER</Text>
          <View style={styles.langPicker}>
            <Pressable
              onPress={() => setLang('ta')}
              style={[styles.langBtn, ta && styles.langBtnActive]}
            >
              <Text style={[styles.langText, ta && styles.langTextActive]}>தமிழ்</Text>
            </Pressable>
            <Pressable
              onPress={() => setLang('en')}
              style={[styles.langBtn, !ta && styles.langBtnActive]}
            >
              <Text style={[styles.langText, !ta && styles.langTextActive]}>EN</Text>
            </Pressable>
          </View>
        </View>

        {/* Review header */}
        <View style={{ alignItems: 'center', marginTop: space.md }}>
          <View style={[styles.icon, { backgroundColor: colors.bg }]}>
            <Ionicons name="time" size={32} color={colors.ink} />
          </View>
          <Text style={styles.eyebrow}>
            {ta ? 'விண்ணப்பம் பெறப்பட்டது' : 'APPLICATION RECEIVED'}
          </Text>
          <Text style={[type.h1, { textAlign: 'center', marginTop: 4 }]}>
            {ta ? 'நீங்கள் தயார்.\nநாங்கள் சரிபார்க்கிறோம்.' : 'You’re ready.\nWe’re verifying.'}
          </Text>
          <Text style={[type.small, { textAlign: 'center', marginTop: space.sm }]}>
            {ta
              ? 'உங்கள் விவரங்கள் verification-ல் உள்ளன. Admin approval முடிந்ததும் account activate ஆகும்.'
              : 'Your details are under office verification. Admin approval is required before marketplace, drivers and wallet become operational.'}
          </Text>
        </View>

        {/* Details box */}
        <View style={styles.detailsBox}>
          <Text style={styles.sectionLabel}>{ta ? 'விண்ணப்ப எண்' : 'APPLICATION ID'}</Text>
          <Text style={styles.appId}>{record.fleet?.plates?.[0] || 'NSM-VN-PENDING'}</Text>

          <View style={styles.detailRow}>
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={styles.detailTitle}>
                {ta ? 'ஒப்பந்தம் ஏற்றுக்கொள்ளப்பட்டது' : 'Agreement accepted'}
              </Text>
              <Text style={styles.detailSub}>Fleet Vendor Partner Agreement · v1.0</Text>
            </View>
          </View>

          <View style={styles.detailRow}>
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={styles.detailTitle}>
                {ta ? 'ஆவணங்கள் சமர்ப்பிக்கப்பட்டன' : 'Documents submitted'}
              </Text>
              <Text style={styles.detailSub}>Business, bank, vehicle and driver details</Text>
            </View>
          </View>

          <View style={styles.detailRow}>
            <Ionicons name="time" size={18} color={colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={styles.detailTitle}>
                {ta ? 'அலுவலக சரிபார்ப்பு நிலுவையில் உள்ளது' : 'Office verification in progress'}
              </Text>
              <Text style={styles.detailSub}>Usually reviewed within 24–48 business hours</Text>
            </View>
          </View>
        </View>

        <Text style={[type.tiny, { textAlign: 'center', marginTop: space.lg, color: colors.success, fontWeight: '700' }]}>
          ✓ {ta ? 'Approval முடிந்ததும் தானாகவே dashboard திறக்கும்' : 'This screen updates automatically as soon as admin approves'}
        </Text>

        <Footer onSignOut={onSignOut} />
      </Card>
    </Screen>
  );
}

function Footer({ onSignOut }: { onSignOut: () => void }) {
  return (
    <View style={styles.footer}>
      <Button
        title={`Call NESAM support (${SUPPORT_PHONE_DISPLAY})`}
        variant="primary"
        onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)}
      />
      <Button title="Sign out" variant="ghost" onPress={onSignOut} style={{ marginTop: space.sm }} />
    </View>
  );
}

export function LoadErrorScreen({
  message,
  onRetry,
  onSignOut,
}: {
  message: string;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <Screen>
      <Card style={styles.card}>
        <Text style={type.h2}>Couldn’t load your account</Text>
        <Notice message={message} style={{ marginTop: space.md }} />
        <Button title="Try again" onPress={onRetry} />
        <Button title="Sign out" variant="secondary" onPress={onSignOut} style={{ marginTop: space.sm }} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space.md },
  langRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.sm,
  },
  brandTag: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 1,
  },
  langPicker: {
    flexDirection: 'row',
    borderRadius: 8,
    backgroundColor: colors.bg,
    padding: 2,
  },
  langBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  langBtnActive: {
    backgroundColor: '#fff',
  },
  langText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
  },
  langTextActive: {
    color: colors.ink,
    fontWeight: '700',
  },
  icon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 1.2,
  },
  detailsBox: {
    marginTop: space.lg,
    backgroundColor: colors.bg,
    borderRadius: 14,
    padding: space.md,
    gap: space.md,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 0.8,
  },
  appId: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.ink,
    marginTop: -4,
  },
  detailRow: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
  },
  detailTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  detailSub: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
  },
  footer: {
    marginTop: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});

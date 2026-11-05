// Driver profile: identity, earnings (moved inside profile), contact & payout account,
// licence & ID, document status with expiry badges, and help/sign-out.
// All sections are minimized by default and only expand when clicked.
import React, { useMemo, useState } from 'react';
import { Alert, Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/nx/Text';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import { useDriverData } from '../context/DriverData';
import { useSignOut } from '../navigation/MainNavigator';
import { NxScreen, useShell } from '../components/nx/Shell';
import { NxColumns } from '../components/nx/layout';
import { NxDialog } from '../components/nx/Dialog';
import { NxIcon, NxIconName } from '../components/nx/Icon';
import {
  NxBadge,
  NxButton,
  NxField,
  NxFormError,
  NxInfo,
  NxPanel,
  NxPills,
  NxRow,
  NxTextButton,
  nxText,
} from '../components/nx/primitives';
import { updateDriverContactDetails, type ContactFields } from '../services/driverService';
import { DateField, displayDate } from '../components/forms';
import { IFSC_RE, MOBILE_RE, UPI_RE, localDateISO } from '../validation/kyc';
import { formatINR, initials } from '../utils/format';
import { last7Days, tripEarningStatus } from '../utils/ledger';
import { describeError } from '../utils/retry';
import { requestAccountDeletion } from '../services/partnerRequests';
import { COMPANY_LEGAL_NAME, SUPPORT_EMAIL } from '../config/constants';
import { nx } from '../theme/nx';
import { POPPINS } from '../theme/fonts';

type Period = 'today' | 'week';

function expiryBadge(date: string) {
  if (!date) return null;
  const days = Math.floor((new Date(`${date}T23:59:59`).getTime() - Date.now()) / 86400000);
  if (Number.isNaN(days)) return null;
  if (days < 0) return <NxBadge label="Expired" tone="red" />;
  if (days <= 30) return <NxBadge label={`Expires in ${days}d`} tone="amber" />;
  return null;
}

function DocRow({ label, url, expiry }: { label: string; url: string; expiry?: string }) {
  return (
    <Pressable
      style={styles.doc}
      disabled={!url}
      onPress={() => void Linking.openURL(url)}
      accessibilityRole="button"
      accessibilityLabel={`${label}${url ? '' : ', not uploaded'}`}
    >
      <NxIcon name="document" size={17} color={nx.muted} />
      <Text style={styles.docLabel} numberOfLines={2}>
        {label}
      </Text>
      {expiry ? expiryBadge(expiry) : null}
      {url ? <NxBadge label="Uploaded" tone="green" icon="check" /> : <NxBadge label="Not uploaded" tone="neutral" />}
    </Pressable>
  );
}

/** Accordion section header: clickable header that toggles section expansion. */
function AccordionHeader({
  icon,
  title,
  subtitle,
  badge,
  isOpen,
  onToggle,
  rightAction,
}: {
  icon: NxIconName;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  rightAction?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={[styles.accordionHeader, isOpen && styles.accordionHeaderOpen]}
      accessibilityRole="button"
      accessibilityState={{ expanded: isOpen }}
      accessibilityLabel={`${title}. ${isOpen ? 'Expanded' : 'Minimized'}. Tap to toggle.`}
    >
      <View style={styles.accordionLeft}>
        <View style={[styles.accordionIconWrap, isOpen && styles.accordionIconWrapOpen]}>
          <NxIcon name={icon} size={18} color={isOpen ? nx.red : '#475569'} />
        </View>
        <View style={styles.accordionTitleWrap}>
          <Text style={[styles.accordionTitle, isOpen && { color: nx.red }]}>{title}</Text>
          {subtitle && !isOpen ? (
            <Text style={styles.accordionSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.accordionRight}>
        {badge}
        {rightAction}
        <View style={[styles.chevronWrap, isOpen && styles.chevronRotated]}>
          <NxIcon name="chevron" size={16} color={isOpen ? nx.red : nx.muted} />
        </View>
      </View>
    </Pressable>
  );
}

export function ProfileScreen({ route }: { route?: { params?: { openSection?: string } } } = {}) {
  const navigation = useNavigation();
  const signOut = useSignOut();
  const { openSupport } = useShell();
  const { account, completedTrips, earnings, ledger } = useDriverData();
  const { driver, identity, license, vehicle, bank } = account;
  const fleet = !!driver.vendorId;

  // By default, ALL sections are minimized. Only expand when clicked!
  const targetSection = route?.params?.openSection;
  const [previousSection, setPreviousSection] = useState(targetSection);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => targetSection ? { [targetSection]: true } : {});
  if (targetSection !== previousSection) {
    setPreviousSection(targetSection);
    if (targetSection) setExpanded((prev) => ({ ...prev, [targetSection]: true }));
  }
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  // Earnings section inside profile
  const [period, setPeriod] = useState<Period>('today');
  const days = useMemo(() => last7Days(ledger), [ledger]);
  const maxEarnings = Math.max(1, ...days.map((d) => d.amount));
  const week = period === 'week';
  const range = `${days[0]?.label ?? ''} – ${days[6]?.label ?? ''}`;
  const waiting = completedTrips.filter((t) => tripEarningStatus(ledger, t.id) !== 'available' && !t.fleetTrip);
  const waitingTotal = waiting.reduce((s, t) => s + (t.payoutRecorded ? t.driverEarnings : 0), 0);


  const toggle = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const confirmSignOut = () =>
    Alert.alert('Sign out?', 'You’ll need to verify your phone number again to sign back in.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);

  const [deleting, setDeleting] = useState(false);
  const confirmDeletion = () =>
    Alert.alert(
      'Delete your account?',
      'NESAM will verify the request, settle anything still open (duties, dues, wallet and deposit) and then delete your account and personal data. Records we must keep by law, such as trip and settlement records, are retained.',
      [
        { text: 'Keep my account', style: 'cancel' },
        {
          text: 'Request deletion',
          style: 'destructive',
          onPress: () => {
            if (deleting) return;
            setDeleting(true);
            requestAccountDeletion('driver')
              .then((r) =>
                Alert.alert(r.alreadyOpen ? 'Already requested' : 'Request received', `Reference ${r.reference}. NESAM will confirm by phone or email.`),
              )
              .catch((e: unknown) => Alert.alert('Request not sent', e instanceof Error ? e.message : 'Please try again.'))
              .finally(() => setDeleting(false));
          },
        },
      ],
    );

  const docTone = driver.docStatus === 'Approved' ? 'green' : driver.docStatus === 'Rejected' ? 'red' : 'amber';

  return (
    <NxScreen title="Profile" subtitle="Driver & Vehicle Account">
      {driver.docStatus === 'Rejected' && driver.rejectionReason ? (
        <NxInfo tone="amber" style={{ marginTop: 0, marginBottom: 16 }}>
          Document note from NESAM: {driver.rejectionReason}
        </NxInfo>
      ) : null}
      {saved ? <NxInfo style={{ marginTop: 0, marginBottom: 16 }}>Profile updated.</NxInfo> : null}

      <NxColumns>
        {/* Section 1: Identity & Vehicle Overview */}
        <NxPanel style={styles.sectionPanel}>
          <AccordionHeader
            icon="user"
            title={driver.name}
            subtitle={`${driver.phone} · ${vehicle.vehicleType} (${vehicle.vehicleNumber || 'No reg'})`}
            badge={<NxBadge label={driver.approvalStatus || 'Approved'} tone="green" />}
            isOpen={!!expanded.identity}
            onToggle={() => toggle('identity')}
          />
          {expanded.identity ? (
            <View style={styles.sectionBody}>
              <View style={styles.identityHead}>
                {driver.photoUrl ? (
                  <Image source={{ uri: driver.photoUrl }} style={styles.avatar} accessibilityLabel={driver.name} />
                ) : (
                  <View style={styles.avatar} accessibilityElementsHidden>
                    <Text style={styles.avatarText}>{initials(driver.name)}</Text>
                  </View>
                )}
                <Text style={styles.name}>{driver.name}</Text>
                <Text style={nxText.copy}>
                  {driver.vendorName ? `Fleet driver · ${driver.vendorName}` : 'Single vehicle owner / driver'}
                </Text>
                <View style={{ marginTop: 8 }}>
                  <NxBadge label="Account approved" tone="green" icon="shield" />
                </View>
              </View>
              <View style={styles.details}>
                <NxRow label="Mobile" value={driver.phone} />
                <NxRow label="Rating" value={driver.rating != null ? `★ ${driver.rating.toFixed(1)}` : 'No ratings yet'} />
                <NxRow label="Completed trips" value={String(completedTrips.length)} />
                {driver.joiningDate ? <NxRow label="Partner since" value={driver.joiningDate} /> : null}
                <NxRow label="Vehicle" value={[vehicle.make, vehicle.model].filter(Boolean).join(' ') || '—'} />
                <NxRow label="Registration" value={vehicle.vehicleNumber || '—'} />
                <NxRow label="Colour" value={vehicle.color || '—'} />
                <NxRow
                  label="Category"
                  value={`${vehicle.vehicleType}${vehicle.capacity ? ` · ${vehicle.capacity} seats` : ''}${vehicle.fuelType ? ` · ${vehicle.fuelType}` : ''}`}
                />
              </View>
            </View>
          ) : null}
        </NxPanel>

        {/* Section 2: Earnings & Settlements (Moved inside Profile) */}
        <NxPanel style={styles.sectionPanel}>
          <AccordionHeader
            icon="chart"
            title="Earnings & settlements"
            subtitle={fleet ? 'Settled by your fleet' : `${formatINR(earnings.todayEarnings)} today · ${formatINR(earnings.thisWeekEarnings)} 7 days`}
            badge={fleet ? <NxBadge label="Fleet driver" tone="neutral" /> : <NxBadge label="Credited" tone="green" />}
            isOpen={!!expanded.earnings}
            onToggle={() => toggle('earnings')}
          />
          {expanded.earnings ? (
            <View style={styles.sectionBody}>
              {fleet ? (
                <NxInfo>
                  You drive for {driver.vendorName || 'a fleet operator'}. Your fleet operator receives trip settlements directly.
                </NxInfo>
              ) : (
                <>
                  <NxPills<Period>
                    label="Earnings period"
                    value={period}
                    onChange={setPeriod}
                    options={[
                      { value: 'today', label: 'Today' },
                      { value: 'week', label: 'Last 7 days' },
                    ]}
                  />

                  <View style={styles.earningsSummaryBox}>
                    <Text style={styles.earningsSummaryLabel}>
                      {week ? `Weekly earnings (${range})` : 'Today’s credited earnings'}
                    </Text>
                    <Text style={styles.earningsTotal}>
                      {formatINR(week ? earnings.thisWeekEarnings : earnings.todayEarnings)}
                    </Text>
                  </View>

                  {week ? (
                    <View
                      style={styles.chart}
                      accessible
                      accessibilityRole="image"
                      accessibilityLabel={`Credited daily earnings: ${days.map((d) => `${d.label} ${formatINR(d.amount)}`).join(', ')}`}
                    >
                      {days.map((d, i) => (
                        <View key={d.key} style={styles.col}>
                          <View style={styles.track}>
                            <View
                              style={[
                                styles.bar,
                                i === 6 && styles.barNow,
                                { height: `${Math.max(4, (d.amount / maxEarnings) * 100)}%` },
                              ]}
                            />
                          </View>
                          <Text style={styles.day} numberOfLines={1}>
                            {d.label}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <NxInfo style={{ marginTop: 8 }}>
                      The payout for each duty is credited once verified. Approved toll receipts on non-cash trips are reimbursed.
                    </NxInfo>
                  )}

                  <View style={{ marginTop: 14 }}>
                    <NxRow label="This month" value={formatINR(earnings.thisMonthEarnings)} />
                    <NxRow label="Lifetime" value={formatINR(earnings.lifetimeEarnings)} />
                    {earnings.tollReimbursements > 0 ? (
                      <NxRow label="Toll reimbursements" value={formatINR(earnings.tollReimbursements)} />
                    ) : null}
                    <NxRow label="Completed duties" value={String(earnings.totalTripsCompleted)} />
                  </View>

                  <View style={styles.settlementBox}>
                    <Text style={styles.settlementHeading}>Pending settlement review</Text>
                    <Text style={styles.settlementAmount}>{formatINR(waitingTotal)}</Text>
                    <Text style={nxText.note}>
                      {waiting.length} completed trip{waiting.length === 1 ? '' : 's'} awaiting settlement verification.
                    </Text>
                  </View>
                </>
              )}
            </View>
          ) : null}
        </NxPanel>

        {/* Section 3: Contact & Payout Account */}
        <NxPanel style={styles.sectionPanel}>
          <AccordionHeader
            icon="edit"
            title="Contact & payout account"
            subtitle={bank.accountNumber ? `A/c ••••${bank.accountNumber.slice(-4)} · ${driver.phone}` : driver.phone}
            isOpen={!!expanded.contact}
            onToggle={() => toggle('contact')}
            rightAction={
              expanded.contact ? (
                <NxTextButton title="Edit" icon="edit" onPress={() => setEditing(true)} />
              ) : null
            }
          />
          {expanded.contact ? (
            <View style={styles.sectionBody}>
              <NxRow label="Email" value={driver.email || '—'} />
              <NxRow label="Date of birth" value={displayDate(driver.dob) || '—'} />
              <NxRow label="Address" value={[driver.address, driver.city, driver.pincode].filter(Boolean).join(', ') || '—'} />
              <NxRow
                label="Emergency contact"
                value={driver.emergencyContact ? `${driver.emergencyContactName} (${driver.emergencyContact})` : '—'}
              />
              <NxRow label="Account holder" value={bank.accountHolder || '—'} />
              <NxRow label="Account no." value={bank.accountNumber ? `••••${bank.accountNumber.slice(-4)}` : '—'} />
              <NxRow label="IFSC" value={bank.ifsc || '—'} />
              <NxRow label="UPI" value={bank.upiId || '—'} />
            </View>
          ) : null}
        </NxPanel>

        {/* Section 4: Licence & ID */}
        <NxPanel style={styles.sectionPanel}>
          <AccordionHeader
            icon="document"
            title="Licence & ID"
            subtitle={license.number ? `DL: ${license.number} · Till ${displayDate(license.expiryDate)}` : 'Licence details'}
            isOpen={!!expanded.license}
            onToggle={() => toggle('license')}
          />
          {expanded.license ? (
            <View style={styles.sectionBody}>
              <NxRow label="Licence no." value={license.number || '—'} />
              <NxRow label="Licence valid till" value={displayDate(license.expiryDate) || '—'} />
              <NxRow
                label="Aadhaar"
                value={identity.aadhaarNumber ? `XXXX XXXX ${identity.aadhaarNumber.slice(-4)}` : '—'}
              />
              <NxRow label="PAN" value={identity.panNumber || '—'} />
            </View>
          ) : null}
        </NxPanel>

        {/* Section 5: Document Verification */}
        <NxPanel style={styles.sectionPanel}>
          <AccordionHeader
            icon="shield"
            title="Document verification"
            subtitle="Licence and vehicle papers"
            badge={<NxBadge label={driver.docStatus} tone={docTone} />}
            isOpen={!!expanded.documents}
            onToggle={() => toggle('documents')}
          />
          {expanded.documents ? (
            <View style={styles.sectionBody}>
              <DocRow label="Driving licence (front)" url={license.frontPhotoUrl} expiry={license.expiryDate} />
              <DocRow label="Driving licence (back)" url={license.backPhotoUrl} />
              <DocRow label="Aadhaar (front)" url={identity.aadhaarFrontUrl} />
              <DocRow label="Aadhaar (back)" url={identity.aadhaarBackUrl} />
              <DocRow label="PAN" url={identity.panPhotoUrl} />
              <DocRow label="Registration certificate (RC)" url={vehicle.rcDocUrl} />
              <DocRow label="Vehicle insurance" url={vehicle.insuranceDocUrl} expiry={vehicle.insuranceExpiry} />
              <DocRow label="Vehicle permit" url={vehicle.statePermitDocUrl} expiry={vehicle.permitExpiry} />
              <DocRow label="Fitness certificate (FC)" url={vehicle.fitnessDocUrl} expiry={vehicle.fitnessExpiry} />
              <DocRow label="Vehicle photo · front" url={vehicle.frontPhotoUrl} />
              <DocRow label="Vehicle photo · rear" url={vehicle.rearPhotoUrl} />
              <DocRow label="Vehicle photo · side" url={vehicle.sidePhotoUrl} />
              <DocRow label="Vehicle photo · interior" url={vehicle.interiorPhotoUrl} />
              <NxButton
                title="Update documents"
                trailingIcon="arrow"
                onPress={() => navigation.navigate('UpdateDocuments' as never)}
                style={{ marginTop: 18 }}
              />
            </View>
          ) : null}
        </NxPanel>

        {/* Section 6: Help & Sign Out */}
        <NxPanel style={styles.sectionPanel}>
          <AccordionHeader
            icon="help"
            title="Help & sign out"
            subtitle="Support, SOS & application version"
            isOpen={!!expanded.help}
            onToggle={() => toggle('help')}
          />
          {expanded.help ? (
            <View style={styles.sectionBody}>
              <View style={{ gap: 14 }}>
                <NxTextButton title="Help & SOS" icon="help" onPress={() => openSupport()} />
                <NxTextButton title="Email NESAM" icon="help" onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
                <NxTextButton title="Delete my account" icon="logout" onPress={confirmDeletion} />
                <NxTextButton title="Sign out" icon="logout" onPress={confirmSignOut} />
              </View>
              <Text style={[nxText.small, { marginTop: 16 }]}>
                NESAM Driver v{Constants.expoConfig?.version ?? '1.0.0'}
              </Text>
              <Text style={[nxText.small, { marginTop: 4 }]}>
                © {new Date().getFullYear()} {COMPANY_LEGAL_NAME}. All rights reserved.
              </Text>
            </View>
          ) : null}
        </NxPanel>
      </NxColumns>

      {editing ? (
        <ContactDialog
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setSaved(true);
          }}
        />
      ) : null}
    </NxScreen>
  );
}

/** A real calendar date in YYYY-MM-DD form (rejects 2001-02-30). */
function isRealDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

function ContactDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { account } = useDriverData();
  const { driver, bank } = account;
  const [form, setForm] = useState<ContactFields>({
    email: driver.email,
    dob: driver.dob,
    address: driver.address,
    city: driver.city,
    pincode: driver.pincode,
    emergencyContactName: driver.emergencyContactName,
    emergencyContact: driver.emergencyContact,
    bank: { ...bank },
  });
  const [confirm, setConfirm] = useState(bank.accountNumber);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<ContactFields>) => setForm((f) => ({ ...f, ...patch }));
  const setBank = (patch: Partial<ContactFields['bank']>) => setForm((f) => ({ ...f, bank: { ...f.bank, ...patch } }));

  const save = async () => {
    if (form.email && !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(form.email.trim())) return setError('Invalid email.');
    // A previously saved value is kept as it is; a newly picked date must be a real, non-future date.
    if (form.dob && form.dob !== driver.dob && (!isRealDate(form.dob) || form.dob > localDateISO())) return setError('Enter a valid date of birth (not in the future).');
    if (!form.address.trim() || !form.city.trim()) return setError('Enter your address and city.');
    if (!/^[1-9]\d{5}$/.test(form.pincode)) return setError('Enter a 6-digit pincode.');
    if (!form.emergencyContactName.trim()) return setError('Enter the emergency contact name.');
    if (!MOBILE_RE.test(form.emergencyContact)) return setError('Enter a valid emergency contact number.');
    if (!form.bank.accountHolder.trim()) return setError('Enter the account holder name.');
    if (!/^\d{9,18}$/.test(form.bank.accountNumber)) return setError('Enter a valid bank account number.');
    if (confirm !== form.bank.accountNumber) return setError('Account numbers do not match.');
    if (!IFSC_RE.test(form.bank.ifsc.toUpperCase())) return setError('Invalid IFSC code.');
    if (form.bank.upiId && !UPI_RE.test(form.bank.upiId)) return setError('Invalid UPI ID.');
    setSaving(true);
    setError('');
    try {
      await updateDriverContactDetails(driver.id, {
        ...form,
        email: form.email.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        emergencyContactName: form.emergencyContactName.trim(),
        bank: { ...form.bank, ifsc: form.bank.ifsc.toUpperCase(), accountHolder: form.bank.accountHolder.trim() },
      });
      onSaved();
    } catch (e) {
      setError(describeError(e, 'Could not save your changes.'));
    } finally {
      setSaving(false);
    }
    return undefined;
  };

  return (
    <NxDialog visible onClose={onClose} eyebrow="PROFILE" title="Edit contact & payout account" locked={saving}>
      <NxField label="Email" value={form.email} onChangeText={(t) => set({ email: t })} keyboardType="email-address" autoCapitalize="none" style={{ marginTop: 0 }} />
      <View style={{ marginTop: 16 }}>
        <DateField label="Date of birth" value={form.dob} onChange={(d) => set({ dob: d })} maximumDate={new Date()} />
      </View>
      <NxField label="Address" value={form.address} onChangeText={(t) => set({ address: t })} multiline />
      <NxField label="City" value={form.city} onChangeText={(t) => set({ city: t })} />
      <NxField label="Pincode" value={form.pincode} onChangeText={(t) => set({ pincode: t.replace(/\D/g, '').slice(0, 6) })} keyboardType="number-pad" />
      <NxField label="Emergency contact name" value={form.emergencyContactName} onChangeText={(t) => set({ emergencyContactName: t })} />
      <NxField label="Emergency mobile" value={form.emergencyContact} onChangeText={(t) => set({ emergencyContact: t.replace(/\D/g, '').slice(0, 10) })} keyboardType="phone-pad" />
      <Text style={[nxText.heading, { fontSize: 14, marginTop: 22 }]}>Bank account</Text>
      <NxField label="Account holder" value={form.bank.accountHolder} onChangeText={(t) => setBank({ accountHolder: t })} />
      <NxField label="Account number" value={form.bank.accountNumber} onChangeText={(t) => setBank({ accountNumber: t.replace(/\D/g, '').slice(0, 18) })} keyboardType="number-pad" secureTextEntry />
      <NxField label="Confirm account number" value={confirm} onChangeText={(t) => setConfirm(t.replace(/\D/g, '').slice(0, 18))} keyboardType="number-pad" contextMenuHidden />
      <NxField label="IFSC" value={form.bank.ifsc} onChangeText={(t) => setBank({ ifsc: t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11) })} autoCapitalize="characters" />
      <NxField label="Bank name" value={form.bank.bankName} onChangeText={(t) => setBank({ bankName: t })} />
      <NxField label="UPI ID" value={form.bank.upiId} onChangeText={(t) => setBank({ upiId: t.trim() })} autoCapitalize="none" />
      <NxFormError message={error} />
      <NxButton title={saving ? 'Saving…' : 'Save changes'} trailingIcon="check" loading={saving} onPress={() => void save()} style={{ marginTop: 14 }} />
    </NxDialog>
  );
}

const styles = StyleSheet.create({
  sectionPanel: {
    padding: 0,
    overflow: 'hidden',
    borderRadius: 14,
    marginBottom: 12,
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    paddingHorizontal: 16,
    minHeight: 58,
    backgroundColor: nx.white,
  },
  accordionHeaderOpen: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: nx.line,
    backgroundColor: '#FAFAFB',
  },
  accordionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  accordionIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  accordionIconWrapOpen: {
    backgroundColor: nx.redSoft,
  },
  accordionTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  accordionTitle: {
    fontFamily: POPPINS.bold,
    fontSize: 14.5,
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  accordionSubtitle: {
    fontFamily: POPPINS.regular,
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  accordionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chevronWrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '0deg' }],
  },
  chevronRotated: {
    transform: [{ rotate: '90deg' }],
  },
  sectionBody: {
    padding: 16,
    backgroundColor: nx.white,
  },
  identityHead: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 12,
  },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: nx.redSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 24,
    fontFamily: POPPINS.bold,
    color: nx.red,
  },
  name: {
    fontSize: 19,
    fontFamily: POPPINS.bold,
    letterSpacing: -0.4,
    color: nx.ink,
    marginBottom: 4,
  },
  details: {
    alignSelf: 'stretch',
    marginTop: 6,
  },
  doc: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: nx.line,
  },
  docLabel: {
    flex: 1,
    fontSize: 12,
    fontFamily: POPPINS.regular,
    color: nx.ink,
  },
  earningsSummaryBox: {
    backgroundColor: nx.redSoft,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    alignItems: 'center',
  },
  earningsSummaryLabel: {
    fontSize: 11.5,
    fontFamily: POPPINS.medium,
    color: nx.red,
  },
  earningsTotal: {
    fontSize: 26,
    fontFamily: POPPINS.bold,
    color: nx.red,
    marginTop: 4,
    letterSpacing: -0.5,
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 120,
    gap: 8,
    paddingTop: 16,
    paddingBottom: 4,
    marginTop: 8,
  },
  col: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  track: {
    flex: 1,
    width: '100%',
    backgroundColor: '#F1F5F9',
    borderRadius: 4,
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    backgroundColor: '#94A3B8',
    borderRadius: 4,
    minHeight: 4,
  },
  barNow: {
    backgroundColor: nx.red,
  },
  day: {
    fontSize: 10,
    fontFamily: POPPINS.medium,
    color: nx.muted,
  },
  settlementBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
  },
  settlementHeading: {
    fontSize: 12.5,
    fontFamily: POPPINS.bold,
    color: nx.ink,
  },
  settlementAmount: {
    fontSize: 20,
    fontFamily: POPPINS.bold,
    color: nx.ink,
    marginTop: 2,
    marginBottom: 4,
  },
});

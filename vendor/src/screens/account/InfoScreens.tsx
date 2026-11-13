// Business & contact (approved vendors may update contact details only — firestore.rules), Agreements accepted,
// and Alerts (notifications by category, each opening the page it is about).
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/kit/Text';
import { Ionicons } from '@expo/vector-icons';
import { useVendorData } from '../../context/VendorData';
import { useInbox } from '../../context/Inbox';
import { Page } from '../../components/shell/Page';
import { Sheet, TextField } from '../../components/ui';
import { SelectField } from '../../components/SelectField';
import { Badge, Between, Btn, Empty, Feedback, Grid, H2, KV, Notice, Panel, Small, Tabs, TextLink } from '../../components/kit/core';
import { dayTime } from '../../components/kit/format';
import { flash } from '../../components/kit/flash';
import { updateApprovedContactInfo } from '../../services/onboardingService';
import { currentTextOf, subscribeToMyAcceptances, type Acceptance } from '../../services/agreements';
import { markNotificationRead, markNotificationsRead } from '../../services/partnerNotifications';
import { INDIAN_STATES } from '../../config/onboarding';
import { CATEGORIES, CATEGORY_LABEL, TONE_COLORS, toneOf } from '../../utils/notificationModel';
import type { NotificationCategory } from '../../types/notifications';
import { digitsOnly, hasErrors, normalizeSpaces, validateAltPhone, validateEmail, validatePincode, validateRequired } from '../../utils/validation';
import { formatPhone } from '../../utils/format';
import { describeDataError } from '../../utils/retry';
import { openPage } from '../../navigation/openPage';
import { colors, fontFamily } from '../../theme';

export function BusinessScreen() {
  const { record, profile } = useVendorData();
  const b = record.business;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    email: b?.email ?? '', altPhone: b?.altPhone ?? '', line1: b?.address.line1 ?? '', line2: b?.address.line2 ?? '',
    city: b?.address.city ?? '', state: b?.address.state ?? '', pincode: b?.address.pincode ?? '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const errors = {
    email: validateEmail(form.email), altPhone: validateAltPhone(form.altPhone, record.phone), line1: validateRequired(form.line1, 'Address line 1', 150),
    city: validateRequired(form.city, 'City', 60), state: form.state ? '' : 'Select a state.', pincode: validatePincode(form.pincode),
  };
  const err = (k: keyof typeof errors) => (submitted ? errors[k] : '');
  const save = async () => {
    setSubmitted(true);
    if (!b || hasErrors(errors) || busy) return;
    setBusy(true); setError('');
    try {
      await updateApprovedContactInfo(b, {
        email: form.email.trim().toLowerCase(), altPhone: digitsOnly(form.altPhone),
        address: { line1: normalizeSpaces(form.line1), line2: normalizeSpaces(form.line2), city: normalizeSpaces(form.city), state: form.state, pincode: form.pincode.trim() },
      });
      setEditing(false);
      flash('Contact details updated.');
    } catch (e) { setError(describeDataError(e)); } finally { setBusy(false); }
  };

  return (
    <Page title="Business & contact" subtitle="Legal names and bank details are changed only by NESAM support.">
      <Grid>
        <Panel style={{ flexGrow: 1 }}>
          <H2>Business</H2>
          <KV rows={[['Business name', profile.companyName || '—'], ['Owner / representative', profile.contactPerson || b?.vendorName || '—'], ['Registered mobile', formatPhone(profile.phone)], ['GSTIN', profile.gstin || '—'], ['PAN', profile.panNumber || '—'], ['Fleet size (declared)', String(profile.totalFleetSize || '—')], b?.operatingCity ? ['Operating city', b.operatingCity] : null]} />
        </Panel>
        <Panel style={{ flexGrow: 1 }}>
          <Between><H2>Contact</H2>{!editing ? <TextLink title="Edit" icon="create-outline" onPress={() => setEditing(true)} /> : null}</Between>
          {editing ? (
            <View style={{ marginTop: 14 }}>
              <TextField label="Email" required value={form.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" error={err('email')} />
              <TextField label="Alternate number" prefix="+91" value={form.altPhone} onChangeText={(v) => set('altPhone')(digitsOnly(v).slice(0, 10))} keyboardType="phone-pad" error={err('altPhone')} />
              <TextField label="Address line 1" required value={form.line1} onChangeText={set('line1')} error={err('line1')} />
              <TextField label="Address line 2" value={form.line2} onChangeText={set('line2')} />
              <TextField label="City" required value={form.city} onChangeText={set('city')} error={err('city')} />
              <SelectField label="State / UT" required value={form.state} onChange={set('state')} options={INDIAN_STATES.map((s) => ({ value: s, label: s }))} error={err('state')} />
              <TextField label="PIN code" required value={form.pincode} onChangeText={(v) => set('pincode')(digitsOnly(v).slice(0, 6))} keyboardType="number-pad" error={err('pincode')} />
              <Feedback tone="error" message={error} />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Btn kind="secondary" title="Cancel" disabled={busy} onPress={() => setEditing(false)} style={{ flex: 1 }} />
                <Btn title="Save" icon="checkmark" busy={busy} onPress={() => void save()} style={{ flex: 1 }} />
              </View>
            </View>
          ) : (
            <KV rows={[['Email', b?.email || '—'], ['Alternate number', b?.altPhone ? `+91 ${b.altPhone}` : '—'], ['Address', b ? [b.address.line1, b.address.line2, b.address.city, `${b.address.state} ${b.address.pincode}`].filter((x) => x && x.trim()).join(', ') : '—']]} />
          )}
        </Panel>
      </Grid>
    </Page>
  );
}

export function AgreementsScreen() {
  const { profile } = useVendorData();
  const [list, setList] = useState<Acceptance[] | null>(null);
  const [view, setView] = useState<{ a: Acceptance; body: string; current: boolean } | null>(null);
  const [loading, setLoading] = useState('');
  useEffect(() => subscribeToMyAcceptances(profile.id, setList, () => setList([])), [profile.id]);
  const open = async (a: Acceptance) => {
    setLoading(a.id);
    try { setView({ a, ...(await currentTextOf(a)) }); } catch { setView({ a, body: '', current: false }); } finally { setLoading(''); }
  };
  return (
    <Page title="Agreement & accepted copy" subtitle="Who accepted which version, and when.">
      {list === null ? <Small>Loading…</Small> : list.length === 0 ? (
        <Empty icon="document-text-outline" title="No agreements recorded yet" text="When NESAM publishes terms for fleet partners, the ones you accept are listed here with the version and time." />
      ) : (
        <Grid>
          {list.map((a) => (
            <Panel key={a.id} style={{ flexGrow: 1 }}>
              <Between><Badge label={`Version ${a.version}`} tone="green" /><Small>{a.source}</Small></Between>
              <H2 style={{ marginTop: 12 }}>{a.title}</H2>
              <Small style={{ marginTop: 4 }}>Accepted {dayTime(a.acceptedAt)}</Small>
              <Btn kind="secondary" small icon="reader-outline" title="Read accepted copy" busy={loading === a.id} onPress={() => void open(a)} style={{ marginTop: 14, alignSelf: 'flex-start' }} />
            </Panel>
          ))}
        </Grid>
      )}
      {view ? (
        <Sheet visible onClose={() => setView(null)} title={view.a.title}>
          <View style={styles.accepted}><Ionicons name="checkmark-circle" size={16} color={colors.success} /><Text style={styles.acceptedText}>Accepted copy · v{view.a.version} · {dayTime(view.a.acceptedAt)}</Text></View>
          {view.current && view.body ? <Text style={styles.body}>{view.body}</Text>
            : <Notice tone="amber" title="A newer version is in force" text="This version's text is not shown here. The NESAM office can send you the exact copy you accepted." />}
        </Sheet>
      ) : null}
    </Page>
  );
}

export function AlertsScreen() {
  const { notifications } = useInbox();
  const [filter, setFilter] = useState<NotificationCategory | 'all'>('all');
  const shown = filter === 'all' ? notifications : notifications.filter((n) => n.category === filter);
  const unread = (c: NotificationCategory | 'all') => notifications.filter((n) => !n.read && (c === 'all' || n.category === c)).length;
  const markAll = () => markNotificationsRead(notifications.filter((n) => !n.read).map((n) => n.id)).catch(() => flash('Could not mark them read. Check your connection.', 'error'));
  return (
    <Page
      title="Notifications"
      action={unread('all') > 0 ? <Btn kind="secondary" small icon="checkmark-done-outline" title="Mark all as read" onPress={markAll} /> : undefined}
    >
      <Tabs value={filter} onChange={setFilter} style={{ marginTop: 0 }} items={[{ id: 'all' as const, label: 'All', count: unread('all') || undefined }, ...CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABEL[c], count: unread(c) || undefined }))]} />
      {shown.length === 0 ? <Empty icon="notifications-outline" title="No notifications" text="Updates from NESAM appear here." /> : (
        <View style={{ gap: 10 }}>
          {shown.map((n) => {
            const tone = TONE_COLORS[toneOf(n)];
            return (
              <Pressable key={n.id} accessibilityRole="button"
                onPress={() => { if (!n.read) markNotificationRead(n.id).catch(() => undefined); openPage(n.ctaPage, n.bookingId || undefined); }}
                style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.item, !n.read && { borderColor: tone.border, backgroundColor: tone.bg }, hovered && { borderColor: '#D8DFE9' }]}>
                <View style={[styles.dot, { backgroundColor: n.read ? colors.border : tone.bar }]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cat}>{CATEGORY_LABEL[n.category].toUpperCase()}{n.bookingCode ? ` · ${n.bookingCode}` : ''}</Text>
                  <Text style={[styles.title, !n.read && { fontWeight: '600' }]}>{n.title}</Text>
                  <Small style={{ marginTop: 3 }}>{n.message}</Small>
                  <Between style={{ marginTop: 8 }}><Small style={{ color: colors.faint }}>{n.time}</Small><Text style={styles.cta}>{n.ctaLabel} ›</Text></Between>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  accepted: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.successSoft, borderRadius: 9, padding: 11, marginBottom: 14 },
  acceptedText: { fontFamily, fontSize: 12, color: colors.success, fontWeight: '500' },
  body: { fontFamily, fontSize: 13.5, lineHeight: 22, color: colors.text },
  item: { flexDirection: 'row', gap: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 13, padding: 16 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  cat: { fontFamily, fontSize: 10, fontWeight: '600', letterSpacing: 0.8, color: colors.muted, marginBottom: 3 },
  title: { fontFamily, fontSize: 14, color: colors.ink, fontWeight: '500' },
  cta: { fontFamily, fontSize: 12, color: colors.primary, fontWeight: '600' },
});

// Swap vehicle or driver (formerly Linking requests) and Documents & verification (reference wDocuments).
import React, { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/kit/Text';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useVendorData } from '../../context/VendorData';
import { Page } from '../../components/shell/Page';
import { displayDate } from '../../components/fields';
import { Avatar, Badge, Between, Btn, Empty, Grid, H2, KV, Notice, Panel, SectionLine, Small, Tabs } from '../../components/kit/core';
import { dayTime, plate } from '../../components/kit/format';
import { flash } from '../../components/kit/flash';
import { linkIsOpen } from '../../services/partnerLinks';
import { resolveFileUrl } from '../../services/storageService';
import { BUSINESS_REG_TYPES, IDENTITY_PROOF_TYPES } from '../../config/onboarding';
import { EXPIRY_WARNING_DAYS } from '../../config/constants';
import type { StoredFile } from '../../types/vendor';
import { daysUntil } from '../../utils/wallet';
import { describeDataError } from '../../utils/retry';
import { CodePanel, fromLabel, linkText, linkTone } from './sheets';
import { SwapDriver, SwapVehicle } from './SwapFlows';
import { VEHICLE_DOCS } from './logic';
import { colors, fontFamily } from '../../theme';

type SwapTab = 'vehicle' | 'driver';

/** Swap a vehicle or a driver that is already on NESAM into this fleet, and follow the requests that are still open. */
export function LinkingScreen() {
  const navigation = useNavigation();
  const { links, profile, bookings, errors } = useVendorData();
  const [tab, setTab] = useState<SwapTab>('vehicle');
  // A request just made is shown (with its code box) inside the flow, so it is left out of the open list below.
  const [shown, setShown] = useState<string[]>([]);

  // Still open: mine waiting for a code or for the office, and other fleets asking to take one of mine.
  const open = links.filter((l) => linkIsOpen(l) && !shown.includes(l.id) && (l.toVendorId === profile.id || l.fromVendorId === profile.id));

  return (
    <Page maxWidth={700}>
      {errors.links ? <Notice tone="red" title="Requests could not load" text={errors.links} style={{ marginBottom: 12 }} /> : null}
      <Tabs fill value={tab} onChange={setTab} items={[{ id: 'vehicle', label: 'Swap vehicle' }, { id: 'driver', label: 'Swap driver' }]} />
      {tab === 'vehicle' ? <SwapVehicle onSent={(id) => setShown((x) => [...x, id])} /> : <SwapDriver onSent={(id) => setShown((x) => [...x, id])} />}

      {open.length ? (
        <View style={{ marginTop: 28 }}>
          <SectionLine title="Open requests" meta={`${open.length}`} />
          <View style={{ gap: 16 }}>
            {open.map((l) => {
              const mine = l.toVendorId === profile.id;
              // Booked duties of mine that hold up a move: reassign them so the request can finish.
              const holding = l.blockedBookingIds.map((id) => bookings.find((b) => b.id === id)).filter((b): b is NonNullable<typeof b> => !!b);
              return (
                <Panel key={l.id}>
                  <Between><Small>{l.kind === 'driver' ? 'Driver' : 'Vehicle'} · {l.id.slice(0, 8).toUpperCase()}</Small><Badge label={linkText[l.status]} tone={linkTone[l.status]} /></Between>
                  <View style={styles.head}>
                    {l.kind === 'driver' ? <Avatar name={l.subjectLabel} size={42} /> : <View style={styles.carIcon}><Ionicons name="car-sport-outline" size={21} color="#6F7785" /></View>}
                    <View style={{ flex: 1 }}>
                      <H2>{l.kind === 'vehicle' ? plate(l.subjectLabel) : l.subjectLabel}</H2>
                      <Small>{mine ? 'Coming to your fleet' : 'Another fleet asked for this'}</Small>
                    </View>
                  </View>
                  <KV rows={[['From', fromLabel(l)], ['To', l.toVendorName], ['Requested', dayTime(l.createdAt)]]} />
                  {!mine ? (
                    <Notice tone="amber" icon="swap-horizontal-outline" title={`${l.toVendorName} asked to take this from your fleet`}
                      text={l.blockedReason || 'Reassign any booked duties of this record first; the NESAM office finishes the move once nothing is open.'} style={{ marginTop: 12 }} />
                  ) : null}
                  {!mine && holding.length ? (
                    <View style={{ marginTop: 10, gap: 8 }}>
                      <Small>Reassign these duties so it can move:</Small>
                      {holding.map((b) => <Btn key={b.id} kind="secondary" small icon="ticket-outline" title={`${b.bookingId} · ${b.driverName || b.vehicleNumber || 'open duty'}`} onPress={() => navigation.navigate('Booking', { id: b.id })} />)}
                    </View>
                  ) : null}
                  {mine ? <View style={{ marginTop: 14 }}><CodePanel link={l} /></View> : null}
                </Panel>
              );
            })}
          </View>
        </View>
      ) : null}
    </Page>
  );
}

function FileRow({ file }: { file: StoredFile }) {
  const [opening, setOpening] = useState(false);
  const open = async () => {
    setOpening(true);
    try { await Linking.openURL(await resolveFileUrl(file.path)); } catch (e) { flash(describeDataError(e), 'error'); } finally { setOpening(false); }
  };
  return (
    <Pressable style={styles.file} onPress={() => void open()} disabled={opening} accessibilityRole="button" accessibilityLabel={`Open ${file.name}`}>
      <Ionicons name={file.contentType === 'application/pdf' ? 'document-text-outline' : 'image-outline'} size={18} color="#6F7785" />
      <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
      <Text style={styles.open}>{opening ? 'Opening…' : 'Open'}</Text>
    </Pressable>
  );
}

export function DocumentsScreen() {
  const navigation = useNavigation();
  const { record, vehicles, drivers } = useVendorData();
  const rows = useMemo(() => {
    const out: { key: string; title: string; sub: string; date: string; days: number | null; onPress: () => void; pending: boolean; rejected: boolean }[] = [];
    for (const v of vehicles) {
      for (const doc of VEHICLE_DOCS) {
        out.push({ key: `${v.id}-${doc.key}`, title: plate(v.vehicleNumber), sub: `${doc.label} · Vehicle`, date: v[doc.key], days: daysUntil(v[doc.key]), onPress: () => navigation.navigate('Vehicle', { id: v.id }), pending: v.docStatus === 'Pending', rejected: v.docStatus === 'Rejected' });
      }
    }
    for (const x of drivers) {
      out.push({ key: `${x.id}-dl`, title: x.name, sub: 'Driving licence · Driver', date: x.licenseExpiry, days: daysUntil(x.licenseExpiry), onPress: () => navigation.navigate('Driver', { id: x.id }), pending: x.approvalStatus !== 'Approved' && x.approvalStatus !== 'Rejected', rejected: x.approvalStatus === 'Rejected' || x.docStatus === 'Rejected' });
    }
    return out.sort((a, b) => Number(b.rejected) - Number(a.rejected) || (a.days ?? 99999) - (b.days ?? 99999));
  }, [vehicles, drivers, navigation]);

  const d = record.documents;
  const f = record.fleet;
  const groups: [string, StoredFile[] | undefined, string?][] = [
    ...(d ? [[BUSINESS_REG_TYPES.find((t) => t.value === d.businessRegistration.type)?.label ?? 'Business registration', d.businessRegistration.files, d.businessRegistration.number] as [string, StoredFile[], string]] : []),
    ...(d ? [[IDENTITY_PROOF_TYPES.find((t) => t.value === d.identityProof.type)?.label ?? 'Identity proof', d.identityProof.files, d.identityProof.maskedNumber] as [string, StoredFile[], string]] : []),
    ['Vehicle RCs (onboarding)', f?.rcFiles],
    ['Insurance (onboarding)', f?.insuranceFiles],
    ['Fitness certificates (onboarding)', f?.fcFiles],
    ['Permits (onboarding)', f?.permitFiles],
    ['Vehicle photos (onboarding)', f?.vehiclePhotos],
  ];

  return (
    <Page title="Documents & verification" subtitle="A hold applies only to the affected Driver ID or Car ID.">
      <SectionLine title="Fleet compliance" meta={`${rows.length} documents`} />
      {rows.length === 0 ? <Empty icon="document-text-outline" title="No fleet documents yet" text="Add vehicles and drivers in Fleet; their document validity appears here." /> : (
        <Panel style={{ paddingVertical: 6 }}>
          {rows.map((r, i) => {
            const tone = r.rejected ? 'red' : r.pending ? 'amber' : r.days === null ? 'neutral' : r.days < 0 ? 'red' : r.days <= EXPIRY_WARNING_DAYS ? 'amber' : 'green';
            const label = r.rejected ? 'Rejected' : r.pending ? 'Under review' : r.days === null ? 'Not recorded' : r.days < 0 ? 'Expired' : r.days <= EXPIRY_WARNING_DAYS ? 'Expiring soon' : 'Valid';
            return (
              <Pressable key={r.key} onPress={r.onPress} accessibilityRole="button" style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.docRow, i === rows.length - 1 && { borderBottomWidth: 0 }, hovered && { backgroundColor: '#FAFAFB' }]}>
                <Ionicons name="document-text-outline" size={20} color="#8B919C" />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.docTitle} numberOfLines={1}>{r.title}</Text>
                  <Small>{r.sub} · {r.date ? displayDate(r.date) : 'Awaiting verification'}</Small>
                </View>
                <Badge label={label} tone={tone} />
                <Ionicons name="chevron-forward" size={15} color="#A9AEB8" />
              </Pressable>
            );
          })}
        </Panel>
      )}
      <View style={{ height: 24 }} />
      <SectionLine title="Business documents" />
      <Notice tone="neutral" icon="lock-closed-outline" title="Locked after approval" text="To replace a business document, contact NESAM partner support. Vehicle documents are renewed from each vehicle." style={{ marginBottom: 16 }} />
      <Grid>
        {groups.map(([title, files, sub]) => (
          <Panel key={title} style={{ flexGrow: 1 }}>
            <H2 style={{ fontSize: 14 }}>{title}</H2>
            {sub ? <Small>{sub}</Small> : null}
            <View style={{ marginTop: 8 }}>{files?.length ? files.map((file) => <FileRow key={file.path} file={file} />) : <Small>No files.</Small>}</View>
          </Panel>
        ))}
      </Grid>
    </Page>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  carIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#F6F7F9', alignItems: 'center', justifyContent: 'center' },
  file: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderTopWidth: 1, borderTopColor: '#F1F2F5' },
  fileName: { flex: 1, fontFamily, fontSize: 13, color: colors.ink },
  open: { fontFamily, fontSize: 12.5, color: colors.primary, fontWeight: '600' },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#F1F2F5' },
  docTitle: { fontFamily, fontSize: 13.5, fontWeight: '500', color: colors.ink },
});

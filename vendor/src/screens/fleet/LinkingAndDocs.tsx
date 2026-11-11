// Linking requests (reference wLinking / wLinkPage) and Documents & verification (reference wDocuments).
import React, { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useVendorData } from '../../context/VendorData';
import { Page } from '../../components/shell/Page';
import { displayDate } from '../../components/fields';
import { Avatar, Badge, Between, Btn, Empty, Grid, H2, Inline, KV, Notice, Panel, SectionLine, Small, Tabs } from '../../components/kit/core';
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
import { VEHICLE_DOCS } from './logic';
import { colors, fontFamily } from '../../theme';

type LinkTab = 'open' | 'away' | 'history';

export function LinkingScreen() {
  const navigation = useNavigation();
  const { links, profile } = useVendorData();
  const [tab, setTab] = useState<LinkTab>('open');
  const open = links.filter((l) => l.toVendorId === profile.id && linkIsOpen(l));
  const away = links.filter((l) => l.fromVendorId === profile.id && l.toVendorId !== profile.id && linkIsOpen(l));
  const history = links.filter((l) => !linkIsOpen(l));
  const list = tab === 'open' ? open : tab === 'away' ? away : history;

  return (
    <Page title="Linking requests" subtitle="Permanent IDs and attachment changes.">
      <Notice tone="neutral" icon="link-outline" title="One permanent ID for every driver and vehicle" text="Linking a driver or vehicle already on NESAM needs a code from the person concerned, or office verification. Previous duty history and settlements are retained." />
      <Tabs value={tab} onChange={setTab} items={[{ id: 'open', label: 'Needs action', count: open.length }, { id: 'away', label: 'Leaving my fleet', count: away.length }, { id: 'history', label: 'History', count: history.length }]} />
      {list.length === 0 ? (
        <Empty icon="link-outline" title={tab === 'open' ? 'Nothing is waiting' : tab === 'away' ? 'Nobody is taking a driver or car from you' : 'No past requests'}
          text={tab === 'open' ? 'When you add a driver or vehicle already on NESAM, the request and its code appear here.' : 'Completed and declined requests are kept here.'}
          action={tab === 'open' ? (
            <Inline style={{ gap: 10, justifyContent: 'center' }}>
              <Btn kind="secondary" small icon="person-add-outline" title="Add driver" onPress={() => navigation.navigate('FleetAdd', { kind: 'driver' })} />
              <Btn kind="secondary" small icon="car-outline" title="Add vehicle" onPress={() => navigation.navigate('FleetAdd', { kind: 'vehicle' })} />
            </Inline>
          ) : undefined} />
      ) : (
        <Grid>
          {list.map((l) => {
            const mine = l.toVendorId === profile.id;
            return (
              <Panel key={l.id} style={{ flexGrow: 1 }}>
                <Between><Small>{l.kind === 'driver' ? 'Driver' : 'Vehicle'} · {l.id.slice(0, 8).toUpperCase()}</Small><Badge label={linkText[l.status]} tone={linkTone[l.status]} /></Between>
                <View style={styles.head}>
                  {l.kind === 'driver' ? <Avatar name={l.subjectLabel} size={42} /> : <View style={styles.carIcon}><Ionicons name="car-sport-outline" size={21} color="#5B6F86" /></View>}
                  <View style={{ flex: 1 }}>
                    <H2>{l.kind === 'vehicle' ? plate(l.subjectLabel) : l.subjectLabel}</H2>
                    <Small>{l.kind === 'driver' ? (l.subjectKind === 'owner_driver' ? 'Owner-driver joins a fleet' : 'Driver changes fleet') : 'Vehicle attachment'}</Small>
                  </View>
                </View>
                <KV rows={[['From', fromLabel(l)], ['To', l.toVendorName], ['Requested', dayTime(l.createdAt)], l.method ? ['Finished by', l.method] : null]} />
                {!mine && l.status !== 'Completed' ? <Notice tone="amber" title={`${l.toVendorName} asked to take this from your fleet`} text="The office will check with you if anything is open." style={{ marginTop: 12 }} /> : null}
                {!mine && l.status === 'Completed' ? <Notice tone="neutral" title={`Moved to ${l.toVendorName}`} style={{ marginTop: 12 }} /> : null}
                {mine ? <View style={{ marginTop: 14 }}><CodePanel link={l} /></View> : null}
              </Panel>
            );
          })}
        </Grid>
      )}
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
      <Ionicons name={file.contentType === 'application/pdf' ? 'document-text-outline' : 'image-outline'} size={18} color="#5B6F86" />
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
              <Pressable key={r.key} onPress={r.onPress} accessibilityRole="button" style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.docRow, i === rows.length - 1 && { borderBottomWidth: 0 }, hovered && { backgroundColor: '#FAFBFD' }]}>
                <Ionicons name="document-text-outline" size={20} color="#7B8FA5" />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.docTitle} numberOfLines={1}>{r.title}</Text>
                  <Small>{r.sub} · {r.date ? displayDate(r.date) : 'Awaiting verification'}</Small>
                </View>
                <Badge label={label} tone={tone} />
                <Ionicons name="chevron-forward" size={15} color="#A5B0BD" />
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
  carIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#F2F5F9', alignItems: 'center', justifyContent: 'center' },
  file: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderTopWidth: 1, borderTopColor: '#EEF1F5' },
  fileName: { flex: 1, fontFamily, fontSize: 13, color: colors.ink },
  open: { fontFamily, fontSize: 12.5, color: colors.primary, fontWeight: '600' },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#EEF1F5' },
  docTitle: { fontFamily, fontSize: 13.5, fontWeight: '500', color: colors.ink },
});

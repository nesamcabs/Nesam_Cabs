// Fleet — "Drivers and vehicles. One permanent ID each." (reference vVehicles): Vehicles / Drivers tabs with counts,
// search + status filter, linking and document shortcuts, and a card per vehicle or driver. Pending invitations show under Drivers.
import React, { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Text } from '../../components/kit/Text';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useVendorData } from '../../context/VendorData';
import { Page } from '../../components/shell/Page';
import { ActionButton, Avatar, Badge, Between, Btn, CarImage, Dropdown, Empty, Grid, Inline, Panel, SearchBox, SectionLine, Small, Tabs, TextLink, Toolbar } from '../../components/kit/core';
import { plate, shortId } from '../../components/kit/format';
import { flash } from '../../components/kit/flash';
import { displayDate } from '../../components/fields';
import { revokeInvite } from '../../services/vendorService';
import { formatPhone } from '../../utils/format';
import { describeDataError } from '../../utils/retry';
import type { FleetDriver, FleetVehicle } from '../../types/operations';
import type { FleetTab, RootStackParamList } from '../../navigation/types';
import { docTone, driverDocState, driverMatches, DRIVER_FILTERS, nextExpiry, vehicleDocState, vehicleMatches, VEHICLE_FILTERS, vehicleStatusLabel } from './logic';
import { SwapPanel } from './LinkingAndDocs';
import { LocalDutySheet, LocalDutyTab } from './LocalDuty';
import { colors, fontFamily } from '../../theme';
import { useLayout } from '../../theme/responsive';

export function FleetScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'Fleet'>>();
  const d = useVendorData();
  const { wide } = useLayout();
  const [tab, setTab] = useState<FleetTab>(route.params?.tab ?? 'Vehicles');
  const [seen, setSeen] = useState(route.params?.tab);
  if (route.params?.tab !== seen) { setSeen(route.params?.tab); if (route.params?.tab) setTab(route.params.tab); }
  // The Swap panel opens under the buttons on this page; arriving with a `swap` token (from the Profile / Helpdesk menus) opens it too.
  const [swapOpen, setSwapOpen] = useState(!!route.params?.swap);
  const [swapSeen, setSwapSeen] = useState(route.params?.swap);
  if (route.params?.swap !== swapSeen) { setSwapSeen(route.params?.swap); if (route.params?.swap) setSwapOpen(true); }
  const [planning, setPlanning] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const vehicles = tab === 'Vehicles';
  const local = tab === 'Local duty';

  const vList = d.vehicles.filter((v) => vehicleMatches(v, search, filter));
  const dList = d.drivers.filter((x) => driverMatches(x, search, filter));
  const invites = !vehicles && filter === 'All' && !search ? d.invites : [];
  const shown = vehicles ? vList.length : dList.length + invites.length;
  const switchTab = (t: FleetTab) => { setTab(t); setFilter('All'); setSwapOpen(false); };
  const tabItems = [{ id: 'Vehicles' as const, label: 'Vehicles', count: d.vehicles.length }, { id: 'Drivers' as const, label: 'Drivers', count: d.drivers.length + d.invites.length }, { id: 'Local duty' as const, label: 'Local duty' }];
  const noun = vehicles ? 'vehicle' : 'driver';
  // Add and Swap: the same size as the tabs (46 high), side by side; on desktop they sit at the right end of the tab row.
  const actions = local ? (
    <View style={[styles.actionRow, wide && { width: 220, marginBottom: 0 }]}>
      <ActionButton icon="navigate-outline" label="Start local duty" primary onPress={() => setPlanning(true)} />
    </View>
  ) : (
    <View style={[styles.actionRow, wide && { width: 380, marginBottom: 0 }]}>
      <ActionButton icon="add" label={`Add ${noun}`} onPress={() => navigation.navigate('FleetAdd', { kind: vehicles ? 'vehicle' : 'driver' })} />
      <ActionButton icon="swap-horizontal" label={`Swap ${noun}`} count={d.actionLinks.length} active={swapOpen} onPress={() => setSwapOpen((o) => !o)} />
    </View>
  );

  const revoke = (phone: string) => Alert.alert('Withdraw invitation?', `${formatPhone(phone)} will no longer be linked to your fleet when they register.`, [
    { text: 'Keep', style: 'cancel' },
    { text: 'Withdraw', style: 'destructive', onPress: () => { revokeInvite(phone).then(() => flash('Invitation withdrawn.'), (e: unknown) => flash(describeDataError(e), 'error')); } },
  ]);

  return (
    <Page>
      {wide ? (
        <Tabs value={tab} onChange={switchTab} style={{ marginTop: 0, marginBottom: 16 }} items={tabItems} action={actions} />
      ) : (
        <>
          <Tabs value={tab} onChange={switchTab} fill style={{ marginTop: 0, marginBottom: 10 }} items={tabItems} />
          {actions}
        </>
      )}
      {planning ? <LocalDutySheet onClose={() => setPlanning(false)} /> : null}
      {local ? <LocalDutyTab onPlan={() => setPlanning(true)} /> : (<>
      {swapOpen ? <SwapPanel kind={vehicles ? 'vehicle' : 'driver'} /> : null}
      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder={vehicles ? 'Registration, Car ID or model' : 'Name, mobile, DL or Driver ID'} />
        <Dropdown label="Fleet status" icon="funnel-outline" value={filter} onChange={setFilter} options={(vehicles ? VEHICLE_FILTERS : DRIVER_FILTERS).map((x) => ({ value: x, label: x === 'All' ? 'All statuses' : x }))} style={{ minWidth: 170 }} />
      </Toolbar>
      <SectionLine meta={`${shown} ${vehicles ? (shown === 1 ? 'vehicle' : 'vehicles') : shown === 1 ? 'driver' : 'drivers'}`} />
      {shown === 0 ? (
        <Empty icon={vehicles ? 'car-sport-outline' : 'people-outline'}
          title={search || filter !== 'All' ? `No matching ${vehicles ? 'vehicles' : 'drivers'}` : vehicles ? 'No vehicles in your fleet yet' : 'No drivers in your fleet yet'}
          text={search || filter !== 'All' ? 'Try another search or status. Add a new ID or link an existing one.' : vehicles ? 'Register your vehicle with its documents, or link one already on NESAM.' : 'Invite a new driver by mobile number, or link a driver already on NESAM.'}
          action={<Btn icon="add" title={vehicles ? 'Add vehicle' : 'Add driver'} onPress={() => navigation.navigate('FleetAdd', { kind: vehicles ? 'vehicle' : 'driver' })} />} />
      ) : (
        <Grid>
          {vehicles
            ? vList.map((v) => <VehicleCard key={v.id} v={v} />)
            : [
                ...dList.map((x) => <DriverCard key={x.id} x={x} />),
                ...invites.map((i) => (
                  <Panel key={i.phone} style={{ flexGrow: 1 }}>
                    <Between>
                      <Text style={styles.eyebrow}>NEW DRIVER</Text>
                      <Badge label={i.approval === 'Approved' ? 'Approved' : i.approval === 'Rejected' ? 'Rejected' : 'Waiting for approval'} tone={i.approval === 'Approved' ? 'green' : i.approval === 'Rejected' ? 'red' : 'amber'} />
                    </Between>
                    <View style={styles.person}>
                      <Avatar name={i.name || i.phone.slice(-4)} size={44} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.name}>{i.name || 'New driver'}</Text>
                        <Small>{formatPhone(i.phone)}</Small>
                      </View>
                    </View>
                    {i.licenseNumber ? <Text style={styles.docDate}>DL · {i.licenseNumber}</Text> : null}
                    <Small style={{ marginTop: 12 }}>
                      {i.approval === 'Approved' ? 'Approved by NESAM. The driver joins your fleet after signing in to the NESAM Driver app with this number.'
                        : i.approval === 'Rejected' ? i.rejectionReason || 'NESAM could not approve this driver. Withdraw and add the driver again with correct details.'
                        : 'NESAM is verifying the licence and selfie. You will see the driver here once approved.'}
                    </Small>
                    <View style={{ flex: 1 }} />
                    <Between style={{ marginTop: 14 }}><Small>{i.approval === 'Approved' ? 'Waiting for sign-in' : i.approval === 'Rejected' ? 'Not approved' : 'Awaiting NESAM approval'}</Small><TextLink title={i.approval === 'Rejected' ? 'Remove' : 'Withdraw'} icon="close" onPress={() => revoke(i.phone)} /></Between>
                  </Panel>
                )),
              ]}
        </Grid>
      )}
      </>)}
    </Page>
  );
}

function VehicleCard({ v }: { v: FleetVehicle }) {
  const navigation = useNavigation();
  const { compact } = useLayout();
  const doc = vehicleDocState(v);
  const n = nextExpiry(v);
  return (
    <Panel onPress={() => navigation.navigate('Vehicle', { id: v.id })} label={`Vehicle ${v.vehicleNumber}`} style={{ flexGrow: 1 }}>
      <Between><Text style={styles.eyebrow}>{shortId(v.id, 'NSM-CAR')}</Text><Text style={styles.kind}>{v.category}</Text></Between>
      <View style={styles.carHead}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.plate}>{plate(v.vehicleNumber)}</Text>
          <Small lines={1}>{[[v.make, v.model].filter(Boolean).join(' ') || 'Model not recorded', v.color].filter(Boolean).join(' · ')}</Small>
        </View>
        <CarImage category={v.category} model={v.model} width={compact ? 96 : 125} height={compact ? 60 : 77} />
      </View>
      <Inline style={{ marginTop: 12 }}>
        <Badge label={vehicleStatusLabel(v)} tone={v.status === 'Active' ? 'neutral' : 'amber'} />
        <Badge label={doc} tone={docTone(doc)} />
        {v.seatingCapacity ? <Badge label={`${v.seatingCapacity} seats`} /> : null}
      </Inline>
      <Text style={styles.docDate}>{v.docStatus === 'Rejected' ? v.rejectionReason || 'Upload a new document for review.' : n ? `${n.label} valid until ${displayDate(n.date)}` : 'Document verification pending'}</Text>
      <View style={{ flex: 1 }} />
      <Between style={{ marginTop: 14 }}>
        <View style={styles.paired}><Ionicons name="person-outline" size={14} color="#6F7785" /><Small lines={1}>{v.assignedDriverName || 'No paired driver'}</Small></View>
        <TextLink title="View details" onPress={() => navigation.navigate('Vehicle', { id: v.id })} />
      </Between>
    </Panel>
  );
}

function DriverCard({ x }: { x: FleetDriver }) {
  const navigation = useNavigation();
  const doc = driverDocState(x);
  const suspended = x.fleetStatus === 'Suspended';
  return (
    <Panel onPress={() => navigation.navigate('Driver', { id: x.id })} label={`Driver ${x.name}`} style={{ flexGrow: 1 }}>
      <Between><Text style={styles.eyebrow}>{shortId(x.id, 'NSM-DR')}</Text><Text style={styles.kind}>Vendor driver</Text></Between>
      <View style={styles.person}>
        <Avatar name={x.name} size={46} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>{x.name}</Text>
          <Small>{formatPhone(x.phone)}{x.rating ? ` · ★ ${x.rating.toFixed(1)}` : ''}</Small>
        </View>
      </View>
      <Text style={styles.docDate}>DL · {x.licenseNumber || '—'}{x.licenseExpiry ? ` · valid until ${displayDate(x.licenseExpiry)}` : ''}</Text>
      <Inline style={{ marginTop: 12 }}>
        <Badge label={suspended ? 'Suspended' : 'Active'} tone={suspended ? 'red' : 'neutral'} />
        <Badge label={doc} tone={docTone(doc)} />
        {!suspended && x.presenceStatus ? <Badge label={x.presenceStatus} tone={x.presenceStatus === 'Online' ? 'green' : x.presenceStatus === 'On Trip' ? 'blue' : 'neutral'} /> : null}
      </Inline>
      <View style={{ flex: 1 }} />
      <Between style={{ marginTop: 14 }}>
        <View style={styles.paired}><Ionicons name="car-outline" size={14} color="#6F7785" /><Small lines={1}>{x.assignedVehicleNumber ? plate(x.assignedVehicleNumber) : 'No paired vehicle'}</Small></View>
        <TextLink title="View details" onPress={() => navigation.navigate('Driver', { id: x.id })} />
      </Between>
    </Panel>
  );
}

const styles = StyleSheet.create({
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  eyebrow: { fontFamily, fontSize: 10, fontWeight: '600', letterSpacing: 1, color: '#8B919C' },
  kind: { fontFamily, fontSize: 10.5, color: '#8B919C' },
  carHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14 },
  plate: { fontFamily, fontSize: 17, fontWeight: '600', color: colors.ink, letterSpacing: 0.2, marginBottom: 4 },
  docDate: { fontFamily, fontSize: 11, color: '#8B919C', marginTop: 10, lineHeight: 18 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 18 },
  name: { fontFamily, fontSize: 16, fontWeight: '600', color: colors.ink, marginBottom: 3 },
  paired: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
});

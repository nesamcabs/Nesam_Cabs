// Home: the next / current trip and the duties open for the driver to accept (reference "Dashboard").
// Data, presence and accept logic are the app's existing ones (DriverData, usePresence, acceptMarketplaceTrip).
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/nx/Text';
import { useNavigation } from '@react-navigation/native';
import { useDriverData } from '../context/DriverData';
import { NxScreen, useShell } from '../components/nx/Shell';
import { NxDialog } from '../components/nx/Dialog';
import { NxIcon } from '../components/nx/Icon';
import { NxBadge, NxButton, NxEmpty, NxField, NxFormError, NxInfo, NxPanel, NxRouteStack, NxSectionHeading, NxTextButton, nxText } from '../components/nx/primitives';
import { TripCard } from '../components/nx/TripCard';
import { kmText, offerWhen, tripIsActive } from '../components/nx/tripFormat';
import { usePresence } from '../hooks/usePresence';
import { NxTwoPane, useLayout } from '../components/nx/layout';
import { useNow } from '../hooks/useNow';
import { acceptMarketplaceTrip, DriverActionError, submitDutyBid, withdrawDutyBid } from '../services/driverService';
import type { MarketplaceOffer } from '../types/driver';
import { categoryMatches } from '../utils/earnings';
import { formatINR } from '../utils/format';
import { describeError } from '../utils/retry';
import { nx } from '../theme/nx';

export function HomeScreen() {
  const navigation = useNavigation();
  const { notify } = useShell();
  const { account, activeTrip, nextTrip, upcomingTrips, completedTrips, offers, offersError, bookingsError, deviceWarning, earnings, wallet } = useDriverData();
  const { wide } = useLayout();
  const { driver, vehicle } = account;
  const presence = usePresence(notify);
  const fleet = !!driver.vendorId;
  const now = useNow();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [dateFilter, setDateFilter] = useState('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [detail, setDetail] = useState<MarketplaceOffer | null>(null);
  const [bidRate, setBidRate] = useState('');
  const [bidNote, setBidNote] = useState('');
  const [bidError, setBidError] = useState('');
  const [bidBusy, setBidBusy] = useState(false);
  const bidOnly = detail?.mode === 'bid_review';

  const matching = useMemo(() => offers.filter((o) => categoryMatches(o.vehicleCategory, vehicle.vehicleType)), [offers, vehicle.vehicleType]);
  const pool = showAll ? offers : matching;
  const dates = useMemo(() => [...new Set(pool.map((o) => offerWhen(o).key).filter(Boolean))], [pool]);
  const visible = pool.filter((o) => dateFilter === 'all' || offerWhen(o).key === dateFilter);
  const active = nextTrip ? tripIsActive(nextTrip) : false;
  const hasActive = !!activeTrip;

  const accept = async (offer: MarketplaceOffer) => {
    if (activeTrip) {
      notify('error', 'You already have an active trip.');
      return;
    }
    setAcceptingId(offer.id);
    try {
      await acceptMarketplaceTrip(driver, vehicle.vehicleNumber, offer);
      setDetail(null);
      notify('ok', 'Trip accepted! Drive to the pickup; take the vehicle photos before you start the trip.');
    } catch (e) {
      notify('error', e instanceof DriverActionError ? e.message : describeError(e, 'This trip is no longer available.'));
    } finally {
      setAcceptingId(null);
    }
  };

  const openDetail = (o: MarketplaceOffer) => {
    setDetail(o);
    setBidRate(o.offeredPayout > 0 ? String(o.offeredPayout) : '');
    setBidNote('');
    setBidError('');
  };

  // Duties NESAM reviews bids on cannot be accepted outright (the server refuses); the driver sends a counter amount.
  const sendBid = async () => {
    if (!detail) return;
    const rate = Number(bidRate);
    if (!Number.isFinite(rate) || rate <= 0 || Math.abs(rate * 100 - Math.round(rate * 100)) > 1e-6) return setBidError('Enter your counter amount in rupees (up to 2 decimals).');
    setBidError('');
    setBidBusy(true);
    try {
      await submitDutyBid(detail, rate, bidNote);
      setDetail(null);
      notify('ok', 'Bid sent. NESAM reviews bids and will notify you if it is accepted.');
    } catch (e) {
      notify('error', e instanceof DriverActionError ? e.message : describeError(e, 'Your bid could not be sent.'));
    } finally {
      setBidBusy(false);
    }
    return undefined;
  };

  const withdrawBid = async () => {
    if (!detail) return;
    setBidBusy(true);
    try {
      await withdrawDutyBid(detail);
      setDetail(null);
      notify('ok', 'Your bid was withdrawn.');
    } catch (e) {
      notify('error', e instanceof DriverActionError ? e.message : describeError(e, 'Your bid could not be withdrawn.'));
    } finally {
      setBidBusy(false);
    }
  };

  // The at-a-glance figures the previous dashboard carried; each opens the screen that explains it.
  const goTab = (screen: 'Trip' | 'Earnings' | 'Wallet' | 'Marketplace') => {
    if (screen === 'Earnings') {
      navigation.navigate('Tabs', { screen: 'Profile', params: { openSection: 'earnings' } } as never);
      return;
    }
    navigation.navigate('Tabs', { screen } as never);
  };
  const metrics = (
    <View style={styles.metrics} accessibilityLabel="Today at a glance">
      {fleet ? (
        <Metric label="Earnings" value="Paid by your fleet" foot={`${driver.vendorName || 'Your fleet operator'} settles your pay`} onPress={() => goTab('Trip')} accent small />
      ) : (
        <Metric label="Today’s earnings" value={formatINR(earnings.todayEarnings)} foot={`Credited, incl. tolls · 7 days ${formatINR(earnings.thisWeekEarnings)}`} onPress={() => goTab('Earnings')} accent />
      )}
      <Metric label="Completed trips" value={String(completedTrips.length)} foot={driver.rating != null ? `Rating ★ ${driver.rating.toFixed(1)}` : 'No ratings yet'} onPress={() => goTab('Trip')} />
      {fleet ? null : <Metric label="Wallet balance" value={formatINR(wallet.available)} foot="Available to withdraw" onPress={() => goTab('Wallet')} />}
      <Metric label="Upcoming trips" value={String(upcomingTrips.length).padStart(2, '0')} foot="Your confirmed duties" onPress={() => goTab('Trip')} />
    </View>
  );

  const openTrip = (id: string) => navigation.navigate('TripFlow', { bookingId: id });
  const detailCannot = !presence.online ? (bidOnly ? 'Go online to bid' : 'Go online to accept') : hasActive ? 'You already have an active trip' : '';

  let duties: React.ReactNode;
  if (fleet) {
    duties = <NxEmpty icon="car" title="Trips come from your fleet" message={`${driver.vendorName || 'Your fleet operator'} takes marketplace trips and assigns them to you. Assigned trips appear on this screen.`} />;
  } else if (!presence.online) {
    duties = (
      <NxEmpty
        icon="power"
        title="You’re taking a break."
        message="Go online to browse and accept new duties. Your assigned trips stay available."
        action={<NxButton title="Go online" trailingIcon="arrow" loading={presence.busy} onPress={() => void presence.change('Online')} />}
      />
    );
  } else if (hasActive) {
    duties = <NxEmpty icon="trip" title="Finish your current trip" message="New duties appear here once you complete it." />;
  } else if (!visible.length) {
    duties = (
      <NxEmpty
        icon="trip"
        title={pool.length ? 'No duties on this date' : 'You’re all caught up.'}
        message={pool.length ? 'Choose another date to see open duties.' : 'New duties appear here instantly — stay online.'}
      />
    );
  } else {
    duties = visible.map((o) => {
      const w = offerWhen(o);
      const mismatch = !categoryMatches(o.vehicleCategory, vehicle.vehicleType);
      return (
        <NxPanel key={o.id} style={styles.duty}>
          <View style={styles.dutyMeta}>
            <View style={styles.dutyDate}>
              <NxIcon name="calendar" size={13} color={nx.muted} />
              <Text style={styles.dutyDateText} numberOfLines={1}>
                {w.date}
                {w.time ? ` · ${w.time}` : ''}
              </Text>
            </View>
            <NxBadge label={o.mode === 'bid_review' ? 'Bid' : o.vehicleCategory || 'Any vehicle'} tone={mismatch ? 'amber' : 'neutral'} />
          </View>
          <NxRouteStack pickup={o.pickup.address} drop={o.drop.address} />
          <View style={styles.dutyInfo}>
            <View style={styles.fact}>
              <NxIcon name="car" size={13} color={nx.muted} />
              <Text style={styles.factText}>{vehicle.vehicleType}</Text>
            </View>
            {o.distanceKm > 0 ? (
              <View style={styles.fact}>
                <NxIcon name="distance" size={13} color={nx.muted} />
                <Text style={styles.factText}>{kmText(o.distanceKm)}</Text>
              </View>
            ) : null}
          </View>
          {mismatch ? <NxInfo tone="amber">Booked as {o.vehicleCategory} — accept only if your vehicle qualifies</NxInfo> : null}
          <View style={styles.dutyBottom}>
            <View>
              <Text style={nxText.small}>Driver payout</Text>
              <Text style={styles.dutyPayout}>{formatINR(o.offeredPayout)}</Text>
            </View>
            <NxButton title="View details" trailingIcon="arrow" variant={mismatch ? 'secondary' : 'soft'} compact onPress={() => openDetail(o)} />
          </View>
        </NxPanel>
      );
    });
  }

  return (
    <NxScreen title="Home" subtitle="Duty Dashboard">
      {driver.docStatus === 'Rejected' ? (
        <NxPanel>
          <NxSectionHeading title="Document update required" caption={driver.rejectionReason || 'Some of your updated documents were not accepted. Please upload them again.'} right={<NxBadge label="Action needed" tone="red" icon="info" />} />
          <NxButton title="Update documents" trailingIcon="arrow" onPress={() => navigation.navigate('UpdateDocuments')} />
        </NxPanel>
      ) : null}
      {deviceWarning ? <NxInfo tone="amber" style={{ marginTop: 0, marginBottom: 16 }}>{deviceWarning}</NxInfo> : null}
      {bookingsError ? <NxInfo tone="red" style={{ marginTop: 0, marginBottom: 16 }}>{bookingsError}</NxInfo> : null}

      {wide ? metrics : null}
      <NxTwoPane
        left={
          <>
      <NxSectionHeading
        title={active ? 'Your current trip' : 'Your next trip'}
        right={<NxTextButton title={`My Trips (${upcomingTrips.length})`} trailingIcon="chevron" onPress={() => navigation.navigate('Tabs', { screen: 'Trip' })} />}
      />
      {nextTrip ? (
        <TripCard trip={nextTrip} now={now} onOpen={() => openTrip(nextTrip.id)} />
      ) : (
        <NxEmpty
          icon="check"
          title={completedTrips.length ? 'All assigned trips completed' : 'No active assigned trips'}
          message="Browse available duties or review your trip history."
          action={<NxButton title="View trip history" variant="secondary" onPress={() => navigation.navigate('Tabs', { screen: 'Trip' })} />}
        />
      )}

          </>
        }
        right={
          <>
      <NxSectionHeading
        title="Available duties"
        badge={<NxBadge label={`${fleet || !presence.online || hasActive ? 0 : visible.length} open`} tone="red" />}
        caption={showAll ? 'All open duties' : `Duties eligible for your ${vehicle.vehicleType}`}
        right={
          !fleet ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <NxTextButton
                title="Marketplace"
                trailingIcon="arrow"
                onPress={() => navigation.navigate('Tabs', { screen: 'Marketplace' } as never)}
              />
              <Pressable
                onPress={() => setFilterOpen(true)}
                disabled={!presence.online || hasActive}
                style={[styles.filter, (!presence.online || hasActive) && { opacity: 0.5 }]}
                accessibilityRole="button"
                accessibilityLabel={`Filter duties by pickup date: ${dateFilter === 'all' ? 'all dates' : dateFilter}`}
              >
                <Text style={styles.filterText} numberOfLines={1}>
                  {dateFilter === 'all' ? 'All dates' : dateFilter}
                </Text>
                <NxIcon name="chevron" size={12} color={nx.muted} />
              </Pressable>
            </View>
          ) : null
        }
      />
      {offersError ? <NxInfo tone="red" style={{ marginTop: 0, marginBottom: 12 }}>{offersError}</NxInfo> : null}
      {duties}
      {!fleet && presence.online && !hasActive ? (
        <View style={styles.listNote}>
          <NxIcon name="info" size={14} color={nx.muted} />
          <Text style={styles.listNoteText}>
            Payouts are shown before you accept. Tolls, parking and state tax are paid by the customer at actual cost.{' '}
            <Text
              style={{ color: nx.red, fontWeight: '700' }}
              onPress={() => {
                setShowAll((v) => !v);
                setDateFilter('all');
              }}
              accessibilityRole="button"
            >
              {showAll ? 'Only my category' : `Show all duties (${offers.length})`}
            </Text>
          </Text>
        </View>
      ) : null}
          </>
        }
      />
      {wide ? null : <View style={{ marginTop: 22 }}>{metrics}</View>}

      <NxDialog visible={filterOpen} onClose={() => setFilterOpen(false)} eyebrow="AVAILABLE DUTIES" title="Filter by pickup date">
        {['all', ...dates].map((d) => (
          <Pressable
            key={d}
            style={styles.option}
            onPress={() => {
              setDateFilter(d);
              setFilterOpen(false);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: dateFilter === d }}
          >
            <Text style={[styles.optionText, dateFilter === d && { color: nx.red }]}>{d === 'all' ? 'All dates' : d}</Text>
            {dateFilter === d ? <NxIcon name="check" size={16} color={nx.red} /> : null}
          </Pressable>
        ))}
      </NxDialog>

      <NxDialog
        visible={detail !== null}
        onClose={() => setDetail(null)}
        eyebrow={detail?.bookingId ?? ''}
        title="Available duty"
        locked={acceptingId !== null || bidBusy}
        footer={
          bidOnly ? (
            <>
              <NxButton title={bidBusy ? 'Sending…' : detailCannot || 'Send bid for review'} trailingIcon="check" loading={bidBusy} disabled={!!detailCannot} onPress={() => void sendBid()} />
              <NxTextButton title="Withdraw my earlier bid" onPress={() => void withdrawBid()} />
              <Text style={styles.footnote}>NESAM reviews bids. The duty is assigned to you only if your bid is accepted.</Text>
            </>
          ) : (
            <>
              <NxButton
                title={acceptingId !== null ? 'Accepting…' : detailCannot || 'Accept duty'}
                trailingIcon="check"
                loading={acceptingId !== null}
                disabled={!!detailCannot}
                onPress={() => detail && void accept(detail)}
              />
              <Text style={styles.footnote}>Accepting assigns this duty to you right away.</Text>
            </>
          )
        }
      >
        {detail ? (
          <>
            <View style={styles.payoutBox}>
              <Text style={{ fontSize: 12, color: nx.red }}>{bidOnly ? 'NESAM offer' : 'Your payout'}</Text>
              <Text style={styles.payoutBoxValue}>{formatINR(detail.offeredPayout)}</Text>
            </View>
            <NxRouteStack pickup={detail.pickup.address} drop={detail.drop.address} />
            <View style={{ marginTop: 6 }}>
              <Line label="Pickup date" value={offerWhen(detail).date} />
              {offerWhen(detail).time ? <Line label="Pickup time" value={`${offerWhen(detail).time} IST`} /> : null}
              <Line label="Vehicle / route" value={`${detail.vehicleCategory || 'Any vehicle'}${detail.distanceKm > 0 ? ` · ${kmText(detail.distanceKm)} estimate` : ''}`} />
            </View>
            {bidOnly ? (
              <>
                <NxField label="Your counter amount (₹)" value={bidRate} onChangeText={(t) => { setBidRate(t.replace(/[^\d.]/g, '').slice(0, 9)); setBidError(''); }} keyboardType="decimal-pad" />
                <NxField label="Note for NESAM (optional)" value={bidNote} onChangeText={(t) => setBidNote(t.slice(0, 300))} multiline />
                <NxFormError message={bidError} />
              </>
            ) : null}
            <NxInfo>Toll, parking and state tax are paid by the customer at actual cost. Record tolls with their receipt at the end of the trip.</NxInfo>
            {!categoryMatches(detail.vehicleCategory, vehicle.vehicleType) ? (
              <NxInfo tone="amber">
                Booked as {detail.vehicleCategory}. Accept only if your {vehicle.vehicleType} qualifies.
              </NxInfo>
            ) : null}
            {hasActive ? <NxInfo tone="amber">You already have an active trip. Finish it before accepting another.</NxInfo> : null}
          </>
        ) : null}
      </NxDialog>
    </NxScreen>
  );
}

function Metric({ label, value, foot, onPress, accent, small }: { label: string; value: string; foot: string; onPress: () => void; accent?: boolean; small?: boolean }) {
  return (
    <Pressable style={styles.metric} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}. ${foot}`}>
      <Text style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.metricValue, accent && { color: nx.red }, small && { fontSize: 15 }]} numberOfLines={2}>
        {value}
      </Text>
      <Text style={styles.metricFoot} numberOfLines={2}>
        {foot}
      </Text>
    </Pressable>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  metric: { flexGrow: 1, flexBasis: 150, minWidth: 140, backgroundColor: nx.white, borderWidth: 1, borderColor: nx.line, borderRadius: 14, padding: 15, gap: 6 },
  metricLabel: { fontSize: 12, color: nx.muted },
  metricValue: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3, color: nx.ink },
  metricFoot: { fontSize: 11, color: '#838894' },
  duty: { padding: 17, marginBottom: 12, borderRadius: 15 },
  dutyMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  dutyDate: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  dutyDateText: { fontSize: 11, color: nx.muted },
  dutyInfo: { flexDirection: 'row', gap: 12, marginTop: 7 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  factText: { fontSize: 11, color: nx.muted },
  dutyBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 14 },
  dutyPayout: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5, color: nx.ink },
  filter: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 34, maxWidth: 130, paddingHorizontal: 9, borderRadius: 8, borderWidth: 1, borderColor: nx.line, backgroundColor: nx.white },
  filterText: { fontSize: 10.5, color: '#626875', flexShrink: 1 },
  listNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 },
  listNoteText: { flex: 1, fontSize: 11, lineHeight: 19.8, color: nx.muted },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: nx.line },
  optionText: { fontSize: 13.5, fontWeight: '600', color: nx.ink },
  footnote: { fontSize: 11, color: nx.muted, textAlign: 'center' },
  payoutBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: nx.redSoft, borderRadius: 14, padding: 16, marginBottom: 4 },
  payoutBoxValue: { fontSize: 24, fontWeight: '800', letterSpacing: -0.6, color: nx.red },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: nx.line },
  lineLabel: { fontSize: 12, color: nx.muted },
  lineValue: { flexShrink: 1, fontSize: 12.5, fontWeight: '700', color: nx.ink, textAlign: 'right' },
});

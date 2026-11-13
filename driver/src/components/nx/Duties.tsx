// Open duties (reference "Available duties"): the duty card, the pickup-date filter and the accept / bid dialog.
// Home and the Duties page share these, so accepting or bidding behaves the same everywhere. The server decides every
// acceptance (acceptMarketplaceTrip) and every bid (submitDutyBid / withdrawDutyBid); the app only presents them.
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useDriverData } from '../../context/DriverData';
import { usePresence } from '../../hooks/usePresence';
import { acceptMarketplaceTrip, DriverActionError, submitDutyBid, withdrawDutyBid } from '../../services/driverService';
import type { MarketplaceOffer } from '../../types/driver';
import { categoryMatches } from '../../utils/earnings';
import { formatINR } from '../../utils/format';
import { describeError } from '../../utils/retry';
import { nx } from '../../theme/nx';
import { PolicyDialog } from './Cancellation';
import { NxDialog } from './Dialog';
import { NxIcon, type NxIconName } from './Icon';
import { NxBadge, NxButton, NxField, NxFormError, NxInfo, NxPanel, NxRouteStack, NxRow, isHovered, placeName } from './primitives';
import { useShell } from './Shell';
import { kmText, offerWhen } from './tripFormat';

/** Offers for the driver's vehicle (or all), the pickup dates among them, and the ones on the chosen date. */
export function useDutyFeed(showAll: boolean, dateFilter: string) {
  const { offers, account } = useDriverData();
  const vehicleType = account.vehicle.vehicleType;
  const matching = useMemo(() => offers.filter((o) => categoryMatches(o.vehicleCategory, vehicleType)), [offers, vehicleType]);
  const pool = showAll ? offers : matching;
  const dates = useMemo(() => [...new Set(pool.map((o) => offerWhen(o).key).filter(Boolean))], [pool]);
  const visible = pool.filter((o) => dateFilter === 'all' || offerWhen(o).key === dateFilter);
  return { all: offers, matching, pool, dates, visible };
}

// ── Duty card ───────────────────────────────────────────────────────────────

export function DutyCard({ offer, onOpen }: { offer: MarketplaceOffer; onOpen: () => void }) {
  const { account } = useDriverData();
  const vehicleType = account.vehicle.vehicleType;
  const w = offerWhen(offer);
  const mismatch = !categoryMatches(offer.vehicleCategory, vehicleType);
  const bid = offer.mode === 'bid_review';
  const addOns = [offer.addOns?.roofCarrier ? 'Roof carrier required' : '', offer.addOns?.pets ? 'Pet travel' : ''].filter(Boolean).join(' · ');
  return (
    <NxPanel style={styles.card}>
      <View style={styles.meta}>
        <View style={styles.metaDate}>
          <NxIcon name="calendar" size={13} color={nx.muted} />
          <Text style={styles.metaText} numberOfLines={1}>
            {w.date}
            {w.time ? ` · ${w.time}` : ''}
          </Text>
        </View>
        <NxBadge label={bid ? 'Bid duty' : offer.vehicleCategory || 'Any vehicle'} tone={bid ? 'red' : mismatch ? 'amber' : 'neutral'} />
      </View>
      <View style={styles.route}>
        <Text style={styles.routeText} numberOfLines={2}>
          {placeName(offer.pickup.address)}
        </Text>
        <NxIcon name="arrow" size={16} color="#A0A5AF" />
        <Text style={styles.routeText} numberOfLines={2}>
          {placeName(offer.drop.address)}
        </Text>
      </View>
      <View style={styles.info}>
        <Fact icon="car" text={offer.vehicleCategory || vehicleType} />
        {offer.distanceKm > 0 ? <Fact icon="distance" text={kmText(offer.distanceKm)} /> : null}
        <Fact icon="pin" text={placeName(offer.pickup.address)} />
      </View>
      {mismatch ? (
        <View style={styles.schedule}>
          <NxIcon name="info" size={12} color={nx.amber} />
          <Text style={styles.scheduleText}>Booked as {offer.vehicleCategory} — accept only if your vehicle qualifies</Text>
        </View>
      ) : null}
      {addOns ? (
        <View style={styles.schedule}>
          <NxIcon name="alert" size={12} color={nx.amber} />
          <Text style={styles.scheduleText}>{addOns}</Text>
        </View>
      ) : null}
      <View style={styles.bottom}>
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.payoutLabel}>{bid ? 'NESAM offer' : 'Driver payout'}</Text>
          <Text style={styles.payout}>{formatINR(offer.offeredPayout)}</Text>
        </View>
        <NxButton title={bid ? 'Place bid' : 'View details'} trailingIcon="arrow" variant={mismatch ? 'secondary' : 'soft'} compact onPress={onOpen} />
      </View>
    </NxPanel>
  );
}

function Fact({ icon, text }: { icon: NxIconName; text: string }) {
  return (
    <View style={styles.fact}>
      <NxIcon name={icon} size={12} color={nx.muted} />
      <Text style={styles.factText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

// ── Date filter ─────────────────────────────────────────────────────────────

export function DateFilterDialog({ visible, onClose, dates, value, onChange }: { visible: boolean; onClose: () => void; dates: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <NxDialog visible={visible} onClose={onClose} eyebrow="Available duties" title="Filter by pickup date">
      {['all', ...dates].map((d) => {
        const on = value === d;
        return (
          <Pressable
            key={d}
            style={(s) => [styles.option, isHovered(s) && { backgroundColor: nx.page }]}
            onPress={() => {
              onChange(d);
              onClose();
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.optionText, on && { color: nx.red }]}>{d === 'all' ? 'All dates' : d}</Text>
            {on ? <NxIcon name="check" size={16} color={nx.red} /> : null}
          </Pressable>
        );
      })}
    </NxDialog>
  );
}

// ── Accept / bid dialog ─────────────────────────────────────────────────────

/** Duty details with Accept (or, for duties NESAM reviews, a counter bid). `onAccepted` runs after a successful accept. */
export function DutyDialog({ offer, onClose, onAccepted }: { offer: MarketplaceOffer | null; onClose: () => void; onAccepted?: (offer: MarketplaceOffer) => void }) {
  const { account, activeTrip, cancelPolicy } = useDriverData();
  const { notify } = useShell();
  const presence = usePresence(notify);
  const { driver, vehicle } = account;
  const [accepting, setAccepting] = useState(false);
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [forId, setForId] = useState<string | null>(null);
  // A new offer resets the form (state is derived during render, the React-recommended pattern).
  if (offer && offer.id !== forId) {
    setForId(offer.id);
    setRate(offer.offeredPayout > 0 ? String(offer.offeredPayout) : '');
    setNote('');
    setError('');
  }
  const bid = offer?.mode === 'bid_review';
  const blocked = !presence.online ? (bid ? 'Go online to bid' : 'Go online to accept') : activeTrip ? 'Finish your active trip first' : '';
  const mismatch = offer ? !categoryMatches(offer.vehicleCategory, vehicle.vehicleType) : false;

  const accept = async () => {
    if (!offer || activeTrip) return;
    setAccepting(true);
    try {
      await acceptMarketplaceTrip(driver, vehicle.vehicleNumber, offer);
      onClose();
      notify('ok', 'Duty assigned. Take the vehicle photos before you head to the pickup.');
      onAccepted?.(offer);
    } catch (e) {
      notify('error', e instanceof DriverActionError ? e.message : describeError(e, 'This duty is no longer available.'));
    } finally {
      setAccepting(false);
    }
  };

  const sendBid = async () => {
    if (!offer) return;
    const value = Number(rate);
    if (!Number.isFinite(value) || value <= 0 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) {
      setError('Enter your counter amount in rupees (up to 2 decimals).');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await submitDutyBid(offer, value, note);
      onClose();
      notify('ok', 'Bid sent. NESAM reviews bids and will notify you if it is accepted.');
    } catch (e) {
      setError(e instanceof DriverActionError ? e.message : describeError(e, 'Your bid could not be sent.'));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!offer) return;
    setBusy(true);
    try {
      await withdrawDutyBid(offer);
      onClose();
      notify('ok', 'Your bid was withdrawn.');
    } catch (e) {
      setError(e instanceof DriverActionError ? e.message : describeError(e, 'Your bid could not be withdrawn.'));
    } finally {
      setBusy(false);
    }
  };

  const p = cancelPolicy;
  const policyLine = `Cancellation: ${formatINR(0)} within ${p.graceHours} h of accepting · ${formatINR(p.afterGraceCharge)} after · ${formatINR(p.lastMinuteCharge)} within ${p.lastMinuteHours} h of pickup. Valid reasons may be waived.`;
  const w = offer ? offerWhen(offer) : null;

  return (
    <>
      <NxDialog
        visible={offer !== null && !policyOpen}
        onClose={onClose}
        eyebrow={offer?.bookingId || 'Duty details'}
        title={bid ? 'Duty bidding' : 'Available duty'}
        locked={accepting || busy}
        footer={
          bid ? (
            <>
              <NxButton title={busy ? 'Sending…' : blocked || 'Send bid for review'} trailingIcon="check" loading={busy} disabled={!!blocked} onPress={() => void sendBid()} />
              <NxButton title="Withdraw my earlier bid" variant="ghost" compact disabled={busy} onPress={() => void withdraw()} />
              <Text style={styles.footnote}>NESAM reviews bids. The duty is assigned to you only if your bid is accepted.</Text>
            </>
          ) : (
            <>
              <NxButton title={accepting ? 'Accepting…' : blocked || 'Accept duty'} trailingIcon="check" loading={accepting} disabled={!!blocked} onPress={() => void accept()} />
              <Text style={styles.policy}>
                {policyLine}{' '}
                <Text style={styles.policyLink} onPress={() => setPolicyOpen(true)} accessibilityRole="link">
                  View policy
                </Text>
              </Text>
            </>
          )
        }
      >
        {offer && w ? (
          <>
            <View style={styles.payoutBox}>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.payoutBoxLabel}>{bid ? 'NESAM offer' : 'Your base payout'}</Text>
                <Text style={styles.payoutBoxNote}>{bid ? 'Send a counter amount below' : 'Driver allowance included'}</Text>
              </View>
              <Text style={styles.payoutBoxValue}>{formatINR(offer.offeredPayout)}</Text>
            </View>
            <NxRouteStack pickup={offer.pickup.address} drop={offer.drop.address} via={offer.via} compact />
            <View style={{ marginTop: 6 }}>
              <NxRow label="Pickup date" value={w.date} />
              {w.time ? <NxRow label="Pickup time" value={`${w.time} IST`} /> : null}
              <NxRow label="Vehicle / route" value={`${offer.vehicleCategory || 'Any vehicle'}${offer.distanceKm > 0 ? ` · ${kmText(offer.distanceKm)} estimate` : ''}`} last />
            </View>
            {bid ? (
              <>
                <NxField label="Your counter amount (₹)" value={rate} onChangeText={(t) => { setRate(t.replace(/[^\d.]/g, '').slice(0, 9)); setError(''); }} keyboardType="decimal-pad" />
                <NxField label="Note for NESAM (optional)" value={note} onChangeText={(t) => setNote(t.slice(0, 300))} multiline />
                <NxFormError message={error} />
              </>
            ) : null}
            <NxInfo>Toll, parking and state tax are extra. Collect separately against actual receipts and record them at the end of the trip.</NxInfo>
            {mismatch ? <NxInfo tone="amber">Booked as {offer.vehicleCategory}. Accept only if your {vehicle.vehicleType} qualifies.</NxInfo> : null}
            {activeTrip ? <NxInfo tone="amber" icon="clock">You already have an active trip. Finish it before accepting another.</NxInfo> : null}
          </>
        ) : null}
      </NxDialog>
      <PolicyDialog visible={offer !== null && policyOpen} onClose={() => setPolicyOpen(false)} policy={cancelPolicy} />
    </>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: 17, paddingHorizontal: 18, marginBottom: 12, borderRadius: 15 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 },
  metaDate: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  metaText: { fontSize: 11.5, color: nx.muted },
  route: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  routeText: { fontSize: 15.5, fontWeight: '700', letterSpacing: -0.4, color: nx.ink, flexShrink: 1 },
  info: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4, marginTop: 8 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  factText: { fontSize: 11.5, color: nx.muted, flexShrink: 1 },
  schedule: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: nx.amberSoft, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 8, marginTop: 11 },
  scheduleText: { flex: 1, fontSize: 11, color: nx.amber },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTopWidth: 1, borderTopColor: nx.lineSoft, paddingTop: 12, marginTop: 14 },
  payoutLabel: { fontSize: 11, color: nx.muted },
  payout: { fontSize: 20, fontWeight: '700', letterSpacing: -0.5, color: nx.ink },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: nx.line },
  optionText: { fontSize: 13.5, fontWeight: '600', color: nx.ink },
  footnote: { fontSize: 11, color: nx.muted, textAlign: 'center' },
  policy: { fontSize: 11, lineHeight: 18, color: nx.muted, paddingTop: 12, borderTopWidth: 1, borderTopColor: nx.line },
  policyLink: { color: nx.red, fontWeight: '600' },
  payoutBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: nx.redSoft, borderRadius: 12, padding: 17, marginBottom: 4 },
  payoutBoxLabel: { fontSize: 12, color: '#A6515A', fontWeight: '600' },
  payoutBoxNote: { fontSize: 11, color: '#A6515A', marginTop: 3, opacity: 0.85 },
  payoutBoxValue: { fontSize: 25, fontWeight: '700', letterSpacing: -0.7, color: nx.red },
});

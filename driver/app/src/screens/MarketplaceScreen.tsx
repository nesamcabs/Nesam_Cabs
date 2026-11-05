// Marketplace: open duties eligible for the driver to accept or bid on.
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/nx/Text';
import { useNavigation } from '@react-navigation/native';
import { useDriverData } from '../context/DriverData';
import { NxScreen, useShell } from '../components/nx/Shell';
import { NxDialog } from '../components/nx/Dialog';
import { NxIcon } from '../components/nx/Icon';
import {
  NxBadge,
  NxButton,
  NxEmpty,
  NxField,
  NxFormError,
  NxInfo,
  NxPanel,
  NxPills,
  NxRouteStack,
  NxSectionHeading,
  NxTextButton,
  nxText,
} from '../components/nx/primitives';
import { kmText, offerWhen } from '../components/nx/tripFormat';
import { usePresence } from '../hooks/usePresence';
import { useLayout } from '../components/nx/layout';
import { acceptMarketplaceTrip, DriverActionError, submitDutyBid, withdrawDutyBid } from '../services/driverService';
import type { MarketplaceOffer } from '../types/driver';
import { categoryMatches } from '../utils/earnings';
import { formatINR } from '../utils/format';
import { describeError } from '../utils/retry';
import { nx } from '../theme/nx';
import { POPPINS } from '../theme/fonts';

type FilterCategory = 'matching' | 'all';

export default function MarketplaceScreen() {
  const navigation = useNavigation();
  const { notify } = useShell();
  const { account, activeTrip, offers, offersError } = useDriverData();
  const { driver, vehicle } = account;
  const presence = usePresence(notify);
  const { wide } = useLayout();
  const fleet = !!driver.vendorId;

  const [categoryFilter, setCategoryFilter] = useState<FilterCategory>('matching');
  const [dateFilter, setDateFilter] = useState('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MarketplaceOffer | null>(null);
  const [bidRate, setBidRate] = useState('');
  const [bidNote, setBidNote] = useState('');
  const [bidError, setBidError] = useState('');
  const [bidBusy, setBidBusy] = useState(false);

  const bidOnly = detail?.mode === 'bid_review';
  const hasActive = !!activeTrip;

  const matchingOffers = useMemo(
    () => offers.filter((o) => categoryMatches(o.vehicleCategory, vehicle.vehicleType)),
    [offers, vehicle.vehicleType],
  );

  const pool = categoryFilter === 'all' ? offers : matchingOffers;
  const dates = useMemo(() => [...new Set(pool.map((o) => offerWhen(o).key).filter(Boolean))], [pool]);
  const visible = pool.filter((o) => dateFilter === 'all' || offerWhen(o).key === dateFilter);

  const accept = async (offer: MarketplaceOffer) => {
    if (activeTrip) {
      notify('error', 'You already have an active trip.');
      return;
    }
    setAcceptingId(offer.id);
    try {
      await acceptMarketplaceTrip(driver, vehicle.vehicleNumber, offer);
      setDetail(null);
      notify('ok', 'Trip accepted! Drive to the pickup; take the vehicle photos before starting.');
      navigation.navigate('TripFlow', { bookingId: offer.bookingId || offer.id });
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

  const sendBid = async () => {
    if (!detail) return;
    const rate = Number(bidRate);
    if (!Number.isFinite(rate) || rate <= 0 || Math.abs(rate * 100 - Math.round(rate * 100)) > 1e-6) {
      return setBidError('Enter your counter amount in rupees (up to 2 decimals).');
    }
    setBidError('');
    setBidBusy(true);
    try {
      await submitDutyBid(detail, rate, bidNote);
      setDetail(null);
      notify('ok', 'Bid sent. NESAM reviews bids and will notify you once accepted.');
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

  const detailCannot = !presence.online
    ? bidOnly
      ? 'Go online to bid'
      : 'Go online to accept'
    : hasActive
    ? 'You already have an active trip'
    : '';

  return (
    <NxScreen
      title="Marketplace"
      subtitle={`${visible.length} open duty${visible.length === 1 ? '' : 'ies'}`}
    >
      {fleet ? (
        <NxEmpty
          icon="car"
          title="Trips assigned by fleet"
          message={`${driver.vendorName || 'Your fleet operator'} takes marketplace trips and assigns duties to you directly.`}
        />
      ) : (
        <>
          {!presence.online ? (
            <NxPanel style={styles.offlineBanner}>
              <View style={styles.offlineRow}>
                <View style={styles.offlineIcon}>
                  <NxIcon name="power" size={18} color="#D97706" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.offlineTitle}>You are currently offline</Text>
                  <Text style={styles.offlineSubtitle}>Go online to view, bid on, and accept marketplace duties in real time.</Text>
                </View>
              </View>
              <NxButton
                title="Go online now"
                trailingIcon="arrow"
                loading={presence.busy}
                onPress={() => void presence.change('Online')}
                style={{ marginTop: 12 }}
              />
            </NxPanel>
          ) : null}

          {hasActive ? (
            <NxInfo tone="amber" style={{ marginTop: 0, marginBottom: 14 }}>
              You currently have an active ongoing trip. Complete it before accepting another duty.
            </NxInfo>
          ) : null}

          {offersError ? (
            <NxInfo tone="red" style={{ marginTop: 0, marginBottom: 14 }}>
              {offersError}
            </NxInfo>
          ) : null}

          <View style={styles.filterBar}>
            <View style={{ flex: 1 }}>
              <NxPills<FilterCategory>
                label="Duty category filter"
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={[
                  { value: 'matching', label: `${vehicle.vehicleType} only (${matchingOffers.length})` },
                  { value: 'all', label: `All categories (${offers.length})` },
                ]}
              />
            </View>
            {dates.length > 0 ? (
              <Pressable
                onPress={() => setFilterOpen(true)}
                style={styles.datePickerBtn}
                accessibilityRole="button"
                accessibilityLabel={`Filter by date: ${dateFilter}`}
              >
                <NxIcon name="calendar" size={14} color={nx.muted} />
                <Text style={styles.datePickerText} numberOfLines={1}>
                  {dateFilter === 'all' ? 'All dates' : dateFilter}
                </Text>
                <NxIcon name="chevron" size={12} color={nx.muted} />
              </Pressable>
            ) : null}
          </View>

          {visible.length === 0 ? (
            <NxEmpty
              icon="trip"
              title={pool.length ? 'No duties on this date' : 'No open duties right now'}
              message={
                pool.length
                  ? 'Try selecting another date or category.'
                  : 'New trip requests appear in real time. Keep the app open and stay online.'
              }
              action={
                dateFilter !== 'all' ? (
                  <NxButton title="Show all dates" variant="secondary" onPress={() => setDateFilter('all')} />
                ) : categoryFilter === 'matching' && offers.length > 0 ? (
                  <NxButton
                    title={`View other categories (${offers.length})`}
                    variant="secondary"
                    onPress={() => setCategoryFilter('all')}
                  />
                ) : undefined
              }
            />
          ) : (
            <View style={styles.cardsGrid}>
              {visible.map((o) => {
                const w = offerWhen(o);
                const mismatch = !categoryMatches(o.vehicleCategory, vehicle.vehicleType);
                const isBidDuty = o.mode === 'bid_review';

                return (
                  <NxPanel key={o.id} style={styles.dutyCard}>
                    <View style={styles.cardHeader}>
                      <View style={styles.dateBadge}>
                        <NxIcon name="calendar" size={13} color={nx.muted} />
                        <Text style={styles.dateText}>
                          {w.date}
                          {w.time ? ` · ${w.time} IST` : ''}
                        </Text>
                      </View>
                      <NxBadge
                        label={isBidDuty ? 'Bid Duty' : o.vehicleCategory || 'Any vehicle'}
                        tone={isBidDuty ? 'red' : mismatch ? 'amber' : 'neutral'}
                      />
                    </View>

                    <NxRouteStack pickup={o.pickup.address} drop={o.drop.address} />

                    <View style={styles.cardMeta}>
                      <View style={styles.metaPill}>
                        <NxIcon name="car" size={13} color={nx.muted} />
                        <Text style={styles.metaPillText}>{o.vehicleCategory || vehicle.vehicleType}</Text>
                      </View>
                      {o.distanceKm > 0 ? (
                        <View style={styles.metaPill}>
                          <NxIcon name="distance" size={13} color={nx.muted} />
                          <Text style={styles.metaPillText}>{kmText(o.distanceKm)}</Text>
                        </View>
                      ) : null}
                    </View>

                    {mismatch ? (
                      <NxInfo tone="amber" style={{ marginTop: 8, marginBottom: 0 }}>
                        Booked for {o.vehicleCategory}. Accept only if your vehicle qualifies.
                      </NxInfo>
                    ) : null}

                    <View style={styles.cardBottom}>
                      <View>
                        <Text style={nxText.small}>{isBidDuty ? 'Offered payout' : 'Driver payout'}</Text>
                        <Text style={styles.payoutValue}>{formatINR(o.offeredPayout)}</Text>
                      </View>
                      <View style={styles.actionRow}>
                        <NxButton
                          title={isBidDuty ? 'Place bid' : 'View & accept'}
                          trailingIcon="arrow"
                          variant={isBidDuty ? 'primary' : 'soft'}
                          compact
                          onPress={() => openDetail(o)}
                        />
                      </View>
                    </View>
                  </NxPanel>
                );
              })}
            </View>
          )}

          <View style={styles.payoutFootnote}>
            <NxIcon name="info" size={13} color={nx.muted} />
            <Text style={styles.payoutFootnoteText}>
              Payouts shown are agreed driver rates. Tolls, parking, and state entry tax are verified and reimbursed at actual cost.
            </Text>
          </View>
        </>
      )}

      {/* Date Filter Dialog */}
      <NxDialog visible={filterOpen} onClose={() => setFilterOpen(false)} eyebrow="MARKETPLACE" title="Filter by pickup date">
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
            <Text style={[styles.optionText, dateFilter === d && { color: nx.red, fontFamily: POPPINS.bold }]}>
              {d === 'all' ? 'All available dates' : d}
            </Text>
            {dateFilter === d ? <NxIcon name="check" size={16} color={nx.red} /> : null}
          </Pressable>
        ))}
      </NxDialog>

      {/* Detail & Bidding Dialog */}
      <NxDialog
        visible={detail !== null}
        onClose={() => setDetail(null)}
        eyebrow={detail?.bookingId || 'DUTY DETAILS'}
        title={bidOnly ? 'Duty bidding' : 'Available duty'}
        locked={acceptingId !== null || bidBusy}
        footer={
          bidOnly ? (
            <>
              <NxButton
                title={bidBusy ? 'Submitting…' : detailCannot || 'Send counter bid'}
                trailingIcon="check"
                loading={bidBusy}
                disabled={!!detailCannot}
                onPress={() => void sendBid()}
              />
              <NxTextButton title="Withdraw earlier bid" onPress={() => void withdrawBid()} />
              <Text style={styles.footnote}>NESAM reviews all bids. The duty is assigned to you once your bid is approved.</Text>
            </>
          ) : (
            <>
              <NxButton
                title={acceptingId !== null ? 'Accepting…' : detailCannot || 'Accept duty now'}
                trailingIcon="check"
                loading={acceptingId !== null}
                disabled={!!detailCannot}
                onPress={() => detail && void accept(detail)}
              />
              <Text style={styles.footnote}>Accepting locks this duty and assigns it to your vehicle immediately.</Text>
            </>
          )
        }
      >
        {detail ? (
          <>
            <View style={styles.payoutBox}>
              <Text style={{ fontSize: 12, color: nx.red, fontWeight: '700' }}>{bidOnly ? 'NESAM offered rate' : 'Your driver payout'}</Text>
              <Text style={styles.payoutBoxValue}>{formatINR(detail.offeredPayout)}</Text>
            </View>

            <NxRouteStack pickup={detail.pickup.address} drop={detail.drop.address} />

            <View style={{ marginTop: 8, gap: 4 }}>
              <View style={styles.detailLine}>
                <Text style={styles.detailLineLabel}>Pickup date</Text>
                <Text style={styles.detailLineValue}>{offerWhen(detail).date}</Text>
              </View>
              {offerWhen(detail).time ? (
                <View style={styles.detailLine}>
                  <Text style={styles.detailLineLabel}>Pickup time</Text>
                  <Text style={styles.detailLineValue}>{`${offerWhen(detail).time} IST`}</Text>
                </View>
              ) : null}
              <View style={styles.detailLine}>
                <Text style={styles.detailLineLabel}>Vehicle category</Text>
                <Text style={styles.detailLineValue}>{detail.vehicleCategory || 'Any vehicle'}</Text>
              </View>
              {detail.distanceKm > 0 ? (
                <View style={styles.detailLine}>
                  <Text style={styles.detailLineLabel}>Estimated distance</Text>
                  <Text style={styles.detailLineValue}>{kmText(detail.distanceKm)}</Text>
                </View>
              ) : null}
            </View>

            {bidOnly ? (
              <View style={{ marginTop: 12 }}>
                <NxField
                  label="Your counter amount (₹)"
                  value={bidRate}
                  onChangeText={(t) => {
                    setBidRate(t.replace(/[^\d.]/g, '').slice(0, 9));
                    setBidError('');
                  }}
                  keyboardType="decimal-pad"
                />
                <NxField
                  label="Note for NESAM dispatch (optional)"
                  value={bidNote}
                  onChangeText={(t) => setBidNote(t.slice(0, 300))}
                  multiline
                />
                <NxFormError message={bidError} />
              </View>
            ) : null}

            <NxInfo style={{ marginTop: 10 }}>
              Tolls, state permit taxes, and parking fees are paid by the customer or reimbursed against receipts.
            </NxInfo>
          </>
        ) : null}
      </NxDialog>
    </NxScreen>
  );
}

const styles = StyleSheet.create({
  offlineBanner: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    marginBottom: 14,
    padding: 16,
  },
  offlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  offlineIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineTitle: {
    fontFamily: POPPINS.bold,
    fontSize: 14,
    color: '#92400E',
  },
  offlineSubtitle: {
    fontFamily: POPPINS.regular,
    fontSize: 11.5,
    color: '#B45309',
    marginTop: 2,
    lineHeight: 16,
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  datePickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: nx.line,
    backgroundColor: nx.white,
  },
  datePickerText: {
    fontSize: 11.5,
    fontFamily: POPPINS.medium,
    color: '#334155',
  },
  cardsGrid: {
    gap: 12,
  },
  dutyCard: {
    padding: 16,
    borderRadius: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  dateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dateText: {
    fontSize: 11.5,
    fontFamily: POPPINS.medium,
    color: nx.muted,
  },
  cardMeta: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaPillText: {
    fontSize: 11.5,
    fontFamily: POPPINS.regular,
    color: nx.muted,
  },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: nx.line,
  },
  payoutValue: {
    fontSize: 21,
    fontFamily: POPPINS.bold,
    color: nx.ink,
    letterSpacing: -0.4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  payoutFootnote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 16,
    paddingHorizontal: 4,
  },
  payoutFootnoteText: {
    fontSize: 11,
    fontFamily: POPPINS.regular,
    color: '#838894',
    flex: 1,
    lineHeight: 16,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: nx.line,
  },
  optionText: {
    fontSize: 13,
    fontFamily: POPPINS.medium,
    color: nx.ink,
  },
  payoutBox: {
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: nx.redSoft,
    borderRadius: 10,
    marginBottom: 12,
  },
  payoutBoxValue: {
    fontSize: 26,
    fontFamily: POPPINS.bold,
    color: nx.red,
    marginTop: 2,
    letterSpacing: -0.6,
  },
  detailLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  detailLineLabel: {
    fontSize: 12,
    fontFamily: POPPINS.regular,
    color: nx.muted,
  },
  detailLineValue: {
    fontSize: 12,
    fontFamily: POPPINS.semibold,
    color: nx.ink,
  },
  footnote: {
    fontSize: 11,
    fontFamily: POPPINS.regular,
    color: nx.muted,
    textAlign: 'center',
    marginTop: 6,
  },
});

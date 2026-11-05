import React, { useMemo, useState } from 'react';
import { GoogleMapPreview } from '../../../../user/web/src/components/GoogleMapPreview';
import type { BidProposal, FleetDriver, FleetVehicle, OpenTrip, VendorTrip } from '../types';
import { canDispatch, isCompleted, isLive, isUpcoming, usePartner } from '../state/Partner';
import { dispatchableDriver, dispatchableVehicle } from '../services/vendorMappers';
import { validateCounterRate } from '../services/vendorFirestoreService';
import { Badge, Banner, Button, Dialog, Empty, SelectInput, TextInput, Field, useToast, Toast } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { formatDateTime12 } from '../utils/time';
import { inr } from '../ui/format';

type Tab = 'Available' | 'Accepted' | 'Active' | 'Completed' | 'Bids';

const bidTone = (s: string) => (s === 'Accepted' || s === 'Selected' ? 'green' : s === 'Rejected' ? 'red' : 'amber') as 'green' | 'red' | 'amber';

export const DutiesPage: React.FC = () => {
  const { openTrips, bids, trips, drivers, vehicles, openLinks, penalties, go, actions } = usePartner();
  const [tab, setTab] = useState<Tab>('Available');
  const [search, setSearch] = useState('');
  const [serviceFilter, setServiceFilter] = useState('All');
  const [bidFor, setBidFor] = useState<OpenTrip | null>(null);
  const [assignFor, setAssignFor] = useState<VendorTrip | null>(null);
  const [detailTrip, setDetailTrip] = useState<VendorTrip | null>(null);
  const [acceptingId, setAcceptingId] = useState('');
  const { toast, show, dismiss } = useToast();

  const upcoming = useMemo(() => trips.filter(isUpcoming), [trips]);
  const live = useMemo(() => trips.filter(isLive), [trips]);
  const done = useMemo(() => trips.filter(isCompleted), [trips]);
  const needDispatch = upcoming.filter((t) => !t.driverId).length;
  const pendingBids = useMemo(() => bids.filter((b) => b.status === 'Pending Review' || b.status === 'Submitted'), [bids]);
  const unreadPenalties = useMemo(() => penalties.filter((p) => p.status === 'Pending' && !p.acknowledged), [penalties]);

  const accept = async (trip: OpenTrip) => {
    if (acceptingId) return;
    setAcceptingId(trip.id);
    try {
      await actions.acceptOffer(trip);
      setTab('Accepted');
      show(`${trip.bookingId} accepted! Now assign a driver and vehicle for it.`);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Could not accept this trip.', 'err');
    } finally {
      setAcceptingId('');
    }
  };

  // Filter open offers
  const filteredOffers = useMemo(() => {
    return openTrips.filter((t) => {
      const matchSearch = !search || [t.bookingId, t.route, t.pickup?.address, t.drop?.address, t.vehicleCategory]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase());
      const sType = (t as unknown as { serviceType?: string }).serviceType || '';
      const matchService = serviceFilter === 'All' || sType.toLowerCase().includes(serviceFilter.toLowerCase());
      return matchSearch && matchService;
    });
  }, [openTrips, search, serviceFilter]);

  // Filter accepted / upcoming
  const filteredUpcoming = useMemo(() => {
    return upcoming.filter((t) => {
      const matchSearch = !search || [t.bookingId, t.pickupAddress, t.dropAddress, t.driverName, t.vehicleNumber]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase());
      return matchSearch;
    });
  }, [upcoming, search]);

  // Filter live trips
  const filteredLive = useMemo(() => {
    return live.filter((t) => {
      const matchSearch = !search || [t.bookingId, t.pickupAddress, t.dropAddress, t.driverName, t.vehicleNumber]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase());
      return matchSearch;
    });
  }, [live, search]);

  // Filter completed
  const filteredDone = useMemo(() => {
    return done.filter((t) => {
      const matchSearch = !search || [t.bookingId, t.pickupAddress, t.dropAddress, t.driverName, t.vehicleNumber]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase());
      return matchSearch;
    });
  }, [done, search]);

  return (
    <div>
      <Toast toast={toast} onDismiss={dismiss} />

      {/* Header bar matching reference vTitle */}
      <div className="v-between" style={{ marginBottom: 18, alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--v-ink)', letterSpacing: '-0.3px' }}>Bookings</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--v-muted)' }}>Accept duties. Quote your payout. Assign your team.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            icon="document"
            onClick={() => setTab('Bids')}
          >
            My bids <span className="v-small-count" style={{ marginLeft: 6 }}>{bids.length}</span>
          </Button>
          <Button variant="secondary" icon="userplus" onClick={() => go('drivers', 'add')}>
            Add driver
          </Button>
          <Button variant="primary" icon="plus" onClick={() => go('vehicles', 'add')}>
            Add vehicle
          </Button>
        </div>
      </div>

      {/* Tab navigation matching reference .v-tabs */}
      <div className="v-tabs v-booking-tabs" role="group" aria-label="Booking status" style={{ marginBottom: 16 }}>
        <button type="button" aria-pressed={tab === 'Available'} onClick={() => setTab('Available')}>
          <span>Available</span>
          <small>{openTrips.length}</small>
        </button>
        <button type="button" aria-pressed={tab === 'Accepted'} onClick={() => setTab('Accepted')}>
          <span>Accepted</span>
          <small>{upcoming.length}</small>
        </button>
        <button type="button" aria-pressed={tab === 'Active'} onClick={() => setTab('Active')}>
          <span>Active</span>
          <small>{live.length}</small>
        </button>
        <button type="button" aria-pressed={tab === 'Completed'} onClick={() => setTab('Completed')}>
          <span>Completed</span>
          <small>{done.length}</small>
        </button>
        <button type="button" aria-pressed={tab === 'Bids'} onClick={() => setTab('Bids')}>
          <span>My bids</span>
          <small>{bids.length}</small>
        </button>
      </div>

      {/* Alert strips matching reference .v-alerts */}
      <div className="v-alerts" style={{ marginBottom: 16 }}>
        {needDispatch > 0 && (
          <button type="button" className="v-strip v-amber" onClick={() => setTab('Accepted')}>
            <Icon name="user" />
            <span><strong>{needDispatch} {needDispatch === 1 ? 'duty needs' : 'duties need'} driver & vehicle assignment</strong></span>
            <Icon name="arrow" />
          </button>
        )}
        {openLinks.length > 0 && (
          <button type="button" className="v-strip" onClick={() => go('requests')}>
            <Icon name="swap" />
            <span>{openLinks.length} driver / vehicle linking requests need attention</span>
            <Icon name="arrow" />
          </button>
        )}
        {unreadPenalties.length > 0 && (
          <button type="button" className="v-strip v-red" onClick={() => go('alerts')}>
            <Icon name="alert" />
            <span><strong>{inr(unreadPenalties[0].amount)} penalty notice</strong> · Duty {unreadPenalties[0].bookingId || unreadPenalties[0].bookingCode || 'Review'}</span>
            <Icon name="arrow" />
          </button>
        )}
      </div>

      {/* Search and service filter toolbar matching reference .v-toolbar */}
      {tab !== 'Bids' && (
        <div className="v-toolbar" style={{ marginBottom: 18 }}>
          <label className="v-search" style={{ flex: 1 }}>
            <Icon name="search" />
            <input
              id="v-search"
              type="search"
              aria-label="Search route or Booking ID"
              placeholder="Search route or Booking ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="v-service">
            <span className="v-sr">Service type</span>
            <select
              id="v-service"
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
            >
              <option value="All">All services</option>
              <option value="One Way">One Way</option>
              <option value="Round Trip">Round Trip</option>
              <option value="Airport">Airport</option>
              <option value="Multicity">Multicity</option>
              <option value="Local Rental">Local Rental</option>
            </select>
          </label>
        </div>
      )}

      {/* Available duties */}
      {tab === 'Available' && (
        filteredOffers.length === 0 ? (
          <div className="vx-card">
            <Empty icon="trip" title="No matching duties right now">
              Offers published by NESAM will appear here immediately. You will also get a real-time notification.
            </Empty>
          </div>
        ) : (
          <div className="v-card-grid">
            {filteredOffers.map((t) => (
              <DutyOfferCard
                key={t.id}
                trip={t}
                bidding={pendingBids.some((b) => b.tripId === t.id)}
                accepting={acceptingId === t.id}
                onAccept={() => accept(t)}
                onBid={() => setBidFor(t)}
              />
            ))}
          </div>
        )
      )}

      {/* Accepted duties */}
      {tab === 'Accepted' && (
        filteredUpcoming.length === 0 ? (
          <div className="vx-card">
            <Empty icon="calendar" title="No duties waiting for dispatch">
              Trips you accept or win appear here until the driver starts the journey.
            </Empty>
          </div>
        ) : (
          <div className="v-card-grid">
            {filteredUpcoming.map((t) => (
              <DutyTripCard
                key={t.id}
                trip={t}
                onAssign={() => setAssignFor(t)}
                onView={() => setDetailTrip(t)}
              />
            ))}
          </div>
        )
      )}

      {/* Active duties */}
      {tab === 'Active' && (
        filteredLive.length === 0 ? (
          <div className="vx-card">
            <Empty icon="pin" title="No active trips in progress">
              Trip updates will appear here once the assigned driver starts the trip in the NESAM Driver app.
            </Empty>
          </div>
        ) : (
          <div className="v-card-grid">
            {filteredLive.map((t) => (
              <DutyTripCard
                key={t.id}
                trip={t}
                onView={() => setDetailTrip(t)}
              />
            ))}
          </div>
        )
      )}

      {/* Completed duties */}
      {tab === 'Completed' && (
        filteredDone.length === 0 ? (
          <div className="vx-card">
            <Empty icon="check" title="No completed trips yet">
              Finished trips and verified settlements are preserved here.
            </Empty>
          </div>
        ) : (
          <div className="v-card-grid">
            {filteredDone.map((t) => (
              <DutyTripCard
                key={t.id}
                trip={t}
                onView={() => setDetailTrip(t)}
              />
            ))}
          </div>
        )
      )}

      {/* My Bids tab */}
      {tab === 'Bids' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <Banner tone="info">
            A submitted bid does not confirm a duty. Once selected, confirm within the deadline to secure the assignment.
          </Banner>
          {bids.length === 0 ? (
            <div className="vx-card">
              <Empty icon="document" title="No bids placed yet">
                Place a counter bid on an available duty to quote your payout.
              </Empty>
            </div>
          ) : (
            <div className="v-card-grid">
              {bids.map((b) => (
                <article key={b.id} className="v-duty-card">
                  <div className="v-card-top">
                    <span className="v-duty-id">{b.bookingId}</span>
                    <Badge tone={bidTone(b.status)}>{b.status}</Badge>
                  </div>
                  <h2 className="v-route" style={{ fontSize: 16, margin: '10px 0 6px' }}>{b.bookingId} Quote</h2>
                  <div className="v-pickup" style={{ fontSize: 12, color: 'var(--v-muted)', marginBottom: 12 }}>
                    <span>Submitted: {b.submittedAt ? formatDateTime12(b.submittedAt) : '—'}</span>
                  </div>
                  {b.biddingNote && (
                    <p className="v-card-note" style={{ fontStyle: 'italic', marginBottom: 14 }}>
                      "{b.biddingNote}"
                    </p>
                  )}
                  <div className="v-card-bottom" style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid var(--v-line)' }}>
                    <div className="v-amount">
                      <small>Your payout quote</small>
                      <strong>{inr(b.vendorCounterRate)}</strong>
                    </div>
                    {b.status === 'Pending Review' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          try {
                            await actions.withdrawBid(b);
                            show(`Bid for ${b.bookingId} withdrawn.`);
                          } catch (e) {
                            show(e instanceof Error ? e.message : 'The bid was not withdrawn.', 'err');
                          }
                        }}
                      >
                        Withdraw
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Counter Bid Dialog */}
      <BidDialog
        trip={bidFor}
        onClose={() => setBidFor(null)}
        onSubmit={async (rate, note) => {
          await actions.submitBid(bidFor!, rate, note);
          show(`Counter bid of ${inr(rate)} sent for ${bidFor!.bookingId}. NESAM will review it.`);
          setBidFor(null);
        }}
      />

      {/* Driver & Vehicle Assignment Dialog */}
      <AssignDialog
        trip={assignFor}
        drivers={drivers}
        vehicles={vehicles}
        onClose={() => setAssignFor(null)}
        onGo={(p) => {
          setAssignFor(null);
          go(p, 'add');
        }}
        onAssign={async (driverId, vehicleId) => {
          await actions.assign(assignFor!.id, driverId, vehicleId);
          const d = drivers.find((x) => x.id === driverId);
          const v = vehicles.find((x) => x.id === vehicleId);
          show(`${d?.name || 'Driver'} is assigned with ${v?.vehicleNumber || 'the vehicle'}. The duty is in their NESAM Driver app.`);
          setAssignFor(null);
        }}
      />

      {/* Duty Details Modal */}
      <DutyDetailsDialog
        trip={detailTrip}
        onClose={() => setDetailTrip(null)}
        onAssign={() => {
          const t = detailTrip;
          setDetailTrip(null);
          setAssignFor(t);
        }}
      />
    </div>
  );
};

const DutyOfferCard: React.FC<{
  trip: OpenTrip;
  bidding: boolean;
  accepting: boolean;
  onAccept: () => void;
  onBid: () => void;
}> = ({ trip, bidding, accepting, onAccept, onBid }) => {
  const isBidMode = trip.status === 'Bidding' || trip.mode === 'bid_review';
  const sType = (trip as unknown as { serviceType?: string }).serviceType;

  return (
    <article className="v-duty-card" data-duty={trip.bookingId}>
      <div className="v-card-top">
        <span className="v-duty-id">{trip.bookingId}</span>
        <Badge tone={isBidMode ? 'amber' : 'green'}>{isBidMode ? 'Bids open' : 'Fixed rate'}</Badge>
      </div>

      <h2 className="v-route">
        {trip.pickup?.city || trip.pickup?.address || 'Pickup'} <span><Icon name="arrow" /></span> {trip.drop?.city || trip.drop?.address || 'Destination'}
      </h2>

      <div className="v-pickup">
        <Icon name="calendar" />
        <span>{trip.travelDate || 'Today'}</span>
        {trip.pickup?.time && (
          <>
            <i>·</i>
            <span>{trip.pickup.time}</span>
          </>
        )}
      </div>

      <div className="v-facts">
        {trip.vehicleCategory && (
          <span><Icon name="car" />{trip.vehicleCategory}</span>
        )}
        {trip.distanceKm !== null && (
          <span><Icon name="distance" />{Math.round(trip.distanceKm)} km included</span>
        )}
        {sType && (
          <span>{sType}</span>
        )}
      </div>

      {isBidMode && (
        <p className="v-card-note v-amber-text">
          Office quotes welcome · Bidding review active
        </p>
      )}

      <div className="v-card-bottom">
        <div className="v-amount">
          <small>{isBidMode ? 'Suggested payout' : 'Vendor payout'}</small>
          <strong>{trip.offeredPayout !== null ? inr(trip.offeredPayout) : 'Quote your rate'}</strong>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {trip.mode !== 'bid_review' && (
            <Button
              variant="primary"
              loading={accepting}
              disabled={trip.offeredPayout === null}
              onClick={onAccept}
            >
              Accept duty
            </Button>
          )}
          {trip.mode !== 'accept_offer' && (
            <Button
              variant={trip.mode === 'bid_review' ? 'primary' : 'secondary'}
              onClick={onBid}
              disabled={bidding}
            >
              {bidding ? 'Bid sent' : 'Place bid'}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
};

const DutyTripCard: React.FC<{
  trip: VendorTrip;
  onAssign?: () => void;
  onView?: () => void;
}> = ({ trip, onAssign, onView }) => {
  const completed = isCompleted(trip);
  const live = isLive(trip);
  const hasDriver = !!trip.driverId;

  const statusTone = completed ? 'green' : live ? 'blue' : hasDriver ? 'green' : 'amber';
  const statusLabel = completed ? 'Completed' : live ? 'On Trip' : hasDriver ? 'Upcoming' : 'Needs Driver';

  return (
    <article className="v-duty-card" data-duty={trip.bookingId}>
      <div className="v-card-top">
        <button
          type="button"
          className="v-duty-id"
          onClick={onView}
          style={{ background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }}
        >
          {trip.bookingId} <Icon name="arrow" />
        </button>
        <Badge tone={statusTone}>{statusLabel}</Badge>
      </div>

      <h2 className="v-route" onClick={onView} style={{ cursor: 'pointer' }}>
        {trip.pickupAddress.split(',')[0]} <span><Icon name="arrow" /></span> {trip.dropAddress.split(',')[0]}
      </h2>

      <div className="v-pickup">
        <Icon name="calendar" />
        <span>{trip.scheduledTime || 'Scheduled'}</span>
      </div>

      <div className="v-facts">
        {trip.vehicleNumber && (
          <span><strong>{trip.vehicleNumber}</strong></span>
        )}
      </div>

      {hasDriver ? (
        <p className="v-card-note">
          <Icon name="user" /> {trip.driverName || 'Driver assigned'} {trip.driverPhone ? `· +91 ${trip.driverPhone}` : ''}
        </p>
      ) : (
        <p className="v-card-note v-amber-text">
          <Icon name="clock" /> Driver assignment pending
        </p>
      )}

      <div className="v-card-bottom">
        <div className="v-amount">
          <small>Vendor payout</small>
          <strong>{trip.vendorPayout !== null ? inr(trip.vendorPayout) : 'In calculation'}</strong>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {onAssign && canDispatch(trip) && (
            <Button
              variant={hasDriver ? 'secondary' : 'primary'}
              size="sm"
              onClick={onAssign}
            >
              {hasDriver ? 'Change' : 'Assign team'}
            </Button>
          )}
          {onView && (
            <Button variant="secondary" size="sm" onClick={onView}>
              View duty
            </Button>
          )}
        </div>
      </div>
    </article>
  );
};

const DutyDetailsDialog: React.FC<{
  trip: VendorTrip | null;
  onClose: () => void;
  onAssign?: () => void;
}> = ({ trip, onClose, onAssign }) => {
  if (!trip) return null;

  const completed = isCompleted(trip);
  const live = isLive(trip);
  const steps = ['Accepted', 'Driver assigned', 'Reached pickup', 'Trip started', 'Completed'];
  const currentIndex = completed ? 4 : live ? 3 : trip.driverId ? 1 : 0;

  return (
    <Dialog open={!!trip} onClose={onClose} eyebrow="Duty Details" title={trip.bookingId}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <Button onClick={onClose}>Close</Button>
          {onAssign && canDispatch(trip) && (
            <Button variant="primary" onClick={onAssign}>
              {trip.driverId ? 'Change driver / vehicle' : 'Assign driver & vehicle'}
            </Button>
          )}
        </div>
      }>
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="v-panel" style={{ padding: 14 }}>
          <div className="v-route-stack">
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--v-green)', marginTop: 5, flexShrink: 0 }} />
              <div>
                <strong style={{ fontSize: 14, color: 'var(--v-ink)' }}>{trip.pickupAddress}</strong>
                <div style={{ fontSize: 12, color: 'var(--v-muted)', marginTop: 2 }}>Pickup point · {trip.scheduledTime || 'Scheduled time'}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--v-red)', marginTop: 5, flexShrink: 0 }} />
              <div>
                <strong style={{ fontSize: 14, color: 'var(--v-ink)' }}>{trip.dropAddress}</strong>
                <div style={{ fontSize: 12, color: 'var(--v-muted)', marginTop: 2 }}>Destination point</div>
              </div>
            </div>
          </div>
          <GoogleMapPreview pickup={{ lat: trip.pickupLat, lng: trip.pickupLng, label: trip.pickupAddress }} drop={{ lat: trip.dropLat, lng: trip.dropLng, label: trip.dropAddress }} height={200} />
        </div>

        {trip.driverId && (
          <div className="v-panel" style={{ padding: 14 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 10px', color: 'var(--v-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Assigned Team
            </h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span className="v-avatar" style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--v-line)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13 }}>
                  {(trip.driverName || 'DR').slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <strong style={{ display: 'block', fontSize: 14, color: 'var(--v-ink)' }}>{trip.driverName}</strong>
                  <span style={{ fontSize: 12, color: 'var(--v-muted)' }}>{trip.vehicleNumber} {trip.driverPhone ? `· +91 ${trip.driverPhone}` : ''}</span>
                </div>
              </div>
              <Badge tone="green">Assigned</Badge>
            </div>
          </div>
        )}

        <div className="v-panel" style={{ padding: 14 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 12px', color: 'var(--v-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Duty Progress
          </h3>
          <ol className="v-timeline" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
            {steps.map((s, i) => (
              <li key={s} style={{ display: 'flex', gap: 12, alignItems: 'center', opacity: i <= currentIndex ? 1 : 0.4 }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: i <= currentIndex ? 'var(--v-green)' : 'var(--v-line)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700 }}>
                  {i <= currentIndex ? '✓' : i + 1}
                </span>
                <span style={{ fontSize: 13, fontWeight: i === currentIndex ? 700 : 500, color: 'var(--v-ink)' }}>
                  {s} {i === currentIndex && <small style={{ color: 'var(--v-green)', marginLeft: 6 }}>● Active</small>}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="v-panel" style={{ padding: 14, background: 'var(--v-page)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--v-muted)' }}>Vendor Payout</span>
            <strong style={{ fontSize: 24, fontWeight: 800, color: 'var(--v-green)' }}>{trip.vendorPayout !== null ? inr(trip.vendorPayout) : 'Under calculation'}</strong>
          </div>
          <p style={{ fontSize: 12, color: 'var(--v-muted)', margin: '6px 0 0' }}>
            Included distance: Toll, parking and state permits are reimbursed against office-verified receipts.
          </p>
        </div>
      </div>
    </Dialog>
  );
};

const BidDialog: React.FC<{ trip: OpenTrip | null; onClose: () => void; onSubmit: (rate: number, note: string) => Promise<void> }> = ({ trip, onClose, onSubmit }) => {
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastTrip, setLastTrip] = useState<string | null>(null);

  if ((trip?.id ?? null) !== lastTrip) {
    setLastTrip(trip?.id ?? null);
    setRate(''); setNote(''); setError('');
  }

  const submit = async () => {
    const n = Number(rate);
    const invalid = validateCounterRate(n, trip?.offeredPayout ?? null);
    if (invalid) return setError(invalid);
    if (!note.trim()) return setError('Add a short note for the NESAM team.');
    setBusy(true); setError('');
    try {
      await onSubmit(n, note);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The bid was not submitted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!trip} onClose={onClose} eyebrow="Counter bid" title={trip ? trip.bookingId : ''} locked={busy}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Send bid</Button></>}>
      {trip && (
        <>
          <p className="vx-muted" style={{ marginBottom: 14 }}>
            {trip.route}<br />
            NESAM offers <strong style={{ color: 'var(--ink)' }}>{trip.offeredPayout !== null ? inr(trip.offeredPayout) : 'a payout that is still under review'}</strong>. Propose your own quote for office review.
          </p>
          <TextInput id="bid-rate" label="Your payout quote (₹)" inputMode="numeric" value={rate} onChange={(e) => { setRate(e.target.value.replace(/\D/g, '')); setError(''); }} placeholder="e.g. 3500" />
          <Field label="Note for the NESAM team" htmlFor="bid-note" required>
            <textarea id="bid-note" className="vx-textarea" value={note} maxLength={300} onChange={(e) => { setNote(e.target.value); setError(''); }} placeholder="Vehicle condition, experienced driver, route details…" />
          </Field>
          {error && <p className="vx-err" role="alert">{error}</p>}
        </>
      )}
    </Dialog>
  );
};

const AssignDialog: React.FC<{
  trip: VendorTrip | null;
  drivers: FleetDriver[];
  vehicles: FleetVehicle[];
  onClose: () => void;
  onGo: (p: 'drivers' | 'vehicles') => void;
  onAssign: (driverId: string, vehicleId: string) => Promise<void>;
}> = ({ trip, drivers, vehicles, onClose, onGo, onAssign }) => {
  const readyDrivers = drivers.filter(dispatchableDriver);
  const readyVehicles = vehicles.filter(dispatchableVehicle);
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastTrip, setLastTrip] = useState<string | null>(null);

  if ((trip?.id ?? null) !== lastTrip) {
    setLastTrip(trip?.id ?? null);
    setDriverId(trip && readyDrivers.some((d) => d.id === trip.driverId) ? trip.driverId : '');
    setVehicleId(trip && readyVehicles.some((v) => v.id === trip.vehicleId) ? trip.vehicleId : '');
    setError('');
  }

  const pickDriver = (id: string) => {
    setDriverId(id);
    const paired = readyVehicles.find((v) => v.assignedDriverId === id);
    if (paired) setVehicleId(paired.id);
  };

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await onAssign(driverId, vehicleId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The trip was not dispatched.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!trip} onClose={onClose} eyebrow={trip?.driverId ? 'Change assignment' : 'Dispatch'} title="Driver & vehicle" locked={busy}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!driverId || !vehicleId} onClick={submit}>{trip?.driverId ? 'Update trip' : 'Assign trip'}</Button></>}>
      {trip && (
        <>
          <p className="vx-muted" style={{ marginBottom: 14 }}>{trip.bookingId} · {trip.scheduledTime || '—'}</p>
          {readyDrivers.length === 0 && (
            <Banner tone="warn" action={{ label: 'Add a driver', onClick: () => onGo('drivers') }}>No approved driver in your fleet yet.</Banner>
          )}
          {readyVehicles.length === 0 && (
            <Banner tone="warn" action={{ label: 'Add a vehicle', onClick: () => onGo('vehicles') }}>No approved vehicle is in service.</Banner>
          )}
          <SelectInput
            id="as-driver"
            label="Driver (verified and active)"
            value={driverId}
            onChange={pickDriver}
            placeholder="Choose a driver"
            options={readyDrivers.map((d) => ({ value: d.id, label: `${d.name || 'Driver'}${d.phone ? ` · +91 ${d.phone}` : ''} · ${d.online ? 'Online' : 'Offline'}` }))}
          />
          <SelectInput
            id="as-vehicle"
            label="Vehicle (documents valid and active)"
            value={vehicleId}
            onChange={setVehicleId}
            placeholder="Choose a vehicle"
            options={readyVehicles.map((v) => ({ value: v.id, label: `${v.vehicleNumber}${v.make || v.model ? ` · ${[v.make, v.model].filter(Boolean).join(' ')}` : ''}` }))}
          />
          <p className="vx-hint">The server verifies the driver licence and vehicle documents before confirming the dispatch.</p>
          {error && <p className="vx-err" role="alert">{error}</p>}
        </>
      )}
    </Dialog>
  );
};

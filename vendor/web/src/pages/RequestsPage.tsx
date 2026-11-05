import React, { useState } from 'react';
import { linkIsOpen, usePartner } from '../state/Partner';
import { Badge, Banner, Button, Empty, Dialog, TextInput, Field, Toast, useToast } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { LinkCard } from './LinkParts';

const SUPPORT_PHONE = import.meta.env.VITE_SUPPORT_PHONE || '+91 90250 99990';

export const RequestsPage: React.FC = () => {
  const { links, profile, trips, go } = usePartner();
  const [tab, setTab] = useState<'open' | 'away' | 'history'>('open');
  const [requestModal, setRequestModal] = useState<'Cancellation' | 'Assignment change' | null>(null);
  const [selectedTripId, setSelectedTripId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast, show, dismiss } = useToast();

  const mine = links.filter((l) => l.toVendorId === profile.id);
  const open = mine.filter(linkIsOpen);
  const away = links.filter((l) => l.fromVendorId === profile.id && l.toVendorId !== profile.id && linkIsOpen(l));
  const history = links.filter((l) => !linkIsOpen(l));

  const list = tab === 'open' ? open : tab === 'away' ? away : history;
  const activeTrips = trips.filter((t) => t.status === 'Accepted' || t.status === 'Assigned');

  const submitRequest = async () => {
    if (!selectedTripId) return;
    if (!reason.trim()) return;
    setBusy(true);
    try {
      // Show confirmation toast
      show(`${requestModal} request submitted for office review.`);
      setRequestModal(null);
      setSelectedTripId('');
      setReason('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Toast toast={toast} onDismiss={dismiss} />

      {/* Title matching reference vTitle */}
      <div className="v-between" style={{ marginBottom: 18, alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--v-ink)', letterSpacing: '-0.3px' }}>Helpdesk</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--v-muted)' }}>Requests and office support.</p>
        </div>
      </div>

      {/* Support panel matching reference .v-support-panel */}
      <section
        className="v-panel v-support-panel"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 20,
          background: '#fff',
          borderRadius: 16,
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <span
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: 'var(--nx-pink)',
              color: 'var(--v-red)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Icon name="phone" />
          </span>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: 'var(--v-ink)' }}>NESAM Office Support</h2>
            <p style={{ fontSize: 13, color: 'var(--v-muted)', margin: '2px 0 0' }}>For urgent duty, payment or account assistance.</p>
          </div>
        </div>
        <a
          href={`tel:${SUPPORT_PHONE.replace(/\s/g, '')}`}
          className="v-button v-primary"
          style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', fontSize: 14 }}
        >
          <Icon name="phone" /> Call office ({SUPPORT_PHONE})
        </a>
      </section>

      {/* Quick Action buttons matching reference .v-help-actions */}
      <div
        className="v-help-actions"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <button
          type="button"
          onClick={() => setRequestModal('Cancellation')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: 16,
            background: '#fff',
            border: '1px solid var(--v-line)',
            borderRadius: 14,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span style={{ color: 'var(--v-red)' }}><Icon name="alert" /></span>
          <span style={{ flex: 1 }}>
            <strong style={{ display: 'block', fontSize: 14, color: 'var(--v-ink)' }}>Request cancellation</strong>
            <small style={{ fontSize: 12, color: 'var(--v-muted)' }}>Send a reason for office review</small>
          </span>
          <Icon name="arrow" />
        </button>

        <button
          type="button"
          onClick={() => setRequestModal('Assignment change')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: 16,
            background: '#fff',
            border: '1px solid var(--v-line)',
            borderRadius: 14,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span style={{ color: 'var(--v-green)' }}><Icon name="swap" /></span>
          <span style={{ flex: 1 }}>
            <strong style={{ display: 'block', fontSize: 14, color: 'var(--v-ink)' }}>Change driver / car</strong>
            <small style={{ fontSize: 12, color: 'var(--v-muted)' }}>Request a verified replacement</small>
          </span>
          <Icon name="arrow" />
        </button>
      </div>

      {/* Section heading */}
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--v-ink)' }}>Linking & Transfer Requests</h2>
        <p style={{ fontSize: 13, color: 'var(--v-muted)', margin: '2px 0 0' }}>Your current duty stays active until office approval.</p>
      </div>

      {/* Tabs */}
      <div className="v-tabs" role="group" aria-label="Request tabs" style={{ marginBottom: 16 }}>
        <button type="button" aria-pressed={tab === 'open'} onClick={() => setTab('open')}>
          <span>Needs action</span>
          <small>{open.length}</small>
        </button>
        <button type="button" aria-pressed={tab === 'away'} onClick={() => setTab('away')}>
          <span>Leaving my fleet</span>
          <small>{away.length}</small>
        </button>
        <button type="button" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>
          <span>Resolved</span>
          <small>{history.length}</small>
        </button>
      </div>

      {list.length === 0 ? (
        <div className="vx-card">
          <Empty
            icon="swap"
            title={tab === 'open' ? 'Nothing is waiting' : tab === 'away' ? 'Nobody is taking a driver or car' : 'No past requests'}
            action={
              tab === 'open' ? (
                <>
                  <Button icon="userplus" onClick={() => go('drivers', 'add')}>Add driver</Button>
                  <Button icon="car" onClick={() => go('vehicles', 'add')}>Add vehicle</Button>
                </>
              ) : undefined
            }
          >
            {tab === 'open' ? 'When you link a driver or car on NESAM, the confirmation code appears here.' : 'Completed and resolved requests are archived here.'}
          </Empty>
        </div>
      ) : (
        <div className="v-card-grid">
          {list.map((l) => (
            <LinkCard key={l.id} link={l} mine={l.toVendorId === profile.id} onToast={show} />
          ))}
        </div>
      )}

      {/* Cancellation / Change Request Modal */}
      <Dialog
        open={!!requestModal}
        onClose={() => setRequestModal(null)}
        eyebrow="Helpdesk Request"
        title={requestModal || ''}
        locked={busy}
        footer={
          <>
            <Button onClick={() => setRequestModal(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!selectedTripId || !reason.trim()} onClick={submitRequest}>
              Submit Request
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <Banner tone="info">
            Your current duty and team assignment remain active until approved by the NESAM office.
          </Banner>
          <div style={{ display: 'grid', gap: 6 }}>
            <label htmlFor="req-trip" style={{ fontSize: 12, fontWeight: 700, color: 'var(--v-muted)', textTransform: 'uppercase' }}>
              Select Active Duty
            </label>
            <select
              id="req-trip"
              value={selectedTripId}
              onChange={(e) => setSelectedTripId(e.target.value)}
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid var(--v-line)',
                fontSize: 14,
                color: 'var(--v-ink)',
                background: '#fff',
              }}
            >
              <option value="">Select a duty</option>
              {activeTrips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.bookingId} — {t.pickupAddress.split(',')[0]} to {t.dropAddress.split(',')[0]}
                </option>
              ))}
            </select>
          </div>
          <Field label="Reason for office review" htmlFor="req-reason" required>
            <textarea
              id="req-reason"
              className="vx-textarea"
              value={reason}
              maxLength={400}
              onChange={(e) => setReason(e.target.value)}
              placeholder="State the reason (e.g., breakdown, driver illness, emergency replacement)..."
              style={{ minHeight: 90 }}
            />
          </Field>
        </div>
      </Dialog>
    </div>
  );
};

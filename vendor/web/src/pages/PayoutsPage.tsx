import React, { useMemo, useState } from 'react';
import { usePartner } from '../state/Partner';
import { Badge, Banner, Button, Dialog, Empty, KV, Stat, TextInput, Toast, useToast, type Tone } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { inr } from '../ui/format';
import { formatDateTime12 } from '../utils/time';

type PaymentTab = 'Settlements' | 'Statements' | 'Collections' | 'Penalties';

const payoutTone: Record<string, Tone> = { Paid: 'green', Pending: 'amber', Deferred: 'amber', Rejected: 'red', Cancelled: 'gray' };

export const PayoutsPage: React.FC = () => {
  const { wallet, payouts, ledger, penalties, trips, profile, actions } = usePartner();
  const [tab, setTab] = useState<PaymentTab>('Settlements');
  const [settlementFilter, setSettlementFilter] = useState<'Pending' | 'Paid'>('Pending');
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast, show, dismiss } = useToast();

  const withdrawable = Math.max(0, Math.floor(wallet.available));
  const hasBank = !!profile.bankAccountNumber && !!profile.ifscCode;
  const hasUpi = !!profile.upiId;
  const [method, setMethod] = useState<'UPI' | 'Bank Transfer'>(hasBank || !hasUpi ? 'Bank Transfer' : 'UPI');

  const completedTrips = useMemo(() => trips.filter((t) => t.status === 'Completed'), [trips]);
  const cashTrips = useMemo(() => completedTrips.filter((t) => (t.grossFare || 0) > 0), [completedTrips]);

  const openDialog = () => {
    setAmount(withdrawable > 0 ? String(withdrawable) : '');
    setError('');
    setOpen(true);
  };

  const submit = async () => {
    if (busy) return;
    const n = Number(amount);
    if (!Number.isSafeInteger(n) || n <= 0) return setError('Enter the amount in whole rupees.');
    if (n > withdrawable) return setError(`You can withdraw up to ${inr(withdrawable)}.`);
    setBusy(true);
    setError('');
    try {
      await actions.requestPayout(n, method);
      setOpen(false);
      show(`Payout request for ${inr(n)} sent to NESAM Finance.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payout request failed. Please retry.');
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
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--v-ink)', letterSpacing: '-0.3px' }}>Payments</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--v-muted)' }}>Duty accounts and settlements.</p>
        </div>
      </div>

      {/* Main total banner matching reference dark card #20242E */}
      <div className="v-panel" style={{ background: '#20242E', color: '#fff', borderColor: '#20242E', padding: 24, borderRadius: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600 }}>Total Wallet Balance</div>
            <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.6px', color: wallet.available < 0 ? '#FFB4BA' : '#fff', marginTop: 4 }}>
              {inr(wallet.available)}
            </div>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
              Net payout after customer advance, cash collections and adjustments.
            </div>
          </div>
          <Button
            variant="primary"
            icon="bank"
            disabled={withdrawable <= 0}
            onClick={openDialog}
            style={{ padding: '12px 20px', fontSize: 14 }}
          >
            Request payout
          </Button>
        </div>
        {wallet.available < 0 && (
          <p style={{ fontSize: 12, color: '#FFB4BA', margin: '12px 0 0' }}>
            Cash fares collected by drivers exceed duty earnings; upcoming earnings settle this first.
          </p>
        )}
      </div>

      {/* Tabs: Settlements, Statements, Collections, Penalties */}
      <div className="v-tabs" role="group" aria-label="Payment tabs" style={{ marginBottom: 16 }}>
        <button type="button" aria-pressed={tab === 'Settlements'} onClick={() => setTab('Settlements')}>
          <span>Settlements</span>
        </button>
        <button type="button" aria-pressed={tab === 'Statements'} onClick={() => setTab('Statements')}>
          <span>Duty statements</span>
        </button>
        <button type="button" aria-pressed={tab === 'Collections'} onClick={() => setTab('Collections')}>
          <span>Cash collected</span>
          <small>{cashTrips.length}</small>
        </button>
        <button type="button" aria-pressed={tab === 'Penalties'} onClick={() => setTab('Penalties')}>
          <span>Penalties & Adjustments</span>
          <small>{penalties.length}</small>
        </button>
      </div>

      {/* Settlements Tab */}
      {tab === 'Settlements' && (
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Summary metrics */}
          <div className="v-payment-summary" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="v-panel" style={{ padding: 18 }}>
              <small style={{ fontSize: 12, color: 'var(--v-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Pending settlement</small>
              <strong style={{ display: 'block', fontSize: 24, fontWeight: 800, color: 'var(--v-ink)', marginTop: 4 }}>
                {inr(wallet.pending)}
              </strong>
            </div>
            <div className="v-panel" style={{ padding: 18 }}>
              <small style={{ fontSize: 12, color: 'var(--v-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Paid settlements</small>
              <strong style={{ display: 'block', fontSize: 24, fontWeight: 800, color: 'var(--v-green)', marginTop: 4 }}>
                {inr(wallet.paidOut)}
              </strong>
            </div>
          </div>

          {/* Subfilter */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className={`v-button ${settlementFilter === 'Pending' ? 'v-primary' : 'v-secondary'}`}
              onClick={() => setSettlementFilter('Pending')}
              style={{ fontSize: 12, padding: '8px 14px' }}
            >
              Pending Settlements
            </button>
            <button
              type="button"
              className={`v-button ${settlementFilter === 'Paid' ? 'v-primary' : 'v-secondary'}`}
              onClick={() => setSettlementFilter('Paid')}
              style={{ fontSize: 12, padding: '8px 14px' }}
            >
              Paid Settlements
            </button>
          </div>

          {/* Payout requests list */}
          <div className="v-panel" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px', color: 'var(--v-ink)' }}>Payout Transfer Requests</h3>
            {payouts.length === 0 ? (
              <Empty icon="bank" title="No payout requests found">
                Request a payout when you have an available balance to transfer.
              </Empty>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {payouts.map((p) => (
                  <div key={p.id} className="v-statement" style={{ display: 'flex', justifyContent: 'space-between', padding: 12, border: '1px solid var(--v-line)', borderRadius: 10 }}>
                    <div>
                      <strong style={{ fontSize: 15, color: 'var(--v-ink)' }}>{inr(p.amount)}</strong>
                      <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--v-muted)' }}>
                        {p.payoutMethod || 'Bank Transfer'} · {p.targetDetails || 'Saved account'}
                      </p>
                      <small style={{ fontSize: 11, color: 'var(--v-muted)' }}>
                        {p.requestedAt ? formatDateTime12(p.requestedAt) : '—'}
                      </small>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <Badge tone={payoutTone[p.status] ?? 'gray'}>{p.status}</Badge>
                      {p.utr && (
                        <div style={{ fontSize: 11, color: 'var(--v-green)', marginTop: 4 }}>
                          UTR: {p.utr}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Duty Statements Tab */}
      {tab === 'Statements' && (
        <div className="v-panel" style={{ padding: 18 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px', color: 'var(--v-ink)' }}>Completed Duty Statements</h3>
          {completedTrips.length === 0 ? (
            <Empty icon="document" title="No duty statements yet">
              Duty statements are generated once trips are finished and verified.
            </Empty>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {completedTrips.map((t) => (
                <div key={t.id} className="v-statement" style={{ display: 'flex', justifyContent: 'space-between', padding: 14, border: '1px solid var(--v-line)', borderRadius: 12 }}>
                  <div>
                    <strong style={{ fontSize: 14, color: 'var(--v-ink)' }}>{t.bookingId}</strong>
                    <p style={{ margin: '3px 0', fontSize: 13, color: 'var(--v-ink)' }}>
                      {t.pickupAddress.split(',')[0]} → {t.dropAddress.split(',')[0]}
                    </p>
                    <small style={{ fontSize: 11, color: 'var(--v-muted)' }}>
                      Driver: {t.driverName || '—'} · Vehicle: {t.vehicleNumber || '—'}
                    </small>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--v-green)' }}>
                      {t.vendorPayout !== null ? inr(t.vendorPayout) : 'In calculation'}
                    </div>
                    <small style={{ fontSize: 11, color: 'var(--v-muted)' }}>Vendor Payout</small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Collections Tab */}
      {tab === 'Collections' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <Banner tone="info">
            Verified cash is automatically adjusted against your net payout. Cash reported by drivers is credited after office audit.
          </Banner>
          <div className="v-panel" style={{ padding: 18 }}>
            {cashTrips.length === 0 ? (
              <Empty icon="wallet" title="No cash collections recorded">
                Fares collected by your drivers will appear here with their verification status.
              </Empty>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {cashTrips.map((t) => (
                  <div key={t.id} className="v-statement" style={{ display: 'flex', justifyContent: 'space-between', padding: 14, border: '1px solid var(--v-line)', borderRadius: 12 }}>
                    <div>
                      <strong style={{ fontSize: 14, color: 'var(--v-ink)' }}>{t.bookingId}</strong>
                      <p style={{ margin: '3px 0', fontSize: 13, color: 'var(--v-ink)' }}>
                        {t.pickupAddress.split(',')[0]} → {t.dropAddress.split(',')[0]}
                      </p>
                      <Badge tone="green">Verified</Badge>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <strong style={{ fontSize: 16, fontWeight: 800, color: 'var(--v-ink)' }}>
                        {inr(t.grossFare || 0)}
                      </strong>
                      <div style={{ fontSize: 11, color: 'var(--v-muted)' }}>Customer fare</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Penalties & Adjustments Tab */}
      {tab === 'Penalties' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="v-section-heading">
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--v-ink)' }}>Penalties & Adjustments</h2>
            <p style={{ fontSize: 13, color: 'var(--v-muted)', margin: '4px 0 0' }}>Notices, decisions and settlement adjustments.</p>
          </div>
          {penalties.length === 0 ? (
            <div className="vx-card">
              <Empty icon="alert" title="No penalties or adjustments">
                Any notices, customer dispute reviews, or office adjustments will appear here.
              </Empty>
            </div>
          ) : (
            <div className="v-card-grid">
              {penalties.map((p) => (
                <article key={p.id} className="v-panel" style={{ padding: 18 }}>
                  <div className="v-between">
                    <span className="v-duty-id">{p.id}</span>
                    <Badge tone={p.status === 'Pending' ? 'amber' : 'green'}>{p.status}</Badge>
                  </div>
                  <div className="v-penalty-amount" style={{ fontSize: 24, fontWeight: 800, color: 'var(--v-red)', margin: '10px 0 4px' }}>
                    {inr(p.amount)}
                  </div>
                  <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px', color: 'var(--v-ink)' }}>{p.reason}</h3>
                  <p style={{ fontSize: 12, color: 'var(--v-muted)', margin: 0 }}>Duty {p.bookingId || p.bookingCode || 'General'}</p>
                  <div className="v-between" style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--v-line)' }}>
                    <span style={{ fontSize: 11, color: 'var(--v-muted)' }}>
                      {p.acknowledged ? 'Acknowledged' : 'New notice'}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Request Payout Dialog */}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Payout Transfer"
        title="Request Payout"
        locked={busy}
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={submit}>Send Request</Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <p className="vx-muted">
            Withdraw from your verified balance: <strong style={{ color: 'var(--v-ink)' }}>{inr(withdrawable)}</strong> available.
          </p>
          <TextInput
            id="payout-amount"
            label="Amount (₹)"
            inputMode="numeric"
            value={amount}
            onChange={(e) => { setAmount(e.target.value.replace(/\D/g, '')); setError(''); }}
            placeholder={`Up to ${withdrawable}`}
            autoFocus
          />
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--v-muted)', textTransform: 'uppercase' }}>Transfer Method</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={`v-button ${method === 'Bank Transfer' ? 'v-primary' : 'v-secondary'}`}
                onClick={() => setMethod('Bank Transfer')}
                style={{ flex: 1 }}
              >
                Bank Transfer
              </button>
              {hasUpi && (
                <button
                  type="button"
                  className={`v-button ${method === 'UPI' ? 'v-primary' : 'v-secondary'}`}
                  onClick={() => setMethod('UPI')}
                  style={{ flex: 1 }}
                >
                  UPI
                </button>
              )}
            </div>
          </div>
          {error && <p className="vx-err" role="alert">{error}</p>}
        </div>
      </Dialog>
    </div>
  );
};

import React, { useState } from 'react';
import { formatDateTime12 } from '../utils/time';
import type { BankDetails, DriverWallet, LedgerEntry, PayoutRequest } from '../types';
import { describeFirestoreError } from '../services/driverFirestoreService';
import { Dialog } from '../components/nx/Dialog';
import { Icon } from '../components/nx/Icon';
import { InfoNote } from '../components/nx/parts';
import { inr } from '../components/nx/format';

interface WalletPayoutScreenProps {
  wallet: DriverWallet;
  bank: BankDetails;
  payoutRequests: PayoutRequest[];
  ledger: LedgerEntry[];
  /** Fleet drivers are paid by their vendor, not from a NESAM wallet. */
  fleetDriver: boolean;
  onRequestPayout: (amount: number, method: 'UPI' | 'Bank Transfer') => Promise<void>;
  onSupport: () => void;
}

const when = (d: Date | null) => (d ? formatDateTime12(d) : '—');

const badgeTone = (s: string) => (s === 'Paid' ? 'green' : s === 'Pending' || s === 'Deferred' ? 'amber' : 'neutral');

const ENTRY_LABEL: Record<string, string> = {
  trip_earning: 'Trip earning',
  toll_reimbursement: 'Toll reimbursement',
  extra_charge: 'Approved extra charges',
  cash_collected: 'Cash fare you collected',
  payout: 'Payout',
};
const ENTRY_STATUS: Record<string, string> = {
  pending: 'Awaiting customer payment',
  available: 'Available',
  reserved: 'Held for payout',
  completed: 'Completed',
  cancelled: 'Released',
};
const ENTRY_ICON: Record<string, 'car' | 'wallet' | 'trip' | 'bank'> = { trip_earning: 'car', toll_reimbursement: 'trip', cash_collected: 'wallet', payout: 'bank' };

export const WalletPayoutScreen: React.FC<WalletPayoutScreenProps> = ({ wallet, bank, payoutRequests, ledger, fleetDriver, onRequestPayout, onSupport }) => {
  const withdrawable = Math.max(0, Math.floor(wallet.available));
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'UPI' | 'Bank Transfer'>(bank.accountNumber || !bank.upiId ? 'Bank Transfer' : 'UPI');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const openModal = () => {
    setAmount(withdrawable > 0 ? String(withdrawable) : '');
    setError('');
    setOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isSafeInteger(value) || value <= 0) return setError('Enter the amount in whole rupees.');
    if (value > withdrawable) return setError(`You can withdraw up to ${inr(withdrawable)}.`);
    if (method === 'UPI' && !bank.upiId) return setError('No UPI ID in your profile. Add one from Profile first.');
    if (method === 'Bank Transfer' && !bank.accountNumber) return setError('No bank account in your profile. Add one from Profile first.');
    setSubmitting(true);
    setError('');
    try {
      await onRequestPayout(value, method);
      setOpen(false);
    } catch (err) {
      setError(describeFirestoreError(err, 'Could not submit the payout request.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (fleetDriver && ledger.length === 0 && payoutRequests.length === 0) {
    return (
      <section className="panel page-card">
        <div className="card-heading">
          <div>
            <h2>Settled by your fleet</h2>
            <p>Driver wallet</p>
          </div>
          <span className="badge neutral">Fleet driver</span>
        </div>
        <div className="info-note">
          <Icon name="info" />
          <span>You drive for a fleet operator. They receive the payout for your trips and pay you directly, so NESAM does not keep a wallet balance for you.</span>
        </div>
      </section>
    );
  }

  const negative = wallet.available < 0;
  return (
    <>
      <div className="two-columns">
        <section>
          <div className="panel wallet-card">
            <div className="eyebrow">Available to withdraw</div>
            <div className="wallet-value" style={negative ? { color: 'var(--red)' } : undefined}>
              {inr(wallet.available)}
            </div>
            <button type="button" className="button primary" onClick={openModal} disabled={withdrawable <= 0}>
              Request payout <Icon name="arrow" />
            </button>
            <div className="wallet-foot">
              <Icon name="shield" />
              Kept by NESAM from your trip ledger
            </div>
          </div>
          <div className="wallet-summary">
            <div className="small-panel">
              <small>Awaiting customer payment</small>
              <strong>{inr(wallet.pending)}</strong>
            </div>
            <div className="small-panel">
              <small>Held for requests</small>
              <strong>{inr(wallet.reserved)}</strong>
            </div>
          </div>
          <div className="wallet-summary" style={{ marginTop: 12 }}>
            <div className="small-panel">
              <small>Paid out</small>
              <strong>{inr(wallet.paidOut)}</strong>
            </div>
            <div className="small-panel">
              <small>Cash fares collected</small>
              <strong>{inr(wallet.cashCollected)}</strong>
            </div>
          </div>
          {negative ? (
            <div style={{ marginTop: 15 }}>
              <InfoNote tone="amber" role="status">
                Cash fares you collected exceed your earnings; upcoming earnings settle this first.
              </InfoNote>
            </div>
          ) : (
            <div style={{ marginTop: 15 }}>
              <InfoNote>Closing a trip does not mark its payment as received. Earnings move to your balance once NESAM verifies the customer’s payment.</InfoNote>
            </div>
          )}
        </section>

        <section className="panel page-card">
          <div className="card-heading">
            <div>
              <h2>Payout requests</h2>
              <p>Reviewed by NESAM finance</p>
            </div>
            <Icon name="clock" />
          </div>
          {payoutRequests.length === 0 ? (
            <p className="profile-note">No payout requests yet.</p>
          ) : (
            <div className="ledger-list">
              {payoutRequests.map((po) => (
                <div className="ledger-item" key={po.id}>
                  <div className="ledger-icon">
                    <Icon name="bank" />
                  </div>
                  <div>
                    <strong>{po.method}</strong>
                    <small>
                      {po.details || '—'} · {po.requestedAt}
                    </small>
                  </div>
                  <div className="ledger-amount">
                    <strong>{inr(po.amount)}</strong>
                    <span className={`badge ${badgeTone(po.status)}`}>{po.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button type="button" className="button secondary full" style={{ marginTop: 18 }} onClick={onSupport}>
            <Icon name="help" />
            Get settlement help
          </button>
        </section>

        <section className="panel page-card">
          <div className="card-heading">
            <div>
              <h2>Wallet ledger</h2>
              <p>Latest {Math.min(ledger.length, 50)} entries</p>
            </div>
            <Icon name="wallet" />
          </div>
          {ledger.length === 0 ? (
            <p className="profile-note">Earnings are recorded here when a completed trip’s fare is verified.</p>
          ) : (
            <div className="ledger-list">
              {ledger.slice(0, 50).map((e) => (
                <div className="ledger-item" key={e.id}>
                  <div className="ledger-icon">
                    <Icon name={ENTRY_ICON[e.type] ?? 'wallet'} />
                  </div>
                  <div>
                    <strong>
                      {ENTRY_LABEL[e.type] || e.type}
                      {e.bookingCode ? ` · ${e.bookingCode}` : ''}
                    </strong>
                    <small>
                      {when(e.createdAt)} · {ENTRY_STATUS[e.status] || e.status}
                    </small>
                  </div>
                  <div className="ledger-amount" style={e.status === 'cancelled' ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
                    <strong style={e.direction === 'debit' ? { color: 'var(--red)' } : undefined}>
                      {e.direction === 'credit' ? '+' : '−'}
                      {inr(e.amount)}
                    </strong>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} eyebrow={`Available ${inr(withdrawable)}`} title="Request payout" locked={submitting}>
        <form onSubmit={handleSubmit} id="payout-form">
          <label className="nx-cancel-field" htmlFor="payout-amount">
            Amount (₹)
            <input
              id="payout-amount"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              max={withdrawable}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError('');
              }}
            />
          </label>
          <div className="page-tabs" role="group" aria-label="Payout method" style={{ marginTop: 16, marginBottom: 0 }}>
            {(['Bank Transfer', 'UPI'] as const).map((m) => (
              <button key={m} type="button" className={`pill-button ${method === m ? 'active' : ''}`} aria-pressed={method === m} onClick={() => setMethod(m)}>
                {m === 'UPI' ? 'UPI' : 'Bank (NEFT/IMPS)'}
              </button>
            ))}
          </div>
          <div className="detail-list">
            <div className="detail-line">
              <span>Paid to</span>
              <strong>
                {method === 'UPI'
                  ? bank.upiId || 'No UPI ID saved'
                  : bank.accountNumber
                    ? `${bank.accountHolder} · A/c ••••${bank.accountNumber.slice(-4)}`
                    : 'No bank account saved'}
              </strong>
            </div>
            {method === 'Bank Transfer' && bank.accountNumber ? (
              <div className="detail-line">
                <span>IFSC{bank.bankName ? ' / Bank' : ''}</span>
                <strong>
                  {bank.ifsc}
                  {bank.bankName ? ` · ${bank.bankName}` : ''}
                </strong>
              </div>
            ) : null}
          </div>
          <div className="nx-cancel-error" role="alert">
            {error}
          </div>
          <button className="button primary full" type="submit" disabled={submitting} style={{ marginTop: 14 }}>
            {submitting ? 'Submitting…' : 'Confirm request'} <Icon name="check" />
          </button>
        </form>
      </Dialog>
    </>
  );
};

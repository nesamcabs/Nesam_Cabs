import { useEffect, useState } from 'react';
import { useCan, useCanDo } from './AccessContext';
import { useTariff } from '../services/tariffService';
import { saveTariffSection } from '../services/bookingOpsService';
import { Button } from './ui';

export default function CommonPetChargeCard() {
  const { tariff } = useTariff();
  const canPrice = useCan('pricing');
  const canEditSettings = useCanDo('Settings', 'edit');
  const saved = tariff?.petCharge ?? 0;
  const [amount, setAmount] = useState(String(saved));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { setAmount(String(saved)); }, [saved]);
  const valid = amount.trim() !== '' && Number.isFinite(Number(amount)) && Number(amount) >= 0 && Number(amount) <= 100000;
  const save = async () => {
    if (!valid || busy || !canPrice || !canEditSettings || tariff === undefined) return;
    setBusy(true);
    setMessage('');
    try {
      await saveTariffSection({ section: 'petCharge', expectedVersion: tariff?.version ?? 0, reason: 'Common pet travel charge updated', data: { petCharge: Number(amount) } });
      setMessage('Saved. The common pet travel charge applies to new bookings across all brands and vehicle categories.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the pet travel charge. Please retry.');
    } finally { setBusy(false); }
  };
  return (
    <section className="min-w-0 rounded-xl border border-line p-3" aria-label="Pet travel charge">
      <label className="ds-field max-w-sm"><span className="flex items-center justify-between gap-1"><span className="text-[12px] font-bold text-ink">Pet travel charge</span><span className="text-[11px] text-muted">₹/trip</span></span>
        <input className="ds-input" type="number" min="0" max="100000" step="0.01" value={amount} disabled={busy || !canPrice || !canEditSettings} onChange={e => { setAmount(e.target.value); setMessage(''); }} />
      </label>
      {!valid ? <p role="alert" className="text-xs text-bad mt-2">Enter a price from INR 0 to 100,000.</p> : null}
      <div className="mt-3"><Button onClick={() => void save()} disabled={busy || !valid || Number(amount) === saved || !canPrice || !canEditSettings || tariff === undefined}>{busy ? 'Saving…' : 'Save pet charge'}</Button></div>
      {message ? <p role="status" className="text-xs mt-2">{message}</p> : null}
    </section>
  );
}

import { useEffect, useState } from 'react';
import { useCan, useCanDo } from './AccessContext';
import { useTariff } from '../services/tariffService';
import { saveTariffSection } from '../services/bookingOpsService';
import { CardBody, SaveBar, SettingCard } from './RateTable';

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
  const canSave = !busy && valid && Number(amount) !== saved && canPrice && canEditSettings && tariff !== undefined;
  return (
    <SettingCard title="Pet travel charge" description="One amount per trip for every brand, service and vehicle."
      footer={<SaveBar onSave={() => void save()} busy={busy} disabled={!canSave} message={message ? { ok: !/could not|error/i.test(message), text: message } : null} />}>
      <CardBody>
        <label className="fm-inline-field">
          <span>Charge</span>
          <span className="fm-affix fm-affix--pre">
            <span>₹</span>
            <input className={`fm-input is-own ${!valid ? "is-bad" : ""}`} type="number" min="0" max="100000" step="0.01" value={amount} disabled={busy || !canPrice || !canEditSettings} onChange={e => { setAmount(e.target.value); setMessage(''); }} aria-label="Pet travel charge per trip" />
          </span>
          <small className="fm-hint">per trip</small>
        </label>
        {!valid ? <p role="alert" className="ds-error mt-2">Enter a price from ₹0 to ₹1,00,000.</p> : null}
      </CardBody>
    </SettingCard>
  );
}

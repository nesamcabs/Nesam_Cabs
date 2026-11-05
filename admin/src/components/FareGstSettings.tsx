import { useEffect, useRef, useState } from 'react';
import { GST_STATES } from '../domain/gstStates';
import { BRAND_LABELS, useTariff, type FareGstRule, type FareWorkspaceScope } from '../services/tariffService';
import { saveTariffSection } from '../services/bookingOpsService';
import { Button } from './ui';
import { useCan, useCanDo } from './AccessContext';

const empty = (): FareGstRule => ({ supplierState: '', rate: 0.05, mode: 'included', classification: 'passenger', reference: '' });
export default function FareGstSettings({ scope, onDirtyChange, onBusyChange }: {
  scope: FareWorkspaceScope; onDirtyChange: (value: boolean) => void; onBusyChange: (value: boolean) => void;
}) {
  const { tariff, error: loadError } = useTariff();
  const [state, setState] = useState('');
  const [rule, setRule] = useState<FareGstRule>(empty);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''), [reason, setReason] = useState('');
  const [version, setVersion] = useState(0);
  const loaded = useRef('');
  const pricing = useCan('pricing'), settings = useCanDo('Settings', 'edit');
  const canEdit = pricing && settings;
  const policy = tariff?.fareGst?.[scope.brand]?.[scope.service];
  const common = tariff?.fareGst?.common?.[scope.service];
  const own = state ? policy?.states?.[state] : policy?.default;
  const inherited = state ? policy?.default ?? common?.states?.[state] ?? common?.default : common?.default;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty, busy]);
  useEffect(() => {
    if (tariff === undefined || dirty || busy || (tariff?.version ?? 0) < version) return;
    const key = `${scope.brand}:${scope.service}:${state}:${tariff?.version ?? 0}`;
    if (loaded.current === key) return;
    loaded.current = key;
    setRule(own ?? inherited ?? { ...empty(), classification: scope.service === 'Local Rental' ? 'rental' : 'passenger' });
    setVersion(tariff?.version ?? 0);
  }, [tariff, scope.brand, scope.service, state, dirty, busy, version, own, inherited]);
  const edit = (patch: Partial<FareGstRule>) => { setRule(value => ({ ...value, ...patch })); setDirty(true); setMessage(''); };
  const changeState = (next: string) => {
    if (busy || (dirty && !window.confirm('Discard unsaved GST changes?'))) return;
    setDirty(false); setState(next); setMessage(''); setReason(''); loaded.current = '';
  };
  const save = async (clear = false) => {
    if (!canEdit || busy || tariff === undefined || loadError) return;
    if (!clear && (!rule.supplierState || !Number.isFinite(rule.rate) || rule.rate < 0 || rule.rate > 0.4 || rule.reference.trim().length < 5)) return setMessage('Select the supplier registration state, a rate from 0 to 40%, and an approved tax reference.');
    if (reason.trim().length < 5) return setMessage('Enter a change reason (at least 5 characters).');
    if (clear && !window.confirm('Remove this GST setting and use the inherited/default calculation for new bookings?')) return;
    setBusy(true); setMessage('');
    try {
      const result = await saveTariffSection({ section: 'fareGst', brand: scope.brand, service: scope.service, expectedVersion: version, reason, clearOverride: clear, data: { state, rule } });
      setVersion(result.version); setDirty(false); loaded.current = ''; setReason(''); setMessage('GST settings saved. Existing bookings keep their quoted tax.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'GST settings could not be saved.'); }
    finally { setBusy(false); }
  };
  const stateSelect = (value: string, change: (value: string) => void, placeholder: string) => <select className="ds-select" value={value} onChange={event => change(event.target.value)}><option value="">{placeholder}</option>{GST_STATES.map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}</select>;
  const pct = Math.round(rule.rate * 10000) / 100;
  const taxable = rule.mode === 'included' ? 1000 / (1 + rule.rate) : 1000;
  return <section id="fare-gst-settings" className="ds-panel ds-panel-pad" aria-label="GST settings">
    <h2 className="text-[17px] font-bold">GST calculation</h2>
    <p className="text-[12px] text-muted mb-3">{scope.brand === 'common' ? 'Common — all brands' : BRAND_LABELS[scope.brand]} → {scope.service} · All vehicle categories. Brand settings override Common; within a brand, pickup-state settings override its default.</p>
    <fieldset disabled={busy || !canEdit || tariff === undefined || !!loadError}>
      <label className="ds-field"><span>Location scope · verified pickup state</span>{stateSelect(state, changeState, 'All pickup states — default')}</label>
      <p className="text-[12px] text-muted my-2">{own ? 'Editing this scope’s saved setting.' : inherited ? 'Inherited setting shown. Save to create an override for this scope.' : 'No scoped GST saved. Existing fare calculations remain in use until you save.'} GST follows the supplier registration and legal place of supply; crossing a state border alone does not decide IGST. Cities and areas use their master location’s state.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="ds-field"><span>Supplier GST registration state *</span>{stateSelect(rule.supplierState, supplierState => edit({ supplierState }), 'Choose registration state')}</label>
        <label className="ds-field"><span>Fare amounts *</span><select className="ds-select" value={rule.mode} onChange={e => edit({ mode: e.target.value as FareGstRule['mode'] })}><option value="excluded">GST excluded — add GST to fare</option><option value="included">GST included — extract GST from fare</option></select></label>
        <label className="ds-field"><span>Total GST rate (%) *</span><input className="ds-input" type="number" min="0" max="40" step="0.01" value={Number.isFinite(pct) ? pct : ''} onChange={e => edit({ rate: e.target.value === '' ? NaN : Number(e.target.value) / 100 })} /><small>Enter the approved total rate, not a separate rate for each component. 0% is supported.</small></label>
        <label className="ds-field"><span>Service classification *</span><select className="ds-select" value={rule.classification} onChange={e => edit({ classification: e.target.value as FareGstRule['classification'] })}><option value="passenger">Passenger transportation</option><option value="rental">Vehicle rental</option></select></label>
        <label className="ds-field"><span>Approved tax reference *</span><input className="ds-input" value={rule.reference} maxLength={300} onChange={e => edit({ reference: e.target.value })} /></label>
        <label className="ds-field"><span>Reason for change *</span><input className="ds-input" value={reason} maxLength={300} onChange={e => { setReason(e.target.value); setDirty(true); }} /></label>
      </div>
      <p className="text-[12px] my-3">Automatic split: same state → CGST + SGST; applicable Union Territory → CGST + UTGST; different supplier/place-of-supply states → IGST. Registered passenger recipients use their GSTIN state; other passengers use their verified boarding state.</p>
      <p className="text-[12px] text-muted">Route fares and business contracts retain their own included/excluded choice. Approved extras retain their separate tax treatment. This setting covers fare GST; cess, reverse-charge liabilities, permit taxes and input tax credits are separate accounting decisions.</p>
      <p className="text-[12px] text-muted my-2">Map pins do not establish a verified state. With pickup-state overrides configured, unverified pickups need booking-desk assistance. No external geocoder is used. Multicity remains a manual quotation service.</p>
      {Number.isFinite(pct) && <p className="text-[12px] my-3">Example, entered fare ₹1,000 at {pct}%: taxable ₹{taxable.toFixed(2)} + GST ₹{(taxable * rule.rate).toFixed(2)} = ₹{(taxable * (1 + rule.rate)).toFixed(2)}.</p>}
      <div className="flex gap-2"><Button onClick={() => save()} disabled={!dirty}>{busy ? 'Saving…' : 'Save GST settings'}</Button>{own && <Button variant="ghost" onClick={() => save(true)}>Remove this GST override</Button>}</div>
    </fieldset>
    {(loadError || message) && <p className="text-[12px] mt-3" role="status">{loadError || message}</p>}
  </section>;
}

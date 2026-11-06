import { useState } from 'react';
import { rentalRulePackages, type RentalPackageRule } from '../services/rentalPackageRule';
import { Button } from './ui';

const FIELDS = [
  ['firstHourFare', 'First-hour customer fare (INR)'],
  ['additionalHourFare', 'Each additional hour (INR)'],
  ['partnerPerHour', 'Partner payout per hour (INR)'],
  ['includedKm', 'Included kilometres'],
  ['extraKmRate', 'Extra kilometre rate (INR/km)'],
  ['extraHourRate', 'Extra-hour rate after the package (INR/hour)'],
] as const;

export default function RentalPackageBuilder({ initialRule, hourly, disabled, onGenerate }: {
  initialRule?: RentalPackageRule;
  hourly?: { firstHour?: number; laterHour?: number; partnerPerHour?: number };
  disabled: boolean;
  onGenerate: (rule: RentalPackageRule, packages: ReturnType<typeof rentalRulePackages>) => void;
}) {
  const [values, setValues] = useState(() => Object.fromEntries(FIELDS.map(([key]) => [key, String(initialRule?.[key] ?? ({ firstHourFare: hourly?.firstHour, additionalHourFare: hourly?.laterHour, partnerPerHour: hourly?.partnerPerHour, extraHourRate: hourly?.laterHour } as Partial<RentalPackageRule>)[key] ?? '')])) as Record<typeof FIELDS[number][0], string>);
  const [mode, setMode] = useState<RentalPackageRule['kmMode']>(initialRule?.kmMode ?? 'per_hour');
  const [generated, setGenerated] = useState(false);
  const valid = FIELDS.every(([key]) => values[key].trim() !== '' && Number.isFinite(Number(values[key])) && Number(values[key]) > 0 && Number(values[key]) <= 100000);
  const generate = () => {
    if (!valid || disabled) return;
    const rule = { ...Object.fromEntries(FIELDS.map(([key]) => [key, Number(values[key])])), kmMode: mode } as RentalPackageRule;
    onGenerate(rule, rentalRulePackages(rule));
    setGenerated(true);
  };
  return <section className="rounded-lg border border-line p-4 space-y-3" style={{ gridColumn: '1 / -1' }} aria-label="Rental package settings">
    <h3 className="text-sm font-bold">Rental package settings · 1–15 hours</h3>
    <p className="text-xs text-muted">Set how fare, partner payout and included kilometres scale with duration. Generate the packages, review or edit individual rows below, then save the fares. No prices change until you save.</p>
    <fieldset disabled={disabled} className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0">
      <label className="ds-field"><span>Kilometre allowance</span><select aria-label="Kilometre allowance" className="ds-select" value={mode} onChange={e => { setMode(e.target.value as RentalPackageRule['kmMode']); setGenerated(false); }}>
        <option value="per_hour">Kilometres per rental hour</option><option value="per_trip">Fixed kilometres per trip</option>
      </select></label>
      {FIELDS.map(([key, label]) => <label key={key} className="ds-field"><span>{label}</span><input type="number" className="ds-input" min="0.01" max="100000" step="0.01" value={values[key]} onChange={e => { setValues(v => ({ ...v, [key]: e.target.value })); setGenerated(false); }} /></label>)}
    </fieldset>
    <Button disabled={disabled || !valid} onClick={generate}>Generate 1–15-hour packages</Button>
    {generated ? <p role="status" className="text-xs text-ok">All 15 package rows updated. Review them and save the fares to publish.</p> : null}
  </section>;
}

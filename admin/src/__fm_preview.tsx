// TEMPORARY layout preview of the fare setting cards (deleted after checking). Not part of the app.
import '@fontsource/poppins/400.css'; import '@fontsource/poppins/500.css'; import '@fontsource/poppins/600.css'; import '@fontsource/poppins/700.css'; import '@fontsource/poppins/800.css';
import './index.css';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { CardBody, OnSwitch, Problems, RateTable, SaveBar, SettingCard, SharedLegend } from './components/RateTable';
import { Badge, Button } from './components/ui';

const cols = [{ key: 'sedan', name: 'Hatchback / Sedan' }, { key: 'suv', name: 'SUV 6+1 / SUV 7+1 / Innova' }, { key: 'crysta', name: 'Innova Crysta', status: { tone: 'warn' as const, text: 'Incomplete', title: 'x' } }];
const row = (key: string, label: string, unit: string, vals: [string, string][], required = false) => ({
  key, label, unit, required,
  cell: (c: string) => { const i = cols.findIndex((x) => x.key === c); const [v, ph] = vals[i]!; return { value: v, placeholder: ph || '—', own: v !== '' }; },
});
const plain = cols.map((c) => ({ key: c.key, name: c.name }));

function App() {
  const [on, setOn] = useState(true);
  return (
    <div style={{ background: '#f5f6f8', padding: 24 }}>
      <div className="fs-main" style={{ maxWidth: 1100 }}>
        <div className="space-y-4">
          <SettingCard title={<span className="flex flex-wrap items-center gap-2">NESAM → Round Trip<Badge tone="amber">Unsaved: Hatchback / Sedan</Badge></span>}
            description="Type a price to set it for this brand. Leave a box empty to use the shared price shown in grey."
            footer={<SaveBar note={<SharedLegend />} onSave={() => {}} />}>
            <RateTable label="x" columns={cols} groups={[
              { title: 'Customer pays', rows: [row('a', 'Price per km', '₹/km', [['14', '13'], ['', '21'], ['', '26']], true), row('b', 'Driver allowance', '₹/day', [['500', ''], ['', '500'], ['', '600']], true), row('c', 'Minimum km per day', 'km/day', [['', '250'], ['', '250'], ['', '250']], true)] },
              { title: 'Partner gets', rows: [row('d', 'Partner pay per km', '₹/km', [['12.6', ''], ['', '19'], ['', '24']], true), row('e', 'Roof carrier charge', '₹/trip', [['0', ''], ['300', ''], ['300', '']])] },
              { title: 'Extra charges', rows: [row('f', 'Waiting · customer pays', '₹/hour', [['200', ''], ['', '200'], ['250', '']]), row('g', 'Hill station · partner gets', '₹/trip', [['', ''], ['300', ''], ['', '']])] },
            ]} />
            <Problems items={['Hatchback / Sedan: add the partner amount for hill station. Without it the charge waits for office review.']} />
          </SettingCard>

          <SettingCard title="Time-based round trip" description="Customers choose days, not a return time. Package fares include driver allowance. Full-Day Return comes from the Round Trip rates above."
            aside={<div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="secondary">Fill demo values</Button><OnSwitch checked={on} onChange={setOn} /></div>}
            footer={<SaveBar reason="" onReason={() => {}} onSave={() => {}} disabled note="Morning Return is optional: fill all three boxes or none." />}>
            <CardBody>
              <div className="fm-mini-grid">
                {['Booked cutoff', 'Morning Return by', 'Next-day 8-hour from', 'Next-day 5-hour from', 'Late-night group ends'].map((l) => <label key={l} className="fm-mini"><span>{l}</span><input className="ds-input" type="time" defaultValue="23:45" /></label>)}
                {['Short package (hours)', 'Medium package (hours)', '5-hour km limit', '8-hour km limit'].map((l) => <label key={l} className="fm-mini"><span>{l}</span><input className="ds-input text-right" type="number" defaultValue="5" /></label>)}
              </div>
              <details className="fm-details" open><summary>How packages are offered</summary><ul><li>Pickup 1:00 AM to 2:59 PM: 8-hour, 5-hour and Full-Day Return by distance.</li><li>Past 8 hours or 150 km a booked short package moves up.</li></ul></details>
            </CardBody>
            <RateTable label="y" columns={plain} groups={[
              { title: 'Full day', rows: [{ key: 'fd', label: 'Full-Day Return', unit: '₹', cell: () => ({ display: '₹4,000' }) }] },
              { title: '5-hour package', rows: [row('h', 'Customer fare', '₹', [['2080', ''], ['2600', ''], ['3100', '']]), row('i', 'Included km', 'km', [['100', ''], ['100', ''], ['100', '']])] },
              { title: 'Availability', rows: [{ key: 'q', label: 'Quote to customers', cell: (c: string) => ({ checked: c !== 'suv', onToggle: () => {} }) }] },
            ]} />
          </SettingCard>

          <SettingCard title="Hill station charge" description="Added as its own fare line when the pickup, a stop or the drop is in a hill station."
            aside={<OnSwitch checked={!on} onChange={(v) => setOn(!v)} />}
            footer={<SaveBar reason="" onReason={() => {}} onSave={() => {}} disabled note="Leave both boxes empty for no charge." message={{ ok: true, text: 'Saved.' }} />}>
            <CardBody className="fm-body--inline">
              <label className="fm-inline-field"><span>Charge</span><select className="ds-select"><option>Once per trip</option></select></label>
              <details className="fm-details"><summary>15 hill stations detected</summary><p>Ooty, Kodaikanal.</p></details>
            </CardBody>
            <RateTable label="z" columns={plain} groups={[{ title: 'One-way trip', rows: [row('j', 'Customer charge', '₹', [['500', ''], ['600', ''], ['1000', '']]), row('k', 'Partner payout', '₹', [['400', ''], ['500', ''], ['800', '']])] }]} />
          </SettingCard>

          <SettingCard title="Rules for extra charges" description="Used for waiting, hill and roof carrier charges on every brand, service and vehicle." aside={<span className="fm-chip fm-chip--ok">Set</span>}
            footer={<SaveBar onSave={() => {}} disabled saveLabel="Save rules" />}>
            <CardBody><fieldset className="fm-mini-grid min-w-0">
              <label className="fm-mini"><span>Free waiting per stop (min)</span><input className="ds-input text-right" defaultValue="30" /></label>
              <label className="fm-mini"><span>Round waiting up to (min)</span><input className="ds-input text-right" defaultValue="15" /></label>
              <label className="fm-mini"><span>Rounding</span><select className="ds-select"><option>Each stop on its own</option></select></label>
              <label className="fm-mini"><span>GST on extra charges</span><select className="ds-select"><option>Add the booking GST rate</option></select></label>
            </fieldset></CardBody>
          </SettingCard>

          <SettingCard title="Pet travel charge" description="One amount per trip for every brand, service and vehicle." footer={<SaveBar onSave={() => {}} disabled />}>
            <CardBody><label className="fm-inline-field"><span>Charge</span><span className="fm-affix fm-affix--pre"><span>₹</span><input className="fm-input is-own" type="number" defaultValue="300" /></span><small className="fm-hint">per trip</small></label></CardBody>
          </SettingCard>

          <SettingCard title="Struck-out price" description={<>Shown crossed out above the real fare in the customer apps. Example: a ₹1,000 fare shows <s>₹1,100</s>.</>}
            footer={<SaveBar reason="" onReason={() => {}} onSave={() => {}} disabled note="Applies to NESAM → Round Trip." />}>
            <CardBody><label className="fm-inline-field"><span>Increase by</span><span className="fm-affix"><input className="fm-input" type="number" placeholder="10" /><span>%</span></span><small className="fm-hint">Shared: 10%</small></label></CardBody>
          </SettingCard>
        </div>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);

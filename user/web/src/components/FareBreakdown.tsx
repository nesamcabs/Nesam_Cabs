import type { FareLine } from '@core/types';
import { formatINR } from '@core/utils/format';
import { PolicyLinks, type PolicyId } from '@/pages/PolicySections';
import { AdditionalCharges } from '@/components/AdditionalCharges';

const money = (n: number) => (n < 0 ? `−${formatINR(-n)}` : formatINR(n));

/** The small grey line under a fare row, in plain words: "399.3 km included • Minimum 130 km", "Included in total". */
function detailText(l: FareLine): string {
  const d = (l.detail ?? '').trim();
  if (!d) return '';
  if (l.key === 'gst') return 'Included in total'; // the total shown is always the amount payable, GST included
  if (/(^|—\s*)included in the fare$/i.test(d)) return '';
  if (l.key === 'distance') {
    const m = /^(.+?) KM (included|billable) \((?:local )?minimum (.+?) KM(.*?)\)(?: at .+)?$/i.exec(d);
    if (m) return `${m[1]} km ${m[2]!.toLowerCase()} • Minimum ${m[3]} km${m[4]}`;
    return d.replace(/\s+at\s+₹[\d.,]+\/KM/i, '').replace(/\bKM\b/g, 'km');
  }
  return d;
}

/**
 * Fare breakup in three groups, each line labelled: what the total includes, what is
 * payable separately (at a rate or at actuals) and what does not apply. The total is
 * always the package total — extras are never silently added to it.
 */
export function FareBreakdown({ lines, total, tolls = 0, estimated = false, policies = ['payment'], footnote }: { lines: FareLine[]; total: number; tolls?: number; estimated?: boolean; policies?: PolicyId[]; footnote?: string }) {
  const included = lines.filter((l) => l.treatment === 'included');
  const extra = lines.filter((l) => l.treatment === 'extra');
  const na = lines.filter((l) => l.treatment === 'not_applicable');
  const gstIncluded = included.some((l) => l.key === 'gst' && (l.amount ?? 0) > 0);
  return (
    <div className="fare">
      <div className="fare__hero">
        <div className="fare__hero-main">
          <span className="fare__hero-label">{estimated ? 'Estimated total fare' : 'Total fare'}</span>
          <strong className="fare__hero-amount num">{formatINR(total + tolls)}</strong>
        </div>
        {gstIncluded ? (
          <span className="fare__hero-badge">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="12" fill="currentColor" /><path d="m7 12.5 3.2 3.2L17 9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            GST included
          </span>
        ) : null}
      </div>

      <h3 className="fare__heading">Fare breakup</h3>
      <ul className="fare__rows">
        {included.map((l) => (
          <li key={l.key} className="fare__row">
            <div>
              <span className="fare__label">{l.label}</span>
              {detailText(l) ? <small>{detailText(l)}</small> : null}
            </div>
            <span className={`fare__value num ${(l.amount ?? 0) < 0 ? 'is-saving' : ''}`}>{l.amount === null ? 'Included' : money(l.amount)}</span>
          </li>
        ))}
        {tolls > 0 ? (
          <li className="fare__row">
            <div>
              <span className="fare__label">Tolls &amp; parking recorded</span>
              <small>Paid by the driver during the trip</small>
            </div>
            <span className="fare__value num">{money(tolls)}</span>
          </li>
        ) : null}
      </ul>
      {extra.length ? <AdditionalCharges lines={extra} policy={<PolicyLinks ids={['terms']} newTab />} footnote={footnote} /> : null}
      {na.length ? <p className="fare__na">Not applicable: {na.map((l) => l.label).join(', ')}.</p> : null}
      {extra.length ? null : (
        <>
          <PolicyLinks lead={tolls > 0 ? undefined : 'Tolls, parking and permits are not included.'} ids={policies} newTab />
          {footnote ? <p className="fare-note">{footnote}</p> : null}
        </>
      )}
    </div>
  );
}

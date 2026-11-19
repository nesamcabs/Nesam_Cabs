// "Choose vehicle & package" for a Round Trip (Customer UX 9.0): vehicle class tabs (Sedan · SUV · Innova · Crysta), the chosen vehicle's
// name, then that vehicle's packages — the first as the hero card, the others compact. The server prices every package for every
// vehicle, so picking a vehicle or a package only changes the choice; the fare in force always comes from the server's answer.
import type { RideCategory } from '@core/types';
import type { ServerCategoryQuote, ServerTimePackage } from '@core/services/quoteService';
import { formatINR } from '@core/utils/format';
import { Icon } from '@/components/Icon';
import './roundVehicle.css';
import { categoryName, categoryPhoto } from '@/lib/categories';
import { FuelPick, type FuelChoice } from '@/components/CabParts';
import { packageClock, packageDay, packageRuleText } from '@core/utils/timePackages';

/** The short class name on a vehicle tab: "Sedan", "SUV", "Innova", "Crysta". */
export function vehicleTabLabel(name: string): string {
  const n = name.trim();
  if (/crysta/i.test(n)) return 'Crysta';
  return n.replace(/\s*(or|\/)\s*similar$/i, '').replace(/^toyota\s+/i, '') || n;
}

interface Props {
  categories: RideCategory[];
  selected: RideCategory | null;
  entries: Map<string, ServerCategoryQuote>;
  unavailable: Map<string, string>;
  packages: ServerTimePackage[];
  selectedPackage: ServerTimePackage | null;
  autoDays: boolean;
  fuel: FuelChoice;
  hasCng: boolean;
  scheduledAt: Date | null;
  loading: boolean;
  /** The booking server is still pricing this trip. */
  quoteLoading?: boolean;
  onPickVehicle: (c: RideCategory) => void;
  onPickPackage: (id: string) => void;
  onFuel: (c: RideCategory, f: FuelChoice) => void;
  onFareDetails: (c: RideCategory) => void;
}

export function RoundVehiclePackage(p: Props) {
  const { selected, packages } = p;
  const entry = selected ? p.entries.get(selected.id) : undefined;
  const standard = packages.find((x) => x.id === 'same:full') ?? packages.find((x) => x.id === 'next');
  /** The small tag floating on a package card. The first card always carries one; the others only when they say something (a saving, the standard, an early return). */
  const badge = (x: ServerTimePackage, first: boolean): { text: string; tone: 'save' | 'std' | 'early' | 'rec' } | null => {
    const save = standard && standard !== x ? standard.fare.total - x.fare.total : 0;
    if (save > 0) return { text: `${formatINR(save)} less than ${standard!.label}`, tone: 'save' };
    if (x.kind === 'morning') return { text: 'Early-return option', tone: 'early' };
    if (x.id === standard?.id) return { text: 'Standard package', tone: 'std' };
    return first ? { text: 'Recommended package', tone: 'rec' } : null;
  };
  /** What the package includes, as short chips: distance, time allowed, driver bata. */
  const chips = (x: ServerTimePackage): string[] => {
    const split = x.dayKm && x.dayKm.length > 1 ? ` (First day: ${x.dayKm[0]} km + ${x.dayKm.length === 2 ? 'Next day' : 'Each next day'}: ${x.dayKm[1]} km)` : '';
    const when = x.kind === 'morning' ? 'Overnight' : x.hours ? `Up to ${x.hours} hours` : x.kind === 'next_day' ? `${x.days} calendar days${split}` : 'Full day';
    return [`${x.includedKm} km included`, when, `Driver bata${x.days > 1 ? ` for ${x.days === 2 ? 'both' : 'all'} days` : ''} included`];
  };
  const endText = (x: ServerTimePackage) => {
    const end = new Date(x.endAt);
    const same = p.scheduledAt ? packageDay(end) === packageDay(p.scheduledAt) : true;
    return `Return by ${same ? '' : `${packageDay(end)}, `}${packageClock(end)}`;
  };
  const upgradeNote = (x: ServerTimePackage) =>
    x.upgrade ? (
      <span className="rvp__note">
        <Icon name="info" size={14} />
        <span>Still running after {packageClock(new Date(x.morningCutoffAt ?? x.endAt))}? It upgrades to {x.upgrade.label} (+{formatINR(x.upgrade.increase)}, {x.upgrade.includedKm} km included).</span>
      </span>
    ) : null;
  const photo = selected ? categoryPhoto(selected) : '';
  /** The lowest package fare a vehicle has for this trip (what "From ₹…" on its tab shows). */
  const from = (c: RideCategory): number | null => {
    const e = p.entries.get(c.id);
    if (!e?.ok) return null;
    const list = e.packages?.length ? e.packages.map((x) => x.fare.taxableAmount) : e.fare ? [e.fare.taxableAmount] : [];
    return list.length ? Math.min(...list) : null;
  };
  const reason = selected ? p.unavailable.get(selected.id) : '';
  const fare = selected && entry?.ok ? entry.fare : undefined;

  return (
    <section className="rvp" aria-labelledby="rvp-title">
      <h2 id="rvp-title" className="rvp__title">Choose vehicle &amp; package</h2>

      <div className="rvp__tabs" role="radiogroup" aria-label="Vehicle">
        {p.categories.map((c) => {
          const on = selected?.id === c.id;
          const off = p.unavailable.has(c.id);
          return (
            <button key={c.id} type="button" role="radio" aria-checked={on} disabled={off} className={`rvp__tab ${on ? 'is-on' : ''}`} onClick={() => p.onPickVehicle(c)} title={off ? p.unavailable.get(c.id) : undefined}>
              <img src={categoryPhoto(c)} alt="" loading="lazy" decoding="async" />
              <span>{vehicleTabLabel(c.name)}</span>
              {from(c) ? <small>From {formatINR(from(c)!)}</small> : null}
            </button>
          );
        })}
        {p.loading && p.categories.length === 0 ? <span className="skeleton rvp__tab-skel" /> : null}
      </div>

      {selected ? (
        <div className="rvp__vehicle" aria-live="polite">
          <div className="rvp__vtext">
            <span className="rvp__vclass">{vehicleTabLabel(selected.name)}</span>
            <strong>{categoryName(selected)}</strong>
            <span className="rvp__vmeta">
              <span><Icon name="user" size={14} /> {selected.seats} seats</span>
              <span><Icon name="snowflake" size={14} /> AC</span>
            </span>
          </div>
          {photo ? <img src={photo} alt="" decoding="async" /> : null}
        </div>
      ) : null}

      {p.autoDays && packages[0] ? (
        <p className="pkgs__auto"><Icon name="clock" size={15} /> No same-day package fits this pickup time and trip, so it is planned as a {packages[0].days}-day trip.</p>
      ) : null}
      {reason ? <p className="rvp__na" role="alert">{reason}</p> : null}
      {!packages.length && !fare && !reason && selected ? (
        p.quoteLoading || p.entries.size === 0 ? (
          <div className="rvp__wait" aria-busy="true" aria-label="Getting packages and fares">
            <span className="skeleton rvp__skel" />
            <span className="skeleton rvp__skel" />
          </div>
        ) : (
          <p className="rvp__na" role="status">Packages and fares for {vehicleTabLabel(selected.name)} are not available for this trip right now. Please choose another vehicle or call us to book.</p>
        )
      ) : null}

      {packages.length ? (
        <div className="rvp__list" role="radiogroup" aria-label="Round-trip packages">
          {packages.map((x, i) => {
            const on = x.id === p.selectedPackage?.id;
            const tag = badge(x, i === 0);
            return (
              <button key={x.id} type="button" role="radio" aria-checked={on} className={`rvp__pkg ${on ? 'is-on' : ''} ${tag ? 'has-tag' : ''}`} onClick={() => p.onPickPackage(x.id)}>
                {tag ? <span className={`rvp__badge rvp__badge--${tag.tone}`}>{tag.text}</span> : null}
                <span className="rvp__head">
                  <span className="rvp__tick" aria-hidden="true">{on ? <Icon name="check" size={13} /> : null}</span>
                  <strong className="rvp__name">{x.label}</strong>
                  <b className="rvp__price">{formatINR(x.fare.total)}</b>
                </span>
                <span className="rvp__chips">
                  {chips(x).map((c) => <span key={c} className="rvp__chip">{c}</span>)}
                </span>
                <span className="rvp__foot">
                  <span className="rvp__return"><Icon name="clock" size={14} /> <b>{endText(x)}</b></span>
                  <span className="rvp__extra">Extra {formatINR(x.extraKmRate)}/km</span>
                </span>
                {on ? upgradeNote(x) : null}
              </button>
            );
          })}
        </div>
      ) : fare && selected ? (
        <div className="rvp__pkg rvp__pkg--static is-on" role="status">
          <span className="rvp__head">
            <strong className="rvp__name">Round Trip{entry?.days ? ` · ${entry.days} ${entry.days === 1 ? 'day' : 'days'}` : ''}</strong>
            <b className="rvp__price">{formatINR(fare.total)}</b>
          </span>
          <span className="rvp__chips">
            <span className="rvp__chip">{entry?.includedKm ? `${entry.includedKm} km included` : 'Fare confirmed by quote'}</span>
            <span className="rvp__chip">Driver bata included</span>
          </span>
          {entry?.extraKmRate ? <span className="rvp__foot"><span className="rvp__extra">Extra {formatINR(entry.extraKmRate)}/km</span></span> : null}
        </div>
      ) : null}

      {packages.length ? (
        <div className="rvp__rule">
          <span className="rvp__ruleicon" aria-hidden="true"><Icon name="clock" size={16} /></span>
          <div className="rvp__ruletext">
            <strong>How your package works</strong>
            {packageRuleText(packages, packageClock).split(/(?<=\.)\s+/).filter(Boolean).map((line) => <span key={line}>{line}</span>)}
          </div>
        </div>
      ) : null}

      {selected && p.hasCng ? <FuelPick name={`fuel-${selected.id}`} value={p.fuel} onChange={(f) => p.onFuel(selected, f)} /> : null}

      <div className="pkgs__fine">
        <ul>
          <li><Icon name="info" size={14} /> <span>Toll, parking &amp; state permit tax extra.</span></li>
          <li><Icon name="info" size={14} /> <span>Your package is the minimum charge; a longer or farther trip moves to the next package.</span></li>
        </ul>
        {selected ? (
          <button type="button" className="rvp__details" onClick={() => p.onFareDetails(selected)}>
            Fare details &amp; exclusions <Icon name="arrow-right" size={14} />
          </button>
        ) : null}
      </div>
    </section>
  );
}

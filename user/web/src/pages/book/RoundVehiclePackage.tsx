// "Choose vehicle & package" for a Round Trip (Customer UX 9.0): vehicle class tabs (Sedan · SUV · Innova · Crysta), the chosen vehicle's
// name, then that vehicle's packages — the first as the hero card, the others compact. The server prices every package for every
// vehicle, so picking a vehicle or a package only changes the choice; the fare in force always comes from the server's answer.
import type { RideCategory } from '@core/types';
import type { ServerCategoryQuote, ServerTimePackage } from '@core/services/quoteService';
import { formatDate, formatINR, formatTime } from '@core/utils/format';
import { Icon } from '@/components/Icon';
import { categoryName, categoryPhoto } from '@/lib/categories';
import { FuelPick, type FuelChoice } from '@/components/CabParts';
import { packageRuleText } from '@core/utils/timePackages';

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
  onPickVehicle: (c: RideCategory) => void;
  onPickPackage: (id: string) => void;
  onFuel: (c: RideCategory, f: FuelChoice) => void;
  onFareDetails: (c: RideCategory) => void;
}

export function RoundVehiclePackage(p: Props) {
  const { selected, packages } = p;
  const entry = selected ? p.entries.get(selected.id) : undefined;
  const standard = packages.find((x) => x.id === 'same:full') ?? packages.find((x) => x.id === 'next');
  const badge = (x: ServerTimePackage) => {
    const save = standard && standard !== x ? standard.fare.total - x.fare.total : 0;
    if (save > 0) return `${formatINR(save)} less than ${standard!.label}`;
    return x.kind === 'morning' ? 'Early-return option' : x.id === standard?.id ? 'Standard package' : 'Recommended package';
  };
  const detail = (x: ServerTimePackage) => {
    const split = x.dayKm && x.dayKm.length > 1 ? ` (First day: ${x.dayKm[0]} km + ${x.dayKm.length === 2 ? 'Next day' : 'Each next day'}: ${x.dayKm[1]} km)` : '';
    const when = x.kind === 'morning' ? 'Overnight' : x.hours ? `Up to ${x.hours} hours` : x.kind === 'next_day' ? `${x.days} calendar days${split}` : 'Full day';
    return `${x.includedKm} km included · ${when}`;
  };
  const endText = (x: ServerTimePackage) => {
    const end = new Date(x.endAt);
    const same = p.scheduledAt ? formatDate(end) === formatDate(p.scheduledAt) : true;
    return `${x.kind === 'morning' ? 'Return by' : 'Ends'} ${same ? '' : `${formatDate(end)}, `}${formatTime(end)}`;
  };
  const upgradeNote = (x: ServerTimePackage) =>
    x.upgrade ? (
      <span className="pkg__note">
        Still running after {formatTime(new Date(x.morningCutoffAt ?? x.endAt))}? It upgrades to {x.upgrade.label} (+{formatINR(x.upgrade.increase)}, {x.upgrade.includedKm} km included).
      </span>
    ) : null;
  const photo = selected ? categoryPhoto(selected) : '';
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
            </button>
          );
        })}
        {p.loading && p.categories.length === 0 ? <span className="skeleton rvp__tab-skel" /> : null}
      </div>

      {selected ? (
        <p className="rvp__caption" aria-live="polite">
          <Icon name="car" size={15} /> <strong>{vehicleTabLabel(selected.name)}</strong> <span>{categoryName(selected)} · {selected.seats} seats · AC</span>
        </p>
      ) : null}

      {p.autoDays && packages[0] ? (
        <p className="pkgs__auto"><Icon name="clock" size={15} /> No same-day package fits this pickup time and trip, so it is planned as a {packages[0].days}-day trip.</p>
      ) : null}
      {reason ? <p className="rvp__na" role="alert">{reason}</p> : null}

      {packages.length ? (
        <div className="rvp__list" role="radiogroup" aria-label="Round-trip packages">
          {packages.map((x, i) => {
            const on = x.id === p.selectedPackage?.id;
            return i === 0 ? (
              <button key={x.id} type="button" role="radio" aria-checked={on} className={`rvp__hero ${on ? 'is-on' : ''}`} onClick={() => p.onPickPackage(x.id)}>
                <span className="rvp__top">
                  <span className="rvp__badge">{badge(x)}</span>
                  <span className="rvp__tick" aria-hidden="true">{on ? <Icon name="check" size={13} /> : null}</span>
                </span>
                <span className="rvp__main">
                  <span className="rvp__text">
                    <strong>{x.label}</strong>
                    <span>{detail(x)}</span>
                    <span>Driver bata{x.days > 1 ? ` for ${x.days === 2 ? 'both' : 'all'} days` : ''} included</span>
                  </span>
                  <span className="rvp__right">
                    <b>{formatINR(x.fare.total)}</b>
                    <img src={photo} alt="" loading="lazy" decoding="async" />
                  </span>
                </span>
                <span className="rvp__foot"><b>{endText(x)}</b> · Extra {formatINR(x.extraKmRate)}/km</span>
                {on ? upgradeNote(x) : null}
              </button>
            ) : (
              <button key={x.id} type="button" role="radio" aria-checked={on} className={`rvp__compact ${on ? 'is-on' : ''}`} onClick={() => p.onPickPackage(x.id)}>
                <span className="rvp__text">
                  <strong>{x.label}</strong>
                  <span>{detail(x)}</span>
                  <span><b>{endText(x)}</b> · Driver bata included · Extra {formatINR(x.extraKmRate)}/km</span>
                  {on ? upgradeNote(x) : null}
                </span>
                <span className="rvp__right">
                  <b>{formatINR(x.fare.total)}</b>
                  <span className="rvp__tick" aria-hidden="true">{on ? <Icon name="check" size={13} /> : null}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : fare && selected ? (
        <div className="rvp__hero is-on" role="status">
          <span className="rvp__main">
            <span className="rvp__text">
              <strong>Round Trip{entry?.days ? ` · ${entry.days} ${entry.days === 1 ? 'day' : 'days'}` : ''}</strong>
              <span>{entry?.includedKm ? `${entry.includedKm} km included` : 'Fare confirmed by quote'}</span>
              <span>Driver bata included{entry?.extraKmRate ? ` · Extra ${formatINR(entry.extraKmRate)}/km` : ''}</span>
            </span>
            <span className="rvp__right">
              <b>{formatINR(fare.total)}</b>
              <img src={photo} alt="" loading="lazy" decoding="async" />
            </span>
          </span>
        </div>
      ) : null}

      {packages.length ? <p className="rvp__rule"><Icon name="clock" size={15} /> <span>{packageRuleText(packages, formatTime)}</span></p> : null}

      {selected && p.hasCng ? <FuelPick name={`fuel-${selected.id}`} value={p.fuel} onChange={(f) => p.onFuel(selected, f)} /> : null}

      <p className="pkgs__fine">
        Toll, parking &amp; state permit tax extra. Your package is the minimum charge; a longer or farther trip moves to the next package.{' '}
        {selected ? (
          <button type="button" className="cab__breakup-btn" onClick={() => p.onFareDetails(selected)}>
            <Icon name="info" size={12} /> Fare details &amp; exclusions
          </button>
        ) : null}
      </p>
    </section>
  );
}

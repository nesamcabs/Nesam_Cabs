import { useEffect, useMemo, useState } from "react";
import { saveRule, setRuleStatus, type Adjustment, type ServiceRule } from "../services/serviceRulesService";
import { BRAND_LABELS, serviceLabel, useTariff, type FareWorkspaceScope } from "../services/tariffService";
import { Button } from "./ui";
import type { MasterLocation } from "../types";
import LocationScopeSelector from "./location/LocationScopeSelector";
import type { FeedStatus } from "../hooks/useLocationsFeed";
import { EMPTY_SEL, indexLocations, rulePlaceLabel, rulePlacesOf, type LocSel } from "../domain/locationHierarchy";
import { CardBody, Problems, SaveBar, SettingCard } from "./RateTable";

// Price changes: one row per rule. Every row names the place, the SERVICE the change is for (One Way, Round Trip, Airport, Hourly
// Rental, Multicity) and, for a Round Trip, which time-based PACKAGES it covers (all, or e.g. only the 5-hour and 3-hour slabs).
// Each row is an ordinary service rule (service_rules) that the booking server applies exactly as shown: the brand's own rule first,
// then the most specific place, then a rule for the service over an all-services one, then a rule for named packages over an
// all-packages one. Rules with dates or pickup-only / drop-only stay in the special-rules list.

type Place = { state: string; city: string; area: string; zoneId?: string; zoneName?: string };
type Edit = { cust?: string; part?: string; packages?: string[] };
type NewRow = { key: string; place: Place; service: string; packages: string[]; cust: string; part: string };

const SERVICES = ["One Way", "Round Trip", "Airport Taxi", "Local Rental", "Multicity"] as const;
const ALL = "";
const norm = (s?: string) => (s ?? "").trim().toLowerCase();
const signed = (a?: Adjustment) => (!a || a.mode === "Normal" ? "0" : `${a.mode === "Decrease" ? "-" : ""}${a.percent}`);
const shown = (a?: Adjustment) => (!a || a.mode === "Normal" ? "0" : `${a.mode === "Decrease" ? "−" : "+"}${a.percent}`);
const adjOf = (v: string): Adjustment => {
  const n = Number(v.trim() === "" ? 0 : v);
  return n === 0 ? { mode: "Normal", percent: 0 } : { mode: n > 0 ? "Increase" : "Decrease", percent: Math.abs(n) };
};
const badPct = (v: string) => v.trim() !== "" && !(Number.isFinite(Number(v)) && Math.abs(Number(v)) < 100);
const keyOf = (p: Place) => `${p.state}|${p.city}|${p.area}${p.zoneId ? `|z:${p.zoneId}` : ""}`;
const pkgKey = (p?: string[]) => (p?.length ? [...p].sort().join(",") : "");
/** A standing price change this table can show and edit: on, no dates, for pickup or drop. */
const standing = (r: ServiceRule) => r.kind === "pricing" && r.status === "Enabled" && r.schedule.mode === "Always" && (r.scope.side ?? "Pickup or drop") === "Pickup or drop";
let seq = 0;

export default function PriceChangeRules({ rules, fareScope, canEdit, loaded, loadError, locations, locationsStatus, onRetry, onManageLocations, onToast }: {
  /** Every rule of this brand (any service) plus the shared All-brands ones; removed ones may be included. */
  rules: ServiceRule[];
  fareScope: FareWorkspaceScope;
  canEdit: boolean;
  loaded: boolean;
  loadError: string | null;
  locations: MasterLocation[];
  onManageLocations?: () => void;
  locationsStatus?: FeedStatus;
  onRetry?: () => void;
  onToast: (text: string) => void;
}) {
  const { tariff } = useTariff();
  const common = fareScope.brand === "common";
  const brandId = common ? "" : fareScope.brand;
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<NewRow[]>([]);
  const [pick, setPick] = useState<LocSel>(EMPTY_SEL);
  const index = useMemo(() => indexLocations(locations), [locations]);
  const [services, setServices] = useState<string[]>([fareScope.service]);
  const [pickPkgs, setPickPkgs] = useState<string[]>([]);
  const [cust, setCust] = useState("");
  const [part, setPart] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setEdits({}); setRemoved(new Set()); setAdded([]); setMessage(null); setServices([fareScope.service]); }, [fareScope.brand]); // eslint-disable-line react-hooks/exhaustive-deps

  // The time-based packages a Round Trip price change can name: the 5-hour, the 8-hour, any extra hour slabs, Full Day, Morning, Next-Day.
  const packageChoices = useMemo(() => {
    const tb = tariff?.roundTrip?.timeBased;
    const five = tb?.fiveHours ?? 5, eight = tb?.eightHours ?? 8;
    const slabs = [
      { id: "same:five", hours: five, label: tb?.names?.five || `${five}-hour package` },
      { id: "same:eight", hours: eight, label: tb?.names?.eight || `${eight}-hour package` },
      ...(tb?.extraSlabs ?? []).map((x) => ({ id: `same:h${x.hours}`, hours: x.hours, label: x.name || `${x.hours}-hour package` })),
    ].sort((a, b) => a.hours - b.hours);
    return [...slabs.map(({ id, label }) => ({ id, label })), { id: "same:full", label: tb?.names?.full || "Full-Day Return" }, { id: "morning", label: tb?.names?.morning || "Morning Return" }, { id: "next", label: tb?.names?.next ? `${tb.names.next} / multi-day` : "Next-Day / multi-day" }];
  }, [tariff]);
  const pkgName = (id: string) => packageChoices.find((p) => p.id === id)?.label ?? id;

  const own = (r: ServiceRule) => (r.brand ?? "") === brandId;
  const live = useMemo(() => rules.filter((r) => standing(r) && (!r.brand || r.brand === brandId)), [rules, brandId]);
  const place = (r: ServiceRule): Place => ({ state: r.scope.state, city: r.scope.city, area: r.scope.area, ...(r.scope.zoneId ? { zoneId: r.scope.zoneId, zoneName: r.scope.zoneName } : {}) });
  const where = (p: Place) => rulePlaceLabel(p);
  const serviceText = (s: string) => (s === ALL ? "All services" : serviceLabel(s));
  const rows = useMemo(() => [...live].sort((a, b) => (a.scope.state || "").localeCompare(b.scope.state || "") || (a.scope.city || "").localeCompare(b.scope.city || "") || (a.scope.area || "").localeCompare(b.scope.area || "") || (a.fareService ?? "").localeCompare(b.fareService ?? "")), [live]);

  const setEdit = (id: string, patch: Edit) => { setMessage(null); setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } })); };
  const togglePkg = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  // ── What will be saved ──
  type Op = { kind: "create"; row: NewRow; service: string } | { kind: "update"; rule: ServiceRule; patch: Partial<ServiceRule> } | { kind: "remove"; rule: ServiceRule };
  const ops: Op[] = [];
  const problems: string[] = [];
  const seen = new Map<string, string>();
  const note = (k: string, text: string) => { if (seen.has(k)) problems.push(`${text}: there is already a price change for this place, service and packages. Edit that one instead.`); else seen.set(k, text); };
  for (const r of rows.filter(own)) {
    if (removed.has(r.id)) { ops.push({ kind: "remove", rule: r }); continue; }
    const name = `${where(place(r))} · ${serviceText(r.fareService ?? ALL)}`;
    const e = edits[r.id] ?? {};
    const c = e.cust ?? signed(r.customer), p = e.part ?? signed(r.partner);
    const pk = e.packages ?? r.packages ?? [];
    note(`${keyOf(place(r))}|${r.fareService ?? ""}|${pkgKey(pk)}`, name);
    if (e.cust === undefined && e.part === undefined && e.packages === undefined) continue;
    if (badPct(c) || badPct(p)) { problems.push(`${name}: a price change must be between −99% and +99%.`); continue; }
    const customer = adjOf(c), partner = adjOf(p);
    if (customer.mode === "Normal" && partner.mode === "Normal") { problems.push(`${name}: enter a change for the customer fare or the partner pay, or remove the row.`); continue; }
    ops.push({ kind: "update", rule: r, patch: { customer, partner, packages: pk.length ? pk : undefined } });
  }
  for (const n of added) {
    const name = `${where(n.place)} · ${serviceText(n.service)}`;
    note(`${keyOf(n.place)}|${n.service}|${pkgKey(n.service === "Round Trip" ? n.packages : [])}`, name);
    ops.push({ kind: "create", row: n, service: n.service });
  }
  const pending = ops.length > 0;

  // ── Add form ──
  const toAdd: Place[] = rulePlacesOf(pick, index);
  const serviceChoices = common ? [ALL, ...SERVICES] : SERVICES;
  const addProblem = !toAdd.length ? "Choose where the price change applies." : !services.length ? "Choose at least one service." : badPct(cust) || badPct(part) ? "A price change must be between −99% and +99%." : adjOf(cust).mode === "Normal" && adjOf(part).mode === "Normal" ? "Enter a change for the customer fare or the partner pay." : "";
  const addRow = () => {
    if (addProblem) return setMessage({ ok: false, text: addProblem });
    setMessage(null);
    for (const p of toAdd) {
      for (const s of services) setAdded((list) => [...list, { key: `n${seq++}`, place: p, service: s, packages: s === "Round Trip" ? pickPkgs : [], cust, part }]);
    }
    setCust(""); setPart(""); setPickPkgs([]);
  };

  const save = async () => {
    if (!canEdit || busy || !pending || problems.length) return;
    if (reason.trim().length < 5) return setMessage({ ok: false, text: "Add a short reason (at least 5 characters)." });
    setBusy(true);
    setMessage(null);
    let done = 0;
    const why = reason.trim();
    try {
      for (const op of ops) {
        if (op.kind === "remove") await setRuleStatus(op.rule, "Removed", why);
        else if (op.kind === "update") await saveRule({ ...op.rule, ...op.patch, packages: op.patch.packages, reason: why }, op.rule.id, op.rule);
        else {
          const n = op.row;
          await saveRule({
            brand: brandId, fareService: op.service, kind: "pricing", name: `${where(n.place)} · ${serviceText(op.service)} price change`, status: "Enabled", priority: 1,
            scope: { ...n.place, side: "Pickup or drop" }, service: op.service, schedule: { mode: "Always" },
            customer: adjOf(n.cust), partner: adjOf(n.part), ...(op.service === "Round Trip" && n.packages.length ? { packages: n.packages } : {}), reason: why,
          });
        }
        done++;
      }
      setEdits({}); setRemoved(new Set()); setAdded([]); setReason("");
      onToast(`Price changes saved for ${common ? "All brands" : BRAND_LABELS[fareScope.brand as keyof typeof BRAND_LABELS]}. New quotes and bookings use them now.`);
    } catch (err) {
      setMessage({ ok: false, text: `${done ? `${done} of ${ops.length} changes were saved. ` : ""}${err instanceof Error ? err.message : "Not saved. Please try again."}` });
    } finally {
      setBusy(false);
    }
  };

  const PackagePicker = ({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) => (
    <details className="relative">
      <summary className={`ds-select cursor-pointer text-[12px] ${disabled ? "opacity-50 pointer-events-none" : ""}`} aria-label="Packages this price change covers">
        {value.length ? `${value.length} package${value.length === 1 ? "" : "s"}` : "All packages"}
      </summary>
      <div className="absolute z-20 mt-1 w-56 rounded-xl border border-line bg-white p-2 shadow-lg">
        <button type="button" className="mb-1 w-full rounded-lg px-2 py-1 text-left text-[12px] font-semibold text-brand hover:bg-gray-50" onClick={() => onChange([])}>All packages</button>
        {packageChoices.map((p) => (
          <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-[12px] hover:bg-gray-50">
            <input type="checkbox" checked={value.includes(p.id)} onChange={() => onChange(togglePkg(value, p.id))} /> {p.label}
          </label>
        ))}
      </div>
    </details>
  );

  const total = rows.length;
  return (
    <SettingCard id="rules-prices" label="Price changes" title="Price changes by service"
      description="Raise or lower the customer fare or the partner pay for a place, for the services you choose. A Round Trip change can cover all packages or only some (for example just the short hour slabs). A rule for one service beats an all-services rule; a rule for named packages beats an all-packages rule."
      footer={canEdit
        ? <SaveBar reason={reason} onReason={setReason} onSave={save} busy={busy} disabled={!pending || problems.length > 0 || !loaded || !!loadError} message={message}
            note={pending ? `${ops.length} change${ops.length === 1 ? "" : "s"} not saved yet.` : "Type 10 for +10%, -5 for −5%. Shared rows come from All brands and are changed there."} />
        : null}>
      {canEdit && (
        <CardBody>
          <LocationScopeSelector variant="row" label="Price change location" value={pick} onChange={setPick} locations={locations} status={locationsStatus} depth="area" pinSearch="multi"
            broad={{ state: "All locations", district: "Whole state", zone: "All zones", area: "All mapped areas" }} onManageLocations={onManageLocations} />
          <div className="fm-place-picker mt-3">
            <label className="fm-mini"><span>Customer fare %</span><input className="ds-input text-right" inputMode="decimal" value={cust} placeholder="0" onChange={(e) => setCust(e.target.value)} aria-label="Customer fare change" /></label>
            <label className="fm-mini"><span>Partner pay %</span><input className="ds-input text-right" inputMode="decimal" value={part} placeholder="0" onChange={(e) => setPart(e.target.value)} aria-label="Partner pay change" /></label>
          </div>
          <fieldset className="mt-3">
            <legend className="text-[11px] font-bold uppercase text-muted">Applies to which service</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {serviceChoices.map((s) => (
                <label key={s || "all"} className="flex cursor-pointer items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={services.includes(s)} onChange={() => setServices((list) => (s === ALL ? (list.includes(ALL) ? [] : [ALL]) : togglePkg(list.filter((x) => x !== ALL), s)))} />
                  {serviceText(s)}
                </label>
              ))}
            </div>
          </fieldset>
          {services.includes("Round Trip") && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase text-muted">Round Trip packages</span>
              <PackagePicker value={pickPkgs} onChange={setPickPkgs} />
              <span className="text-[12px] text-muted">{pickPkgs.length ? pickPkgs.map(pkgName).join(", ") : "Every package of the Round Trip."}</span>
            </div>
          )}
          <div className="mt-3"><Button icon="plus" onClick={addRow}>{toAdd.length > 1 ? `Add ${toAdd.length} price changes per service` : "Add price change"}</Button></div>
        </CardBody>
      )}

      {loadError ? <CardBody><p className="ds-error" role="alert">Saved rules could not be loaded: {loadError} {onRetry && <button type="button" className="fm-linkbtn" onClick={onRetry}>Retry</button>}</p></CardBody>
        : !loaded ? <CardBody><p className="fm-sub" role="status">Loading saved rules…</p></CardBody>
        : (
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] font-bold uppercase text-muted">
                    <th className="py-2 pr-3">Place</th><th className="pr-3">Service</th><th className="pr-3">Packages</th>
                    <th className="pr-3 text-right">Customer fare %</th><th className="pr-3 text-right">Partner pay %</th><th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const mine = own(r), gone = removed.has(r.id), e = edits[r.id] ?? {};
                    const service = r.fareService ?? ALL;
                    const pk = e.packages ?? r.packages ?? [];
                    return (
                      <tr key={r.id} className={`border-t border-line ${gone ? "opacity-40 line-through" : ""}`}>
                        <td className="py-2 pr-3 font-semibold">{where(place(r))}{!mine && <span className="ml-2 rounded-full border border-line px-1.5 text-[10px] font-bold text-muted">shared</span>}</td>
                        <td className="pr-3">{serviceText(service)}</td>
                        <td className="pr-3">
                          {service === "Round Trip" ? (mine && canEdit ? <PackagePicker value={pk} onChange={(v) => setEdit(r.id, { packages: v })} disabled={gone} /> : <span className="text-[12px]">{pk.length ? pk.map(pkgName).join(", ") : "All packages"}</span>) : <span className="text-muted">—</span>}
                        </td>
                        {(["cust", "part"] as const).map((f) => {
                          const v = e[f] ?? signed(f === "cust" ? r.customer : r.partner);
                          return (
                            <td key={f} className="pr-3 text-right">
                              {mine && canEdit
                                ? <input className={`ds-input w-20 text-right ${badPct(v) ? "ds-input--bad" : ""}`} inputMode="decimal" value={v} disabled={gone} onChange={(ev) => setEdit(r.id, { [f]: ev.target.value })} aria-label={f === "cust" ? "Customer fare change" : "Partner pay change"} />
                                : <span>{shown(f === "cust" ? r.customer : r.partner)}</span>}
                            </td>
                          );
                        })}
                        <td className="text-right">
                          {mine && canEdit ? <button type="button" className="fm-linkbtn" onClick={() => setRemoved((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}>{gone ? "Undo" : "Remove"}</button> : null}
                        </td>
                      </tr>
                    );
                  })}
                  {added.map((n) => (
                    <tr key={n.key} className="border-t border-line bg-amber-50/50">
                      <td className="py-2 pr-3 font-semibold">{where(n.place)} <span className="ml-1 rounded-full border border-amber-300 px-1.5 text-[10px] font-bold text-amber-800">new</span></td>
                      <td className="pr-3">{serviceText(n.service)}</td>
                      <td className="pr-3 text-[12px]">{n.service === "Round Trip" ? (n.packages.length ? n.packages.map(pkgName).join(", ") : "All packages") : <span className="text-muted">—</span>}</td>
                      <td className="pr-3 text-right">{shown(adjOf(n.cust))}</td>
                      <td className="pr-3 text-right">{shown(adjOf(n.part))}</td>
                      <td className="text-right"><button type="button" className="fm-linkbtn" onClick={() => setAdded((l) => l.filter((x) => x.key !== n.key))}>Remove</button></td>
                    </tr>
                  ))}
                  {!total && !added.length ? <tr><td colSpan={6} className="py-4 text-center text-muted">No price changes yet. Add one above.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </CardBody>
        )}
      <Problems items={problems} />
    </SettingCard>
  );
}

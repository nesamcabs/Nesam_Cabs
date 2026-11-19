import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import DateTime12Input from "./DateTime12Input";
import { refDateTime } from "../domain/officeStage";
import { Button, Icon } from "./ui";
import { BRAND_LABELS, serviceLabel, type FareWorkspaceScope } from "../services/tariffService";
import {
  adjText, isoToIstInput, istInputToIso, phaseOf, saveRule, setRuleStatus,
  type Adjustment, type RuleKind, type ServiceRule, type Side,
} from "../services/serviceRulesService";
import { CardBody, SettingCard, type VehicleCol } from "./RateTable";

// Date-based, special and inherited rules, all inside the page (no side drawer): a filterable list, and the add / edit / switch on-off /
// remove / details panels open right under the row they belong to. Every rule is an ordinary service_rules document that the booking
// server applies (functions/src/serviceRules.ts): this brand's own rule first, then the most specific place, then the service, the
// packages and the higher priority. A rule with dates only runs while its dates are on.

type Mode = "edit" | "details" | "on" | "off" | "remove";
type Phase = ReturnType<typeof phaseOf>;
type Filter = "All" | "Active" | "Scheduled" | "Ended" | "Off";
type Place = { state: string; city: string; area: string };

const KIND_LABEL: Record<RuleKind, string> = { availability: "Booking", categories: "Cabs shown", pricing: "Price change", limit: "Limit" };
const KIND_ICON = { availability: "toggle-right", categories: "car-front", pricing: "indian-rupee", limit: "badge-indian-rupee" } as const;
const SIDES: Side[] = ["Pickup or drop", "Pickup only", "Drop only"];
const norm = (s?: string) => (s ?? "").trim().toLowerCase();
const signed = (a?: Adjustment) => (!a || a.mode === "Normal" ? "" : `${a.mode === "Decrease" ? "-" : ""}${a.percent}`);
const adjOf = (v: string): Adjustment => {
  const n = Number(v.trim() === "" ? 0 : v);
  return n === 0 ? { mode: "Normal", percent: 0 } : { mode: n > 0 ? "Increase" : "Decrease", percent: Math.abs(n) };
};
const badPct = (v: string) => v.trim() !== "" && !(Number.isFinite(Number(v)) && Math.abs(Number(v)) < 100);
const dateText = (iso?: string) => (iso ? refDateTime(new Date(iso)) : "");

export default function DateRules({ rules, allRules, isOwn, fareScope, vehicles, canEdit, loaded, loadError, stateName, stateOptions, citiesOf, areasOf, onToast }: {
  /** The rules to list: with dates, pickup-only / drop-only, switched off, a second rule for a place, or inherited. */
  rules: ServiceRule[];
  /** Every rule in scope, used to spot two rules that would clash. */
  allRules: ServiceRule[];
  isOwn: (r: ServiceRule) => boolean;
  fareScope: FareWorkspaceScope;
  vehicles: VehicleCol[];
  canEdit: boolean;
  loaded: boolean;
  loadError: string | null;
  stateName: (code: string) => string;
  stateOptions: { value: string; label: string }[];
  citiesOf: (state: string) => string[];
  areasOf: (state: string, city: string) => string[];
  onToast: (text: string) => void;
}) {
  const [now, setNow] = useState(Date.now);
  const [filter, setFilter] = useState<Filter>("All");
  const [open, setOpen] = useState<{ id: string; mode: Mode } | null>(null);
  const [adding, setAdding] = useState<RuleKind | null>(null);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  // A different brand or service is a different list.
  useEffect(() => { setOpen(null); setAdding(null); }, [fareScope.brand, fareScope.service]);

  const brandName = fareScope.brand === "common" ? "All brands (shared)" : BRAND_LABELS[fareScope.brand];
  const where = `${brandName} → ${serviceLabel(fareScope.service)}`;
  const placeText = (p: Place) => (p.area ? `${p.area}, ${p.city}` : p.city ? p.city : p.state ? stateName(p.state) : "All locations");
  const phase = (r: ServiceRule): Phase => phaseOf(r, now);
  const inFilter = (r: ServiceRule) => {
    const p = phase(r);
    return filter === "All" || (filter === "Off" ? p === "Disabled" : p === filter);
  };
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { All: rules.length, Active: 0, Scheduled: 0, Ended: 0, Off: 0 };
    for (const r of rules) {
      const p = phaseOf(r, now);
      if (p === "Active") c.Active++; else if (p === "Scheduled") c.Scheduled++; else if (p === "Ended") c.Ended++; else if (p === "Disabled") c.Off++;
    }
    return c;
  }, [rules, now]);
  const sorted = useMemo(() => {
    const order: Record<string, number> = { Active: 0, Scheduled: 1, Disabled: 2, Ended: 3, Removed: 4 };
    return [...rules].sort((a, b) => (order[phaseOf(a, now)] ?? 9) - (order[phaseOf(b, now)] ?? 9) || Date.parse(a.schedule.from ?? "") - Date.parse(b.schedule.from ?? "") || a.name.localeCompare(b.name));
  }, [rules, now]);
  const shown = sorted.filter(inFilter);

  const done = (text: string) => { setOpen(null); setAdding(null); onToast(text); };
  const toggleOpen = (id: string, mode: Mode) => { setAdding(null); setOpen((o) => (o?.id === id && o.mode === mode ? null : { id, mode })); };

  const valueCell = (r: ServiceRule) => {
    if (r.kind === "availability") return <span className={`fm-chip fm-chip--${r.availability === "Paused" ? "warn" : r.availability === "Limited" ? "blue" : "ok"}`}>{r.availability ?? "Available"}</span>;
    if (r.kind === "categories") return <span className="fm-rules__cabs">{(r.categories ?? []).join(" · ") || "All cabs"}</span>;
    if (r.kind === "pricing") return <span>Customer <b>{adjText(r.customer)}</b><br />Partner <b>{adjText(r.partner)}</b>{r.packages?.length ? <><br /><small>{r.packages.length} package{r.packages.length === 1 ? "" : "s"}</small></> : null}</span>;
    return <span>{r.limit ? `₹${r.limit.min}–₹${r.limit.max}` : ""}</span>;
  };
  const whenCell = (r: ServiceRule) => r.schedule.mode === "Always"
    ? <span>Always</span>
    : <span>{r.schedule.from ? dateText(r.schedule.from) : "Now"}<br /><small>to {r.schedule.to ? dateText(r.schedule.to) : "open end"}</small></span>;
  const phaseChip = (r: ServiceRule) => {
    const p = phase(r);
    const tone = p === "Active" ? "ok" : p === "Scheduled" ? "blue" : "off";
    return <span className={`fm-chip fm-chip--${tone}`}>{p === "Active" ? "Active now" : p === "Disabled" ? "Switched off" : p}</span>;
  };
  const sourceTag = (r: ServiceRule) => isOwn(r) ? null : <span className="fm-tag" title={r.brand ? "An older rule saved for every service of this brand. Change it by editing the rule in the old list or removing it." : "Shared by every brand. Change it under Brand → All brands (shared)."}>{r.brand ? "Older rule" : "Shared"}</span>;

  return (
    <SettingCard id="rules-dates" label="Date-based and special rules" title="Date-based, special and inherited rules"
      description="Rules that run on pickup dates (festivals, strikes, peak days), pickup-only or drop-only rules, switched-off rules, and rules inherited from All brands. While a date rule is on, it overrides the table for its place when its priority is higher."
      aside={canEdit && loaded && !loadError ? (
        <div className="fm-seg" role="group" aria-label="Add a rule">
          {(["availability", "categories", "pricing"] as RuleKind[]).map((k) => (
            <button key={k} type="button" className={adding === k ? "is-on" : ""} onClick={() => { setOpen(null); setAdding(adding === k ? null : k); }}>
              <Icon name={KIND_ICON[k]} size={13} /> {k === "availability" ? "Open / pause" : k === "categories" ? "Cabs shown" : "Price change"}
            </button>
          ))}
        </div>
      ) : null}>
      {adding && (
        <CardBody>
          <RuleForm key={`new-${adding}`} kind={adding} fareScope={fareScope} vehicles={vehicles} allRules={allRules} placeText={placeText}
            stateOptions={stateOptions} citiesOf={citiesOf} areasOf={areasOf} onCancel={() => setAdding(null)} onDone={done} />
        </CardBody>
      )}

      {loadError ? <CardBody><p className="ds-error" role="alert">Saved rules could not be loaded: {loadError}. Reload to try again.</p></CardBody>
        : !loaded ? <CardBody><p className="fm-sub" role="status">Loading saved rules…</p></CardBody>
        : (
          <>
            <CardBody className="fm-body--inline">
              <div className="fm-seg" role="tablist" aria-label="Show rules">
                {(["All", "Active", "Scheduled", "Ended", "Off"] as Filter[]).map((f) => (
                  <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? "is-on" : ""} onClick={() => setFilter(f)}>
                    {f === "Off" ? "Switched off" : f === "Active" ? "Active now" : f} <span className="fm-count">{counts[f]}</span>
                  </button>
                ))}
              </div>
            </CardBody>
            {shown.length === 0 ? (
              <CardBody>
                <div className="fm-empty">
                  <Icon name="calendar-clock" size={22} />
                  <strong>{rules.length ? "No rules in this view" : `No date-based or special rules for ${where}`}</strong>
                  <p>{rules.length ? "Choose another filter above." : canEdit ? "Use the buttons at the top right to add one, for example a festival price change or a day when bookings are paused." : "Nothing is set."}</p>
                </div>
              </CardBody>
            ) : (
              <div className="fm-scroll">
                <table className="fm-table fm-rules" aria-label="Date-based and special rules">
                  <thead>
                    <tr><th>Rule</th><th>Where</th><th>What</th><th>When (India time)</th><th className="fm-num">Priority</th><th>Status</th><th aria-label="Actions" /></tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => {
                      const mine = isOwn(r) && canEdit;
                      const isOpen = open?.id === r.id ? open.mode : null;
                      const on = r.status === "Enabled";
                      return (
                        <Fragment key={r.id}>
                          <tr className={isOpen ? "is-open" : ""}>
                            <td data-label="Rule">
                              <span className="fm-rules__name"><Icon name={KIND_ICON[r.kind]} size={14} /><strong>{r.name}</strong></span>
                              <small>{KIND_LABEL[r.kind]} {sourceTag(r)}</small>
                            </td>
                            <td data-label="Where"><strong>{placeText(r.scope)}</strong><small>{(r.scope.side ?? "Pickup or drop")}{!isOwn(r) && r.fareService ? ` · ${serviceLabel(r.fareService)}` : ""}</small></td>
                            <td data-label="What">{valueCell(r)}</td>
                            <td data-label="When">{whenCell(r)}</td>
                            <td data-label="Priority" className="fm-num">{r.priority}</td>
                            <td data-label="Status">
                              <div className="fm-rules__status">
                                {mine ? (
                                  <label className="fm-switch" title={on ? "Switch this rule off" : "Switch this rule on"}>
                                    <input type="checkbox" checked={on} onChange={() => toggleOpen(r.id, on ? "off" : "on")} aria-label={`${on ? "Switch off" : "Switch on"} ${r.name}`} />
                                    <span aria-hidden="true" />
                                  </label>
                                ) : null}
                                {phaseChip(r)}
                              </div>
                            </td>
                            <td className="fm-rules__actions">
                              {mine && <button type="button" className="fm-linkbtn" onClick={() => toggleOpen(r.id, "edit")}>Edit</button>}
                              <button type="button" className="fm-linkbtn" onClick={() => toggleOpen(r.id, "details")}>Details</button>
                              {mine && <button type="button" className="fm-linkbtn fm-linkbtn--danger" onClick={() => toggleOpen(r.id, "remove")}>Remove</button>}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="fm-expand">
                              <td colSpan={7}>
                                {isOpen === "edit" ? <RuleForm kind={r.kind} rule={r} fareScope={fareScope} vehicles={vehicles} allRules={allRules} placeText={placeText}
                                  stateOptions={stateOptions} citiesOf={citiesOf} areasOf={areasOf} onCancel={() => setOpen(null)} onDone={done} />
                                  : isOpen === "details" ? <Details rule={r} own={isOwn(r)} placeText={placeText} phase={phase(r)} onClose={() => setOpen(null)} />
                                  : <StatusPanel rule={r} to={isOpen === "remove" ? "Removed" : isOpen === "on" ? "Enabled" : "Disabled"} onCancel={() => setOpen(null)} onDone={done} />}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
    </SettingCard>
  );
}

// ── Read-only details of one rule ─────────────────────────────────────────────────────────────────────────────────
function Details({ rule, own, placeText, phase, onClose }: { rule: ServiceRule; own: boolean; placeText: (p: Place) => string; phase: Phase; onClose: () => void }) {
  const last = rule.history?.length ? rule.history[rule.history.length - 1] : undefined;
  const facts: [string, string][] = [
    ["Rule", rule.name],
    ["Type", KIND_LABEL[rule.kind]],
    ["Place", `${placeText(rule.scope)} · ${rule.scope.side ?? "Pickup or drop"}`],
    ["Service", rule.fareService ? serviceLabel(rule.fareService) : rule.service || "All services"],
    ["Brand", rule.brand ? BRAND_LABELS[rule.brand as keyof typeof BRAND_LABELS] ?? rule.brand : "All brands (shared)"],
    ["Value", rule.kind === "availability" ? rule.availability ?? "Available" : rule.kind === "categories" ? (rule.categories ?? []).join(" · ") : `Customer ${adjText(rule.customer)} · Partner ${adjText(rule.partner)}`],
    ["When", rule.schedule.mode === "Always" ? "Always" : `${dateText(rule.schedule.from) || "Now"} → ${dateText(rule.schedule.to) || "open end"}`],
    ["State", phase === "Active" ? "Active now" : phase === "Disabled" ? "Switched off" : phase],
    ["Priority", String(rule.priority)],
    ["Reason", rule.reason || "—"],
    ...(last ? [["Last change", `${last.action} by ${last.byName}${last.at?.toDate ? ` · ${refDateTime(last.at.toDate())}` : ""}`] as [string, string]] : []),
  ];
  return (
    <div className="fm-form">
      <dl className="fm-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {!own && <p className="fm-form__note"><Icon name="info" size={13} /> This rule is {rule.brand ? "an older one saved for every service of this brand" : "shared by every brand"}, so it can only be changed {rule.brand ? "by removing it from the booking settings list" : "under Brand → All brands (shared)"}.</p>}
      <div className="fm-form__actions"><Button onClick={onClose}>Close</Button></div>
    </div>
  );
}

// ── Switch on / off / remove, with a reason ───────────────────────────────────────────────────────────────────────
function StatusPanel({ rule, to, onCancel, onDone }: { rule: ServiceRule; to: "Enabled" | "Disabled" | "Removed"; onCancel: () => void; onDone: (text: string) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const verb = to === "Enabled" ? "Switch on" : to === "Disabled" ? "Switch off" : "Remove";
  const go = async () => {
    if (busy) return;
    if (reason.trim().length < 5) return setError("Add a short reason (at least 5 characters).");
    setBusy(true);
    setError(null);
    try { await setRuleStatus(rule, to, reason.trim()); onDone(`${rule.name} ${to === "Enabled" ? "switched on" : to === "Disabled" ? "switched off" : "removed"}.`); }
    catch (err) { setError(err instanceof Error ? err.message : "The change was not saved."); setBusy(false); }
  };
  return (
    <div className={`fm-form fm-form--status ${to === "Removed" ? "is-danger" : ""}`} onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <p className="fm-form__lead">{verb} <strong>{rule.name}</strong>? {to === "Removed" ? "Removed rules disappear from this list and stop applying. This cannot be undone." : to === "Disabled" ? "It stops applying until you switch it on again." : "It applies again right away."}</p>
      <div className="fm-form__row">
        <input ref={input} className="ds-input" placeholder="Reason for this change" aria-label="Reason" maxLength={300} value={reason} disabled={busy}
          onChange={(e) => { setReason(e.target.value); setError(null); }} onKeyDown={(e) => { if (e.key === "Enter") void go(); }} />
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant={to === "Enabled" ? "primary" : "danger"} loading={busy} onClick={() => void go()}>{verb}</Button>
      </div>
      {error && <p className="fm-msg fm-msg--bad"><Icon name="circle-alert" size={13} /> {error}</p>}
    </div>
  );
}

// ── Add or edit one rule ──────────────────────────────────────────────────────────────────────────────────────────
function RuleForm({ kind, rule, fareScope, vehicles, allRules, placeText, stateOptions, citiesOf, areasOf, onCancel, onDone }: {
  kind: RuleKind; rule?: ServiceRule; fareScope: FareWorkspaceScope; vehicles: VehicleCol[]; allRules: ServiceRule[]; placeText: (p: Place) => string;
  stateOptions: { value: string; label: string }[]; citiesOf: (state: string) => string[]; areasOf: (state: string, city: string) => string[];
  onCancel: () => void; onDone: (text: string) => void;
}) {
  const [scope, setScope] = useState<ServiceRule["scope"]>(rule?.scope ?? { state: "", city: "", area: "", side: "Pickup or drop" });
  const [name, setName] = useState(rule?.name ?? "");
  const [priority, setPriority] = useState(String(rule?.priority ?? 10));
  const [mode, setMode] = useState<"Always" | "Range">(rule ? rule.schedule.mode : "Range");
  const [from, setFrom] = useState(isoToIstInput(rule?.schedule.from));
  const [to, setTo] = useState(isoToIstInput(rule?.schedule.to));
  const [availability, setAvailability] = useState<"Available" | "Limited" | "Paused">(rule?.availability ?? "Paused");
  const [cats, setCats] = useState<string[]>(rule?.categories ?? vehicles.map((v) => v.name));
  const [cust, setCust] = useState(signed(rule?.customer));
  const [part, setPart] = useState(signed(rule?.partner));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const submitting = useRef(false);

  const priorityN = Number(priority);
  const cities = scope.state ? citiesOf(scope.state) : [];
  const areas = scope.city ? areasOf(scope.state, scope.city) : [];
  const autoName = `${scope.area || scope.city || (scope.state ? "State" : "All locations")} ${kind === "categories" ? "cabs shown" : kind === "availability" ? "booking" : "price change"}`;
  const service = rule ? rule.service : fareScope.service;
  const draft: Omit<ServiceRule, "id"> = {
    brand: rule?.brand ?? (fareScope.brand === "common" ? "" : fareScope.brand), fareService: rule ? rule.fareService ?? "" : fareScope.service,
    kind, name: name.trim() || autoName, status: rule?.status === "Disabled" ? "Disabled" : "Enabled", priority: priorityN, scope, service,
    schedule: mode === "Always" ? { mode } : { mode, ...(from ? { from: istInputToIso(from) } : {}), ...(to ? { to: istInputToIso(to) } : {}) },
    ...(kind === "availability" ? { availability } : {}), ...(kind === "categories" ? { categories: cats } : {}),
    ...(kind === "pricing" ? { customer: adjOf(cust), partner: adjOf(part), ...(rule?.packages?.length ? { packages: rule.packages } : {}) } : {}), reason: reason.trim(),
  };

  // Same type, place, service and priority with overlapping dates would be ambiguous: the server refuses it, so say so here first.
  const conflict = allRules.find((r) => r.id !== rule?.id && r.kind === kind && r.status === "Enabled" && r.priority === priorityN
    && (r.brand ?? "") === (draft.brand ?? "") && (r.fareService ?? "") === (draft.fareService ?? "")
    && norm(r.scope.state) === norm(scope.state) && norm(r.scope.city) === norm(scope.city) && norm(r.scope.area) === norm(scope.area) && norm(r.service) === norm(service)
    && (r.schedule.mode === "Always" || mode === "Always" || !((r.schedule.to ? Date.parse(r.schedule.to) : Infinity) <= (from ? Date.parse(istInputToIso(from)) : -Infinity) || (to ? Date.parse(istInputToIso(to)) : Infinity) <= (r.schedule.from ? Date.parse(r.schedule.from) : -Infinity))));

  const problem = (() => {
    if (!Number.isInteger(priorityN) || priorityN < 1 || priorityN > 100) return "Priority must be a whole number from 1 to 100.";
    if (kind === "categories" && !cats.length) return "Keep at least one cab on. To stop bookings, use Open / pause → Paused.";
    if (kind === "pricing" && (badPct(cust) || badPct(part))) return "A price change must be between −99% and +99%.";
    if (kind === "pricing" && adjOf(cust).mode === "Normal" && adjOf(part).mode === "Normal") return "Enter a change for the customer fare or the partner pay.";
    if (mode === "Range" && !from && !to) return "Set the pickup dates, or choose Always.";
    if (mode === "Range" && from && to && to <= from) return "The end must be after the start.";
    if (conflict) return `This overlaps "${conflict.name}", which has the same place, service and priority. Change the place, dates or priority.`;
    if (reason.trim().length < 5) return "Add a short reason (at least 5 characters).";
    return "";
  })();

  const save = async () => {
    if (submitting.current) return;
    setTried(true);
    if (problem) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try { await saveRule(draft, rule?.id, rule); onDone(`${draft.name} saved.`); }
    catch (err) { setError(err instanceof Error ? err.message : "The rule was not saved. Check your permissions and try again."); setBusy(false); submitting.current = false; }
  };

  // What the rule will do, in one sentence.
  const valueText = kind === "availability" ? (availability === "Paused" ? "New bookings are paused" : availability === "Limited" ? "Bookings are limited: the office confirms each one" : "Bookings are open")
    : kind === "categories" ? `Customers see only ${cats.length ? cats.join(", ") : "no cabs"}`
    : `Customer fare ${adjText(adjOf(cust))}, partner pay ${adjText(adjOf(part))}`;
  const whenText = mode === "Always" ? "at all times" : `for pickups ${from ? `from ${dateText(istInputToIso(from))}` : "from now"}${to ? ` until ${dateText(istInputToIso(to))}` : " with no end date"} (India time)`;
  const sideText = scope.side === "Pickup only" ? "starting in" : scope.side === "Drop only" ? "ending in" : "starting or ending in";
  // Unsaved changes: anything different from how the form opened. Leaving the browser tab with unsaved changes asks first.
  const snapshot = JSON.stringify({ scope, name, priority, mode, from, to, availability, cats, cust, part, reason });
  const opened = useRef(snapshot);
  const dirty = snapshot !== opened.current;
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);

  return (
    <div className="fm-form" onKeyDown={(e) => { if (e.key === "Escape" && !busy && (!dirty || window.confirm("Discard your unsaved changes?"))) onCancel(); }}>
      <div className="fm-form__head">
        <strong>{rule ? `Edit ${rule.name}` : kind === "availability" ? "Open or pause bookings" : kind === "categories" ? "Choose the cabs customers see" : "Change the price"}</strong>
        <span className="fm-hint">{fareScope.brand === "common" ? "All brands" : BRAND_LABELS[fareScope.brand]} → {serviceLabel(rule?.fareService || fareScope.service)}</span>
      </div>
      {rule && <p className="fm-form__note"><Icon name="info" size={13} /> Editing changes this rule everywhere it applies, not only for the place you were looking at.</p>}

      <div className="fm-form__grid">
        <section className="fm-form__block">
          <h4>1 · What</h4>
          {kind === "availability" && (
            <div className="fm-choices">
              {([["Available", "Customers can request bookings."], ["Limited", "The office confirms each booking."], ["Paused", "Stop new booking requests."]] as const).map(([v, d]) => (
                <label key={v} className={availability === v ? "is-on" : ""}><input type="radio" name="avail" checked={availability === v} onChange={() => setAvailability(v)} /><span><strong>{v}</strong><small>{d}</small></span></label>
              ))}
            </div>
          )}
          {kind === "categories" && (
            <div className="fm-cabs">
              {vehicles.map((v) => {
                const on = cats.some((c) => norm(c) === norm(v.name));
                return <label key={v.id} className={on ? "is-on" : ""}><input type="checkbox" checked={on} onChange={() => setCats(on ? cats.filter((c) => norm(c) !== norm(v.name)) : [...cats, v.name])} /><Icon name="car-front" size={14} />{v.name}</label>;
              })}
            </div>
          )}
          {kind === "pricing" && (
            <div className="fm-form__two">
              <label className="fm-mini"><span>Customer fare %</span><input className={`ds-input text-right ${badPct(cust) ? "ds-input--bad" : ""}`} inputMode="decimal" placeholder="0" value={cust} onChange={(e) => setCust(e.target.value)} /></label>
              <label className="fm-mini"><span>Partner pay %</span><input className={`ds-input text-right ${badPct(part) ? "ds-input--bad" : ""}`} inputMode="decimal" placeholder="0" value={part} onChange={(e) => setPart(e.target.value)} /></label>
              <p className="fm-hint fm-form__span">Type 10 for +10%, -5 for −5%. Leave 0 for no change.</p>
            </div>
          )}
        </section>

        <section className="fm-form__block">
          <h4>2 · Where</h4>
          <div className="fm-form__two">
            <label className="fm-mini"><span>State</span>
              <select className="ds-select" value={scope.state} onChange={(e) => setScope({ ...scope, state: e.target.value, city: "", area: "" })}>
                <option value="">All locations</option>
                {stateOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="fm-mini"><span>City</span>
              <select className="ds-select" value={scope.city} disabled={!scope.state} onChange={(e) => setScope({ ...scope, city: e.target.value, area: "" })}>
                <option value="">Whole state</option>
                {scope.city && !cities.includes(scope.city) ? <option value={scope.city}>{scope.city}</option> : null}
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="fm-mini"><span>Area / zone</span>
              <select className="ds-select" value={scope.area} disabled={!scope.city} onChange={(e) => setScope({ ...scope, area: e.target.value })}>
                <option value="">Whole city</option>
                {scope.area && !areas.includes(scope.area) ? <option value={scope.area}>{scope.area}</option> : null}
                {areas.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className="fm-mini"><span>Applies to trips</span>
              <select className="ds-select" value={scope.side ?? "Pickup or drop"} onChange={(e) => setScope({ ...scope, side: e.target.value as Side })}>
                {SIDES.map((s) => <option key={s} value={s}>{s === "Pickup or drop" ? "Start or end here" : s === "Pickup only" ? "Start here only" : "End here only"}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="fm-form__block">
          <h4>3 · When</h4>
          <div className="fm-seg" role="tablist" aria-label="When the rule runs">
            {(["Range", "Always"] as const).map((m) => <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? "is-on" : ""} onClick={() => setMode(m)}>{m === "Always" ? "Always" : "On pickup dates"}</button>)}
          </div>
          {mode === "Range" ? (
            <div className="fm-form__two mt-2">
              <label className="fm-mini"><span>From · India time</span><DateTime12Input value={from} onChange={setFrom} label="Pickup from" /></label>
              <label className="fm-mini"><span>Until · India time</span><DateTime12Input value={to} onChange={setTo} label="Pickup until" min={from ? from.slice(0, 10) : undefined} /></label>
              <p className="fm-hint fm-form__span">Matched on the pickup time. The start time is included, the end time is not.</p>
            </div>
          ) : <p className="fm-hint mt-2">The rule applies until you switch it off.</p>}
        </section>

        <section className="fm-form__block">
          <h4>4 · Details</h4>
          <div className="fm-form__two">
            <label className="fm-mini"><span>Name (optional)</span><input className="ds-input" value={name} maxLength={120} placeholder={autoName} onChange={(e) => setName(e.target.value)} /></label>
            <label className="fm-mini"><span>Priority (1–100)</span><input className="ds-input text-right" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} /></label>
            <p className="fm-hint fm-form__span">When two rules cover the same trip, the more specific place wins, then the higher priority. Date rules usually need a priority above the table rules (which use 1).</p>
          </div>
        </section>
      </div>

      <div className="fm-result" role="status">
        <Icon name="eye" size={15} />
        <span><strong>What will happen:</strong> {valueText} for trips {sideText} {placeText(scope)}, {whenText}.</span>
      </div>

      <div className="fm-form__row">
        <input className="ds-input" placeholder="Reason for this change" aria-label="Reason for this change" maxLength={300} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
        <Button onClick={() => { if (!busy && (!dirty || window.confirm("Discard your unsaved changes?"))) onCancel(); }} disabled={busy}>Cancel</Button>
        <Button variant="primary" icon="check" loading={busy} onClick={() => void save()}>{rule ? "Save changes" : "Save rule"}</Button>
      </div>
      {conflict && !tried && <p className="fm-msg fm-msg--bad"><Icon name="circle-alert" size={13} /> This overlaps "{conflict.name}" (same place, service and priority). Change the place, dates or priority.</p>}
      {(tried && problem) || error ? <p className="fm-msg fm-msg--bad" role="alert"><Icon name="circle-alert" size={13} /> {error || problem}</p> : null}
    </div>
  );
}

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { categoryTitle } from "../domain/categoryLabel";
import type { FareRule, MasterLocation, TravelService, VehicleCategory } from "../types";
import { subscribeFareRules, subscribeLocations, subscribeServices, subscribeVehicleCategories } from "../services/adminFirestoreService";
import { saveFixedRouteFare } from "../services/bookingOpsService";
import { saveLocation, deriveLocationCode, type LocationForm } from "../services/locationService";
import { auth } from "../services/firebase";
import { CITIES_BY_STATE } from "../domain/placeDirectory";
import { GST_STATES } from "../domain/gstStates";
import { ActionError } from "../services/callables";
import { BRAND_LABELS, type FareWorkspaceScope } from "../services/tariffService";
import { inr } from "../services/tariffService";
import { useCan, useCanDo } from "./AccessContext";
import { ErrorBanner, Modal } from "./Feedback";
import { Badge, Button, DataTable, EmptyState, Icon, toneForStatus } from "./ui";

const STATUS_FILTERS = ["All", "Active", "Inactive"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
const text = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? String(n) : "");

/** A route fare the booking server may price with: saved by this tool, so it carries the partner payout, GST and peak choices. */
const complete = (r: FareRule) => r.managed === true && (r.partnerPayout ?? 0) > 0 && !!r.gstMode && !!r.peakAdjustment && typeof r.reverseDirection === "boolean";

/**
 * Fixed route fares: an agreed customer fare and partner payout for one route (and, when chosen, its reverse).
 * Records are the saved FIXED_ROUTE fare rules; every change goes through the audited, versioned server function.
 */
export default function FixedRouteFares({ onClose, onToast, scope = { brand: "common", service: "One Way" } }: { onClose: () => void; onToast: (t: string) => void; scope?: FareWorkspaceScope }) {
  const pricingAccess = useCan("pricing");
  const settingsEdit = useCanDo("Settings", "edit");
  const canEdit = pricingAccess && settingsEdit;
  const brand = scope.brand === "common" ? "" : scope.brand;
  const scopeLabel = (scope.brand === "common" ? "Common — all brands" : BRAND_LABELS[scope.brand]) + " → " + scope.service;
  const owns = (r: FareRule) => (r.brand ?? "") === brand && (!r.fareService || r.fareService === scope.service);
  const [rules, setRules] = useState<FareRule[] | null>(null);
  const [locations, setLocations] = useState<MasterLocation[]>([]);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [services, setServices] = useState<TravelService[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("All");
  const [panel, setPanel] = useState<{ kind: "view" | "edit" | "status"; rule: FareRule } | { kind: "new" } | null>(null);

  useEffect(() => {
    setRules(null);
    setError(null);
    const fail = (m: string) => setError(m);
    const u = [subscribeFareRules((r) => { setRules(r); setError(null); }, fail), subscribeLocations(setLocations, fail), subscribeVehicleCategories(setCategories, fail), subscribeServices(setServices, fail)];
    return () => u.forEach((x) => x());
  }, [retry]);

  const routes = useMemo(() => (rules ?? []).filter((r) => r.pricingType === "FIXED_ROUTE" && (!r.brand || r.brand === brand) && (!r.fareService || r.fareService === scope.service)), [rules, brand, scope.service]);
  const place = (id?: string, saved?: string) => locations.find((l) => l.id === id)?.name || saved || "Unknown location";
  const category = (r: FareRule) => categories.find((c) => c.id === r.vehicleCategoryId)?.name || r.vehicleCategoryName || "Unknown category";
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return routes
      .filter((r) => status === "All" || r.status === status)
      .filter((r) => !t || [place(r.originLocationId, r.originLocationName), place(r.destinationLocationId, r.destinationLocationName), category(r), r.serviceName, r.name, r.code].some((v) => (v || "").toLowerCase().includes(t)))
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || (a.name || "").localeCompare(b.name || ""));
  }, [routes, q, status, locations, categories]); // eslint-disable-line react-hooks/exhaustive-deps

  // A dialog on top owns Escape / backdrop while it is open, so the drawer cannot close underneath unsaved edits.
  const loading = rules === null && !error;
  return (
    <Modal title="Fixed route fares" subtitle={scopeLabel} onClose={onClose} busy={panel !== null} wide>
      {error && <div className="mb-3"><ErrorBanner message={`Saved route fares could not be loaded: ${error}`} onRetry={() => setRetry((n) => n + 1)} /></div>}
      <div className="ds-filterbar" role="search">
        <div className="ds-search" style={{ flex: "1 1 280px" }}>
          <Icon name="search" />
          <input type="search" className="ds-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search route or car category" aria-label="Search route or car category" />
        </div>
        <label className="ds-field"><span className="sr-only">Status</span>
          <select className="ds-select" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Status">{STATUS_FILTERS.map((s) => <option key={s} value={s}>{s === "All" ? "All statuses" : s}</option>)}</select>
        </label>
        <Button variant="primary" icon="plus" disabledReason={canEdit ? undefined : "Changing fares needs pricing access."} onClick={() => setPanel({ kind: "new" })}>Add route fare</Button>
      </div>
      <p className="text-[12px] text-muted my-3" role="status">{loading ? "Loading saved route fares…" : `${shown.length} route fare${shown.length === 1 ? "" : "s"}${shown.length !== routes.length ? ` of ${routes.length}` : ""}`}</p>

      {!loading && !(error && rules === null) && (shown.length === 0 ? (
        <EmptyState title={routes.length ? "No route fares match" : "No fixed route fares saved yet"} hint={routes.length ? "Change the search or the status filter." : "Add an agreed fare for a specific route. Routes without one keep the normal pricing."} />
      ) : (
        <DataTable label="Fixed route fares" minWidth={1080} fixed hasActions>
          <thead><tr><th>ROUTE / DIRECTION</th><th>SERVICE / CAR</th><th>CUSTOMER FARE</th><th>PARTNER PAYOUT</th><th>GST / PEAK</th><th>STATUS</th><th className="ds-actions">ACTIONS</th></tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>{place(r.originLocationId, r.originLocationName)} → {place(r.destinationLocationId, r.destinationLocationName)}</strong>
                <small>{typeof r.reverseDirection === "boolean" ? (r.reverseDirection ? "Both directions" : "This direction only") : "Direction not set"} · Priority {r.priority ?? 1}</small>
              </td>
              <td><strong>{r.brand ? BRAND_LABELS[r.brand as keyof typeof BRAND_LABELS] : "Common — all brands"} · {r.fareService || r.serviceName || "All services"}</strong><small>{category(r)}</small></td>
              <td><strong>{inr(r.baseFare)}</strong></td>
              <td>{r.partnerPayout ? <strong>{inr(r.partnerPayout)}</strong> : <span className="text-muted">Not set</span>}</td>
              <td>
                {r.gstMode ? <strong>{r.gstMode === "included" ? "GST included" : "GST added"}</strong> : <span className="text-muted">GST not set</span>}
                <small>{r.peakAdjustment ? (r.peakAdjustment === "apply" ? "Peak adjustment applies" : "Excluded from peak adjustment") : "Peak not set"}</small>
              </td>
              <td>
                <Badge tone={toneForStatus(r.status)}>{r.status}</Badge>
                {r.status === "Active" && !complete(r) && <small>Not used for bookings until completed in Edit</small>}
              </td>
              <td className="ds-actions"><div>
                <Button size="sm" variant="ghost" onClick={() => setPanel({ kind: "view", rule: r })}>View</Button>
                {canEdit && owns(r) && <Button size="sm" onClick={() => setPanel({ kind: "edit", rule: r })}>Edit</Button>}
                {canEdit && owns(r) && <Button size="sm" variant="ghost" onClick={() => setPanel({ kind: "status", rule: r })}>{r.status === "Active" ? "Disable" : "Enable"}</Button>}
              </div></td>
            </tr>
          ))}</tbody>
        </DataTable>
      ))}

      {panel?.kind === "view" && <ViewDialog rule={panel.rule} route={`${place(panel.rule.originLocationId, panel.rule.originLocationName)} → ${place(panel.rule.destinationLocationId, panel.rule.destinationLocationName)}`} category={category(panel.rule)} onClose={() => setPanel(null)} />}
      {(panel?.kind === "new" || panel?.kind === "edit") && (
        <RouteEditor
          fareScope={scope} rule={panel.kind === "edit" ? panel.rule : undefined} locations={locations} categories={categories} services={services} canEdit={canEdit}
          onClose={() => setPanel(null)} onSaved={(t) => { setPanel(null); onToast(t); }}
        />
      )}
      {panel?.kind === "status" && <StatusDialog rule={panel.rule} onClose={() => setPanel(null)} onSaved={(t) => { setPanel(null); onToast(t); }} />}
    </Modal>
  );
}

function ViewDialog({ rule: r, route, category, onClose }: { rule: FareRule; route: string; category: string; onClose: () => void }) {
  const period = r.effectiveFrom || r.effectiveUntil ? `${r.effectiveFrom || "Any time"} to ${r.effectiveUntil || "no end"}` : "Always";
  const rows: [string, string][] = [
    ["Route", route],
    ["Direction", typeof r.reverseDirection === "boolean" ? (r.reverseDirection ? "Both directions: the same fare applies in reverse" : "This direction only") : "Not set"],
    ["Service", r.serviceName || "Any service"],
    ["Vehicle category", category],
    ["Customer fare", inr(r.baseFare)],
    ["Tax on the fare", r.gstMode ? (r.gstMode === "included" ? "GST included in the fare" : "GST added on top") : "Not set"],
    ["Partner payout", r.partnerPayout ? inr(r.partnerPayout) : "Not set"],
    ["Peak adjustments", r.peakAdjustment ? (r.peakAdjustment === "apply" ? "Apply to this fare" : "Do not apply to this fare") : "Not set"],
    ["Priority", String(r.priority ?? 1)],
    ["Valid", period],
    ["Status", r.status],
    ["Used for new bookings", r.status === "Active" && complete(r) ? "Yes, for office bookings with pickup and drop chosen from the location master" : r.status === "Active" ? "No: complete it in Edit first" : "No: disabled"],
    ["Last change reason", r.lastReason || "—"],
  ];
  return (
    <Modal title="Route fare" subtitle={r.name} onClose={onClose} size="lg" footer={<Button onClick={onClose}>Close</Button>}>
      <dl className="ds-facts" data-cols={2}>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </Modal>
  );
}

/** "You have unsaved changes." — Stay keeps the form, Discard closes it without saving. */
function LeaveDialog({ onStay, onDiscard }: { onStay: () => void; onDiscard: () => void }) {
  return (
    <Modal title="You have unsaved changes." centered onClose={onStay} footer={<><Button onClick={onStay}>Stay</Button><Button variant="danger" onClick={onDiscard}>Discard &amp; go back</Button></>}>
      <p className="text-[13px] text-body">The route fare has not been saved. Leaving now discards your entries.</p>
    </Modal>
  );
}

function RouteEditor({ rule, fareScope, locations, categories, services, canEdit, onClose, onSaved }: {
  rule?: FareRule; fareScope: FareWorkspaceScope; locations: MasterLocation[]; categories: VehicleCategory[]; services: TravelService[]; canEdit: boolean; onClose: () => void; onSaved: (t: string) => void;
}) {
  // The values and version the editor opened with: a save is made against exactly this version.
  const [opened] = useState(() => ({ version: rule?.version ?? 0 }));
  const initial = useMemo(() => ({
    origin: rule?.originLocationId ?? "", dest: rule?.destinationLocationId ?? "", category: rule?.vehicleCategoryId ?? "", service: rule?.serviceId ?? "",
    fare: text(rule?.baseFare), payout: text(rule?.partnerPayout), gst: rule?.gstMode ?? "", peak: rule?.peakAdjustment ?? "",
    direction: typeof rule?.reverseDirection === "boolean" ? (rule.reverseDirection ? "both" : "one") : rule ? "" : "one",
    enabled: rule ? rule.status === "Active" : false, priority: String(rule?.priority ?? 1), from: rule?.effectiveFrom ?? "", until: rule?.effectiveUntil ?? "", reason: "",
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const set = (p: Partial<typeof f>) => { setF((x) => ({ ...x, ...p })); setError(null); };
  const close = () => { if (busy) return; if (dirty) setLeaving(true); else onClose(); };

  // Active locations, categories and services are offered; one already saved on this fare stays selectable.
  const pickLocations = locations.filter((l) => l.status === "Active" || l.id === f.origin || l.id === f.dest);
  const pickCategories = categories.filter((c) => c.status === "Active" || c.id === f.category);
  // The services, named as customers know them. Each uses the saved service of that kind (from Services); one that has not
  // been set up there yet is shown but cannot be chosen, because a fare is stored against a real saved service.
  const activeServices = services.filter((s) => s.status === "Active" || s.id === f.service);
  const serviceChoices = [
    { label: "One Way", types: ["One Way Taxi", "Outstation Cab"], words: /one.?way/i },
    { label: "Round Trip", types: ["Outstation Cab"], words: /round.?trip/i },
    { label: "Multicity", types: ["Multicity"], words: /multi.?city/i },
    { label: "Local Rental", types: ["Local Rental"], words: /rental/i },
    { label: "Airport Taxi", types: ["Airport Taxi"], words: /airport/i },
  ].map((c) => {
    const found = c.types.map((t) => activeServices.find((s) => s.serviceType === t)).find(Boolean) ?? activeServices.find((s) => c.words.test(s.name));
    return { ...c, id: found?.id ?? "" };
  });
  // A fare already saved against some other saved service keeps showing it.
  const extraSaved = activeServices.filter((s) => s.id === f.service && !serviceChoices.some((c) => c.id === s.id));

  // Built-in cities that are not in the location master yet: choosing one adds it to Locations as an active City, then selects it.
  const builtIn = useMemo(() => {
    const have = new Set(locations.filter((l) => l.type === "City").map((l) => (l.name || l.city).trim().toLowerCase()));
    const out: { key: string; name: string; state: string }[] = [];
    for (const [code, names] of Object.entries(CITIES_BY_STATE)) {
      const state = GST_STATES.find(([c]) => c === code)?.[1] ?? code;
      for (const name of names) if (!have.has(name.toLowerCase())) out.push({ key: `new:${name}`, name, state });
    }
    return out;
  }, [locations]);
  const [adding, setAdding] = useState(false);
  const pickPlace = async (side: "origin" | "dest", value: string) => {
    if (!value.startsWith("new:")) return set({ [side]: value } as Partial<typeof f>);
    const entry = builtIn.find((b) => b.key === value);
    if (!entry || adding) return;
    setAdding(true);
    const form: LocationForm = {
      name: entry.name, code: deriveLocationCode(entry.name), type: "City", state: entry.state, district: "", city: entry.name, area: "", pincode: "", address: "",
      parentLocationId: "", lat: "", lng: "", placeId: "", pickupEnabled: true, dropEnabled: true, onlineBookingEnabled: true, adminBookingEnabled: true,
      serviceIds: [], status: "Active", displayOrder: locations.length + 1,
    };
    try {
      const saved = await saveLocation(form, null, locations, auth.currentUser?.uid || "");
      set({ [side]: saved.id } as Partial<typeof f>);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The city could not be added to Locations.");
    } finally {
      setAdding(false);
    }
  };
  const placeOptions = (
    <>
      {pickLocations.length > 0 && <optgroup label="In Locations">{pickLocations.map((l) => <option key={l.id} value={l.id}>{l.name}{l.city && l.city !== l.name ? ` (${l.city})` : ""}</option>)}</optgroup>}
      {canEdit && builtIn.length > 0 && <optgroup label="Add city from the built-in list">{builtIn.map((b) => <option key={b.key} value={b.key}>{b.name} · {b.state}</option>)}</optgroup>}
    </>
  );

  const problem = (() => {
    if (!f.origin || !f.dest) return "Choose both the pickup and the drop location.";
    if (f.origin === f.dest) return "Pickup and drop must be different locations.";
    if (!f.category) return "Choose a vehicle category.";
    if (!(num(f.fare) > 0)) return "Enter the customer fare (more than zero).";
    if (!(num(f.payout) > 0)) return "Enter the partner payout (more than zero).";
    if (f.gst !== "included" && f.gst !== "excluded") return "Choose whether the fare includes GST or GST is added on top.";
    if (f.direction !== "one" && f.direction !== "both") return "Choose whether the fare applies to this direction only or both directions.";
    if (f.peak !== "apply" && f.peak !== "exclude") return "Choose whether peak adjustments apply to this fare.";
    const p = num(f.priority);
    if (!Number.isInteger(p) || p < 1 || p > 99) return "Priority must be a whole number from 1 (highest) to 99.";
    if (f.from && f.until && f.until < f.from) return "The end date is before the start date.";
    if (f.reason.trim().length < 5) return "Record the reason for this change.";
    return null;
  })();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !canEdit) return;
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const r = await saveFixedRouteFare({
        ...(rule ? { ruleId: rule.id, expectedVersion: opened.version } : {}), reason: f.reason.trim(),
        data: {
          brand: fareScope.brand === "common" ? "" : fareScope.brand, fareService: fareScope.service, originLocationId: f.origin, destinationLocationId: f.dest, vehicleCategoryId: f.category, serviceId: f.service, customerFare: num(f.fare), partnerPayout: num(f.payout),
          gstMode: f.gst as "included" | "excluded", peakAdjustment: f.peak as "apply" | "exclude", reverseDirection: f.direction === "both",
          status: f.enabled ? "Active" : "Inactive", priority: num(f.priority), effectiveFrom: f.from, effectiveUntil: f.until,
        },
      });
      // Success is reported only once the server has confirmed the save.
      onSaved(`Route fare ${rule ? "updated" : "saved"} (version ${r.version}).`);
    } catch (err) {
      // The entries stay in the form; nothing is closed.
      setError(err instanceof ActionError ? err.message : "The route fare was not saved.");
      setBusy(false);
    }
  };

  return (
    <>
      <Modal title={rule ? "Edit route fare" : "Add route fare"} subtitle={(fareScope.brand === "common" ? "Common — all brands" : BRAND_LABELS[fareScope.brand]) + " → " + fareScope.service} onClose={close} busy={busy || leaving} size="lg"
        footNote="Used for office bookings whose pickup and drop are chosen from the location master. Other bookings keep normal pricing."
        footer={<><Button onClick={close} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" form="route-fare-form" loading={busy} disabledReason={canEdit ? undefined : "Changing fares needs pricing access."}>Save route fare</Button></>}>
        <form id="route-fare-form" className="grid gap-4" noValidate onSubmit={submit}>
          {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
          <div className="ds-form-grid">
            <label className="ds-field"><span>Pickup location</span>
              <select className="ds-select" value={f.origin} onChange={(e) => void pickPlace("origin", e.target.value)} disabled={busy || adding}>
                <option value="">{adding ? "Adding city…" : "Choose pickup"}</option>{placeOptions}
              </select>
            </label>
            <label className="ds-field"><span>Drop location</span>
              <select className="ds-select" value={f.dest} onChange={(e) => void pickPlace("dest", e.target.value)} disabled={busy || adding}>
                <option value="">{adding ? "Adding city…" : "Choose drop"}</option>{placeOptions}
              </select>
            </label>
            <label className="ds-field"><span>Service</span>
              <select className="ds-select" value={f.service} onChange={(e) => set({ service: e.target.value })} disabled={busy}>
                <option value="">Any service</option>{serviceChoices.map((c) => <option key={c.label} value={c.id} disabled={!c.id}>{c.label}{c.id ? "" : " (not set up in Services)"}</option>)}{extraSaved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="ds-field"><span>Vehicle category</span>
              <select className="ds-select" value={f.category} onChange={(e) => set({ category: e.target.value })} disabled={busy}>
                <option value="">Choose a category</option>{pickCategories.map((c) => <option key={c.id} value={c.id}>{categoryTitle(c)}</option>)}
              </select>
            </label>
            <label className="ds-field"><span>Customer fare · ₹</span><input className="ds-input" type="number" inputMode="decimal" min={0} step="0.01" value={f.fare} onChange={(e) => set({ fare: e.target.value })} disabled={busy} /></label>
            <label className="ds-field"><span>Partner payout · ₹</span><input className="ds-input" type="number" inputMode="decimal" min={0} step="0.01" value={f.payout} onChange={(e) => set({ payout: e.target.value })} disabled={busy} /></label>
          </div>

          <fieldset className="grid gap-2" disabled={busy}>
            <legend className="text-[12px] font-medium text-muted mb-1">Direction</legend>
            {([["one", "This direction only", "The fare applies from the pickup to the drop. The opposite direction is priced separately."], ["both", "Both directions", "The same fare also applies from the drop back to the pickup."]] as const).map(([v, label, hint]) => (
              <label key={v} className="ds-check ds-panel ds-panel-pad" style={{ alignItems: "center" }}><input type="radio" name="route-direction" checked={f.direction === v} onChange={() => set({ direction: v })} /><span><strong className="block text-[13px] text-ink">{label}</strong><small className="text-muted">{hint}</small></span></label>
            ))}
          </fieldset>
          <fieldset className="grid gap-2" disabled={busy}>
            <legend className="text-[12px] font-medium text-muted mb-1">Tax on the customer fare</legend>
            {([["included", "Fare includes GST", "The customer pays exactly this amount; GST is shown inside it."], ["excluded", "GST added on top", "GST is added to this amount at the tariff's GST rate."]] as const).map(([v, label, hint]) => (
              <label key={v} className="ds-check ds-panel ds-panel-pad" style={{ alignItems: "center" }}><input type="radio" name="route-gst" checked={f.gst === v} onChange={() => set({ gst: v })} /><span><strong className="block text-[13px] text-ink">{label}</strong><small className="text-muted">{hint}</small></span></label>
            ))}
          </fieldset>
          <fieldset className="grid gap-2" disabled={busy}>
            <legend className="text-[12px] font-medium text-muted mb-1">Peak adjustments</legend>
            {([["apply", "Apply peak adjustments", "The fare adjustment in force at pickup time is applied to this fare."], ["exclude", "Do not apply", "This fare stays as agreed whatever adjustment is active."]] as const).map(([v, label, hint]) => (
              <label key={v} className="ds-check ds-panel ds-panel-pad" style={{ alignItems: "center" }}><input type="radio" name="route-peak" checked={f.peak === v} onChange={() => set({ peak: v })} /><span><strong className="block text-[13px] text-ink">{label}</strong><small className="text-muted">{hint}</small></span></label>
            ))}
          </fieldset>

          <div className="ds-form-grid">
            <label className="ds-field"><span>Priority (1 = highest)</span><input className="ds-input" type="number" min={1} max={99} step={1} value={f.priority} onChange={(e) => set({ priority: e.target.value })} disabled={busy} /></label>
            <label className="ds-field"><span>Valid from</span><input className="ds-input" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} disabled={busy} /></label>
            <label className="ds-field"><span>Valid until</span><input className="ds-input" type="date" value={f.until} onChange={(e) => set({ until: e.target.value })} disabled={busy} /></label>
          </div>
          <label className="ds-check"><input type="checkbox" checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} disabled={busy} />Enabled for new quotes and bookings</label>
          <label className="ds-field"><span>Reason for this change</span><input className="ds-input" maxLength={300} value={f.reason} onChange={(e) => set({ reason: e.target.value })} disabled={busy} /></label>
        </form>
      </Modal>
      {leaving && <LeaveDialog onStay={() => setLeaving(false)} onDiscard={() => { setLeaving(false); onClose(); }} />}
    </>
  );
}

function StatusDialog({ rule, onClose, onSaved }: { rule: FareRule; onClose: () => void; onSaved: (t: string) => void }) {
  const [opened] = useState(() => rule.version ?? 0);
  const to = rule.status === "Active" ? "Inactive" : "Active";
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const close = () => { if (busy) return; if (reason.trim()) setLeaving(true); else onClose(); };
  const run = async () => {
    if (busy) return;
    if (reason.trim().length < 5) return setError("Record the reason for this change.");
    setBusy(true);
    setError(null);
    try {
      const r = await saveFixedRouteFare({ action: "status", ruleId: rule.id, expectedVersion: opened, status: to, reason: reason.trim() });
      onSaved(`Route fare ${to === "Active" ? "enabled" : "disabled"} (version ${r.version}).`);
    } catch (err) {
      setError(err instanceof ActionError ? err.message : "The status was not changed.");
      setBusy(false);
    }
  };
  return (
    <>
      <Modal title={`${to === "Active" ? "Enable" : "Disable"} route fare`} subtitle={rule.name} onClose={close} busy={busy || leaving} centered
        footer={<><Button onClick={close} disabled={busy}>Cancel</Button><Button variant={to === "Active" ? "primary" : "danger"} loading={busy} onClick={run}>{to === "Active" ? "Enable fare" : "Disable fare"}</Button></>}>
        {error && <div className="ds-error mb-3" role="alert"><Icon name="circle-alert" />{error}</div>}
        <p className="text-[13px] text-ink mb-3">{to === "Active" ? "New office quotes on this route will use this fare." : "New quotes on this route go back to normal pricing. Existing bookings keep their fare."}</p>
        <label className="ds-field"><span>Reason for this change</span><input className="ds-input" maxLength={300} value={reason} onChange={(e) => { setReason(e.target.value); setError(null); }} disabled={busy} /></label>
      </Modal>
      {leaving && <LeaveDialog onStay={() => setLeaving(false)} onDiscard={() => { setLeaving(false); onClose(); }} />}
    </>
  );
}

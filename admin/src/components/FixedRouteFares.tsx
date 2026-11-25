import { useEffect, useMemo, useState } from "react";
import type { FareRule, MasterLocation, VehicleCategory } from "../types";
import { subscribeFareRules, subscribeVehicleCategories } from "../services/adminFirestoreService";
import { useLocationsFeed } from "../hooks/useLocationsFeed";
import { saveFixedRouteFare } from "../services/bookingOpsService";
import { saveLocation, deriveLocationCode, type LocationForm } from "../services/locationService";
import { auth } from "../services/firebase";
import LocationScopeSelector from "./location/LocationScopeSelector";
import { EMPTY_SEL, indexLocations, selOfLocation, stateNameOf, type LocSel } from "../domain/locationHierarchy";
import { ActionError } from "../services/callables";
import { BRAND_LABELS, inr, type FareWorkspaceScope } from "../services/tariffService";
import { useCan, useCanDo } from "./AccessContext";
import { Button, Icon } from "./ui";
import { CardBody, OnSwitch, Problems, RateTable, SaveBar, SettingCard, type RateColumn, type RateGroup } from "./RateTable";

// Fixed route fares, on one page like Booking rules: add a route at the top (pick the two places, type the fare for each cab, Save),
// and the saved routes in a table underneath: switch a fare on or off, change it in the form, copy it as the start of a new one, or delete it —
// one at a time or many at once (tick the rows). Nothing opens a drawer.
// Records are the saved FIXED_ROUTE fare rules; every change goes through the audited, versioned server function.

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
const text = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? String(n) : "");

/** A route fare the booking server may price with: saved by this tool, so it carries the partner payout, GST and peak choices. */
const complete = (r: FareRule) => r.managed === true && (r.partnerPayout ?? 0) > 0 && !!r.gstMode && !!r.peakAdjustment && typeof r.reverseDirection === "boolean";

type Fares = Record<string, { fare: string; payout: string }>;
const blank = { origin: "", dest: "", direction: "one", gst: "included", peak: "exclude", enabled: true, priority: "1", from: "", until: "" };
type Form = typeof blank;

export default function FixedRouteFares({ onToast, scope = { brand: "common", service: "One Way" } }: { onToast: (t: string) => void; scope?: FareWorkspaceScope }) {
  const pricingAccess = useCan("pricing");
  const settingsEdit = useCanDo("Settings", "edit");
  const canEdit = pricingAccess && settingsEdit;
  const brand = scope.brand === "common" ? "" : scope.brand;
  const scopeLabel = (scope.brand === "common" ? "Common — all brands" : BRAND_LABELS[scope.brand]) + " → " + scope.service;
  const owns = (r: FareRule) => (r.brand ?? "") === brand && (!r.fareService || r.fareService === scope.service);

  const [rules, setRules] = useState<FareRule[] | null>(null);
  // Locations with their own load state (a failure is shown with Retry, never as "no places").
  const { locations, status: locationsStatus } = useLocationsFeed();
  const [attempt, setAttempt] = useState(0);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRules(null);
    setError(null);
    const fail = (m: string) => setError(m);
    const u = [subscribeFareRules((r) => { setRules(r); setError(null); }, fail), subscribeVehicleCategories(setCategories, fail)];
    return () => u.forEach((x) => x());
  }, [attempt]);

  const routes = useMemo(() => (rules ?? []).filter((r) => r.pricingType === "FIXED_ROUTE" && (!r.brand || r.brand === brand) && (!r.fareService || r.fareService === scope.service)), [rules, brand, scope.service]);
  const place = (id?: string, saved?: string) => locations.find((l) => l.id === id)?.name || saved || "Unknown location";
  const categoryName = (r: FareRule) => categories.find((c) => c.id === r.vehicleCategoryId)?.name || r.vehicleCategoryName || "Unknown cab";

  // ── The add / edit form ───────────────────────────────────────────────────────────────────────────────────────
  const [f, setF] = useState<Form>(blank);
  const [fares, setFares] = useState<Fares>({});
  const [editing, setEditing] = useState<FareRule | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (p: Partial<Form>) => { setMessage(null); setF((x) => ({ ...x, ...p })); };
  const setFare = (id: string, p: Partial<Fares[string]>) => { setMessage(null); setFares((all) => ({ ...all, [id]: { ...(all[id] ?? { fare: "", payout: "" }), ...p } })); };

  const columns: RateColumn[] = useMemo(() => categories
    .filter((c) => (editing ? c.id === editing.vehicleCategoryId : c.status === "Active"))
    .sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99))
    .map((c) => ({ key: c.id, name: c.name })), [categories, editing]);

  // Pickup and drop are chosen independently with the shared location selector. A route fare is matched on the exact Locations
  // record (as before): the endpoint is the chosen area / city / village, or a chosen service zone record. Broad scopes are not endpoints.
  const index = useMemo(() => indexLocations(locations), [locations]);
  const [sels, setSels] = useState<{ origin: LocSel; dest: LocSel }>({ origin: EMPTY_SEL, dest: EMPTY_SEL });
  const endpointOf = (x: LocSel) => x.locationId || x.zoneId;
  useEffect(() => {
    // An edit, copy, reverse or reset sets the ids: show them in the selectors (never the other way round).
    setSels((cur) => ({
      origin: endpointOf(cur.origin) === f.origin ? cur.origin : f.origin ? selOfLocation(f.origin, index) ?? EMPTY_SEL : EMPTY_SEL,
      dest: endpointOf(cur.dest) === f.dest ? cur.dest : f.dest ? selOfLocation(f.dest, index) ?? EMPTY_SEL : EMPTY_SEL,
    }));
  }, [f.origin, f.dest, index]);
  const pickSide = (side: "origin" | "dest", next: LocSel) => { setSels((cur) => ({ ...cur, [side]: next })); set({ [side]: endpointOf(next) } as Partial<Form>); };
  // Add location: a district chosen with no saved City record of that name can be added to Locations as an active City (the
  // existing "add from the built-in list" operation), then becomes the endpoint.
  const [adding, setAdding] = useState(false);
  const addCity = async (side: "origin" | "dest") => {
    const x = sels[side];
    if (!x.state || !x.district || adding) return;
    setAdding(true);
    const form: LocationForm = {
      name: x.district, code: deriveLocationCode(x.district), type: "City", state: stateNameOf(x.state), district: x.district, city: x.district, area: "", pincode: "", address: "",
      parentLocationId: "", lat: "", lng: "", placeId: "", pickupEnabled: true, dropEnabled: true, onlineBookingEnabled: true, adminBookingEnabled: true,
      serviceIds: [], status: "Active", displayOrder: locations.length + 1,
    };
    try {
      const saved = await saveLocation(form, null, locations, auth.currentUser?.uid || "");
      setSels((cur) => ({ ...cur, [side]: { ...x, locationId: saved.id } }));
      set({ [side]: saved.id } as Partial<Form>);
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "The city could not be added to Locations." });
    } finally {
      setAdding(false);
    }
  };
  const endpoint = (side: "origin" | "dest") => {
    const x = sels[side];
    const cityMissing = x.district && !endpointOf(x) && !index.some((i) => i.loc.type === "City" && i.state === x.state && i.loc.name.trim().toLowerCase() === x.district.toLowerCase());
    return (
      <div className="fm-mini">
        <span>{side === "origin" ? "Pickup place" : "Drop place"}</span>
        <LocationScopeSelector variant="row" label={side === "origin" ? "Pickup place" : "Drop place"} value={x} onChange={(next) => pickSide(side, next)} locations={locations} depth="area"
          pinSearch="locate" disabled={busy || adding} status={locationsStatus} broad={{ zone: "All zones" }}
          action={canEdit && cityMissing ? <Button size="sm" icon="plus" loading={adding} onClick={() => void addCity(side)}>Add {x.district} to Locations</Button> : undefined} />
      </div>
    );
  };

  const used = columns.filter((c) => (fares[c.key]?.fare ?? "").trim() !== "" || (fares[c.key]?.payout ?? "").trim() !== "");
  const touched = !!(f.origin || f.dest || used.length);
  const problems: string[] = [];
  if (touched) {
    if (!f.origin || !f.dest) problems.push("Choose both the pickup and the drop place.");
    else if (f.origin === f.dest) problems.push("Pickup and drop must be different places.");
    if (!used.length) problems.push("Type the customer fare and partner payout for at least one cab.");
    for (const c of used) {
      const v = fares[c.key];
      if (!(num(v.fare) > 0)) problems.push(`${c.name}: enter the customer fare (more than zero).`);
      if (!(num(v.payout) > 0)) problems.push(`${c.name}: enter the partner payout (more than zero).`);
    }
    const p = num(f.priority);
    if (!Number.isInteger(p) || p < 1 || p > 99) problems.push("Priority must be a whole number from 1 (highest) to 99.");
    if (f.from && f.until && f.until < f.from) problems.push("The end date is before the start date.");
  }

  const startEdit = (r: FareRule) => {
    setEditing(r);
    setF({
      origin: r.originLocationId ?? "", dest: r.destinationLocationId ?? "", direction: r.reverseDirection === true ? "both" : "one", gst: r.gstMode ?? "included",
      peak: r.peakAdjustment ?? "exclude", enabled: r.status === "Active", priority: String(r.priority ?? 1), from: r.effectiveFrom ?? "", until: r.effectiveUntil ?? "",
    });
    setFares({ [r.vehicleCategoryId ?? ""]: { fare: text(r.baseFare), payout: text(r.partnerPayout) } });
    setReason("");
    setMessage(null);
    window.setTimeout(() => document.getElementById("route-add")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  // Copy: the same values as the start of a NEW route fare (pick the places, adjust the fares, save). Pickup and drop come over swapped.
  const startCopy = (r: FareRule) => {
    startEdit(r);
    setEditing(null);
    setF((x) => ({ ...x, origin: r.destinationLocationId ?? "", dest: r.originLocationId ?? "" }));
    setMessage({ ok: true, text: "Copied as a new route fare with pickup and drop swapped. Choose the places, check the fares and save." });
  };
  const reset = () => { setEditing(null); setF(blank); setFares({}); setReason(""); setMessage(null); };

  const save = async () => {
    if (!canEdit || busy || !touched || problems.length) return;
    if (reason.trim().length < 5) return setMessage({ ok: false, text: "Add a short reason (at least 5 characters)." });
    setBusy(true);
    setMessage(null);
    let done = 0;
    try {
      for (const c of used) {
        await saveFixedRouteFare({
          ...(editing ? { ruleId: editing.id, expectedVersion: editing.version ?? 0 } : {}), reason: reason.trim(),
          data: {
            brand, fareService: scope.service, originLocationId: f.origin, destinationLocationId: f.dest, vehicleCategoryId: c.key, serviceId: editing?.serviceId ?? "",
            customerFare: num(fares[c.key].fare), partnerPayout: num(fares[c.key].payout), gstMode: f.gst as "included" | "excluded", peakAdjustment: f.peak as "apply" | "exclude",
            reverseDirection: f.direction === "both", status: f.enabled ? "Active" : "Inactive", priority: num(f.priority), effectiveFrom: f.from, effectiveUntil: f.until,
          },
        });
        done++;
      }
      onToast(`${done} route fare${done === 1 ? "" : "s"} ${editing ? "updated" : "saved"}. New quotes use ${done === 1 ? "it" : "them"} now.`);
      reset();
    } catch (err) {
      const t = err instanceof ActionError || err instanceof Error ? err.message : "The route fare was not saved.";
      setMessage({ ok: false, text: done ? `${done} of ${used.length} saved. ${t}` : t });
    } finally {
      setBusy(false);
    }
  };

  const groups: RateGroup[] = [{ title: "", rows: [
    { key: "fare", label: "Customer fare", unit: "₹", cell: (k) => ({ value: fares[k]?.fare ?? "", onChange: (v) => setFare(k, { fare: v }), own: !!fares[k]?.fare, step: "0.01" }) },
    { key: "payout", label: "Partner payout", unit: "₹", cell: (k) => ({ value: fares[k]?.payout ?? "", onChange: (v) => setFare(k, { payout: v }), own: !!fares[k]?.payout, step: "0.01" }) },
  ] }];

  // ── Saved route fares ─────────────────────────────────────────────────────────────────────────────────────────
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"All" | "Active" | "Inactive">("All");
  const [cab, setCab] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return routes
      .filter((r) => status === "All" || r.status === status)
      .filter((r) => !cab || r.vehicleCategoryId === cab)
      .filter((r) => !t || [place(r.originLocationId, r.originLocationName), place(r.destinationLocationId, r.destinationLocationName), categoryName(r), r.name].some((v) => (v || "").toLowerCase().includes(t)))
      .sort((a, b) => place(a.originLocationId, a.originLocationName).localeCompare(place(b.originLocationId, b.originLocationName)) || place(a.destinationLocationId, a.destinationLocationName).localeCompare(place(b.destinationLocationId, b.destinationLocationName)) || (a.priority ?? 99) - (b.priority ?? 99));
  }, [routes, q, status, cab, locations, categories]); // eslint-disable-line react-hooks/exhaustive-deps

  const [onOff, setOnOff] = useState<Record<string, boolean>>({});
  const [listReason, setListReason] = useState("");
  const [listBusy, setListBusy] = useState(false);
  const [listMessage, setListMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = routes.filter((r) => owns(r) && onOff[r.id] !== undefined && onOff[r.id] !== (r.status === "Active"));
  const saveList = async () => {
    if (!canEdit || listBusy || !changed.length) return;
    if (listReason.trim().length < 5) return setListMessage({ ok: false, text: "Add a short reason (at least 5 characters)." });
    setListBusy(true);
    setListMessage(null);
    let done = 0;
    try {
      for (const r of changed) {
        await saveFixedRouteFare({ action: "status", ruleId: r.id, expectedVersion: r.version ?? 0, status: onOff[r.id] ? "Active" : "Inactive", reason: listReason.trim() });
        done++;
      }
      setOnOff({});
      setListReason("");
      onToast(`${done} route fare${done === 1 ? "" : "s"} updated.`);
    } catch (err) {
      const t = err instanceof Error ? err.message : "Not saved. Please try again.";
      setListMessage({ ok: false, text: done ? `${done} of ${changed.length} changes were saved. ${t}` : t });
    } finally {
      setListBusy(false);
    }
  };

  // ── Many at once: tick rows, then turn them on, off or delete them ──────────────────────────────────────────────
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const pickable = shown.filter(owns);
  const chosen = pickable.filter((r) => picked[r.id]);
  const allPicked = pickable.length > 0 && chosen.length === pickable.length;
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkReason, setBulkReason] = useState("");
  const [bulkMessage, setBulkMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const nameOf = (r: FareRule) => `${place(r.originLocationId, r.originLocationName)} → ${place(r.destinationLocationId, r.destinationLocationName)} · ${categoryName(r)}`;
  const bulk = async (kind: "on" | "off" | "delete") => {
    const rows = chosen;
    if (!canEdit || bulkBusy || !rows.length) return;
    if (bulkReason.trim().length < 5) return setBulkMessage({ ok: false, text: "Add a short reason (at least 5 characters)." });
    if (kind === "delete" && !window.confirm(rows.length === 1
      ? `Delete this route fare for good?\n\n${nameOf(rows[0])}\n\nBookings already made keep the price they were quoted. New quotes on this route go back to normal pricing.`
      : `Delete ${rows.length} route fares for good? Bookings already made keep the price they were quoted. New quotes on these routes go back to normal pricing.`)) return;
    setBulkBusy(true);
    setBulkMessage(null);
    let done = 0;
    const left: Record<string, boolean> = {};
    let failure = "";
    for (const r of rows) {
      try {
        await saveFixedRouteFare({ action: kind === "delete" ? "delete" : "status", ruleId: r.id, expectedVersion: r.version ?? 0, ...(kind === "delete" ? {} : { status: kind === "on" ? "Active" : "Inactive" }), reason: bulkReason.trim() });
        done++;
      } catch (err) {
        failure ||= `${nameOf(r)}: ${err instanceof Error ? err.message : "not saved."}`;
        left[r.id] = true;
      }
    }
    setBulkBusy(false);
    setPicked(left);
    if (kind === "delete" && editing && rows.some((r) => r.id === editing.id) && !left[editing.id]) reset();
    const verb = kind === "delete" ? "deleted" : kind === "on" ? "turned on" : "turned off";
    if (!failure) setBulkReason("");
    setBulkMessage(failure ? { ok: false, text: `${done} of ${rows.length} ${verb}. ${failure}` } : null);
    if (done) onToast(`${done} route fare${done === 1 ? "" : "s"} ${verb}.`);
  };

  const loading = rules === null && !error;
  return (
    <div className="space-y-4">
      {canEdit && (
        <SettingCard id="route-add" label="Add a route fare" title={editing ? `Change route fare · ${place(editing.originLocationId, editing.originLocationName)} → ${place(editing.destinationLocationId, editing.destinationLocationName)}` : "Add a route fare"}
          description={`${scopeLabel} · An agreed fare for one route. Routes without one keep the normal pricing. Used for office bookings whose pickup and drop are chosen from Locations.`}
          aside={<OnSwitch checked={f.enabled} onChange={(on) => set({ enabled: on })} label="On for customers" />}
          footer={<SaveBar reason={reason} onReason={setReason} onSave={save} busy={busy} disabled={!touched || problems.length > 0 || rules === null || !!error || !!locationsStatus.error}
            saveLabel={editing ? "Save changes" : "Save route fare"}
            note={editing ? <>Changing one cab. <button type="button" className="fm-linkbtn" onClick={reset}>Cancel change</button></> : "Type a fare under each cab that should have one. Cabs left empty keep the normal pricing."} message={message} />}>
          <CardBody>
            <div className="fm-mini-grid">
            </div>
            <div className="grid gap-3">{endpoint("origin")}{endpoint("dest")}</div>
            <div className="fm-mini-grid mt-3">
              <label className="fm-mini"><span>Direction</span>
                <select className="ds-select" value={f.direction} onChange={(e) => set({ direction: e.target.value })}>
                  <option value="one">This direction only</option>
                  <option value="both">Both directions (same fare back)</option>
                </select>
              </label>
              <label className="fm-mini"><span>Tax on the fare</span>
                <select className="ds-select" value={f.gst} onChange={(e) => set({ gst: e.target.value })}>
                  <option value="included">Fare includes GST</option>
                  <option value="excluded">GST added on top</option>
                </select>
              </label>
              <label className="fm-mini"><span>Peak adjustments</span>
                <select className="ds-select" value={f.peak} onChange={(e) => set({ peak: e.target.value })}>
                  <option value="exclude">Keep the fare as agreed</option>
                  <option value="apply">Apply the peak adjustment</option>
                </select>
              </label>
            </div>
          </CardBody>
          {columns.length === 0
            ? <CardBody><p className="fm-sub" role="status">{loading ? "Loading cabs…" : "No active vehicle categories yet. Add one under Vehicle categories."}</p></CardBody>
            : <RateTable label="Fare for each cab on this route" columns={columns} groups={groups} disabled={busy} />}
          <CardBody>
            <details className="fm-details">
              <summary>More options (priority and dates)</summary>
              <div className="fm-mini-grid mt-3">
                <label className="fm-mini"><span>Priority (1 = highest)</span><input className="ds-input" type="number" min={1} max={99} step={1} value={f.priority} onChange={(e) => set({ priority: e.target.value })} /></label>
                <label className="fm-mini"><span>Valid from</span><input className="ds-input" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></label>
                <label className="fm-mini"><span>Valid until</span><input className="ds-input" type="date" value={f.until} onChange={(e) => set({ until: e.target.value })} /></label>
              </div>
              <p className="fm-sub mt-2">Leave the dates empty for a fare that is always on. When two fares cover the same route and cab, the one with the lower priority number is used.</p>
            </details>
          </CardBody>
          <Problems items={problems} />
        </SettingCard>
      )}

      <SettingCard id="route-saved" label="Saved route fares" title="Saved route fares"
        description={`${scopeLabel} · ${loading ? "Loading…" : `${shown.length} route fare${shown.length === 1 ? "" : "s"}${shown.length !== routes.length ? ` of ${routes.length}` : ""}`}`}
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <div className="ds-search" style={{ width: 230 }}>
              <Icon name="search" />
              <input type="search" className="ds-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search route or cab" aria-label="Search route or cab" />
            </div>
            <select className="ds-select" value={cab} onChange={(e) => setCab(e.target.value)} aria-label="Cab">
              <option value="">All cabs</option>
              {categories.filter((c) => routes.some((r) => r.vehicleCategoryId === c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="ds-select" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status">
              <option value="All">All</option><option value="Active">On</option><option value="Inactive">Off</option>
            </select>
          </div>}
        footer={canEdit && chosen.length > 0
          ? (
            <div className="px-4 py-3 border-t border-line flex flex-wrap items-center gap-2" role="region" aria-label="Selected route fares">
              <strong className="text-[13px]">{chosen.length} selected</strong>
              <input className="ds-input" style={{ width: 260 }} value={bulkReason} onChange={(e) => { setBulkMessage(null); setBulkReason(e.target.value); }} placeholder="Reason (at least 5 characters)" aria-label="Reason for the change" />
              <Button size="sm" onClick={() => void bulk("on")} disabled={bulkBusy}>Turn on</Button>
              <Button size="sm" onClick={() => void bulk("off")} disabled={bulkBusy}>Turn off</Button>
              <Button size="sm" onClick={() => void bulk("delete")} disabled={bulkBusy}><span className="text-bad">Delete…</span></Button>
              <button type="button" className="fm-linkbtn" onClick={() => { setPicked({}); setBulkMessage(null); }}>Clear selection</button>
              {bulkBusy && <span className="text-[12px] text-muted">Working…</span>}
              {bulkMessage && <span className={`text-[12px] font-semibold ${bulkMessage.ok ? "text-ok" : "text-bad"}`} role="alert">{bulkMessage.text}</span>}
            </div>
          )
          : canEdit && changed.length > 0
          ? <SaveBar reason={listReason} onReason={setListReason} onSave={saveList} busy={listBusy} message={listMessage} note={`${changed.length} change${changed.length === 1 ? "" : "s"} not saved yet.`} />
          : null}>
        {error && <CardBody><p className="ds-error" role="alert">Saved route fares could not be loaded: {error} <button type="button" className="fm-linkbtn" onClick={() => setAttempt((n) => n + 1)}>Retry</button></p></CardBody>}
        {!error && (
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[940px] text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] font-bold uppercase text-muted">
                    <th className="py-2 pr-2 w-6">{canEdit && pickable.length > 0 ? <input type="checkbox" checked={allPicked} onChange={(e) => setPicked(e.target.checked ? Object.fromEntries(pickable.map((r) => [r.id, true])) : {})} aria-label="Select all shown route fares" /> : null}</th><th className="py-2 pr-3">Route</th><th className="pr-3">Cab</th><th className="pr-3 text-right">Customer fare</th><th className="pr-3 text-right">Partner payout</th><th className="pr-3">Tax / peak</th><th className="pr-3">On</th><th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const mine = owns(r);
                    const on = onOff[r.id] ?? r.status === "Active";
                    return (
                      <tr key={r.id} className={`border-t border-line ${picked[r.id] ? "bg-blue-50/50" : ""}`}>
                        <td className="py-2 pr-2">{mine && canEdit ? <input type="checkbox" checked={!!picked[r.id]} onChange={(e) => { setBulkMessage(null); setPicked((p) => ({ ...p, [r.id]: e.target.checked })); }} aria-label={`Select ${nameOf(r)}`} /> : null}</td>
                        <td className="py-2 pr-3">
                          <span className="font-semibold">{place(r.originLocationId, r.originLocationName)} → {place(r.destinationLocationId, r.destinationLocationName)}</span>
                          {!mine && <span className="ml-2 rounded-full border border-line px-1.5 text-[10px] font-bold text-muted">shared</span>}
                          <small className="block text-muted">{r.reverseDirection ? "Both directions" : typeof r.reverseDirection === "boolean" ? "This direction only" : "Direction not set"}{r.effectiveFrom || r.effectiveUntil ? ` · ${r.effectiveFrom || "any time"} to ${r.effectiveUntil || "no end"}` : ""}{(r.priority ?? 1) !== 1 ? ` · Priority ${r.priority}` : ""}</small>
                        </td>
                        <td className="pr-3">{categoryName(r)}</td>
                        <td className="pr-3 text-right font-semibold">{inr(r.baseFare)}</td>
                        <td className="pr-3 text-right">{r.partnerPayout ? inr(r.partnerPayout) : <span className="text-muted">Not set</span>}</td>
                        <td className="pr-3 text-[12px]">
                          {r.gstMode ? (r.gstMode === "included" ? "GST included" : "GST added") : <span className="text-muted">GST not set</span>}
                          <small className="block text-muted">{r.peakAdjustment ? (r.peakAdjustment === "apply" ? "Peak applies" : "No peak change") : "Peak not set"}</small>
                        </td>
                        <td className="pr-3">
                          {mine && canEdit
                            ? <label className="fm-switch" title={on ? "On for customers" : "Off"}><input type="checkbox" checked={on} onChange={(e) => { setListMessage(null); setOnOff((s) => ({ ...s, [r.id]: e.target.checked })); }} aria-label={`${place(r.originLocationId, r.originLocationName)} to ${place(r.destinationLocationId, r.destinationLocationName)} ${categoryName(r)} on or off`} /><span aria-hidden="true" /></label>
                            : <span>{on ? "On" : "Off"}</span>}
                          {r.status === "Active" && !complete(r) && <small className="block text-muted">Not used until completed in Change</small>}
                        </td>
                        <td className="text-right whitespace-nowrap">{mine && canEdit ? (
                          <span className="inline-flex gap-3">
                            <button type="button" className="fm-linkbtn" onClick={() => startEdit(r)}>Change</button>
                            <button type="button" className="fm-linkbtn" onClick={() => startCopy(r)} title="Use this fare as the start of a new one">Copy</button>
                            <button type="button" className="fm-linkbtn text-bad" onClick={() => { setBulkMessage(null); setPicked({ [r.id]: true }); window.setTimeout(() => document.querySelector<HTMLInputElement>("[aria-label='Reason for the change']")?.focus(), 0); }} title="Select this fare to delete it">Delete</button>
                          </span>
                        ) : null}</td>
                      </tr>
                    );
                  })}
                  {loading ? <tr><td colSpan={8} className="py-4 text-center text-muted">Loading saved route fares…</td></tr>
                    : !shown.length ? <tr><td colSpan={8} className="py-4 text-center text-muted">{routes.length ? "No route fares match. Change the search or the filter." : "No route fares yet. Add one above."}</td></tr> : null}
                </tbody>
              </table>
            </div>
          </CardBody>
        )}
      </SettingCard>
    </div>
  );
}

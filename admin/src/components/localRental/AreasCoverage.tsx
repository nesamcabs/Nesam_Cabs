import { useEffect, useMemo, useState } from "react";
import type { MasterLocation } from "../../types";
import { areasOf, locationsWithPin, pinsOfLocation, rulePlaceLabel, rulePlacesOf, selOfLocation, stateNameOf, zoneOfArea, zonesOf, type Indexed, type LocSel } from "../../domain/locationHierarchy";
import { pinOffices, type PinOffice } from "../../domain/pincodes";
import { usePincodeScope } from "../../hooks/usePincodeScope";
import { setZonePincodes } from "../../services/locationService";
import { rankRules, saveRule, setRuleStatus, type ServiceRule } from "../../services/serviceRulesService";
import { geoDocId, type GeoFareDoc, type GeoService } from "../../services/geoFareService";
import { covers, samePlace, standing, type Place } from "../BookingRulesGrid";
import PincodePicker from "../PincodePicker";
import type { VehicleCol } from "../RateTable";
import { Button, Icon } from "../ui";
import MappedLocationsMap from "./MappedLocationsMap";
import { Footer, Hint, LoadFailure, Panel, Pill, type Tone } from "./ui";
import type { FeedStatus } from "../../hooks/useLocationsFeed";

type Avail = "Available" | "Limited" | "Paused";
type Draft = { avail?: "" | Avail; cats?: string[] | null };
const norm = (s?: string) => (s ?? "").trim().toLowerCase();

/**
 * Areas & coverage. Coverage is the SAME service-rule records as Booking rules → Places & cabs (service_rules: booking status and the
 * cabs customers see, per place, with the same inheritance), so the two screens always agree. It is separate from rates: a place having
 * a rate, or matching a PIN, does not open bookings there. A zone's mapped areas are its Locations records (by parent or by the zone's
 * PINs); "Link areas" adds PINs to the zone with the existing zone-PIN save (Locations master).
 */
export default function AreasCoverage({ brand, service, fareService, rules, rulesLoaded, rulesError, onRetryRules, docs, feed, locationsStatus, sel, onSel, index, locations, vehicles, canEdit, canEditLocations, onToast, onEditRates, onManageLocations, scopeText }: {
  brand: string; service: GeoService; fareService: string; rules: ServiceRule[]; rulesLoaded: boolean; rulesError: string | null; onRetryRules: () => void;
  docs: Map<string, GeoFareDoc> | null; feed: FeedStatus; locationsStatus: FeedStatus;
  sel: LocSel; onSel: (s: LocSel) => void; index: Indexed[]; locations: MasterLocation[]; vehicles: VehicleCol[]; canEdit: boolean; canEditLocations: boolean;
  onToast: (t: string) => void; onEditRates: (areaIds: string[]) => void; onManageLocations: () => void; scopeText: (target: string) => string;
}) {
  const brandId = brand === "common" ? "" : brand;
  const isOwn = (r: ServiceRule) => (r.brand ?? "") === brandId && r.fareService === fareService;
  const live = useMemo(() => rules.filter((r) => r.status !== "Removed" && (r.kind === "availability" || r.kind === "categories") && (!r.brand || r.brand === brandId)
    && (!r.fareService || r.fareService === fareService)), [rules, brandId, fareService]);
  const zones = useMemo(() => (sel.district ? zonesOf(index, sel.state, sel.district) : []), [index, sel.state, sel.district]);
  const zone = zones.find((z) => z.id === sel.zoneId) ?? index.find((x) => x.loc.id === sel.zoneId)?.loc;
  // With zones saved, a zone is chosen to manage its areas; a district with no zones lists all of its mapped areas.
  const rows = useMemo(() => (!sel.district ? [] : zones.length && !sel.zoneId ? [] : areasOf(index, sel.state, sel.district, sel.zoneId)), [index, sel, zones.length]);
  const [picked, setPicked] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [bulkAvail, setBulkAvail] = useState<"" | "inherit" | Avail>("");
  const [bulkCats, setBulkCats] = useState<string[] | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setPicked([]); setDrafts({}); setMessage(null); }, [brand, service, sel.state, sel.district, sel.zoneId]);

  const zonePins = (id: string) => { const z = locations.find((l) => l.id === id); return z ? pinsOfLocation(z) : []; };
  const placeFor = (a: MasterLocation): Place | null => rulePlacesOf({ ...sel, locationId: a.id, pins: [] }, index)[0] ?? null;
  // A City record is saved as a city-wide rule (its name), which can be the whole district. It is shown here but changed only in
  // Booking rules → Places & cabs, so editing a zone's areas can never broaden into a city- or district-wide rule.
  const cityWide = (a: MasterLocation) => { const p = placeFor(a); return !!p && !p.area && !p.zoneId; };
  const catNames = vehicles.map((v) => v.name);
  const viewOf = (p: Place) => {
    const own = (kind: string) => rankRules(live.filter((r) => isOwn(r) && standing(r) && r.kind === kind && samePlace(r, p)))[0];
    const wider = (kind: string, skip?: ServiceRule) => rankRules(live.filter((r) => standing(r) && r.kind === kind && r.id !== skip?.id && covers(r, p, zonePins)))[0];
    const ownA = own("availability"), ownC = own("categories");
    const d = drafts[key(p)] ?? {};
    const inhA = wider("availability", ownA), inhC = wider("categories", ownC);
    return {
      ownA, ownC,
      avail: d.avail !== undefined ? d.avail : ownA?.availability ?? "",
      inheritedAvail: (inhA?.availability ?? "Available") as Avail,
      cats: d.cats !== undefined ? d.cats : ownC?.categories?.length ? ownC.categories : null,
      inheritedCats: inhC?.categories?.length ? inhC.categories : null,
    };
  };
  const key = (p: Place) => `${p.state}|${p.city}|${p.area}|${p.zoneId ?? ""}`;
  const rateSource = (a: MasterLocation): { tone: Tone; text: string } => {
    if (!docs) return feed.error ? { tone: "bad", text: "Rates unavailable" } : { tone: "off", text: "Loading…" };
    const has = (k: string) => [geoDocId(brand, service, k), ...(brand !== "common" ? [geoDocId("common", service, k)] : [])].some((id) => Object.keys(docs.get(id)?.classes ?? {}).length > 0);
    const z = zoneOfArea(a, index);
    if (has(`a_${a.id}`)) return { tone: "ok", text: "Area override" };
    if (z && has(`z_${z.id}`)) return { tone: "info", text: "Zone override" };
    if (has(`d_${sel.state}_${sel.district.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`)) return { tone: "info", text: "District default" };
    return { tone: "warn", text: "Not configured" };
  };

  const applyBulk = () => {
    if (!picked.length || (!bulkAvail && bulkCats === null)) return;
    setMessage(null);
    setDrafts((all) => {
      const next = { ...all };
      for (const id of picked) {
        const a = rows.find((r) => r.id === id && !cityWide(r));
        const p = a ? placeFor(a) : null;
        if (!p) continue;
        next[key(p)] = { ...next[key(p)], ...(bulkAvail ? { avail: bulkAvail === "inherit" ? "" : bulkAvail } : {}), ...(bulkCats !== null ? { cats: bulkCats } : {}) };
      }
      return next;
    });
  };

  // ── Changes to save (the same create / update / remove of service rules Places & cabs makes) ──
  type Op = { place: Place; kind: "availability" | "categories"; action: "create" | "update" | "remove"; rule?: ServiceRule; patch?: Partial<ServiceRule> };
  const ops: Op[] = [];
  const problems: string[] = [];
  for (const a of rows) {
    const p = placeFor(a);
    if (!p || !drafts[key(p)]) continue;
    const v = viewOf(p);
    if (v.avail === "" && v.ownA) ops.push({ place: p, kind: "availability", action: "remove", rule: v.ownA });
    else if (v.avail !== "" && (!v.ownA || v.ownA.availability !== v.avail)) ops.push({ place: p, kind: "availability", action: v.ownA ? "update" : "create", rule: v.ownA, patch: { availability: v.avail } });
    if (v.cats === null && v.ownC) ops.push({ place: p, kind: "categories", action: "remove", rule: v.ownC });
    else if (v.cats !== null) {
      if (!v.cats.length) problems.push(`${a.name}: keep at least one cab on. To stop bookings there, set Paused.`);
      else if (!v.ownC || v.cats.join("|") !== (v.ownC.categories ?? []).join("|")) ops.push({ place: p, kind: "categories", action: v.ownC ? "update" : "create", rule: v.ownC, patch: { categories: v.cats } });
    }
  }
  const save = async () => {
    if (!canEdit || busy || !ops.length || problems.length) return;
    if (reason.trim().length < 5) return setMessage({ ok: false, text: "Enter a reason for this change (at least 5 characters)." });
    setBusy(true); setMessage(null);
    let done = 0;
    try {
      for (const op of ops) {
        const why = reason.trim();
        if (op.action === "remove") await setRuleStatus(op.rule!, "Removed", why);
        else if (op.action === "update") await saveRule({ ...op.rule!, ...op.patch, reason: why }, op.rule!.id, op.rule);
        else await saveRule({
          brand: brandId, fareService, kind: op.kind, name: `${rulePlaceLabel(op.place)} · ${op.kind === "availability" ? "booking" : "cabs shown"}`,
          status: "Enabled", priority: 1, scope: { ...op.place, side: "Pickup or drop" }, service: fareService, schedule: { mode: "Always" }, ...op.patch, reason: why,
        });
        done++;
      }
      setDrafts({}); setReason(""); setPicked([]);
      onToast(`Coverage saved for ${done} change${done === 1 ? "" : "s"}. Booking rules → Places & cabs shows the same settings.`);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Not saved. Please try again.";
      setMessage({ ok: false, text: done ? `${done} of ${ops.length} changes were saved. ${text}` : text });
    } finally { setBusy(false); }
  };

  const pickable = rows.filter((r) => !cityWide(r));
  const allPicked = pickable.length > 0 && pickable.every((r) => picked.includes(r.id));
  const withCoords = rows.filter((r) => typeof r.lat === "number" && typeof r.lng === "number");

  return (
    <div className="space-y-4">
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
        <Panel title="Zone mapping" aside={zone && canEditLocations ? <LinkAreas zone={zone} sel={sel} onToast={onToast} /> : undefined}>
          <Hint>Uses existing Places &amp; cabs settings.</Hint>
          <div className="my-3 flex flex-wrap items-center gap-4 text-[13.5px]">
            <label className="flex items-center gap-2 font-semibold text-slate-700">Select zone
              <select className="ds-select w-[220px]" value={sel.zoneId} disabled={!sel.district || !zones.length} onChange={(e) => onSel({ ...sel, zoneId: e.target.value, locationId: "", pins: [] })} aria-label="Zone to manage">
                <option value="">{!sel.district ? "Choose a district first" : zones.length ? "Select a zone" : "No zones saved"}</option>
                {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </label>
            <span className="h-5 w-px bg-slate-300" />
            <span className="font-semibold text-slate-700">Mapped areas <strong className="ml-1 text-slate-900">{sel.district && (zone || !zones.length) ? rows.length : "—"}</strong></span>
            {zone && <span className="text-slate-600">Zone PINs <strong className="text-slate-900">{pinsOfLocation(zone).length || "none"}</strong></span>}
          </div>
          {rulesError ? <LoadFailure what="Booking rules (coverage)" failure={{ denied: /permission/i.test(rulesError), error: rulesError }} onRetry={onRetryRules} />
          : locationsStatus.error ? <LoadFailure what="Locations" failure={locationsStatus} onRetry={locationsStatus.onRetry} />
          : locationsStatus.loading || !rulesLoaded ? <p className="text-[13px] text-slate-500" role="status">Loading coverage…</p>
          : !sel.district || (zones.length > 0 && !zone) ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <Icon name="map-pin" size={26} className="mx-auto text-slate-500" />
              <p className="mt-2 text-[15px] font-bold text-slate-900">{sel.district ? "Select a zone to manage its mapped areas" : "Choose a state and district above"}</p>
              <p className="text-[13px] text-slate-600">Linked areas will appear here.</p>
            </div>
          ) : !rows.length ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-[13.5px] text-slate-600">
              No mapped areas{zone ? ` in ${zone.name}` : ` in ${sel.district}`} yet. {zone ? "Link areas by PIN, or add areas in Locations." : "Add areas in Locations."}
              <div className="mt-2"><button type="button" className="fm-linkbtn" onClick={onManageLocations}>Open Locations</button></div>
            </div>
          ) : (
            <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[640px] text-[13.5px]">
                <thead className="sticky top-0 bg-slate-50 text-left text-[12.5px] font-semibold text-slate-700"><tr>
                  <th className="w-9 px-3 py-2"><input type="checkbox" aria-label="Select all areas" checked={allPicked} onChange={() => setPicked(allPicked ? [] : pickable.map((r) => r.id))} /></th>
                  <th className="px-2 py-2">Area / Village</th><th className="px-2 py-2">PIN</th><th className="px-2 py-2">Service status</th><th className="px-2 py-2">Cabs</th><th className="px-2 py-2">Rate source</th>
                </tr></thead>
                <tbody>{rows.map((a) => {
                  const p = placeFor(a);
                  const v = p ? viewOf(p) : null;
                  const status = v ? (v.avail || v.inheritedAvail) : "Available";
                  const cats = v ? v.cats ?? v.inheritedCats : null;
                  const rs = rateSource(a);
                  const pending = p && drafts[key(p)];
                  return (
                    <tr key={a.id} className={`border-t border-slate-100 ${pending ? "bg-amber-50/60" : ""}`}>
                      <td className="px-3 py-1.5"><input type="checkbox" aria-label={`Select ${a.name}`} checked={picked.includes(a.id)} disabled={cityWide(a)}
                        title={cityWide(a) ? "A city-wide rule: change it in Booking rules → Places & cabs" : undefined} onChange={() => setPicked((x) => (x.includes(a.id) ? x.filter((i) => i !== a.id) : [...x, a.id]))} /></td>
                      <td className="px-2 py-1.5"><strong className="text-slate-800">{a.name}</strong>{a.type !== "Area / Locality" && <small className="ml-1 text-slate-500">{a.type}</small>}{cityWide(a) && <small className="block text-slate-500">City-wide · change in Booking rules</small>}</td>
                      <td className="px-2 py-1.5 tabular-nums text-slate-700">{pinsOfLocation(a).join(", ") || <Pill tone="warn">Needs PIN</Pill>}</td>
                      <td className="px-2 py-1.5"><Pill tone={status === "Paused" ? "bad" : status === "Limited" ? "warn" : "ok"} title={v?.avail ? "Set for this place" : "Follows the wider place"}>{status}{v && !v.avail ? " · inherited" : ""}</Pill></td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-700">{!cats ? "All cabs" : `${cats.length} of ${catNames.length}`}{v && v.cats === null ? <small className="ml-1 text-slate-500">inherited</small> : null}</td>
                      <td className="px-2 py-1.5"><Pill tone={rs.tone}>{rs.text}</Pill></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
          {canEdit && rows.length > 0 && (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-slate-700">Availability
                <select className="ds-select w-[170px]" value={bulkAvail} disabled={!picked.length} onChange={(e) => setBulkAvail(e.target.value as typeof bulkAvail)}>
                  <option value="">Set</option><option value="inherit">Follow wider place</option><option value="Available">Available</option><option value="Limited">Limited</option><option value="Paused">Paused</option>
                </select>
              </label>
              <CabsPicker names={catNames} value={bulkCats} onChange={setBulkCats} disabled={!picked.length} />
              <Button disabled={!picked.length || (!bulkAvail && bulkCats === null)} onClick={applyBulk}>Apply to selected</Button>
              <span className="mx-1 h-6 w-px bg-slate-300" />
              <Button icon="calculator" disabled={!picked.length} onClick={() => onEditRates(picked)} title="Open Fare rates → Area overrides for the selected areas. Only the fields you change are saved to each.">Edit rates for {picked.length || "selected"}</Button>
            </div>
          )}
        </Panel>

        <Panel title="Saved zone boundary">
          {zone ? (
            <>
              {withCoords.length ? <MappedLocationsMap points={withCoords} /> : (
                <div className="flex h-[160px] flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-center text-[13px] text-slate-600">
                  <Icon name="map-pin" size={24} className="text-slate-400" />No mapped location of this zone has coordinates yet.
                </div>
              )}
              <dl className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-[13.5px]">
                <dt className="font-semibold text-slate-700">Boundary status</dt><dd className="rounded-md bg-slate-50 px-3 py-1.5 text-slate-700">No verified boundary saved</dd>
                <dt className="font-semibold text-slate-700">Mapped locations</dt><dd className="rounded-md bg-slate-50 px-3 py-1.5 text-slate-700">{rows.length} ({withCoords.length} with coordinates)</dd>
              </dl>
              <div className="mt-2"><Hint>A zone covers its PINs and its mapped Locations records. Boundary drawings are not stored in this system, so none is shown or guessed.</Hint></div>
            </>
          ) : (
            <div className="flex h-[200px] flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-center text-[13.5px] text-slate-600">
              <Icon name="map-pin" size={26} className="text-slate-400" />Select a zone to view its mapped locations.
              <Button size="sm" className="mt-3" onClick={onManageLocations}>Manage locations</Button>
            </div>
          )}
          <div className="mt-3"><Hint>Coverage and pricing are configured separately.</Hint></div>
        </Panel>
      </div>

      <PinMatches index={index} onSel={onSel} />
      {canEdit && (
        <Footer scopeText={scopeText(zone ? zone.name : sel.district ? `${sel.district} district` : "Select zone")} reason={reason} onReason={setReason} onSave={save} saveLabel="Save coverage"
          busy={busy} disabled={!ops.length || problems.length > 0 || !rulesLoaded || !!rulesError || !!locationsStatus.error} message={message ?? (problems.length ? { ok: false, text: problems[0]! } : null)} />
      )}
    </div>
  );
}

function CabsPicker({ names, value, onChange, disabled }: { names: string[]; value: string[] | null; onChange: (v: string[] | null) => void; disabled?: boolean }) {
  const on = value ?? names;
  return (
    <details className={`relative ${disabled ? "pointer-events-none opacity-50" : ""}`}>
      <summary className="ds-select flex w-[190px] cursor-pointer list-none flex-col justify-center" aria-label="Vehicle categories">
        <span className="text-[11px] font-semibold text-slate-600">Vehicle categories</span>
        <span className="text-[13px]">{value === null ? "Set" : `${value.length} of ${names.length} on`}</span>
      </summary>
      <div className="absolute z-30 mt-1 w-[220px] rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
        {names.map((n) => (
          <label key={n} className="flex items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-slate-50">
            <input type="checkbox" checked={on.some((x) => norm(x) === norm(n))} onChange={() => onChange(on.some((x) => norm(x) === norm(n)) ? on.filter((x) => norm(x) !== norm(n)) : [...on, n])} /> {n}
          </label>
        ))}
        <button type="button" className="fm-linkbtn mt-1 px-2 text-[12px]" onClick={() => onChange(null)}>Clear (no change)</button>
      </div>
    </details>
  );
}

/** Link areas to a zone by PIN: the district's India Post PINs, saved on the zone with the existing zone-PIN save. */
function LinkAreas({ zone, sel, onToast }: { zone: MasterLocation; sel: LocSel; onToast: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const scope = usePincodeScope(open ? sel.state : "", open ? sel.district : "", "none");
  const [pins, setPins] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setPins(pinsOfLocation(zone)); setError(""); } }, [open, zone]);
  const save = async () => {
    setBusy(true); setError("");
    try { await setZonePincodes(zone, pins); onToast(`${zone.name}: ${pins.length} PIN${pins.length === 1 ? "" : "s"} linked.`); setOpen(false); }
    catch (err) { setError(err instanceof Error ? err.message : "The zone PINs were not saved."); }
    finally { setBusy(false); }
  };
  if (!open) return <Button icon="link" onClick={() => setOpen(true)}>Link areas</Button>;
  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
      <div className="relative w-[240px]"><PincodePicker list={scope.list} selected={pins} onChange={setPins} cityChosen label={`PINs of ${zone.name}`} /></div>
      <Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>Save zone PINs</Button>
      <Button size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
      {error && <p className="w-full text-[12.5px] font-semibold text-red-700" role="alert">{error}</p>}
    </div>
  );
}

/** Every location carrying a PIN, with its hierarchy: saved Locations records (choose one to select it) and India Post offices. */
function PinMatches({ index, onSel }: { index: Indexed[]; onSel: (s: LocSel) => void }) {
  const [q, setQ] = useState("");
  const [offices, setOffices] = useState<PinOffice[] | null>(null);
  const pin = /^[1-9]\d{5}$/.test(q) ? q : "";
  useEffect(() => {
    let live = true;
    setOffices(null);
    if (pin) void pinOffices(pin).then((r) => { if (live) setOffices(r); });
    return () => { live = false; };
  }, [pin]);
  const saved = pin ? locationsWithPin(pin, index) : [];
  return (
    <Panel title="PIN matches">
      <div className="relative">
        <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="ds-input w-full !pl-9" inputMode="numeric" maxLength={6} placeholder="Enter PIN" aria-label="Enter PIN" value={q} onChange={(e) => setQ(e.target.value.replace(/\D/g, ""))} />
      </div>
      <div className="mt-2 rounded-lg bg-slate-50 p-3 text-[13.5px]">
        {!pin ? <p className="text-center text-slate-600">{q ? "Enter all six digits." : "Select a matching location to view its hierarchy."}</p>
          : offices === null ? <p className="text-slate-600" role="status">Searching…</p>
          : !saved.length && !offices.length ? <p className="text-slate-600">No location carries PIN {pin}.</p>
          : (
            <ul className="grid gap-1">
              {saved.map((x) => (
                <li key={x.loc.id}><button type="button" className="w-full rounded-md px-2 py-1.5 text-left hover:bg-white" onClick={() => { const s = selOfLocation(x.loc.id, index); if (s) onSel(s); }}>
                  <strong>{x.loc.name}</strong> <span className="text-slate-500">· {x.zone ? "Service zone" : x.loc.type} · {x.district || "District not set"} · {stateNameOf(x.state)}</span>
                </button></li>
              ))}
              {offices.map((o) => (
                <li key={`${o.district}|${o.office}`} className="px-2 py-1 text-slate-600">{o.office} · {o.district} · {stateNameOf(o.state)} <small className="text-slate-400">(India Post · no saved location)</small></li>
              ))}
            </ul>
          )}
      </div>
    </Panel>
  );
}

import { useEffect, useMemo, useState } from "react";
import { rankRules, saveRule, setRuleStatus, type RuleKind, type ServiceRule } from "../services/serviceRulesService";
import { BRAND_LABELS, serviceLabel, type FareWorkspaceScope } from "../services/tariffService";
import { Button, Icon } from "./ui";
import { Modal } from "./Feedback";
import { parentOf } from "../domain/placeZones";
import { isPincode } from "../domain/pincodes";
import type { MasterLocation } from "../types";
import LocationScopeSelector from "./location/LocationScopeSelector";
import type { FeedStatus } from "../hooks/useLocationsFeed";
import { EMPTY_SEL, indexLocations, pinsOfLocation, rulePlaceLabel, rulePlacesOf, type LocSel } from "../domain/locationHierarchy";
import { CardBody, Problems, RateTable, SaveBar, SettingCard, type RateColumn, type RateRow, type VehicleCol } from "./RateTable";

// Booking rules on one page: one row per place, and across the top whether bookings are open and which cabs customers see.
// (Price changes have their own table, PriceChangeRules, where each change names its service and packages.) Each changed cell is saved as an ordinary service rule (service_rules), exactly what the booking server applies
// (functions/src/serviceRules.ts evaluateRules): the brand's own rule first, then the most specific place, then the higher priority.
// A row that is not set here follows the wider place above it. Rules with dates, pickup-only / drop-only rules and switched-off
// rules are not table cells; they stay in the list under the table.

/** A booking-rule place: state code, city / district name, area name or pincode, and optionally a Service Zone of the district. */
export interface Place { state: string; city: string; area: string; zoneId?: string; zoneName?: string }
type Avail = "Available" | "Limited" | "Paused";
type Draft = { avail?: "" | Avail; cats?: string[] | null };

const AVAIL: Avail[] = ["Available", "Limited", "Paused"];
const keyOf = (p: Place) => `${p.state}|${p.city}|${p.area}${p.zoneId ? `|z:${p.zoneId}` : ""}`;
export const placeOf = (s: ServiceRule["scope"]): Place => ({ state: s.state, city: s.city, area: s.area, ...(s.zoneId ? { zoneId: s.zoneId, zoneName: s.zoneName } : {}) });
const norm = (s?: string) => (s ?? "").trim().toLowerCase();
export const samePlace = (r: ServiceRule, p: Place) => norm(r.scope.state) === norm(p.state) && norm(r.scope.city) === norm(p.city) && norm(r.scope.area) === norm(p.area) && (r.scope.zoneId ?? "") === (p.zoneId ?? "");
/** The rule's place is this place or a wider one (the state, the city, everywhere). */
export const covers = (r: ServiceRule, p: Place, zonePins: (id: string) => string[] = () => []) => (!r.scope.state || norm(r.scope.state) === norm(p.state))
  // A Service Zone rule covers the zone row itself and the pincode rows listed in the zone (the server matches by those pincodes).
  && (!r.scope.zoneId || p.zoneId === r.scope.zoneId || (isPincode(p.area) && zonePins(r.scope.zoneId).includes(p.area)))
  // A district's rule also covers a town listed inside it that is shown as its own place (Krishnagiri → Hosur).
  && (!r.scope.city || norm(r.scope.city) === norm(p.city) || (!r.scope.area && parentOf(p.city) === norm(r.scope.city)))
  && (!r.scope.area || norm(r.scope.area) === norm(p.area));
/** A standing rule the table can show and edit: on, no dates, for pickup or drop. */
export const standing = (r: ServiceRule) => r.status === "Enabled" && r.schedule.mode === "Always" && (r.scope.side ?? "Pickup or drop") === "Pickup or drop";
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.some((y) => norm(y) === norm(x)));

/** The two kinds this table edits; price changes have their own table (PriceChangeRules). */
const TABLE_KINDS: RuleKind[] = ["availability", "categories"];

/**
 * The rules that are NOT cells of the booking table or rows of the price-change table: with dates, pickup-only / drop-only, switched
 * off, a second rule for the same place, or inherited. The page lists them in DateRules, where they can be edited in place.
 */
export function specialRules(rules: ServiceRule[], isOwn: (r: ServiceRule) => boolean): ServiceRule[] {
  const live = rules.filter((r) => r.status !== "Removed" && r.kind !== "limit");
  const inTable = new Set<string>();
  const groups = new Map<string, ServiceRule[]>();
  for (const r of live) {
    if (!TABLE_KINDS.includes(r.kind) || !isOwn(r) || !standing(r)) continue;
    const key = `${r.kind}|${keyOf(placeOf(r.scope))}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const list of groups.values()) inTable.add(rankRules(list)[0]!.id);
  return live.filter((r) => !inTable.has(r.id) && !(r.kind === "pricing" && standing(r)));
}

export default function BookingRulesGrid({ rules, isOwn, fareScope, vehicles, canEdit, loaded, loadError, locations, locationsStatus, onRetry, focus, onManageLocations, onToast }: {
  /** Every rule for this brand & service, including shared (All brands) rules it inherits; removed rules may be included. */
  rules: ServiceRule[];
  /** A rule saved for this brand & service (the others are inherited). */
  isOwn: (r: ServiceRule) => boolean;
  fareScope: FareWorkspaceScope;
  vehicles: VehicleCol[];
  canEdit: boolean;
  loaded: boolean;
  loadError: string | null;
  /** The Locations master, for the shared location selector and zone pincodes. */
  locations: MasterLocation[];
  /** Local & Rental → Areas & coverage: only the rows inside this selection (the same records, not a copy). */
  focus?: (p: Place) => boolean;
  onManageLocations?: () => void;
  locationsStatus?: FeedStatus;
  onRetry?: () => void;
  onToast: (text: string) => void;
}) {
  const live = useMemo(() => rules.filter((r) => r.status !== "Removed" && r.kind !== "limit"), [rules]);
  const catNames = vehicles.map((v) => v.name);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [added, setAdded] = useState<Place[]>([]);
  const [pick, setPick] = useState<LocSel>(EMPTY_SEL);
  const index = useMemo(() => indexLocations(locations), [locations]);
  const zonePins = (id: string) => { const z = locations.find((l) => l.id === id); return z ? pinsOfLocation(z) : []; };
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // The place whose deletion is being confirmed (only places with saved rules need it).
  const [removing, setRemoving] = useState<Place | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [removeError, setRemoveError] = useState<string | null>(null);
  // A different brand or service is a different table.
  useEffect(() => { setDrafts({}); setAdded([]); setMessage(null); }, [fareScope.brand, fareScope.service]);
  // ── Places: everywhere, every place that has a rule, and places added here (in state → city → area order) ──────────
  const places = useMemo(() => {
    const all = new Map<string, Place>([["||", { state: "", city: "", area: "" }]]);
    // Only standing booking / cab rules make a row; date-based and special rules are listed in their own section, price changes in theirs.
    for (const r of live) if (standing(r) && TABLE_KINDS.includes(r.kind)) { const p = placeOf(r.scope); all.set(keyOf(p), p); }
    for (const p of added) all.set(keyOf(p), p);
    return [...all.values()].filter((p) => !focus || focus(p)).sort((a, b) => (a.state || "").localeCompare(b.state || "") || (a.city || "").localeCompare(b.city || "") || (a.area || "").localeCompare(b.area || ""));
  }, [live, added, focus]);
  const label = (p: Place) => rulePlaceLabel(p);
  const level = (p: Place) => p.area ? (isPincode(p.area) ? "Pincode" : "Area") : p.zoneId ? "Service zone" : p.city ? "District / city" : p.state ? "State" : "Everywhere";

  // ── What applies at each place, worked out like the booking server ─────────────────────────────────────────────────
  const ownRule = (p: Place, kind: RuleKind) => rankRules(live.filter((r) => isOwn(r) && standing(r) && r.kind === kind && samePlace(r, p)))[0];
  const wider = (p: Place, kind: RuleKind, skip?: ServiceRule) => rankRules(live.filter((r) => standing(r) && r.kind === kind && r.id !== skip?.id && covers(r, p, zonePins)))[0];
  /** Where an inherited value comes from, in words: "the All brands rule for Dindigul", "the wider rule for Tamil Nadu". */
  const fromText = (r?: ServiceRule) => {
    if (!r) return "the default";
    const at = label(placeOf(r.scope));
    if (isOwn(r)) return `the rule for ${at}`;
    return r.brand ? `an older ${BRAND_LABELS[r.brand as keyof typeof BRAND_LABELS] ?? r.brand} rule for all services (${at})` : `the All brands rule for ${at}`;
  };
  /** The short tag after an inherited value in the Status box. */
  const tagOf = (r?: ServiceRule) => !r ? "default" : !isOwn(r) ? "shared" : "wider";
  const view = (p: Place) => {
    const d = drafts[keyOf(p)] ?? {};
    const ownA = ownRule(p, "availability"), ownC = ownRule(p, "categories");
    const inhA = wider(p, "availability", ownA), inhC = wider(p, "categories", ownC);
    const avail = d.avail !== undefined ? d.avail : (ownA?.availability ?? "");
    const cats = d.cats !== undefined ? d.cats : (ownC?.categories?.length ? ownC.categories : null);
    const inheritedCats = inhC?.categories?.length ? inhC.categories : null;
    return { ownA, ownC, inhA, inhC, avail, cats, inheritedAvail: (inhA?.availability ?? "Available") as Avail, inheritedCats };
  };
  const setDraft = (p: Place, patch: Draft) => { setMessage(null); setDrafts((all) => ({ ...all, [keyOf(p)]: { ...all[keyOf(p)], ...patch } })); };

  // ── The changes to save, per place and kind ─────────────────────────────────────────────────────────────────────
  type Op = { place: Place; kind: RuleKind; action: "create" | "update" | "remove"; rule?: ServiceRule; patch?: Partial<ServiceRule> };
  const problems: string[] = [];
  const ops: Op[] = [];
  for (const p of places) {
    if (!drafts[keyOf(p)]) continue;
    const v = view(p);
    const name = label(p);
    // Booking status
    if (v.avail === "" && v.ownA) ops.push({ place: p, kind: "availability", action: "remove", rule: v.ownA });
    else if (v.avail !== "" && (!v.ownA || v.ownA.availability !== v.avail)) ops.push({ place: p, kind: "availability", action: v.ownA ? "update" : "create", rule: v.ownA, patch: { availability: v.avail } });
    // Cabs shown
    if (v.cats === null && v.ownC) ops.push({ place: p, kind: "categories", action: "remove", rule: v.ownC });
    else if (v.cats !== null) {
      if (!v.cats.length) problems.push(`${name}: keep at least one cab on. To stop bookings there, set Booking to Paused.`);
      // Switching a cab off and on again leaves a place as it was: nothing to save.
      else if (!v.ownC && sameSet(v.cats, v.inheritedCats ?? catNames)) { /* same as the wider place */ }
      else if (!v.ownC || !sameSet(v.cats, v.ownC.categories ?? [])) ops.push({ place: p, kind: "categories", action: v.ownC ? "update" : "create", rule: v.ownC, patch: { categories: v.cats } });
    }
  }
  const pending = ops.length > 0;

  const save = async () => {
    if (!canEdit || busy || !pending || problems.length) return;
    if (reason.trim().length < 5) return setMessage({ ok: false, text: "Add a short reason (at least 5 characters)." });
    setBusy(true);
    setMessage(null);
    let done = 0;
    try {
      for (const op of ops) {
        const why = reason.trim();
        if (op.action === "remove") { await setRuleStatus(op.rule!, "Removed", why); }
        else if (op.action === "update") { await saveRule({ ...op.rule!, ...op.patch, reason: why }, op.rule!.id, op.rule); }
        else {
          await saveRule({
            brand: fareScope.brand === "common" ? "" : fareScope.brand, fareService: fareScope.service, kind: op.kind,
            name: `${label(op.place)} · ${op.kind === "availability" ? "booking" : op.kind === "categories" ? "cabs shown" : "price change"}`,
            status: "Enabled", priority: 1, scope: { ...op.place, side: "Pickup or drop" }, service: fareScope.service, schedule: { mode: "Always" },
            ...op.patch, reason: why,
          });
        }
        done++;
      }
      setDrafts({});
      setAdded([]);
      setReason("");
      onToast(`Booking rules saved for ${where}. New quotes and bookings use them now.`);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Not saved. Please try again.";
      setMessage({ ok: false, text: done ? `${done} of ${ops.length} changes were saved. ${text}` : text });
    } finally {
      setBusy(false);
    }
  };

  // ── Deleting a place: its own standing booking and cab rules are removed (history is kept) ─────────────────────────
  const rulesOfPlace = (p: Place) => live.filter((r) => isOwn(r) && standing(r) && TABLE_KINDS.includes(r.kind) && samePlace(r, p));
  const forget = (p: Place) => {
    setAdded((list) => list.filter((x) => keyOf(x) !== keyOf(p)));
    setDrafts((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== keyOf(p))));
    setMessage(null);
  };
  const askDelete = (p: Place) => {
    if (!rulesOfPlace(p).length) return forget(p); // added here and never saved
    setRemoveReason("");
    setRemoveError(null);
    setRemoving(p);
  };
  const confirmDelete = async () => {
    if (!removing || busy || !canEdit) return;
    if (removeReason.trim().length < 5) return setRemoveError("Add a short reason (at least 5 characters).");
    setBusy(true);
    setRemoveError(null);
    try {
      for (const rule of rulesOfPlace(removing)) await setRuleStatus(rule, "Removed", removeReason.trim());
      const name = label(removing);
      const stays = live.some((r) => standing(r) && !isOwn(r) && TABLE_KINDS.includes(r.kind) && samePlace(r, removing));
      forget(removing);
      setRemoving(null);
      onToast(stays ? `${name}: your rules were deleted. The row stays because of a shared rule; delete that under All brands.` : `${name} deleted. It now follows the wider place.`);
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Not deleted. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // ── The table ──────────────────────────────────────────────────────────────────────────────────────────────────
  const columns: RateColumn[] = [
    { key: "avail", name: "Status", group: "Booking", width: 172 },
    ...vehicles.map((v) => ({ key: `cat:${v.name}`, name: v.name, group: "Cabs shown" })),
    { key: "reset", name: "", group: "", width: 86 },
  ];
  const rows: RateRow[] = places.map((p) => {
    const v = view(p);
    const hasOwn = v.avail !== "" || v.cats !== null;
    // A row that exists only because of a rule this brand & service does not own says so.
    const sharedOnly = !v.ownA && !v.ownC && live.some((r) => standing(r) && !isOwn(r) && samePlace(r, p));
    return {
      key: keyOf(p), label: label(p), unit: sharedOnly ? `${level(p)} · shared` : level(p),
      // "All locations" is the base row and cannot be deleted.
      action: canEdit && (p.state || p.city || p.area) ? (
        <button type="button" className="fm-linkbtn fm-linkbtn--danger flex-none self-center" disabled={sharedOnly} onClick={() => askDelete(p)}
          aria-label={`Delete ${label(p)}`} title={sharedOnly ? "This is a shared rule: delete it under All brands, or the brand that owns it." : `Delete ${label(p)}`}>
          <Icon name="trash-2" size={14} />
        </button>
      ) : undefined,
      cell: (col: string) => {
        if (col === "avail") return {
          value: v.avail, inherited: v.avail === "",
          options: [{ value: "", label: `${v.inheritedAvail} (${tagOf(v.inhA)})` }, ...AVAIL.map((a) => ({ value: a, label: a }))],
          title: v.avail === "" ? `Follows ${fromText(v.inhA)}` : "Set for this place",
          onChange: (x: string) => setDraft(p, { avail: x as Draft["avail"] }),
        };
        if (col.startsWith("cat:")) {
          const cat = col.slice(4);
          const list = v.cats ?? v.inheritedCats;
          const on = !list || list.some((c) => norm(c) === norm(cat));
          return {
            checked: on, inherited: v.cats === null,
            title: v.cats === null ? `${on ? "Shown" : "Hidden"} · follows ${fromText(v.inhC)}` : on ? "Shown here" : "Hidden here",
            onToggle: (next: boolean) => {
              const base = v.cats ?? v.inheritedCats ?? catNames;
              setDraft(p, { cats: next ? [...base.filter((c) => norm(c) !== norm(cat)), cat] : base.filter((c) => norm(c) !== norm(cat)) });
            },
          };
        }
        return {
          display: hasOwn && canEdit
            ? <button type="button" className="fm-linkbtn" title="Follow the wider place again" onClick={() => setDraft(p, { avail: "", cats: null })}>Reset</button>
            : "",
        };
      },
    };
  });

  const brandName = fareScope.brand === "common" ? "All brands (shared)" : BRAND_LABELS[fareScope.brand];
  const where = `${brandName} → ${serviceLabel(fareScope.service)}`;
  // Add location: the place(s) the shared selector stands for (several picked PINs = one row each, as before).
  const toAdd: Place[] = pick.state ? rulePlacesOf(pick, index) : [];
  const canAdd = toAdd.length > 0;
  const addPlace = () => {
    if (!canAdd) return;
    setAdded((list) => [...list, ...toAdd.filter((p) => !list.some((x) => keyOf(x) === keyOf(p)))]);
    setPick({ ...EMPTY_SEL, state: pick.state });
  };

  return (
    <div className="space-y-4">
      <SettingCard id="rules-places" label={`Booking rules for ${where}`}
        title={`Places and cabs · ${where}`}
        description="One row per place. Choose whether bookings are open and which cabs customers can book. Price changes are set per service in the table below. A faded cell follows the wider place above it; change it to set this place on its own."
        footer={canEdit
          ? <SaveBar reason={reason} onReason={setReason} onSave={save} busy={busy} disabled={!pending || problems.length > 0 || !loaded || !!loadError} message={message}
              note={pending ? `${ops.length} change${ops.length === 1 ? "" : "s"} not saved yet.` : "Faded = follows the wider place. Limited = the office confirms each booking."} />
          : null}>
        {canEdit && (
          <CardBody>
            <LocationScopeSelector variant="row" label="Place to add" value={pick} onChange={setPick} locations={locations} status={locationsStatus} depth="area" pinSearch="multi"
              broad={{ state: "Choose a state", district: "Whole state", zone: "All zones", area: "All mapped areas" }} onManageLocations={onManageLocations}
              action={<Button icon="plus" onClick={addPlace} disabled={!canAdd}>{toAdd.length < 2 ? "Add location" : `Add ${toAdd.length} locations`}</Button>} />
          </CardBody>
        )}
        {loadError ? <CardBody><p className="ds-error" role="alert">Saved rules could not be loaded: {loadError} {onRetry && <button type="button" className="fm-linkbtn" onClick={onRetry}>Retry</button>}</p></CardBody>
          : !loaded ? <CardBody><p className="fm-sub" role="status">Loading saved rules…</p></CardBody>
          : <RateTable label={`Booking rules for ${where}`} disabled={!canEdit || busy} columns={columns} groups={[{ title: "", rows }]} cornerWidth={210} minWidth={500 + vehicles.length * 92} />}
        <Problems items={problems} />
      </SettingCard>
      {removing && (
        <Modal title={`Delete ${label(removing)}?`} onClose={() => !busy && setRemoving(null)} busy={busy} centered
          footer={<><Button onClick={() => setRemoving(null)} disabled={busy}>Cancel</Button><Button variant="danger" loading={busy} disabled={removeReason.trim().length < 5} onClick={() => void confirmDelete()}>Delete place</Button></>}>
          <p className="text-[12px] text-muted mb-2">Its booking status and cab settings for {where} are removed, and it follows the wider place again. Price changes and date-based rules for this place are not touched.</p>
          <label className="ds-field"><span>Reason for deleting</span><input className="ds-input" value={removeReason} maxLength={300} onChange={(e) => setRemoveReason(e.target.value)} /></label>
          {removeError && <div className="ds-error mt-2" role="alert">{removeError}</div>}
        </Modal>
      )}
    </div>
  );
}

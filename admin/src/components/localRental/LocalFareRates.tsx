import { useEffect, useMemo, useState } from "react";
import type { MasterLocation } from "../../types";
import type { Indexed, LocSel } from "../../domain/locationHierarchy";
import { cellView, inheritChain, LEVEL_LABEL, parseCell, rowStatus, sourceLabel, type CellView, type EditLevel } from "../../domain/geoFareView";
import { LOCAL_FIELDS, geoDocId, saveGeoFares, type FieldPatch, type GeoFareDoc, type LocalField, type Party } from "../../services/geoFareService";
import { CLASS_LABEL, type TariffClass } from "../../services/tariffService";
import type { VehicleCol } from "../RateTable";
import { Problems } from "../RateTable";
import { cellInput, Footer, Hint, LoadFailure, Panel, Pill, Seg } from "./ui";
import type { FeedStatus } from "../../hooks/useLocationsFeed";
import { fareTarget } from "./fareTarget";

const LABEL: Record<LocalField, string> = { minimumFare: "Minimum fare ₹", baseFare: "Base fare ₹", includedKm: "Included km", extraKmRate: "Extra ₹/km", freeWaitingMin: "Free wait min", waitingPerMin: "Waiting ₹/min" };
const NAME: Record<LocalField, string> = { minimumFare: "minimum fare", baseFare: "base fare", includedKm: "included km", extraKmRate: "extra-km rate", freeWaitingMin: "free waiting minutes", waitingPerMin: "waiting rate" };

/**
 * Local Pickup & Drop rates: the approved fields for the customer fare and, separately, the partner payout, per vehicle class, at the
 * district default, a zone override or an area override. An empty box inherits (shown in grey with its source); clearing a value saved
 * here removes the override; a typed 0 is a real value. Saved through saveGeoFares (server-validated, audited, version-checked).
 */
export default function LocalFareRates({ brand, scopeText, docs, feed, sel, index, bulkIds, vehicles, canEdit, onToast, onDirty, children }: {
  brand: string; scopeText: (target: string) => string; docs: Map<string, GeoFareDoc> | null; sel: LocSel; index: Indexed[]; bulkIds: string[];
  vehicles: VehicleCol[]; canEdit: boolean; onToast: (t: string) => void; onDirty: (dirty: boolean) => void; children?: React.ReactNode;
  /** Load state of `docs`: a failed read shows the failure with Retry and keeps Save off (typed values are kept). */
  feed: FeedStatus;
}) {
  const [level, setLevel] = useState<EditLevel>("district");
  const [party, setParty] = useState<Party>("customer");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const target = useMemo(() => fareTarget(level, sel, level === "area" ? bulkIds : [], index, brand, "local"), [level, sel, bulkIds, index, brand]);
  const sig = `${brand}|${target.ids.join(",")}`;
  // A different place / brand / level is a different form: its own values load, nothing typed for another place carries over.
  useEffect(() => { setDrafts({}); setMessage(null); }, [sig]);
  const dirtyKeys = Object.keys(drafts);
  useEffect(() => { onDirty(dirtyKeys.length > 0); }, [dirtyKeys.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const classes = useMemo(() => {
    const seen = new Map<TariffClass, string>();
    for (const v of vehicles) if (!seen.has(v.cls) || v.owner) seen.set(v.cls, v.owner ? v.name : seen.get(v.cls) ?? v.name);
    return [...seen.entries()];
  }, [vehicles]);
  const chain = target.ready ? inheritChain(brand, "local", target.keys, target.ids[0]!) : [];
  const view = (cls: TariffClass, p: Party, f: LocalField): CellView => docs ? cellView(docs, target.ids, chain, (d) => d?.classes?.[cls]?.[p]?.[f]) : { mixed: false };
  const key = (cls: TariffClass, p: Party, f: LocalField) => `${cls}|${p}|${f}`;
  const shown = (cls: TariffClass, p: Party, f: LocalField) => drafts[key(cls, p, f)] ?? (view(cls, p, f).own?.toString() ?? "");
  const edit = (cls: TariffClass, p: Party, f: LocalField, v: string) => {
    setMessage(null);
    setDrafts((d) => {
      const k = key(cls, p, f), saved = view(cls, p, f);
      const next = { ...d };
      if (!saved.mixed && v === (saved.own?.toString() ?? "")) delete next[k]; else next[k] = v;
      return next;
    });
  };

  const problems: string[] = [];
  const patch: Record<string, { customer?: FieldPatch; partner?: FieldPatch }> = {};
  for (const [k, text] of Object.entries(drafts)) {
    const [cls, p, f] = k.split("|") as [TariffClass, Party, LocalField];
    const parsed = parseCell(text);
    if (!parsed) { problems.push(`${CLASS_LABEL[cls]} ${p === "customer" ? "customer" : "partner"} ${NAME[f]}: enter zero or more, or leave it empty to inherit.`); continue; }
    ((patch[cls] ??= {})[p] ??= {})[f] = "remove" in parsed ? null : parsed.value;
  }

  const save = async () => {
    if (!(docs) || !canEdit || busy || !target.ready || !dirtyKeys.length || problems.length) return;
    if (reason.trim().length < 5) return setMessage({ ok: false, text: "Enter a reason for this change (at least 5 characters)." });
    setBusy(true); setMessage(null);
    try {
      const expected = Object.fromEntries(target.ids.map((id) => [id, docs?.get(id)?.version ?? 0]));
      await saveGeoFares({ brand, service: "local", targets: target.scopes, data: { classes: patch }, expected, reason: reason.trim() });
      setDrafts({}); setReason("");
      onToast(`Local Pickup & Drop rates saved for ${target.label}.`);
    } catch (err) {
      // The typed values stay on screen so nothing is lost.
      setMessage({ ok: false, text: err instanceof Error ? err.message : "The rates were not saved." });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Panel title="Local Pickup & Drop">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Seg label="Rate level" value={level} onChange={setLevel} options={[{ id: "district", label: "District default" }, { id: "zone", label: "Zone overrides" }, { id: "area", label: "Area overrides" }]} />
          {level === "area" && bulkIds.length > 1 && <Pill tone="mixed">Bulk edit · {bulkIds.length} areas</Pill>}
        </div>
        <div className="mb-3"><Seg label="Party" variant="outline" value={party} onChange={setParty} options={[{ id: "customer", label: "Customer fare" }, { id: "partner", label: "Partner payout" }]} /></div>
        {!docs ? (feed.error ? <LoadFailure what="Saved location rates" failure={feed} onRetry={feed.onRetry} /> : <p className="text-[13px] text-slate-500" role="status">Loading saved rates…</p>)
          : !target.ready ? <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-[13.5px] text-slate-600">{target.needs}</div>
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-separate border-spacing-y-1 text-[13.5px]" aria-label={`Local ${party === "customer" ? "customer fares" : "partner payouts"} · ${target.label}`}>
                <thead><tr className="whitespace-nowrap text-left text-[12.5px] font-semibold text-slate-700">
                  <th className="px-2 py-1.5">Vehicle</th>{LOCAL_FIELDS.map((f) => <th key={f} className="px-2 py-1.5">{LABEL[f]}</th>)}<th className="px-2 py-1.5">Rate source</th>
                </tr></thead>
                <tbody>{classes.map(([cls, vname]) => {
                  const cells = LOCAL_FIELDS.map((f) => view(cls, party, f));
                  const st = rowStatus(cells, level);
                  const firstInherited = cells.find((c) => c.own === undefined && c.inherited)?.inherited;
                  return (
                    <tr key={cls} className="bg-slate-50/60">
                      <td className="rounded-l-lg px-2 py-1 font-semibold text-slate-800">{vname}</td>
                      {LOCAL_FIELDS.map((f, n) => {
                        const c = cells[n]!;
                        const dirty = key(cls, party, f) in drafts;
                        return (
                          <td key={f} className="px-1.5 py-1">
                            <input className={`${cellInput} ${dirty ? "!border-amber-400 bg-amber-50" : ""}`} inputMode="decimal" disabled={!canEdit || busy}
                              aria-label={`${vname} ${party} ${NAME[f]}`} value={shown(cls, party, f)} onChange={(e) => edit(cls, party, f, e.target.value)}
                              placeholder={c.mixed ? "Mixed" : c.inherited ? String(c.inherited.value) : "Set"}
                              title={c.mixed ? "The selected areas hold different values. Typing a value sets it on every selected area." : c.own !== undefined ? `Set here (${LEVEL_LABEL[level]}). Clear it to inherit again.` : c.inherited ? `Inherited from ${sourceLabel(c.inherited.docId, brand)}` : "Not configured"} />
                          </td>
                        );
                      })}
                      <td className="rounded-r-lg px-2 py-1"><Pill tone={st.tone} title={firstInherited ? `Some values from ${sourceLabel(firstInherited.docId, brand)}` : undefined}>{st.text === "Inherited" && firstInherited ? sourceLabel(firstInherited.docId, brand) : st.text}</Pill></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <Hint>Area override → Zone override → District default. Grey numbers are inherited; clear a value to inherit again. A quote uses these rates only when every value resolves for both the customer and the partner.</Hint>
        </div>
        <Problems items={problems} />
      </Panel>
      {children}
      {canEdit && (
        <Footer scopeText={scopeText(target.ready ? target.label : "Choose a place")} reason={reason} onReason={setReason} onSave={save} saveLabel="Save fare rules" busy={busy}
          disabled={!(docs) || !target.ready || !dirtyKeys.length || problems.length > 0} message={message} />
      )}
    </div>
  );
}

/** Airport-type Locations records of a district (verified identity: the record itself, never a name match). */
export const airportsOf = (index: Indexed[], sel: LocSel): MasterLocation[] =>
  index.filter((x) => x.loc.type === "Airport" && x.state === sel.state && x.district.toLowerCase() === sel.district.toLowerCase()).map((x) => x.loc);
export const airportDocId = (brand: string, id: string) => geoDocId(brand, "local", `a_${id}`);

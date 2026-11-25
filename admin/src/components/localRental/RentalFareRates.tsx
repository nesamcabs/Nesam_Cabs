import { useEffect, useMemo, useState } from "react";
import type { Indexed, LocSel } from "../../domain/locationHierarchy";
import { cellView, inheritChain, LEVEL_LABEL, parseCell, rowStatus, sourceLabel, type CellView, type EditLevel } from "../../domain/geoFareView";
import { RENTAL_FIELDS, saveGeoFares, type FieldPatch, type GeoFareDoc, type RentalField } from "../../services/geoFareService";
import { CLASS_LABEL, RENTAL_HOURS, useTariff, type Tariff, type TariffClass } from "../../services/tariffService";
import type { VehicleCol } from "../RateTable";
import { Problems } from "../RateTable";
import { Modal } from "../Feedback";
import { Button } from "../ui";
import RentalPackageBuilder from "../RentalPackageBuilder";
import { cellInput, Footer, Hint, Panel, Pill, Seg } from "./ui";
import { fareTarget } from "./fareTarget";

const LABEL: Record<RentalField, string> = { customerFare: "Customer fare ₹", partnerPayout: "Partner payout ₹", includedKm: "Included km", extraKmRate: "Extra ₹/km", extraHourRate: "Extra ₹/hour" };

/**
 * The existing (brand-scoped) rental package of a class and hours, the broadest default below the location rates; disabled or
 * incomplete packages supply nothing (the server does the same: functions/src/domain/geoFares.ts resolveRental).
 */
function standardPackage(t: Tariff | null | undefined, brand: string, cls: TariffClass, h: number): Partial<Record<RentalField | "gstMode", number | string>> | null {
  const base = t?.rentalPackages?.[cls]?.packages?.[String(h)];
  const common = t?.brandOverrides?.common?.["Local Rental"]?.[cls]?.rentalPackages?.[String(h)];
  const own = brand !== "common" ? t?.brandOverrides?.[brand]?.["Local Rental"]?.[cls]?.rentalPackages?.[String(h)] : undefined;
  if (!base?.enabled) return null;
  return { ...base, ...(common ?? {}), ...(own ?? {}) } as Partial<Record<RentalField | "gstMode", number | string>>;
}

/**
 * Hourly Rental packages (1–15 hours) by location: for the chosen vehicle, every package row shows its five values together.
 * District default, zone and area overrides inherit field by field; the standard package is the broadest default. A package is
 * offered only when all five values and the GST treatment resolve. Nothing is generated or guessed: "Fill from hourly rates" uses
 * the per-hour values the admin types, exactly as in the standard fare table.
 */
export default function RentalFareRates({ brand, scopeText, docs, sel, index, bulkIds, vehicles, canEdit, onToast, onDirty, children }: {
  brand: string; scopeText: (target: string) => string; docs: Map<string, GeoFareDoc> | null; sel: LocSel; index: Indexed[]; bulkIds: string[];
  vehicles: VehicleCol[]; canEdit: boolean; onToast: (t: string) => void; onDirty: (dirty: boolean) => void; children?: React.ReactNode;
}) {
  const { tariff } = useTariff();
  const classes = useMemo(() => {
    const seen = new Map<TariffClass, string>();
    for (const v of vehicles) if (!seen.has(v.cls) || v.owner) seen.set(v.cls, v.owner ? v.name : seen.get(v.cls) ?? v.name);
    return [...seen.entries()];
  }, [vehicles]);
  const [level, setLevel] = useState<EditLevel>("district");
  const [cls, setCls] = useState<TariffClass | "">("");
  useEffect(() => { if (!cls || !classes.some(([c]) => c === cls)) setCls(classes[0]?.[0] ?? ""); }, [classes, cls]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [builderFor, setBuilderFor] = useState<TariffClass | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const target = useMemo(() => fareTarget(level, sel, level === "area" ? bulkIds : [], index, brand, "rental"), [level, sel, bulkIds, index, brand]);
  const sig = `${brand}|${target.ids.join(",")}`;
  useEffect(() => { setDrafts({}); setMessage(null); }, [sig]);
  useEffect(() => { onDirty(Object.keys(drafts).length > 0); }, [Object.keys(drafts).length]); // eslint-disable-line react-hooks/exhaustive-deps

  const chain = target.ready ? inheritChain(brand, "rental", target.keys, target.ids[0]!) : [];
  const view = (c: TariffClass, h: number, f: RentalField): CellView => {
    if (!docs) return { mixed: false };
    const std = standardPackage(tariff, brand, c, h)?.[f];
    return cellView(docs, target.ids, chain, (d) => d?.classes?.[c]?.packages?.[String(h)]?.[f], typeof std === "number" ? { value: std, docId: "package" } : undefined);
  };
  const gstView = (c: TariffClass): { own?: string; mixed: boolean; inherited?: { value: string; docId: string } } => {
    if (!docs) return { mixed: false };
    const owns = target.ids.map((id) => docs.get(id)?.classes?.[c]?.gstMode);
    const mixed = owns.some((v) => v !== owns[0]);
    let inherited: { value: string; docId: string } | undefined;
    for (const id of chain) { const v = docs.get(id)?.classes?.[c]?.gstMode; if (v) { inherited = { value: v, docId: id }; break; } }
    const std = RENTAL_HOURS.map((h) => standardPackage(tariff, brand, c, h)?.gstMode).find((m) => typeof m === "string");
    if (!inherited && typeof std === "string") inherited = { value: std, docId: "package" };
    return { own: mixed ? undefined : owns[0], mixed, inherited };
  };
  const key = (c: TariffClass, h: number, f: RentalField) => `${c}|${h}|${f}`;
  const shown = (c: TariffClass, h: number, f: RentalField) => drafts[key(c, h, f)] ?? (view(c, h, f).own?.toString() ?? "");
  const edit = (k: string, v: string, saved: string, mixed: boolean) => {
    setMessage(null);
    setDrafts((d) => { const n = { ...d }; if (!mixed && v === saved) delete n[k]; else n[k] = v; return n; });
  };

  const problems: string[] = [];
  const patch: Record<string, { gstMode?: "included" | "excluded" | null; packages?: Record<string, FieldPatch> }> = {};
  for (const [k, text] of Object.entries(drafts)) {
    const [c, h, f] = k.split("|") as [TariffClass, string, string];
    if (h === "gst") { (patch[c] ??= {}).gstMode = text === "" ? null : (text as "included" | "excluded"); continue; }
    const parsed = parseCell(text);
    if (!parsed) { problems.push(`${CLASS_LABEL[c]} ${h}-hour ${LABEL[f as RentalField]}: enter zero or more, or leave it empty to inherit.`); continue; }
    (((patch[c] ??= {}).packages ??= {})[h] ??= {})[f] = "remove" in parsed ? null : parsed.value;
  }
  const dirtyCount = Object.keys(drafts).length;

  const save = async () => {
    if (!canEdit || busy || !target.ready || !dirtyCount || problems.length) return;
    if (reason.trim().length < 5) return setMessage({ ok: false, text: "Enter a reason for this change (at least 5 characters)." });
    setBusy(true); setMessage(null);
    try {
      const expected = Object.fromEntries(target.ids.map((id) => [id, docs?.get(id)?.version ?? 0]));
      await saveGeoFares({ brand, service: "rental", targets: target.scopes, data: { classes: patch }, expected, reason: reason.trim() });
      setDrafts({}); setReason("");
      onToast(`Hourly Rental packages saved for ${target.label}.`);
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "The packages were not saved." });
    } finally { setBusy(false); }
  };

  const vname = classes.find(([c]) => c === cls)?.[1] ?? "";
  const gst = cls ? gstView(cls) : null;
  const gstKey = cls ? `${cls}|gst|mode` : "";
  const gstShown = cls ? drafts[gstKey] ?? gst?.own ?? "" : "";
  const rowSource = (cells: CellView[]) => {
    const src = cells.find((c) => c.own === undefined && c.inherited)?.inherited;
    return src ? sourceLabel(src.docId, brand) : "";
  };

  return (
    <div className="space-y-4">
      <Panel title="Hourly Rental">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Seg label="Rate level" value={level} onChange={setLevel} options={[{ id: "district", label: "District default" }, { id: "zone", label: "Zone overrides" }, { id: "area", label: "Area overrides" }]} />
          {level === "area" && bulkIds.length > 1 && <Pill tone="mixed">Bulk edit · {bulkIds.length} areas</Pill>}
        </div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 className="text-[15px] font-bold text-slate-900">Hourly packages <span className="ml-2 text-[13px] font-semibold text-[#b91c1c]">1 – 15 hour slots</span></h4>
            <p className="text-[12.5px] text-slate-600">Complete all five values to offer a package.</p>
          </div>
          {canEdit && target.ready && (
            <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">Fill from hourly rates
              <select className="ds-select w-[200px]" value="" onChange={(e) => setBuilderFor((e.target.value || null) as TariffClass | null)} aria-label="Fill from hourly rates">
                <option value="">Choose a vehicle…</option>
                {classes.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </select>
            </label>
          )}
        </div>
        {classes.length > 0 && cls && <div className="mb-3"><Seg label="Vehicle" variant="outline" value={cls} onChange={(v) => setCls(v)} options={classes.map(([c, n]) => ({ id: c, label: n }))} /></div>}
        {!docs ? <p className="text-[13px] text-slate-500" role="status">Loading saved packages…</p>
          : !target.ready ? <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-[13.5px] text-slate-600">{target.needs}</div>
          : !cls ? <Hint>No active vehicle categories. Add one in Vehicle categories.</Hint>
          : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-semibold text-slate-700">GST on {vname} packages</span>
                <select className="ds-select w-[260px]" value={gstShown} disabled={!canEdit || busy} aria-label={`${vname} package GST`}
                  onChange={(e) => edit(gstKey, e.target.value, gst?.own ?? "", !!gst?.mixed)}>
                  <option value="">{gst?.mixed ? "Mixed" : gst?.inherited ? `Inherit: ${gst.inherited.value === "included" ? "GST included" : "GST added"} (${sourceLabel(gst.inherited.docId, brand)})` : "Not set"}</option>
                  <option value="included">Fare includes GST</option>
                  <option value="excluded">GST added on top</option>
                </select>
              </div>
              <div className="max-h-[560px] overflow-auto rounded-lg">
                <table className="w-full min-w-[860px] border-separate border-spacing-y-1 text-[13.5px]" aria-label={`${vname} hourly packages · ${target.label}`}>
                  <thead className="sticky top-0 z-10 bg-white"><tr className="whitespace-nowrap text-left text-[12.5px] font-semibold text-slate-700">
                    <th className="px-2 py-1.5">Package</th>{RENTAL_FIELDS.map((f) => <th key={f} className="px-2 py-1.5">{LABEL[f]}</th>)}<th className="px-2 py-1.5">Status</th>
                  </tr></thead>
                  <tbody>{RENTAL_HOURS.map((h) => {
                    const cells = RENTAL_FIELDS.map((f) => view(cls, h, f));
                    const st = rowStatus(cells, level);
                    const src = rowSource(cells);
                    return (
                      <tr key={h} className="bg-slate-50/60">
                        <td className="whitespace-nowrap rounded-l-lg px-2 py-1 font-semibold text-slate-800">{h} hour{h > 1 ? "s" : ""}</td>
                        {RENTAL_FIELDS.map((f, n) => {
                          const c = cells[n]!, k = key(cls, h, f);
                          return (
                            <td key={f} className="px-1.5 py-1">
                              <input className={`${cellInput} ${k in drafts ? "!border-amber-400 bg-amber-50" : ""}`} inputMode="decimal" disabled={!canEdit || busy} aria-label={`${vname} ${h}-hour ${LABEL[f]}`}
                                value={shown(cls, h, f)} onChange={(e) => edit(k, e.target.value, c.own?.toString() ?? "", c.mixed)}
                                placeholder={c.mixed ? "Mixed" : c.inherited ? String(c.inherited.value) : "Set"}
                                title={c.mixed ? "The selected areas hold different values." : c.own !== undefined ? `Set here (${LEVEL_LABEL[level]}). Clear it to inherit again.` : c.inherited ? `Inherited from ${sourceLabel(c.inherited.docId, brand)}` : "Not configured"} />
                            </td>
                          );
                        })}
                        <td className="rounded-r-lg px-2 py-1"><Pill tone={st.tone}>{st.text === "Inherited" && src ? src : st.text}</Pill></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            </>
          )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <Hint>Complete all five values to offer a package. Extra kilometres and hours beyond a package are billed at its rates when the trip ends.</Hint>
          {target.ready && <span className="text-[13px] text-slate-600">Rate source: <strong className="text-slate-900">{LEVEL_LABEL[level]}</strong></span>}
        </div>
        <Problems items={problems} />
      </Panel>
      {children}
      {canEdit && (
        <Footer scopeText={scopeText(target.ready ? target.label : "Choose a place")} reason={reason} onReason={setReason} onSave={save} saveLabel="Save rental rates" busy={busy}
          disabled={!target.ready || !dirtyCount || problems.length > 0} message={message} />
      )}
      {builderFor && (
        <Modal title={`Fill packages · ${classes.find(([c]) => c === builderFor)?.[1] ?? CLASS_LABEL[builderFor]}`} onClose={() => setBuilderFor(null)} footer={<Button onClick={() => setBuilderFor(null)}>Close</Button>}>
          <RentalPackageBuilder key={builderFor} disabled={!canEdit || busy}
            onGenerate={(_rule, generated) => {
              const c = builderFor;
              setDrafts((d) => {
                const n = { ...d };
                for (const [h, row] of Object.entries(generated)) for (const f of RENTAL_FIELDS) n[key(c, Number(h), f)] = String(row[f]);
                return n;
              });
              setCls(c);
              setBuilderFor(null);
              onToast("15 packages filled in from the values you entered. Review them and save.");
            }} />
        </Modal>
      )}
    </div>
  );
}

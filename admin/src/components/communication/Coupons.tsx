import { useEffect, useMemo, useState, type FormEvent } from "react";
import { isCampaignCoupon } from "../../domain/couponWorkspace";
import type { MasterLocation, VehicleCategory } from "../../types";
import { subscribeCoupons, subscribeLocations, subscribeVehicleCategories } from "../../services/adminFirestoreService";
import {
  AUDIENCES, COUPON_SERVICES, checkCoupon, couponState, draftOf, emptyCouponDraft, generateCode, isEnabled, istAt, istInput, saveCoupon,
  setCouponActive, validateDraft, type Coupon, type CouponCheck, type CouponDraft, type CouponState,
} from "../../services/couponService";
import { normalizeCouponCode } from "../../services/couponEngine";
import { bookableCategories, newRequestId, quoteAdminBooking, type FareQuote } from "../../services/adminBookingService";
import { ActionError } from "../../services/callables";
import { useBookings } from "../../hooks/useOfficeData";
import { agreedPayoutOf, fareOf, refDate, refDateTime, refTime, rupee } from "../../domain/officeStage";
import { Modal, Toast, useToast } from "../Feedback";
import TimeSelect12 from "../TimeSelect12";
import { Badge, Button, DataTable, EmptyState, Icon, PageHeader } from "../ui";
import { TripFields, emptyTrip, estimateFacts, tripPickupDate, tripToForm, useQuickData, validateTrip, type QuickTrip } from "../booking/QuickFare";

const FILTERS = ["All", "Active", "Scheduled", "Ended", "Disabled", "Archived"] as const;
const stamp = (v: string) => (Number.isFinite(istAt(v)) ? `${refDate(new Date(istAt(v)))} · ${refTime(new Date(istAt(v)))}`.toUpperCase() : "—");

export default function CouponsPanel({ canEdit, canSeeUsage, includeLegacy = false }: { canEdit: boolean; canSeeUsage: boolean; includeLegacy?: boolean }) {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [locations, setLocations] = useState<MasterLocation[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [sheet, setSheet] = useState<{ kind: "new" | "history" } | { kind: "edit" | "test" | "state"; c: Coupon } | null>(null);
  const { toast, show } = useToast(6000);
  useEffect(() => {
    const u = [subscribeCoupons((r) => setCoupons(r as Coupon[])), subscribeVehicleCategories(setCategories), subscribeLocations(setLocations)];
    return () => u.forEach((x) => x());
  }, []);
  const cats = useMemo(() => bookableCategories(categories).sort((a, b) => (a.displayOrder ?? 99) - (b.displayOrder ?? 99)), [categories]);
  const cities = useMemo(() => [...new Set(locations.filter((l) => l.status !== "Inactive" && l.city).map((l) => l.city!))].sort(), [locations]);
  const list = coupons
    .filter((c) => isCampaignCoupon(c) || includeLegacy)
    .filter((c) => !includeLegacy || !c.adminBookingOnly)
    .filter((c) => (filter === "Archived" ? c.status === "Archived" : c.status !== "Archived" && (filter === "All" || couponState(c) === filter)) && (!q || `${c.code} ${c.name}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const catName = (id: string) => cats.find((c) => c.id === id)?.name ?? id;
  const done = (t: string) => { setSheet(null); show(t); };

  return (
    <>
      <Toast toast={toast} />
      <PageHeader title="Offers & Coupons" subtitle="Generate codes, control eligibility and review confirmed usage." actions={canEdit && <Button variant="primary" icon="plus" onClick={() => setSheet({ kind: "new" })}>Create coupon</Button>} />
      <div className="ds-note mb-4"><Icon name="badge-percent" size={15} />NESAM-funded discounts · Partner payout stays unchanged · One coupon per booking</div>
      <div className="ds-filterbar mb-3">
        <input type="search" className="ds-input" style={{ maxWidth: 260 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code or offer name" aria-label="Search coupons" />
        <select className="ds-select !w-auto" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Coupon status">{FILTERS.map((f) => <option key={f}>{f}</option>)}</select>
        <span className="ml-auto text-[12px] text-muted">{list.length} offers</span>
        {canSeeUsage && <Button variant="ghost" icon="history" onClick={() => setSheet({ kind: "history" })}>Usage history</Button>}
      </div>
      <DataTable label="Coupons" minWidth={1120} hasActions>
          <thead><tr><th>CODE / OFFER</th><th className="ds-num">DISCOUNT / MINIMUM</th><th>ELIGIBILITY</th><th>VALIDITY · IST</th><th>USED / LIMIT</th><th>STATUS</th><th className="ds-actions">ACTIONS</th></tr></thead>
          <tbody>
            {list.map((c) => {
              const d = draftOf(c, cats.map((x) => x.id));
              const state: CouponState = couponState(c);
              const services = !c.serviceNames?.length ? "All services" : c.serviceNames.join(" · ");
              const area = !c.scope || c.scope === "Any" ? "All configured areas" : `${c.city}${c.scope === "Exact route" ? ` → ${c.dropCity}` : " pickups"}`;
              return (
                <tr key={c.id}>
                  <td><strong style={{ letterSpacing: ".04em" }}>{c.code}</strong><small>{c.name}{c.sample ? " · Sample" : ""}</small><small>{c.adminBookingOnly ? "Office bookings only" : "Customer & office bookings"}</small></td>
                  <td className="ds-num"><strong>{c.discountType === "PERCENTAGE" ? `${c.discountValue}% · Max ${rupee(c.maximumDiscount || 0)}` : rupee(c.discountValue)}</strong><small>Base fare ≥ {rupee(c.minimumBookingAmount || 0)}</small></td>
                  <td>{d.audience} customers<small>{services}</small><small>{c.vehicleCategoryIds?.length ? c.vehicleCategoryIds.map(catName).join(" · ") : ""}</small><small>{area}</small></td>
                  <td className="text-[11px]">
                    <small className="ds-eyebrow" style={{ margin: 0 }}>BOOKING WINDOW</small>
                    <div>{stamp(d.bookFrom)}</div><div>TO {stamp(d.bookUntil)}</div>
                    {c.audience && <><small className="ds-eyebrow" style={{ margin: "6px 0 0" }}>PICKUP WINDOW</small><div>{stamp(d.pickupFrom)}</div><div>TO {stamp(d.pickupUntil)}</div></>}
                  </td>
                  <td><strong>{c.usedCount ?? 0} / {c.totalUsageLimit || "No limit"}</strong><small>{c.perCustomerLimit ? `${c.perCustomerLimit} per customer` : "No per-customer limit"}</small></td>
                  <td>
                    <label className="flex items-center gap-2 text-[12px]">
                      <button type="button" role="switch" aria-checked={isEnabled(c)} aria-label={`${isEnabled(c) ? "Disable" : "Enable"} ${c.code}`} disabled={!canEdit} onClick={() => setSheet({ kind: "state", c })}
                        className="relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50" style={{ background: isEnabled(c) ? "var(--color-brand)" : "#cfd6df" }}>
                        <span className="inline-block h-5 w-5 rounded-full bg-white shadow transition" style={{ transform: `translateX(${isEnabled(c) ? 22 : 2}px)` }} />
                      </button>
                      {c.status === "Archived" ? "Archived" : isEnabled(c) ? "Enabled" : "Disabled"}
                    </label>
                    {(state === "Scheduled" || state === "Ended") && <Badge tone={state === "Scheduled" ? "amber" : "neutral"}>{state}</Badge>}
                  </td>
                  <td><div className="flex gap-1">{canEdit && <Button size="sm" variant="ghost" icon="pencil" onClick={() => setSheet({ kind: "edit", c })}>Edit</Button>}<Button size="sm" icon="flask-conical" onClick={() => setSheet({ kind: "test", c })}>Test</Button></div></td>
                </tr>
              );
            })}
          </tbody>
        
      </DataTable>
      {!list.length && <EmptyState title={coupons.length ? "No matching records" : "No coupons created yet"} hint={coupons.length ? undefined : "Create a coupon to offer a NESAM-funded discount."} />}

      {canEdit && sheet?.kind === "new" && <CouponSheet coupons={coupons} cats={cats} cities={cities} onClose={() => setSheet(null)} onDone={done} />}
      {canEdit && sheet?.kind === "edit" && <CouponSheet editing={sheet.c} coupons={coupons} cats={cats} cities={cities} onClose={() => setSheet(null)} onDone={done} />}
      {canEdit && sheet?.kind === "state" && <StateSheet c={sheet.c} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "test" && <TestSheet c={sheet.c} cats={cats} onClose={() => setSheet(null)} />}
      {sheet?.kind === "history" && <UsageSheet coupons={coupons} onClose={() => setSheet(null)} />}
    </>
  );
}

/** Date + Today / Tomorrow + time, as in the reference window fields. Value: "YYYY-MM-DDTHH:mm" IST. */
function WindowField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const date = value.slice(0, 10), time = value.slice(11, 16) || "10:00";
  const day = (n: number) => istInput(Date.now() + n * 86_400_000).slice(0, 10);
  return (
    <div className="ds-field">
      <span>{label}</span>
      <input type="date" className="ds-input" aria-label={`${label} · date`} value={date} onChange={(e) => onChange(`${e.target.value}T${time}`)} />
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => onChange(`${day(0)}T${time}`)}>Today</Button>
        <Button size="sm" variant="ghost" onClick={() => onChange(`${day(1)}T${time}`)}>Tomorrow</Button>
        <TimeSelect12 label={`${label} · time`} value={time} onChange={(v) => onChange(`${date}T${v || "10:00"}`)} />
      </div>
    </div>
  );
}

function CouponSheet({ editing, coupons, cats, cities, onClose, onDone }: { editing?: Coupon; coupons: Coupon[]; cats: VehicleCategory[]; cities: string[]; onClose: () => void; onDone: (t: string) => void }) {
  const catIds = cats.map((c) => c.id);
  const [d, setD] = useState<CouponDraft>(() => (editing ? draftOf(editing, catIds) : emptyCouponDraft(catIds)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<CouponDraft>) => setD((x) => ({ ...x, ...p }));
  // Categories arrive after the sheet opens: a new coupon starts with every category selected.
  const catKey = catIds.join(",");
  useEffect(() => { if (!editing && catKey) setD((x) => (x.categories.length ? x : { ...x, categories: catKey.split(",") })); }, [catKey, editing]);
  const toggle = (k: "services" | "categories", v: string) => set({ [k]: d[k].includes(v) ? d[k].filter((x) => x !== v) : [...d[k], v] } as Partial<CouponDraft>);
  const num = (v: string) => (v === "" ? NaN : Number(v));
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const err = validateDraft(d, coupons, editing ?? null, cities, cats.length);
    if (err) return setError(err);
    setBusy(true);
    setError(null);
    try {
      await saveCoupon(d, editing ?? null, cats.map((c) => ({ id: c.id, name: c.name })));
      onDone(editing ? `${d.code.toUpperCase()} updated.` : `${d.code.toUpperCase()} created.`);
    } catch {
      setError("The coupon was not saved. Check your connection and Pricing access.");
      setBusy(false);
    }
  };
  const Step = ({ n, t }: { n: string; t: string }) => <h3 className="ds-step-title"><span className="ds-step-num">{n}</span>{t}</h3>;
  return (
    <Modal title={editing ? "Edit coupon" : "Create coupon"} onClose={onClose} busy={busy} size="lg" footer={<Button variant="primary" type="submit" form="coupon-form" loading={busy}>Save coupon</Button>}>
      <form id="coupon-form" onSubmit={save} className="grid gap-4" noValidate>
        {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
        <Step n="01" t="Code & discount" />
        <div className="flex items-end gap-2">
          <label className="ds-field flex-1"><span>Coupon code</span><input className="ds-input" maxLength={24} autoComplete="off" value={d.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} disabled={!!editing?.usedCount} /></label>
          <Button icon="sparkles" disabled={!!editing?.usedCount} onClick={() => { try { set({ code: generateCode(coupons) }); } catch (x) { setError((x as Error).message); } }}>Generate code</Button>
        </div>
        <label className="ds-field"><span>Offer name</span><input className="ds-input" value={d.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="ds-field"><span>Description</span><textarea className="ds-input" value={d.description} onChange={(e) => set({ description: e.target.value })} /></label>
        <label className="ds-field"><span>Terms & conditions</span><textarea className="ds-input" value={d.termsAndConditions} onChange={(e) => set({ termsAndConditions: e.target.value })} /></label>
        <label className="ds-check"><input type="checkbox" checked={d.adminBookingOnly} onChange={(e) => set({ adminBookingOnly: e.target.checked })} />Office bookings only</label>
        <div className="ds-form-grid">
          <label className="ds-field"><span>Discount type</span><select className="ds-select" value={d.type} onChange={(e) => set({ type: e.target.value as CouponDraft["type"] })}><option value="Amount">₹ amount</option><option value="Percent">Percentage</option></select></label>
          <label className="ds-field"><span>{d.type === "Percent" ? "Discount · %" : "Discount · ₹"}</span><input type="number" className="ds-input" min={d.type === "Percent" ? 0.01 : 1} step={d.type === "Percent" ? 0.01 : 1} value={Number.isFinite(d.value) ? d.value : ""} onChange={(e) => set({ value: num(e.target.value) })} /></label>
          {d.type === "Percent" && <label className="ds-field"><span>Maximum discount · ₹</span><input type="number" className="ds-input" min={1} step={1} value={Number.isFinite(d.max) ? d.max : ""} onChange={(e) => set({ max: num(e.target.value) })} /></label>}
          <label className="ds-field"><span>Minimum eligible base fare · ₹</span><input type="number" className="ds-input" min={0} step={1} value={Number.isFinite(d.minFare) ? d.minFare : ""} onChange={(e) => set({ minFare: num(e.target.value) })} /></label>
          <label className="ds-field"><span>Customers</span><select className="ds-select" value={d.audience} onChange={(e) => set({ audience: e.target.value as CouponDraft["audience"] })}>{AUDIENCES.map((a) => <option key={a}>{a}</option>)}</select></label>
        </div>
        <Step n="02" t="Eligibility & area" />
        <div className="ds-form-grid">
          <fieldset className="grid gap-2"><legend className="text-[11px] font-medium text-muted mb-1">Services</legend>{COUPON_SERVICES.map((s) => <label key={s} className="ds-check"><input type="checkbox" checked={d.services.includes(s)} onChange={() => toggle("services", s)} />{s}</label>)}</fieldset>
          <fieldset className="grid gap-2 content-start"><legend className="text-[11px] font-medium text-muted mb-1">Vehicle categories</legend>{cats.map((c) => <label key={c.id} className="ds-check"><input type="checkbox" checked={d.categories.includes(c.id)} onChange={() => toggle("categories", c.id)} />{c.name}</label>)}{!cats.length && <small className="text-[11px] text-muted">No active vehicle categories. The coupon applies to every category.</small>}</fieldset>
        </div>
        <div className="ds-form-grid">
          <label className="ds-field"><span>Location scope</span><select className="ds-select" value={d.scope} onChange={(e) => set({ scope: e.target.value as CouponDraft["scope"] })}><option>Any</option><option>Pickup city</option><option>Exact route</option></select></label>
          {d.scope !== "Any" && <label className="ds-field"><span>Pickup city</span><select className="ds-select" value={d.city} onChange={(e) => set({ city: e.target.value })}><option value="">Select city</option>{cities.map((c) => <option key={c}>{c}</option>)}</select></label>}
          {d.scope === "Exact route" && <label className="ds-field"><span>Drop city</span><select className="ds-select" value={d.dropCity} onChange={(e) => set({ dropCity: e.target.value })}><option value="">Select city</option>{cities.map((c) => <option key={c}>{c}</option>)}</select></label>}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <label className="ds-check"><input type="checkbox" checked={d.allowFixed} onChange={(e) => set({ allowFixed: e.target.checked })} />Allow fixed route fares</label>
          <label className="ds-check"><input type="checkbox" checked={d.allowBusiness} onChange={(e) => set({ allowBusiness: e.target.checked })} />Allow B2B bookings</label>
          <label className="ds-check"><input type="checkbox" checked={d.allowPeak} onChange={(e) => set({ allowPeak: e.target.checked })} />Allow peak-adjusted fares</label>
        </div>
        <Step n="03" t="Booking & travel windows" />
        <div className="ds-form-grid">
          <WindowField label="Bookings start · IST" value={d.bookFrom} onChange={(v) => set({ bookFrom: v })} />
          <WindowField label="Bookings end · IST" value={d.bookUntil} onChange={(v) => set({ bookUntil: v })} />
          <WindowField label="Pickup dates start · IST" value={d.pickupFrom} onChange={(v) => set({ pickupFrom: v })} />
          <WindowField label="Pickup dates end · IST" value={d.pickupUntil} onChange={(v) => set({ pickupUntil: v })} />
        </div>
        <p className="text-[11px] text-faint">Booking time and pickup time must both qualify. End times are exclusive.</p>
        <div className="ds-form-grid">
          <label className="ds-field"><span>Uses per customer</span><input type="number" className="ds-input" min={1} max={100} value={Number.isFinite(d.perCustomer) ? d.perCustomer : ""} onChange={(e) => set({ perCustomer: num(e.target.value) })} /></label>
          <label className="ds-field"><span>Total confirmed uses</span><input type="number" className="ds-input" min={1} max={1000000} value={Number.isFinite(d.totalLimit) ? d.totalLimit : ""} onChange={(e) => set({ totalLimit: num(e.target.value) })} /></label>
        </div>
        <label className="ds-check"><input type="checkbox" checked={d.active} onChange={(e) => set({ active: e.target.checked })} />Enable coupon</label>
        <label className="ds-field"><span>Reason for this change</span><input className="ds-input" maxLength={500} value={d.reason} onChange={(e) => set({ reason: e.target.value })} /></label>
        <p className="text-[11px] text-faint">Discount is rounded to whole rupees and applies to eligible base fare. Toll, parking, other actual extras and agreed partner payout are retained.</p>
      </form>
    </Modal>
  );
}

function StateSheet({ c, onClose, onDone }: { c: Coupon; onClose: () => void; onDone: (t: string) => void }) {
  const enabling = !isEnabled(c);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 5) return setError(`Record why the coupon is being ${enabling ? "enabled" : "disabled"}.`);
    setBusy(true);
    try { await setCouponActive(c, enabling, reason.trim()); onDone(`${c.code} ${enabling ? "enabled" : "disabled"}.`); }
    catch { setError("The change was not saved."); setBusy(false); }
  };
  return (
    <Modal title={enabling ? "Enable coupon?" : "Disable coupon?"} onClose={onClose} busy={busy} footer={<><Button onClick={onClose}>Cancel</Button><Button variant={enabling ? "primary" : "danger"} type="submit" form="coupon-state" loading={busy}>{enabling ? "Confirm enable" : "Confirm disable"}</Button></>}>
      <form id="coupon-state" onSubmit={save} className="grid gap-4" noValidate>
        <div className="ds-sheet-card" style={{ marginBottom: 0 }}><strong>{c.code}</strong><small className="block">Confirmed booking fares and prior usage stay saved.</small></div>
        {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
        <label className="ds-field"><span>Reason</span><input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </form>
    </Modal>
  );
}

function TestSheet({ c, cats, onClose }: { c: Coupon; cats: VehicleCategory[]; onClose: () => void }) {
  const data = useQuickData();
  const [trip, setTrip] = useState<QuickTrip>(emptyTrip);
  const [categoryId, setCategoryId] = useState(cats[0]?.id ?? "");
  const [group, setGroup] = useState<"New" | "Returning" | "Regular">("New");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ check: CouponCheck; quote: FareQuote } | null>(null);
  const run = async (e: FormEvent) => {
    e.preventDefault();
    const err = validateTrip(trip);
    if (err) return setError(err);
    if (!categoryId) return setError("Choose the car category.");
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const quote = await quoteAdminBooking(tripToForm(trip, categoryId), newRequestId());
      const f = quote.quote;
      const service = data.services.find((s) => s.id === trip.serviceId)?.name || quote.service || trip.tripType;
      const check = checkCoupon(c, {
        service, categoryId, pickupAt: tripPickupDate(trip)?.getTime() ?? Date.now(), pickupText: `${trip.pickup?.name ?? ""} ${trip.pickup?.address ?? ""}`, dropText: `${trip.drop?.name ?? ""} ${trip.drop?.address ?? ""}`,
        group, base: f.subtotal, total: f.total, taxable: f.taxableAmount || f.subtotal, peakAdjusted: f.globalAdjustment?.direction === "increase",
      });
      setResult({ check, quote });
    } catch (x) {
      setError(x instanceof ActionError ? x.message : "This trip could not be priced.");
    }
    setBusy(false);
  };
  const payout = result ? estimateFacts.partnerPayoutOf(result.quote) : null;
  return (
    <Modal title="Test coupon" onClose={onClose} busy={busy} size="xl">
      <div className="ds-sheet-card"><strong>{c.code}</strong><small className="block">Preview only · No booking or usage is recorded</small></div>
      <form onSubmit={run} className="grid gap-4" noValidate>
        {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
        <TripFields trip={trip} set={(p) => setTrip((t) => ({ ...t, ...p }))} data={data} idPrefix="coupon-test" compact />
        <div className="ds-form-grid">
          <label className="ds-field"><span>Car category</span><select className="ds-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{cats.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="ds-field"><span>Sample customer group</span><select className="ds-select" value={group} onChange={(e) => setGroup(e.target.value as typeof group)}><option>New</option><option>Returning</option><option>Regular</option></select></label>
        </div>
        <div><Button variant="primary" type="submit" icon="flask-conical" loading={busy}>Test coupon</Button></div>
      </form>
      {result && (
        <section className="ds-sheet-card mt-4" aria-live="polite" style={{ borderLeftColor: result.check.eligible ? "var(--color-ok)" : "var(--color-brand)" }}>
          <header className="flex items-center gap-2"><Icon name={result.check.eligible ? "circle-check" : "circle-alert"} /><strong>{result.check.eligible ? "Eligible" : "Not eligible"}</strong></header>
          <p className="text-[12px] text-body mt-1">{result.check.reason}</p>
          {result.check.eligible && (
            <>
              <div className="ds-kpi-grid mt-3" style={{ marginBottom: 8 }}>
                <div className="ds-kpi"><span className="ds-kpi-label">Original estimate</span><strong>{rupee(result.quote.quote.total)}</strong></div>
                <div className="ds-kpi"><span className="ds-kpi-label">Coupon discount</span><strong>−{rupee(result.check.amount)}</strong></div>
                <div className="ds-kpi"><span className="ds-kpi-label">New customer total</span><strong>{rupee(result.check.total)}</strong></div>
                {payout != null && <div className="ds-kpi"><span className="ds-kpi-label">Partner payout</span><strong>{rupee(payout)}</strong></div>}
              </div>
              <small className="text-[11px] text-muted">Same km coverage · Partner payout unchanged</small>
            </>
          )}
        </section>
      )}
    </Modal>
  );
}

function UsageSheet({ coupons, onClose }: { coupons: Coupon[]; onClose: () => void }) {
  const bookings = useBookings();
  const codes = useMemo(() => new Set(coupons.map((c) => normalizeCouponCode(c.code))), [coupons]);
  const rows = (bookings.rows ?? [])
    .filter((b) => b.couponCode && codes.has(normalizeCouponCode(String(b.couponCode))) && !["Cancelled", "Rejected"].includes(b.status))
    .sort((a, b) => String(b.createdAt?.seconds ?? 0).localeCompare(String(a.createdAt?.seconds ?? 0), undefined, { numeric: true }));
  return (
    <Modal title="Coupon usage history" onClose={onClose} size="xl">
      <div className="ds-note mb-4"><Icon name="info" size={14} />Only confirmed bookings count. Disabling an offer does not rewrite existing booking fares.</div>
      <DataTable label="Coupon usage" minWidth={860}>
          <thead><tr><th>DATE / TIME</th><th>COUPON</th><th>BOOKING / CUSTOMER ID</th><th>DISCOUNT</th><th>CUSTOMER TOTAL</th><th>PARTNER PAYOUT</th></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td>{refDateTime(b.createdAt as never)}</td>
                <td><strong>{String(b.couponCode).toUpperCase()}</strong></td>
                <td>{b.bookingId || b.id}<small>{b.customerId || "Customer record"}</small></td>
                <td>{rupee(Number(b.discount) || 0)}</td>
                <td>{rupee(fareOf(b))}</td>
                <td>{agreedPayoutOf(b) ? rupee(agreedPayoutOf(b)) : "Not agreed yet"}</td>
              </tr>
            ))}
          </tbody>
        
      </DataTable>
      {bookings.rows !== null && !rows.length && <EmptyState />}
    </Modal>
  );
}

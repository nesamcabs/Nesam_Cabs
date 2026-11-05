import DateTime12Input from "../DateTime12Input";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import type { Booking, Driver, MarketplaceTrip, Vehicle, Vendor } from "../../types";
import { Modal } from "../Feedback";
import { Button, Icon } from "../ui";
import { assignDriver, publishToMarketplace } from "../../services/bookingOpsService";
import { awardBid, rejectBid } from "../../services/marketplaceService";
import { ActionError } from "../../services/callables";
import { db } from "../../services/firebase";
import type { OfficeData } from "../../hooks/useOfficeData";
import { refDateTime, rupee, suggestedPayoutOf, tripTypeOf } from "../../domain/officeStage";
import { bookingPickupDate, isoDateIST, toDate } from "../../utils/time";

const code = (b: Booking) => b.bookingId || b.id;
const errText = (e: unknown, fallback: string) => (e instanceof ActionError || e instanceof Error ? e.message || fallback : fallback);

/** Booking summary card at the top of every duty sheet. */
export function DutyCard({ b, extra }: { b: Booking; extra?: ReactNode }) {
  const p = bookingPickupDate(b);
  return (
    <div className="ds-sheet-card">
      <span>{p ? refDateTime(p) : `${b.date} · ${b.time}`}</span>
      <strong>{b.pickup} → {b.drop}</strong>
      <small>{extra ?? `${code(b)} · ${tripTypeOf(b)} · ${b.vehicleCategory || b.vehicle}`}</small>
    </div>
  );
}

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div role="alert" className="ds-error" style={{ margin: "0 0 14px" }}>
      <Icon name="circle-alert" />
      <span>{text}</span>
    </div>
  );
}

// ── Publish duty / Edit published payout ──────────────────────────────────

const TERM_ITEMS = [
  ["driverBata", "Driver bata"],
  ["toll", "Toll"],
  ["parking", "Parking"],
  ["stateTax", "State tax"],
  ["nightAllowance", "Night allowance"],
] as const;
type TermKey = (typeof TERM_ITEMS)[number][0];
const TERM_CHOICES = ["Included", "At actuals", "Not applicable"];

interface StoredTerms {
  customerExtraKm?: number;
  partnerExtraKm?: number;
  items?: Partial<Record<TermKey, string>>;
  receiptRequired?: boolean;
}

/** Local "YYYY-MM-DDTHH:mm" (India time) for a datetime-local input. */
function localInput(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60000);
  return ist.toISOString().slice(0, 16);
}
const fromLocalInput = (v: string) => (v ? new Date(Date.parse(`${v}:00Z`) - 330 * 60000) : null);

export function PublishDutyDrawer({ booking, market, edit, canSetPayout, onClose, onDone }: {
  booking: Booking;
  market?: MarketplaceTrip;
  /** Change the payout / mode of a duty that is already published. */
  edit?: boolean;
  canSetPayout: boolean;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const stored = ((booking as { dutyTerms?: StoredTerms }).dutyTerms ?? (market as { terms?: StoredTerms } | undefined)?.terms ?? {}) as StoredTerms;
  const start = edit && market ? Number(market.offeredPayout) || 0 : suggestedPayoutOf(booking) ?? 0;
  const pickup = bookingPickupDate(booking);
  const [mode, setMode] = useState<"fixed" | "bid">(edit && market?.mode === "bid_review" ? "bid" : "fixed");
  const [amount, setAmount] = useState(start ? String(Math.round(start)) : "");
  const [maximum, setMaximum] = useState(market?.ceiling ? String(market.ceiling) : start ? String(Math.ceil(start * 1.2)) : "");
  const [closes, setCloses] = useState(pickup ? localInput(new Date(Math.max(Date.now(), pickup.getTime() - 3 * 3600000))) : "");
  const [note, setNote] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [custKm, setCustKm] = useState(String(stored.customerExtraKm ?? (booking.pricing?.extraKmRatePaise ? booking.pricing.extraKmRatePaise / 100 : "")));
  const [partKm, setPartKm] = useState(String(stored.partnerExtraKm ?? ""));
  const [items, setItems] = useState<Record<TermKey, string>>(() => Object.fromEntries(TERM_ITEMS.map(([k]) => [k, stored.items?.[k] ?? (k === "driverBata" ? "Included" : "At actuals")])) as Record<TermKey, string>);
  const [receipt, setReceipt] = useState(stored.receiptRequired !== false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startNum = Number(amount) || 0;
  const step = Math.round(startNum * 0.05);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!(startNum > 0) || startNum > 1000000) return setError("Enter a valid vendor payout.");
    if (mode === "bid" && !(Number(maximum) >= startNum)) return setError("Maximum payout must be at least the starting payout.");
    if (edit && note.trim().length < 5) return setError("Record the reason for changing a published payout.");
    if (!reviewed) return setError("Review the payout details and tick the confirmation.");
    if (!(Number(custKm) > 0) || !(Number(partKm) > 0)) return setError("Enter separate positive customer and partner extra-km rates.");
    const closeAt = fromLocalInput(closes);
    const cutoffMinutes = mode === "bid" && closeAt && pickup ? Math.max(0, Math.round((pickup.getTime() - closeAt.getTime()) / 60000)) : undefined;
    // Without finance access the payout comes from the tariff / commission policy.
    const manual = canSetPayout && Math.round(startNum) !== Math.round(start) ? Math.round(startNum) : canSetPayout && edit ? Math.round(startNum) : undefined;
    setBusy(true);
    setError(null);
    try {
      const r = await publishToMarketplace(booking.id, manual, {
        mode: mode === "bid" ? "bid_review" : "accept_offer",
        ...(mode === "bid" ? { escalation: { enabled: true, ceiling: Number(maximum), stepPercent: 5, intervalMinutes: 60 } } : {}),
        ...(cutoffMinutes !== undefined ? { cutoffMinutes } : {}),
        terms: { customerExtraKm: Number(custKm), partnerExtraKm: Number(partKm), items, receiptRequired: receipt },
        note: note.trim(),
      });
      onDone(edit ? "Duty published / payout updated. Matching authorised bids allocate automatically." : `Duty published at ${rupee(r.offeredPayout)}. ${r.partnersNotified} partner${r.partnersNotified === 1 ? "" : "s"} notified.`);
    } catch (err) {
      setError(errText(err, "The duty was not published."));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={edit ? "Edit published payout" : "Publish duty"}
      onClose={onClose}
      busy={busy}
      footNote="Customer fare stays unchanged"
      footer={<Button variant="primary" icon="send" type="submit" form="publish-duty-form" loading={busy}>{edit ? "Save payout" : "Publish duty"}</Button>}
    >
      <form id="publish-duty-form" onSubmit={submit} noValidate>
        <ErrorLine text={error} />
        <DutyCard b={booking} extra={<>{code(booking)} · {tripTypeOf(booking)} · {booking.vehicleCategory || booking.vehicle}<br />Customer {booking.customer || "Not supplied"} · {booking.phone || "Not supplied"}</>} />
        <div className="ds-seg mb-4" role="group" aria-label="Publication mode">
          <button type="button" aria-pressed={mode === "fixed"} onClick={() => setMode("fixed")}>{mode === "fixed" && <Icon name="check" size={14} />}Fixed payout</button>
          <button type="button" aria-pressed={mode === "bid"} onClick={() => setMode("bid")}><Icon name="chart-no-axes-combined" size={14} />Bidding</button>
        </div>
        {mode === "fixed" ? (
          <>
            <label className="ds-field mb-3">
              <span>Vendor payout · ₹</span>
              <input className="ds-input" type="number" min={1} max={1000000} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!canSetPayout} style={{ fontSize: 17, fontWeight: 600, minHeight: 48 }} />
            </label>
            <p className="ds-note mb-4">
              Preset partner payout is loaded from this booking’s saved tariff. Driver / vehicle assignment follows partner acceptance.
              {!canSetPayout && " Changing the payout needs finance access."}
            </p>
          </>
        ) : (
          <>
            <div className="ds-form-grid mb-3">
              <label className="ds-field"><span>Starting payout · ₹</span><input className="ds-input" type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!canSetPayout} /></label>
              <label className="ds-field"><span>Maximum payout · ₹</span><input className="ds-input" type="number" min={1} step={1} value={maximum} onChange={(e) => setMaximum(e.target.value)} /></label>
            </div>
            <p className="ds-note mb-3">
              <strong>Every 1 hour · +5% of starting payout</strong>
              <br />
              Hourly increment: {rupee(step)}. Stops at the maximum or when the duty is accepted.
            </p>
            <label className="ds-field mb-1">
              <span>Bidding closes · IST</span>
              <DateTime12Input value={closes} onChange={setCloses} />
            </label>
            <div className="flex gap-3 mb-3 text-[11px]">
              <button type="button" className="ds-link" onClick={() => setCloses(localInput(new Date(Date.parse(`${isoDateIST(new Date())}T${closes.slice(11) || "08:00"}:00Z`) - 330 * 60000)))}>Today</button>
              <button type="button" className="ds-link" onClick={() => setCloses(localInput(new Date(Date.parse(`${isoDateIST(new Date(Date.now() + 86400000))}T${closes.slice(11) || "08:00"}:00Z`) - 330 * 60000)))}>Tomorrow</button>
            </div>
            <p className="ds-note mb-4">Valid authorised bids auto allocate at the earliest matching payout. Customer fare is unchanged.</p>
          </>
        )}
        <label className="ds-field mb-3">
          <span>{edit ? "Reason for payout change" : "Office note · optional"}</span>
          <input className="ds-input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="ds-check mb-2">
          <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
          I reviewed the payout and publication details.
        </label>
        <details className="ds-disclosure" open>
          <summary>Agreed expense &amp; extra-km terms</summary>
          <div className="ds-form-grid">
            <label className="ds-field"><span>Customer extra km · ₹ / km</span><input className="ds-input" type="number" min={1} value={custKm} onChange={(e) => setCustKm(e.target.value)} /></label>
            <label className="ds-field"><span>Partner extra km · ₹ / km</span><input className="ds-input" type="number" min={1} value={partKm} onChange={(e) => setPartKm(e.target.value)} /></label>
          </div>
        </details>
        <details className="ds-disclosure" open>
          <summary>Included / Extra terms</summary>
          <div className="ds-form-grid">
            {TERM_ITEMS.map(([k, label]) => (
              <label key={k} className="ds-field">
                <span>{label}</span>
                <select className="ds-select" value={items[k]} onChange={(e) => setItems({ ...items, [k]: e.target.value })}>
                  {TERM_CHOICES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
            ))}
          </div>
          <label className="ds-check mt-3">
            <input type="checkbox" checked={receipt} onChange={(e) => setReceipt(e.target.checked)} />
            Receipt required for actual expenses
          </label>
          <p className="text-[11px] text-faint mt-2">Saved with the duty. These rates and terms are frozen when a partner accepts.</p>
        </details>
      </form>
    </Modal>
  );
}

// ── Published duty (Manage) ───────────────────────────────────────────────

interface Bid {
  id: string;
  vendorId?: string;
  vendorName?: string;
  driverId?: string;
  driverName?: string;
  amount?: number | string;
  status?: string;
  createdAt?: unknown;
  validUntil?: unknown;
}

export function PublishedDutyDrawer({ booking, market, onClose, onEditPayout, onAllocate, onDone }: {
  booking: Booking;
  market?: MarketplaceTrip;
  onClose: () => void;
  onEditPayout: () => void;
  onAllocate: () => void;
  onDone: (text: string) => void;
}) {
  const [bids, setBids] = useState<Bid[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const q = query(collection(db, "marketplace_trips", booking.id, "bids"), orderBy("createdAt", "asc"));
    return onSnapshot(q, (s) => setBids(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Bid, "id">) }))), () => setBids([]));
  }, [booking.id]);
  const offer = Number(market?.offeredPayout) || 0;
  const bidding = market?.mode === "bid_review" || Boolean(market?.escalation?.enabled);
  const max = market?.ceiling ?? (market?.escalation?.ceilingPaise ? market.escalation.ceilingPaise / 100 : undefined);
  const nextAt = toDate((market as { nextEscalationAt?: never } | undefined)?.nextEscalationAt);
  const act = async (id: string, kind: "award" | "reject") => {
    setBusy(id);
    setError(null);
    try {
      if (kind === "award") await awardBid(booking.id, id);
      else await rejectBid(booking.id, id);
      onDone(kind === "award" ? "Duty allocated at the matched payout." : "Bid declined.");
    } catch (e) {
      setError(errText(e, "The bid was not updated."));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal title="Published duty" onClose={onClose} busy={!!busy}>
      <ErrorLine text={error} />
      <DutyCard b={booking} extra={`${code(booking)} · ${booking.vehicleCategory || booking.vehicle}`} />
      <dl className="ds-facts mb-4" data-cols={3}>
        <div><dt>Current payout</dt><dd>{rupee(offer)}</dd></div>
        <div><dt>Maximum</dt><dd>{bidding && max ? rupee(max) : "Fixed"}</dd></div>
        <div><dt>Next increase</dt><dd>{market?.escalation?.enabled ? (nextAt ? refDateTime(nextAt) : "Within the hour") : "Not scheduled"}</dd></div>
      </dl>
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <span className="ds-badge" data-tone={bidding ? "amber" : "blue"}>{bidding ? "Bidding" : "Fixed payout"}</span>
        <Button size="sm" icon="pencil" onClick={onEditPayout}>Edit payout</Button>
        <Button size="sm" icon="user-round-check" onClick={onAllocate}>Office allocation</Button>
      </div>
      {bids === null ? (
        <p className="text-[12px] text-muted">Loading bids…</p>
      ) : bids.length === 0 ? (
        <p className="ds-note">No bids received. Bids and their submission times appear here.</p>
      ) : (
        <ol className="grid gap-3">
          {bids.map((bid, i) => (
            <li key={bid.id} className="ds-panel ds-panel-pad">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <strong className="text-[13px] text-ink">{i + 1}. {bid.vendorName || bid.driverName || "Partner"}</strong>
                  <div className="text-[11px] text-faint">{bid.vendorId || bid.driverId} · {bid.id}</div>
                </div>
                <div className="text-right">
                  <strong className="text-[15px] text-ink">{rupee(Number(bid.amount) || 0)}</strong>
                  <div className="text-[11px] text-faint">Expected payout</div>
                </div>
              </div>
              <div className="text-[11px] text-muted mt-2">
                {bid.status === "Pending Review" ? "Waiting for match" : bid.status} · Bid {refDateTime(bid.createdAt as never) || "time not recorded"}
                {bid.validUntil ? ` · Valid until ${refDateTime(bid.validUntil as never)}` : ""}
              </div>
              {bid.status === "Pending Review" && (
                <div className="flex gap-2 mt-3">
                  <Button size="sm" variant="primary" loading={busy === bid.id} onClick={() => act(bid.id, "award")}>Allocate at this payout</Button>
                  <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => act(bid.id, "reject")}>Decline</Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="text-[11px] text-faint mt-4">Payout steps</p>
      <p className="text-[12px] text-body">{rupee(Number(market?.startOffer ?? offer))} · {refDateTime((market as { publishedAt?: never } | undefined)?.publishedAt) || "—"} · Published</p>
    </Modal>
  );
}

// ── Assign on behalf (vendor → driver → vehicle → confirm) ────────────────

function driverBlock(d: Driver): string | null {
  const s = String(d.status || "");
  if (/reject/i.test(s)) return "Approval rejected";
  if (/suspend/i.test(s) || d.fleetStatus === "Suspended") return "ID suspended · office email verification and reactivation required";
  if (/inactive|deactiv/i.test(s) || d.fleetStatus === "Inactive") return "Vendor Drivers ID inactive";
  if (!/approved|active/i.test(s)) return "Driver document / verification hold";
  if (d.docStatus && !/verified|approved/i.test(d.docStatus)) return "Driver document / verification hold";
  return null;
}

function vehicleBlock(v: Vehicle, b: Booking): string | null {
  const need = (b.vehicleCategory || b.vehicle || "").toLowerCase();
  const has = (v.category || "").toLowerCase();
  if (need && has && need !== has) return `${b.vehicleCategory || b.vehicle} required`;
  const end = bookingPickupDate(b)?.getTime() ?? Date.now();
  const expiries = [v.insuranceExpiry, v.fitnessExpiry, v.permitExpiry].map((x) => (x ? Date.parse(x) : NaN)).filter((x) => Number.isFinite(x));
  if (expiries.some((x) => x < end + 86400000)) return "Document expires before trip ends";
  if (v.docStatus && !/verified|approved/i.test(v.docStatus)) return "Document renewal required";
  if (["Inactive", "Maintenance"].includes(v.status || "")) return "Vehicle not in service";
  return null;
}

export function AssignOnBehalfDrawer({ booking, data, agreedPayout, onClose, onDone }: {
  booking: Booking;
  data: OfficeData;
  /** Payout shown on the confirmation step. */
  agreedPayout: number | null;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const vendorFixed = booking.assignedVendorId || "";
  const [vendorId, setVendorId] = useState(vendorFixed);
  const [driverId, setDriverId] = useState(booking.assignedDriverId || "");
  const [vehicleId, setVehicleId] = useState(booking.assignedVehicleId || "");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [reference, setReference] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vendors = useMemo(() => data.vendors.filter((v) => /approved|active/i.test(String(v.status))).sort((a, b) => (a.companyName || a.name || "").localeCompare(b.companyName || b.name || "")), [data.vendors]);
  const vendor: Vendor | undefined = data.vendorById.get(vendorId);
  const drivers = useMemo(() => data.drivers.filter((d) => (d.vendorId || "") === vendorId && vendorId), [data.drivers, vendorId]);
  const vehicles = useMemo(() => data.vehicles.filter((v) => (v.vendorId || "") === vendorId && vendorId), [data.vehicles, vendorId]);
  const driver = data.driverById.get(driverId);
  const vehicle = data.vehicleById.get(vehicleId);
  const licence = (d?: Driver) => d?.licenseNumber || d?.license || d?.phone || "";

  const next = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (step === 1) {
      if (!vendorId || !driverId) return setError("Choose vendor and driver.");
      const why = driver ? driverBlock(driver) : "Choose vendor and driver.";
      if (why) return setError(why);
      return setStep(2);
    }
    if (step === 2) {
      if (!vehicleId) return setError("Choose a vehicle.");
      const why = vehicle ? vehicleBlock(vehicle, booking) : "Choose a vehicle.";
      if (why) return setError(why);
      return setStep(3);
    }
    if (reference.trim().length < 3) return setError("Record the vendor request / call reference.");
    if (!checked) return setError("Review the payout details and tick the confirmation.");
    setBusy(true);
    try {
      await assignDriver({ bookingId: booking.id, driverId, vehicleId, reason: `Assigned on behalf of ${vendor?.companyName || vendor?.name || "vendor"} · ${reference.trim()}` });
      onDone(`${driver?.name || "Driver"} and ${vehicle?.vehicleNumber || "vehicle"} confirmed for ${code(booking)}.`);
    } catch (err) {
      setError(errText(err, "The assignment was not confirmed."));
      setBusy(false);
    }
  };

  const stepper = (
    <div className="ds-steps" aria-label="Steps">
      {(["Driver", "Vehicle", "Confirm"] as const).map((s, i) => (
        <span key={s} data-on={step === i + 1 ? "true" : undefined} data-done={step > i + 1 ? "true" : undefined}><b>{i + 1}</b>{s}</span>
      ))}
    </div>
  );

  return (
    <Modal
      title="Assign on behalf"
      onClose={onClose}
      busy={busy}
      footNote={step === 1 ? "Office assistance" : undefined}
      footer={
        <>
          {step > 1 && <Button onClick={() => { setError(null); setStep((step - 1) as 1 | 2); }} disabled={busy}>Back</Button>}
          <Button variant="primary" icon="arrow-right" type="submit" form="assign-behalf-form" loading={busy}>
            {step === 1 ? "Continue to vehicle" : step === 2 ? "Review assignment" : "Confirm assignment"}
          </Button>
        </>
      }
    >
      <form id="assign-behalf-form" onSubmit={next} noValidate>
        <ErrorLine text={error} />
        {stepper}
        <DutyCard b={booking} extra={`${code(booking)} · ${booking.vehicleCategory || booking.vehicle} · ${rupee(agreedPayout)}`} />
        {step === 1 && (
          <>
            {vendorFixed ? (
              <div className="ds-note mb-4"><span className="block text-[11px] text-muted">Accepted vendor</span><strong>{vendor?.companyName || vendor?.name || booking.assignedVendorName} · {vendorFixed.slice(0, 12)}</strong></div>
            ) : (
              <label className="ds-field mb-4">
                <span>Vendor</span>
                <select className="ds-select" value={vendorId} onChange={(e) => { setVendorId(e.target.value); setDriverId(""); setVehicleId(""); }}>
                  <option value="">Choose vendor</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.companyName || v.name} · {v.id.slice(0, 12)}</option>)}
                </select>
              </label>
            )}
            <label className="ds-field mb-3">
              <span>Driver</span>
              <select className="ds-select" value={driverId} onChange={(e) => { setDriverId(e.target.value); setVehicleId(data.driverById.get(e.target.value)?.assignedVehicleId || ""); }}>
                <option value="">Choose driver</option>
                {drivers.map((d) => {
                  const why = driverBlock(d);
                  return <option key={d.id} value={d.id} disabled={!!why}>{d.name} · {licence(d)}{why ? ` — ${why}` : ""}</option>;
                })}
              </select>
            </label>
          </>
        )}
        {step === 2 && (
          <label className="ds-field mb-3">
            <span>Vehicle</span>
            <select className="ds-select" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Choose vehicle</option>
              {vehicles.map((v) => {
                const why = vehicleBlock(v, booking);
                return <option key={v.id} value={v.id} disabled={!!why}>{v.vehicleNumber || v.number} · {v.model || v.category}{why ? ` — ${why}` : ""}</option>;
              })}
            </select>
          </label>
        )}
        {step === 3 && (
          <>
            <dl className="ds-facts mb-4" data-cols={2}>
              <div><dt>Vendor</dt><dd>{vendor?.companyName || vendor?.name} · {vendorId.slice(0, 12)}</dd></div>
              <div><dt>Driver</dt><dd>{driver?.name} · {licence(driver)}</dd></div>
              <div><dt>Vehicle</dt><dd>{vehicle?.vehicleNumber || vehicle?.number} · {vehicle?.model || vehicle?.category}</dd></div>
              <div><dt>Agreed payout</dt><dd>{rupee(agreedPayout)}</dd></div>
            </dl>
            <div className="ds-note mb-4">
              <strong>Terms &amp; penalty</strong>
              <br />
              Toll, parking and state tax are extra at actuals unless the duty terms say otherwise. Missed-assignment penalties follow the commission policy. Only this confirmed driver and vehicle can operate the duty.
            </div>
            <label className="ds-field mb-3">
              <span>Vendor request / call reference</span>
              <input className="ds-input" maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
            <label className="ds-check">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              I checked driver, vehicle, agreed payout, terms and penalty details.
            </label>
          </>
        )}
        <p className="text-[11px] text-faint mt-4">Linked, verified IDs only. Documents and schedule overlap are checked at final confirmation.</p>
      </form>
    </Modal>
  );
}

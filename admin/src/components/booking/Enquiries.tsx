import DateTime12Input from "../DateTime12Input";
import { categoryTitle } from "../../domain/categoryLabel";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Modal, Toast, useToast } from "../Feedback";
import { Badge, Button, EmptyState, Icon, PageHeader, toneForStatus } from "../ui";
import { StageBar } from "../ui/ListKit";
import { OFFICE_STAGES, refDateTime, rupee, type OfficeStage } from "../../domain/officeStage";
import {
  ENQUIRY_STATUSES, assignEnquiryHandler, currentStaff, effectiveStatus, markEnquirySent, subscribeEnquiries, updateEnquiryStatus,
  type Enquiry, type EnquiryStatus,
  isMulticityEnquiry, priceMulticityEnquiry, convertMulticityEnquiry, type MulticityQuoteResult,
} from "../../services/enquiryService";
import { subscribeLocations, subscribeVehicleCategories } from "../../services/adminFirestoreService";
import { ActionError } from "../../services/callables";
import type { MasterLocation, VehicleCategory } from "../../types";
import { useCanDo } from "../AccessContext";
import { subscribeStaffAccounts } from "../../services/staffService";

const SUPPORT_LINE = "+91 9025099990";

/** Copy-ready customer quote (no message is sent automatically). */
export function quoteText(e: Enquiry): string {
  const brandTitle = e.brand === "onewaycarrentals" ? "ONE WAY CAR RENTALS" : e.brand === "people_taxi" ? "PEOPLE TAXI" : "NESAM TOURS & TRAVELS";
  const stopsText = e.stops && e.stops.length > 0 ? `Via: ${e.stops.map((s) => s.name).join(" → ")}` : "";
  return [
    `${brandTitle} — Quote ${e.code}`,
    `${e.pickup} → ${e.drop}`,
    stopsText,
    e.pickupAt ? refDateTime(e.pickupAt) : "",
    `${e.tripType || "One Way"} · ${e.vehicle || ""}`,
    `Estimated total: ${rupee(e.estimate ?? null)}`,
    e.includedKm ? `${e.includedKm} km included` : "",
    e.extraKmRate ? `Extra km: ${rupee(e.extraKmRate)}` : "",
    "Toll, parking and state tax: extra",
    e.validUntil ? `Valid until: ${refDateTime(e.validUntil)}` : "",
    `Support: ${SUPPORT_LINE}`,
  ].filter(Boolean).join("\n");
}

export default function Enquiries({ stageCounts, onStage, onBack, onNewBooking, onConvert }: {
  stageCounts: Record<OfficeStage, number>;
  onStage: (s: OfficeStage) => void;
  onBack: () => void;
  onNewBooking: () => void;
  /** Opens the New booking flow prefilled from the quote. */
  onConvert?: (e: Enquiry) => void;
}) {
  const [rows, setRows] = useState<Enquiry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"All" | EnquiryStatus>("All");
  const [openId, setOpenId] = useState<string | null>(null);
  const [statusFor, setStatusFor] = useState<Enquiry | null>(null);
  const [handlerFor, setHandlerFor] = useState<Enquiry | null>(null);
  const { toast, show } = useToast(6000);

  useEffect(() => subscribeEnquiries(setRows, setError), []);

  const list = useMemo(() => {
    const all = (rows ?? []).map((e) => ({ e, s: effectiveStatus(e) }));
    return all
      .filter((x) => filter === "All" || x.s === filter)
      .sort((a, b) => (b.e.createdAt?.toMillis?.() ?? 0) - (a.e.createdAt?.toMillis?.() ?? 0));
  }, [rows, filter]);

  const open = rows?.find((r) => r.id === openId) ?? null;

  if (open) {
    return (
      <>
        <Toast toast={toast} />
        <QuoteDetails
          e={open}
          onBack={() => setOpenId(null)}
          onConvert={() => (onConvert ? onConvert(open) : onNewBooking())}
          onCopy={async () => {
            try {
              await navigator.clipboard.writeText(quoteText(open));
              show("Quote copied. Paste it into WhatsApp or SMS after checking the details.");
            } catch {
              show("Copy was blocked by the browser. Select the quote text and copy it manually.", "error");
            }
          }}
          onSent={async () => {
            try {
              await markEnquirySent(open.id);
              show("Quote marked as sent.");
            } catch {
              show("The quote was not updated.", "error");
            }
          }}
          onHandler={() => setHandlerFor(open)}
        />
        {handlerFor && <HandlerDialog e={handlerFor} onClose={() => setHandlerFor(null)} onSaved={() => { setHandlerFor(null); show("Handling staff updated."); }} />}
      </>
    );
  }

  return (
    <>
      <Toast toast={toast} />
      <PageHeader
        eyebrow="NESAM OPERATIONS"
        title="Enquiries & follow-ups"
        subtitle="Save the route first. Collect only the contact needed for the next step."
        actions={<Button variant="primary" icon="calculator" onClick={onNewBooking}>Quick fare</Button>}
      />
      <StageBar
        label="Booking status"
        tabs={OFFICE_STAGES.map((s) => ({ id: s, label: s, count: stageCounts[s] }))}
        value={"" as OfficeStage}
        onChange={onStage}
        aside={<Button variant="secondary" size="sm" icon="phone-forwarded" aria-pressed onClick={onBack}>Enquiries &amp; quotes</Button>}
      />
      <div className="ds-chip-row" role="tablist" aria-label="Enquiry status">
        {(["All", ...ENQUIRY_STATUSES] as const).map((s) => (
          <Button key={s} size="sm" role="tab" aria-selected={filter === s} variant={filter === s ? "primary" : "secondary"} onClick={() => setFilter(s)}>{s}</Button>
        ))}
      </div>
      {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
      {rows !== null && list.length === 0 && (
        <div className="ds-panel"><EmptyState title="No enquiries in this view" hint="Save an estimate for follow-up." /></div>
      )}
      <ul className="grid gap-3">
        {list.map(({ e, s }) => (
          <li key={e.id} className="ds-panel ds-panel-pad">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-faint">
                  <span>{e.code}</span>
                  {e.brand && (
                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-700 font-medium">
                      {e.brand === "onewaycarrentals" ? "One Way Car Rentals" : e.brand === "people_taxi" ? "People Taxi" : "NESAM"}
                    </span>
                  )}
                </div>
                <strong className="block text-[15px] text-ink mt-1">{e.pickup} → {e.drop}</strong>
                {e.stops && e.stops.length > 0 ? (
                  <p className="text-[11px] text-brand font-medium mt-0.5">Via: {e.stops.map((st) => st.name).join(" → ")}</p>
                ) : null}
                <p className="text-[12px] text-muted mt-1">{e.pickupAt ? refDateTime(e.pickupAt) : "Pickup not set"} · {e.vehicle || "Vehicle not chosen"}</p>
                <p className="text-[12px] text-body mt-1">{e.customerName || "Enquiry customer"} {e.phone ? `+91 ${e.phone.replace(/^\+91/, "")}` : ""}</p>
              </div>
              <div className="text-right">
                <Badge tone={toneForStatus(s)}>{s}</Badge>
                <strong className="block text-[16px] text-ink mt-2">{rupee(e.estimate ?? null)}</strong>
                <span className="block text-[11px] text-faint mt-1">Follow up {e.followUpAt ? refDateTime(e.followUpAt) : "not set"}</span>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" onClick={() => setOpenId(e.id)}>Open enquiry</Button>
              <Button size="sm" variant="ghost" onClick={() => setStatusFor(e)}>Update status</Button>
            </div>
          </li>
        ))}
      </ul>
      {statusFor && <StatusDialog e={statusFor} onClose={() => setStatusFor(null)} onSaved={() => { setStatusFor(null); show("Enquiry status saved."); }} />}
    </>
  );
}

function QuoteDetails({ e, onBack, onConvert, onCopy, onSent, onHandler }: { e: Enquiry; onBack: () => void; onConvert: () => void; onCopy: () => void; onSent: () => void; onHandler: () => void }) {
  const status = effectiveStatus(e);
  const [convertOpen, setConvertOpen] = useState(false);
  const canCreate = useCanDo('Bookings', 'create');
  const isMulticity = isMulticityEnquiry(e);
  const convertReason = !canCreate ? 'Booking creation permission is required.' : status === 'Converted' ? `Converted to ${e.convertedBookingId || 'a booking'}.`
    : ['Closed', 'Expired'].includes(status) ? 'Save a fresh, active quote before conversion.' : isMulticity && !e.quoteRevision ? 'Calculate and save a fresh Multicity quote first.' : undefined;
  const fact = (k: string, v: string) => (
    <div><dt>{k}</dt><dd>{v}</dd></div>
  );
  return (
    <>
      <PageHeader
        eyebrow="NESAM OPERATIONS"
        title="Quote details"
        subtitle={e.code}
        actions={<Button icon="arrow-left" onClick={onBack}>Back to enquiries</Button>}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-5 content-start">
          <section className="ds-panel ds-panel-pad">
            <div className="flex items-center gap-2 mb-2">
              <Badge tone={status === "Converted" ? "green" : status === "Expired" || status === "Closed" ? "red" : "blue"}>{status === "New" || status === "Draft" ? "Saved" : status}</Badge>
              <span className="text-[11px] text-faint">Created {e.createdAt ? refDateTime(e.createdAt) : "just now"}</span>
            </div>
            <h2 className="text-[18px] font-bold text-ink">{e.pickup} → {e.drop}</h2>
            <p className="text-[12px] text-muted mt-1">{e.pickupAt ? refDateTime(e.pickupAt) : "Pickup not set"} · {e.tripType || "One Way"} · {e.vehicle || "—"}</p>
            {e.stops && e.stops.length > 0 && (
              <div className="mt-3 p-3 bg-sunken rounded border border-line">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-muted mb-2">Multicity Itinerary ({e.stops.length} intermediate stops)</span>
                <ol className="list-decimal list-inside text-[13px] text-ink grid gap-1">
                  <li><strong>Start:</strong> {e.pickup}</li>
                  {e.stops.map((s, idx) => (
                    <li key={s.id || idx}><strong>Stop {idx + 1}:</strong> {s.name} {s.address && s.address !== s.name ? <span className="text-[11px] text-muted">({s.address})</span> : null}</li>
                  ))}
                  <li><strong>Destination:</strong> {e.drop}</li>
                </ol>
                {e.tripEndAt && <p className="text-[11px] text-muted mt-2">Expected tour end: {refDateTime(e.tripEndAt)}</p>}
              </div>
            )}
            <dl className="ds-facts mt-3" data-cols={3}>
              {fact("Customer", `${e.customerName || "Enquiry customer"} · ${e.phone ? `+91 ${e.phone.replace(/^\+91/, "")}` : "+91"}`)}
              {fact("WhatsApp", e.whatsapp || (e.phone ? `+91 ${e.phone.replace(/^\+91/, "")}` : "+91"))}
              {fact("Quote valid until", e.validUntil ? refDateTime(e.validUntil) : "Not set")}
              {fact("Follow-up", e.followUpAt ? refDateTime(e.followUpAt) : "Not set")}
              {e.brand ? fact("Brand", e.brand === "onewaycarrentals" ? "One Way Car Rentals" : e.brand === "people_taxi" ? "People Taxi" : "NESAM") : null}
              {fact("Source", e.source || "Phone")}
              {e.sentAt ? fact("Quote sent", refDateTime(e.sentAt)) : null}
            </dl>
            <div className="flex flex-wrap gap-2 mt-4">
              <Button variant="primary" icon="calendar-check-2" onClick={() => isMulticity ? setConvertOpen(true) : onConvert()} disabledReason={convertReason}>Convert to booking</Button>
              <Button icon="copy" onClick={onCopy}>Copy quote</Button>
              <Button variant="ghost" icon="send" onClick={onSent} disabledReason={['Converted', 'Closed', 'Expired'].includes(status) ? 'This enquiry is closed or expired.' : !(Number(e.estimate) > 0) || (isMulticity && !e.quoteRevision) ? 'Save a priced quote first.' : undefined}>Mark as sent</Button>
            </div>
          </section>
          {isMulticityEnquiry(e) && status !== "Converted" && status !== "Closed" ? <MulticityPricer e={e} /> : null}
          <section className="ds-panel ds-panel-pad">
            <h3 className="text-[15px] font-bold text-ink">Customer quote</h3>
            <p className="text-[12px] text-muted mb-3">Copy this after confirming the details. No message is sent automatically.</p>
            <pre className="ds-note whitespace-pre-wrap" style={{ fontFamily: "inherit" }}>{quoteText(e)}</pre>
          </section>
        </div>
        <div className="grid gap-5 content-start">
          <FareBreakupCard vehicle={e.vehicle} lines={(e.breakup ?? []).filter((l) => !/^GST /.test(l.label))} total={e.estimate ?? 0} gstRate={e.gstRate ?? 0} gstAmount={e.breakup?.find((l) => /^GST /.test(l.label))?.amount} extraKm={e.extraKmRate} payout={e.payout ?? null} priceEntered={e.gstIncluded ? "Including GST" : "Excluding GST"} />
          <section className="ds-panel ds-panel-pad">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[14px] font-bold text-ink">Handling staff</h3>
              <Button size="sm" icon="user-round-check" onClick={onHandler}>Assign handling staff</Button>
            </div>
            <dl className="ds-facts" data-cols={1}>
              {fact("Responsible staff", e.handler?.name || "Not assigned")}
              {fact("Next action", e.nextAction || "Not recorded")}
              {fact("Due", e.due ? refDateTime(e.due) : "Not set")}
              {fact("Handover note", e.handoverNote || "No note")}
            </dl>
          </section>
        </div>
      </div>
      {convertOpen && <MulticityConversionDialog e={e} onClose={() => setConvertOpen(false)} />}
    </>
  );
}

/**
 * Prices a Multicity itinerary from the brand's saved Multicity rates (the server measures every leg and counts the
 * calendar days). Preview first; "Save quote" writes it to the enquiry (estimate, breakup, validity) for Copy quote and follow-up.
 */
function MulticityConversionDialog({ e, onClose }: { e: Enquiry; onClose: () => void }) {
  const revision = useRef(e.quoteRevision || '');
  const [name, setName] = useState(e.customerName || '');
  const [phone, setPhone] = useState(e.phone || '');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'UPI'>('Cash');
  const [accepted, setAccepted] = useState(false);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState('');
  const changed = e.quoteRevision !== revision.current;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || changed || created) return;
    if (name.trim().length < 2 || !accepted || reference.trim().length < 5) return setError('Record the customer name, fare/terms agreement and its reference.');
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = await convertMulticityEnquiry({ enquiryId: e.id, expectedRevision: revision.current, customerName: name.trim(), phone, paymentMethod, customerAccepted: accepted, acceptanceReference: reference.trim() });
      setCreated(result.bookingId);
    } catch (err) { setError(err instanceof Error ? err.message : 'Conversion could not be completed. Refresh the enquiry before retrying.'); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <Modal title="Convert Multicity quote to booking" onClose={onClose} busy={busy} size="lg" footer={created ? <Button onClick={onClose}>Done</Button> : <Button variant="primary" type="submit" form="multicity-convert" loading={busy} disabled={changed || !accepted}>Create booking</Button>}>
    {created ? <p role="status">Booking {created} created for review. Approval and publication remain separate.</p> : <form id="multicity-convert" onSubmit={submit} className="grid gap-4">
      {error && <p className="ds-error" role="alert">{error}</p>}
      {changed && <p className="ds-error" role="alert">This quote changed. Close this window and review the new quote.</p>}
      <p className="ds-note">{e.pickup} → {(e.stops || []).map(stop => stop.name).join(' → ')} → {e.drop}<br />{e.vehicle} · {rupee(e.estimate || 0)} · {e.pickupAt ? refDateTime(e.pickupAt) : ''}</p>
      <fieldset disabled={busy || changed} className="ds-form-grid">
        <label className="ds-field"><span>Customer name</span><input className="ds-input" value={name} onChange={event => setName(event.target.value)} maxLength={80} /></label>
        <label className="ds-field"><span>Customer mobile</span><input className="ds-input" type="tel" value={phone} onChange={event => setPhone(event.target.value)} /></label>
        <label className="ds-field"><span>Pay driver by</span><select className="ds-select" value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as 'Cash' | 'UPI')}><option>Cash</option><option>UPI</option></select></label>
        <label className="ds-field"><span>Customer agreement reference</span><input className="ds-input" value={reference} onChange={event => setReference(event.target.value)} maxLength={300} placeholder="Call / message reference" /></label>
        <label className="ds-check" data-span="2"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />Customer agreed to this itinerary, quoted fare and booking terms.</label>
      </fieldset>
      <p className="text-[12px] text-muted">Every stop and the saved quote are preserved. No new fare is calculated during conversion.</p>
    </form>}
  </Modal>;
}

function MulticityPricer({ e }: { e: Enquiry }) {
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [categoryId, setCategoryId] = useState(e.categoryId ?? "");
  const [validDays, setValidDays] = useState("7");
  const [preview, setPreview] = useState<MulticityQuoteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [locations, setLocations] = useState<MasterLocation[]>([]);
  const [pickupLocationId, setPickupLocationId] = useState(e.pickupPoint?.id || '');
  useEffect(() => subscribeLocations(setLocations), []);
  const matchingPickups = locations.filter(l => l.status === 'Active' && e.pickupPoint && Number.isFinite(l.lat) && Number.isFinite(l.lng) && Math.abs(l.lat! - e.pickupPoint.lat) <= 0.0001 && Math.abs(l.lng! - e.pickupPoint.lng) <= 0.0001);
  useEffect(() => subscribeVehicleCategories((list) => setCategories(list.filter((c) => c.status === "Active"))), []);
  const run = async (save: boolean) => {
    if (!categoryId) return setError("Choose the vehicle category to quote.");
    setBusy(true); setError(null); setSaved(false);
    try {
      const r = await priceMulticityEnquiry(e.id, categoryId, save, Math.min(30, Math.max(1, Number(validDays) || 7)), pickupLocationId);
      setPreview(r);
      if (save) setSaved(true);
    } catch (err) {
      setError(err instanceof ActionError ? err.message : "The quote could not be priced.");
    } finally { setBusy(false); }
  };
  return (
    <section className="ds-panel ds-panel-pad">
      <h3 className="text-[15px] font-bold text-ink">Price Multicity quote</h3>
      <p className="text-[12px] text-muted mb-3">Uses the {e.brand === "onewaycarrentals" ? "One Way Car Rentals" : e.brand === "people_taxi" ? "People Taxi" : "NESAM"} Multicity rates in Service &amp; Fare Settings: road distance of every leg, daily minimum KM, daily driver bata and the brand GST setting.</p>
      {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="ds-field"><span>Verified pickup master · GST state</span><select className="ds-select" value={matchingPickups.some(l => l.id === pickupLocationId) ? pickupLocationId : ''} onChange={event => { setPickupLocationId(event.target.value); setPreview(null); setSaved(false); }}><option value="">Use pickup's saved master reference</option>{matchingPickups.map(location => <option key={location.id} value={location.id}>{location.name} · {location.state}</option>)}</select><small className="text-muted">Only master locations matching the pickup coordinates can verify its state. State-specific GST requires a verified pickup.</small></label>
        <label className="ds-field"><span>Vehicle category</span>
          <select className="ds-select" value={categoryId} onChange={(ev) => { setCategoryId(ev.target.value); setPreview(null); }}>
            <option value="">Choose…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{categoryTitle(c)}</option>)}
          </select>
        </label>
        <label className="ds-field"><span>Quote valid (days)</span><input className="ds-input w-20" type="number" min={1} max={30} value={validDays} onChange={(ev) => setValidDays(ev.target.value)} /></label>
        <Button onClick={() => run(false)} loading={busy} disabled={busy}>Calculate</Button>
        <Button variant="primary" onClick={() => run(true)} loading={busy} disabled={busy || !preview || preview.categoryId !== categoryId}>Save quote</Button>
      </div>
      {preview && (
        <div className="mt-3 text-[12px]">
          <p className="text-muted">{preview.totalKm} KM itinerary · {preview.days} day{preview.days === 1 ? "" : "s"} · {preview.includedKm} KM billable · extra KM {rupee(preview.extraKmRate)}</p>
          <ul className="grid gap-1 mt-2">{preview.breakup.map((l, i) => <li key={i} className="flex justify-between gap-3"><span>{l.label}</span><strong>{rupee(l.amount)}</strong></li>)}</ul>
          <p className="mt-2 text-[14px] font-bold text-ink">Customer total {rupee(preview.estimate)}</p>
          {saved && <p className="text-green-700 mt-1">Saved as this enquiry's quote. Use Copy quote to send it to the customer.</p>}
        </div>
      )}
    </section>
  );
}

/** "Sedan · Fare breakup" card used by quotes and the New booking flow. */
export function FareBreakupCard({ vehicle, lines, total, gstRate, gstAmount, extraKm, payout, priceEntered = "Excluding GST" }: {
  vehicle?: string;
  lines: { label: string; amount: number }[];
  total: number;
  /** As stored on fares and quotes: a fraction (0.05 = 5%). Older records holding a percentage are read as one. */
  gstRate: number;
  /** The GST the server calculated; when absent it is worked out from the total. */
  gstAmount?: number;
  extraKm?: number;
  payout: number | null;
  priceEntered?: string;
}) {
  const pct = gstRate > 0 && gstRate < 1 ? Math.round(gstRate * 10000) / 100 : gstRate;
  const gst = typeof gstAmount === "number" ? gstAmount : Math.round((total - total / (1 + pct / 100)) * 100) / 100;
  const taxable = Math.round((total - gst) * 100) / 100;
  return (
    <section className="ds-panel ds-panel-pad">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-bold text-ink">{vehicle || "Vehicle"} · Fare breakup</h3>
        <span className="ds-badge">Tariff</span>
      </div>
      <dl className="grid gap-3 text-[12px]">
        {lines.map((l, i) => (
          <div key={i} className="flex justify-between gap-3"><dt className="text-muted">{l.label}</dt><dd className="text-ink">{rupee(l.amount)}</dd></div>
        ))}
        <div className="flex justify-between gap-3"><dt className="text-muted">Taxable amount · excluding GST</dt><dd className="text-ink">{rupee(taxable)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted">GST · {pct}%</dt><dd className="text-ink">{rupee(gst)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted">Customer total · including GST</dt><dd className="text-ink font-semibold">{rupee(total)}</dd></div>
      </dl>
      <p className="text-[11px] text-muted mt-3">Price entered: <strong>{priceEntered}</strong>{extraKm ? ` · Extra km ${rupee(extraKm)}` : ""}</p>
      {payout !== null && (
        <div className="mt-4 pt-4 border-t border-dashed border-line">
          <span className="block text-[11px] text-muted">Standard vendor payout</span>
          <strong className="block text-[19px] text-muted mt-1">{rupee(payout)}</strong>
          <span className="block text-[9px] text-faint mt-1">Office only</span>
        </div>
      )}
    </section>
  );
}

function StatusDialog({ e, onClose, onSaved }: { e: Enquiry; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<EnquiryStatus>(["New", "Call back", "No response", "Quote sent", "Customer accepted", "Closed"].includes(e.status) ? e.status : "New");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    try {
      await updateEnquiryStatus(e.id, status, note.trim());
      onSaved();
    } catch {
      setError("The status was not saved.");
      setBusy(false);
    }
  };
  return (
    <Modal eyebrow="NESAM" title="Update enquiry" onClose={onClose} busy={busy} footer={<Button variant="primary" type="submit" form="enq-status" loading={busy}>Save status</Button>}>
      <form id="enq-status" onSubmit={save} className="grid gap-4">
        {error && <div className="ds-error" role="alert">{error}</div>}
        <label className="ds-field"><span>Status</span>
          <select className="ds-select" value={status} onChange={(x) => setStatus(x.target.value as EnquiryStatus)}>
            {(["New", "Call back", "No response", "Quote sent", "Customer accepted", "Closed"] as const).map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="ds-field"><span>Office note</span><textarea className="ds-input" rows={3} maxLength={300} value={note} onChange={(x) => setNote(x.target.value)} /></label>
      </form>
    </Modal>
  );
}

function HandlerDialog({ e, onClose, onSaved }: { e: Enquiry; onClose: () => void; onSaved: () => void }) {
  const self = currentStaff();
  const [staff, setStaff] = useState<{ uid: string; name: string }[]>([self]);
  const [uid, setUid] = useState(e.handler?.uid || self.uid);
  const [nextAction, setNextAction] = useState(e.nextAction || "");
  const [due, setDue] = useState("");
  const [note, setNote] = useState(e.handoverNote || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => subscribeStaffAccounts(
    (list) => setStaff([self, ...list.filter((a) => a.status === "active" && a.uid !== self.uid).map((a) => ({ uid: a.uid, name: a.name || a.email || "Staff" }))]),
    () => undefined,
  ), []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    if (nextAction.trim().length < 3) return setError("Record the next action.");
    setBusy(true);
    try {
      const who = staff.find((s) => s.uid === uid) ?? self;
      await assignEnquiryHandler(e.id, { handler: who, nextAction: nextAction.trim(), due: due ? new Date(due) : null, handoverNote: note.trim() });
      onSaved();
    } catch {
      setError("Handling staff was not saved.");
      setBusy(false);
    }
  };
  return (
    <Modal eyebrow="NESAM" title="Assign handling staff" onClose={onClose} busy={busy} footer={<Button variant="primary" type="submit" form="enq-handler" loading={busy}>Save handover</Button>}>
      <form id="enq-handler" onSubmit={save} className="grid gap-4">
        {error && <div className="ds-error" role="alert">{error}</div>}
        <label className="ds-field"><span>Responsible staff</span>
          <select className="ds-select" value={uid} onChange={(x) => setUid(x.target.value)}>{staff.map((s) => <option key={s.uid} value={s.uid}>{s.name}</option>)}</select>
        </label>
        <label className="ds-field"><span>Next action</span><input className="ds-input" maxLength={160} value={nextAction} onChange={(x) => setNextAction(x.target.value)} /></label>
        <label className="ds-field"><span>Due</span><DateTime12Input value={due} onChange={setDue} /></label>
        <label className="ds-field"><span>Handover note</span><textarea className="ds-input" rows={3} maxLength={300} value={note} onChange={(x) => setNote(x.target.value)} /></label>
      </form>
    </Modal>
  );
}

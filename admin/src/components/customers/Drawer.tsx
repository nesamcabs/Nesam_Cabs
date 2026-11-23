import { useEffect, useState } from "react";
import type { Booking } from "../../types";
import Icon from "../ui/Icon";
import { paymentOf } from "../../domain/bookingFlow";
import { brandLabel, groupOf, inr, isBlockedStatus, joinCompanyGstin, offerFor, primaryBadge, statusLabel, type Row } from "../../domain/customerDirectory";
import { refDateTime } from "../../domain/officeStage";
import { fetchSavedPlaces } from "../../services/customerDirectoryService";
import { bookingPickupDate } from "../../utils/time";
import { CloseButton, Layer, useTitleId } from "./Layer";
import { cabChoices } from "./Dialogs";
import { PhoneLine, customerCodeOf, emailOf } from "./CustomerTable";
import { BTN_PRIMARY, Chip, FIELD, FIELD_LABEL, type Tone } from "./Parts";

export interface OfferState { ok: boolean; message: string }

export interface DrawerProps {
  row: Row;
  owned: Booking[];
  phone?: string;
  cabs: string[];
  offer: OfferState;
  canReveal: boolean;
  canBook: boolean;
  canEdit: boolean;
  canSettle: boolean;
  onClose: () => void;
  onReveal: () => void;
  onBook: () => void;
  onStatement: () => void;
  onCopyStatement: () => void;
  onToggleBlock: () => void;
  onEdit: () => void;
  onRemind: () => void;
  onMarkPaid: () => void;
  onCoupon: () => void;
  onOffers: () => void;
  onSavePrefs: (p: { preferredCab: string; preferredDriver: string; notes: string }) => Promise<void>;
}

type Tab = "Trips" | "Bookings" | "Payments";
const SECTION = "text-[11px] leading-4 font-bold uppercase tracking-wider text-slate-500";
const LABEL = "text-[10px] leading-4 text-slate-400";
const VALUE = "font-semibold text-slate-800 mt-0.5 break-words";

export function CustomerDrawer(p: DrawerProps) {
  const { row, owned } = p;
  const { c, s } = row;
  const titleId = useTitleId();
  const blocked = isBlockedStatus(c.status);
  const badge = primaryBadge(row);
  const initials = (c.name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const brands = (c.brands ?? []).map(brandLabel);
  const offer = offerFor(row);
  const due = s.outstanding;

  const [tab, setTab] = useState<Tab>("Trips");
  const [places, setPlaces] = useState<{ state: "loading" | "ready" | "error"; list: { id: string; name: string; address: string }[] }>({ state: "loading", list: [] });
  useEffect(() => {
    let live = true;
    setPlaces({ state: "loading", list: [] });
    fetchSavedPlaces(c.id).then((r) => live && setPlaces({ state: "ready", list: r.places })).catch(() => live && setPlaces({ state: "error", list: [] }));
    return () => { live = false; };
  }, [c.id]);

  const [cab, setCab] = useState(c.preferredCab || "Any Cab");
  const [driver, setDriver] = useState(c.preferredDriver ?? "");
  const [note, setNote] = useState(c.notes ?? "");
  const [saving, setSaving] = useState(false);
  // The saved record wins when it changes (another save, a refresh); unsaved typing is kept while it does not.
  useEffect(() => { setCab(c.preferredCab || "Any Cab"); setDriver(c.preferredDriver ?? ""); setNote(c.notes ?? ""); }, [c.id, c.preferredCab, c.preferredDriver, c.notes]);
  const dirty = cab !== (c.preferredCab || "Any Cab") || driver.trim() !== (c.preferredDriver ?? "") || note.trim() !== (c.notes ?? "");

  const completed = owned.filter((b) => b.status === "Completed");
  const list = tab === "Trips" ? completed : owned;

  return (
    <Layer kind="drawer" title={`Customer profile, ${c.name}`} labelledBy={titleId} onClose={p.onClose}>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div aria-hidden="true" className="w-10 h-10 rounded-[12px] bg-crimson-50 text-crimson-800 font-bold text-sm flex items-center justify-center shrink-0">{initials || "?"}</div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h2 id={titleId} className="text-sm leading-5 font-bold text-slate-900 truncate" title={c.name}>{c.name || "Unnamed customer"}</h2>
              <Chip tone={badge.tone as Tone}>{badge.label}</Chip>
            </div>
            <p className="text-[11px] leading-4 text-slate-500 truncate">{customerCodeOf(c)} • {brands.length ? brands.join(", ") : "Brand not recorded"}</p>
          </div>
        </div>
        <CloseButton onClick={p.onClose} label="Close customer profile" />
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs leading-4">
        <div className="grid grid-cols-3 gap-2.5">
          <button type="button" onClick={p.onBook} disabled={!p.canBook || blocked} title={blocked ? "Unblock this customer to book" : !p.canBook ? "Your Staff ID does not include creating bookings" : undefined}
            className={`py-2.5 px-3 rounded-[12px] shadow-xs flex items-center justify-center gap-1.5 ${BTN_PRIMARY}`}><Icon name="circle-plus" size={14} /><span>+ Book Cab</span></button>
          <button type="button" onClick={p.onCopyStatement} className="py-2.5 px-3 rounded-[12px] bg-slate-100 hover:bg-slate-200/80 text-slate-800 font-semibold flex items-center justify-center gap-1.5"><Icon name="file-text" size={14} /><span>Copy Statement</span></button>
          <button type="button" onClick={p.onToggleBlock} disabled={!p.canEdit} className="py-2.5 px-3 rounded-[12px] bg-red-50 hover:bg-red-100 text-red-700 font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50">
            <Icon name={blocked ? "circle-check" : "ban"} size={14} /><span>{blocked ? "Unblock" : "Block Rider"}</span>
          </button>
        </div>
        <div className="flex items-center gap-4 -mt-2">
          {p.canEdit && <button type="button" onClick={p.onEdit} className="text-[11px] font-semibold text-slate-600 hover:text-crimson-800 inline-flex items-center gap-1"><Icon name="pencil" size={12} />Edit customer</button>}
          <button type="button" onClick={p.onStatement} className="text-[11px] font-semibold text-slate-600 hover:text-crimson-800 inline-flex items-center gap-1"><Icon name="file-text" size={12} />Full account statement</button>
        </div>

        <div className="p-4 rounded-[16px] bg-slate-50 border border-slate-200/80 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] leading-4 font-bold uppercase tracking-wider text-slate-400">Contact &amp; Billing Info</span>
            {!p.phone && c.hasPhone !== false && (
              <button type="button" onClick={p.onReveal} disabled={!p.canReveal} title={p.canReveal ? undefined : "Your Staff ID does not include viewing full numbers"} className="text-[11px] font-semibold text-crimson-800 hover:underline flex items-center gap-1 disabled:opacity-50 disabled:no-underline"><Icon name="eye" size={12} /><span>View Full Number</span></button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div><p className={LABEL}>Mobile Number</p><div className="mt-0.5"><PhoneLine c={c} phone={p.phone} canReveal={p.canReveal} onReveal={p.onReveal} size="drawer" /></div></div>
            <div className="min-w-0"><p className={LABEL}>Email Address</p><p className={`${VALUE} truncate`} title={emailOf(c)}>{emailOf(c) || "Not supplied"}</p></div>
            <div><p className={LABEL}>Home City &amp; Lead Source</p><p className={VALUE}>{[c.city, c.leadSource].filter(Boolean).join(" • ") || "Not recorded"}</p></div>
            <div><p className={LABEL}>GST / Company</p><p className={VALUE}>{joinCompanyGstin(c.company, c.gstin) || "Individual Rider"}</p></div>
            <div><p className={LABEL}>Preferred Cab &amp; Driver</p><p className={VALUE}>{`${c.preferredCab || "Any Cab"}${c.preferredDriver ? ` • ${c.preferredDriver}` : ""}`}</p></div>
            <div>
              <p className={LABEL}>Pending Credit Due</p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <p className={`font-bold ${due > 0.004 ? "text-amber-700" : "text-emerald-700"}`}>{due > 0.004 ? inr(due) : "₹0 (Settled)"}</p>
                {due > 0.004 && <button type="button" onClick={p.onRemind} className="px-2 py-0.5 rounded text-[10px] leading-4 font-semibold bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100" title="Copies a WhatsApp payment reminder; it is not sent">Copy WA reminder</button>}
                {due > 0.004 && (p.canSettle
                  ? <button type="button" onClick={p.onMarkPaid} className="px-2 py-0.5 rounded text-[10px] leading-4 font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100">Mark Paid</button>
                  : <button type="button" onClick={p.onStatement} className="px-2 py-0.5 rounded text-[10px] leading-4 font-semibold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50" title="Settlement is recorded in Accounts">Open statement</button>)}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 pt-1">{statusLabel(c.status)} · {s.total} booking{s.total === 1 ? "" : "s"} · {s.completed} completed · {groupOf(s.completed)}{s.paid > 0 ? ` · paid ${inr(s.paid)}` : ""}</p>
        </div>

        <div className="p-3.5 rounded-[16px] border border-amber-200/80 bg-amber-50/40 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] leading-4 font-bold text-amber-950 flex items-center gap-1.5"><Icon name="gift" size={14} className="text-amber-700 shrink-0" /><span>Loyalty &amp; Repeat Reward Coupon</span></p>
            <p className="text-[11px] leading-4 text-slate-600 mt-0.5">{p.offer.ok ? `Copy the ₹${offer.amount} ${offer.code} loyalty discount message for WhatsApp` : p.offer.message}</p>
            {!p.offer.ok && <button type="button" onClick={p.onOffers} className="text-[11px] font-semibold text-crimson-800 hover:underline mt-0.5">Open Offers &amp; Coupons</button>}
          </div>
          <button type="button" onClick={p.onCoupon} disabled={!p.offer.ok} className="px-3 py-1.5 rounded-[12px] text-[11px] leading-4 font-bold bg-amber-600 hover:bg-amber-700 text-white shrink-0 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed">Copy {offer.code} message</button>
        </div>

        <div className="space-y-2">
          <h3 className={SECTION}>Saved Pickup Addresses</h3>
          {places.state === "loading" ? <p className="text-slate-400" role="status">Loading saved addresses…</p>
            : places.state === "error" ? <p className="text-slate-500" role="alert">Saved addresses could not be loaded.</p>
            : places.list.length === 0 ? <p className="text-slate-400">No saved pickup addresses.</p>
            : places.list.map((a) => (
              <div key={a.id} className="p-2.5 rounded-[12px] bg-slate-50 border border-slate-200/70 flex items-center gap-2 text-slate-700">
                <Icon name="map-pin" size={14} className="text-crimson-800 shrink-0" /><span className="break-words min-w-0">{a.name ? <strong className="font-semibold">{a.name} · </strong> : null}{a.address}</span>
              </div>
            ))}
        </div>

        <form className="p-4 rounded-[16px] border border-slate-200 bg-white space-y-3" onSubmit={async (e) => { e.preventDefault(); if (!dirty || saving) return; setSaving(true); try { await p.onSavePrefs({ preferredCab: cab === "Any Cab" ? "" : cab, preferredDriver: driver.trim(), notes: note.trim() }); } finally { setSaving(false); } }}>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="col-span-2 sm:col-span-1">
              <label htmlFor="cd-d-cab" className={FIELD_LABEL}>Preferred Cab</label>
              <select id="cd-d-cab" value={cab} disabled={!p.canEdit} onChange={(e) => setCab(e.target.value)} className={`${FIELD} px-2.5`}>{cabChoices(p.cabs, cab).map((x) => <option key={x}>{x}</option>)}</select>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label htmlFor="cd-d-driver" className={FIELD_LABEL}>Preferred Driver</label>
              <input id="cd-d-driver" maxLength={60} value={driver} disabled={!p.canEdit} onChange={(e) => setDriver(e.target.value)} placeholder="e.g., Murugan S" className={FIELD} />
            </div>
          </div>
          <div>
            <label htmlFor="cd-d-note" className={FIELD_LABEL}>Admin Note &amp; Special Instructions</label>
            <div className="flex gap-2">
              <input id="cd-d-note" maxLength={300} value={note} disabled={!p.canEdit} onChange={(e) => setNote(e.target.value)} placeholder="e.g., Morning 5 AM airport pickup • English speaking driver" className={`${FIELD} flex-1 min-w-0`} />
              <button type="submit" disabled={!p.canEdit || !dirty || saving} className="px-3.5 h-9 rounded-[12px] bg-slate-900 text-white font-semibold hover:bg-slate-800 disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
            </div>
            {!p.canEdit && <p className="text-[11px] text-slate-400 mt-1">Your Staff ID does not include editing customers.</p>}
          </div>
        </form>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className={SECTION}>{tab === "Trips" ? "Completed & Recent Trips" : tab === "Bookings" ? "All Bookings" : "Payments"}</h3>
            <span className="font-bold text-crimson-800">Total Spend: {inr(s.spend)}</span>
          </div>
          <div role="tablist" aria-label="Booking history" className="flex gap-1.5">
            {(["Trips", "Bookings", "Payments"] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`px-2.5 py-1 rounded-lg text-[11px] leading-4 ${tab === t ? "bg-slate-900 text-white font-bold" : "bg-slate-100 text-slate-600 font-medium hover:bg-slate-200/70"}`}>{t === "Trips" ? "Completed trips" : t === "Bookings" ? "All bookings" : "Payments"}</button>
            ))}
          </div>
          <div className="border border-slate-200 rounded-[16px] divide-y divide-slate-100 overflow-hidden" role="tabpanel">
            {list.length === 0 ? <p className="p-4 text-center text-slate-400">{tab === "Trips" ? "No completed trips recorded yet." : tab === "Bookings" ? "No bookings yet." : "No payments recorded."}</p> : list.map((b) => {
              const pay = paymentOf(b);
              return (
                <div key={b.id} className="p-3 bg-white flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 break-words">{b.pickup} → {b.drop}</p>
                    <p className="text-[11px] text-slate-500 break-words">
                      {b.bookingId || b.id} • {refDateTime(bookingPickupDate(b)) || "Date not recorded"} • {b.vehicleCategory || b.vehicle || "Vehicle not recorded"}
                      {tab === "Bookings" ? ` • ${b.status}` : ""}
                      {tab === "Payments" ? ` • ${pay.status} · paid ${inr(pay.totalPaid)} · balance ${inr(pay.balanceDue)}` : ""}
                    </p>
                  </div>
                  <span className={`font-bold shrink-0 ${tab === "Payments" && pay.balanceDue > 0 ? "text-amber-700" : "text-emerald-700"}`}>{inr(tab === "Payments" ? pay.balanceDue || pay.totalPaid : pay.amountDue)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Layer>
  );
}

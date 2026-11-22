import { useCallback, useEffect, useRef, useState } from "react";
import { Timestamp } from "firebase/firestore";
import {
  markEnquiryConverted,
  markEnquiryLost,
  revealEnquiryNumber,
  saveEnquiry,
  snoozeEnquiry,
  subscribeEnquiries,
  updateEnquiryFollowUp,
  type Enquiry,
  type EnquiryStop,
  type NewEnquiry,
} from "../services/enquiryService";
import { fetchNumberViews, type NumberView } from "../services/customerDirectoryService";
import { breakupLines, estimateFacts, type CategoryEstimate, type QuickTrip } from "../components/booking/QuickFare";
import { deskTripRecord } from "../components/quickFareDesk/deskTrip";
import { deskKeyOf, openDuplicateOf, spacedPhone, type DeskQuoteLine, type DeskTripSnapshot } from "../domain/quickFareDesk";
import type { PickedPoint } from "../components/MapLocationPicker";

export interface FollowUpInput {
  /** The priced trip (only the fields its trip type uses). */
  trip: QuickTrip;
  snapshot: DeskTripSnapshot;
  line: DeskQuoteLine;
  /** The server quote of that vehicle; null for a draft (typed) quote. */
  estimate: CategoryEstimate | null;
  customerId: string | null;
  /** "+91XXXXXXXXXX". */
  mobile: string;
  digits: string;
  name: string;
  followUpAtMs: number;
  note: string;
}

/** Firestore refuses `undefined` anywhere in a document (a picked point may carry an unset field). */
const plain = <T,>(v: T): T => (v === null || v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

const stopsOf = (pts: PickedPoint[]): EnquiryStop[] =>
  pts.map((p, i) => ({ id: p.placeId ?? `stop-${i + 1}`, name: p.name || p.address, address: p.address || p.name, lat: p.lat, lng: p.lng }));

/** The enquiry fields of a desk follow-up: the shared enquiry record, plus the desk's trip and quote line. */
function enquiryFields(i: FollowUpInput): NewEnquiry {
  const t = i.trip;
  const s = i.snapshot;
  const q = i.estimate?.quote ?? null;
  const points = (t.stops ?? []).flatMap((x) => (x.point ? [x.point] : []));
  const rental = t.tripType === "Local Rental";
  return {
    brand: s.source,
    pickup: s.pickup,
    drop: s.drop,
    pickupPoint: plain(t.pickup),
    dropPoint: rental ? null : plain(t.drop),
    // A Multicity itinerary is kept in `stops` (the office's Multicity marker); round-trip stops in `roundStops`.
    ...(t.multicity ? { stops: stopsOf(points), roundStops: [] } : { stops: [], roundStops: stopsOf(points) }),
    pickupAt: s.pickupAtMs ? Timestamp.fromMillis(s.pickupAtMs) : null,
    serviceId: t.serviceId || "",
    service: s.tab,
    tripType: s.tab,
    categoryId: i.line.manual ? null : i.line.categoryId,
    vehicle: i.line.vehicle,
    includedKm: i.line.includedKm ?? 0,
    extraKmRate: q ? estimateFacts.extraKmRateOf(q) : 0,
    estimate: i.line.fare,
    breakup: q ? breakupLines(q) : [],
    gstRate: q ? q.quote.gstRate ?? 0 : 0,
    // Partner payout is never copied into an enquiry: every operations user can read enquiries.
    payout: null,
    customerId: i.customerId ?? undefined,
    customerName: i.name,
    phone: i.mobile,
    whatsapp: spacedPhone(i.mobile),
    followUpAt: Timestamp.fromMillis(i.followUpAtMs),
    note: i.note,
    source: "Phone",
    validUntil: null,
    deskKey: deskKeyOf(i.digits, s),
    deskTrip: deskTripRecord(t) as unknown as Enquiry["deskTrip"],
    deskQuote: { ...i.line },
  };
}

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * The desk's follow-ups are the office's enquiries (Bookings › Enquiries & quotes): saved, snoozed, closed and
 * converted there, so every screen and every staff member sees the same records. The number-view history is the
 * server's audit ledger.
 */
export function useQuickFareDesk() {
  const [enquiries, setEnquiries] = useState<Enquiry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const rowsRef = useRef<Enquiry[]>([]);

  useEffect(() => subscribeEnquiries(
    (rows) => { rowsRef.current = rows; setEnquiries(rows); setLoadError(null); },
    (m) => { setLoadError(m); setEnquiries((r) => r ?? []); },
  ), []);

  // ── Number views: the server ledger, desk enquiries only ──
  const [views, setViews] = useState<{ rows: NumberView[]; scope: "all" | "own" | null; error: string | null; loading: boolean }>({ rows: [], scope: null, error: null, loading: true });
  const viewSeq = useRef(0);
  const loadViews = useCallback(async () => {
    const seq = ++viewSeq.current;
    setViews((v) => ({ ...v, loading: true }));
    try {
      const r = await fetchNumberViews(50);
      if (seq !== viewSeq.current) return;
      setViews({ rows: r.entries.filter((e) => e.kind === "reveal" && /^NSM-QT-/.test(e.customerCode)), scope: r.scope, error: null, loading: false });
    } catch (e) {
      if (seq !== viewSeq.current) return;
      setViews((v) => ({ ...v, error: errText(e, "The number-view history could not be loaded."), loading: false }));
    }
  }, []);
  useEffect(() => { void loadViews(); return () => { viewSeq.current++; }; }, [loadViews]);

  /** Creates the follow-up, or updates the open enquiry already saved for this caller and trip. */
  const saveFollowUp = useCallback(async (i: FollowUpInput): Promise<{ kind: "created" | "updated"; code: string }> => {
    const fields = enquiryFields(i);
    const existing = openDuplicateOf(rowsRef.current, fields.deskKey!, Date.now());
    if (existing) {
      await updateEnquiryFollowUp(existing.id, {
        ...fields,
        customerName: fields.customerName || existing.customerName || "",
        customerId: fields.customerId ?? existing.customerId,
        note: fields.note || existing.note || "",
      }, `Follow-up updated from Quick Fare: ${i.line.vehicle} ₹${i.line.fare}`);
      return { kind: "updated", code: existing.code };
    }
    const saved = await saveEnquiry({ ...fields, status: "Call back" });
    return { kind: "created", code: saved.code };
  }, []);

  const snooze = useCallback((id: string) => snoozeEnquiry(id, 15), []);
  const markLost = useCallback((id: string, reason: string) => markEnquiryLost(id, reason), []);
  const markConverted = useCallback((id: string, bookingId: string) => markEnquiryConverted(id, bookingId), []);

  /** The server logs the view first and only then returns the number. */
  const reveal = useCallback(async (id: string, category: string, note: string) => {
    const r = await revealEnquiryNumber(id, category, note);
    void loadViews();
    return r;
  }, [loadViews]);

  const byId = useCallback((id: string) => rowsRef.current.find((e) => e.id === id) ?? null, []);

  return { enquiries, loadError, views, reloadViews: loadViews, saveFollowUp, snooze, markLost, markConverted, reveal, byId };
}

export type QuickFareDesk = ReturnType<typeof useQuickFareDesk>;

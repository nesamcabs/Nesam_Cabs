import { useState, type FormEvent } from "react";
import { Button, EmptyState, Icon, PageHeader } from "../components/ui";
import { Toast, useToast } from "../components/Feedback";
import {
  EstimateList, SaveEnquiryDialog, TripFields, emptyTrip, estimateAll, tripServiceLabel, useQuickData, validateTrip,
  type CategoryEstimate, type QuickTrip,
} from "../components/booking/QuickFare";
import type { NewBookingDraft } from "./NewBooking";

/**
 * Quick fare: a price check for a caller, on its own page and one click from the top bar. The fares are the server's (the same
 * quote New booking uses), one per vehicle. Nothing is booked or saved until the office chooses to: from the result they can
 * save the quote as an enquiry or carry the trip into New booking.
 */
export default function QuickFare({ onNewBooking, onEnquirySaved }: {
  onNewBooking?: (draft: NewBookingDraft) => void;
  onEnquirySaved?: () => void;
}) {
  const data = useQuickData();
  const { toast, show } = useToast(7000);
  const [trip, setTrip] = useState<QuickTrip>(emptyTrip);
  const [estimates, setEstimates] = useState<CategoryEstimate[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  // Any change to the trip makes the shown fares stale, so they are cleared.
  const set = (p: Partial<QuickTrip>) => { setTrip((t) => ({ ...t, ...p })); setEstimates(null); setError(null); };

  const run = async (e?: FormEvent) => {
    e?.preventDefault();
    const why = validateTrip(trip);
    if (why) return setError(why);
    if (!data.categories.length) return setError("Vehicle categories are still loading. Try again in a moment.");
    setBusy(true);
    setError(null);
    try {
      const list = await estimateAll(trip, data.categories);
      setEstimates(list);
      const first = list.find((x) => x.quote);
      setSelected(first?.category.id ?? "");
      if (!first) setError(list[0]?.error ?? "No vehicle could be priced for this trip.");
    } catch {
      setEstimates(null);
      setError("Could not get the fare. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const chosen = estimates?.find((x) => x.category.id === selected && x.quote) ?? null;
  const priced = estimates?.some((x) => x.quote) ?? false;
  const reset = () => { setTrip(emptyTrip()); setEstimates(null); setSelected(""); setError(null); };

  return (
    <>
      <Toast toast={toast} />
      <PageHeader title="Quick fare" />
      <div className="qfp">
        <section className="qfp-card" aria-labelledby="qfp-trip">
          <header className="qfp-head">
            <span className="qfp-badge" aria-hidden="true"><Icon name="calculator" size={18} /></span>
            <div>
              <h2 id="qfp-trip">Quick fare</h2>
              <p>Check a price for a caller. Nothing is booked or saved until you choose to.</p>
            </div>
            <Button variant="ghost" size="sm" icon="rotate-ccw" onClick={reset} className="qfp-clear">Clear</Button>
          </header>
          <form onSubmit={run} noValidate className="qfp-form">
            <TripFields trip={trip} set={set} data={data} compact idPrefix="page-qf" />
            {error && <p role="alert" className="qfp-error"><Icon name="info" size={15} />{error}</p>}
            <div className="qfp-actions">
              <Button type="submit" variant="primary" icon="calculator" loading={busy}>Get fare</Button>
            </div>
          </form>
        </section>

        <section className="qfp-card" aria-labelledby="qfp-fares" aria-live="polite">
          <header className="qfp-head">
            <span className="qfp-badge" data-tone="soft" aria-hidden="true"><Icon name="car-front" size={18} /></span>
            <div>
              <h2 id="qfp-fares">Fares</h2>
              <p>{priced ? "One price per vehicle. Pick a vehicle to see its full breakup." : "The fare for every vehicle appears here."}</p>
            </div>
          </header>
          {priced && estimates ? (
            <div className="qfp-results">
              <EstimateList estimates={estimates} selected={selected} onSelect={setSelected} />
              <div className="qfp-actions">
                <Button variant="secondary" icon="phone-forwarded" disabled={!chosen} onClick={() => setSaveOpen(true)}>Save as enquiry</Button>
                {onNewBooking && (
                  <Button variant="primary" icon="arrow-right" disabled={!chosen} onClick={() => onNewBooking({ trip, categoryId: selected })}>Create booking</Button>
                )}
              </div>
            </div>
          ) : estimates ? (
            <EmptyState icon="info" title="No vehicle is priced for this trip" hint="Set the fares for this service in Service & Fare Settings, or try another trip." />
          ) : (
            <EmptyState icon="calculator" title={busy ? "Getting the fares…" : "No fare yet"} hint="Choose the service, pickup, drop and time, then press Get fare." />
          )}
        </section>
      </div>

      {saveOpen && chosen && (
        <SaveEnquiryDialog
          trip={trip}
          estimate={chosen}
          serviceName={tripServiceLabel(trip)}
          onClose={() => setSaveOpen(false)}
          onSaved={() => { setSaveOpen(false); show("Enquiry saved. The fare and terms are retained."); onEnquirySaved?.(); }}
        />
      )}
    </>
  );
}

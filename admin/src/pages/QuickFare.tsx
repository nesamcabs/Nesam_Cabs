import { QuickFareCard } from "../components/booking/QuickFare";
import type { CategoryEstimate, QuickTrip } from "../components/booking/QuickFare";
import type { Enquiry } from "../services/enquiryService";
import { PageHeader } from "../components/ui";

/** Phone-enquiry Quick fare: give the estimate first, then continue to a booking or save the enquiry. */
export default function QuickFare({ onProceed, onSaved }: {
  onProceed: (trip: QuickTrip, categoryId: string, estimates: CategoryEstimate[]) => void;
  onSaved: (e: Enquiry) => void;
}) {
  return (
    <>
      <PageHeader eyebrow="NESAM OPERATIONS" title="Quick fare" subtitle="Get the estimate first. Customer details follow when booking." />
      <QuickFareCard onProceed={onProceed} onSaved={onSaved} />
    </>
  );
}

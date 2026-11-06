import { QuickFareCard } from "../components/booking/QuickFare";
import type { Enquiry } from "../services/enquiryService";
import { PageHeader } from "../components/ui";

/** Phone-enquiry Quick fare: give the estimate, or save it as an enquiry. Bookings are created from New booking. */
export default function QuickFare({ onSaved }: { onSaved: (e: Enquiry) => void }) {
  return (
    <>
      <PageHeader title="Quick fare" />
      <QuickFareCard onSaved={onSaved} />
    </>
  );
}

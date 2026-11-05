import { useState } from "react";
import PartnerRegistry from "../components/partners/PartnerRegistry";
import { Button } from "../components/ui";
import DriverKycDesk from "./DriverKycDesk";

/** Driver Partners: the Master Admin registry; the previous KYC review desk stays one click away. */
export default function Drivers({ onOpenBooking, onNavigate, initialProfile }: { onOpenBooking: (id: string) => void; onNavigate?: (page: string, tab?: string) => void; initialProfile?: string }) {
  const [desk, setDesk] = useState(false);
  if (desk) {
    return (
      <div>
        <div className="ds-page-body" style={{ paddingBottom: 0 }}><Button icon="arrow-left" onClick={() => setDesk(false)}>Back to Driver Partners</Button></div>
        <DriverKycDesk />
      </div>
    );
  }
  return <PartnerRegistry kind="driver" initialProfile={initialProfile} onOpenBooking={onOpenBooking} onNavigate={onNavigate} aside={<Button variant="ghost" icon="scan-text" onClick={() => setDesk(true)}>KYC review desk</Button>} />;
}

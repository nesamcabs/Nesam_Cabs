import { useState } from "react";
import PartnerRegistry from "../components/partners/PartnerRegistry";
import { Button } from "../components/ui";
import VendorApplications from "./VendorApplications";

/** Vendors: the Master Admin registry; the previous Applications & invites stays one click away. */
export default function Vendors({ onOpenBooking, onNavigate }: { onOpenBooking: (id: string) => void; onNavigate?: (page: string, tab?: string) => void }) {
  const [desk, setDesk] = useState(false);
  if (desk) {
    return (
      <div>
        <div className="ds-page-body" style={{ paddingBottom: 0 }}><Button icon="arrow-left" onClick={() => setDesk(false)}>Back to Vendors</Button></div>
        <VendorApplications />
      </div>
    );
  }
  return <PartnerRegistry kind="vendor" onOpenBooking={onOpenBooking} onNavigate={onNavigate} aside={<Button variant="ghost" icon="clipboard-list" onClick={() => setDesk(true)}>Applications & invites</Button>} />;
}

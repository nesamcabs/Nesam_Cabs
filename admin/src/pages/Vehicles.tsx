import { useState } from "react";
import PartnerRegistry from "../components/partners/PartnerRegistry";
import { Button } from "../components/ui";
import VehicleDesk from "./VehicleDesk";

/** Vehicles: the Master Admin registry; the previous Fleet desk stays one click away. */
export default function Vehicles({ onOpenBooking, onNavigate, initialProfile }: { onOpenBooking: (id: string) => void; onNavigate?: (page: string, tab?: string) => void; initialProfile?: string }) {
  const [desk, setDesk] = useState(false);
  if (desk) {
    return (
      <div>
        <div className="ds-page-body" style={{ paddingBottom: 0 }}><Button icon="arrow-left" onClick={() => setDesk(false)}>Back to Vehicles</Button></div>
        <VehicleDesk />
      </div>
    );
  }
  return <PartnerRegistry kind="vehicle" initialProfile={initialProfile} onOpenBooking={onOpenBooking} onNavigate={onNavigate} aside={<Button variant="ghost" icon="car-front" onClick={() => setDesk(true)}>Fleet desk</Button>} />;
}

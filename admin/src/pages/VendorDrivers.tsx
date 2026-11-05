import PartnerRegistry from "../components/partners/PartnerRegistry";

/** Vendor Drivers: drivers who work for a vendor (DL number is the Driver ID). */
export default function VendorDrivers({ onOpenBooking, onNavigate }: { onOpenBooking: (id: string) => void; onNavigate?: (page: string, tab?: string) => void }) {
  return <PartnerRegistry kind="vendor-driver" onOpenBooking={onOpenBooking} onNavigate={onNavigate} />;
}

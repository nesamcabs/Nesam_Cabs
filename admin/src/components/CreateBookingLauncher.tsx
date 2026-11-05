import { useEffect, useState } from "react";
import type { Customer, FareRule, MasterLocation, TravelService, VehicleCategory } from "../types";
import { subscribeCustomers, subscribeFareRules, subscribeLocations, subscribeServices, subscribeVehicleCategories } from "../services/adminFirestoreService";
import ManualBookingModal from "./ManualBookingModal";
import type { CreatedAdminBooking } from "../services/adminBookingService";
import { Modal } from "./Feedback";
import { secondaryBtn } from "./FormKit";

/** Loads what the booking form needs only while it is open, then renders it. */
export default function CreateBookingLauncher({ onClose, onCreated }: { onClose: () => void; onCreated: (b: CreatedAdminBooking) => void }) {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [services, setServices] = useState<TravelService[] | null>(null);
  const [locations, setLocations] = useState<MasterLocation[] | null>(null);
  const [fareRules, setFareRules] = useState<FareRule[] | null>(null);
  const [categories, setCategories] = useState<VehicleCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const u = [subscribeCustomers(setCustomers, setError), subscribeServices(setServices, setError), subscribeLocations(setLocations, setError), subscribeFareRules(setFareRules, setError), subscribeVehicleCategories(setCategories, setError)];
    return () => u.forEach((x) => x());
  }, []);
  if (error) {
    return (
      <Modal title="Create New Booking" onClose={onClose} footer={<button onClick={onClose} className={secondaryBtn}>Close</button>}>
        <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">{error}</div>
      </Modal>
    );
  }
  if (!customers || !services || !locations || !fareRules || !categories) {
    return (
      <Modal title="Create New Booking" onClose={onClose}>
        <p className="text-sm text-muted" role="status">Loading booking form…</p>
      </Modal>
    );
  }
  return <ManualBookingModal customers={customers} services={services} locations={locations} categories={categories} fareRules={fareRules} onClose={onClose} onCreated={onCreated} />;
}

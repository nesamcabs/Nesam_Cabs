// Quick swap: move a driver or a vehicle that is already on NESAM into a vendor's fleet straight from the admin panel, with no OTP.
// The admin types the driver's mobile number or the vehicle's registration number, picks the destination vendor and confirms. The move
// is written with the same audit trail as a manual transfer (history entry, who and when); earlier trips and accounts stay with the old
// partner. A driver or vehicle with a booked or running duty cannot be moved until that duty is finished or reassigned.
import { useMemo, useState, type FormEvent } from "react";
import { useOfficeData } from "../../hooks/useOfficeData";
import { transferAttachment } from "../../domain/partners";
import { Modal } from "../Feedback";
import Button from "../ui/Button";
import Badge from "../ui/Badge";

const ACTIVE = ["Approved", "Confirmed", "Assigned", "Ongoing"];
const digits = (v: string) => v.replace(/\D/g, "");
const plateKey = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
const str = (v: unknown) => (typeof v === "string" ? v : "");

export default function QuickSwap({ kind, onClose, onDone }: { kind: "vendor-driver" | "vehicle"; onClose: () => void; onDone: (message: string) => void }) {
  const data = useOfficeData();
  const isVehicle = kind === "vehicle";
  const [query, setQuery] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const found = useMemo(() => {
    if (isVehicle) {
      const k = plateKey(query);
      return k.length >= 6 ? data.vehicles.find((v) => plateKey(str(v.vehicleNumber) || str(v.number)) === k) ?? null : null;
    }
    const d = digits(query).slice(-10);
    return d.length === 10 ? data.drivers.find((x) => digits(str(x.phone)).slice(-10) === d) ?? null : null;
  }, [query, isVehicle, data.vehicles, data.drivers]);
  const typed = isVehicle ? plateKey(query).length >= 6 : digits(query).length >= 10;

  const currentVendorId = found ? str((found as { vendorId?: string }).vendorId) : "";
  const currentFleet = found ? (isVehicle ? str((found as { vendorName?: string }).vendorName) : data.vendorById.get(currentVendorId)?.companyName || "") : "";
  const duties = !found ? [] : (data.bookings ?? []).filter((b) => ACTIVE.includes(b.status) && (isVehicle ? b.assignedVehicleId === found.id : b.assignedDriverId === found.id));
  const vendors = data.vendors.filter((v) => /approved|active/i.test(String(v.status)) && v.id !== currentVendorId);
  const label = found ? (isVehicle ? str((found as { vehicleNumber?: string }).vehicleNumber) || str((found as { number?: string }).number) : str((found as { name?: string }).name) || "Driver") : "";

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!found) { setError(isVehicle ? "Enter a registration number that is on NESAM." : "Enter a mobile number that is on NESAM."); return; }
    if (duties.length) { setError(`${duties.length} booked or running ${duties.length === 1 ? "duty blocks" : "duties block"} this swap. Finish or reassign ${duties.length === 1 ? "it" : "them"} first.`); return; }
    const vendor = vendors.find((v) => v.id === to);
    if (!vendor) { setError("Choose the vendor to move it to."); return; }
    setBusy(true); setError("");
    try {
      await transferAttachment(isVehicle ? "vehicle" : "vendor-driver", found.id, { id: vendor.id, name: vendor.companyName || vendor.name }, "Direct swap by admin (no OTP)", note.trim());
      onDone(`${label} moved to ${vendor.companyName || vendor.name}.`);
    } catch {
      setError("The swap was not saved. Try again.");
      setBusy(false);
    }
  };

  return (
    <Modal title={isVehicle ? "Swap vehicle" : "Swap driver"} subtitle="Move it to another fleet directly. No OTP is sent." onClose={onClose} busy={busy} centered
      footer={<Button variant="primary" type="submit" form="quick-swap" loading={busy} disabled={!found || !to}>Swap now</Button>}>
      <form id="quick-swap" onSubmit={save} className="grid gap-4" noValidate>
        <label className="ds-field">
          <span>{isVehicle ? "Vehicle registration number" : "Driver mobile number"}</span>
          <input className="ds-input" value={query} onChange={(e) => { setQuery(e.target.value); setError(""); }} placeholder={isVehicle ? "TN 01 AB 1234" : "98765 43210"} inputMode={isVehicle ? "text" : "tel"} autoFocus autoCapitalize={isVehicle ? "characters" : "off"} />
        </label>

        {found ? (
          <div className="ds-sheet-card" style={{ marginBottom: 0 }}>
            <span>{isVehicle ? "Vehicle on NESAM" : "Driver on NESAM"}</span>
            <strong>{label}</strong>
            <small>
              {isVehicle ? [str((found as { make?: string }).make), str((found as { model?: string }).model)].filter(Boolean).join(" ") || "Model not recorded" : `+91 ${digits(str((found as { phone?: string }).phone)).slice(-10)}`}
              {" · "}Now with: {currentFleet || (isVehicle ? "NESAM fleet" : "No fleet (own vehicle)")}
            </small>
            {duties.length > 0 ? <Badge tone="red">{duties.length} booked / running {duties.length === 1 ? "duty" : "duties"}</Badge> : null}
          </div>
        ) : typed ? (
          <div className="ds-error" role="alert">{isVehicle ? "No vehicle with this registration number is on NESAM." : "No driver with this mobile number is on NESAM."}</div>
        ) : null}

        <label className="ds-field">
          <span>Move to vendor</span>
          <select className="ds-select" value={to} onChange={(e) => { setTo(e.target.value); setError(""); }} disabled={!found}>
            <option value="">Choose vendor</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.companyName || v.name}</option>)}
          </select>
          <span className="text-[11px] text-faint">Approved, active vendors only.</span>
        </label>
        <label className="ds-field"><span>Note · optional</span><input className="ds-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Owner asked on call" /></label>
        {error ? <div className="ds-error" role="alert">{error}</div> : null}
        <p className="text-[12px] text-muted">The permanent ID and earlier trips and payouts stay as they were. The swap is recorded in the status history with your name.</p>
      </form>
    </Modal>
  );
}

// Drivers added by a vendor from the vendor panel's Add driver form (driver_invites with a vendorId). They sit in the Vendor Drivers
// registry as unapproved records until NESAM has checked the licence number, licence photo and selfie. Approving sets preApproved on
// the record, so the driver is approved the moment they sign in to the Driver app with that number; rejecting records a reason,
// which the vendor sees on their Drivers list.
import { useEffect, useState } from "react";
import { subscribeToCollection, updateFirestoreDocument } from "../../services/adminFirestoreService";
import { auth } from "../../services/firebase";
import { formatDateTime12 } from "../../utils/time";
import { Modal } from "../Feedback";
import Badge from "../ui/Badge";
import Button from "../ui/Button";

export interface VendorInvite {
  id: string;
  name?: string;
  phone?: string;
  vendorId?: string;
  vendorName?: string;
  licenseNumber?: string;
  licenseDocUrl?: string;
  selfieUrl?: string;
  preApproved?: boolean;
  approvalStatus?: string;
  rejectionReason?: string;
  createdAt?: { toDate?: () => Date } | string;
}

export const last10 = (v?: string) => (v || "").replace(/\D/g, "").slice(-10);
export const inviteState = (i: VendorInvite): "Approved" | "Rejected" | "Unapproved" =>
  i.preApproved ? "Approved" : i.approvalStatus === "Rejected" ? "Rejected" : "Unapproved";

const dateOf = (v: VendorInvite["createdAt"]): Date | null => {
  if (!v) return null;
  const d = typeof v === "string" ? new Date(v) : v.toDate?.() ?? null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/** Every driver a vendor has added, live (pass `enabled` false on pages that don't need them). */
export function useVendorInvites(enabled: boolean): VendorInvite[] {
  const [invites, setInvites] = useState<VendorInvite[]>([]);
  useEffect(() => (enabled ? subscribeToCollection<VendorInvite>("driver_invites", (l) => setInvites(l.filter((i) => !!i.vendorId))) : undefined), [enabled]);
  return invites;
}

export function InviteReviewDialog({ invite: i, onClose, onDone }: { invite: VendorInvite; onClose: () => void; onDone: (message: string) => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const st = inviteState(i);
  const added = dateOf(i.createdAt);

  const decide = async (approve: boolean) => {
    if (!approve && !reason.trim()) { setError("Enter a reason for the vendor."); return; }
    setBusy(true); setError("");
    const by = auth.currentUser?.email || auth.currentUser?.uid || "admin";
    const ok = await updateFirestoreDocument("driver_invites", i.id, approve
      ? { preApproved: true, approvalStatus: "Approved", rejectionReason: "", approvedBy: by }
      : { preApproved: false, approvalStatus: "Rejected", rejectionReason: reason.trim(), reviewedBy: by });
    setBusy(false);
    if (!ok) { setError("Could not save the decision. Try again."); return; }
    onDone(approve ? `${i.name || "Driver"} approved. They join ${i.vendorName || "the fleet"} when they sign in to the Driver app.` : `${i.name || "Driver"} rejected. The vendor can see the reason.`);
  };

  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "8px 0", borderBottom: "1px solid #f1f2f5", fontSize: 13 }}>
      <span style={{ opacity: 0.65 }}>{label}</span><span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );

  return (
    <Modal
      title={i.name || "Vendor driver"}
      subtitle="Added by a vendor · waiting for NESAM to verify"
      onClose={onClose}
      busy={busy}
      centered
      footer={
        st === "Approved" ? <Button onClick={onClose}>Close</Button> : (
          <>
            <Button onClick={onClose} disabled={busy}>Close</Button>
            {st === "Unapproved" && !rejecting ? <Button disabled={busy} onClick={() => setRejecting(true)}>Reject</Button> : null}
            {rejecting ? <Button disabled={busy} onClick={() => void decide(false)}>Send rejection</Button> : null}
            {!rejecting ? <Button variant="primary" disabled={busy} onClick={() => void decide(true)}>{st === "Rejected" ? "Approve anyway" : "Approve driver"}</Button> : null}
          </>
        )
      }
    >
      <div>
        {row("Mobile", i.phone || i.id)}
        {row("Fleet (vendor)", i.vendorName || "Vendor")}
        {row("Driving licence number", <code>{i.licenseNumber || "Not provided"}</code>)}
        {row("Licence photo", i.licenseDocUrl ? <a href={i.licenseDocUrl} target="_blank" rel="noopener noreferrer">Open file</a> : "Not uploaded")}
        {row("Selfie", i.selfieUrl ? <a href={i.selfieUrl} target="_blank" rel="noopener noreferrer">Open file</a> : "Not uploaded")}
        {row("Added", added ? formatDateTime12(added) : "—")}
        {row("Status", <Badge tone={st === "Approved" ? "green" : st === "Rejected" ? "red" : "amber"}>{st === "Approved" ? "Approved · waiting for sign-in" : st}</Badge>)}
        {st === "Rejected" && i.rejectionReason ? row("Rejection reason", i.rejectionReason) : null}
        {rejecting ? (
          <div style={{ marginTop: 12 }}>
            <label htmlFor="invite-reject" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Reason shown to the vendor</label>
            <textarea id="invite-reject" className="ds-input" rows={3} style={{ width: "100%" }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Licence photo is unreadable. Please add the driver again." />
          </div>
        ) : null}
        {error ? <div role="alert" style={{ marginTop: 10, color: "#b42318", fontSize: 12 }}>{error}</div> : null}
        <p style={{ fontSize: 12, opacity: 0.65, marginTop: 12 }}>An approved driver is approved automatically when they sign in to the NESAM Driver app with this number.</p>
      </div>
    </Modal>
  );
}

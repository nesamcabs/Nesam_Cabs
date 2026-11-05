import { useMemo, useState } from "react";
import type { Driver, Vehicle, Vendor } from "../types";
import { useOfficeData } from "../hooks/useOfficeData";
import { approvalOf, decideApproval, type PartnerKind, type Raw } from "../domain/partners";
import { Modal, Toast, useToast } from "../components/Feedback";
import { Badge, Button, EmptyState, Icon, PageHeader, toneForStatus } from "../components/ui";

interface Item {
  kind: PartnerKind;
  id: string;
  name: string;
  code: string;
  status: string;
  consent: string;
  documents: string;
  invitedBy: string;
  expiring: string[];
  raw: Raw;
  docs: [string, string | undefined][];
}

const soon = (d?: string) => !!d && Date.parse(d) < Date.now() + 30 * 86400000;

/** Account approvals and document renewals waiting for the office. */
export default function Verification({ onBack }: { onBack?: () => void }) {
  const data = useOfficeData();
  const [open, setOpen] = useState<Item | null>(null);
  const { toast, show } = useToast(6000);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const vName = (id?: string) => (id ? data.vendorById.get(id)?.companyName || data.vendorById.get(id)?.name || "Vendor" : "Self registration");
    for (const d of data.drivers as (Driver & Raw)[]) {
      const kind: PartnerKind = d.vendorId ? "vendor-driver" : "driver";
      const a = approvalOf(kind, d);
      const expiring = soon(d.licenseExpiry) ? [`Driving licence ${d.licenseExpiry}`] : [];
      if (a === "Approved" && d.docStatus !== "Pending" && !expiring.length) continue;
      out.push({
        kind, id: d.id, name: d.name || "Driver", code: d.licenseNumber || d.id.slice(0, 12), status: a === "Approved" ? "Renewal" : "Pending",
        consent: d.phone ? "Received" : "Pending", documents: d.licenseNumber || d.licenseInfo ? (d.docStatus === "Rejected" ? "Changes requested" : "Submitted") : "Missing",
        invitedBy: vName(d.vendorId), expiring, raw: d, docs: [["Driving licence", d.licenseExpiry], ["Photo", d.docs?.photo ? "Uploaded" : undefined]],
      });
    }
    for (const v of data.vehicles as (Vehicle & Raw)[]) {
      const a = approvalOf("vehicle", v);
      const expiring = [["Insurance", v.insuranceExpiry], ["Fitness", v.fitnessExpiry], ["Permit", v.permitExpiry]].filter(([, x]) => soon(x)).map(([k, x]) => `${k} ${x}`);
      if (a === "Approved" && !expiring.length) continue;
      out.push({
        kind: "vehicle", id: v.id, name: v.vehicleNumber || v.number || "Vehicle", code: [v.make, v.model].filter(Boolean).join(" · ") || v.category || "", status: a === "Approved" ? "Renewal" : "Pending",
        consent: "Not required", documents: v.rcDocUrl || v.insuranceDocUrl ? "Submitted" : "Missing", invitedBy: vName(v.vendorId), expiring, raw: v,
        docs: [["Registration certificate", v.rcDocUrl ? "Uploaded" : undefined], ["Insurance", v.insuranceExpiry], ["Fitness certificate", v.fitnessExpiry], ["Permit", v.permitExpiry]],
      });
    }
    for (const v of data.vendors as (Vendor & Raw)[]) {
      const a = approvalOf("vendor", v);
      if (a === "Approved") continue;
      out.push({ kind: "vendor", id: v.id, name: v.companyName || v.name || "Vendor", code: `NSM-VN-${v.id.slice(0, 6).toUpperCase()}`, status: a, consent: v.phone ? "Received" : "Pending", documents: a === "Incomplete" ? "Missing" : "Submitted", invitedBy: "Self registration", expiring: [], raw: v, docs: [] });
    }
    return out.sort((x, y) => Number(x.status === "Renewal") - Number(y.status === "Renewal") || x.name.localeCompare(y.name));
  }, [data.drivers, data.vehicles, data.vendors, data.vendorById]);

  return (
    <div className="ds-page-body">
      <Toast toast={toast} />
      <PageHeader eyebrow="NESAM OPERATIONS" title="Verification" subtitle="Driver and vehicle documents, approvals and transfer records." actions={onBack ? <Button icon="arrow-left" onClick={onBack}>Back</Button> : undefined} />
      <section className="ds-panel ds-panel-pad">
        <h2 className="text-[17px] font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>Account approvals</h2>
        <p className="text-[12px] text-muted mb-4">Consent, documents and account status.</p>
        {items.length === 0 ? <EmptyState title="Nothing waiting for verification" hint="New applications and document renewals appear here." /> : (
          <ul className="grid gap-3">
            {items.map((it) => (
              <li key={`${it.kind}-${it.id}`} className="ds-verify-row">
                <div className="min-w-0">
                  <strong>{it.name}</strong>
                  <small>{it.code}</small>
                </div>
                <Badge tone={toneForStatus(it.status === "Renewal" ? "expiring" : it.status)}>{it.status}</Badge>
                <span className="text-[12px] text-body">{it.kind === "vehicle" ? "Vehicle documents" : "Driver consent"}: {it.kind === "vehicle" ? it.documents : it.consent}</span>
                {it.expiring.length > 0 && <span className="text-[11px] text-warn">{it.expiring.join(" · ")}</span>}
                <Button size="sm" onClick={() => setOpen(it)}>Review application</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {open && <ReviewApplication it={open} onClose={() => setOpen(null)} onDone={(t) => { setOpen(null); show(t); }} />}
    </div>
  );
}

function ReviewApplication({ it, onClose, onDone }: { it: Item; onClose: () => void; onDone: (t: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const decide = async (d: "Approved" | "Changes requested") => {
    if (d !== "Approved" && note.trim().length < 5) return setError("Record the requested corrections.");
    setBusy(d);
    try { await decideApproval(it.kind, it.raw, d, note.trim()); onDone(`${it.name}: ${d === "Approved" ? "account approved" : "changes requested"}.`); }
    catch { setError("The decision was not recorded. Check your permissions and try again."); setBusy(null); }
  };
  return (
    <Modal eyebrow="" title="Review application" onClose={onClose} busy={!!busy} footer={<><Button onClick={onClose} disabled={!!busy}>Close</Button><Button loading={busy === "Changes requested"} onClick={() => decide("Changes requested")}>Request changes</Button><Button variant="primary" icon="circle-check" loading={busy === "Approved"} onClick={() => decide("Approved")}>Approve account</Button></>}>
      <div className="ds-profile-head"><span className="ds-initials">{it.name.slice(0, 2).toUpperCase()}</span><div><strong>{it.name}</strong><small>{it.code}</small></div></div>
      {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
      <dl className="ds-facts" data-cols={2}>
        {it.kind !== "vehicle" && <div><dt>Driver consent</dt><dd>{it.consent}</dd></div>}
        <div><dt>Documents</dt><dd>{it.documents}</dd></div>
        <div><dt>Invited by</dt><dd>{it.invitedBy}</dd></div>
        <div><dt>Approval</dt><dd>{approvalOf(it.kind, it.raw)}</dd></div>
        {it.docs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || "Not recorded"}</dd></div>)}
      </dl>
      {it.expiring.length > 0 && <p className="ds-note mt-3">Renewal due: {it.expiring.join(" · ")}</p>}
      <label className="ds-field mt-4"><span>Office note / requested corrections</span><input className="ds-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
    </Modal>
  );
}

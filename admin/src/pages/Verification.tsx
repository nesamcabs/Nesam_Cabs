import { useEffect, useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import type { Driver, Vehicle, Vendor } from "../types";
import { useOfficeData } from "../hooks/useOfficeData";
import { approvalOf, decideApproval, rejectDriverDocuments, type PartnerKind, type Raw } from "../domain/partners";
import { isUploaded, partnerDocuments, readiness } from "../domain/verificationDocs";
import VerificationDocuments from "../components/partners/VerificationDocuments";
import { db } from "../services/firebase";
import { subscribeToDocument } from "../services/adminFirestoreService";
import { getVendorKyc } from "../services/vendorReviewService";
import { Modal, Toast, useToast } from "../components/Feedback";
import { Badge, Button, EmptyState, Icon, PageHeader, toneForStatus } from "../components/ui";

interface Item {
  kind: PartnerKind;
  id: string;
  name: string;
  code: string;
  status: string;
  invitedBy: string;
  expiring: string[];
  raw: Raw;
}

type Filter = "all" | "driver" | "vendor" | "vehicle";
const FILTERS: [Filter, string][] = [["all", "All"], ["driver", "Drivers"], ["vendor", "Vendors"], ["vehicle", "Vehicles"]];
const KIND_LABEL: Record<PartnerKind, string> = { driver: "Driver Partner", "vendor-driver": "Vendor Driver", vendor: "Vendor", vehicle: "Vehicle" };
const matches = (f: Filter, k: PartnerKind) => f === "all" || k === f || (f === "driver" && k === "vendor-driver");

const soon = (d?: string) => !!d && Date.parse(d) < Date.now() + 30 * 86400000;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const bag = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Account approvals and document renewals waiting for the office. */
export default function Verification({ onBack }: { onBack?: () => void }) {
  const data = useOfficeData();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const { toast, show } = useToast(6000);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const vName = (id?: string) => (id ? data.vendorById.get(id)?.companyName || data.vendorById.get(id)?.name || "Vendor" : "Self registration");
    for (const d of data.drivers as unknown as (Driver & Raw)[]) {
      const kind: PartnerKind = d.vendorId ? "vendor-driver" : "driver";
      const a = approvalOf(kind, d);
      const expiring = soon(d.licenseExpiry) ? [`Driving licence ${d.licenseExpiry}`] : [];
      if (a === "Approved" && d.docStatus !== "Pending" && !expiring.length) continue;
      const status = a !== "Approved" ? a : d.docStatus === "Pending" ? "Documents updated" : "Renewal";
      out.push({ kind, id: d.id, name: d.name || "Name not recorded", code: [d.licenseNumber, d.phone].filter(Boolean).join(" · ") || d.id.slice(0, 12), status, invitedBy: vName(d.vendorId), expiring, raw: d });
    }
    for (const v of data.vehicles as unknown as (Vehicle & Raw)[]) {
      const a = approvalOf("vehicle", v);
      const expiring = [["Insurance", v.insuranceExpiry], ["Fitness", v.fitnessExpiry], ["Permit", v.permitExpiry]].filter(([, x]) => soon(x)).map(([k, x]) => `${k} ${x}`);
      if (a === "Approved" && !expiring.length) continue;
      out.push({ kind: "vehicle", id: v.id, name: v.vehicleNumber || str(v.number) || "Vehicle", code: [v.make, v.model].filter(Boolean).join(" · ") || v.category || "", status: a === "Approved" ? "Renewal" : a, invitedBy: vName(v.vendorId), expiring, raw: v });
    }
    for (const v of data.vendors as unknown as (Vendor & Raw)[]) {
      const a = approvalOf("vendor", v);
      if (a === "Approved") continue;
      const business = str(bag(v.business).businessName);
      out.push({ kind: "vendor", id: v.id, name: business || v.companyName || v.name || "Vendor", code: [`NSM-VN-${v.id.slice(0, 6).toUpperCase()}`, v.phone].filter(Boolean).join(" · "), status: a, invitedBy: "Self registration", expiring: [], raw: v });
    }
    // New applications first; renewals of working accounts after them.
    return out.sort((x, y) => Number(x.status === "Renewal") - Number(y.status === "Renewal") || x.name.localeCompare(y.name));
  }, [data.drivers, data.vehicles, data.vendors, data.vendorById]);

  const rows = items.filter((it) => matches(filter, it.kind));
  // Bound to live data, so a re-upload by the partner appears while the review is open.
  const open = items.find((it) => `${it.kind}-${it.id}` === openKey) ?? null;

  return (
    <div className="ds-page-body">
      <Toast toast={toast} />
      <PageHeader title="Verification" actions={onBack ? <Button icon="arrow-left" onClick={onBack}>Back</Button> : undefined} />
      <section className="ds-panel ds-panel-pad">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <h2 className="text-[17px] font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>Account approvals</h2>
            <p className="text-[12px] text-muted">Check the uploaded documents, then approve or reject.</p>
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by type">
            {FILTERS.map(([id, label]) => (
              <Button key={id} size="sm" variant={filter === id ? "primary" : "secondary"} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {label} ({items.filter((it) => matches(id, it.kind)).length})
              </Button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? <EmptyState title="Nothing waiting for verification" hint="New applications and document renewals appear here." /> : (
          <ul className="grid gap-2.5">
            {rows.map((it) => {
              const count = partnerDocuments(it.kind, it.raw).filter(isUploaded).length;
              return (
                <li key={`${it.kind}-${it.id}`} className="ds-verify-row">
                  <span className="ds-initials">{it.name.slice(0, 2).toUpperCase()}</span>
                  <div className="min-w-0">
                    <strong>{it.name}</strong>
                    <small>{KIND_LABEL[it.kind]} · {it.code}</small>
                  </div>
                  <Badge tone={toneForStatus(it.status === "Renewal" ? "expiring" : it.status === "Documents updated" || it.status === "Unapproved" || it.status === "Changes requested" ? "pending" : it.status)}>{it.status}</Badge>
                  <span className={`text-[12px] ${count ? "text-body" : "text-brand font-semibold"}`}>{count ? `${count} document${count === 1 ? "" : "s"}` : "No documents"}</span>
                  {it.expiring.length > 0 && <span className="text-[11px] text-warn">{it.expiring.join(" · ")}</span>}
                  <Button size="sm" variant="primary" icon="eye" onClick={() => setOpenKey(`${it.kind}-${it.id}`)}>Review</Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {open && <ReviewApplication key={`${open.kind}-${open.id}`} it={open} onClose={() => setOpenKey(null)} onDone={(t) => { setOpenKey(null); show(t); }} />}
    </div>
  );
}

type Action = "approve" | "changes" | "reject";

function ReviewApplication({ it, onClose, onDone }: { it: Item; onClose: () => void; onDone: (t: string) => void }) {
  const driver = it.kind === "driver" || it.kind === "vendor-driver";
  const vendor = it.kind === "vendor";
  const [busy, setBusy] = useState<Action | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const [name, setName] = useState(str(it.raw.name));
  // Aadhaar / PAN (drivers) and the full owner ID number (vendors) are kept in restricted records.
  const [privateData, setPrivateData] = useState<Record<string, unknown>>({});
  const [privateError, setPrivateError] = useState(false);
  const [vendorId, setVendorId] = useState("");

  useEffect(() => {
    if (!driver) return;
    return subscribeToDocument<Record<string, unknown>>(`driver_private/${it.id}`, (d) => setPrivateData(d ?? {}), () => setPrivateError(true));
  }, [driver, it.id]);
  useEffect(() => {
    if (!vendor) return;
    let alive = true;
    getVendorKyc(it.id).then((k) => alive && setVendorId(k?.identityNumber ?? ""), () => alive && setPrivateError(true));
    return () => { alive = false; };
  }, [vendor, it.id]);

  const raw = it.raw;
  const docs = partnerDocuments(it.kind, raw, privateData);
  const business = bag(raw.business);
  const bank = bag(raw.payoutSummary);
  const vendorDocsRecord = bag(raw.documents);
  const approval = approvalOf(it.kind, raw);
  const approved = approval === "Approved";
  const needsName = driver && !str(raw.name);

  const missingDetails = vendor ? [...(str(business.businessName) ? [] : ["business details"]), ...(str(bank.bankLast4) ? [] : ["bank details"])] : [];
  const ready = readiness(docs, seen, missingDetails);
  const blocker = ready.blocker || (needsName && name.trim().length < 3 ? "Enter the driver’s name as printed on the licence." : "");
  // Rejecting also means the reviewer looked: every uploaded document must have been opened.
  const unopened = ready.uploaded - ready.checked;

  const decide = async (action: Action) => {
    const reason = note.trim();
    if (action !== "approve" && reason.length < 5) return setError("Write the reason, so the partner knows what to fix (at least 5 characters).");
    setError(null);
    setBusy(action);
    try {
      // Approving an owner-driver also adds their registered vehicle: the office is told what happened to it.
      let vehicleNote: string | null = null;
      if (action === "approve") {
        if (needsName) await updateDoc(doc(db, "drivers", it.id), { name: name.trim() });
        vehicleNote = await decideApproval(it.kind, needsName ? { ...raw, name: name.trim() } : raw, "Approved", reason);
      } else if (driver && approved) {
        await rejectDriverDocuments(it.kind as "driver" | "vendor-driver", raw, reason);
      } else {
        await decideApproval(it.kind, raw, action === "reject" ? "Rejected" : "Changes requested", reason);
      }
      onDone(`${needsName ? name.trim() || it.name : it.name}: ${action === "approve" ? "approved" : action === "reject" ? "rejected" : "changes requested"}.${vehicleNote ? ` ${vehicleNote}` : ""}`);
    } catch {
      setError("The decision was not recorded. Check your permissions and try again.");
      setBusy(null);
    }
  };

  const idProof = bag(vendorDocsRecord.identityProof);
  const businessProof = bag(vendorDocsRecord.businessRegistration);
  const identity = { ...bag(raw.identity), ...bag(privateData.identity) };
  const vehicleInfo = bag(raw.vehicleInfo);
  const facts: [string, string][] = driver
    ? [
        ["Mobile", str(raw.phone)],
        ["Invited by", it.invitedBy],
        ["Licence no.", str(raw.licenseNumber) || str(bag(raw.licenseInfo).number)],
        ["Licence valid till", str(raw.licenseExpiry) || str(bag(raw.licenseInfo).expiryDate)],
        ["Vehicle", str(vehicleInfo.vehicleNumber) || str(raw.assignedVehicleNumber)],
        ["Aadhaar no.", str(identity.aadhaarNumber)],
        ["PAN no.", str(identity.panNumber)],
      ]
    : vendor
      ? [
          ["Owner", str(business.vendorName) || str(raw.contactPerson)],
          ["Mobile", str(raw.phone)],
          ["Operating city", str(business.operatingCity)],
          [`Owner ID${str(idProof.type) ? ` (${str(idProof.type)})` : ""}`, vendorId || str(idProof.maskedNumber)],
          ["Business proof", str(businessProof.number) ? `${str(businessProof.type)} · ${str(businessProof.number)}` : "Not provided (optional)"],
          ["Bank account", str(bank.bankLast4) ? `••••${str(bank.bankLast4)} · ${str(bank.ifsc)}` : ""],
        ]
      : [
          ["Make / model", [str(raw.make), str(raw.model)].filter(Boolean).join(" ")],
          ["Category", str(raw.category)],
          ["Owner", it.invitedBy === "Self registration" ? "NESAM fleet" : it.invitedBy],
          ["RC number", str(raw.rcNumber)],
        ];
  // Identity numbers show only when the partner gave them.
  const shown = facts.filter(([k, v]) => v || !/^(Aadhaar|PAN|RC number|Vehicle$|Operating)/.test(k));

  return (
    <Modal
      title="Review application"
      onClose={onClose}
      busy={!!busy}
      size="lg"
      footNote={blocker || "All documents checked."}
      footer={
        <>
          <Button variant="danger" loading={busy === "reject"} disabled={!!busy || unopened > 0} onClick={() => decide("reject")}>{driver && approved ? "Reject documents" : "Reject"}</Button>
          {!(driver && approved) && <Button loading={busy === "changes"} disabled={!!busy} onClick={() => decide("changes")}>Request changes</Button>}
          <Button variant="primary" icon="circle-check" loading={busy === "approve"} disabled={!!busy || !!blocker} onClick={() => decide("approve")}>{driver && approved ? "Approve documents" : "Approve"}</Button>
        </>
      }
    >
      <div className="ds-profile-head">
        <span className="ds-initials">{it.name.slice(0, 2).toUpperCase()}</span>
        <div><strong>{it.name}</strong><small>{KIND_LABEL[it.kind]} · {it.code}</small></div>
        <Badge tone={approved ? "green" : "amber"}>{approval}</Badge>
      </div>
      {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
      <dl className="ds-facts" data-cols={3}>
        {shown.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || "Not recorded"}</dd></div>)}
      </dl>
      {needsName && (
        <label className="ds-field mt-3"><span>Driver name, as printed on the licence</span><input className="ds-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
      )}
      {it.expiring.length > 0 && <p className="ds-note mt-3">Renewal due: {it.expiring.join(" · ")}</p>}
      {privateError && <p className="ds-note mt-3">Restricted identity details are not available to your login.</p>}

      <VerificationDocuments docs={docs} seen={seen} onSeen={(key) => setSeen((s) => (s.has(key) ? s : new Set(s).add(key)))} />

      <label className="ds-field mt-5"><span>Reason / office note (required to reject or request changes)</span><textarea className="ds-input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
    </Modal>
  );
}

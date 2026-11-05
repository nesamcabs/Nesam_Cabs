import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../services/firebase";
import { callFunction, ActionError } from "../services/callables";
import { subscribeVendors } from "../services/adminFirestoreService";
import { useCan } from "../components/AccessContext";
import { ConfirmDialog, ErrorBanner, Modal, Toast, useToast } from "../components/Feedback";
import { Field, Notice, inputCls, primaryBtn, secondaryBtn } from "../components/FormKit";
import { formatDateTime12 } from "../utils/time";
import type { Vendor } from "../types";

type LinkStatus = "Awaiting OTP" | "Office review" | "Completed" | "Rejected" | "Cancelled";

interface PartnerLink {
  id: string;
  kind: "driver" | "vehicle";
  status: LinkStatus;
  subjectId: string;
  subjectLabel: string;
  subjectPhoneMask: string;
  subjectKind: string;
  fromVendorId: string;
  fromVendorName: string;
  fromType: string;
  toVendorId: string;
  toVendorName: string;
  requestedByName: string;
  requestedByRole: string;
  consent: boolean;
  otpVerified: boolean;
  receiverName: string;
  receiverPhoneMask: string;
  hasReceiver: boolean;
  method: string;
  blockedReason: string;
  overrideReason: string;
  rejectedReason: string;
  officeHelp: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

interface LinkEvent {
  id: string;
  type: string;
  actorName: string;
  actorRole: string;
  reason: string;
  method: string;
  at: Date | null;
}

interface Acceptance {
  id: string;
  userId: string;
  role: string;
  title: string;
  version: number;
  acceptedAt: Date | null;
  source: string;
}

const OPEN: LinkStatus[] = ["Awaiting OTP", "Office review"];
const asDate = (v: unknown): Date | null => (v && typeof (v as { toDate?: () => Date }).toDate === "function" ? (v as { toDate: () => Date }).toDate() : null);
const str = (v: unknown) => (typeof v === "string" ? v : "");

const pill: Record<LinkStatus, string> = {
  "Awaiting OTP": "bg-blue-50 text-blue-700 border-blue-200",
  "Office review": "bg-amber-50 text-amber-800 border-amber-200",
  Completed: "bg-green-50 text-green-700 border-green-200",
  Rejected: "bg-red-50 text-brand border-red-200",
  Cancelled: "bg-gray-100 text-gray-600 border-gray-300",
};

const fromLabel = (l: PartnerLink) =>
  l.fromVendorName || (l.fromType === "owner_driver" ? "Owner-driver" : l.fromType === "unattached" ? "Not attached" : "—");

function mapLink(id: string, d: Record<string, unknown>): PartnerLink {
  return {
    id, kind: d.kind === "vehicle" ? "vehicle" : "driver", status: (str(d.status) || "Office review") as LinkStatus,
    subjectId: str(d.subjectId), subjectLabel: str(d.subjectLabel), subjectPhoneMask: str(d.subjectPhoneMask), subjectKind: str(d.subjectKind),
    fromVendorId: str(d.fromVendorId), fromVendorName: str(d.fromVendorName), fromType: str(d.fromType),
    toVendorId: str(d.toVendorId), toVendorName: str(d.toVendorName), requestedByName: str(d.requestedByName), requestedByRole: str(d.requestedByRole),
    consent: d.consent === true, otpVerified: d.otpVerified === true, receiverName: str(d.receiverName), receiverPhoneMask: str(d.receiverPhoneMask),
    hasReceiver: d.hasReceiver === true, method: str(d.method), blockedReason: str(d.blockedReason), overrideReason: str(d.overrideReason),
    rejectedReason: str(d.rejectedReason), officeHelp: d.officeHelp === true, createdAt: asDate(d.createdAt), updatedAt: asDate(d.updatedAt),
  };
}

type Tab = "review" | "all" | "start" | "agreements";

export default function PartnerLinks() {
  const canPeople = useCan("people");
  const canFleet = useCan("fleet");
  const [tab, setTab] = useState<Tab>("review");
  const [links, setLinks] = useState<PartnerLink[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [acceptances, setAcceptances] = useState<Acceptance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"All" | "driver" | "vehicle">("All");
  const [selected, setSelected] = useState<string | null>(null);
  const { toast, show } = useToast();

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    const fail = (m: string) => { setLoadError(m); setLoading(false); };
    const unsubs = [
      onSnapshot(
        query(collection(db, "partner_links"), orderBy("createdAt", "desc"), limit(300)),
        (snap) => { setLinks(snap.docs.map((d) => mapLink(d.id, d.data()))); setLoading(false); },
        () => fail("Could not load partner requests. Check your connection and permissions."),
      ),
      subscribeVendors(setVendors, fail),
      onSnapshot(
        query(collection(db, "legal_acceptances"), where("role", "in", ["vendor", "driver"]), limit(300)),
        (snap) => setAcceptances(snap.docs.map((d) => {
          const x = d.data();
          return { id: d.id, userId: str(x.userId), role: str(x.role), title: str(x.title), version: Number(x.version) || 0, acceptedAt: asDate(x.acceptedAt), source: str(x.source) };
        }).sort((a, b) => (b.acceptedAt?.getTime() ?? 0) - (a.acceptedAt?.getTime() ?? 0))),
        () => undefined,
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [retryKey]);

  const stats = useMemo(() => ({
    review: links.filter((l) => l.status === "Office review").length,
    awaiting: links.filter((l) => l.status === "Awaiting OTP").length,
    done: links.filter((l) => l.status === "Completed" && l.updatedAt && Date.now() - l.updatedAt.getTime() < 7 * 86400000).length,
    total: links.length,
  }), [links]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return links.filter((l) => {
      if (tab === "review" && l.status !== "Office review") return false;
      if (kindFilter !== "All" && l.kind !== kindFilter) return false;
      return !q || [l.subjectLabel, l.fromVendorName, l.toVendorName, l.id, l.status].some((v) => v.toLowerCase().includes(q));
    });
  }, [links, tab, search, kindFilter]);

  const current = links.find((l) => l.id === selected) ?? null;
  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.companyName || id.slice(0, 8);

  const tabs: [Tab, string, number?][] = [["review", "Needs review", stats.review], ["all", "All requests", stats.total], ["start", "Start a link"], ["agreements", "Agreements", acceptances.length]];

  return (
    <div className="p-4 md:p-6 space-y-5">
      <Toast toast={toast} />
      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />}

      <div>
        <h1 className="text-xl font-bold text-ink">Partner links</h1>
        <p className="text-sm text-muted">
          Owner-drivers and vendor drivers joining a fleet, and vehicles changing hands. A driver confirms with a code sent to their own phone; a vehicle is confirmed by the driver of its last trip.
          Anything that cannot finish automatically waits here for you.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Needs review", value: stats.review, tone: stats.review ? "text-amber-700" : "" },
          { label: "Waiting for a code", value: stats.awaiting, tone: "" },
          { label: "Completed (7 days)", value: stats.done, tone: "text-green-700" },
          { label: "All requests", value: stats.total, tone: "" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-line shadow-sm p-4">
            <div className={`text-2xl font-bold ${s.tone || "text-ink"}`}>{loading ? "—" : s.value}</div>
            <div className="text-sm text-muted mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div role="tablist" className="flex flex-wrap gap-2">
        {tabs.map(([id, label, n]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border ${tab === id ? "bg-ink text-white border-ink" : "bg-white text-body border-line-strong hover:bg-gray-50"}`}>
            {label}{n !== undefined && n > 0 ? <span className="ml-2 text-xs bg-white/20 rounded-full px-1.5 py-0.5">{n}</span> : null}
          </button>
        ))}
      </div>

      {(tab === "review" || tab === "all") && (
        <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-line bg-surface-2 flex flex-wrap items-center gap-2">
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search driver, plate or vendor…" aria-label="Search requests" className={`${inputCls} min-w-[14rem] !w-auto`} />
            <select aria-label="Type" value={kindFilter} onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)} className={`${inputCls} !w-auto`}>
              <option value="All">Drivers & vehicles</option>
              <option value="driver">Drivers</option>
              <option value="vehicle">Vehicles</option>
            </select>
          </div>
          {loading && <div className="py-12 text-center text-sm text-muted" role="status">Loading requests…</div>}
          {!loading && list.length === 0 && (
            <div className="py-12 text-center text-sm text-muted">{tab === "review" ? "Nothing is waiting for the office." : "No requests match."}</div>
          )}
          {!loading && list.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted bg-surface-2">
                  <tr><th className="px-4 py-2.5">Request</th><th className="px-4 py-2.5">From</th><th className="px-4 py-2.5">To vendor</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Asked</th><th className="px-4 py-2.5" /></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.map((l) => (
                    <tr key={l.id} className="hover:bg-surface-2">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-ink">{l.subjectLabel}</div>
                        <div className="text-xs text-muted">{l.kind === "driver" ? (l.subjectKind === "owner_driver" ? "Owner-driver joins a fleet" : "Driver changes fleet") : "Vehicle attachment"}</div>
                      </td>
                      <td className="px-4 py-3 text-body">{fromLabel(l)}</td>
                      <td className="px-4 py-3 text-body">{l.toVendorName}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-md border text-xs font-semibold ${pill[l.status]}`}>{l.status}</span>
                        {l.blockedReason && l.status === "Office review" && <div className="text-xs text-muted mt-1 max-w-[18rem]">{l.blockedReason}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">{formatDateTime12(l.createdAt) || "—"}</td>
                      <td className="px-4 py-3 text-right"><button className={secondaryBtn} onClick={() => setSelected(l.id)}>{OPEN.includes(l.status) ? "Review" : "History"}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "start" && (
        <StartLink vendors={vendors.filter((v) => ["APPROVED", "Approved", "Active"].includes(String(v.status)))} canPeople={canPeople} canFleet={canFleet}
          onDone={(msg, id) => { show(msg); if (id) { setTab("all"); setSelected(id); } }} onError={(m) => show(m, "error")} />
      )}

      {tab === "agreements" && (
        <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-line bg-surface-2 text-sm text-muted">
            Who accepted which version of the vendor and driver agreements, and when. Texts are edited under Terms &amp; Privacy.
          </div>
          {acceptances.length === 0 ? <div className="py-12 text-center text-sm text-muted">No acceptances recorded yet.</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted bg-surface-2">
                  <tr><th className="px-4 py-2.5">Document</th><th className="px-4 py-2.5">Role</th><th className="px-4 py-2.5">Partner</th><th className="px-4 py-2.5">Version</th><th className="px-4 py-2.5">Accepted</th><th className="px-4 py-2.5">Source</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {acceptances.map((a) => (
                    <tr key={a.id}>
                      <td className="px-4 py-2.5 font-semibold text-ink">{a.title}</td>
                      <td className="px-4 py-2.5 capitalize">{a.role}</td>
                      <td className="px-4 py-2.5 text-xs text-muted">{a.role === "vendor" ? vendorName(a.userId) : a.userId.slice(0, 10)}</td>
                      <td className="px-4 py-2.5">v{a.version}</td>
                      <td className="px-4 py-2.5 text-xs text-muted whitespace-nowrap">{formatDateTime12(a.acceptedAt) || "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-muted">{a.source || "app"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {current && (
        <LinkDialog link={current} canAct={current.kind === "driver" ? canPeople : canFleet} onClose={() => setSelected(null)} onToast={show} />
      )}
    </div>
  );
}

// ── Start a link ─────────────────────────────────────────────────────────

interface Found { label: string; lines: string[]; warn?: string }

function StartLink({ vendors, canPeople, canFleet, onDone, onError }: {
  vendors: Vendor[]; canPeople: boolean; canFleet: boolean;
  onDone: (message: string, linkId?: string) => void; onError: (message: string) => void;
}) {
  const [kind, setKind] = useState<"driver" | "vehicle">(canPeople ? "driver" : "vehicle");
  const [subject, setSubject] = useState("");
  const [toVendorId, setToVendorId] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const allowed = kind === "driver" ? canPeople : canFleet;
  const lookup = async () => {
    setBusy(true); setError(""); setFound(null);
    try {
      if (kind === "driver") {
        const r = await callFunction<{ phone: string }, { found: boolean; name?: string; kind?: string; fleet?: string; phoneMask?: string; approved?: boolean; openDuties?: number; onHold?: boolean }>("findPartnerDriver", { phone: subject });
        if (!r.found) setError("No NESAM driver uses that number.");
        else setFound({
          label: `${r.name} · ${r.phoneMask}`,
          lines: [r.kind === "owner_driver" ? "Owner-driver (works for themselves)" : `Driver of ${r.fleet}`, r.approved ? "Approved by NESAM" : "Not approved yet", `${r.openDuties ?? 0} open duties`],
          warn: !r.approved ? "An unapproved driver cannot be linked." : r.onHold ? "This driver is on hold." : (r.openDuties ?? 0) > 0 ? "Open duties must be reassigned before the move." : undefined,
        });
      } else {
        const r = await callFunction<{ plate: string }, { found: boolean; plate?: string; model?: string; owner?: string; verified?: boolean; onHold?: boolean; openDuties?: number; otpReceiver?: { name: string; phoneMask: string } | null }>("findPartnerVehicle", { plate: subject });
        if (!r.found) setError("That vehicle is not on NESAM.");
        else setFound({
          label: `${r.plate}${r.model ? ` · ${r.model}` : ""}`,
          lines: [`Held by: ${r.owner}`, r.verified ? "Verified" : "Not verified", r.otpReceiver ? `Code goes to ${r.otpReceiver.name} (${r.otpReceiver.phoneMask}), last trip driver` : "No recent trip driver — office verification only"],
          warn: r.onHold ? "This vehicle is on hold. Moving it needs an override." : (r.openDuties ?? 0) > 0 ? "Open duties must be reassigned before the move." : undefined,
        });
      }
    } catch (e) { setError(e instanceof ActionError ? e.message : "Lookup failed."); } finally { setBusy(false); }
  };

  const start = async (sendOtp: boolean) => {
    setBusy(true); setError("");
    try {
      const r = await callFunction<unknown, { linkId: string; status?: string; existing?: boolean }>("adminCreatePartnerLink", kind === "driver" ? { kind, phone: subject, toVendorId, sendOtp } : { kind, plate: subject, toVendorId, sendOtp });
      onDone(r.existing ? "An open request for this already exists." : sendOtp ? "Request started. The code was sent." : "Request added to the office queue.", r.linkId);
      setSubject(""); setFound(null);
    } catch (e) { const m = e instanceof ActionError ? e.message : "Could not start the request."; setError(m); onError(m); } finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-xl border border-line shadow-sm p-5 max-w-2xl space-y-4">
      <p className="text-sm text-muted">Start a link on a vendor's behalf, for example when they phone the office. You can send the confirmation code, or put it straight in the queue and approve it yourself with a written reason.</p>
      <div className="flex gap-2">
        {([["driver", "Driver", canPeople], ["vehicle", "Vehicle", canFleet]] as const).map(([k, label, ok]) => (
          <button key={k} disabled={!ok} onClick={() => { setKind(k); setFound(null); setError(""); setSubject(""); }}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border disabled:opacity-40 ${kind === k ? "bg-ink text-white border-ink" : "bg-white border-line-strong"}`}>{label}</button>
        ))}
      </div>
      {!allowed && <Notice tone="warn">Your role does not include {kind === "driver" ? "People" : "Fleet"} access.</Notice>}
      <Field label={kind === "driver" ? "Driver mobile number" : "Vehicle registration number"}>
        <div className="flex gap-2">
          <input className={inputCls} value={subject} onChange={(e) => { setSubject(e.target.value); setFound(null); setError(""); }} placeholder={kind === "driver" ? "10-digit number" : "TN 01 AB 1234"} inputMode={kind === "driver" ? "numeric" : "text"} />
          <button className={secondaryBtn} disabled={busy || !subject.trim() || !allowed} onClick={lookup}>Find</button>
        </div>
      </Field>
      {found && (
        <div className="rounded-lg border border-line p-3 space-y-1">
          <div className="font-semibold text-ink">{found.label}</div>
          {found.lines.map((l) => <div key={l} className="text-sm text-muted">{l}</div>)}
          {found.warn && <Notice tone="warn">{found.warn}</Notice>}
        </div>
      )}
      {found && (
        <Field label="Move to vendor">
          <select className={inputCls} value={toVendorId} onChange={(e) => setToVendorId(e.target.value)}>
            <option value="">Choose an approved vendor</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.companyName || v.id}</option>)}
          </select>
        </Field>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {found && (
        <div className="flex flex-wrap gap-2">
          <button className={primaryBtn} disabled={busy || !toVendorId || !allowed} onClick={() => start(true)}>Send confirmation code</button>
          <button className={secondaryBtn} disabled={busy || !toVendorId || !allowed} onClick={() => start(false)}>Add to office queue</button>
        </div>
      )}
    </div>
  );
}

// ── One request ──────────────────────────────────────────────────────────

function LinkDialog({ link, canAct, onClose, onToast }: { link: PartnerLink; canAct: boolean; onClose: () => void; onToast: (m: string, t?: "success" | "error") => void }) {
  const [events, setEvents] = useState<LinkEvent[]>([]);
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [ack, setAck] = useState(false);
  const [confirm, setConfirm] = useState<"reject" | "cancel" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => onSnapshot(query(collection(db, "partner_links", link.id, "events"), orderBy("at", "asc")), (snap) =>
    setEvents(snap.docs.map((d) => { const x = d.data(); return { id: d.id, type: str(x.type), actorName: str(x.actorName), actorRole: str(x.actorRole), reason: str(x.reason), method: str(x.method), at: asDate(x.at) }; })),
  () => undefined), [link.id]);

  const open = OPEN.includes(link.status);
  const confirmed = link.kind === "driver" ? link.consent : link.otpVerified;

  const run = async (name: string, data: Record<string, unknown>, ok: string, close = false) => {
    setBusy(true); setError("");
    try {
      const r = await callFunction<unknown, { status?: string; completed?: boolean; message?: string; testCode?: string }>(name, { linkId: link.id, ...data });
      onToast(r.message || ok);
      setCode(""); setConfirm(null);
      if (close) onClose();
    } catch (e) { setError(e instanceof ActionError ? e.message : "That did not work. Try again."); } finally { setBusy(false); }
  };

  const approveNow = () => run("decidePartnerLink", { decision: "approve", override: !confirmed || override, reason }, "Approved.", true);
  const overrideNeeded = !confirmed || override;
  const canApprove = canAct && (!overrideNeeded || (reason.trim().length >= 5 && ack));

  return (
    <Modal title={link.subjectLabel} subtitle={`${link.kind === "driver" ? "Driver" : "Vehicle"} request · ${link.id}`} onClose={onClose} busy={busy} size="lg"
      footer={<button className={secondaryBtn} onClick={onClose} disabled={busy}>Close</button>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-block px-2 py-0.5 rounded-md border text-xs font-semibold ${pill[link.status]}`}>{link.status}</span>
          {link.officeHelp && <span className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-0.5">Vendor asked for help</span>}
          {link.method && <span className="text-xs text-muted">Finished by: {link.method}</span>}
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Info label="From" value={fromLabel(link)} />
          <Info label="To vendor" value={link.toVendorName} />
          <Info label="Requested by" value={`${link.requestedByName} (${link.requestedByRole})`} />
          <Info label="Asked" value={formatDateTime12(link.createdAt) || "—"} />
          {link.kind === "driver"
            ? <Info label="Driver consent" value={link.consent ? "Confirmed with a code" : "Not confirmed"} tone={link.consent ? "ok" : "warn"} />
            : <Info label="Last-trip driver code" value={link.otpVerified ? "Confirmed" : link.hasReceiver ? `Not confirmed — to ${link.receiverName} ${link.receiverPhoneMask}` : "No recent driver to ask"} tone={link.otpVerified ? "ok" : "warn"} />}
          {link.kind === "driver" && <Info label="Mobile" value={link.subjectPhoneMask || "—"} />}
        </div>

        {link.blockedReason && open && <Notice tone="warn">{link.blockedReason}</Notice>}
        {link.overrideReason && <Notice tone="info">Override reason: {link.overrideReason}</Notice>}
        {link.rejectedReason && <Notice tone="error">Declined: {link.rejectedReason}</Notice>}
        {link.blockedReason.includes("duties") && open && <p className="text-xs text-muted">Reassign the open duties from Bookings first, then approve. An override never moves a car or driver that has an open duty.</p>}

        {open && canAct && (
          <div className="rounded-lg border border-line p-4 space-y-3">
            <div className="text-sm font-bold text-ink">Decision</div>
            {link.hasReceiver || link.kind === "driver" ? (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Code the driver read out" className="min-w-[10rem]">
                  <input className={inputCls} value={code} inputMode="numeric" maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="6 digits" />
                </Field>
                <button className={secondaryBtn} disabled={busy || code.length !== 6} onClick={() => run("verifyPartnerLinkOtp", { code }, "Code confirmed.")}>Verify code</button>
                <button className={secondaryBtn} disabled={busy} onClick={() => run("resendPartnerLinkOtp", {}, "A new code was sent.")}>Send a new code</button>
              </div>
            ) : null}

            {!confirmed && <Notice tone="warn">{link.kind === "driver" ? "The driver's consent is not confirmed yet." : "The last-trip driver has not confirmed with a code."} You can still approve with an override, which is recorded with your name and reason.</Notice>}
            {confirmed && (
              <label className="flex items-center gap-2 text-sm text-body"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Approve as an override (hold or verification skipped)</label>
            )}
            {overrideNeeded && (
              <>
                <Field label="Reason for the override" hint="At least 5 characters. It is kept in the history.">
                  <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Driver confirmed on a recorded call" />
                </Field>
                <label className="flex items-start gap-2 text-sm text-body"><input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I am moving this without the normal code check. This is recorded against my name.</label>
              </>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            <div className="flex flex-wrap gap-2">
              <button className={primaryBtn} disabled={busy || !canApprove} onClick={approveNow}>{overrideNeeded ? "Approve with override" : "Approve"}</button>
              <button className="px-4 py-2.5 border border-red-300 text-red-700 rounded-lg text-sm font-semibold hover:bg-red-50 disabled:opacity-50" disabled={busy} onClick={() => setConfirm("reject")}>Decline</button>
              <button className={secondaryBtn} disabled={busy} onClick={() => setConfirm("cancel")}>Cancel request</button>
            </div>
          </div>
        )}
        {open && !canAct && <Notice tone="warn">Your role cannot decide this kind of request.</Notice>}

        <div>
          <div className="text-sm font-bold text-ink mb-2">History</div>
          {events.length === 0 ? <p className="text-sm text-muted">No events yet.</p> : (
            <ol className="space-y-2">
              {events.map((e) => (
                <li key={e.id} className="text-sm border-l-2 border-line pl-3">
                  <div className="font-semibold text-ink capitalize">{e.type.replace(/_/g, " ")}{e.method ? ` · ${e.method}` : ""}</div>
                  <div className="text-xs text-muted">{e.actorName} ({e.actorRole}) · {formatDateTime12(e.at) || "—"}</div>
                  {e.reason && <div className="text-xs text-muted">“{e.reason}”</div>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {confirm === "reject" && (
        <RejectDialog busy={busy} error={error} onCancel={() => setConfirm(null)} onConfirm={(r) => run("decidePartnerLink", { decision: "reject", reason: r }, "Declined.", true)} />
      )}
      {confirm === "cancel" && (
        <ConfirmDialog title="Cancel this request?" message="The vendor will see it as cancelled and any pending code stops working." confirmLabel="Cancel request" danger busy={busy} error={error}
          onCancel={() => setConfirm(null)} onConfirm={() => run("cancelPartnerLink", {}, "Request cancelled.", true)} />
      )}
    </Modal>
  );
}

function RejectDialog({ busy, error, onCancel, onConfirm }: { busy: boolean; error: string; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal title="Decline this request" onClose={onCancel} busy={busy}
      footer={<><button className={secondaryBtn} onClick={onCancel} disabled={busy}>Back</button><button className={primaryBtn} disabled={busy || reason.trim().length < 3} onClick={() => onConfirm(reason.trim())}>Decline</button></>}>
      <Field label="Reason shown to the vendor" required>
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
    </Modal>
  );
}

function Info({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={`font-semibold ${tone === "ok" ? "text-green-700" : tone === "warn" ? "text-amber-800" : "text-ink"}`}>{value}</div>
    </div>
  );
}

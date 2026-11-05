import DateTime12Input from "../DateTime12Input";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage, auth } from "../../services/firebase";
import type { Booking, Driver, Vehicle, Vendor } from "../../types";
import { useOfficeData } from "../../hooks/useOfficeData";
import { subscribeWallets, walletKey, type Wallet } from "../../services/earningsService";
import Statement from "../accounts/Statement";
import { subscribeStaffAccounts } from "../../services/staffService";
import {
  ACCOUNTS, APPROVALS, DURATIONS, HOLD_REASONS, accountOf, approvalOf, changeAccount, closeFullFinal, decideApproval, disputeOf, editPartnerProfile, isHold,
  transferAttachment, type Account, type AccountAction, type Approval, type HistoryEntry, type PartnerKind, type Raw,
} from "../../domain/partners";
import { refDateTime, rupee, tripTypeOf } from "../../domain/officeStage";
import { bookingPickupDate, isoDateIST } from "../../utils/time";
import { ErrorBanner, Modal, Toast, useToast } from "../Feedback";
import { Badge, Button, DataTable, EmptyState, Icon, PageHeader, Tabs, TableSkeleton, toneForStatus } from "../ui";
import { StageBar } from "../ui/ListKit";
import { useAccess, useAccountControl } from "../AccessContext";
import { ExportDialog, Initials, SimplePager, useSelection, type ExportSpec } from "../ui/RecordKit";

// ── Normalised record ─────────────────────────────────────────────────────

export interface PartnerRow {
  id: string;
  kind: PartnerKind;
  name: string;
  /** Permanent ID: DL number for drivers, registration for vehicles, vendor code. */
  code: string;
  phone: string;
  email: string;
  linked: string;
  linkedId: string;
  approval: Approval;
  account: Account;
  dispute: string;
  raw: Raw;
}

const s = (v: unknown) => (typeof v === "string" ? v : "");

function rowOf(kind: PartnerKind, raw: Raw, vendors: Map<string, Vendor>): PartnerRow {
  const vendor = vendors.get(s(raw.vendorId));
  if (kind === "vendor") {
    const v = raw as unknown as Vendor & Raw;
    return { id: v.id, kind, name: v.companyName || v.name || "Vendor", code: s(raw.vendorCode) || `NSM-VN-${v.id.slice(0, 6).toUpperCase()}`, phone: v.phone || "", email: v.email || "", linked: v.companyName || v.name || "", linkedId: v.id, approval: approvalOf(kind, raw), account: accountOf(kind, raw), dispute: disputeOf(raw), raw };
  }
  if (kind === "vehicle") {
    const v = raw as unknown as Vehicle & Raw;
    return { id: v.id, kind, name: v.vehicleNumber || v.number || "Vehicle", code: v.vehicleNumber || v.number || v.id, phone: "", email: "", linked: v.vendorName || vendor?.companyName || vendor?.name || s(raw.assignedDriverName) || "NESAM fleet", linkedId: v.vendorId || "", approval: approvalOf(kind, raw), account: accountOf(kind, raw), dispute: disputeOf(raw), raw };
  }
  const d = raw as unknown as Driver & Raw;
  return { id: d.id, kind, name: d.name || "Driver", code: d.licenseNumber || d.license || d.id.slice(0, 12), phone: d.phone || "", email: s(raw.email), linked: vendor?.companyName || vendor?.name || s(raw.vendor) || "", linkedId: d.vendorId || "", approval: approvalOf(kind, raw), account: accountOf(kind, raw), dispute: disputeOf(raw), raw };
}

const CONFIG: Record<PartnerKind, { title: string; subtitle: string; plural: string; singular: string; add?: string; idLabel: string }> = {
  driver: { title: "Driver Partners", subtitle: "DL number is the Driver ID. Approval, account status and dispute remain separate.", plural: "Driver Partners", singular: "Driver Partner", add: "Add driver", idLabel: "Driver ID" },
  "vendor-driver": { title: "Vendor Drivers", subtitle: "DL number is the Driver ID. Approval, account status and dispute remain separate.", plural: "Vendor Drivers", singular: "Vendor Driver", add: "Add driver", idLabel: "Driver ID" },
  vendor: { title: "Vendors", subtitle: "Vendor applications, approval decisions and separate account controls.", plural: "Vendors", singular: "Vendor", idLabel: "Permanent ID" },
  vehicle: { title: "Vehicles", subtitle: "Registration is the vehicle ID. Approval and account restrictions stay separate.", plural: "Vehicles", singular: "Vehicle", add: "Add vehicle", idLabel: "Vehicle ID" },
};

type ApprovalTab = Approval | "Suspended" | "All";
const PAGE = 10;

// ── Duties for a partner ──────────────────────────────────────────────────

function dutiesOf(row: PartnerRow, bookings: Booking[]): Booking[] {
  return bookings.filter((b) =>
    row.kind === "vendor" ? b.assignedVendorId === row.id
    : row.kind === "vehicle" ? b.assignedVehicleId === row.id
    : b.assignedDriverId === row.id,
  );
}

const ACTIVE = ["Approved", "Confirmed", "Assigned", "Ongoing"];

// ── Registry page ─────────────────────────────────────────────────────────

export default function PartnerRegistry({ kind, onOpenBooking, onNavigate, aside, initialProfile }: {
  kind: PartnerKind;
  /** Opens this record's profile straight away (a "Driver profile" / "Vehicle profile" link from another page). */
  initialProfile?: string;
  onOpenBooking: (id: string) => void;
  onNavigate?: (page: string, tab?: string) => void;
  /** Extra header actions (e.g. the detailed KYC review desk the app had before). */
  aside?: ReactNode;
}) {
  const cfg = CONFIG[kind];
  const data = useOfficeData();
  const { toast, show } = useToast(7000);
  const [tab, setTab] = useState<ApprovalTab>("All");
  const [q, setQ] = useState("");
  const [account, setAccount] = useState<"All" | Account>("All");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [profile, setProfile] = useState<string | null>(initialProfile ?? null);
  const [sheet, setSheet] = useState<{ kind: "review" | "add"; id?: string } | null>(null);
  const sel = useSelection();

  const rows = useMemo<PartnerRow[] | null>(() => {
    const src: Raw[] | null =
      kind === "vendor" ? (data.vendors as unknown as Raw[])
      : kind === "vehicle" ? (data.vehicles as unknown as Raw[])
      : (data.drivers as unknown as Raw[]).filter((d) => (kind === "vendor-driver" ? !!s(d.vendorId) : !s(d.vendorId)));
    if (data.bookings === null && !src.length) return null;
    return src.map((r) => rowOf(kind, r, data.vendorById)).sort((a, b) => a.name.localeCompare(b.name));
  }, [kind, data.vendors, data.vehicles, data.drivers, data.vendorById, data.bookings]);

  const all = rows ?? [];
  const inTab = (r: PartnerRow) => tab === "All" || (tab === "Suspended" ? r.account === "Suspended" : r.approval === tab);
  const counts = useMemo(() => {
    const c: Record<string, number> = { All: all.length, Suspended: all.filter((r) => r.account === "Suspended").length };
    for (const a of APPROVALS) c[a] = all.filter((r) => r.approval === a).length;
    return c;
  }, [all]);
  const filtered = all
    .filter(inTab)
    .filter((r) => account === "All" || r.account === account)
    .filter((r) => {
      const t = q.trim().toLowerCase();
      if (!t) return true;
      const d = t.replace(/\D/g, "");
      return [r.name, r.code, r.email, r.linked, r.id].some((v) => v.toLowerCase().includes(t)) || (d.length >= 4 && r.phone.replace(/\D/g, "").includes(d));
    });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const cur = Math.min(page, pages);
  const shown = filtered.slice((cur - 1) * PAGE, cur * PAGE);
  const tabs: { id: ApprovalTab; label: string; count: number }[] = [
    { id: "Unapproved", label: `Unapproved ${cfg.plural}`, count: counts.Unapproved },
    { id: "Changes requested", label: "Changes requested", count: counts["Changes requested"] },
    { id: "Approved", label: "Approved", count: counts.Approved },
    { id: "Rejected", label: "Rejected", count: counts.Rejected },
    { id: "Suspended", label: "Suspended", count: counts.Suspended },
    { id: "Incomplete", label: "Incomplete", count: counts.Incomplete },
    { id: "All", label: "All", count: counts.All },
  ];

  const spec: ExportSpec<PartnerRow> = {
    scope: cfg.plural,
    headers: [cfg.idLabel, "Name", "Mobile", "Email", kind === "vendor" ? "City" : "Linked", "Approval", "Account", "Dispute"],
    row: (r) => [r.code, r.name, r.phone, r.email, kind === "vendor" ? s(r.raw.city) : r.linked, r.approval, r.account, r.dispute],
  };

  const fleetOf = (vendorId: string) => ({ vehicles: data.vehicles.filter((v) => v.vendorId === vendorId).length, drivers: data.drivers.filter((d) => d.vendorId === vendorId).length });
  const current = all.find((r) => r.id === profile) ?? null;
  const reviewing = all.find((r) => r.id === sheet?.id) ?? null;

  const head = (() => {
    switch (kind) {
      case "driver": return ["PARTNER / DL", "CONTACT", "OWN VEHICLE", "APPROVAL", "ACCOUNT / DISPUTE"];
      case "vendor-driver": return ["DRIVER / DL", "CONTACT", "LINKED VENDOR", "APPROVAL", "ACCOUNT / DISPUTE"];
      case "vendor": return ["VENDOR / ID", "CONTACT / CITY", "FLEET", "APPROVAL", "ACCOUNT / DISPUTE"];
      case "vehicle": return ["REGISTRATION / MODEL", "CATEGORY", "LINKED PARTNER", "DOCUMENTS", "APPROVAL / ACCOUNT"];
    }
  })();

  const cells = (r: PartnerRow): ReactNode[] => {
    const statusCells = [
      <Badge key="a" tone={toneForStatus(r.approval)}>{r.approval}</Badge>,
      <><Badge tone={toneForStatus(r.account === "Active" ? "Active" : r.account)}>{r.account}</Badge>{r.dispute !== "None" && <small>Dispute {r.dispute.toLowerCase()}</small>}</>,
    ];
    if (kind === "vehicle") {
      const v = r.raw as unknown as Vehicle;
      const exp = [v.insuranceExpiry, v.fitnessExpiry, v.permitExpiry].filter(Boolean).some((x) => Date.parse(x!) < Date.now());
      return [
        <div className="ds-person"><Initials name={r.name} /><div><strong>{r.name}</strong><small>{v.model || v.make || "Model not recorded"}</small></div></div>,
        <strong>{v.category || "—"}</strong>,
        <>{r.linked}</>,
        <Badge tone={exp ? "red" : r.approval === "Approved" ? "green" : "amber"}>{exp ? "Expired" : r.approval === "Approved" ? "Verified" : "Pending"}</Badge>,
        <div className="grid gap-1 text-[11px]"><span className="text-faint">Approval</span><Badge tone={toneForStatus(r.approval)}>{r.approval}</Badge><span className="text-faint">Account</span><Badge tone={toneForStatus(r.account)}>{r.account}</Badge></div>,
      ];
    }
    const person = <div className="ds-person"><Initials name={r.name} /><div><strong>{r.name}</strong><small>{kind === "vendor" ? r.code : r.code}</small></div></div>;
    const contact = <><strong>{r.phone || "Not provided"}</strong><small>{r.email || "Email not supplied"}{kind === "vendor" && s(r.raw.city) ? ` · ${s(r.raw.city)}` : ""}</small></>;
    if (kind === "vendor") {
      const f = fleetOf(r.id);
      return [person, contact, <><strong>{f.vehicles} vehicles</strong><small>{f.drivers} drivers</small></>, ...statusCells];
    }
    if (kind === "driver") {
      const d = r.raw as unknown as Driver;
      const v = d.assignedVehicleId ? data.vehicleById.get(d.assignedVehicleId) : undefined;
      return [person, contact, <><strong>{d.assignedVehicleNumber || d.vehicleNumber || "Not attached"}</strong><small>{v?.model || d.vehicleType || ""}</small></>, ...statusCells];
    }
    return [person, contact, <>{r.linked || "Not linked"}</>, ...statusCells];
  };

  return (
    <div className="ds-page-body">
      <Toast toast={toast} />
      {data.error && <ErrorBanner message={data.error} />}
      <PageHeader title={cfg.title} subtitle={cfg.subtitle} actions={<>{aside}<Button icon="download" onClick={() => setExporting(true)}>Export data</Button>{cfg.add && <Button variant="primary" icon="plus" onClick={() => setSheet({ kind: "add" })}>{cfg.add}</Button>}</>} />
      <StageBar label="Approval" tabs={tabs} value={tab} onChange={(t) => { setTab(t); setPage(1); }} />
      <div className="ds-filterbar" role="search">
        <div className="ds-search" style={{ flex: "1 1 320px" }}>
          <Icon name="search" />
          <input type="search" className="ds-input" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={kind === "vehicle" ? "Registration, model or partner" : kind === "vendor" ? "Vendor name, mobile or ID" : "Name, mobile, DL number"} aria-label={`Search ${cfg.plural}`} />
        </div>
        <label className="ds-field"><span>Account status</span>
          <select className="ds-select" value={account} onChange={(e) => { setAccount(e.target.value as typeof account); setPage(1); }}>{["All", ...ACCOUNTS].map((a) => <option key={a}>{a}</option>)}</select>
        </label>
      </div>
      <div className="ds-toolbar-count">
        <strong>{filtered.length} records · {sel.ids.size} selected</strong>
        <Button variant="ghost" size="sm" icon="rotate-ccw" disabled={!q && account === "All" && tab === "All" && !sel.ids.size} onClick={() => { setQ(""); setAccount("All"); setTab("All"); sel.clear(); }}>Clear filters</Button>
      </div>
      {rows === null ? <div className="ds-panel"><TableSkeleton rows={4} cols={5} /></div> : filtered.length === 0 ? <div className="ds-panel"><EmptyState /></div> : (
        <DataTable label={cfg.plural} minWidth={1060} fixed hasActions>
          <colgroup><col style={{ width: 44 }} /><col style={{ width: 240 }} /><col style={{ width: 190 }} /><col style={{ width: 170 }} /><col style={{ width: 120 }} /><col style={{ width: 140 }} /><col style={{ width: 160 }} /></colgroup>
          <thead><tr>
            <th className="ds-check-cell"><input type="checkbox" aria-label="Select visible records" checked={shown.length > 0 && shown.every((r) => sel.has(r.id))} onChange={(e) => sel.setAll(shown.map((r) => r.id), e.target.checked)} /></th>
            {head.map((h) => <th key={h}>{h}</th>)}
            <th className="ds-actions">ACTIONS</th>
          </tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.id} className="ds-row-stripe" data-tone={isHold(r.account) ? "red" : r.approval === "Approved" ? undefined : "amber"}>
              <td className="ds-check-cell"><input type="checkbox" aria-label={`Select ${r.name}`} checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} /></td>
              {cells(r).map((c, i) => <td key={i}>{c}</td>)}
              <td className="ds-actions"><div><Button size="sm" onClick={() => setProfile(r.id)}>View</Button><Button size="sm" variant="ghost" onClick={() => setSheet({ kind: "review", id: r.id })}>Review</Button></div></td>
            </tr>
          ))}</tbody>
        </DataTable>
      )}
      {filtered.length > 0 && <SimplePager page={cur} pages={pages} from={(cur - 1) * PAGE + 1} to={Math.min(cur * PAGE, filtered.length)} total={filtered.length} onPage={setPage} />}

      {exporting && <ExportDialog spec={spec} all={all} filtered={filtered} selected={all.filter((r) => sel.has(r.id))} filters={{ tab, account, q }} onClose={() => setExporting(false)} />}
      {current && <PartnerProfile row={current} onClose={() => setProfile(null)} onOpenBooking={onOpenBooking} onNavigate={onNavigate} onReview={() => setSheet({ kind: "review", id: current.id })} onToast={show} />}
      {sheet?.kind === "review" && reviewing && <ReviewSheet row={reviewing} onClose={() => setSheet(null)} onDone={(t) => { setSheet(null); show(t); }} />}
      {sheet?.kind === "add" && <AddSheet kind={kind} onClose={() => setSheet(null)} onDone={(t) => { setSheet(null); show(t); }} />}
    </div>
  );
}

// ── Profile ───────────────────────────────────────────────────────────────

type PTab = "Overview" | "Vehicles" | "Fleet" | "Wallet" | "Duties" | "Accounts" | "Documents" | "Controls" | "Status history" | "Transfers";

function tabsFor(kind: PartnerKind): PTab[] {
  if (kind === "vendor") return ["Overview", "Fleet", "Wallet", "Duties", "Accounts", "Documents", "Controls", "Status history"];
  if (kind === "vehicle") return ["Overview", "Documents", "Duties", "Controls", "Status history", "Transfers"];
  return ["Overview", "Vehicles", "Duties", "Accounts", "Documents", "Controls", "Status history", "Transfers"];
}

function ProfileHead({ row }: { row: PartnerRow }) {
  return (
    <div className="ds-profile-head">
      <Initials name={row.name} />
      <div><strong>{row.name}</strong><small>{CONFIG[row.kind].idLabel} · {row.code} · {CONFIG[row.kind].plural}</small></div>
      <Badge tone={toneForStatus(row.account)}>{row.account}</Badge>
    </div>
  );
}

function StatusStrip({ row }: { row: PartnerRow }) {
  const hist = ((row.raw.statusHistory as HistoryEntry[] | undefined) ?? []).slice(-1)[0];
  return (
    <div className="ds-panel ds-panel-pad mb-4">
      <dl className="ds-facts" data-cols={3}>
        <div><dt>ACCOUNT STATUS</dt><dd>{row.account}</dd></div>
        <div><dt>DISPUTE STATUS</dt><dd>{row.dispute}</dd></div>
        <div><dt>NEW DUTY ACCESS</dt><dd>{isHold(row.account) ? "On hold" : "No account hold"}</dd></div>
      </dl>
      <p className="text-[11px] text-faint mt-2">Final duty eligibility checks still apply.</p>
      <p className="text-[11px] text-muted mt-1">{hist ? `${hist.action} · ${hist.byName} · ${refDateTime(hist.at)}` : "No status change recorded"}</p>
    </div>
  );
}

function PartnerProfile({ row, onClose, onOpenBooking, onNavigate, onReview, onToast }: {
  row: PartnerRow; onClose: () => void; onOpenBooking: (id: string) => void; onNavigate?: (page: string, tab?: string) => void; onReview: () => void; onToast: (t: string) => void;
}) {
  const data = useOfficeData();
  const [tab, setTab] = useState<PTab>("Overview");
  const [sheet, setSheet] = useState<"account" | "edit" | "ff" | "panel" | "transfer" | null>(null);
  const [action, setAction] = useState<AccountAction>("Suspend ID");
  const duties = useMemo(() => dutiesOf(row, data.bookings ?? []), [row, data.bookings]);
  const cfg = CONFIG[row.kind];
  const d = row.raw as unknown as Driver & Vehicle & Vendor & Raw;
  const phone = row.phone;
  const control = (a: AccountAction) => { setAction(a); setSheet("account"); };

  const overview = (
    <>
      <StatusStrip row={row} />
      <dl className="ds-facts" data-cols={2}>
        {([
          [row.kind === "vehicle" ? "Vehicle ID · registration" : row.kind === "vendor" ? "Permanent ID" : "Driver ID · DL number", row.code],
          ["Role", cfg.plural],
          ["Registered mobile", phone || "Not provided"],
          ["Email", row.email || "Not supplied"],
          ["Status", row.account],
          ["Linked business", row.kind === "driver" ? `${row.name} · Owner Driver` : row.linked || "—"],
          ...(row.kind === "vehicle" ? [["Make / model", [d.make, d.model].filter(Boolean).join(" · ") || "Not recorded"], ["Category", d.category || "—"], ["Roof carrier", (row.raw.roofCarrier as boolean) ? "Available" : "Not available"]] as const
            : row.kind === "vendor" ? [["City", d.city || "—"], ["GSTIN", d.gstin || d.gst || "Not supplied"]] as const
            : [["Driving licence", d.licenseNumber || d.license || "—"], ["Licence valid until", d.licenseExpiry || "—"]] as const),
        ] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <div className="flex flex-wrap gap-2 mt-5">
        <Button icon="shield-x" onClick={() => control(isHold(row.account) ? "Reactivate ID" : "Suspend ID")}>{isHold(row.account) ? "Reactivate ID" : "Suspend ID"}</Button>
        <Button icon="flag" onClick={() => control(row.dispute === "Open" ? "Resolve dispute" : "Open dispute")}>{row.dispute === "Open" ? "Resolve dispute" : "Open dispute"}</Button>
        <Button variant="ghost" icon="settings-2" onClick={() => control("Mark inactive")}>More controls</Button>
        <Button variant="ghost" icon="pencil" onClick={() => setSheet("edit")}>Edit profile</Button>
        {row.kind !== "vehicle" && <Button variant="ghost" icon="file-check-2" onClick={() => setSheet("ff")}>Full &amp; Final</Button>}
      </div>
      {row.kind !== "vehicle" && (
        <div className="flex flex-wrap gap-2 mt-2">
          <Button variant="ghost" icon="file-text" onClick={() => setTab("Accounts")}>View account statement</Button>
          <Button variant="ghost" icon="route" onClick={() => setTab("Duties")}>View duties</Button>
          <Button variant="ghost" icon="eye" onClick={() => setSheet("panel")}>View partner panel</Button>
          {phone ? <a className="ds-btn ds-btn-ghost" href={`tel:${phone.replace(/[^\d+]/g, "")}`}><Icon name="phone" size={14} />Call {cfg.singular}</a> : null}
        </div>
      )}
      <p className="text-[11px] text-faint mt-2">Partner panel opens in read-only mode.</p>
      <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-line">
        <span className="text-[12px] text-muted">Approval</span><Badge tone={toneForStatus(row.approval)}>{row.approval}</Badge>
        <Button size="sm" onClick={onReview}>Review approval</Button>
        {row.kind !== "vehicle" && <Button size="sm" variant="ghost" onClick={() => setTab("Accounts")}>Monthly statement</Button>}
        {row.kind !== "vendor" && <Button size="sm" variant="ghost" onClick={() => setSheet("transfer")}>Transfer attachment</Button>}
      </div>
    </>
  );

  return (
    <Modal title={`${cfg.singular} profile`} onClose={onClose} wide>
      <ProfileHead row={row} />
      <Tabs<PTab> label={`${cfg.singular} profile`} value={tab} onChange={setTab} tabs={tabsFor(row.kind).map((t) => ({ id: t, label: t }))} />
      {tab === "Overview" && overview}
      {(tab === "Vehicles" || tab === "Fleet") && <FleetTab row={row} />}
      {tab === "Wallet" && <WalletTab row={row} />}
      {tab === "Duties" && <DutiesTab row={row} duties={duties} onOpenBooking={(id) => { onClose(); onOpenBooking(id); }} onPanel={() => setSheet("panel")} />}
      {tab === "Accounts" && <StatementTab row={row} onNavigate={onNavigate} />}
      {tab === "Documents" && <DocumentsTab row={row} onOpen={() => { onClose(); onNavigate?.("verification"); }} />}
      {tab === "Controls" && (
        <>
          <StatusStrip row={row} />
          <div className="flex flex-wrap gap-2">
            <Button icon="shield-x" onClick={() => control(isHold(row.account) ? "Reactivate ID" : "Suspend ID")}>{isHold(row.account) ? "Reactivate ID" : "Suspend ID"}</Button>
            <Button icon="flag" onClick={() => control(row.dispute === "Open" ? "Resolve dispute" : "Open dispute")}>{row.dispute === "Open" ? "Resolve dispute" : "Open dispute"}</Button>
            <Button variant="ghost" icon="settings-2" onClick={() => control("Mark inactive")}>More controls</Button>
          </div>
          <p className="text-[11px] text-faint mt-4">View record · {refDateTime(new Date())} · {auth.currentUser?.displayName || auth.currentUser?.email} · {row.code}</p>
        </>
      )}
      {tab === "Status history" && <HistoryTab row={row} />}
      {tab === "Transfers" && <TransfersTab row={row} onNew={() => setSheet("transfer")} />}

      {sheet === "account" && <AccountSheet row={row} initial={action} duties={duties.filter((b) => ACTIVE.includes(b.status))} onClose={() => setSheet(null)} onDone={(t) => { setSheet(null); onToast(t); }} />}
      {sheet === "edit" && <EditSheet row={row} onClose={() => setSheet(null)} onDone={(t) => { setSheet(null); onToast(t); }} />}
      {sheet === "ff" && <FullFinalSheet row={row} duties={duties} onClose={() => setSheet(null)} onDone={(t) => { setSheet(null); onToast(t); }} />}
      {sheet === "panel" && <PartnerPanelSheet row={row} onClose={() => setSheet(null)} />}
      {sheet === "transfer" && row.kind !== "vendor" && <TransferSheet row={row} duties={duties.filter((b) => ACTIVE.includes(b.status))} onClose={() => setSheet(null)} onDone={(t) => { setSheet(null); onToast(t); }} />}
    </Modal>
  );
}

function FleetTab({ row }: { row: PartnerRow }) {
  const data = useOfficeData();
  const vehicles = row.kind === "vendor" ? data.vehicles.filter((v) => v.vendorId === row.id) : data.vehicles.filter((v) => v.assignedDriverId === row.id || v.id === (row.raw as unknown as Driver).assignedVehicleId);
  const drivers = row.kind === "vendor" ? data.drivers.filter((x) => x.vendorId === row.id) : [];
  return (
    <>
      <h3 className="text-[14px] font-bold text-ink mb-2">Linked vehicles</h3>
      {vehicles.length === 0 ? <EmptyState title="No vehicle linked" /> : (
        <DataTable label="Linked vehicles" minWidth={520} hideTools>
          <thead><tr><th>REGISTRATION / MODEL</th><th>CATEGORY</th><th>STATUS</th></tr></thead>
          <tbody>{vehicles.map((v) => <tr key={v.id}><td><strong>{v.vehicleNumber || v.number}</strong><small>{v.model || v.make}</small></td><td>{v.category}</td><td><Badge tone={toneForStatus(accountOf("vehicle", v as unknown as Raw))}>{accountOf("vehicle", v as unknown as Raw)}</Badge></td></tr>)}</tbody>
        </DataTable>
      )}
      {row.kind === "vendor" && (
        <>
          <h3 className="text-[14px] font-bold text-ink mt-5 mb-2">Linked drivers</h3>
          {drivers.length === 0 ? <EmptyState title="No driver linked" /> : (
            <DataTable label="Linked drivers" minWidth={520} hideTools>
              <thead><tr><th>DRIVER / DL</th><th>MOBILE</th><th>APPROVAL / ACCOUNT</th></tr></thead>
              <tbody>{drivers.map((x) => <tr key={x.id}><td><strong>{x.name}</strong><small>{x.licenseNumber}</small></td><td>{x.phone}</td><td><Badge tone={toneForStatus(approvalOf("vendor-driver", x as unknown as Raw))}>{approvalOf("vendor-driver", x as unknown as Raw)}</Badge> <Badge tone={toneForStatus(accountOf("vendor-driver", x as unknown as Raw))}>{accountOf("vendor-driver", x as unknown as Raw)}</Badge></td></tr>)}</tbody>
            </DataTable>
          )}
        </>
      )}
    </>
  );
}

function WalletTab({ row }: { row: PartnerRow }) {
  const [wallets, setWallets] = useState<Map<string, Wallet> | null>(null);
  useEffect(() => subscribeWallets(setWallets, () => setWallets(new Map())), []);
  const w = wallets?.get(walletKey(row.kind === "vendor" ? "vendor" : "driver", row.id));
  if (wallets === null) return <p className="text-[12px] text-muted">Loading wallet…</p>;
  if (!w) return <EmptyState title="No wallet entries yet" hint="The wallet opens with the first verified trip earning." />;
  return (
    <dl className="ds-facts" data-cols={3}>
      {([["Available", w.available], ["Pending", w.pending], ["Reserved for payout", w.reserved], ["Paid out", w.paidOut], ["Cash collected", w.cashCollected], ["Trip earnings", w.tripEarnings]] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{rupee(v)}</dd></div>)}
    </dl>
  );
}

function DutiesTab({ row, duties, onOpenBooking, onPanel }: { row: PartnerRow; duties: Booking[]; onOpenBooking: (id: string) => void; onPanel: () => void }) {
  const [f, setF] = useState<"Upcoming" | "On trip" | "Completed" | "Cancelled / Removed">("Upcoming");
  const [pendingOnly, setPendingOnly] = useState(false);
  const group = (b: Booking) => (b.status === "Ongoing" ? "On trip" : b.status === "Completed" ? "Completed" : ["Cancelled", "Rejected"].includes(b.status) ? "Cancelled / Removed" : "Upcoming");
  const counts = { Upcoming: 0, "On trip": 0, Completed: 0, "Cancelled / Removed": 0 } as Record<string, number>;
  duties.forEach((b) => counts[group(b)]++);
  const pending = duties.filter((b) => group(b) === "Upcoming" && !b.assignedDriverId).length;
  const list = duties.filter((b) => group(b) === f).filter((b) => !pendingOnly || !b.assignedDriverId).sort((a, z) => (bookingPickupDate(a)?.getTime() ?? 0) - (bookingPickupDate(z)?.getTime() ?? 0));
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div><strong className="text-[15px] text-ink">{row.kind === "vehicle" ? "Vehicle duties" : "Partner duties"}</strong><p className="text-[12px] text-muted">Upcoming {counts.Upcoming} · Assignment pending {pending} · On trip {counts["On trip"]}</p></div>
        {row.kind !== "vehicle" && <Button size="sm" icon="eye" onClick={onPanel}>View partner panel</Button>}
      </div>
      <div className="ds-chip-row">{(["Upcoming", "On trip", "Completed", "Cancelled / Removed"] as const).map((k) => <Button key={k} size="sm" variant={f === k ? "primary" : "secondary"} onClick={() => setF(k)}>{k} · {counts[k]}</Button>)}</div>
      <div className="flex items-center justify-between mb-2 text-[12px] text-muted"><span>{list.length} allocation{list.length === 1 ? "" : "s"} · Earliest pickup first</span><label className="ds-check"><input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} />Assignment pending only</label></div>
      {list.length === 0 ? <p className="text-[13px] text-muted">No duties in this selection.</p> : (
        <DataTable label="Duties" minWidth={900} fixed hasActions>
          <thead><tr><th>PICKUP DATE / TIME · IST</th><th>ROUTE / DUTY</th><th>TRIP TYPE / CAR</th><th>ACCEPTED AT · IST</th><th>DRIVER + CAB</th><th className="ds-actions">ACTION</th></tr></thead>
          <tbody>{list.map((b) => (
            <tr key={b.id}>
              <td>{refDateTime(bookingPickupDate(b))}<small>{b.bookingId || b.id}</small></td>
              <td><strong>{b.pickup} → {b.drop}</strong><small>{b.pricing?.includedKm ? `${b.pricing.includedKm} km included` : ""}</small></td>
              <td><strong>{tripTypeOf(b)}</strong><small>{b.vehicleCategory || b.vehicle} · Payout {rupee(Number(b.vendorPayout || b.driverPayout) || null)}</small></td>
              <td>{refDateTime((b as Booking & { acceptedAt?: never }).acceptedAt) || "Not recorded"}</td>
              <td><strong>{b.assignedDriverName || "Driver pending"}</strong><small>{b.assignedVehicleNumber || "Cab pending"}</small></td>
              <td className="ds-actions"><div><Button size="sm" onClick={() => onOpenBooking(b.id)}>View duty</Button></div></td>
            </tr>
          ))}</tbody>
        </DataTable>
      )}
      <p className="text-[11px] text-faint mt-3">Removed allocations retain their original driver, cab and payout. View duty opens the current booking.</p>
    </>
  );
}

function StatementTab({ row }: { row: PartnerRow; onNavigate?: (page: string, tab?: string) => void }) {
  return <Statement account={{ type: row.kind === "vendor" ? "vendor" : "driver", id: row.id, name: row.name }} code={row.code} />;
}

function DocumentsTab({ row, onOpen }: { row: PartnerRow; onOpen: () => void }) {
  const r = row.raw as unknown as Driver & Vehicle & Raw;
  const docs: [string, string | undefined][] = row.kind === "vehicle"
    ? [["Registration certificate", s(r.rcExpiry) || undefined], ["Insurance", r.insuranceExpiry], ["Fitness certificate", r.fitnessExpiry], ["Permit", r.permitExpiry]]
    : row.kind === "vendor" ? [["Business registration", undefined], ["GST certificate", undefined], ["Owner ID", undefined]]
    : [["Driving licence", r.licenseExpiry]];
  const dates = docs.map(([, d]) => d).filter(Boolean) as string[];
  const soonest = dates.sort()[0];
  return (
    <>
      <dl className="ds-facts mb-4" data-cols={3}>
        <div><dt>Verification</dt><dd>{row.approval === "Approved" ? "Verified" : row.approval}</dd></div>
        <div><dt>Current document validity</dt><dd>{soonest || "Not recorded"}</dd></div>
        {row.kind !== "vehicle" && <div><dt>Mobile consent</dt><dd>{row.phone ? "Verified" : "Pending"}</dd></div>}
      </dl>
      <DataTable label="Documents" minWidth={420} hideTools>
        <thead><tr><th>DOCUMENT</th><th>VALID UNTIL</th></tr></thead>
        <tbody>{docs.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v ? <Badge tone={Date.parse(v) < Date.now() ? "red" : "green"}>{v}</Badge> : "Not recorded"}</td></tr>)}</tbody>
      </DataTable>
      <p className="text-[11px] text-faint mt-3">Uploaded document files and renewal approvals are managed in Verification.</p>
      <Button className="mt-2" icon="file-check-2" onClick={onOpen}>Open verification</Button>
    </>
  );
}

function HistoryTab({ row }: { row: PartnerRow }) {
  const hist = [...((row.raw.statusHistory as HistoryEntry[] | undefined) ?? []), ...((row.raw.approvalHistory as HistoryEntry[] | undefined) ?? [])].sort((a, b) => (b.at?.toMillis?.() ?? 0) - (a.at?.toMillis?.() ?? 0));
  return (
    <>
      <StatusStrip row={row} />
      <p className="text-[12px] text-muted mb-3">Every change is a separate record. Times are shown in IST, including seconds.</p>
      {hist.length === 0 ? <p className="text-[13px] text-muted">No status changes have been recorded for this ID.</p> : (
        <ul className="ds-activity">{hist.map((h, i) => (
          <li key={i}><strong>{h.action}{h.from && h.to ? ` · ${h.from} → ${h.to}` : ""}</strong><span>{[h.reason, h.remarks, h.until ? `until ${refDateTime(new Date(h.until))}` : ""].filter(Boolean).join(" · ")}</span><small>{h.byName} · {h.at?.toDate ? h.at.toDate().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : ""}</small></li>
        ))}</ul>
      )}
    </>
  );
}

function TransfersTab({ row, onNew }: { row: PartnerRow; onNew: () => void }) {
  const list = ((row.raw.transfers as { to: string; reason: string; reference: string; byName: string; at: { toDate?: () => Date } }[] | undefined) ?? []).slice().reverse();
  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div><strong className="text-[15px] text-ink">Attachment transfers</strong><p className="text-[12px] text-muted">Driver ID = DL number · Vehicle ID = registration. Previous trips and accounts remain with their original partner.</p></div>
        <Button icon="arrow-left-right" onClick={onNew}>New transfer</Button>
      </div>
      <div className="ds-toolbar-count"><strong>{list.length} transfers</strong></div>
      {list.length === 0 ? <EmptyState /> : (
        <DataTable label="Transfers" minWidth={640} hideTools>
          <thead><tr><th>DATE / TIME · IST</th><th>DRIVER / VEHICLE</th><th>FROM → TO</th><th>CONSENT / STATUS</th></tr></thead>
          <tbody>{list.map((t, i) => <tr key={i}><td>{refDateTime(t.at?.toDate?.() ?? null)}</td><td>{row.name}<small>{row.code}</small></td><td>→ {t.to}<small>{t.reason}</small></td><td><Badge tone="green">Completed</Badge><small>{t.byName}{t.reference ? ` · ${t.reference}` : ""}</small></td></tr>)}</tbody>
        </DataTable>
      )}
    </>
  );
}

// ── Sheets ────────────────────────────────────────────────────────────────

function ErrorLine({ text }: { text: string | null }) {
  return text ? <div className="ds-error" role="alert" style={{ marginBottom: 12 }}><Icon name="circle-alert" />{text}</div> : null;
}

function ReviewSheet({ row, onClose, onDone }: { row: PartnerRow; onClose: () => void; onDone: (t: string) => void }) {
  const [decision, setDecision] = useState<Approval>(row.approval);
  const [reason, setReason] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const history = ((row.raw.approvalHistory as HistoryEntry[] | undefined) ?? []).slice().reverse();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (decision !== "Approved" && reason.trim().length < 5) return setError("Record the reason / requested corrections.");
    if (decision === row.approval && !reason.trim()) return setError("Choose a different decision or record a note.");
    if (!ok) return setError("Confirm you verified the profile, consent and required documents.");
    setBusy(true);
    try { await decideApproval(row.kind, row.raw, decision, reason.trim()); onDone(`${row.name}: approval ${decision.toLowerCase()}.`); }
    catch { setError("The decision was not recorded. Check your permissions and try again."); setBusy(false); }
  };
  return (
    <Modal title="Review approval" onClose={onClose} busy={busy} footer={<Button variant="primary" type="submit" form="review-form" loading={busy}>Record decision</Button>}>
      <form id="review-form" onSubmit={save} className="grid gap-4" noValidate>
        <ProfileHead row={row} />
        <p className="ds-note">Approval decisions do not clear a suspension, dispute hold or F&amp;F closure.</p>
        <ErrorLine text={error} />
        <label className="ds-field"><span>Approval decision</span><select className="ds-select" value={decision} onChange={(e) => setDecision(e.target.value as Approval)}>{APPROVALS.map((a) => <option key={a}>{a}</option>)}</select></label>
        <label className="ds-field"><span>Reason / requested corrections</span><textarea className="ds-input" rows={3} maxLength={400} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <label className="ds-check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />I verified the profile, consent and required documents.</label>
        <details className="ds-disclosure"><summary>Approval history · {history.length}</summary>
          {history.length === 0 ? <p className="text-[12px] text-muted">No earlier decision.</p> : <ul className="ds-activity">{history.map((h, i) => <li key={i}><strong>{h.to}</strong><span>{h.reason}</span><small>{h.byName} · {refDateTime(h.at)}</small></li>)}</ul>}
        </details>
      </form>
    </Modal>
  );
}

function AccountSheet({ row, initial, duties, onClose, onDone }: { row: PartnerRow; initial: AccountAction; duties: Booking[]; onClose: () => void; onDone: (t: string) => void }) {
  const [action, setAction] = useState<AccountAction>(initial);
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [days, setDays] = useState(1);
  const [custom, setCustom] = useState("");
  const [handler, setHandler] = useState(auth.currentUser?.displayName || auth.currentUser?.email || "Current acting staff");
  const [staff, setStaff] = useState<string[]>([]);
  const [holdDuties, setHoldDuties] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => subscribeStaffAccounts((l) => setStaff(l.filter((a) => a.status === "active").map((a) => a.name || a.email)), () => undefined), []);
  const all: AccountAction[] = isHold(row.account) || row.dispute === "Open"
    ? ["Reactivate ID", ...(row.dispute === "Open" ? ["Resolve dispute" as const] : []), "Suspend ID", "Mark inactive", "Permanent block"]
    : ["Suspend ID", "Mark inactive", "Permanent block", "Open dispute"];
  // Same limits as the database rules: each action needs this account type's control; permanent
  // block / unblock and reopening a closed ID are Master-only.
  const isMaster = useAccess().isSuper;
  const control = useAccountControl(row.kind === "vendor" ? "Vendors" : row.kind === "vehicle" ? "Vehicles" : row.kind === "vendor-driver" ? "Vendor Drivers" : "Driver Partners");
  const masterOnlyState = row.account === "Permanent block" || row.account === "Closed";
  const allowed = (a: AccountAction) =>
    isMaster || (!masterOnlyState && (
      a === "Suspend ID" ? control("suspend")
      : a === "Mark inactive" ? control("inactive")
      : a === "Open dispute" || a === "Resolve dispute" ? control("dispute")
      : a === "Reactivate ID" ? control("reactivate") || (row.account === "Dispute hold" && control("dispute"))
      : false));
  const actions = all.filter(allowed);
  const until = action === "Suspend ID" ? (days ? new Date(Date.now() + days * 86400000) : custom ? new Date(custom) : null) : null;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!actions.includes(action)) return setError("Your access does not include this account action. Ask the Master account.");
    if (!reason) return setError("Select a reason.");
    if (action === "Suspend ID" && !until) return setError("Select a suspension duration.");
    setBusy(true);
    try { await changeAccount(row.kind, row.raw, action, { reason, remarks: remarks.trim(), until, handler, holdDuties }); onDone(`${row.name}: ${action.toLowerCase()} recorded.`); }
    catch { setError("The account status was not changed. Check your permissions and try again."); setBusy(false); }
  };
  return (
    <Modal title="Account status" onClose={onClose} busy={busy} footNote="Permanent ID · history retained" footer={<Button variant={["Reactivate ID", "Resolve dispute"].includes(action) ? "primary" : "danger"} type="submit" form="acct-form" loading={busy}>{action}</Button>}>
      <form id="acct-form" onSubmit={save} className="grid gap-4" noValidate>
        <ProfileHead row={row} />
        <ErrorLine text={error} />
        <label className="ds-field"><span>Action</span><select className="ds-select" value={action} onChange={(e) => setAction(e.target.value as AccountAction)}>{actions.map((a) => <option key={a}>{a}</option>)}</select></label>
        <label className="ds-field"><span>{action === "Open dispute" ? "Dispute type / reason" : "Issue / reason"}</span><select className="ds-select" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Select reason</option>{HOLD_REASONS.map((r) => <option key={r}>{r}</option>)}</select></label>
        {action === "Suspend ID" && (
          <div className="ds-field"><span>Duration</span>
            <div className="ds-seg" style={{ "--ds-seg": 4 } as React.CSSProperties}>{DURATIONS.map(([l, d]) => <button type="button" key={l} aria-pressed={days === d} onClick={() => setDays(d)}>{l}</button>)}</div>
            {days === 0 && <DateTime12Input value={custom} onChange={setCustom} />}
            {until && <span className="text-[11px] text-muted mt-1">Review after {refDateTime(until)} · Manual reactivation required.</span>}
          </div>
        )}
        <label className="ds-field"><span>Remarks · optional</span><input className="ds-input" maxLength={300} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
        {action === "Open dispute" && (
          <>
            <label className="ds-field"><span>Handling staff</span><select className="ds-select" value={handler} onChange={(e) => setHandler(e.target.value)}><option>{auth.currentUser?.displayName || auth.currentUser?.email || "Current acting staff"}</option>{staff.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="ds-check"><input type="checkbox" checked={holdDuties} onChange={(e) => setHoldDuties(e.target.checked)} />Hold new duty access while this dispute is open.</label>
          </>
        )}
        <div className="ds-note"><strong>Related records &amp; evidence</strong><br />Affected bookings: {duties.length}{duties.length ? ` · ${duties.map((b) => b.bookingId || b.id).slice(0, 4).join(", ")}` : ""}</div>
      </form>
    </Modal>
  );
}

function EditSheet({ row, onClose, onDone }: { row: PartnerRow; onClose: () => void; onDone: (t: string) => void }) {
  const r = row.raw as unknown as Vehicle & Raw;
  const [f, setF] = useState(row.kind === "vehicle" ? { model: r.model ?? "", make: r.make ?? "", category: r.category ?? "" } : row.kind === "vendor" ? { companyName: row.name, email: row.email, city: s(row.raw.city) } : { name: row.name, email: row.email, phone: row.phone });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels: Record<string, string> = { name: "Name", email: "Email", phone: "Registered mobile", companyName: "Vendor name", city: "City", model: "Model", make: "Make", category: "Category" };
  return (
    <Modal title={`Edit ${CONFIG[row.kind].plural}`} onClose={onClose} busy={busy} footNote="Permanent ID retained" footer={<Button variant="primary" loading={busy} onClick={async () => {
      if (Object.values(f).some((v, i) => i === 0 && String(v).trim().length < 2)) return setError("Enter the name.");
      setBusy(true);
      try { await editPartnerProfile(row.kind, row.id, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v).trim()])), note.trim()); onDone("Profile saved."); }
      catch { setError("The profile was not saved."); setBusy(false); }
    }}>Save profile</Button>}>
      <div className="grid gap-4">
        <ProfileHead row={row} />
        <ErrorLine text={error} />
        {Object.entries(f).map(([k, v]) => <label key={k} className="ds-field"><span>{labels[k] ?? k}</span><input className="ds-input" value={String(v)} onChange={(e) => setF({ ...f, [k]: e.target.value } as typeof f)} /></label>)}
        <label className="ds-field"><span>Office note · optional</span><input className="ds-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
    </Modal>
  );
}

function FullFinalSheet({ row, duties, onClose, onDone }: { row: PartnerRow; duties: Booking[]; onClose: () => void; onDone: (t: string) => void }) {
  const active = duties.filter((b) => ACTIVE.includes(b.status));
  const unclosed = duties.filter((b) => b.status === "Completed" && !(b as Booking & { finance?: unknown }).finance);
  const [balance, setBalance] = useState("");
  const [deposit, setDeposit] = useState("");
  const [ref, setRef] = useState("");
  const [reason, setReason] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (active.length) return setError("Complete / reallocate duties, close bills and resolve pending assessments / payouts first.");
    if (balance.trim() === "" || !Number.isFinite(Number(balance))) return setError("Enter the verified working balance, including zero.");
    if (ref.trim().length < 3 || reason.trim().length < 5) return setError("Record the settlement reference and the closure reason.");
    if (!ok) return setError("Confirm the reconciliation before closing the ID.");
    setBusy(true);
    try { await closeFullFinal(row.kind, row.raw, { balance: Number(balance), deposit: Number(deposit) || 0, reference: ref.trim(), reason: reason.trim(), name: row.name }); onDone(`${row.name}: Full & Final settled and ID closed.`); }
    catch { setError("The closure was not recorded."); setBusy(false); }
  };
  return (
    <Modal title="Full & Final closure" onClose={onClose} busy={busy} footNote="Recorded settlement · no bank transfer is initiated" footer={<Button variant="danger" type="submit" form="ff-form" loading={busy}>Settle &amp; close ID</Button>}>
      <form id="ff-form" onSubmit={save} className="grid gap-4" noValidate>
        <ProfileHead row={row} />
        <ErrorLine text={error} />
        <div className="ds-note"><strong>Closure checks</strong><br />{active.length} active duties · {unclosed.length} unclosed bills · 0 pending assessments</div>
        {unclosed.length > 0 && <div><strong className="text-[12px] text-ink">Completed bills need verification</strong><ul className="text-[12px] text-body mt-1">{unclosed.map((b) => <li key={b.id}>{b.bookingId || b.id} · {b.pickup} → {b.drop}</li>)}</ul></div>}
        <label className="ds-field"><span>Verified working balance · ₹</span><input className="ds-input" type="number" value={balance} onChange={(e) => setBalance(e.target.value)} /></label>
        <label className="ds-field"><span>Refundable security deposit · ₹</span><input className="ds-input" type="number" min={0} value={deposit} onChange={(e) => setDeposit(e.target.value)} /></label>
        <p className="text-[11px] text-faint">Positive working balance: pay account holder. Negative balance: collect outstanding. Security deposit refund is recorded separately.</p>
        <label className="ds-field"><span>Settlement / bank payment reference</span><input className="ds-input" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
        <label className="ds-field"><span>Closure reason</span><input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <label className="ds-check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />I reconciled all duties, collections, wallet entries and the deposit. Settlement is completed.</label>
        <p className="text-[11px] text-faint">F&amp;F closure preserves every statement. Reopening this ID requires the Master account.</p>
      </form>
    </Modal>
  );
}

function PartnerPanelSheet({ row, onClose }: { row: PartnerRow; onClose: () => void }) {
  const data = useOfficeData();
  const [tab, setTab] = useState<"Available duties" | "Bids" | "Bookings">("Available duties");
  const open = [...data.marketById.values()].filter((m) => ["Open", "Bidding"].includes(m.status));
  const mine = dutiesOf(row, data.bookings ?? []);
  return (
    <Modal title="Partner panel · read only" onClose={onClose} wide>
      <ProfileHead row={row} />
      <p className="ds-note mb-3"><strong>Read-only partner panel</strong> · Office inspection · duty feed, bids and bookings · no partner actions</p>
      <Tabs label="Partner panel" value={tab} onChange={setTab} tabs={(["Available duties", "Bids", "Bookings"] as const).map((t) => ({ id: t, label: t }))} />
      {tab === "Available duties" && (open.length === 0 ? <EmptyState /> : (
        <DataTable label="Available duties" minWidth={760} hideTools>
          <thead><tr><th>PICKUP DATE / TIME</th><th>DUTY / ROUTE</th><th>TRIP TYPE / CAR</th><th className="ds-num">CURRENT PAYOUT</th><th>DUTY MODE</th></tr></thead>
          <tbody>{open.map((m) => {
            const b = data.bookings?.find((x) => x.id === m.id);
            return <tr key={m.id}><td>{refDateTime(b ? bookingPickupDate(b) : null)}</td><td><strong>{b ? `${b.pickup} → ${b.drop}` : m.bookingId}</strong><small>{m.bookingId}</small></td><td>{b ? tripTypeOf(b) : ""}<small>{m.vehicleCategory}</small></td><td className="ds-num">{rupee(Number(m.offeredPayout))}</td><td>{m.mode === "bid_review" ? "Bidding" : "Fixed payout"}{m.ceiling ? <small>Maximum {rupee(m.ceiling)}</small> : null}</td></tr>;
          })}</tbody>
        </DataTable>
      ))}
      {tab === "Bids" && <EmptyState title="Bids are listed on each published duty" hint="Open Bookings → Published → Manage to see bids from this partner." />}
      {tab === "Bookings" && (mine.length === 0 ? <EmptyState /> : <ul className="ds-activity">{mine.map((b) => <li key={b.id}><strong>{b.bookingId || b.id} · {b.pickup} → {b.drop}</strong><span>{b.status}</span><small>{refDateTime(bookingPickupDate(b))}</small></li>)}</ul>)}
      <p className="text-[11px] text-faint mt-3">Customer contact follows Master / eye-access rules.</p>
    </Modal>
  );
}

function TransferSheet({ row, duties, onClose, onDone }: { row: PartnerRow; duties: Booking[]; onClose: () => void; onDone: (t: string) => void }) {
  const data = useOfficeData();
  const vendors = data.vendors.filter((v) => /approved|active/i.test(String(v.status)) && v.id !== row.linkedId);
  const [to, setTo] = useState("");
  const [consent, setConsent] = useState(false);
  const [reason, setReason] = useState("");
  const [ref, setRef] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (duties.length) return setError(`${duties.length} assigned / running duties block this transfer. Complete the trip or resolve the allocation before continuing.`);
    if (!to) return setError("Choose the destination vendor.");
    if (row.kind !== "vehicle" && !consent) return setError("Record the driver's consent to the change.");
    if (reason.trim().length < 5) return setError("Record the reason for transfer.");
    if (!ok) return setError("Confirm you verified the driver / vehicle and destination vendor.");
    setBusy(true);
    const v = to === "__own" ? null : vendors.find((x) => x.id === to)!;
    try { await transferAttachment(row.kind as "driver" | "vendor-driver" | "vehicle", row.id, v ? { id: v.id, name: v.companyName || v.name } : null, reason.trim(), ref.trim()); onDone(`${row.name} transferred.`); }
    catch { setError("The transfer was not recorded."); setBusy(false); }
  };
  return (
    <Modal title="Verified manual transfer" onClose={onClose} busy={busy} footer={<Button variant="primary" type="submit" form="transfer-form" loading={busy}>Confirm transfer</Button>}>
      <form id="transfer-form" onSubmit={save} className="grid gap-4" noValidate>
        <div><strong className="text-[14px] text-ink">Move an existing driver or vehicle to another vendor</strong><p className="text-[12px] text-muted">Select → Verify → Confirm. Permanent IDs and earlier trip / account history continue.</p></div>
        <ErrorLine text={error} />
        <div className="ds-sheet-card" style={{ marginBottom: 0 }}><span>Driver / vehicle</span><strong>{row.name}</strong><small>{row.code}{row.phone ? ` · +91 ${row.phone.replace(/^\+?91/, "")}` : ""} · {row.account}</small></div>
        <dl className="ds-facts" data-cols={1}><div><dt>FROM VENDOR · AUTOMATIC</dt><dd>{row.linked || `${row.name} · Owner Driver`}</dd></div></dl>
        <label className="ds-field"><span>To vendor</span><select className="ds-select" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose vendor</option>{row.linkedId && row.kind !== "vehicle" && <option value="__own">Driver Partner (own vehicle)</option>}{vendors.map((v) => <option key={v.id} value={v.id}>{v.companyName || v.name}</option>)}</select><span className="text-[11px] text-faint">Approved + Active vendors only · Current vendor excluded</span></label>
        {duties.length > 0 && <div className="ds-error"><Icon name="triangle-alert" />{duties.length} assigned / running duties block this transfer.</div>}
        {row.kind !== "vehicle" && <label className="ds-check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />Driver consents to changing {row.kind === "driver" ? "Driver Partner to Vendor Driver" : "the linked vendor"}</label>}
        <label className="ds-field"><span>Reason for transfer</span><input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <label className="ds-field"><span>Verification / call reference · Optional</span><input className="ds-input" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
        <label className="ds-check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />I have verified the selected driver / vehicle and destination vendor</label>
      </form>
    </Modal>
  );
}

/** Admin-assisted registration: Driver ID = DL number, Vehicle ID = registration. */
function AddSheet({ kind, onClose, onDone }: { kind: PartnerKind; onClose: () => void; onDone: (t: string) => void }) {
  const data = useOfficeData();
  const isVehicle = kind === "vehicle";
  const [f, setF] = useState({ code: "", name: "", phone: "", role: kind === "vendor-driver" ? "Vendor Driver" : "Driver Partner", vendorId: "", shownNumber: "", shownName: "", validUntil: "", licenceClass: "", make: "", model: "", category: "", reference: "", note: "" });
  const [checks, setChecks] = useState([false, false, false]);
  const [approve, setApprove] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const checkLabels = isVehicle
    ? ["Registration certificate checked against the vehicle", "Insurance, fitness and permit validity checked", "Current official record / uploaded documents checked by office"]
    : ["Driver identity and registered mobile consent checked", "Selfie checked against the DL identity", "Current official record / uploaded documents checked by office"];
  const pending = checks.filter((c) => !c).length + (f.shownNumber ? 0 : 1) + (f.validUntil ? 0 : 1) + (f.reference ? 0 : 1) + (approve ? 0 : 1);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const code = f.code.trim().toUpperCase();
    if (code.length < 6) return setError(isVehicle ? "Enter the registration number." : "Enter the DL number (Driver ID).");
    if (!isVehicle && (f.name.trim().length < 2 || !/^[6-9]\d{9}$/.test(f.phone.replace(/\D/g, "").slice(-10)))) return setError("Enter the driver name and a valid 10-digit registered mobile.");
    if (f.role === "Vendor Driver" && !f.vendorId && !isVehicle) return setError("Choose the vendor this driver works for.");
    if (f.shownNumber && f.shownNumber.trim().toUpperCase() !== code) return setError(`The number shown on the ${isVehicle ? "RC" : "DL"} does not match. Keep the record on Hold.`);
    const dup = isVehicle ? data.vehicles.some((v) => (v.vehicleNumber || v.number || "").toUpperCase() === code) : data.drivers.some((d) => (d.licenseNumber || "").toUpperCase() === code);
    if (dup) return setError(`${isVehicle ? "This registration" : "This DL number"} already has a permanent ID.`);
    const allOk = !pending;
    setBusy(true);
    try {
      const approvalStatus = approve && allOk ? "Approved" : f.shownNumber && f.validUntil ? "Unapproved" : "Incomplete";
      const by = { createdBy: auth.currentUser?.uid ?? "", createdByName: auth.currentUser?.displayName || auth.currentUser?.email || "", createdAt: serverTimestamp(), source: "admin" };
      const history = [{ action: "Audited office entry", reason: f.reference, remarks: f.note, byName: by.createdByName, at: new Date() }];
      let id: string;
      if (isVehicle) {
        const r = await addDoc(collection(db, "vehicles"), { ...by, vehicleNumber: code, number: code, make: f.make.trim(), model: f.model.trim(), category: f.category, vendorId: f.vendorId, vendorName: data.vendorById.get(f.vendorId)?.companyName || "", status: "Active", docStatus: approvalStatus === "Approved" ? "Approved" : "Pending", approvalStatus, accountStatus: "Active", insuranceExpiry: f.validUntil, statusHistory: history });
        id = r.id;
      } else {
        const r = await addDoc(collection(db, "drivers"), { ...by, name: f.name.trim(), phone: `+91${f.phone.replace(/\D/g, "").slice(-10)}`, licenseNumber: code, license: code, licenseExpiry: f.validUntil, licenceClass: f.licenceClass, vendorId: f.role === "Vendor Driver" ? f.vendorId : "", status: approvalStatus === "Approved" ? "Approved" : "Pending", docStatus: approvalStatus === "Approved" ? "Approved" : "Pending", verified: approvalStatus === "Approved", approvalStatus, accountStatus: "Active", fleetStatus: "Active", statusHistory: history });
        id = r.id;
      }
      for (const file of files) {
        const path = isVehicle ? `fleet/${id}/${Date.now()}-${file.name}` : `drivers/${id}/kyc/${Date.now()}-${file.name}`;
        await uploadBytes(storageRef(storage, path), file).catch(() => undefined);
      }
      onDone(`${isVehicle ? code : f.name.trim()} registered · ${approvalStatus}.`);
    } catch {
      setError("The record was not created. Check your permissions and try again.");
      setBusy(false);
    }
  };
  return (
    <Modal title={isVehicle ? "Add vehicle" : `Add ${kind === "vendor-driver" ? "Vendor Driver" : "Driver Partner"}`} onClose={onClose} busy={busy} size="lg" footNote="Permanent ID · Audited office entry" footer={<Button variant="primary" type="submit" form="add-form" loading={busy}>Verify</Button>}>
      <form id="add-form" onSubmit={save} className="grid gap-4" noValidate>
        <div><span className="ds-eyebrow">ADMIN ASSISTED REGISTRATION</span><strong className="block text-[14px] text-ink">{isVehicle ? "Vehicle ID = registration" : "Driver ID = DL number"}</strong></div>
        <ErrorLine text={error} />
        <section className="ds-panel ds-panel-pad">
          <strong className="text-[13px] text-ink">Upload evidence</strong>
          <p className="text-[11px] text-muted mb-2">{files.length} / 2 uploaded · JPG / PNG / PDF · Up to 3 MB</p>
          <input type="file" multiple accept="image/jpeg,image/png,application/pdf" onChange={(e) => {
            const list = Array.from(e.target.files ?? []).filter((x) => x.size <= 3 * 1024 * 1024).slice(0, 4);
            setFiles(list);
          }} />
          <p className="text-[11px] text-faint mt-2">{isVehicle ? "01 RC digital record · 02 Insurance" : "01 DL digital record · 02 Selfie"}. Unknown fields stay Check required.</p>
        </section>
        <h3 className="ds-step-title"><span className="ds-step-num">01</span>{isVehicle ? "Vehicle details" : "Driver details"}</h3>
        <div className="ds-form-grid">
          <label className="ds-field"><span>{isVehicle ? "Registration number · Vehicle ID" : "DL number · Driver ID"}</span><input className="ds-input" value={f.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} /></label>
          {isVehicle ? (
            <>
              <label className="ds-field"><span>Make</span><input className="ds-input" value={f.make} onChange={(e) => set({ make: e.target.value })} /></label>
              <label className="ds-field"><span>Model</span><input className="ds-input" value={f.model} onChange={(e) => set({ model: e.target.value })} /></label>
              <label className="ds-field"><span>Category</span><select className="ds-select" value={f.category} onChange={(e) => set({ category: e.target.value })}><option value="">Choose category</option>{Array.from(new Set(data.vehicles.map((v) => v.category).filter(Boolean))).concat(["Sedan", "SUV", "Innova", "Innova Crysta"]).filter((v, i, a) => a.indexOf(v) === i).map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="ds-field" data-span="2"><span>Linked partner</span><select className="ds-select" value={f.vendorId} onChange={(e) => set({ vendorId: e.target.value })}><option value="">NESAM fleet / Driver Partner</option>{data.vendors.map((v) => <option key={v.id} value={v.id}>{v.companyName || v.name}</option>)}</select></label>
            </>
          ) : (
            <>
              <label className="ds-field"><span>Driver name</span><input className="ds-input" value={f.name} onChange={(e) => set({ name: e.target.value })} /></label>
              <label className="ds-field"><span>Registered mobile</span><input className="ds-input" inputMode="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></label>
              <div className="ds-field"><span>Account role</span><div className="ds-seg">{(["Vendor Driver", "Driver Partner"] as const).map((r) => <button key={r} type="button" aria-pressed={f.role === r} onClick={() => set({ role: r })}>{r}</button>)}</div></div>
              {f.role === "Vendor Driver" && <label className="ds-field" data-span="2"><span>Vendor</span><select className="ds-select" value={f.vendorId} onChange={(e) => set({ vendorId: e.target.value })}><option value="">Choose vendor</option>{data.vendors.map((v) => <option key={v.id} value={v.id}>{v.companyName || v.name}</option>)}</select></label>}
              {f.role === "Driver Partner" && <p className="text-[11px] text-faint" data-span="2">Driver Partner is self-driven. Attach the own vehicle from Vehicles after creating the DL record.</p>}
            </>
          )}
        </div>
        <h3 className="ds-step-title"><span className="ds-step-num">02</span>Identity &amp; validity review</h3>
        <div className="ds-form-grid">
          <label className="ds-field"><span>{isVehicle ? "Number shown on RC" : "Number shown on DL"}</span><input className="ds-input" value={f.shownNumber} onChange={(e) => set({ shownNumber: e.target.value.toUpperCase() })} /></label>
          {!isVehicle && <label className="ds-field"><span>Name shown on DL</span><input className="ds-input" value={f.shownName} onChange={(e) => set({ shownName: e.target.value })} /></label>}
          <label className="ds-field"><span>{isVehicle ? "Insurance valid until" : "DL valid until"}</span><input className="ds-input" type="date" value={f.validUntil} onChange={(e) => set({ validUntil: e.target.value })} /></label>
          {!isVehicle && <label className="ds-field"><span>Licence class / reference</span><input className="ds-input" value={f.licenceClass} onChange={(e) => set({ licenceClass: e.target.value })} /></label>}
          {checkLabels.map((l, i) => <label key={l} className="ds-check" data-span="2"><input type="checkbox" checked={checks[i]} onChange={(e) => setChecks(checks.map((c, j) => (j === i ? e.target.checked : c)))} />{l}</label>)}
          <label className="ds-field"><span>Verification / call reference</span><input className="ds-input" value={f.reference} onChange={(e) => set({ reference: e.target.value })} /></label>
          <label className="ds-field"><span>Office note · optional</span><input className="ds-input" value={f.note} onChange={(e) => set({ note: e.target.value })} /></label>
          <label className="ds-check" data-span="2"><input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} />Approve after all verification checks pass</label>
        </div>
        <p className="text-[11px] text-faint">Missing / expired / mismatched details remain Pending or Hold. All documents must remain valid through the assigned trip.</p>
        <Badge tone={pending ? "amber" : "green"}>{pending ? `${pending} checks pending` : "All checks passed"}</Badge>
      </form>
    </Modal>
  );
}

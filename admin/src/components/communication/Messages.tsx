import DateTime12Input from "../DateTime12Input";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { collection, doc, increment, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import {
  EXTRA_CHANNELS, GROUPS, MESSAGE_TYPES, TEMPLATES, cancelCampaign, retryDeliveries, saveDraft, sendCampaign, subscribeCampaignReads,
  subscribeCampaigns, uploadGreeting, type Campaign, type Group, type MessageType, type Recipient, type Target,
} from "../../services/noticeService";
import { sendAdminNotification } from "../../services/adminNotificationService";
import { ActionError } from "../../services/callables";
import { useCustomers, useDrivers, useVendors } from "../../hooks/useOfficeData";
import { accountOf, approvalOf, type Raw } from "../../domain/partners";
import { refDateTime } from "../../domain/officeStage";
import { customerCode } from "../../pages/Customers";
import { Modal, Toast, useToast } from "../Feedback";
import { Badge, Button, DataTable, EmptyState, Icon, PageHeader, toneForStatus } from "../ui";
import { Pager, usePaging } from "../ui/ListKit";

const STATUS_TABS = ["All", "Draft", "Scheduled", "Sent", "Cancelled"] as const;
const s = (v: unknown) => (typeof v === "string" ? v : "");
const digits = (p: string) => p.replace(/\D/g, "").slice(-10);
const errText = (e: unknown, fallback: string) => (e instanceof ActionError || e instanceof Error ? e.message : fallback);

/** Every person the office can message, with duplicate contacts merged into one recipient. */
function usePeople() {
  const customers = useCustomers();
  const drivers = useDrivers();
  const vendors = useVendors();
  return useMemo(() => {
    const rows: { group: Group; active: boolean; name: string; phone: string; email: string; code: string; account: Recipient["accounts"][number] }[] = [];
    for (const c of customers.rows ?? []) rows.push({ group: "Customers", active: !c.status || /^active$/i.test(c.status), name: c.name || "Customer", phone: c.phone || "", email: c.email || "", code: customerCode(c), account: { type: "customer", id: c.id } });
    for (const d of drivers.rows ?? []) {
      const raw = d as unknown as Raw;
      const kind = d.vendorId ? "vendor-driver" : "driver";
      rows.push({ group: d.vendorId ? "Vendor Drivers" : "Driver Partners", active: approvalOf(kind, raw) === "Approved" && accountOf(kind, raw) === "Active", name: d.name || "Driver", phone: d.phone || "", email: s(raw.email), code: d.licenseNumber || d.id.slice(0, 12), account: { type: "driver", id: d.id } });
    }
    for (const v of vendors.rows ?? []) {
      const raw = v as unknown as Raw;
      rows.push({ group: "Vendors", active: approvalOf("vendor", raw) === "Approved" && accountOf("vendor", raw) === "Active", name: v.companyName || v.name || "Vendor", phone: v.phone || "", email: v.email || "", code: s(raw.vendorCode) || `NSM-VN-${v.id.slice(0, 6).toUpperCase()}`, account: { type: "vendor", id: v.id } });
    }
    return rows;
  }, [customers.rows, drivers.rows, vendors.rows]);
}
type Person = ReturnType<typeof usePeople>[number];
const ROLE: Record<Group, string> = { Customers: "Customer", "Driver Partners": "Driver Partner", Vendors: "Vendor", "Vendor Drivers": "Vendor Driver" };

/** Merges people who share a mobile number (or email) into one recipient with every linked account. */
function mergeRecipients(people: Person[]): Recipient[] {
  const out = new Map<string, Recipient>();
  for (const p of people) {
    const key = digits(p.phone) || p.email.toLowerCase() || `${p.account.type}:${p.account.id}`;
    const r = out.get(key);
    if (r) {
      if (!r.roles.includes(ROLE[p.group])) r.roles.push(ROLE[p.group]);
      r.ids.push(p.code);
      if (!r.accounts.some((a) => a.type === p.account.type && a.id === p.account.id)) r.accounts.push(p.account);
      r.email ||= p.email;
    } else out.set(key, { key, name: p.name, phone: p.phone, email: p.email, roles: [ROLE[p.group]], ids: [p.code], accounts: [p.account] });
  }
  return [...out.values()];
}

export default function MessagesPanel({ canSend }: { canSend: boolean }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tab, setTab] = useState<(typeof STATUS_TABS)[number]>("All");
  const [sheet, setSheet] = useState<{ kind: "new" } | { kind: "edit" | "open"; id: string } | { kind: "duty" | "deliveries" } | null>(null);
  const { toast, show } = useToast(6000);
  useEffect(() => subscribeCampaigns(setCampaigns), []);
  const list = campaigns.filter((m) => tab === "All" || m.status === tab || (tab === "Sent" && m.status === "Sending"));
  const opened = sheet && "id" in sheet ? campaigns.find((c) => c.id === sheet.id) : undefined;

  return (
    <>
      <Toast toast={toast} />
      <section className="ds-panel ds-panel-pad mb-6 flex flex-wrap items-center justify-between gap-3">
        <div><strong className="text-[13px] text-ink">Duty email automation</strong><p className="text-[11px] text-muted mt-1">Confirmation · Assignment · Revision · Cancellation · Settlement</p></div>
        <Button size="sm" icon="mail" onClick={() => setSheet({ kind: "duty" })}>Duty email history</Button>
      </section>
      <PageHeader eyebrow="NESAM OPERATIONS" title="Communication" subtitle="Wishes, common notices and individual warnings." actions={canSend && <Button variant="primary" icon="plus" onClick={() => setSheet({ kind: "new" })}>Create notification</Button>} />
      <section className="ds-panel ds-panel-pad mb-5">
        <h2 className="text-[17px] font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>Everyone · Groups · Selected people</h2>
        <p className="text-[12px] text-body mt-1">Choose Customers, Driver Partners, Vendors and Vendor Drivers independently. Personal warnings go to one profile.</p>
      </section>
      <div className="ds-chip-row">{STATUS_TABS.map((t) => <Button key={t} size="sm" variant={tab === t ? "primary" : "secondary"} onClick={() => setTab(t)}>{t}</Button>)}</div>
      {list.length ? (
        <div className="grid gap-3 mb-6">
          {list.map((m) => (
            <article key={m.id} className="ds-panel ds-panel-pad flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[240px]">
                <h3 className="text-[14px] font-bold text-ink">{m.title}</h3>
                <p className="text-[12px] text-body mt-1">{m.body.slice(0, 130)}</p>
                <small className="text-[11px] text-muted">{m.code} · {m.target === "Groups" ? m.groups.join(", ") : m.target} · {m.recipients.length} unique recipients{m.sendAt && m.status === "Scheduled" ? ` · ${refDateTime(m.sendAt)}` : ""}</small>
              </div>
              <Badge tone={m.status === "Sent" ? "green" : m.status === "Cancelled" ? "red" : "blue"}>{m.status}</Badge>
              <Button size="sm" icon="arrow-up-right" onClick={() => setSheet({ kind: "open", id: m.id })}>Open</Button>
            </article>
          ))}
        </div>
      ) : (
        <div className="mb-6"><EmptyState title={campaigns.length ? "No matching records" : "No notifications created yet"} hint={campaigns.length ? undefined : "Send festival wishes to everyone or choose the exact audience."} action={canSend ? <Button variant="primary" icon="plus" onClick={() => setSheet({ kind: "new" })}>Create notification</Button> : undefined} /></div>
      )}

      <AccountNotices onDone={show} />

      <section className="ds-panel ds-panel-pad mt-6 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-[16px] font-bold text-ink">Notification delivery log</h2><p className="text-[13px] text-body mt-3">Track each recipient and retry failed deliveries only.</p></div>
        <Button size="sm" icon="list-checks" onClick={() => setSheet({ kind: "deliveries" })}>Open delivery log</Button>
      </section>

      {sheet?.kind === "new" && <CreateSheet onClose={() => setSheet(null)} onSaved={(id) => setSheet({ kind: "open", id })} />}
      {sheet?.kind === "edit" && opened && <CreateSheet editing={opened} onClose={() => setSheet(null)} onSaved={(id) => setSheet({ kind: "open", id })} />}
      {sheet?.kind === "open" && opened && <CampaignSheet m={opened} canSend={canSend} onEdit={() => setSheet({ kind: "edit", id: opened.id })} onClose={() => setSheet(null)} onDone={(t) => { setSheet(null); show(t); }} />}
      {sheet?.kind === "duty" && <DutyMailSheet onClose={() => setSheet(null)} onDone={show} />}
      {sheet?.kind === "deliveries" && <DeliveryLogSheet onClose={() => setSheet(null)} onDone={show} />}
    </>
  );
}

// ── Create notification ─────────────────────────────────────────────────────

function CreateSheet({ editing, onClose, onSaved }: { editing?: Campaign; onClose: () => void; onSaved: (id: string) => void }) {
  const people = usePeople();
  const [kind, setKind] = useState<MessageType>(editing?.kind ?? "Festival wishes");
  const [language, setLanguage] = useState<"Tamil" | "English">(editing?.language ?? "Tamil");
  const [template, setTemplate] = useState(editing?.template ?? "");
  const [target, setTarget] = useState<Target>(editing?.target ?? "Everyone");
  const [groups, setGroups] = useState<Group[]>(editing?.groups ?? [...GROUPS]);
  const [onlyActive, setOnlyActive] = useState(editing?.onlyActive ?? true);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [trip, setTrip] = useState(editing?.trip ?? "");
  const [requiresAck, setRequiresAck] = useState(editing?.requiresAck ?? false);
  const [image, setImage] = useState<Campaign["image"]>(editing?.image ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>(editing?.image?.url ?? "");
  const [push, setPush] = useState(editing?.push ?? true);
  const [channels, setChannels] = useState<string[]>(editing?.channels ?? []);
  const [picked, setPicked] = useState<Set<string>>(new Set(editing?.target === "Individuals" ? editing.recipients.flatMap((r) => r.accounts.map((a) => `${a.type}:${a.id}`)) : []));
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const personal = kind === "Personal warning";
  const effTarget: Target = personal ? "Individuals" : target;

  const pool = people.filter((p) => (!onlyActive || p.active) && (effTarget === "Everyone" || groups.includes(p.group)));
  const chosen = effTarget === "Individuals" ? pool.filter((p) => picked.has(`${p.account.type}:${p.account.id}`)) : pool;
  const recipients = useMemo(() => mergeRecipients(chosen), [chosen]);
  const term = search.trim().toLowerCase();
  const matches = effTarget === "Individuals" ? pool.filter((p) => !term || [p.name, p.phone, p.code, p.email].some((v) => v.toLowerCase().includes(term))).slice(0, 60) : [];

  const applyTemplate = (id: string) => {
    setTemplate(id);
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setKind(t.kind);
    setTitle(t.title);
    setBody(t.body);
    setLanguage(/[஀-௿]/.test(t.title) ? "Tamil" : "English");
  };
  const pickFile = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return setError("Upload a JPG, PNG or WebP image.");
    if (f.size > 2 * 1024 * 1024) return setError("The greeting image must be 2 MB or smaller.");
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };
  const toggle = (key: string) => setPicked((prev) => {
    const next = new Set(personal ? [] : prev);
    if (prev.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3) return setError("Enter the notification title.");
    if (body.trim().length < 3) return setError("Enter the message.");
    if (effTarget === "Groups" && !groups.length) return setError("Choose at least one group.");
    if (!recipients.length) return setError("Choose at least one recipient.");
    if (personal && recipients.length !== 1) return setError("A personal warning goes to one profile. Choose one person.");
    if (recipients.length > 2000) return setError("Send to 2,000 recipients or fewer at a time. Choose groups separately.");
    setBusy(true);
    setError(null);
    try {
      const img = file ? await uploadGreeting(file) : image;
      const id = await saveDraft({
        kind, language, template, target: effTarget, groups: effTarget === "Everyone" ? [...GROUPS] : groups, onlyActive,
        title: title.trim(), body: body.trim(), trip: trip.trim(), requiresAck, image: img ?? null, channels, push, recipients,
      }, editing?.id);
      onSaved(id);
    } catch (err) {
      setError(errText(err, "The notification was not saved."));
      setBusy(false);
    }
  };

  return (
    <Modal title={editing ? "Edit notification" : "Create notification"} eyebrow="NESAM" onClose={onClose} busy={busy} footer={<Button variant="primary" icon="eye" type="submit" form="notice-form" loading={busy}>Review recipients &amp; message</Button>}>
      <form id="notice-form" onSubmit={submit} className="grid gap-4" noValidate>
        {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
        <div className="ds-form-grid">
          <label className="ds-field"><span>Message type</span><select className="ds-select" value={kind} onChange={(e) => setKind(e.target.value as MessageType)}>{MESSAGE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="ds-field"><span>Language</span><select className="ds-select" value={language} onChange={(e) => setLanguage(e.target.value as "Tamil" | "English")}><option>Tamil</option><option>English</option></select></label>
          <label className="ds-field"><span>Template</span><select className="ds-select" value={template} onChange={(e) => applyTemplate(e.target.value)}><option value="">Write a message</option>{TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label className="ds-field"><span>Recipients</span><select className="ds-select" value={effTarget} disabled={personal} onChange={(e) => setTarget(e.target.value as Target)}><option>Everyone</option><option>Groups</option><option>Individuals</option></select></label>
        </div>
        {effTarget !== "Everyone" && (
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {GROUPS.map((g) => <label key={g} className="ds-check"><input type="checkbox" checked={groups.includes(g)} onChange={(e) => setGroups(e.target.checked ? [...groups, g] : groups.filter((x) => x !== g))} />{g}</label>)}
          </div>
        )}
        <label className="ds-check"><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />Active accounts only</label>
        {effTarget === "Individuals" && (
          <div className="ds-sheet-card" style={{ marginBottom: 0 }}>
            <label className="ds-field"><span>{personal ? "Choose one profile" : "Choose people"}</span><input type="search" className="ds-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, mobile or ID" /></label>
            <div className="mt-2 max-h-56 overflow-auto grid gap-1">
              {matches.map((p) => {
                const key = `${p.account.type}:${p.account.id}`;
                return <label key={key} className="ds-check"><input type={personal ? "radio" : "checkbox"} name="notice-person" checked={picked.has(key)} onChange={() => toggle(key)} /><span><strong>{p.name}</strong> · {ROLE[p.group]} · {p.code}{p.phone ? ` · ${p.phone}` : ""}</span></label>;
              })}
              {!matches.length && <small className="text-muted">No matching people.</small>}
            </div>
            <small className="text-[11px] text-muted">{picked.size} selected</small>
          </div>
        )}
        <label className="ds-field"><span>Notification title</span><input className="ds-input" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="ds-field"><span>Message</span><textarea className="ds-input" rows={4} maxLength={1200} value={body} onChange={(e) => setBody(e.target.value)} /></label>
        <label className="ds-field"><span>Trip / duty reference · optional</span><input className="ds-input" value={trip} onChange={(e) => setTrip(e.target.value)} /></label>
        <label className="ds-check"><input type="checkbox" checked={requiresAck} onChange={(e) => setRequiresAck(e.target.checked)} />Require பார்த்தேன் / Acknowledge</label>
        <div className="flex flex-wrap items-center gap-3">
          <label className="ds-btn ds-btn-secondary" style={{ cursor: "pointer" }}><Icon name="image-up" />Upload greeting image<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => pickFile(e.target.files?.[0])} /></label>
          {preview ? <><small className="text-[11px] text-muted">{file?.name ?? image?.name}</small><Button size="sm" variant="ghost" icon="x" onClick={() => { setFile(null); setImage(null); setPreview(""); }}>Remove image</Button></> : <small className="text-[11px] text-muted">Optional JPG / PNG / WebP · up to 2 MB</small>}
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-[11px] font-medium text-muted mb-1">Delivery · in-app notice always</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <label className="ds-check"><input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} />Push</label>
            {EXTRA_CHANNELS.map(([k, l]) => <label key={k} className="ds-check"><input type="checkbox" checked={channels.includes(k)} onChange={(e) => setChannels(e.target.checked ? [...channels, k] : channels.filter((x) => x !== k))} />{l}</label>)}
          </div>
        </fieldset>
        <NoticePreview title={title} body={body} image={preview} footer={`${recipients.length} unique recipients · duplicate contacts removed`} />
      </form>
    </Modal>
  );
}

function NoticePreview({ title, body, image, footer, label = "NESAM CABS" }: { title: string; body: string; image?: string; footer?: string; label?: string }) {
  return (
    <div className="ds-sheet-card" style={{ marginBottom: 0 }}>
      <span className="flex items-center gap-1.5 text-[11px] font-bold text-brand-ink"><Icon name="bell" size={14} />{label}</span>
      {image && <img src={image} alt="Greeting preview" className="mt-2 rounded-md max-h-48 object-cover w-full" />}
      <strong className="block mt-2 text-[14px] text-ink">{title || "Notification title"}</strong>
      <p className="text-[12px] text-body mt-1 whitespace-pre-line">{body || "Your message preview appears here."}</p>
      {footer && <small className="text-[11px] text-muted">{footer}</small>}
    </div>
  );
}

// ── Open notification: review, send, schedule, cancel ─────────────────────

function CampaignSheet({ m, canSend, onEdit, onClose, onDone }: { m: Campaign; canSend: boolean; onEdit: () => void; onClose: () => void; onDone: (t: string) => void }) {
  const [delivery, setDelivery] = useState<"Now" | "Schedule">("Now");
  const [at, setAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reads, setReads] = useState<{ read: number; ack: number; byRecipient: Map<string, string> }>({ read: 0, ack: 0, byRecipient: new Map() });
  useEffect(() => (m.status === "Sent" || m.status === "Sending" ? subscribeCampaignReads(m.id, setReads) : undefined), [m.id, m.status]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try { await fn(); onDone(done); } catch (err) { setError(errText(err, "The action could not be completed.")); setBusy(false); }
  };
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (delivery === "Schedule") {
      if (!at) return setError("Choose the send date and time.");
      return run(() => sendCampaign(m.id, "schedule", new Date(Date.parse(`${at}:00+05:30`)).toISOString()), "Notification scheduled.");
    }
    return run(() => sendCampaign(m.id, "now"), `Notification sent to ${m.recipients.length} recipients.`);
  };
  const statusOf = (r: Recipient) => {
    if (m.status === "Draft" || m.status === "Scheduled") return "Ready";
    if (m.status === "Cancelled") return "Cancelled";
    return r.accounts.map((a) => reads.byRecipient.get(a.id)).find(Boolean) ?? (m.status === "Sending" ? "Sending" : "Delivered");
  };

  return (
    <Modal title="Notification" onClose={onClose} busy={busy} size="lg">
      <div className="grid gap-4">
        {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
        <div className="ds-profile-head"><div><h3>{m.title}</h3><p>{m.code} · {m.kind}</p></div><Badge tone={m.status === "Sent" ? "green" : m.status === "Cancelled" ? "red" : "blue"}>{m.status}</Badge></div>
        <NoticePreview title={m.title} body={m.body} image={m.image?.url} label={`NESAM CABS · ${m.language}`} footer={m.requiresAck ? "பார்த்தேன் · Acknowledge required" : undefined} />
        <p className="text-[13px] text-body"><b>{m.recipients.length}</b> unique recipients · {m.target === "Groups" ? m.groups.join(", ") : m.target}{m.sendAt ? ` · ${refDateTime(m.sendAt)}` : ""}{m.trip ? ` · ${m.trip}` : ""}</p>
        <p className="text-[11px] text-muted">In-app{m.push ? " · Push" : ""}{m.channels.map((c) => ` · ${EXTRA_CHANNELS.find(([k]) => k === c)?.[1] ?? c}`).join("")}</p>
        <details className="ds-disclosure" open>
          <summary>Chosen recipients</summary>
          <div className="grid gap-2 mt-2 max-h-72 overflow-auto">
            {m.recipients.map((r) => (
              <div key={r.key} className="flex items-center justify-between gap-3 border-b border-line-soft pb-2">
                <span><strong className="text-[13px] text-ink">{r.name}</strong><small className="block text-[11px] text-muted">{r.ids.join(" · ")} · {r.roles.join(", ")}</small></span>
                <Badge tone={toneForStatus(statusOf(r))}>{statusOf(r)}</Badge>
              </div>
            ))}
          </div>
        </details>
        {m.status === "Draft" && canSend && (
          <>
            <div className="flex flex-wrap gap-2"><Button size="sm" icon="pencil" onClick={onEdit}>Edit draft</Button><Button size="sm" variant="ghost" icon="x" loading={busy} onClick={() => run(() => cancelCampaign(m, "Draft cancelled"), "Draft cancelled.")}>Cancel draft</Button></div>
            <form onSubmit={send} className="grid gap-3" noValidate>
              <label className="ds-field"><span>Send</span><select className="ds-select" value={delivery} onChange={(e) => setDelivery(e.target.value as "Now" | "Schedule")}><option>Now</option><option>Schedule</option></select></label>
              {delivery === "Schedule" && <label className="ds-field"><span>Send at · IST</span><DateTime12Input value={at} onChange={setAt} /></label>}
              <p className="text-[11px] text-faint">Every recipient gets the in-app notice in their NESAM app. Push, WhatsApp, SMS and email go only on the channels chosen; each attempt is recorded in the delivery log.</p>
              <div><Button variant="primary" type="submit" icon={delivery === "Schedule" ? "calendar-clock" : "send"} loading={busy}>{delivery === "Schedule" ? "Schedule notification" : `Send to ${m.recipients.length} recipients`}</Button></div>
            </form>
          </>
        )}
        {(m.status === "Sent" || m.status === "Sending") && (
          <div className="ds-kpi-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginBottom: 0 }}>
            <div className="ds-kpi"><span className="ds-kpi-label">Sent</span><span className="text-[16px] font-bold text-ink">{m.counts?.sent ?? (m.status === "Sending" ? "…" : m.recipients.length)}</span></div>
            <div className="ds-kpi"><span className="ds-kpi-label">Read</span><span className="text-[16px] font-bold text-ink">{reads.read}</span></div>
            <div className="ds-kpi"><span className="ds-kpi-label">Acknowledged</span><span className="text-[16px] font-bold text-ink">{reads.ack}</span></div>
          </div>
        )}
        {m.status === "Sent" && !!m.counts?.failed && <p className="text-[12px] text-red-700">{m.counts.failed} external deliveries failed. Open the delivery log to retry failed recipients only.</p>}
        {m.status === "Scheduled" && canSend && <div><Button icon="calendar-x" loading={busy} onClick={() => run(() => cancelCampaign(m, "Schedule cancelled"), "Scheduled notification cancelled.")}>Cancel schedule</Button></div>}
      </div>
    </Modal>
  );
}

// ── Account notices ────────────────────────────────────────────────────────

interface AccountNotice { id: string; entity: string; entityKind: string; name: string; to: string; subject: string; body: string; status: string; at?: unknown; attempts?: number; error?: string }

function AccountNotices({ onDone }: { onDone: (t: string) => void }) {
  const [rows, setRows] = useState<AccountNotice[]>([]);
  const [open, setOpen] = useState<AccountNotice | null>(null);
  useEffect(() => onSnapshot(query(collection(db, "account_notices"), orderBy("at", "desc"), limit(200)), (snap) => setRows(snap.docs.map((d) => ({ ...(d.data() as Omit<AccountNotice, "id">), id: d.id }))), () => setRows([])), []);
  const paging = usePaging(rows, rows.length, 10);
  return (
    <section className="ds-panel">
      <div className="ds-section-head"><div><h2>Account notices</h2><p>Suspension / reactivation email queue</p></div></div>
      <DataTable label="Account notices" minWidth={760} hasActions>
          <thead><tr><th>DATE · IST</th><th>ACCOUNT</th><th>EMAIL</th><th>STATUS</th><th className="ds-actions">ACTION</th></tr></thead>
          <tbody>
            {paging.slice.map((n) => (
              <tr key={n.id}>
                <td>{refDateTime(n.at as never)}</td>
                <td><strong>{n.name}</strong><small>{n.entity}</small></td>
                <td>{n.to || "Email not supplied"}</td>
                <td><Badge tone={n.status === "Sent" ? "green" : n.status === "Failed" ? "red" : n.to ? "blue" : "amber"}>{n.status}</Badge></td>
                <td><Button size="sm" variant="ghost" icon="arrow-up-right" onClick={() => setOpen(n)}>View notice</Button></td>
              </tr>
            ))}
          </tbody>
        
      </DataTable>
      {!rows.length && <EmptyState />}
      {rows.length > 10 && <div className="px-5 pb-4"><Pager paging={paging} tabTotal={rows.length} /></div>}
      {open && <AccountNoticeSheet n={rows.find((r) => r.id === open.id) ?? open} onClose={() => setOpen(null)} onDone={(t) => { setOpen(null); onDone(t); }} />}
    </section>
  );
}

function AccountNoticeSheet({ n, onClose, onDone }: { n: AccountNotice; onClose: () => void; onDone: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prepare = async () => {
    if (!n.to) return setError("Update the registered profile email before sending this notice.");
    if (n.entityKind === "vehicle") return setError("Vehicles have no email address. Notify the linked partner instead.");
    setBusy(true);
    setError(null);
    try {
      const r = await sendAdminNotification({ target: "single_user", recipientId: n.entity, recipientType: n.entityKind === "vendor" ? "vendor" : "driver", channel: "Email", type: "approvals", title: n.subject, message: n.body });
      const failed = !r.success || !!r.channels?.email?.failed || !!r.channels?.email?.notConfigured;
      try {
        await updateDoc(doc(db, "account_notices", n.id), { status: failed ? "Failed" : "Sent", preparedAt: serverTimestamp(), preparedByName: "", attempts: increment(1), error: r.error ?? (r.channels?.email?.notConfigured ? "Email provider is not configured." : "") });
      } catch {
        setError(failed ? "The email failed and its notice status could not be saved. Check the delivery log." : "The email was sent, but its notice status could not be saved. Check the delivery log before retrying.");
        return;
      }
      if (failed) { setError(r.error ?? "The email could not be sent. Check the delivery log."); return; }
      onDone("Account notice emailed.");
    } catch {
      setError("The notice could not be completed. Check the delivery log before retrying.");
    } finally { setBusy(false); }
  };
  return (
    <Modal title="Account notice" onClose={onClose} busy={busy} footer={<Button icon="mail" loading={busy} onClick={prepare}>Prepare notice</Button>}>
      <div className="grid gap-4">
        {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
        <div className="ds-profile-head"><div><h3>{n.subject}</h3><p>{n.entity}</p></div><Badge tone={n.to ? "blue" : "amber"}>{n.status}</Badge></div>
        <dl className="ds-facts"><div><dt>Recipient email</dt><dd>{n.to || "Not supplied"}</dd></div><div><dt>Created</dt><dd>{refDateTime(n.at as never)}</dd></div>{n.attempts ? <div><dt>Attempts</dt><dd>{n.attempts}</dd></div> : null}</dl>
        <div className="ds-note">{n.body}</div>
        {n.error && <p className="text-[12px] text-red-700">{n.error}</p>}
        <p className="text-[11px] text-muted">Prepare notice emails this text to the registered address. Update the registered profile email before queuing a missing-address notice.</p>
      </div>
    </Modal>
  );
}

// ── Delivery log & duty mail history ───────────────────────────────────────

interface Delivery { id: string; title?: string; message?: string; recipientId?: string; recipientType?: string; recipientName?: string; channel?: string; status?: string; attempts?: number; bookingId?: string; error?: string; sentAt?: unknown; campaignId?: string; category?: string }
const CHANNEL_LABEL: Record<string, string> = { in_app: "In-app", push: "Push", whatsapp: "WhatsApp", sms: "SMS", email: "Email" };
const deliveryTone = (st?: string) => (st === "failed" ? "red" : st === "sent" || st === "delivered" || st === "read" ? "green" : "amber");
const word = (st?: string) => (st ?? "queued").replace("_", " ").replace(/^\w/, (c) => c.toUpperCase());

function useDeliveries() {
  const [rows, setRows] = useState<Delivery[] | null>(null);
  useEffect(() => onSnapshot(query(collection(db, "notification_deliveries"), orderBy("sentAt", "desc"), limit(400)), (snap) => setRows(snap.docs.map((d) => ({ ...(d.data() as Delivery), id: d.id }))), () => setRows([])), []);
  return rows;
}

function DeliveryLogSheet({ onClose, onDone }: { onClose: () => void; onDone: (t: string) => void }) {
  const rows = useDeliveries();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const shown = (rows ?? []).filter((r) => !status || r.status === status);
  const paging = usePaging(shown, status, 20);
  const retry = async (key: string, p: { deliveryId?: string }) => {
    setBusy(key);
    setError(null);
    try {
      const r = await retryDeliveries(p);
      onDone(r.retried ? `${r.recovered} of ${r.retried} failed deliveries sent on retry.` : "No failed WhatsApp, SMS or email deliveries to retry.");
    } catch (err) { setError(errText(err, "Retry failed.")); }
    setBusy(null);
  };
  return (
    <Modal title="Notification delivery log" onClose={onClose} size="xl">
      <div className="grid gap-4">
        <div className="ds-note"><Icon name="info" size={14} />Each recipient and channel attempt is listed with its real provider status. In-app notices are stored for the recipient's app; retry applies to failed WhatsApp, SMS and email attempts only.</div>
        {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
        <div className="flex flex-wrap items-center gap-3">
          <Button icon="refresh-cw" loading={busy === "all"} onClick={() => retry("all", {})}>Retry failed recipients only</Button>
          <select className="ds-select !w-auto" aria-label="Delivery status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{["sent", "failed", "not_configured", "skipped", "delivered", "read"].map((x) => <option key={x} value={x}>{word(x)}</option>)}</select>
        </div>
        <DataTable label="Delivery log" minWidth={760} hasActions>
            <thead><tr><th>MESSAGE / RECIPIENT</th><th>CHANNEL</th><th>STATUS / ATTEMPTS</th><th className="ds-actions">ACTION</th></tr></thead>
            <tbody>
              {paging.slice.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.title}</strong><small>{d.recipientName || d.recipientType} · {d.recipientId?.slice(0, 12)}{d.bookingId ? ` · ${d.bookingId.slice(0, 10)}` : ""}</small>{d.error && <small className="text-red-700">{d.error}</small>}</td>
                  <td>{CHANNEL_LABEL[d.channel ?? ""] ?? d.channel}<small>{refDateTime(d.sentAt as never)}</small></td>
                  <td><Badge tone={deliveryTone(d.status)}>{word(d.status)}</Badge><small>Attempt {d.attempts ?? 1}</small></td>
                  <td>{d.status === "failed" && ["whatsapp", "sms", "email"].includes(d.channel ?? "") && <Button size="sm" icon="refresh-cw" loading={busy === d.id} onClick={() => retry(d.id, { deliveryId: d.id })}>Retry</Button>}</td>
                </tr>
              ))}
            </tbody>
          
        </DataTable>
        {rows !== null && !shown.length && <EmptyState />}
        {shown.length > 20 && <Pager paging={paging} tabTotal={shown.length} />}
      </div>
    </Modal>
  );
}

function DutyMailSheet({ onClose, onDone }: { onClose: () => void; onDone: (t: string) => void }) {
  const rows = useDeliveries();
  const [preview, setPreview] = useState<Delivery | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mails = (rows ?? []).filter((r) => r.channel === "email" && r.bookingId);
  const paging = usePaging(mails, mails.length, 20);
  const resend = async (d: Delivery) => {
    setBusy(d.id);
    setError(null);
    try {
      const r = await retryDeliveries({ deliveryId: d.id });
      onDone(r.recovered ? "Duty email sent again." : "The email could not be resent. Check the recipient's email address.");
    } catch (err) { setError(errText(err, "The email was not resent.")); }
    setBusy(null);
  };
  return (
    <Modal title="Duty mail history" onClose={onClose} size="xl">
      <div className="grid gap-4">
        <div className="ds-note"><Icon name="info" size={14} />Transactional duty emails: confirmation, assignment, revision, cancellation and settlement. Resend sends the same email again to the registered address.</div>
        {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
        <DataTable label="Duty mail history" minWidth={860} hasActions>
            <thead><tr><th>EVENT / VERSION</th><th>RECIPIENT</th><th>CREATED · IST</th><th>DELIVERY</th><th className="ds-actions">ACTION</th></tr></thead>
            <tbody>
              {paging.slice.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.title}</strong><small>{d.bookingId} · {d.id.slice(0, 8).toUpperCase()}</small></td>
                  <td>{d.recipientName || word(d.recipientType)}<small>{d.recipientId?.slice(0, 12)}</small></td>
                  <td>{refDateTime(d.sentAt as never)}</td>
                  <td><Badge tone={deliveryTone(d.status)}>{word(d.status)}</Badge><small>{d.attempts ?? 1} attempt{(d.attempts ?? 1) === 1 ? "" : "s"}</small></td>
                  <td><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setPreview(d)}>Preview</Button><Button size="sm" loading={busy === d.id} onClick={() => resend(d)}>Resend</Button></div></td>
                </tr>
              ))}
            </tbody>
          
        </DataTable>
        {rows !== null && !mails.length && <EmptyState />}
        {mails.length > 20 && <Pager paging={paging} tabTotal={mails.length} />}
      </div>
      {preview && (
        <Modal title={preview.title || "Duty email"} centered onClose={() => setPreview(null)}>
          <div className="grid gap-2"><small className="text-muted">{preview.bookingId} · {refDateTime(preview.sentAt as never)}</small><p className="text-[13px] text-body whitespace-pre-line">{preview.message}</p></div>
        </Modal>
      )}
    </Modal>
  );
}

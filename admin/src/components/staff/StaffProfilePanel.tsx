import { useEffect, useState } from "react";
import { ACCOUNT_TYPES, DUTY_ACTIONS, MODULE_ACTIONS, STAFF_MODULES, STAFF_PRESETS, permissionsOf, PERMISSION_INFO, type StaffPreset } from "../../config/permissions";
import {
  StaffActionError, saveStaffProfile, resetStaffPassword, setStaffStatus, subscribeStaffActivity, subscribeStaffAudit, subscribeStaffSessions,
  type AuditEntry, type StaffAccount, type StaffActivityRecord, type StaffSaveResult, type StaffSessionRecord,
} from "../../services/staffService";
import { EXPIRE_MS, revokeStaffSessions } from "../../services/staffSessionService";
import { formatDateTime12 } from "../../utils/time";
import { Modal } from "../Feedback";
import { Badge, Button, Tabs } from "../ui";

type Tab = "overview" | "access" | "sessions" | "activity";
type Next = "Active" | "Inactive" | "Suspended";

const AUDIT_TEXT: Record<string, string> = {
  staff_profile_created: "Staff ID created",
  staff_profile_updated: "Profile & access changed",
  staff_status_changed: "Status changed",
  staff_sessions_revoked: "All sessions revoked",
  staff_session_ended: "Session ended",
  staff_password_reset: "Password reset by Master",
};
const FLAG_TEXT: Record<string, string> = {
  vendorPayout: "Vendor payout / margin", bankDetails: "Bank settlement details", temporaryReveal: "Temporary reveal (handled bookings)",
  requestApproval: "Request reveal approval", copyAfterReveal: "Copy after reveal", driver: "Driver swap", vehicle: "Vehicle swap",
  viewCoupons: "View coupons", applyCoupon: "Apply coupon", createVehicle: "Create / update vehicle", createDriver: "Create / update driver",
  approveVehicleDocs: "Approve vehicle documents", approveDriverDocs: "Approve driver documents",
};
const when = (d: Date | null) => (d ? formatDateTime12(d) : "—");
const errText = (e: unknown) => (e instanceof StaffActionError ? e.message : "The change was not saved. Check your connection and try again.");
export const statusTone = (s: string) => (s === "Active" ? "green" : s === "Suspended" ? "red" : s === "Invited" ? "amber" : "neutral");

/** Lifecycle actions offered from each status (the server re-checks every one). */
const LIFECYCLE: Record<string, { to: Next; label: string; danger?: boolean }[]> = {
  Invited: [{ to: "Active", label: "Activate" }, { to: "Inactive", label: "Deactivate", danger: true }],
  Active: [{ to: "Suspended", label: "Suspend", danger: true }, { to: "Inactive", label: "Deactivate", danger: true }],
  Suspended: [{ to: "Active", label: "Reactivate" }, { to: "Inactive", label: "Deactivate", danger: true }],
  Inactive: [{ to: "Active", label: "Reactivate" }],
};

export default function StaffProfilePanel({ account, onClose, onEdit, onInvite, notify }: {
  account: StaffAccount;
  onClose: () => void;
  onEdit: () => void;
  onInvite: (result: StaffSaveResult) => void;
  notify: (message: string, type?: "success" | "error") => void;
}) {
  const p = account.profile!;
  const [tab, setTab] = useState<Tab>("overview");
  const [sessions, setSessions] = useState<StaffSessionRecord[] | null>(null);
  const [activity, setActivity] = useState<StaffActivityRecord[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [change, setChange] = useState<{ to: Next; label: string } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetReason, setResetReason] = useState("");
  const [resetError, setResetError] = useState("");

  const closeReset = () => {
    if (busy) return;
    setResetOpen(false); setNewPassword(""); setConfirmPassword(""); setResetReason(""); setResetError("");
  };
  const resetPassword = async () => {
    if (busy) return;
    if (newPassword.length < 8 || newPassword.length > 128) { setResetError("Use a password between 8 and 128 characters."); return; }
    if (newPassword !== confirmPassword) { setResetError("Passwords do not match."); return; }
    if (resetReason.trim().length < 5) { setResetError("Record a reason of at least 5 characters."); return; }
    setBusy(true); setResetError("");
    try {
      const result = await resetStaffPassword(account.uid, newPassword, resetReason);
      setResetOpen(false); setNewPassword(""); setConfirmPassword(""); setResetReason("");
      notify(result.warnings.length ? result.warnings.join(" ") : "Password changed. Share the new password privately with the staff member.", result.warnings.length ? "error" : "success");
    } catch (error) { setResetError(errText(error)); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (tab !== "sessions" && tab !== "activity") return;
    setLoadError(null);
    const unsubs = tab === "sessions"
      ? [subscribeStaffSessions(account.uid, setSessions, setLoadError)]
      : [subscribeStaffActivity(account.uid, setActivity, setLoadError), subscribeStaffAudit(account.uid, setAudit, setLoadError)];
    return () => unsubs.forEach((u) => u());
  }, [tab, account.uid]);

  const changeStatus = async () => {
    if (!change || busy) return;
    if (reason.trim().length < 5) { setActionError("Record the reason (at least 5 characters)."); return; }
    setBusy(true);
    setActionError(null);
    try {
      const r = await setStaffStatus(account.uid, change.to, reason, p.accessVersion);
      notify(`${account.name} is now ${change.to}.${r.sessionsEnded ? ` ${r.sessionsEnded} open session(s) ended.` : ""}${r.grantsRevoked ? ` ${r.grantsRevoked} contact reveal grant(s) ended.` : ""}`);
      setChange(null);
      setReason("");
    } catch (e) {
      setActionError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const resendInvite = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await saveStaffProfile({
        uid: account.uid, expectedVersion: p.accessVersion, name: account.name, phone: p.phone, email: account.email, contactEmail: account.contactEmail || p.contactEmail || "", branch: p.branch,
        preset: (STAFF_PRESETS as readonly string[]).includes(p.preset) ? (p.preset as StaffPreset) : "Custom", access: p.matrix, duty: p.duty, reason: "Invitation resent", resendInvite: true,
      });
      onInvite(r);
    } catch (e) {
      notify(errText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (sessionId?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await revokeStaffSessions(account.uid, sessionId);
      notify(sessionId ? "Session ended. That browser tab signs out." : `All sessions revoked (${r.ended} open). Sign-in tokens on every device were revoked.`);
    } catch {
      notify("The sessions were not revoked. Check your connection and try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  const sessionStatus = (s: StaffSessionRecord) =>
    s.status === "Online" && s.lastActiveAt && Date.now() - s.lastActiveAt.getTime() > EXPIRE_MS ? "Expired" : s.status || "—";
  const modules = STAFF_MODULES.filter((m) => (p.matrix.modules[m] ?? []).length);
  const flags = (["sensitive", "privacy", "fleetSwap", "partnerRights"] as const).flatMap((g) => Object.entries(p.matrix[g]).filter(([, v]) => v).map(([k]) => FLAG_TEXT[k] ?? k));

  return (
    <>
      <Modal
        title={account.name || account.email}
        subtitle={`${p.staffCode} · ${p.preset}${p.branch ? ` · ${p.branch}` : ""}`}
        eyebrow="STAFF PROFILE"
        onClose={onClose}
        busy={busy}
        size="xl"
        footer={<Button onClick={onClose} disabled={busy}>Close</Button>}
      >
        <div className="space-y-4 text-xs">
          <Tabs<Tab>
            label="Staff profile sections"
            value={tab}
            onChange={setTab}
            tabs={[{ id: "overview", label: "Overview" }, { id: "access", label: "Access" }, { id: "sessions", label: "Sessions" }, { id: "activity", label: "Activity" }]}
          />

          {tab === "overview" && (
            <div className="space-y-4">
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[["Staff ID", p.staffCode], ["Status", <Badge key="s" tone={statusTone(p.accountStatus)}>{p.accountStatus}</Badge>], ["Mobile", p.phone || "—"], [account.username ? "Username" : "Email (sign-in)", account.username || account.email || "—"], ["Email ID", account.contactEmail || p.contactEmail || "—"], ["Role preset", p.preset], ["Branch", p.branch || "—"], ["Created", when(account.createdAt)], ["Last change", when(p.updatedAt)]].map(([k, v]) => (
                  <div key={String(k)}><dt className="text-[11px] text-faint">{k}</dt><dd className="font-semibold text-ink">{v}</dd></div>
                ))}
              </dl>
              <div className="flex flex-wrap gap-2">
                {(LIFECYCLE[p.accountStatus] ?? []).map((a) => (
                  <Button key={a.to} variant={a.danger ? "danger" : "primary"} disabled={busy} onClick={() => { setActionError(null); setReason(""); setChange(a); }}>{a.label}</Button>
                ))}
                {p.accountStatus === "Invited" && !account.username && <Button disabled={busy} onClick={() => void resendInvite()}>Resend invitation</Button>}
                {account.username && <Button disabled={busy} onClick={() => setResetOpen(true)}>Reset password</Button>}
                <Button icon="sliders-horizontal" disabled={busy} onClick={onEdit}>Edit access</Button>
              </div>
              <section>
                <h3 className="text-[13px] font-bold text-ink mb-2">Status history</h3>
                {p.statusHistory.length === 0 ? <p className="text-faint">No status changes recorded.</p> : (
                  <ul className="divide-y divide-hover border border-line rounded-lg">
                    {p.statusHistory.map((h, i) => (
                      <li key={i} className="px-3 py-2">
                        <strong className="text-ink">{h.action}</strong>{h.from || h.to ? ` · ${h.from || "—"} → ${h.to}` : ""}
                        <span className="block text-[11px] text-muted">{h.reason || "No reason recorded"} · {h.byName || "—"} · {when(h.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <p className="text-[11px] text-muted">Full & Final settlement and closure are not tracked for staff accounts in this system; deactivate the Staff ID when someone leaves.</p>
            </div>
          )}

          {tab === "access" && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1">
                {permissionsOf(p.matrix).map((k) => <Badge key={k} tone="neutral">{PERMISSION_INFO[k].label}</Badge>)}
              </div>
              <div className="overflow-x-auto border border-line rounded-lg">
                <table className="w-full min-w-[560px] text-[12px]">
                  <thead><tr className="bg-surface-2 text-[11px] text-faint uppercase"><th className="px-3 py-2 text-left">Module</th>{MODULE_ACTIONS.map((a) => <th key={a} className="px-2 py-2 text-center">{a}</th>)}</tr></thead>
                  <tbody>
                    {modules.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-faint">No modules granted.</td></tr>}
                    {modules.map((m) => (
                      <tr key={m} className="border-t border-line-soft">
                        <th scope="row" className="px-3 py-2 text-left font-semibold text-ink">{m}</th>
                        {MODULE_ACTIONS.map((a) => <td key={a} className="px-2 py-2 text-center">{p.matrix.modules[m]?.includes(a) ? "✓" : "—"}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><dt className="text-[11px] text-faint">Duty permissions</dt><dd className="text-ink">{DUTY_ACTIONS.filter(([k]) => p.duty.includes(k)).map(([, l]) => l).join(", ") || "None"}</dd></div>
                <div><dt className="text-[11px] text-faint">Settlement approval limit</dt><dd className="text-ink">{p.matrix.bankLimit > 0 ? `₹${p.matrix.bankLimit.toLocaleString("en-IN")} per settlement` : "None"}</dd></div>
                <div><dt className="text-[11px] text-faint">Account controls</dt><dd className="text-ink">{ACCOUNT_TYPES.filter((t) => (p.matrix.accountControls[t] ?? []).length).map((t) => `${t}: ${p.matrix.accountControls[t]!.join(", ")}`).join(" · ") || "None"}</dd></div>
                <div><dt className="text-[11px] text-faint">Separate rights</dt><dd className="text-ink">{flags.join(", ") || "None"}</dd></div>
              </dl>
              <p className="text-[11px] text-muted">Full customer contact, permanent block / unblock and reopening closed accounts stay Master-only.</p>
              <Button icon="sliders-horizontal" onClick={onEdit}>Edit access</Button>
            </div>
          )}

          {tab === "sessions" && (
            <div className="space-y-3">
              <p className="text-[11px] text-muted">One record per signed-in browser tab of the admin panel (heartbeat every 2 minutes). Revoking ends the tab and, for “all sessions”, the sign-in on every device.</p>
              {loadError && <div role="alert" className="text-red-700">{loadError}</div>}
              <Button variant="danger" disabled={busy} onClick={() => void revoke()}>Revoke all sessions</Button>
              {sessions === null && !loadError ? <p className="text-faint">Loading sessions…</p> : (sessions ?? []).length === 0 ? <p className="text-faint">No sessions recorded for this Staff ID yet.</p> : (
                <div className="overflow-x-auto border border-line rounded-lg">
                  <table className="w-full min-w-[620px] text-[12px]">
                    <thead><tr className="bg-surface-2 text-[11px] text-faint uppercase"><th className="px-3 py-2 text-left">Device</th><th className="px-3 py-2 text-left">Login / last active</th><th className="px-3 py-2 text-left">Ended</th><th className="px-3 py-2 text-left">Status</th><th /></tr></thead>
                    <tbody>
                      {sessions!.map((s) => (
                        <tr key={s.id} className="border-t border-line-soft">
                          <td className="px-3 py-2">{s.device} · {s.browser}</td>
                          <td className="px-3 py-2">{when(s.startedAt)}<span className="block text-[11px] text-faint">Active {when(s.lastActiveAt)}</span></td>
                          <td className="px-3 py-2">{when(s.endedAt)}{s.endedByName && <span className="block text-[11px] text-faint">by {s.endedByName}</span>}</td>
                          <td className="px-3 py-2"><Badge tone={sessionStatus(s) === "Online" ? "green" : "neutral"}>{sessionStatus(s)}</Badge></td>
                          <td className="px-3 py-2 text-right">{s.status === "Online" && <Button size="sm" disabled={busy} onClick={() => void revoke(s.id)}>End</Button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === "activity" && (
            <div className="space-y-4">
              {loadError && <div role="alert" className="text-red-700">{loadError}</div>}
              <section>
                <h3 className="text-[13px] font-bold text-ink mb-2">Access changes</h3>
                {audit === null && !loadError ? <p className="text-faint">Loading…</p> : (audit ?? []).length === 0 ? <p className="text-faint">No access changes recorded.</p> : (
                  <ul className="divide-y divide-hover border border-line rounded-lg">
                    {audit!.map((a) => (
                      <li key={a.id} className="px-3 py-2">
                        <strong className="text-ink">{AUDIT_TEXT[a.action] ?? a.action}</strong>
                        {typeof a.details.from === "string" && typeof a.details.to === "string" && ` · ${a.details.from} → ${a.details.to}`}
                        <span className="block text-[11px] text-muted">{typeof a.details.reason === "string" && a.details.reason ? `${a.details.reason} · ` : ""}by {a.actorName || "—"} · {when(a.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h3 className="text-[13px] font-bold text-ink mb-2">Workspace activity</h3>
                {activity === null && !loadError ? <p className="text-faint">Loading…</p> : (activity ?? []).length === 0 ? <p className="text-faint">No activity recorded.</p> : (
                  <ul className="divide-y divide-hover border border-line rounded-lg">
                    {activity!.map((a) => (
                      <li key={a.id} className="px-3 py-2"><strong className="text-ink">{a.action}</strong> · {a.module}<span className="block text-[11px] text-muted">{when(a.at)}</span></li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </div>
      </Modal>

      {resetOpen && (
        <Modal title={`Reset password · ${account.username}`} centered busy={busy} onClose={closeReset}
          footer={<><Button disabled={busy} onClick={closeReset}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void resetPassword()}>Set new password</Button></>}>
          <div className="space-y-3 text-xs">
            <p>Set a new password and share it privately. Existing staff sessions will be revoked; account status and permissions stay the same.</p>
            <label className="ds-field"><span>New password *</span><input className="ds-input" type="password" autoComplete="new-password" value={newPassword} maxLength={128} onChange={(e) => setNewPassword(e.target.value)} /></label>
            <label className="ds-field"><span>Confirm password *</span><input className="ds-input" type="password" autoComplete="new-password" value={confirmPassword} maxLength={128} onChange={(e) => setConfirmPassword(e.target.value)} /></label>
            <label className="ds-field"><span>Reason *</span><input className="ds-input" value={resetReason} maxLength={300} onChange={(e) => setResetReason(e.target.value)} /></label>
            {resetError && <p role="alert" className="text-red-600">{resetError}</p>}
          </div>
        </Modal>
      )}
      {change && (
        <Modal
          title={`${change.label} ${account.name || account.email}?`}
          centered
          busy={busy}
          onClose={() => setChange(null)}
          footer={
            <>
              <Button onClick={() => setChange(null)} disabled={busy}>Cancel</Button>
              <Button variant={change.to === "Active" ? "primary" : "danger"} loading={busy} onClick={() => void changeStatus()}>{change.label}</Button>
            </>
          }
        >
          <div className="space-y-3 text-xs">
            <p className="text-body">
              {change.to === "Active"
                ? "The Staff ID regains the access in its matrix. The server checks the matrix is valid first."
                : "Access ends on the next request: open sessions are revoked, sign-in is disabled and pending customer-contact reveal requests end."}
            </p>
            <label className="block">
              <span className="block text-[11px] font-semibold text-muted mb-1">Reason *</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="w-full p-2 border border-line rounded-lg text-xs" />
            </label>
            {actionError && <p role="alert" className="text-[11px] text-red-600">{actionError}</p>}
          </div>
        </Modal>
      )}
    </>
  );
}

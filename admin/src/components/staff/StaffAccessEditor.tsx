import { useEffect, useMemo, useState, type InputHTMLAttributes } from "react";
import {
  ACCOUNT_ACTIONS, ACCOUNT_TYPES, DUTY_ACTIONS, LIMITED_MODULES, MASTER_ONLY_MODULES, MODULE_ACTIONS, STAFF_MODULES, STAFF_PRESETS,
  accessProblems, describeRequirement, missingRequirements, normalizeMatrix, presetAccess, withRequirements,
  type AccountAction, type AccountType, type DutyAction, type FlagGroup, type ModuleAction, type Requirement, type StaffMatrix,
  type StaffModule, type StaffPreset, type StaffStatus,
} from "../../config/permissions";
import { StaffActionError, saveStaffProfile, validateStaffIdentity, type StaffAccount, type StaffErrorKind, type StaffSaveResult } from "../../services/staffService";
import { newId } from "../../services/callables";
import { ConfirmDialog, Modal } from "../Feedback";
import { Button } from "../ui";

const ACTION_LABEL: Record<ModuleAction, string> = { view: "View", create: "Create", edit: "Edit", approve: "Approve", export: "Export", send: "Send" };
const ACCOUNT_LABEL: Record<AccountAction, string> = { suspend: "Suspend", reactivate: "Reactivate", inactive: "Inactive", dispute: "Dispute" };
const FLAG_SECTIONS: { group: FlagGroup; title: string; note: string; items: [string, string][] }[] = [
  {
    group: "sensitive", title: "Sensitive data",
    note: "Kept separate from module access. Bank details are read only by finance staff holding this right.",
    items: [["vendorPayout", "Vendor payout / company margin"], ["bankDetails", "Bank settlement details"]],
  },
  {
    group: "privacy", title: "Customer privacy access",
    note: "Full customer contact is Master-only. Staff reveal one booking at a time; approvals expire and end when this access changes.",
    items: [["temporaryReveal", "Temporary reveal on bookings this person handled"], ["requestApproval", "Request Master approval for customer access"], ["copyAfterReveal", "Copy button after an authorised reveal"]],
  },
  {
    group: "fleetSwap", title: "Driver & vehicle swaps",
    note: "Changing the driver or cab of an assigned duty.",
    items: [["driver", "Driver swap"], ["vehicle", "Vehicle swap"]],
  },
  {
    group: "partnerRights", title: "Coupons, drivers & vehicles",
    note: "Creating a driver or vehicle is separate from approving its documents.",
    items: [["viewCoupons", "View coupons"], ["applyCoupon", "Apply coupon to booking"], ["createVehicle", "Create / update vehicle"], ["createDriver", "Create / update driver"], ["approveVehicleDocs", "Approve vehicle documents"], ["approveDriverDocs", "Approve driver documents"]],
  },
];

interface Draft {
  username: string;
  password: string;
  confirmPassword: string;
  name: string;
  phone: string;
  email: string;
  contactEmail: string;
  branch: string;
  preset: StaffPreset;
  accountStatus: "Invited" | "Active";
  matrix: StaffMatrix;
  duty: DutyAction[];
  reason: string;
}

const clone = (m: StaffMatrix) => normalizeMatrix(JSON.parse(JSON.stringify(m)));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isPreset = (v: string): v is StaffPreset => (STAFF_PRESETS as readonly string[]).includes(v);
const cellAllowed = (m: StaffModule, a: ModuleAction) => !MASTER_ONLY_MODULES.includes(m) && (!LIMITED_MODULES[m] || LIMITED_MODULES[m]!.includes(a));

function initialDraft(account: StaffAccount | null): Draft {
  const p = account?.profile;
  if (!account || !p) {
    const preset = presetAccess("Booking staff");
    return { username: "", password: "", confirmPassword: "", name: "", phone: "", email: "", contactEmail: "", branch: "", preset: "Booking staff", accountStatus: "Active", matrix: preset.matrix, duty: preset.duty, reason: "" };
  }
  return {
    username: account.username ?? "", password: "", confirmPassword: "",
    name: account.name, phone: p.phone, email: account.email, contactEmail: account.contactEmail || p.contactEmail || "", branch: p.branch, preset: isPreset(p.preset) ? p.preset : "Custom",
    accountStatus: p.accountStatus === "Active" ? "Active" : "Invited", matrix: clone(p.matrix), duty: [...p.duty], reason: "",
  };
}

/**
 * Create a Staff ID or edit its profile and access. Presets only pre-fill the matrix; the matrix is
 * what is saved and enforced. Granting something adds what it depends on (listed under the matrix);
 * removing a dependency is allowed and blocks the save until it is resolved. The server validates
 * the same rules and refuses a save made from an out-of-date copy.
 */
export default function StaffAccessEditor({ account, onClose, onSaved }: {
  account: StaffAccount | null;
  onClose: () => void;
  onSaved: (result: StaffSaveResult, created: boolean, who: { name: string; email: string }) => void;
}) {
  const editing = !!account;
  const [initial] = useState(() => initialDraft(account));
  // The version this form was opened from: a save after someone else's change is refused by the server.
  const [baseVersion] = useState(() => account?.profile?.accessVersion ?? 0);
  const [d, setD] = useState<Draft>(initial);
  const [added, setAdded] = useState<Requirement[]>([]);
  const [pendingPreset, setPendingPreset] = useState<StaffPreset | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ kind: StaffErrorKind; message: string } | null>(null);
  // One id for this form: a retry after a lost response returns the first save, never a second account.
  const [requestId] = useState(() => newId("staff"));
  const [touched, setTouched] = useState(false);

  const dirty = !same(d, initial);
  const status: StaffStatus = editing ? account!.profile?.accountStatus ?? "Inactive" : d.accountStatus;
  const identityErrors = validateStaffIdentity({ ...d, email: editing ? d.email : `${d.username.trim().toLowerCase()}@staff.nesam.invalid`, contactEmail: d.contactEmail });
  const credentialError = !editing ? (
    !/^[a-z][a-z0-9._-]{2,31}$/.test(d.username.trim().toLowerCase()) ? "Username must be 3–32 characters, start with a letter, and use letters, numbers, dots, underscores or hyphens."
      : d.password.length < 8 || d.password.length > 128 ? "Use a password between 8 and 128 characters."
        : d.password !== d.confirmPassword ? "Passwords do not match." : ""
  ) : "";
  const missing = useMemo(() => missingRequirements(d.matrix, d.duty), [d.matrix, d.duty]);
  const problems = useMemo(() => accessProblems(d.matrix, d.duty, status).filter((p) => !p.startsWith("Missing ")), [d.matrix, d.duty, status]);
  const reasonError = editing && d.reason.trim().length < 5 ? "Record why this access is changing (at least 5 characters)." : "";
  const blocked = Object.keys(identityErrors).length > 0 || !!credentialError || missing.length > 0 || problems.length > 0 || !!reasonError;

  // Leaving the page with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Applies a change; when it grants something, also grants what that depends on and lists it. */
  const update = (next: { matrix: StaffMatrix; duty: DutyAction[] }, granting: boolean) => {
    if (granting) {
      const r = withRequirements(next.matrix, next.duty);
      setAdded(r.added);
      setD((x) => ({ ...x, matrix: r.matrix, duty: r.duty }));
    } else {
      setAdded([]);
      setD((x) => ({ ...x, matrix: next.matrix, duty: next.duty }));
    }
  };

  const toggleModule = (m: StaffModule, a: ModuleAction, on: boolean) => {
    const matrix = clone(d.matrix);
    const row = matrix.modules[m] ?? [];
    // Removing View removes the whole row: no other action works without it.
    matrix.modules[m] = on ? MODULE_ACTIONS.filter((x) => x === a || row.includes(x)) : a === "view" ? [] : row.filter((x) => x !== a);
    update({ matrix, duty: d.duty }, on);
  };
  const toggleDuty = (k: DutyAction, on: boolean) => update({ matrix: d.matrix, duty: on ? DUTY_ACTIONS.map(([x]) => x).filter((x) => x === k || d.duty.includes(x)) : d.duty.filter((x) => x !== k) }, on);
  const toggleControl = (t: AccountType, a: AccountAction, on: boolean) => {
    const matrix = clone(d.matrix);
    const row = matrix.accountControls[t] ?? [];
    matrix.accountControls[t] = on ? ACCOUNT_ACTIONS.filter((x) => x === a || row.includes(x)) : row.filter((x) => x !== a);
    update({ matrix, duty: d.duty }, on);
  };
  const toggleFlag = (g: FlagGroup, k: string, on: boolean) => {
    const matrix = clone(d.matrix);
    matrix[g][k] = on;
    update({ matrix, duty: d.duty }, on);
  };
  const setLimit = (v: string) => {
    const n = Math.max(0, Math.round(Number(v) || 0));
    const matrix = clone(d.matrix);
    matrix.bankLimit = n;
    update({ matrix, duty: d.duty }, n > d.matrix.bankLimit);
  };

  const applyPreset = (p: StaffPreset, replace: boolean) => {
    if (replace) {
      const next = presetAccess(p);
      setAdded([]);
      setD((x) => ({ ...x, preset: p, matrix: next.matrix, duty: next.duty }));
    } else {
      setD((x) => ({ ...x, preset: p }));
    }
    setPendingPreset(null);
  };
  const choosePreset = (p: StaffPreset) => {
    if (p === d.preset) return;
    const base = presetAccess(d.preset);
    const customised = !same(d.matrix, base.matrix) || !same(d.duty, base.duty);
    if (customised) setPendingPreset(p);
    else applyPreset(p, true);
  };

  const close = () => {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  const save = async () => {
    if (saving) return;
    setTouched(true);
    if (blocked) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveStaffProfile({
        ...(editing ? { uid: account!.uid, expectedVersion: baseVersion } : { accountStatus: "Active", requestId, username: d.username.trim().toLowerCase(), password: d.password }),
        name: d.name, phone: d.phone, email: editing ? d.email : `${d.username.trim().toLowerCase()}@staff.nesam.invalid`, contactEmail: d.contactEmail, branch: d.branch, preset: d.preset, access: d.matrix, duty: d.duty, reason: d.reason,
      });
      // Credentials belong only to this creation form, never to the saved profile or result dialog.
      setD((current) => ({ ...current, password: "", confirmPassword: "" }));
      onSaved(result, !editing, { name: d.name.trim(), email: d.email.trim().toLowerCase() });
    } catch (e) {
      // Entries stay as they are so the Master can correct and retry.
      setError(e instanceof StaffActionError ? { kind: e.kind, message: e.message } : { kind: "service", message: "The server did not confirm the save. Your entries are kept; try again." });
    } finally {
      setSaving(false);
    }
  };

  const input = "w-full p-2 border border-line rounded-lg text-xs";
  const field = (label: string, key: "name" | "phone" | "email" | "contactEmail" | "branch", extra: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="block text-[11px] font-semibold text-muted mb-1">{label}</span>
      <input value={d[key]} onChange={(e) => setD({ ...d, [key]: e.target.value })} className={input} {...extra} />
      {touched && key !== "branch" && identityErrors[key] && <p className="text-[10px] text-red-600 mt-1">{identityErrors[key]}</p>}
    </label>
  );

  return (
    <>
      <Modal
        title={editing ? `Edit access · ${account!.name || account!.email}` : "Add staff"}
        subtitle={editing ? `${account!.profile?.staffCode ?? ""} · ${status}` : "Set a username, password and workspace access for this staff member."}
        onClose={close}
        busy={saving}
        size="xl"
        wide
        footNote={dirty ? "Unsaved changes" : undefined}
        footer={
          <>
            <Button onClick={close} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} loading={saving} disabled={saving || (touched && blocked)}>
              {saving ? "Saving…" : editing ? "Save profile & access" : "Create staff login"}
            </Button>
          </>
        }
      >
        <div className="space-y-5 text-xs">
          {!editing && <p className="p-3 rounded-lg bg-surface-2 border border-line text-body">You create the login credentials here. Staff sign in with their username and password; an email invitation is not required. Usernames must be unique and passwords must be 8–128 characters.</p>}
          {error && (
            <div role="alert" className={`p-3 rounded-lg border ${error.kind === "service" ? "bg-amber-50 border-amber-200 text-amber-900" : "bg-red-50 border-red-200 text-red-700"}`}>
              <strong className="block mb-0.5">
                {error.kind === "service" ? "Server not reachable" : error.kind === "permission" ? "Not permitted" : error.kind === "conflict" ? "Changed by someone else" : "Check the details"}
              </strong>
              {error.message}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {field("Full name *", "name", { maxLength: 80 })}
            {field("Mobile *", "phone", { maxLength: 10, inputMode: "numeric" })}
            {field("Email ID · optional", "contactEmail", { type: "email", maxLength: 120, placeholder: "e.g. staff@nesamtravels.com" })}
            {editing ? (account?.username ? <div><span className="block text-[11px] font-semibold text-muted mb-1">Username</span><input className={input} value={account.username} readOnly /></div> : field("Email (sign-in) *", "email", { type: "email", maxLength: 120 })) : (
              <>
                <label className="block"><span className="block text-[11px] font-semibold text-muted mb-1">Username / login ID *</span><input className={input} value={d.username} onChange={(e) => setD({ ...d, username: e.target.value.toLowerCase() })} maxLength={32} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="e.g. booking.staff01" /><span className="block mt-1 text-[11px] text-muted">3–32 characters; start with a letter. Use letters, numbers, dots, underscores or hyphens.</span></label>
                <label className="block"><span className="block text-[11px] font-semibold text-muted mb-1">Password *</span><input className={input} type="password" value={d.password} onChange={(e) => setD({ ...d, password: e.target.value })} minLength={8} maxLength={128} autoComplete="new-password" /></label>
                <label className="block"><span className="block text-[11px] font-semibold text-muted mb-1">Confirm password *</span><input className={input} type="password" value={d.confirmPassword} onChange={(e) => setD({ ...d, confirmPassword: e.target.value })} maxLength={128} autoComplete="new-password" /></label>
                {touched && credentialError && <p role="alert" className="text-[11px] text-red-600">{credentialError}</p>}
              </>
            )}
            {field("Branch · optional", "branch", { maxLength: 60 })}
            <label className="block">
              <span className="block text-[11px] font-semibold text-muted mb-1">Role preset</span>
              <select value={d.preset} onChange={(e) => choosePreset(e.target.value as StaffPreset)} className={input}>
                {STAFF_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            {!editing ? (
              <div className="text-[11px] text-muted self-end pb-2">Active — staff can sign in immediately with the username and password you set. Share these credentials privately.</div>
            ) : (
              <div className="text-[11px] text-muted self-end pb-2">Status changes (activate, suspend, deactivate, reactivate) are made from the profile, with a reason.</div>
            )}
          </div>

          <p className="p-3 rounded-lg bg-surface-2 border border-line text-[11px] text-body">
            The preset pre-fills the matrix below. What is ticked here is what this Staff ID can do — the server and database rules enforce it.
            Staff &amp; Access stays with the Master account; Settings can only be viewed or exported.
          </p>

          <section>
            <h3 className="text-[13px] font-bold text-ink mb-2">Workspace modules</h3>
            <div className="overflow-x-auto border border-line rounded-lg">
              <table className="w-full min-w-[640px] text-[12px]">
                <thead>
                  <tr className="bg-surface-2 text-[11px] text-faint uppercase">
                    <th className="px-3 py-2 text-left">Module</th>
                    {MODULE_ACTIONS.map((a) => <th key={a} className="px-2 py-2 text-center">{ACTION_LABEL[a]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {STAFF_MODULES.map((m) => (
                    <tr key={m} className="border-t border-line-soft">
                      <th scope="row" className="px-3 py-2 text-left font-semibold text-ink">
                        {m}
                        {MASTER_ONLY_MODULES.includes(m) && <span className="block text-[10px] font-normal text-faint">Master only</span>}
                      </th>
                      {MODULE_ACTIONS.map((a) => (
                        <td key={a} className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            className="accent-brand"
                            aria-label={`${m} ${a}`}
                            disabled={!cellAllowed(m, a) || saving}
                            checked={!!d.matrix.modules[m]?.includes(a)}
                            onChange={(e) => toggleModule(m, a, e.target.checked)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="text-[13px] font-bold text-ink mb-2">Duty permissions</h3>
            <div className="flex flex-wrap gap-3">
              {DUTY_ACTIONS.map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 px-2 py-1.5 border border-line rounded-lg">
                  <input type="checkbox" className="accent-brand" disabled={saving} checked={d.duty.includes(k)} onChange={(e) => toggleDuty(k, e.target.checked)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted mt-1">Each duty action needs Bookings view and approve.</p>
          </section>

          <section>
            <h3 className="text-[13px] font-bold text-ink mb-2">Account controls</h3>
            <div className="overflow-x-auto border border-line rounded-lg">
              <table className="w-full min-w-[520px] text-[12px]">
                <thead>
                  <tr className="bg-surface-2 text-[11px] text-faint uppercase">
                    <th className="px-3 py-2 text-left">Account type</th>
                    {ACCOUNT_ACTIONS.map((a) => <th key={a} className="px-2 py-2 text-center">{ACCOUNT_LABEL[a]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {ACCOUNT_TYPES.map((t) => (
                    <tr key={t} className="border-t border-line-soft">
                      <th scope="row" className="px-3 py-2 text-left font-semibold text-ink">{t}</th>
                      {ACCOUNT_ACTIONS.map((a) => (
                        <td key={a} className="px-2 py-2 text-center">
                          <input type="checkbox" className="accent-brand" aria-label={`${t} ${a}`} disabled={saving} checked={!!d.matrix.accountControls[t]?.includes(a)} onChange={(e) => toggleControl(t, a, e.target.checked)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted mt-1">Suspend does not include Reactivate. Permanent block / unblock and reopening closed accounts stay Master-only.</p>
          </section>

          {FLAG_SECTIONS.map((s) => (
            <section key={s.group}>
              <h3 className="text-[13px] font-bold text-ink mb-1">{s.title}</h3>
              <p className="text-[11px] text-muted mb-2">{s.note}</p>
              <div className="flex flex-wrap gap-3">
                {s.items.map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 px-2 py-1.5 border border-line rounded-lg">
                    <input type="checkbox" className="accent-brand" disabled={saving} checked={d.matrix[s.group][k] === true} onChange={(e) => toggleFlag(s.group, k, e.target.checked)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              {s.group === "sensitive" && (
                <label className="block mt-3 max-w-xs">
                  <span className="block text-[11px] font-semibold text-muted mb-1">Settlement approval limit · ₹ per settlement (0 = none)</span>
                  <input type="number" min={0} step={1} value={d.matrix.bankLimit} disabled={saving} onChange={(e) => setLimit(e.target.value)} className={input} />
                </label>
              )}
            </section>
          ))}

          {added.length > 0 && (
            <div role="status" className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800">
              <strong className="block mb-1">Also granted, because the change depends on it:</strong>
              <ul className="list-disc pl-5">{added.map((r, i) => <li key={i}>{describeRequirement(r)}</li>)}</ul>
            </div>
          )}
          {(missing.length > 0 || problems.length > 0) && (
            <div role="alert" className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
              <strong className="block mb-1">Resolve before saving:</strong>
              <ul className="list-disc pl-5">
                {problems.map((p) => <li key={p}>{p}</li>)}
                {missing.map((r, i) => <li key={i}>Missing {describeRequirement(r)}</li>)}
              </ul>
              {missing.length > 0 && (
                <Button size="sm" className="mt-2" onClick={() => update({ matrix: d.matrix, duty: d.duty }, true)}>Add the required access</Button>
              )}
            </div>
          )}

          <label className="block">
            <span className="block text-[11px] font-semibold text-muted mb-1">{editing ? "Reason for this change *" : "Note · optional"}</span>
            <input value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} maxLength={300} className={input} />
            {touched && reasonError && <p className="text-[10px] text-red-600 mt-1">{reasonError}</p>}
          </label>
          {editing && <p className="text-[11px] text-muted">Saving ends this person’s pending and approved customer-contact reveal requests. Their open pages update immediately.</p>}
        </div>
      </Modal>

      {pendingPreset && (
        <Modal
          title={`Apply the ${pendingPreset} preset?`}
          centered
          onClose={() => setPendingPreset(null)}
          footer={
            <>
              <Button onClick={() => applyPreset(pendingPreset, false)}>Keep my selections</Button>
              <Button variant="primary" onClick={() => applyPreset(pendingPreset, true)}>Replace selections</Button>
            </>
          }
        >
          <p className="text-xs text-body">
            The current selections differ from the {d.preset} preset. Replacing discards them and loads the {pendingPreset} defaults. Keeping them only changes the preset label.
          </p>
        </Modal>
      )}

      {confirmDiscard && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          message="The changes in this form have not been saved."
          confirmLabel="Discard"
          danger
          onConfirm={() => { setConfirmDiscard(false); onClose(); }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </>
  );
}

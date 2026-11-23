import { useState, type FormEvent } from "react";
import Icon from "../ui/Icon";
import { Modal } from "../Feedback";
import { copyText } from "../../utils/clipboard";
import { ROLE_PRESETS_META, presetPolicy, type RolePresetMeta } from "./rolePresets";
import { validateRole, type StaffRole } from "../../services/staffService";
import { permissionsOf, presetAccess } from "../../config/permissions";

const POLICY_TEXT = { none: "Numbers masked", temporary: "Temporary reveal", "on approval": "Reveal on approval" } as const;
const btn = "inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-xl text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#991B1B] disabled:opacity-50 disabled:cursor-not-allowed";
export const BTN_PRIMARY = `${btn} bg-[#991B1B] hover:bg-[#7F1D1D] text-white shadow-xs`;
export const BTN_SECONDARY = `${btn} bg-white border border-slate-200 text-slate-700 hover:bg-slate-50`;

/** The one-time login details of a Staff ID that was just created with a Master-set password. */
export interface ShareCredsData {
  name: string;
  staffCode: string;
  role: string;
  shift: string;
  username: string;
  /** Present only right after creation; never read back from a stored profile. */
  password?: string;
}

/**
 * Shown once, straight after a Staff ID is created. The password lives only in this dialog's props and is gone when
 * it closes; later the Master uses Reset password in the profile. Nothing is sent: the actions copy text.
 */
export function CredentialsHandoverModal({ creds, onClose, showToast }: {
  creds: ShareCredsData;
  onClose: () => void;
  showToast: (msg: string, type?: "success" | "error") => void;
}) {
  const [showPass, setShowPass] = useState(false);
  const loginUrl = typeof window !== "undefined" ? window.location.origin : "";
  const message = [
    "*NESAM CABS — Staff sign-in*",
    `Name: ${creds.name}`,
    creds.staffCode ? `Staff code: ${creds.staffCode}` : "",
    `Role: ${creds.role}`,
    creds.shift ? `Shift: ${creds.shift}` : "",
    "",
    `Sign in at: ${loginUrl}`,
    `Login ID: ${creds.username}`,
    creds.password ? `One-time password: ${creds.password}` : "",
    "",
    "Please change this password after your first sign-in.",
  ].filter((l, i, all) => l !== "" || (all[i - 1] ?? "") !== "").join("\n");

  const copy = async (text: string, ok: string) => {
    const done = await copyText(text);
    showToast(done ? ok : "The browser did not allow copying.", done ? "success" : "error");
  };

  return (
    <Modal title="Staff ID created" subtitle={`${creds.name}${creds.staffCode ? ` · ${creds.staffCode}` : ""}`} onClose={onClose} centered size="md"
      footer={<button type="button" onClick={onClose} className={BTN_PRIMARY}>Done</button>}>
      <div className="space-y-3 text-xs">
        <dl className="rounded-xl border border-slate-200 divide-y divide-slate-100">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <dt className="text-slate-500">Login ID</dt>
            <dd className="flex items-center gap-2 min-w-0"><code className="font-semibold text-slate-900 truncate">{creds.username}</code>
              <button type="button" onClick={() => void copy(creds.username, "Login ID copied.")} className="text-[11px] font-semibold text-[#991B1B] hover:underline shrink-0">Copy ID</button></dd>
          </div>
          {creds.password && (
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <dt className="text-slate-500">One-time password</dt>
              <dd className="flex items-center gap-2 min-w-0"><code className="font-semibold text-slate-900 truncate">{showPass ? creds.password : "••••••••••••••"}</code>
                <button type="button" onClick={() => setShowPass((v) => !v)} aria-label={showPass ? "Hide password" : "Show password"} className="text-slate-400 hover:text-slate-700 shrink-0">
                  <Icon name={showPass ? "eye-off" : "eye"} size={14} /></button></dd>
            </div>
          )}
        </dl>
        <p className="text-[11px] text-slate-500">
          {creds.password ? "This password is shown only now and is not stored in the panel. To change it later, use Reset password in the staff profile." : "Passwords are never shown again. Use Reset password in the staff profile to issue a new one."}
        </p>
        <button type="button" onClick={() => void copy(message, "Sign-in message copied. It has not been sent.")} className={`${BTN_SECONDARY} w-full`}>
          <Icon name="copy" size={14} />Copy WhatsApp message (not sent)
        </button>
      </div>
    </Modal>
  );
}

/** Built-in presets and custom roles, with how many Staff IDs use each. A role in use cannot be deleted. */
export function ManageRolesModal({ customRoles, assignedTo, onClose, onOpenAddRole, onDelete }: {
  customRoles: StaffRole[];
  /** Staff IDs using a preset ("preset:<name>") or a custom role ("role:<id>"). */
  assignedTo: (key: string) => number;
  onClose: () => void;
  onOpenAddRole: () => void;
  onDelete: (role: StaffRole) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remove = async (role: StaffRole) => {
    setDeleting(role.id);
    setError(null);
    try { await onDelete(role); } catch (e) { setError(e instanceof Error ? e.message : "The role was not deleted."); } finally { setDeleting(null); }
  };
  return (
    <Modal title="Roles" subtitle={`${ROLE_PRESETS_META.length} built-in presets · ${customRoles.length} custom`} onClose={onClose} size="xl" busy={!!deleting}
      footer={<><button type="button" onClick={() => { onClose(); onOpenAddRole(); }} className={BTN_SECONDARY}><Icon name="plus" size={14} />Add Extra Role</button><button type="button" onClick={onClose} className={BTN_PRIMARY}>Done</button></>}>
      <div className="space-y-5 text-xs">
        {error && <div role="alert" className="ds-error">{error}</div>}
        <section aria-labelledby="roles-builtin" className="space-y-2.5">
          <h3 id="roles-builtin" className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Built-in presets</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {ROLE_PRESETS_META.map((meta) => {
              const pol = presetPolicy(meta.preset);
              return (
                <div key={meta.id} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1.5 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border truncate ${meta.badgeClass}`}>{meta.shortName}</span>
                    <span className="text-[10px] font-semibold text-slate-500 shrink-0">{assignedTo(`preset:${meta.preset}`)} assigned</span>
                  </div>
                  <h4 className="font-bold text-slate-900 break-words">{meta.name}</h4>
                  <p className="text-[11px] text-slate-500">{meta.desc}</p>
                  <p className="text-[10px] text-slate-500 pt-1 border-t border-slate-200/60">Login prefix <code>{meta.prefix}.</code> · {POLICY_TEXT[pol.reveal]} · {pol.exports ? "Some exports" : "No exports"}</p>
                </div>
              );
            })}
          </div>
        </section>
        <section aria-labelledby="roles-custom" className="space-y-2.5">
          <h3 id="roles-custom" className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Custom roles</h3>
          {customRoles.length === 0 ? <p className="text-slate-500">No custom roles yet.</p> : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {customRoles.map((role) => {
                const n = assignedTo(`role:${role.id}`);
                return (
                  <div key={role.id} className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/30 space-y-1.5 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">Custom</span>
                      <span className="text-[10px] font-semibold text-slate-500">{n} assigned</span>
                    </div>
                    <h4 className="font-bold text-slate-900 break-words">{role.name}</h4>
                    <p className="text-[11px] text-slate-500">{role.basePreset ? `Starts from ${role.basePreset}` : "Older role: permission areas only"} · {role.permissions.length} area{role.permissions.length === 1 ? "" : "s"}</p>
                    <div className="pt-1 border-t border-amber-200/60 flex items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-500">{n ? "Move its staff to another role before deleting." : ""}</span>
                      <button type="button" disabled={n > 0 || !!deleting} onClick={() => void remove(role)} title={n ? "Assigned roles cannot be deleted" : "Delete this role"}
                        className="text-[11px] font-semibold text-red-700 hover:underline disabled:text-slate-400 disabled:no-underline disabled:cursor-not-allowed">
                        {deleting === role.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

/** Adds a custom role that starts from a built-in preset's modules and duties; resolves the saved role. */
export function CustomRoleModal({ roles, onClose, onSave }: {
  roles: StaffRole[];
  onClose: () => void;
  onSave: (name: string, preset: RolePresetMeta) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [presetId, setPresetId] = useState(ROLE_PRESETS_META[0].id);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const meta = ROLE_PRESETS_META.find((p) => p.id === presetId) ?? ROLE_PRESETS_META[0];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problems = validateRole(name, permissionsOf(presetAccess(meta.preset).matrix), roles, null);
    if (problems.name || problems.permissions) return setError(problems.name ?? problems.permissions ?? null);
    setSaving(true);
    setError(null);
    try { await onSave(name.trim(), meta); } catch (err) { setError(err instanceof Error ? err.message : "The role was not saved."); setSaving(false); }
  };

  return (
    <Modal title="Add extra role" subtitle="A custom role starts from a built-in preset; adjust each Staff ID's modules afterwards." onClose={onClose} centered size="md" busy={saving}
      footer={<><button type="button" onClick={onClose} disabled={saving} className={BTN_SECONDARY}>Cancel</button><button type="submit" form="custom-role-form" disabled={saving} className={BTN_PRIMARY}><Icon name="check" size={14} />{saving ? "Saving…" : "Save role"}</button></>}>
      <form id="custom-role-form" onSubmit={submit} className="space-y-4 text-xs" noValidate>
        {error && <div role="alert" className="ds-error">{error}</div>}
        <label className="ds-field"><span>Role name *</span>
          <input autoFocus required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Airport VIP Desk Controller" className="ds-input" /></label>
        <label className="ds-field"><span>Starts from</span>
          <select value={presetId} onChange={(e) => setPresetId(e.target.value)} className="ds-select">
            {ROLE_PRESETS_META.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      </form>
    </Modal>
  );
}

/** Development only: walks through the reason form. It reveals nothing and writes no log. */
export function DevUnmaskPreviewModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (reason: string) => void }) {
  const [category, setCategory] = useState("");
  const [detail, setDetail] = useState("");
  return (
    <Modal title="Reveal reason form (development preview)" subtitle="Nothing is revealed or logged from this preview." onClose={onClose} centered size="md"
      footer={<><button type="button" onClick={onClose} className={BTN_SECONDARY}>Cancel</button><button type="button" disabled={!category} onClick={() => onSubmit(detail.trim() ? `${category}: ${detail.trim()}` : category)} className={BTN_PRIMARY}>Check form</button></>}>
      <div className="space-y-3 text-xs">
        <label className="ds-field"><span>Reason category *</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="ds-select">
            <option value="">Choose a reason</option>
            <option>Pickup address landmark clarification</option>
            <option>Driver delayed / breakdown reassignment</option>
            <option>Customer cancellation &amp; refund inquiry</option>
          </select>
        </label>
        <label className="ds-field"><span>Note</span><textarea rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} className="ds-input h-auto py-2" /></label>
      </div>
    </Modal>
  );
}

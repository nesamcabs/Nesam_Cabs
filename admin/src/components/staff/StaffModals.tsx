import { useState, useCallback } from "react";
import Icon from "../ui/Icon";
import { ROLE_PRESETS_META, type RolePresetMeta } from "./StaffAccessEditor";
import { type StaffRole } from "../../services/staffService";

export interface ShareCredsData {
  name: string;
  staffCode: string;
  role: string;
  shift: string;
  username: string;
  password?: string;
}

export function WhatsAppShareModal({
  creds,
  onClose,
  showToast,
}: {
  creds: ShareCredsData;
  onClose: () => void;
  showToast: (msg: string, type?: "success" | "error") => void;
}) {
  const [showPass, setShowPass] = useState(false);
  const [copied, setCopied] = useState(false);

  const loginUrl = typeof window !== "undefined" ? window.location.origin : "https://nesamcabs.com/admin";

  const formattedMessage = `*NESAM CABS — STAFF LOGIN CREDENTIALS*
Staff Member: ${creds.name}
Staff ID: ${creds.staffCode || "Assigned"}
Role: ${creds.role}
Shift: ${creds.shift || "General Day Shift"}

*Login Credentials:*
• Login URL: ${loginUrl}
• Username: ${creds.username}
${creds.password ? `• Temporary Password: ${creds.password}` : "• Password: (As configured privately by Super Admin)"}

_Please sign in and update your temporary credentials. This account has access to the Nesam Cabs Admin Workspace._`;

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(formattedMessage);
        setCopied(true);
        showToast("WhatsApp credentials copied to clipboard!");
        setTimeout(() => setCopied(false), 2500);
      } else {
        showToast("Clipboard not available in this browser", "error");
      }
    } catch {
      showToast("Failed to copy to clipboard", "error");
    }
  }, [formattedMessage, showToast]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden fade-in">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-800">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Icon name="message-square" size={16} />
            </div>
            <h3 className="text-sm font-bold text-slate-900">WhatsApp Credentials Share Card</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200/80 space-y-2.5 text-xs">
            <div className="flex items-center justify-between border-b border-emerald-200/60 pb-2">
              <span className="font-bold text-emerald-950 uppercase text-[10px] tracking-wider">
                NESAM CABS • STAFF LOGIN
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                {creds.staffCode || "STAFF ID"}
              </span>
            </div>
            <div className="space-y-1 text-slate-800">
              <p>
                <span className="font-semibold text-slate-500">Name:</span> <strong>{creds.name}</strong>
              </p>
              <p>
                <span className="font-semibold text-slate-500">Role:</span> {creds.role}
              </p>
              <p>
                <span className="font-semibold text-slate-500">Shift / Hub:</span> {creds.shift}
              </p>
            </div>
            <div className="p-2.5 bg-white rounded-lg border border-emerald-200/70 space-y-1 font-mono text-[11px]">
              <p className="text-slate-700">
                Username: <strong className="text-slate-900">@{creds.username}</strong>
              </p>
              <div className="flex items-center justify-between">
                <span className="text-slate-700">
                  Password:{" "}
                  <strong className="text-slate-900">
                    {creds.password ? (showPass ? creds.password : "••••••••") : "(Hidden / Master Configured)"}
                  </strong>
                </span>
                {creds.password && (
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="text-[10px] text-emerald-700 hover:underline font-sans"
                  >
                    {showPass ? "Hide" : "Show"}
                  </button>
                )}
              </div>
              <p className="text-slate-500 truncate text-[10px] pt-0.5">URL: {loginUrl}</p>
            </div>
          </div>

          <p className="text-[11px] text-slate-500">
            Share this message securely with the employee. Credentials allow login on desktop, tablet, and mobile.
          </p>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 shadow-xs"
            >
              <Icon name="copy" size={14} />
              <span>{copied ? "Copied!" : "Copy WhatsApp Message"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ManageRolesModal({
  customRoles,
  onClose,
  onOpenAddRole,
}: {
  customRoles: StaffRole[];
  onClose: () => void;
  onOpenAddRole: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden fade-in max-h-[85vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-crimson-50 text-[#991B1B] flex items-center justify-center font-bold">
              <Icon name="sliders-horizontal" size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Configured Nesam Cabs Roles</h3>
              <p className="text-[11px] text-slate-500">7 Core Built-In Roles + Custom Role Builder</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-3 flex-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">7 Core Role Presets</span>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenAddRole();
              }}
              className="text-xs font-semibold text-[#991B1B] hover:underline flex items-center gap-1"
            >
              <Icon name="plus" size={12} />
              <span>+ Add Extra Role</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {ROLE_PRESETS_META.map((meta) => (
              <div key={meta.id} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${meta.badgeClass}`}>
                    {meta.shortName}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400 uppercase">Built-In</span>
                </div>
                <h4 className="font-bold text-slate-900">{meta.name}</h4>
                <p className="text-[11px] text-slate-500">{meta.desc}</p>
                <div className="flex items-center gap-2 text-[10px] text-slate-500 pt-1 border-t border-slate-200/60">
                  <span>Prefix: <code>{meta.prefix}.*</code></span>
                  <span>•</span>
                  <span>{meta.maskCustomer ? "Masked Numbers" : "Full Contact"}</span>
                </div>
              </div>
            ))}
          </div>

          {customRoles.length > 0 && (
            <div className="pt-4 border-t border-slate-100 space-y-3">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Custom Built Roles ({customRoles.length})</span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {customRoles.map((role) => (
                  <div key={role.id} className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/30 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                        Custom Role
                      </span>
                      <span className="text-[10px] text-slate-400">{role.permissions.length} permissions</span>
                    </div>
                    <h4 className="font-bold text-slate-900">{role.name}</h4>
                    <p className="text-[11px] text-slate-500">Custom permission set assigned to team members</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function CustomRoleModal({
  onClose,
  onSave,
  saving,
}: {
  onClose: () => void;
  onSave: (name: string, preset: RolePresetMeta) => Promise<void>;
  saving: boolean;
}) {
  const [name, setName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState(ROLE_PRESETS_META[0].id);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 3) {
      setError("Role name must be at least 3 characters.");
      return;
    }
    setError(null);
    const preset = ROLE_PRESETS_META.find((p) => p.id === selectedPresetId) || ROLE_PRESETS_META[0];
    await onSave(name.trim(), preset);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden fade-in">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
              <Icon name="plus-circle" size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Add Extra / Custom Role</h3>
              <p className="text-[11px] text-slate-500">Define a custom role preset with tailored permissions</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="w-8 h-8 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 font-medium">
              {error}
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Role Title *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Airport VIP Desk Controller"
              className="w-full h-10 px-3 text-sm font-medium text-slate-900 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Base Preset Template
            </label>
            <select
              value={selectedPresetId}
              onChange={(e) => setSelectedPresetId(e.target.value)}
              className="w-full h-10 px-3 text-xs sm:text-sm font-medium text-slate-900 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]"
            >
              {ROLE_PRESETS_META.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.shortName})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              New role will start with the default modules and security policies of the chosen template.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#991B1B] hover:bg-[#7F1D1D] text-white flex items-center gap-1.5 shadow-xs disabled:opacity-50"
            >
              <Icon name="check" size={14} />
              <span>{saving ? "Saving…" : "Save Custom Role"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function UnmaskReasonModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [category, setCategory] = useState("");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!category) {
      setError("Please select a valid reason category.");
      return;
    }
    const combined = detail.trim() ? `${category}: ${detail.trim()}` : category;
    onSubmit(combined);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden fade-in">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
              <Icon name="shield-alert" size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Mandatory Reason to View Customer Number</h3>
              <p className="text-[11px] text-slate-500">Every reveal is audited under your Staff ID</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 font-medium">
              {error}
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Select Reason Category *
            </label>
            <select
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full h-10 px-3 text-xs sm:text-sm font-medium text-slate-900 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]"
            >
              <option value="">-- Choose valid reason --</option>
              <option value="Pickup address landmark clarification">Pickup address landmark clarification</option>
              <option value="Driver delayed / breakdown reassignment">Driver delayed / breakdown reassignment</option>
              <option value="Flight/Train delay rescheduling">Flight/Train delay rescheduling</option>
              <option value="Customer cancellation & refund inquiry">Customer cancellation & refund inquiry</option>
              <option value="Other emergency operations">Other emergency operations</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Operational Note / Booking Reference
            </label>
            <textarea
              rows={3}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="e.g., Driver unable to locate passenger at Airport Terminal 1 Gate 4"
              className="w-full p-3 text-xs text-slate-900 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]"
            />
          </div>

          <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-[11px] text-amber-900">
            ⚠️ <strong>Customer Privacy Policy:</strong> Phone reveals are permanently logged with timestamp and staff
            identifier in the compliance audit trail. Zero unlogged views allowed.
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#991B1B] hover:bg-[#7F1D1D] text-white flex items-center gap-1.5 shadow-xs"
            >
              <Icon name="eye" size={14} />
              <span>Authorize &amp; View Number</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

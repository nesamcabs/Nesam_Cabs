import { useState, useEffect } from "react";
import OperationsSettingsCard from "../components/OperationsSettingsCard";
import DispatchRulesCard from "../components/DispatchRulesCard";
import {
  subscribeSettings,
  saveSettings,
} from "../services/adminFirestoreService";

const tabs = ["Company", "Booking", "Payment", "Notifications", "General", "Operations & Security"];

// Everything starts empty: company identity, tax and payment details are
// entered by the operator and never pre-filled with sample values.
const EMPTY_SETTINGS: Record<string, string | boolean> = {
  companyName: "",
  gst: "",
  phone: "",
  email: "",
  website: "",
  address: "",
  advanceBookingLimit: "",
  minBookingNotice: "",
  cancelWindow: "",
  cancelCharge: "",
  allowCod: false,
  smsEnabled: false,
  emailEnabled: false,
  whatsappEnabled: false,
  pushEnabled: false,
  currency: "",
  timezone: "",
  language: "",
  gstRate: "",
  upi: "",
};

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export default function Settings() {
  const [activeTab, setActiveTab] = useState("Company");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<any>(EMPTY_SETTINGS);
  const [formData, setFormData] = useState<any>(EMPTY_SETTINGS);

  useEffect(() => {
    const unsub = subscribeSettings((data) => {
      const next = { ...EMPTY_SETTINGS, ...data };
      setLoaded(next);
      setFormData(next);
    });
    return () => unsub();
  }, []);

  const handleSave = async () => {
    if (saving) return;
    setError(null);
    const gst = String(formData.gst || "").trim().toUpperCase();
    if (gst && !GSTIN_RE.test(gst)) {
      setActiveTab("Company");
      setError("Enter a valid 15-character GSTIN (e.g. 33ABCDE1234F1Z5).");
      return;
    }
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(formData.email).trim())) {
      setActiveTab("Company");
      setError("Enter a valid company email address.");
      return;
    }
    setSaving(true);
    // Gateway secrets are never stored in Firestore.
    const { rzpKey: _k, rzpSecret: _s, updatedAt: _u, ...safeData } = formData;
    const ok = await saveSettings({ ...safeData, gst });
    setSaving(false);
    if (!ok) {
      setError("Settings could not be saved. Check your connection and admin access, then try again.");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 bg-white rounded-xl border border-line p-1 w-fit shadow-sm">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2 rounded-lg text-[13px] font-semibold transition-all cursor-pointer ${
                activeTab === tab
                  ? "text-white shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
              style={activeTab === tab ? { background: "#c1232c" } : {}}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-semibold">
          {error}
        </div>
      )}
      <div className="bg-white rounded-xl border border-line shadow-sm p-6">
        {activeTab === "Operations & Security" && (<><OperationsSettingsCard /><DispatchRulesCard /></>)}
        {activeTab === "Company" && (
          <div className="space-y-6 max-w-2xl">
            <div>
              <h3 className="text-[15px] font-bold text-ink mb-4 flex items-center gap-2">
                <span
                  className="w-1 h-4 rounded-full"
                  style={{ background: "#c1232c" }}
                />
                Company Information
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  {
                    label: "Company Name",
                    key: "companyName",
                  },
                  { label: "GST Number", key: "gst" },
                  { label: "Phone", key: "phone" },
                  { label: "Email", key: "email" },
                  { label: "Website", key: "website" },
                ].map((f) => (
                  <div key={f.label}>
                    <label className="text-[11px] font-semibold text-faint uppercase tracking-wide block mb-1.5">
                      {f.label}
                    </label>
                    <input
                      value={formData[f.key] || ""}
                      onChange={(e) =>
                        setFormData({ ...formData, [f.key]: e.target.value })
                      }
                      className="w-full px-3 py-2 text-[13px] border border-line rounded-lg focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/20 text-ink"
                    />
                  </div>
                ))}
                <div className="md:col-span-2">
                  <label className="text-[11px] font-semibold text-faint uppercase tracking-wide block mb-1.5">
                    Address
                  </label>
                  <textarea
                    value={formData.address || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, address: e.target.value })
                    }
                    rows={3}
                    className="w-full px-3 py-2 text-[13px] border border-line rounded-lg focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/20 text-ink resize-none"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "Booking" && (
          <div className="space-y-5 max-w-xl">
            <p className="ds-note">Booking horizon and minimum notice update the server booking rules. Cash availability applies to new bookings. Customer cancellation charges follow the published cancellation policy (Terms &amp; Privacy); partner cancellation charges are set under Partner Requests.</p>
            <h3 className="text-[15px] font-bold text-ink flex items-center gap-2">
              <span
                className="w-1 h-4 rounded-full"
                style={{ background: "#c1232c" }}
              />
              Booking Rules
            </h3>
            {[
              {
                label: "Advance Booking Limit (days)",
                key: "advanceBookingLimit",
              },
              {
                label: "Minimum Booking Notice (hours)",
                key: "minBookingNotice",
              },
            ].map((f) => (
              <div key={f.label}>
                <label className="text-[11px] font-semibold text-faint uppercase tracking-wide block mb-1.5">
                  {f.label}
                </label>
                <input
                  type="number"
                  value={formData[f.key] || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, [f.key]: e.target.value })
                  }
                  className="w-full px-3 py-2 text-[13px] border border-line rounded-lg focus:outline-none focus:border-brand text-ink"
                />
              </div>
            ))}
            <div>
              <label className="text-[11px] font-semibold text-faint uppercase tracking-wide block mb-1.5">
                Allow Cash on Delivery
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={!!formData.allowCod}
                    onChange={(e) =>
                      setFormData({ ...formData, allowCod: e.target.checked })
                    }
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5 bg-line rounded-full peer peer-checked:bg-brand transition-colors" />
                  <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5" />
                </div>
                <span className="text-[13px] text-body">Enabled</span>
              </label>
            </div>
          </div>
        )}

        {activeTab === "Notifications" && (
          <div className="space-y-4 max-w-xl">
            <p className="ds-note">These switches control NESAM server delivery. A channel must also have a configured provider. Firebase sign-in OTP is managed separately by Firebase Authentication.</p>
            <h3 className="text-[15px] font-bold text-ink flex items-center gap-2">
              <span
                className="w-1 h-4 rounded-full"
                style={{ background: "#c1232c" }}
              />
              Notification Channels
            </h3>
            {[
              {
                label: "SMS Notifications",
                key: "smsEnabled",
                desc: "Send SMS for bookings and updates",
              },
              {
                label: "Email Notifications",
                key: "emailEnabled",
                desc: "Send email confirmations",
              },
              {
                label: "WhatsApp Notifications",
                key: "whatsappEnabled",
                desc: "Send WhatsApp updates via API",
              },
              {
                label: "Push Notifications",
                key: "pushEnabled",
                desc: "Browser and app push alerts",
              },
            ].map((n) => (
              <div
                key={n.label}
                className="flex items-center justify-between p-4 border border-line rounded-xl"
              >
                <div>
                  <div className="text-[13px] font-semibold text-ink">
                    {n.label}
                  </div>
                  <div className="text-[11px] text-faint mt-0.5">{n.desc}</div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={!!formData[n.key]}
                      onChange={(e) =>
                        setFormData({ ...formData, [n.key]: e.target.checked })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-line rounded-full peer peer-checked:bg-brand transition-colors" />
                    <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5" />
                  </div>
                </label>
              </div>
            ))}
          </div>
        )}

        {activeTab === "General" && (
          <div className="space-y-5 max-w-xl">
            <p className="ds-note">Fixed for the NESAM platform. GST on fares is set in Service &amp; Fare Settings; invoice tax rules are under Invoices → Tax automation.</p>
            <h3 className="text-[15px] font-bold text-ink flex items-center gap-2">
              <span
                className="w-1 h-4 rounded-full"
                style={{ background: "#c1232c" }}
              />
              General Settings
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "Currency", key: "currency" },
                { label: "Time Zone", key: "timezone" },
                { label: "Language", key: "language" },
              ].map((f) => (
                <div key={f.label}>
                  <label className="text-[11px] font-semibold text-faint uppercase tracking-wide block mb-1.5">
                    {f.label}
                  </label>
                  <input
                    value={formData[f.key] || ""}
                    readOnly
                    onChange={(e) =>
                      setFormData({ ...formData, [f.key]: e.target.value })
                    }
                    className="w-full px-3 py-2 text-[13px] border border-line rounded-lg focus:outline-none focus:border-brand text-ink"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "Payment" && (
          <div className="space-y-5 max-w-xl">
            <h3 className="text-[15px] font-bold text-ink flex items-center gap-2">
              <span
                className="w-1 h-4 rounded-full"
                style={{ background: "#c1232c" }}
              />
              Payment Settings
            </h3>
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
              <div className="text-[13px] font-semibold text-yellow-800 mb-1">
                ⚠️ Security Notice
              </div>
              <div className="text-[12px] text-yellow-700">
                Payment gateway API secrets must never be stored in Firestore.
                Configure keys via environment variables on your server or Cloud
                Functions only.
              </div>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-faint uppercase tracking-wide block mb-1.5">
                UPI ID (for manual payments)
              </label>
              <input
                value={formData.upi || ""}
                onChange={(e) =>
                  setFormData({ ...formData, upi: e.target.value })
                }
                className="w-full px-3 py-2 text-[13px] border border-line rounded-lg focus:outline-none focus:border-brand text-ink font-mono"
                placeholder="e.g. company@bank"
              />
            </div>
          </div>
        )}

        {activeTab !== "Operations & Security" && (
        <div className="mt-8 pt-5 border-t border-line flex gap-3">
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className={`px-6 py-2.5 text-[13px] font-semibold text-white rounded-lg transition-all disabled:opacity-50 ${saved ? "bg-green-600" : "hover:opacity-90"}`}
            style={!saved ? { background: "#c1232c" } : {}}
          >
            {saving ? "Saving…" : saved ? "✓ Saved!" : "Save Changes"}
          </button>
          <button
            onClick={() => {
              setFormData(loaded);
              setError(null);
            }}
            disabled={saving}
            className="px-6 py-2.5 text-[13px] font-semibold text-muted border border-line rounded-lg hover:bg-hover transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
        )}
      </div>
    </div>
  );
}

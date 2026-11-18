// Online payments (Razorpay) at a glance on the Payments page: are the keys and the webhook secret set (never the keys
// themselves), test or live mode, and the office's switch that turns customer online payment on or off. Partner payments (dues
// and deposits) are not affected by the switch.
import { useCallback, useEffect, useState } from "react";
import { getPaymentGatewayStatus, setOnlinePayments, type GatewayStatus } from "../services/bookingOpsService";
import { apiBaseUrl } from "../services/backend";
import { ActionError } from "../services/callables";
import { formatDateTime12 } from "../utils/time";

const chip = (ok: boolean) => (ok ? "text-green-700 bg-green-50 border-green-200" : "text-amber-800 bg-amber-50 border-amber-200");

export default function GatewayPanel({ onToast }: { onToast?: (text: string) => void }) {
  const [s, setS] = useState<GatewayStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      setS(await getPaymentGatewayStatus());
    } catch (e) {
      setError(e instanceof ActionError ? e.message : "Could not read the payment gateway status.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async () => {
    if (!s || busy) return;
    const next = !s.onlineEnabled;
    if (!next && !window.confirm("Switch customer online payments off? Customers will only be able to pay cash or UPI to the driver.")) return;
    setBusy(true);
    try {
      await setOnlinePayments(next);
      onToast?.(next ? "Customer online payments switched on." : "Customer online payments switched off.");
      await load();
    } catch (e) {
      setError(e instanceof ActionError ? e.message : "The switch was not changed.");
    } finally {
      setBusy(false);
    }
  };

  const webhook = apiBaseUrl ? `${apiBaseUrl}/api/razorpay-webhook` : "Firebase function: razorpayWebhook (us-central1)";
  const live = !!s && s.keyConfigured && s.onlineEnabled;

  return (
    <section className="bg-white rounded-2xl border border-line p-5 shadow-sm" aria-labelledby="gw-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="gw-title" className="text-[15px] font-bold text-ink">Online payments · Razorpay</h2>
          <p className="text-[12px] text-muted mt-0.5">
            Customers pay a booking's balance by UPI, card, net banking or wallet. Drivers and vendors pay dues and deposits. Money counts only after the server verifies it with Razorpay.
          </p>
        </div>
        {s && (
          <button
            onClick={() => void toggle()}
            disabled={busy || !s.keyConfigured}
            title={s.keyConfigured ? "" : "Set the Razorpay keys first"}
            className={`px-4 py-2 text-[12px] font-semibold rounded-lg border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${s.onlineEnabled ? "bg-white text-ink border-line hover:bg-gray-50" : "text-white border-transparent"}`}
            style={s.onlineEnabled ? undefined : { background: "#c1232c" }}
          >
            {busy ? "Saving…" : s.onlineEnabled ? "Switch customer payments off" : "Switch customer payments on"}
          </button>
        )}
      </div>

      {error && <div className="mt-3 text-[12px] text-brand bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {s ? (
        <>
          <div className="mt-4 flex flex-wrap gap-2 text-[12px]">
            <span className={`px-2.5 py-1 rounded-full border font-semibold ${chip(s.keyConfigured)}`}>API keys: {s.keyConfigured ? `set (${s.keyIdHint})` : "not set"}</span>
            <span className={`px-2.5 py-1 rounded-full border font-semibold ${s.mode === "live" ? chip(true) : chip(false)}`}>Mode: {s.mode === "live" ? "Live" : s.mode === "test" ? "Test (no real money)" : "—"}</span>
            <span className={`px-2.5 py-1 rounded-full border font-semibold ${chip(s.webhookConfigured)}`}>Webhook secret: {s.webhookConfigured ? "set" : "not set"}</span>
            <span className={`px-2.5 py-1 rounded-full border font-semibold ${chip(live)}`}>Customer online payment: {live ? "on" : s.onlineEnabled ? "on, waiting for keys" : "off"}</span>
          </div>
          {s.updatedByName && (
            <p className="mt-2 text-[11px] text-faint">
              Switch last changed by {s.updatedByName}
              {s.updatedAt ? ` · ${formatDateTime12(new Date(s.updatedAt))}` : ""}
            </p>
          )}
          {(!s.keyConfigured || !s.webhookConfigured || s.mode === "test") && (
            <div className="mt-3 text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {!s.keyConfigured
                ? "Online payment stays hidden in every app until the Razorpay keys are set on the server."
                : !s.webhookConfigured
                  ? "Payments work, but without the webhook a payment whose window was closed early is confirmed only when the customer returns. Set the webhook secret."
                  : "Test mode: payments use Razorpay's test cards and UPI ids and no real money moves. Switch to live keys before launch."}
            </div>
          )}
        </>
      ) : !error ? (
        <div className="mt-4 h-8 w-72 rounded bg-gray-100 animate-pulse" />
      ) : null}

      <button onClick={() => setHelp((h) => !h)} className="mt-3 text-[12px] font-semibold text-brand cursor-pointer" aria-expanded={help}>
        {help ? "Hide setup steps" : "How to set up Razorpay"}
      </button>
      {help && (
        <ol className="mt-2 list-decimal pl-5 space-y-1 text-[12px] text-body">
          <li>In the Razorpay Dashboard › Account & Settings › API Keys, generate a key (Test first, then Live).</li>
          <li>
            Set <code>RAZORPAY_KEY_ID</code> and <code>RAZORPAY_KEY_SECRET</code> on the server: as Vercel environment variables of the API project, and with{" "}
            <code>firebase functions:secrets:set</code> for the Firebase functions. Never put them in Firestore or in an app.
          </li>
          <li>
            In Razorpay › Webhooks, add <code className="break-all">{webhook}</code> with the events <code>payment.captured</code>, <code>payment.failed</code> and{" "}
            <code>order.paid</code>, and a secret. Set the same secret as <code>RAZORPAY_WEBHOOK_SECRET</code> on the server.
          </li>
          <li>Redeploy the API and functions, then refresh this panel: all four chips should be green.</li>
        </ol>
      )}
    </section>
  );
}

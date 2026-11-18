import { useRef, useState } from "react";
import { DEMO_STEPS, publishDemoSetup, type DemoStatus, type DemoStep } from "../services/demoSetupService";
import { Notice, primaryBtn, secondaryBtn } from "../components/FormKit";
import { useAccess } from "../components/AccessContext";

const ICON: Record<DemoStatus, string> = { waiting: "○", running: "◔", done: "✓", skipped: "–", failed: "✕" };
const TONE: Record<DemoStatus, string> = { waiting: "text-muted", running: "text-brand", done: "text-ok", skipped: "text-muted", failed: "text-bad" };
const WORD: Record<DemoStatus, string> = { waiting: "Waiting", running: "Working…", done: "Saved", skipped: "Already there", failed: "Needs attention" };

/**
 * Demo data setup: one button that fills every pricing and catalogue setting with a complete demo data set (all vehicle classes, all
 * three brands, every Indian state, the Round Trip guide v8 packages…). Safe to press again: by default whatever is already saved is kept.
 */
export default function DemoSetup() {
  const access = useAccess();
  const [replace, setReplace] = useState(false);
  const [sure, setSure] = useState(false);
  const [asking, setAsking] = useState(false);
  const [steps, setSteps] = useState<DemoStep[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const inFlight = useRef(false);

  if (!access.isSuper) {
    return <div className="p-4 md:p-6"><Notice tone="warn">Only the Super Admin can publish demo data.</Notice></div>;
  }

  const run = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFinished(false);
    setAsking(false);
    try {
      const done = await publishDemoSetup({ replace, onProgress: setSteps });
      setSteps(done);
    } finally {
      inFlight.current = false;
      setBusy(false);
      setSure(false);
      setFinished(true);
    }
  };

  const list = steps ?? DEMO_STEPS.map((s) => ({ ...s, status: "waiting" as DemoStatus, detail: "" }));
  const failed = list.filter((s) => s.status === "failed");
  const changed = list.filter((s) => s.status === "done").length;

  return (
    <div className="p-4 md:p-6 space-y-5" style={{ maxWidth: 920 }}>
      <div>
        <h1 className="text-xl font-bold text-ink">Demo data setup</h1>
        <p className="text-sm text-muted">One button fills every pricing and catalogue setting with a complete demo set: all vehicle classes on NESAM, People Taxi and One Way Car Rentals, the Round Trip guide v8 packages and hill-station charges, rentals, airport, GST, brand prices, local fares and fixed routes in every Indian state. Replace the demo amounts later in Service & Fare Settings.</p>
      </div>

      <section className="ds-panel ds-panel-pad" aria-label="What will be published">
        <h2 className="text-[15px] font-bold text-ink mb-3">What gets published</h2>
        <ol className="space-y-2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {list.map((s, i) => (
            <li key={s.id} className="flex items-start gap-3" aria-live={s.status === "running" ? "polite" : undefined}>
              <span className={`${TONE[s.status]} font-bold`} style={{ width: 22, textAlign: "center", fontSize: 18, lineHeight: "22px" }} aria-hidden="true">{ICON[s.status]}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="text-[13px] font-semibold text-ink">{i + 1}. {s.label} <span className={`${TONE[s.status]} text-[11px] font-bold uppercase ml-1`}>{steps ? WORD[s.status] : ""}</span></div>
                <div className="text-[12px] text-muted">{s.detail || s.hint}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <label className="flex items-start gap-2 text-[13px]">
        <input type="checkbox" checked={replace} disabled={busy} onChange={(e) => setReplace(e.target.checked)} style={{ marginTop: 3 }} />
        <span><strong>Replace prices that are already saved</strong> with the demo values. Leave this off to keep everything you have already set and fill only what is missing.</span>
      </label>

      {!asking ? (
        <button type="button" className={primaryBtn} disabled={busy} onClick={() => setAsking(true)} style={{ minHeight: 52, fontSize: 16, padding: "0 28px" }}>
          {busy ? "Publishing…" : finished ? "Publish again" : "Publish everything"}
        </button>
      ) : (
        <div className="ds-panel ds-panel-pad" role="alertdialog" aria-label="Confirm publishing" style={{ borderColor: "var(--color-brand)" }}>
          <p className="text-[13px] text-ink mb-2"><strong>This writes to your live database.</strong> Customers on all three sites will see these prices as soon as the tariff is on. {replace ? "Prices already saved will be replaced." : "Prices already saved are kept."} Every price change is recorded in the audit log.</p>
          <label className="flex items-center gap-2 text-[13px] mb-3">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I understand and want to publish the demo data
          </label>
          <div className="flex gap-2">
            <button type="button" className={primaryBtn} disabled={!sure || busy} onClick={run}>Yes, publish everything</button>
            <button type="button" className={secondaryBtn} onClick={() => { setAsking(false); setSure(false); }}>Cancel</button>
          </div>
        </div>
      )}

      {finished && !busy ? (
        failed.length ? (
          <Notice tone="error">{failed.length} step{failed.length > 1 ? "s" : ""} need attention (shown in red above). Everything else was saved. Fix the cause and press “Publish again” — saved parts are kept, so it only fills what is missing.</Notice>
        ) : (
          <Notice tone="ok">Done. {changed ? `${changed} part${changed > 1 ? "s" : ""} published.` : "Everything was already in place."} Open Service & Fare Settings to see and edit every value; the customer sites show the new prices within a minute.</Notice>
        )
      ) : null}
    </div>
  );
}

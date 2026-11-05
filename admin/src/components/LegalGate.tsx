import { useCallback, useEffect, useState } from "react";
import { getLegalStatus, acceptLegalDocuments, type RequiredLegalDoc } from "../services/bookingOpsService";
import { getDoc, doc } from "firebase/firestore";
import { db } from "../services/firebase";
import { Notice, primaryBtn } from "./FormKit";

interface Doc { id: string; title: string; body: string; version: number; checkboxText: string }

/**
 * Blocks the admin panel until the signed-in staff member has accepted the
 * current published staff documents (a new version asks again). If nothing is
 * published, or the status can't be read, it does not block.
 */
export default function LegalGate({ children }: { children: React.ReactNode }) {
  const [missing, setMissing] = useState<RequiredLegalDoc[]>([]);
  const [bodies, setBodies] = useState<Record<string, Doc>>({});
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await getLegalStatus("admin");
      setMissing(s.missing);
      if (s.missing.length) {
        // Staff can read published documents directly; fetch the text to show it.
        const entries = await Promise.all(s.missing.map(async (m) => {
          const snap = await getDoc(doc(db, "legal_documents", m.key));
          return [m.key, { id: m.key, title: m.title, body: String(snap.data()?.body ?? ""), version: m.version, checkboxText: m.checkboxText }] as const;
        }));
        setBodies(Object.fromEntries(entries));
      }
    } catch {
      setMissing([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!missing.length) return <>{children}</>;
  const text = missing[0].checkboxText || "I agree to the Staff Acceptable Use Policy and Privacy Policy.";

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await acceptLegalDocuments("admin", missing, text);
      setMissing([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record your acceptance.");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Terms and privacy">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[calc(100vh-2rem)] flex flex-col">
        <div className="px-6 py-4 border-b border-line">
          <h2 className="text-lg font-bold text-ink">Please review and accept to continue</h2>
          <p className="text-sm text-muted">These documents are new or have changed since you last accepted.</p>
        </div>
        <div className="px-6 py-4 overflow-y-auto space-y-4">
          {missing.map((m) => (
            <details key={m.key} className="border border-line rounded-lg" open={missing.length === 1}>
              <summary className="px-4 py-3 text-sm font-bold cursor-pointer">{m.title} <span className="font-normal text-muted">· version {m.version}</span></summary>
              <pre className="px-4 pb-4 text-sm text-body whitespace-pre-wrap font-sans max-h-72 overflow-auto">{bodies[m.key]?.body || "Loading…"}</pre>
            </details>
          ))}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
        <div className="px-6 py-4 border-t border-line space-y-3">
          <label className="flex items-start gap-2 text-sm font-semibold text-ink">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="w-4 h-4 mt-0.5 accent-brand" />
            <span>{text}</span>
          </label>
          <button onClick={accept} disabled={!checked || busy} className={primaryBtn}>{busy ? "Saving…" : "Accept and continue"}</button>
        </div>
      </div>
    </div>
  );
}


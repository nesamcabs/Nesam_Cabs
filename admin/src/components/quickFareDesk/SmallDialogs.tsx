import { useState, type FormEvent } from "react";
import { Eye, LoaderCircle } from "lucide-react";
import DeskDialog from "./DeskDialog";
import { LOST_REASONS, REVEAL_CATEGORIES, REVEAL_NOTE_MIN, type LostReason } from "../../domain/quickFareDesk";
import { DESK_MAX_RENTAL_HOURS } from "./deskTrip";

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** Mandatory reason before a caller's number is shown. The server logs it first and only then releases the number. */
export function RevealDialog({ caller, onReveal, onClose }: { caller: string; onReveal: (category: string, note: string) => Promise<void>; onClose: () => void }) {
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!category) return setError("Select a valid reason.");
    if (note.trim().length < REVEAL_NOTE_MIN) return setError(`Enter a note of at least ${REVEAL_NOTE_MIN} characters.`);
    setBusy(true);
    setError(null);
    try {
      await onReveal(category, note.trim());
    } catch (err) {
      setError(errText(err, "The number could not be shown. Try again."));
      setBusy(false);
    }
  };
  return (
    <DeskDialog title="Mandatory Reason to View Number" subtitle={caller} icon={<Eye className="w-4 h-4" />} tone="amberStrong" header="amber" variant="center" size="md" busy={busy} onClose={onClose}>
      <form onSubmit={submit} className="p-5 space-y-3.5 text-xs" noValidate>
        <div>
          <label htmlFor="qfRrPreset" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Reason Category *</label>
          <select id="qfRrPreset" data-autofocus required value={category} disabled={busy} onChange={(e) => { setCategory(e.target.value); setError(null); }}
            className="w-full h-9 px-2.5 font-semibold border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#991B1B]">
            <option value="">-- Select valid reason --</option>
            {REVEAL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="qfRrDetail" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Detailed Note (Min {REVEAL_NOTE_MIN} characters) *</label>
          <input id="qfRrDetail" required maxLength={200} disabled={busy} value={note} onChange={(e) => { setNote(e.target.value); setError(null); }}
            placeholder="e.g., Calling back caller to confirm the quoted booking" className="w-full h-9 px-3 border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]" />
        </div>
        {error && <div role="alert" className="px-3 py-2 rounded-xl font-medium bg-amber-50 text-amber-800 border border-amber-200">{error}</div>}
        <button type="submit" disabled={busy} className="w-full bg-[#991B1B] hover:bg-[#7F1D1D] text-white font-semibold py-2.5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-80 disabled:cursor-progress">
          {busy && <LoaderCircle className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
          {busy ? "Logging Reason…" : "Log Reason & Reveal Number"}
        </button>
      </form>
    </DeskDialog>
  );
}

export function LostDialog({ caller, onSave, onClose }: { caller: string; onSave: (reason: LostReason) => Promise<void>; onClose: () => void }) {
  const [reason, setReason] = useState<LostReason>(LOST_REASONS[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(reason);
    } catch (err) {
      setError(errText(err, "The enquiry was not updated. Try again."));
      setBusy(false);
    }
  };
  return (
    <DeskDialog title="Mark Enquiry as Lost" subtitle={caller || "Select why caller did not book"} header="plain" variant="center" size="sm" busy={busy} onClose={onClose}>
      <form onSubmit={submit} className="p-5 space-y-3 text-xs">
        <fieldset className="space-y-2" disabled={busy}>
          <legend className="sr-only">Select why the caller did not book</legend>
          {LOST_REASONS.map((r, i) => (
            <label key={r} className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
              <input type="radio" name="lostReason" value={r} data-autofocus={i === 0 || undefined} checked={reason === r} onChange={() => setReason(r)} className="accent-[#991B1B]" />
              <span className="font-medium text-slate-800">{r}</span>
            </label>
          ))}
        </fieldset>
        {error && <div role="alert" className="px-3 py-2 rounded-xl font-medium bg-amber-50 text-amber-800 border border-amber-200">{error}</div>}
        <button type="submit" disabled={busy} className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2.5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-80 disabled:cursor-progress">
          {busy && <LoaderCircle className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
          {busy ? "Saving…" : "Save Lost Reason"}
        </button>
      </form>
    </DeskDialog>
  );
}

export function RentalDialog({ hours, onPick, onClose }: { hours: number; onPick: (h: number) => void; onClose: () => void }) {
  return (
    <DeskDialog title="Rental duration" subtitle={`Choose from 1 to ${DESK_MAX_RENTAL_HOURS} hours to calculate instant rental fares.`} header="handle" size="md" onClose={onClose}>
      <div className="px-5 pb-5">
        <div className="grid grid-cols-3 gap-2.5 mt-4" role="radiogroup" aria-label="Rental hours">
          {Array.from({ length: DESK_MAX_RENTAL_HOURS }, (_, i) => i + 1).map((h) => (
            <button key={h} type="button" role="radio" aria-checked={hours === h} data-autofocus={hours === h || undefined} onClick={() => onPick(h)}
              className={`py-2.5 px-2 rounded-xl text-xs ${hours === h ? "font-bold border border-[#B91C1C] bg-[#FEF2F2] text-[#991B1B]" : "font-semibold border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"}`}>
              {h} {h === 1 ? "hour" : "hours"}
            </button>
          ))}
        </div>
      </div>
    </DeskDialog>
  );
}

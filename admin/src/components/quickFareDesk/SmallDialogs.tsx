import { useState, type FormEvent } from "react";
import Icon from "../ui/Icon";
import DeskDialog from "./DeskDialog";
import { LOST_REASONS, REVEAL_CATEGORIES, type LostReason } from "../../domain/quickFareDesk";
import { DESK_MAX_RENTAL_HOURS } from "./deskTrip";

/** A note counts when it says something: 10+ characters including at least 3 letters. */
const meaningful = (v: string) => v.trim().length >= 10 && (v.match(/[a-z஀-௿]/gi)?.length ?? 0) >= 3;

export function RevealDialog({ caller, onReveal, onClose }: { caller: string; onReveal: (category: string, note: string) => void; onClose: () => void }) {
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!category) return setError("Choose a reason category.");
    if (!meaningful(note)) return setError("Write a short note (at least 10 characters) saying why you need the number.");
    onReveal(category, note.trim());
  };
  return (
    <DeskDialog title="Reason to view number" icon="eye" tone="amber" subtitle={caller} size="md" onClose={onClose}>
      <form onSubmit={submit} className="p-5 space-y-3.5" noValidate>
        <div className="dk-ff">
          <label htmlFor="rvCategory">Reason category *</label>
          <select id="rvCategory" data-autofocus className="dk-in" value={category} onChange={(e) => { setCategory(e.target.value); setError(null); }}>
            <option value="">Select a reason</option>
            {REVEAL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="dk-ff">
          <label htmlFor="rvNote">Note *</label>
          <input id="rvNote" className="dk-in" maxLength={200} value={note} onChange={(e) => { setNote(e.target.value); setError(null); }} placeholder="Why you need the number now" />
        </div>
        {error && <div role="alert" className="px-3 py-2 rounded-xl text-xs font-semibold bg-red-50 text-red-800 border border-red-200">{error}</div>}
        <button type="submit" className="w-full h-11 bg-[#991B1B] hover:bg-[#7F1D1D] text-white font-extrabold text-sm rounded-xl flex items-center justify-center gap-2">
          <Icon name="eye" size={15} />Show number
        </button>
        <p className="text-[11px] text-slate-500">Recorded in this session's number-view history only.</p>
      </form>
    </DeskDialog>
  );
}

export function LostDialog({ caller, onSave, onClose }: { caller: string; onSave: (reason: LostReason) => void; onClose: () => void }) {
  const [reason, setReason] = useState<LostReason>(LOST_REASONS[0]);
  return (
    <DeskDialog title="Mark enquiry as lost" icon="calendar-x" tone="crimson" subtitle={caller} size="sm" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSave(reason); }} className="p-5 space-y-3">
        <fieldset className="space-y-2">
          <legend className="dk-ff__label">Why did the caller not book?</legend>
          {LOST_REASONS.map((r, i) => (
            <label key={r} className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50 text-xs font-semibold text-slate-800">
              <input type="radio" name="lostReason" value={r} data-autofocus={i === 0 || undefined} checked={reason === r} onChange={() => setReason(r)} className="accent-[#991B1B]" />
              {r}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-sm rounded-xl">Save lost reason</button>
      </form>
    </DeskDialog>
  );
}

export function RentalDialog({ hours, onPick, onClose }: { hours: number; onPick: (h: number) => void; onClose: () => void }) {
  return (
    <DeskDialog title="Rental duration" icon="clock" tone="crimson" subtitle={`1 to ${DESK_MAX_RENTAL_HOURS} hours`} size="md" onClose={onClose}>
      <div className="p-5 grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Rental hours">
        {Array.from({ length: DESK_MAX_RENTAL_HOURS }, (_, i) => i + 1).map((h) => (
          <button key={h} type="button" role="radio" aria-checked={hours === h} data-autofocus={hours === h || undefined} onClick={() => onPick(h)}
            className={`h-11 rounded-xl text-xs transition-colors ${hours === h ? "font-extrabold border-[1.5px] border-[#991B1B] bg-crimson-50 text-[#991B1B]" : "font-bold border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"}`}>
            {h} {h === 1 ? "hour" : "hours"}
          </button>
        ))}
      </div>
    </DeskDialog>
  );
}

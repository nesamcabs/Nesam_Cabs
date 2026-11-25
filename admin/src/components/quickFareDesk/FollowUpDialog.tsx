import { useEffect, useRef, useState, type FormEvent } from "react";
import { BellPlus, BellRing, CalendarClock, LoaderCircle } from "lucide-react";
import DeskDialog from "./DeskDialog";
import {
  HOURS_12,
  MINUTES_60,
  REMINDER_CHIPS,
  TOMORROW_PRESETS,
  istDateOf,
  istMs,
  istTimeOf,
  joinClock12,
  mobileInputValue,
  normalizeIndianMobile,
  reminderPresetAt,
  splitClock12,
  type Meridiem,
  type ReminderPreset,
} from "../../domain/quickFareDesk";
import { callerBadgeText, useCallerLookup } from "../../hooks/useCallerLookup";
import type { Customer } from "../../types";
import CustomerSuggestions from "../booking/CustomerSuggestions";
import { useRankedCustomers } from "../../hooks/useRankedCustomers";
import type { CustomerSuggestion } from "../../domain/customerSuggestions";

export interface FollowUpSubmit {
  customerId: string | null;
  mobile: string;
  digits: string;
  name: string;
  followUpAtMs: number;
  note: string;
}

const LABEL = "block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1";
const SELECT = "h-9 px-2 text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#991B1B]";

export default function FollowUpDialog({ summary, customers, onSave, onClose }: {
  /** "Theni → Madurai • SUV (Diesel • Pet Friendly) • ₹4,365". */
  summary: string;
  customers: Customer[];
  onSave: (v: FollowUpSubmit) => Promise<void>;
  onClose: () => void;
}) {
  const [mobile, setMobile] = useState("");
  const [name, setName] = useState("");
  const nameAuto = useRef(false);
  // The schedule fields show the chosen reminder; a preset keeps its exact instant until a field is changed by hand.
  const [preset, setPreset] = useState<{ id: ReminderPreset; atMs: number } | null>(() => ({ id: "15", atMs: reminderPresetAt("15", Date.now()) }));
  // The initialisers run on the first render only, while the "In 15 min" preset is set.
  const [date, setDate] = useState(() => istDateOf(preset!.atMs));
  const [clock, setClock] = useState(() => splitClock12(istTimeOf(preset!.atMs)));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lookup = useCallerLookup(mobile, customers);
  const [suggest, setSuggest] = useState<"" | "mobile" | "name">("");
  const ranked = useRankedCustomers(customers);
  const pick = ({ customer, digits }: CustomerSuggestion) => {
    setName(customer.name || "");
    nameAuto.current = true;
    setSuggest("");
    // A follow-up stores the number to call: a masked one has to be typed.
    setMobile(digits);
    if (!digits) nameAuto.current = false;
    setError(digits ? null : `Type the full mobile number for ${customer.name || "this customer"} (${customer.phoneMasked ?? "hidden"}).`);
  };
  const norm = normalizeIndianMobile(mobile);

  // A name filled from a customer record belongs to that number: another number clears it (or fills the new match).
  const foundId = lookup.state === "found" ? lookup.id : "";
  const foundName = lookup.state === "found" ? lookup.customer?.name ?? "" : "";
  useEffect(() => {
    if (foundName && (!name.trim() || nameAuto.current)) { setName(foundName); nameAuto.current = true; }
    else if (!foundId && nameAuto.current) { setName(""); nameAuto.current = false; }
  }, [foundId, foundName]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (id: ReminderPreset) => {
    const atMs = reminderPresetAt(id, Date.now());
    setPreset({ id, atMs });
    setDate(istDateOf(atMs));
    setClock(splitClock12(istTimeOf(atMs)));
    setError(null);
    const tomorrow = TOMORROW_PRESETS.find((t) => t.id === id);
    if (tomorrow && !note.trim()) setNote(tomorrow.note);
  };
  const edit = (patch: Partial<{ date: string; hour: string; minute: string; mer: Meridiem }>) => {
    if (patch.date !== undefined) setDate(patch.date);
    setClock((c) => ({ hour: patch.hour ?? c.hour, minute: patch.minute ?? c.minute, mer: patch.mer ?? c.mer }));
    setPreset(null);
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!norm.ok) return setError(norm.reason);
    const atMs = preset ? preset.atMs : istMs(date, joinClock12(clock.hour, clock.minute, clock.mer));
    if (!Number.isFinite(atMs)) return setError("Choose the follow-up date and time.");
    if (atMs < Date.now() - 60000 && preset?.id !== "now") return setError("That follow-up time has passed. Choose a later time, or Alert Now.");
    setBusy(true);
    setError(null);
    try {
      await onSave({ customerId: foundId || null, mobile: norm.e164, digits: norm.digits, name: name.trim(), followUpAtMs: atMs, note: note.trim() });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "The follow-up was not saved. Try again.");
      setBusy(false);
    }
  };

  const badge = callerBadgeText(lookup);
  return (
    <DeskDialog title="Save Follow-Up & Set Alert" subtitle={summary} icon={<BellPlus className="w-4 h-4" />} tone="amber" size="md" busy={busy} onClose={onClose}>
      <form onSubmit={submit} className="p-5 space-y-4" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="fuMobileInput" className={LABEL}>Caller Mobile *</label>
            <div className="flex items-center h-10 bg-white border border-slate-200 rounded-xl overflow-hidden focus-within:border-[#991B1B]">
              <span className="px-2.5 text-xs font-semibold text-slate-500 bg-slate-50 h-full flex items-center border-r border-slate-200" aria-hidden="true">+91</span>
              <input id="fuMobileInput" data-autofocus type="tel" inputMode="tel" autoComplete="off" placeholder="10-digit mobile" value={mobile}
                onChange={(e) => { setMobile(mobileInputValue(e.target.value)); setSuggest("mobile"); setError(null); }}
                onFocus={() => setSuggest(lookup.state === "found" ? "" : "mobile")} onClick={() => setSuggest(lookup.state === "found" ? "" : "mobile")} onBlur={() => setSuggest("")}
                aria-invalid={!!error && !norm.ok} aria-describedby={error ? "fuError" : undefined}
                className="w-full h-full px-2.5 text-sm font-medium text-slate-800 !border-0 !outline-none !shadow-none" />
            </div>
          </div>
          <div>
            <label htmlFor="fuNameInput" className={LABEL}>Caller Name</label>
            <input id="fuNameInput" placeholder="e.g., Ramesh" maxLength={80} autoComplete="off" value={name} onChange={(e) => { setName(e.target.value); nameAuto.current = false; setSuggest(foundId ? "" : "name"); }} onBlur={() => setSuggest("")}
              className="w-full h-10 px-3 text-sm font-medium text-slate-800 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]" />
          </div>
        </div>
        {suggest && <CustomerSuggestions ranked={ranked} query={suggest === "mobile" ? mobile : name} onPick={pick} />}
        {badge && <p className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/70 px-3 py-1.5 rounded-lg">{badge}</p>}
        {lookup.state === "error" && <p className="text-[11px] text-slate-400">Customer lookup is unavailable right now ({lookup.message}).</p>}

        <div className="p-3 rounded-xl bg-slate-50/90 border border-slate-200/80 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1">
              <CalendarClock className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
              <span>Follow-Up Date &amp; Time (12 Hrs)</span>
            </span>
            <div className="flex items-center gap-1.5">
              {TOMORROW_PRESETS.map((t) => (
                <button key={t.id} type="button" aria-pressed={preset?.id === t.id} onClick={() => apply(t.id)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-colors ${preset?.id === t.id ? "bg-amber-50 text-amber-800 border-amber-400" : "bg-white text-slate-700 border-slate-200 hover:border-amber-400 hover:text-amber-800"}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <div className="sm:col-span-5">
              <label htmlFor="fuScheduleDateInput" className="block text-[10px] font-medium text-slate-500 mb-1">Follow-Up Date</label>
              <input id="fuScheduleDateInput" type="date" min={istDateOf(Date.now())} value={date} onChange={(e) => e.target.value && edit({ date: e.target.value })}
                className="qfd-date-native relative w-full h-9 px-2.5 text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#991B1B]" />
            </div>
            <div className="sm:col-span-7">
              <span className="block text-[10px] font-medium text-slate-500 mb-1" id="fuTimeLabel">Follow-Up Time (12-Hr AM/PM)</span>
              <div className="grid grid-cols-3 gap-1.5" role="group" aria-labelledby="fuTimeLabel">
                <select aria-label="Hour" className={SELECT} value={clock.hour} onChange={(e) => edit({ hour: e.target.value })}>
                  {HOURS_12.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
                <select aria-label="Minute" className={SELECT} value={clock.minute} onChange={(e) => edit({ minute: e.target.value })}>
                  {MINUTES_60.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <select aria-label="AM or PM" value={clock.mer} onChange={(e) => edit({ mer: e.target.value as Meridiem })}
                  className="h-9 px-2 text-xs font-bold text-[#991B1B] bg-crimson-50/50 border border-crimson-200 rounded-lg focus:outline-none focus:border-[#991B1B]">
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div>
          <span className={`${LABEL} mb-1.5`} id="fuChipsLabel">Follow-Up Alert Time</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-labelledby="fuChipsLabel">
            {REMINDER_CHIPS.map((c) => {
              const on = preset?.id === c.id;
              return (
                <button key={c.id} type="button" aria-pressed={on} onClick={() => apply(c.id)}
                  className={`py-2 px-2 rounded-xl text-xs border ${on ? "font-semibold border-[#991B1B] bg-crimson-50 text-[#991B1B]" : "font-medium border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label htmlFor="fuNoteInput" className={LABEL}>Call Note</label>
          <input id="fuNoteInput" maxLength={300} placeholder="e.g., Asking family, will confirm by evening" value={note} onChange={(e) => setNote(e.target.value)}
            className="w-full h-10 px-3 text-xs sm:text-sm text-slate-800 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]" />
        </div>

        {error && <div id="fuError" role="alert" className="px-3 py-2 rounded-xl text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">{error}</div>}

        <button type="submit" disabled={busy} aria-busy={busy || undefined}
          className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold text-sm py-3 rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 disabled:opacity-80 disabled:cursor-progress">
          {busy ? <LoaderCircle className="w-4 h-4 animate-spin" aria-hidden="true" /> : <BellRing className="w-4 h-4" aria-hidden="true" />}
          <span>{busy ? "Saving Follow-Up…" : "Save Follow-Up & Activate Alert"}</span>
        </button>
      </form>
    </DeskDialog>
  );
}

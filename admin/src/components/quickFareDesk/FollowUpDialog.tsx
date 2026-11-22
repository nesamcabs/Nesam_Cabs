import { useMemo, useState, type FormEvent } from "react";
import Icon from "../ui/Icon";
import TimeSelect12 from "../TimeSelect12";
import DeskDialog from "./DeskDialog";
import { formatINR, normalizeIndianMobile, type DeskQuoteLine } from "../../domain/quickFareDesk";
import { addDaysISO, isoDateIST } from "../../utils/time";
import { dateLabel, hhmmIST, istInstant } from "./deskTrip";
import type { Customer } from "../../types";

export interface FollowUpSubmit {
  customerId: string | null;
  mobile: string;
  name: string;
  reminderAtMs: number;
  note: string;
}

type Preset = "15" | "30" | "60" | "now" | "tmrw9" | "tmrw17" | null;
const QUICK: { id: Exclude<Preset, null>; label: string }[] = [
  { id: "15", label: "In 15 min" },
  { id: "30", label: "In 30 min" },
  { id: "60", label: "In 1 hour" },
  { id: "now", label: "Alert Now" },
  { id: "tmrw9", label: "Tomorrow 9 AM" },
  { id: "tmrw17", label: "Tomorrow 5 PM" },
];

/** Date + time (India) of a quick reminder choice. */
function presetAt(p: Exclude<Preset, null>): { date: string; time: string } {
  if (p === "tmrw9" || p === "tmrw17") return { date: addDaysISO(isoDateIST(new Date()), 1), time: p === "tmrw9" ? "09:00" : "17:00" };
  const at = new Date(Date.now() + (p === "now" ? 0 : Number(p)) * 60000);
  return { date: isoDateIST(at), time: hhmmIST(at) };
}

export default function FollowUpDialog({ route, line, sourceName, extras, customers, initial, onSave, onClose }: {
  route: string;
  line: DeskQuoteLine;
  sourceName: string;
  /** Fuel and add-ons of the quote, "CNG • Pet Friendly". */
  extras?: string;
  customers: Customer[];
  initial?: { mobile?: string; name?: string };
  onSave: (v: FollowUpSubmit) => void;
  onClose: () => void;
}) {
  const start = presetAt("15");
  const [mobile, setMobile] = useState(initial?.mobile ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [nameAuto, setNameAuto] = useState(false);
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [preset, setPreset] = useState<Preset>("15");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const today = isoDateIST(new Date());

  // Customers by normalised mobile (a customer without a usable number is never matched).
  const byMobile = useMemo(() => {
    const m = new Map<string, Customer>();
    for (const c of customers) { const n = normalizeIndianMobile(c.phone || ""); if (n.ok && !m.has(n.digits)) m.set(n.digits, c); }
    return m;
  }, [customers]);
  const norm = normalizeIndianMobile(mobile);
  const match = norm.ok ? byMobile.get(norm.digits) ?? null : null;

  const onMobile = (v: string) => {
    setMobile(v);
    setError(null);
    const n = normalizeIndianMobile(v);
    const m = n.ok ? byMobile.get(n.digits) : undefined;
    // A name filled from a customer record follows its number: a different number clears it (or fills the new match).
    if (m && (!name.trim() || nameAuto)) { setName(m.name); setNameAuto(true); }
    else if (nameAuto) { setName(""); setNameAuto(false); }
  };
  const pick = (p: Exclude<Preset, null>) => {
    const at = presetAt(p);
    setDate(at.date);
    setTime(at.time);
    setPreset(p);
    setError(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!norm.ok) return setError(norm.reason);
    if (!date || !time) return setError("Choose the reminder date and time.");
    const at = istInstant(date, time);
    if (Number.isNaN(at.getTime())) return setError("Choose a valid reminder date and time.");
    if (at.getTime() < Date.now() - 60000) return setError("The reminder time has passed. Choose a later time or Alert Now.");
    onSave({ customerId: match?.id ?? null, mobile: norm.e164, name: name.trim(), reminderAtMs: preset === "now" ? Date.now() : at.getTime(), note: note.trim() });
  };

  return (
    <DeskDialog title="Save follow-up & set alert" icon="bell-plus" tone="amber" subtitle={`${route} · ${line.vehicle}${extras && !line.manual ? ` (${extras})` : ""} ${formatINR(line.fare)}${line.manual ? " (draft quote)" : ""} · ${sourceName}`} onClose={onClose}>
      <form onSubmit={submit} className="p-5 space-y-4" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="dk-ff">
            <label htmlFor="fuMobile">Caller mobile *</label>
            <div className="dk-in dk-in--pre">
              <span>+91</span>
              <input id="fuMobile" data-autofocus type="tel" inputMode="tel" autoComplete="off" value={mobile} onChange={(e) => onMobile(e.target.value)} aria-invalid={!!error && !norm.ok} aria-describedby="fuMobileHint" />
            </div>
            <small id="fuMobileHint" className="dk-hint">{norm.ok ? `Saved as ${norm.e164}` : "10 digits, +91, 0091 or a leading 0"}</small>
          </div>
          <div className="dk-ff">
            <label htmlFor="fuName">Caller name</label>
            <input id="fuName" className="dk-in" maxLength={80} autoComplete="off" value={name} onChange={(e) => { setName(e.target.value); setNameAuto(false); }} />
          </div>
        </div>

        {match && (
          <p className="text-[11.5px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/70 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
            <Icon name="user-check" size={14} /> Existing customer: {match.name}{match.city ? ` · ${match.city}` : ""}
          </p>
        )}

        <div className="dk-ff">
          <span className="dk-ff__label">Remind me</span>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5" role="group" aria-label="Quick reminder">
            {QUICK.map((q) => (
              <button key={q.id} type="button" className="dk-chip" aria-pressed={preset === q.id} onClick={() => pick(q.id)}>{q.label}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="dk-ff">
            <label htmlFor="fuDate">Date</label>
            <div className="dk-in relative flex items-center justify-between">
              <span>{dateLabel(date) || "Choose date"}</span>
              <Icon name="calendar" size={16} className="text-slate-400 pointer-events-none" />
              <input id="fuDate" type="date" min={today} value={date} onChange={(e) => { setDate(e.target.value); setPreset(null); setError(null); }} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
            </div>
          </div>
          <div className="dk-ff">
            <label htmlFor="fuTimeHour">Time <span className="dk-ist">IST</span></label>
            <div className="dk-in dk-in--time">
              <TimeSelect12 id="fuTimeHour" label="Reminder time" value={time} onChange={(v) => { setTime(v); setPreset(null); setError(null); }} className="dk-time12" />
            </div>
          </div>
        </div>

        <div className="dk-ff">
          <label htmlFor="fuNote">Call note</label>
          <input id="fuNote" className="dk-in" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What the caller said" />
        </div>

        {error && <div role="alert" className="px-3 py-2 rounded-xl text-xs font-semibold bg-red-50 text-red-800 border border-red-200">{error}</div>}

        <button type="submit" className="w-full h-12 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-[14.5px] rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2">
          <Icon name="bell-ring" size={16} />
          <span>Save follow-up</span>
        </button>
        <p className="text-[11px] text-slate-500 text-center">Saved on this browser for this session. Reminders sound while this page is open.</p>
      </form>
    </DeskDialog>
  );
}

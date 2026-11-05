/**
 * A time of day in the 12-hour form: hour, minute and AM / PM. The value stays "HH:mm" (24-hour,
 * India time) everywhere else in the app, so saved data and prices are unchanged; only the way it is
 * chosen and shown differs. An empty value shows "--" until a part is chosen.
 */
const HOURS12 = ["12", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11"];
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

function parse(value: string): { h24: number; m: string } | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(value || "");
  if (!m) return null;
  const h24 = Number(m[1]);
  return h24 >= 0 && h24 <= 23 ? { h24, m: m[2] } : null;
}

const to24 = (hour12: string, period: "AM" | "PM") => String((Number(hour12) % 12) + (period === "PM" ? 12 : 0)).padStart(2, "0");

export default function TimeSelect12({ id, label, value, onChange, className = "", disabled = false }: { id?: string; label: string; value: string; onChange: (v: string) => void; className?: string; disabled?: boolean }) {
  const t = parse(value);
  const hour12 = t ? HOURS12[t.h24 % 12] : "";
  const minute = t ? t.m : "";
  const period: "AM" | "PM" = t && t.h24 >= 12 ? "PM" : "AM";
  return (
    <span className={`ds-time ${className}`}>
      <select id={id} className="ds-select" aria-label={`${label} hour`} value={hour12} disabled={disabled} onChange={(e) => onChange(`${to24(e.target.value, period)}:${minute || "00"}`)}>
        {!t && <option value="">--</option>}
        {HOURS12.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <span aria-hidden="true">:</span>
      <select className="ds-select" aria-label={`${label} minute`} value={minute} disabled={disabled} onChange={(e) => onChange(`${t ? to24(hour12, period) : "09"}:${e.target.value}`)}>
        {!t && <option value="">--</option>}
        {MINUTES.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <select className="ds-select" aria-label={`${label} AM or PM`} value={period} onChange={(e) => t && onChange(`${to24(hour12, e.target.value as "AM" | "PM")}:${minute}`)} disabled={disabled || !t}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </span>
  );
}

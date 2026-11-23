import { CalendarClock, CalendarDays, CarFront, CircleAlert, RotateCw, UserRound } from "lucide-react";
import { assigneeOf, type TripRow } from "../../domain/commandDesk";
import { fareOf, rupee } from "../../domain/officeStage";
import { addDaysISO, bookingPickupDate, formatTime12, isoDateIST } from "../../utils/time";
import { BookingSourceBadge, StatusBadge } from "../booking/BookingBadges";

interface ScheduleCardsProps {
  /** Open trips picking up today / tomorrow on the India calendar, soonest first (commandDesk.scheduleSplit). */
  today: TripRow[];
  tomorrow: TripRow[];
  /** The Dashboard's clock (ticks every 30 s), so the days roll over at midnight IST. */
  now: Date;
  /** Bookings not delivered yet. */
  loading: boolean;
  /** The bookings could not be read (nothing to show). */
  error: string | null;
  onRetry?: () => void;
  onManage: (bookingId: string) => void;
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "2-digit", month: "short", year: "numeric" });
/** "Mon, 23 Nov 2026" for a YYYY-MM-DD India calendar date. */
function dayLabel(iso: string): string {
  const parts = DAY_FORMAT.formatToParts(new Date(Date.parse(`${iso}T12:00:00+05:30`)));
  const part = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${part("weekday")}, ${part("day")} ${part("month")} ${part("year")}`;
}
const tripCount = (n: number) => `${n} ${n === 1 ? "trip" : "trips"}`;

/** Today's and Tomorrow's pickups, side by side on desktop and stacked on phones. */
export default function ScheduleCards({ today, tomorrow, now, loading, error, onRetry, onManage }: ScheduleCardsProps) {
  const todayIso = isoDateIST(now);
  const tomorrowIso = addDaysISO(todayIso, 1);
  return (
    <section aria-label="Today's and tomorrow's schedule" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ScheduleCard id="schedule-today" title="Today's Schedule" icon="today" date={dayLabel(todayIso)} rows={today} loading={loading} error={error} onRetry={onRetry} onManage={onManage}
        empty="No pickups scheduled for today." />
      <ScheduleCard id="schedule-tomorrow" title="Tomorrow's Schedule" icon="tomorrow" date={dayLabel(tomorrowIso)} rows={tomorrow} loading={loading} error={error} onRetry={onRetry} onManage={onManage}
        empty="No pickups scheduled for tomorrow." />
    </section>
  );
}

function ScheduleCard({ id, title, icon, date, rows, loading, error, onRetry, onManage, empty }: {
  id: string;
  title: string;
  icon: "today" | "tomorrow";
  date: string;
  rows: TripRow[];
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  onManage: (bookingId: string) => void;
  empty: string;
}) {
  const Icon = icon === "today" ? CalendarClock : CalendarDays;
  const count = error ? "—" : loading ? "…" : tripCount(rows.length);
  const countText = error ? "Trip count unavailable" : loading ? "Loading trips" : tripCount(rows.length);
  return (
    <article aria-labelledby={`${id}-title`} aria-busy={loading || undefined} className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden flex flex-col min-w-0">
      <header className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span aria-hidden="true" className={`grid place-items-center w-9 h-9 rounded-xl shrink-0 ${icon === "today" ? "bg-[var(--color-brand-soft)] text-[var(--color-brand)]" : "bg-slate-100 text-slate-600"}`}>
            <Icon className="w-[18px] h-[18px]" strokeWidth={1.85} />
          </span>
          <div className="min-w-0">
            <h3 id={`${id}-title`} className="text-xs font-bold uppercase tracking-wider text-slate-800">{title}</h3>
            <p className="text-[11px] font-medium text-slate-500 truncate">{date}</p>
          </div>
        </div>
        <span className="shrink-0 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-[11px] font-bold tabular-nums" aria-label={countText} title={countText}>{count}</span>
      </header>

      <div className="flex-1 min-h-[148px] max-h-[360px] overflow-y-auto">
        {error ? (
          <div role="alert" className="h-full min-h-[148px] flex flex-col items-center justify-center gap-2 p-5 text-center">
            <CircleAlert className="w-5 h-5 text-amber-600" strokeWidth={1.85} aria-hidden="true" />
            <p className="text-xs font-bold text-slate-800">The schedule could not be loaded.</p>
            <p className="text-[11px] text-slate-500 max-w-[320px] break-words">{error}</p>
            {onRetry && (
              <button type="button" onClick={onRetry} className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
                <RotateCw className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />Retry
              </button>
            )}
          </div>
        ) : loading ? (
          <ul className="divide-y divide-slate-100" aria-label={`${title}: loading`}>
            {[0, 1, 2].map((i) => (
              <li key={i} className="px-4 sm:px-5 py-3.5 flex gap-3 animate-pulse" aria-hidden="true">
                <span className="w-12 h-8 rounded-md bg-slate-100" />
                <span className="flex-1 space-y-2"><span className="block h-3 w-2/5 rounded bg-slate-100" /><span className="block h-3 w-4/5 rounded bg-slate-100" /></span>
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <div className="h-full min-h-[148px] flex items-center justify-center p-6 text-center text-xs text-slate-500">{empty}</div>
        ) : (
          <ul className="divide-y divide-slate-100" aria-label={`${title}, ${tripCount(rows.length)}`}>
            {rows.map((r) => <ScheduleRow key={r.b.id} row={r} onManage={onManage} />)}
          </ul>
        )}
      </div>
    </article>
  );
}

function ScheduleRow({ row, onManage }: { row: TripRow; onManage: (bookingId: string) => void }) {
  const { b } = row;
  const pickup = bookingPickupDate(b);
  const [clock, period] = (pickup ? formatTime12(pickup) : "").split(" ");
  const ref = b.bookingId || b.id;
  const fare = fareOf(b);
  const driver = b.assignedDriverName || b.driver || "";
  const assigned = Boolean(b.assignedDriverId || driver);
  const who = assigneeOf(row);
  const car = b.vehicleCategory || b.vehicle || "";
  const route = `${b.pickup || "Pickup not set"} → ${b.drop || "Drop not set"}`;
  return (
    <li className="px-4 sm:px-5 py-3 flex items-start gap-3 hover:bg-slate-50/80 transition-colors">
      <div className="w-[52px] shrink-0 pt-0.5 text-center" title="Pickup time (IST)">
        <p className="text-[13px] font-extrabold text-slate-900 tabular-nums leading-tight">{clock || "—"}</p>
        <p className="text-[10px] font-bold text-slate-500 leading-tight">{period || "time"}</p>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-mono text-[11px] font-bold text-[#991B1B]">{ref}</span>
          <BookingSourceBadge booking={b} size="sm" />
          <StatusBadge status={b.status} />
        </div>
        <p className="text-xs font-semibold text-slate-900 mt-1 line-clamp-2 break-words" title={route}>{route}</p>
        {assigned ? (
          <p className="mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[11px] text-slate-600">
            <span className="inline-flex items-center gap-1 min-w-0">
              <UserRound className="w-3.5 h-3.5 shrink-0 text-slate-400" strokeWidth={1.85} aria-hidden="true" />
              <span className="truncate"><span className="sr-only">Driver: </span>{driver || "Driver assigned"}</span>
            </span>
            {(b.assignedVehicleNumber || car) && (
              <span className="inline-flex items-center gap-1 min-w-0">
                <CarFront className="w-3.5 h-3.5 shrink-0 text-slate-400" strokeWidth={1.85} aria-hidden="true" />
                <span className="truncate"><span className="sr-only">Vehicle: </span>{[b.assignedVehicleNumber, car].filter(Boolean).join(" · ")}</span>
              </span>
            )}
          </p>
        ) : (
          <p className="mt-1 flex items-center gap-1.5 flex-wrap text-[11px] text-slate-600">
            <span className="px-1.5 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 font-bold">Driver not assigned</span>
            <span className="min-w-0 line-clamp-2 break-words">{[who.primary, who.secondary, car].filter(Boolean).join(" · ")}</span>
          </p>
        )}
      </div>

      <div className="shrink-0 flex flex-col items-end gap-1.5">
        {fare > 0 ? <span className="text-xs font-extrabold text-slate-900 tabular-nums">{rupee(fare)}</span> : <span className="text-[11px] text-slate-400">Fare not set</span>}
        <button type="button" onClick={() => onManage(b.id)} aria-label={`Manage booking ${ref}`}
          className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-[#991B1B] hover:bg-[#7F1D1D] text-white shadow-2xs transition-colors">
          Manage
        </button>
      </div>
    </li>
  );
}

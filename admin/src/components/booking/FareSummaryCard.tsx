import type { Booking } from "../../types";
import { rupee } from "../../domain/officeStage";
import { Icon } from "../ui";

type Line = NonNullable<Booking["fareBreakup"]>["lines"][number];

/**
 * The quoted fare in three steps a caller can read aloud: what the price includes, the total, and what the customer
 * pays on top only if it happens. Lines and amounts are the booking server's; a charge billed later has no amount,
 * so its rule is shown in place of a figure (never "₹0").
 */
export default function FareSummaryCard({ lines, total, cab, route }: { lines: Line[]; total: number; cab: string; route: string }) {
  const included = lines.filter((l) => l.treatment === "included");
  const extras = lines.filter((l) => l.treatment === "extra");
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900">Fare breakdown</p>
          {cab && <p className="text-[11px] text-slate-500">{cab}</p>}
        </div>
        {route && <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600"><Icon name="route" size={12} />{route}</span>}
      </div>

      <div className="px-4 pt-3">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-700"><Icon name="circle-check" size={14} />Included in the fare</p>
        <ul className="mt-1 divide-y divide-slate-100">
          {included.map((l) => (
            <li key={l.key} className="flex items-start justify-between gap-4 py-2.5">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-slate-800">{l.label}</p>
                {l.detail && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{l.detail}</p>}
              </div>
              <span className={`shrink-0 text-[13px] font-bold tabular-nums ${(l.amount ?? 0) < 0 ? "text-emerald-700" : "text-slate-900"}`}>
                {l.amount !== null && l.amount < 0 ? `− ${rupee(-l.amount)}` : rupee(l.amount)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-1 flex items-center justify-between gap-4 border-y border-[#F5D0D0] bg-[#FEF2F2] px-4 py-3.5">
        <div>
          <p className="text-sm font-bold text-slate-900">Total fare</p>
          <p className="text-[11px] text-slate-600">For everything listed above</p>
        </div>
        <span className="text-2xl font-extrabold tabular-nums text-[#991B1B]">{rupee(total)}</span>
      </div>

      {extras.length > 0 && (
        <div className="bg-amber-50/40 px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-800"><Icon name="circle-plus" size={14} />Not included · paid extra only if used</p>
          <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
            {extras.map((l) => (
              <li key={l.key} className="rounded-xl border border-amber-200/80 bg-white px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800">{l.label}</span>
                  {l.amount !== null && <span className="shrink-0 text-xs font-bold tabular-nums text-slate-900">{rupee(l.amount)}</span>}
                </div>
                {l.detail && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{l.detail}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

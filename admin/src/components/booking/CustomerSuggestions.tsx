import { searchCustomers, type CustomerSuggestion } from "../../domain/customerSuggestions";

/**
 * Existing customers under a mobile or name box. `floating` hangs over the page; otherwise it sits in the flow (inside
 * dialogs, which would clip a floating list). Picking uses mousedown so the box's blur does not close the list first.
 */
export default function CustomerSuggestions({ ranked, query, onPick, floating = false }: {
  ranked: CustomerSuggestion[];
  query: string;
  onPick: (s: CustomerSuggestion) => void;
  floating?: boolean;
}) {
  const rows = searchCustomers(ranked, query);
  // Nothing typed and nothing saved yet, or no match: say so instead of showing an empty box.
  return (
    <div className={`${floating ? "absolute left-0 right-0 top-[calc(100%+6px)] z-30 min-w-[18rem]" : "mt-1.5"} overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg`} onMouseDown={(e) => e.preventDefault()}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{query.trim() ? "Matching customers" : "Most frequent customers"}</span>
        {rows.length > 0 && <span className="text-[10px] text-slate-400">Click to fill</span>}
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-xs text-slate-500">{ranked.length ? "No saved customer matches. Continue to book as a new customer." : "No customers are saved yet."}</p>
      ) : (
        <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto">
          {rows.map((s) => (
            <li key={s.customer.id}>
              <button type="button" onClick={() => onPick(s)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FEF2F2] text-[11px] font-bold text-[#9F1212]">
                    {(s.customer.name || "CU").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-slate-800">{s.customer.name || "Customer"}</span>
                    <span className="block text-[11px] text-slate-500">{s.phoneLabel || "No mobile saved"}</span>
                  </span>
                </span>
                {s.bookings > 0 && <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{s.bookings} booking{s.bookings === 1 ? "" : "s"}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

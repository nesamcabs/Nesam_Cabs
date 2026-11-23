import Icon from "../ui/Icon";
import MenuButton from "../ui/MenuButton";
import { brandLabel, inr, isBlockedStatus, primaryBadge, groupOf, type Row } from "../../domain/customerDirectory";
import { refDateTime } from "../../domain/officeStage";
import { BrandChip, Chip, StatusChip, type Tone } from "./Parts";

export const customerCodeOf = (c: { id: string; customerCode?: string }) => c.customerCode || `NSM-CU-${c.id.slice(0, 6).toUpperCase()}`;
export const emailOf = (c: { email?: string }) => (c.email && c.email !== "N/A" ? c.email : "");

export interface TableActions {
  canReveal: boolean;
  canBook: boolean;
  canEdit: boolean;
  revealed: (id: string) => string | undefined;
  onReveal: (r: Row) => void;
  onView: (r: Row) => void;
  onBook: (r: Row) => void;
  onRemind: (r: Row) => void;
  onStatement: (r: Row) => void;
  onEdit: (r: Row) => void;
  onToggleBlock: (r: Row) => void;
}

export function PhoneLine({ c, phone, canReveal, onReveal, size = "row" }: { c: Row["c"]; phone?: string; canReveal: boolean; onReveal: () => void; size?: "row" | "drawer" }) {
  const shown = phone ?? (c.phoneMasked || "No number on file");
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className={`font-bold ${size === "drawer" ? "text-sm" : ""} ${phone ? "text-emerald-700" : "text-slate-800"}`} aria-label={phone ? `Mobile ${phone}` : `Mobile number protected, ${shown}`}>{shown}</span>
      {c.hasPhone !== false && !phone && size === "row" && (
        <button type="button" onClick={onReveal} disabled={!canReveal} title={canReveal ? "Mandatory reason required to view full number" : "Your Staff ID does not include viewing full numbers"}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] leading-4 font-semibold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 transition-colors disabled:opacity-50 disabled:hover:bg-amber-50">
          <Icon name="eye" size={12} /><span>View #</span>
        </button>
      )}
      {phone && <span className="text-[10px] font-semibold text-emerald-600">(Logged)</span>}
    </div>
  );
}

const TD = "py-3.5 px-4 align-top";

export function CustomerTable({ rows, selected, onToggle, onTogglePage, a }: { rows: Row[]; selected: ReadonlySet<string>; onToggle: (id: string) => void; onTogglePage: (on: boolean) => void; a: TableActions }) {
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.c.id));
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Customers table, scrolls horizontally on small screens">
      <table className="w-full min-w-[980px] text-left border-collapse">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] leading-4 font-bold uppercase tracking-wider text-slate-400">
            <th scope="col" className="py-3 pl-5 pr-2 w-8"><input type="checkbox" aria-label="Select all customers on this page" checked={allOnPage} onChange={(e) => onTogglePage(e.target.checked)} /></th>
            <th scope="col" className="py-3 px-4">Name / Customer ID</th>
            <th scope="col" className="py-3 px-4">Contact (Privacy Protected)</th>
            <th scope="col" className="py-3 px-4">Booking History &amp; Spend</th>
            <th scope="col" className="py-3 px-4">Segment &amp; Status</th>
            <th scope="col" className="py-3 px-5 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-xs leading-4">
          {rows.map((r) => {
            const { c, s } = r;
            const badge = primaryBadge(r);
            const derived = groupOf(s.completed);
            const phone = a.revealed(c.id);
            const meta = [customerCodeOf(c), c.city, c.leadSource].filter(Boolean);
            const pref = c.preferredCab && c.preferredCab !== "Any Cab" ? `Pref: ${c.preferredCab}${c.preferredDriver ? ` • ${c.preferredDriver}` : ""}` : emailOf(c) || "Email not supplied";
            return (
              <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                <td className="py-3.5 pl-5 pr-2 align-top"><input type="checkbox" aria-label={`Select ${c.name}`} checked={selected.has(c.id)} onChange={() => onToggle(c.id)} /></td>
                <td className={TD}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 break-words">{c.name || "Unnamed customer"}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5 break-words">{meta.map((m, i) => <span key={i}>{i ? " • " : ""}<span className={i === 2 ? "text-slate-600 font-medium" : ""}>{m}</span></span>)}</p>
                    </div>
                    <Chip tone={badge.tone as Tone}>{badge.label}</Chip>
                  </div>
                </td>
                <td className={TD}>
                  <PhoneLine c={c} phone={phone} canReveal={a.canReveal} onReveal={() => a.onReveal(r)} />
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[210px]" title={pref}>{pref}</p>
                </td>
                <td className={TD}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-slate-800">{s.completed} trip{s.completed === 1 ? "" : "s"}</p>
                    {s.outstanding > 0.004 && <span className="px-1.5 py-0.5 rounded text-[10px] leading-4 font-bold bg-amber-50 text-amber-800 border border-amber-200">Due {inr(s.outstanding)}</span>}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">{s.completed > 0 ? `Total Spend: ${inr(s.spend)}` : "No completed trips yet"}</p>
                  {s.lastCompletedAt && <p className="text-[11px] text-slate-400 mt-0.5">Last trip: {refDateTime(s.lastCompletedAt)}</p>}
                </td>
                <td className={TD}>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <StatusChip status={c.status} />
                    {(c.brands ?? []).map((b) => <BrandChip key={b}>{brandLabel(b)}</BrandChip>)}
                    {derived !== "New" && (c.isVip || c.isCorporate) && <BrandChip>{derived}</BrandChip>}
                  </div>
                </td>
                <td className="py-3.5 px-5 align-top text-right">
                  <div className="inline-flex items-center gap-1.5">
                    {s.outstanding > 0.004 && <button type="button" onClick={() => a.onRemind(r)} title="Copy a WhatsApp payment reminder to send yourself (it is not sent)" aria-label={`Copy payment reminder for ${r.c.name}`} className="px-2 py-1.5 rounded-lg text-[11px] leading-4 font-semibold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200/80 whitespace-nowrap">Copy reminder</button>}
                    {a.canBook && !isBlockedStatus(c.status) && <button type="button" onClick={() => a.onBook(r)} className="px-2.5 py-1.5 rounded-lg text-[11px] leading-4 font-semibold bg-crimson-50 hover:bg-crimson-100 text-crimson-800 border border-crimson-200/70">+ Book</button>}
                    <button type="button" onClick={() => a.onView(r)} className="px-2.5 py-1.5 rounded-lg text-[11px] leading-4 font-semibold bg-white border border-slate-200 hover:bg-slate-50 text-slate-800">View</button>
                    <MenuButton iconOnly label={`More actions for ${c.name}`} items={[
                      { label: "Account statement", icon: "file-text", onSelect: () => a.onStatement(r) },
                      ...(a.canEdit ? [
                        { label: "Edit customer", icon: "pencil" as const, onSelect: () => a.onEdit(r) },
                        { label: isBlockedStatus(c.status) ? "Unblock customer" : "Block customer", icon: isBlockedStatus(c.status) ? "circle-check" as const : "ban" as const, danger: !isBlockedStatus(c.status), onSelect: () => a.onToggleBlock(r) },
                      ] : []),
                    ]} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

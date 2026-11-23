import type { ReactNode } from "react";
import Icon, { type IconName } from "../ui/Icon";
import type { Kpis } from "../../domain/customerDirectory";
import { inr, isActiveStatus, isBlockedStatus, statusLabel } from "../../domain/customerDirectory";
import type { NumberViews } from "../../services/customerDirectoryService";

export const CARD = "bg-white rounded-[16px] border border-slate-200/90 shadow-xs";

const TONES = {
  amber: "font-bold bg-amber-50 text-amber-800 border border-amber-200",
  blue: "font-bold bg-blue-50 text-blue-700 border border-blue-200",
  green: "font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200",
  red: "font-bold bg-red-50 text-red-700 border border-red-200",
  slate: "font-medium bg-slate-100 text-slate-600",
  sky: "font-bold bg-sky-50 text-sky-700 border border-sky-200",
  plain: "font-semibold bg-emerald-50 text-emerald-700",
} as const;
export type Tone = keyof typeof TONES;

export const Chip = ({ tone, children }: { tone: Tone; children: ReactNode }) => (
  <span className={`px-2 py-0.5 rounded-full text-[10px] leading-4 whitespace-nowrap ${TONES[tone]}`}>{children}</span>
);

export const StatusChip = ({ status }: { status: string }) =>
  isBlockedStatus(status) ? <Chip tone="red">Blocked</Chip> : isActiveStatus(status) ? <Chip tone="plain">Active</Chip> : <Chip tone="slate">{statusLabel(status)}</Chip>;

export const BrandChip = ({ children }: { children: ReactNode }) => <span className="px-2 py-0.5 rounded-md text-[10px] leading-4 font-medium bg-slate-100 text-slate-600">{children}</span>;

function Kpi({ label, icon, iconCls, value, valueCls, sub }: { label: string; icon: IconName; iconCls: string; value: string; valueCls: string; sub: string }) {
  return (
    <div className={`${CARD} p-4`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] leading-4 font-semibold uppercase tracking-wider text-slate-400">{label}</span>
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${iconCls}`}><Icon name={icon} size={14} /></span>
      </div>
      <p className={`text-2xl leading-8 font-bold mt-2 ${valueCls}`}>{value}</p>
      <p className="text-[11px] leading-4 text-slate-500 mt-0.5">{sub}</p>
    </div>
  );
}

/** The four reference cards. Totals come from every customer the signed-in user may see, never from the list filters. */
export function KpiCards({ k, views, viewsError, loading }: { k: Kpis; views: NumberViews | null; viewsError: string | null; loading: boolean }) {
  const dash = (v: string) => (loading ? "—" : v);
  const logged = viewsError ? "view log unavailable" : views ? `${views.total} reason-logged view${views.total === 1 ? "" : "s"}` : "loading views";
  return (
    <section aria-label="Summary" className="grid grid-cols-2 @min-[880px]:grid-cols-4 gap-3.5">
      <Kpi label="Total Customers" icon="users" iconCls="bg-slate-100 text-slate-600" value={dash(String(k.total))} valueCls="text-slate-900" sub="Customer accounts on record" />
      <Kpi label="Repeat / VIP (3+ Trips)" icon="crown" iconCls="bg-amber-50 text-amber-600" value={dash(String(k.vip))} valueCls="text-amber-600" sub="Regular riders and marked VIPs" />
      <Kpi label="Corporate / GST" icon="building-2" iconCls="bg-blue-50 text-blue-600" value={dash(String(k.corporate))} valueCls="text-blue-700" sub="Corporate accounts" />
      <Kpi label="Pending Credit Due" icon="indian-rupee" iconCls="bg-crimson-50 text-crimson-800" value={dash(inr(k.due))} valueCls="text-crimson-800" sub={`${k.dueAccounts} due account${k.dueAccounts === 1 ? "" : "s"} • ${logged}`} />
    </section>
  );
}

const fmtTime = (ms: number) =>
  ms ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(ms)) : "—";

/** "Recent Customer Number Views (Mandatory Reason Audit Log)" — newest first. Master sees every entry, anyone else only their own. */
export function AuditLedger({ views, error, onRetry }: { views: NumberViews | null; error: string | null; onRetry: () => void }) {
  return (
    <section className="bg-white rounded-[16px] border border-amber-200/90 shadow-xs overflow-hidden" aria-labelledby="cd-ledger-title">
      <div className="px-5 py-3 bg-amber-50/60 border-b border-amber-200/70 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon name="shield-alert" size={16} className="text-amber-700" />
          <h2 id="cd-ledger-title" className="text-xs leading-4 font-bold text-amber-950">Recent Customer Number Views (Mandatory Reason Audit Log)</h2>
        </div>
        <span className="text-[10px] leading-4 font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
          {views ? (views.scope === "all" ? "100% Logged" : "Your views") : "Audit log"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs min-w-[640px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] leading-4 font-bold uppercase tracking-wider text-slate-400">
              <th scope="col" className="py-2.5 px-5">Viewed By</th>
              <th scope="col" className="py-2.5 px-4">Customer</th>
              <th scope="col" className="py-2.5 px-4">Mandatory Reason Given</th>
              <th scope="col" className="py-2.5 px-5 text-right">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {error ? (
              <tr><td colSpan={4} className="py-6 px-5 text-center text-slate-500" role="alert">The view log could not be loaded. <button type="button" className="font-semibold text-crimson-800 underline" onClick={onRetry}>Retry</button></td></tr>
            ) : !views ? (
              <tr><td colSpan={4} className="py-6 px-5 text-center text-slate-400">Loading the view log…</td></tr>
            ) : views.entries.length === 0 ? (
              <tr><td colSpan={4} className="py-6 px-5 text-center text-slate-400">No customer numbers have been viewed yet.</td></tr>
            ) : views.entries.map((e) => (
              <tr key={e.id}>
                <td className="py-2.5 px-5 font-semibold text-slate-900">{e.viewedBy}{e.viewedByRole ? <span className="font-normal text-slate-400"> · {e.viewedByRole}</span> : null}</td>
                <td className="py-2.5 px-4 font-medium text-crimson-800">{e.customer}{e.customerCode ? ` (${e.customerCode})` : ""}</td>
                <td className="py-2.5 px-4 text-slate-700">{e.reason}</td>
                <td className="py-2.5 px-5 text-right text-[11px] text-slate-500 font-semibold whitespace-nowrap">{fmtTime(e.atMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {views?.scope === "own" && <p className="px-5 py-2 text-[11px] text-slate-500 border-t border-slate-100">You can see your own views here. The Master account sees every view.</p>}
    </section>
  );
}

export const FIELD_LABEL = "block text-[10px] leading-4 font-bold uppercase tracking-wider text-slate-500 mb-1";
export const FIELD = "w-full h-9 px-3 border border-slate-200 rounded-[12px] text-xs bg-white focus:outline-none focus:border-crimson-800 disabled:bg-slate-50 disabled:text-slate-500";
export const BTN_PRIMARY = "bg-crimson-800 hover:bg-crimson-900 text-white font-semibold disabled:opacity-60 disabled:cursor-not-allowed";
/** Page / dialog action: 40px tall, balanced padding, keyboard focus ring (pair with BTN_PRIMARY, or use BTN_SECONDARY). */
export const BTN_ACTION = "inline-flex items-center justify-center gap-2 h-10 px-4 rounded-[12px] text-[13px] leading-5 font-semibold shadow-xs transition-[background-color,box-shadow,transform] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crimson-800";
export const BTN_SECONDARY = `${BTN_ACTION} bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-60 disabled:cursor-not-allowed`;

import { useState } from "react";
import { Field, inputCls } from "../FormKit";

export interface PostingOptionsValue {
  mode: "accept_offer" | "bid_review";
  escalate: boolean;
  ceiling: string;
  cutoffMinutes: string;
}

export const DEFAULT_POSTING: PostingOptionsValue = { mode: "accept_offer", escalate: false, ceiling: "", cutoffMinutes: "" };

export function usePostingOptions() {
  const [v, setV] = useState<PostingOptionsValue>(DEFAULT_POSTING);
  return { value: v, set: setV, reset: () => setV(DEFAULT_POSTING) };
}

/** What postBookingToMarketplace receives for the chosen options. Returns an error text when they are not valid. */
export function postingPayload(v: PostingOptionsValue): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  const data: Record<string, unknown> = { mode: v.mode };
  if (v.escalate) {
    const ceiling = Number(v.ceiling);
    if (!(ceiling > 0)) return { ok: false, error: "Enter the escalation ceiling in rupees." };
    data.escalation = { enabled: true, ceiling };
  }
  if (v.cutoffMinutes.trim()) {
    const m = Number(v.cutoffMinutes);
    if (!Number.isInteger(m) || m < 0) return { ok: false, error: "Enter the cut-off as whole minutes before pickup." };
    data.cutoffMinutes = m;
  }
  return { ok: true, data };
}

/** One explicit mode per post, so accepting the current offer and Admin-reviewed bidding never compete. */
export default function PostingOptions({ value, onChange }: { value: PostingOptionsValue; onChange: (v: PostingOptionsValue) => void }) {
  const set = (patch: Partial<PostingOptionsValue>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3 text-sm">
      <fieldset className="space-y-2">
        <legend className="font-semibold text-ink">How partners take this duty</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="posting-mode" checked={value.mode === "accept_offer"} onChange={() => set({ mode: "accept_offer" })} className="mt-1 accent-brand" />
          <span><strong>Accept the current offer</strong> — the first eligible partner to accept gets it; bids are not accepted.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="posting-mode" checked={value.mode === "bid_review"} onChange={() => set({ mode: "bid_review" })} className="mt-1 accent-brand" />
          <span><strong>Bids reviewed by NESAM</strong> — partners send a counter amount; you choose a bid and assign.</span>
        </label>
      </fieldset>
      <label className="flex items-center gap-2 font-semibold text-body">
        <input type="checkbox" checked={value.escalate} onChange={(e) => set({ escalate: e.target.checked })} className="w-4 h-4 accent-brand" />
        Raise the offer 5% every hour until a partner takes it
      </label>
      {value.escalate && (
        <Field label="Ceiling (₹)" hint="The offer never exceeds this or the customer fare. The customer fare stays fixed.">
          <input value={value.ceiling} onChange={(e) => set({ ceiling: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" className={inputCls} />
        </Field>
      )}
      <Field label="Stop offering before pickup (minutes, optional)" hint="When the cut-off passes with no partner, the offer closes and you are alerted.">
        <input value={value.cutoffMinutes} onChange={(e) => set({ cutoffMinutes: e.target.value.replace(/\D/g, "") })} inputMode="numeric" className={inputCls} />
      </Field>
    </div>
  );
}

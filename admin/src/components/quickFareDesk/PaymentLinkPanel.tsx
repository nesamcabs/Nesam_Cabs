import { useState } from "react";
import { Copy, ExternalLink, Link2, LoaderCircle, MessageCircle } from "lucide-react";
import { createBookingPaymentLink } from "../../services/enquiryService";
import { copyText } from "../../services/customerDirectoryService";
import { formatINR } from "../../domain/quickFareDesk";

export interface PayLink { url: string; amount: number }

/** Generate a Razorpay payment link for a booking, then copy it or send it on WhatsApp. Links come only from the server. */
export default function PaymentLinkPanel({ bookingId, bookingCode, brandName, fare, suggested, digits, link, onLink, problem, unavailable }: {
  bookingId: string;
  bookingCode: string;
  brandName: string;
  fare: number;
  /** The amount offered first (the advance, else the whole fare). */
  suggested: number;
  /** The customer's 10-digit number; "" when this account cannot see it. */
  digits: string;
  link: PayLink | null;
  onLink: (l: PayLink) => void;
  /** Why an automatic link was not created. */
  problem?: string | null;
  /** Set when online payment cannot be used at all. */
  unavailable?: string | null;
}) {
  const [amount, setAmount] = useState(String(suggested > 0 ? suggested : fare));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(problem ?? null);
  const [copied, setCopied] = useState("");
  const value = Number(amount);
  const valid = Number.isFinite(value) && value >= 1 && value <= fare + 0.005;

  const generate = async () => {
    if (busy || !valid) return setError(`Enter an amount from ₹1 to ${formatINR(fare)}.`);
    setBusy(true);
    setError(null);
    try {
      const r = await createBookingPaymentLink(bookingId, value, value >= fare ? "full" : "advance");
      if (!r?.shortUrl) throw new Error("The server did not return a payment link.");
      onLink({ url: r.shortUrl, amount: r.amount || value });
      setCopied("");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "The payment link could not be created.");
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!link) return;
    setCopied((await copyText(link.url)) ? "Copied!" : "Copy failed");
    window.setTimeout(() => setCopied(""), 2000);
  };
  const message = link ? `${brandName}: pay ${formatINR(link.amount)} for booking ${bookingCode} using this secure link: ${link.url}` : "";

  return (
    <section aria-label="Payment link" className="rounded-xl border border-blue-200 bg-blue-50/40 p-3.5 text-left space-y-2.5">
      <p className="flex items-center gap-1.5 text-xs font-bold text-slate-900"><Link2 className="h-4 w-4 text-[#2563EB]" aria-hidden="true" />Payment link</p>
      {unavailable && !link ? <p className="text-[11px] text-slate-600">{unavailable}</p> : (
        <>
          {link && (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-600">Link for <strong>{formatINR(link.amount)}</strong></p>
              <input readOnly aria-label="Payment link address" value={link.url} onFocus={(e) => e.currentTarget.select()} className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800" />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void copy()} className="flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"><Copy className="h-3.5 w-3.5" aria-hidden="true" /><span aria-live="polite">{copied || "Copy link"}</span></button>
                <a href={`https://wa.me/${digits ? `91${digits}` : ""}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"><MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />Send on WhatsApp</a>
                <a href={link.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />Open</a>
              </div>
            </div>
          )}
          <div className="flex items-end gap-2">
            <label className="block flex-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Amount (₹)
              <input type="number" min={1} max={fare} value={amount} disabled={busy} onChange={(e) => { setAmount(e.target.value); setError(null); }} className="mt-1 block h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-semibold normal-case text-slate-800" />
            </label>
            <button type="button" onClick={() => void generate()} disabled={busy} aria-busy={busy || undefined} className={`flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold disabled:opacity-60 ${link ? "border border-blue-200 bg-white text-[#2563EB] hover:bg-blue-50" : "bg-[#2563EB] text-white hover:bg-blue-700"}`}>
              {busy && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}{link ? "New link" : "Generate link"}
            </button>
          </div>
        </>
      )}
      {error && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-medium text-amber-800">{error}</p>}
    </section>
  );
}

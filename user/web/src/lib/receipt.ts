// Receipt as a printable page (the browser's print dialog also offers "Save as PDF").
import type { TripRecord } from '@core/types';
import { COMPANY_NAME, GST_RATE } from '@core/config/constants';
import { escapeHtml, formatDateTime, formatDistance, formatDuration } from '@core/utils/format';
import { tripFareLines } from './fareLines';
import { payableAmount } from './tripMoney';

const money = (n: number) => `${n < 0 ? '−' : ''}₹${Math.abs(Math.round(n * 100) / 100).toLocaleString('en-IN', Number.isInteger(Math.round(Math.abs(n) * 100) / 100) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Receipt HTML — every interpolated value is escaped. */
export function receiptHtml(trip: TripRecord, customerName: string): string {
  const f = trip.fareBreakdown;
  const lines = tripFareLines(trip);
  const rows = [
    ...lines.filter((l) => l.treatment === 'included' && l.amount !== null).map((l) => [l.label, l.amount ?? 0] as [string, number]),
    ...(trip.tollCharges ? [['Tolls & parking', trip.tollCharges] as [string, number]] : []),
    ...(trip.extraCharges ? [['Waiting / hill / roof carrier (approved)', trip.extraCharges] as [string, number]] : []),
  ]
    .map(([label, amount]) => `<tr><td>${escapeHtml(label)}</td><td class="r">${escapeHtml(money(amount))}</td></tr>`)
    .join('');
  const extras = lines.filter((l) => l.treatment === 'extra');
  const paidRows = trip.paid
    ? `<table class="paid"><tr><td>Paid so far</td><td class="r">${escapeHtml(money(trip.paid.totalPaid))}</td></tr><tr><td>Balance due</td><td class="r">${escapeHtml(money(trip.paid.balanceDue))}</td></tr></table>`
    : '';
  const extrasBox = extras.length
    ? `<div class="box"><b>Not included in the fare — payable separately:</b><br>${extras
        .map((e) => `${escapeHtml(e.label)} ${e.amount ? escapeHtml(money(e.amount)) : '(at actuals)'} — ${escapeHtml(e.detail)}`)
        .join('<br>')}</div>`
    : '';
  const gstNote = f
    ? `GST @ ${Math.round(f.gstRate * 100)}% on taxable value ${escapeHtml(money(f.taxableAmount))}.`
    : `Fare inclusive of GST @ ${Math.round(GST_RATE * 100)}%.`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Receipt ${escapeHtml(trip.bookingId)}</title>
<style>
body{font-family:'Poppins',system-ui,-apple-system,Helvetica,Arial,sans-serif;margin:32px;color:#111;max-width:640px}
h1{font-size:20px;margin:0;color:#E31E24}.muted{color:#666;font-size:12px}
.box{border:1px solid #e5e5e5;border-radius:8px;padding:12px;margin:14px 0;font-size:13px;line-height:1.6}
table{width:100%;border-collapse:collapse;font-size:13px}td{padding:6px 0;border-bottom:1px solid #eee}.r{text-align:right}
.paid{margin-top:8px}.total td{font-weight:700;font-size:15px;border-top:2px solid #111;border-bottom:none}
</style></head><body>
<h1>${escapeHtml(COMPANY_NAME)}</h1><div class="muted">Ride receipt · Booking ${escapeHtml(trip.bookingId)}</div>
<div class="box"><b>Customer:</b> ${escapeHtml(customerName)}<br>
<b>Trip:</b> ${escapeHtml(trip.pickup.name)} → ${escapeHtml(trip.drop.name)}<br>
<b>Service:</b> ${escapeHtml(trip.service)} · ${escapeHtml(trip.tripType)} · ${escapeHtml(trip.categoryName)}<br>
<b>Started:</b> ${escapeHtml(formatDateTime(trip.startedAt))} · <b>Completed:</b> ${escapeHtml(formatDateTime(trip.completedAt))}<br>
${trip.driver ? `<b>Driver:</b> ${escapeHtml(trip.driver.name)} · ${escapeHtml(trip.driver.vehicleNumber)}<br>` : ''}
<b>Payment:</b> ${escapeHtml(trip.paymentMethod)} (${escapeHtml(trip.paymentStatus)})</div>
<table>${rows}<tr class="total"><td>Total</td><td class="r">${escapeHtml(money(payableAmount(trip)))}</td></tr></table>
${paidRows}${extrasBox}
<p class="muted">${gstNote} Upfront fare based on ${escapeHtml(formatDistance(trip.distanceKm))} / ${escapeHtml(formatDuration(trip.durationMin))} estimated. Thank you for riding with NESAM.</p>
</body></html>`;
}

/** Opens the print dialog for the receipt without leaving the page. */
export function printReceipt(trip: TripRecord, customerName: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    throw new Error('Printing is not available in this browser.');
  }
  doc.open();
  doc.write(receiptHtml(trip, customerName));
  doc.close();
  const cleanup = () => window.setTimeout(() => frame.remove(), 1000);
  win.addEventListener('afterprint', cleanup);
  window.setTimeout(() => {
    win.focus();
    win.print();
    // Browsers that never fire afterprint.
    window.setTimeout(cleanup, 60000);
  }, 150);
}

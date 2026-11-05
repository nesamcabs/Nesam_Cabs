// Receipt + payment instructions (port of user/web TripReceipt.tsx). The
// Web's print window becomes a PDF generated with expo-print and handed to
// the Android share sheet (save, email, WhatsApp…).
import React, { useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { TripRecord } from '../types';
import { FareLines, tripFareLines } from './FareLines';
import { COMPANY_NAME, COMPANY_UPI_ID, CUSTOMER_PAYMENTS_ENABLED, GST_RATE } from '../config/constants';
import { escapeHtml, formatDateTime, formatDistance, formatDuration, formatINR } from '../utils/format';
import { Button, Card, Notice } from './ui';
import { colors, fonts, space, type } from '../theme';

export function payableAmount(trip: TripRecord): number {
  const base = trip.fareBreakdown?.total ?? trip.fare;
  return Math.round(base + trip.tollCharges + (trip.extraCharges ?? 0));
}

/** What is still owed: the server's balance once payments are recorded, else the full amount. */
export function amountDue(trip: TripRecord): number {
  return trip.paid ? Math.max(0, Math.round(trip.paid.balanceDue)) : payableAmount(trip);
}

export function upiLink(trip: TripRecord): string {
  const params = [
    ['pa', COMPANY_UPI_ID],
    ['pn', COMPANY_NAME],
    ['am', amountDue(trip).toFixed(2)],
    ['cu', 'INR'],
    ['tn', `Ride ${trip.bookingId}`],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `upi://pay?${params}`;
}

/** Receipt HTML — every interpolated value is escaped. */
export function receiptHtml(trip: TripRecord, customerName: string): string {
  const f = trip.fareBreakdown;
  const money = (n: number) => `${n < 0 ? '−' : ''}₹${Math.abs(Math.round(n * 100) / 100).toLocaleString('en-IN', Number.isInteger(Math.round(Math.abs(n) * 100) / 100) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const lines = tripFareLines(trip);
  const rows = [
    ...lines.filter((l) => l.treatment === 'included' && l.amount !== null).map((l) => [l.label, l.amount ?? 0] as [string, number]),
    ...(trip.tollCharges ? [['Tolls & parking', trip.tollCharges] as [string, number]] : []),
  ]
    .map(([label, amount]) => `<tr><td>${escapeHtml(label)}</td><td class="r">${escapeHtml(money(amount))}</td></tr>`)
    .join('');
  const extras = lines.filter((l) => l.treatment === 'extra');
  const paidRows = trip.paid
    ? `<table style="margin-top:8px"><tr><td>Paid so far</td><td class="r">${escapeHtml(money(trip.paid.totalPaid))}</td></tr><tr><td>Balance due</td><td class="r">${escapeHtml(money(trip.paid.balanceDue))}</td></tr></table>`
    : '';
  const extrasBox = extras.length
    ? `<div class="box"><b>Not included in the fare — payable separately:</b><br>${extras.map((e) => `${escapeHtml(e.label)} ${e.amount ? escapeHtml(money(e.amount)) : '(at actuals)'} — ${escapeHtml(e.detail)}`).join('<br>')}</div>`
    : '';
  const gstNote = f ? `GST @ ${Math.round(f.gstRate * 100)}% on taxable value ${escapeHtml(money(f.taxableAmount))}.` : `Fare inclusive of GST @ ${Math.round(GST_RATE * 100)}%.`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${escapeHtml(trip.bookingId)}</title>
<style>
body{font-family:Helvetica,Arial,sans-serif;margin:32px;color:#111}
h1{font-size:20px;margin:0;color:#E31E24}.muted{color:#666;font-size:12px}
.box{border:1px solid #e5e5e5;border-radius:8px;padding:12px;margin:14px 0;font-size:13px;line-height:1.6}
table{width:100%;border-collapse:collapse;font-size:13px}td{padding:6px 0;border-bottom:1px solid #eee}.r{text-align:right}
.total td{font-weight:700;font-size:15px;border-top:2px solid #111;border-bottom:none}
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

export function TripReceipt({ trip, customerName }: { trip: TripRecord; customerName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const total = payableAmount(trip);
  const amount = amountDue(trip);
  const paid = trip.paymentStatus === 'Paid' || (trip.paid !== null && trip.paid.totalPaid > 0 && amount === 0);

  const share = async () => {
    setBusy(true);
    setError('');
    try {
      if (Platform.OS === 'web') {
        // No file system in a browser: open the print dialog, which also offers "Save as PDF".
        await Print.printAsync({ html: receiptHtml(trip, customerName) });
        return;
      }
      const { uri } = await Print.printToFileAsync({ html: receiptHtml(trip, customerName) });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Receipt ${trip.bookingId}`, UTI: 'com.adobe.pdf' });
      } else {
        await Print.printAsync({ uri });
      }
    } catch {
      setError('Couldn’t create the receipt PDF. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <View style={styles.head}>
          <Text style={type.h3}>Receipt</Text>
          <Text style={type.small}>{trip.bookingId}</Text>
        </View>
        <FareLines lines={tripFareLines(trip)} total={trip.fareBreakdown?.total ?? trip.fare} tolls={trip.tollCharges} />
        {trip.paid && trip.paid.totalPaid > 0 ? (
          <View style={[styles.head, { marginTop: space.sm }]}>
            <Text style={type.small}>Paid so far {formatINR(trip.paid.totalPaid)}</Text>
            <Text style={type.small}>Balance {formatINR(trip.paid.balanceDue)}</Text>
          </View>
        ) : null}
        <Notice message={error} style={{ marginTop: space.md }} />
        <Button title={busy ? 'Preparing PDF…' : 'Download / share receipt (PDF)'} variant="secondary" loading={busy} onPress={() => void share()} style={{ marginTop: space.md }} />
      </Card>

      <Card style={paid ? styles.paid : styles.due}>
        {paid ? (
          <Text style={[type.h3, { color: colors.success }]}>
            Paid {formatINR(trip.paid?.totalPaid || total)} via {trip.paymentMethod}. Thank you!
          </Text>
        ) : (
          <>
            <Text style={styles.dueLabel}>
              {trip.paymentMethod === 'Cash' ? 'PAY CASH TO YOUR DRIVER' : trip.paymentMethod === 'UPI' ? 'PAY BY UPI' : trip.paymentMethod === 'Wallet' ? 'NESAM WALLET' : 'AMOUNT DUE'}
            </Text>
            <Text style={styles.dueAmount}>{formatINR(amount)}</Text>
            <Text style={styles.dueHint}>
              {trip.paymentMethod === 'Cash'
                ? 'Your driver will confirm the payment once collected.'
                : trip.paymentMethod === 'Wallet'
                  ? 'This amount will be deducted from your wallet. Nothing to pay the driver.'
                  : CUSTOMER_PAYMENTS_ENABLED && COMPANY_UPI_ID
                    ? 'Payment status updates once it’s confirmed.'
                    : 'Scan your driver’s UPI QR code to pay.'}
            </Text>
            {CUSTOMER_PAYMENTS_ENABLED && trip.paymentMethod === 'UPI' && COMPANY_UPI_ID ? (
              <Button title="Open UPI app" variant="secondary" onPress={() => void Linking.openURL(upiLink(trip)).catch(() => setError('No UPI app found on this phone.'))} style={{ marginTop: space.md }} />
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  paid: { backgroundColor: colors.successSoft, borderColor: colors.successBorder },
  due: { backgroundColor: colors.ink, borderColor: colors.ink },
  dueLabel: { color: '#D1D5DB', fontFamily: fonts.extraBold, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  dueAmount: { color: colors.white, fontFamily: fonts.black, fontSize: 30, fontWeight: '900', marginTop: 4 },
  dueHint: { color: '#E5E7EB', fontFamily: fonts.regular, fontSize: 12, marginTop: 4 },
});

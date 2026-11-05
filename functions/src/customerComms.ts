// Messages to the customer over WhatsApp, SMS and email (booking confirmation,
// driver assigned, trip updates, receipts). Each channel is attempted
// independently; one failing never blocks another, and every attempt is logged
// in notification_deliveries with its status.
import { DocumentData } from 'firebase-admin/firestore';
import { db } from './admin';
import { deliveryRow } from './notify';
import { Channel, SendResult, sendEmail, sendSms, sendWhatsApp, toDigits } from './providers';
import { brandOf, renderEmail, type EmailContent } from './mailer';
import { formatDateTime12, formatTime12, pickupInstant } from './domain/time';
import { loadContact } from './contacts';

export type CustomerMessageKind = 'booking_received' | 'booking_approved' | 'vendor_assigned' | 'driver_assigned' | 'booking_cancelled' | 'trip_completed' | 'refund_update';

export interface CustomerContact {
  name: string;
  /** E.164 mobile number. */
  phone: string;
  /** E.164 WhatsApp number; falls back to the mobile number. */
  whatsapp: string;
  email: string;
}

export function contactOf(b: DocumentData): CustomerContact {
  const wa = b.customerWhatsapp && typeof b.customerWhatsapp === 'object' ? b.customerWhatsapp : null;
  const phone = typeof b.phone === 'string' ? b.phone : '';
  return {
    name: typeof b.customer === 'string' ? b.customer : '',
    phone,
    whatsapp: wa && typeof wa.e164 === 'string' && wa.e164 ? wa.e164 : phone,
    email: typeof b.customerEmail === 'string' ? b.customerEmail : '',
  };
}

const rupees = (n: unknown) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

export function pickupWhen(b: DocumentData): string {
  const at = pickupInstant(b);
  return at ? formatDateTime12(at) : `${b.date ?? ''} ${typeof b.time === 'string' ? b.time : ''}`.trim();
}

interface Composed {
  subject: string;
  /** Single-line text for SMS/WhatsApp variables. */
  line: string;
  /** Longer plain-text body (kept for older callers and as the email's text part). */
  body: string;
  /** The same message laid out for the branded HTML email. */
  email: EmailContent;
}

/**
 * One customer message in the booking's own brand (NESAM Cabs, People Taxi or One Way Car Rentals): a one-line version for
 * SMS / WhatsApp and a full email with the trip details.
 */
export function composeCustomerMessage(kind: CustomerMessageKind, b: DocumentData, extra: { otp?: string; reason?: string } = {}): Composed {
  const brand = brandOf(b);
  const code = String(b.bookingId || '');
  const when = pickupWhen(b);
  const route = `${b.pickup ?? ''} to ${b.drop ?? ''}`;
  const name = typeof b.customer === 'string' && b.customer.trim() ? b.customer.trim() : 'there';
  const greeting = `Hello ${name},`;
  const trip: [string, string][] = [
    ['Booking ID', code], ['Pickup', String(b.pickup ?? '')], ['Drop', b.tripType === 'Local Rental' ? 'Local rental' : String(b.drop ?? '')],
    ['Pickup time', when], ['Trip type', String(b.tripType ?? b.service ?? '')], ['Vehicle', String(b.vehicleCategory ?? b.vehicle ?? '') + (b.fuelType === 'cng' ? ' (CNG)' : '')],
  ];
  const out = (subject: string, line: string, email: Omit<EmailContent, 'greeting'>): Composed => ({
    subject, line, body: [greeting, '', ...email.paragraphs.flatMap((x) => [x, ''])].join('\n').trim(), email: { ...email, greeting },
  });
  switch (kind) {
    case 'booking_received': {
      const line = `${brand.name}: your booking ${code} for ${when} (${route}) is confirmed. We will share the driver details before pickup.`;
      return out(`Booking ${code} confirmed`, line, {
        title: 'Your booking is confirmed',
        paragraphs: [`Thank you for booking with ${brand.name}. Your booking is confirmed. We will share the driver details before pickup.`],
        rows: [...trip, ['Fare', rupees(b.fare)], ['Payment', String(b.paymentMethod ?? 'Cash')]],
        note: 'Nothing is charged until your trip. Tolls, parking and state permits are payable at actuals unless your fare says they are included.',
      });
    }
    case 'booking_approved': {
      // Approval is not an assignment: no driver or vehicle is promised yet.
      const otpLine = extra.otp ? ` Your boarding OTP is ${extra.otp}. Share it only with your driver at pickup.` : '';
      const line = `Your ${brand.name} booking ${code} for ${when} (${route}) is approved. We are arranging your vehicle and will send driver details before pickup. Fare ${rupees(b.fare)}.${otpLine}`;
      return out(`Booking ${code} approved`, line, {
        title: 'Your booking is confirmed',
        paragraphs: [`Your booking is approved. We are arranging your vehicle and will send the driver's details before pickup.`, ...(extra.otp ? [`Your boarding OTP is ${extra.otp}. Share it only with your driver when you board.`] : [])],
        rows: [...trip, ['Fare', rupees(b.fare)]],
      });
    }
    case 'vendor_assigned': {
      const line = `Booking ${code} is confirmed with a ${brand.name} partner for ${when}. Driver and vehicle details will follow before pickup.`;
      return out(`Booking ${code} — partner confirmed`, line, {
        title: 'A partner has taken your trip', paragraphs: ['Your trip is confirmed with one of our partner fleets. Driver and vehicle details will follow before pickup.'], rows: trip,
      });
    }
    case 'driver_assigned': {
      const driver = String(b.assignedDriverName ?? b.driver ?? '');
      const line = `Driver assigned for booking ${code}: ${driver}${b.assignedVehicleNumber ? `, vehicle ${b.assignedVehicleNumber}` : ''}. Pickup ${when}.`;
      return out(`Driver assigned — ${code}`, line, {
        title: 'Your driver is assigned', paragraphs: ['Your driver and vehicle are confirmed for this trip.'],
        rows: [...trip, ['Driver', driver], ['Vehicle number', String(b.assignedVehicleNumber ?? '')]],
        note: 'Share your boarding OTP only with your driver at pickup.',
      });
    }
    case 'booking_cancelled': {
      const line = `Your ${brand.name} booking ${code} has been cancelled${extra.reason ? `: ${extra.reason}` : ''}.`;
      return out(`Booking ${code} cancelled`, line, {
        title: 'Your booking is cancelled',
        paragraphs: [`Booking ${code} has been cancelled${extra.reason ? `: ${extra.reason}` : '.'}`, 'Any refund due is recorded on the booking and you will get an update when it is processed.'],
        rows: trip,
      });
    }
    case 'trip_completed': {
      const line = `Thank you for travelling with ${brand.name}. Trip ${code} is complete. Total ${rupees(b.fare)}.`;
      return out(`Trip ${code} completed — receipt`, line, {
        title: 'Thank you for travelling with us',
        paragraphs: [`Your trip is complete. Here is your summary.`],
        rows: [...trip, ['Fare', rupees(b.fare)], ...(Number(b.tollCharges) > 0 ? [['Tolls & parking', rupees(b.tollCharges)] as [string, string]] : []),
          ['Paid', rupees(b.paymentSummary?.totalPaid)], ['Balance due', rupees(b.paymentSummary?.balanceDue)]],
        note: 'Your tax invoice is issued by the office. Reply to this email if anything on the trip needs a correction.',
      });
    }
    case 'refund_update': {
      const line = `Refund update for booking ${code}: ${extra.reason ?? 'status changed'}.`;
      return out(`Refund update — ${code}`, line, { title: 'Refund update', paragraphs: [`Refund for booking ${code}: ${extra.reason ?? 'the status has changed'}.`], rows: trip });
    }
  }
}

const templateFor = (kind: CustomerMessageKind) => process.env[`WHATSAPP_TEMPLATE_${kind.toUpperCase()}`] || process.env.WHATSAPP_TEMPLATE_BOOKING_UPDATE || '';

/**
 * Sends one customer message on every channel that has a destination.
 * Returns each channel's result so the caller can show "WhatsApp failed,
 * SMS sent" instead of a single vague status.
 */
export async function sendCustomerMessage(
  bookingId: string,
  b: DocumentData,
  kind: CustomerMessageKind,
  extra: { otp?: string; reason?: string } = {},
  /** Channels to use (default: every channel with a destination). */
  only?: Channel[],
): Promise<SendResult[]> {
  // Raw contact details are held apart from the booking (partners can read the booking).
  const stored = await loadContact(bookingId, b);
  const c: CustomerContact = { name: stored.name || contactOf(b).name, phone: stored.phone, whatsapp: stored.whatsapp, email: stored.email };
  const m = composeCustomerMessage(kind, b, extra);
  const jobs: Promise<SendResult>[] = [];
  const template = templateFor(kind);
  const use = (ch: Channel) => !only || only.includes(ch);
  if (use('whatsapp') && toDigits(c.whatsapp).length >= 10) {
    jobs.push(template
      ? sendWhatsApp(c.whatsapp, { name: template, bodyParams: [c.name || 'Customer', m.line] })
      : Promise.resolve({ ok: false, channel: 'whatsapp' as Channel, status: 'not_configured' as const, provider: 'whatsapp_cloud', error: 'No WhatsApp template is configured for this message.' }));
  }
  if (use('sms') && toDigits(c.phone).length >= 10) jobs.push(sendSms(c.phone, { text: m.line, variables: { message: m.line, var1: m.line } }));
  if (use('email') && c.email) {
    const brand = brandOf(b);
    const mail = renderEmail(brand, m.email);
    jobs.push(sendEmail(c.email, { subject: m.subject, text: mail.text, html: mail.html, brand }));
  }
  const results = await Promise.all(jobs);
  const recipient = { recipientId: String(b.customerId || bookingId), recipientType: 'customer' as const, category: 'bookings' as const, title: m.subject, message: m.line, bookingId };
  await Promise.all(results.map((r) => db.collection('notification_deliveries').add(deliveryRow('', recipient, r.channel, r.status === 'sent' ? 'sent' : r.status === 'not_configured' ? 'not_configured' : 'failed', {
    provider: r.provider, providerMessageId: r.providerMessageId ?? '', error: r.error ?? '', kind,
  }))));
  return results;
}

export { formatTime12 };

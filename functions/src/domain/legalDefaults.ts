// Starter text for the legal documents. These are TEMPLATES for the business
// to review with its own legal adviser: seeding creates them as drafts, they
// are not shown to users or enforced until an administrator publishes them,
// and they must be edited to match how NESAM actually operates.

export type LegalRole = 'customer' | 'driver' | 'vendor' | 'admin';
export type LegalType =
  | 'terms' | 'privacy' | 'driver_terms' | 'vendor_terms' | 'cancellation' | 'refund' | 'payment'
  | 'vehicle_verification_consent' | 'location_consent';

export interface LegalDefault {
  key: string;
  type: LegalType;
  role: LegalRole;
  title: string;
  /** Whether the user must accept before continuing. */
  requiresAcceptance: boolean;
  /** The exact text next to the checkbox. */
  checkboxText: string;
  body: string;
}

export const LEGAL_ROLES: readonly LegalRole[] = ['customer', 'driver', 'vendor', 'admin'];
export const LEGAL_TYPES: readonly LegalType[] = ['terms', 'privacy', 'driver_terms', 'vendor_terms', 'cancellation', 'refund', 'payment', 'vehicle_verification_consent', 'location_consent'];

export const legalKey = (type: string, role: string) => `${type}_${role}`;

const CO = 'NESAM Tours & Travels';

const privacy = (who: string, collects: string, uses: string) => `PRIVACY POLICY — ${who}

1. Who we are
${CO} ("we", "us") operates the booking platform. We decide why and how your personal data is processed.

2. What we collect
${collects}

3. Why we use it
${uses}

4. Who sees it
Staff who need it to operate bookings and support you. A driver or vendor sees a customer's name and contact details only after the trip is confirmed to them. We do not sell personal data. Service providers (cloud hosting, SMS, WhatsApp and email delivery, maps) process it on our instructions.

5. How long we keep it
Booking, payment and tax records are kept for the period the law requires. Other data is deleted or anonymised when it is no longer needed.

6. Your choices
You may ask to access, correct or erase your data, and to withdraw consent for optional uses, by contacting us through the support details in the app. Withdrawing consent does not affect processing already carried out.

7. Security
Access is restricted by role, data is encrypted in transit, and important actions are logged.

8. Changes
If this policy changes materially we will ask you to review and accept the new version.`;

export const LEGAL_DEFAULTS: LegalDefault[] = [
  {
    key: legalKey('terms', 'customer'), type: 'terms', role: 'customer', title: 'Terms & Conditions — Customers', requiresAcceptance: true,
    checkboxText: 'I agree to the Terms & Conditions and Privacy Policy.',
    body: `TERMS & CONDITIONS — CUSTOMERS

1. The service
${CO} arranges taxi and tour bookings with independent drivers and fleet operators. A booking is confirmed only after NESAM approves it and a driver is assigned.

2. Fares
The fare shown at booking is calculated from the vehicle category, distance and configured charges. Charges listed as "extra" (for example toll, parking, state tax, waiting and kilometres beyond the booked distance) are payable separately at actual cost. GST is shown in the fare.

3. Payments
You may pay in cash, by UPI or by bank transfer, in one or more instalments. Every payment is recorded with the amount, method and the person who collected it. Ask for a receipt.

4. Cancellations and refunds
Cancellation charges and refunds follow the Cancellation Policy and Refund Policy published in the app. Any refund is paid back through the method agreed with you.

5. Your responsibilities
Provide accurate pickup details, be available at the pickup time, treat the driver and vehicle with care and do not carry unlawful items.

6. Boarding OTP
You receive a one-time code for each trip. Share it only with your driver at pickup.

7. Liability
Nothing in these terms limits liability that cannot be limited by law.

8. Governing law
These terms are governed by the laws of India.`,
  },
  {
    key: legalKey('privacy', 'customer'), type: 'privacy', role: 'customer', title: 'Privacy Policy — Customers', requiresAcceptance: true,
    checkboxText: 'I agree to the Terms & Conditions and Privacy Policy.',
    body: privacy('CUSTOMERS',
      'Name, mobile number, WhatsApp number, optional email address, pickup and drop locations, trip history, payment records and support messages.',
      'To create and run your bookings, send booking confirmations and one-time codes by SMS, WhatsApp and email, record payments, give support, prevent fraud and meet legal obligations.'),
  },
  {
    key: legalKey('cancellation', 'customer'), type: 'cancellation', role: 'customer', title: 'Cancellation Policy', requiresAcceptance: false,
    checkboxText: 'I have read the Cancellation Policy.',
    body: `CANCELLATION POLICY

Cancel before a driver is assigned: no charge.
Cancel after assignment but before the trip starts: a cancellation charge may apply, shown to you before you confirm.
After the trip has started the booking can be cancelled only by NESAM staff.

The cancellation charge, if any, is deducted from the amount you paid and the rest is refunded under the Refund Policy.`,
  },
  {
    key: legalKey('refund', 'customer'), type: 'refund', role: 'customer', title: 'Refund Policy', requiresAcceptance: false,
    checkboxText: 'I have read the Refund Policy.',
    body: `REFUND POLICY

If a paid booking is cancelled and a refund is due, we refund the amount you paid minus any cancellation charge.
Refunds are made by the method you paid with or another method agreed with you, and are recorded with a reference.
Status shown in the app: Pending, Processing, Completed, Failed or Rejected. If a refund fails we will contact you to agree another method.`,
  },
  {
    key: legalKey('terms', 'driver'), type: 'terms', role: 'driver', title: 'Terms & Conditions — Drivers', requiresAcceptance: true,
    checkboxText: 'I agree to the Driver Terms & Conditions and Privacy Policy.',
    body: `DRIVER TERMS & CONDITIONS

1. Relationship
You provide transport services as an independent driver or as part of a fleet operator. These terms do not create employment.

2. Eligibility
You must hold a valid licence, vehicle documents, insurance, permit and fitness certificate, and keep them current.

3. Trips
Accept only trips you can complete. Follow the trip steps in the app in order: Reached Pickup, Trip Started (after the customer's boarding OTP), Trip End. Do not share a customer's details or use them for any other purpose.

4. Vehicle verification
Before each trip you capture photos of the vehicle front, rear and interior using the in-app camera. Photos from the gallery are not accepted. Submitting a reused, edited or misleading photo is a serious breach.

5. Payments
Fares are collected as recorded in the app. Record every amount you collect, with its method. Cash you collect is accounted against your earnings. Payouts are made as shown in your wallet.

6. Penalties
We may issue a penalty for a breach such as cancelling after acceptance, not turning up, or providing false information. You will be shown the amount, reason and booking and asked to acknowledge it. Acknowledging a penalty confirms you have read it; you may dispute it.

7. Safety and conduct
Drive safely, follow the law, and do not operate while impaired.

8. Governing law
These terms are governed by the laws of India.`,
  },
  {
    key: legalKey('privacy', 'driver'), type: 'privacy', role: 'driver', title: 'Privacy Policy — Drivers', requiresAcceptance: true,
    checkboxText: 'I agree to the Driver Terms & Conditions and Privacy Policy.',
    body: privacy('DRIVERS',
      'Name, contact details, identity and licence documents, bank or UPI details, vehicle documents and photos, trip activity, device information for security checks, and location while you use trip features.',
      'To verify you, assign and run trips, pay you, protect customers and the platform against fraud, and meet legal obligations.'),
  },
  {
    key: legalKey('vehicle_verification_consent', 'driver'), type: 'vehicle_verification_consent', role: 'driver', title: 'Vehicle photo verification consent', requiresAcceptance: true,
    checkboxText: 'I agree that the app may capture and store photos of my vehicle and check them for authenticity.',
    body: `VEHICLE PHOTO VERIFICATION

Before a trip you will capture photos of the vehicle front, rear and dashboard/interior using the camera. For each photo we store the image, the time it was captured and, if you allow it, the location. We compare images with earlier submissions and check them for signs of copying or editing, and flag suspicious ones for review. Photos are visible to NESAM staff. We keep them for the period needed to resolve disputes and meet legal obligations.`,
  },
  {
    key: legalKey('location_consent', 'driver'), type: 'location_consent', role: 'driver', title: 'Location permission', requiresAcceptance: true,
    checkboxText: 'I understand why the app uses my location and allow it during trips.',
    body: `LOCATION PERMISSION

The app uses your device location while you are on a trip: to confirm you reached the pickup point, to show the customer where you are and to record where each trip step happened. If you deny the permission some trip steps may not be available. We do not use your location when you are not using trip features.`,
  },
  {
    key: legalKey('terms', 'vendor'), type: 'terms', role: 'vendor', title: 'Terms & Conditions — Vendors', requiresAcceptance: true,
    checkboxText: 'I agree to the Vendor Terms & Conditions and Privacy Policy.',
    body: `VENDOR TERMS & CONDITIONS

1. Relationship
You operate a fleet of vehicles and drivers and accept trips through the platform.

2. Fleet quality
Only approved vehicles and approved drivers may be dispatched. Keep all documents valid.

3. Trips and dispatch
Accept trips you can serve and dispatch a driver and vehicle promptly. Trips with no driver close to pickup time are escalated to NESAM staff.

4. Payments and payouts
Payouts follow the agreed commission and the wallet shown in the app. Cash collected by your drivers is accounted against your earnings.

5. Penalties
Penalties may be issued to you for fleet breaches. You will see the amount, reason and booking and be asked to acknowledge it; you may dispute it.

6. Customer data
Customer contact details are shared only after a booking is confirmed to you, and only for completing the trip.

7. Governing law
These terms are governed by the laws of India.`,
  },
  {
    key: legalKey('privacy', 'vendor'), type: 'privacy', role: 'vendor', title: 'Privacy Policy — Vendors', requiresAcceptance: true,
    checkboxText: 'I agree to the Vendor Terms & Conditions and Privacy Policy.',
    body: privacy('VENDORS',
      'Business and owner details, GST and identity documents, bank details, fleet and driver records, trip and payout history.',
      'To verify your business, run trips, pay you, meet tax and legal obligations and prevent fraud.'),
  },
  {
    key: legalKey('terms', 'admin'), type: 'terms', role: 'admin', title: 'Staff acceptable use', requiresAcceptance: true,
    checkboxText: 'I agree to the Staff Acceptable Use Policy and Privacy Policy.',
    body: `STAFF ACCEPTABLE USE

Use your access only for your role. Customer, driver and vendor data is confidential and may be used only to run the service. Do not share your login. Important actions you take (approvals, fares, payments, refunds, penalties) are logged with your name.`,
  },
  {
    key: legalKey('privacy', 'admin'), type: 'privacy', role: 'admin', title: 'Privacy Policy — Staff', requiresAcceptance: true,
    checkboxText: 'I agree to the Staff Acceptable Use Policy and Privacy Policy.',
    body: privacy('STAFF', 'Your name, work email, role and the actions you perform in the admin panel.', 'To manage access, secure the platform and keep an audit trail.'),
  },
];

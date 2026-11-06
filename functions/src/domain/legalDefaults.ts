// Starter text for the legal documents shown in the apps (customer, driver, vendor and staff). These are
// TEMPLATES: seeding creates them as drafts, nothing is shown to users or enforced until an administrator
// publishes it, and the business should review them with its legal adviser before publishing. The admin
// page (LegalDocuments) offers this text for documents that do not exist yet, and as an update for drafts.
// Keep the customer text in line with the public policies on the customer sites (pages/PolicySections.tsx).

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

const CO = 'NESAM Tours and Travels Private Limited';
const BRANDS = 'NESAM Cabs, People Taxi and One Way Car Rentals';
const ADDRESS = 'Theni, Tamil Nadu 625531, India';
const PHONE = '+91 90250 99990';
const EMAIL = 'support@nesamcabs.com';
const UPDATED = 'Last updated: 7 November 2026';

const contact = `CONTACT US
${CO}, ${ADDRESS}
Phone: ${PHONE}
Email: ${EMAIL}`;

const privacy = (who: string, collects: string[], uses: string[], shares: string[], keeps: string) => `PRIVACY POLICY — ${who}
${UPDATED}

IN SHORT
• We collect only what we need to run the service with you.
• We never sell your personal data.
• You can ask to see, correct or delete your data at any time.

1. WHO IS RESPONSIBLE FOR YOUR DATA
${CO}, ${ADDRESS} ("we", "us") runs ${BRANDS}. We decide why and how your personal data is used. This policy follows the Digital Personal Data Protection Act, 2023 and the Information Technology Act, 2000.

2. WHAT WE COLLECT
${collects.map((x) => `• ${x}`).join('\n')}

3. WHY WE USE IT
${uses.map((x) => `• ${x}`).join('\n')}

4. WHO WE SHARE IT WITH
${shares.map((x) => `• ${x}`).join('\n')}
• Service providers who work for us: cloud hosting and sign-in (Google Firebase and Google Cloud), website hosting, maps (Google Maps), SMS, WhatsApp and email delivery, and online payments (Razorpay). They may use your data only to provide their service to us.
• Police or government authorities when the law requires it, or to protect someone's safety.
We never sell personal data, and we do not share it for other companies' advertising.

5. HOW LONG WE KEEP IT
${keeps} Booking, payment, invoice and tax records are kept for the period the law requires. Other data is deleted or anonymised when it is no longer needed.

6. YOUR RIGHTS
You can:
• see the personal data we hold about you;
• correct or update it;
• ask us to delete it (some records must be kept by law, as explained above);
• withdraw consent for optional uses — withdrawing does not affect what was done before;
• name a person to use these rights for you if you die or cannot use them yourself;
• complain to us, and then to the Data Protection Board of India if you are not satisfied.
To use these rights, email ${EMAIL} or call ${PHONE}. We may ask you to confirm your identity first.

7. SECURITY
Data is sent over encrypted connections. Access is limited by role to people who need it, and important actions are logged with the name of the person who took them. If a data breach affects you, we will tell you and the authorities as the law requires.

8. CHANGES
If this policy changes in an important way, we will ask you to read and accept the new version.

${contact}`;

// ── Customers ───────────────────────────────────────────────────────────────────

const customerTerms = `TERMS & CONDITIONS — CUSTOMERS
${UPDATED}

IN SHORT
• ${BRANDS} are run by ${CO}. By booking with us you agree to these terms.
• A booking is confirmed only when it shows Confirmed or a driver is assigned.
• The fare you see before you book is the fare for that trip. Tolls, parking and state permits are extra.
• Be ready on time, share your boarding OTP only with your driver, and treat the driver and vehicle with respect.

1. ABOUT US AND THESE TERMS
${BRANDS} are cab booking brands of ${CO}, ${ADDRESS} ("we", "us"). These terms apply every time you book through our websites, apps, phone line or WhatsApp. Read them with our Cancellation, Refund, Fare & Payment and Privacy policies. By creating an account, booking, or travelling on a booking made for you, you agree to them.

2. WHO DRIVES YOU
We arrange trips with professional drivers: our own driver partners, or drivers of fleet operators (vendors) who work with us. Every driver and vehicle must be approved by us with a valid driving licence, registration, insurance, permit and fitness certificate. Once a driver is assigned, your booking shows the driver's name, vehicle number and contact.

3. YOUR ACCOUNT
• You sign in with your mobile number and a one-time password (OTP). Keep your phone and OTPs private. Anything booked from your account is treated as booked by you.
• You must be at least 18 years old to book. Children may travel with a responsible adult.
• Give your real name and a mobile number you can be reached on.
• If you book for someone else, make sure they agree to you sharing their name and number with us and the driver.

4. HOW BOOKING WORKS
1) Choose the service, pickup, drop (and stops where allowed), date and time.
2) Choose a vehicle. Each shows the fare calculated for your exact route.
3) Check the fare breakdown and trip rules on Review booking, accept the policies and submit.
4) Your booking is Pending until our team confirms it.
5) When a driver is assigned, you get the driver and vehicle details and a boarding OTP.
6) At pickup, check the vehicle number, then share the OTP with the driver to start the trip.
7) At the end, pay as agreed and rate your trip.
Bookings must be made at least 30 minutes before pickup. We may decline a request (for example, when no vehicle is free or the area is not served); a declined request costs nothing.

5. OUR SERVICES
One Way (drop) trips, Round Trips with stops, Airport transfers, Hourly Rental within a city, Local Pickup & Drop inside a city, Multicity tours, and Local Taxi on-demand rides where available. Every service comes with a driver; we do not rent self-drive cars.

6. FARES
• Your fare is calculated by our booking system from the road distance of your route (measured with Google Maps), the service, vehicle, date and time, and our tariff. Once you book, later price changes do not affect your booking.
• GST is included in the total shown.
• Not included: tolls, parking, state entry taxes and permits. You pay these at actual cost.
• Added only when they happen, at the rates shown for your booking: extra kilometres, extra hours or days, waiting after the free period, hill station charge, roof carrier charge.
• A higher price shown crossed out is for comparison only. You pay the fare that is not crossed out.

7. TRIP RULES
• Every rate below is shown for your vehicle on Review booking and in your booking details.
• Driver allowance (bata) covers the driver's meals and stay. It is included in outstation fares and charged per day on round trips. You do not need to provide food or a room for the driver.
• Waiting: a free waiting period applies at pickup and at each stop; after it, waiting is charged per hour at the rate shown.
• Hill stations and ghat roads (for example Ooty, Kodaikanal, Yercaud, Munnar, Valparai): a fixed hill station charge per trip.
• Roof carrier: a fixed charge per trip if you ask for one.
• Extra charges are recorded by the driver and checked by our office before you are billed.
• There is no separate night charge unless one appears in your fare breakdown.
• Detours, extra stops or sightseeing you ask for are charged at the extra-km rate.
• On steep ghat climbs the driver may switch the AC off for a short time. On long drives the driver takes short rest breaks for safety.
One Way: you pay for the road distance or the one-way minimum km, whichever is more. One pickup and one drop are included. Trips of 40 km or less inside one city are priced as Local Pickup & Drop.
Round Trip: starts and ends at your pickup, with up to 8 stops. Charged by calendar day (Indian time), counting the start and return dates; returning after midnight adds a day. You pay for the actual distance out and back, or the minimum km per day × days, whichever is more, plus a driver allowance per day.
Airport: fixed packages with included km; extra km at the extra-km rate; airport parking and entry fees at actual cost. Add your flight number for pickups. Allow plenty of time to reach the airport.
Hourly Rental: a package of hours with included km, for use within the city. Extra hours and km are charged at the rates shown. Unused hours or km are not refunded.
Local Pickup & Drop: trips of 40 km or less inside one city, at the city's minimum km or the road distance, whichever is more.
Multicity: priced on the whole itinerary with a minimum km and driver allowance per day; confirmed by our travel desk before it is accepted.
Local Taxi: the fare is shown before you request. If the distance driven differs from the planned route, the fare is worked out on the distance driven, up to a set limit. Waiting after the free period is charged per minute. Paid online in the app.

8. CHANGING YOUR TRIP
Contact support to change the time, stops, hours, days or destination. We tell you the new fare before the change. The driver may not change the route or ask for money that is not shown in your booking — report it to us if this happens.

9. WHAT WE PROMISE
• A clean, roadworthy, insured and permitted vehicle of the category you booked, with an approved driver.
• If we cannot provide that category, we will tell you as early as we can and offer a similar or higher category at no extra cost, or let you cancel free with a full refund.
• Clear fares, with every extra charge explained.
• Support before, during and after your trip.

10. PASSENGER CONDUCT, LUGGAGE AND PETS
• No smoking (including e-cigarettes), alcohol or drugs in the vehicle. Do not travel drunk.
• Everyone wears a seat belt. Passengers may not be more than the seats in the vehicle, including children.
• Be polite to the driver. Abuse, harassment or violence will be reported.
• Never ask the driver to speed, skip rest breaks, overload the vehicle or break any law.
• Carry only the luggage that fits safely in the boot; pack and secure it properly. Ask for a roof carrier for extra luggage.
• Do not carry explosives, fireworks, gas cylinders, fuel, weapons, illegal drugs, contraband or anything dangerous or unlawful.
• Pets travel only if you tell us in advance, the driver agrees, and the pet is in a carrier or on a seat cover you provide. You are responsible for any cleaning or damage. Assistance animals are welcome; please tell us in advance.
• Children travel with a responsible adult. Bring your own child seat if you need one.
• The driver may refuse or stop a trip in a safe place if a passenger is drunk, abusive or violent, carries prohibited items, overloads the vehicle or puts anyone's safety at risk. A cancellation fee or the fare for the distance travelled may then be charged.
• Follow all laws and government rules during travel.

11. BOARDING OTP AND SAFETY
You receive a one-time code for each trip. Check the vehicle number first, then share the code only with your driver at pickup. In an emergency call 112 first; our support line is not an emergency service. Use the Safety centre to share your trip or send an SOS alert to our team.

12. DELAYS AND THINGS OUTSIDE OUR CONTROL
Travel times are estimates. Traffic, weather, road works, festivals, strikes, accidents, police checks or breakdowns can cause delays. If a vehicle breaks down we will arrange a replacement as quickly as we reasonably can. Allow extra time for flights, trains, exams and events; we are not responsible for missed connections caused by delays outside our reasonable control.

13. DAMAGE AND CLEANING
If a passenger damages the vehicle or makes it unusually dirty, you pay the reasonable cost of cleaning or repair. We show you photos and the bill or estimate before charging you.

14. LOST BELONGINGS
Check the vehicle before you leave. If you leave something behind, contact support quickly; we will contact the driver and help you get it back. We are not responsible for items left in the vehicle. Any return delivery cost is paid by you.

15. OUR LIABILITY
If something goes wrong because of our fault, our liability for that trip is limited to the amount you paid for it. This does not limit liability that the law does not allow us to limit, such as for death or personal injury caused by negligence, or your rights under the Consumer Protection Act, 2019.

16. SUSPENDING AN ACCOUNT
We may suspend or close an account used for fraud, abuse or harassment, fake bookings or repeated non-payment. Where reasonable, we tell you why and let you respond.

17. CHANGES TO THESE TERMS
We may update these terms. If a change is important, we will ask you to accept the new version before your next booking.

18. COMPLAINTS
Contact support first, with your booking ID. We acknowledge every complaint within 48 hours and aim to resolve it within 30 days. Grievance Officer: ${CO}, ${ADDRESS}; email ${EMAIL} (subject "Grievance"); phone ${PHONE}. If you are not satisfied, contact the National Consumer Helpline on 1915 (consumerhelpline.gov.in) or file a complaint at edaakhil.nic.in.

19. LAW AND DISPUTES
These terms are governed by the laws of India. Subject to your right to approach a consumer commission, the courts at Theni, Tamil Nadu have jurisdiction.

${contact}`;

const customerCancellation = `CANCELLATION POLICY
${UPDATED}

IN SHORT
• Scheduled booking: free while Pending or more than 1 hour before pickup; after that ₹100.
• Instant booking: free before a driver is assigned and for 3 minutes after; after that ₹50.
• The app shows the fee before you confirm.
• If we cancel, you pay nothing and get back anything you paid.

1. HOW TO CANCEL
Open My trips, choose the booking and tap Cancel. The app shows whether a fee applies before you confirm. For bookings made through our office, call support.

2. SCHEDULED BOOKINGS
• Free while the booking is still Pending.
• Free when pickup is more than 1 hour away.
• ₹100 when the booking is confirmed and pickup is 1 hour away or less, because a driver is already committed.

3. INSTANT BOOKINGS
• Free before a driver is assigned, and for 3 minutes after.
• ₹50 after that, because the driver is on the way.

4. LOCAL TAXI RIDES
Free before a driver is assigned and for a short time after. After that, the fee shown in the app applies.

5. TRIPS THAT HAVE STARTED
A trip that has started cannot be cancelled in the app. To end it early, tell the driver and call support. You pay for the distance and time used.

6. NO-SHOW
If you are not at the pickup point and cannot be reached, the driver waits and tries to contact you. If you still cannot be reached, the booking may be cancelled as a no-show and the cancellation fee that applied at that time is charged.

7. IF WE CANCEL
If we, the driver or the fleet operator cancel, or we cannot provide your vehicle, you pay no fee and anything you paid is refunded in full. If a driver asks you to cancel the booking yourself, please call support instead so no fee is charged to you by mistake.

8. CHANGING INSTEAD OF CANCELLING
Call support before cancelling. We may be able to change the date or time, subject to availability.

9. A FEE YOU THINK IS WRONG
Contact support with your booking ID. We check the booking history and remove any fee charged by mistake.

${contact}`;

const customerRefund = `REFUND POLICY
${UPDATED}

IN SHORT
• A refund applies only to money you actually paid.
• You get back what you paid, minus any cancellation fee and any part of the trip already used.
• Refunds go back the way you paid, or another way we agree with you, with a reference number.

1. WHEN YOU GET A REFUND
• You cancel a booking you already paid for (fully or as an advance).
• We cancel your booking, or cannot provide your vehicle — you get back everything you paid.
• You were charged twice, paid too much, or paid for a service you did not receive.
• A payment failed but money left your account.

2. HOW TO ASK
Contact support with your booking ID, amount, payment method and the transaction reference or receipt. We check the payment and confirm the refund amount to you.

3. HOW IT IS PAID
By the method you used, or another method we agree with you (UPI or bank transfer). Online payments go back to the same card, UPI or account. You receive a refund reference, and the status appears on your booking: Pending, Processing, Completed, Failed or Rejected.

4. HOW LONG IT TAKES
We aim to start an approved refund within 7 working days. Your bank may take a few more working days. A Pending or Processing refund is not yet in your account; if it is delayed, contact us with the reference.

5. PAYMENTS MADE TO A DRIVER
If you paid a driver or fleet operator directly, we first check the payment with them and your receipt. Keep receipts and UPI screenshots.

6. FAILED OR REJECTED REFUNDS
If a refund fails, we contact you to agree another way. If we reject a request, we tell you why, and you can ask us to review it.

${contact}`;

const customerPayment = `FARE & PAYMENT POLICY
${UPDATED}

IN SHORT
• No money is taken when you book. Pay your driver at the end of the trip, in cash or by UPI.
• Check the amount against your booking and keep a receipt.
• We will never ask for your UPI PIN, card PIN or OTP for a payment.

1. HOW TO PAY
• Book now, pay later: for standard bookings, pay the driver at the end of the trip in cash or by UPI. Check that the UPI name belongs to the driver or to us.
• Every payment is recorded on your booking with the amount and method.
• Local Taxi rides are paid online through Razorpay. We never see or store your card details.
• Office and phone bookings may need an advance by cash, UPI or bank transfer, recorded with a receipt.
• Business accounts are billed under their signed agreement.

2. WHAT YOU PAY FOR
• The fare shown on Review booking, including GST.
• Extras that happen on the trip, at the rates shown for your booking: extra km, extra hours or days, waiting, hill station and roof carrier charges.
• Tolls, parking, state entry taxes and permits at actual cost.
• Any cancellation fee under the Cancellation Policy.

3. OFFERS AND COUPONS
One coupon per booking, only under its stated conditions. Coupons have no cash value. We may change or withdraw an offer; bookings already confirmed keep it.

4. GST INVOICES
For a GST invoice, contact support with your booking ID and GSTIN.

5. PAYMENT PROBLEMS
If you were charged twice, paid too much, or money left your account for a failed payment, contact support with your booking ID and the transaction reference. Do not pay again until support has checked it.

${contact}`;

// ── Drivers ─────────────────────────────────────────────────────────────────────

const driverTerms = `DRIVER PARTNER TERMS & CONDITIONS
${UPDATED}

IN SHORT
• You work with us as an independent driver partner, not as an employee.
• Keep your licence and vehicle documents valid, and follow the trip steps in the app.
• Treat customers with respect and keep their details private.
• Earnings, cash collected, commission and penalties are all shown in your wallet and statement.

1. OUR RELATIONSHIP
You provide transport services as an independent driver partner, or as a driver of a fleet operator (vendor) that works with ${CO} ("we", "us"). These terms do not make you our employee, agent or partner in law. You choose which trips to accept.

2. WHO CAN DRIVE
• You must hold a valid driving licence for the vehicle class, and your driving licence number is your Driver ID with us.
• You must submit true documents: licence, identity proof, address proof, photo, and bank or UPI details. Vehicles need a valid registration certificate (RC), insurance, permit, fitness certificate and pollution certificate. The registration number is the vehicle's ID.
• We verify every document before you can take trips. Keep them valid; an expired document stops new trips until it is renewed and approved.
• Tell us immediately if your licence is suspended or any document changes.

3. TAKING TRIPS
• Accept only trips you can complete on time with an approved vehicle.
• Trips may be assigned to you, offered to you, or published on the open marketplace. A trip is yours only when the app confirms it.
• Follow the trip steps in the app, in order: Reached Pickup → Trip Started (only after the customer gives you their boarding OTP) → Trip End. Never start a trip without the OTP.
• Reach the pickup point on time. If you will be late, tell the customer and our team.
• Follow the normal road route. Make detours or stops only when the customer asks.
• Record extra usage honestly in the app: waiting time at each stop, hill travel and roof carrier use. Our office checks it before the customer is billed.

4. VEHICLE PHOTO VERIFICATION
Before a trip you capture photos of the vehicle (front, rear and interior) with the in-app camera. Gallery photos are not accepted. Submitting a reused, edited or misleading photo is a serious breach and can lead to suspension.

5. CONDUCT AND SAFETY
• Drive safely and within speed limits. Follow all traffic laws.
• Never drive under the influence of alcohol or drugs, and never while too tired. Take rest breaks on long drives.
• Do not smoke in the vehicle. Keep the vehicle clean and the AC working.
• Be polite and professional. Harassment, abuse or discrimination of any kind leads to immediate suspension.
• Do not ask the customer for extra money, a different route or an off-app trip. Do not ask the customer to cancel a booking.
• You may refuse or stop a trip in a safe place if a passenger is drunk, abusive or violent, carries prohibited items or puts safety at risk. Report it to us at once.
• In an accident, make sure everyone is safe, call 112 if anyone is hurt, and then inform us.
• Hand over any item a customer leaves behind to our team or return it as we direct.

6. CUSTOMER DATA
Use a customer's name, number and address only to complete their trip. Do not save, share or contact them for any other reason, during or after the trip.

7. PAYMENTS AND EARNINGS
• Collect only the amount shown in the app for the trip, plus actual tolls, parking and permits against receipts.
• Record every amount you collect, with its method, in the app. Give the customer a receipt when asked.
• Cash you collect is adjusted against what we owe you.
• Our commission is set by our commission policy and shown in your statement. Fixed partner payouts on some fares are shown before you accept the trip.
• Payouts become due a set number of hours after a trip is completed, as shown in your wallet. A payout may be held while a payment, complaint or dispute about the trip is checked.
• You are responsible for your own income tax and any other taxes on your earnings.

8. PENALTIES
We may issue a penalty for a breach, such as cancelling after accepting, not turning up, late arrival, starting a trip without the OTP, collecting extra money, false information or misconduct. You will see the amount, reason and booking, and be asked to acknowledge it. Acknowledging only confirms you have read it. You can dispute a penalty through the app or support, and we will review it.

9. ACCOUNT STATUS
Your account may be Active, Suspended, Inactive, on Dispute hold or Permanently blocked. We may suspend an account for document problems, safety complaints, fraud or repeated breaches, and we will tell you why. Serious breaches (for example violence, fraud or driving under the influence) may lead to a permanent block.

10. LEAVING THE PLATFORM
You can stop working with us at any time. When an account is closed, we prepare a Full & Final statement of earnings, cash collected, penalties and payouts, and settle the balance.

11. LOCATION
The app uses your location while you are on a trip, as explained in the Location permission notice.

12. CHANGES
We may update these terms. If a change is important, you will be asked to accept the new version.

13. LAW
These terms are governed by the laws of India. The courts at Theni, Tamil Nadu have jurisdiction.

${contact}`;

const driverVerification = `VEHICLE PHOTO VERIFICATION
${UPDATED}

Before a trip, you capture photos of the vehicle — front, rear and dashboard/interior — using the camera inside the app. Photos from your gallery are not accepted.

For each photo we store:
• the image;
• the time it was captured;
• your location at that time, if you allow location access.

We compare each photo with earlier submissions and check it for signs of copying or editing. Suspicious photos are flagged for review by our team, and you may be asked to capture them again. Submitting a reused, edited or misleading photo is a serious breach of the Driver Partner Terms.

Photos are visible only to authorised NESAM staff. We keep them for as long as needed to check trips, resolve complaints and disputes, and meet our legal duties, and then delete them.

${contact}`;

const driverLocation = `LOCATION PERMISSION
${UPDATED}

Why we use your location
• To confirm you have reached the pickup point.
• To show the customer where you are while you come to them and during the trip.
• To record where each trip step (Reached Pickup, Trip Started, Trip End) happened.
• To send help quickly if there is an SOS alert.

When we use it
Only while you use trip features: going to a pickup, and during a trip. We do not track you when you are offline or not on a trip.

Your choice
You can deny or turn off location permission in your phone settings. Some trip steps will then not be available, because we cannot confirm where they happened.

${contact}`;

// ── Vendors ─────────────────────────────────────────────────────────────────────

const vendorTerms = `VENDOR (FLEET OPERATOR) TERMS & CONDITIONS
${UPDATED}

IN SHORT
• You run your own fleet of vehicles and drivers and take trips through our platform.
• Only approved vehicles and drivers may be sent on trips.
• You are responsible for your drivers' conduct, documents and payments to them.
• Payouts, cash collected, commission and penalties are shown in your wallet and statement.

1. OUR RELATIONSHIP
You operate a fleet of vehicles and drivers as an independent business and accept trips through the platform of ${CO} ("we", "us"). These terms do not create employment, agency or partnership in law.

2. YOUR BUSINESS
• Submit true business, owner, identity, GST (where registered) and bank details. We verify them before you can take trips.
• Tell us promptly about any change in ownership, address, bank details or GST registration.

3. FLEET AND DRIVERS
• Only vehicles and drivers approved by us may be sent on trips. Each vehicle needs a valid RC, insurance, permit, fitness and pollution certificate; each driver needs a valid licence and verified documents.
• Keep every document valid. A vehicle or driver with an expired document cannot take trips until it is renewed and approved.
• You are responsible for your drivers: their training, conduct, rest, wages and any legal duties you have towards them.
• Your drivers must follow the Driver Partner Terms, including the trip steps, boarding OTP, photo verification and conduct rules.

4. TRIPS AND DISPATCH
• Accept only trips you can serve on time.
• After accepting, assign an approved driver and vehicle of the booked category promptly. Trips without a driver close to pickup time are escalated to our team and may be reassigned.
• Do not send a different vehicle category or an unapproved driver. Do not ask the customer for extra money or an off-app trip.

5. PAYMENTS AND PAYOUTS
• Your earnings follow our commission policy, or the fixed partner payout shown on the trip before you accept it.
• Cash your drivers collect from customers is adjusted against what we owe you.
• Payouts become due a set number of hours after a trip is completed, as shown in your wallet. A payout may be held while a payment, complaint or dispute is checked.
• You are responsible for your own income tax and GST, and for issuing GST invoices where your registration requires it.

6. PENALTIES
We may issue a penalty for fleet breaches, such as not assigning a driver, cancelling after accepting, late arrival, wrong vehicle, unapproved drivers, extra money collected or misconduct. You will see the amount, reason and booking, and be asked to acknowledge it. You can dispute it, and we will review it.

7. CUSTOMER DATA
Customer details are shared with you only after a booking is confirmed to you, and only to complete that trip. Do not store, share or use them for anything else, and make sure your drivers do the same.

8. ACCOUNT STATUS AND LEAVING
Your account may be Active, Suspended, Inactive, on Dispute hold or Permanently blocked. We will tell you the reason for any suspension. When an account is closed, we prepare a Full & Final statement and settle the balance.

9. CHANGES AND LAW
We may update these terms; if a change is important you will be asked to accept the new version. These terms are governed by the laws of India, and the courts at Theni, Tamil Nadu have jurisdiction.

${contact}`;

// ── Staff ───────────────────────────────────────────────────────────────────────

const staffTerms = `STAFF ACCEPTABLE USE POLICY
${UPDATED}

1. YOUR ACCESS
Your Staff ID gives you access only to the sections your role needs. Use it only for your work at ${CO}.

2. CONFIDENTIAL DATA
Customer, driver, vendor, fare and payment data is confidential. Use it only to run the service. Do not copy, export, photograph or share it outside your work, and do not contact customers, drivers or vendors for any personal reason.

3. YOUR LOGIN
Do not share your password, OTP or Staff ID with anyone, even another staff member. Lock or sign out of the admin panel when you leave your device. Report a lost device or suspected misuse straight away.

4. YOUR ACTIONS ARE RECORDED
Important actions — approving bookings, changing fares and settings, recording payments and refunds, issuing penalties, changing accounts — are logged with your name and time.

5. MONEY AND FARES
Record payments, refunds and charges exactly as they happened, with correct references. Do not give discounts, overrides or refunds outside your permissions.

6. LEAVING
When you leave or change roles, your access is changed or removed. Your duty of confidentiality continues after you leave.

Breaking this policy may lead to your access being removed and to disciplinary or legal action.`;

export const LEGAL_DEFAULTS: LegalDefault[] = [
  {
    key: legalKey('terms', 'customer'), type: 'terms', role: 'customer', title: 'Terms & Conditions — Customers', requiresAcceptance: true,
    checkboxText: 'I agree to the Terms & Conditions and Privacy Policy.',
    body: customerTerms,
  },
  {
    key: legalKey('privacy', 'customer'), type: 'privacy', role: 'customer', title: 'Privacy Policy — Customers', requiresAcceptance: true,
    checkboxText: 'I agree to the Terms & Conditions and Privacy Policy.',
    body: privacy('CUSTOMERS',
      [
        'Account details: name, mobile number, WhatsApp number and email (optional).',
        'Trip details: pickup, drop and stop locations, dates and times, passenger name and number (if you book for someone else), flight number (optional) and trip notes.',
        'Payment records: amounts, methods, references and receipts. We do not store card or UPI PIN details.',
        'Location: your device location, only if you allow it.',
        'Safety and support: SOS alerts, support messages, ratings, reviews and complaints.',
        'Technical details: device and browser type and sign-in records, to keep your account secure.',
      ],
      [
        'To create and run your bookings, assign a driver and keep you updated.',
        'To send confirmations, OTPs and trip updates by SMS, WhatsApp and email.',
        'To record payments, issue receipts and invoices, and process refunds.',
        'To keep passengers and drivers safe, handle SOS alerts and prevent fraud.',
        'To answer questions and complaints, and to meet legal and tax duties.',
      ],
      [
        'Your assigned driver and fleet operator: your name, pickup and drop details and a way to contact you, only for your trip.',
        'Our operations and support staff who need it to run your booking.',
      ],
      'We keep your account details while your account is open.'),
  },
  {
    key: legalKey('cancellation', 'customer'), type: 'cancellation', role: 'customer', title: 'Cancellation Policy', requiresAcceptance: false,
    checkboxText: 'I have read the Cancellation Policy.',
    body: customerCancellation,
  },
  {
    key: legalKey('refund', 'customer'), type: 'refund', role: 'customer', title: 'Refund Policy', requiresAcceptance: false,
    checkboxText: 'I have read the Refund Policy.',
    body: customerRefund,
  },
  {
    key: legalKey('payment', 'customer'), type: 'payment', role: 'customer', title: 'Fare & Payment Policy', requiresAcceptance: false,
    checkboxText: 'I have read the Fare & Payment Policy.',
    body: customerPayment,
  },
  {
    key: legalKey('terms', 'driver'), type: 'terms', role: 'driver', title: 'Terms & Conditions — Driver Partners', requiresAcceptance: true,
    checkboxText: 'I agree to the Driver Partner Terms & Conditions and Privacy Policy.',
    body: driverTerms,
  },
  {
    key: legalKey('privacy', 'driver'), type: 'privacy', role: 'driver', title: 'Privacy Policy — Driver Partners', requiresAcceptance: true,
    checkboxText: 'I agree to the Driver Partner Terms & Conditions and Privacy Policy.',
    body: privacy('DRIVER PARTNERS',
      [
        'Identity and contact: name, mobile number, photo, address, and identity and address proof.',
        'Driving and vehicle: driving licence (your Driver ID), vehicle documents and vehicle photos.',
        'Payments: bank or UPI details, earnings, cash collected, payouts, commission and penalties.',
        'Trips: trips offered, accepted and completed, trip steps, extra usage recorded, ratings and complaints.',
        'Location: while you use trip features, as explained in the Location permission notice.',
        'Technical details: device information and sign-in records, for security checks.',
      ],
      [
        'To verify you and your vehicle, and keep your documents up to date.',
        'To offer, assign and run trips, and connect you with customers.',
        'To pay you and keep accurate earnings, cash and tax records.',
        'To protect customers, drivers and the platform against fraud and unsafe behaviour.',
        'To handle complaints, disputes and penalties, and meet legal duties.',
      ],
      [
        'Customers on your trips: your name, photo, vehicle number and contact, only for that trip.',
        'Your fleet operator (vendor), if you drive for one: your trips, earnings and documents.',
        'Our operations, verification and finance staff who need it for their work.',
      ],
      'We keep your profile while your account is open, and documents for as long as you take trips with us.'),
  },
  {
    key: legalKey('vehicle_verification_consent', 'driver'), type: 'vehicle_verification_consent', role: 'driver', title: 'Vehicle photo verification consent', requiresAcceptance: true,
    checkboxText: 'I agree that the app may capture and store photos of my vehicle and check them for authenticity.',
    body: driverVerification,
  },
  {
    key: legalKey('location_consent', 'driver'), type: 'location_consent', role: 'driver', title: 'Location permission', requiresAcceptance: true,
    checkboxText: 'I understand why the app uses my location and allow it during trips.',
    body: driverLocation,
  },
  {
    key: legalKey('terms', 'vendor'), type: 'terms', role: 'vendor', title: 'Terms & Conditions — Vendors', requiresAcceptance: true,
    checkboxText: 'I agree to the Vendor Terms & Conditions and Privacy Policy.',
    body: vendorTerms,
  },
  {
    key: legalKey('privacy', 'vendor'), type: 'privacy', role: 'vendor', title: 'Privacy Policy — Vendors', requiresAcceptance: true,
    checkboxText: 'I agree to the Vendor Terms & Conditions and Privacy Policy.',
    body: privacy('VENDORS',
      [
        'Business details: business name, owner details, address, GST registration and identity documents.',
        'Bank and payment details: bank or UPI details, earnings, cash collected by your drivers, payouts, commission and penalties.',
        'Fleet details: your vehicles, their documents and photos, and your drivers and their documents.',
        'Trips: trips offered, accepted, assigned and completed, ratings and complaints.',
        'Technical details: device information and sign-in records, for security checks.',
      ],
      [
        'To verify your business, vehicles and drivers.',
        'To offer and run trips, and connect your drivers with customers.',
        'To pay you and keep accurate earnings, cash and tax records.',
        'To prevent fraud, handle complaints, disputes and penalties, and meet legal duties.',
      ],
      [
        'Customers on your trips: your driver and vehicle details, only for that trip.',
        'Our operations, verification and finance staff who need it for their work.',
      ],
      'We keep your business profile while your account is open.'),
  },
  {
    key: legalKey('terms', 'admin'), type: 'terms', role: 'admin', title: 'Staff acceptable use', requiresAcceptance: true,
    checkboxText: 'I agree to the Staff Acceptable Use Policy and Privacy Policy.',
    body: staffTerms,
  },
  {
    key: legalKey('privacy', 'admin'), type: 'privacy', role: 'admin', title: 'Privacy Policy — Staff', requiresAcceptance: true,
    checkboxText: 'I agree to the Staff Acceptable Use Policy and Privacy Policy.',
    body: privacy('STAFF',
      ['Your name, work email, mobile number, role and Staff ID.', 'The actions you take in the admin panel, with times, and your sign-in and device records.'],
      ['To give you the right access for your role.', 'To keep the platform secure and keep an audit trail of important actions.'],
      ['Other staff who manage access and review the audit trail.'],
      'We keep your staff record while you work with us, and the audit trail for as long as the law and our records require.'),
  },
];

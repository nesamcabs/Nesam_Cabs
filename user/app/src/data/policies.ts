// The customer policies, as on the website's /legal page (user/web/src/pages/PolicySections.tsx): readable before
// sign-in. Fees and windows come from the shared booking constants, so the text always matches what the app charges.
import {
  COMPANY_LEGAL_NAME,
  FREE_CANCEL_AFTER_ASSIGN_MS,
  INSTANT_CANCELLATION_FEE,
  SCHEDULED_CANCELLATION_FEE,
  SCHEDULED_FREE_CANCEL_BEFORE_MS,
  SCHEDULE_MIN_LEAD_MIN,
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  SUPPORT_PHONE_DISPLAY,
} from '../config/constants';

const BRAND = 'NESAM Cabs';
const UPDATED = '7 November 2026';
const ADDRESS = 'Theni, Tamil Nadu 625531, India';

export type PolicyId =
  | 'terms'
  | 'trip-rules'
  | 'payment'
  | 'cancellation'
  | 'refund'
  | 'conduct'
  | 'safety'
  | 'privacy'
  | 'deletion'
  | 'complaints';

export const POLICY_TITLES: Record<PolicyId, string> = {
  terms: 'Terms & Conditions',
  'trip-rules': 'Trip Rules & Charges',
  payment: 'Fare & Payment Policy',
  cancellation: 'Cancellation Policy',
  refund: 'Refund Policy',
  conduct: 'Passenger Conduct, Luggage & Pets',
  safety: 'Passenger Safety & Support',
  privacy: 'Privacy & Location Policy',
  deletion: 'Account & Data Deletion',
  complaints: 'Complaints & Grievances',
};

const hours = SCHEDULED_FREE_CANCEL_BEFORE_MS / 3600000;
/** The scheduled free-cancellation window, e.g. "1 hour". */
export const FREE_CANCEL_WINDOW = `${hours} hour${hours === 1 ? '' : 's'}`;
const INSTANT_GRACE = `${FREE_CANCEL_AFTER_ASSIGN_MS / 60000} minutes`;

/** One piece of a policy: a sub-heading, a paragraph, or a bullet / numbered list. */
export type Block = { h: string } | { p: string } | { ul: string[] } | { ol: string[] };

export interface Policy {
  id: PolicyId;
  /** "In short": the few points a rider most needs, shown first. */
  short: string[];
  blocks: Block[];
}

export const POLICIES: Policy[] = [
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'terms',
    short: [
      `${BRAND} is run by ${COMPANY_LEGAL_NAME}. By booking with us you agree to these terms.`,
      'A booking is confirmed only when your booking shows Confirmed or a driver is assigned.',
      'The fare you see before you book is the fare for that trip. Tolls, parking and state permits are extra.',
      'Be ready at the pickup point on time, share the boarding OTP only with your driver, and treat the driver and vehicle with respect.',
    ],
    blocks: [
      { h: '1. About us and these terms' },
      { p: `${BRAND} is a cab booking service of ${COMPANY_LEGAL_NAME}, ${ADDRESS} ("we", "us", "our"). NESAM Cabs, People Taxi and One Way Car Rentals are brands of the same company and are served by the same operations team.` },
      { p: 'These Terms & Conditions apply every time you use our website, app, phone line or WhatsApp to book a cab. Please read them together with the Trip Rules & Charges, Fare & Payment, Cancellation, Refund, Conduct, Safety and Privacy policies on this page. Together they are our full agreement with you.' },
      { p: 'By creating an account, making a booking or travelling on a booking made for you, you agree to these terms. If you do not agree, please do not use the service.' },

      { h: '2. Who drives you' },
      { p: 'We arrange trips with professional drivers. A driver may be one of our own driver partners or a driver from a fleet operator (vendor) who works with us. Every driver and vehicle must be approved by us before they can take a trip, with a valid driving licence, registration, insurance, permit and fitness certificate.' },
      { p: 'Once a driver is assigned, your booking shows the driver\'s name, the vehicle number and how to contact them.' },

      { h: '3. Your account' },
      {
        ul: [
          'You sign in with your mobile number and a one-time password (OTP). Keep your phone and OTPs private. Anything booked from your account is treated as booked by you.',
          'You must be at least 18 years old to create an account or make a booking. Children may travel with a responsible adult.',
          'Give your real name and a mobile number you can be reached on. We use these to confirm your trip and to put the driver in touch with you.',
          'You may book for someone else. Make sure you have their permission to share their name and mobile number with us and the driver.',
          'One account per person. Do not create accounts in someone else\'s name or use another person\'s account.',
        ],
      },

      { h: '4. How booking works' },
      {
        ol: [
          'Choose the service, pickup, drop (and stops, where allowed), date and time.',
          'Choose a vehicle. Each vehicle card shows the fare our system calculated for your exact route.',
          'On Review booking, check the trip details, the fare breakdown and the Trip Rules for your service, then accept the policies and submit.',
          'Your booking is now Pending. Our team checks the details and confirms it.',
          'When a driver is assigned, you receive the driver and vehicle details and a boarding OTP.',
          'At pickup, check the vehicle number, then share the OTP with the driver to start the trip.',
          'At the end of the trip, pay the driver as agreed and rate your trip.',
        ],
      },
      { p: `Bookings must be made at least ${SCHEDULE_MIN_LEAD_MIN} minutes before pickup, and no further ahead than the dates the date picker allows. Submitting a booking is a request: it is confirmed only when the booking status shows Confirmed or Assigned. We may decline a request (for example, when no suitable vehicle is free, the details are incomplete or the area is not served). A declined request costs you nothing.` },

      { h: '5. Our services' },
      {
        ul: [
          'One Way (drop) trips between cities.',
          'Round Trips, with optional stops on the way, ending back at your pickup.',
          'Airport transfers to and from airports.',
          'Hourly Rental: a car with a driver for a set number of hours within a city.',
          'Local Pickup & Drop inside one city.',
          'Multicity tours planned with our travel desk.',
          'Local Taxi: on-demand rides within the city, where available.',
        ],
      },
      { p: 'Every service comes with a driver. We do not rent self-drive cars. The rules and charges for each service are explained in Trip Rules & Charges.' },

      { h: '6. Fares' },
      {
        ul: [
          'Your fare is calculated by our booking system from the road distance of your route (measured with Google Maps), the service, the vehicle type, the date and time, and our current tariff.',
          'The fare shown on Review booking is the fare for that booking. It does not change later because we change our prices.',
          'GST is included in the total shown.',
          'Tolls, parking, state entry taxes and permits are not included. You pay them at actual cost (see Trip Rules & Charges).',
          'Extra kilometres, extra hours, extra days, waiting, hill station and roof carrier charges are added only when they happen on your trip, at the rates shown for your booking.',
          'A higher price shown crossed out above a fare is for comparison only. You pay the fare that is not crossed out.',
        ],
      },

      { h: '7. Changing your trip' },
      {
        ul: [
          'To change the pickup time, add or remove stops, extend hours or days, or change the destination, contact support before or during the trip. We will tell you the new fare before the change is made.',
          'The driver may not change the route, add charges or ask for extra money that is not shown in your booking. Report it to us if this happens.',
          'If you ask the driver for a detour, an extra stop or more time, the extra distance, time or days are charged at the rates shown for your booking.',
        ],
      },

      { h: '8. What we promise' },
      {
        ul: [
          'A clean, roadworthy, insured and permitted vehicle of the category you booked, with an approved driver.',
          'If we cannot provide the category you booked, we will tell you as early as we can and offer a similar or higher category at no extra cost, or let you cancel free of charge with a full refund of anything you paid.',
          'Clear fares, with every extra charge explained before or when it applies.',
          'Help from our support team before, during and after your trip.',
        ],
      },

      { h: '9. What we ask of you' },
      {
        ul: [
          'Give the correct pickup address and landmark, and be ready at the pickup point at the booked time.',
          'Keep your phone on so the driver can reach you.',
          'Travel within the seating and luggage capacity of the vehicle.',
          'Follow the Passenger Conduct rules: no smoking, alcohol or drugs, and respect for the driver.',
          'Never ask the driver to speed, overload the vehicle, skip rest breaks or break any traffic law.',
          'Pay the fare and any agreed extra charges.',
          'Do not use the service for anything unlawful.',
        ],
      },

      { h: '10. Delays and things outside our control' },
      { p: 'Travel times are estimates. Traffic, weather, road works, festivals, strikes, accidents, police checks or a vehicle breakdown can cause delays. If a vehicle breaks down, we will arrange a replacement as quickly as we reasonably can.' },
      { p: 'Please allow extra time for flights, trains, exams and events. We are not responsible for missed connections caused by delays outside our reasonable control.' },

      { h: '11. Damage and cleaning' },
      { p: 'If a passenger damages the vehicle or makes it unusually dirty (for example, spilled food or drink, vomiting or a broken fitting), you will be asked to pay the reasonable cost of cleaning or repair. We will show you photos and the bill or estimate before charging you.' },

      { h: '12. Our liability' },
      { p: 'If something goes wrong because of our fault, our liability for that trip is limited to the amount you paid for it. This does not limit any liability that the law does not allow us to limit, such as for death or personal injury caused by negligence, or your rights under the Consumer Protection Act, 2019.' },
      { p: 'We are not responsible for loss of belongings left in the vehicle, but we will always help you try to recover them (see Passenger Safety & Support).' },

      { h: '13. Suspending an account' },
      { p: 'We may suspend or close an account that is used for fraud, abuse or harassment of drivers or staff, fake bookings, or repeated non-payment. Where reasonable, we will tell you why and give you a chance to respond.' },

      { h: '14. Changes to these terms' },
      { p: 'We may update these policies when our service or the law changes. The date at the top of this page shows when they were last changed. If a change is important, we will ask you to read and accept the new version before your next booking.' },

      { h: '15. Law and disputes' },
      { p: 'These terms are governed by the laws of India. Please contact us first, so we can try to solve any problem quickly (see Complaints & Grievances). Subject to your right to approach a consumer commission, the courts at Theni, Tamil Nadu have jurisdiction.' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'trip-rules',
    short: [
      'The exact amounts for your trip (included km, extra-km rate, driver allowance, waiting rate and extras) are shown on Review booking before you confirm.',
      'Tolls, parking and state permits are paid at actual cost and are not part of the fare.',
      'Extra km, hours, days, waiting, hill station and roof carrier charges apply only when they happen.',
      'Your driver allowance covers the driver\'s food and stay. You do not need to arrange or pay for them.',
    ],
    blocks: [
      { h: 'Rules for every trip' },
      {
        ol: [
          'Amounts: every rate in these rules (minimum km, extra-km rate, driver allowance, waiting rate, hill and roof carrier charges) is shown for your vehicle on Review booking and in your booking details. Rates differ by service and vehicle type.',
          'Tolls, parking, state entry taxes and permits are not included in the fare. You can pay them directly, or repay the driver against the receipt.',
          'Driver allowance (bata) covers the driver\'s meals and night stay. It is included in outstation fares and charged per day on round trips. You do not have to provide food or a room for the driver.',
          'Waiting: a free waiting period applies at the pickup point and at each stop. After it, waiting is charged per hour at the rate shown for your vehicle. Please be ready on time to avoid waiting charges.',
          'Hill stations: trips to hill stations and ghat roads (for example Ooty, Kodaikanal, Yercaud, Munnar or Valparai) carry a fixed hill station charge per trip, at the amount shown for your vehicle.',
          'Roof carrier: if you need a roof carrier for extra luggage, ask when booking. A fixed roof carrier charge per trip applies, at the amount shown for your vehicle.',
          'Extra charges are recorded by the driver during the trip and checked by our office before you are billed for them. You can ask for details of any extra charge.',
          'Night travel: there is no separate night charge unless one appears in your fare breakdown.',
          'Route: the driver follows the normal road route for your trip. Detours, extra stops or sightseeing you ask for are charged at the extra-km rate.',
          'Air conditioning: all vehicles are air-conditioned. On steep ghat climbs the driver may switch the AC off for a short time to protect the engine.',
          'Rest breaks: on long drives the driver takes short breaks for safety. Please allow for them.',
          'Distance: kilometres are counted from your pickup point to your drop point, not from the driver\'s base.',
        ],
      },

      { h: 'One Way (drop) trips' },
      {
        ul: [
          'You pay for the road distance of your route, or the minimum kilometres for one-way trips, whichever is more. The minimum is shown on Review booking.',
          'The driver allowance is included.',
          'One pickup point and one drop point are included. Extra pickup or drop points are charged for the extra distance.',
          'Trips of 40 km or less inside one city are priced as Local Pickup & Drop instead (see below).',
          'Kilometres driven beyond the included distance, at your request, are charged at the extra-km rate.',
        ],
      },

      { h: 'Round Trips' },
      {
        ul: [
          'A round trip starts and ends at your pickup point, and can include up to 8 stops on the way.',
          'It is charged by calendar day (Indian time), counting both the start date and the return date. For example, leaving on Monday morning and returning on Tuesday night is 2 days. Returning after midnight adds one more day.',
          'You pay for the actual distance (out, through your stops and back), or the minimum km per day multiplied by the number of days, whichever is more.',
          'A driver allowance is charged for each day.',
          'The longest round trip you can book online is shown when you choose your return date. For longer trips, call us.',
          'If you travel more than the included kilometres, the extra kilometres are charged at the extra-km rate.',
        ],
      },

      { h: 'Airport transfers' },
      {
        ul: [
          'Airport fares are fixed packages with a set number of included kilometres. Extra kilometres are charged at the extra-km rate.',
          'Airport parking and entry fees are not included. They are paid at actual cost.',
          'For airport pickups, add your flight number so we can plan for delays. Waiting after the free period is charged at the waiting rate.',
          'Please allow plenty of time to reach the airport. We are not responsible for missed flights caused by traffic or delays outside our control.',
        ],
      },

      { h: 'Hourly Rental' },
      {
        ul: [
          'Choose a package of hours. Each package includes a set number of kilometres, shown on the vehicle card.',
          'Rental cars are for use within the city. For trips to another city, book a One Way or Round Trip.',
          'Time is counted from your pickup to the end of your trip.',
          'Extra hours and extra kilometres beyond the package are charged at the rates shown for your booking.',
          'Unused hours or kilometres are not refunded.',
        ],
      },

      { h: 'Local Pickup & Drop' },
      {
        ul: [
          'For trips of 40 km or less inside one city.',
          'You pay for the road distance, or the city\'s minimum kilometres, whichever is more, at the city rate shown.',
          'Waiting after the free period is charged at the waiting rate.',
        ],
      },

      { h: 'Multicity tours' },
      {
        ul: [
          'A multicity tour visits several cities on one trip. It is priced on the whole itinerary, with a minimum km per day and a driver allowance per day.',
          'Our travel desk reviews and confirms every multicity tour before it is accepted. The fare is confirmed to you before the trip.',
        ],
      },

      { h: 'Local Taxi (on-demand rides)' },
      {
        ul: [
          'The fare is shown before you request the ride.',
          'If the distance actually driven is different from the planned route (for example, because you changed the drop), the fare is worked out on the distance driven, up to a set limit above the quoted distance.',
          'Waiting after the free period is charged per minute, as shown in the app.',
          'Payment is made online in the app.',
          'The cancellation fee and the free cancellation time are shown in the app before you cancel.',
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'payment',
    short: [
      'No money is taken when you book. You pay your driver at the end of the trip, in cash or by UPI.',
      'Check that the amount matches your booking, and keep a receipt.',
      'Our staff and drivers will never ask for your UPI PIN, card PIN or OTP for a payment.',
    ],
    blocks: [
      { h: 'How to pay' },
      {
        ul: [
          'Book now, pay later: for standard bookings, no payment is taken when you book. You pay the driver at the end of the trip, in cash or by UPI.',
          'Before you pay by UPI, check that the name shown belongs to the driver or to us. Keep the payment screenshot or receipt.',
          'Every payment is recorded on your booking with the amount and method. Check the payment record in My trips.',
          'Local Taxi rides are paid online in the app through our payment partner (Razorpay). We never see or store your card details.',
          'For bookings made through our office or phone line, you may be asked to pay an advance by cash, UPI or bank transfer. Advances and balances are recorded with a receipt.',
          'Business accounts are billed under the agreement signed with the business.',
        ],
      },

      { h: 'What you pay for' },
      {
        ul: [
          'The fare shown on Review booking, including GST.',
          'Extras that happen on the trip: extra kilometres, extra hours or days, waiting, hill station and roof carrier charges, at the rates shown for your booking.',
          'Tolls, parking, state entry taxes and permits at actual cost.',
          'Any cancellation fee under the Cancellation Policy.',
        ],
      },

      { h: 'Offers and coupons' },
      {
        ul: [
          'Only one coupon can be used per booking.',
          'A coupon works only under its stated conditions (for example, the service, minimum fare, dates or first booking only).',
          'Coupons cannot be exchanged for cash, and cannot be added after a trip is completed.',
          'We may change or withdraw an offer at any time. This does not affect bookings already confirmed with that offer.',
        ],
      },

      { h: 'GST invoices' },
      { p: 'If you need a GST invoice for business use, ask support with your booking ID and your GSTIN before or soon after the trip.' },

      { h: 'Payment problems' },
      {
        ul: [
          'If you were charged twice, paid more than you should, or your payment failed but money left your account, contact support with your booking ID and the transaction reference.',
          'Do not pay again until support has checked a disputed or missing payment.',
          'Never share your UPI PIN, card PIN or any OTP with anyone. Our staff and drivers will never ask for them.',
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'cancellation',
    short: [
      `Scheduled booking: free to cancel while it is Pending, or more than ${FREE_CANCEL_WINDOW} before pickup. After that, ₹${SCHEDULED_CANCELLATION_FEE}.`,
      `Instant booking: free before a driver is assigned and for ${INSTANT_GRACE} after. After that, ₹${INSTANT_CANCELLATION_FEE}.`,
      'The app always shows the fee before you confirm a cancellation.',
      'If we cancel, or cannot provide your vehicle, you pay nothing and get back anything you paid.',
    ],
    blocks: [
      { h: 'How to cancel' },
      { p: 'Open My trips, choose the booking and tap Cancel. The app shows whether a fee applies before you confirm. For bookings made through our office, call support to cancel.' },

      { h: 'Scheduled bookings' },
      {
        ul: [
          'Free while the booking is still Pending (not yet confirmed).',
          `Free when pickup is more than ${FREE_CANCEL_WINDOW} away.`,
          `₹${SCHEDULED_CANCELLATION_FEE} when the booking is confirmed and pickup is ${FREE_CANCEL_WINDOW} away or less, because a driver is already committed to your trip.`,
        ],
      },

      { h: 'Instant bookings' },
      {
        ul: [
          'Free before a driver is assigned.',
          `Free for ${INSTANT_GRACE} after a driver is assigned.`,
          `₹${INSTANT_CANCELLATION_FEE} after that, because the driver is already on the way to you.`,
        ],
      },

      { h: 'Local Taxi rides' },
      { p: 'Free before a driver is assigned and for a short time after. After that, the cancellation fee shown in the app applies. The app shows the amount before you confirm.' },

      { h: 'Trips that have started' },
      { p: 'Once a trip has started (Ongoing), it cannot be cancelled in the app. If you need to end the trip early, tell the driver and call support. You pay for the distance and time used, under the Trip Rules for your service.' },

      { h: 'If you do not turn up' },
      { p: 'If you are not at the pickup point and cannot be reached by phone, the driver will wait and try to contact you. If you still cannot be reached, the booking may be cancelled as a no-show and the cancellation fee that applied at that time is charged.' },

      { h: 'If we cancel' },
      {
        ul: [
          'If we, the driver or the fleet operator cancel your booking, or we cannot provide your vehicle, you pay no cancellation fee and anything you paid is refunded in full.',
          'We will tell you as early as we can and try to arrange another vehicle.',
          'If a driver asks you to cancel the booking yourself, please do not. Call support instead, so no fee is charged to you by mistake.',
        ],
      },

      { h: 'Changing instead of cancelling' },
      { p: 'If your plans change, call support before cancelling. We may be able to change the pickup time or date for you, subject to availability. A change is confirmed only when we confirm it to you.' },

      { h: 'A fee you think is wrong' },
      { p: 'Contact support with your booking ID. We will check the booking history and remove any fee that was charged by mistake.' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'refund',
    short: [
      'A refund applies only to money you actually paid. Cancelling an unpaid booking costs nothing and needs no refund.',
      'You get back what you paid, minus any cancellation fee.',
      'Refunds go back to the way you paid, or another way we agree with you, with a reference number.',
    ],
    blocks: [
      { h: 'When you get a refund' },
      {
        ul: [
          'You cancel a booking you have already paid for (in full or as an advance).',
          'We cancel your booking, or cannot provide your vehicle.',
          'You were charged twice, paid too much, or paid for a service you did not receive.',
          'A payment failed but money was taken from your account.',
        ],
      },

      { h: 'How much you get back' },
      { p: 'The amount you paid, minus any cancellation fee that applied, and minus any part of the trip you already used. If we cancel, you get back everything you paid.' },

      { h: 'How a refund is paid' },
      {
        ol: [
          'Contact support with your booking ID, the amount, the payment method and the transaction reference or receipt.',
          'We check the payment and confirm the refund amount to you.',
          'We pay the refund back by the method you used, or another method we agree with you (for example, UPI or bank transfer). Online payments are refunded to the same card, UPI or account.',
          'You receive a refund reference, and the refund status appears on your booking: Pending, Processing, Completed, Failed or Rejected.',
        ],
      },

      { h: 'How long it takes' },
      { p: 'We aim to start an approved refund within 7 working days. Your bank may then take a few more working days to show the money in your account. A refund marked Pending or Processing is not yet in your account; if it is delayed, contact us with the refund reference.' },

      { h: 'Payments made to a driver' },
      { p: 'If you paid a driver or fleet operator directly, we first check the payment with them and the receipt. Keep your receipts and UPI screenshots.' },

      { h: 'If a refund fails or is rejected' },
      { p: 'If a refund fails, we will contact you to agree another way to pay it. If we reject a refund request, we will tell you why. You can ask us to review the decision under Complaints & Grievances.' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'conduct',
    short: [
      'No smoking, alcohol or drugs in the vehicle.',
      'Carry only the luggage the vehicle can hold safely. Ask for a roof carrier if you have extra.',
      'Pets travel only if you tell us in advance, the driver agrees, and the pet is in a carrier.',
      'The driver may refuse or stop a trip if safety is at risk.',
    ],
    blocks: [
      { h: 'In the vehicle' },
      {
        ul: [
          'No smoking (including e-cigarettes), alcohol or drugs inside the vehicle. Do not travel while drunk or under the influence.',
          'Everyone must wear a seat belt.',
          'The number of passengers may not be more than the seats in the vehicle, including children.',
          'Keep the vehicle clean. Light snacks are fine; please avoid messy or strong-smelling food.',
          'Be polite to the driver. Abuse, threats, harassment or violence are never acceptable and will be reported.',
          'Do not ask the driver to speed, overtake dangerously, skip rest breaks, carry extra passengers or break any law.',
        ],
      },

      { h: 'Luggage' },
      {
        ul: [
          'Carry only the luggage that fits safely in the boot of the vehicle you booked. Larger vehicles carry more.',
          'Luggage must be packed and secured properly. The driver may refuse luggage that is unsafe or overloads the vehicle.',
          'If you have extra luggage, ask for a roof carrier when you book. A roof carrier charge applies (see Trip Rules & Charges).',
          'You are responsible for your own belongings. Please check the vehicle before you leave it.',
        ],
      },

      { h: 'Items you cannot carry' },
      {
        ul: [
          'Explosives, fireworks, gas cylinders, fuel or other flammable items.',
          'Weapons and ammunition (unless legally carried with a valid licence and declared to the driver).',
          'Illegal drugs, contraband or stolen goods.',
          'Anything that is against the law, dangerous, or that smells strongly or could damage the vehicle.',
        ],
      },

      { h: 'Pets' },
      {
        ul: [
          'Tell us when you book (or call support) if you want to travel with a pet. We will check that the driver agrees.',
          'Pets must travel in a proper carrier or crate, or on a seat cover you provide.',
          'You are responsible for your pet\'s behaviour and for any cleaning or damage it causes.',
          'Assistance animals are welcome. Please tell us in advance so we can plan for them.',
        ],
      },

      { h: 'Children' },
      { p: 'Children must travel with a responsible adult. If you need a child seat, please bring your own. Every child counts as a passenger.' },

      { h: 'Accessibility' },
      { p: 'If you or a passenger need help getting in or out, a wheelchair, or extra space, tell us when you book. We will do our best to arrange a suitable vehicle.' },

      { h: 'When a driver may refuse or stop a trip' },
      { p: 'The driver may refuse to start a trip, or stop it in a safe place, if a passenger is drunk, abusive or violent, carries prohibited items, overloads the vehicle, or puts anyone\'s safety at risk. The driver must report this to us. In these cases a cancellation fee or the fare for the distance already travelled may be charged.' },

      { h: 'Laws and rules' },
      { p: 'All passengers must follow the law and any government rules that apply during travel, including state border checks and rules at airports, stations and tourist places.' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'safety',
    short: [
      'In an emergency, call 112 first.',
      'Before boarding, check that the vehicle number matches your booking. Share the OTP only after that.',
      'Use the Safety centre during a trip to share your trip or alert our team.',
    ],
    blocks: [
      { h: 'Before you board' },
      {
        ul: [
          'Check that the vehicle number and driver name match the details in your booking.',
          'Do not board a vehicle whose details do not match. Call support instead.',
          'Share the boarding OTP with the driver only after you have checked the vehicle and are ready to start.',
        ],
      },

      { h: 'During your trip' },
      {
        ul: [
          'Wear your seat belt at all times.',
          'Use Share trip in the Safety centre so a trusted person can follow your trip.',
          'Use SOS in the Safety centre to send your trip details and current location to our operations team.',
          'If you feel unsafe, ask the driver to stop in a busy, well-lit place and call us.',
          'For immediate danger, call the emergency number 112 first. Our support line is not an emergency service.',
        ],
      },

      { h: 'Accidents and breakdowns' },
      { p: 'If there is an accident, make sure everyone is safe, call 112 if anyone is hurt, and then call our support line. If the vehicle breaks down, we will arrange a replacement as quickly as we reasonably can.' },

      { h: 'Lost belongings' },
      { p: 'Check the vehicle before you leave. If you left something behind, contact support as soon as possible with your booking ID and a description. We will contact the driver and help you get it back. Return delivery costs, if any, are paid by you.' },

      { h: 'Getting help' },
      { p: `Call ${SUPPORT_PHONE_DISPLAY}, email ${SUPPORT_EMAIL} or open Support in the app. Keep your booking ID ready.` },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'privacy',
    short: [
      'We collect only what we need to run your bookings: your name, mobile number, trip details and payment records.',
      'Your details go to your assigned driver only for your trip. We never sell your data.',
      'Location is used only when you allow it, to set your pickup and keep you safe.',
      'You can ask to see, correct or delete your data at any time.',
    ],
    blocks: [
      { h: 'Who is responsible for your data' },
      { p: `${COMPANY_LEGAL_NAME}, ${ADDRESS}, decides how your personal data is used on ${BRAND} and our sister brands. This policy follows the Digital Personal Data Protection Act, 2023 and the Information Technology Act, 2000.` },

      { h: 'What we collect' },
      {
        ul: [
          'Account details: your name, mobile number, WhatsApp number and email (optional).',
          'Trip details: pickup, drop and stop locations, dates and times, passenger name and mobile number (if you book for someone else), flight number (optional) and trip notes.',
          'Payment records: amounts, methods, references and receipts. We do not store card or UPI PIN details.',
          'Location: your device location, only if you allow it.',
          'Safety and support: SOS alerts, support messages, ratings, reviews and complaints.',
          'Technical details: device and browser type, and sign-in records, used to keep your account secure.',
        ],
      },

      { h: 'Why we use it' },
      {
        ul: [
          'To create and run your bookings, assign a driver and keep you updated.',
          'To send booking confirmations, OTPs and trip updates by SMS, WhatsApp and email.',
          'To record payments, issue receipts and invoices, and process refunds.',
          'To keep passengers and drivers safe, handle SOS alerts, and prevent fraud and misuse.',
          'To answer your questions and complaints.',
          'To meet our legal and tax duties.',
        ],
      },

      { h: 'Location' },
      { p: 'If you allow it, your device location helps you set the pickup point. You can refuse and type an address instead. During a trip, the app may show the driver\'s location to you. An SOS alert sends your trip details and current location to our operations team. You can change location permission at any time in your browser or phone settings.' },

      { h: 'Who we share it with' },
      {
        ul: [
          'Your assigned driver and fleet operator: your name, pickup and drop details and a way to contact you, only for your trip.',
          'Our operations and support staff who need it to run your booking.',
          'Service providers who work for us: cloud hosting and sign-in (Google Firebase and Google Cloud), website hosting, maps (Google Maps), SMS, WhatsApp and email delivery, and online payments (Razorpay). They may use your data only to provide their service to us.',
          'Police or government authorities when the law requires it, or to protect someone\'s safety.',
        ],
      },
      { p: 'We never sell your personal data, and we do not share it for other companies\' advertising.' },

      { h: 'Booking for someone else' },
      { p: 'If you give us another person\'s name, mobile or WhatsApp number, make sure they agree. We use their details only for that trip.' },

      { h: 'How long we keep it' },
      { p: 'We keep your account details while your account is open. Booking, payment, invoice and tax records are kept for the period the law requires. Other data is deleted or anonymised when it is no longer needed.' },

      { h: 'Browser storage' },
      { p: 'We use your browser\'s storage to keep you signed in and to save an unfinished booking. We do not use advertising cookies. Clearing your browser storage may sign you out or remove an unfinished booking.' },

      { h: 'Your rights' },
      {
        ul: [
          'See the personal data we hold about you.',
          'Correct or update it.',
          'Ask us to delete it (see Account & Data Deletion).',
          'Withdraw consent for optional uses, such as location or WhatsApp updates.',
          'Complain to us, and then to the Data Protection Board of India if you are not satisfied.',
          'Name a person to use these rights for you if you die or cannot use them yourself.',
        ],
      },
      { p: `To use any of these rights, email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE_DISPLAY}. We may ask you to confirm your identity first.` },

      { h: 'Security' },
      { p: 'Your data is sent over encrypted connections. Access is limited to people who need it for their work, and important actions are logged. No system is perfectly secure; if a data breach affects you, we will tell you and the authorities as the law requires.' },

      { h: 'Children' },
      { p: 'Our service is for adults. We do not knowingly collect data from children, except a child passenger\'s name when an adult books for them.' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'deletion',
    short: [
      'You can ask us to delete your account at any time.',
      'Records the law requires us to keep (such as bookings, invoices and tax records) are kept for the required period, then deleted.',
    ],
    blocks: [
      { h: 'How to ask' },
      {
        ul: [
          'Signed in on the website: open Account and choose Delete my account.',
          'In the mobile app: Account, then Settings, then Delete my account.',
          `Cannot sign in: email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE_DISPLAY} from the mobile number on your account, and tell us that number.`,
        ],
      },

      { h: 'What happens next' },
      {
        ol: [
          'Your request is recorded. Nothing is deleted the moment you tap the button.',
          'Our team confirms the request with you by phone or email.',
          'We settle anything still open: upcoming bookings, unpaid amounts and refunds.',
          'We delete or anonymise your profile, saved places and contact details.',
        ],
      },
      { p: 'You can ask support to withdraw the request before it is processed. Once processed, the account cannot be restored.' },

      { h: 'What we keep' },
      { p: 'Bookings, invoices, payment and tax records, and records needed for a dispute or a legal claim are kept for the period the law requires. They are not used for marketing.' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'complaints',
    short: [
      'Contact support first. Most problems are solved the same day.',
      'We acknowledge every complaint within 48 hours and aim to resolve it within 30 days.',
      'If you are not satisfied, you can contact the National Consumer Helpline (1915).',
    ],
    blocks: [
      { h: 'How to complain' },
      {
        ol: [
          `Call ${SUPPORT_PHONE_DISPLAY}, email ${SUPPORT_EMAIL} or open Support in the app.`,
          'Give your booking ID, the date, what went wrong, and any receipts or photos.',
          'Ask for your complaint reference number.',
        ],
      },

      { h: 'Our promise' },
      {
        ul: [
          'We acknowledge every complaint within 48 hours.',
          'We aim to resolve it within 30 days, and keep you updated until it is closed.',
          'If we cannot agree, we explain our decision in writing.',
        ],
      },

      { h: 'Grievance Officer' },
      { p: `Grievance Officer, ${COMPANY_LEGAL_NAME}, ${ADDRESS}. Email: ${SUPPORT_EMAIL} (subject: "Grievance"). Phone: ${SUPPORT_PHONE_DISPLAY}.` },

      { h: 'If you are still not satisfied' },
      { p: 'You can contact the National Consumer Helpline on 1915 or at consumerhelpline.gov.in, or file a complaint with a consumer commission at edaakhil.nic.in. For privacy complaints, you can approach the Data Protection Board of India.' },
    ],
  },
];

export { BRAND, UPDATED, ADDRESS };

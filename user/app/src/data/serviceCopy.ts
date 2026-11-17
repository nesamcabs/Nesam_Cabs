// Front-screen service notes (Customer UX 9.0): one short line under each service's tabs, and a "Details" dialog that says what the
// service includes, what it does not, and which charges are extra. Shared by the app and the sites. The wording never states a
// price: the fares and rates always come from the server and are shown with each vehicle.

export type ServiceNoteKind = 'oneway' | 'roundtrip' | 'multicity' | 'local' | 'rental';

export interface ServiceCopy {
  /** The bold line of the note. */
  title: string;
  /** The grey line under it. */
  sub: string;
  /** The first paragraph of the Details dialog. */
  intro: string;
  /** Label + text rows of the Details dialog. A row labelled "Not included" is drawn with a minus mark. */
  items: readonly (readonly [label: string, text: string])[];
  /** The Details dialog's heading. */
  heading: string;
}

export const SERVICE_COPY: Record<ServiceNoteKind, ServiceCopy> = {
  oneway: {
    heading: 'One Way',
    title: 'Direct pickup & drop',
    sub: 'Tea / food breaks allowed · No local sightseeing',
    intro: 'A direct journey from your pickup to your drop.',
    items: [
      ['Included', 'One pickup, one drop, and tea / food breaks on your route.'],
      ['Not included', 'City sightseeing or unplanned local rides.'],
      ['Extra stops', 'Additional pickup / drop in the same city is charged separately.'],
      ['Other charges', 'Toll, parking and applicable state permit / entry tax are extra.'],
    ],
  },
  roundtrip: {
    heading: 'Round Trip',
    title: 'Round trip · Return to pickup city',
    sub: 'Your cab stays with you · Booked itinerary only',
    intro: 'Travel to your booked stops and return to your pickup city.',
    items: [
      ['Included', 'Your selected package distance, time and driver bata.'],
      ['Your route', 'Only the itinerary and stops confirmed in this booking.'],
      ['Time & distance', 'Package upgrades and extra kilometres follow the selected vehicle tariff.'],
      ['Morning Return', 'Complete by 9:00 AM next day. After the cutoff, Next-Day Return applies automatically.'],
      ['Other charges', 'Toll, parking and applicable state permit / entry tax are extra.'],
    ],
  },
  multicity: {
    heading: 'Multicity',
    title: 'Multiple cities · One booked route',
    sub: 'Stop at booked cities · No local sightseeing',
    intro: 'Book one cab through your chosen stop cities to your final drop.',
    items: [
      ['Included', 'Travel through the cities and stops in your confirmed itinerary.'],
      ['Not included', 'City sightseeing or unplanned local rides at stop cities.'],
      ['Waiting at stops', 'Waiting at a via-stop is charged separately. Travel time is not waiting time.'],
      ['Other charges', 'Extra pickup / drop, toll, parking and applicable state permit / entry tax are extra.'],
    ],
  },
  local: {
    heading: 'Pickup & Drop',
    title: 'Local pickup & drop',
    sub: 'Direct city ride · Now or Schedule',
    intro: 'A direct ride within the city of your pickup.',
    items: [
      ['Included', 'The base distance and estimated trip time shown with your vehicle.'],
      ['Not included', 'Sightseeing, stops on the way, and travel outside the city.'],
      ['Other charges', 'Extra distance or time, toll, parking and applicable permit charges are extra.'],
    ],
  },
  rental: {
    heading: 'Hourly Rental',
    title: 'Hourly city rental',
    sub: 'Multiple city stops · Now or Schedule',
    intro: 'Keep your cab for the hours you choose, from 1 to 15.',
    items: [
      ['Included', 'The package hours and kilometres shown with your vehicle.'],
      ['Extra usage', 'Hours or kilometres beyond your package are charged at the rates shown with your fare.'],
      ['Other charges', 'Toll, parking and applicable state entry tax are extra.'],
    ],
  },
};

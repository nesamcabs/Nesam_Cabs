import { db } from './admin';
/** Missing legacy preferences preserve delivery; an explicit off switch always wins. */
export async function channelEnabled(channel:'sms'|'email'|'whatsapp'|'push'):Promise<boolean> {
  const config=await db.doc('settings/config').get();
  return config.data()?.[`${channel}Enabled`]!==false;
}
// "Pay later" (pay the driver at the end of the trip) is controlled only by Service & Fare Settings › Payment options.
// The old "Allow Cash on Delivery" switch is retired: it silently blocked every pay-later booking.

import { db } from './admin';
/** Missing legacy preferences preserve delivery; an explicit off switch always wins. */
export async function channelEnabled(channel:'sms'|'email'|'whatsapp'|'push'):Promise<boolean> {
  const config=await db.doc('settings/config').get();
  return config.data()?.[`${channel}Enabled`]!==false;
}
export async function assertCashAllowed(method:unknown):Promise<void> {
  if(method!=='Cash')return;
  const config=await db.doc('settings/config').get();
  if(config.data()?.allowCod===false) {
    const {HttpsError}=await import('firebase-functions/v2/https');
    throw new HttpsError('failed-precondition','Cash payments are disabled. Choose an available non-cash payment method.');
  }
}

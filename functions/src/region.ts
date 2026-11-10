// Where the server functions run. This is the same city as the Firestore database (Mumbai, asia-south1), so every
// database read a quote or a booking makes stays in India, and a rider in India reaches the server in a few milliseconds.
//
// Imported first in index.ts: it must run before any function is defined. It applies to every function: callables,
// Firestore triggers (which have to run where the database is) and scheduled jobs.
import { setGlobalOptions } from 'firebase-functions/v2';

export const REGION = 'asia-south1';

/**
 * Web addresses that other companies call (the Razorpay payment webhook and the WhatsApp webhook) are registered in
 * those companies' dashboards with the old us-central1 address. They stay there so payments and WhatsApp keep working;
 * move them only together with a dashboard update.
 */
export const WEBHOOK_REGION = 'us-central1';

setGlobalOptions({ region: REGION });

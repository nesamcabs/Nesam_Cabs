import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { razorpayWebhook as handleWebhook } from './http/other';
import type { ApiRequest } from './http/util';

// Share signature verification and idempotent receipt processing with the Vercel API.
const webhookSecret = defineSecret('RAZORPAY_WEBHOOK_SECRET');
export const razorpayWebhook = onRequest({ secrets: [webhookSecret] }, async (req, res) => {
  await handleWebhook(req as unknown as ApiRequest, res);
});

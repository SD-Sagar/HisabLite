// Razorpay calls this when a payment is captured. It is the backup for verify-payment: if the
// shopkeeper's phone died or the app closed after paying, the plan still turns on.
// Deployed without JWT checking; Razorpay's signature proves the call is genuine.
import { admin, env, hmacHex, sameText } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const body = await req.text();
  const expected = await hmacHex(env('RAZORPAY_WEBHOOK_SECRET'), body);
  if (!sameText(expected, req.headers.get('x-razorpay-signature') ?? '')) {
    return new Response('bad signature', { status: 400 });
  }

  const event = JSON.parse(body);
  const payment = event?.payload?.payment?.entity;
  if ((event?.event === 'payment.captured' || event?.event === 'order.paid') && payment?.order_id) {
    const { error } = await admin().rpc('apply_payment', { p_order_id: payment.order_id, p_payment_id: payment.id });
    // payments for orders this app didn't make (the same Razorpay account used elsewhere) are not ours
    if (error && !/unknown order/.test(error.message)) {
      console.error(error);
      return new Response('try again', { status: 500 }); // Razorpay retries
    }
  }
  return new Response('ok');
});

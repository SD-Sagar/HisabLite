// Called by the app right after Razorpay's checkout succeeds: checks Razorpay's signature and
// turns the plan on. (razorpay-webhook does the same, in case the app closed mid-payment.)
import { admin, cors, env, hmacHex, json, sameText, shopFrom } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const shop = await shopFrom(req);
    if (!shop) return json({ error: 'not logged in' }, 401);
    const { orderId, paymentId, signature } = await req.json();
    if (!orderId || !paymentId || !signature) return json({ error: 'missing fields' }, 400);

    const expected = await hmacHex(env('RAZORPAY_KEY_SECRET'), `${orderId}|${paymentId}`);
    if (!sameText(expected, String(signature))) return json({ error: 'bad signature' }, 400);

    const db = admin();
    const { data: order } = await db.from('orders').select('shop_id').eq('id', orderId).maybeSingle();
    if (!order || order.shop_id !== shop) return json({ error: 'not your order' }, 403);

    const { data: paidUntil, error } = await db.rpc('apply_payment', { p_order_id: orderId, p_payment_id: paymentId });
    if (error) throw error;
    return json({ paidUntil });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

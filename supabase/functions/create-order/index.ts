// Starts a Razorpay payment for a plan. The price comes from the plans table, never from the app.
import { admin, cors, env, json, razorpayAuth, shopFrom } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const shop = await shopFrom(req);
    if (!shop) return json({ error: 'not logged in' }, 401);
    const { plan } = await req.json();
    const db = admin();
    const { data: p } = await db.from('plans').select('id, price').eq('id', plan).eq('active', true).maybeSingle();
    if (!p) return json({ error: 'unknown plan' }, 400);

    const amount = p.price * 100; // paise
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: razorpayAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, currency: 'INR', receipt: `el-${Date.now()}`, notes: { shop_id: shop, plan: p.id } }),
    });
    const order = await res.json();
    if (!res.ok) return json({ error: order?.error?.description ?? 'Razorpay refused the order' }, 502);

    const { error } = await db.from('orders').insert({ id: order.id, shop_id: shop, plan: p.id, amount });
    if (error) throw error;
    return json({ orderId: order.id, amount, keyId: env('RAZORPAY_KEY_ID') });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

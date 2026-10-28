// Not used yet: plans are paid by UPI and turned on by hand for now (see pay.ts). Once the
// Razorpay account is ready, deploy supabase/functions/{create-order,verify-payment,razorpay-webhook}
// and call buyPlan from the plans page.
import { refreshAccess } from './access';
import { supabase } from './cloud';
import type { Plan } from './pay';

interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void };
  }
}

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Razorpay checkout could not load'));
    document.head.appendChild(s);
  });
}

/**
 * Opens Razorpay for a plan. Resolves true once the payment is checked on the server and the
 * plan is on, false if the shopkeeper closed the payment window.
 */
export async function buyPlan(plan: Plan, opts: { phone: string; color: string; description: string }): Promise<boolean> {
  const sb = supabase!;
  const [{ data, error }] = await Promise.all([
    sb.functions.invoke<{ orderId: string; amount: number; keyId: string }>('create-order', { body: { plan: plan.id } }),
    loadCheckout(),
  ]);
  if (error || !data) throw error ?? new Error('no order');
  return new Promise((resolve, reject) => {
    const checkout = new window.Razorpay!({
      key: data.keyId,
      order_id: data.orderId,
      amount: data.amount,
      currency: 'INR',
      name: 'HisabLite',
      description: opts.description,
      prefill: { contact: opts.phone },
      theme: { color: opts.color },
      handler: async (r: RazorpayResponse) => {
        const { error: verifyError } = await sb.functions.invoke('verify-payment', {
          body: { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature },
        });
        if (verifyError) return reject(verifyError);
        await refreshAccess().catch(() => undefined);
        resolve(true);
      },
      modal: { ondismiss: () => resolve(false) },
    });
    checkout.open();
  });
}

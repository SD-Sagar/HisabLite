import { hasPremium, useAccess } from './access';
import type { BillBrand } from './bill';
import { usePayConfig } from './pay';
import { useSettings } from '../settings';

/**
 * The line at the bottom of a ফর্দ and of the WhatsApp message. A shop on a plan may turn it
 * off; for everyone else it stays, and it is how their customers hear about the app. `premium`
 * says whether the logo and the plan-only designs may be drawn.
 */
export function useBillBrand(): BillBrand & { premium: boolean } {
  const access = useAccess();
  const config = usePayConfig();
  const settings = useSettings();
  const premium = hasPremium(access);
  return { credit: !premium || (settings?.bill.credit ?? true), link: config.appLink, premium };
}

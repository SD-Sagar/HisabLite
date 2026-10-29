import { useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { refreshAccess, type PlanId } from './access';
import { supabase } from './cloud';

export interface Plan {
  id: PlanId;
  /** rupees */
  price: number;
  /** null = lifetime */
  months: number | null;
}

/** shown when the price list can't be fetched; the server always takes the price from its own table */
export const DEFAULT_PLANS: Plan[] = [
  { id: 'monthly', price: 299, months: 1 },
  { id: 'yearly', price: 1450, months: 12 },
  { id: 'lifetime', price: 5000, months: null },
];

/** Prices live in the plans table, so they can be changed from the Supabase dashboard. */
export async function fetchPlans(): Promise<Plan[]> {
  if (!supabase) return DEFAULT_PLANS;
  const { data, error } = await supabase.from('plans').select('id, price, months').eq('active', true).order('sort');
  return !error && data?.length ? (data as Plan[]) : DEFAULT_PLANS;
}

// ── paying by UPI, checked by hand ──

/** Where shopkeepers send the money, and the WhatsApp number they write to. Set on the অ্যাডমিন page. */
export interface PayConfig {
  upiId: string;
  upiName: string;
  /** digits with the country code */
  supportPhone: string;
  /** where to get the app; it goes on every free shop's ফর্দ and messages */
  appLink: string;
  /** khata photos a free shop may have read each month */
  freeScans: number;
  /** where the app is on the web, for the khata links customers open */
  webUrl: string;
}

const NO_CONFIG: PayConfig = { upiId: '', upiName: '', supportPhone: '', appLink: '', freeScans: 5, webUrl: '' };

/**
 * The EasyLedger owner's own number. Shopkeepers call or WhatsApp it for help whenever the
 * অ্যাডমিন page hasn't set another, so there is always someone to ask — even on the login screen,
 * offline, before the settings have ever come down.
 */
export const OWNER_PHONE = '917306454446';

/** Kept on the phone too, so the login screen can show the WhatsApp number offline. */
export async function fetchPayConfig(): Promise<PayConfig> {
  if (!supabase) return NO_CONFIG;
  const { data, error } = await supabase.from('app_config').select('upi_id, upi_name, support_phone, app_link, free_scans, web_url').maybeSingle();
  if (error) throw error;
  const value: PayConfig = {
    upiId: data?.upi_id ?? '', upiName: data?.upi_name ?? '', supportPhone: data?.support_phone ?? '', appLink: data?.app_link ?? '',
    freeScans: data?.free_scans ?? 5, webUrl: data?.web_url ?? '',
  };
  await db.kv.put({ key: 'payConfig', value });
  return value;
}

/** the fetch already on its way, so screens that open together ask the server once */
let fetching: Promise<unknown> | null = null;

/** The settings as the screens use them; the অ্যাডমিন page reads fetchPayConfig, so it shows only what is really saved. */
export function usePayConfig(): PayConfig {
  useEffect(() => {
    fetching ??= fetchPayConfig()
      .catch(() => undefined)
      .finally(() => (fetching = null));
  }, []);
  const stored = useLiveQuery(async () => (await db.kv.get('payConfig'))?.value as PayConfig | undefined);
  return useMemo(() => {
    const c = stored ?? NO_CONFIG;
    return c.supportPhone ? c : { ...c, supportPhone: OWNER_PHONE };
  }, [stored]);
}

export const isUpiId = (s: string) => /^[\w.-]{2,}@[a-zA-Z][\w.-]{1,}$/.test(s.trim());

/**
 * upi://pay link that opens GPay, PhonePe, Paytm or BHIM with the amount filled in. The note
 * carries the shop's number, so the owner can tell whose money it is.
 */
export function upiLink(c: PayConfig, amount: number, note: string) {
  // the UPI id goes in as it is: some apps don't read an escaped @
  return `upi://pay?pa=${c.upiId.trim()}&pn=${encodeURIComponent(c.upiName || 'Khatay-Kalomay')}&am=${amount}&cu=INR&tn=${encodeURIComponent(note)}`;
}

/** "I have paid": the owner sees it on the অ্যাডমিন page and turns the plan on. */
export async function requestPlan(plan: PlanId, utr: string) {
  const { error } = await supabase!.rpc('request_plan', { p_plan: plan, p_utr: utr.trim() });
  if (error) throw error;
  await refreshAccess();
}

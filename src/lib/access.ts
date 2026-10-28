import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { supabase } from './cloud';

export type PlanId = 'monthly' | 'yearly' | 'lifetime';

/** a UPI payment the shop told us about, as the owner last left it */
export interface PlanRequest {
  id: number;
  plan: PlanId;
  /** rupees */
  amount: number;
  utr: string;
  status: 'pending' | 'approved' | 'rejected';
  /** the owner's reason, when rejected */
  note: string;
  createdAt: string;
}

/** the shop's row from the server, kept on the phone so the plan is known offline too */
export interface ShopStatus {
  trialEndsAt: string;
  paidUntil: string | null;
  plan: string | null;
  serverNow: string;
  /** phone clock when serverNow was read */
  fetchedAt: number;
  request: PlanRequest | null;
  /** runs EasyLedger itself: checks payments on the অ্যাডমিন page */
  isAdmin: boolean;
  /** for admins, payments waiting to be checked */
  adminPending: number;
  /** khata photos read on our AI key this month, and how many a free shop gets */
  scans: { used: number; allowance: number };
  /** the owner has put the AI key on the server; undefined from a server that doesn't say */
  aiReady?: boolean;
}

export type Access =
  /** built without the cloud: no login, no plans, everything open */
  | { kind: 'local' }
  | { kind: 'loading' }
  /** the app as everyone gets it: the whole khata, free, with a few AI scans a month */
  | { kind: 'free' }
  | { kind: 'paid'; until: number; daysLeft: number; plan: PlanId | null }
  | { kind: 'lifetime' };

interface StatusRow {
  trial_ends_at: string;
  paid_until: string | null;
  plan: string | null;
  server_now: string;
  is_admin: boolean;
  admin_pending: number | null;
  scans: { used: number; allowance: number } | null;
  ai_ready?: boolean;
  request: { id: number; plan: PlanId; amount: number; utr: string; status: PlanRequest['status']; note: string; created_at: string } | null;
}

export async function refreshAccess() {
  if (!supabase) return;
  const { data: authData } = await supabase.auth.getUser();
  console.log('[DEBUG] Logged in auth user id:', authData.user?.id, 'phone:', authData.user?.phone);
  const { data, error } = await supabase.rpc('shop_status');
  console.log('[DEBUG] shop_status raw response:', data, 'error:', error);
  if (error) throw error;
  const row = data as StatusRow | null;
  if (!row) {
    console.log('[DEBUG] shop_status returned null/empty — not saving status');
    return;
  }
  const r = row.request;
  const value: ShopStatus = {
    trialEndsAt: row.trial_ends_at,
    paidUntil: row.paid_until,
    plan: row.plan,
    serverNow: row.server_now,
    fetchedAt: Date.now(),
    request: r && { id: r.id, plan: r.plan, amount: r.amount, utr: r.utr, status: r.status, note: r.note, createdAt: r.created_at },
    isAdmin: !!row.is_admin,
    adminPending: row.admin_pending ?? 0,
    scans: row.scans ?? { used: 0, allowance: 5 },
    aiReady: row.ai_ready,
  };
  console.log('[DEBUG] isAdmin value being saved:', value.isAdmin, '| full status:', value);
  await db.kv.put({ key: 'shopStatus', value });
}

const DAY = 86_400_000;
const time = (iso: string | null) => (iso === 'infinity' ? Infinity : iso ? Date.parse(iso) : -Infinity);

type PlanDates = Pick<ShopStatus, 'paidUntil' | 'plan' | 'serverNow' | 'fetchedAt'>;

export function accessFrom(s: PlanDates | null | undefined, now = Date.now()): Access {
  if (!supabase) return { kind: 'local' };
  if (!s) return { kind: 'loading' };
  // judged by the server's clock, so moving the phone's date back doesn't stretch a plan
  const serverNow = now + (Date.parse(s.serverNow) - s.fetchedAt);
  const paid = time(s.paidUntil);
  if (paid === Infinity) return { kind: 'lifetime' };
  if (paid > serverNow) return { kind: 'paid', until: paid, daysLeft: Math.ceil((paid - serverNow) / DAY), plan: s.plan as PlanId };
  return { kind: 'free' };
}

/** undefined while reading the phone, null before the server has ever answered */
export function useShopStatus(): ShopStatus | null | undefined {
  return useLiveQuery(async () => ((await db.kv.get('shopStatus'))?.value as ShopStatus | undefined) ?? null);
}

export function useAccess(): Access {
  return accessFrom(useShopStatus());
}

/** The extras: the shop's own WhatsApp wording, the logo, the plan-only ফর্দ designs, unlimited khata scans. */
export const hasPremium = (a: Access) => a.kind === 'paid' || a.kind === 'lifetime' || a.kind === 'local';

/**
 * Reading khata photos is still being worked on. Until this is true, shops see “শীঘ্রই আসছে” in
 * its place; only the people who run EasyLedger (and a copy built without the cloud) can use it.
 */
export const SCAN_OPEN_TO_ALL = false;

export const canScan = (s: ShopStatus | null | undefined) => SCAN_OPEN_TO_ALL || !supabase || !!s?.isAdmin;

/** Only a shop that has actually paid gets the gold badge. */
export const isPaid = (a: Access) => a.kind === 'paid' || a.kind === 'lifetime';

/** khata photos left this month on our AI key; Infinity for a shop on a plan */
export function scansLeft(s: ShopStatus | null | undefined, a: Access): number {
  if (hasPremium(a)) return Infinity;
  if (!s) return 0;
  return Math.max(0, s.scans.allowance - s.scans.used);
}

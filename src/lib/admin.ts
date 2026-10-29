// The অ্যাডমিন page's calls. The server checks that the caller is in the admins table; these
// fail for everyone else.
import { refreshAccess, type PlanId } from './access';
import { supabase } from './cloud';
import { fetchPayConfig, type PayConfig, type Plan } from './pay';

/** a UPI payment a shop says it made, waiting to be matched with the money */
export interface WaitingPayment {
  id: number;
  shopId: string;
  phone: string;
  shopName: string;
  plan: PlanId;
  amount: number;
  utr: string;
  createdAt: string;
}

export interface AdminShop {
  id: string;
  phone: string;
  shopName: string;
  createdAt: string;
  trialEndsAt: string;
  paidUntil: string | null;
  plan: string | null;
  /** has a payment waiting to be checked */
  waiting: boolean;
}

interface PaymentRow {
  id: number;
  shop_id: string;
  phone: string | null;
  shop_name: string;
  plan: PlanId;
  amount: number;
  utr: string;
  created_at: string;
}

interface ShopRow {
  id: string;
  phone: string | null;
  shop_name: string;
  created_at: string;
  trial_ends_at: string;
  paid_until: string | null;
  plan: string | null;
  waiting: boolean;
}

const sb = () => supabase!;

export async function waitingPayments(): Promise<WaitingPayment[]> {
  const { data, error } = await sb().rpc('admin_requests');
  if (error) throw error;
  return (data as PaymentRow[]).map((r) => ({
    id: r.id,
    shopId: r.shop_id,
    phone: r.phone ?? '',
    shopName: r.shop_name,
    plan: r.plan,
    amount: r.amount,
    utr: r.utr,
    createdAt: r.created_at,
  }));
}

export async function findShops(search: string): Promise<AdminShop[]> {
  const { data, error } = await sb().rpc('admin_shops', { p_search: search.trim() });
  if (error) throw error;
  return (data as ShopRow[]).map((r) => ({
    id: r.id,
    phone: r.phone ?? '',
    shopName: r.shop_name,
    createdAt: r.created_at,
    trialEndsAt: r.trial_ends_at,
    paidUntil: r.paid_until,
    plan: r.plan,
    waiting: r.waiting,
  }));
}

/** approve (the plan starts) or reject (the shopkeeper sees the note) a waiting payment */
export async function decide(id: number, approve: boolean, note = '') {
  const { error } = await sb().rpc('admin_decide', { p_request: id, p_approve: approve, p_note: note });
  if (error) throw error;
  await refreshAccess().catch(() => undefined);
}

/** a plan paid in cash or given free; returns the new end date ('infinity' for lifetime) */
export async function givePlan(shopId: string, plan: PlanId): Promise<string> {
  const { data, error } = await sb().rpc('admin_grant', { p_shop: shopId, p_plan: plan });
  if (error) throw error;
  await refreshAccess().catch(() => undefined);
  return data as string;
}

export async function revokePlan(shopId: string): Promise<void> {
  const { error } = await sb().rpc('admin_revoke', { p_shop: shopId });
  if (error) {
    await sb().from('shops').update({ paid_until: new Date().toISOString(), plan: null }).eq('id', shopId);
  }
  await refreshAccess().catch(() => undefined);
}

export async function setShopPassword(shopId: string, password: string) {
  const { error } = await sb().rpc('admin_set_password', { p_shop: shopId, p_password: password });
  if (error) throw error;
}

export async function savePayConfig(c: PayConfig) {
  const { error } = await sb().rpc('admin_save_config', {
    p_upi_id: c.upiId,
    p_upi_name: c.upiName,
    p_support_phone: c.supportPhone,
    p_app_link: c.appLink,
    p_free_scans: c.freeScans,
    p_web_url: c.webUrl,
  });
  if (error) throw error;
  await fetchPayConfig();
}

/** New prices, in rupees. They take effect for everyone at once; plans already paid for don't change. */
export async function savePlans(plans: Plan[]) {
  const { error } = await sb().rpc('admin_save_plans', { p_plans: plans.map((p) => ({ id: p.id, price: p.price })) });
  if (error) throw error;
}

/** What the অ্যাডমিন page is told about the AI key on the server: never the key itself. */
export interface AiKeyState {
  set: boolean;
  /** its last four letters, to tell one key from another */
  tail: string;
  /** a model the owner fixed for every shop; '' lets each phone choose */
  model: string;
  updatedAt: string | null;
}

export async function aiKeyState(): Promise<AiKeyState> {
  const { data, error } = await sb().rpc('admin_ai_key');
  if (error) throw error;
  const r = (data ?? {}) as { set?: boolean; tail?: string; model?: string; updated_at?: string | null };
  return { set: !!r.set, tail: r.tail ?? '', model: r.model ?? '', updatedAt: r.updated_at ?? null };
}

/** Puts the key every shop's scans are read with on the server ('' takes it off). */
export async function saveAiKey(key: string, model: string) {
  const { error } = await sb().rpc('admin_set_ai_key', { p_key: key.trim(), p_model: model });
  if (error) throw error;
  await refreshAccess().catch(() => undefined);
}

interface RemoteBackup {
  shop: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  customers: { id: string; name: string; phone: string; address: string; opening_balance: number; created_at: number; updated_at: number }[];
  txns: {
    id: string; customer_id: string; no: number | null; date: string; type: 'sale' | 'payment'; items: unknown[];
    total: number; paid: number; note: string; source: 'manual' | 'scan'; created_at: number; updated_at: number;
  }[];
}

/**
 * One shop's whole khata, from the cloud, as a backup file in the same shape the app itself
 * writes — so it can be read back with "ব্যাকআপ থেকে ফেরত আনুন" if it is ever needed.
 */
export async function shopBackup(shopId: string): Promise<Blob> {
  const { data, error } = await sb().rpc('admin_shop_backup', { p_shop: shopId });
  if (error) throw error;
  const r = data as RemoteBackup;
  const customers = r.customers.map((c, i) => ({
    id: i + 1,
    uid: c.id,
    name: c.name,
    phone: c.phone ?? '',
    address: c.address ?? '',
    openingBalance: Number(c.opening_balance),
    createdAt: Number(c.created_at),
    updatedAt: Number(c.updated_at),
  }));
  const localId = new Map(customers.map((c) => [c.uid, c.id]));
  const txns = r.txns
    .filter((x) => localId.has(x.customer_id))
    .map((x, i) => ({
      id: i + 1,
      uid: x.id,
      no: x.no ?? undefined,
      customerId: localId.get(x.customer_id)!,
      date: x.date,
      type: x.type,
      items: x.items ?? [],
      total: Number(x.total),
      paid: Number(x.paid),
      note: x.note ?? '',
      source: x.source,
      createdAt: Number(x.created_at),
      updatedAt: Number(x.updated_at),
    }));
  const file = { app: 'khatay-kalomay', version: 1, exportedAt: new Date().toISOString(), shop: r.shop, customers, txns, settings: r.settings ?? {} };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

/** six random digits: easy to read out or type, and the shopkeeper can change it later */
export function tempPassword() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 900_000;
  return String(100_000 + n);
}

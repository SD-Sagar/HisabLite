import type { LineItem } from '../db';
import { supabase } from './cloud';
import { fetchPayConfig } from './pay';

/** One customer's khata as their own phone sees it — no login, read only. */
export interface KhataView {
  shop: { name: string; phone: string };
  customer: { name: string };
  /** what the paper khata already said when this customer was written down */
  opening: number;
  balance: number;
  entries: {
    date: string;
    type: 'sale' | 'payment';
    no: number | null;
    items: LineItem[];
    total: number;
    paid: number;
    note: string;
  }[];
  as_of: string;
}

/** The shop asks for a customer's link (a plan is checked on the server). Returns the whole address. */
export async function shareKhata(customerUid: string): Promise<string> {
  const { data, error } = await supabase!.rpc('share_khata', { p_customer: customerUid });
  if (error) throw error;
  const config = await fetchPayConfig().catch(() => null);
  // where the app lives on the web; inside the Android app the page's own address is no use
  const base = config?.webUrl || `${location.origin}${location.pathname}`;
  return `${base.replace(/\/+$/, '')}/#/k/${data as string}`;
}

export async function stopSharing(customerUid: string) {
  const { error } = await supabase!.rpc('stop_sharing', { p_customer: customerUid });
  if (error) throw error;
}

/** What the customer's phone loads. null when the link was taken back or never existed. */
export async function fetchKhataView(token: string): Promise<KhataView | null> {
  const { data, error } = await supabase!.rpc('khata_view', { p_token: token });
  if (error) throw error;
  return (data as KhataView | null) ?? null;
}

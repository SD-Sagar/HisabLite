import type { Lang } from '../i18n';
import { supabase } from './cloud';
import { fetchPayConfig } from './pay';

/**
 * A ফর্দ sent as a link. A web page cannot drop a picture into one customer's WhatsApp chat, but
 * it can open that chat with a message in it — so the picture goes to the cloud and the message
 * carries its link. WhatsApp shows the ফর্দ as the link's preview, and a tap opens it full size on
 * the app's own site, where the customer also sees where it came from.
 *
 * Files live in the public "bills" bucket as <token>.png (the ফর্দ) and <token>-og.jpg (the small
 * card WhatsApp shows). The token is 22 random letters, so a link can't be guessed.
 */
export const BILL_BUCKET = 'bills';

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const canLinkBills = () => !!supabase;

/** The picture's address in cloud storage. */
export function billImageUrl(token: string, kind: 'bill' | 'card' = 'bill') {
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${BILL_BUCKET}/${token}${kind === 'card' ? '-og.jpg' : '.png'}`;
}

/** Puts the ফর্দ and its preview card in the cloud; returns the link to send. */
export async function publishBill(bill: Blob, card: Blob, lang: Lang): Promise<string> {
  const token = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const store = supabase!.storage.from(BILL_BUCKET);
  const [a, b] = await Promise.all([
    store.upload(`${token}.png`, bill, { contentType: 'image/png', cacheControl: '31536000', upsert: false }),
    store.upload(`${token}-og.jpg`, card, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false }),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  const config = await fetchPayConfig().catch(() => null);
  const web = config?.webUrl?.replace(/\/+$/, '');
  const langPart = lang === 'bn' ? '' : `?l=${lang}`;
  // on the app's web address the link shows the ফর্দ as its preview (api/f.js); without one set,
  // the page this phone is on still opens it
  return web ? `${web}/f/${token}${langPart}` : `${location.origin}${location.pathname}#/f/${token}${langPart}`;
}

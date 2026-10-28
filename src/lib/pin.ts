import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';

/**
 * The app's own PIN, kept on this phone only (like the phone's screen lock). Only a salted hash
 * is stored. Four digits can't stop someone who can take the phone's storage apart; what it
 * stops is anyone picking the phone up off the counter and opening the khata.
 */
export interface PinRecord {
  salt: string;
  hash: string;
}

export const PIN_LENGTH = 4;

const KEY = 'pin';

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** cyrb53, twice: for a phone reached over plain http, where the browser offers no SHA-256 */
function looseHash(text: string): string {
  const one = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
  };
  return one(1) + one(2);
}

async function digest(text: string): Promise<string> {
  if (!crypto.subtle) return looseHash(text);
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

export async function setPin(pin: string) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  await db.kv.put({ key: KEY, value: { salt, hash: await digest(`${salt}:${pin}`) } satisfies PinRecord });
}

export async function checkPin(pin: string): Promise<boolean> {
  const rec = (await db.kv.get(KEY))?.value as PinRecord | undefined;
  return !!rec && (await digest(`${rec.salt}:${pin}`)) === rec.hash;
}

export const clearPin = () => db.kv.delete(KEY);

/** undefined while reading the phone; null when no PIN is set */
export function usePin(): PinRecord | null | undefined {
  return useLiveQuery(async () => ((await db.kv.get(KEY))?.value as PinRecord | undefined) ?? null);
}

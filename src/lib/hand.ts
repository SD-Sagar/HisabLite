import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';

const KEY = 'handSample';

/**
 * One page of this shop's khata that the owner already checked, kept as an example of their
 * own handwriting. It goes with every later photo so the AI can see how this hand writes its
 * digits and names instead of guessing afresh each time.
 *
 * It stays on this phone only: it is a photo, too heavy to push through settings sync.
 */
export interface HandSample {
  /** JPEG, base64 without the data: prefix */
  base64: string;
  /** what the page really says, written out from the entries the owner saved */
  text: string;
  savedAt: number;
}

export const sampleUrl = (s: HandSample) => `data:image/jpeg;base64,${s.base64}`;

export async function getHandSample(): Promise<HandSample | null> {
  const row = await db.kv.get(KEY);
  return (row?.value as HandSample | undefined) ?? null;
}

export const saveHandSample = (s: HandSample) => db.kv.put({ key: KEY, value: s });

export const clearHandSample = () => db.kv.delete(KEY);

/** undefined while loading, null when the shop has not kept a page yet */
export const useHandSample = () => useLiveQuery(getHandSample);

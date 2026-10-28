import { db, deleteCustomers, type Customer } from '../db';

/**
 * Customers that came in together. Everyone brought in by one import shares the moment they
 * were written, so a bad import can be taken back in one go — which matters when a file turns
 * out to hold ten thousand lines that were never customers.
 */
export interface ImportBatch {
  /** the moment they were all added */
  at: number;
  /** the ones with nothing in their khata: safe to remove */
  ids: number[];
  /** how many of the batch have entries, so they are kept */
  used: number;
}

/** Only a group this big can be an import; two customers added by hand are not. */
const LEAST = 5;

export async function importBatches(): Promise<ImportBatch[]> {
  const [customers, txns] = await Promise.all([db.customers.toArray(), db.txns.toArray()]);
  const busy = new Set(txns.map((t) => t.customerId));
  const groups = new Map<number, Customer[]>();
  for (const c of customers) {
    const at = c.createdAt;
    groups.set(at, [...(groups.get(at) ?? []), c]);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length >= LEAST)
    .map(([at, list]) => ({
      at,
      ids: list.filter((c) => !busy.has(c.id)).map((c) => c.id),
      used: list.filter((c) => busy.has(c.id)).length,
    }))
    .filter((b) => b.ids.length)
    .sort((a, b) => b.at - a.at);
}

/** Takes one import back. Returns how many were removed. */
export const undoImport = (batch: ImportBatch) => deleteCustomers(batch.ids);

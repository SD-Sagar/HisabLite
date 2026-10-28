import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { balances, byChronology, db, type Customer, type Txn } from '../db';
import { useT } from '../i18n';

export interface CustomerRow extends Customer {
  balance: number;
  lastDate: string | null;
}

export interface Ledger {
  customers: CustomerRow[];
  txns: Txn[];
}

async function loadLedger(): Promise<Ledger> {
  const [customers, txns] = await Promise.all([db.customers.toArray(), db.txns.toArray()]);
  const bal = balances(customers, txns);
  const last = new Map<number, string>();
  for (const t of txns) if ((last.get(t.customerId) ?? '') < t.date) last.set(t.customerId, t.date);
  return {
    customers: customers.map((c) => ({ ...c, balance: bal.get(c.id) ?? 0, lastDate: last.get(c.id) ?? null })),
    txns,
  };
}

const LedgerContext = createContext<Ledger | undefined>(undefined);

/**
 * One live copy of the khata for every screen. Each screen used to read the whole database for
 * itself when it opened, so with a few hundred customers a page came up empty and filled in
 * seconds later; now the numbers are already there when a page opens.
 */
export function LedgerProvider({ children }: { children: ReactNode }) {
  const ledger = useLiveQuery(loadLedger);
  return createElement(LedgerContext.Provider, { value: ledger }, children);
}

/** All customers with their live বাকি. undefined while loading. */
export const useLedger = () => useContext(LedgerContext);

export interface ItemCatalog {
  names: string[];
  units: string[];
  /** last used unit and rate per item name */
  last: Map<string, { unit: string; rate: number }>;
}

/**
 * Item names — the ones sold most often first, then the common fruits in the app's
 * language — with the most recent unit/rate used for each, and every unit in use.
 */
export function useItemCatalog(): ItemCatalog {
  const t = useT();
  const txns = useLedger()?.txns;
  return useMemo(() => {
    const last = new Map<string, { unit: string; rate: number }>();
    const times = new Map<string, number>();
    const units = new Set<string>();
    for (const txn of [...(txns ?? [])].sort(byChronology)) {
      for (const it of txn.items) {
        const name = it.name.trim();
        if (!name) continue;
        last.set(name, { unit: it.unit, rate: it.rate });
        times.set(name, (times.get(name) ?? 0) + 1);
        if (it.unit.trim()) units.add(it.unit.trim());
      }
    }
    const sold = [...times.keys()].sort((a, b) => times.get(b)! - times.get(a)!);
    return {
      names: [...new Set([...sold, ...t.fruits])],
      units: [...new Set([...t.units, ...units])],
      last,
    };
  }, [txns, t]);
}

/** One customer's own entries, oldest first. */
export function useCustomerTxns(customerId: number | null | undefined): Txn[] {
  const txns = useLedger()?.txns;
  return useMemo(
    () => (customerId ? (txns ?? []).filter((x) => x.customerId === customerId).sort(byChronology) : []),
    [txns, customerId],
  );
}

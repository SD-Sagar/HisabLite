import Dexie, { type EntityTable, type Table } from 'dexie';

export interface LineItem {
  name: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
}

export type TxnType = 'sale' | 'payment';

/**
 * Every row synced to the cloud carries a uid that is the same on every phone (the local
 * numeric id is not), and dirty = 1 until the cloud has the latest version of it.
 */
interface Synced {
  uid: string;
  dirty: 0 | 1;
}

export interface Customer extends Synced {
  id: number;
  name: string;
  phone: string;
  address: string;
  /** বাকি carried over from the paper khata when the customer was added */
  openingBalance: number;
  createdAt: number;
  updatedAt: number;
}

export interface Txn extends Synced {
  id: number;
  /** number printed on the ফর্দ / রসিদ; kept the same on every phone */
  no?: number;
  customerId: number;
  /** YYYY-MM-DD, local date */
  date: string;
  type: TxnType;
  items: LineItem[];
  /** value of goods given (0 for a pure payment) */
  total: number;
  /** cash received with this entry */
  paid: number;
  note: string;
  source: 'manual' | 'scan';
  /** photo of the khata page this entry was read from */
  imageId?: number;
  createdAt: number;
  updatedAt: number;
}

export interface StoredImage {
  id: number;
  uid: string;
  /** null for a photo taken on another phone that hasn't been downloaded yet */
  blob: Blob | null;
  /** 1 once the photo is in cloud storage */
  uploaded: 0 | 1;
  createdAt: number;
}

/** a row deleted on this phone, waiting to be deleted in the cloud too */
export interface Tombstone {
  id: number;
  table: 'customers' | 'txns';
  uid: string;
}

interface KV {
  key: string;
  value: unknown;
}

/** set on a transaction that writes rows exactly as the cloud has them */
export interface FromCloud {
  fromCloud?: boolean;
}

/** New rows may leave out the sync fields; they are filled in on the way into the database. */
export type NewRow<T extends Synced & { id: number }> = Omit<T, 'id' | 'uid' | 'dirty'> & Partial<Synced>;

/** RFC 4122 v4. crypto.randomUUID only exists on https/localhost; this also works over plain http on the shop Wi-Fi. */
export function uuid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

class LedgerDB extends Dexie {
  customers!: EntityTable<Customer, 'id'>;
  txns!: EntityTable<Txn, 'id'>;
  images!: EntityTable<StoredImage, 'id'>;
  tombstones!: EntityTable<Tombstone, 'id'>;
  kv!: EntityTable<KV, 'key'>;

  constructor() {
    super('easyledger');
    this.version(1).stores({
      customers: '++id, name, phone',
      txns: '++id, customerId, date, [customerId+date]',
      images: '++id',
      kv: 'key',
    });
    this.version(2)
      .stores({
        customers: '++id, name, phone, &uid, dirty',
        txns: '++id, customerId, date, [customerId+date], &uid, dirty, no',
        images: '++id, &uid, uploaded',
        tombstones: '++id',
      })
      .upgrade(async (tx) => {
        // everything written before sync existed goes up on the first login
        await tx.table('customers').toCollection().modify((c) => Object.assign(c, { uid: uuid(), dirty: 1 }));
        await tx.table('txns').toCollection().modify((t) => Object.assign(t, { uid: uuid(), dirty: 1, no: t.id }));
        await tx.table('images').toCollection().modify((i) => Object.assign(i, { uid: uuid(), uploaded: 0 }));
      });

    // Any change made on this phone marks the row for upload. Rows written by the sync itself
    // always say dirty: 0 explicitly, which is how the two are told apart. (An update only shows
    // the fields that really changed, so a transaction applying the cloud's rows is marked too:
    // otherwise a row already at dirty 0 would be sent straight back up.)
    for (const table of [this.customers, this.txns] as Table<Synced>[]) {
      table.hook('creating', (_key, obj) => {
        obj.uid ||= uuid();
        if (obj.dirty === undefined) obj.dirty = 1;
      });
      table.hook('updating', (mods, _key, _obj, tx) =>
        'dirty' in mods || (tx as FromCloud).fromCloud ? undefined : { dirty: 1 },
      );
    }
    this.images.hook('creating', (_key, obj) => {
      obj.uid ||= uuid();
      if (obj.uploaded === undefined) obj.uploaded = 0;
    });
  }
}

export const db = new LedgerDB();

/** How much an entry changes the customer's বাকি. Positive = customer owes more. */
export const txnEffect = (t: Pick<Txn, 'total' | 'paid'>) => t.total - t.paid;

export const byChronology = (a: Txn, b: Txn) =>
  a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id - b.id;

/** The number shown on the ফর্দ. */
export const billNo = (t: Pick<Txn, 'id' | 'no'>) => t.no ?? t.id;

/** Next ফর্দ number; call inside the transaction that adds the entry. */
export async function nextBillNo() {
  const last = await db.txns.orderBy('no').last();
  return (last?.no ?? 0) + 1;
}

// uid and dirty are filled in by the hooks above
export const addCustomer = (c: NewRow<Customer>) => db.customers.add(c as Customer);
export const addTxn = (t: NewRow<Txn>) => db.txns.add(t as Txn);
export const addImage = (blob: Blob, createdAt: number) => db.images.add({ blob, createdAt } as StoredImage);

/*
 * নগদ বিক্রি: goods sold to someone with no khata, paid for on the spot. They are kept under one
 * hidden customer, so they count in the day's sales and cash while nobody's বাকি moves. That
 * customer is told apart by its uid: a version-8 UUID, where every real customer's is version 4.
 * It is made from the shop's own id, so each phone of the shop arrives at the same one and the
 * cloud keeps a single cash customer however many phones sold for cash before they synced.
 */
export const isCashCustomer = (c: Pick<Customer, 'uid'>) => c.uid.charAt(14) === '8';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The cash customer's local id, adding it the first time a cash sale is written. */
export async function cashCustomerId(shopId: string | null, name: string): Promise<number> {
  return db.transaction('rw', db.customers, async () => {
    const existing = await db.customers.filter(isCashCustomer).first();
    if (existing) return existing.id;
    // without a login there is no shop id; any version-8 id serves on a phone of its own
    const base = shopId && UUID.test(shopId) ? shopId.toLowerCase() : uuid();
    const now = Date.now();
    return addCustomer({
      uid: `${base.slice(0, 14)}8${base.slice(15)}`,
      name,
      phone: '',
      address: '',
      openingBalance: 0,
      createdAt: now,
      updatedAt: now,
    });
  });
}

export interface TxnWithBalance extends Txn {
  /** বাকি just before this entry */
  before: number;
  /** বাকি right after this entry */
  after: number;
}

/** Oldest first, each entry annotated with the running বাকি. */
export function withRunningBalance(customer: Customer, txns: Txn[]): TxnWithBalance[] {
  let bal = customer.openingBalance;
  return [...txns].sort(byChronology).map((t) => {
    const before = bal;
    bal += txnEffect(t);
    return { ...t, before, after: bal };
  });
}

export function balances(customers: Customer[], txns: Txn[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const c of customers) map.set(c.id, c.openingBalance);
  for (const t of txns) map.set(t.customerId, (map.get(t.customerId) ?? 0) + txnEffect(t));
  return map;
}

/** Balance of one customer just before and after a given entry. */
export async function balanceAround(txn: Txn): Promise<{ before: number; after: number }> {
  const customer = await db.customers.get(txn.customerId);
  const txns = await db.txns.where('customerId').equals(txn.customerId).toArray();
  if (!customer) return { before: 0, after: txnEffect(txn) };
  const row = withRunningBalance(customer, txns).find((t) => t.id === txn.id);
  return row ? { before: row.before, after: row.after } : { before: 0, after: txnEffect(txn) };
}

export async function deleteTxn(txn: Txn) {
  await db.transaction('rw', db.txns, db.tombstones, async () => {
    await db.txns.delete(txn.id);
    await db.tombstones.add({ table: 'txns', uid: txn.uid } as Tombstone);
  });
}

export async function deleteCustomer(id: number) {
  await db.transaction('rw', db.customers, db.txns, db.tombstones, async () => {
    const customer = await db.customers.get(id);
    const txns = await db.txns.where('customerId').equals(id).toArray();
    await db.tombstones.bulkAdd([
      ...txns.map((t) => ({ table: 'txns', uid: t.uid }) as Tombstone),
      ...(customer ? [{ table: 'customers', uid: customer.uid } as Tombstone] : []),
    ]);
    await db.txns.bulkDelete(txns.map((t) => t.id));
    await db.customers.delete(id);
  });
}

/**
 * Removes many customers at once, with their entries — for undoing an import that brought in
 * rows that were never customers. Tombstones go with them, so every phone and the cloud follow.
 */
export async function deleteCustomers(ids: number[]): Promise<number> {
  return db.transaction('rw', db.customers, db.txns, db.tombstones, async () => {
    const customers = (await db.customers.bulkGet(ids)).filter((c): c is Customer => !!c);
    const txns = await db.txns.where('customerId').anyOf(ids).toArray();
    await db.tombstones.bulkAdd([
      ...txns.map((t) => ({ table: 'txns', uid: t.uid }) as Tombstone),
      ...customers.map((c) => ({ table: 'customers', uid: c.uid }) as Tombstone),
    ]);
    await db.txns.bulkDelete(txns.map((t) => t.id));
    await db.customers.bulkDelete(customers.map((c) => c.id));
    return customers.length;
  });
}

/** Empties the khata on this phone (after logging out, or before another shop's data comes in). */
export async function wipeLocalData() {
  await db.transaction('rw', [db.customers, db.txns, db.images, db.tombstones, db.kv], async () => {
    await Promise.all([db.customers.clear(), db.txns.clear(), db.images.clear(), db.tombstones.clear()]);
    await db.kv.bulkDelete(['sync', 'shopStatus', 'settingsSync', 'handSample', 'pin']);
  });
}

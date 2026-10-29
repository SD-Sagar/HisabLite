import { balances, db, isCashCustomer, uuid, type Customer, type Tombstone, type Txn } from '../db';
import { tr } from '../i18n';
import { getSettings, saveSettings, withoutKeys, type Settings, type SharedSettings } from '../settings';

interface BackupFile {
  app: 'khatay-kalomay' | 'hisablite' | 'easyledger';
  version: 1;
  exportedAt: string;
  /** files made before cloud sync have no uid / no / dirty */
  customers: (Omit<Customer, 'uid' | 'dirty'> & Partial<Customer>)[];
  txns: (Omit<Txn, 'uid' | 'dirty'> & Partial<Txn>)[];
  settings: SharedSettings;
}

/** JSON backup of customers, entries and settings. Photos and API keys are left out. */
export async function exportBackup(): Promise<Blob> {
  const data: BackupFile = {
    app: 'khatay-kalomay',
    version: 1,
    exportedAt: new Date().toISOString(),
    customers: (await db.customers.toArray()).map(({ dirty: _d, ...c }) => c),
    txns: (await db.txns.toArray()).map(({ imageId: _img, dirty: _d, ...t }) => t),
    settings: withoutKeys(await getSettings()),
  };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

/**
 * Replaces the whole khata with the backup, and keeps the current API keys. With cloud sync
 * on, every phone of the shop follows: the old rows are deleted in the cloud and the backup's
 * rows go up as the newest version.
 */
export async function importBackup(file: File): Promise<{ customers: number; txns: number }> {
  let data: BackupFile;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error(tr().backup.cantRead);
  }
  if ((data?.app !== 'khatay-kalomay' && data?.app !== 'hisablite' && data?.app !== 'easyledger') || !Array.isArray(data.customers) || !Array.isArray(data.txns)) {
    throw new Error(tr().backup.notBackup);
  }
  const { apiKey, geminiApiKey } = await getSettings();
  const now = Date.now();
  await db.transaction('rw', [db.customers, db.txns, db.images, db.tombstones, db.kv], async () => {
    const keep = new Set([...data.customers, ...data.txns].map((r) => r.uid).filter(Boolean));
    const gone = [
      ...(await db.customers.toArray()).map((c) => ({ table: 'customers', uid: c.uid })),
      ...(await db.txns.toArray()).map((t) => ({ table: 'txns', uid: t.uid })),
    ].filter((r) => !keep.has(r.uid)) as Tombstone[];
    await Promise.all([db.customers.clear(), db.txns.clear(), db.images.clear()]);
    await db.tombstones.bulkAdd(gone);
    await db.customers.bulkAdd(data.customers.map((c) => ({ ...c, uid: c.uid || uuid(), updatedAt: now, dirty: 1 })));
    await db.txns.bulkAdd(data.txns.map((t) => ({ ...t, uid: t.uid || uuid(), no: t.no ?? t.id, updatedAt: now, dirty: 1 })));
    if (data.settings) await saveSettings({ ...(data.settings as Settings), apiKey, geminiApiKey });
  });
  return { customers: data.customers.length, txns: data.txns.length };
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Customer list with current বাকি — opens in Excel / Google Sheets. */
export async function exportCustomersCsv(): Promise<Blob> {
  const [customers, txns] = await Promise.all([db.customers.toArray(), db.txns.toArray()]);
  const bal = balances(customers, txns);
  const lines = [
    tr().backup.csvHeaders,
    ...customers
      .filter((c) => !isCashCustomer(c))
      .map((c) => [c.name, c.phone, c.address, Math.round((bal.get(c.id) ?? 0) * 100) / 100]),
  ].map((row) => row.map(csvCell).join(','));
  // BOM so Excel reads Bengali/Hindi correctly
  return new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
}

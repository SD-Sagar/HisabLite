import { useSyncExternalStore } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { liveQuery } from 'dexie';
import { toast } from '../components/ui';
import { db, wipeLocalData, type Customer, type FromCloud, type LineItem, type StoredImage, type Txn, type TxnType } from '../db';
import { applyCloudSettings, getSettings, withoutKeys, type SettingsSync, type SharedSettings } from '../settings';
import { refreshAccess } from './access';
import { PHOTO_BUCKET, supabase } from './cloud';

/*
 * Offline-first sync. The phone's own database stays the one the app reads and writes, so
 * nothing waits for the internet. Rows changed here carry dirty = 1 and go up in the
 * background; rows changed on other phones come down by the time the server stored them.
 * The newer updated_at wins, on the phone and (via a trigger) on the server.
 */

const PAGE = 1000;
const CHUNK = 200;

interface RemoteCustomer {
  id: string;
  name: string;
  phone: string;
  address: string;
  opening_balance: number;
  created_at: number;
  updated_at: number;
  deleted: boolean;
  synced_at: string;
}

interface RemoteTxn {
  id: string;
  customer_id: string;
  no: number | null;
  date: string;
  type: TxnType;
  items: LineItem[];
  total: number;
  paid: number;
  note: string;
  source: Txn['source'];
  image_id: string | null;
  created_at: number;
  updated_at: number;
  deleted: boolean;
  synced_at: string;
}

interface RemoteSettings {
  data: Partial<SharedSettings>;
  updated_at: number;
  synced_at: string;
}

type Pulled = 'customers' | 'txns' | 'shop_settings';

/** which shop's khata is on this phone, and how far each table has been pulled */
interface SyncState {
  shopId: string;
  pulled: Partial<Record<Pulled, string>>;
}

// ── status, for the account section in সেটিংস ──

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'offline' | 'error';
  /** rows (and photos) on this phone that the cloud doesn't have yet */
  pending: number;
  lastSynced: number | null;
}

let status: SyncStatus = { state: 'idle', pending: 0, lastSynced: null };
const listeners = new Set<() => void>();

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

export async function pendingCount() {
  const [customers, txns, deletes, photos, settings] = await Promise.all([
    db.customers.where('dirty').equals(1).count(),
    db.txns.where('dirty').equals(1).count(),
    db.tombstones.count(),
    db.images.where('uploaded').equals(0).count(),
    db.kv.get('settingsSync'),
  ]);
  return customers + txns + deletes + photos + ((settings?.value as SettingsSync | undefined)?.dirty ? 1 : 0);
}

// ── which shop this phone belongs to ──

async function getState(): Promise<SyncState | undefined> {
  return (await db.kv.get('sync'))?.value as SyncState | undefined;
}

/**
 * Called whenever a shop is logged in. A phone that last held another shop's khata is emptied
 * first. A khata kept on the phone from before there was a login goes up to this shop.
 */
export async function claimDevice(shopId: string) {
  const state = await getState();
  if (state?.shopId === shopId) return;
  if (state) await wipeLocalData();
  await db.kv.put({ key: 'sync', value: { shopId, pulled: {} } satisfies SyncState });
}

export async function currentShopId() {
  return (await getState())?.shopId ?? null;
}

// ── push ──

const sb = () => supabase!;

function chunks<T>(rows: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** dirty = 0 for rows the cloud now has — unless they were edited again while on their way up */
async function markClean(name: 'customers' | 'txns', sent: { id: number; updatedAt: number }[]) {
  const table = db.table<{ id: number; updatedAt: number; dirty: 0 | 1 }, number>(name);
  await db.transaction('rw', table, async () => {
    const now = await table.bulkGet(sent.map((r) => r.id));
    const clean = sent.filter((r, i) => now[i] && now[i]!.updatedAt === r.updatedAt);
    if (clean.length) await table.bulkUpdate(clean.map((r) => ({ key: r.id, changes: { dirty: 0 as const } })));
  });
}

async function pushPhotos(shopId: string) {
  const photos = await db.images.where('uploaded').equals(0).toArray();
  for (const p of photos) {
    if (p.blob) {
      const { error } = await sb()
        .storage.from(PHOTO_BUCKET)
        .upload(`${shopId}/${p.uid}.jpg`, p.blob, { upsert: true, contentType: p.blob.type || 'image/jpeg' });
      if (error) throw error;
    }
    await db.images.update(p.id, { uploaded: 1 });
  }
}

async function pushCustomers() {
  const rows = await db.customers.where('dirty').equals(1).toArray();
  for (const part of chunks(rows)) {
    const { error } = await sb()
      .from('customers')
      .upsert(
        part.map((c) => ({
          id: c.uid,
          name: c.name,
          phone: c.phone,
          address: c.address,
          opening_balance: c.openingBalance,
          created_at: c.createdAt,
          updated_at: c.updatedAt,
          deleted: false,
        })),
      );
    if (error) throw error;
    await markClean('customers', part);
  }
}

async function pushTxns() {
  const rows = await db.txns.where('dirty').equals(1).toArray();
  if (!rows.length) return;
  const customerUid = new Map((await db.customers.toArray()).map((c) => [c.id, c.uid]));
  const imageIds = [...new Set(rows.flatMap((t) => (t.imageId ? [t.imageId] : [])))];
  const imageUid = new Map((await db.images.bulkGet(imageIds)).flatMap((i) => (i ? [[i.id, i.uid] as const] : [])));
  for (const part of chunks(rows)) {
    // an entry whose customer is gone from this phone has nowhere to go
    const payload = part.flatMap((t) => {
      const customer = customerUid.get(t.customerId);
      if (!customer) return [];
      return [
        {
          id: t.uid,
          customer_id: customer,
          no: t.no ?? null,
          date: t.date,
          type: t.type,
          items: t.items,
          total: t.total,
          paid: t.paid,
          note: t.note,
          source: t.source,
          image_id: (t.imageId && imageUid.get(t.imageId)) || null,
          created_at: t.createdAt,
          updated_at: t.updatedAt,
          deleted: false,
        },
      ];
    });
    if (payload.length) {
      const { error } = await sb().from('txns').upsert(payload);
      if (error) throw error;
    }
    await markClean('txns', part);
  }
}

async function pushDeletes() {
  const tombstones = await db.tombstones.toArray();
  for (const table of ['customers', 'txns'] as const) {
    for (const part of chunks(tombstones.filter((t) => t.table === table))) {
      const { error } = await sb()
        .from(table)
        .update({ deleted: true, updated_at: Date.now() })
        .in(
          'id',
          part.map((t) => t.uid),
        );
      if (error) throw error;
      await db.tombstones.bulkDelete(part.map((t) => t.id));
    }
  }
}

async function pushSettings(shopId: string) {
  const meta = (await db.kv.get('settingsSync'))?.value as SettingsSync | undefined;
  if (!meta?.dirty) return;
  const { lang: _lang, ...data } = withoutKeys(await getSettings());
  const { error } = await sb().from('shop_settings').upsert({ shop_id: shopId, data, updated_at: meta.updatedAt });
  if (error) throw error;
  await db.transaction('rw', db.kv, async () => {
    const now = (await db.kv.get('settingsSync'))?.value as SettingsSync | undefined;
    if (now?.updatedAt === meta.updatedAt) await db.kv.put({ key: 'settingsSync', value: { ...meta, dirty: 0 } });
  });
}

// ── pull ──

async function pull<R extends { synced_at: string }>(table: Pulled, apply: (rows: R[]) => Promise<void>) {
  const since = (await getState())?.pulled[table];
  // rows can be committed a moment out of order, so look back a minute; seeing a row twice is harmless
  let after = since ? new Date(Date.parse(since) - 60_000).toISOString() : '1970-01-01T00:00:00Z';
  let newest = since;
  for (;;) {
    const { data, error } = await sb().from(table).select('*').gt('synced_at', after).order('synced_at').limit(PAGE);
    if (error) throw error;
    const rows = data as R[];
    if (rows.length) {
      await apply(rows);
      after = rows[rows.length - 1].synced_at;
      if (!newest || Date.parse(after) > Date.parse(newest)) newest = after;
    }
    if (rows.length < PAGE) break;
  }
  if (newest && newest !== since) {
    await db.transaction('rw', db.kv, async () => {
      const state = await getState();
      if (state) await db.kv.put({ key: 'sync', value: { ...state, pulled: { ...state.pulled, [table]: newest } } });
    });
  }
}

/*
 * Rows from the cloud are written in bulk, one transaction a page: while a transaction runs, the
 * khata on screen waits for it, and writing a thousand rows one at a time kept the customer list
 * blank for seconds on a phone.
 */

async function applyCustomers(rows: RemoteCustomer[]) {
  await db.transaction('rw', db.customers, db.txns, async (tx) => {
    (tx as FromCloud).fromCloud = true;
    const locals = await db.customers.where('uid').anyOf(rows.map((r) => r.id)).toArray();
    const byUid = new Map(locals.map((c) => [c.uid, c]));
    const added: Customer[] = [];
    const changed: { key: number; changes: Partial<Customer> }[] = [];
    const gone: number[] = [];
    for (const r of rows) {
      const local = byUid.get(r.id);
      // this phone already has this version, or a newer one still going up
      if (local && local.updatedAt >= r.updated_at) continue;
      if (r.deleted) {
        if (local) gone.push(local.id);
        continue;
      }
      const fields = {
        uid: r.id,
        name: r.name,
        phone: r.phone ?? '',
        address: r.address ?? '',
        openingBalance: Number(r.opening_balance),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        dirty: 0 as const,
      };
      if (local) changed.push({ key: local.id, changes: fields });
      else added.push(fields as Customer);
    }
    if (gone.length) {
      await db.txns.where('customerId').anyOf(gone).delete();
      await db.customers.bulkDelete(gone);
    }
    if (changed.length) await db.customers.bulkUpdate(changed);
    if (added.length) await db.customers.bulkAdd(added);
  });
}

async function applyTxns(rows: RemoteTxn[]) {
  const customerId = new Map((await db.customers.toArray()).map((c) => [c.uid, c.id]));
  await db.transaction('rw', db.txns, db.images, async (tx) => {
    (tx as FromCloud).fromCloud = true;
    const locals = await db.txns.where('uid').anyOf(rows.map((r) => r.id)).toArray();
    const byUid = new Map(locals.map((t) => [t.uid, t]));
    // the photo itself is fetched only when someone opens it; here it just gets a row
    const photoUids = [...new Set(rows.flatMap((r) => (r.image_id && !r.deleted ? [r.image_id] : [])))];
    const known = await db.images.where('uid').anyOf(photoUids).toArray();
    const imageId = new Map(known.map((i) => [i.uid, i.id]));
    for (const uid of photoUids) {
      if (imageId.has(uid)) continue;
      const created = rows.find((r) => r.image_id === uid)!.created_at;
      imageId.set(uid, await db.images.add({ uid, blob: null, uploaded: 1, createdAt: created } as StoredImage));
    }
    const added: Txn[] = [];
    const changed: { key: number; changes: Partial<Txn> }[] = [];
    const gone: number[] = [];
    for (const r of rows) {
      const local = byUid.get(r.id);
      if (local && local.updatedAt >= r.updated_at) continue;
      if (r.deleted) {
        if (local) gone.push(local.id);
        continue;
      }
      const owner = customerId.get(r.customer_id);
      if (!owner) continue;
      const fields = {
        uid: r.id,
        no: r.no ?? undefined,
        customerId: owner,
        date: r.date,
        type: r.type,
        items: r.items ?? [],
        total: Number(r.total),
        paid: Number(r.paid),
        note: r.note ?? '',
        source: r.source,
        imageId: r.image_id ? imageId.get(r.image_id) : undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        dirty: 0 as const,
      };
      if (local) changed.push({ key: local.id, changes: fields });
      else added.push(fields as Txn);
    }
    if (gone.length) await db.txns.bulkDelete(gone);
    if (changed.length) await db.txns.bulkUpdate(changed);
    if (added.length) await db.txns.bulkAdd(added);
  });
}

async function applySettings(rows: RemoteSettings[]) {
  const latest = rows[rows.length - 1];
  const meta = (await db.kv.get('settingsSync'))?.value as SettingsSync | undefined;
  if (!latest || (meta && meta.updatedAt >= latest.updated_at)) return;
  await applyCloudSettings(latest.data, latest.updated_at);
}

// ── one round, and the loop that runs it ──

const isOffline = (e: unknown) => !navigator.onLine || /fetch|network/i.test(String((e as Error)?.message ?? e));

async function syncOnce(shopId: string) {
  if (!navigator.onLine) return setStatus({ state: 'offline' });
  setStatus({ state: 'syncing' });
  let failed: unknown = null;
  try {
    await refreshAccess();
  } catch (e) {
    failed = e;
  }
  // a push the server refuses (say, after the plan ran out) must not stop other phones' changes coming down
  try {
    await pushPhotos(shopId);
    await pushCustomers();
    await pushTxns();
    await pushDeletes();
    await pushSettings(shopId);
  } catch (e) {
    failed = e;
  }
  try {
    await pull('customers', applyCustomers);
    await pull('txns', applyTxns);
    await pull('shop_settings', applySettings);
  } catch (e) {
    failed = e;
  }
  if (failed) {
    console.warn('sync:', failed);
    setStatus({ state: isOffline(failed) ? 'offline' : 'error' });
  } else {
    setStatus({ state: 'idle', lastSynced: Date.now() });
  }
}

let runNow: () => Promise<void> = async () => undefined;

/** Syncs right away; resolves when this round (and any change made meanwhile) is done. */
export const syncNow = () => runNow();

/** Keeps the phone and the cloud in step while a shop is logged in. Returns a stop function. */
export function startSync(shopId: string): () => void {
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;
  let timer: number | undefined;

  const run = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await syncOnce(shopId);
      } while (again && !stopped);
    })().finally(() => {
      running = null;
    });
    return running;
  };
  const tick = () => void run();

  // a change on this phone goes up a moment later, so a burst of typing is one upload
  const pending = liveQuery(pendingCount).subscribe({
    next: (n) => {
      setStatus({ pending: n });
      if (n) {
        clearTimeout(timer);
        timer = window.setTimeout(tick, 1500);
      }
    },
  });
  const onVisible = () => document.visibilityState === 'visible' && tick();
  window.addEventListener('online', tick);
  document.addEventListener('visibilitychange', onVisible);
  const every = window.setInterval(tick, 25_000);
  runNow = run;
  tick();

  // Supabase Realtime live channel for instant platform updates
  let liveChannel: RealtimeChannel | null = null;
  if (supabase) {
    try {
      liveChannel = supabase
        .channel(`shop-live-${shopId}`)
        .on('broadcast', { event: 'shop_event' }, async ({ payload }) => {
          try {
            await refreshAccess();
            await run();
            const action = payload?.action;
            if (action === 'plan_changed') {
              const isLifetime = payload.plan === 'lifetime' || payload.until === 'infinity';
              toast(isLifetime ? 'আপনার প্ল্যান সফলভাবে আপগ্রেড করা হয়েছে (Lifetime)! 🎉' : 'আপনার প্ল্যান সফলভাবে আপডেট হয়েছে! 🎉');
            } else if (action === 'plan_revoked') {
              toast('আপনার প্ল্যান রিসেট করা হয়েছে (ফ্রি প্ল্যান)');
            } else if (action === 'password_changed') {
              toast('অ্যাডমিন দ্বারা আপনার অ্যাকাউন্টের পাসওয়ার্ড পরিবর্তিত হয়েছে');
            } else if (action === 'shop_name_changed' && payload.shopName) {
              toast(`দোকানের নাম পরিবর্তিত হয়েছে: ${payload.shopName}`);
            }
          } catch (e) {
            console.warn('[Realtime event error]:', e);
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'shops', filter: `id=eq.${shopId}` }, async () => {
          await refreshAccess().catch(() => undefined);
          void run();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_settings', filter: `shop_id=eq.${shopId}` }, async () => {
          void run();
        })
        .subscribe();
    } catch (e) {
      console.warn('[Realtime channel setup failed]:', e);
    }
  }

  return () => {
    stopped = true;
    runNow = async () => undefined;
    pending.unsubscribe();
    clearTimeout(timer);
    clearInterval(every);
    window.removeEventListener('online', tick);
    document.removeEventListener('visibilitychange', onVisible);
    if (liveChannel && supabase) {
      try {
        supabase.removeChannel(liveChannel);
      } catch {
        // ignore
      }
    }
  };
}

/** A khata photo, downloaded from the cloud the first time it is opened on this phone. */
export async function loadPhoto(image: StoredImage): Promise<Blob | null> {
  if (image.blob) return image.blob;
  const shopId = await currentShopId();
  if (!supabase || !shopId) return null;
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).download(`${shopId}/${image.uid}.jpg`);
  if (error || !data) return null;
  await db.images.update(image.id, { blob: data });
  return data;
}

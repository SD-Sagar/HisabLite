import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Image as ImageIcon, Trash2 } from 'lucide-react';
import { addTxn, balanceAround, cashCustomerId, db, deleteTxn, isCashCustomer, nextBillNo, txnEffect, type Txn } from '../db';
import { usePremium } from '../components/Access';
import { CustomerForm } from '../components/CustomerForm';
import { EntryFields, type EntryDraft } from '../components/EntryFields';
import { ImageViewer } from '../components/ImageViewer';
import { draftToItem, draftTotal, emptyItem, itemToDraft } from '../components/ItemsEditor';
import { SendSheet, type SendRequest } from '../components/SendSheet';
import { TopBar, toast } from '../components/ui';
import { useT } from '../i18n';
import { useAccount } from '../lib/auth';
import { numInput, parseNum, roundModeOf, todayISO } from '../lib/format';
import { useItemCatalog, useLedger } from '../lib/hooks';
import { entryMessage } from '../lib/template';
import { forMessages, useSettings } from '../settings';

export default function EntryForm() {
  const t = useT();
  const params = useParams();
  const editId = params.id ? Number(params.id) : null;
  const [search] = useSearchParams();
  const nav = useNavigate();
  const ledger = useLedger();
  const settings = useSettings();
  const catalog = useItemCatalog();
  const { shopId } = useAccount();
  const premium = usePremium();

  const [original, setOriginal] = useState<Txn | null>(null);
  const [draft, setDraft] = useState<EntryDraft>(() => ({
    type: search.get('type') === 'payment' ? 'payment' : 'sale',
    customerId: search.get('c') ? Number(search.get('c')) : null,
    cash: search.get('cash') === '1' && search.get('type') !== 'payment',
    date: todayISO(),
    items: [emptyItem()],
    // paise are rounded away unless the shop picks otherwise on this ফর্দ
    round: 'rupee',
    paid: '',
    note: '',
  }));
  const [newCustomer, setNewCustomer] = useState<string | null>(null);
  const [send, setSend] = useState<SendRequest | null>(null);
  /** where the send sheet leads once it closes */
  const [after, setAfter] = useState<string | null>(null);
  const [showImage, setShowImage] = useState(false);
  const [saving, setSaving] = useState(false);

  const patch = (p: Partial<EntryDraft>) => setDraft((d) => ({ ...d, ...p }));

  useEffect(() => {
    if (!editId) return;
    db.txns.get(editId).then(async (txn) => {
      if (!txn) return;
      const owner = await db.customers.get(txn.customerId);
      const cash = !!owner && isCashCustomer(owner);
      setOriginal(txn);
      setDraft({
        type: txn.type,
        customerId: cash ? null : txn.customerId,
        cash,
        date: txn.date,
        items: txn.items.length ? txn.items.map(itemToDraft) : [emptyItem()],
        // the rounding it was saved with, so its total stays as it was
        round: roundModeOf(txn),
        paid: numInput(txn.paid),
        note: txn.note,
      });
    });
  }, [editId]);

  const { type, customerId } = draft;
  const cash = type === 'sale' && draft.cash;
  const customer = ledger?.customers.find((c) => c.id === customerId);
  // বাকি without this entry, so editing an old entry doesn't count it twice
  const prev = customer ? customer.balance - (original && original.customerId === customer.id ? txnEffect(original) : 0) : undefined;

  const save = async () => {
    if (!cash && (!customerId || !customer)) return toast(t.entry.pickCustomer);
    const lineItems = type === 'sale' ? draft.items.map(draftToItem).filter((x): x is NonNullable<typeof x> => !!x) : [];
    const total = type === 'sale' ? draftTotal(draft) : 0;
    // a cash sale is paid for there and then, whatever was typed before it became one
    const paid = cash ? total : parseNum(draft.paid);
    if (type === 'sale' && !lineItems.length && !paid) return toast(t.entry.needItem);
    if (type === 'payment' && !paid) return toast(t.entry.needAmount);
    setSaving(true);
    const now = Date.now();
    const owner = cash ? await cashCustomerId(shopId, t.cash.name) : customerId!;
    const fields = {
      customerId: owner,
      date: draft.date,
      type,
      items: lineItems,
      total,
      paid,
      note: draft.note.trim(),
    };
    let saved: Txn;
    if (original) {
      saved = { ...original, ...fields, updatedAt: now };
      await db.txns.put(saved);
    } else {
      const newId = await db.transaction('rw', db.txns, async () =>
        addTxn({ ...fields, no: await nextBillNo(), source: 'manual', createdAt: now, updatedAt: now }),
      );
      saved = (await db.txns.get(newId))!;
    }
    setSaving(false);
    toast(t.common.savedToast);
    // a cash memo has nobody's বাকি on it and no one's number to send it to
    const data = cash
      ? { customer: { name: t.cash.name, phone: '' }, txn: saved, before: 0, after: 0, cash: true }
      : { customer: customer!, txn: saved, ...(await balanceAround(saved)) };
    setAfter(`/c/${owner}`);
    setSend({
      title: t.entry.sendTitle,
      customerName: data.customer.name,
      phone: data.customer.phone,
      message: entryMessage(data, forMessages(settings!, premium)),
      bill: data,
    });
  };

  const remove = async () => {
    if (!original || !confirm(t.entry.confirmDelete)) return;
    await deleteTxn(original);
    toast(t.entry.deleted);
    nav(-1);
  };

  const done = () => {
    setSend(null);
    nav(after ?? (customerId ? `/c/${customerId}` : '/'), { replace: true });
  };

  return (
    <div className="page has-actions">
      <TopBar title={original ? t.entry.editTitle : type === 'sale' ? t.entry.newSale : t.entry.newPayment} back />

      <EntryFields
        draft={draft}
        onChange={patch}
        customers={ledger?.customers ?? []}
        catalog={catalog}
        prev={prev}
        onNewCustomer={setNewCustomer}
      />

      {original && (
        <div className="row gap wrap">
          {original.imageId && (
            <button className="btn ghost" onClick={() => setShowImage(true)}>
              <ImageIcon size={18} /> {t.common.khataPhoto}
            </button>
          )}
          <button className="btn danger-ghost" onClick={remove}>
            <Trash2 size={18} /> {t.entry.delete}
          </button>
        </div>
      )}

      <div className="sticky-actions">
        <button className="btn primary big block" disabled={saving || !settings} onClick={save}>
          {original ? t.common.update : t.common.save}
        </button>
      </div>

      <CustomerForm
        open={newCustomer !== null}
        initialName={newCustomer ?? ''}
        onClose={() => setNewCustomer(null)}
        onSaved={(id) => id && patch({ customerId: id, cash: false })}
      />
      {settings && <SendSheet request={send} settings={settings} onClose={done} />}
      {showImage && <ImageViewer imageId={original?.imageId} onClose={() => setShowImage(false)} />}
    </div>
  );
}

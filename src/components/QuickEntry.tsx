import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, ReceiptText, ShoppingBasket, Wallet } from 'lucide-react';
import { addTxn, balanceAround, db, nextBillNo, type TxnType } from '../db';
import { useT } from '../i18n';
import { money, parseNum, todayISO } from '../lib/format';
import type { CustomerRow } from '../lib/hooks';
import { entryMessage } from '../lib/template';
import { forMessages, useSettings } from '../settings';
import { usePremium } from './Access';
import { SendSheet, type SendRequest } from './SendSheet';
import { Modal, Segmented, toast } from './ui';

/**
 * The everyday entry, straight from the customer list: how much went out, or how much came in.
 * No item lines — a shop that wants those opens the full ফর্দ from the link at the bottom.
 */
export function QuickEntry({ customer, type: startType, onClose }: { customer: CustomerRow; type: TxnType; onClose: () => void }) {
  const t = useT();
  const settings = useSettings();
  const premium = usePremium();
  const [type, setType] = useState<TxnType>(startType);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [send, setSend] = useState<SendRequest | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    amountRef.current?.focus();
  }, []);

  const value = parseNum(amount);
  const after = customer.balance + (type === 'sale' ? value : -value);
  const sale = type === 'sale';

  const save = async () => {
    if (!value || !settings) return toast(sale ? t.quick.needAmountSale : t.entry.needAmount);
    setSaving(true);
    const now = Date.now();
    const newId = await db.transaction('rw', db.txns, async () =>
      addTxn({
        customerId: customer.id,
        date: todayISO(),
        type,
        items: [],
        total: sale ? value : 0,
        paid: sale ? 0 : value,
        note: note.trim(),
        no: await nextBillNo(),
        source: 'manual',
        createdAt: now,
        updatedAt: now,
      }),
    );
    const saved = (await db.txns.get(newId))!;
    setSaving(false);
    toast(t.common.savedToast);
    const bal = await balanceAround(saved);
    const data = { customer, txn: saved, ...bal };
    setSend({
      title: t.entry.sendTitle,
      customerName: customer.name,
      phone: customer.phone,
      message: entryMessage(data, forMessages(settings, premium)),
      bill: data,
    });
  };

  // the send sheet takes over once the entry is saved
  if (send && settings) return <SendSheet request={send} settings={settings} onClose={onClose} />;

  return (
    <Modal
      open
      onClose={onClose}
      title={t.quick.title(customer.name)}
      className="quick-entry"
      footer={
        <div className="row gap">
          <button type="button" className="btn ghost grow" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button type="button" className={`btn grow ${sale ? 'sale' : 'pay'}`} disabled={saving} onClick={save}>
            {sale ? <ShoppingBasket size={18} /> : <Wallet size={18} />} {t.common.save}
          </button>
        </div>
      }
    >
      {/* the same two words, the same way round, as the buttons on the customer's card */}
      <Segmented
        value={type}
        onChange={setType}
        options={[
          { value: 'payment', label: t.common.deposit, tone: 'pay' },
          { value: 'sale', label: t.common.sell, tone: 'sale' },
        ]}
      />

      <label className="field">
        <span>{sale ? t.quick.goodsLabel : t.entry.amountLabel}</span>
        <span className="money-input big">
          <span>₹</span>
          <input
            ref={amountRef}
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </span>
      </label>

      <label className="field">
        <span>{t.quick.note}</span>
        <input placeholder={t.quick.notePlaceholder} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      <div className="quick-sum">
        <span>
          {t.entry.dueNow}: <b>{money(customer.balance)}</b>
        </span>
        <span className={after > 0.004 ? 'tone-due' : 'tone-advance'}>
          → {t.quick.willBe} <b>{money(Math.abs(after))}</b>
        </span>
      </div>

      <p className="notice info quick-hint">
        <MessageCircle size={18} /> {t.quick.whatsappHint}
      </p>

      <Link className="btn ghost small quick-full" to={`/entry/new?c=${customer.id}&type=sale`} onClick={onClose}>
        <ReceiptText size={16} /> {t.quick.fullBill}
      </Link>
    </Modal>
  );
}

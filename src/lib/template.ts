import type { Customer, Txn } from '../db';
import { tr, type Dict, type Lang } from '../i18n';
import type { Settings } from '../settings';
import { fmtDate, money, num, roundOffOf, signedMoney, todayISO, toNativeDigits } from './format';

/** Everything a WhatsApp message or ফর্দ needs about one entry. */
export interface BillData {
  customer: Pick<Customer, 'name' | 'phone'>;
  txn: Pick<Txn, 'id' | 'no' | 'date' | 'type' | 'items' | 'total' | 'paid' | 'note'>;
  /** বাকি before this entry */
  before: number;
  /** বাকি after this entry */
  after: number;
  /** a নগদ বিক্রি: paid in full, in nobody's khata, so no বাকি is shown */
  cash?: boolean;
}

export const PLACEHOLDERS = [
  'name', 'date', 'items', 'today_total', 'paid', 'prev_due', 'total_due', 'shop', 'shop_phone', 'upi',
] as const satisfies readonly (keyof Dict['placeholders'])[];

export function renderTemplate(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? vars[key] : m)).trim();
}

/** Formatter for the "native digits" setting — only for numbers, never phone/UPI. */
export const digitsFor = (s: Settings) => (text: string) => (s.bengaliDigits ? toNativeDigits(text, s.lang) : text);

function dueText(bal: number, lang: Lang) {
  return bal < 0 ? `${money(-bal)} (${tr(lang).balance.advance})` : money(bal);
}

export function templateVars(d: BillData, s: Settings): Record<string, string> {
  const dg = digitsFor(s);
  const lines = d.txn.items.map((it) => {
    const qty = it.qty ? ` ${num(it.qty)}${it.unit ? ' ' + it.unit : ''}` : '';
    const rate = it.qty && it.rate ? ` × ${money(it.rate)}` : '';
    return dg(`• ${it.name}${qty}${rate} = ${money(it.amount)}`);
  });
  // the lines then add up to the day's total, as they do on the ফর্দ
  const adj = roundOffOf(d.txn);
  if (adj) lines.push(dg(`• ${tr(s.lang).bill.roundOff} = ${signedMoney(adj)}`));
  const items = lines.join('\n');
  return {
    name: d.customer.name,
    date: dg(fmtDate(d.txn.date, s.lang)),
    // a quick entry has no item lines, so the day's amount stands in for them
    items: items || (d.txn.total ? dg(`• ${tr(s.lang).bill.todayGoods} = ${money(d.txn.total)}`) : '—'),
    today_total: dg(money(d.txn.total)),
    paid: dg(money(d.txn.paid)),
    prev_due: dg(dueText(d.before, s.lang)),
    total_due: dg(dueText(d.after, s.lang)),
    shop: s.shopName,
    shop_phone: s.shopPhone,
    upi: s.upiId,
  };
}

export function entryMessage(d: BillData, s: Settings) {
  const tpl = d.cash ? tr(s.lang).cash.template : d.txn.type === 'payment' ? s.templates.payment : s.templates.sale;
  return renderTemplate(tpl, templateVars(d, s));
}

export function reminderMessage(customer: Pick<Customer, 'name' | 'phone'>, balance: number, s: Settings) {
  const vars = templateVars(
    {
      customer,
      txn: { id: 0, date: todayISO(), type: 'sale', items: [], total: 0, paid: 0, note: '' },
      before: balance,
      after: balance,
    },
    s,
  );
  return renderTemplate(s.templates.reminder, vars);
}

/** Made-up entry used for the live previews in সেটিংস, written in the chosen language. */
export function sampleBill(lang: Lang): BillData {
  const { customer, items } = tr(lang).sample;
  const [mango, banana, apple] = items;
  return {
    customer: { name: customer, phone: '9876543210' },
    txn: {
      id: 128,
      date: todayISO(),
      type: 'sale',
      items: [
        { ...mango, qty: 20, rate: 80, amount: 1600 },
        { ...banana, qty: 5, rate: 45, amount: 225 },
        { ...apple, qty: 1, rate: 1450, amount: 1450 },
      ],
      total: 3275,
      paid: 1000,
      note: '',
    },
    before: 4200,
    after: 6475,
  };
}

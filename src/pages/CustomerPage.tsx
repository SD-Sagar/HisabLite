import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Banknote, BookOpen, CalendarDays, ChevronRight, Crown, Image as ImageIcon, Link2, Loader2, MessageCircle, Pencil, Phone,
  Plus, ReceiptText, Wallet,
} from 'lucide-react';
import { billNo, isCashCustomer, withRunningBalance, type TxnWithBalance } from '../db';
import { CustomerForm } from '../components/CustomerForm';
import { ImageViewer } from '../components/ImageViewer';
import { SendSheet, type SendRequest } from '../components/SendSheet';
import { usePremium } from '../components/Access';
import { cloudEnabled } from '../lib/cloud';
import { shareKhata } from '../lib/khata';
import { Empty, Modal, StatCard, TopBar, toast } from '../components/ui';
import { useT } from '../i18n';
import { fmtDate, fmtDateLong, itemsSummary, money, qtyText, roundOffOf, signedMoney, todayISO } from '../lib/format';
import { useLedger } from '../lib/hooks';
import { entryMessage, reminderMessage } from '../lib/template';
import { forMessages, useSettings } from '../settings';

/**
 * One customer: what they owe now, quick actions, and every ফর্দ and payment, newest first. The
 * hidden cash customer's page is the book of নগদ বিক্রি instead: no বাকি, just the cash memos.
 */
export default function CustomerPage() {
  const t = useT();
  const id = Number(useParams().id);
  const nav = useNavigate();
  const settings = useSettings();
  // from the khata already in memory, so the page opens complete instead of filling in a moment later
  const ledger = useLedger();
  const data = useMemo(
    () =>
      ledger && {
        customer: ledger.customers.find((c) => c.id === id),
        txns: ledger.txns.filter((x) => x.customerId === id),
      },
    [ledger, id],
  );

  const [editing, setEditing] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [send, setSend] = useState<SendRequest | null>(null);
  const [imageId, setImageId] = useState<number | null>(null);
  const [sharing, setSharing] = useState(false);
  const premium = usePremium();

  const customer = data?.customer;
  const rows = useMemo(
    () => (customer && data ? withRunningBalance(customer, data.txns).reverse() : []),
    [customer, data],
  );
  const balance = rows.length ? rows[0].after : (customer?.openingBalance ?? 0);
  const open = rows.find((txn) => txn.id === openId);

  if (data && !customer) {
    return (
      <div className="page">
        <TopBar title={t.common.customer} back />
        <Empty icon={<Wallet size={36} />} title={t.customer.gone} />
      </div>
    );
  }
  if (!customer || !settings) return <div className="page" />;

  const cash = isCashCustomer(customer);
  const name = cash ? t.cash.name : customer.name;
  const dueText = (bal: number) => (bal < -0.004 ? `${t.balance.advance} ${money(-bal)}` : t.customer.dueBecame(money(bal)));
  const title = (txn: TxnWithBalance) => (txn.type === 'sale' ? t.customer.billNo(billNo(txn)) : t.customer.payment);
  const today = todayISO();
  const cashToday = cash ? rows.reduce((sum, x) => sum + (x.date === today ? x.total : 0), 0) : 0;
  const cashAll = cash ? rows.reduce((sum, x) => sum + x.total, 0) : 0;

  const sendEntry = (txn: TxnWithBalance) => {
    setOpenId(null);
    const bill = cash
      ? { customer: { name, phone: '' }, txn, before: 0, after: 0, cash: true }
      : { customer, txn, before: txn.before, after: txn.after };
    setSend({
      title: t.customer.sendTitle,
      customerName: name,
      phone: bill.customer.phone,
      message: entryMessage(bill, forMessages(settings, premium)),
      bill,
    });
  };

  /** the customer's own khata on a link, sent on WhatsApp; without a plan it offers one instead */
  const sendKhataLink = async () => {
    if (!premium) return nav('/plans');
    setSharing(true);
    try {
      const link = await shareKhata(customer.uid);
      setSend({
        title: t.customer.shareKhata,
        customerName: customer.name,
        phone: customer.phone,
        message: t.customer.khataMessage(customer.name, settings.shopName, link),
      });
    } catch (e) {
      console.error(e);
      toast(t.customer.shareFailed);
    } finally {
      setSharing(false);
    }
  };

  const sendReminder = () =>
    setSend({
      title: t.customer.reminderTitle,
      customerName: customer.name,
      phone: customer.phone,
      message: reminderMessage(customer, balance, forMessages(settings, premium)),
    });

  return (
    <div className="page">
      <TopBar title={cash ? t.cash.name : t.common.customer} back />

      <section className="profile-head">
        <h1>{name}</h1>
        {cash && <p className="muted">{t.cash.help}</p>}
        {customer.phone && (
          <a className="profile-phone" href={`tel:${customer.phone}`} aria-label={t.customer.call}>
            <Phone size={15} /> {customer.phone}
          </a>
        )}
        {customer.address && <p className="muted">{customer.address}</p>}
      </section>

      {cash ? (
        <section className="stat-grid">
          <StatCard icon={<CalendarDays size={16} />} label={t.cash.today} value={money(cashToday)} accent="good" />
          <StatCard
            icon={<Banknote size={16} />}
            label={t.cash.total}
            value={money(cashAll)}
            sub={t.home.bills(rows.length)}
            accent="plain"
          />
        </section>
      ) : (
        <section className="stat-grid">
          <StatCard
            icon={<Wallet size={16} />}
            label={balance < -0.004 ? t.customer.advanceNow : t.customer.dueNow}
            value={money(Math.abs(balance))}
            accent={balance > 0.004 ? 'due' : balance < -0.004 ? 'good' : 'plain'}
          />
          <StatCard
            icon={<ReceiptText size={16} />}
            label={t.customer.entries}
            value={String(rows.length)}
            sub={t.customer.sinceStart}
            accent="plain"
          />
        </section>
      )}

      {cash ? (
        <Link className="btn big primary block" to="/entry/new?cash=1">
          <Plus size={22} /> {t.cash.newBill}
        </Link>
      ) : (
        <section className="action-pair">
          <Link className="btn big primary" to={`/entry/new?c=${customer.id}&type=sale`}>
            <Plus size={22} /> {t.customer.newBill}
          </Link>
          <Link className="btn big pay" to={`/entry/new?c=${customer.id}&type=payment`}>
            <Wallet size={20} /> {t.customer.payment}
          </Link>
          <button className="btn big whatsapp" onClick={sendReminder}>
            <MessageCircle size={20} /> WhatsApp
          </button>
          <button className="btn big ghost" onClick={() => setEditing(true)}>
            <Pencil size={18} /> {t.customer.fix}
          </button>
        </section>
      )}

      {/* the customer's own khata, on a link: it settles arguments before they start */}
      {cloudEnabled && !cash && (
        <button className="btn ghost block" disabled={sharing} onClick={sendKhataLink}>
          {sharing ? <Loader2 className="spin" size={18} /> : premium ? <Link2 size={18} /> : <Crown size={18} />}{' '}
          {t.customer.shareKhata}
        </button>
      )}

      <section className="tile-section">
        <div className="section-title">
          <h2>
            <BookOpen size={18} /> {t.customer.khata}
          </h2>
        </div>

        {!rows.length && !customer.openingBalance ? (
          <p className="tile muted">{t.customer.noTxns}</p>
        ) : (
          <div className="ledger">
            {rows.map((txn) => (
              <button key={txn.id} className="ledger-row" onClick={() => setOpenId(txn.id)}>
                <span className={`txn-icon ${txn.type === 'sale' ? 'bill' : 'payment'}`}>
                  {txn.type === 'sale' ? <ReceiptText size={18} /> : <Wallet size={18} />}
                </span>
                <span className="ledger-main">
                  <strong>{title(txn)}</strong>
                  <small>{[fmtDate(txn.date), txn.type === 'sale' && itemsSummary(txn.items)].filter(Boolean).join(' · ')}</small>
                </span>
                <span className="ledger-amt">
                  {txn.type === 'sale' ? <b>{money(txn.total)}</b> : <b className="tone-advance">−{money(txn.paid)}</b>}
                  <small>{cash ? t.common.cash : dueText(txn.after)}</small>
                </span>
                <ChevronRight size={18} className="tile-chevron" />
              </button>
            ))}
            {customer.openingBalance !== 0 && (
              <div className="ledger-row static">
                <span className="txn-icon">₹</span>
                <span className="ledger-main">
                  <strong>{t.common.openingDue}</strong>
                </span>
                <span className="ledger-amt">
                  <b>{money(customer.openingBalance)}</b>
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* one ফর্দ or payment, opened from the list */}
      <Modal open={!!open} onClose={() => setOpenId(null)} title={open ? title(open) : ''}>
        {open && (
          <>
            <p className="muted sheet-date">{fmtDateLong(open.date)}</p>
            {open.items.length > 0 && (
              <table className="items-table">
                <tbody>
                  {open.items.map((it, i) => (
                    <tr key={i}>
                      <td>{it.name}</td>
                      <td className="muted">
                        {qtyText(it)}
                        {it.qty && it.rate ? ` × ${money(it.rate)}` : ''}
                      </td>
                      <td className="num">{money(it.amount)}</td>
                    </tr>
                  ))}
                  {roundOffOf(open) !== 0 && (
                    <tr>
                      <td colSpan={2} className="muted">
                        {t.entry.roundOff}
                      </td>
                      <td className="num">{signedMoney(roundOffOf(open))}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            {cash ? (
              <dl className="mini-sum">
                <dt>
                  <b>{t.cash.received}</b>
                </dt>
                <dd>
                  <b className="tone-advance">{money(open.total)}</b>
                </dd>
              </dl>
            ) : (
              <dl className="mini-sum">
                <dt>{t.common.prevDue}</dt>
                <dd>{money(open.before)}</dd>
                {open.total > 0 && (
                  <>
                    <dt>{t.common.goods}</dt>
                    <dd>+ {money(open.total)}</dd>
                  </>
                )}
                {open.paid > 0 && (
                  <>
                    <dt>{t.common.paid}</dt>
                    <dd className="tone-advance">− {money(open.paid)}</dd>
                  </>
                )}
                <dt>
                  <b>{t.customer.dueAfter}</b>
                </dt>
                <dd>
                  <b>{money(open.after)}</b>
                </dd>
              </dl>
            )}
            {open.note && (
              <p className="muted">
                {t.common.note}: {open.note}
              </p>
            )}
            <button className="btn whatsapp big block" onClick={() => sendEntry(open)}>
              <MessageCircle size={20} /> {open.type === 'sale' ? t.customer.sendBill : t.customer.sendReceipt}
            </button>
            <div className="row gap">
              <Link className="btn ghost grow" to={`/entry/${open.id}`}>
                <Pencil size={18} /> {t.common.edit}
              </Link>
              {open.imageId && (
                <button
                  className="btn ghost grow"
                  onClick={() => {
                    setOpenId(null);
                    setImageId(open.imageId!);
                  }}
                >
                  <ImageIcon size={18} /> {t.common.khataPhoto}
                </button>
              )}
            </div>
          </>
        )}
      </Modal>

      <CustomerForm
        open={editing}
        onClose={() => setEditing(false)}
        customer={customer}
        onSaved={(saved) => saved === null && nav('/', { replace: true })}
      />
      <SendSheet request={send} settings={settings} onClose={() => setSend(null)} />
      <ImageViewer imageId={imageId} onClose={() => setImageId(null)} />
    </div>
  );
}

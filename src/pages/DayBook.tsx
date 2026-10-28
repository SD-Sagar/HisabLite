import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, CalendarDays, ChevronLeft, ChevronRight, Scale, ShoppingBasket, TrendingUp, Wallet } from 'lucide-react';
import { Empty, StatCard, TopBar } from '../components/ui';
import { byChronology, isCashCustomer } from '../db';
import { useT } from '../i18n';
import { fmtDate, itemsSummary, money, relativeDay, shiftDate, todayISO } from '../lib/format';
import { useLedger } from '../lib/hooks';

/** দিনের হিসাব — everything that happened on one day, across customers and cash sales. */
export default function DayBook() {
  const t = useT();
  const ledger = useLedger();
  const [date, setDate] = useState(todayISO());

  const { rows, sales, paid } = useMemo(() => {
    const people = new Map(ledger?.customers.map((c) => [c.id, c]));
    const rows = (ledger?.txns ?? [])
      .filter((txn) => txn.date === date)
      .sort(byChronology)
      .map((txn) => {
        const c = people.get(txn.customerId);
        const cash = !!c && isCashCustomer(c);
        return { ...txn, cash, customerName: cash ? t.cash.name : (c?.name ?? '?') };
      });
    return {
      rows,
      sales: rows.reduce((s, txn) => s + txn.total, 0),
      paid: rows.reduce((s, txn) => s + txn.paid, 0),
    };
  }, [ledger, date, t]);

  return (
    <div className="page">
      <TopBar menu title={t.nav.day} sub={fmtDate(date)} />

      <section className="card day-nav">
        <button className="icon-btn" aria-label={t.day.prev} onClick={() => setDate(shiftDate(date, -1))}>
          <ChevronLeft size={24} />
        </button>
        <label className="day-picker">
          <strong>{relativeDay(date)}</strong>
          <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} />
        </label>
        <button
          className="icon-btn"
          aria-label={t.day.next}
          disabled={date >= todayISO()}
          onClick={() => setDate(shiftDate(date, 1))}
        >
          <ChevronRight size={24} />
        </button>
      </section>

      <section className="stat-grid">
        <StatCard icon={<TrendingUp size={16} />} label={t.day.goodsOut} value={money(sales)} accent="primary" />
        <StatCard icon={<Wallet size={16} />} label={t.day.cashIn} value={money(paid)} accent="good" />
        <StatCard
          icon={<Scale size={16} />}
          label={sales - paid >= 0 ? t.day.dueUp : t.day.dueDown}
          value={money(Math.abs(sales - paid))}
          sub={t.day.txnCount(rows.length)}
          accent="due"
        />
      </section>

      <section className="card">
        {!rows.length ? (
          <Empty icon={<CalendarDays size={36} />} title={t.day.empty} />
        ) : (
          <div className="list">
            {rows.map((txn) => (
              <Link key={txn.id} to={`/c/${txn.customerId}`} className="list-row">
                <span className={`txn-icon ${txn.cash ? 'payment' : txn.type}`}>
                  {txn.cash ? <Banknote size={18} /> : txn.type === 'sale' ? <ShoppingBasket size={18} /> : <Wallet size={18} />}
                </span>
                <span className="list-main">
                  <strong>{txn.customerName}</strong>
                  <small>{txn.type === 'sale' ? itemsSummary(txn.items) : t.common.cashIn}</small>
                </span>
                {/* a cash sale was paid there and then: nothing went on anyone's বাকি */}
                {txn.cash ? (
                  <span className="txn-amt col">
                    <b>{money(txn.total)}</b>
                    <small className="tone-advance">{t.common.cash}</small>
                  </span>
                ) : (
                  <span className="txn-amt col">
                    {txn.total > 0 && <b className="tone-due">{money(txn.total)}</b>}
                    {txn.paid > 0 && (
                      <small className="tone-advance">
                        {t.common.paid} {money(txn.paid)}
                      </small>
                    )}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, BellRing, BookUp, CalendarRange, ChevronRight, Crown, Search, TrendingUp, UserPlus, Users, Wallet,
} from 'lucide-react';
import { AccessBanner } from '../components/Access';
import { reduceMotion } from '../components/AppRouter';
import { CustomerForm } from '../components/CustomerForm';
import { AddFromSearch, CustomerCards, SearchField, useCustomerRows } from '../components/CustomerList';
import { Empty, StatCard, TopBar } from '../components/ui';
import { isCashCustomer } from '../db';
import { useT } from '../i18n';
import { isPaid, useAccess } from '../lib/access';
import { fmtDateLong, money, todayISO } from '../lib/format';
import { useLedger } from '../lib/hooks';
import { useSettings } from '../settings';

/** what was typed in the home search, so coming back to the results finds it again */
let lastQuery = '';
/** the numbers rise into place only the first time the app opens */
let introPlayed = false;

const EASE = 'cubic-bezier(.22, 1, .36, 1)';

/** Moves elements from dy pixels away back to where they now are (the search box flying up or down). */
function glide(els: (HTMLElement | null)[], dy: number, fade = false) {
  if (reduceMotion() || Math.abs(dy) < 2) return;
  for (const el of els) {
    el?.animate(
      [
        { transform: `translateY(${dy}px)`, opacity: fade ? 0.35 : 1 },
        { transform: 'translateY(0)', opacity: 1 },
      ],
      { duration: 460, easing: EASE },
    );
  }
}

/**
 * The day's numbers, then every customer with the two buttons the shop uses all day. Tapping the
 * search box turns the whole page into the customer list, with the box at the very top.
 */
export default function Home() {
  const t = useT();
  const ledger = useLedger();
  const settings = useSettings();
  const paid = isPaid(useAccess());
  const nav = useNavigate();
  const [params] = useSearchParams();
  const searching = params.has('find');
  const [q, setQState] = useState(() => (searching ? lastQuery : ''));
  const query = useDeferredValue(q);
  const rows = useCustomerRows(searching ? query : '');
  const [adding, setAdding] = useState(false);
  const today = todayISO();
  const shopName = settings?.shopName || 'HisabLite';

  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const was = useRef(searching);
  const searchTop = useRef(0);
  const [intro] = useState(() => !introPlayed);

  useEffect(() => {
    introPlayed = true;
  }, []);

  const setQ = (value: string) => {
    lastQuery = value;
    setQState(value);
  };

  // the bottom menu steps aside while searching: the keyboard needs the room
  useEffect(() => {
    document.documentElement.toggleAttribute('data-searching', searching);
    return () => document.documentElement.removeAttribute('data-searching');
  }, [searching]);

  /** The box glides to the top and the page becomes the list of customers. */
  const openSearch = () => {
    if (searching) return;
    const from = boxRef.current?.getBoundingClientRect().top ?? 0;
    setQ('');
    // the router redraws the page at once, so the box can be measured in its new place right after
    nav('?find=1');
    const to = boxRef.current?.getBoundingClientRect().top ?? 0;
    searchTop.current = to;
    glide([boxRef.current], from - to);
    glide([listRef.current], from - to, true);
  };

  const closeSearch = () => {
    if (window.history.state?.idx > 0) nav(-1);
    else nav('/', { replace: true });
  };

  // back (the ← in the box, or the phone's own back button): the box drops back into place
  useEffect(() => {
    if (was.current && !searching) {
      inputRef.current?.blur();
      setQ('');
      const now = boxRef.current?.getBoundingClientRect().top ?? 0;
      glide([boxRef.current], (searchTop.current || 8) - now);
      if (headRef.current && !reduceMotion()) {
        headRef.current.animate([{ opacity: 0, transform: 'translateY(-14px)' }, { opacity: 1, transform: 'none' }], {
          duration: 380,
          easing: EASE,
        });
      }
    }
    was.current = searching;
  }, [searching]);

  const d = useMemo(() => {
    const month = today.slice(0, 7);
    let todaySales = 0, todayBills = 0, monthSales = 0, monthBills = 0, todayPaid = 0, cashBuyers = 0;
    const payers = new Set<number>();
    const cashId = ledger?.customers.find(isCashCustomer)?.id;
    for (const txn of ledger?.txns ?? []) {
      if (txn.date.startsWith(month) && txn.total > 0) {
        monthSales += txn.total;
        monthBills++;
      }
      if (txn.date !== today) continue;
      if (txn.total > 0) {
        todaySales += txn.total;
        todayBills++;
      }
      if (txn.paid > 0) {
        todayPaid += txn.paid;
        // every cash sale is somebody different who paid
        if (txn.customerId === cashId) cashBuyers++;
        else payers.add(txn.customerId);
      }
    }
    const owing = (ledger?.customers ?? []).filter((c) => c.balance > 0.004);
    return {
      todaySales, todayBills, monthSales, monthBills, todayPaid, payers: payers.size + cashBuyers,
      totalDue: owing.reduce((s, c) => s + c.balance, 0),
      owingCount: owing.length,
    };
  }, [ledger, today]);

  const empty = ledger && !ledger.customers.some((c) => !isCashCustomer(c));

  return (
    <div className={`page home ${searching ? 'searching' : ''}`}>
      {!searching && (
        <div ref={headRef} className="home-head">
          <TopBar
            menu
            title={shopName}
            sub={fmtDateLong(today)}
            badge={
              paid && (
                <span className="premium-tag">
                  <Crown size={13} /> {t.plans.premiumBadge}
                </span>
              )
            }
            right={
              <>
                {!empty && (
                  <button className="icon-btn" aria-label={t.common.search} onClick={openSearch}>
                    <Search size={22} />
                  </button>
                )}
                <button className="icon-btn" aria-label={t.common.newCustomer} onClick={() => setAdding(true)}>
                  <UserPlus size={24} />
                </button>
              </>
            }
          />

          <AccessBanner />

          <section className={`stat-grid ${intro ? 'intro' : ''}`}>
            <StatCard
              icon={<TrendingUp size={16} />}
              label={t.home.todaySales}
              value={money(d.todaySales)}
              sub={d.todayBills ? t.home.billsToday(d.todayBills) : t.home.noBillsToday}
              accent="primary"
            />
            <StatCard
              icon={<CalendarRange size={16} />}
              label={t.home.monthSales}
              value={money(d.monthSales)}
              sub={t.home.bills(d.monthBills)}
              accent="primary"
            />
            <StatCard
              icon={<Wallet size={16} />}
              label={t.home.todayPaid}
              value={money(d.todayPaid)}
              sub={d.payers ? t.home.payers(d.payers) : t.home.noPayers}
              accent="good"
            />
            <StatCard
              icon={<Users size={16} />}
              label={t.home.totalDue}
              value={money(d.totalDue)}
              sub={t.home.owing(d.owingCount)}
              accent="due"
            />
          </section>

          {d.owingCount > 0 && (
            <Link className="remind-cta" to="/reminders">
              <BellRing size={20} />
              <span>
                <strong>{t.reminders.title}</strong>
                <small>{t.reminders.cta(d.owingCount)}</small>
              </span>
              <ChevronRight size={18} />
            </Link>
          )}
        </div>
      )}

      {empty && !searching ? (
        <section className="card">
          <Empty icon={<Users size={36} />} title={t.common.noCustomers}>
            <p>{t.home.emptyHelp}</p>
            <button className="btn primary pill" onClick={() => setAdding(true)}>
              <UserPlus size={18} /> {t.customers.add}
            </button>
            {/* nobody types two hundred names in: the old book can come in on its own */}
            <Link className="btn ghost pill" to="/import">
              <BookUp size={18} /> {t.importOld.title}
            </Link>
          </Empty>
        </section>
      ) : (
        <>
          <div ref={boxRef} className="home-search">
            <SearchField
              value={q}
              onChange={setQ}
              inputRef={inputRef}
              onFocus={openSearch}
              before={
                searching ? (
                  <button type="button" className="icon-btn search-back" aria-label={t.common.back} onClick={closeSearch}>
                    <ArrowLeft size={21} />
                  </button>
                ) : undefined
              }
            />
            {searching && rows && (
              <p className="search-count muted small">{query.trim() ? t.home.found(rows.length) : t.customers.count(rows.length)}</p>
            )}
          </div>

          <div ref={listRef} className="home-list">
            {searching && rows && <AddFromSearch q={query} rows={rows} />}
            {rows ? (
              <CustomerCards rows={rows} memory={searching ? 'find' : 'home'} resetOn={searching ? query : ''} />
            ) : (
              <ListSkeleton />
            )}
            {searching && rows && query.trim() && !rows.length && <p className="muted center">{t.customers.noMatch(query)}</p>}
          </div>
        </>
      )}

      <CustomerForm open={adding} onClose={() => setAdding(false)} onSaved={(id) => id && nav(`/c/${id}`)} />
    </div>
  );
}

/** Grey cards in the shape of the real ones while the khata is read, so nothing jumps when it comes. */
function ListSkeleton() {
  return (
    <section className="tile-section" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="cust-card skeleton">
          <div className="cust-main">
            <span className="cust-who">
              <span className="avatar" />
              <span className="tile-main">
                <i />
                <i />
              </span>
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}

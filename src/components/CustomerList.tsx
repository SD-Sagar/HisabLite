import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Plus, Search, UserPlus, Wallet, X } from 'lucide-react';
import { CustomerForm } from './CustomerForm';
import { normName } from './CustomerPicker';
import { QuickEntry } from './QuickEntry';
import { Balance } from './ui';
import { isCashCustomer, type TxnType } from '../db';
import { useT } from '../i18n';
import { initials, relativeDay } from '../lib/format';
import { useLedger, type CustomerRow } from '../lib/hooks';

/** Customers matching a search, whoever owes the most first: the list the shop looks at all day. */
export function useCustomerRows(q: string): CustomerRow[] | undefined {
  const ledger = useLedger();
  return useMemo(() => {
    if (!ledger) return undefined;
    const n = normName(q);
    const digits = q.replace(/\D/g, '');
    return ledger.customers
      // cash sales have no customer to show; they are in দিনের হিসাব
      .filter((c) => !isCashCustomer(c))
      .filter((c) => !n || normName(c.name).includes(n) || (!!digits && (c.phone ?? '').replace(/\D/g, '').includes(digits)))
      .sort((a, b) => b.balance - a.balance);
  }, [ledger, q]);
}

/** how many cards are drawn at a time */
const STEP = 40;

/** how far down each list had been drawn, so coming back to it finds the same place */
const drawn = new Map<string, number>();

/**
 * Draws a long list a screenful at a time: more cards are added as the shopkeeper scrolls near
 * the end. A khata of 400 customers used to build every card at once, which on an ordinary
 * phone froze the screen for seconds with the list and the bottom menu missing.
 */
function useProgressive(total: number, memory: string | undefined, resetOn: unknown) {
  const [count, setCount] = useState(() => Math.max(STEP, (memory && drawn.get(memory)) || 0));
  const sentinel = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useEffect(() => {
    // a new search starts again from the top of its results
    if (first.current) {
      first.current = false;
      return;
    }
    setCount(STEP);
  }, [resetOn]);

  useEffect(() => {
    if (memory) drawn.set(memory, count);
  }, [memory, count]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || count >= total) return;
    const io = new IntersectionObserver((seen) => seen.some((e) => e.isIntersecting) && setCount((c) => c + STEP), {
      rootMargin: '900px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [count, total]);

  return { count: Math.min(count, total), sentinel };
}

/**
 * Customer cards, each with the two buttons most shopkeepers need all day: goods given and
 * money taken. `memory` names the list, so going back to it restores how far it was drawn.
 */
export function CustomerCards({ rows, memory, resetOn }: { rows: CustomerRow[]; memory?: string; resetOn?: unknown }) {
  const nav = useNavigate();
  /** the customer whose entry box is open, and which way round it starts */
  const [entry, setEntry] = useState<{ customer: CustomerRow; type: TxnType } | null>(null);
  const { count, sentinel } = useProgressive(rows.length, memory, resetOn);
  const open = useCallback((id: number) => nav(`/c/${id}`), [nav]);
  const write = useCallback((customer: CustomerRow, type: TxnType) => setEntry({ customer, type }), []);

  return (
    <>
      <section className="tile-section cust-list">
        {rows.slice(0, count).map((c) => (
          <CustomerCard key={c.id} c={c} onOpen={open} onWrite={write} />
        ))}
        {count < rows.length && <div ref={sentinel} className="list-more" aria-hidden="true" />}
      </section>
      {entry && <QuickEntry customer={entry.customer} type={entry.type} onClose={() => setEntry(null)} />}
    </>
  );
}

const CustomerCard = memo(
  function CustomerCard({
    c,
    onOpen,
    onWrite,
  }: {
    c: CustomerRow;
    onOpen: (id: number) => void;
    onWrite: (c: CustomerRow, type: TxnType) => void;
  }) {
    const t = useT();
    return (
      <div className="cust-card">
        <button type="button" className="cust-main" onClick={() => onOpen(c.id)}>
          <span className="cust-who">
            <span className="avatar">{initials(c.name)}</span>
            <span className="tile-main">
              <strong>{c.name}</strong>
              <small>{c.lastDate ? t.common.lastTxn(relativeDay(c.lastDate)) : c.phone || t.customers.noTxns}</small>
            </span>
            <ChevronRight size={18} className="tile-chevron" />
          </span>
          {/* what is owed, in the middle of the card */}
          <span className="cust-due">
            <Balance value={c.balance} />
          </span>
        </button>
        {/* money in on the left, goods out on the right */}
        <div className="cust-actions">
          <button type="button" className="btn pay" onClick={() => onWrite(c, 'payment')}>
            <Wallet size={18} /> {t.common.deposit}
          </button>
          <button type="button" className="btn sale" onClick={() => onWrite(c, 'sale')}>
            <Plus size={20} strokeWidth={2.6} /> {t.common.sell}
          </button>
        </div>
      </div>
    );
  },
  // the ledger is rebuilt on every change; a card only redraws when what it shows changed
  (a, b) =>
    a.onOpen === b.onOpen &&
    a.onWrite === b.onWrite &&
    a.c.id === b.c.id &&
    a.c.name === b.c.name &&
    a.c.phone === b.c.phone &&
    a.c.balance === b.c.balance &&
    a.c.lastDate === b.c.lastDate,
);

/** The search field used above customer lists. */
export function SearchField({
  value,
  onChange,
  inputRef,
  autoFocus,
  onFocus,
  before,
}: {
  value: string;
  onChange: (q: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  onFocus?: () => void;
  /** e.g. a back arrow, inside the box on the left */
  before?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="search-box">
      {before ?? <Search size={19} />}
      <input
        ref={inputRef}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={t.common.search}
        value={value}
        onFocus={onFocus}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button type="button" className="icon-btn search-clear" aria-label={t.common.clear} onClick={() => onChange('')}>
          <X size={18} />
        </button>
      )}
    </div>
  );
}

/** When a search finds nobody by that name: make them a customer, straight from here. */
export function AddFromSearch({ q, rows }: { q: string; rows: CustomerRow[] }) {
  const t = useT();
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  const name = q.trim();
  if (!name || /^\d+$/.test(name.replace(/\s/g, '')) || rows.some((c) => normName(c.name) === normName(name))) return null;
  return (
    <>
      <button type="button" className="list-row add-row" onClick={() => setAdding(true)}>
        <span className="avatar sm new">
          <UserPlus size={16} />
        </span>
        <span className="list-main">
          <strong>{t.picker.addNew(name)}</strong>
        </span>
      </button>
      <CustomerForm open={adding} initialName={name} onClose={() => setAdding(false)} onSaved={(id) => id && nav(`/c/${id}`)} />
    </>
  );
}

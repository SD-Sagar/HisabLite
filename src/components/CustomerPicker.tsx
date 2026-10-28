import { useMemo, useState } from 'react';
import { Banknote, ChevronDown, Search, UserPlus } from 'lucide-react';
import { useLang, useT } from '../i18n';
import type { CustomerRow } from '../lib/hooks';
import { initials } from '../lib/format';
import { Balance, Modal } from './ui';

export const normName = (s: string) => s.toLowerCase().replace(/[\s.\-_,()]/g, '');

/**
 * Tap-to-open customer chooser. `newName` is shown when the entry will create a new customer
 * (used by the photo review screen). With `onCash`, a নগদ বিক্রি — no customer at all — can be
 * chosen too; `cash` says it is.
 */
export function CustomerPicker({
  customers,
  value,
  newName,
  cash,
  onCash,
  onPick,
  onNew,
}: {
  customers: CustomerRow[];
  value: number | null;
  newName?: string;
  cash?: boolean;
  onCash?: () => void;
  onPick: (id: number) => void;
  onNew: (name: string) => void;
}) {
  const t = useT();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const selected = customers.find((c) => c.id === value);

  const list = useMemo(() => {
    const n = normName(q);
    const rows = n
      ? customers.filter((c) => normName(c.name).includes(n) || c.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '') || '\0'))
      : customers;
    return [...rows].sort((a, b) => a.name.localeCompare(b.name, lang));
  }, [customers, q, lang]);

  const exact = customers.some((c) => normName(c.name) === normName(q));

  return (
    <>
      <button
        type="button"
        className="picker-btn"
        onClick={() => {
          setQ(selected ? '' : newName ?? '');
          setOpen(true);
        }}
      >
        {cash ? (
          <>
            <span className="avatar sm cash">
              <Banknote size={18} />
            </span>
            <span className="picker-name cash-name">
              {t.cash.name}
              <small>{t.cash.noKhata}</small>
            </span>
          </>
        ) : selected ? (
          <>
            <span className="avatar sm">{initials(selected.name)}</span>
            <span className="picker-name">{selected.name}</span>
            <Balance value={selected.balance} />
          </>
        ) : newName ? (
          <>
            <span className="avatar sm new">+</span>
            <span className="picker-name">
              {newName} <em className="chip warn">{t.common.newCustomer}</em>
            </span>
          </>
        ) : (
          <>
            <Search size={18} className="picker-search" />
            <span className="picker-placeholder">{t.picker.placeholder}</span>
          </>
        )}
        <ChevronDown size={18} />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={t.picker.title}>
        <div className="search-box">
          <Search size={18} />
          <input autoFocus placeholder={t.common.search} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {q.trim() && !exact && (
          <button
            type="button"
            className="list-row add-row"
            onClick={() => {
              onNew(q.trim());
              setOpen(false);
            }}
          >
            <span className="avatar sm new">
              <UserPlus size={16} />
            </span>
            <span className="list-main">
              <strong>{t.picker.addNew(q.trim())}</strong>
            </span>
          </button>
        )}
        <div className="list">
          {/* always there, even with a name typed: a scanned entry arrives with the name read from
              the page in the box, and may still turn out to be a cash sale */}
          {onCash && (
            <button
              type="button"
              className={`list-row cash-row ${cash ? 'selected' : ''}`}
              onClick={() => {
                onCash();
                setOpen(false);
              }}
            >
              <span className="avatar sm cash">
                <Banknote size={18} />
              </span>
              <span className="list-main">
                <strong>{t.cash.name}</strong>
                <small>{t.cash.noKhata}</small>
              </span>
            </button>
          )}
          {list.map((c) => (
            <button
              type="button"
              key={c.id}
              className={`list-row ${c.id === value ? 'selected' : ''}`}
              onClick={() => {
                onPick(c.id);
                setOpen(false);
              }}
            >
              <span className="avatar sm">{initials(c.name)}</span>
              <span className="list-main">
                <strong>{c.name}</strong>
                {c.phone && <small>{c.phone}</small>}
              </span>
              <Balance value={c.balance} />
            </button>
          ))}
          {!list.length && !q.trim() && <p className="muted center">{t.common.noCustomers}</p>}
        </div>
      </Modal>
    </>
  );
}

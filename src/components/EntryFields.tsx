import { useMemo, useState, type ReactNode } from 'react';
import { Banknote, Plus, ShoppingBasket, Wallet } from 'lucide-react';
import { isCashCustomer, type TxnType } from '../db';
import { useT } from '../i18n';
import { money, numInput, parseNum, round2, roundOptions, roundTotal, signedMoney, type RoundMode } from '../lib/format';
import { useCustomerTxns, type CustomerRow, type ItemCatalog } from '../lib/hooks';
import { CustomerPicker } from './CustomerPicker';
import { DateChip } from './DateChip';
import { draftsTotal, ItemsEditor, type DraftItem } from './ItemsEditor';
import { Segmented } from './ui';

export interface EntryDraft {
  type: TxnType;
  customerId: number | null;
  /** a নগদ বিক্রি: someone with no khata paid in full, so no customer is needed */
  cash: boolean;
  /** photo review only: a name that is not in the list yet, added as a customer on save */
  newName?: string;
  date: string;
  items: DraftItem[];
  /** how the lines' sum becomes the ফর্দ's total */
  round: RoundMode;
  paid: string;
  note: string;
}

/** how many recent customers are offered as one-tap chips */
const RECENT = 8;

/**
 * The ফর্দ / payment form, shared by the entry page and the photo review sheet:
 * who and when, the items (or the amount), then the money worked out like the bottom of a paper ফর্দ.
 */
export function EntryFields({
  draft,
  onChange,
  customers,
  catalog,
  prev,
  onNewCustomer,
  warning,
}: {
  draft: EntryDraft;
  onChange: (patch: Partial<EntryDraft>) => void;
  customers: CustomerRow[];
  catalog: ItemCatalog;
  /** বাকি before this entry; the running বাকি is shown only when it is known */
  prev?: number;
  onNewCustomer: (name: string) => void;
  /** shown under the items, e.g. when the total written on the page doesn't match */
  warning?: ReactNode;
}) {
  const t = useT();
  const sale = draft.type === 'sale';
  const cash = sale && draft.cash;
  const sum = sale ? draftsTotal(draft.items) : 0;
  const total = sale ? roundTotal(sum, draft.round) : 0;
  const adj = round2(total - sum);
  // a cash sale is paid in full; it has no বাকি before or after
  const paid = cash ? total : parseNum(draft.paid);
  const known = prev !== undefined && !cash;
  const after = round2((prev ?? 0) + total - paid);
  const setPaid = (value: string) => onChange({ paid: value });
  const history = useCustomerTxns(draft.customerId);
  // the hidden customer that holds cash sales is never one to pick by name
  const people = useMemo(() => customers.filter((c) => !isCashCustomer(c)), [customers]);

  // whoever the shop wrote for most recently, a tap away
  const recent = useMemo(
    () =>
      people
        .filter((c) => c.lastDate)
        .sort((a, b) => (b.lastDate ?? '').localeCompare(a.lastDate ?? '') || b.updatedAt - a.updatedAt)
        .slice(0, RECENT),
    [people],
  );
  const choosing = !draft.customerId && !draft.newName && !cash;
  const toCash = () => onChange({ cash: true, customerId: null });

  return (
    <>
      <Segmented
        value={draft.type}
        // money coming in is always someone's; it can't be a cash sale
        onChange={(type) => onChange(type === 'payment' ? { type, cash: false } : { type })}
        options={[
          { value: 'sale', label: <><ShoppingBasket size={18} /> {t.common.gaveGoods}</>, tone: 'sale' },
          { value: 'payment', label: <><Wallet size={18} /> {t.common.gotMoney}</>, tone: 'pay' },
        ]}
      />

      <section className="card entry-who">
        <CustomerPicker
          customers={people}
          value={cash ? null : draft.customerId}
          newName={draft.customerId || cash ? undefined : draft.newName}
          cash={cash}
          onCash={sale ? toCash : undefined}
          onPick={(id) => onChange({ customerId: id, cash: false })}
          onNew={onNewCustomer}
        />
        {choosing && (sale || recent.length > 0) && (
          <div className="recent-chips">
            <small className="muted">{t.entry.recent}</small>
            <div className="chips">
              {sale && (
                <button type="button" className="chip action cash-chip" onClick={toCash}>
                  <Banknote size={16} /> {t.cash.name}
                </button>
              )}
              {recent.map((c) => (
                <button type="button" key={c.id} className="chip action" onClick={() => onChange({ customerId: c.id })}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <DateChip value={draft.date} onChange={(date) => onChange({ date })} />
      </section>

      {sale ? (
        <section className="card">
          <h2 className="card-title">{t.entry.itemsTitle}</h2>
          <ItemsEditor items={draft.items} onChange={(items) => onChange({ items })} catalog={catalog} history={history} />
          {warning}
        </section>
      ) : (
        <section className="card form">
          <label className="field">
            <span>{t.entry.amountLabel}</span>
            <span className="money-input big">
              <span>₹</span>
              <input inputMode="decimal" placeholder="0" value={draft.paid} onChange={(e) => setPaid(e.target.value)} />
            </span>
          </label>
          {known && (prev ?? 0) > 0.004 && (
            <div className="chips">
              <button type="button" className="chip action" onClick={() => setPaid(numInput(prev))}>
                {t.entry.allDue(money(prev ?? 0))}
              </button>
            </div>
          )}
          {warning}
        </section>
      )}

      {(sale || known) && (
        <section className="card summary">
          {known && (
            <div>
              <span>{t.common.prevDue}</span>
              <b>{money(prev)}</b>
            </div>
          )}
          {/* the lines' sum and the round-off, as the printed ফর্দ shows them */}
          {sale && adj !== 0 && (
            <>
              <div className="summary-sub">
                <span>{t.entry.subtotal}</span>
                <span>{money(sum)}</span>
              </div>
              <div className="summary-sub">
                <span>{t.entry.roundOff}</span>
                <span>{signedMoney(adj)}</span>
              </div>
            </>
          )}
          {sale && (
            <div>
              <span>{t.common.todayGoods}</span>
              <b>
                {known && '+ '}
                {money(total)}
              </b>
            </div>
          )}
          {sale && <RoundChips sum={sum} total={total} onPick={(round) => onChange({ round })} />}
          {cash ? (
            <div className="summary-total">
              <span>{t.cash.received}</span>
              <b className="tone-advance">{money(total)}</b>
            </div>
          ) : sale ? (
            <>
              <label className="summary-paid">
                <span>{t.entry.cashPaid}</span>
                <span className="money-input">
                  <span>− ₹</span>
                  <input inputMode="decimal" placeholder="0" value={draft.paid} onChange={(e) => setPaid(e.target.value)} />
                </span>
              </label>
              {/* most payments are "all of today's" or "everything": one tap instead of typing it */}
              {total > 0 && (
                <div className="chips paid-chips">
                  <button type="button" className="chip action" onClick={() => setPaid(numInput(total))}>
                    {t.entry.paidToday(money(total))}
                  </button>
                  {known && (prev ?? 0) > 0.004 && (
                    <button type="button" className="chip action" onClick={() => setPaid(numInput(round2((prev ?? 0) + total)))}>
                      {t.entry.paidAll(money(round2((prev ?? 0) + total)))}
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <div>
              <span>{t.common.paid}</span>
              <b className="tone-advance">− {money(paid)}</b>
            </div>
          )}
          {known && (
            <div className="summary-total">
              <span>{after < -0.004 ? t.balance.advance : t.entry.dueNow}</span>
              <b className={after > 0.004 ? 'tone-due' : after < -0.004 ? 'tone-advance' : ''}>{money(Math.abs(after))}</b>
            </div>
          )}
        </section>
      )}

      <NoteField value={draft.note} onChange={(note) => onChange({ note })} />
    </>
  );
}

/**
 * The round figures the day's goods can come to — to the rupee, down or up to a ten, or exactly
 * as added — one tap each. Nothing shows when the sum is already round.
 */
function RoundChips({ sum, total, onPick }: { sum: number; total: number; onPick: (round: RoundMode) => void }) {
  const t = useT();
  const options = roundOptions(sum);
  if (options.length < 2) return null;
  return (
    <div className="round-chips">
      <small className="muted">{t.entry.roundOff}</small>
      <div className="chips" role="radiogroup" aria-label={t.entry.roundOff}>
        {options.map((o) => {
          const on = Math.abs(o.total - total) < 0.005;
          return (
            <button
              type="button"
              key={o.mode}
              role="radio"
              aria-checked={on}
              className={`chip action ${on ? 'on' : ''}`}
              onClick={() => onPick(o.mode)}
            >
              {money(o.total)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Most entries have no note, so it stays a small button until it is needed. */
function NoteField({ value, onChange }: { value: string; onChange: (note: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!open && !value) {
    return (
      <button type="button" className="btn ghost small" onClick={() => setOpen(true)}>
        <Plus size={16} /> {t.entry.addNote}
      </button>
    );
  }
  return (
    <section className="card">
      <label className="field">
        <span>{t.common.note}</span>
        <input autoFocus={open} value={value} placeholder={t.entry.notePlaceholder} onChange={(e) => onChange(e.target.value)} />
      </label>
    </section>
  );
}

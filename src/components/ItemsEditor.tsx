import { useEffect, useMemo, useState } from 'react';
import { Check, History, Plus, Trash2, X } from 'lucide-react';
import type { LineItem, Txn } from '../db';
import { tr, useT } from '../i18n';
import { money, num, numInput, parseNum, round2, roundTotal, type RoundMode } from '../lib/format';
import type { ItemCatalog } from '../lib/hooks';
import { patchSettings, useSettings } from '../settings';
import { Keypad } from './Keypad';
import { Modal } from './ui';

/** An item row as typed — numbers stay strings so "12." or "১২" can be edited freely. */
export interface DraftItem {
  key: string;
  name: string;
  qty: string;
  unit: string;
  rate: string;
  amount: string;
}

let seq = 0;
const nextKey = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`;

export const emptyItem = (): DraftItem => ({ key: nextKey(), name: '', qty: '', unit: tr().units[0], rate: '', amount: '' });

export const itemToDraft = (it: Partial<LineItem> & { name: string }): DraftItem => ({
  key: nextKey(),
  name: it.name,
  qty: numInput(it.qty),
  unit: it.unit ?? '',
  rate: numInput(it.rate),
  amount: numInput(it.amount ?? (it.qty && it.rate ? it.qty * it.rate : 0)),
});

export function draftToItem(d: DraftItem): LineItem | null {
  const qty = parseNum(d.qty);
  const rate = parseNum(d.rate);
  const amount = parseNum(d.amount) || round2(qty * rate);
  if (!d.name.trim() && !amount) return null;
  return { name: d.name.trim() || tr().common.goods, qty, unit: d.unit.trim(), rate, amount };
}

export const draftsTotal = (items: DraftItem[]) =>
  round2(items.reduce((sum, d) => sum + (draftToItem(d)?.amount ?? 0), 0));

/** What a ফর্দ comes to: its lines added up, then rounded the way the shop chose. */
export const draftTotal = (d: { items: DraftItem[]; round: RoundMode }) => roundTotal(draftsTotal(d.items), d.round);

const isBlank = (d: DraftItem) => !d.name.trim() && !d.qty && !d.rate && !d.amount;

/** An amount that was only qty × rate goes away with them; one typed by hand stays. */
function recalc(it: DraftItem, patch: Partial<DraftItem>): DraftItem {
  const next = { ...it, ...patch };
  if ('qty' in patch || 'rate' in patch) {
    const q = parseNum(next.qty);
    const r = parseNum(next.rate);
    const wasWorkedOut = !it.amount || parseNum(it.amount) === round2(parseNum(it.qty) * parseNum(it.rate));
    if (q && r) {
      if (wasWorkedOut) next.amount = String(round2(q * r));
    } else if (wasWorkedOut) next.amount = '';
  }
  return next;
}

/** fruit tiles shown before "all" is tapped */
const TILES = 12;

/**
 * The lines of a ফর্দ, written like paper — “আম  20 কেজি × ₹80  ₹1,600” — with fruit tiles
 * underneath. A tap on a fruit opens a big keypad with that fruit's last rate already in, so most
 * lines are: tap the fruit, type the weight, done. Tapping a line opens it again to change it.
 * The same fruit can go on twice at two rates; fruits the shop never sells can be taken off.
 */
export function ItemsEditor({
  items,
  onChange,
  catalog,
  history = [],
}: {
  items: DraftItem[];
  onChange: (items: DraftItem[]) => void;
  catalog: ItemCatalog;
  /** this customer's earlier entries, oldest first: their own rates, and "same as last time" */
  history?: Txn[];
}) {
  const t = useT();
  const settings = useSettings();
  const [open, setOpen] = useState<{ item: DraftItem; isNew: boolean } | null>(null);
  const [allTiles, setAllTiles] = useState(false);
  /** taking the fruits the shop doesn't sell off the tiles */
  const [pruning, setPruning] = useState(false);
  const lines = items.filter((it) => !isBlank(it));
  const hiddenList = settings?.hiddenItems;
  const hidden = useMemo(() => new Set(hiddenList ?? []), [hiddenList]);

  /** this customer's own last rate and unit for an item, or the shop's latest */
  const lastFor = useMemo(() => {
    const own = new Map<string, { unit: string; rate: number }>();
    for (const txn of history) for (const it of txn.items) if (it.name.trim()) own.set(it.name.trim(), { unit: it.unit, rate: it.rate });
    return (name: string) => own.get(name.trim()) ?? catalog.last.get(name.trim());
  }, [history, catalog.last]);

  const lastBill = useMemo(() => [...history].reverse().find((x) => x.type === 'sale' && x.items.length), [history]);

  const startItem = (name: string) => {
    // a fruit already on the ফর্দ opens its latest line, so a wrong weight is fixed, not added twice;
    // a second lot of it at another rate is one more tap in there
    const existing = name ? lines.findLast((it) => it.name.trim() === name.trim()) : undefined;
    if (existing) return setOpen({ item: existing, isNew: false });
    const known = name ? lastFor(name) : undefined;
    setOpen({
      item: { ...emptyItem(), name, unit: known?.unit || tr().units[0], rate: known ? numInput(known.rate) : '' },
      isNew: true,
    });
  };

  /** another line of the same fruit, starting from the rate and unit of the one before */
  const again = (from: DraftItem) => setOpen({ item: { ...emptyItem(), name: from.name, unit: from.unit, rate: from.rate }, isNew: true });

  const unhide = (name: string) => void patchSettings((s) => ({ hiddenItems: s.hiddenItems.filter((n) => n !== name) }));
  const hide = (name: string) => void patchSettings((s) => ({ hiddenItems: [...new Set([...s.hiddenItems, name])] }));

  const save = (item: DraftItem) => {
    const exists = lines.some((it) => it.key === item.key);
    onChange(exists ? lines.map((it) => (it.key === item.key ? item : it)) : [...lines, item]);
    setOpen(null);
    // a fruit taken off the tiles and then typed in by hand is being sold again
    if (hidden.has(item.name.trim())) unhide(item.name.trim());
  };

  const remove = (key: string) => {
    onChange(lines.filter((it) => it.key !== key));
    setOpen(null);
  };

  /** how often each fruit is on the ফর্দ, and its latest line */
  const added = new Map<string, { last: DraftItem; times: number }>();
  for (const it of lines) added.set(it.name.trim(), { last: it, times: (added.get(it.name.trim())?.times ?? 0) + 1 });
  const shown = catalog.names.filter((n) => !hidden.has(n));
  const tiles = allTiles || pruning ? shown : shown.slice(0, TILES);

  return (
    <div className="items-editor">
      <div className="bill-lines">
        {lines.map((it, i) => {
          const done = draftToItem(it);
          return (
            <button type="button" key={it.key} className="bill-line" onClick={() => setOpen({ item: it, isNew: false })}>
              <span className="bl-no">{i + 1}</span>
              <span className="bl-main">
                <strong>{it.name || t.common.goods}</strong>
                <small>
                  {[parseNum(it.qty) ? `${num(parseNum(it.qty))} ${it.unit}`.trim() : '', parseNum(it.rate) ? `× ${money(parseNum(it.rate))}` : '']
                    .filter(Boolean)
                    .join(' ')}
                </small>
              </span>
              <b className="bl-amt">{money(done?.amount ?? 0)}</b>
            </button>
          );
        })}
        {!lines.length && <p className="bill-lines-empty">{t.items.tapFruit}</p>}
        <button type="button" className="bill-line add" onClick={() => startItem('')}>
          <Plus size={18} /> {t.items.other}
        </button>
      </div>

      {!lines.length && lastBill && (
        <button
          type="button"
          className="repeat-btn"
          // each line at its own rate, so a fruit taken twice at two rates comes back as it was
          onClick={() => onChange(lastBill.items.map((it) => itemToDraft(it)))}
        >
          <History size={18} />
          <span>
            <strong>{t.items.repeat}</strong>
            <small>{lastBill.items.map((it) => it.name).join(', ')}</small>
          </span>
        </button>
      )}

      {/* the tiles wait for the shop's list of removed fruits, so none flashes up and vanishes */}
      {settings && (
        <>
          {pruning && <p className="notice warn prune-help">{t.items.editHelp}</p>}
          <div className="fruit-grid">
            {tiles.map((name) => {
              const last = lastFor(name);
              const has = pruning ? undefined : added.get(name);
              return (
                <button
                  type="button"
                  key={name}
                  className={`fruit-tile ${has ? 'added' : ''} ${pruning ? 'prune' : ''}`}
                  onClick={() => (pruning ? hide(name) : startItem(name))}
                >
                  <strong>{name}</strong>
                  <small>
                    {has
                      ? has.times > 1
                        ? t.items.times(has.times)
                        : `${num(parseNum(has.last.qty))} ${has.last.unit}`
                      : last?.rate
                        ? `${money(last.rate)}/${last.unit}`
                        : ' '}
                  </small>
                  {pruning ? (
                    <span className="fruit-x">
                      <X size={13} strokeWidth={3} />
                    </span>
                  ) : (
                    has && <span className="fruit-check">{has.times > 1 ? has.times : <Check size={13} strokeWidth={3} />}</span>
                  )}
                </button>
              );
            })}
            {!pruning && shown.length > TILES && (
              <button type="button" className="fruit-tile more" onClick={() => setAllTiles(!allTiles)}>
                <strong>{allTiles ? t.items.fewer : t.items.more}</strong>
              </button>
            )}
          </div>

          {pruning ? (
            <div className="prune-foot">
              {settings.hiddenItems.length > 0 && (
                <>
                  <small className="muted">{t.items.hiddenTitle}</small>
                  <div className="chips">
                    {settings.hiddenItems.map((name) => (
                      <button type="button" key={name} className="chip action" onClick={() => unhide(name)}>
                        <Plus size={14} /> {name}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <button type="button" className="btn primary block" onClick={() => setPruning(false)}>
                <Check size={18} /> {t.items.editDone}
              </button>
            </div>
          ) : (
            <button type="button" className="btn ghost small prune-btn" onClick={() => setPruning(true)}>
              <Trash2 size={15} /> {t.items.editTiles}
            </button>
          )}
        </>
      )}

      <ItemSheet
        open={open}
        catalog={catalog}
        lastFor={lastFor}
        onClose={() => setOpen(null)}
        onSave={save}
        onRemove={remove}
        onAgain={again}
      />
    </div>
  );
}

type Field = 'qty' | 'rate' | 'amount';

/** One line of the ফর্দ on a big keypad: how much, at what rate, and the total worked out. */
function ItemSheet({
  open,
  catalog,
  lastFor,
  onClose,
  onSave,
  onRemove,
  onAgain,
}: {
  open: { item: DraftItem; isNew: boolean } | null;
  catalog: ItemCatalog;
  lastFor: (name: string) => { unit: string; rate: number } | undefined;
  onClose: () => void;
  onSave: (item: DraftItem) => void;
  onRemove: (key: string) => void;
  /** the same fruit once more, on a line of its own */
  onAgain: (from: DraftItem) => void;
}) {
  const t = useT();
  const [d, setD] = useState<DraftItem>(emptyItem);
  const [field, setField] = useState<Field>('qty');
  /** the next key replaces what is in the box instead of adding to it */
  const [fresh, setFresh] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const naming = !!open && !open.item.name;

  useEffect(() => {
    if (!open) return;
    setD(open.item);
    setField('qty');
    // a line opened again: the first key replaces the old weight rather than adding to it
    setFresh(!open.isNew);
    setHint(null);
  }, [open]);

  const choose = (f: Field) => {
    setField(f);
    setFresh(true);
    setHint(null);
  };

  const type = (k: string) => {
    setHint(null);
    setD((was) => {
      const current = fresh ? '' : was[field];
      if (k === '.' && current.includes('.')) return was;
      const value = (current === '0' && k !== '.' ? '' : current) + k;
      if (value.replace('.', '').length > 9) return was;
      return field === 'amount' ? { ...was, amount: value } : recalc(was, { [field]: value });
    });
    setFresh(false);
  };

  const back = () => {
    setD((was) => {
      const value = fresh ? '' : was[field].slice(0, -1);
      return field === 'amount' ? { ...was, amount: value } : recalc(was, { [field]: value });
    });
    setFresh(false);
  };

  const done = () => {
    const name = d.name.trim();
    if (!name) return setHint(t.items.needName);
    const q = parseNum(d.qty);
    const amount = parseNum(d.amount) || round2(q * parseNum(d.rate));
    if (!q && !amount) {
      choose('qty');
      return setHint(t.items.needQty);
    }
    if (q && !amount) {
      choose('rate');
      return setHint(t.items.needRate);
    }
    onSave({ ...d, name, amount: String(amount) });
  };

  // a computer's keyboard works too: digits, point, backspace, Enter, and Tab to the next box
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (/^[0-9.]$/.test(e.key)) type(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Enter') done();
      else if (e.key === 'Tab') {
        e.preventDefault();
        choose(field === 'qty' ? 'rate' : field === 'rate' ? 'amount' : 'qty');
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const units = [...new Set([d.unit, ...catalog.units].filter(Boolean))].slice(0, 10);
  const q = parseNum(d.qty);
  const r = parseNum(d.rate);
  // a line already on the ফর্দ, not yet touched: the customer may have taken this fruit again.
  // (d is this very object until the first key; any change makes a new one)
  const offerAgain = !!open && !open.isNew && !!open.item.name && d === open.item;

  const box = (f: Field, label: string, shown: string, after?: string) => (
    <button type="button" className={`calc-row ${field === f ? 'active' : ''}`} onClick={() => choose(f)}>
      <span className="calc-label">{label}</span>
      <span className="calc-value">
        {shown || <em>0</em>}
        {field === f && <i className="caret" />}
      </span>
      {after && <span className="calc-after">{after}</span>}
    </button>
  );

  return (
    <Modal
      open={!!open}
      onClose={onClose}
      title={open?.item.name || t.items.other}
      className="item-sheet"
      footer={
        <>
          {open && !open.isNew && (
            <button type="button" className="btn danger-ghost" onClick={() => onRemove(d.key)} aria-label={t.items.remove}>
              <Trash2 size={18} />
            </button>
          )}
          <button type="button" className="btn primary big grow" onClick={done}>
            <Check size={20} /> {open?.isNew ? t.items.addLine : t.common.ok}
          </button>
        </>
      }
    >
      {offerAgain && (
        <button type="button" className="repeat-btn again-btn" onClick={() => onAgain(open.item)}>
          <Plus size={20} />
          <span>
            <strong>{t.items.again(open.item.name)}</strong>
            <small>{t.items.againHelp}</small>
          </span>
        </button>
      )}

      {naming && (
        <label className="field">
          <span>{t.items.name}</span>
          <input
            list="item-names"
            autoFocus
            placeholder={t.items.namePlaceholder}
            value={d.name}
            onChange={(e) => {
              const name = e.target.value;
              const known = lastFor(name);
              setD((was) => (known && !was.rate ? recalc({ ...was, name, unit: known.unit || was.unit }, { rate: numInput(known.rate) }) : { ...was, name }));
            }}
          />
          <datalist id="item-names">
            {catalog.names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
      )}

      <div className="calc">
        {box('qty', t.items.qty, d.qty, d.unit)}
        {box('rate', t.items.rate, d.rate ? `₹${d.rate}` : '', d.unit ? `/ ${d.unit}` : undefined)}
        {box('amount', t.items.amount, d.amount ? `₹${d.amount}` : q && r ? `₹${num(round2(q * r))}` : '')}
      </div>

      <div className="unit-chips" role="radiogroup" aria-label={t.items.unit}>
        {units.map((u) => (
          <button
            type="button"
            key={u}
            role="radio"
            aria-checked={d.unit === u}
            className={`chip action ${d.unit === u ? 'on' : ''}`}
            onClick={() => setD((was) => ({ ...was, unit: u }))}
          >
            {u}
          </button>
        ))}
      </div>

      {hint && <p className="notice warn calc-hint">{hint}</p>}
      <Keypad dot onDigit={type} onBack={back} className="calc-keys" />
    </Modal>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Banknote, CalendarDays, Camera, CheckCircle2, KeyRound, Loader2, MessageCircle, Pencil, PenLine,
  ReceiptText, RefreshCw, ScanLine, Sparkles, Trash2, Undo2, ZoomIn,
} from 'lucide-react';
import { addCustomer, addImage, addTxn, balanceAround, cashCustomerId, db, isCashCustomer, nextBillNo, type NewRow, type Txn } from '../db';
import { normName } from '../components/CustomerPicker';
import { DateChip } from '../components/DateChip';
import { EntryFields, type EntryDraft } from '../components/EntryFields';
import { ImageViewer } from '../components/ImageViewer';
import { PagePicker, usePages } from '../components/PagePicker';
import { draftToItem, draftTotal, emptyItem, itemToDraft } from '../components/ItemsEditor';
import { SendSheet, type SendRequest } from '../components/SendSheet';
import { Modal, TopBar, toast } from '../components/ui';
import { useT } from '../i18n';
import { fmtDate, initials, isValidISODate, money, numInput, parseNum, qtyText, round2, signedMoney, todayISO } from '../lib/format';
import { useItemCatalog, useLedger, type CustomerRow } from '../lib/hooks';
import { saveHandSample, useHandSample } from '../lib/hand';
import { prepareImage } from '../lib/image';
import type { ScanResult } from '../lib/ocr';
import { entryMessage } from '../lib/template';
import { activeKey, activeModel, forMessages, modelName, saveSettings, scanModel, useSettings } from '../settings';
import { usePremium } from '../components/Access';
import { canScan, SCAN_OPEN_TO_ALL, useShopStatus } from '../lib/access';
import { useAccount } from '../lib/auth';
import { cloudEnabled } from '../lib/cloud';

interface ScanDraft extends EntryDraft {
  key: string;
  /** which photo this entry was read from, 1 for the first */
  page: number;
  include: boolean;
  /** opened and closed again by the owner, so its warnings have been seen */
  checked: boolean;
  newName: string;
  writtenTotal: number | null;
  confidence: 'high' | 'medium' | 'low';
}

interface SavedEntry {
  txn: Txn;
  customerName: string;
  phone: string;
  cash: boolean;
}

type Step = 'pick' | 'reading' | 'review' | 'done';

/** One khata opened flat, or two thin ones. Past this a photo holds too little of each line. */
const MAX_PAGES = 6;

function toDrafts(result: ScanResult, customers: CustomerRow[], pages: number): ScanDraft[] {
  const today = todayISO();
  const pageDate = isValidISODate(result.page_date) ? result.page_date : today;
  return result.entries.map((e, i) => {
    const byId = customers.find((c) => c.id === e.matched_customer_id);
    const byName = byId ?? customers.find((c) => normName(c.name) === normName(e.customer_name));
    return {
      key: `s${i}`,
      page: Math.min(Math.max(1, Math.round(e.page ?? 1)), pages),
      include: true,
      checked: false,
      customerId: byName?.id ?? null,
      cash: false,
      newName: e.customer_name.trim(),
      type: e.type,
      date: isValidISODate(e.date) && e.date <= today ? e.date : pageDate,
      items: e.items.length ? e.items.map((it) => itemToDraft({ ...it, unit: it.unit ?? '', qty: it.qty ?? 0, rate: it.rate ?? 0, amount: it.amount ?? undefined })) : [emptyItem()],
      // the khata's own figures, as written; the shop can round one while checking it
      round: 'exact',
      paid: numInput(e.paid),
      note: e.note ?? '',
      writtenTotal: e.written_total,
      confidence: e.confidence,
    };
  });
}

/** the date most entries on the page share */
function commonDate(drafts: ScanDraft[]) {
  const count = new Map<string, number>();
  for (const d of drafts) count.set(d.date, (count.get(d.date) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? todayISO();
}

/** the page's own total, when it was written and the items don't add up to it */
function mismatchOf(d: ScanDraft) {
  if (d.type !== 'sale' || d.writtenTotal == null) return null;
  const sum = draftTotal(d);
  return Math.abs(round2(d.writtenTotal) - sum) > 0.5 ? { written: d.writtenTotal, sum } : null;
}

/** One saved entry written out the way it reads on paper, for the handwriting sample. */
function sampleLine(d: ScanDraft, customers: CustomerRow[], cashName: string) {
  const name = d.cash ? cashName : (customers.find((c) => c.id === d.customerId)?.name ?? d.newName.trim());
  const paid = d.cash ? draftTotal(d) : parseNum(d.paid);
  if (d.type === 'payment') return `${name} — payment ${paid}`;
  const items = d.items
    .map(draftToItem)
    .filter((x): x is NonNullable<typeof x> => !!x)
    .map((it) => [it.name, it.qty ? `${it.qty} ${it.unit}`.trim() : '', it.rate ? `× ${it.rate}` : '', `= ${it.amount}`].filter(Boolean).join(' '));
  return [`${name} — ${items.join('; ')}`, `total ${draftTotal(d)}`, paid ? `cash ${paid}` : ''].filter(Boolean).join(' | ');
}

export default function Scan() {
  const t = useT();
  const settings = useSettings();
  const ledger = useLedger();
  const catalog = useItemCatalog();

  const sample = useHandSample();
  const status = useShopStatus();
  const { shopId } = useAccount();
  const premium = usePremium();
  const pages = usePages(MAX_PAGES);
  const { files, previews } = pages;
  const [step, setStep] = useState<Step>('pick');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<ScanDraft[]>([]);
  const [pageDate, setPageDate] = useState(todayISO());
  const [editKey, setEditKey] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedEntry[]>([]);
  /** the page being looked at full size, if any */
  const [zoom, setZoom] = useState<number | null>(null);
  const [send, setSend] = useState<SendRequest | null>(null);

  const reset = () => {
    pages.clear();
    setDrafts([]);
    setWarnings([]);
    setSaved([]);
    setError(null);
    setStep('pick');
  };

  // Shops read their khata on the owner's key, kept on the server. The owner can still use a key
  // of their own on this phone (to test one), and the app built without the cloud always does.
  const server = cloudEnabled && !(!!status?.isAdmin && !!settings && !!activeKey(settings));

  /** careful = the shopkeeper asked for another look: a bigger picture, the other model, slower reading */
  const read = async (careful = false) => {
    if (!files.length || !settings || !ledger) return;
    setStep('reading');
    setError(null);
    try {
      // the AI code is large, so it is only loaded when a photo is actually read
      const [{ readLedgerPhoto }, shots] = await Promise.all([
        import('../lib/ocr'),
        Promise.all(files.map((f) => prepareImage(f, careful ? 3000 : 2400, careful ? 0.92 : 0.88))),
      ]);
      const { result, model } = await readLedgerPhoto(server ? 'gemini' : settings.provider, {
        apiKey: server ? '' : activeKey(settings),
        server,
        model: scanModel(settings, server, careful),
        images: shots.map(({ base64, mediaType }) => ({ base64, mediaType })),
        // never the hidden cash customer: an entry matched to it would hold a বাকি nobody owes
        customers: ledger.customers.filter((c) => !isCashCustomer(c)).map((c) => ({ id: c.id, name: c.name })),
        items: catalog.names,
        // what the shopkeeper told us about their own khata, and a page in their own hand
        style: settings.khataStyle,
        sample: sample ? { base64: sample.base64, text: sample.text } : undefined,
        today: todayISO(),
        lang: settings.lang,
        careful,
      });
      if (!result.entries.length) {
        setError(t.scan.nothingFound);
        setStep('pick');
        return;
      }
      const found = toDrafts(result, ledger.customers, files.length);
      setDrafts(found);
      setPageDate(commonDate(found));
      const chosen = server ? settings.geminiModel : activeModel(settings);
      const switched = (server || settings.provider === 'gemini') && model !== chosen;
      // remember the model that worked so the next page goes straight to it
      if (switched) await saveSettings({ ...settings, geminiModel: model });
      setWarnings([
        ...(switched
          ? [t.scan.switched(modelName(chosen), modelName(model))]
          : []),
        ...result.warnings,
      ]);
      setStep('review');
    } catch (e) {
      console.error(e);
      const { OcrError } = await import('../lib/ocr');
      setError(e instanceof OcrError ? e.message : t.common.genericError);
      setStep('pick');
    }
  };

  const patch = (key: string, p: Partial<ScanDraft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)));

  // entries on the page's date move with it; one written under another date keeps its own
  const movePageDate = (date: string) => {
    setDrafts((ds) => ds.map((d) => (d.date === pageDate ? { ...d, date } : d)));
    setPageDate(date);
  };

  const chosen = drafts.filter((d) => d.include);
  const editing = drafts.find((d) => d.key === editKey);

  const closeSheet = () => {
    if (editKey) patch(editKey, { checked: true });
    setEditKey(null);
  };

  const saveAll = async () => {
    if (!files.length || !chosen.length) return;
    const missing = chosen.find((d) => !d.cash && !d.customerId && !d.newName.trim());
    if (missing) return toast(t.scan.needNames);

    const stored = await Promise.all(files.map((f) => prepareImage(f, 1400, 0.7)));
    const now = Date.now();
    const result: SavedEntry[] = [];
    const cashId = chosen.some((d) => d.cash && d.type === 'sale') ? await cashCustomerId(shopId, t.cash.name) : null;

    await db.transaction('rw', db.customers, db.txns, db.images, async () => {
      const imageIds: number[] = [];
      for (const page of stored) imageIds.push(await addImage(page.blob, now));
      const created = new Map<string, number>();
      let no = await nextBillNo();
      for (const [i, d] of chosen.entries()) {
        const cash = d.cash && d.type === 'sale';
        let customerId = cash ? cashId : d.customerId;
        if (!customerId) {
          const key = normName(d.newName);
          customerId = created.get(key) ?? null;
          if (!customerId) {
            customerId = await addCustomer({
              name: d.newName.trim(), phone: '', address: '', openingBalance: 0, createdAt: now, updatedAt: now,
            });
            created.set(key, customerId);
          }
        }
        const items = d.type === 'sale' ? d.items.map(draftToItem).filter((x): x is NonNullable<typeof x> => !!x) : [];
        const total = d.type === 'sale' ? draftTotal(d) : 0;
        const txn: NewRow<Txn> = {
          no: no++,
          customerId,
          date: d.date,
          type: d.type,
          items,
          total,
          // a cash sale is paid in full, so it leaves nobody owing
          paid: cash ? total : parseNum(d.paid),
          note: d.note.trim(),
          source: 'scan',
          imageId: imageIds[d.page - 1] ?? imageIds[0],
          createdAt: now + i, // keeps page order stable within the day
          updatedAt: now,
        };
        const id = await addTxn(txn);
        const c = await db.customers.get(customerId);
        result.push({
          txn: (await db.txns.get(id))!,
          customerName: cash ? t.cash.name : (c?.name ?? d.newName),
          phone: cash ? '' : (c?.phone ?? ''),
          cash,
        });
      }
    });

    setSaved(result);
    setStep('done');
    toast(`${t.scan.savedN(result.length)} ✓`);
  };

  const sendSaved = async (s: SavedEntry) => {
    if (!settings) return;
    const bal = s.cash ? { before: 0, after: 0 } : await balanceAround(s.txn);
    const customer = { name: s.customerName, phone: s.phone };
    const data = { customer, txn: s.txn, ...bal, cash: s.cash };
    setSend({
      title: t.scan.sendTo(s.customerName),
      customerName: s.customerName,
      phone: s.phone,
      message: entryMessage(data, forMessages(settings, premium)),
      bill: data,
    });
  };

  /** Keeps this page as the example of this shop's hand, for every scan from now on. */
  const keepSample = async () => {
    // the first page that still has entries on it: image and reading have to be of the same page
    const no = chosen[0]?.page ?? 1;
    const onPage = chosen.filter((d) => d.page === no);
    if (!files[no - 1] || !onPage.length) return;
    const img = await prepareImage(files[no - 1], 1200, 0.8);
    await saveHandSample({
      base64: img.base64,
      text: onPage.map((d) => sampleLine(d, ledger?.customers ?? [], t.cash.name)).join('\n'),
      savedAt: Date.now(),
    });
    toast(t.scan.sampleKept);
  };

  // without the cloud the key has to be on this phone; with it, the owner has to have put one on the server
  const noKey = !server && settings && !activeKey(settings);
  const aiOff = server && status?.aiReady === false;
  const ownKey = !cloudEnabled || !!status?.isAdmin;
  const editingMismatch = editing && mismatchOf(editing);

  // still being worked on: shops see what is coming, and are sent to the ফর্দ meanwhile
  if (!canScan(status)) {
    return (
      <div className="page">
        <TopBar menu title={t.scan.title} />
        {status !== undefined && (
          <section className="card scan-soon">
            <span className="scan-soon-icon">
              <ScanLine size={40} />
            </span>
            <span className="soon-tag">{t.nav.soon}</span>
            <h2>{t.scan.soonTitle}</h2>
            <p className="muted">{t.scan.soonHelp}</p>
            <Link className="btn primary big block" to="/entry/new">
              <ReceiptText size={20} /> {t.scan.soonAction}
            </Link>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className={`page ${step === 'review' ? 'wide has-actions' : ''}`}>
      <TopBar menu title={t.scan.title} />

      {cloudEnabled && !SCAN_OPEN_TO_ALL && <p className="notice info">{t.scan.adminOnly}</p>}

      {(noKey || aiOff) && (
        <div className="notice warn">
          <KeyRound size={18} />
          <div>
            {noKey ? (
              <>
                {t.scan.needKey} <Link to="/settings#ai">{t.scan.goSettings}</Link>
              </>
            ) : ownKey ? (
              <>
                {t.scan.needServerKey} <Link to="/admin">{t.scan.goAdmin}</Link>
              </>
            ) : (
              t.scan.comingSoon
            )}
          </div>
        </div>
      )}

      {(step === 'pick' || step === 'reading') && (
        <>
          <section className={`card ${previews.length ? '' : 'scan-start'}`}>
            <PagePicker
              pages={pages}
              editable={step === 'pick'}
              heading={t.scan.heading}
              intro={t.scan.intro}
              tips={t.scan.tips}
              help={files.length > 1 ? t.scan.pagesHelp(files.length) : t.scan.onePageHelp}
            />
            {!!previews.length && (
              <>
                {error && (
                  <p className="notice error">
                    <AlertTriangle size={18} /> {error}
                  </p>
                )}
                {step === 'reading' ? (
                  <div className="reading">
                    <Loader2 className="spin" size={28} />
                    <div>
                      <strong>{t.scan.reading}</strong>
                      <p className="muted small">{t.scan.readingTime}</p>
                    </div>
                  </div>
                ) : (
                  <button className="btn primary block big" disabled={!!noKey || aiOff || !settings || !ledger} onClick={() => read()}>
                    <Sparkles size={20} /> {files.length > 1 ? t.scan.readPages(files.length) : t.scan.read}
                  </button>
                )}
              </>
            )}
          </section>
        </>
      )}

      {step === 'review' && (
        <div className="review">
          <aside className="review-image">
            {previews.map((src, i) => (
              <button key={src} className="image-btn" onClick={() => setZoom(i)} aria-label={t.scan.zoomAria}>
                <img src={src} alt={t.scan.pageNo(i + 1)} />
                <span>
                  <ZoomIn size={16} /> {previews.length > 1 ? t.scan.pageNo(i + 1) : t.scan.zoom}
                </span>
              </button>
            ))}
          </aside>

          <div className="review-entries">
            <p className="notice info">
              <CheckCircle2 size={18} /> {t.scan.found(drafts.length)}
            </p>
            {warnings.map((w, i) => (
              <p key={i} className="notice warn">
                <AlertTriangle size={18} /> {w}
              </p>
            ))}
            <DateChip value={pageDate} onChange={movePageDate} label={t.scan.pageDate} />

            {drafts.map((d) => (
              <ScanCard
                key={d.key}
                d={d}
                customers={ledger?.customers ?? []}
                pageDate={pageDate}
                onOpen={() => setEditKey(d.key)}
                onRestore={() => patch(d.key, { include: true })}
              />
            ))}

            <button className="btn ghost block" onClick={() => read(true)}>
              <RefreshCw size={18} /> {t.scan.readAgain}
            </button>
            <p className="muted small center">{t.scan.readAgainHelp}</p>

            <div className="sticky-actions">
              <button className="btn ghost" onClick={reset}>
                {t.common.cancel}
              </button>
              <button className="btn primary big grow" disabled={!chosen.length} onClick={saveAll}>
                <CheckCircle2 size={20} /> {t.scan.saveN(chosen.length)}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'done' && (
        <section className="card">
          <div className="done-head">
            <CheckCircle2 size={40} />
            <h2>{t.scan.savedN(saved.length)}</h2>
            <p className="muted">{t.scan.sendNow}</p>
          </div>
          <div className="list">
            {saved.map((s) => (
              <div key={s.txn.id} className="list-row">
                <span className="list-main">
                  <strong>{s.customerName}</strong>
                  <small>
                    {[s.txn.type === 'sale' && `${t.common.goods} ${money(s.txn.total)}`, s.txn.paid > 0 && `${t.common.paid} ${money(s.txn.paid)}`]
                      .filter(Boolean)
                      .join(' • ')}
                  </small>
                </span>
                <button className="btn whatsapp" onClick={() => sendSaved(s)}>
                  <MessageCircle size={18} /> {t.common.send}
                </button>
              </div>
            ))}
          </div>
          {/* the page has just been checked line by line, so it is the best example of this hand */}
          <button className="btn ghost block" onClick={keepSample}>
            <PenLine size={18} /> {sample ? t.scan.sampleChange : t.scan.sampleKeep}
          </button>
          <p className="muted small center">{t.scan.sampleHelp}</p>
          <button className="btn primary block big" onClick={reset}>
            <Camera size={20} /> {t.scan.another}
          </button>
        </section>
      )}

      {/* one entry opened from the review list; changes apply as they are typed */}
      <Modal
        open={!!editing}
        onClose={closeSheet}
        title={t.scan.fixTitle}
        className="entry-sheet"
        footer={
          <button className="btn primary big block" onClick={closeSheet}>
            <CheckCircle2 size={20} /> {t.scan.ok}
          </button>
        }
      >
        {editing && (
          <>
            <EntryFields
              draft={editing}
              onChange={(p) => patch(editing.key, p)}
              customers={ledger?.customers ?? []}
              catalog={catalog}
              onNewCustomer={(name) => patch(editing.key, { customerId: null, cash: false, newName: name })}
              warning={
                editingMismatch && (
                  <p className="notice warn">
                    <AlertTriangle size={18} /> {t.scan.mismatch(money(editingMismatch.written), money(editingMismatch.sum))}
                  </p>
                )
              }
            />
            <button
              className="btn danger-ghost"
              onClick={() => {
                patch(editing.key, { include: false });
                setEditKey(null);
              }}
            >
              <Trash2 size={18} /> {t.scan.exclude}
            </button>
          </>
        )}
      </Modal>

      {zoom !== null && <ImageViewer src={previews[zoom]} onClose={() => setZoom(null)} />}
      {settings && <SendSheet request={send} settings={settings} onClose={() => setSend(null)} />}
    </div>
  );
}

/** One entry read from the page, shown the way it would look on a ফর্দ. Tapping it opens it for fixing. */
function ScanCard({
  d,
  customers,
  pageDate,
  onOpen,
  onRestore,
}: {
  d: ScanDraft;
  customers: CustomerRow[];
  pageDate: string;
  onOpen: () => void;
  onRestore: () => void;
}) {
  const t = useT();
  const sale = d.type === 'sale';
  const cash = sale && d.cash;
  const customer = cash ? undefined : customers.find((c) => c.id === d.customerId);
  const name = cash ? t.cash.name : (customer?.name ?? d.newName.trim());
  const items = sale ? d.items.map(draftToItem).filter((x): x is NonNullable<typeof x> => !!x) : [];
  const total = sale ? draftTotal(d) : 0;
  const adj = round2(total - items.reduce((sum, it) => sum + it.amount, 0));
  const paid = cash ? total : parseNum(d.paid);
  const mismatch = !d.checked && mismatchOf(d);
  const unsure = !d.checked && d.confidence !== 'high';

  if (!d.include) {
    return (
      <div className="scan-card off">
        <span className="grow">
          <s>{name || t.scan.noName}</s> · {t.scan.excluded}
        </span>
        <button className="btn small ghost" onClick={onRestore}>
          <Undo2 size={16} /> {t.scan.restore}
        </button>
      </div>
    );
  }

  return (
    <button type="button" className={`scan-card ${!name || mismatch || unsure ? 'attention' : ''}`} onClick={onOpen}>
      <span className="scan-card-head">
        {cash ? (
          <span className="avatar sm cash">
            <Banknote size={16} />
          </span>
        ) : (
          <span className={`avatar sm ${customer ? '' : 'new'}`}>{customer ? initials(customer.name) : '+'}</span>
        )}
        <span className="scan-card-name">
          <strong className={name ? '' : 'tone-due'}>{name || t.scan.noName}</strong>
          {!cash && !customer && name && <em className="chip warn">{t.common.newCustomer}</em>}
        </span>
        <b className={sale ? '' : 'tone-advance'}>{sale ? money(total) : `${t.common.paid} ${money(paid)}`}</b>
      </span>

      {items.map((it, i) => (
        <span key={i} className="scan-line">
          <span>
            {it.name}{' '}
            <small>
              {qtyText(it)}
              {it.qty && it.rate ? ` × ${money(it.rate)}` : ''}
            </small>
          </span>
          <span className="num">{money(it.amount)}</span>
        </span>
      ))}
      {sale && Math.abs(adj) >= 0.005 && (
        <span className="scan-line">
          <span>{t.entry.roundOff}</span>
          <span className="num">{signedMoney(adj)}</span>
        </span>
      )}
      {sale && paid > 0 && (
        <span className="scan-line">
          <span>{cash ? t.cash.received : t.scan.cashPaid}</span>
          <span className="num tone-advance">{cash ? money(paid) : `− ${money(paid)}`}</span>
        </span>
      )}
      {d.date !== pageDate && (
        <span className="scan-meta">
          <CalendarDays size={14} /> {fmtDate(d.date)}
        </span>
      )}
      {d.note && (
        <span className="scan-meta">
          {t.common.note}: {d.note}
        </span>
      )}
      {mismatch && (
        <span className="notice warn">
          <AlertTriangle size={16} /> {t.scan.mismatch(money(mismatch.written), money(mismatch.sum))}
        </span>
      )}

      <span className="scan-card-foot">
        {unsure && (
          <span className={`chip ${d.confidence === 'low' ? 'error' : 'warn'}`}>{d.confidence === 'low' ? t.scan.lowConf : t.scan.medConf}</span>
        )}
        {d.checked && (
          <span className="scan-checked">
            <CheckCircle2 size={15} /> {t.scan.checked}
          </span>
        )}
        <span className="scan-fix">
          <Pencil size={15} /> {t.scan.fix}
        </span>
      </span>
    </button>
  );
}

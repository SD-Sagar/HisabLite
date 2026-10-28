import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BookUp, CheckCircle2, FileUp, KeyRound, Loader2, Sparkles, Trash2, Undo2, Users } from 'lucide-react';
import { addCustomer, db, isCashCustomer } from '../db';
import { normName } from '../components/CustomerPicker';
import { PagePicker, usePages } from '../components/PagePicker';
import { Segmented, TopBar, toast } from '../components/ui';
import { useT } from '../i18n';
import { numInput, parseNum } from '../lib/format';
import { useShopStatus } from '../lib/access';
import { cloudEnabled } from '../lib/cloud';
import { useHandSample } from '../lib/hand';
import { useLedger } from '../lib/hooks';
import { fileBase64, prepareImage } from '../lib/image';
import {
  guessColumns, isPdfFile, isTableFile, peopleFrom, readTable, type ColumnMap, type Repeat, type Table,
} from '../lib/table';
import { activeKey, scanModel, useSettings } from '../settings';

/** An old book is thicker than a day's page, so more photos are allowed here. */
const MAX_PAGES = 8;

interface PersonDraft {
  key: string;
  name: string;
  phone: string;
  /** what they owe the shop; typed, so it can be corrected here */
  due: string;
  include: boolean;
  /** already in the app under this name, so it is left alone by default */
  existing: boolean;
  confidence: 'high' | 'medium' | 'low';
}

type Step = 'pick' | 'reading' | 'map' | 'review' | 'done';

/**
 * The way in for a shopkeeper who already keeps accounts somewhere else: photograph the pages of
 * the paper book, or hand over the file another app printed (Khatabook's PDF report, Vyapar's
 * Excel). Either way it ends in the same list of names and dues to check and save.
 */
export default function Import() {
  const t = useT();
  const settings = useSettings();
  const ledger = useLedger();
  const sample = useHandSample();
  const pages = usePages(MAX_PAGES);
  const { files, previews } = pages;
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('pick');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<PersonDraft[]>([]);
  const [table, setTable] = useState<Table | null>(null);
  const [columns, setColumns] = useState<ColumnMap>({ name: 0, due: 1, advance: -1, phone: -1 });
  const [repeat, setRepeat] = useState<Repeat>('add');
  const [saved, setSaved] = useState(0);

  const status = useShopStatus();
  // read on the owner's key on the server, like the khata scan (see Scan.tsx)
  const server = cloudEnabled && !(!!status?.isAdmin && !!settings && !!activeKey(settings));
  const noKey = !server && settings && !activeKey(settings);
  const aiOff = server && status?.aiReady === false;
  const ownKey = !cloudEnabled || !!status?.isAdmin;

  const reset = () => {
    pages.clear();
    setDrafts([]);
    setWarnings([]);
    setTable(null);
    // the next file gets a fresh reading of its own
    setRepeat('add');
    setError(null);
    setStep('pick');
  };

  const toDrafts = (found: { name: string; phone: string; balance: number | null | undefined; confidence?: 'high' | 'medium' | 'low' }[]) =>
    found
      .filter((p) => p.name.trim())
      .map(
        (p, i) =>
          ({
            key: `p${i}`,
            name: p.name.trim(),
            phone: p.phone.replace(/\D/g, ''),
            due: numInput(p.balance ?? 0),
            include: !(ledger?.customers ?? []).some((c) => normName(c.name) === normName(p.name)),
            existing: (ledger?.customers ?? []).some((c) => normName(c.name) === normName(p.name)),
            confidence: p.confidence ?? 'high',
          }) satisfies PersonDraft,
      );

  /** Photos of the paper book, or a PDF printed by another app — both go to the AI. */
  const readWithAi = async (pdf?: File) => {
    if (!settings || !ledger || (!pdf && !files.length)) return;
    setStep('reading');
    setError(null);
    try {
      const [{ readKhataPeople }, shots] = await Promise.all([
        import('../lib/ocr'),
        pdf
          ? fileBase64(pdf).then((base64) => [{ base64, mediaType: 'application/pdf' as const }])
          : Promise.all(files.map((f) => prepareImage(f, 2400, 0.88))),
      ]);
      const { result } = await readKhataPeople(server ? 'gemini' : settings.provider, {
        apiKey: server ? '' : activeKey(settings),
        server,
        model: scanModel(settings, server, false),
        images: shots.map(({ base64, mediaType }) => ({ base64, mediaType })),
        customers: ledger.customers.filter((c) => !isCashCustomer(c)).map((c) => ({ id: c.id, name: c.name })),
        style: settings.khataStyle,
        // a printed report is nobody's handwriting, so the sample would only be noise
        sample: pdf || !sample ? undefined : { base64: sample.base64, text: sample.text },
        today: new Date().toLocaleDateString('en-CA'),
        lang: settings.lang,
      });
      const found = toDrafts(result.people.map((p) => ({ ...p, phone: p.phone ?? '' })));
      if (!found.length) {
        setError(t.importOld.nobody);
        setStep('pick');
        return;
      }
      setDrafts(found);
      setWarnings(result.warnings);
      setStep('review');
    } catch (e) {
      console.error(e);
      const { OcrError } = await import('../lib/ocr');
      setError(e instanceof OcrError ? e.message : t.common.genericError);
      setStep('pick');
    }
  };

  /** A file from another ledger app: a table is read here and now, a PDF goes to the AI. */
  const takeFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (isPdfFile(file.name)) {
      if (noKey) return setError(t.scan.needKey);
      if (aiOff) return setError(ownKey ? t.scan.needServerKey : t.scan.comingSoon);
      return readWithAi(file);
    }
    if (!isTableFile(file.name)) return setError(t.importOld.fileUnknown);
    try {
      const read = await readTable(file);
      if (!read.rows.length) return setError(t.importOld.fileEmpty);
      setTable(read);
      setColumns(guessColumns(read));
      setStep('map');
    } catch (e) {
      console.error(e);
      setError(t.importOld.fileFailed);
    }
  };

  // what the chosen columns would bring in, so the shopkeeper sees the count before saving
  const fromFile = useMemo(() => (table ? peopleFrom(table, columns, repeat) : null), [table, columns, repeat]);

  const useColumns = () => {
    if (!fromFile) return;
    const found = toDrafts(fromFile.people.map((p) => ({ ...p, confidence: 'high' as const })));
    if (!found.length) return setError(t.importOld.fileEmpty);
    setDrafts(found);
    setWarnings([]);
    setStep('review');
  };

  const patch = (key: string, p: Partial<PersonDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)));

  const chosen = drafts.filter((d) => d.include && d.name.trim());

  const saveAll = async () => {
    if (!chosen.length) return;
    const now = Date.now();
    await db.transaction('rw', db.customers, async () => {
      for (const d of chosen) {
        await addCustomer({
          name: d.name.trim(),
          phone: d.phone,
          address: '',
          openingBalance: parseNum(d.due),
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    setSaved(chosen.length);
    setStep('done');
    toast(`${t.importOld.saved(chosen.length)} ✓`);
  };

  const columnName = (i: number) => table?.headers[i]?.trim() || t.importOld.colNo(i + 1);

  return (
    <div className="page">
      <TopBar menu title={t.importOld.title} />

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.tsv,.txt,.xlsx,.xlsm,.pdf,application/pdf,text/csv"
        hidden
        onChange={(e) => {
          takeFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

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
        <section className={`card ${previews.length ? '' : 'scan-start'}`}>
          <PagePicker
            pages={pages}
            editable={step === 'pick'}
            heading={t.importOld.heading}
            intro={t.importOld.intro}
            tips={t.importOld.tips}
            help={t.importOld.pagesHelp(files.length)}
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
                    <strong>{t.importOld.reading}</strong>
                    <p className="muted small">{t.scan.readingTime}</p>
                  </div>
                </div>
              ) : (
                <button className="btn primary block big" disabled={!!noKey || aiOff || !settings || !ledger} onClick={() => readWithAi()}>
                  <Sparkles size={20} /> {t.importOld.read}
                </button>
              )}
            </>
          )}

          {/* whoever already keeps a khata in another app can hand over its file instead */}
          {!previews.length && (
            <div className="from-file">
              <span className="or">{t.importOld.or}</span>
              {step === 'reading' ? (
                <div className="reading">
                  <Loader2 className="spin" size={28} />
                  <strong>{t.importOld.reading}</strong>
                </div>
              ) : (
                <>
                  <p className="muted small">{t.importOld.fileHelp}</p>
                  <button className="btn ghost block" onClick={() => fileRef.current?.click()}>
                    <FileUp size={18} /> {t.importOld.pickFile}
                  </button>
                  <small className="muted">{t.importOld.fileKinds}</small>
                  {error && (
                    <p className="notice error">
                      <AlertTriangle size={18} /> {error}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      )}

      {step === 'map' && table && fromFile && (
        <section className="card form">
          <h2 className="card-title">{t.importOld.mapTitle}</h2>
          <p className="muted small">{t.importOld.mapHelp(table.fileName, table.rows.length)}</p>

          <div className="table-peek">
            <table>
              <thead>
                <tr>
                  {table.headers.map((_, i) => (
                    <th key={i}>{columnName(i)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.slice(0, 3).map((row, n) => (
                  <tr key={n}>
                    {table.headers.map((_, i) => (
                      <td key={i}>{row[i] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(
            [
              ['name', t.importOld.colName, false],
              ['due', t.importOld.colDue, false],
              ['advance', t.importOld.colAdvance, true],
              ['phone', t.importOld.colPhone, true],
            ] as const
          ).map(([key, label, canSkip]) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <select value={columns[key]} onChange={(e) => setColumns({ ...columns, [key]: Number(e.target.value) })}>
                {canSkip && <option value={-1}>{t.importOld.colNone}</option>}
                {table.headers.map((_, i) => (
                  <option key={i} value={i}>
                    {columnName(i)}
                  </option>
                ))}
              </select>
            </label>
          ))}

          {/* the same customer over many lines is what a transaction export looks like */}
          {fromFile.merged > 0 && (
            <div className="field">
              <span>{t.importOld.repeatTitle(fromFile.merged)}</span>
              <Segmented
                value={repeat}
                onChange={setRepeat}
                options={[
                  { value: 'add', label: t.importOld.repeatAdd },
                  { value: 'last', label: t.importOld.repeatLast },
                ]}
              />
              <small>{t.importOld.repeatHelp}</small>
            </div>
          )}

          <p className="notice info">
            <CheckCircle2 size={18} /> {t.importOld.willAdd(fromFile.people.length, table.rows.length)}
          </p>

          {error && (
            <p className="notice error">
              <AlertTriangle size={18} /> {error}
            </p>
          )}
          <div className="row gap">
            <button className="btn ghost" onClick={reset}>
              {t.common.cancel}
            </button>
            <button className="btn primary grow big" onClick={useColumns}>
              <CheckCircle2 size={20} /> {t.importOld.mapGo}
            </button>
          </div>
        </section>
      )}

      {step === 'review' && (
        <section className="card has-actions">
          <p className="notice info">
            <CheckCircle2 size={18} /> {t.importOld.found(drafts.length)}
          </p>
          {warnings.map((w, i) => (
            <p key={i} className="notice warn">
              <AlertTriangle size={18} /> {w}
            </p>
          ))}
          <p className="muted small">{t.importOld.help}</p>

          <div className="people-list">
            {drafts.map((d) => (
              <div key={d.key} className={`people-row ${d.include ? '' : 'off'} ${d.confidence === 'low' ? 'attention' : ''}`}>
                <span className="people-main">
                  <input
                    className="people-name"
                    value={d.name}
                    placeholder={t.importOld.name}
                    onChange={(e) => patch(d.key, { name: e.target.value })}
                  />
                  {d.existing && <em className="chip warn">{t.importOld.already}</em>}
                </span>
                <input
                  className="people-due"
                  inputMode="decimal"
                  value={d.due}
                  placeholder={t.importOld.due}
                  onChange={(e) => patch(d.key, { due: e.target.value })}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={d.include ? t.importOld.leaveOut : t.importOld.bringBack}
                  onClick={() => patch(d.key, { include: !d.include })}
                >
                  {d.include ? <Trash2 size={18} /> : <Undo2 size={18} />}
                </button>
              </div>
            ))}
          </div>

          <div className="sticky-actions">
            <button className="btn ghost" onClick={reset}>
              {t.common.cancel}
            </button>
            <button className="btn primary big grow" disabled={!chosen.length} onClick={saveAll}>
              <Users size={20} /> {t.importOld.save(chosen.length)}
            </button>
          </div>
        </section>
      )}

      {step === 'done' && (
        <section className="card">
          <div className="done-head">
            <BookUp size={40} />
            <h2>{t.importOld.saved(saved)}</h2>
            <p className="muted">{t.importOld.doneHelp}</p>
          </div>
          <Link className="btn primary block big" to="/">
            {t.importOld.toHome}
          </Link>
          <button className="btn ghost block" onClick={reset}>
            {t.importOld.morePages}
          </button>
        </section>
      )}
    </div>
  );
}

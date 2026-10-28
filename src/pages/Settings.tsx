import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BookUp, Check, CheckCircle2, ChevronRight, CloudOff, CloudUpload, Crown, Download, Eye, EyeOff, FileSpreadsheet,
  Image as ImageIcon, KeyRound, Languages, Loader2, Lock, LogOut, MessageCircle, NotebookPen, PaintBucket, Palette,
  PlugZap, RefreshCw, RotateCcw, ShieldCheck, Sparkles, Store, Trash2, Upload, UserRound,
} from 'lucide-react';
import { PlanStatus } from '../components/Access';
import { PinSetup } from '../components/Lock';
import { DesktopContact, Support } from '../components/Support';
import { Segmented, TopBar, toast } from '../components/ui';
import { UpgradeModal } from '../components/UpgradeModal';
import { LANGS, tr, useT, type Lang } from '../i18n';
import { hasPremium, isPaid, refreshAccess, useAccess, useShopStatus } from '../lib/access';
import { changePassword, logOut, MIN_PASSWORD, useAccount } from '../lib/auth';
import { renderBill } from '../lib/bill';
import { useBillBrand } from '../lib/brand';
import { importBatches, undoImport, type ImportBatch } from '../lib/cleanup';
import { clearHandSample, sampleUrl, useHandSample } from '../lib/hand';
import { logoDataUrl } from '../lib/image';
import { exportBackup, exportCustomersCsv, importBackup } from '../lib/backup';
import { cloudEnabled } from '../lib/cloud';
import { fmtDate, isoDate, prettyPhone, todayISO } from '../lib/format';
import { usePin } from '../lib/pin';
import { syncNow, useSyncStatus } from '../lib/sync';
import { downloadBlob } from '../lib/share';
import { PLACEHOLDERS, reminderMessage, renderTemplate, sampleBill, templateVars, type BillData } from '../lib/template';
import {
  activeKey, activeModel, BG_TONES, BILL_DESIGNS, forBill, forMessages, GEMINI_MODELS, getSettings, isFreeDesign,
  isFreeTheme, isFreeTone, modelName, MODELS, pageColor, saveSettings, THEME_COLORS, withLanguage, withTheme,
  type BillDesign, type ModelInfo, type Settings as S, type Templates,
} from '../settings';

const ACCENTS = ['#5e35b1', '#2248c5', '#15803d', '#0f766e', '#be123c', '#c2410c', '#a16207', '#334155'];

const samplePayment = (bill: BillData): BillData => ({
  ...bill,
  txn: { ...bill.txn, type: 'payment', items: [], total: 0, paid: 2000 },
  after: bill.before - 2000,
});

function Section({ id, icon, title, children }: { id?: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="card form" id={id}>
      <h2 className="card-title with-icon">
        {icon} {title}
      </h2>
      {children}
    </section>
  );
}

function ImportCleanup() {
  const t = useT();
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [busy, setBusy] = useState(false);
  const load = () => importBatches().then(setBatches);

  useEffect(() => {
    load();
  }, []);

  if (!batches.length) return null;
  return (
    <div className="field">
      <span>{t.settings.undoImport}</span>
      <small>{t.settings.undoImportHelp}</small>
      {batches.map((b) => (
        <div key={b.at} className="list-row">
          <span className="list-main">
            <strong>{t.settings.undoCount(b.ids.length)}</strong>
            <small>
              {new Date(b.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              {b.used ? ` · ${t.settings.undoKept(b.used)}` : ''}
            </small>
          </span>
          <button
            type="button"
            className="btn danger-ghost small"
            disabled={busy}
            onClick={async () => {
              if (!confirm(t.settings.undoConfirm(b.ids.length))) return;
              setBusy(true);
              try {
                toast(t.settings.undoDone(await undoImport(b)));
              } finally {
                setBusy(false);
                load();
              }
            }}
          >
            <Trash2 size={16} /> {t.common.delete}
          </button>
        </div>
      ))}
    </div>
  );
}

function AccountSection({ onUpgrade }: { onUpgrade: () => void }) {
  const t = useT();
  const { phone } = useAccount();
  const access = useAccess();
  const status = useShopStatus();
  const isAdmin = !!status?.isAdmin;
  const sync = useSyncStatus();
  const [leaving, setLeaving] = useState(false);
  const [changing, setChanging] = useState(false);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const line =
    sync.state === 'syncing'
      ? t.account.syncing
      : sync.state === 'offline'
        ? t.account.offline
        : sync.state === 'error'
          ? t.account.error
          : sync.pending
            ? t.account.pending(sync.pending)
            : t.account.synced;
  const time = sync.lastSynced && new Date(sync.lastSynced).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const ok = sync.state === 'idle' && !sync.pending;

  const leave = async () => {
    if (!confirm(t.account.logoutConfirm)) return;
    setLeaving(true);
    const unsent = await logOut();
    if (unsent && confirm(t.account.logoutUnsent(unsent))) await logOut(true);
    setLeaving(false);
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setPasswordError(t.auth.shortPassword);
    setSaving(true);
    setPasswordError(null);
    try {
      await changePassword(password);
      done();
    } catch (err) {
      if ((err as { code?: string }).code === 'same_password') done();
      else {
        console.error(err);
        setPasswordError(t.account.passwordFailed);
      }
    } finally {
      setSaving(false);
    }
    function done() {
      toast(t.account.passwordChanged);
      setChanging(false);
      setPassword('');
    }
  };

  return (
    <Section id="account" icon={<UserRound size={20} />} title={t.account.title}>
      <div className="account-row">
        <span className="muted">{t.account.phone}</span>
        <b>{prettyPhone(phone)}</b>
      </div>

      {isAdmin && (
        <Link to="/admin" className={`plan-banner ${status?.adminPending ? 'warn' : ''}`} style={{ marginTop: 8, marginBottom: 8 }}>
          <ShieldCheck size={20} />
          <span>
            <strong>{t.admin.title}</strong>
            {status?.adminPending ? ` · ${t.admin.banner(status.adminPending)}` : ''}
          </span>
          <b>
            {t.admin.title} <ChevronRight size={16} />
          </b>
        </Link>
      )}

      {isPaid(access) ? (
        <div className="premium-card" style={{ marginTop: 8, marginBottom: 8 }}>
          <Crown size={22} />
          <div>
            <strong>{t.settings.premium}</strong>
            <small>
              {access.kind === 'lifetime'
                ? t.plans.lifetimeActive
                : t.plans.active(access.plan ? t.plans[access.plan] : '', fmtDate(isoDate(new Date(access.until))))}
            </small>
          </div>
        </div>
      ) : (
        <div className="plan-banner" style={{ marginTop: 8, marginBottom: 8, background: 'var(--surface-2)' }}>
          <Sparkles size={20} className="tone-warn" />
          <span>
            <strong>{t.plans.freeNow}</strong> · <small>{t.plans.freeHelp}</small>
          </span>
          <button type="button" className="btn primary small" onClick={onUpgrade}>
            <Crown size={14} /> {t.upgrade?.seePlans ?? t.plans.see}
          </button>
        </div>
      )}

      <PlanStatus access={access} />

      <p className={`sync-line ${ok ? 'ok' : sync.state}`}>
        {ok ? <CheckCircle2 size={18} /> : sync.state === 'offline' ? <CloudOff size={18} /> : <CloudUpload size={18} />}
        <span>
          {line}
          {ok && time && <small>{t.account.lastSynced(time)}</small>}
        </span>
      </p>

      <div className="row gap wrap">
        <button type="button" className="btn ghost" disabled={sync.state === 'syncing'} onClick={() => void syncNow()}>
          <RefreshCw size={18} className={sync.state === 'syncing' ? 'spin' : ''} /> {t.account.syncNow}
        </button>
        <button type="button" className="btn ghost" onClick={() => setChanging(!changing)}>
          <KeyRound size={18} /> {t.account.changePassword}
        </button>
        <button type="button" className="btn danger-ghost" disabled={leaving} onClick={leave}>
          <LogOut size={18} /> {t.account.logout}
        </button>
      </div>

      {changing && (
        <form className="row gap" onSubmit={savePassword}>
          <input
            className="grow"
            autoFocus
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={t.account.newPassword}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="btn primary" disabled={saving}>
            {saving ? <Loader2 className="spin" size={18} /> : t.common.save}
          </button>
        </form>
      )}
      {passwordError && <p className="notice error">{passwordError}</p>}
    </Section>
  );
}

function PinSection() {
  const t = useT();
  const pin = usePin();
  const [mode, setMode] = useState<'set' | 'change' | 'off' | null>(null);

  return (
    <Section id="pin" icon={<Lock size={20} />} title={t.lock.section}>
      <p className="muted small">{t.lock.sectionHelp}</p>
      {pin ? (
        <div className="row gap wrap">
          <span className="chip good">
            <CheckCircle2 size={14} /> {t.lock.isOn}
          </span>
          <button type="button" className="btn ghost small" onClick={() => setMode('change')}>
            {t.lock.change}
          </button>
          <button type="button" className="btn danger-ghost small" onClick={() => setMode('off')}>
            {t.lock.turnOff}
          </button>
        </div>
      ) : (
        <button type="button" className="btn primary small" onClick={() => setMode('set')}>
          <Lock size={16} /> {t.lock.set}
        </button>
      )}

      {mode && <PinSetup mode={mode} onClose={() => setMode(null)} />}
    </Section>
  );
}

function DesignThumbnail({ design }: { design: BillDesign }) {
  switch (design) {
    case 'tally':
      return (
        <div className="design-thumb thumb-tally" data-design="tally">
          <div className="th-tally-header">
            <span className="th-tally-title">ট্যালি খাতা</span>
          </div>
          <div className="th-tally-table">
            <div className="th-tally-thead">
              <span className="col-desc">বিবরণ</span>
              <span className="col-qty">পরিমাণ</span>
              <span className="col-rate">দর</span>
              <span className="col-amt">মোট</span>
            </div>
            <div className="th-tally-tbody">
              <div className="th-tally-tr">
                <span className="col-desc"><i /></span>
                <span className="col-qty"><i /></span>
                <span className="col-rate"><i /></span>
                <span className="col-amt"><i /></span>
              </div>
              <div className="th-tally-tr">
                <span className="col-desc"><i /></span>
                <span className="col-qty"><i /></span>
                <span className="col-rate"><i /></span>
                <span className="col-amt"><i /></span>
              </div>
              <div className="th-tally-tr">
                <span className="col-desc"><i /></span>
                <span className="col-qty"><i /></span>
                <span className="col-rate"><i /></span>
                <span className="col-amt"><i /></span>
              </div>
            </div>
          </div>
          <div className="th-tally-footer">
            <div className="th-tally-total-box">
              <span>মোট: ₹1,450</span>
            </div>
          </div>
        </div>
      );

    case 'paper':
      return (
        <div className="design-thumb thumb-paper" data-design="paper">
          <div className="th-paper-margin" />
          <div className="th-paper-content">
            <div className="th-paper-shop">
              <span className="bar-pen" />
              <span className="bar-pen sm" />
            </div>
            <div className="th-paper-entries">
              <div className="th-paper-entry"><span className="pen-desc" /><span className="pen-amt" /></div>
              <div className="th-paper-entry"><span className="pen-desc sm" /><span className="pen-amt" /></div>
              <div className="th-paper-entry"><span className="pen-desc" /><span className="pen-amt" /></div>
              <div className="th-paper-entry"><span className="pen-desc md" /><span className="pen-amt" /></div>
            </div>
          </div>
          <div className="th-paper-stamp">
            <span>পরিশোধ</span>
          </div>
        </div>
      );

    case 'receipt':
      return (
        <div className="design-thumb thumb-receipt" data-design="receipt">
          <div className="th-receipt-slip">
            <div className="th-receipt-teeth top" />
            <div className="th-receipt-body">
              <div className="th-receipt-head">
                <span className="th-receipt-logo" />
                <span className="th-receipt-title" />
              </div>
              <div className="th-receipt-sep">- - - - - - - -</div>
              <div className="th-receipt-row"><span className="item-name" /><span className="item-price" /></div>
              <div className="th-receipt-row"><span className="item-name" /><span className="item-price" /></div>
              <div className="th-receipt-row"><span className="item-name" /><span className="item-price" /></div>
              <div className="th-receipt-sep">- - - - - - - -</div>
              <div className="th-receipt-total">
                <span>TOTAL</span>
                <span>₹890</span>
              </div>
              <div className="th-receipt-barcode" />
            </div>
            <div className="th-receipt-teeth bottom" />
          </div>
        </div>
      );

    case 'band':
      return (
        <div className="design-thumb thumb-band" data-design="band">
          <div className="th-band-header">
            <span className="th-band-logo" />
            <div className="th-band-texts">
              <span className="th-band-shop" />
              <span className="th-band-sub" />
            </div>
          </div>
          <div className="th-band-body">
            <div className="th-band-row"><span className="th-b-desc" /><span className="th-b-amt" /></div>
            <div className="th-band-row"><span className="th-b-desc sm" /><span className="th-b-amt" /></div>
            <div className="th-band-row"><span className="th-b-desc" /><span className="th-b-amt" /></div>
          </div>
          <div className="th-band-footer">
            <span className="th-band-total" />
          </div>
        </div>
      );

    case 'line':
      return (
        <div className="design-thumb thumb-line" data-design="line">
          <div className="th-line-header">
            <span className="th-line-shop" />
            <div className="th-line-thick-rule" />
          </div>
          <div className="th-line-body">
            <div className="th-line-row"><span className="desc" /><span className="amt" /></div>
            <div className="th-line-row"><span className="desc sm" /><span className="amt" /></div>
            <div className="th-line-row"><span className="desc" /><span className="amt" /></div>
          </div>
          <div className="th-line-footer">
            <div className="th-line-total-rule">
              <span className="amt" />
            </div>
          </div>
        </div>
      );

    case 'dark':
      return (
        <div className="design-thumb thumb-dark" data-design="dark">
          <div className="th-dark-header">
            <span className="th-dark-shop" />
            <span className="th-dark-cyan-rule" />
          </div>
          <div className="th-dark-body">
            <div className="th-dark-row zebra"><span className="desc" /><span className="amt" /></div>
            <div className="th-dark-row"><span className="desc sm" /><span className="amt" /></div>
            <div className="th-dark-row zebra"><span className="desc" /><span className="amt" /></div>
          </div>
          <div className="th-dark-footer">
            <div className="th-dark-total">
              <span className="th-cyan-dot" />
              <span className="th-cyan-bar" />
            </div>
          </div>
        </div>
      );

    case 'royal':
      return (
        <div className="design-thumb thumb-royal" data-design="royal">
          <div className="th-royal-inner">
            <div className="th-royal-header">
              <span className="th-royal-crest">◆</span>
              <span className="th-royal-title" />
            </div>
            <div className="th-royal-gold-rule" />
            <div className="th-royal-body">
              <div className="th-royal-row"><span className="desc" /><span className="amt" /></div>
              <div className="th-royal-row"><span className="desc sm" /><span className="amt" /></div>
              <div className="th-royal-row"><span className="desc" /><span className="amt" /></div>
            </div>
            <div className="th-royal-footer">
              <span className="th-royal-total" />
            </div>
          </div>
        </div>
      );

    case 'gradient':
      return (
        <div className="design-thumb thumb-gradient" data-design="gradient">
          <div className="th-grad-wave">
            <span className="th-grad-title" />
          </div>
          <div className="th-grad-body">
            <div className="th-grad-card">
              <span className="th-gc-title" />
              <span className="th-gc-amt" />
            </div>
            <div className="th-grad-card">
              <span className="th-gc-title" />
              <span className="th-gc-amt" />
            </div>
          </div>
          <div className="th-grad-footer">
            <span className="th-grad-total" />
          </div>
        </div>
      );

    case 'fresh':
      return (
        <div className="design-thumb thumb-fresh" data-design="fresh">
          <div className="th-fresh-header">
            <span className="th-fresh-fruit">🍊🍃</span>
            <span className="th-fresh-title" />
          </div>
          <div className="th-fresh-body">
            <div className="th-fresh-row"><span className="pill" /><span className="amt" /></div>
            <div className="th-fresh-row"><span className="pill sm" /><span className="amt" /></div>
            <div className="th-fresh-row"><span className="pill" /><span className="amt" /></div>
          </div>
          <div className="th-fresh-footer">
            <span className="th-fresh-total" />
          </div>
        </div>
      );

    case 'invoice':
      return (
        <div className="design-thumb thumb-invoice" data-design="invoice">
          <div className="th-inv-header">
            <div className="th-inv-left">
              <span className="co-name" />
              <span className="co-sub" />
            </div>
            <span className="th-inv-badge">INVOICE</span>
          </div>
          <div className="th-inv-table">
            <div className="th-inv-thead">
              <span className="c1" /><span className="c2" /><span className="c3" /><span className="c4" />
            </div>
            <div className="th-inv-tr">
              <span className="c1" /><span className="c2" /><span className="c3" /><span className="c4" />
            </div>
            <div className="th-inv-tr alt">
              <span className="c1" /><span className="c2" /><span className="c3" /><span className="c4" />
            </div>
            <div className="th-inv-tr">
              <span className="c1" /><span className="c2" /><span className="c3" /><span className="c4" />
            </div>
          </div>
          <div className="th-inv-footer">
            <div className="th-inv-total-box">
              <span className="lbl" />
              <span className="amt" />
            </div>
          </div>
        </div>
      );

    case 'frame':
    default:
      return (
        <div className="design-thumb thumb-frame" data-design="frame">
          <div className="th-frame-outer">
            <div className="th-frame-inner">
              <span className="th-frame-c tl">┌</span>
              <span className="th-frame-c tr">┐</span>
              <span className="th-frame-c bl">└</span>
              <span className="th-frame-c br">┘</span>
              <div className="th-frame-header">
                <span className="th-frame-flourish">❖</span>
                <span className="th-frame-title" />
              </div>
              <div className="th-frame-body">
                <div className="th-frame-row"><span className="desc" /><span className="dots">. . . . .</span><span className="amt" /></div>
                <div className="th-frame-row"><span className="desc sm" /><span className="dots">. . . . .</span><span className="amt" /></div>
                <div className="th-frame-row"><span className="desc" /><span className="dots">. . . . .</span><span className="amt" /></div>
              </div>
              <div className="th-frame-footer">
                <span className="th-frame-total" />
              </div>
            </div>
          </div>
        </div>
      );
  }
}

function DesignPicker({
  s,
  premium,
  trying,
  onPick,
}: {
  s: S;
  premium: boolean;
  trying: BillDesign | null;
  onPick: (d: BillDesign) => void;
}) {
  const t = useT();
  const current = trying ?? s.bill.design;
  return (
    <div className="field">
      <span>{t.settings.billLook}</span>
      <div className="design-grid" role="radiogroup">
        {BILL_DESIGNS.map((design) => {
          const selected = current === design;
          const locked = !premium && !isFreeDesign(design);
          return (
            <button
              key={design}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`design-btn ${selected ? 'active' : ''} ${locked ? 'locked' : ''}`}
              onClick={() => onPick(design)}
            >
              <DesignThumbnail design={design} />
              <div className="design-meta">
                <strong>{t.settings.designs[design]}</strong>
                {locked ? (
                  <span className="chip warn mini">
                    <Crown size={11} /> {t.upgrade?.featureRequired ?? 'Premium'}
                  </span>
                ) : (
                  <span className="chip good mini">
                    <Check size={11} /> Free
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

type SettingsTab = 'account' | 'shop' | 'design' | 'whatsapp' | 'data';

export default function Settings() {
  const t = useT();
  const [s, setS] = useState<S | null>(null);
  const [tab, setTab] = useState<keyof Templates>('sale');
  const [showKey, setShowKey] = useState(false);
  const [billUrl, setBillUrl] = useState<string | null>(null);
  const [testState, setTestState] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<string | null>(null);
  const [trying, setTrying] = useState<BillDesign | null>(null);
  const [upgradeFeature, setUpgradeFeature] = useState<string | null>(null);
  const tplRef = useRef<HTMLTextAreaElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const { hash } = useLocation();
  const access = useAccess();
  const premium = hasPremium(access);
  const admin = !cloudEnabled || !!useShopStatus()?.isAdmin;
  const ownKey = admin;
  const brand = useBillBrand();
  const hand = useHandSample();
  const logoRef = useRef<HTMLInputElement>(null);

  const [hubTab, setHubTab] = useState<SettingsTab>(() => {
    if (hash === '#ai' || hash === '#backup' || hash === '#data') return 'data';
    if (hash === '#shop') return 'shop';
    if (hash === '#design' || hash === '#bill' || hash === '#color') return 'design';
    if (hash === '#whatsapp' || hash === '#hand') return 'whatsapp';
    return 'account';
  });

  useEffect(() => {
    refreshAccess().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (hash === '#ai' || hash === '#backup' || hash === '#data') setHubTab('data');
    else if (hash === '#shop') setHubTab('shop');
    else if (hash === '#design' || hash === '#bill' || hash === '#color') setHubTab('design');
    else if (hash === '#whatsapp' || hash === '#hand') setHubTab('whatsapp');
    else if (hash === '#account' || hash === '#language' || hash === '#pin') setHubTab('account');
  }, [hash]);

  const opened = useRef<S | null>(null);

  useEffect(() => {
    getSettings().then((loaded) => {
      opened.current = loaded;
      setS(loaded);
    });
  }, []);

  useEffect(() => {
    if (!s || s === opened.current) return;
    const timer = setTimeout(() => saveSettings(s), 400);
    return () => clearTimeout(timer);
  }, [s]);

  useEffect(() => {
    if (!s) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const look = forBill(s, premium);
      const shown = trying ? { ...look, bill: { ...look.bill, design: trying } } : look;
      const canvas = await renderBill(sampleBill(s.lang), shown, { credit: brand.credit, link: brand.link });
      if (!cancelled) setBillUrl(canvas.toDataURL('image/png'));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [s, premium, trying, brand.credit, brand.link]);

  if (!s) return <div className="page" />;

  const gemini = s.provider === 'gemini';
  const list = gemini ? GEMINI_MODELS : MODELS;
  const current = gemini ? s.geminiModel : s.model;
  const modelOptions: ModelInfo[] = list.some((m) => m.id === current) ? list : [...list, { id: current, name: current }];

  const runTest = async () => {
    setTestState('testing');
    try {
      const { testConnection } = await import('../lib/ocr');
      const chosen = activeModel(s);
      const answered = await testConnection(s.provider, activeKey(s), chosen);
      setTestState('ok');
      if (answered === chosen) {
        setTestNote(null);
      } else {
        setS((prev) => prev && (prev.provider === 'gemini' ? { ...prev, geminiModel: answered } : prev));
        setTestNote(t.settings.modelSwitched(modelName(chosen), modelName(answered)));
      }
    } catch (e) {
      setTestState((e as Error).message || t.settings.testFailed);
    }
  };

  const set = <K extends keyof S>(key: K, value: S[K]) => setS({ ...s, [key]: value });
  const setBill = <K extends keyof S['bill']>(key: K, value: S['bill'][K]) => setS({ ...s, bill: { ...s.bill, [key]: value } });
  const setTpl = (value: string) => setS({ ...s, templates: { ...s.templates, [tab]: value } });
  const setStyle = <K extends keyof S['khataStyle']>(key: K, value: S['khataStyle'][K]) =>
    setS({ ...s, khataStyle: { ...s.khataStyle, [key]: value } });

  const saveNow = (next: S) => {
    setS(next);
    saveSettings(next);
  };
  const chooseLang = (lang: Lang) => lang !== s.lang && saveNow(withLanguage(s, lang));

  const insert = (key: string) => {
    const el = tplRef.current;
    const tpl = s.templates[tab];
    const at = el?.selectionStart ?? tpl.length;
    const end = el?.selectionEnd ?? at;
    const token = `{${key}}`;
    setTpl(tpl.slice(0, at) + token + tpl.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const sample = sampleBill(s.lang);
  const sent = forMessages(s, premium);
  const preview =
    tab === 'reminder'
      ? reminderMessage(sample.customer, sample.after, sent)
      : renderTemplate(sent.templates[tab], templateVars(tab === 'payment' ? samplePayment(sample) : sample, sent));

  const stamp = todayISO();

  return (
    <div className="page">
      <TopBar menu title={t.nav.settings} sub={t.settings.autosave} />

      <nav className="settings-hub-nav" role="tablist" aria-label={t.nav.settings}>
        <button
          type="button"
          role="tab"
          aria-selected={hubTab === 'account'}
          className={`settings-hub-tab ${hubTab === 'account' ? 'active' : ''}`}
          onClick={() => setHubTab('account')}
        >
          <UserRound size={16} /> {t.settingsTabs.account}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={hubTab === 'shop'}
          className={`settings-hub-tab ${hubTab === 'shop' ? 'active' : ''}`}
          onClick={() => setHubTab('shop')}
        >
          <Store size={16} /> {t.settingsTabs.shop}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={hubTab === 'design'}
          className={`settings-hub-tab ${hubTab === 'design' ? 'active' : ''}`}
          onClick={() => setHubTab('design')}
        >
          <Palette size={16} /> {t.settingsTabs.design}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={hubTab === 'whatsapp'}
          className={`settings-hub-tab ${hubTab === 'whatsapp' ? 'active' : ''}`}
          onClick={() => setHubTab('whatsapp')}
        >
          <MessageCircle size={16} /> {t.settingsTabs.whatsapp}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={hubTab === 'data'}
          className={`settings-hub-tab ${hubTab === 'data' ? 'active' : ''}`}
          onClick={() => setHubTab('data')}
        >
          <Download size={16} /> {t.settingsTabs.data}
        </button>
      </nav>

      {hubTab === 'account' && (
        <div className="settings-tab-pane">
          {cloudEnabled && <AccountSection onUpgrade={() => setUpgradeFeature(t.settings.premium)} />}

          <Section id="language" icon={<Languages size={20} />} title="ভাষা · भाषा · Language">
            <div className="lang-grid" role="radiogroup">
              {LANGS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  role="radio"
                  aria-checked={s.lang === l.id}
                  lang={l.id}
                  className={`lang-btn ${s.lang === l.id ? 'active' : ''}`}
                  onClick={() => chooseLang(l.id)}
                >
                  <strong>{l.name}</strong>
                  <small>{l.letters}</small>
                </button>
              ))}
            </div>
            <p className="muted small">{t.settings.languageHelp}</p>
          </Section>

          <PinSection />
        </div>
      )}

      {hubTab === 'shop' && (
        <div className="settings-tab-pane">
          <Section icon={<Store size={20} />} title={t.settings.shop}>
            <label className="field">
              <span>{t.settings.shopName}</span>
              <input value={s.shopName} onChange={(e) => set('shopName', e.target.value)} />
            </label>
            <label className="field">
              <span>{t.settings.phone}</span>
              <input type="tel" value={s.shopPhone} onChange={(e) => set('shopPhone', e.target.value)} />
            </label>
            <label className="field">
              <span>{t.settings.address}</span>
              <input value={s.shopAddress} onChange={(e) => set('shopAddress', e.target.value)} placeholder={t.settings.addressPlaceholder} />
            </label>
            <label className="field">
              <span>{t.settings.upi}</span>
              <input value={s.upiId} onChange={(e) => set('upiId', e.target.value.trim())} placeholder="yourname@upi" />
            </label>
            <div className="row gap">
              <label className="field grow">
                <span>{t.settings.countryCode}</span>
                <input inputMode="numeric" value={s.countryCode} onChange={(e) => set('countryCode', e.target.value)} />
              </label>
              {t.settings.nativeDigits && (
                <label className="check grow">
                  <input type="checkbox" checked={s.bengaliDigits} onChange={(e) => set('bengaliDigits', e.target.checked)} />
                  {t.settings.nativeDigits}
                </label>
              )}
            </div>

            <div className="field" style={{ marginTop: 14 }}>
              <span>{t.settings.logo}</span>
              <div className="logo-row">
                {s.logo ? (
                  <img className="logo-preview" src={s.logo} alt={t.settings.logo} />
                ) : (
                  <span className="logo-preview empty">
                    <ImageIcon size={22} />
                  </span>
                )}
                <div className="row gap wrap">
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => {
                      if (!premium) {
                        setUpgradeFeature(t.settings.logo);
                      } else {
                        logoRef.current?.click();
                      }
                    }}
                  >
                    {!premium && <Crown size={14} style={{ marginRight: 4 }} />}
                    <Upload size={16} /> {s.logo ? t.settings.logoChange : t.settings.logoPick}
                  </button>
                  {s.logo && (
                    <button type="button" className="btn danger-ghost small" onClick={() => set('logo', '')}>
                      {t.settings.logoRemove}
                    </button>
                  )}
                </div>
              </div>
              <small>{t.settings.logoHelp}</small>
              <input
                ref={logoRef}
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  try {
                    set('logo', await logoDataUrl(file));
                  } catch (err) {
                    console.error(err);
                    toast(t.settings.logoFailed);
                  }
                }}
              />
            </div>
          </Section>
        </div>
      )}

      {hubTab === 'design' && (
        <div className="settings-tab-pane">
          <Section icon={<Palette size={20} />} title={t.settings.billLook}>
            {!premium && cloudEnabled && (
              <button
                type="button"
                className="notice info premium-note"
                style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none', marginBottom: 12 }}
                onClick={() => setUpgradeFeature(t.settings.billLook)}
              >
                <Crown size={18} /> {t.settings.premiumLocked} — {t.plans.see}
              </button>
            )}

            <DesignPicker
              s={s}
              premium={premium}
              trying={trying}
              onPick={(design) => {
                if (premium || isFreeDesign(design)) {
                  setTrying(null);
                  setBill('design', design);
                } else {
                  setTrying(design);
                  setUpgradeFeature(t.settings.designs[design]);
                }
              }}
            />

            {trying && (
              <button
                type="button"
                className="notice info premium-note"
                style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none', marginTop: 10 }}
                onClick={() => setUpgradeFeature(t.settings.designs[trying])}
              >
                <Crown size={18} /> {t.settings.designLocked(t.settings.designs[trying])} — {t.plans.see}
              </button>
            )}

            {/* Live rendered sample bill preview right beneath the picker */}
            <div className="bill-preview-wrap" style={{ marginTop: 16 }}>
              <span className="muted small" style={{ display: 'block', marginBottom: 6 }}>{t.settings.billSample}</span>
              {billUrl && <img className="bill-preview" src={billUrl} alt={t.settings.billSample} />}
            </div>

            <div className="field" style={{ marginTop: 16 }}>
              <span>{t.settings.billTitle}</span>
              <input value={s.bill.title} onChange={(e) => setBill('title', e.target.value)} />
            </div>

            <div className="field">
              <span>{t.settings.color}</span>
              <div className="swatches">
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`swatch ${s.bill.accent === c ? 'active' : ''}`}
                    style={{ background: c }}
                    aria-label={c}
                    onClick={() => setBill('accent', c)}
                  />
                ))}
                <input
                  type="color"
                  value={s.bill.accent}
                  onChange={(e) => setBill('accent', e.target.value)}
                  aria-label={t.settings.customColor}
                />
              </div>
            </div>

            <label className="check">
              <input type="checkbox" checked={s.bill.showPrevDue} onChange={(e) => setBill('showPrevDue', e.target.checked)} />
              {t.settings.showPrevDue}
            </label>
            <label className="check">
              <input type="checkbox" checked={s.bill.showShopContact} onChange={(e) => setBill('showShopContact', e.target.checked)} />
              {t.settings.showContact}
            </label>
            <label className="check">
              <input type="checkbox" checked={s.bill.showUpi} onChange={(e) => setBill('showUpi', e.target.checked)} />
              {t.settings.showUpi}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={!premium || s.bill.credit}
                onChange={(e) => {
                  if (!premium) {
                    setUpgradeFeature(t.settings.credit);
                  } else {
                    setBill('credit', e.target.checked);
                  }
                }}
              />
              {!premium && <Crown size={14} style={{ marginRight: 6 }} />}
              {t.settings.credit}
            </label>
            <p className="muted small">{t.settings.creditHelp}</p>
            <label className="field">
              <span>{t.settings.footer}</span>
              <input value={s.bill.footer} onChange={(e) => setBill('footer', e.target.value)} />
            </label>
          </Section>

          <Section icon={<PaintBucket size={20} />} title={t.settings.appColor}>
            {!premium && (
              <button
                type="button"
                className="notice info premium-note"
                style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none' }}
                onClick={() => setUpgradeFeature(t.settings.appColor)}
              >
                <Crown size={18} /> {t.settings.premiumLocked} — {t.plans.see}
              </button>
            )}
            <div className="swatches">
              {THEME_COLORS.map((c) => {
                const locked = !premium && !isFreeTheme(c);
                return (
                  <button
                    key={c}
                    type="button"
                    className={`swatch ${s.themeColor === c ? 'active' : ''}`}
                    style={{ background: c }}
                    aria-label={c}
                    aria-pressed={s.themeColor === c}
                    onClick={() => {
                      if (locked) {
                        setUpgradeFeature(t.settings.appColor);
                      } else {
                        saveNow(withTheme(s, c));
                      }
                    }}
                  >
                    {locked && <Crown size={12} color="#ffffff" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }} />}
                  </button>
                );
              })}
            </div>

            <div className="field" style={{ marginTop: 14 }}>
              <span>{t.settings.bgTone}</span>
              <div className="tone-grid" role="radiogroup">
                {BG_TONES.map((tone) => {
                  const locked = !premium && !isFreeTone(tone);
                  return (
                    <button
                      key={tone}
                      type="button"
                      role="radio"
                      aria-checked={s.bgTone === tone}
                      className={`tone-btn ${s.bgTone === tone ? 'active' : ''}`}
                      onClick={() => {
                        if (locked) {
                          setUpgradeFeature(t.settings.bgTone);
                        } else {
                          saveNow({ ...s, bgTone: tone });
                        }
                      }}
                    >
                      <span className="tone-chip" style={{ background: pageColor(tone, s.themeColor) }}>
                        <i />
                      </span>
                      {t.settings.tones[tone]}
                      {locked && <Crown size={13} style={{ marginLeft: 4 }} />}
                    </button>
                  );
                })}
              </div>
            </div>
          </Section>
        </div>
      )}

      {hubTab === 'whatsapp' && (
        <div className="settings-tab-pane">
          <Section icon={<MessageCircle size={20} />} title={t.settings.whatsapp}>
            {!premium && (
              <button
                type="button"
                className="notice info premium-note"
                style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none' }}
                onClick={() => setUpgradeFeature(t.settings.whatsapp)}
              >
                <Crown size={18} /> {t.settings.messagesLocked} — {t.plans.see}
              </button>
            )}
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'sale', label: t.settings.tplSale },
                { value: 'payment', label: t.settings.tplPayment },
                { value: 'reminder', label: t.settings.tplReminder },
              ]}
            />
            {premium && (
              <>
                <div className="chips">
                  {PLACEHOLDERS.map((key) => (
                    <button key={key} type="button" className="chip action" onClick={() => insert(key)}>
                      + {t.placeholders[key]}
                    </button>
                  ))}
                </div>
                <textarea ref={tplRef} rows={10} value={s.templates[tab]} onChange={(e) => setTpl(e.target.value)} />
                <button type="button" className="btn ghost small" onClick={() => setTpl(tr(s.lang).defaults.templates[tab])}>
                  <RotateCcw size={16} /> {t.settings.resetTemplate}
                </button>
              </>
            )}
            <div className="wa-preview">
              <span className="muted small">{t.settings.previewLabel}</span>
              <div className="wa-bubble">{preview}</div>
            </div>
          </Section>

          <Section id="hand" icon={<NotebookPen size={20} />} title={t.style.title}>
            <p className="muted small">{t.style.intro}</p>
            <label className="field">
              <span>{t.style.shorthand}</span>
              <textarea
                rows={5}
                value={s.khataStyle.shorthand}
                onChange={(e) => setStyle('shorthand', e.target.value)}
                placeholder={t.style.shorthandPlaceholder}
              />
              <small>{t.style.shorthandHelp}</small>
            </label>
            <label className="field">
              <span>{t.style.notes}</span>
              <textarea
                rows={4}
                value={s.khataStyle.notes}
                onChange={(e) => setStyle('notes', e.target.value)}
                placeholder={t.style.notesPlaceholder}
              />
              <small>{t.style.notesHelp}</small>
            </label>
            <div className="field">
              <span>{t.style.sample}</span>
              {hand ? (
                <div className="logo-row">
                  <img className="logo-preview" src={sampleUrl(hand)} alt={t.style.sample} />
                  <div className="row gap wrap">
                    <small className="muted">{t.style.sampleFrom(fmtDate(new Date(hand.savedAt).toLocaleDateString('en-CA')))}</small>
                    <button type="button" className="btn danger-ghost small" onClick={() => clearHandSample()}>
                      <Trash2 size={16} /> {t.style.sampleRemove}
                    </button>
                  </div>
                </div>
              ) : (
                <small>{t.style.sampleHow}</small>
              )}
            </div>
          </Section>
        </div>
      )}

      {hubTab === 'data' && (
        <div className="settings-tab-pane">
          {admin && (
            <Section id="backup" icon={<Download size={20} />} title={t.nav.backup}>
              <p className="muted small">{cloudEnabled ? t.settings.backupHelpAdmin : t.settings.backupHelp}</p>
              <div className="row gap wrap">
                <button className="btn primary" onClick={async () => downloadBlob(await exportBackup(), `hisablite-backup-${stamp}.json`)}>
                  <Download size={18} /> {t.settings.backupDownload}
                </button>
                <button className="btn ghost" onClick={() => importRef.current?.click()}>
                  <Upload size={18} /> {t.settings.backupRestore}
                </button>
              </div>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file || !confirm(t.settings.restoreConfirm)) return;
                  try {
                    const r = await importBackup(file);
                    setS(await getSettings());
                    toast(t.settings.restored(r.customers, r.txns));
                  } catch (err) {
                    toast((err as Error).message);
                  }
                }}
              />
            </Section>
          )}

          <Section icon={<BookUp size={20} />} title={t.importOld.title}>
            <p className="muted small">{t.importOld.intro}</p>
            <Link to="/import" className="btn ghost">
              <BookUp size={18} /> {t.importOld.read}
            </Link>
          </Section>

          <Section icon={<FileSpreadsheet size={20} />} title={t.settings.lists}>
            <button
              className="btn ghost"
              onClick={async () => downloadBlob(await exportCustomersCsv(), `${t.settings.dueListFile}-${stamp}.csv`)}
            >
              <FileSpreadsheet size={18} /> {t.settings.dueListCsv}
            </button>
            <ImportCleanup />
          </Section>

          {ownKey && (
            <Section id="ai" icon={<KeyRound size={20} />} title={t.settings.ai}>
              {cloudEnabled && (
                <Link className="notice info premium-note" to="/admin">
                  <KeyRound size={18} /> {t.settings.aiServerNote}
                </Link>
              )}
              <Segmented
                value={s.provider}
                onChange={(provider) => {
                  set('provider', provider);
                  setTestState(null);
                }}
                options={[
                  { value: 'gemini', label: t.settings.geminiFree },
                  { value: 'claude', label: t.settings.claudePaid },
                ]}
              />

              {gemini ? (
                <>
                  <ol className="steps">
                    <li>
                      {t.settings.geminiStep1.before && `${t.settings.geminiStep1.before} `}
                      <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                        aistudio.google.com/apikey
                      </a>{' '}
                      {t.settings.geminiStep1.after}
                    </li>
                    <li>{t.settings.geminiStep2}</li>
                    <li>{t.settings.geminiStep3}</li>
                  </ol>
                  <p className="notice warn">{t.settings.geminiPrivacy}</p>
                </>
              ) : (
                <p className="muted small">{t.settings.claudeHelp}</p>
              )}

              <label className="field">
                <span>{gemini ? 'Gemini API key' : 'Claude API key'}</span>
                <div className="input-with-btn">
                  <input
                    type={showKey ? 'text' : 'password'}
                    autoComplete="off"
                    spellCheck={false}
                    value={gemini ? s.geminiApiKey : s.apiKey}
                    onChange={(e) => {
                      set(gemini ? 'geminiApiKey' : 'apiKey', e.target.value.trim());
                      setTestState(null);
                    }}
                    placeholder={gemini ? 'AIza…' : 'sk-ant-…'}
                  />
                  <button type="button" className="icon-btn" aria-label={t.settings.showKey} onClick={() => setShowKey(!showKey)}>
                    {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>
              <label className="field">
                <span>{t.settings.model}</span>
                <select
                  value={gemini ? s.geminiModel : s.model}
                  onChange={(e) => {
                    set(gemini ? 'geminiModel' : 'model', e.target.value);
                    setTestState(null);
                  }}
                >
                  {modelOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.note ? `${m.name} — ${t.settings.modelNotes[m.note]}` : m.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="row gap wrap">
                <button type="button" className="btn ghost" disabled={!activeKey(s) || testState === 'testing'} onClick={runTest}>
                  {testState === 'testing' ? <Loader2 className="spin" size={18} /> : <PlugZap size={18} />} {t.settings.testKey}
                </button>
                {testState === 'ok' && (
                  <span className="tone-advance">
                    <CheckCircle2 size={16} /> {t.settings.keyOk}
                  </span>
                )}
              </div>
              {testState === 'ok' && testNote && <p className="notice warn">{testNote}</p>}
              {testState && testState !== 'ok' && testState !== 'testing' && <p className="notice error">{testState}</p>}
            </Section>
          )}

          <DesktopContact id="desktop" />
          <Support id="support" />
        </div>
      )}

      <UpgradeModal
        open={!!upgradeFeature}
        onClose={() => setUpgradeFeature(null)}
        feature={upgradeFeature ?? undefined}
      />
    </div>
  );
}

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle, Calendar, Check, CheckCircle2, Crown, DatabaseBackup, Eye, EyeOff, IndianRupee, KeyRound, Loader2, MessageCircle,
  PlugZap, RotateCcw, Search, Sparkles, Store, Wallet, X,
} from 'lucide-react';
import { Empty, Modal, TopBar, toast } from '../components/ui';
import { useT, type Dict } from '../i18n';
import { accessFrom, refreshAccess, useShopStatus } from '../lib/access';
import {
  aiKeyState, decide, findShops, givePlan, revokePlan, saveAiKey, savePayConfig, savePlans, setShopPassword, shopBackup, tempPassword,
  updateShopName, waitingPayments, type AdminShop, type AiKeyState, type WaitingPayment,
} from '../lib/admin';
import { fullPhone } from '../lib/auth';
import { dayTime, fmtDate, initials, isoDate, money, prettyPhone, todayISO } from '../lib/format';
import { DEFAULT_PLANS, fetchPayConfig, fetchPlans, isUpiId, type Plan } from '../lib/pay';
import { downloadBlob, openWhatsApp } from '../lib/share';
import { GEMINI_MODELS, useSettings } from '../settings';

const day = (ms: number) => fmtDate(isoDate(new Date(ms)));

/** where a shop stands, in a word or two, for the list */
function standing(s: AdminShop, t: Dict): { label: string; tone: string } {
  const now = Date.now();
  const a = accessFrom({ paidUntil: s.paidUntil, plan: s.plan, serverNow: new Date(now).toISOString(), fetchedAt: now });
  switch (a.kind) {
    case 'paid':
      return { label: t.admin.paid(a.plan ? t.plans[a.plan] : '', day(a.until)), tone: 'good' };
    case 'lifetime':
      return { label: t.admin.lifetime, tone: 'good' };
    default:
      return { label: t.admin.free, tone: '' };
  }
}

/**
 * For the people who run EasyLedger: UPI payments to check, every shop (give a plan, set a new
 * password) and the UPI id shopkeepers pay to.
 */
export default function Admin() {
  const t = useT();
  const status = useShopStatus();
  const isAdmin = !!status?.isAdmin;
  const [adminTab, setAdminTab] = useState<'payments' | 'shops' | 'config'>('payments');
  const [payments, setPayments] = useState<WaitingPayment[] | null>(null);
  const [shops, setShops] = useState<AdminShop[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>(DEFAULT_PLANS);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback(
    (e: unknown) => {
      console.error(e);
      setError(t.admin.failed);
    },
    [t],
  );
  const loadPayments = useCallback(() => waitingPayments().then(setPayments, fail), [fail]);
  const loadShops = useCallback((search: string) => findShops(search).then(setShops, fail), [fail]);

  // Both lists refresh whenever the app hears from the server (every minute, and when the app is
  // opened again), so a payment sent meanwhile shows up by itself.
  const heard = status?.fetchedAt;

  // ask the server as soon as the page opens, so a fresh admin (or a new payment) shows at once
  useEffect(() => {
    refreshAccess().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (isAdmin) fetchPlans().then(setPlans);
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) void loadPayments();
  }, [isAdmin, heard, loadPayments]);

  // searched a moment after the typing stops
  useEffect(() => {
    if (!isAdmin) return;
    const timer = setTimeout(() => void loadShops(q), 250);
    return () => clearTimeout(timer);
  }, [isAdmin, q, heard, loadShops]);

  const reload = () => Promise.all([loadPayments(), loadShops(q)]);

  const approve = async (p: WaitingPayment) => {
    if (!confirm(t.admin.approveConfirm(money(p.amount), t.plans[p.plan]))) return;
    setBusy(p.id);
    setError(null);
    try {
      await decide(p.id, true, '', p.shopId);
      toast(t.admin.approved);
      await reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const reject = async (p: WaitingPayment) => {
    const note = prompt(t.admin.rejectReason, t.admin.rejectDefault);
    if (note === null) return;
    setBusy(p.id);
    setError(null);
    try {
      await decide(p.id, false, note, p.shopId);
      toast(t.admin.rejectedDone);
      await reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  if (status === undefined) return null;
  if (!isAdmin) {
    return (
      <div className="page">
        <TopBar title={t.admin.title} back />
        <Empty icon={<Crown size={32} />} title={t.admin.onlyAdmins} />
      </div>
    );
  }

  const open = shops?.find((s) => s.id === openId) ?? null;

  return (
    <div className="page wide admin-page">
      <TopBar title={t.admin.title} back />

      {/* KPI Stats Overview */}
      <div className="admin-kpi-grid">
        <div className="admin-kpi-card">
          <span className="kpi-label"><Store size={14} /> {t.admin.statsTotalShops}</span>
          <strong>{shops ? shops.length : '—'}</strong>
        </div>
        <div className={`admin-kpi-card ${payments && payments.length > 0 ? 'warn' : ''}`}>
          <span className="kpi-label"><Wallet size={14} /> {t.admin.statsPendingPayments}</span>
          <strong>{payments ? payments.length : '0'}</strong>
        </div>
        <div className="admin-kpi-card good">
          <span className="kpi-label"><Crown size={14} /> {t.admin.statsActivePaid}</span>
          <strong>{shops ? shops.filter((s) => s.paidUntil || s.plan).length : '—'}</strong>
        </div>
        <div className="admin-kpi-card">
          <span className="kpi-label"><Sparkles size={14} /> {t.admin.statsAiReady}</span>
          <strong>{status?.aiReady ? '✓' : '—'}</strong>
        </div>
      </div>

      {/* Segmented Admin Navigation Tabs */}
      <div className="admin-tabs">
        <button
          type="button"
          className={`admin-tab ${adminTab === 'payments' ? 'active' : ''}`}
          onClick={() => setAdminTab('payments')}
        >
          <Wallet size={16} />
          {t.admin.tabPayments}
          {!!payments?.length && <span className="chip warn" style={{ padding: '0 6px', fontSize: 11 }}>{payments.length}</span>}
        </button>
        <button
          type="button"
          className={`admin-tab ${adminTab === 'shops' ? 'active' : ''}`}
          onClick={() => setAdminTab('shops')}
        >
          <Store size={16} />
          {t.admin.tabShops}
        </button>
        <button
          type="button"
          className={`admin-tab ${adminTab === 'config' ? 'active' : ''}`}
          onClick={() => setAdminTab('config')}
        >
          <PlugZap size={16} />
          {t.admin.tabConfig}
        </button>
      </div>

      {error && <p className="notice error">{error}</p>}

      {/* Tab: Payments to Verify */}
      {adminTab === 'payments' && (
        <section className="card">
          <h2 className="card-title with-icon">
            <Wallet size={20} /> {t.admin.toCheck}
            {!!payments?.length && <span className="chip warn">{payments.length}</span>}
          </h2>
          {payments === null ? (
            <Loader2 className="spin" size={22} />
          ) : payments.length === 0 ? (
            <p className="muted">{t.admin.nothingToCheck}</p>
          ) : (
            <ul className="admin-list">
              {payments.map((p) => (
                <li key={p.id} className="admin-pay">
                  <div className="admin-pay-head">
                    <b>{p.shopName || prettyPhone(p.phone)}</b>
                    <strong>{money(p.amount)}</strong>
                  </div>
                  <small className="muted">
                    {p.shopName && `${prettyPhone(p.phone)} · `}
                    {t.plans[p.plan]} · {dayTime(p.createdAt)}
                  </small>
                  {p.utr ? <p className="admin-utr">{t.plans.utrLine(p.utr)}</p> : <p className="muted small">{t.admin.noUtr}</p>}
                  <div className="admin-pay-actions">
                    <button type="button" className="btn primary" disabled={busy === p.id} onClick={() => approve(p)}>
                      {busy === p.id ? <Loader2 className="spin" size={18} /> : <Check size={18} />} {t.admin.approve}
                    </button>
                    <button type="button" className="btn danger-ghost" disabled={busy === p.id} onClick={() => reject(p)}>
                      <X size={18} /> {t.admin.reject}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Tab: All Shops & Search */}
      {adminTab === 'shops' && (
        <section className="card">
          <h2 className="card-title with-icon">
            <Store size={20} /> {t.admin.shops}
          </h2>
          <div className="search-box">
            <Search size={18} />
            <input placeholder={t.admin.search} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {shops === null ? (
            <Loader2 className="spin" size={22} />
          ) : shops.length === 0 ? (
            <p className="muted">{t.admin.noShops}</p>
          ) : (
            <ul className="admin-list shops">
              {shops.map((s) => {
                const st = standing(s, t);
                return (
                  <li key={s.id}>
                    <button type="button" className="admin-shop" onClick={() => setOpenId(s.id)}>
                      <span className="avatar sm">{initials(s.shopName || '#')}</span>
                      <span className="admin-shop-main">
                        <b>{s.shopName || t.admin.noName}</b>
                        <small>{prettyPhone(s.phone)}</small>
                      </span>
                      <span className="admin-shop-chips">
                        {s.waiting && <span className="chip warn">{t.admin.waiting}</span>}
                        <span className={`chip ${st.tone}`}>{st.label}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* Tab: System Config & Pricing */}
      {adminTab === 'config' && (
        <div className="admin-settings">
          <PlanPrices plans={plans} onSaved={() => fetchPlans().then(setPlans)} />
          <PaySettings />
          <AiKeyCard />
        </div>
      )}

      {open && <ShopSheet shop={open} plans={plans} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}

/** One shop: its trial or plan, a plan given by hand, and a new password. */
function ShopSheet({ shop, plans, onClose, onChanged }: { shop: AdminShop; plans: Plan[]; onClose: () => void; onChanged: () => Promise<unknown> }) {
  const t = useT();
  const [currentShop, setCurrentShop] = useState(shop);
  const [shopNameInput, setShopNameInput] = useState(shop.shopName || '');
  const [password, setPassword] = useState(tempPassword);
  const [justSet, setJustSet] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCurrentShop(shop);
    setShopNameInput(shop.shopName || '');
  }, [shop]);

  const name = currentShop.shopName || prettyPhone(currentShop.phone);
  const st = standing(currentShop, t);

  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (e) {
      console.error(e);
      setError(t.admin.failed);
    } finally {
      setBusy(false);
    }
  };

  const give = (p: Plan) => {
    if (!confirm(t.admin.giveConfirm(t.plans[p.id], name))) return;
    void run(async () => {
      const until = await givePlan(currentShop.id, p.id);
      setCurrentShop((prev) => ({ ...prev, paidUntil: until, plan: p.id }));
      toast(until === 'infinity' ? t.admin.givenLifetime : t.admin.given(day(Date.parse(until))));
      await onChanged();
    });
  };

  const resetToFree = () => {
    if (!confirm(t.admin.resetConfirm(name))) return;
    void run(async () => {
      await revokePlan(currentShop.id);
      setCurrentShop((prev) => ({ ...prev, paidUntil: null, plan: null }));
      toast(t.admin.resetDone);
      await onChanged();
    });
  };

  const saveShopName = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await updateShopName(currentShop.id, shopNameInput.trim());
      setCurrentShop((prev) => ({ ...prev, shopName: shopNameInput.trim() }));
      toast(t.admin.saved);
      await onChanged();
    });
  };

  const savePassword = (e: FormEvent) => {
    e.preventDefault();
    if (password.trim().length < 6) return setError(t.auth.shortPassword);
    void run(async () => {
      await setShopPassword(currentShop.id, password.trim());
      setJustSet(password.trim());
    });
  };

  return (
    <Modal open onClose={onClose} title={name} className="shop-sheet">
      <div className="admin-shop-info">
        <p className="muted">
          {prettyPhone(currentShop.phone)} · {t.admin.joined(day(Date.parse(currentShop.createdAt)))}
        </p>
        <div className="row gap wrap">
          <span className={`chip ${st.tone}`}>{st.label}</span>
          {currentShop.waiting && <span className="chip warn">{t.admin.waiting}</span>}
        </div>
        <button type="button" className="btn whatsapp small" onClick={() => openWhatsApp(currentShop.phone, '')}>
          <MessageCircle size={16} /> {t.admin.message}
        </button>
      </div>

      <h3 className="sheet-title">{t.settings.shopName}</h3>
      <form className="row gap" onSubmit={saveShopName}>
        <input
          className="grow"
          value={shopNameInput}
          placeholder={t.admin.noName}
          onChange={(e) => setShopNameInput(e.target.value)}
        />
        <button
          type="submit"
          className="btn primary"
          disabled={busy || shopNameInput.trim() === (currentShop.shopName || '')}
        >
          {busy ? <Loader2 className="spin" size={18} /> : <Check size={18} />} {t.common.save}
        </button>
      </form>

      <h3 className="sheet-title">{t.admin.give}</h3>
      <div className="admin-give">
        {plans.map((p) => {
          const isActive = currentShop.plan === p.id && (currentShop.paidUntil || currentShop.plan);
          return (
            <button
              key={p.id}
              type="button"
              className={`btn ${isActive ? 'primary' : 'ghost'}`}
              disabled={busy}
              onClick={() => give(p)}
            >
              {t.plans[p.id]} · {money(p.price)} {isActive ? '✓' : ''}
            </button>
          );
        })}
      </div>
      {(currentShop.paidUntil || currentShop.plan) && (
        <button
          type="button"
          className="btn danger-ghost"
          style={{ width: '100%', marginTop: 8 }}
          disabled={busy}
          onClick={resetToFree}
        >
          <RotateCcw size={16} /> {t.admin.resetToFree}
        </button>
      )}

      <h3 className="sheet-title">{t.admin.backup}</h3>
      <button
        type="button"
        className="btn ghost"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            downloadBlob(await shopBackup(currentShop.id), `khatay-kalomay-${(currentShop.shopName || currentShop.phone).replace(/[\\/:*?"<>|\s]+/g, '-')}-${todayISO()}.json`);
            toast(t.admin.backupDone);
          })
        }
      >
        <DatabaseBackup size={18} /> {t.admin.backupShop}
      </button>

      <h3 className="sheet-title">{t.admin.newPassword}</h3>
      <form className="row gap" onSubmit={savePassword}>
        <input className="grow" value={password} autoComplete="off" spellCheck={false} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn primary" disabled={busy}>
          {busy ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />} {t.admin.setPassword}
        </button>
      </form>
      {justSet && (
        <div className="notice info login-help">
          <span>{t.admin.passwordSet}</span>
          <button
            type="button"
            className="btn whatsapp small"
            onClick={() => openWhatsApp(shop.phone, t.admin.passwordMessage(prettyPhone(shop.phone), justSet))}
          >
            <MessageCircle size={16} /> {t.admin.sendPassword}
          </button>
        </div>
      )}
      {error && <p className="notice error">{error}</p>}
    </Modal>
  );
}

/**
 * The key every shop's khata photos are read with. It goes to the server and stays there: no
 * shopkeeper's phone ever sees it, and none of them is asked for one.
 */
function AiKeyCard() {
  const t = useT();
  const settings = useSettings();
  const [state, setState] = useState<AiKeyState | null>(null);
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 'idle', 'testing', 'ok', or what went wrong */
  const [test, setTest] = useState('idle');
  const [error, setError] = useState<string | null>(null);
  const mine = settings?.geminiApiKey ?? '';

  const load = useCallback(
    () =>
      aiKeyState().then(
        (s) => {
          setState(s);
          setModel(s.model);
        },
        (e) => {
          console.error(e);
          // the server hasn't had this part added yet (the SQL of 2026-09-27)
          setError(t.admin.aiKeyNoServer);
        },
      ),
    [t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const check = async () => {
    setTest('testing');
    try {
      const { testConnection } = await import('../lib/ocr');
      await testConnection('gemini', key.trim(), model || settings?.geminiModel || GEMINI_MODELS[0].id);
      setTest('ok');
    } catch (e) {
      setTest((e as Error).message || t.settings.testFailed);
    }
  };

  const save = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await saveAiKey(value, model);
      toast(value ? t.admin.aiKeySaved : t.admin.aiKeyRemoved);
      setKey('');
      setTest('idle');
      await load();
    } catch (e) {
      console.error(e);
      setError(t.admin.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2 className="card-title with-icon">
        <Sparkles size={20} /> {t.admin.aiKey}
      </h2>
      <p className="muted small">{t.admin.aiKeyHelp}</p>
      {state &&
        (state.set ? (
          <p className="notice info">
            <CheckCircle2 size={18} /> {t.admin.aiKeyOn(state.tail, state.updatedAt ? day(Date.parse(state.updatedAt)) : '')}
          </p>
        ) : (
          <p className="notice warn">
            <AlertTriangle size={18} /> {t.admin.aiKeyOff}
          </p>
        ))}
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) void save(key);
        }}
      >
        <label className="field">
          <span>Gemini API key</span>
          <div className="input-with-btn">
            <input
              type={show ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder="AIza…"
              value={key}
              onChange={(e) => {
                setKey(e.target.value.trim());
                setTest('idle');
              }}
            />
            <button type="button" className="icon-btn" aria-label={t.settings.showKey} onClick={() => setShow(!show)}>
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <small>
            {t.admin.aiKeyWhere}{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              aistudio.google.com/apikey
            </a>
          </small>
        </label>
        {mine && !key && (
          <button type="button" className="btn ghost small" onClick={() => setKey(mine)}>
            <KeyRound size={16} /> {t.admin.aiKeyUseMine}
          </button>
        )}
        <label className="field">
          <span>{t.settings.model}</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">{t.admin.aiModelAuto}</option>
            {GEMINI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {test === 'ok' && (
          <span className="tone-advance row gap">
            <CheckCircle2 size={16} /> {t.settings.keyOk}
          </span>
        )}
        {!['idle', 'ok', 'testing'].includes(test) && <p className="notice error">{test}</p>}
        {error && <p className="notice error">{error}</p>}
        <div className="row gap wrap">
          <button type="button" className="btn ghost" disabled={!key || test === 'testing'} onClick={check}>
            {test === 'testing' ? <Loader2 className="spin" size={18} /> : <PlugZap size={18} />} {t.settings.testKey}
          </button>
          <button className="btn primary grow" disabled={!key || busy}>
            {busy && <Loader2 className="spin" size={18} />} {t.admin.aiKeySave}
          </button>
        </div>
        {state?.set && (
          <button
            type="button"
            className="btn danger-ghost small"
            disabled={busy}
            onClick={() => confirm(t.admin.aiKeyRemoveConfirm) && void save('')}
          >
            {t.admin.aiKeyRemove}
          </button>
        )}
      </form>
    </section>
  );
}

/** The plan prices every shop sees. Plans already paid for keep the date they were given. */
function PlanPrices({ plans, onSaved }: { plans: Plan[]; onSaved: () => void }) {
  const t = useT();
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPrices(Object.fromEntries(plans.map((p) => [p.id, String(p.price)])));
  }, [plans]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const next = plans.map((p) => ({ ...p, price: Math.round(Number(prices[p.id])) }));
    if (next.some((p) => !Number.isFinite(p.price) || p.price < 1)) return setError(t.admin.badPrice);
    setBusy(true);
    setError(null);
    try {
      await savePlans(next);
      toast(t.admin.saved);
      onSaved();
    } catch (err) {
      console.error(err);
      setError(t.admin.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2 className="card-title with-icon">
        <IndianRupee size={20} /> {t.admin.prices}
      </h2>
      <form className="form" onSubmit={save}>
        <div className="admin-plans-grid">
          {plans.map((p) => {
            const isFeatured = p.id === 'yearly';
            const isLifetime = p.id === 'lifetime';
            return (
              <div key={p.id} className={`admin-plan-card ${isFeatured ? 'featured' : ''} ${isLifetime ? 'lifetime' : ''}`}>
                <div className="admin-plan-card-head">
                  <div className="admin-plan-icon-wrap">
                    {p.id === 'monthly' && <Calendar size={20} />}
                    {p.id === 'yearly' && <Sparkles size={20} />}
                    {p.id === 'lifetime' && <Crown size={20} />}
                  </div>
                  <div className="admin-plan-info">
                    <strong>{t.plans[p.id]}</strong>
                    <span className="plan-cycle">
                      {p.id === 'monthly' && t.plans.perMonth}
                      {p.id === 'yearly' && t.plans.perYear}
                      {p.id === 'lifetime' && t.plans.once}
                    </span>
                  </div>
                  {isFeatured && <span className="admin-plan-badge">Popular</span>}
                </div>

                <div className="admin-plan-price-box">
                  <span className="currency-symbol">₹</span>
                  <input
                    className="admin-plan-input"
                    inputMode="numeric"
                    value={prices[p.id] ?? ''}
                    placeholder="0"
                    onChange={(e) => setPrices({ ...prices, [p.id]: e.target.value.replace(/[^\d]/g, '') })}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="muted small" style={{ marginTop: 12 }}>{t.admin.pricesHelp}</p>
        {error && <p className="notice error">{error}</p>}
        <button className="btn primary" style={{ marginTop: 12, width: 'fit-content' }} disabled={busy}>
          {busy ? <Loader2 className="spin" size={18} /> : <Check size={18} />} {t.common.save}
        </button>
      </form>
    </section>
  );
}

/** The UPI id shopkeepers pay to, the WhatsApp number they write to, and the app's own link. */
function PaySettings() {
  const t = useT();
  const [upiId, setUpiId] = useState('');
  const [upiName, setUpiName] = useState('');
  const [support, setSupport] = useState('');
  const [appLink, setAppLink] = useState('');
  const [freeScans, setFreeScans] = useState('5');
  const [webUrl, setWebUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPayConfig().then(
      (c) => {
        setUpiId(c.upiId);
        setUpiName(c.upiName);
        // shown without the +91 it is stored with
        setSupport(c.supportPhone.replace(/^91(?=\d{10}$)/, ''));
        setAppLink(c.appLink);
        setFreeScans(String(c.freeScans));
        setWebUrl(c.webUrl);
      },
      () => undefined,
    );
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (upiId.trim() && !isUpiId(upiId)) return setError(t.admin.badUpi);
    const phone = support.trim() ? fullPhone(support, '91') : '';
    if (phone === null) return setError(t.auth.badPhone);
    setBusy(true);
    setError(null);
    try {
      await savePayConfig({
        upiId: upiId.trim(), upiName: upiName.trim(), supportPhone: phone, appLink: appLink.trim(),
        freeScans: Math.max(0, Math.round(Number(freeScans) || 0)), webUrl: webUrl.trim(),
      });
      toast(t.admin.saved);
    } catch (err) {
      console.error(err);
      setError(t.admin.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2 className="card-title with-icon">
        <Wallet size={20} /> {t.admin.payTitle}
      </h2>
      <form className="form" onSubmit={save}>
        <div className="admin-config-group">
          <h3 className="admin-group-title"><Wallet size={18} /> UPI Payment Gateway</h3>
          <div className="grid-2-col">
            <label className="field">
              <span>{t.admin.upiId}</span>
              <input autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="name@okaxis" value={upiId} onChange={(e) => setUpiId(e.target.value)} />
            </label>
            <label className="field">
              <span>{t.admin.upiName}</span>
              <input value={upiName} placeholder="Khatay-Kalomay Store" onChange={(e) => setUpiName(e.target.value)} />
            </label>
          </div>
        </div>

        <div className="admin-config-group" style={{ marginTop: 14 }}>
          <h3 className="admin-group-title"><PlugZap size={18} /> Support Contact & Distribution</h3>
          <div className="grid-2-col">
            <label className="field">
              <span>{t.admin.support}</span>
              <span className="money-input phone-input">
                <span>+91</span>
                <input type="tel" inputMode="numeric" placeholder="98xxxxxxxx" value={support} onChange={(e) => setSupport(e.target.value)} />
              </span>
              <small>{t.admin.supportHelp}</small>
            </label>
            <label className="field">
              <span>{t.admin.freeScans}</span>
              <input inputMode="numeric" value={freeScans} onChange={(e) => setFreeScans(e.target.value.replace(/[^\d]/g, ''))} />
              <small>{t.admin.freeScansHelp}</small>
            </label>
          </div>
          <div className="grid-2-col">
            <label className="field">
              <span>{t.admin.appLink}</span>
              <input
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://play.google.com/store/apps/details?id=..."
                value={appLink}
                onChange={(e) => setAppLink(e.target.value)}
              />
              <small>{t.admin.appLinkHelp}</small>
            </label>
            <label className="field">
              <span>{t.admin.webUrl}</span>
              <input
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://khatay-kalomay.app"
                value={webUrl}
                onChange={(e) => setWebUrl(e.target.value)}
              />
              <small>{t.admin.webUrlHelp}</small>
            </label>
          </div>
        </div>

        {error && <p className="notice error">{error}</p>}
        <button className="btn primary" style={{ marginTop: 14, width: 'fit-content' }} disabled={busy}>
          {busy ? <Loader2 className="spin" size={18} /> : <Check size={18} />} {t.common.save}
        </button>
      </form>
    </section>
  );
}

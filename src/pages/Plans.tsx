import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, Crown, Download, Hourglass, Loader2, MessageCircle, Smartphone, XCircle } from 'lucide-react';
import { PlanStatus } from '../components/Access';
import { Modal, TopBar, toast } from '../components/ui';
import { useT } from '../i18n';
import { accessFrom, canScan, refreshAccess, SCAN_OPEN_TO_ALL, scansLeft, useShopStatus, type PlanRequest } from '../lib/access';
import { useAccount } from '../lib/auth';
import { dayTime, money, prettyPhone } from '../lib/format';
import { DEFAULT_PLANS, fetchPlans, requestPlan, upiLink, usePayConfig, type PayConfig, type Plan } from '../lib/pay';
import { qrPng } from '../lib/qr';
import { openWhatsApp } from '../lib/share';

/**
 * The trial or plan the shop is on and the plans to buy. A plan is paid by UPI to the app's
 * owner; the shopkeeper then says "I have paid" and the owner turns the plan on.
 */
export default function Plans() {
  const t = useT();
  const status = useShopStatus();
  const access = accessFrom(status);
  const { phone } = useAccount();
  const config = usePayConfig();
  const [plans, setPlans] = useState<Plan[]>(DEFAULT_PLANS);
  const [paying, setPaying] = useState<Plan | null>(null);
  /** plans shown again while a payment waits, to pay for a different one */
  const [again, setAgain] = useState(false);

  useEffect(() => {
    fetchPlans().then(setPlans);
    // an approval shows as soon as the page opens, without waiting for the next sync
    refreshAccess().catch(() => undefined);
  }, []);

  const request = status?.request;
  const waiting = request?.status === 'pending' ? request : null;
  const rejected = request?.status === 'rejected' ? request : null;
  const showPlans = access.kind !== 'lifetime' && (!waiting || again);

  const per = (p: Plan) => (p.months === null ? t.plans.once : p.months === 12 ? t.plans.perYear : t.plans.perMonth);
  const note = (p: Plan) =>
    p.months === null ? t.plans.lifetimeNote : p.months >= 12 ? t.plans.yearlyNote(money(Math.floor(p.price / p.months))) : t.plans.monthlyNote;
  const about = (r: PlanRequest) => t.plans.payTitle(t.plans[r.plan], money(r.amount));
  const tell = (r: PlanRequest) =>
    openWhatsApp(config.supportPhone, t.plans.payMessage(t.plans[r.plan], money(r.amount), prettyPhone(phone), r.utr));

  return (
    <div className="page">
      <TopBar title={t.plans.title} back />

      <section className="card">
        <PlanStatus access={access} left={access.kind === 'free' && canScan(status) ? scansLeft(status, access) : undefined} />
      </section>

      {waiting && (
        <section className="card pay-state">
          <div className="plan-status warn">
            <Hourglass size={20} />
            <div>
              <strong>{t.plans.pending}</strong>
              <small>
                {about(waiting)}
                {waiting.utr && ` · ${t.plans.utrLine(waiting.utr)}`}
              </small>
              <small>{t.plans.sentAt(dayTime(waiting.createdAt))}</small>
            </div>
          </div>
          <p className="muted small">{t.plans.pendingHelp}</p>
          {config.supportPhone && (
            <button type="button" className="btn whatsapp block" onClick={() => tell(waiting)}>
              <MessageCircle size={18} /> {t.plans.tell}
            </button>
          )}
          {!again && (
            <button type="button" className="btn ghost small" onClick={() => setAgain(true)}>
              {t.plans.payAgain}
            </button>
          )}
        </section>
      )}

      {rejected && (
        <section className="card pay-state">
          <div className="plan-status bad">
            <XCircle size={20} />
            <div>
              <strong>{t.plans.rejected}</strong>
              <small>{about(rejected)}</small>
              {rejected.note && <small>{t.plans.reason(rejected.note)}</small>}
            </div>
          </div>
          <p className="muted small">{t.plans.rejectedHelp}</p>
          {config.supportPhone && (
            <button type="button" className="btn whatsapp small" onClick={() => tell(rejected)}>
              <MessageCircle size={16} /> {t.auth.whatsapp}
            </button>
          )}
        </section>
      )}

      <section className="card">
        <h2 className="card-title">{t.plans.freeTitle}</h2>
        <ul className="plan-features">
          {[...t.plans.freeIncludes, ...(SCAN_OPEN_TO_ALL ? [t.plans.freeScansLine(status?.scans.allowance ?? 5)] : [])].map((f) => (
            <li key={f}>
              <CheckCircle2 size={18} /> {f}
            </li>
          ))}
        </ul>
      </section>

      <section className="card premium-list">
        <h2 className="card-title with-icon">
          <Crown size={20} /> {t.plans.premiumTitle}
        </h2>
        <ul className="plan-features">
          {[...t.plans.premiumIncludes, SCAN_OPEN_TO_ALL ? t.plans.scanPremium : t.plans.scanSoon].map((f) => (
            <li key={f}>
              <Crown size={18} /> {f}
            </li>
          ))}
        </ul>
      </section>

      {showPlans && (
        <>
          <div className="plan-list">
            {plans.map((p) => (
              <section key={p.id} className={`plan-card ${p.id === 'yearly' ? 'best' : ''}`}>
                {p.id === 'yearly' && <span className="plan-badge">{t.plans.best}</span>}
                <h2>{t.plans[p.id]}</h2>
                <p className="plan-price">
                  <b>{money(p.price)}</b> <span>{per(p)}</span>
                </p>
                <p className="muted small">{note(p)}</p>
                <button className={`btn big block ${p.id === 'yearly' ? 'primary' : 'ghost'}`} onClick={() => setPaying(p)}>
                  {t.plans.pay(money(p.price))}
                </button>
              </section>
            ))}
          </div>
          <p className="muted small center">{t.plans.howToPay}</p>
        </>
      )}

      {paying && (
        <PaySheet
          plan={paying}
          config={config}
          phone={phone}
          onClose={() => setPaying(null)}
          onSent={() => {
            setPaying(null);
            setAgain(false);
          }}
        />
      )}
    </div>
  );
}

/** Where to send the money (UPI app, QR, UPI id), then "I have paid" with the UPI reference. */
function PaySheet({
  plan,
  config,
  phone,
  onClose,
  onSent,
}: {
  plan: Plan;
  config: PayConfig;
  phone: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const t = useT();
  const [utr, setUtr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ready = !!config.upiId;
  // the note shows in the owner's UPI app next to the money, so it says whose it is
  const link = ready ? upiLink(config, plan.price, `Khatay-Kalomay ${plan.id} ${phone.replace(/\D/g, '').slice(-10)}`) : '';
  const qr = useMemo(() => (link ? qrPng(link) : ''), [link]);
  // upi:// opens the UPI apps only on Android; elsewhere the QR is the way
  const android = /Android/i.test(navigator.userAgent);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(config.upiId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // nothing to do: the id is on the screen to type
    }
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestPlan(plan.id, utr);
      toast(t.plans.requestSent);
      onSent();
    } catch (e) {
      console.error(e);
      setError(t.plans.requestFailed);
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t.plans.payTitle(t.plans[plan.id], money(plan.price))}
      className="pay-sheet"
      footer={
        ready && (
          <button type="button" className="btn primary big block" disabled={busy} onClick={send}>
            {busy ? <Loader2 className="spin" size={20} /> : <CheckCircle2 size={20} />} {t.plans.sent}
          </button>
        )
      }
    >
      {!ready ? (
        <>
          <p className="notice warn">{t.plans.noUpi}</p>
          {config.supportPhone && (
            <button type="button" className="btn whatsapp block" onClick={() => openWhatsApp(config.supportPhone, '')}>
              <MessageCircle size={18} /> {t.auth.whatsapp}
            </button>
          )}
        </>
      ) : (
        <>
          <h3 className="pay-step">
            <span>1</span> {t.plans.step1}
          </h3>
          {android && (
            <a className="btn primary big block" href={link}>
              <Smartphone size={20} /> {t.plans.openUpi(money(plan.price))}
            </a>
          )}
          <div className="pay-upi">
            <div>
              <small>{t.plans.upiId}</small>
              <b>{config.upiId}</b>
              {config.upiName && <small>{config.upiName}</small>}
            </div>
            <button type="button" className="btn ghost small" onClick={copy}>
              <Copy size={16} /> {copied ? t.plans.copied : t.plans.copy}
            </button>
          </div>
          <div className="pay-qr">
            <img src={qr} alt={`UPI QR · ${money(plan.price)}`} width={200} height={200} />
            <small className="muted">{t.plans.qrHelp}</small>
            <a className="btn ghost small" href={qr} download={`khatay-kalomay-${plan.id}-upi.png`}>
              <Download size={16} /> {t.plans.saveQr}
            </a>
          </div>

          <h3 className="pay-step">
            <span>2</span> {t.plans.step2}
          </h3>
          <label className="field">
            <span>{t.plans.utr}</span>
            <input
              inputMode="numeric"
              autoComplete="off"
              maxLength={40}
              placeholder="123456789012"
              value={utr}
              onChange={(e) => setUtr(e.target.value)}
            />
            <small>{t.plans.utrHelp}</small>
          </label>
          {error && <p className="notice error">{error}</p>}
        </>
      )}
    </Modal>
  );
}

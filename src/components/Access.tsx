import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Crown, Gift, Hourglass, ScanLine, ShieldCheck, UserCog } from 'lucide-react';
import { useT } from '../i18n';
import { accessFrom, canScan, hasPremium, scansLeft, useShopStatus, type Access } from '../lib/access';
import { fmtDate, isoDate, money } from '../lib/format';
import { toast } from './ui';

const day = (ms: number) => fmtDate(isoDate(new Date(ms)));

/** One line on where the shop stands: free, or on a plan. */
export function PlanStatus({ access, left }: { access: Access; left?: number }) {
  const t = useT();
  switch (access.kind) {
    case 'free':
      return (
        <div className="plan-status">
          <Gift size={20} />
          <div>
            <strong>{t.plans.freeNow}</strong>
            <small>{t.plans.freeHelp}</small>
            {left !== undefined && <small>{left > 0 ? t.plans.scansLeft(left) : t.plans.scansOver}</small>}
          </div>
        </div>
      );
    case 'paid':
      return (
        <div className={`plan-status good ${access.daysLeft <= 5 ? 'warn' : ''}`}>
          <ShieldCheck size={20} />
          <strong>{t.plans.active(access.plan ? t.plans[access.plan] : '', day(access.until))}</strong>
        </div>
      );
    case 'lifetime':
      return (
        <div className="plan-status good">
          <Crown size={20} />
          <strong>{t.plans.lifetimeActive}</strong>
        </div>
      );
    default:
      return null;
  }
}

/**
 * On the home screen: payments waiting for the owner, this shop's own payment being checked,
 * a plan about to run out, and — for a free shop — what a plan would add.
 */
export function AccessBanner() {
  const t = useT();
  const status = useShopStatus();
  const access = accessFrom(status);
  const waiting = status?.request?.status === 'pending' ? status.request : null;
  // scans left only matter to someone who can scan
  const left = canScan(status) ? scansLeft(status, access) : Infinity;

  return (
    <>
      {!!status?.isAdmin && (
        <Link to="/admin" className={`plan-banner ${status.adminPending > 0 ? 'warn' : ''}`}>
          <UserCog size={18} />
          <span>{status.adminPending > 0 ? t.admin.banner(status.adminPending) : t.admin.title}</span>
          <b>
            <ChevronRight size={16} />
          </b>
        </Link>
      )}

      {waiting ? (
        <Link to="/plans" className="plan-banner">
          <Hourglass size={18} />
          <span>{t.plans.pendingBanner(money(waiting.amount))}</span>
          <b>
            <ChevronRight size={16} />
          </b>
        </Link>
      ) : access.kind === 'paid' && access.daysLeft <= 5 ? (
        <Link to="/plans" className="plan-banner warn">
          <Gift size={18} />
          <span>{t.plans.endsSoon(access.daysLeft)}</span>
          <b>
            {t.plans.choose} <ChevronRight size={16} />
          </b>
        </Link>
      ) : access.kind === 'free' ? (
        // the free app is the whole khata; this is only about the extras
        <Link to="/plans" className={`plan-banner ${left <= 2 ? 'warn' : ''}`}>
          {left <= 2 ? <ScanLine size={18} /> : <Crown size={18} />}
          <span>{left <= 0 ? t.plans.scansOver : left <= 2 ? t.plans.scansLeft(left) : t.plans.upsell}</span>
          <b>
            {t.plans.see} <ChevronRight size={16} />
          </b>
        </Link>
      ) : null}
    </>
  );
}

/** Says so when the owner turns on a plan this phone was waiting for. */
export function PlanWatcher() {
  const t = useT();
  const request = useShopStatus()?.request;
  const waitingFor = useRef<number | null>(null);
  useEffect(() => {
    if (!request) return;
    if (request.status === 'pending') waitingFor.current = request.id;
    else if (request.id === waitingFor.current) {
      waitingFor.current = null;
      if (request.status === 'approved') toast(t.plans.thanks);
    }
  }, [request, t]);
  return null;
}

/** true while the shop may use the premium extras */
export function usePremium() {
  return hasPremium(accessFrom(useShopStatus()));
}

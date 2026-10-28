import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Menu, X } from 'lucide-react';
import { useLang, useT } from '../i18n';
import { balanceLabel } from '../lib/format';
import { Drawer } from './Drawer';

let locks = 0;

/**
 * Stops the page behind a sheet from scrolling. Counted, so closing one of two open sheets
 * doesn't let the page move under the other.
 */
export function lockScroll(): () => void {
  locks++;
  document.body.classList.add('no-scroll');
  let done = false;
  return () => {
    if (done) return;
    done = true;
    locks = Math.max(0, locks - 1);
    if (!locks) document.body.classList.remove('no-scroll');
  };
}

/** how long a sheet takes to slide away; styles.css uses the same */
const CLOSE_MS = 190;

/**
 * Keeps something on screen for a moment after it is told to go, so it can animate out.
 * `closing` is true for that moment.
 */
export function useExit(open: boolean, ms = CLOSE_MS) {
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  useEffect(() => {
    if (open || !shown) return;
    const timer = setTimeout(() => setShown(false), ms);
    return () => clearTimeout(timer);
  }, [open, shown, ms]);
  return { shown: open || shown, closing: !open && shown };
}

export function TopBar({
  title,
  sub,
  back,
  menu,
  right,
  badge,
}: {
  title: string;
  sub?: string;
  back?: boolean;
  /** show the ☰ side menu (top-level pages) */
  menu?: boolean;
  right?: ReactNode;
  /** shown right after the title, e.g. the premium crown */
  badge?: ReactNode;
}) {
  const nav = useNavigate();
  const t = useT();
  const [drawer, setDrawer] = useState(false);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  return (
    <header className="topbar">
      {menu && (
        <>
          <button className="icon-btn" aria-label={t.nav.menu} onClick={() => setDrawer(true)}>
            <Menu size={22} />
          </button>
          <Drawer open={drawer} onClose={closeDrawer} />
        </>
      )}
      {back && (
        <button
          className="icon-btn"
          aria-label={t.common.back}
          onClick={() => (window.history.state?.idx > 0 ? nav(-1) : nav('/'))}
        >
          <ArrowLeft size={22} />
        </button>
      )}
      <div className="topbar-title">
        <h1>
          <span>{title}</span>
          {badge}
        </h1>
        {sub && <p>{sub}</p>}
      </div>
      {right}
    </header>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const t = useT();
  const { shown, closing } = useExit(open);
  // the latest onClose, without re-running the effect below on every render
  const close = useRef(onClose);
  close.current = onClose;
  // while sliding away the sheet keeps what it last showed; many callers empty it on close
  const last = useRef({ title, children, footer });
  if (open) last.current = { title, children, footer };
  const view = open ? { title, children, footer } : last.current;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    const unlock = lockScroll();
    return () => {
      window.removeEventListener('keydown', onKey);
      unlock();
    };
  }, [open]);

  if (!shown) return null;
  return createPortal(
    <div
      className={`modal-backdrop ${closing ? 'closing' : ''}`}
      onMouseDown={(e) => open && e.target === e.currentTarget && onClose()}
    >
      <div className={`modal ${className ?? ''}`} role="dialog" aria-modal="true" aria-label={view.title}>
        <div className="modal-head">
          <h2>{view.title}</h2>
          <button className="icon-btn" aria-label={t.common.close} onClick={() => open && onClose()}>
            <X size={22} />
          </button>
        </div>
        <div className="modal-body">{view.children}</div>
        {view.footer && <div className="modal-foot">{view.footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

const TOAST_EVENT = 'easyledger-toast';

export function toast(message: string) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message }));
}

export function Toaster() {
  const [msg, setMsg] = useState<{ text: string; n: number } | null>(null);
  const { shown, closing } = useExit(!!msg?.text);
  const last = useRef(msg);
  if (msg) last.current = msg;
  useEffect(() => {
    let timer: number | undefined;
    let n = 0;
    const on = (e: Event) => {
      setMsg({ text: (e as CustomEvent<string>).detail, n: ++n });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMsg(null), 2600);
    };
    window.addEventListener(TOAST_EVENT, on);
    return () => {
      window.removeEventListener(TOAST_EVENT, on);
      window.clearTimeout(timer);
    };
  }, []);
  const shownMsg = msg ?? last.current;
  return shown && shownMsg ? (
    // a new message pops in afresh instead of silently replacing the old one
    <div key={shownMsg.n} className={`toast ${closing ? 'leaving' : ''}`} role="status">
      {shownMsg.text}
    </div>
  ) : null;
}

export function Balance({ value }: { value: number }) {
  const b = balanceLabel(value, useLang());
  return (
    <span className={`balance tone-${b.tone}`}>
      <span className="balance-value">{b.text}</span>
      <span className="balance-label">{b.label}</span>
    </span>
  );
}

/** Dashboard number card with a coloured left edge, as on the home screen. */
export function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent: 'primary' | 'good' | 'due' | 'plain';
}) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <span className="stat-label">
        <span className="stat-icon">{icon}</span>
        {label}
      </span>
      <strong className="stat-value">{value}</strong>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode; tone?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`${value === o.value ? 'active' : ''} ${o.tone ?? ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

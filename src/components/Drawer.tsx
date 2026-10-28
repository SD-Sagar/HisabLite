import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router-dom';
import {
  BellRing, BookUp, CalendarDays, Crown, DatabaseBackup, Home, Languages, PenLine, ScanLine, Settings, UserCog, Users, X,
} from 'lucide-react';
import { useT, type Dict } from '../i18n';
import { canScan, useShopStatus } from '../lib/access';
import { cloudEnabled } from '../lib/cloud';
import { useSettings } from '../settings';
import { Logo } from './Logo';
import { Support, useContactUs, WhatsAppIcon } from './Support';
import { lockScroll, useExit } from './ui';

/** `scan` marks the link to reading khata photos, which says “শীঘ্রই” until that is ready */
type DrawerLink = { to: string; icon: ReactNode; label: keyof Dict['nav']; end?: boolean; scan?: boolean };

const LINKS: DrawerLink[] = [
  { to: '/', icon: <Home size={20} />, label: 'home', end: true },
  { to: '/customers', icon: <Users size={20} />, label: 'customers' },
  { to: '/scan', icon: <ScanLine size={20} />, label: 'scanPage', scan: true },
  { to: '/entry/new', icon: <PenLine size={20} />, label: 'manualEntry' },
  { to: '/import', icon: <BookUp size={20} />, label: 'importOld' },
  { to: '/reminders', icon: <BellRing size={20} />, label: 'reminders' },
  { to: '/day', icon: <CalendarDays size={20} />, label: 'day' },
  { to: '/settings', icon: <Settings size={20} />, label: 'settings', end: true },
  { to: '/settings#language', icon: <Languages size={20} />, label: 'language' },
  // plans exist only when the app runs with the cloud
  ...(cloudEnabled ? [{ to: '/plans', icon: <Crown size={20} />, label: 'plans' as const }] : []),
];

/** Backups are the owner's job; a shopkeeper's khata is kept safe in the cloud. */
const BACKUP_LINK: DrawerLink = { to: '/settings#backup', icon: <DatabaseBackup size={20} />, label: 'backup' };

/** only for the people who run EasyLedger */
const ADMIN_LINK: DrawerLink = { to: '/admin', icon: <UserCog size={20} />, label: 'admin' };

/** Side menu opened from the ☰ button in the top bar. */
export function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useSettings();
  const t = useT();
  const status = useShopStatus();
  const admin = !!status?.isAdmin;
  const scanSoon = status !== undefined && !canScan(status);
  const links = [...LINKS, ...(admin || !cloudEnabled ? [BACKUP_LINK] : []), ...(admin ? [ADMIN_LINK] : [])];
  const { write } = useContactUs();
  const { shown, closing } = useExit(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const unlock = lockScroll();
    return () => {
      window.removeEventListener('keydown', onKey);
      unlock();
    };
  }, [open, onClose]);

  if (!shown) return null;
  return createPortal(
    <div className={`drawer-backdrop ${closing ? 'closing' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <nav className="drawer" aria-label={t.nav.menu}>
        <div className="drawer-head">
          <Logo />
          <div>
            <strong>{settings?.shopName || 'HisabLite'}</strong>
            <small>HisabLite · {t.app.tagline}</small>
          </div>
          <button className="icon-btn" aria-label={t.nav.closeMenu} onClick={onClose}>
            <X size={22} />
          </button>
        </div>
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            // links into a section of সেটিংস would otherwise light up together with সেটিংস itself
            className={({ isActive }) => `drawer-link${isActive && !l.to.includes('#') ? ' active' : ''}`}
            onClick={onClose}
          >
            {l.icon}
            {t.nav[l.label]}
            {l.scan && scanSoon && <span className="soon-tag">{t.nav.soon}</span>}
          </NavLink>
        ))}
        {/* a shop that wants EasyLedger on its computer asks for it on WhatsApp, straight from here */}
        <button
          type="button"
          className="drawer-link"
          onClick={() => {
            write(t.desktop.message);
            onClose();
          }}
        >
          <WhatsAppIcon size={20} />
          {t.desktop.contact}
        </button>
        {/* help is one tap from every page */}
        <div className="drawer-support">
          <Support compact />
        </div>
      </nav>
    </div>,
    document.body,
  );
}

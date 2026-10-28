import { useEffect, useLayoutEffect } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { CalendarDays, Home as HomeIcon, ReceiptText, Settings as SettingsIcon } from 'lucide-react';
import { PlanWatcher } from './components/Access';
import { AppRouter } from './components/AppRouter';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppLock } from './components/Lock';
import { Toaster } from './components/ui';
import { isLang, LangContext, setLang, tr, useT } from './i18n';
import { accessFrom, hasPremium, useShopStatus } from './lib/access';
import { AccountContext, useAuth, type Account } from './lib/auth';
import { LedgerProvider } from './lib/hooks';
import { startSync } from './lib/sync';
import Admin from './pages/Admin';
import BillView from './pages/BillView';
import CustomerPage from './pages/CustomerPage';
import Customers from './pages/Customers';
import DayBook from './pages/DayBook';
import EntryForm from './pages/EntryForm';
import Home from './pages/Home';
import Login from './pages/Login';
import KhataView from './pages/KhataView';
import Plans from './pages/Plans';
import Reminders from './pages/Reminders';
import Import from './pages/Import';
import Scan from './pages/Scan';
import Settings from './pages/Settings';
import { DEFAULT_THEME, DEFAULT_TONE, forTheme, pageColor, useSettings } from './settings';

function BottomNav() {
  const t = useT();
  return (
    <nav className="bottom-nav">
      <NavLink to="/" end>
        <HomeIcon size={22} />
        <span>{t.nav.home}</span>
      </NavLink>
      {/* the customer list is on the home screen; this slot is for a ফর্দ with item lines */}
      <NavLink to="/entry/new">
        <ReceiptText size={22} />
        <span>{t.nav.newBill}</span>
      </NavLink>
      <NavLink to="/day">
        <CalendarDays size={22} />
        <span>{t.nav.day}</span>
      </NavLink>
      <NavLink to="/settings">
        <SettingsIcon size={22} />
        <span>{t.nav.settings}</span>
      </NavLink>
    </nav>
  );
}

function Shell({ account }: { account: Account }) {
  const { pathname, search } = useLocation();
  const showNav = !pathname.startsWith('/entry');

  // while a shop is logged in, its khata is kept in step with the cloud
  useEffect(() => (account.shopId ? startSync(account.shopId) : undefined), [account.shopId]);

  return (
    <AccountContext.Provider value={account}>
      <LedgerProvider>
        <div className={`app ${showNav ? 'with-nav' : ''}`}>
          <main>
            {/* a screen that breaks shows a way out; moving to another page starts it afresh */}
            <ErrorBoundary key={pathname}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/customers" element={<Customers />} />
                <Route path="/c/:id" element={<CustomerPage />} />
                {/* a fresh form whenever the customer or type in the link changes */}
                <Route path="/entry/new" element={<EntryForm key={`new${search}`} />} />
                <Route path="/entry/:id" element={<EntryForm />} />
                <Route path="/scan" element={<Scan />} />
                <Route path="/import" element={<Import />} />
                <Route path="/day" element={<DayBook />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/plans" element={<Plans />} />
                <Route path="/reminders" element={<Reminders />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="*" element={<Home />} />
              </Routes>
            </ErrorBoundary>
          </main>
          {showNav && <BottomNav />}
          <Toaster />
          {account.shopId && <PlanWatcher />}
        </div>
      </LedgerProvider>
    </AccountContext.Provider>
  );
}

export default function App() {
  const settings = useSettings();
  const auth = useAuth();
  const status = useShopStatus();
  const access = accessFrom(status);
  const premium = hasPremium(access);
  const lang = settings?.lang ?? 'bn';
  const { themeColor: theme, bgTone: tone } = settings
    ? forTheme(settings, premium)
    : { themeColor: DEFAULT_THEME, bgTone: DEFAULT_TONE };
  // Helpers outside React (dates, ফর্দ, AI errors) read this, so it is set before anything below renders.
  setLang(lang);

  useLayoutEffect(() => {
    document.documentElement.lang = lang;
    document.title = tr(lang).app.docTitle;
  }, [lang]);

  // the lighter/darker shades in styles.css are mixed from --primary; the page colour from the tone
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme) root.style.setProperty('--primary', theme);
    if (tone) root.dataset.bg = tone;
    // the phone's status bar in the same colour as the page
    if (theme && tone) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', pageColor(tone, theme));
  }, [theme, tone]);

  // wait for the saved language so the first screen isn't drawn in the wrong one
  if (!settings) return null;
  // a customer opening a link their shop sent them: no login, nothing of ours in the way
  const hash = window.location.hash;
  const shared = /^#\/k\/([\w-]+)/.exec(hash)?.[1];
  const bill = /^#\/f\/([\w-]+)/.exec(hash)?.[1];
  if (shared || bill) {
    // a ফর্দ link says which language its shop uses
    const linkLang = /[?&]l=(bn|hi|en)\b/.exec(hash)?.[1];
    const viewLang = linkLang && isLang(linkLang) ? linkLang : lang;
    setLang(viewLang);
    return (
      <LangContext.Provider value={viewLang}>
        <ErrorBoundary>{shared ? <KhataView token={shared} /> : <BillView token={bill!} />}</ErrorBoundary>
      </LangContext.Provider>
    );
  }
  if (auth.status === 'loading') return null;
  return (
    <LangContext.Provider value={lang}>
      <ErrorBoundary>
        {auth.status === 'out' ? (
          <>
            <Login />
            <Toaster />
          </>
        ) : (
          <AppLock phone={auth.phone}>
            <AppRouter>
              <Shell account={{ shopId: auth.shopId, phone: auth.phone }} />
            </AppRouter>
          </AppLock>
        )}
      </ErrorBoundary>
    </LangContext.Provider>
  );
}

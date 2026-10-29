import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Loader2, LogIn, Store } from 'lucide-react';
import { Logo } from '../components/Logo';
import { Support, WhatsAppIcon } from '../components/Support';
import { Segmented } from '../components/ui';
import { LANGS, useLang, useT, type Lang } from '../i18n';
import { authMessage, fullPhone, isTaken, logIn, MIN_PASSWORD, signUp, usedHere } from '../lib/auth';
import { prettyPhone } from '../lib/format';
import { usePayConfig } from '../lib/pay';
import { openWhatsApp } from '../lib/share';
import { getSettings, saveSettings, useSettings, withLanguage } from '../settings';

type Mode = 'login' | 'signup';

/**
 * Mobile number and password. A new number opens a new shop, free for good. A phone nobody has
 * logged in on starts on "new shop", since that is who opens the app first.
 */
export default function Login() {
  const t = useT();
  const lang = useLang();
  const settings = useSettings();
  const config = usePayConfig();
  const cc = (settings?.countryCode ?? '91').replace(/\D/g, '') || '91';
  const [mode, setMode] = useState<Mode>(() => (usedHere() ? 'login' : 'signup'));
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  // a new password is shown while it is typed, so a typo can't lock the shop out
  const [show, setShow] = useState(mode === 'signup');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);

  const switchTo = (m: Mode) => {
    setMode(m);
    setShow(m === 'signup');
    setError(null);
    setForgot(false);
  };

  // once logged in, the app replaces this screen with the khata
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const to = fullPhone(phone, cc);
    if (!to) return setError(t.auth.badPhone);
    if (password.length < MIN_PASSWORD) return setError(t.auth.shortPassword);
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await logIn(to, password);
      else
        await signUp(to, password).catch(async (err) => {
          // the number already has a shop: with its password, this is simply logging in
          if (!isTaken(err)) throw err;
          await logIn(to, password).catch(() => {
            switchTo('login');
            throw err;
          });
        });
    } catch (err) {
      console.error(err);
      setError(authMessage(err));
      setBusy(false);
    }
  };

  // the language is this phone's own, so picking it here isn't sent to the cloud
  const chooseLang = async (l: Lang) => {
    const s = await getSettings();
    if (s.lang !== l) await saveSettings(withLanguage(s, l), 'cloud');
  };

  const typed = fullPhone(phone, cc);

  return (
    <div className="login">
      <div className="lang-pills" role="radiogroup">
        {LANGS.map((l) => (
          <button
            key={l.id}
            type="button"
            role="radio"
            lang={l.id}
            aria-checked={lang === l.id}
            className={lang === l.id ? 'active' : ''}
            onClick={() => void chooseLang(l.id)}
          >
            {l.name}
          </button>
        ))}
      </div>

      <div className="login-brand">
        <Logo />
        <h1>খাতায়-কলমে</h1>
        <span className="brand-subtitle" style={{ fontSize: '14px', fontWeight: 600, color: 'var(--muted)', marginTop: '-4px', display: 'block' }}>Khatay-Kalomay</span>
        <p>{t.app.tagline}</p>
      </div>

      <section className="card login-card">
        <Segmented
          value={mode}
          options={[
            { value: 'login', label: t.auth.login },
            { value: 'signup', label: t.auth.signup },
          ]}
          onChange={switchTo}
        />
        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>{t.auth.phone}</span>
            <span className="money-input phone-input">
              <span>+{cc}</span>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                autoFocus
                placeholder="98xxxxxxxx"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </span>
          </label>
          <label className="field">
            <span>{mode === 'signup' ? t.auth.newPassword : t.auth.password}</span>
            <span className="password-input">
              <input
                type={show ? 'text' : 'password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t.auth.passwordHint}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className="icon-btn" aria-label={show ? t.auth.hide : t.auth.show} onClick={() => setShow(!show)}>
                {show ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </span>
          </label>
          {mode === 'signup' && <p className="muted small">{t.auth.remember}</p>}
          <button className="btn primary big block" disabled={busy}>
            {busy ? <Loader2 className="spin" size={20} /> : mode === 'signup' ? <Store size={20} /> : <LogIn size={20} />}{' '}
            {mode === 'signup' ? t.auth.create : t.auth.enter}
          </button>
          {mode === 'login' && (
            <button type="button" className="btn ghost small login-forgot" onClick={() => setForgot(!forgot)}>
              {t.auth.forgot}
            </button>
          )}
        </form>
        {error && <p className="notice error">{error}</p>}
        {forgot && mode === 'login' && (
          <div className="notice info login-help">
            <span>{t.auth.forgotHelp}</span>
            {config.supportPhone && (
              <button
                type="button"
                className="btn whatsapp small"
                onClick={() => openWhatsApp(config.supportPhone, t.auth.forgotMessage(typed ? prettyPhone(typed) : ''))}
              >
                <WhatsAppIcon size={16} /> {t.auth.whatsapp}
              </button>
            )}
          </div>
        )}
      </section>

      {/* someone who can't get in can't reach the menu either, so help is here too */}
      <Support compact />
    </div>
  );
}

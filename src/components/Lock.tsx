import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { KeyRound, Loader2, Lock as LockIcon } from 'lucide-react';
import { useT } from '../i18n';
import { supabase } from '../lib/cloud';
import { checkPin, clearPin, PIN_LENGTH, setPin, usePin } from '../lib/pin';
import { useSettings } from '../settings';
import { Keypad } from './Keypad';
import { Logo } from './Logo';
import { Modal, toast } from './ui';

/** away from the app longer than this, and the PIN is asked again */
const AWAY_MS = 2 * 60_000;
/** every fifth wrong PIN in a row makes the next try wait this long */
const WAIT_MS = 30_000;

/**
 * Asks for the app's PIN when the app is opened, and again after it has been in the background
 * for a while. A quick trip to WhatsApp to send a ফর্দ doesn't lock it. The screen underneath stays
 * as it was, so a half-written ফর্দ is still there after unlocking.
 */
export function AppLock({ phone, children }: { phone: string; children: ReactNode }) {
  const pin = usePin();
  const [unlocked, setUnlocked] = useState(false);

  // no PIN means nothing to unlock; a PIN set just now doesn't lock the shop out of the screen it is on
  useEffect(() => {
    if (pin === null) setUnlocked(true);
  }, [pin]);

  useEffect(() => {
    let hiddenAt = 0;
    const onVisible = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > AWAY_MS) setUnlocked(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // nothing is drawn until it is known whether there is a PIN, so the khata never flashes up first
  if (pin === undefined) return null;
  const locked = !!pin && !unlocked;
  return (
    <>
      <div className="lock-host" inert={locked}>
        {children}
      </div>
      {locked && <LockScreen phone={phone} onUnlock={() => setUnlocked(true)} />}
    </>
  );
}

/** The four dots that fill as the PIN is typed. */
function PinDots({ filled, shake }: { filled: number; shake: boolean }) {
  return (
    <div className={`pin-dots ${shake ? 'shake' : ''}`} aria-hidden="true">
      {Array.from({ length: PIN_LENGTH }, (_, i) => (
        <span key={i} className={i < filled ? 'on' : ''} />
      ))}
    </div>
  );
}

/**
 * Typing a PIN on the keypad (or a computer's keyboard). Calls onFull with the four digits;
 * resolves false to shake and start again.
 */
function usePinEntry(onFull: (pin: string) => Promise<boolean | void>, disabled = false) {
  const [digits, setDigits] = useState('');
  const [shake, setShake] = useState(false);
  const typed = useRef('');
  const busy = useRef(false);

  const show = (value: string) => {
    typed.current = value;
    setDigits(value);
  };

  const press = useCallback(
    (d: string) => {
      if (busy.current || disabled || !/^\d$/.test(d)) return;
      const next = (typed.current + d).slice(0, PIN_LENGTH);
      show(next);
      if (next.length < PIN_LENGTH) return;
      busy.current = true;
      void onFull(next).then((ok) => {
        if (ok !== false) {
          show('');
          busy.current = false;
          return;
        }
        navigator.vibrate?.(120);
        setShake(true);
        setTimeout(() => {
          setShake(false);
          show('');
          busy.current = false;
        }, 420);
      });
    },
    [onFull, disabled],
  );
  const back = useCallback(() => {
    if (!busy.current) show(typed.current.slice(0, -1));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, back]);

  return { digits, shake, press, back };
}

function LockScreen({ phone, onUnlock }: { phone: string; onUnlock: () => void }) {
  const t = useT();
  const settings = useSettings();
  const [wrong, setWrong] = useState(0);
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [forgot, setForgot] = useState(false);
  const waiting = waitUntil > now;

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [waiting]);

  const entry = usePinEntry(
    useCallback(
      async (pin: string) => {
        if (await checkPin(pin)) {
          onUnlock();
          return true;
        }
        setWrong((n) => {
          if ((n + 1) % 5 === 0) {
            setWaitUntil(Date.now() + WAIT_MS);
            setNow(Date.now());
          }
          return n + 1;
        });
        return false;
      },
      [onUnlock],
    ),
    waiting,
  );

  return createPortal(
    <div className="lock" role="dialog" aria-modal="true" aria-label={t.lock.title}>
      <div className="lock-top">
        <Logo size={64} />
        <h1>{settings?.shopName || 'খাতায়-কলমে'}</h1>
        <p>
          <LockIcon size={15} /> {t.lock.enter}
        </p>
      </div>
      <PinDots filled={entry.digits.length} shake={entry.shake} />
      <p className={`lock-note ${wrong ? 'bad' : ''}`}>
        {waiting ? t.lock.wait(Math.ceil((waitUntil - now) / 1000)) : wrong ? t.lock.wrong : ' '}
      </p>
      <Keypad onDigit={entry.press} onBack={entry.back} className="lock-keys" />
      <button type="button" className="btn ghost small lock-forgot" onClick={() => setForgot(true)}>
        {t.lock.forgot}
      </button>
      <ForgotPin open={forgot} phone={phone} onClose={() => setForgot(false)} onDone={onUnlock} />
    </div>,
    document.body,
  );
}

/**
 * A forgotten PIN is taken off with the account's password (the same one used to log in on a new
 * phone). The app built without the cloud has no password, so there it can simply be removed.
 */
function ForgotPin({ open, phone, onClose, onDone }: { open: boolean; phone: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = async () => {
    await clearPin();
    toast(t.lock.removed);
    onClose();
    onDone();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return done();
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({
        phone: phone.startsWith('+') ? phone : `+${phone}`,
        password,
      });
      if (err) throw err;
      await done();
    } catch (err) {
      console.error(err);
      setError(!navigator.onLine ? t.auth.offline : t.lock.badPassword);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t.lock.forgotTitle}>
      <form className="form" onSubmit={submit}>
        {supabase ? (
          <>
            <p className="muted">{t.lock.forgotHelp}</p>
            <label className="field">
              <span>{t.auth.password}</span>
              <input
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </>
        ) : (
          <p className="muted">{t.lock.forgotLocal}</p>
        )}
        {error && <p className="notice error">{error}</p>}
        <button className="btn primary big block" disabled={busy || (!!supabase && !password)}>
          {busy ? <Loader2 className="spin" size={20} /> : <KeyRound size={20} />} {t.lock.removePin}
        </button>
      </form>
    </Modal>
  );
}

type SetupStep = 'old' | 'new' | 'again';

/**
 * Setting, changing or turning off the PIN, from সেটিংস. Changing or turning it off asks for the
 * current one first.
 */
export function PinSetup({ mode, onClose }: { mode: 'set' | 'change' | 'off' | null; onClose: () => void }) {
  const t = useT();
  const [step, setStep] = useState<SetupStep>('new');
  const [first, setFirst] = useState('');
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!mode) return;
    setStep(mode === 'set' ? 'new' : 'old');
    setFirst('');
    setNote(null);
  }, [mode]);

  const entry = usePinEntry(
    useCallback(
      async (pin: string) => {
        if (step === 'old') {
          if (!(await checkPin(pin))) {
            setNote(t.lock.wrong);
            return false;
          }
          setNote(null);
          if (mode === 'off') {
            await clearPin();
            toast(t.lock.turnedOff);
            onClose();
            return true;
          }
          setStep('new');
          return true;
        }
        if (step === 'new') {
          setFirst(pin);
          setStep('again');
          setNote(null);
          return true;
        }
        if (pin !== first) {
          setNote(t.lock.mismatch);
          setStep('new');
          setFirst('');
          return false;
        }
        await setPin(pin);
        toast(t.lock.saved);
        onClose();
        return true;
      },
      [step, first, mode, onClose, t],
    ),
    !mode,
  );

  const heading = step === 'old' ? t.lock.current : step === 'new' ? t.lock.choose : t.lock.again;

  return (
    <Modal open={!!mode} onClose={onClose} title={mode === 'off' ? t.lock.turnOff : mode === 'change' ? t.lock.change : t.lock.set} className="pin-sheet">
      <p className="pin-heading">{heading}</p>
      <PinDots filled={entry.digits.length} shake={entry.shake} />
      <p className={`lock-note ${note ? 'bad' : ''}`}>{note ?? (step === 'new' ? t.lock.chooseHelp : ' ')}</p>
      <Keypad onDigit={entry.press} onBack={entry.back} />
    </Modal>
  );
}

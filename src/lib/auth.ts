import { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { wipeLocalData } from '../db';
import { tr } from '../i18n';
import { DEFAULT_SETTINGS, getSettings, saveSettings, withLanguage } from '../settings';
import { supabase } from './cloud';
import { refreshAccess } from './access';
import { claimDevice, pendingCount, syncNow } from './sync';

export type AuthState =
  | { status: 'loading' }
  | { status: 'out' }
  /** shopId is null when the app runs without the cloud */
  | { status: 'in'; shopId: string | null; phone: string };

export interface Account {
  shopId: string | null;
  phone: string;
}

export const AccountContext = createContext<Account>({ shopId: null, phone: '' });
export const useAccount = () => useContext(AccountContext);

const STORAGE_KEY = 'easyledger-auth';
/** set once any shop has logged in on this phone: the login screen then starts on "log in" */
const USED_KEY = 'easyledger-used';

export function usedHere(): boolean {
  try {
    return !!localStorage.getItem(USED_KEY);
  } catch {
    return false;
  }
}

/**
 * The login saved on this phone. Offline, Supabase can't refresh an old token and reports no
 * session, but the shop is still logged in and its khata must stay usable.
 */
function savedLogin(): { id: string; phone: string } | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return s?.user?.id ? { id: s.user.id, phone: s.user.phone ?? '' } : null;
  } catch {
    return null;
  }
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>(supabase ? { status: 'loading' } : { status: 'in', shopId: null, phone: '' });

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    const show = async (session: Session | null) => {
      const user = session ? { id: session.user.id, phone: session.user.phone ?? '' } : savedLogin();
      if (!user) {
        if (alive) setState({ status: 'out' });
        return;
      }
      await claimDevice(user.id);
      try {
        localStorage.setItem(USED_KEY, '1');
      } catch {
        // only decides which tab the login screen opens on
      }
      if (alive) setState((s) => (s.status === 'in' && s.shopId === user.id ? s : { status: 'in', shopId: user.id, phone: user.phone }));
    };
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Supabase asks not to await its own calls inside this callback, hence the timeout
      if (event === 'SIGNED_OUT') setTimeout(() => alive && setState({ status: 'out' }));
      else setTimeout(() => void show(session));
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return state;
}

/** +91 and ten digits; null if it isn't a mobile number */
export function fullPhone(input: string, countryCode: string): string | null {
  const digits = input
    .replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6))
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/\D/g, '')
    .replace(/^0/, '');
  const cc = countryCode.replace(/\D/g, '') || '91';
  const local = digits.length === 10 + cc.length && digits.startsWith(cc) ? digits.slice(cc.length) : digits;
  return /^[6-9]\d{9}$/.test(local) ? `+${cc}${local}` : null;
}

/** Supabase's own lowest allowed length */
export const MIN_PASSWORD = 6;

/** A new shop: the number becomes its login, and its first 30 days are free. */
export async function signUp(phone: string, password: string) {
  const { data, error } = await supabase!.auth.signUp({ phone, password });
  if (error) throw error;
  // only when the project still wants numbers confirmed by SMS, which EasyLedger doesn't send
  if (!data.session) throw new Error('signed up without a session');
  await refreshAccess().catch(() => undefined);
}

export async function logIn(phone: string, password: string) {
  const { error } = await supabase!.auth.signInWithPassword({ phone, password });
  if (error) throw error;
  await refreshAccess().catch(() => undefined);
}

export async function changePassword(password: string) {
  const { error } = await supabase!.auth.updateUser({ password });
  if (error) throw error;
}

const errorOf = (e: unknown) => (e ?? {}) as { code?: string; status?: number; message?: string };

/** signing up with a number that already has a shop */
export const isTaken = (e: unknown) => {
  const { code = '', message = '' } = errorOf(e);
  return code === 'user_already_exists' || code === 'phone_exists' || /already (registered|exists)/i.test(message);
};

/** A login error in words a shopkeeper understands. */
export function authMessage(e: unknown): string {
  const t = tr().auth;
  const { code = '', status, message = '' } = errorOf(e);
  if (!navigator.onLine || /fetch|network/i.test(message)) return t.offline;
  if (code.includes('rate_limit') || status === 429) return t.tooMany;
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) return t.wrongPassword;
  if (isTaken(e)) return t.taken;
  if (code === 'weak_password') return t.shortPassword;
  if (code === 'validation_failed') return t.badPhone;
  return t.failed;
}

/**
 * Logs this phone out and clears the khata from it (it stays in the cloud). Returns how many
 * changes never reached the cloud, without logging out, unless force is set.
 */
export async function logOut(force = false): Promise<number> {
  await syncNow();
  const unsent = await pendingCount();
  if (unsent && !force) return unsent;
  await supabase?.auth.signOut({ scope: 'local' });
  const { lang } = await getSettings();
  await wipeLocalData();
  // the next shop on this phone starts clean, in the language the phone was using
  await saveSettings(withLanguage(DEFAULT_SETTINGS, lang), 'cloud');
  return 0;
}

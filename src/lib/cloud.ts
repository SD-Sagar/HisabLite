import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * The Supabase project. null when the app is built without one: then there is no login and
 * the khata stays on this device only, as it always did.
 */
export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'easyledger-auth' },
      })
    : null;

export const cloudEnabled = !!supabase;

/** khata photos live at khata/<shop id>/<photo uid>.jpg */
export const PHOTO_BUCKET = 'khata';

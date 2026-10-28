import { tr } from '../i18n';
import { refreshAccess } from './access';
import { supabase } from './cloud';
import { OcrError, type ServerConn } from './ocr-shared';

/**
 * Starts a scan on the owner's AI key (supabase/functions/ai). The server counts it against a free
 * shop's scans for the month and hands back a ticket; the Gemini client then talks to the
 * function instead of to Google, with the shop's login and that ticket.
 */
export async function startServerScan(): Promise<ServerConn> {
  const t = tr();
  if (!supabase) throw new OcrError(t.scan.comingSoon);
  const { data, error } = await supabase.rpc('start_scan');
  if (error) {
    // the server hasn't been given this part yet
    if (error.code === 'PGRST202' || /start_scan/.test(error.message)) throw new OcrError(t.scan.comingSoon);
    if (!navigator.onLine || /fetch|network/i.test(error.message)) throw new OcrError(t.ocr.offline);
    throw error;
  }
  const r = data as { allowed?: boolean; ticket?: string } | null;
  // the free scans are counted on the server; show the new count at once
  void refreshAccess().catch(() => undefined);
  if (!r?.allowed || !r.ticket) throw new OcrError(t.ocr.scansOver);
  const { data: session } = await supabase.auth.getSession();
  return {
    baseUrl: `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, '')}/functions/v1/ai`,
    headers: {
      Authorization: `Bearer ${session.session?.access_token ?? ''}`,
      apikey: String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''),
      'x-scan-ticket': r.ticket,
    },
  };
}

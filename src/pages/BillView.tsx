import { useState } from 'react';
import { Download, ImageOff, Loader2 } from 'lucide-react';
import { Logo } from '../components/Logo';
import { toast } from '../components/ui';
import { useT } from '../i18n';
import { billImageUrl } from '../lib/billLink';
import { usePayConfig } from '../lib/pay';
import { downloadBlob } from '../lib/share';

/**
 * What a customer sees after tapping the ফর্দ link from their shop: the ফর্দ itself, a button to
 * keep it, and a small word about the app. No login, nothing else of the shop's.
 */
export default function BillView({ token }: { token: string }) {
  const t = useT();
  const config = usePayConfig();
  const [state, setState] = useState<'loading' | 'ok' | 'gone'>('loading');
  const [saving, setSaving] = useState(false);
  const url = billImageUrl(token);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      downloadBlob(await res.blob(), `${t.bill.fileBase}-${token.slice(0, 6)}.png`);
    } catch (e) {
      console.error(e);
      toast(t.common.genericError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="khata-page bill-view">
      {state === 'gone' ? (
        <section className="card center bill-gone">
          <ImageOff size={36} />
          <h1>{t.billView.gone}</h1>
          <p className="muted">{t.billView.goneHelp}</p>
        </section>
      ) : (
        <>
          <div className={`bill-view-frame ${state}`}>
            {state === 'loading' && (
              <div className="bill-loading">
                <Loader2 className="spin" size={28} />
              </div>
            )}
            <img src={url} alt={t.send.billAlt} onLoad={() => setState('ok')} onError={() => setState('gone')} />
          </div>
          {state === 'ok' && (
            <button type="button" className="btn primary big block" disabled={saving} onClick={save}>
              {saving ? <Loader2 className="spin" size={20} /> : <Download size={20} />} {t.billView.save}
            </button>
          )}
        </>
      )}

      <footer className="khata-foot">
        <Logo />
        <span>{t.billView.madeWith}</span>
        {config.appLink && (
          <a className="btn ghost small" href={config.appLink} target="_blank" rel="noopener">
            {t.khata.getApp}
          </a>
        )}
      </footer>
    </div>
  );
}

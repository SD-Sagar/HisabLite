import { useEffect, useState } from 'react';
import { Loader2, Phone, ShoppingBasket, Wallet } from 'lucide-react';
import { Logo } from '../components/Logo';
import { useT } from '../i18n';
import { fmtDate, itemsSummary, money } from '../lib/format';
import { fetchKhataView, type KhataView as Khata } from '../lib/khata';
import { usePayConfig } from '../lib/pay';

/**
 * The page a customer opens from the link their shop sent: their own khata, read only, with no
 * login. It is the same numbers the shop sees, which is the point of sending it.
 */
export default function KhataView({ token }: { token: string }) {
  const t = useT();
  const config = usePayConfig();
  const [khata, setKhata] = useState<Khata | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchKhataView(token).then(setKhata, () => setFailed(true));
  }, [token]);

  if (khata === undefined && !failed) {
    return (
      <div className="khata-page center">
        <Loader2 className="spin" size={28} />
      </div>
    );
  }

  if (!khata) {
    return (
      <div className="khata-page">
        <section className="card center">
          <h1>{t.khata.gone}</h1>
          <p className="muted">{t.khata.goneHelp}</p>
        </section>
      </div>
    );
  }

  const advance = khata.balance < -0.004;
  return (
    <div className="khata-page">
      <header className="khata-head">
        <h1>{khata.shop.name || 'খাতায়-কলমে'}</h1>
        {khata.shop.phone && (
          <a className="khata-phone" href={`tel:${khata.shop.phone}`}>
            <Phone size={16} /> {khata.shop.phone}
          </a>
        )}
      </header>

      <section className={`card khata-due ${advance ? 'good' : ''}`}>
        <span>{khata.customer.name}</span>
        <strong>{money(Math.abs(khata.balance))}</strong>
        <small>{advance ? t.khata.advance : t.khata.due}</small>
        <small className="muted">{t.khata.asOf(fmtDate(khata.as_of.slice(0, 10)))}</small>
      </section>

      <section className="tile-section">
        {khata.entries.map((e, i) => (
          <div key={i} className="khata-row">
            <span className={`txn-icon ${e.type === 'sale' ? 'bill' : 'payment'}`}>
              {e.type === 'sale' ? <ShoppingBasket size={18} /> : <Wallet size={18} />}
            </span>
            <span className="tile-main">
              <strong>{e.type === 'sale' ? t.khata.goods : t.khata.payment}</strong>
              <small>
                {fmtDate(e.date)}
                {e.type === 'sale' && e.items.length ? ` · ${itemsSummary(e.items)}` : ''}
                {e.note ? ` · ${e.note}` : ''}
              </small>
            </span>
            {e.type === 'sale' ? <b>{money(e.total)}</b> : <b className="tone-advance">− {money(e.paid)}</b>}
          </div>
        ))}
        {Math.abs(khata.opening) > 0.004 && (
          <div className="khata-row">
            <span className="txn-icon bill">
              <ShoppingBasket size={18} />
            </span>
            <span className="tile-main">
              <strong>{t.khata.opening}</strong>
            </span>
            <b>{money(khata.opening)}</b>
          </div>
        )}
        {!khata.entries.length && Math.abs(khata.opening) <= 0.004 && <p className="muted center">{t.khata.empty}</p>}
      </section>

      <footer className="khata-foot">
        <Logo />
        <span>{t.khata.madeWith}</span>
        {config.appLink && (
          <a className="btn ghost small" href={config.appLink} target="_blank" rel="noopener">
            {t.khata.getApp}
          </a>
        )}
      </footer>
    </div>
  );
}

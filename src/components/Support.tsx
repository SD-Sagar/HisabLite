import { Copy, Headset, Monitor, Phone } from 'lucide-react';
import { LANGS, tr, useT } from '../i18n';
import { useAccount } from '../lib/auth';
import { prettyPhone } from '../lib/format';
import { usePayConfig } from '../lib/pay';
import { callUrl, canCall, openWhatsApp } from '../lib/share';
import { useSettings } from '../settings';
import { toast } from './ui';

/** WhatsApp's own mark — the icon set has no brand logos — so the button is known at a glance */
export function WhatsAppIcon({ size = 20 }: { size?: number }) {
  return (
    <svg className="wa-logo" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

/**
 * The number people reach EasyLedger on, and `write`, which opens WhatsApp to it with a message
 * that already names the shop and the shopkeeper's own number.
 */
export function useContactUs() {
  const { supportPhone } = usePayConfig();
  const settings = useSettings();
  const { phone } = useAccount();
  // the shop's name only once the owner has written it; the starting one says nothing
  const shop = settings && !LANGS.some((l) => tr(l.id).defaults.shopName === settings.shopName) ? settings.shopName : '';
  const me = phone ? prettyPhone(phone) : '';
  const write = (message: (shop: string, phone: string) => string) => openWhatsApp(supportPhone, message(shop, me));
  return { supportPhone, write };
}

/**
 * Who to ring when the app gets stuck: the owner's number, a call button on a phone, and WhatsApp
 * with the shop already named in the message. A computer can't place a call, so there it offers
 * WhatsApp (the desktop app or WhatsApp Web) and shows the number to dial from a phone.
 * `compact` is the short form for the side menu and the login screen.
 */
export function Support({ compact, id }: { compact?: boolean; id?: string }) {
  const t = useT();
  const { supportPhone, write } = useContactUs();
  const phoneLike = canCall();
  const number = prettyPhone(supportPhone);
  const copy = () =>
    navigator.clipboard?.writeText(number).then(
      () => toast(t.plans.copied),
      () => toast(t.send.copyFailed),
    );

  const buttons = (
    <div className="support-actions">
      {phoneLike && (
        // quieter in the short form, so it never competes with the login button above it
        <a className={compact ? 'btn ghost' : 'btn primary big'} href={callUrl(supportPhone)}>
          <Phone size={compact ? 17 : 20} /> {t.support.call}
        </a>
      )}
      <button type="button" className={`btn whatsapp ${compact ? '' : 'big'}`} onClick={() => write(t.support.message)}>
        <WhatsAppIcon size={compact ? 18 : 21} /> {phoneLike ? t.support.whatsapp : t.support.whatsappDesktop}
      </button>
    </div>
  );

  if (compact) {
    return (
      <div className="support-compact">
        <span className="support-line">
          <Headset size={16} /> {t.support.ask}
          {phoneLike ? (
            <a href={callUrl(supportPhone)}>{number}</a>
          ) : (
            <b>{number}</b>
          )}
        </span>
        {buttons}
      </div>
    );
  }

  return (
    <section className="card support-card" id={id}>
      <div className="support-head">
        <span className="support-icon">
          <Headset size={22} />
        </span>
        <div>
          <h2>{t.support.title}</h2>
          <p className="muted">{phoneLike ? t.support.help : t.support.helpDesktop}</p>
        </div>
      </div>
      <div className="support-number">
        {phoneLike ? <a href={callUrl(supportPhone)}>{number}</a> : <span>{number}</span>}
        {!phoneLike && (
          <button type="button" className="icon-btn" aria-label={t.support.copy} title={t.support.copy} onClick={copy}>
            <Copy size={18} />
          </button>
        )}
      </div>
      {buttons}
    </section>
  );
}

/**
 * For a shop that wants EasyLedger on its computer: a single WhatsApp button whose message already
 * asks for the desktop app. No number, call or copy here — it is an enquiry, not the help line.
 */
export function DesktopContact({ id }: { id?: string }) {
  const t = useT();
  const { write } = useContactUs();
  return (
    <section className="card support-card" id={id}>
      <div className="support-head">
        <span className="support-icon">
          <Monitor size={22} />
        </span>
        <div>
          <h2>{t.desktop.title}</h2>
          <p className="muted">{t.desktop.help}</p>
        </div>
      </div>
      <button type="button" className="btn whatsapp big desktop-contact" onClick={() => write(t.desktop.message)}>
        <WhatsAppIcon size={21} /> {t.desktop.contact}
      </button>
    </section>
  );
}

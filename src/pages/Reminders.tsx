import { useMemo, useState } from 'react';
import { Check, MessageCircle, PartyPopper } from 'lucide-react';
import { usePremium } from '../components/Access';
import { Empty, TopBar } from '../components/ui';
import { isCashCustomer } from '../db';
import { useT } from '../i18n';
import { initials, money, waPhone } from '../lib/format';
import { useLedger } from '../lib/hooks';
import { openWhatsApp } from '../lib/share';
import { reminderMessage } from '../lib/template';
import { forMessages, useSettings } from '../settings';

/**
 * Everyone who owes something, biggest first, each a tap away from a WhatsApp reminder — free
 * for every shop. The browser only opens WhatsApp on a tap, so it is one tap per customer, which
 * also lets the shopkeeper skip whoever they don't want to chase today.
 */
export default function Reminders() {
  const t = useT();
  const ledger = useLedger();
  const settings = useSettings();
  // the reminder is in the shop's own words only with a plan
  const premium = usePremium();
  const [sent, setSent] = useState<number[]>([]);

  const rows = useMemo(
    () => (ledger?.customers ?? []).filter((c) => c.balance > 0.004 && !isCashCustomer(c)).sort((a, b) => b.balance - a.balance),
    [ledger],
  );
  const total = rows.reduce((s, c) => s + c.balance, 0);

  const nudge = (c: { id: number; name: string; phone: string; balance: number }) => {
    if (!settings) return;
    openWhatsApp(waPhone(c.phone, settings.countryCode), reminderMessage(c, c.balance, forMessages(settings, premium)));
    setSent((was) => (was.includes(c.id) ? was : [...was, c.id]));
  };

  return (
    <div className="page">
      <TopBar menu title={t.reminders.title} sub={rows.length ? t.reminders.sub(rows.length, money(total)) : undefined} />

      {!rows.length ? (
        <section className="card">
          <Empty icon={<PartyPopper size={36} />} title={t.reminders.nobody} />
        </section>
      ) : (
        <>
          <p className="notice info">{t.reminders.help}</p>
          <p className="muted small center">{t.reminders.done(sent.length, rows.length)}</p>
          <section className="tile-section">
            {rows.map((c) => {
              const already = sent.includes(c.id);
              return (
                <div key={c.id} className={`remind-row ${already ? 'sent' : ''}`}>
                  <span className="avatar">{initials(c.name)}</span>
                  <span className="tile-main">
                    <strong>{c.name}</strong>
                    <small>{c.phone || t.reminders.noPhone}</small>
                  </span>
                  <b className="tone-due">{money(c.balance)}</b>
                  <button
                    type="button"
                    className={`btn ${already ? 'ghost' : 'whatsapp'} small`}
                    onClick={() => nudge(c)}
                  >
                    {already ? <Check size={16} /> : <MessageCircle size={16} />} {already ? t.reminders.sent : t.reminders.send}
                  </button>
                </div>
              );
            })}
          </section>
          {sent.length === rows.length && <p className="notice info center">{t.reminders.allDone}</p>}
        </>
      )}
    </div>
  );
}

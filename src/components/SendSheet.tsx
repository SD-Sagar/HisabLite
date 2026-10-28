import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Crown, Download, Image as ImageIcon, Loader2, MessageCircle, Pencil, Printer } from 'lucide-react';
import { useT } from '../i18n';
import { forBill, type Settings } from '../settings';
import { billBlob, billCardBlob, billFileName, printsAsIs } from '../lib/bill';
import { canLinkBills, publishBill } from '../lib/billLink';
import { useBillBrand } from '../lib/brand';
import { waPhone } from '../lib/format';
import {
  canShareFiles, copyImage, downloadBlob, openWhatsApp, preparePrint, sendToChat, shareImage, whatsappUrl,
} from '../lib/share';
import type { BillData } from '../lib/template';
import { Modal, toast } from './ui';

export interface SendRequest {
  title: string;
  customerName: string;
  phone: string;
  message: string;
  /** when present, a ফর্দ image is offered too */
  bill?: BillData;
}

/**
 * What the shopkeeper sees after making a ফর্দ: the ফর্দ itself, and two ways to send it —
 * written, or as the picture. Nothing else, because this screen is used twenty times a day.
 * The message can still be changed, but only if they ask for it.
 */
export function SendSheet({
  request: incoming,
  settings,
  onClose,
}: {
  request: SendRequest | null;
  settings: Settings;
  onClose: () => void;
}) {
  const t = useT();
  const brand = useBillBrand();
  // the sheet keeps showing the last request while it slides away
  const kept = useRef(incoming);
  if (incoming) kept.current = incoming;
  const request = incoming ?? kept.current;
  const [message, setMessage] = useState('');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  /** the ফর্দ's link once it is in the cloud, and a WhatsApp button for when the phone blocked opening it */
  const [link, setLink] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  /** prints the ফর্দ; there once its paper copy is ready */
  const [print, setPrint] = useState<(() => void) | null>(null);
  const look = forBill(settings, brand.premium);

  useEffect(() => {
    if (!incoming) return;
    setMessage(incoming.message);
    setEditing(false);
    setBlob(null);
    setPreview(null);
    setLink(null);
    setBlocked(null);
    setPrint(null);
    const bill = incoming.bill;
    if (!bill) return;
    let url: string | null = null;
    let cancelled = false;
    const mark = { credit: brand.credit, link: brand.link };
    billBlob(bill, look, mark)
      .then((b) => {
        if (cancelled) return;
        url = URL.createObjectURL(b);
        setBlob(b);
        setPreview(url);
        // the paper copy is made once the ফর্দ is on screen, so the print dialog opens at once on a tap
        return billBlob(bill, look, mark, true).then((paper) =>
          preparePrint(paper, billFileName(bill, settings.lang).replace(/\.png$/, ''), printsAsIs(look.bill.design)),
        );
      })
      .then((fn) => {
        if (fn && !cancelled) setPrint(() => fn);
      })
      .catch((e) => console.error('ফর্দ:', e));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // look is rebuilt every render; what matters in it is the settings and the plan
  }, [incoming, settings, brand.premium, brand.credit, brand.link]);

  if (!request) return null;
  const phone = waPhone(request.phone, settings.countryCode);
  // a free shop's message ends with the app's line; it is added on the way out, not typed into
  // the box, so it goes with every message
  const appLine = brand.credit && brand.link ? t.send.appLine(brand.link) : '';
  const outgoing = appLine ? `${message}\n\n${appLine}` : message;
  const receipt = request.bill?.txn.type === 'payment';
  // a passer-by who paid cash usually wants the memo in hand, not on WhatsApp
  const cash = !!request.bill?.cash;
  const fileName = request.bill ? billFileName(request.bill, settings.lang) : `${t.bill.fileBase}.png`;
  const shareable = canShareFiles();
  // a customer with a number gets the ফর্দ as a link, straight into their own chat
  const byLink = !!phone && canLinkBills() && navigator.onLine;

  /** WhatsApp with this customer's chat open and the ফর্দ's link in the message box. */
  const openChat = (url: string) => {
    const text = receipt ? t.send.receiptLink(request.customerName, url) : t.send.billLink(request.customerName, url);
    const wa = whatsappUrl(phone, text);
    const opened = window.open(wa, '_blank');
    if (opened) opened.opener = null;
    // the phone stops a window that opens long after the tap; then one more tap does it
    else setBlocked(wa);
  };

  /**
   * The picture. With the customer's number and the internet, the ফর্দ goes up to the cloud and
   * their chat opens with its link (WhatsApp shows the ফর্দ in the link). The Android app puts the
   * picture itself in the chat. Otherwise the phone's share sheet, and failing that, the picture
   * is copied and the chat opened for a paste.
   */
  const sendPicture = async () => {
    if (!blob || !request.bill) return;
    if (await sendToChat(phone, blob, outgoing)) return;
    if (byLink) {
      if (link) return openChat(link);
      setLinking(true);
      try {
        const card = await billCardBlob(request.bill, look);
        const url = await publishBill(blob, card, settings.lang);
        setLink(url);
        openChat(url);
        return;
      } catch (e) {
        console.error('ফর্দ link:', e);
        toast(t.send.linkFailed);
      } finally {
        setLinking(false);
      }
    }
    if (shareable) {
      try {
        await shareImage(blob, fileName, outgoing);
        return;
      } catch {
        // the share sheet refused; fall through to the clipboard
      }
    }
    const copied = await copyImage(blob).catch(() => false);
    openWhatsApp(phone, outgoing);
    toast(copied ? t.send.pasteHint : t.send.copyFailed);
  };

  return (
    <Modal open={!!incoming} onClose={onClose} title={request.title}>
      {request.bill ? (
        <div className="send-bill">
          {preview ? (
            <img className="bill-preview" src={preview} alt={receipt ? t.send.receiptAlt : t.send.billAlt} />
          ) : (
            <div className="bill-loading">{t.send.billMaking}</div>
          )}

          {cash && (
            <button className="btn primary block big" disabled={!print} onClick={() => print?.()}>
              <Printer size={20} /> {t.send.printBill}
            </button>
          )}

          {blocked ? (
            <a className="btn whatsapp block big" href={blocked} target="_blank" rel="noopener" onClick={() => setBlocked(null)}>
              <MessageCircle size={20} /> {t.send.openWhatsApp}
            </a>
          ) : (
            <button className="btn whatsapp block big" disabled={!blob || linking} onClick={sendPicture}>
              {linking ? <Loader2 className="spin" size={20} /> : <ImageIcon size={20} />}{' '}
              {linking ? t.send.linkMaking : receipt ? t.send.sendReceiptImage : t.send.sendBillImage}
            </button>
          )}
          <button className="btn ghost block" onClick={() => openWhatsApp(phone, outgoing)}>
            <MessageCircle size={20} /> {t.send.sendWritten}
          </button>
        </div>
      ) : (
        <button className="btn whatsapp block big" onClick={() => openWhatsApp(phone, outgoing)}>
          <MessageCircle size={20} /> {t.send.sendWritten}
        </button>
      )}

      <p className="muted small center send-hint">
        {!phone
          ? t.send.noPhoneShort(request.customerName)
          : request.bill && byLink
            ? t.send.linkHint(request.customerName)
            : shareable
              ? t.send.shareHint
              : t.send.pasteShort}
      </p>

      <div className="send-more">
        <button type="button" className="btn ghost small" onClick={() => setEditing(!editing)}>
          <Pencil size={15} /> {t.send.editMessage}
        </button>
        {request.bill && (
          <button type="button" className="btn ghost small" disabled={!blob} onClick={() => blob && downloadBlob(blob, fileName)}>
            <Download size={15} /> {t.send.saveImage}
          </button>
        )}
        {request.bill && !cash && (
          <button type="button" className="btn ghost small" disabled={!print} onClick={() => print?.()}>
            <Printer size={15} /> {t.send.print}
          </button>
        )}
      </div>

      {editing && (
        <>
          <label className="field">
            <span>{t.send.messageLabel}</span>
            <textarea rows={request.bill ? 6 : 9} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          {appLine && (
            <div className="app-line">
              <small className="muted">{t.send.appLineLabel}</small>
              <span>{appLine}</span>
              <Link className="btn ghost small" to="/plans">
                <Crown size={14} /> {t.send.appLineRemove}
              </Link>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

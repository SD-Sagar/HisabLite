// Everything that leaves the app goes through here, so the Android build can swap in
// native share plugins later without touching the screens.

export function whatsappUrl(phone: string | null, text: string) {
  const q = `text=${encodeURIComponent(text)}`;
  return phone ? `https://wa.me/${phone}?${q}` : `https://wa.me/?${q}`;
}

export function openWhatsApp(phone: string | null, text: string) {
  window.open(whatsappUrl(phone, text), '_blank', 'noopener');
}

/**
 * Whether this device can place a call from a tel: link. A computer mostly can't (or opens some
 * calling program nobody set up), so there help is offered on WhatsApp instead.
 */
export const canCall = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

/** tel: link for digits with the country code */
export const callUrl = (phone: string) => `tel:+${phone.replace(/\D/g, '')}`;

export const canShareFiles = () => {
  try {
    const probe = new File([new Blob(['x'], { type: 'image/png' })], 'x.png', { type: 'image/png' });
    return !!navigator.canShare?.({ files: [probe] });
  } catch {
    return false;
  }
};

/** Opens the phone's share sheet (pick WhatsApp → customer). Returns false if the user cancelled. */
export async function shareImage(blob: Blob, fileName: string, caption?: string): Promise<boolean> {
  const file = new File([blob], fileName, { type: blob.type || 'image/png' });
  try {
    await navigator.share({ files: [file], text: caption });
    return true;
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return false;
    throw e;
  }
}

/**
 * Only a real Android app may put a picture straight into one person's WhatsApp chat (the jid
 * intent). The Capacitor build sets window.easyledgerShare and this starts working; in a browser
 * there is nothing there, so it answers false and the screen falls back to the share sheet.
 */
export interface NativeShare {
  sendToChat(phone: string, base64: string, mediaType: string, text: string): Promise<boolean>;
  /** Android's own printing; a WebView has no print dialog of its own */
  printImage?(base64: string, mediaType: string, jobName: string): Promise<boolean>;
}

declare global {
  interface Window {
    easyledgerShare?: NativeShare;
  }
}

const base64Of = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export async function sendToChat(phone: string | null, blob: Blob, text: string): Promise<boolean> {
  const bridge = window.easyledgerShare;
  if (!phone || !bridge) return false;
  try {
    return await bridge.sendToChat(phone, await base64Of(blob), blob.type || 'image/png', text);
  } catch {
    return false;
  }
}

/** the page the printer sees: one picture, hidden from the screen (styles.css, .print-sheet) */
let sheet: { el: HTMLElement; url: string } | null = null;

/**
 * Gets a picture ready for the printer and returns what prints it. The picture is loaded
 * beforehand so the print dialog can open right from the tap — an iPhone prints nothing when
 * print() comes after a wait. Anything the phone can print to works: a printer on the Wi-Fi, a
 * Bluetooth receipt printer through its printing app, or “Save as PDF”. `wide` fills the page
 * (a full-size bill) instead of printing receipt-width.
 */
export async function preparePrint(blob: Blob, title: string, wide = false): Promise<() => void> {
  if (sheet) URL.revokeObjectURL(sheet.url);
  const url = URL.createObjectURL(blob);
  const el = sheet?.el ?? document.body.appendChild(Object.assign(document.createElement('div'), { className: 'print-sheet' }));
  el.classList.toggle('wide', wide);
  const img = new Image();
  img.alt = title;
  img.src = url;
  el.replaceChildren(img);
  sheet = { el, url };
  await img.decode().catch(() => undefined);

  return () => {
    const bridge = window.easyledgerShare;
    if (bridge?.printImage) {
      void base64Of(blob)
        .then((b64) => bridge.printImage!(b64, blob.type || 'image/png', title))
        .catch(() => false);
      return;
    }
    const root = document.documentElement;
    root.classList.add('printing');
    window.print();
    // The phone's print screen can draw the page again while it is open (a new paper size), so
    // the picture stays the printed page until the shopkeeper is back and touches the app.
    setTimeout(() => {
      window.addEventListener('pointerdown', () => root.classList.remove('printing'), { once: true, capture: true });
    }, 500);
  };
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function copyImage(blob: Blob): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
    return true;
  } catch {
    return false;
  }
}

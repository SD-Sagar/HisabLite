import { billNo } from '../db';
import { tr, type Dict, type Lang } from '../i18n';
import type { BillDesign, Settings } from '../settings';
import { fmtDate, money, num, roundOffOf, signedMoney } from './format';
import { digitsFor, type BillData } from './template';
import { amountInWords } from './words';

// Hind Siliguri covers Bengali and Latin; Hind, from the same type family, covers Hindi.
const FONT = '"Hind Siliguri", "Hind", "Noto Sans Bengali", "Noto Sans Devanagari", "Nirmala UI", sans-serif';

const W = 1080;
const GOOD = '#15803d';

type Ctx = CanvasRenderingContext2D;

interface TextOpts {
  size?: number;
  weight?: number;
  color?: string;
  align?: CanvasTextAlign;
  maxWidth?: number;
}

function text(ctx: Ctx, s: string, x: number, y: number, o: TextOpts = {}) {
  let size = o.size ?? 30;
  const weight = o.weight ?? 400;
  ctx.font = `${weight} ${size}px ${FONT}`;
  if (o.maxWidth) {
    while (ctx.measureText(s).width > o.maxWidth && size > 20) {
      size -= 2;
      ctx.font = `${weight} ${size}px ${FONT}`;
    }
    if (ctx.measureText(s).width > o.maxWidth) {
      while (s.length > 1 && ctx.measureText(s + '…').width > o.maxWidth) s = s.slice(0, -1);
      s += '…';
    }
  }
  ctx.fillStyle = o.color ?? '#1f2937';
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}

function width(ctx: Ctx, s: string, size: number, weight = 400) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  return ctx.measureText(s).width;
}

function line(ctx: Ctx, x0: number, x1: number, y: number, color: string, w = 2, dash: number[] = []) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.restore();
}

function box(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill?: string | CanvasGradient, stroke?: string, lw = 3) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  ctx.restore();
}

function rgbOf(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x5e35b1;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function tint(hex: string, alpha: number) {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** mixes the colour with black (amount < 0) or white (amount > 0) */
function shade(hex: string, amount: number) {
  const target = amount < 0 ? 0 : 255;
  const k = Math.abs(amount);
  const [r, g, b] = rgbOf(hex).map((v) => Math.round(v + (target - v) * k));
  return `rgb(${r}, ${g}, ${b})`;
}

const fontsReady = new Map<string, Promise<unknown>>();

/** A canvas doesn't download fonts by itself, so load every weight it draws with first. */
function ensureFonts(lang: Lang): Promise<unknown> {
  let ready = fontsReady.get(lang);
  if (!ready) {
    const load = (family: string, sample: string) =>
      [400, 600, 700].map((w) => document.fonts.load(`${w} 30px "${family}"`, sample));
    // digits, ₹ and English names always come from Hind Siliguri
    const loads = load('Hind Siliguri', 'অআকখ ₹0123 abc');
    if (lang === 'hi') loads.push(...load('Hind', 'अआकख'));
    ready = Promise.all(loads).catch(() => undefined);
    fontsReady.set(lang, ready);
  }
  return ready;
}

/** The shop's own logo, when it has one. A broken or huge picture just means no logo. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('logo could not be read'));
    img.src = src;
  });
}

function drawLogo(ctx: Ctx, logo: HTMLImageElement, x: number, top: number, size: number, round = 20) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, top, size, size, round);
  ctx.closePath();
  // a white plate behind it, so a see-through logo still shows on a coloured band
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.clip();
  const scale = Math.min(size / logo.width, size / logo.height);
  const w = logo.width * scale;
  const h = logo.height * scale;
  ctx.drawImage(logo, x + (size - w) / 2, top + (size - h) / 2, w, h);
  ctx.restore();
}

/** The small "খাতায়-কলমে দিয়ে তৈরি" line at the very bottom, and where to get the app. */
export interface BillBrand {
  credit: boolean;
  link: string;
}

const NO_BRAND: BillBrand = { credit: false, link: '' };

interface Row {
  label: string;
  value: string;
  bold?: boolean;
  good?: boolean;
  /** what the figure is, and the figure itself, for a design that writes the numbers its own way */
  kind: 'subtotal' | 'roundOff' | 'goods' | 'prev' | 'total' | 'paid';
  amount: number;
}

/** Everything a design needs to draw one ফর্দ. */
interface Pen {
  ctx: Ctx;
  d: BillData;
  s: Settings;
  t: Dict['bill'];
  words: Dict;
  dg: (s: string) => string;
  accent: string;
  logo: HTMLImageElement | null;
  brand: BillBrand;
  sale: boolean;
  /** "address   •   phone", or '' when the shop hides it */
  contact: string;
  look: Look;
}

/**
 * One ফর্দ design. Each part draws from y and returns where the next part starts. The page
 * colour goes under everything, and `overlay` over it (frames, torn paper edges), once the
 * height is known.
 */
interface Look {
  paper: string;
  ink: string;
  muted: string;
  rule: string;
  /** left and right edges of the writing */
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  header(p: Pen, y: number): number;
  title(p: Pen, y: number, title: string): number;
  meta(p: Pen, y: number): number;
  received(p: Pen, y: number): number;
  items(p: Pen, y: number): number;
  totals(p: Pen, y: number, rows: Row[]): number;
  balance(p: Pen, y: number, label: string, amount: string, advance: boolean): number;
  note(p: Pen, y: number): number;
  footer(p: Pen, y: number): number;
  backdrop?(ctx: Ctx, w: number, h: number, p: Pen): void;
  overlay?(ctx: Ctx, w: number, h: number, p: Pen): void;
}

const detailOf = (p: Pen, it: BillData['txn']['items'][number]) =>
  p.dg(
    [it.qty ? `${num(it.qty)}${it.unit ? ' ' + it.unit : ''}` : '', it.qty && it.rate ? `× ${money(it.rate)}` : '']
      .filter(Boolean)
      .join('  '),
  );

// ── the parts most designs share ──

function headerBand(p: Pen, fill: string | CanvasGradient, nameColor: string, contactColor: string, stripe?: string) {
  const { ctx } = p;
  const h = p.contact ? 200 : 150;
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, W, h);
  if (stripe) {
    ctx.fillStyle = stripe;
    ctx.fillRect(0, 0, W, 10);
  }
  if (p.logo) drawLogo(ctx, p.logo, p.look.x0, (h - (p.contact ? 118 : 98)) / 2, p.contact ? 118 : 98);
  const room = W - 2 * 56 - (p.logo ? 300 : 0);
  text(ctx, p.s.shopName || p.t.shopFallback, W / 2, p.contact ? 90 : 96, { size: 60, weight: 700, color: nameColor, align: 'center', maxWidth: room });
  if (p.contact) text(ctx, p.contact, W / 2, 152, { size: 28, color: contactColor, align: 'center', maxWidth: room });
  return h;
}

function titlePill(p: Pen, y: number, title: string, fill: string | CanvasGradient, color: string) {
  const { ctx } = p;
  y += 70;
  const tw = width(ctx, title, 34, 700);
  box(ctx, W / 2 - tw / 2 - 34, y - 44, tw + 68, 62, 31, fill);
  text(ctx, title, W / 2, y, { size: 34, weight: 700, color, align: 'center' });
  return y;
}

function metaColumns(p: Pen, y: number, dashed = true) {
  const { ctx, look, d, t } = p;
  y += 76;
  text(ctx, t.customer, look.x0, y, { size: 24, color: look.muted });
  text(ctx, t.date, look.x1, y, { size: 24, color: look.muted, align: 'right' });
  y += 46;
  text(ctx, d.customer.name, look.x0, y, { size: 42, weight: 700, color: look.ink, maxWidth: look.x1 - look.x0 - 330 });
  text(ctx, p.dg(fmtDate(d.txn.date, p.s.lang)), look.x1, y, { size: 32, weight: 600, color: look.ink, align: 'right' });
  y += 40;
  if (d.customer.phone) text(ctx, d.customer.phone, look.x0, y, { size: 26, color: look.muted });
  if (d.txn.id) text(ctx, p.dg(t.number(billNo(d.txn))), look.x1, y, { size: 26, color: look.muted, align: 'right' });
  y += 34;
  line(ctx, look.x0, look.x1, y, look.rule, 2, dashed ? [10, 8] : []);
  return y;
}

function receivedBox(p: Pen, y: number, fill = 'rgba(21, 128, 61, 0.08)', color = GOOD) {
  const { ctx, look } = p;
  y += 28;
  box(ctx, look.x0, y, look.x1 - look.x0, 158, 18, fill);
  const mid = (look.x0 + look.x1) / 2;
  text(ctx, p.t.receivedBig, mid, y + 54, { size: 29, weight: 600, color, align: 'center' });
  text(ctx, p.dg(money(p.d.txn.paid)), mid, y + 126, { size: 64, weight: 700, color, align: 'center' });
  return y + 158;
}

/** the item table: a tinted head row, then one row per item, every other one shaded */
function itemsTable(p: Pen, y: number, o: { head?: string; headInk?: string; zebra?: string; rowRule?: string } = {}) {
  const { ctx, look, d, t } = p;
  const right = look.x1 - 8;
  y += 20;
  if (o.head) {
    ctx.fillStyle = o.head;
    ctx.fillRect(look.x0, y, look.x1 - look.x0, 58);
  }
  const headInk = o.headInk ?? look.muted;
  text(ctx, '#', look.x0 + 22, y + 40, { size: 26, weight: 600, color: headInk });
  text(ctx, t.itemsHead, look.x0 + 76, y + 40, { size: 26, weight: 600, color: headInk });
  text(ctx, t.amountHead, right, y + 40, { size: 26, weight: 600, color: headInk, align: 'right' });
  y += 58;
  if (!o.head) line(ctx, look.x0, look.x1, y, look.rule, 2);
  d.txn.items.forEach((it, i) => {
    const rowH = 88;
    if (o.zebra && i % 2 === 1) {
      ctx.fillStyle = o.zebra;
      ctx.fillRect(look.x0, y, look.x1 - look.x0, rowH);
    }
    text(ctx, p.dg(String(i + 1)), look.x0 + 22, y + 40, { size: 28, color: look.muted });
    text(ctx, it.name || '—', look.x0 + 76, y + 40, { size: 32, weight: 600, color: look.ink, maxWidth: right - look.x0 - 76 - 240 });
    const detail = detailOf(p, it);
    if (detail) text(ctx, detail, look.x0 + 76, y + 74, { size: 25, color: look.muted });
    text(ctx, p.dg(money(it.amount)), right, y + 52, { size: 32, weight: 600, color: look.ink, align: 'right' });
    y += rowH;
    if (o.rowRule && i < d.txn.items.length - 1) line(ctx, look.x0, look.x1, y, o.rowRule, 1.5);
  });
  line(ctx, look.x0, look.x1, y, look.rule, 2);
  return y;
}

/** label and figure pairs, both against the right edge */
function totalsRight(p: Pen, y: number, rows: Row[], goodColor = GOOD) {
  const { ctx, look } = p;
  const right = look.x1 - 8;
  const labelR = right - 250;
  y += 26;
  for (const r of rows) {
    y += 50;
    const color = r.good ? goodColor : undefined;
    text(ctx, r.label, labelR, y, { size: 29, weight: r.bold ? 700 : 400, color: color ?? look.muted, align: 'right' });
    text(ctx, r.value, right, y, { size: 31, weight: r.bold ? 700 : 600, color: color ?? look.ink, align: 'right' });
  }
  return y;
}

function balanceBox(p: Pen, y: number, label: string, amount: string, o: { fill: string | CanvasGradient; stroke?: string; labelInk: string; amountInk: string }) {
  const { ctx, look } = p;
  y += 34;
  box(ctx, look.x0, y, look.x1 - look.x0, 96, 18, o.fill, o.stroke);
  text(ctx, label, look.x0 + 32, y + 62, { size: 34, weight: 700, color: o.labelInk, maxWidth: 520 });
  text(ctx, amount, look.x1 - 32, y + 64, { size: 46, weight: 700, color: o.amountInk, align: 'right' });
  return y + 96;
}

function noteLine(p: Pen, y: number) {
  y += 52;
  text(p.ctx, `${p.words.common.note}: ${p.d.txn.note}`, p.look.x0, y, { size: 27, color: p.look.muted, maxWidth: p.look.x1 - p.look.x0 });
  return y;
}

/** UPI, the shop's own closing words, and the app's line for a free shop */
function footerCentered(p: Pen, y: number, rule: 'dash' | 'solid' | 'none' = 'dash') {
  const { ctx, look, s, brand } = p;
  const mid = (look.x0 + look.x1) / 2;
  const room = look.x1 - look.x0;
  y += 50;
  if (rule !== 'none') line(ctx, look.x0, look.x1, y, look.rule, 2, rule === 'dash' ? [10, 8] : []);
  if (s.bill.showUpi && s.upiId) {
    y += 56;
    text(ctx, `UPI: ${s.upiId}`, mid, y, { size: 30, weight: 600, color: look.ink, align: 'center', maxWidth: room });
  }
  if (s.bill.footer) {
    y += 52;
    text(ctx, s.bill.footer, mid, y, { size: 28, color: look.muted, align: 'center', maxWidth: room });
  }
  if (brand.credit) {
    y += 48;
    text(ctx, [p.t.madeWith, brand.link].filter(Boolean).join('   ·   '), mid, y, { size: 24, color: '#9ca3af', align: 'center', maxWidth: room });
  }
  return y + 48;
}

const base: Look = {
  paper: '#ffffff',
  ink: '#1f2937',
  muted: '#6b7280',
  rule: '#e5e7eb',
  x0: 56,
  x1: W - 56,
  top: 0,
  bottom: 0,
  header: (p) => headerBand(p, p.accent, '#ffffff', 'rgba(255,255,255,0.92)'),
  title: (p, y, title) => titlePill(p, y, title, tint(p.accent, 0.1), p.accent),
  meta: (p, y) => metaColumns(p, y),
  received: (p, y) => receivedBox(p, y),
  items: (p, y) => itemsTable(p, y, { head: tint(p.accent, 0.08), zebra: '#f9fafb' }),
  totals: (p, y, rows) => totalsRight(p, y, rows),
  balance: (p, y, label, amount) =>
    balanceBox(p, y, label, amount, { fill: tint(p.accent, 0.1), stroke: p.accent, labelInk: p.accent, amountInk: p.accent }),
  note: noteLine,
  footer: (p, y) => footerCentered(p, y),
};

// ── 1. সাদা, পাতলা: white, a thick rule under the name, nothing shaded ──

const line_: Look = {
  ...base,
  header(p) {
    const { ctx } = p;
    const h = headerBand(p, '#ffffff', p.accent, p.look.muted);
    ctx.fillStyle = p.accent;
    ctx.fillRect(p.look.x0, h - 8, p.look.x1 - p.look.x0, 8);
    return h;
  },
  title(p, y, title) {
    const { ctx, look } = p;
    y += 74;
    const tw = width(ctx, title, 32, 600);
    const mid = W / 2;
    line(ctx, look.x0, mid - tw / 2 - 28, y - 11, look.rule, 2);
    line(ctx, mid + tw / 2 + 28, look.x1, y - 11, look.rule, 2);
    text(ctx, title, mid, y, { size: 32, weight: 600, color: look.ink, align: 'center' });
    return y;
  },
  meta: (p, y) => metaColumns(p, y, false),
  items: (p, y) => itemsTable(p, y, { rowRule: '#f0f1f3' }),
  balance(p, y, label, amount) {
    const { ctx, look } = p;
    y += 40;
    line(ctx, look.x0, look.x1, y, look.ink, 4);
    y += 70;
    text(ctx, label, look.x0, y, { size: 34, weight: 700, color: look.ink, maxWidth: 520 });
    text(ctx, amount, look.x1 - 8, y + 4, { size: 52, weight: 700, color: p.accent, align: 'right' });
    return y + 26;
  },
  footer: (p, y) => footerCentered(p, y, 'solid'),
};

// ── 2. খাতার পাতা: cream paper, blue ruled lines, a red margin and a rubber stamp for the balance ──

const PAPER_LINE = 'rgba(59, 130, 246, 0.22)';
const MARGIN = 'rgba(220, 38, 38, 0.45)';
const PEN = '#1e3a8a';

const paper: Look = {
  ...base,
  paper: '#fdf8e8',
  ink: '#1f2a44',
  muted: '#5b6477',
  rule: PAPER_LINE,
  x0: 140,
  x1: W - 60,
  top: 20,
  bottom: 30,
  header(p, y) {
    const { ctx, look } = p;
    if (p.logo) drawLogo(ctx, p.logo, look.x0, y + 26, 96, 48);
    const mid = (look.x0 + look.x1) / 2 + (p.logo ? 50 : 0);
    const room = look.x1 - look.x0 - (p.logo ? 140 : 0);
    y += 96;
    text(ctx, p.s.shopName || p.t.shopFallback, mid, y, { size: 58, weight: 700, color: PEN, align: 'center', maxWidth: room });
    // a hand-drawn double underline
    const nw = Math.min(room, width(ctx, p.s.shopName || p.t.shopFallback, 58, 700));
    line(ctx, mid - nw / 2, mid + nw / 2, y + 16, p.accent, 3);
    line(ctx, mid - nw / 2 + 20, mid + nw / 2 - 20, y + 25, p.accent, 2);
    if (p.contact) {
      y += 64;
      text(ctx, p.contact, mid, y, { size: 26, color: look.muted, align: 'center', maxWidth: room });
    }
    return y + 20;
  },
  title(p, y, title) {
    const { ctx, look } = p;
    y += 78;
    const mid = (look.x0 + look.x1) / 2;
    const tw = width(ctx, title, 32, 700);
    box(ctx, mid - tw / 2 - 30, y - 44, tw + 60, 62, 12, undefined, p.accent, 3);
    text(ctx, title, mid, y, { size: 32, weight: 700, color: p.accent, align: 'center' });
    return y + 10;
  },
  meta(p, y) {
    const { ctx, look, d, t } = p;
    y += 70;
    text(ctx, `${t.customer}:`, look.x0, y, { size: 28, color: look.muted });
    text(ctx, d.customer.name, look.x0 + width(ctx, `${t.customer}:`, 28) + 16, y, { size: 38, weight: 700, color: PEN, maxWidth: 520 });
    text(ctx, p.dg(fmtDate(d.txn.date, p.s.lang)), look.x1, y, { size: 30, weight: 600, color: look.ink, align: 'right' });
    line(ctx, look.x0 - 60, W, y + 16, PAPER_LINE, 2);
    y += 56;
    if (d.customer.phone) text(ctx, d.customer.phone, look.x0, y, { size: 26, color: look.muted });
    if (d.txn.id) text(ctx, p.dg(t.number(billNo(d.txn))), look.x1, y, { size: 26, color: look.muted, align: 'right' });
    line(ctx, look.x0 - 60, W, y + 16, PAPER_LINE, 2);
    return y + 16;
  },
  received: (p, y) => receivedBox(p, y, 'rgba(21, 128, 61, 0.07)'),
  items(p, y) {
    const { ctx, look, d } = p;
    y += 12;
    d.txn.items.forEach((it, i) => {
      y += 64;
      const name = `${p.dg(String(i + 1))}. ${it.name || '—'}`;
      text(ctx, name, look.x0, y, { size: 32, weight: 600, color: PEN, maxWidth: 440 });
      const detail = detailOf(p, it);
      if (detail) text(ctx, detail, look.x0 + Math.min(460, width(ctx, name, 32, 600) + 24), y, { size: 26, color: look.muted });
      text(ctx, p.dg(money(it.amount)), look.x1, y, { size: 32, weight: 600, color: PEN, align: 'right' });
      line(ctx, look.x0 - 60, W, y + 16, PAPER_LINE, 2);
    });
    return y + 16;
  },
  totals(p, y, rows) {
    const { ctx, look } = p;
    y += 12;
    for (const r of rows) {
      y += 60;
      const color = r.good ? GOOD : look.ink;
      text(ctx, r.label, look.x1 - 280, y, { size: 29, weight: r.bold ? 700 : 400, color: r.good ? GOOD : look.muted, align: 'right' });
      text(ctx, r.value, look.x1, y, { size: 31, weight: r.bold ? 700 : 600, color, align: 'right' });
      line(ctx, look.x0 - 60, W, y + 16, PAPER_LINE, 2);
    }
    return y + 16;
  },
  // the figure that matters, stamped on like a rubber stamp
  balance(p, y, label, amount) {
    const { ctx, look } = p;
    y += 56;
    const color = p.accent;
    const h = 150;
    const w = Math.min(look.x1 - look.x0 - 40, Math.max(width(ctx, amount, 58, 700), width(ctx, label, 30, 700)) + 120);
    const cx = (look.x0 + look.x1) / 2;
    ctx.save();
    ctx.translate(cx, y + h / 2);
    ctx.rotate(-0.045);
    ctx.globalAlpha = 0.88;
    box(ctx, -w / 2, -h / 2, w, h, 22, tint(color, 0.06), color, 5);
    box(ctx, -w / 2 + 10, -h / 2 + 10, w - 20, h - 20, 16, undefined, color, 2);
    text(ctx, label, 0, -12, { size: 30, weight: 700, color, align: 'center' });
    text(ctx, amount, 0, 48, { size: 58, weight: 700, color, align: 'center' });
    ctx.restore();
    return y + h + 10;
  },
  note(p, y) {
    y += 58;
    text(p.ctx, `${p.words.common.note}: ${p.d.txn.note}`, p.look.x0, y, { size: 27, color: p.look.muted, maxWidth: p.look.x1 - p.look.x0 });
    return y;
  },
  footer: (p, y) => footerCentered(p, y, 'none'),
  overlay(ctx, _w, h) {
    // the khata's red margin, twice, top to bottom
    line2(ctx, 104, 0, h, MARGIN, 3);
    line2(ctx, 112, 0, h, MARGIN, 2);
  },
};

function line2(ctx: Ctx, x: number, y0: number, y1: number, color: string, w: number) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
  ctx.restore();
}

// ── 3. রসিদ মেশিন: a narrow till slip on a grey counter, torn edges and a barcode ──

const SLIP_X0 = 170;
const SLIP_X1 = W - 170;

/** UPI and the closing words under a till slip; the barcode only where it is drawn for show */
function slipFooter(p: Pen, y: number, barcode: boolean) {
  const { ctx, look, s, brand } = p;
  const mid = W / 2;
  const room = look.x1 - look.x0;
  if (s.bill.showUpi && s.upiId) {
    y += 56;
    text(ctx, `UPI: ${s.upiId}`, mid, y, { size: 26, weight: 600, color: look.ink, align: 'center', maxWidth: room });
  }
  if (s.bill.footer) {
    y += 50;
    text(ctx, `*** ${s.bill.footer} ***`, mid, y, { size: 25, color: look.ink, align: 'center', maxWidth: room });
  }
  if (barcode) {
    // a barcode drawn from the ফর্দ number: it only looks the part, nothing scans it
    y += 36;
    const code = String(p.d.txn.id ? billNo(p.d.txn) : 0).padStart(6, '0');
    let seed = [...code].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
    let x = mid - 210;
    ctx.fillStyle = look.ink;
    while (x < mid + 210) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const bar = 2 + (seed % 5);
      ctx.fillRect(x, y, bar, 70);
      x += bar + 2 + ((seed >> 8) % 4);
    }
    y += 100;
    text(ctx, code, mid, y, { size: 22, color: look.muted, align: 'center' });
  }
  if (brand.credit) {
    y += 42;
    text(ctx, [p.t.madeWith, brand.link].filter(Boolean).join(' · '), mid, y, { size: 21, color: barcode ? '#8a8a8a' : look.muted, align: 'center', maxWidth: room });
  }
  return y + 30;
}

const receipt: Look = {
  ...base,
  paper: '#e7eaee',
  ink: '#111111',
  muted: '#555555',
  rule: '#9a9a9a',
  x0: SLIP_X0 + 44,
  x1: SLIP_X1 - 44,
  top: 40,
  bottom: 60,
  header(p, y) {
    const { ctx, look } = p;
    const mid = W / 2;
    y += 30;
    if (p.logo) {
      drawLogo(ctx, p.logo, mid - 48, y, 96, 48);
      y += 110;
    }
    y += 56;
    text(ctx, p.s.shopName || p.t.shopFallback, mid, y, { size: 50, weight: 700, color: look.ink, align: 'center', maxWidth: look.x1 - look.x0 });
    if (p.contact) {
      y += 46;
      text(ctx, p.contact, mid, y, { size: 24, color: look.muted, align: 'center', maxWidth: look.x1 - look.x0 });
    }
    y += 34;
    line(ctx, look.x0, look.x1, y, look.rule, 2, [8, 8]);
    return y;
  },
  title(p, y, title) {
    y += 58;
    text(p.ctx, `* ${title} *`, W / 2, y, { size: 32, weight: 700, color: p.look.ink, align: 'center' });
    return y;
  },
  meta(p, y) {
    const { ctx, look, d, t } = p;
    const row = (label: string, value: string) => {
      y += 44;
      text(ctx, label, look.x0, y, { size: 26, color: look.muted });
      text(ctx, value, look.x1, y, { size: 26, weight: 600, color: look.ink, align: 'right', maxWidth: 420 });
    };
    y += 10;
    row(t.customer, d.customer.name);
    row(t.date, p.dg(fmtDate(d.txn.date, p.s.lang)));
    if (d.txn.id) row('#', p.dg(String(billNo(d.txn))));
    y += 26;
    line(ctx, look.x0, look.x1, y, look.rule, 2, [8, 8]);
    return y;
  },
  received: (p, y) => receivedBox(p, y, 'rgba(0, 0, 0, 0.04)', '#111111'),
  items(p, y) {
    const { ctx, look, d } = p;
    y += 8;
    for (const it of d.txn.items) {
      y += 46;
      text(ctx, it.name || '—', look.x0, y, { size: 28, weight: 600, color: look.ink, maxWidth: 440 });
      text(ctx, p.dg(money(it.amount)), look.x1, y, { size: 28, weight: 600, color: look.ink, align: 'right' });
      const detail = detailOf(p, it);
      if (detail) {
        y += 36;
        text(ctx, detail, look.x0 + 20, y, { size: 24, color: look.muted });
      }
    }
    y += 28;
    line(ctx, look.x0, look.x1, y, look.rule, 2, [8, 8]);
    return y;
  },
  totals(p, y, rows) {
    const { ctx, look } = p;
    for (const r of rows) {
      y += 44;
      text(ctx, r.label, look.x0, y, { size: 26, weight: r.bold ? 700 : 400, color: look.ink });
      text(ctx, r.value, look.x1, y, { size: 27, weight: r.bold ? 700 : 600, color: look.ink, align: 'right' });
    }
    return y;
  },
  balance(p, y, label, amount) {
    const { ctx, look } = p;
    y += 30;
    line(ctx, look.x0, look.x1, y, look.ink, 2);
    line(ctx, look.x0, look.x1, y + 7, look.ink, 2);
    y += 62;
    text(ctx, label, look.x0, y, { size: 30, weight: 700, color: look.ink, maxWidth: 360 });
    text(ctx, amount, look.x1, y + 2, { size: 42, weight: 700, color: look.ink, align: 'right' });
    y += 26;
    line(ctx, look.x0, look.x1, y, look.ink, 2);
    line(ctx, look.x0, look.x1, y + 7, look.ink, 2);
    return y + 7;
  },
  footer: (p, y) => slipFooter(p, y, true),
  backdrop(ctx, _w, h) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(SLIP_X0, 30, SLIP_X1 - SLIP_X0, h - 60);
    ctx.restore();
  },
  overlay(ctx, _w, h) {
    // torn edges: little teeth cut out of the slip, top and bottom
    ctx.fillStyle = '#e7eaee';
    const tooth = 18;
    for (let x = SLIP_X0; x < SLIP_X1; x += tooth * 2) {
      ctx.beginPath();
      ctx.moveTo(x, 29);
      ctx.lineTo(x + tooth, 29 + tooth);
      ctx.lineTo(x + tooth * 2, 29);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, h - 29);
      ctx.lineTo(x + tooth, h - 29 - tooth);
      ctx.lineTo(x + tooth * 2, h - 29);
      ctx.fill();
    }
  },
};

// ── 4. গাঢ়: a near-black head with the shop's colour on top, and a dark balance ──

const DARK = '#111827';

const dark: Look = {
  ...base,
  header: (p) => headerBand(p, DARK, '#ffffff', 'rgba(255,255,255,0.8)', p.accent),
  title: (p, y, title) => titlePill(p, y, title, DARK, '#ffffff'),
  items: (p, y) => itemsTable(p, y, { head: DARK, headInk: '#e5e7eb', zebra: '#f6f7f9' }),
  balance: (p, y, label, amount) => {
    const { ctx, look } = p;
    const next = balanceBox(p, y, label, amount, { fill: DARK, labelInk: '#e5e7eb', amountInk: '#ffffff' });
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.roundRect(look.x0, next - 96, 12, 96, [18, 0, 0, 18]);
    ctx.fill();
    return next;
  },
};

// ── 5. রাজকীয়: ivory paper, a deep head, gold rules and a gold frame round the page ──

const GOLD = '#b8912f';
const CHAMPAGNE = '#f5e6b8';

function diamond(ctx: Ctx, x: number, y: number, r: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const royal: Look = {
  ...base,
  paper: '#fffcf3',
  ink: '#1c1917',
  muted: '#6b5e4a',
  rule: '#e8dcc0',
  x0: 76,
  x1: W - 76,
  top: 40,
  bottom: 44,
  header(p, y) {
    const { ctx } = p;
    const deep = shade(p.accent, -0.5);
    const h = p.contact ? 200 : 160;
    ctx.fillStyle = deep;
    ctx.fillRect(40, y, W - 80, h);
    line(ctx, 40, W - 40, y + h - 12, GOLD, 2);
    line(ctx, 40, W - 40, y + h - 6, GOLD, 4);
    if (p.logo) drawLogo(p.ctx, p.logo, 80, y + (h - 104) / 2 - 6, 104, 52);
    const room = W - 2 * 76 - (p.logo ? 280 : 0);
    text(ctx, p.s.shopName || p.t.shopFallback, W / 2, y + (p.contact ? 92 : 100), { size: 60, weight: 700, color: CHAMPAGNE, align: 'center', maxWidth: room });
    if (p.contact) text(ctx, p.contact, W / 2, y + 148, { size: 26, color: 'rgba(255,255,255,0.8)', align: 'center', maxWidth: room });
    return y + h;
  },
  title(p, y, title) {
    const { ctx, look } = p;
    y += 76;
    const mid = W / 2;
    text(ctx, title, mid, y, { size: 36, weight: 700, color: shade(p.accent, -0.5), align: 'center' });
    y += 30;
    line(ctx, look.x0 + 160, mid - 22, y, GOLD, 2);
    line(ctx, mid + 22, look.x1 - 160, y, GOLD, 2);
    diamond(ctx, mid, y, 9, GOLD);
    return y;
  },
  meta: (p, y) => metaColumns(p, y, false),
  received: (p, y) => receivedBox(p, y, 'rgba(184, 145, 47, 0.1)', shade('#b8912f', -0.35)),
  items: (p, y) => itemsTable(p, y, { head: 'rgba(184, 145, 47, 0.14)', headInk: shade(p.accent, -0.5), rowRule: '#efe6d0' }),
  balance(p, y, label, amount) {
    const { ctx, look } = p;
    const deep = shade(p.accent, -0.5);
    y += 36;
    box(ctx, look.x0, y, look.x1 - look.x0, 104, 14, deep);
    box(ctx, look.x0 + 8, y + 8, look.x1 - look.x0 - 16, 88, 10, undefined, GOLD, 2);
    text(ctx, label, look.x0 + 36, y + 66, { size: 34, weight: 700, color: CHAMPAGNE, maxWidth: 520 });
    text(ctx, amount, look.x1 - 36, y + 68, { size: 46, weight: 700, color: '#ffffff', align: 'right' });
    return y + 104;
  },
  footer(p, y) {
    const { ctx } = p;
    const next = footerCentered(p, y, 'none');
    diamond(ctx, W / 2, y + 22, 7, GOLD);
    line(ctx, W / 2 - 150, W / 2 - 18, y + 22, GOLD, 1.5);
    line(ctx, W / 2 + 18, W / 2 + 150, y + 22, GOLD, 1.5);
    return next;
  },
  overlay(ctx, w, h) {
    ctx.save();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 4;
    ctx.strokeRect(16, 16, w - 32, h - 32);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(26, 26, w - 52, h - 52);
    ctx.restore();
    for (const [x, y] of [[26, 26], [w - 26, 26], [26, h - 26], [w - 26, h - 26]]) diamond(ctx, x, y, 10, GOLD);
  },
};

// ── 6. আধুনিক: a gradient head with a curved edge, items as small cards ──

function gradientOf(ctx: Ctx, accent: string, x0: number, y0: number, x1: number, y1: number) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, shade(accent, -0.25));
  g.addColorStop(1, shade(accent, 0.3));
  return g;
}

const gradient: Look = {
  ...base,
  ink: '#111827',
  x0: 60,
  x1: W - 60,
  header(p) {
    const { ctx } = p;
    const h = p.contact ? 250 : 210;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, 0);
    ctx.lineTo(W, h - 50);
    ctx.quadraticCurveTo(W / 2, h + 40, 0, h - 50);
    ctx.closePath();
    ctx.fillStyle = gradientOf(ctx, p.accent, 0, 0, W, h);
    ctx.fill();
    ctx.clip();
    // soft light circles
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.beginPath();
    ctx.arc(W - 90, 40, 150, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(80, h - 20, 110, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (p.logo) drawLogo(ctx, p.logo, 60, (h - 150) / 2, 110, 55);
    const room = W - 120 - (p.logo ? 300 : 0);
    text(ctx, p.s.shopName || p.t.shopFallback, W / 2, p.contact ? 96 : 104, { size: 62, weight: 700, color: '#ffffff', align: 'center', maxWidth: room });
    if (p.contact) text(ctx, p.contact, W / 2, 152, { size: 27, color: 'rgba(255,255,255,0.9)', align: 'center', maxWidth: room });
    return h - 10;
  },
  title(p, y, title) {
    const { ctx } = p;
    y += 60;
    const tw = width(ctx, title, 32, 700);
    box(ctx, W / 2 - tw / 2 - 36, y - 44, tw + 72, 64, 32, gradientOf(ctx, p.accent, W / 2 - tw / 2, 0, W / 2 + tw / 2, 0));
    text(ctx, title, W / 2, y, { size: 32, weight: 700, color: '#ffffff', align: 'center' });
    return y;
  },
  items(p, y) {
    const { ctx, look, d } = p;
    y += 24;
    const colors = [p.accent, shade(p.accent, 0.35), shade(p.accent, -0.3)];
    d.txn.items.forEach((it, i) => {
      const h = 100;
      box(ctx, look.x0, y, look.x1 - look.x0, h, 20, tint(p.accent, 0.06));
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();
      ctx.arc(look.x0 + 50, y + h / 2, 30, 0, Math.PI * 2);
      ctx.fill();
      text(ctx, (it.name || '—').slice(0, 1), look.x0 + 50, y + h / 2 + 11, { size: 30, weight: 700, color: '#ffffff', align: 'center' });
      text(ctx, it.name || '—', look.x0 + 100, y + 44, { size: 31, weight: 600, color: look.ink, maxWidth: look.x1 - look.x0 - 380 });
      const detail = detailOf(p, it);
      if (detail) text(ctx, detail, look.x0 + 100, y + 80, { size: 24, color: look.muted });
      text(ctx, p.dg(money(it.amount)), look.x1 - 28, y + 62, { size: 33, weight: 700, color: look.ink, align: 'right' });
      y += h + 14;
    });
    return y - 14;
  },
  balance(p, y, label, amount) {
    const { ctx, look } = p;
    y += 36;
    box(ctx, look.x0, y, look.x1 - look.x0, 110, 28, gradientOf(ctx, p.accent, look.x0, 0, look.x1, 0));
    text(ctx, label, look.x0 + 36, y + 68, { size: 34, weight: 700, color: 'rgba(255,255,255,0.95)', maxWidth: 520 });
    text(ctx, amount, look.x1 - 36, y + 72, { size: 50, weight: 700, color: '#ffffff', align: 'right' });
    return y + 110;
  },
  footer: (p, y) => footerCentered(p, y, 'none'),
};

// ── 7. তাজা ফল: a green market card with an orange and a leaf, fruit-coloured dots ──

const LEAF = '#15803d';
const ORANGE = '#f97316';

function fruit(ctx: Ctx, x: number, y: number, r: number) {
  ctx.fillStyle = ORANGE;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#22c55e';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.45, y - r * 1.02, r * 0.5, r * 0.22, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

const fresh: Look = {
  ...base,
  paper: '#f6fbf3',
  ink: '#14331f',
  muted: '#55705e',
  rule: '#cfe6d3',
  header(p) {
    const { ctx } = p;
    const h = p.contact ? 210 : 170;
    const g = ctx.createLinearGradient(0, 30, 0, 30 + h);
    g.addColorStop(0, '#16a34a');
    g.addColorStop(1, LEAF);
    box(ctx, 36, 30, W - 72, h, 34, g);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(36, 30, W - 72, h, 34);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.arc(170, 30 + h, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    fruit(ctx, W - 150, 30 + h / 2 + 8, 44);
    fruit(ctx, W - 88, 30 + h / 2 + 40, 26);
    if (p.logo) drawLogo(ctx, p.logo, 70, 30 + (h - 100) / 2, 100, 50);
    const room = W - 2 * 56 - 330;
    const mid = p.logo ? W / 2 - 10 : W / 2 - 60;
    text(ctx, p.s.shopName || p.t.shopFallback, mid, 30 + (p.contact ? 92 : 104), { size: 58, weight: 700, color: '#ffffff', align: 'center', maxWidth: room });
    if (p.contact) text(ctx, p.contact, mid, 30 + 150, { size: 26, color: 'rgba(255,255,255,0.9)', align: 'center', maxWidth: room });
    return 30 + h;
  },
  title: (p, y, title) => titlePill(p, y, title, ORANGE, '#ffffff'),
  items(p, y) {
    const { ctx, look, d } = p;
    const dots = [ORANGE, '#16a34a', '#dc2626', '#eab308', '#a855f7'];
    y += 20;
    d.txn.items.forEach((it, i) => {
      const h = 90;
      ctx.fillStyle = dots[i % dots.length];
      ctx.beginPath();
      ctx.arc(look.x0 + 22, y + 38, 11, 0, Math.PI * 2);
      ctx.fill();
      text(ctx, it.name || '—', look.x0 + 52, y + 48, { size: 32, weight: 600, color: look.ink, maxWidth: look.x1 - look.x0 - 330 });
      const detail = detailOf(p, it);
      if (detail) text(ctx, detail, look.x0 + 52, y + 80, { size: 25, color: look.muted });
      text(ctx, p.dg(money(it.amount)), look.x1 - 8, y + 58, { size: 32, weight: 600, color: look.ink, align: 'right' });
      y += h;
      line(ctx, look.x0, look.x1, y, look.rule, 2, [4, 8]);
    });
    return y;
  },
  totals: (p, y, rows) => totalsRight(p, y, rows, LEAF),
  balance(p, y, label, amount) {
    const { ctx, look } = p;
    y += 36;
    box(ctx, look.x0, y, look.x1 - look.x0, 104, 52, LEAF);
    fruit(ctx, look.x0 + 58, y + 58, 24);
    text(ctx, label, look.x0 + 104, y + 66, { size: 34, weight: 700, color: '#ffffff', maxWidth: 460 });
    text(ctx, amount, look.x1 - 40, y + 70, { size: 48, weight: 700, color: '#ffffff', align: 'right' });
    return y + 104;
  },
  footer: (p, y) => footerCentered(p, y, 'none'),
};

// ── 8. ইনভয়েস: a business invoice — shop on the left, the title big on the right, a full table ──

const invoice: Look = {
  ...base,
  ink: '#111827',
  muted: '#6b7280',
  rule: '#e5e7eb',
  x0: 64,
  x1: W - 64,
  top: 20,
  header(p, y) {
    const { ctx, look, d, t } = p;
    let x = look.x0;
    y += 40;
    if (p.logo) {
      drawLogo(ctx, p.logo, x, y, 110, 18);
      x += 132;
    }
    const title = p.sale ? p.s.bill.title : t.receiptTitle;
    text(ctx, title, look.x1, y + 56, { size: 52, weight: 700, color: p.accent, align: 'right', maxWidth: 420 });
    if (d.txn.id) text(ctx, p.dg(t.number(billNo(d.txn))), look.x1, y + 104, { size: 27, weight: 600, color: look.ink, align: 'right' });
    text(ctx, p.dg(fmtDate(d.txn.date, p.s.lang)), look.x1, y + 144, { size: 26, color: look.muted, align: 'right' });
    text(ctx, p.s.shopName || t.shopFallback, x, y + 50, { size: 44, weight: 700, color: look.ink, maxWidth: 520 - (x - look.x0) });
    let cy = y + 50;
    if (p.contact) {
      for (const part of [p.s.shopAddress, p.s.shopPhone && t.phone(p.s.shopPhone)].filter(Boolean) as string[]) {
        cy += 40;
        text(ctx, part, x, cy, { size: 25, color: look.muted, maxWidth: 520 - (x - look.x0) });
      }
    }
    y = Math.max(y + 170, cy + 30);
    ctx.fillStyle = p.accent;
    ctx.fillRect(look.x0, y, look.x1 - look.x0, 6);
    return y + 6;
  },
  // the title already stands in the head
  title: (_p, y) => y,
  meta(p, y) {
    const { ctx, look, d, t } = p;
    y += 30;
    box(ctx, look.x0, y, 560, 120, 12, tint(p.accent, 0.07));
    text(ctx, t.customer, look.x0 + 24, y + 40, { size: 24, weight: 600, color: p.accent });
    text(ctx, d.customer.name, look.x0 + 24, y + 86, { size: 38, weight: 700, color: look.ink, maxWidth: 510 });
    if (d.customer.phone) text(ctx, d.customer.phone, look.x1, y + 86, { size: 27, color: look.muted, align: 'right' });
    return y + 120;
  },
  items(p, y) {
    const { ctx, look, d, t, words } = p;
    const cQty = 610;
    const cRate = 800;
    const right = look.x1 - 18;
    y += 30;
    box(ctx, look.x0, y, look.x1 - look.x0, 60, 8, p.accent);
    const head = { size: 24, weight: 600, color: '#ffffff' };
    text(ctx, '#', look.x0 + 20, y + 40, head);
    text(ctx, t.itemsHead, look.x0 + 64, y + 40, head);
    text(ctx, words.items.qty, cQty, y + 40, { ...head, align: 'right' });
    text(ctx, words.items.rate, cRate, y + 40, { ...head, align: 'right' });
    text(ctx, t.amountHead, right, y + 40, { ...head, align: 'right' });
    y += 60;
    d.txn.items.forEach((it, i) => {
      const h = 70;
      if (i % 2 === 1) {
        ctx.fillStyle = '#f9fafb';
        ctx.fillRect(look.x0, y, look.x1 - look.x0, h);
      }
      text(ctx, p.dg(String(i + 1)), look.x0 + 20, y + 45, { size: 26, color: look.muted });
      text(ctx, it.name || '—', look.x0 + 64, y + 45, { size: 29, weight: 600, color: look.ink, maxWidth: cQty - look.x0 - 64 - 150 });
      if (it.qty) text(ctx, p.dg(`${num(it.qty)}${it.unit ? ' ' + it.unit : ''}`), cQty, y + 45, { size: 26, color: look.ink, align: 'right', maxWidth: 170 });
      if (it.rate) text(ctx, p.dg(money(it.rate)), cRate, y + 45, { size: 26, color: look.ink, align: 'right' });
      text(ctx, p.dg(money(it.amount)), right, y + 45, { size: 29, weight: 600, color: look.ink, align: 'right' });
      y += h;
      line(ctx, look.x0, look.x1, y, look.rule, 1.5);
    });
    return y;
  },
  totals(p, y, rows) {
    const { ctx, look } = p;
    const right = look.x1 - 18;
    y += 20;
    for (const r of rows) {
      y += 48;
      text(ctx, r.label, right - 260, y, { size: 27, weight: r.bold ? 700 : 400, color: r.good ? GOOD : look.muted, align: 'right' });
      text(ctx, r.value, right, y, { size: 29, weight: r.bold ? 700 : 600, color: r.good ? GOOD : look.ink, align: 'right' });
    }
    return y;
  },
  balance(p, y, label, amount) {
    const { ctx, look } = p;
    y += 30;
    const x = look.x1 - 560;
    box(ctx, x, y, 560, 92, 10, p.accent);
    text(ctx, label, x + 28, y + 58, { size: 29, weight: 700, color: '#ffffff', maxWidth: 270 });
    text(ctx, amount, look.x1 - 28, y + 62, { size: 42, weight: 700, color: '#ffffff', align: 'right' });
    return y + 92;
  },
  footer(p, y) {
    const { ctx, look, s, brand } = p;
    y += 60;
    const top = y;
    // how to pay, on the left; a line to sign on the right
    if (s.bill.showUpi && s.upiId) {
      text(ctx, `UPI: ${s.upiId}`, look.x0, y, { size: 27, weight: 600, color: look.ink, maxWidth: 520 });
      y += 44;
    }
    if (s.bill.footer) {
      text(ctx, s.bill.footer, look.x0, y, { size: 26, color: look.muted, maxWidth: 520 });
      y += 44;
    }
    line(ctx, look.x1 - 300, look.x1, top + 40, look.ink, 2);
    text(ctx, p.t.sign, look.x1 - 150, top + 78, { size: 24, color: look.muted, align: 'center' });
    y = Math.max(y, top + 100);
    if (brand.credit) {
      y += 30;
      text(ctx, [p.t.madeWith, brand.link].filter(Boolean).join('   ·   '), W / 2, y, { size: 23, color: '#9ca3af', align: 'center', maxWidth: look.x1 - look.x0 });
    }
    return y + 44;
  },
};

// ── 9. ফ্রেম: a double frame, everything centred, dotted leaders like a printed menu ──

function leader(p: Pen, y: number, left: string, right: string, o: { size: number; weight?: number; color?: string; rightColor?: string }) {
  const { ctx, look } = p;
  const lw = Math.min(width(ctx, left, o.size, o.weight), look.x1 - look.x0 - 280);
  text(ctx, left, look.x0, y, { size: o.size, weight: o.weight, color: o.color ?? look.ink, maxWidth: look.x1 - look.x0 - 280 });
  const rw = width(ctx, right, o.size, 600);
  text(ctx, right, look.x1, y, { size: o.size, weight: 600, color: o.rightColor ?? o.color ?? look.ink, align: 'right' });
  const from = look.x0 + lw + 14;
  const to = look.x1 - rw - 14;
  if (to - from > 20) line(ctx, from, to, y - 6, '#b6bcc6', 2.5, [2, 9]);
}

const frame: Look = {
  ...base,
  ink: '#1f2937',
  x0: 110,
  x1: W - 110,
  top: 50,
  bottom: 60,
  header(p, y) {
    const { ctx, look } = p;
    const mid = W / 2;
    y += 20;
    if (p.logo) {
      drawLogo(ctx, p.logo, mid - 55, y, 110, 55);
      y += 124;
    }
    y += 62;
    text(ctx, p.s.shopName || p.t.shopFallback, mid, y, { size: 58, weight: 700, color: look.ink, align: 'center', maxWidth: look.x1 - look.x0 });
    if (p.contact) {
      y += 50;
      text(ctx, p.contact, mid, y, { size: 26, color: look.muted, align: 'center', maxWidth: look.x1 - look.x0 });
    }
    y += 30;
    line(ctx, mid - 70, mid + 70, y, p.accent, 4);
    return y;
  },
  title(p, y, title) {
    const { ctx } = p;
    y += 70;
    const mid = W / 2;
    const tw = width(ctx, title, 32, 600);
    line(ctx, mid - tw / 2 - 110, mid - tw / 2 - 24, y - 11, p.accent, 2);
    line(ctx, mid + tw / 2 + 24, mid + tw / 2 + 110, y - 11, p.accent, 2);
    text(ctx, title, mid, y, { size: 32, weight: 600, color: p.accent, align: 'center' });
    return y;
  },
  meta(p, y) {
    const { ctx, look, d, t } = p;
    const mid = W / 2;
    y += 74;
    text(ctx, d.customer.name, mid, y, { size: 42, weight: 700, color: look.ink, align: 'center', maxWidth: look.x1 - look.x0 });
    y += 44;
    const bits = [p.dg(fmtDate(d.txn.date, p.s.lang)), d.txn.id ? p.dg(t.number(billNo(d.txn))) : '', d.customer.phone].filter(Boolean);
    text(ctx, bits.join('   ·   '), mid, y, { size: 26, color: look.muted, align: 'center', maxWidth: look.x1 - look.x0 });
    return y + 10;
  },
  items(p, y) {
    const { d } = p;
    y += 30;
    for (const it of d.txn.items) {
      y += 56;
      leader(p, y, it.name || '—', p.dg(money(it.amount)), { size: 31, weight: 600 });
      const detail = detailOf(p, it);
      if (detail) {
        y += 36;
        text(p.ctx, detail, p.look.x0, y, { size: 24, color: p.look.muted });
      }
    }
    y += 30;
    line(p.ctx, p.look.x0, p.look.x1, y, p.look.rule, 2);
    return y;
  },
  totals(p, y, rows) {
    y += 10;
    for (const r of rows) {
      y += 52;
      leader(p, y, r.label, r.value, { size: 28, weight: r.bold ? 700 : 400, color: r.good ? GOOD : p.look.muted, rightColor: r.good ? GOOD : p.look.ink });
    }
    return y;
  },
  balance(p, y, label, amount) {
    const { ctx } = p;
    const mid = W / 2;
    y += 70;
    text(ctx, label, mid, y, { size: 30, weight: 600, color: p.look.muted, align: 'center' });
    y += 78;
    text(ctx, amount, mid, y, { size: 66, weight: 700, color: p.accent, align: 'center' });
    const aw = width(ctx, amount, 66, 700);
    line(ctx, mid - aw / 2, mid + aw / 2, y + 18, p.accent, 3);
    line(ctx, mid - aw / 2, mid + aw / 2, y + 26, p.accent, 1.5);
    return y + 26;
  },
  note(p, y) {
    y += 56;
    text(p.ctx, `${p.words.common.note}: ${p.d.txn.note}`, W / 2, y, { size: 27, color: p.look.muted, align: 'center', maxWidth: p.look.x1 - p.look.x0 });
    return y;
  },
  footer: (p, y) => footerCentered(p, y, 'none'),
  overlay(ctx, w, h, p) {
    ctx.save();
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 6;
    ctx.strokeRect(24, 24, w - 48, h - 48);
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 40, w - 80, h - 80);
    ctx.restore();
    for (const [x, y] of [[40, 40], [w - 40, 40], [40, h - 40], [w - 40, h - 40]]) diamond(ctx, x, y, 12, p.accent);
  },
};

// ── 10. ট্যালি ধাঁচ: the ruled, boxed bill of the accounting software half of India prints ──
// Black on white, every part in its own box, amounts with paise, the total written out in words,
// “for the shop” and a line to sign. It prints as it looks, on A4 or any other paper.

const TX0 = 40;
const TX1 = W - 40;
const TPAD = 16;
const INK = '#000000';
const GREY = '#3a3a3a';
/** column edges: # | goods | quantity | rate | per | amount */
const TCOLS = [TX0, TX0 + 70, 500, 650, 780, 870, TX1];

const two = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const paise = (p: Pen, n: number) => p.dg(two.format(n));

/** the box's own left and right walls, for one part of the bill */
const walls = (ctx: Ctx, y0: number, y1: number) => {
  line2(ctx, TX0, y0, y1, INK, 2);
  line2(ctx, TX1, y0, y1, INK, 2);
};

/** dd-mm-yyyy, the way such bills date themselves */
const shortDate = (iso: string) => iso.split('-').reverse().join('-');

/** “19.5 কেজি” when every line is in the same unit, else nothing */
function quantityTotal(p: Pen): string {
  const items = p.d.txn.items;
  const unit = items[0]?.unit;
  if (!unit || items.some((it) => !it.qty || it.unit !== unit)) return '';
  return p.dg(`${num(items.reduce((s, it) => s + it.qty, 0))} ${unit}`);
}

const tally: Look = {
  ...base,
  ink: INK,
  muted: GREY,
  rule: INK,
  x0: TX0 + TPAD,
  x1: TX1 - TPAD,
  top: 0,
  bottom: 20,
  header(p, y) {
    const { ctx, t, d } = p;
    // the title stands above the box, as “Tax Invoice” does
    y += 54;
    text(ctx, p.sale ? p.s.bill.title : t.receiptTitle, W / 2, y, { size: 32, weight: 700, color: INK, align: 'center', maxWidth: TX1 - TX0 });
    y += 22;
    const top = y;
    const split = TX0 + 540;
    const mid = split + (TX1 - split) / 2;
    let x = TX0 + TPAD;
    if (p.logo) {
      drawLogo(ctx, p.logo, x, top + 16, 92, 10);
      x += 108;
    }
    let ly = top + 50;
    text(ctx, p.s.shopName || t.shopFallback, x, ly, { size: 34, weight: 700, color: INK, maxWidth: split - x - TPAD });
    if (p.contact) {
      for (const part of [p.s.shopAddress, p.s.shopPhone && t.phone(p.s.shopPhone)].filter(Boolean) as string[]) {
        ly += 38;
        text(ctx, part, x, ly, { size: 24, color: GREY, maxWidth: split - x - TPAD });
      }
    }
    const bottom = Math.max(ly + 28, top + (p.logo ? 124 : 104));
    line(ctx, TX0, TX1, top, INK, 2);
    line2(ctx, split, top, bottom, INK, 1.5);
    line2(ctx, mid, top, bottom, INK, 1.5);
    text(ctx, t.noHead, split + TPAD, top + 36, { size: 22, color: GREY, maxWidth: mid - split - 2 * TPAD });
    if (d.txn.id) text(ctx, p.dg(String(billNo(d.txn))), split + TPAD, top + 78, { size: 28, weight: 700, color: INK, maxWidth: mid - split - 2 * TPAD });
    text(ctx, t.date, mid + TPAD, top + 36, { size: 22, color: GREY });
    text(ctx, p.dg(shortDate(d.txn.date)), mid + TPAD, top + 78, { size: 26, weight: 700, color: INK, maxWidth: TX1 - mid - 2 * TPAD });
    walls(ctx, top, bottom);
    line(ctx, TX0, TX1, bottom, INK, 1.5);
    return bottom;
  },
  // the title already stands above the box
  title: (_p, y) => y,
  meta(p, y) {
    const { ctx, d, t } = p;
    const top = y;
    text(ctx, t.buyer, TX0 + TPAD, top + 34, { size: 22, color: GREY });
    text(ctx, d.customer.name, TX0 + TPAD, top + 74, { size: 30, weight: 700, color: INK, maxWidth: 620 });
    if (d.customer.phone) text(ctx, t.phone(d.customer.phone), TX1 - TPAD, top + 74, { size: 24, color: GREY, align: 'right', maxWidth: 300 });
    const bottom = top + 98;
    walls(ctx, top, bottom);
    line(ctx, TX0, TX1, bottom, INK, 1.5);
    return bottom;
  },
  received(p, y) {
    const { ctx, d, t } = p;
    const top = y;
    text(ctx, t.receivedBig, TX0 + TPAD, top + 46, { size: 27, weight: 600, color: INK });
    text(ctx, `₹ ${paise(p, d.txn.paid)}`, TX1 - TPAD, top + 50, { size: 36, weight: 700, color: INK, align: 'right' });
    text(ctx, `${t.inWords} ${amountInWords(d.txn.paid, p.s.lang)}`, TX0 + TPAD, top + 96, { size: 22, color: INK, maxWidth: TX1 - TX0 - 2 * TPAD });
    const bottom = top + 122;
    walls(ctx, top, bottom);
    line(ctx, TX0, TX1, bottom, INK, 1.5);
    return bottom;
  },
  items(p, y) {
    const { ctx, d, t, words } = p;
    const [c0, c1, c2, c3, c4, c5, c6] = TCOLS;
    const top = y;
    const head = { size: 22, weight: 700, color: INK };
    text(ctx, t.slHead, (c0 + c1) / 2, top + 34, { ...head, align: 'center' });
    text(ctx, t.itemsHead, c1 + 12, top + 34, head);
    text(ctx, words.items.qty, c3 - 12, top + 34, { ...head, align: 'right' });
    text(ctx, words.items.rate, c4 - 12, top + 34, { ...head, align: 'right' });
    text(ctx, words.items.unit, (c4 + c5) / 2, top + 34, { ...head, align: 'center' });
    text(ctx, t.amountHead, c6 - 12, top + 34, { ...head, align: 'right' });
    y = top + 52;
    line(ctx, TX0, TX1, y, INK, 1.5);
    const row = 52;
    d.txn.items.forEach((it, i) => {
      const at = y + 36;
      text(ctx, p.dg(String(i + 1)), (c0 + c1) / 2, at, { size: 24, color: INK, align: 'center' });
      text(ctx, it.name || '—', c1 + 12, at, { size: 26, weight: 600, color: INK, maxWidth: c2 - c1 - 24 });
      if (it.qty) text(ctx, p.dg(`${num(it.qty)}${it.unit ? ' ' + it.unit : ''}`), c3 - 12, at, { size: 24, color: INK, align: 'right', maxWidth: c3 - c2 - 24 });
      if (it.qty && it.rate) text(ctx, paise(p, it.rate), c4 - 12, at, { size: 24, color: INK, align: 'right', maxWidth: c4 - c3 - 24 });
      if (it.qty && it.unit) text(ctx, it.unit, (c4 + c5) / 2, at, { size: 22, color: INK, align: 'center', maxWidth: c5 - c4 - 12 });
      text(ctx, paise(p, it.amount), c6 - 12, at, { size: 25, weight: 600, color: INK, align: 'right', maxWidth: c6 - c5 - 24 });
      y += row;
    });
    // the round-off sits in the table, as such bills list it
    const adj = roundOffOf(d.txn);
    if (adj) {
      text(ctx, t.roundOff, c2 - 12, y + 36, { size: 24, weight: 600, color: INK, align: 'right', maxWidth: c2 - c1 - 24 });
      text(ctx, p.dg(`${adj < 0 ? '(−)' : '(+)'} ${two.format(Math.abs(adj))}`), c6 - 12, y + 36, { size: 24, color: INK, align: 'right' });
      y += row;
    }
    y += 16;
    line(ctx, TX0, TX1, y, INK, 1.5);
    const totalAt = y + 40;
    // “আজকের মাল”, not “মোট”: the grid below has a মোট of its own (with the old বাকি in it)
    text(ctx, t.todayGoods, c2 - 12, totalAt, { size: 26, weight: 700, color: INK, align: 'right', maxWidth: c2 - c1 - 24 });
    const qty = quantityTotal(p);
    if (qty) text(ctx, qty, c3 - 12, totalAt, { size: 24, weight: 700, color: INK, align: 'right', maxWidth: c3 - c2 - 24 });
    text(ctx, `₹ ${paise(p, d.txn.total)}`, c6 - 12, totalAt, { size: 26, weight: 700, color: INK, align: 'right', maxWidth: c6 - c5 - 20 });
    y += 58;
    // the columns run from the head down through the total
    for (const x of [c1, c2, c3, c4, c5]) line2(ctx, x, top, y, INK, 1.2);
    line(ctx, TX0, TX1, y, INK, 1.5);
    text(ctx, t.inWords, TX0 + TPAD, y + 32, { size: 21, color: GREY });
    text(ctx, 'E. & O.E', TX1 - TPAD, y + 32, { size: 21, color: GREY, align: 'right' });
    text(ctx, amountInWords(d.txn.total, p.s.lang), TX0 + TPAD, y + 70, { size: 25, weight: 700, color: INK, maxWidth: TX1 - TX0 - 2 * TPAD });
    y += 92;
    walls(ctx, top, y);
    line(ctx, TX0, TX1, y, INK, 1.5);
    return y;
  },
  totals(p, y, rows) {
    const { ctx } = p;
    // the table above already has the lines' sum, the round-off and the day's total
    const cells = rows.filter((r) => !(p.d.txn.items.length && ['subtotal', 'roundOff', 'goods'].includes(r.kind)));
    if (!cells.length) return y;
    const top = y;
    const w = (TX1 - TX0) / cells.length;
    cells.forEach((r, i) => {
      const x = TX0 + i * w;
      if (i) line2(ctx, x, top, top + 96, INK, 1.5);
      const value =
        r.kind === 'paid'
          ? `− ${paise(p, r.amount)}`
          : r.kind === 'prev' && r.amount < 0
            ? `${paise(p, -r.amount)} ${p.words.balance.advance}`
            : paise(p, r.amount);
      text(ctx, r.label, x + TPAD, top + 36, { size: 22, color: GREY, maxWidth: w - 2 * TPAD });
      text(ctx, value, x + TPAD, top + 76, { size: 26, weight: r.bold ? 700 : 600, color: INK, maxWidth: w - 2 * TPAD });
    });
    const bottom = top + 96;
    walls(ctx, top, bottom);
    line(ctx, TX0, TX1, bottom, INK, 1.5);
    return bottom;
  },
  balance(p, y, label) {
    const { ctx, d } = p;
    const top = y;
    const amount = p.sale && d.cash ? d.txn.total : Math.abs(d.after);
    // with the rule above it, a double line: the grand total
    line(ctx, TX0, TX1, top + 6, INK, 1.5);
    text(ctx, label, TX0 + TPAD, top + 64, { size: 30, weight: 700, color: INK, maxWidth: 560 });
    text(ctx, `₹ ${paise(p, amount)}`, TX1 - TPAD, top + 66, { size: 36, weight: 700, color: INK, align: 'right' });
    const bottom = top + 94;
    walls(ctx, top, bottom);
    line(ctx, TX0, TX1, bottom, INK, 1.5);
    return bottom;
  },
  note(p, y) {
    const { ctx } = p;
    const top = y;
    text(ctx, `${p.words.common.note}: ${p.d.txn.note}`, TX0 + TPAD, top + 40, { size: 24, color: INK, maxWidth: TX1 - TX0 - 2 * TPAD });
    const bottom = top + 60;
    walls(ctx, top, bottom);
    line(ctx, TX0, TX1, bottom, INK, 1.5);
    return bottom;
  },
  footer(p, y) {
    const { ctx, s, t, brand } = p;
    const top = y;
    const split = TX0 + 540;
    const room = split - TX0 - 2 * TPAD;
    let ly = top + 40;
    if (s.bill.showUpi && s.upiId) {
      text(ctx, `UPI: ${s.upiId}`, TX0 + TPAD, ly, { size: 24, weight: 600, color: INK, maxWidth: room });
      ly += 38;
    }
    if (s.bill.footer) {
      text(ctx, s.bill.footer, TX0 + TPAD, ly, { size: 23, color: GREY, maxWidth: room });
      ly += 38;
    }
    const bottom = Math.max(ly, top + 132);
    line2(ctx, split, top, bottom, INK, 1.5);
    text(ctx, t.forShop(s.shopName || t.shopFallback), TX1 - TPAD, top + 38, { size: 23, weight: 700, color: INK, align: 'right', maxWidth: TX1 - split - 2 * TPAD });
    text(ctx, t.sign, TX1 - TPAD, bottom - 16, { size: 22, color: GREY, align: 'right' });
    walls(ctx, top, bottom);
    line(ctx, TX0, TX1, bottom, INK, 2);
    y = bottom + 38;
    text(ctx, t.computerMade(!p.sale), W / 2, y, { size: 21, color: GREY, align: 'center' });
    if (brand.credit) {
      y += 34;
      text(ctx, [t.madeWith, brand.link].filter(Boolean).join('   ·   '), W / 2, y, { size: 21, color: '#8a8a8a', align: 'center', maxWidth: TX1 - TX0 });
    }
    return y + 12;
  },
};

const LOOKS: Record<BillDesign, Look> = { band: base, line: line_, paper, receipt, tally, dark, royal, gradient, fresh, invoice, frame };

/**
 * For paper, whatever colourful design the shop picked: the till slip alone, black on white, no
 * barcode. A 58 mm receipt printer prints nothing but black, and a coloured head would come out
 * as a grey block; this reads the same on that and on an A4 page. (The ট্যালি ধাঁচ is already made
 * for paper, so it prints as it is.)
 */
export const printsAsIs = (design: BillDesign) => design === 'tally';

const printed: Look = {
  ...receipt,
  paper: '#ffffff',
  ink: '#000000',
  muted: '#333333',
  rule: '#555555',
  top: 0,
  bottom: 20,
  received: (p, y) => receivedBox(p, y, '#ffffff', '#000000'),
  footer: (p, y) => slipFooter(p, y, false),
  backdrop: undefined,
  overlay: undefined,
};

/**
 * Draws the ফর্দ (or, for a payment, the রসিদ) in the language from settings. Returns a canvas
 * cropped to its content; `forPrint` gives the black-and-white copy meant for a printer.
 */
export async function renderBill(d: BillData, s: Settings, brand: BillBrand = NO_BRAND, forPrint = false): Promise<HTMLCanvasElement> {
  await ensureFonts(s.lang);
  const words = tr(s.lang);
  const t = words.bill;
  const b = s.bill;
  const slip = forPrint && !printsAsIs(b.design);
  const look = slip ? printed : (LOOKS[b.design] ?? base);
  const sale = d.txn.type === 'sale';
  const cash = sale && !!d.cash;
  const dg = digitsFor(s);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = 4400 + d.txn.items.length * 110;
  const ctx = canvas.getContext('2d')!;

  const p: Pen = {
    ctx,
    d,
    s,
    t,
    words,
    dg,
    accent: b.accent || s.themeColor,
    logo: s.logo ? await loadImage(s.logo).catch(() => null) : null,
    brand,
    sale,
    contact: b.showShopContact ? [s.shopAddress, s.shopPhone && t.phone(s.shopPhone)].filter(Boolean).join('   •   ') : '',
    look,
  };

  const rows: Row[] = [];
  // the lines' sum and what rounding did to it, when the total isn't simply the sum
  const adj = sale ? roundOffOf(d.txn) : 0;
  if (adj) {
    rows.push({ kind: 'subtotal', amount: d.txn.total - adj, label: t.subtotal, value: dg(money(d.txn.total - adj)) });
    rows.push({ kind: 'roundOff', amount: adj, label: t.roundOff, value: dg(signedMoney(adj)) });
  }
  // a cash memo ends in what was paid, in the box below; it has no বাকি to show
  if (sale && !cash) rows.push({ kind: 'goods', amount: d.txn.total, label: t.todayGoods, value: dg(money(d.txn.total)), bold: true });
  if (!cash && (b.showPrevDue || !sale)) {
    rows.push({
      kind: 'prev',
      amount: d.before,
      label: t.prevDue,
      value: dg(d.before < 0 ? `${money(-d.before)} ${words.balance.advance}` : money(d.before)),
    });
    if (sale) rows.push({ kind: 'total', amount: d.before + d.txn.total, label: t.total, value: dg(money(d.before + d.txn.total)) });
  }
  if (!cash && d.txn.paid) {
    rows.push({ kind: 'paid', amount: d.txn.paid, label: sale ? t.cashPaid : t.paymentReceived, value: dg(`− ${money(d.txn.paid)}`), good: true });
  }
  const advance = !cash && d.after < -0.004;

  let y = look.top;
  y = look.header(p, y);
  y = look.title(p, y, sale ? b.title : t.receiptTitle);
  y = look.meta(p, y);
  if (!sale && d.txn.paid) y = look.received(p, y);
  if (d.txn.items.length) y = look.items(p, y);
  if (rows.length) y = look.totals(p, y, rows);
  y = cash
    ? look.balance(p, y, t.cashTotal, dg(money(d.txn.total)), false)
    : look.balance(p, y, advance ? t.advanceNow : t.dueNow, dg(money(Math.abs(d.after))), advance);
  if (d.txn.note) y = look.note(p, y);
  y = look.footer(p, y) + look.bottom;

  // a printer gets the slip alone, without the counter it lies on
  const x0 = slip ? SLIP_X0 : 0;
  const w = slip ? SLIP_X1 - SLIP_X0 : W;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = Math.ceil(y);
  const o = out.getContext('2d')!;
  o.fillStyle = look.paper;
  o.fillRect(0, 0, w, out.height);
  look.backdrop?.(o, w, out.height, p);
  o.drawImage(canvas, -x0, 0);
  look.overlay?.(o, w, out.height, p);
  return out;
}

export async function billBlob(d: BillData, s: Settings, brand: BillBrand = NO_BRAND, forPrint = false): Promise<Blob> {
  const canvas = await renderBill(d, s, brand, forPrint);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(tr(s.lang).errors.imageMake))), 'image/png'),
  );
}

/**
 * The small picture WhatsApp shows with a ফর্দ link (1200 × 630): the shop, the customer, and the
 * figure they need — so the bill can be read without even opening it.
 */
export async function billCardBlob(d: BillData, s: Settings): Promise<Blob> {
  await ensureFonts(s.lang);
  const words = tr(s.lang);
  const t = words.bill;
  const dg = digitsFor(s);
  const accent = s.bill.accent || s.themeColor;
  const sale = d.txn.type === 'sale';
  const cw = 1200;
  const ch = 630;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cw, ch);

  // the shop, on a panel in its colour
  const panel = 440;
  ctx.fillStyle = gradientOf(ctx, accent, 0, 0, panel, ch);
  ctx.fillRect(0, 0, panel, ch);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.arc(panel - 40, ch - 30, 170, 0, Math.PI * 2);
  ctx.fill();
  const shop = s.shopName || t.shopFallback;
  // the shop's name over as many as three lines
  ctx.font = `700 54px ${FONT}`;
  const lines: string[] = [];
  let current = '';
  for (const word of shop.split(/\s+/)) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width > panel - 90 && current) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  const shown = lines.slice(0, 3);
  let y = ch / 2 - (shown.length - 1) * 34;
  for (const l of shown) {
    text(ctx, l, 50, y, { size: 54, weight: 700, color: '#ffffff', maxWidth: panel - 90 });
    y += 68;
  }
  text(ctx, sale ? s.bill.title : t.receiptTitle, 50, ch - 60, { size: 28, weight: 600, color: 'rgba(255,255,255,0.85)', maxWidth: panel - 90 });

  // the customer and the figures
  const x = panel + 60;
  const room = cw - x - 60;
  text(ctx, d.customer.name, x, 118, { size: 56, weight: 700, color: '#111827', maxWidth: room });
  const sub = [d.txn.id ? t.number(billNo(d.txn)) : '', fmtDate(d.txn.date, s.lang)].filter(Boolean).join('  ·  ');
  text(ctx, dg(sub), x, 172, { size: 30, color: '#6b7280', maxWidth: room });
  line(ctx, x, cw - 60, 214, '#e5e7eb', 3);
  if (sale) {
    text(ctx, t.todayGoods, x, 280, { size: 32, color: '#6b7280' });
    text(ctx, dg(money(d.txn.total)), cw - 60, 282, { size: 40, weight: 700, color: '#111827', align: 'right' });
  } else {
    text(ctx, t.receivedBig, x, 280, { size: 32, color: GOOD });
    text(ctx, dg(money(d.txn.paid)), cw - 60, 282, { size: 40, weight: 700, color: GOOD, align: 'right' });
  }
  const cash = sale && !!d.cash;
  const advance = !cash && d.after < -0.004;
  box(ctx, x - 20, 330, cw - x - 40, 190, 26, tint(accent, 0.1));
  text(ctx, cash ? t.cashTotal : advance ? t.advanceNow : t.dueNow, x + 10, 395, { size: 34, weight: 600, color: accent, maxWidth: room - 40 });
  text(ctx, dg(money(cash ? d.txn.total : Math.abs(d.after))), x + 10, 486, { size: 84, weight: 700, color: accent, maxWidth: room - 40 });
  text(ctx, t.tapToSee, x, 585, { size: 27, color: '#9ca3af', maxWidth: room });

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(words.errors.imageMake))), 'image/jpeg', 0.86),
  );
}

export const billFileName = (d: BillData, lang: Lang) =>
  `${d.txn.type === 'sale' ? tr(lang).bill.fileBase : tr(lang).bill.receiptFile}-${d.customer.name.replace(/[\\/:*?"<>|\s]+/g, '-')}-${d.txn.date}.png`;

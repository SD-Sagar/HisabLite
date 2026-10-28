import type { LineItem, Txn } from '../db';
import { getLang, tr, type Lang } from '../i18n';

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export const num = (n: number) => inr.format(round2(n));

export const money = (n: number) => (n < 0 ? '-₹' : '₹') + num(Math.abs(n));

/** + ₹0.50 / − ₹7, for a round-off */
export const signedMoney = (n: number) => `${n < 0 ? '−' : '+'} ${money(Math.abs(n))}`;

/** How a ফর্দ's lines become its total: to the rupee, down or up to a round ten, or exactly as added. */
export type RoundMode = 'rupee' | 'down10' | 'up10' | 'exact';

/** Worked in paise, so ₹1,850 can never slip to ₹1,860 on a float. */
export function roundTotal(sum: number, mode: RoundMode): number {
  const paise = Math.round(sum * 100);
  if (mode === 'down10') return Math.floor(paise / 1000) * 10;
  if (mode === 'up10') return Math.ceil(paise / 1000) * 10;
  if (mode === 'rupee') return Math.round(paise / 100);
  return paise / 100;
}

/** The totals a sum can be rounded to, each once, smallest first; ₹0 is never one of them. */
export function roundOptions(sum: number): { mode: RoundMode; total: number }[] {
  const out: { mode: RoundMode; total: number }[] = [];
  for (const mode of ['rupee', 'down10', 'up10', 'exact'] as const) {
    const total = roundTotal(sum, mode);
    if (total > 0 && !out.some((o) => o.total === total)) out.push({ mode, total });
  }
  return out.sort((a, b) => a.total - b.total);
}

export const itemsSum = (items: Pick<LineItem, 'amount'>[]) => round2(items.reduce((s, it) => s + it.amount, 0));

/**
 * What rounding added to (or took off) a saved ফর্দ: its total against its lines. Nothing is
 * stored for it — a ফর্দ written before round-off existed simply comes out as 0.
 */
export function roundOffOf(t: Pick<Txn, 'items' | 'total'>): number {
  if (!t.items.length) return 0;
  const adj = round2(t.total - itemsSum(t.items));
  return Math.abs(adj) < 0.005 ? 0 : adj;
}

/** The rounding a saved ফর্দ was made with, so opening it to edit keeps its total. */
export function roundModeOf(t: Pick<Txn, 'items' | 'total'>): RoundMode {
  const sum = itemsSum(t.items);
  const modes: RoundMode[] = ['exact', 'rupee', 'down10', 'up10'];
  return modes.find((m) => Math.abs(roundTotal(sum, m) - t.total) < 0.005) ?? 'exact';
}

const NATIVE_DIGITS: Partial<Record<Lang, string>> = { bn: '০১২৩৪৫৬৭৮৯', hi: '०१२३४५६७८९' };

/** 0-9 → ০-৯ (Bengali) or ०-९ (Hindi); English keeps its digits. */
export const toNativeDigits = (s: string, lang: Lang) => {
  const digits = NATIVE_DIGITS[lang];
  return digits ? s.replace(/[0-9]/g, (d) => digits[Number(d)]) : s;
};

/** ০-৯ and ०-९ → 0-9, so numbers typed on a Bengali or Hindi keyboard still count. */
const toAsciiDigits = (s: string) =>
  s
    .replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6))
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));

/** Parses user input that may use Bengali/Hindi digits or Indian comma grouping. NaN-safe: returns 0. */
export function parseNum(s: string | number | null | undefined): number {
  if (typeof s === 'number') return Number.isFinite(s) ? s : 0;
  if (!s) return 0;
  const n = Number.parseFloat(toAsciiDigits(s).replace(/[,\s₹]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Shows a number in an input: empty for 0 so the field starts blank. */
export const numInput = (n: number | null | undefined) => (n ? String(round2(n)) : '');

const pad = (n: number) => String(n).padStart(2, '0');

export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayISO = () => isoDate(new Date());

export function shiftDate(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + days));
}

/** 2026-09-18 → 18 সেপ্টেম্বর 2026 / 18 सितंबर 2026 / 18 Sep 2026 */
export function fmtDate(iso: string, lang: Lang = getLang()) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${tr(lang).date.months[m - 1]} ${y}`;
}

/** 2026-09-18 → 18 সেপ্টেম্বর 2026, শুক্রবার */
export function fmtDateLong(iso: string, lang: Lang = getLang()) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${fmtDate(iso, lang)}, ${tr(lang).date.weekdays[new Date(y, m - 1, d).getDay()]}`;
}

export function relativeDay(iso: string, lang: Lang = getLang()) {
  const today = todayISO();
  if (iso === today) return tr(lang).date.today;
  if (iso === shiftDate(today, -1)) return tr(lang).date.yesterday;
  return fmtDate(iso, lang);
}

/** 2026-09-18 → “আজ, 18 সেপ্টেম্বর” or “গতকাল, 17 সেপ্টেম্বর”; older dates in full */
export function dayLabel(iso: string, lang: Lang = getLang()) {
  const [, m, d] = iso.split('-').map(Number);
  const t = tr(lang).date;
  const today = todayISO();
  if (iso === today) return `${t.today}, ${d} ${t.months[m - 1]}`;
  if (iso === shiftDate(today, -1)) return `${t.yesterday}, ${d} ${t.months[m - 1]}`;
  return fmtDate(iso, lang);
}

/** a moment as “আজ, 18 সেপ্টেম্বর, 3:40 pm”: the day as dayLabel writes it, then the time */
export function dayTime(when: string | number, lang: Lang = getLang()) {
  const d = new Date(when);
  return `${dayLabel(isoDate(d), lang)}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
}

export const isValidISODate = (s: string | null | undefined): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());

/** Digits-only phone with country code, as wa.me expects. null when there is no usable number. */
export function waPhone(phone: string, countryCode: string): string | null {
  let digits = toAsciiDigits(phone).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) return countryCode.replace(/\D/g, '') + digits;
  return digits.length > 10 ? digits : null;
}

export const qtyText = (it: Pick<LineItem, 'qty' | 'unit'>) =>
  it.qty ? `${num(it.qty)}${it.unit ? ' ' + it.unit : ''}` : '';

export const itemsSummary = (items: LineItem[]) =>
  items.map((it) => [it.name, qtyText(it)].filter(Boolean).join(' ')).join(', ');

export const initials = (name: string) => name.trim().slice(0, 1).toUpperCase() || '?';

/** +919876543210 (or 919876543210, as Supabase stores it) → +91 98765 43210 */
export const prettyPhone = (phone: string) => (phone && !phone.startsWith('+') ? '+' + phone : phone).replace(/^(\+\d+?)(\d{5})(\d{5})$/, '$1 $2 $3');

export function balanceLabel(bal: number, lang: Lang = getLang()) {
  const t = tr(lang).balance;
  if (bal > 0.004) return { text: money(bal), label: t.due, tone: 'due' as const };
  if (bal < -0.004) return { text: money(-bal), label: t.advance, tone: 'advance' as const };
  return { text: '₹0', label: t.clear, tone: 'clear' as const };
}

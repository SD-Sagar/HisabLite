import { tr, type Dict, type Lang } from '../i18n';

type Words = Dict['inWords'];

/** A whole number in words, grouped the Indian way: crore, lakh, thousand, hundred. */
function spell(n: number, w: Words): string {
  if (n < 100) return w.upTo99[n];
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  let rest = n % 10_000_000;
  if (crore) parts.push(`${spell(crore, w)} ${w.crore}`);
  const lakh = Math.floor(rest / 100_000);
  rest %= 100_000;
  if (lakh) parts.push(`${w.upTo99[lakh]} ${w.lakh}`);
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (thousand) parts.push(`${w.upTo99[thousand]} ${w.thousand}`);
  const hundred = Math.floor(rest / 100);
  rest %= 100;
  if (hundred) parts.push(w.hundreds[hundred]);
  if (rest) parts.push(w.upTo99[rest]);
  return parts.join(' ');
}

/** ₹1,850 → “এক হাজার আটশো পঞ্চাশ টাকা মাত্র”, the line a Tally-style bill writes under its total */
export function amountInWords(amount: number, lang: Lang): string {
  const w = tr(lang).inWords;
  const paise = Math.round(Math.abs(amount) * 100);
  const rupees = Math.floor(paise / 100);
  const cents = paise % 100;
  return cents ? w.withPaise(spell(rupees, w), spell(cents, w)) : w.rupees(spell(rupees, w));
}

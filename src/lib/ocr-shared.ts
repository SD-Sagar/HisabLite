import * as z from 'zod';
import type { Customer } from '../db';
import { tr, type Lang } from '../i18n';
import type { KhataStyle } from '../settings';

const ItemSchema = z.object({
  name: z.string(),
  qty: z.number().nullable(),
  unit: z.string().nullable(),
  rate: z.number().nullable(),
  amount: z.number().nullable(),
});

const EntrySchema = z.object({
  customer_name: z.string(),
  matched_customer_id: z.number().nullable(),
  /** which photo this block was read from, 1 for the first; left out by a model that forgets */
  page: z.number().nullish(),
  date: z.string().nullable(),
  type: z.enum(['sale', 'payment']),
  items: z.array(ItemSchema),
  written_total: z.number().nullable(),
  paid: z.number().nullable(),
  note: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
});

export const ScanSchema = z.object({
  page_date: z.string().nullable(),
  entries: z.array(EntrySchema),
  warnings: z.array(z.string()),
});

export type ScanEntry = z.infer<typeof EntrySchema>;
export type ScanResult = z.infer<typeof ScanSchema>;

const PersonSchema = z.object({
  name: z.string(),
  /** phone number written beside the name, digits only; null when there is none */
  phone: z.string().nullish(),
  /** what they owe the shop today; negative when the shop owes them */
  balance: z.number().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
});

/** Moving in from a paper book: only who is in it and what each one owes right now. */
export const PeopleSchema = z.object({
  people: z.array(PersonSchema),
  warnings: z.array(z.string()),
});

export type ScanPerson = z.infer<typeof PersonSchema>;
export type PeopleResult = z.infer<typeof PeopleSchema>;

/** 'entries' reads a day's ledger page; 'people' lifts a whole old book into the app. */
export type ReadMode = 'entries' | 'people';

export const schemaFor = (mode: ReadMode | undefined) => (mode === 'people' ? PeopleSchema : ScanSchema);

export const PEOPLE_PROMPT = `You read photos of a fruit shop's old paper credit ledger (খাতা / खाता) from India. The shopkeeper is moving their book into an app, and all they want from these photos is the list of people and what each one owes today — not the day-by-day entries.

The writing may be Bengali, Hindi (Devanagari), English or mixed, with Bengali (০-৯), Devanagari (०-९) or English digits. The shop owner checks every line before it is saved, so be faithful to what is written rather than guessing.

- One row per person, in the order they appear. The same person written in two places is ONE row, with the later figure.
- balance: what that person owes the shop right now — the closing figure, which is usually the last or lowest amount in their part of the page, after the additions and the payments. Never add the figures up yourself, and never use a figure that is crossed out. Use the amount written as the standing due. If nothing can be read, use null.
- A person who has paid ahead (the shop owes them) gets a negative balance.
- phone: the digits written beside the name, if any; otherwise null.
- The pages may not be handwritten at all: they may be a report printed by another ledger app, with a proper table. Then read the table — one row per person, the name column and the amount column.
- Such reports often keep two amount columns: what the customer owes the shop ("Aapko Milenge", "You will get", "বাকি", "बकाया"), and what the shop owes the customer ("Aap Denge", "You will give", "অগ্রিম", "देना"). The first is a positive balance, the second a negative one. A "Details" column usually holds the phone number.
- Skip page totals ("Grand Total"), headings, dates, footers and anything that is not a person.
- confidence: "low" if you had to guess the name or the figure, "medium" if it was hard to read, else "high".
- warnings: short notes, in the output language, about anything the owner should check — a crossed-out figure, two people with the same name, a column you could not follow.`;

export const SYSTEM_PROMPT = `You read photos of handwritten credit-ledger pages (খাতা / ফর্দ / खाता) from a fruit shop or wholesale fruit আড়ত in India, and turn them into structured entries for a ledger app. The shop owner reviews every entry before saving, so be faithful to what is written rather than guessing.

The writing may be Bengali, Hindi (Devanagari), English or mixed, with Bengali (০-৯), Devanagari (०-९) or English digits. A typical block is a customer name followed by fruit lines with quantity, unit (কেজি, পেটি, ক্যারেট, ঝুড়ি, পিস, ডজন, किलो, पेटी, कैरेट, दर्जन, kg, box …), rate and amount, sometimes a total and a cash payment (জমা, নগদ, দিল, পেলাম, जमा, नकद, दिया, cash).

Khata pages are not all laid out the same way. In an আড়ত the goods and the supplier (বেপারি) are often written once at the top of a block and every line below is one customer with weight × rate; then the goods name for each of those entries comes from the heading above them, and the supplier named in the heading is not a customer — never make an entry for that name. Other shops write the rate before the weight, or keep cash on the other side of the page.

Whatever the shopkeeper tells you in the user message about their own khata is the truth about these pages, and it overrides everything in the paragraphs above — which part of a line is the name, the weight, the rate or the total, and what any mark on the page means. If they say some numbers are not a customer's credit (cash in hand, already settled, a mark such as a circle or a letter beside the number), leave those numbers out of the entries completely, and say in warnings what you left out and why.

How to fill the fields:
- One entry per customer block, in the order written. If the same customer appears twice, keep two entries.
- A block where the customer only paid money and took no goods is type "payment" with an empty items list and the amount in paid.
- Keep customer names in the script they are written in. Write fruit names and units in the output language named in the user message (e.g. "aam", "Mango", "आम" → "আম" when it is Bengali), but never invent items.
- Output plain numbers (convert Bengali and Devanagari digits). If an item's amount is missing but qty and rate are present, compute amount = qty × rate; if the rate is missing but qty and amount are present, compute the rate. Use null only when a value can neither be read nor derived.
- written_total is the total written on the page for that block, exactly as written; null if none. Do not compute it yourself.
- matched_customer_id: the id from the known-customer list when the written name clearly refers to that customer (allowing spelling variants, nicknames and transliteration between scripts); otherwise null.
- page: the number of the photo the block was read from, as labelled in the user message. Use 1 when there is only one photo.
- date: YYYY-MM-DD when a date is written for the block or page, else null. Dates are Indian style (day first); assume the current year when only day and month are written.
- confidence: "low" if you had to guess any name or number, "medium" if something was hard to read, else "high".
- Leave out anything the shopkeeper said to leave out, and never turn it into an entry for anybody. Put it in warnings instead.
- warnings: short notes, in the output language, about anything the owner should check — smudged digits, crossed-out lines you skipped, arithmetic on the page that does not add up.`;

export class OcrError extends Error {}

export interface ReadOutcome<T = ScanResult | PeopleResult> {
  result: T;
  /** the model that actually read the page (may differ from the chosen one when it was busy) */
  model: string;
}

export interface PagePhoto {
  base64: string;
  /** a photo of a page, or a PDF another ledger app printed */
  mediaType: 'image/jpeg' | 'image/png' | 'application/pdf';
}

/** An old page of this shop's khata with the reading the owner checked, shown as an example. */
export interface HandExample {
  base64: string;
  text: string;
}

/** How to reach the AI on the owner's key: the ai function, with the shop's login and a scan ticket. */
export interface ServerConn {
  baseUrl: string;
  headers: Record<string, string>;
}

export interface ReadOptions {
  apiKey: string;
  model: string;
  /** read on the owner's key through the server, instead of a key on this phone */
  server?: boolean;
  /** filled in by ocr.ts once the server has given this scan its ticket */
  conn?: ServerConn;
  /** what to pull out of the photos; 'entries' when left out */
  mode?: ReadMode;
  /** the pages of one khata, in order; entries may run from one into the next */
  images: PagePhoto[];
  customers: Pick<Customer, 'id' | 'name'>[];
  /** the goods this shop actually sells, so a half-legible word is read as one of them */
  items?: string[];
  /** the shop's own short forms and the way its khata is laid out */
  style?: KhataStyle;
  /** a checked page of the same handwriting, to learn this hand from */
  sample?: HandExample;
  today: string;
  /** a second, slower look, after the shopkeeper said the first one had mistakes */
  careful?: boolean;
  /** app language: item names, units and warnings come back in it */
  lang: Lang;
}

export function userPrompt(o: ReadOptions) {
  const t = tr(o.lang);
  const people = o.mode === 'people';
  const known = o.customers.length ? o.customers.map((c) => `${c.id}: ${c.name}`).join('\n') : '(none yet)';
  const goods = o.items?.length ? o.items.slice(0, 60).join(', ') : '';
  const shorthand = o.style?.shorthand.trim();
  const notes = o.style?.notes.trim();
  const pages = o.images.length;
  // the shopkeeper's own description comes first and is repeated at the end: it is the one thing
  // that beats the general instructions, and a model skims the middle of a long message
  const shopRules = [
    notes &&
      `HOW THIS SHOP'S KHATA IS WRITTEN — the shopkeeper's own words. Where this differs from the general description in your instructions, THIS is what the page means:\n${notes}`,
    shorthand &&
      `Short forms this shop writes, and what each one means:\n${shorthand}\nWherever one of these appears on the page, put the full word in the output.`,
  ].filter(Boolean) as string[];
  return [
    `Today's date: ${o.today}`,
    `Output language: ${t.ocr.languageName}. Preferred unit words: ${t.units.join(', ')}.`,
    ...shopRules,
    people
      ? `People already in the app — a name that means the same person as one of these is still worth returning, the app will match it up:\n${known}`
      : `Known customers (id: name):\n${known}`,
    // a shop's own words are the best dictionary for its own handwriting
    !people && goods &&
      `Goods this shop usually sells: ${goods}. Prefer these spellings when a written word is close to one of them, but write what is actually there if it is clearly something else.`,
    o.sample &&
      'The photo marked SAMPLE is not a page to read. It is an older page in the same hand, with its checked reading written under it. Study it first for the shape of each digit and the spelling of names and goods, then read the real pages the same way. Never take an entry from the sample.',
    pages > 1 &&
      (people
        ? `There are ${pages} photos, marked "Page 1" to "Page ${pages}", from one book. The same person may appear on more than one page — give that person one row, with the figure from the later page.`
        : `There are ${pages} photos, marked "Page 1" to "Page ${pages}". They are pages of one khata, in order — read them as one ledger. A block that starts on one page and carries on to the next is ONE entry, not two. Set "page" to the photo where the block starts.`),
    pages === 1 && !people && 'There is one photo. Set "page" to 1 in every entry.',
    o.careful &&
      'The shopkeeper says the first reading had mistakes. Read it again more slowly: go line by line, check every digit (0/6, 1/7, 3/8, ৩/৪, ২/৭ are easily confused), check each written total against its own lines, and mark confidence "low" wherever you are unsure instead of guessing.',
    people
      ? 'List every person in these pages and what each one owes today.'
      : shopRules.length
        ? "Extract every entry from these ledger pages. Follow this shop's own description of its khata above wherever it differs from the general rules, and leave out whatever it says is not a customer's credit."
        : 'Extract every entry from these ledger pages.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Error texts in the app's current language. */
export const ocrText = () => tr().ocr;

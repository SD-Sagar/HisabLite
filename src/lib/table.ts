import { round2 } from './format';

/**
 * Reading the file another ledger app spat out: a CSV, or an Excel sheet. Excel is a zip of XML,
 * and the browser can unzip it, so no library is needed — a khata app should not carry a
 * megabyte of spreadsheet code around for a job that happens once.
 */

export interface Table {
  /** the file it came from, shown to the shopkeeper */
  fileName: string;
  /** the first row, when it looks like headings */
  headers: string[];
  rows: string[][];
}

export class TableError extends Error {}

const TEXT = ['.csv', '.tsv', '.txt'];
const SHEET = ['.xlsx', '.xlsm'];

export const isTableFile = (name: string) => [...TEXT, ...SHEET].some((e) => name.toLowerCase().endsWith(e));
export const isPdfFile = (name: string) => name.toLowerCase().endsWith('.pdf');

/** Splits one CSV line, keeping what is inside quotes together. */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

function parseCsv(text: string, fileName: string): Table {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const first = clean.split('\n', 1)[0] ?? '';
  // whichever separator the exporting app used
  const sep = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let line = '';
  let quotes = 0;
  for (const part of clean.split('\n')) {
    line = line ? `${line}\n${part}` : part;
    quotes += (part.match(/"/g) ?? []).length;
    // a cell may hold a line break of its own; only split where the quotes are balanced
    if (quotes % 2) continue;
    if (line.trim()) rows.push(splitLine(line, sep));
    line = '';
    quotes = 0;
  }
  if (!rows.length) throw new TableError('empty');
  return { fileName, headers: rows[0], rows: rows.slice(1) };
}

// ── the smallest zip reader that can open an .xlsx ──

const u16 = (v: DataView, at: number) => v.getUint16(at, true);
const u32 = (v: DataView, at: number) => v.getUint32(at, true);

async function inflate(data: Uint8Array, method: number): Promise<Uint8Array> {
  if (method === 0) return data;
  if (method !== 8) throw new TableError('compression');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** file name → bytes, for the few parts of the workbook we need */
async function unzip(buffer: ArrayBuffer, wanted: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let end = -1;
  for (let i = buffer.byteLength - 22; i >= 0 && i > buffer.byteLength - 66_000; i--) {
    if (u32(view, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new TableError('not a zip');
  const count = u16(view, end + 10);
  let at = u32(view, end + 16);
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (u32(view, at) !== 0x02014b50) break;
    const method = u16(view, at + 10);
    const size = u32(view, at + 20);
    const nameLen = u16(view, at + 28);
    const extraLen = u16(view, at + 30);
    const commentLen = u16(view, at + 32);
    const localAt = u32(view, at + 42);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    if (wanted(name) && u32(view, localAt) === 0x04034b50) {
      const dataAt = localAt + 30 + u16(view, localAt + 26) + u16(view, localAt + 28);
      out.set(name, await inflate(bytes.subarray(dataAt, dataAt + size), method));
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** "BC12" → 54: which column that cell sits in */
function columnOf(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

async function parseSheet(file: File): Promise<Table> {
  const parts = await unzip(
    await file.arrayBuffer(),
    (name) => name === 'xl/sharedStrings.xml' || name.startsWith('xl/worksheets/sheet'),
  );
  const sheetName = [...parts.keys()].filter((n) => n.startsWith('xl/worksheets/sheet')).sort()[0];
  if (!sheetName) throw new TableError('no sheet');
  const text = (data: Uint8Array) => new TextDecoder().decode(data as BufferSource);
  const xml = new DOMParser();

  const shared: string[] = [];
  const strings = parts.get('xl/sharedStrings.xml');
  if (strings) {
    for (const si of xml.parseFromString(text(strings), 'application/xml').getElementsByTagName('si')) {
      shared.push([...si.getElementsByTagName('t')].map((t) => t.textContent ?? '').join(''));
    }
  }

  const rows: string[][] = [];
  for (const row of xml.parseFromString(text(parts.get(sheetName)!), 'application/xml').getElementsByTagName('row')) {
    const cells: string[] = [];
    for (const c of row.getElementsByTagName('c')) {
      const at = columnOf(c.getAttribute('r') ?? '');
      const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      const value =
        type === 's' ? (shared[Number(v)] ?? '') : type === 'inlineStr' ? (c.textContent ?? '') : v;
      if (at >= 0) cells[at] = value.trim();
    }
    const filled = [...cells].map((x) => x ?? '');
    if (filled.some((x) => x)) rows.push(filled);
  }
  if (!rows.length) throw new TableError('empty');
  return { fileName: file.name, headers: rows[0], rows: rows.slice(1) };
}

export async function readTable(file: File): Promise<Table> {
  if (SHEET.some((e) => file.name.toLowerCase().endsWith(e))) return parseSheet(file);
  return parseCsv(await file.text(), file.name);
}

// ── making sense of the columns ──

export interface ColumnMap {
  name: number;
  /** what the customer owes the shop */
  due: number;
  /** what the shop owes the customer, when the file keeps it in its own column */
  advance: number;
  phone: number;
}

const WORDS = {
  name: ['name', 'customer', 'party', 'client', 'নাম', 'কাস্টমার', 'নাম', 'नाम', 'ग्राहक', 'पार्टी'],
  // "aapko milenge" is Khatabook's "you will get"
  due: ['aapko milenge', 'you will get', 'milenge', 'due', 'balance', 'debit', 'receivable', 'baki', 'বাকি', 'পাবেন', 'बकाया', 'लेना'],
  advance: ['aap denge', 'you will give', 'denge', 'advance', 'credit', 'payable', 'অগ্রিম', 'দেবেন', 'देना', 'जमा'],
  phone: ['phone', 'mobile', 'number', 'contact', 'details', 'ফোন', 'নম্বর', 'फ़ोन', 'मोबाइल', 'नंबर'],
};

const looksLikeAmount = (v: string) => /^[-₹\s]*[\d,]+(\.\d+)?\s*(dr|cr)?$/i.test(v.trim()) && /\d/.test(v);

/** Takes the headings apart, and when they say nothing useful, looks at the rows themselves. */
export function guessColumns(table: Table): ColumnMap {
  const heads = table.headers.map((h) => h.toLowerCase().trim());
  const find = (words: string[]) => heads.findIndex((h) => h && words.some((w) => h.includes(w)));
  const map: ColumnMap = { name: find(WORDS.name), due: find(WORDS.due), advance: find(WORDS.advance), phone: find(WORDS.phone) };

  const body = table.rows.slice(0, 20);
  if (map.name < 0) {
    // the wordiest column that is not a number
    const score = table.headers.map((_, i) =>
      body.reduce((n, r) => n + (r[i] && !looksLikeAmount(r[i]) && /\D/.test(r[i]) ? r[i].length : 0), 0),
    );
    map.name = score.indexOf(Math.max(...score));
  }
  if (map.due < 0) {
    const amounts = table.headers.map((_, i) => body.filter((r) => r[i] && looksLikeAmount(r[i])).length);
    const best = Math.max(...amounts);
    map.due = best > 0 ? amounts.indexOf(best) : -1;
  }
  return map;
}

/** ₹1,200.00 Dr → 1200; blank → 0 */
export function amount(cell: string | undefined): number {
  if (!cell) return 0;
  const negative = /^\(.*\)$/.test(cell.trim()) || /-/.test(cell);
  const n = Number(cell.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

const SKIP = /^(grand\s*)?total\b|^sum\b|^opening\b|^closing\b|^balance$|^कुल|^মোট/i;

/** A row is a person only if its name holds a letter; spaces, dashes and ₹ figures are not. */
const isName = (v: string) => /\p{L}/u.test(v);

export interface Person {
  name: string;
  phone: string;
  /** positive when they owe the shop */
  balance: number;
}

/**
 * What to do when the same name comes back line after line. A transaction export has one line
 * per entry, so adding them up gives what that customer owes; a list that repeats a running
 * balance instead should keep the last one.
 */
export type Repeat = 'add' | 'last';

export interface FileRead {
  people: Person[];
  /** lines that were not a person at all: totals, headings, blank or symbols */
  skipped: number;
  /** lines that joined a name already seen */
  merged: number;
}

/** The rows that are really people, with the columns the shopkeeper pointed at. */
export function peopleFrom(table: Table, map: ColumnMap, repeat: Repeat = 'add'): FileRead {
  const people: Person[] = [];
  const seen = new Map<string, Person>();
  let skipped = 0;
  let merged = 0;
  for (const row of table.rows) {
    const name = (row[map.name] ?? '').trim();
    if (!name || !isName(name) || SKIP.test(name)) {
      skipped++;
      continue;
    }
    const balance = amount(row[map.due]) - (map.advance >= 0 ? amount(row[map.advance]) : 0);
    const phone = (row[map.phone] ?? '').replace(/\D/g, '').slice(-12);
    const key = name.toLowerCase().replace(/\s+/g, ' ');
    const already = seen.get(key);
    if (!already) {
      const person = { name, phone, balance };
      seen.set(key, person);
      people.push(person);
      continue;
    }
    // one person, many lines
    merged++;
    already.balance = round2(repeat === 'add' ? already.balance + balance : balance);
    if (!already.phone && phone) already.phone = phone;
  }
  return { people, skipped, merged };
}

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { isLang, LANGS, tr, type Dict, type Lang } from './i18n';

/** the whole look of the ফর্দ picture; the first five are free, the rest come with a plan */
export type BillDesign =
  | 'band' | 'line' | 'paper' | 'receipt' | 'tally'
  | 'dark' | 'royal' | 'gradient' | 'fresh' | 'invoice' | 'frame';

export const BILL_DESIGNS: BillDesign[] = [
  'band', 'line', 'paper', 'receipt', 'tally', 'dark', 'royal', 'gradient', 'fresh', 'invoice', 'frame',
];

const FREE_DESIGNS: BillDesign[] = ['tally'];

export const isFreeDesign = (d: BillDesign) => FREE_DESIGNS.includes(d);

/** the page colour behind the app's cards */
export type BgTone = 'pearl' | 'ivory' | 'frost' | 'sage';

export const BG_TONES: BgTone[] = ['pearl', 'ivory', 'frost', 'sage'];
export const DEFAULT_TONE: BgTone = 'pearl';

export const isFreeTheme = (color: string) => color.toLowerCase() === DEFAULT_THEME.toLowerCase();
export const isFreeTone = (tone: BgTone) => tone === DEFAULT_TONE;

export interface BillStyle {
  title: string;
  accent: string;
  design: BillDesign;
  showPrevDue: boolean;
  showShopContact: boolean;
  showUpi: boolean;
  /** the small "EasyLedger দিয়ে তৈরি" line; only a paid shop may turn it off */
  credit: boolean;
  footer: string;
}

export interface Templates {
  sale: string;
  payment: string;
  reminder: string;
}

/**
 * How this shop writes its khata, in the owner's own words. It is sent with every photo so the
 * AI reads the shop's short forms and layout instead of guessing at them.
 */
export interface KhataStyle {
  /** one short form a line: "আ = আম" */
  shorthand: string;
  /** anything else worth telling the AI about the page */
  notes: string;
}

export type OcrProvider = 'gemini' | 'claude';

export interface Settings {
  /** bumped when stored settings need a one-time fix-up (see merge) */
  version: number;
  /** language of the app, the WhatsApp messages and the ফর্দ */
  lang: Lang;
  /** main colour of the app */
  themeColor: string;
  /** the page colour behind the cards */
  bgTone: BgTone;
  shopName: string;
  /** the shop's own logo for the top of the ফর্দ, as a data URL ('' = none) */
  logo: string;
  ownerName: string;
  shopPhone: string;
  shopAddress: string;
  upiId: string;
  /** prepended to 10-digit phone numbers for WhatsApp links */
  countryCode: string;
  /** write numbers as ০১২৩ (Bengali) or ०१२३ (Hindi) in messages and ফর্দ */
  bengaliDigits: boolean;
  templates: Templates;
  bill: BillStyle;
  /** the shop's own short forms and khata layout, told to the AI before it reads */
  khataStyle: KhataStyle;
  /** fruit tiles the shop took off the ফর্দ page because it doesn't sell them */
  hiddenItems: string[];
  /** which AI reads khata photos */
  provider: OcrProvider;
  /** Claude (Anthropic) key and model */
  apiKey: string;
  model: string;
  geminiApiKey: string;
  geminiModel: string;
}

export type ModelNote = keyof Dict['settings']['modelNotes'];

export interface ModelInfo {
  id: string;
  name: string;
  note?: ModelNote;
}

export const MODELS: ModelInfo[] = [
  { id: 'claude-opus-5', name: 'Claude Opus 5', note: 'best' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', note: 'cheap' },
];

export const GEMINI_MODELS: ModelInfo[] = [
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', note: 'googlePick' },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', note: 'newest' },
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', note: 'fastest' },
];

const RETIRED_GEMINI = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'];

/** Short display name for a model id, e.g. "Gemini 3.5 Flash". */
export const modelName = (id: string) => [...MODELS, ...GEMINI_MODELS].find((m) => m.id === id)?.name ?? id;

export const activeKey = (s: Settings) => (s.provider === 'gemini' ? s.geminiApiKey : s.apiKey);
export const activeModel = (s: Settings) => (s.provider === 'gemini' ? s.geminiModel : s.model);

/**
 * Which model reads a page. On the owner's server key it is always a Gemini model; a second,
 * careful look uses another one.
 */
export function scanModel(s: Settings, server: boolean, careful: boolean): string {
  if (!server) return careful ? otherModel(s) : activeModel(s);
  if (!careful) return s.geminiModel;
  return GEMINI_MODELS.find((m) => m.id !== s.geminiModel)?.id ?? s.geminiModel;
}

/** A second opinion for a page that was read badly: the other model in the same family. */
export function otherModel(s: Settings): string {
  const list = (s.provider === 'gemini' ? GEMINI_MODELS : MODELS).map((m) => m.id);
  const now = activeModel(s);
  return list.find((id) => id !== now) ?? now;
}

/** Colours offered for the app. White text must stay readable on each one. */
export const THEME_COLORS = ['#5e35b1', '#0f766e', '#c2410c', '#be123c', '#2248c5', '#15803d', '#334155'];

export const DEFAULT_THEME = THEME_COLORS[0];

/** navy was the default before the app colour became a setting */
const OLD_DEFAULT_ACCENT = '#2248c5';

const SETTINGS_VERSION = 2;

const bn = tr('bn').defaults;

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  lang: 'bn',
  themeColor: DEFAULT_THEME,
  bgTone: 'pearl',
  shopName: bn.shopName,
  logo: '',
  ownerName: '',
  shopPhone: '',
  shopAddress: '',
  upiId: '',
  countryCode: '91',
  bengaliDigits: false,
  templates: bn.templates,
  bill: {
    title: bn.billTitle,
    accent: DEFAULT_THEME,
    design: 'tally',
    showPrevDue: true,
    showShopContact: true,
    showUpi: true,
    credit: true,
    footer: bn.billFooter,
  },
  khataStyle: { shorthand: '', notes: '' },
  hiddenItems: [],
  provider: 'gemini',
  apiKey: '',
  model: 'claude-opus-5',
  geminiApiKey: '',
  geminiModel: 'gemini-3.6-flash',
};

function merge(stored: Partial<Settings> | undefined): Settings {
  const s: Settings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    templates: { ...DEFAULT_SETTINGS.templates, ...stored?.templates },
    bill: { ...DEFAULT_SETTINGS.bill, ...stored?.bill },
    khataStyle: { ...DEFAULT_SETTINGS.khataStyle, ...stored?.khataStyle },
  };
  if (!isLang(s.lang)) s.lang = DEFAULT_SETTINGS.lang;
  if (!BILL_DESIGNS.includes(s.bill.design)) s.bill.design = DEFAULT_SETTINGS.bill.design;
  if (!BG_TONES.includes(s.bgTone)) s.bgTone = DEFAULT_SETTINGS.bgTone;
  if (!Array.isArray(s.hiddenItems)) s.hiddenItems = [];
  // Google no longer offers these to new keys
  if (RETIRED_GEMINI.includes(s.geminiModel)) s.geminiModel = DEFAULT_SETTINGS.geminiModel;
  // The ফর্দ was navy only because that was the default; follow the new app colour instead.
  if (stored && (stored.version ?? 1) < 2 && s.bill.accent === OLD_DEFAULT_ACCENT) s.bill.accent = s.themeColor;
  s.version = SETTINGS_VERSION;
  return s;
}

const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/**
 * Switches the language. Texts the owner never changed (shop name, messages, ফর্দ title
 * and footer) move to the new language too; anything they wrote themselves is kept.
 */
export function withLanguage(s: Settings, lang: Lang): Settings {
  const all = LANGS.map((l) => tr(l.id).defaults);
  const next = tr(lang).defaults;
  type Defaults = typeof next;
  const swap = (value: string, pick: (d: Defaults) => string) =>
    all.some((d) => sameText(value, pick(d))) ? pick(next) : value;
  return {
    ...s,
    lang,
    shopName: s.shopName,
    templates: {
      sale: swap(s.templates.sale, (d) => d.templates.sale),
      payment: swap(s.templates.payment, (d) => d.templates.payment),
      reminder: swap(s.templates.reminder, (d) => d.templates.reminder),
    },
    bill: {
      ...s.bill,
      title: swap(s.bill.title, (d) => d.billTitle),
      footer: swap(s.bill.footer, (d) => d.billFooter),
    },
  };
}

/** Each page colour, and how much of the app colour is mixed into it (styles.css does the same mix). */
export const BG_TONE_MIX: Record<BgTone, { base: string; tint: number }> = {
  pearl: { base: '#f6f6fb', tint: 0.07 },
  ivory: { base: '#f8f4ec', tint: 0.02 },
  frost: { base: '#eef2f8', tint: 0.03 },
  sage: { base: '#eef5f0', tint: 0.02 },
};

/** The page colour as a hex, for the phone's status bar. */
export function pageColor(tone: BgTone, primary: string): string {
  const { base, tint } = BG_TONE_MIX[tone] ?? BG_TONE_MIX.pearl;
  const rgb = (hex: string) => {
    const n = parseInt(/^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? '5e35b1', 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const a = rgb(primary);
  const b = rgb(base);
  return `#${a.map((v, i) => Math.round(v * tint + b[i] * (1 - tint)).toString(16).padStart(2, '0')).join('')}`;
}

/** What a ফর্দ may use: without a plan the shop's logo and the plan-only designs are left off. */
export function forBill(s: Settings, premium: boolean): Settings {
  if (premium) return s;
  return { ...s, logo: '', bill: { ...s.bill, design: isFreeDesign(s.bill.design) ? s.bill.design : 'tally' } };
}

/** What app theme may use: without a plan, custom themes and background tones are locked to defaults. */
export function forTheme(s: Settings, premium: boolean): { themeColor: string; bgTone: BgTone } {
  if (premium) return { themeColor: s.themeColor, bgTone: s.bgTone };
  return { themeColor: DEFAULT_THEME, bgTone: DEFAULT_TONE };
}

/** What a WhatsApp message may use: the shop's own wording comes with a plan; without one, the app's. */
export function forMessages(s: Settings, premium: boolean): Settings {
  return premium ? s : { ...s, templates: tr(s.lang).defaults.templates };
}

/** Changes the app colour; a ফর্দ that matched the old colour follows along. */
export function withTheme(s: Settings, color: string): Settings {
  const follow = s.bill.accent.toLowerCase() === s.themeColor.toLowerCase();
  return { ...s, themeColor: color, bill: follow ? { ...s.bill, accent: color } : s.bill };
}

export async function getSettings(): Promise<Settings> {
  const row = await db.kv.get('settings');
  return merge(row?.value as Partial<Settings> | undefined);
}

/** API keys stay on the phone they were typed on; everything else follows the shop to every phone. */
export type SharedSettings = Omit<Settings, 'apiKey' | 'geminiApiKey'>;
export const withoutKeys = ({ apiKey: _claude, geminiApiKey: _gemini, ...rest }: Settings): SharedSettings => rest;

export interface SettingsSync {
  updatedAt: number;
  /** 1 = changed on this phone since the cloud last had it */
  dirty: 0 | 1;
}

/** 'cloud' is for settings that just came down from another phone, so they aren't sent back up. */
export async function saveSettings(s: Settings, from: 'phone' | 'cloud' = 'phone') {
  await db.transaction('rw', db.kv, async () => {
    await db.kv.put({ key: 'settings', value: s });
    if (from === 'phone') await db.kv.put({ key: 'settingsSync', value: { updatedAt: Date.now(), dirty: 1 } satisfies SettingsSync });
  });
}

/**
 * Changes a few settings, starting from what is saved at this moment rather than from a copy a
 * screen read earlier, which could put back something another phone has changed since.
 */
export async function patchSettings(change: (s: Settings) => Partial<Settings>) {
  await db.transaction('rw', db.kv, async () => {
    const s = await getSettings();
    await saveSettings({ ...s, ...change(s) });
  });
}

/**
 * Settings from the cloud. The API keys and the language stay this phone's own; texts still at
 * their defaults follow this phone's language.
 */
export async function applyCloudSettings(data: Partial<SharedSettings>, updatedAt: number) {
  const current = await getSettings();
  const { apiKey, geminiApiKey, lang } = current;
  const merged = merge(data);
  // Protect existing local shop name: if cloud data doesn't specify a shopName or it's blank,
  // do not overwrite the shop's name with DEFAULT_SETTINGS.shopName
  if (!data.shopName?.trim() && current.shopName?.trim()) {
    merged.shopName = current.shopName;
  }
  await db.transaction('rw', db.kv, async () => {
    await saveSettings(withLanguage({ ...merged, apiKey, geminiApiKey }, lang), 'cloud');
    await db.kv.put({ key: 'settingsSync', value: { updatedAt, dirty: 0 } satisfies SettingsSync });
  });
}

/** undefined while loading */
export function useSettings(): Settings | undefined {
  return useLiveQuery(getSettings);
}

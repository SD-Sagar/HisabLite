import { createContext, useContext } from 'react';
import bn, { type Dict } from './bn';
import en from './en';
import hi from './hi';

export type { Dict };
export type Lang = 'bn' | 'hi' | 'en';

/** Each language is named in its own script, so it can be found from any other one. */
export const LANGS: { id: Lang; name: string; letters: string }[] = [
  { id: 'bn', name: 'বাংলা', letters: 'অ আ ক খ' },
  { id: 'hi', name: 'हिंदी', letters: 'अ आ क ख' },
  { id: 'en', name: 'English', letters: 'A B C D' },
];

const DICTS: Record<Lang, Dict> = { bn, hi, en };

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && v in DICTS;

// Code outside React (ফর্দ drawing, dates, OCR errors) reads the language from here.
// App sets it from the saved settings before anything below it renders.
let current: Lang = 'bn';

export const setLang = (lang: Lang) => {
  current = lang;
};

export const getLang = () => current;

export const tr = (lang: Lang = current): Dict => DICTS[lang] ?? bn;

export const LangContext = createContext<Lang>('bn');

export const useLang = () => useContext(LangContext);

/** The strings for the current language; re-renders the component when it changes. */
export const useT = () => tr(useContext(LangContext));

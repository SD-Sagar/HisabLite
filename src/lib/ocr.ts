import type { OcrProvider } from '../settings';
import type { PeopleResult, ReadOptions, ReadOutcome, ScanResult } from './ocr-shared';

export { OcrError } from './ocr-shared';
export type { PeopleResult, ReadOutcome, ScanEntry, ScanPerson, ScanResult } from './ocr-shared';

// Each provider's SDK is large, so only the one in use is downloaded.

async function read(provider: OcrProvider, o: ReadOptions) {
  // the owner's key lives on the server, and it is a Gemini key
  if (o.server) {
    const conn = await (await import('./ai-server')).startServerScan();
    return (await import('./ocr-gemini')).readWithGemini({ ...o, conn });
  }
  if (provider === 'gemini') return (await import('./ocr-gemini')).readWithGemini(o);
  return (await import('./ocr-claude')).readWithClaude(o);
}

/** A day's page: every entry on it. */
export async function readLedgerPhoto(provider: OcrProvider, o: ReadOptions): Promise<ReadOutcome<ScanResult>> {
  // the mode decides the shape the model must answer in, so the cast holds
  return (await read(provider, { ...o, mode: 'entries' })) as ReadOutcome<ScanResult>;
}

/** An old book being moved in: only the people and what each one owes. */
export async function readKhataPeople(provider: OcrProvider, o: ReadOptions): Promise<ReadOutcome<PeopleResult>> {
  return (await read(provider, { ...o, mode: 'people' })) as ReadOutcome<PeopleResult>;
}

/** Checks the key with a tiny request. Returns the model that answered. */
export async function testConnection(provider: OcrProvider, apiKey: string, model: string): Promise<string> {
  if (provider === 'gemini') return (await import('./ocr-gemini')).testGemini(apiKey, model);
  return (await import('./ocr-claude')).testClaude(apiKey, model);
}

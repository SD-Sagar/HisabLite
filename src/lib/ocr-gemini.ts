import { ApiError, BlockedReason, FinishReason, GoogleGenAI, type Part } from '@google/genai';
import * as z from 'zod';
import { tr } from '../i18n';
import {
  OcrError, ocrText, PEOPLE_PROMPT, schemaFor, SYSTEM_PROMPT, userPrompt, type PeopleResult, type ReadMode,
  type ReadOptions, type ReadOutcome, type ScanResult, type ServerConn,
} from './ocr-shared';

/**
 * Gemini accepts only a subset of JSON Schema: drop `$schema` and turn
 * `type: ["number", "null"]` into an `anyOf`, which it does understand.
 */
function geminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(geminiSchema);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key !== '$schema') out[key] = geminiSchema(value);
  }
  if (Array.isArray(out.type)) {
    const { type, ...rest } = out;
    return { ...rest, anyOf: (type as string[]).map((t) => ({ type: t })) };
  }
  return out;
}

const SCHEMAS = new Map<ReadMode, unknown>();

/** Gemini is told the exact shape to answer in; built once per shape. */
function responseSchema(mode: ReadMode) {
  if (!SCHEMAS.has(mode)) SCHEMAS.set(mode, geminiSchema(z.toJSONSchema(schemaFor(mode))));
  return SCHEMAS.get(mode);
}

/**
 * Tried in order when the chosen model is busy, out of free quota, or not offered to this key.
 * Google retires models for new users without notice, so a 404 that names a replacement
 * ("use models/gemini-x") puts that model next in line as well.
 */
const FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];

// Either the key on this device, with requests going straight to Google, or the owner's key on the
// server: then requests go to the ai function, which adds the key (see ai-server.ts).
// One retry after ~2s for 408/429/5xx; after that we move on to another model.
const client = (apiKey: string, conn?: ServerConn) =>
  new GoogleGenAI({
    apiKey: conn ? 'on-the-server' : apiKey,
    httpOptions: {
      retryOptions: { attempts: 2, initialDelay: 2, maxDelay: 8 },
      ...(conn ? { baseUrl: conn.baseUrl, headers: conn.headers } : {}),
    },
  });

const isKeyError = (e: ApiError) => e.status === 401 || e.status === 403 || (e.status === 400 && /api key/i.test(e.message));

/** The app's own server said no (not Google), which no other model would change. */
function serverSaid(e: ApiError): string | null {
  const own = /EASYLEDGER_(\w+)/.exec(e.message)?.[1];
  if (own) return own;
  // the ai function hasn't been put on the server yet
  return /function was not found/i.test(e.message) ? 'NO_KEY' : null;
}

/** Busy, out of quota for this model, or model not offered — another model may still work. */
const worthTryingAnother = (e: unknown): e is ApiError =>
  e instanceof ApiError && !isKeyError(e) && !serverSaid(e) && (e.status >= 500 || e.status === 429 || e.status === 404);

/** The SDK puts Google's JSON error body in `message`; pull out the human-readable part. */
function googleMessage(e: ApiError) {
  try {
    const body = JSON.parse(e.message) as { error?: { message?: string } };
    return body.error?.message || e.message;
  } catch {
    return e.message;
  }
}

function friendlyError(e: unknown, server = false): never {
  if (e instanceof OcrError) throw e;
  if (e instanceof ApiError) {
    const own = serverSaid(e);
    if (own === 'NO_KEY') throw new OcrError(tr().scan.comingSoon);
    if (own === 'LOGIN') throw new OcrError(ocrText().serverLogin);
    if (own) throw new OcrError(ocrText().serverTicket);
    const detail = `\n(Google ${e.status}: ${googleMessage(e).slice(0, 200)})`;
    // on the server it is the owner's key Google turned down, nothing the shopkeeper can fix
    if (isKeyError(e)) throw new OcrError((server ? ocrText().ownerKey : ocrText().geminiKey) + detail);
    throw new OcrError(ocrText().requestProblem + detail);
  }
  if (e instanceof TypeError) throw new OcrError(ocrText().offline); // fetch failed
  throw e;
}

interface Failure {
  model: string;
  error: ApiError;
}

/** Every model failed: explain the most useful cause, and list what each model said. */
function allFailed(failures: Failure[]): never {
  const statuses = failures.map((f) => f.error.status);
  const trail = failures.map((f) => `${f.model.replace('gemini-', '')}: ${f.error.status}`).join(', ');
  const first = failures[0].error;
  const detail = `\n(Google — ${trail}. ${googleMessage(first).slice(0, 160)})`;
  if (statuses.some((s) => s >= 500)) throw new OcrError(ocrText().googleDown + detail);
  if (statuses.includes(429)) throw new OcrError(ocrText().quota + detail);
  throw new OcrError(ocrText().noModels + detail);
}

class AllModelsFailed extends Error {
  constructor(readonly failures: Failure[]) {
    super('all Gemini models failed');
  }
}

/** Runs `attempt` on the chosen model, falling through to others while Google says busy / gone / out of quota. */
async function acrossModels<T>(
  chosen: string,
  attempt: (model: string) => Promise<T>,
  server = false,
): Promise<{ value: T; model: string }> {
  const queue = [chosen, ...FALLBACK_MODELS.filter((m) => m !== chosen)];
  const failures: Failure[] = [];
  for (let i = 0; i < queue.length; i++) {
    const model = queue[i];
    try {
      return { value: await attempt(model), model };
    } catch (e) {
      if (!worthTryingAnother(e)) friendlyError(e, server);
      failures.push({ model, error: e });
      const suggested = /use models\/(gemini-[\w.-]+)/.exec(googleMessage(e))?.[1];
      if (suggested && !queue.includes(suggested)) queue.splice(i + 1, 0, suggested);
    }
  }
  throw new AllModelsFailed(failures);
}

/** The shop's own sample page first, then the khata pages in order, then what to do with them. */
function parts(o: ReadOptions): Part[] {
  const list: Part[] = [];
  if (o.sample) {
    list.push({ text: 'SAMPLE — an older page from this same shop, here only so you can learn this handwriting:' });
    list.push({ inlineData: { mimeType: 'image/jpeg', data: o.sample.base64 } });
    list.push({ text: `The shopkeeper checked that sample. It says:
${o.sample.text}` });
  }
  o.images.forEach((img, i) => {
    list.push({ text: `Page ${i + 1}:` });
    list.push({ inlineData: { mimeType: img.mediaType, data: img.base64 } });
  });
  list.push({ text: userPrompt(o) });
  return list;
}

async function readOnce(ai: GoogleGenAI, o: ReadOptions, model: string, withSchema: boolean) {
  const mode = o.mode ?? 'entries';
  const schema = responseSchema(mode);
  const system = mode === 'people' ? PEOPLE_PROMPT : SYSTEM_PROMPT;
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: parts(o) }],
    config: {
      systemInstruction: withSchema
        ? system
        : `${system}\n\nReply with only a JSON object that matches this JSON Schema:\n${JSON.stringify(schema)}`,
      responseMimeType: 'application/json',
      ...(withSchema ? { responseJsonSchema: schema } : {}),
    },
  });

  const blocked = response.promptFeedback?.blockReason;
  if (blocked && blocked !== BlockedReason.BLOCKED_REASON_UNSPECIFIED) throw new OcrError(ocrText().blocked);
  const finish = response.candidates?.[0]?.finishReason;
  if (finish === FinishReason.MAX_TOKENS) throw new OcrError(ocrText().tooLong);
  if (finish === FinishReason.SAFETY || finish === FinishReason.PROHIBITED_CONTENT) throw new OcrError(ocrText().blocked);

  let json: unknown;
  try {
    json = JSON.parse(response.text ?? 'null');
  } catch {
    throw new OcrError(ocrText().emptyPage);
  }
  const parsed = schemaFor(mode).safeParse(json);
  if (!parsed.success) throw new OcrError(ocrText().emptyPage);
  return parsed.data as ScanResult | PeopleResult;
}

export async function readWithGemini(o: ReadOptions): Promise<ReadOutcome> {
  const ai = client(o.apiKey, o.conn);
  const server = !!o.conn;
  try {
    const { value, model } = await acrossModels(o.model, (m) => readOnce(ai, o, m, true), server);
    return { result: value, model };
  } catch (e) {
    if (!(e instanceof AllModelsFailed)) throw e;
    // A 500 from every model can mean Gemini is choking on the response schema itself;
    // one last try that asks for the same JSON in plain words instead.
    const internal = e.failures.find((f) => f.error.status === 500);
    if (internal && e.failures.every((f) => f.error.status === 500 || f.error.status === 404)) {
      try {
        return { result: await readOnce(ai, o, internal.model, false), model: internal.model };
      } catch (last) {
        if (!(last instanceof ApiError)) friendlyError(last, server);
      }
    }
    allFailed(e.failures);
  }
}

/** Cheap call used by the key test button in সেটিংস. Returns the model that answered. */
export async function testGemini(apiKey: string, model: string): Promise<string> {
  const ai = client(apiKey);
  try {
    return (await acrossModels(model, (m) => ai.models.generateContent({ model: m, contents: 'Reply with OK.' }))).model;
  } catch (e) {
    if (e instanceof AllModelsFailed) allFailed(e.failures);
    throw e;
  }
}

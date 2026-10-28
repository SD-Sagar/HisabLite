import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import {
  OcrError, ocrText, PEOPLE_PROMPT, schemaFor, SYSTEM_PROMPT, userPrompt, type ReadOptions, type ReadOutcome,
} from './ocr-shared';

// The key lives only on this device and requests go straight to Anthropic.
const client = (apiKey: string) => new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

function friendlyError(e: unknown): never {
  if (e instanceof OcrError) throw e;
  const t = ocrText();
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    throw new OcrError(t.claudeKey);
  }
  if (e instanceof Anthropic.RateLimitError) throw new OcrError(t.rateLimit);
  if (e instanceof Anthropic.BadRequestError) throw new OcrError(t.badRequest(e.message));
  if (e instanceof Anthropic.APIConnectionError) throw new OcrError(t.offline);
  if (e instanceof Anthropic.APIError) throw new OcrError(t.server(String(e.status ?? '?')));
  throw e;
}

/** The shop's own sample page first, then the khata pages in order, then what to do with them. */
function blocks(o: ReadOptions): Anthropic.Beta.BetaContentBlockParam[] {
  const list: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (o.sample) {
    list.push({ type: 'text', text: 'SAMPLE — an older page from this same shop, here only so you can learn this handwriting:' });
    list.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: o.sample.base64 } });
    list.push({ type: 'text', text: `The shopkeeper checked that sample. It says:
${o.sample.text}` });
  }
  o.images.forEach((img, i) => {
    list.push({ type: 'text', text: `Page ${i + 1}:` });
    list.push(
      img.mediaType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: img.base64 } }
        : { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } },
    );
  });
  list.push({ type: 'text', text: userPrompt(o) });
  return list;
}

export async function readWithClaude(o: ReadOptions): Promise<ReadOutcome> {
  // Server-side fallback re-runs a declined request on another model; documented for Opus 5.
  const fallback =
    o.model === 'claude-opus-5'
      ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
      : {};

  try {
    const response = await client(o.apiKey).beta.messages.parse({
      model: o.model,
      max_tokens: 16000,
      ...fallback,
      system: o.mode === 'people' ? PEOPLE_PROMPT : SYSTEM_PROMPT,
      messages: [{ role: 'user', content: blocks(o) }],
      output_config: { format: betaZodOutputFormat(schemaFor(o.mode)) },
    });

    if (response.stop_reason === 'refusal') throw new OcrError(ocrText().blocked);
    if (response.stop_reason === 'max_tokens') throw new OcrError(ocrText().tooLong);
    if (!response.parsed_output) throw new OcrError(ocrText().emptyPage);
    return { result: response.parsed_output, model: o.model };
  } catch (e) {
    friendlyError(e);
  }
}

/** Cheap call used by the key test button in সেটিংস. Returns the model that answered. */
export async function testClaude(apiKey: string, model: string): Promise<string> {
  try {
    await client(apiKey).messages.create({ model, max_tokens: 64, messages: [{ role: 'user', content: 'Reply with OK.' }] });
    return model;
  } catch (e) {
    friendlyError(e);
  }
}

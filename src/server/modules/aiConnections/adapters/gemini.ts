/**
 * Google Gemini adapter (S19a, D-179): `POST {base}/v1beta/models/{model}:streamGenerateContent?alt=sse`
 * with `x-goog-api-key`. Tools become one `functionDeclarations` list; their JSON Schemas are reduced
 * to the OpenAPI subset Gemini accepts (`geminiSchema`). The assistant is role `model`; tool results
 * are `functionResponse` parts in a user turn. Function calls may carry a `thoughtSignature`, which is
 * kept on the call (`signature`) and sent back with it, as the API requires for multi-step tool use.
 * A call's `id` is sent back (as `functionCall.id` and `functionResponse.id`) only when Gemini gave
 * one; an id the adapter made up (`generatedId`) stays on our side.
 */
import { AiCallError, aiRequest, failureOfStatus, readText, sseEvents, type AiHttpResponse } from '../http.ts';
import { toolCall, type Adapter, type ChatMessage, type StopReason, type ToolDefinition } from './types.ts';

const KEEP = new Set(['type', 'format', 'description', 'nullable', 'enum', 'properties', 'required', 'items', 'minItems', 'maxItems', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'anyOf', 'title']);

/** A JSON Schema reduced to Gemini's OpenAPI subset: union types and `null` become `nullable`, `const` an enum, unknown keywords dropped. */
export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const s = { ...(schema as Record<string, unknown>) };
  if ('const' in s && !('enum' in s)) s.enum = [s.const];
  if (Array.isArray(s.type)) {
    const types = (s.type as string[]).filter((t) => t !== 'null');
    if (types.length < (s.type as string[]).length) s.nullable = true;
    s.type = types[0] ?? 'string';
  }
  if (Array.isArray(s.anyOf)) {
    const options = (s.anyOf as Array<Record<string, unknown>>).filter((o) => !(o && o.type === 'null'));
    if (options.length < (s.anyOf as unknown[]).length) s.nullable = true;
    if (options.length === 1) {
      delete s.anyOf;
      Object.assign(s, options[0]);
    } else s.anyOf = options;
  }
  if (Array.isArray(s.enum)) s.enum = (s.enum as unknown[]).filter((v) => v !== null).map(String);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (!KEEP.has(k)) continue;
    if (k === 'properties' && v && typeof v === 'object') out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, geminiSchema(pv)]));
    else if (k === 'items' || k === 'anyOf') out[k] = geminiSchema(v);
    else out[k] = v;
  }
  if (out.type === 'object' && !out.properties) out.properties = {};
  return out;
}

export const geminiTools = (tools: ToolDefinition[]) => [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t.inputSchema) })) }];

interface Content {
  role: 'user' | 'model';
  parts: Array<Record<string, unknown>>;
}

export function geminiContents(messages: ChatMessage[]): Content[] {
  const out: Content[] = [];
  const push = (role: Content['role'], parts: Content['parts']) => {
    if (!parts.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  };
  // Ids Gemini itself gave (made-up ones are never sent: Gemini would not know them).
  const providerIds = new Set(messages.flatMap((m) => (m.role === 'assistant' ? (m.toolCalls ?? []).filter((c) => !c.generatedId).map((c) => c.id) : [])));
  for (const m of messages) {
    if (m.role === 'user') push('user', [{ text: m.content }]);
    else if (m.role === 'assistant')
      push('model', [
        ...(m.content ? [{ text: m.content }] : []),
        ...(m.toolCalls ?? []).map((c) => ({ functionCall: { ...(c.generatedId ? {} : { id: c.id }), name: c.name, args: c.arguments }, ...(c.signature ? { thoughtSignature: c.signature } : {}) })),
      ]);
    else
      push('user', [{ functionResponse: { ...(providerIds.has(m.toolCallId) ? { id: m.toolCallId } : {}), name: m.name, response: m.isError ? { error: m.content } : { content: m.content } } }]);
  }
  return out;
}

/**
 * The failure of a non-2xx answer. Gemini answers a wrong key with 400 and the reason
 * `API_KEY_INVALID` in the error's details, so a 400 body (small, capped) is read for that reason
 * only; nothing of its text is passed on.
 */
export async function geminiFailure(res: AiHttpResponse): Promise<AiCallError> {
  if (res.status !== 400) {
    res.cancel();
    return new AiCallError(failureOfStatus(res.status), res.status);
  }
  try {
    const d: any = JSON.parse(await readText(res, 64 * 1024));
    const details: any[] = (Array.isArray(d) ? d[0] : d)?.error?.details ?? [];
    if (Array.isArray(details) && details.some((x) => x?.reason === 'API_KEY_INVALID')) return new AiCallError('KEY_REJECTED', 400);
  } catch {
    res.cancel();
  }
  return new AiCallError(failureOfStatus(400), 400);
}

const STOP: Record<string, StopReason> = { STOP: 'end', MAX_TOKENS: 'length' };

export const geminiAdapter: Adapter = async function* (req) {
  const model = req.model.replace(/^models\//u, '');
  const body = {
    ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
    contents: geminiContents(req.messages),
    ...(req.tools.length ? { tools: geminiTools(req.tools) } : {}),
    generationConfig: { maxOutputTokens: req.maxTokens },
  };
  const res = await aiRequest({
    url: `${req.target.baseUrl}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...(req.target.secret ? { 'x-goog-api-key': req.target.secret } : {}) },
    body: JSON.stringify(body),
    policy: req.target.policy,
    signal: req.signal,
  });
  if (res.status < 200 || res.status >= 300) throw await geminiFailure(res);
  let input = 0;
  let output = 0;
  let stop: StopReason = 'other';
  let calls = 0;
  let any = false;
  for await (const ev of sseEvents(res.body)) {
    let d: any;
    try {
      d = JSON.parse(ev.data);
    } catch {
      throw new AiCallError('BAD_RESPONSE');
    }
    if (d?.error) {
      res.cancel();
      throw new AiCallError(Number(d.error.code) === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR');
    }
    any = true;
    if (d?.usageMetadata) {
      input = Number(d.usageMetadata.promptTokenCount) || input;
      output = (Number(d.usageMetadata.candidatesTokenCount) || 0) + (Number(d.usageMetadata.thoughtsTokenCount) || 0) || output;
    }
    const cand = d?.candidates?.[0];
    for (const part of Array.isArray(cand?.content?.parts) ? cand.content.parts : []) {
      if (part?.functionCall) {
        calls += 1;
        yield { type: 'toolCall', call: toolCall(part.functionCall.id ? String(part.functionCall.id) : null, String(part.functionCall.name ?? ''), part.functionCall.args ?? {}, typeof part.thoughtSignature === 'string' ? part.thoughtSignature : undefined) };
      } else if (typeof part?.text === 'string' && part.text && part.thought !== true) yield { type: 'text', text: part.text };
    }
    if (cand?.finishReason) stop = STOP[String(cand.finishReason)] ?? 'other';
    if (d?.promptFeedback?.blockReason) stop = 'other';
  }
  if (!any) throw new AiCallError('BAD_RESPONSE');
  yield { type: 'usage', inputTokens: input, outputTokens: output };
  yield { type: 'done', stop: stop === 'length' ? 'length' : calls ? 'toolUse' : stop };
};

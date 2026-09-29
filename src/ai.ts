import { answerRejection, responseRejection, type RejectionReason } from './provider-response';

/** Server-only OpenAI-compatible transport. Never accepts endpoint/key from a user prompt. */
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type AIConfig = { baseURL: string; apiKey: string; model: string; protocol?: "chat" | "responses"; sessionId?: string; maxOutputTokens?: number };
export type Completion = { text: string; inputTokens: number; outputTokens: number };

export class ProviderError extends Error {
  readonly kind: "configuration" | "unavailable" | "invalid_response" | "rejected" | "output_limit";
  constructor(kind: "configuration" | "unavailable" | "invalid_response" | "rejected" | "output_limit", readonly reason?: RejectionReason | "timeout" | "invalid_header" | "redirect_mode" | "fetch_receiver" | "transport_type_error") {
    super(`AI provider ${kind}`);
    this.kind = kind;
  }
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function tokenCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 0) throw new ProviderError("invalid_response");
  return value;
}
async function readJSON(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError("invalid_response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 262144) { await reader.cancel(); throw new ProviderError("invalid_response"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ProviderError("invalid_response"); }
}

export async function complete(config: AIConfig, messages: ChatMessage[], transport: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<Completion> {
  let url: URL;
  try { url = new URL(config.baseURL.replace(/\/$/, "") + (config.protocol === "responses" ? "/responses" : "/chat/completions")); }
  catch { throw new ProviderError("configuration"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !config.apiKey || !config.model)
    throw new ProviderError("configuration");
  if (!messages.length || messages.length > 50 || messages.some(message => message.content.length > 16000)) throw new ProviderError("configuration");
  const outputLimit = config.maxOutputTokens ?? 2048;
  if (!Number.isSafeInteger(outputLimit) || outputLimit < 64 || outputLimit > 4096) throw new ProviderError("configuration");
  const payload = config.protocol === "responses"
    ? { model: config.model, input: messages, max_output_tokens: outputLimit, store: false, stream: false }
    : { model: config.model, messages, max_tokens: outputLimit, stream: false };
  let result: Record<string, unknown>;
  try {
    const response = await transport(url, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(60000),
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json", "user-agent": "TellUmo/0.3 (website-building-agent)", ...(url.hostname === "opencode.ai" && config.sessionId ? { "x-opencode-session": config.sessionId } : {}) },
      body: JSON.stringify(payload)
    });
    if (!response.ok) { await response.body?.cancel(); throw new ProviderError(response.status >= 400 && response.status < 500 ? "rejected" : "unavailable"); }
    result = object(await readJSON(response));
  } catch (cause) {
    if (cause instanceof ProviderError) throw cause;
    // Never propagate upstream bodies, URLs, or credentials to logs or clients.
    const message = cause instanceof Error ? cause.message : '';
    const reason = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError') ? 'timeout'
      : /header/i.test(message) ? 'invalid_header'
      : /redirect/i.test(message) ? 'redirect_mode'
      : /Illegal invocation|incorrect this/i.test(message) ? 'fetch_receiver'
      : cause instanceof TypeError ? 'transport_type_error' : undefined;
    throw new ProviderError("unavailable", reason);
  }
  const rejection = responseRejection(result, config.model, config.protocol ?? "chat");
  if (rejection) throw new ProviderError("invalid_response", rejection);
  const usage = object(result.usage);
  let text: unknown;
  if (config.protocol === "responses") {
    if (result.status === "incomplete" && object(result.incomplete_details).reason === "max_output_tokens") throw new ProviderError("output_limit");
    if (result.status !== "completed" || !Array.isArray(result.output)) throw new ProviderError("invalid_response");
    text = result.output.flatMap(item => {
      const output = object(item);
      if (output.type !== "message" || !Array.isArray(output.content)) return [];
      return output.content.map(part => object(part)).filter(part => part.type === "output_text").map(part => part.text);
    }).filter(value => typeof value === "string").join("\n");
  } else {
    const choice = object(Array.isArray(result.choices) ? result.choices[0] : null);
    if (choice.finish_reason === "length") throw new ProviderError("output_limit");
    if (choice.finish_reason !== "stop") throw new ProviderError("invalid_response");
    text = object(choice.message).content;
  }
  if (typeof text !== "string" || !text.trim() || text.length > 32000) throw new ProviderError("invalid_response");
  const answerError = answerRejection(text, config.apiKey);
  if (answerError) throw new ProviderError("invalid_response", answerError);
  return { text, inputTokens: tokenCount(usage.prompt_tokens ?? usage.input_tokens), outputTokens: tokenCount(usage.completion_tokens ?? usage.output_tokens) };
}

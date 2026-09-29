/** Adapted from Jarvis modelgateway/go.go, local.go and rejection.go.
 * Source commit and port boundaries: docs/jarvis-reuse.md.
 * This text-only boundary never interprets model output as tool authority.
 */
export const rejectionReasons = ['envelope_invalid', 'model_identity', 'message_invalid', 'tool_content', 'credential_echo', 'content_limit', 'usage_invalid'] as const;
export type RejectionReason = typeof rejectionReasons[number];

export function responseRejection(result: Record<string, unknown>, model: string, protocol: 'chat' | 'responses'): RejectionReason | undefined {
  // Compatible gateways sometimes omit model; an explicitly different identity is rejected.
  if (result.model !== undefined && result.model !== model) return 'model_identity';
  if (protocol === 'responses') {
    if (!Array.isArray(result.output)) return 'envelope_invalid';
    for (const item of result.output) {
      if (!item || typeof item !== 'object') return 'message_invalid';
      if (item.type === 'reasoning') continue; // Never shown as an answer.
      if (item.type !== 'message') return 'tool_content';
      if (item.role !== undefined && item.role !== 'assistant') return 'message_invalid';
      if (!Array.isArray(item.content) || item.content.some((part: unknown) => !part || typeof part !== 'object' || !('type' in part) || part.type !== 'output_text' || !('text' in part) || typeof part.text !== 'string')) return 'message_invalid';
    }
  } else {
    if (!Array.isArray(result.choices) || result.choices.length !== 1) return 'envelope_invalid';
    const message = result.choices[0]?.message;
    if (!message || (message.role !== undefined && message.role !== 'assistant')) return 'message_invalid';
    if ((message.tool_calls != null && (!Array.isArray(message.tool_calls) || message.tool_calls.length)) || message.function_call != null) return 'tool_content';
  }
}

export function answerRejection(text: string, key: string): RejectionReason | undefined {
  // A defective gateway can echo its Authorization value. Never persist that answer.
  if (text.includes(key)) return 'credential_echo';
  if (new TextEncoder().encode(text).length > 32000) return 'content_limit';
}

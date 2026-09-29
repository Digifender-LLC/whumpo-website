export type ChatRequest = {id: string; revision: number; content: string};
type Transcript = {turns: {id: string; user_text: string}[]};

/** Definitive validation/auth failures should be shown immediately. */
export function canRecoverChat(error: unknown): boolean {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? error.status : undefined;
  return typeof status !== 'number' || status >= 500 || status === 408;
}

/** Recover a committed message through a read, never a second model request. */
export async function submitChat<T extends Transcript>(
  request: ChatRequest,
  post: (request: ChatRequest) => Promise<T>,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await post(request);
  } catch (error) {
    if (!canRecoverChat(error)) throw error;
    try {
      const transcript = await read();
      if (transcript.turns.some(turn => turn.id === request.id && turn.user_text === request.content)) {
        return transcript;
      }
    } catch { /* Keep the original request available for an explicit same-ID retry. */ }
    throw error;
  }
}

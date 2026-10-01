import {chatControl,type ChatControl} from '../../../src/chat-controls';
export type ChatRequest = {id: string; revision: number; content: string; action?:ChatControl};
type SavedRequest={id:string;user_text:string;action_json:string|null;revision:number};
type Transcript = {turns: SavedRequest[]};
export function matchesChatRequest(turn:SavedRequest,request:ChatRequest){
 const control=request.action?chatControl(request.action):null;
 if(request.action&&!control)return false;
 return turn.id===request.id&&turn.revision===request.revision+1&&turn.user_text===request.content&&turn.action_json===(control?JSON.stringify(control.action):null);
}

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
      if (transcript.turns.some(turn => matchesChatRequest(turn,request))) {
        return transcript;
      }
    } catch { /* Keep the original request available for an explicit same-ID retry. */ }
    throw error;
  }
}

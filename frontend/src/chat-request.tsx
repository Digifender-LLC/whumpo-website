import {displayChatRequest} from '../../src/first-draft-command';
// Human messages are literal; internal review receipts use plain-language labels.
export function ChatRequest({text,literal=false}:{text:string;literal?:boolean}){
 return <>{literal?text:displayChatRequest(text)}</>;
}

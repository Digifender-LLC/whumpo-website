import {displayChatRequest} from '../../src/first-draft-command';

// Saved request bytes remain available for support and exact recovery. This
// component only displays text; it never sends, retries or approves a request.
export function ChatRequest({text}:{text:string}){
 const label=displayChatRequest(text);
 if(label===text)return <>{text}</>;
 return <><p>{label}</p><details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer min-h-11 flex items-center underline underline-offset-4">Request details</summary><pre className="whitespace-pre-wrap break-all font-mono">{text}</pre></details></>;
}

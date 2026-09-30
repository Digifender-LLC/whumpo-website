import {conversationalReply} from '../../src/chat-language';
import {Fragment} from 'react';
// Only a complete, fixed internal navigation line becomes a link. This does not
// interpret Markdown/HTML or turn model text into an action or confirmation.
const publishingPath=/^(\/workspace\/cms\?project=[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/gm;
export function ChatReply({text}:{text:string}){
 return <>{conversationalReply(text).split(publishingPath).map((part,index)=>index%2===1?<a key={index} href={part} className="inline-flex min-h-11 items-center font-medium underline underline-offset-4">Open publishing desk</a>:<Fragment key={index}>{part}</Fragment>)}</>;
}

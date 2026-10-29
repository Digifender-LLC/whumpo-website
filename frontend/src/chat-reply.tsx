import {Fragment} from 'react';
// Only a complete, fixed internal navigation line becomes a link. This does not
// interpret Markdown/HTML or turn model text into an action or confirmation.
const publishingPath=/^(\/workspace\/cms\?project=[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/gm;
// Long URLs and IDs are set in mono and cut off visually only. The full value stays in the
// text, so selecting it (one click selects all) and copying always yields the whole value.
const longValue=/(https?:\/\/[^\s<>"')]*[^\s<>"').,;:!?]|\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b)/;
function Plain({text}:{text:string}){
 return <>{text.split(longValue).map((part,index)=>index%2===1?<code key={index} title={part} className="inline-block max-w-full select-all truncate align-bottom font-mono text-body-sm">{part}</code>:<Fragment key={index}>{part}</Fragment>)}</>;
}
export function ChatReply({text}:{text:string}){
 return <>{text.split(publishingPath).map((part,index)=>index%2===1?<a key={index} href={part} className="inline-flex min-h-11 items-center font-medium underline underline-offset-4">Open publishing desk</a>:<Plain key={index} text={part}/>)}</>;
}

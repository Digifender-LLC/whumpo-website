import type {Answer,Answers,Field} from '../../src/chat-interactions/types';
import {isFieldVisible} from '../../src/chat-interactions/protocol';
import {ChatInteractionField} from './chat-interaction-field';

/** Omitted fields have no controls or resource readers mounted. Their local
 * draft values remain owned by the parent editor until save/submit/discard. */
export function ChatInteractionFields({fields,answers,owner,interactionId,digest,locked,fieldError,onChange,onResourceReady}:{
 fields:Field[];answers:Answers;owner:string;interactionId:string;digest:string;locked:boolean;fieldError:string|null;
 onChange:(id:string,value:Answer|undefined)=>void;onResourceReady:(fieldId:string,ready:boolean)=>void;
}){
 return fields.filter(field=>isFieldVisible(field,answers)).map(field=><div key={field.id} data-interaction-field={field.id}>
  <ChatInteractionField field={field} owner={owner} interactionId={interactionId} digest={digest} value={answers[field.id]} locked={locked} invalid={fieldError===field.id} onChange={value=>onChange(field.id,value)} onResourceReady={onResourceReady}/>
 </div>);
}

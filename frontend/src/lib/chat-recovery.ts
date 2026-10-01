import {chatControl} from '../../../src/chat-controls';
import type {ChatRequest} from './chat-delivery';
export const recoveryKey='whumpo.chat-recovery.v1';
export const draftLifetime=24*60*60*1000;
const maxText=16000,maxRecord=100000;
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type Recovery={draft:string;pending:ChatRequest|null;updatedAt:number};
const id=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).every(key=>keys.includes(key));
function request(value:unknown):ChatRequest|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 if(!exact(v,['id','revision','content','action'])||!id(v.id)||!Number.isSafeInteger(v.revision)||Number(v.revision)<0||typeof v.content!=='string'||!v.content.trim()||v.content.length>maxText||v.content!==v.content.trim())return null;
 if('action'in v){const control=chatControl(v.action);if(!control||control.command!==v.content)return null;return {id:v.id,revision:Number(v.revision),content:v.content,action:control.action};}
 return {id:v.id,revision:Number(v.revision),content:v.content};
}
export function readRecovery(store:Store,owner:string,now=Date.now()):Recovery|null{
 const raw=store.getItem(recoveryKey);if(!raw)return null;
 let result:Recovery,expired=false;
 try{
  if(!id(owner)||raw.length>maxRecord)throw Error('Invalid recovery');
  const v=JSON.parse(raw);
  if(!v||typeof v!=='object'||Array.isArray(v)||!exact(v,['version','owner','updatedAt','draft','pending'])||v.version!==1||v.owner!==owner||!Number.isSafeInteger(v.updatedAt)||v.updatedAt<0||typeof v.draft!=='string'||v.draft.length>maxText)throw Error('Invalid recovery');
  const pending=v.pending===null?null:request(v.pending);if(v.pending!==null&&!pending)throw Error('Invalid request');
  // Never forget an unresolved operation just because an unsent draft expired.
  const draft=now>=v.updatedAt&&now-v.updatedAt<draftLifetime?v.draft:'';
  result={draft,pending,updatedAt:v.updatedAt};expired=draft!==v.draft;
 }catch{store.removeItem(recoveryKey);return null;}
 if(!result.draft&&!result.pending){store.removeItem(recoveryKey);return null;}
 // Storage failures are distinct from invalid data; preserve unresolved identity.
 if(expired)writeRecovery(store,owner,result);
 return result;
}
export function writeRecovery(store:Store,owner:string,value:Recovery):void{
 if(!id(owner)||typeof value.draft!=='string'||value.draft.length>maxText||!Number.isSafeInteger(value.updatedAt)||value.updatedAt<0||value.pending!==null&&!request(value.pending))throw Error('Recovery is unavailable');
 if(!value.draft&&!value.pending){store.removeItem(recoveryKey);return;}
 const raw=JSON.stringify({version:1,owner,draft:value.draft,pending:value.pending,updatedAt:value.updatedAt});if(raw.length>maxRecord)throw Error('Recovery is too large');store.setItem(recoveryKey,raw);
}
export function clearChatRecovery(){try{sessionStorage.removeItem(recoveryKey);}catch{/* Storage may be unavailable in this browser. */}}

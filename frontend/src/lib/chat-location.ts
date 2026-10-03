/** A per-tab locator, never cached content or authority. The interaction reader
 * rechecks account, project, retention and admission every time it is opened. */
export const chatLocationKey='whumpo.chat-location';
export const chatLocationLifetime=7*24*60*60*1000;
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const interactionId=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value);
export function readChatLocation(store:Store,owner:string,now=Date.now()):string|null{
 const raw=store.getItem(chatLocationKey);if(!raw)return null;
 try{
  if(raw.length>350||!interactionId(owner))throw Error();
  const v=JSON.parse(raw);
  if(!v||Object.keys(v).sort().join(',')!=='interactionId,owner,updatedAt,version'||v.version!==1||v.owner!==owner||!interactionId(v.interactionId)||!Number.isSafeInteger(v.updatedAt)||v.updatedAt<0||now<v.updatedAt||now-v.updatedAt>=chatLocationLifetime)throw Error();
  return v.interactionId;
 }catch{store.removeItem(chatLocationKey);return null;}
}
export function saveChatLocation(store:Store,owner:string,id:string|null,now=Date.now()){
 if(!interactionId(owner)||id!==null&&!interactionId(id)||!Number.isSafeInteger(now)||now<0)throw Error('Saved Chat location is unavailable.');
 if(id===null){store.removeItem(chatLocationKey);return;}
 store.setItem(chatLocationKey,JSON.stringify({version:1,owner,interactionId:id,updatedAt:now}));
}
export function clearChatLocation(){try{sessionStorage.removeItem(chatLocationKey);}catch{/* Browser storage can be unavailable. */}}

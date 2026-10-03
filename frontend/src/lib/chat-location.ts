/** A per-tab locator, never cached content or authority. Current readers
 * recheck account, project, retention and admission when work is reopened. */
export const chatLocationKey='whumpo.chat-location';
export const chatLocationLifetime=7*24*60*60*1000;
export type ChatLocation={kind:'interaction'|'turn';id:string};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const chatLocationId=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value);
export function readChatLocation(store:Store,owner:string,now=Date.now()):ChatLocation|null{
 const raw=store.getItem(chatLocationKey);if(!raw)return null;
 try{
  if(raw.length>350||!chatLocationId(owner))throw Error();
  const v=JSON.parse(raw);
  if(!v||Object.keys(v).sort().join(',')!=='id,kind,owner,updatedAt,version'||v.version!==2||v.owner!==owner||!['interaction','turn'].includes(v.kind)||!chatLocationId(v.id)||!Number.isSafeInteger(v.updatedAt)||v.updatedAt<0||now<v.updatedAt||now-v.updatedAt>=chatLocationLifetime)throw Error();
  return {kind:v.kind,id:v.id};
 }catch{store.removeItem(chatLocationKey);return null;}
}
export function saveChatLocation(store:Store,owner:string,target:ChatLocation|null,now=Date.now()){
 if(!chatLocationId(owner)||target!==null&&(!['interaction','turn'].includes(target.kind)||!chatLocationId(target.id))||!Number.isSafeInteger(now)||now<0)throw Error('Saved Chat location is unavailable.');
 if(target===null){store.removeItem(chatLocationKey);return;}
 store.setItem(chatLocationKey,JSON.stringify({version:2,owner,kind:target.kind,id:target.id,updatedAt:now}));
}
export function clearChatLocation(){try{sessionStorage.removeItem(chatLocationKey);}catch{/* Browser storage can be unavailable. */}}

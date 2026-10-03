/** A signal to re-read server identity, never an identity or authorization record. */
const channelName='whumpo.identity';
const signal={version:1,type:'identity-changed'} as const;
let generation=0,channel:BroadcastChannel|null=null,subscribers=0;
export const identityGeneration=()=>generation;
export function fenceIdentityRequests(){generation++;}
export function announceIdentityChange(){
 // An HTTP reply can settle after its initiating route has unmounted.
 const sender=channel??new BroadcastChannel(channelName);sender.postMessage(signal);if(sender!==channel)sender.close();
}
export function invalidateIdentity(broadcast=false){
 fenceIdentityRequests();
 if(broadcast)announceIdentityChange();
 window.dispatchEvent(new Event('whumpo:identity-changed'));
}
export function observeIdentityChanges(){
 if(!channel){
  channel=new BroadcastChannel(channelName);
  channel.onmessage=({data})=>{
   if(data&&typeof data==='object'&&!Array.isArray(data)&&Object.keys(data).length===2&&data.version===1&&data.type==='identity-changed')invalidateIdentity();
  };
 }
 subscribers++;
 return ()=>{if(--subscribers===0){channel?.close();channel=null;}};
}

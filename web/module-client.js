/** whumpo-portal@1 consumes whumpo-modules@1. No auth, storage, principal or permission implementation. */
export function moduleClient({manifest,send}){
 if(manifest?.api!=='whumpo-portal'||manifest.version!==1)throw Error('Reload this portal to use the current version.');
 const request=(instanceId,operation,target=null,input=null,requestId=null)=>{
  const ref=manifest.instances[instanceId];if(!ref)throw Error('This component is unavailable.');
  return {api:'whumpo-modules',version:1,operation,resourceId:ref.resourceId,configRevision:ref.configRevision,requestId,target,input};
 };
 return {request,read:(id,op,target=null)=>send('modules',request(id,op,target))};
}
export async function inputDigest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');}

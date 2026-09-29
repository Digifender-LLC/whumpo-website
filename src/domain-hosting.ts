import {DomainError,hostname,verifyDNS} from './domains';
import {hashToken} from './security';
export type HostingConfig={token:string;zone:string;target:string};
// Activation also asserts the operator verified the fallback origin, route exclusions and included allowance.
export function hostingConfig(env:{CLOUDFLARE_DOMAINS_TOKEN?:string;DOMAIN_HOSTING_READY?:string}):HostingConfig|undefined{
 return env.DOMAIN_HOSTING_READY==='verified'&&env.CLOUDFLARE_DOMAINS_TOKEN?{token:env.CLOUDFLARE_DOMAINS_TOKEN,zone:'8d46ee4e394514402479acf16579f7b5',target:'hosting.whumpo.site'}:undefined;
}
type Connection={id:string;user_id:string;claim_id:string;project_id:string;hostname:string;zone_id:string;target:string;proof_hash:string;state:string;provider_id:string|null;provider_status:string;ssl_status:string;detail:string;created_at:string;expires_at:string;checked_at:string|null;serve_until:string|null};
const idPattern=/^[a-f0-9-]{36}$/;
function configured(config:HostingConfig|undefined){if(!config||!config.token||!/^[a-f0-9]{32}$/.test(config.zone)||config.target!=='hosting.whumpo.site')throw new DomainError(503,'Domain hosting is awaiting platform configuration.');return config;}
function view(c:Connection){return {id:c.id,claimId:c.claim_id,projectId:c.project_id,hostname:c.hostname,state:c.state==='review'&&c.expires_at<=new Date().toISOString()?'expired':c.state==='active'&&(!c.serve_until||c.serve_until<=new Date().toISOString())?'needs_check':c.state,connected:c.state==='active'&&!!c.serve_until&&c.serve_until>new Date().toISOString(),target:c.target,providerStatus:c.provider_status,certificateStatus:c.ssl_status,detail:c.detail,expiresAt:c.expires_at,checkedAt:c.checked_at};}
async function owned(db:D1Database,user:string,id:string){const c=await db.prepare('SELECT c.* FROM domain_connections c JOIN projects p ON p.id=c.project_id WHERE c.id=? AND c.user_id=? AND p.owner_user_id=?').bind(id,user,user).first<Connection>();if(!c)throw new DomainError(404,'Domain connection not found.');return c;}
export async function hostingConnections(db:D1Database,user:string){const {results}=await db.prepare('SELECT * FROM domain_connections WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(user).all<Connection>();return results.map(view);}
async function readJSON(response:Response){
 if(!response.ok||!response.body){await response.body?.cancel();throw new DomainError(503,'Cloudflare could not complete the hostname request.');}
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>131072)throw Error('size');chunks.push(value);}}catch{await reader.cancel();throw new DomainError(503,'Cloudflare returned an unreadable hostname response.');}
 const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
 try{const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value)||value.success!==true||!('result' in value))throw Error('shape');return value as {result:unknown;result_info?:{total_count?:number}};}catch{throw new DomainError(503,'Cloudflare returned an invalid hostname response.');}
}
async function request(config:HostingConfig,path:string,method='GET',body?:unknown,transport:typeof fetch=fetch){
 try{return await transport('https://api.cloudflare.com/client/v4/zones/'+config.zone+'/custom_hostnames'+path,{method,headers:{authorization:'Bearer '+config.token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(10000)});}catch{throw new DomainError(503,'Cloudflare hostname request outcome could not be confirmed.');}
}
function providerRecord(raw:unknown,name:string,id?:string){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new DomainError(503,'Invalid hostname identity from Cloudflare.');const r=raw as Record<string,unknown>,ssl=r.ssl as Record<string,unknown>|undefined;
 if(typeof r.id!=='string'||!idPattern.test(r.id)||r.hostname!==name||id&&r.id!==id||(r.status!==undefined&&(typeof r.status!=='string'||r.status.length>80))||(ssl?.status!==undefined&&(typeof ssl.status!=='string'||ssl.status.length>80)))throw new DomainError(503,'Invalid hostname identity from Cloudflare.');
 return {id:r.id,status:typeof r.status==='string'?r.status:'',ssl:typeof ssl?.status==='string'?ssl.status:''};
}
async function currentProof(db:D1Database,user:string,claim:string){const c=await db.prepare('SELECT d.* FROM domain_claims d JOIN projects p ON p.id=d.project_id WHERE d.id=? AND p.owner_user_id=?').bind(claim,user).first<{project_id:string;hostname:string;token:string;expires_at:string}>();if(!c)throw new DomainError(404,'Domain not found.');hostname(c.hostname);if(c.expires_at<=new Date().toISOString())throw new DomainError(409,'Renew the expired domain ownership proof first.');return c;}
export async function reviewHosting(db:D1Database,user:string,id:string,claimId:string,configuration:HostingConfig|undefined){
 const config=configured(configuration);if(!idPattern.test(id)||!idPattern.test(claimId))throw new DomainError(400,'Choose a domain ownership claim.');
 const prior=await db.prepare('SELECT * FROM domain_connections WHERE id=? AND user_id=?').bind(id,user).first<Connection>();if(prior){if(prior.claim_id!==claimId)throw new DomainError(409,'Review ID was already used.');return view(prior);}
 const claim=await currentProof(db,user,claimId),now=new Date().toISOString();
 try{await db.prepare("INSERT INTO domain_connections(id,user_id,claim_id,project_id,hostname,zone_id,target,proof_hash,state,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,'review',?,?)").bind(id,user,claimId,claim.project_id,claim.hostname,config.zone,config.target,await hashToken(claim.token),now,new Date(Date.now()+600000).toISOString()).run();}catch(cause){const saved=await db.prepare('SELECT * FROM domain_connections WHERE id=? AND user_id=? AND claim_id=?').bind(id,user,claimId).first<Connection>();if(saved)return view(saved);if(String(cause).includes('domain_connection_reviews'))throw new DomainError(409,'This account reached its 100 hosting-review test limit.');throw cause;}return view(await owned(db,user,id));
}
export async function confirmHosting(db:D1Database,user:string,id:string,configuration:HostingConfig|undefined,transport:typeof fetch=fetch){
 const config=configured(configuration),c=await owned(db,user,id);if(c.zone_id!==config.zone||c.target!==config.target)throw new DomainError(409,'Hosting configuration changed.');
 // A dispatched create is never retried. Unknown IDs require operator reconciliation.
 if(c.state!=='review')return view(c);
 if(c.expires_at<=new Date().toISOString())throw new DomainError(409,'Hosting review expired. Prepare a new review.');
 const claim=await currentProof(db,user,c.claim_id);if(await hashToken(claim.token)!==c.proof_hash)throw new DomainError(409,'Domain proof changed. Prepare a new review.');
 if(!await verifyDNS('_whumpo.'+c.hostname,'whumpo-verification='+claim.token,transport))throw new DomainError(409,'The current domain ownership proof was not found.');
 const inventory=await readJSON(await request(config,'?per_page=1', 'GET',undefined,transport));
 if(!Number.isSafeInteger(inventory.result_info?.total_count)||Number(inventory.result_info?.total_count)>=80)throw new DomainError(409,'Cloudflare hostname allowance needs operator review.');
 const existing=await readJSON(await request(config,'?hostname='+encodeURIComponent(c.hostname)+'&per_page=50','GET',undefined,transport));
 if(!Array.isArray(existing.result)||existing.result.length||existing.result_info?.total_count!==0)throw new DomainError(409,'Cloudflare already has this hostname or could not prove it absent. No hostname was adopted or replaced.');
 try{const claimed=await db.prepare("UPDATE domain_connections SET state='creating',detail='Provisioning hostname' WHERE id=? AND user_id=? AND state='review' AND expires_at>? RETURNING id").bind(id,user,new Date().toISOString()).first();if(!claimed)return view(await owned(db,user,id));}catch(cause){if(/domain_connection_capacity|UNIQUE constraint/.test(String(cause)))throw new DomainError(409,'This hostname is already reserved or the platform hostname limit was reached.');throw cause;}
 try{
  const created=providerRecord((await readJSON(await request(config,'','POST',{hostname:c.hostname,ssl:{method:'http',type:'dv'}},transport))).result,c.hostname);
  // Persist the exact resource ID even if disconnect raced the request, so cleanup can target it.
  await db.prepare("UPDATE domain_connections SET provider_id=?,provider_status=?,ssl_status=?,state=CASE WHEN state='creating' THEN 'provisioning' ELSE state END,detail='Hostname created; awaiting certificate and routing checks' WHERE id=? AND user_id=? AND provider_id IS NULL AND state IN ('creating','disconnecting')").bind(created.id,created.status,created.ssl,id,user).run();
 }catch{
  const saved=await owned(db,user,id);if(!saved.provider_id)await db.prepare("UPDATE domain_connections SET state=CASE WHEN state='creating' THEN 'uncertain' ELSE state END,detail='Creation outcome is uncertain. No retry will create another hostname; operator reconciliation is required.' WHERE id=? AND user_id=? AND provider_id IS NULL").bind(id,user).run();
 }
 return view(await owned(db,user,id));
}
export async function disconnectHosting(db:D1Database,user:string,id:string,configuration:HostingConfig|undefined,transport:typeof fetch=fetch){
 let c=await owned(db,user,id);if(c.state==='disconnected')return view(c);
 // Fail closed locally before any external call, including when configuration is absent.
 await db.prepare("UPDATE domain_connections SET state=CASE WHEN state='review' THEN 'disconnected' ELSE 'disconnecting' END,serve_until=NULL,check_id=NULL,detail=CASE WHEN state='review' THEN 'Hosting review cancelled; no hostname created' ELSE 'Local routing disabled; provider cleanup pending' END WHERE id=? AND user_id=? AND state!='disconnected'").bind(id,user).run();c=await owned(db,user,id);
 if(c.state==='disconnected'||!c.provider_id||!configuration)return view(c);const config=configured(configuration);if(config.zone!==c.zone_id)throw new DomainError(409,'Original hosting zone configuration is required for cleanup.');
 try{
  // Recheck identity before deleting. Never delete a name-based search result.
  const response=await request(config,'/'+c.provider_id,'GET',undefined,transport);
  if(response.status===404)await response.body?.cancel();else{
   providerRecord((await readJSON(response)).result,c.hostname,c.provider_id);
   const deleted=await request(config,'/'+c.provider_id,'DELETE',undefined,transport);
   if(deleted.status===404)await deleted.body?.cancel();else{const result=(await readJSON(deleted)).result as {id?:string}|null;if(result?.id!==c.provider_id)throw new DomainError(503,'Deletion receipt did not match.');}
  }
  await db.prepare("UPDATE domain_connections SET state='disconnected',detail='Local routing disabled and provider hostname removed' WHERE id=? AND user_id=? AND state='disconnecting'").bind(id,user).run();
 }catch{/* Retain exact resource and fail-closed cleanup state for a later retry. */}
 return view(await owned(db,user,id));
}
export async function refreshHosting(db:D1Database,user:string,id:string,configuration:HostingConfig|undefined,transport:typeof fetch=fetch,allowCleanup=true){
 const c=await owned(db,user,id);if(c.state==='disconnecting')return allowCleanup?disconnectHosting(db,user,id,configuration,transport):view(c);
 if(!['active','provisioning'].includes(c.state)||!c.provider_id)return view(c);
 // Expired checks and outages cannot keep old routing authorization alive.
 const checkId=crypto.randomUUID();
 const started=await db.prepare("UPDATE domain_connections SET state='provisioning',serve_until=NULL,check_id=? WHERE id=? AND user_id=? AND state IN ('active','provisioning') RETURNING id").bind(checkId,id,user).first();if(!started)return view(await owned(db,user,id));
 try{
  const config=configured(configuration);if(c.zone_id!==config.zone||c.target!==config.target)throw new DomainError(409,'Original hosting configuration is required.');
  const remote=providerRecord((await readJSON(await request(config,'/'+c.provider_id,'GET',undefined,transport))).result,c.hostname,c.provider_id);
  const claim=await currentProof(db,user,c.claim_id);
  const proof=await verifyDNS('_whumpo.'+c.hostname,'whumpo-verification='+claim.token,transport);
  const routed=await verifyDNS(c.hostname,c.target,transport,'CNAME');
  const ready=remote.status==='active'&&remote.ssl==='active'&&proof&&routed,now=new Date().toISOString();
  await db.prepare("UPDATE domain_connections SET state=?,provider_status=?,ssl_status=?,checked_at=?,serve_until=?,detail=? WHERE id=? AND user_id=? AND provider_id=? AND check_id=? AND state IN ('active','provisioning') AND EXISTS(SELECT 1 FROM domain_claims d WHERE d.id=domain_connections.claim_id AND d.token=? AND d.expires_at=? AND d.expires_at>?)").bind(ready?'active':'provisioning',remote.status,remote.ssl,now,ready?new Date(Math.min(Date.now()+7200000,Date.parse(claim.expires_at))).toISOString():null,ready?'Certificate, hostname and DNS checks passed':'Awaiting active hostname, certificate, current TXT proof and direct CNAME',id,user,c.provider_id,checkId,claim.token,claim.expires_at,now).run();
 }catch{await db.prepare("UPDATE domain_connections SET detail='Hosting could not be verified. Local routing is disabled until a successful check.' WHERE id=? AND user_id=? AND check_id=? AND state='provisioning'").bind(id,user,checkId).run();}
 return view(await owned(db,user,id));
}
export async function maintainHosting(db:D1Database,configuration:HostingConfig|undefined,transport:typeof fetch=fetch){
 if(!configuration)return;
 const {results}=await db.prepare("SELECT id,user_id FROM domain_connections WHERE state IN ('active','provisioning','disconnecting') ORDER BY checked_at ASC LIMIT 80").all<{id:string;user_id:string}>();
 // Process at most eighty records in batches of four; each job uses bounded provider/DNS calls.
 for(let offset=0;offset<results.length;offset+=4)await Promise.all(results.slice(offset,offset+4).map(c=>refreshHosting(db,c.user_id,c.id,configuration,transport)));
}

/** Operator recovery reads only; never accepts a provider URL or mutates Cloudflare. */
export async function recoveryResource(configuration:HostingConfig,providerId:string,name:string,transport:typeof fetch=fetch){
 const config=configured(configuration);if(!idPattern.test(providerId))throw new DomainError(400,'Invalid provider resource ID.');
 const raw=(await readJSON(await request(config,'/'+providerId,'GET',undefined,transport))).result;
 const record=providerRecord(raw,name,providerId),createdAt=(raw as {created_at?:unknown}).created_at;
 if(typeof createdAt!=='string'||!Number.isFinite(Date.parse(createdAt)))throw new DomainError(503,'Cloudflare did not return a valid resource creation time.');
 return {...record,createdAt};
}

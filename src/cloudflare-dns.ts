import {cloudflareAccess,type CloudflareConfig} from './cloudflare-connection';
import {DomainError,hostname} from './domains';
import {hashToken} from './security';
type Action={id:string;user_id:string;claim_id:string;project_id:string;token_id:string;zone_id:string;zone_name:string;record_name:string;content:string;inventory_hash:string;created_at:string;expires_at:string;state:string;provider_id:string|null;detail:string};
type RecordInfo={id:string;name:string;type:string;content:string;comment:string;ttl:number};
const proofMatches=(value:string,expected:string)=>value===expected||value===JSON.stringify(expected);
const uuid=/^[0-9a-f-]{36}$/,zoneID=/^[0-9a-f]{32}$/,stamp=()=>new Date().toISOString();
const view=(a:Action)=>({id:a.id,claimId:a.claim_id,projectId:a.project_id,zoneId:a.zone_id,zoneName:a.zone_name,record:{type:'TXT',name:a.record_name,value:a.content,ttl:1},state:a.state,providerId:a.provider_id,expiresAt:a.expires_at,detail:a.detail});
async function owned(db:D1Database,user:string,id:string){const a=await db.prepare('SELECT * FROM cloudflare_dns_actions WHERE id=? AND user_id=?').bind(id,user).first<Action>();if(!a)throw new DomainError(404,'DNS review not found.');return a;}
async function proof(db:D1Database,user:string,id:string){const p=await db.prepare('SELECT d.*,p.owner_user_id FROM domain_claims d JOIN projects p ON p.id=d.project_id WHERE d.id=? AND p.owner_user_id=?').bind(id,user).first<{id:string;project_id:string;hostname:string;token:string;expires_at:string}>();if(!p)throw new DomainError(404,'Domain proof not found.');hostname(p.hostname);if(p.expires_at<=stamp())throw new DomainError(409,'Renew the expired domain proof first.');return p;}
async function zone(access:Awaited<ReturnType<typeof cloudflareAccess>>,id:string,name:string){const d=await access.send('/zones/'+id),z=d.result as Record<string,unknown>|undefined;if(d.success!==true||!z||z.id!==id||typeof z.name!=='string'||z.status!=='active'||!(name===z.name||name.endsWith('.'+z.name)))throw new DomainError(409,'Choose an active authorized Cloudflare zone containing this hostname.');return z.name;}
function record(raw:unknown,name:string):RecordInfo{
 if(!raw||typeof raw!=='object')throw new DomainError(503,'Cloudflare returned an invalid DNS record.');const r=raw as Record<string,unknown>;
 if(typeof r.id!=='string'||!zoneID.test(r.id)||r.name!==name||typeof r.type!=='string'||typeof r.content!=='string'||r.content.length>8192||typeof r.ttl!=='number'||r.comment!==undefined&&r.comment!==null&&typeof r.comment!=='string')throw new DomainError(503,'Cloudflare returned an invalid DNS record.');
 return {id:r.id,name,type:r.type,content:r.content,comment:typeof r.comment==='string'?r.comment:'',ttl:r.ttl};
}
async function inventory(access:Awaited<ReturnType<typeof cloudflareAccess>>,zoneId:string,name:string){const data=await access.send('/zones/'+zoneId+'/dns_records?'+new URLSearchParams({'name.exact':name,per_page:'100',page:'1'})),info=data.result_info as Record<string,unknown>|undefined;
 if(data.success!==true||!Array.isArray(data.result)||data.result.length>100||!info||!Number.isSafeInteger(info.total_count)||info.total_count!==data.result.length)throw new DomainError(409,'Cloudflare could not provide the complete DNS record set. No changes were made.');
 const records=data.result.map(r=>record(r,name)).sort((a,b)=>a.id.localeCompare(b.id));return {records,hash:await hashToken(JSON.stringify(records))};}
export async function listDNSActions(db:D1Database,user:string){const {results}=await db.prepare('SELECT * FROM cloudflare_dns_actions WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(user).all<Action>();return {actions:results.map(view)};}
export async function reviewTXT(db:D1Database,user:string,id:string,claimId:string,zoneId:string,config:CloudflareConfig|undefined,transport:typeof fetch=fetch){
 if(!uuid.test(id)||!uuid.test(claimId)||!zoneID.test(zoneId))throw new DomainError(400,'Choose a domain claim and Cloudflare zone.');
 const old=await db.prepare('SELECT * FROM cloudflare_dns_actions WHERE id=? AND user_id=?').bind(id,user).first<Action>();if(old){if(old.claim_id!==claimId||old.zone_id!==zoneId)throw new DomainError(409,'DNS review ID already used.');return view(old);}
 const p=await proof(db,user,claimId),access=await cloudflareAccess(db,user,config,transport),zoneName=await zone(access,zoneId,p.hostname),name='_whumpo.'+p.hostname,content='whumpo-verification='+p.token,found=await inventory(access,zoneId,name);
 if(found.records.some(r=>r.type==='CNAME'||r.type==='NS'))throw new DomainError(409,'A CNAME or delegation conflicts with this TXT proof. Resolve it in Cloudflare; Whumpo will not overwrite it.');
 const created=stamp(),expires=new Date(Date.now()+600000).toISOString();
 try{const r=await db.prepare(`INSERT INTO cloudflare_dns_actions(id,user_id,claim_id,project_id,token_id,zone_id,zone_name,record_name,content,inventory_hash,created_at,expires_at)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM domain_claims d JOIN projects p ON p.id=d.project_id WHERE d.id=? AND p.owner_user_id=? AND d.token=? AND d.expires_at>?)`).bind(id,user,claimId,p.project_id,access.tokenId,zoneId,zoneName,name,content,found.hash,created,expires,claimId,user,p.token,created).run();if(!r.meta.changes)throw new DomainError(409,'Domain proof changed. Prepare a fresh review.');}
 catch(cause){const saved=await db.prepare('SELECT * FROM cloudflare_dns_actions WHERE id=? AND user_id=? AND claim_id=? AND zone_id=?').bind(id,user,claimId,zoneId).first<Action>();if(saved)return view(saved);if(String(cause).includes('cloudflare_dns_quota'))throw new DomainError(409,'This account reached its 100 DNS-review test limit.');throw cause;}
 return view(await owned(db,user,id));
}
export async function confirmTXT(db:D1Database,user:string,id:string,config:CloudflareConfig|undefined,transport:typeof fetch=fetch){
 const a=await owned(db,user,id);if(['applied','unchanged','observed'].includes(a.state))return view(a);
 const access=await cloudflareAccess(db,user,config,transport,a.state==='review'?a.token_id:undefined);
 const name=await zone(access,a.zone_id,a.record_name);if(name!==a.zone_name)throw new DomainError(409,'Cloudflare zone identity changed.');
 const found=await inventory(access,a.zone_id,a.record_name);
 if(a.state!=='review'){
  const match=found.records.filter(r=>r.type==='TXT'&&proofMatches(r.content,a.content)&&r.comment==='Whumpo proof '+a.id);
  if(match.length===1){await db.prepare("UPDATE cloudflare_dns_actions SET state='observed',provider_id=?,detail='Exact reviewed TXT record observed after an uncertain request. Creation provenance is not assumed. Verify public DNS separately.' WHERE id=? AND user_id=? AND state IN ('sending','uncertain')").bind(match[0].id,id,user).run();}
  return view(await owned(db,user,id));
 }
 const p=await proof(db,user,a.claim_id);if(a.expires_at<=stamp()||'whumpo-verification='+p.token!==a.content||'_whumpo.'+p.hostname!==a.record_name)throw new DomainError(409,'DNS review expired or the proof changed. Prepare a fresh review.');
 if(found.hash!==a.inventory_hash)throw new DomainError(409,'DNS records changed after review. Prepare a fresh review; nothing was overwritten.');
 const existing=found.records.find(r=>r.type==='TXT'&&proofMatches(r.content,a.content));
 try{const claimed=await db.prepare("UPDATE cloudflare_dns_actions SET state=?,provider_id=?,detail=? WHERE id=? AND user_id=? AND state='review' RETURNING id").bind(existing?'unchanged':'sending',existing?.id??null,existing?'The exact TXT proof already exists. No DNS write was needed. Verify public DNS separately.':'TXT create dispatched; its outcome is not confirmed.',id,user).first();if(!claimed||existing)return view(await owned(db,user,id));}
 catch(cause){if(/cloudflare_dns_stale|UNIQUE constraint/.test(String(cause)))throw new DomainError(409,'DNS review changed, access expired, or another write is unresolved. Refresh before proceeding.');throw cause;}
 // Once sending is persisted, retries can only observe; they never POST again.
 try{
  const data=await access.send('/zones/'+a.zone_id+'/dns_records','POST',{type:'TXT',name:a.record_name,content:JSON.stringify(a.content),ttl:1,comment:'Whumpo proof '+a.id});if(data.success!==true)throw new DomainError(503,'DNS creation could not be confirmed.');
  const created=record(data.result,a.record_name);if(created.type!=='TXT'||!proofMatches(created.content,a.content)||created.comment!=='Whumpo proof '+a.id)throw new DomainError(503,'DNS creation identity could not be confirmed.');
  await db.prepare("UPDATE cloudflare_dns_actions SET state='applied',provider_id=?,detail='Cloudflare acknowledged the reviewed TXT record. Verify public DNS separately; hosting is unchanged.' WHERE id=? AND user_id=? AND state IN ('sending','uncertain')").bind(created.id,id,user).run();
 }catch{await db.prepare("UPDATE cloudflare_dns_actions SET state='uncertain',detail='The DNS request outcome is uncertain. Check the result; this request will not be sent again. If no exact record can be observed, operator review is required.' WHERE id=? AND user_id=? AND state='sending'").bind(id,user).run();}
 return view(await owned(db,user,id));
}

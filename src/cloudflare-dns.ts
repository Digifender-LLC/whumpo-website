import {cloudflareAccess,type CloudflareConfig} from './cloudflare-connection';
import {DomainError,hostname} from './domains';
import {hashToken} from './security';
type Action={id:string;user_id:string;claim_id:string;project_id:string;token_id:string;zone_id:string;zone_name:string;record_name:string;content:string;inventory_hash:string;created_at:string;expires_at:string;state:string;provider_id:string|null;detail:string;record_type:'TXT'|'CNAME';connection_id:string|null;proof_token:string|null};
type RecordInfo={id:string;name:string;type:string;content:string;comment:string;ttl:number;proxied?:boolean};
const proofMatches=(value:string,expected:string)=>value===expected||value===JSON.stringify(expected);
const uuid=/^[0-9a-f-]{36}$/,zoneID=/^[0-9a-f]{32}$/,stamp=()=>new Date().toISOString();
const view=(a:Action)=>({id:a.id,connectionId:a.connection_id,claimId:a.claim_id,projectId:a.project_id,zoneId:a.zone_id,zoneName:a.zone_name,record:{type:a.record_type,name:a.record_name,value:a.content,ttl:1,...(a.record_type==='CNAME'?{proxied:false}:{})},state:a.state,providerId:a.provider_id,expiresAt:a.expires_at,detail:a.detail});
async function owned(db:D1Database,user:string,id:string){const a=await db.prepare('SELECT * FROM cloudflare_dns_actions WHERE id=? AND user_id=?').bind(id,user).first<Action>();if(!a)throw new DomainError(404,'DNS review not found.');return a;}
async function proof(db:D1Database,user:string,id:string){const p=await db.prepare('SELECT d.*,p.owner_user_id FROM domain_claims d JOIN projects p ON p.id=d.project_id WHERE d.id=? AND p.owner_user_id=?').bind(id,user).first<{id:string;project_id:string;hostname:string;token:string;expires_at:string}>();if(!p)throw new DomainError(404,'Domain proof not found.');hostname(p.hostname);if(p.expires_at<=stamp())throw new DomainError(409,'Renew the expired domain proof first.');return p;}
async function zone(access:Awaited<ReturnType<typeof cloudflareAccess>>,id:string,name:string){const d=await access.send('/zones/'+id),z=d.result as Record<string,unknown>|undefined;if(d.success!==true||!z||z.id!==id||typeof z.name!=='string'||z.status!=='active'||!(name===z.name||name.endsWith('.'+z.name)))throw new DomainError(409,'Choose an active authorized Cloudflare zone containing this hostname.');return z.name;}
function record(raw:unknown,name:string,routing=false):RecordInfo{
 if(!raw||typeof raw!=='object')throw new DomainError(503,'Cloudflare returned an invalid DNS record.');const r=raw as Record<string,unknown>;
 if(typeof r.id!=='string'||!zoneID.test(r.id)||r.name!==name||typeof r.type!=='string'||typeof r.content!=='string'||r.content.length>8192||typeof r.ttl!=='number'||r.comment!==undefined&&r.comment!==null&&typeof r.comment!=='string')throw new DomainError(503,'Cloudflare returned an invalid DNS record.');
 if(routing&&r.type==='CNAME'&&typeof r.proxied!=='boolean')throw new DomainError(503,'Cloudflare did not return the CNAME proxy status.');
 return {id:r.id,name,type:r.type,content:r.content,comment:typeof r.comment==='string'?r.comment:'',ttl:r.ttl,...(routing&&r.type==='CNAME'?{proxied:r.proxied as boolean}:{})};
}
async function inventory(access:Awaited<ReturnType<typeof cloudflareAccess>>,zoneId:string,name:string,routing=false){const data=await access.send('/zones/'+zoneId+'/dns_records?'+new URLSearchParams({'name.exact':name,per_page:'100',page:'1'})),info=data.result_info as Record<string,unknown>|undefined;
 if(data.success!==true||!Array.isArray(data.result)||data.result.length>100||!info||!Number.isSafeInteger(info.total_count)||info.total_count!==data.result.length)throw new DomainError(409,'Cloudflare could not provide the complete DNS record set. No changes were made.');
 const records=data.result.map(r=>record(r,name,routing)).sort((a,b)=>a.id.localeCompare(b.id));return {records,hash:await hashToken(JSON.stringify(records))};}
export async function listDNSActions(db:D1Database,user:string){const {results}=await db.prepare('SELECT * FROM cloudflare_dns_actions WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(user).all<Action>();return {actions:results.map(view)};}
export async function reviewTXT(db:D1Database,user:string,id:string,claimId:string,zoneId:string,config:CloudflareConfig|undefined,transport:typeof fetch=fetch){
 if(!uuid.test(id)||!uuid.test(claimId)||!zoneID.test(zoneId))throw new DomainError(400,'Choose a domain claim and Cloudflare zone.');
 const old=await db.prepare('SELECT * FROM cloudflare_dns_actions WHERE id=? AND user_id=?').bind(id,user).first<Action>();if(old){if(old.record_type!=='TXT'||old.claim_id!==claimId||old.zone_id!==zoneId)throw new DomainError(409,'DNS review ID already used.');return view(old);}
 const p=await proof(db,user,claimId),access=await cloudflareAccess(db,user,config,transport),zoneName=await zone(access,zoneId,p.hostname),name='_tellumo.'+p.hostname,content='tellumo-verification='+p.token,found=await inventory(access,zoneId,name);
 if(found.records.some(r=>r.type==='CNAME'||r.type==='NS'))throw new DomainError(409,'A CNAME or delegation conflicts with this TXT proof. Resolve it in Cloudflare; Whumpo will not overwrite it.');
 const created=stamp(),expires=new Date(Date.now()+600000).toISOString();
 try{const r=await db.prepare(`INSERT INTO cloudflare_dns_actions(id,user_id,claim_id,project_id,token_id,zone_id,zone_name,record_name,content,inventory_hash,created_at,expires_at)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM domain_claims d JOIN projects p ON p.id=d.project_id WHERE d.id=? AND p.owner_user_id=? AND d.token=? AND d.expires_at>?)`).bind(id,user,claimId,p.project_id,access.tokenId,zoneId,zoneName,name,content,found.hash,created,expires,claimId,user,p.token,created).run();if(!r.meta.changes)throw new DomainError(409,'Domain proof changed. Prepare a fresh review.');}
 catch(cause){const saved=await db.prepare("SELECT * FROM cloudflare_dns_actions WHERE id=? AND user_id=? AND claim_id=? AND zone_id=? AND record_type='TXT'").bind(id,user,claimId,zoneId).first<Action>();if(saved)return view(saved);if(String(cause).includes('cloudflare_dns_quota'))throw new DomainError(409,'This account reached its 100 DNS-review test limit.');throw cause;}
 return view(await owned(db,user,id));
}
const routingTarget='hosting.whumpo.site',hostingZone='8d46ee4e394514402479acf16579f7b5';
type RoutingConnection={id:string;claim_id:string;project_id:string;hostname:string;target:string;zone_id:string;state:string;provider_id:string|null;proof_hash:string};
async function routingConnection(db:D1Database,user:string,id:string,ready:boolean){
 if(!ready)throw new DomainError(503,'Domain hosting is awaiting platform configuration.');
 const c=await db.prepare('SELECT c.* FROM domain_connections c JOIN projects p ON p.id=c.project_id WHERE c.id=? AND c.user_id=? AND p.owner_user_id=?').bind(id,user,user).first<RoutingConnection>();
 if(!c)throw new DomainError(404,'Domain connection not found.');
 if(!['provisioning','active'].includes(c.state)||!c.provider_id||!uuid.test(c.provider_id)||c.target!==routingTarget||c.zone_id!==hostingZone)throw new DomainError(409,'Confirm a Whumpo hosting connection before reviewing routing.');
 const p=await proof(db,user,c.claim_id);
 if(p.project_id!==c.project_id||p.hostname!==c.hostname||await hashToken(p.token)!==c.proof_hash)throw new DomainError(409,'Hosting ownership proof changed. Review the hosting connection again.');
 return {c,p};
}
function routingConflicts(records:RecordInfo[]){if(records.length>1||records.some(r=>r.type!=='CNAME'||r.content!==routingTarget||r.proxied!==false))throw new DomainError(409,'Existing DNS records conflict with Whumpo routing. Resolve them in Cloudflare; Whumpo will not replace them.');}
export async function reviewCNAME(db:D1Database,user:string,id:string,connectionId:string,zoneId:string,config:CloudflareConfig|undefined,transport:typeof fetch=fetch,hostingReady=false){
 if(!uuid.test(id)||!uuid.test(connectionId)||!zoneID.test(zoneId))throw new DomainError(400,'Choose a hosting connection and Cloudflare zone.');
 const old=await db.prepare('SELECT * FROM cloudflare_dns_actions WHERE id=? AND user_id=?').bind(id,user).first<Action>();
 if(old){if(old.record_type!=='CNAME'||old.connection_id!==connectionId||old.zone_id!==zoneId)throw new DomainError(409,'DNS review ID already used.');return view(old);}
 const {c,p}=await routingConnection(db,user,connectionId,hostingReady),access=await cloudflareAccess(db,user,config,transport),zoneName=await zone(access,zoneId,c.hostname);
 if(c.hostname===zoneName)throw new DomainError(409,'Use a subdomain for direct CNAME routing. Apex routing is not supported.');
 const found=await inventory(access,zoneId,c.hostname,true);routingConflicts(found.records);
 const created=stamp(),expires=new Date(Date.now()+600000).toISOString();
 try{await db.prepare(`INSERT INTO cloudflare_dns_actions(id,user_id,claim_id,project_id,token_id,zone_id,zone_name,record_name,content,inventory_hash,created_at,expires_at,record_type,connection_id,proof_token)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'CNAME',?,?)`).bind(id,user,c.claim_id,c.project_id,access.tokenId,zoneId,zoneName,c.hostname,routingTarget,found.hash,created,expires,connectionId,p.token).run();}
 catch(cause){const saved=await db.prepare("SELECT * FROM cloudflare_dns_actions WHERE id=? AND user_id=? AND connection_id=? AND zone_id=? AND record_type='CNAME'").bind(id,user,connectionId,zoneId).first<Action>();if(saved)return view(saved);if(String(cause).includes('cloudflare_dns_quota'))throw new DomainError(409,'This account reached its 100 DNS-review test limit.');if(String(cause).includes('cloudflare_dns_stale'))throw new DomainError(409,'Hosting connection or ownership changed. Prepare a fresh review.');throw cause;}
 return view(await owned(db,user,id));
}
export async function confirmDNS(db:D1Database,user:string,id:string,config:CloudflareConfig|undefined,transport:typeof fetch=fetch,hostingReady=false){
 const a=await owned(db,user,id);if(['applied','unchanged','observed'].includes(a.state))return view(a);
 const routing=a.record_type==='CNAME',marker=(routing?'Whumpo routing ':'Whumpo proof ')+a.id;
 // Configuration gates new writes; observation of a prior uncertain dispatch stays read-only.
 if(routing&&a.state==='review')await routingConnection(db,user,a.connection_id!,hostingReady);
 const access=await cloudflareAccess(db,user,config,transport,a.state==='review'?a.token_id:undefined);
 const name=await zone(access,a.zone_id,a.record_name);if(name!==a.zone_name)throw new DomainError(409,'Cloudflare zone identity changed.');
 const found=await inventory(access,a.zone_id,a.record_name,routing);
 const matches=(r:RecordInfo)=>r.type===a.record_type&&(routing?r.content===a.content&&r.proxied===false:proofMatches(r.content,a.content));
 if(a.state!=='review'){
  const match=found.records.filter(r=>matches(r)&&r.comment===marker);
  if(match.length===1){await db.prepare("UPDATE cloudflare_dns_actions SET state='observed',provider_id=?,detail=? WHERE id=? AND user_id=? AND state IN ('sending','uncertain')").bind(match[0].id,'Exact reviewed '+a.record_type+' record observed after an uncertain request. Creation provenance is not assumed. Verify public DNS and hosting separately.',id,user).run();}
  return view(await owned(db,user,id));
 }
 const p=await proof(db,user,a.claim_id);
 if(a.expires_at<=stamp()||(routing?p.token!==a.proof_token||p.hostname!==a.record_name||a.content!==routingTarget||a.record_name===a.zone_name:'tellumo-verification='+p.token!==a.content||'_tellumo.'+p.hostname!==a.record_name))throw new DomainError(409,'DNS review expired or the proof changed. Prepare a fresh review.');
 if(found.hash!==a.inventory_hash)throw new DomainError(409,'DNS records changed after review. Prepare a fresh review; nothing was overwritten.');
 if(routing)routingConflicts(found.records);
 const existing=found.records.find(matches);
 try{const claimed=await db.prepare("UPDATE cloudflare_dns_actions SET state=?,provider_id=?,detail=? WHERE id=? AND user_id=? AND state='review' RETURNING id").bind(existing?'unchanged':'sending',existing?.id??null,existing?'The exact '+a.record_type+' record already exists. No DNS write was needed. Verify public DNS and hosting separately.':a.record_type+' create dispatched; its outcome is not confirmed.',id,user).first();if(!claimed||existing)return view(await owned(db,user,id));}
 catch(cause){if(/cloudflare_dns_stale|UNIQUE constraint/.test(String(cause)))throw new DomainError(409,'DNS review changed, access expired, or another write is unresolved. Refresh before proceeding.');throw cause;}
 // Once sending is persisted, retries can only observe; they never POST again.
 try{
  const data=await access.send('/zones/'+a.zone_id+'/dns_records','POST',{type:a.record_type,name:a.record_name,content:routing?a.content:JSON.stringify(a.content),ttl:1,...(routing?{proxied:false}:{}),comment:marker});if(data.success!==true)throw new DomainError(503,'DNS creation could not be confirmed.');
  const created=record(data.result,a.record_name,routing);if(!matches(created)||created.comment!==marker)throw new DomainError(503,'DNS creation identity could not be confirmed.');
  await db.prepare("UPDATE cloudflare_dns_actions SET state='applied',provider_id=?,detail=? WHERE id=? AND user_id=? AND state IN ('sending','uncertain')").bind(created.id,'Cloudflare acknowledged the reviewed '+a.record_type+' record. '+(routing?'Check hosting status to verify public DNS and TLS before treating this hostname as live.':'Verify public DNS separately; hosting is unchanged.'),id,user).run();
 }catch{await db.prepare("UPDATE cloudflare_dns_actions SET state='uncertain',detail='The DNS request outcome is uncertain. Check the result; this request will not be sent again. If no exact record can be observed, operator review is required.' WHERE id=? AND user_id=? AND state='sending'").bind(id,user).run();}
 return view(await owned(db,user,id));
}

import {newSessionToken} from './security';
export class DomainError extends Error {constructor(public status:number,message:string){super(message);}}
type Claim={id:string;project_id:string;hostname:string;token:string;expires_at:string;verified_at:string|null;created_at:string};
export function hostname(value:string){
 const name=value.trim().toLowerCase();
 if(name.length>243||!name.includes('.')||!name.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))||/^\d+(?:\.\d+){3}$/.test(name)||/\.(?:localhost|local|test|invalid|example|internal)$/.test(name)||name==='digifender.com'||name.endsWith('.digifender.com'))throw new DomainError(400,'Enter a public hostname such as www.yourdomain.com, without a URL or path. The platform domain cannot be claimed.');
 return name;
}
export function domainView(c:Claim){return {id:c.id,projectId:c.project_id,hostname:c.hostname,status:c.expires_at<=new Date().toISOString()?'expired':c.verified_at?'ownership_verified':'awaiting_dns',record:{type:'TXT',name:'_whumpo.'+c.hostname,value:'whumpo-verification='+c.token},expiresAt:c.expires_at,verifiedAt:c.verified_at,connected:false};}
export async function listDomains(db:D1Database,userId:string){const {results}=await db.prepare('SELECT d.* FROM domain_claims d JOIN projects p ON p.id=d.project_id WHERE p.owner_user_id=? ORDER BY d.created_at DESC').bind(userId).all<Claim>();const {results:active}=await db.prepare("SELECT claim_id FROM domain_connections WHERE user_id=? AND state='active' AND serve_until>?").bind(userId,new Date().toISOString()).all<{claim_id:string}>();return {domains:results.map(c=>({...domainView(c),connected:active.some(a=>a.claim_id===c.id)})),connectionEnabled:false};}
/** Query a fixed resolver. Customer input is a DNS question, never a fetch destination. */
export async function verifyDNS(name:string,value:string,transport:typeof fetch=fetch,recordType:'TXT'|'CNAME'='TXT'){
 const url=new URL('https://cloudflare-dns.com/dns-query');url.searchParams.set('name',name);url.searchParams.set('type',recordType);
 let response:Response;
 try{response=await transport(url,{headers:{accept:'application/dns-json'},redirect:'manual',signal:AbortSignal.timeout(5000)});}catch{throw new DomainError(503,'DNS could not be checked. Please try again later.');}
 if(!response.ok||!response.body){await response.body?.cancel();throw new DomainError(503,'DNS could not be checked. Please try again later.');}
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let length=0;
 try{while(true){const {done,value:chunk}=await reader.read();if(done)break;length+=chunk.length;if(length>32768)throw Error('DNS size');chunks.push(chunk);}}
 catch{await reader.cancel();throw new DomainError(503,'DNS returned an unreadable response. Please try again later.');}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let data:{Status?:number;Answer?:{name?:string;type?:number;data?:string}[]};try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new DomainError(503,'DNS returned an unreadable response. Please try again later.');}
 if(!data||typeof data!=='object')throw new DomainError(503,'DNS returned an unreadable response. Please try again later.');
 if(data.Status===3)return false;
 if(data.Status!==0||data.Answer!==undefined&&!Array.isArray(data.Answer))throw new DomainError(503,'DNS is not ready to verify this hostname. Please try again later.');
 return (data.Answer??[]).some(a=>a?.type===(recordType==='TXT'?16:5)&&typeof a.name==='string'&&a.name.toLowerCase().replace(/\.$/,'')===name&&(recordType==='TXT'?a.data===JSON.stringify(value):typeof a.data==='string'&&a.data.toLowerCase().replace(/\.$/,'')===value));
}
function instructions(c:Claim){const v=domainView(c);return `${c.hostname}: ${v.status==='ownership_verified'?'ownership verified':'awaiting ownership verification'}. This proof does not change hosting.\n\nAt your domain provider, add this TXT record:\nName: ${v.record.name}\nValue: ${v.record.value}\n\nSome providers append your domain automatically; enter only the remaining record-name prefix there. This proof expires ${c.expires_at}. Then use /verify-domain ${c.id}. Do not change your existing website records yet. Review hosting and certificate status separately in Domains.`;}
export async function domainCommand(db:D1Database,userId:string,turnId:string,command:string){
 if(command==='/domains'||command==='show domains'){const result=await listDomains(db,userId);return {reply:(result.domains.map(d=>`${d.hostname} — ${d.status.replaceAll('_',' ')}; ${d.connected?'connected':'not connected'}\nID: ${d.id}`).join('\n\n')||'No domains added yet.')+'\n\nUse /domain www.yourdomain.com PROJECT_ID to prepare a DNS ownership proof. Find the project ID with /projects. Use /dns for reviewed Cloudflare TXT proofs, or the Domains panel to review hosting and check an existing connection. Ownership verification alone does not connect hosting. Purchases are not enabled.',statements:[] as D1PreparedStatement[]};}
 if(command.startsWith('/domain ')){
  const args=command.split(/\s+/);if(args.length!==3||! /^[0-9a-f-]{36}$/.test(args[2]))throw new DomainError(400,'Use /domain HOSTNAME PROJECT_ID. Find the project ID with /projects.');
  const name=hostname(args[1]);if(!await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(args[2],userId).first())throw new DomainError(404,'Project not found');
  const prior=await db.prepare('SELECT * FROM domain_claims WHERE project_id=? AND hostname=?').bind(args[2],name).first<Claim>();const now=new Date().toISOString();
  if(prior&&prior.expires_at>now)return {reply:instructions(prior),statements:[] as D1PreparedStatement[]};
  const c:Claim={id:prior?.id??turnId,project_id:args[2],hostname:name,token:newSessionToken(),expires_at:new Date(Date.now()+7*86400000).toISOString(),verified_at:null,created_at:now};
  const statement=prior?db.prepare('UPDATE domain_claims SET token=?,expires_at=?,verified_at=NULL WHERE id=? AND EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(c.token,c.expires_at,c.id,turnId,userId):db.prepare('INSERT INTO domain_claims(id,project_id,hostname,token,expires_at,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(c.id,c.project_id,c.hostname,c.token,c.expires_at,c.created_at,turnId,userId);
  return {reply:instructions(c),statements:[statement,db.prepare("INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) SELECT ?,?,project_id,'domain.proof.created','Prepared domain ownership verification',? FROM domain_claims WHERE id=? AND EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)").bind('domain:'+turnId,userId,now,c.id,turnId,userId)]};
 }
 if(command.startsWith('/verify-domain ')){
  const args=command.split(/\s+/);if(args.length!==2||! /^[0-9a-f-]{36}$/.test(args[1]))throw new DomainError(400,'Use /verify-domain followed by the domain ID from /domains.');
  const c=await db.prepare('SELECT d.* FROM domain_claims d JOIN projects p ON p.id=d.project_id WHERE d.id=? AND p.owner_user_id=?').bind(args[1],userId).first<Claim>();if(!c)throw new DomainError(404,'Domain not found');
  const now=new Date().toISOString();if(c.expires_at<=now)throw new DomainError(409,'This proof expired. Use /domain with the hostname and project ID to create a fresh proof.');
  const valid=await verifyDNS('_whumpo.'+c.hostname,'whumpo-verification='+c.token);
  return {reply:valid?`Ownership of ${c.hostname} verified. This ownership check does not change hosting. Review hosting and certificate status separately in Domains. Keep your existing website records unchanged.`:`The current TXT proof for ${c.hostname} was not found. Check the name and value at your provider, allow time for DNS to update, then try /verify-domain ${c.id} again. Check the separate hosting status in Domains.`,statements:[db.prepare('UPDATE domain_claims SET verified_at=? WHERE id=? AND token=? AND expires_at>? AND EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(valid?now:null,c.id,c.token,now,turnId,userId),db.prepare("INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) SELECT ?,?,project_id,'domain.proof.checked',?,? FROM domain_claims WHERE id=? AND EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)").bind('domain:'+turnId,userId,valid?'Verified domain ownership':'Domain proof not found',now,c.id,turnId,userId)]};
 }
 return undefined;
}

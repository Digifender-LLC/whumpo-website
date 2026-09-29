import {DomainError} from './domains';
import {recoveryResource,type HostingConfig} from './domain-hosting';
import {hashToken} from './security';
type Snapshot={id:string;user_id:string;claim_id:string;project_id:string;hostname:string;zone_id:string;state:string;provider_id:string|null;created_at:string;proof_hash:string;reconciliation_id:string|null};
export type RecoveryReview={version:1;id:string;connection:Snapshot;resource:{id:string;createdAt:string};action:'resume'|'cleanup';reviewedAt:string;expiresAt:string;digest:string};
const uuid=/^[a-f0-9-]{36}$/;
const fields='id,user_id,claim_id,project_id,hostname,zone_id,state,provider_id,created_at,proof_hash,reconciliation_id';
async function connection(db:D1Database,id:string){if(!uuid.test(id))throw new DomainError(400,'Invalid connection ID.');const c=await db.prepare('SELECT '+fields+' FROM domain_connections WHERE id=?').bind(id).first<Snapshot>();if(!c)throw new DomainError(404,'Connection not found.');return c;}
function eligible(c:Snapshot,config:HostingConfig,action:string){if(c.zone_id!==config.zone||c.provider_id||!['uncertain','disconnecting'].includes(c.state)||!['resume','cleanup'].includes(action)||c.state==='disconnecting'&&action!=='cleanup')throw new DomainError(409,'This connection is not eligible for the requested recovery.');}
async function fingerprint(value:Omit<RecoveryReview,'digest'>){return hashToken(JSON.stringify(value));}
export async function inspectRecovery(db:D1Database,id:string,providerId:string,action:'resume'|'cleanup',config:HostingConfig,transport:typeof fetch=fetch):Promise<RecoveryReview>{
 const c=await connection(db,id);eligible(c,config,action);
 const r=await recoveryResource(config,providerId,c.hostname,transport);
 if(Date.parse(r.createdAt)<Date.parse(c.created_at)||Date.parse(r.createdAt)>Date.now()+60000)throw new DomainError(409,'The provider resource creation time does not match this request window.');
 const reviewedAtMs=Date.now();
 const value:Omit<RecoveryReview,'digest'>={version:1,id:crypto.randomUUID(),connection:c,resource:{id:r.id,createdAt:r.createdAt},action,reviewedAt:new Date(reviewedAtMs).toISOString(),expiresAt:new Date(reviewedAtMs+600000).toISOString()};
 return {...value,digest:await fingerprint(value)};
}
/** Operator-only API: intentionally not imported by the HTTP Worker. Evidence is a human attestation,
 * not an assertion that matching hostname/time proves which application created a resource. */
export async function applyRecovery(db:D1Database,review:RecoveryReview,expectedDigest:string,operator:string,evidence:string,config:HostingConfig,transport:typeof fetch=fetch){
 if(!review||review.version!==1||!uuid.test(review.id)||!review.connection||!review.resource||typeof review.digest!=='string'||review.digest!==expectedDigest||typeof operator!=='string'||!operator.trim()||operator.length>100||typeof evidence!=='string'||evidence.trim().length<12||evidence.length>1000||/[\x00-\x1f\x7f]/.test(operator+evidence))throw new DomainError(400,'A reviewed digest, operator name and concise evidence note are required.');
 const {digest,...unsigned}=review;if(await fingerprint(unsigned)!==digest)throw new DomainError(409,'Recovery review was modified. Inspect it again.');
 const prior=await db.prepare('SELECT * FROM domain_reconciliations WHERE id=?').bind(review.id).first<{connection_id:string;provider_id:string;new_state:string;operator:string;evidence:string}>();
 if(prior){if(prior.connection_id!==review.connection.id||prior.provider_id!==review.resource.id||prior.operator!==operator||prior.evidence!==evidence||prior.new_state!==(review.action==='resume'?'provisioning':'disconnecting'))throw new DomainError(409,'Recovery receipt does not match this replay.');return {id:review.id,replayed:true};}
 try{
 if(!Number.isFinite(Date.parse(review.expiresAt))||Date.parse(review.expiresAt)<=Date.now()||Date.parse(review.reviewedAt)>Date.now()||Date.parse(review.expiresAt)-Date.parse(review.reviewedAt)!==600000)throw new DomainError(409,'Recovery review expired or has invalid timestamps.');
 const current=await connection(db,review.connection.id);eligible(current,config,review.action);
 if(JSON.stringify(current)!==JSON.stringify(review.connection))throw new DomainError(409,'Connection changed since inspection. Inspect it again.');
 const resource=await recoveryResource(config,review.resource.id,current.hostname,transport);
 if(resource.createdAt!==review.resource.createdAt)throw new DomainError(409,'Provider resource changed since inspection.');
  const result=await db.prepare("UPDATE domain_connections SET provider_id=?,state=?,serve_until=NULL,check_id=NULL,reconciliation_id=?,reconciliation_operator=?,reconciliation_evidence=?,detail='Operator reconciled provider identity; routing remains disabled pending normal checks or cleanup' WHERE id=? AND user_id=? AND state=? AND provider_id IS NULL AND reconciliation_id IS NULL AND proof_hash=? RETURNING id").bind(resource.id,review.action==='resume'?'provisioning':'disconnecting',review.id,operator,evidence,current.id,current.user_id,current.state,current.proof_hash).first();
  if(!result)throw new DomainError(409,'Connection changed before recovery could commit.');
 }catch(cause){const receipt=await db.prepare('SELECT id FROM domain_reconciliations WHERE id=?').bind(review.id).first();if(receipt)return applyRecovery(db,review,expectedDigest,operator,evidence,config,transport);throw cause;}
 return {id:review.id,replayed:false};
}

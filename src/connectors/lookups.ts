import type {ConnectorLookupInput} from '../connector-lookup-shape';
import {assertWorkspace} from '../workspace-identity/admission';
import {connectionFeature,featurePredicate,requireFeature} from '../feature-admission';
import {buildConnectorRequest,connectorOperation,isActiveConnectorProvider,type ActiveConnectorProvider,type ConnectorOperationId} from '../connector-catalog';
import {connectorDigest} from '../connector-receipts';
import {copyJSON} from '../project-specification/v2/json';
import {githubInstallations,type GitHubConfig} from '../github-connection';
import {githubRepositories} from '../github-backups';
import {cloudflareZones,type CloudflareConfig} from '../cloudflare-connection';
import {connectorCredentialId,connectorCredentialPredicate} from './admission';
export class ConnectorLookupError extends Error{constructor(readonly status:number,readonly code:string){super(code==='content_route_unavailable'?'Connected content has no approved model route. Choose the owner panel.':code==='lookup_used'?'This lookup permission was already used. Prepare a new lookup.':'This lookup permission is unavailable or changed. Prepare a fresh lookup.');}}
const fail=(code:string,status=409):never=>{throw new ConnectorLookupError(status,code);};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
export type {ConnectorLookupInput} from '../connector-lookup-shape';
type Consent={id:string;user_id:string;provider:ActiveConnectorProvider;operation_id:string;credential_id:string;operation_digest:string;params_digest:string;destination:ConnectorLookupInput['destination'];state:'review'|'confirmed'|'consumed'|'void';created_at:string;expires_at:string};
export type ConnectorLookupOptions={github?:GitHubConfig;cloudflare?:CloudflareConfig;transport?:typeof fetch};
function input(value:unknown):ConnectorLookupInput{
 let v:ConnectorLookupInput;try{v=copyJSON(value,8192) as ConnectorLookupInput;}catch{return fail('invalid_lookup',400);}
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!=='destination,id,operationId,params,provider,version'||v.version!==1||!uuid(v.id)||typeof v.operationId!=='string'||!isActiveConnectorProvider(v.provider))fail('invalid_lookup',400);
 // WH-021 has no admitted confidential runtime route. Never accept a client/model approval flag.
 if(v.destination==='model-context')fail('content_route_unavailable',403);
 if(v.destination!=='owner-panel')fail('destination_forbidden',400);
 const op=connectorOperation(v.provider,v.operationId);
 if(op.kind!=='read'||!op.destinations.includes(v.destination))fail('operation_forbidden',403);
 buildConnectorRequest(v.provider,v.operationId as ConnectorOperationId<typeof v.provider>,v.params);
 return v;
}
function publicConsent(c:Consent){return {version:1 as const,id:c.id,provider:c.provider,operationId:c.operation_id,paramsDigest:c.params_digest,destination:c.destination,state:c.state==='review'||c.state==='confirmed'?c.expires_at<=new Date().toISOString()?'expired' as const:c.state:c.state,expiresAt:c.expires_at};}
async function owned(db:D1Database,user:string,id:string){
 await assertWorkspace(db,user);if(!uuid(id))fail('invalid_lookup',400);
 const c=await db.prepare('SELECT * FROM connector_lookup_consents WHERE id=? AND user_id=?').bind(id,user).first<Consent>();if(!c)fail('not_found',404);return c!;
}
export async function readConnectorLookup(db:D1Database,user:string,id:string){return publicConsent(await owned(db,user,id));}
function configured(v:ConnectorLookupInput,options:ConnectorLookupOptions){if(!(v.provider==='github'?options.github:options.cloudflare))fail('not_configured',503);}
function guard(db:D1Database,user:string,c:Pick<Consent,'provider'|'credential_id'>){
 const feature=featurePredicate(db,connectionFeature(user,c.provider,null,'read')),credential=connectorCredentialPredicate(c.provider,user,c.credential_id);
 return {sql:`(${feature.sql}) AND (${credential.sql})`,params:[...feature.params,...credential.params]};
}
async function match(c:Consent,v:ConnectorLookupInput){
 if(c.provider!==v.provider||c.operation_id!==v.operationId||c.destination!==v.destination||c.params_digest!==await connectorDigest(v.params)||c.operation_digest!==await connectorDigest(connectorOperation(v.provider,v.operationId)))fail('lookup_changed');
}
/** Server issuance persists digests only. Exact parameters are returned transiently for owner review. */
export async function prepareConnectorLookup(db:D1Database,user:string,value:unknown,options:ConnectorLookupOptions){
 await assertWorkspace(db,user);
 let proposal:unknown;try{proposal=copyJSON(value,8192);}catch{return fail('invalid_lookup',400);}
 if(!proposal||typeof proposal!=='object'||Array.isArray(proposal)||Object.hasOwn(proposal,'id'))fail('invalid_lookup',400);
 const v=input({...proposal as Record<string,unknown>,id:crypto.randomUUID()});configured(v,options);
 await requireFeature(db,connectionFeature(user,v.provider,null,'read'));
 await cleanupConnectorLookups(db,user);
 const credentialId=await connectorCredentialId(db,user,v.provider),operationDigest=await connectorDigest(connectorOperation(v.provider,v.operationId)),paramsDigest=await connectorDigest(v.params);
 const count=await db.prepare('SELECT count(*) n FROM connector_lookup_consents WHERE user_id=?').bind(user).first<{n:number}>();if(count&&count.n>=100)fail('lookup_capacity',429);
 const gate=guard(db,user,{provider:v.provider,credential_id:credentialId});
 const inserted=await db.prepare(`INSERT INTO connector_lookup_consents(id,user_id,provider,operation_id,credential_id,operation_digest,params_digest,destination,expires_at) SELECT ?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+15 minutes') WHERE ${gate.sql}`).bind(v.id,user,v.provider,v.operationId,credentialId,operationDigest,paramsDigest,v.destination,...gate.params).run();
 if(inserted.meta.changes!==1)fail('lookup_changed');return {...publicConsent(await owned(db,user,v.id)),params:v.params};
}
/** Only an admitted current owner can approve the exact query and destination. No result is an approval. */
export async function confirmConnectorLookup(db:D1Database,user:string,value:unknown,paramsDigest:unknown,options:ConnectorLookupOptions){
 await assertWorkspace(db,user);const v=input(value);configured(v,options);const c=await owned(db,user,v.id);await match(c,v);
 if(paramsDigest!==c.params_digest||c.state!=='review'||c.expires_at<=new Date().toISOString())fail(c.state==='consumed'?'lookup_used':'lookup_changed');
 const gate=guard(db,user,c),r=await db.prepare(`UPDATE connector_lookup_consents SET state='confirmed',confirmed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND user_id=? AND state='review' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND params_digest=? AND ${gate.sql}`).bind(c.id,user,c.params_digest,...gate.params).run();
 if(r.meta.changes!==1)fail('lookup_changed');return publicConsent(await owned(db,user,c.id));
}
async function dispatch(db:D1Database,user:string,v:ConnectorLookupInput,c:Consent,options:ConnectorLookupOptions){
 if(v.provider==='github'&&v.operationId==='installations.list')return githubInstallations(db,user,options.github,options.transport,c.credential_id);
 if(v.provider==='github'&&v.operationId==='repositories.list')return githubRepositories(db,user,options.github,Number(v.params.installation),Number(v.params.page),options.transport,c.credential_id);
 if(v.provider==='cloudflare'&&v.operationId==='zones.list')return cloudflareZones(db,user,options.cloudflare,Number(v.params.page),options.transport,c.credential_id);
 return fail('adapter_unavailable',503);
}
/** One committed consumption precedes the provider read. Lost replies never replay the lookup. */
export async function executeConnectorLookup(db:D1Database,user:string,value:unknown,options:ConnectorLookupOptions){
 await assertWorkspace(db,user);const v=input(value);configured(v,options);const c=await owned(db,user,v.id);await match(c,v);
 const gate=guard(db,user,c),r=await db.prepare(`UPDATE connector_lookup_consents SET state='consumed',consumed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND user_id=? AND state='confirmed' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${gate.sql}`).bind(c.id,user,...gate.params).run();
 if(r.meta.changes!==1)fail(c.state==='consumed'?'lookup_used':'lookup_changed');
 const data=await dispatch(db,user,v,c,options);
 if(!await db.prepare(`SELECT 1 WHERE ${gate.sql}`).bind(...gate.params).first())fail('access_changed',403);
 // Data is opaque untrusted external information. No persistence, tool selection, instruction or continuation.
 return Object.freeze({version:1 as const,consentId:c.id,provider:c.provider,operationId:c.operation_id,destination:c.destination,provenance:'untrusted-external' as const,dataClass:connectorOperation(v.provider,v.operationId).dataClass,data});
}

/** Expired read authority has no uncertain external write to preserve. Bounded maintenance. */
export async function cleanupConnectorLookups(db:D1Database,user:string|null=null){
 return db.prepare("DELETE FROM connector_lookup_consents WHERE id IN (SELECT id FROM connector_lookup_consents WHERE expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (? IS NULL OR user_id=?) ORDER BY expires_at,id LIMIT 100)").bind(user,user).run();
}
export async function cancelConnectorLookup(db:D1Database,user:string,id:string){
 const c=await owned(db,user,id);
 if(c.state==='review'||c.state==='confirmed')await db.prepare("UPDATE connector_lookup_consents SET state='void' WHERE id=? AND user_id=? AND state IN ('review','confirmed')").bind(id,user).run();
 return readConnectorLookup(db,user,id);
}

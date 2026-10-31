/** WH-143 single-use, request-bound lookup consent (docs/connectors.md "Request-bound lookup and data-use consent").
 * Issue binds owner, provider, operation, credential, parameter digest and destination for at most 15 minutes. Only the owner,
 * through the WH-105 Chat card, confirms. A read consumes it exactly once. Every query is scoped by owner; another account's row is
 * NOT_FOUND (no existence oracle). `connector-content` is not touched here: its retention is an owner decision. No adapter calls this yet. */
import {connectorCatalog,paramTypes,type ConnectorOperation} from './connector-catalog/catalog';
import {jsonDigest} from './project-specification/v2/json';
import {readInteraction} from './chat-interactions/store';
import {lookupConsentCard} from './chat-interactions/maintained';

export const lookupConsentTtlMs=900000;
export type LookupConsentCode='INVALID'|'NOT_FOUND'|'EXPIRED'|'NOT_CONFIRMED'|'ALREADY_CONFIRMED'|'ALREADY_USED'|'VOIDED'|'MISMATCH'|'LIMIT'|'MODEL_ROUTE'|'CARD';
export class LookupConsentError extends Error {constructor(readonly code:LookupConsentCode){super('Lookup consent '+code);}}
/** Server-owned route record (docs/inference-privacy.md). Only a route recorded as not training and approved for connector content admits model-context. */
export type ModelRoute={trainsOnData:boolean;approvedForConnectorContent:boolean};
/** The current Muse Contributor test route is training-enabled, so real connected content cannot reach it. */
export const currentModelRoute:ModelRoute=Object.freeze({trainsOnData:true,approvedForConnectorContent:false});
export type LookupBinding={provider:string;operationId:string;credentialId:string;params:Record<string,unknown>;destination:string};
export type LookupCard={interactionId:string;definitionDigest:string;cardId:string};
const fail=(code:LookupConsentCode):never=>{throw new LookupConsentError(code);};
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

/** Refuses model-context unless the route is recorded as not training and approved for connector content. */
export function assertModelRoute(destination:string,route:ModelRoute){
 if(destination==='model-context'&&(route.trainsOnData!==false||route.approvedForConnectorContent!==true))fail('MODEL_ROUTE');
}
/** Validates against the frozen catalog (typed params, request-bound read, declared destination); returns the digest of provider, operation and params. */
async function bind(b:LookupBinding,route:ModelRoute){
 const providers=connectorCatalog.providers as Record<string,{operations:Record<string,ConnectorOperation>}|undefined>;
 const op=b&&typeof b==='object'&&typeof b.provider==='string'&&typeof b.operationId==='string'&&Object.hasOwn(providers,b.provider)&&Object.hasOwn(providers[b.provider]!.operations,b.operationId)?providers[b.provider]!.operations[b.operationId]:undefined;
 if(!op||op.kind!=='read'||op.consent!=='request-bound'||!['owner-panel','model-context'].includes(b.destination)||!(op.destinations as readonly string[]).includes(b.destination)||typeof b.credentialId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(b.credentialId))return fail('INVALID');
 const names=Object.keys(op.params),given=b.params;
 if(!given||typeof given!=='object'||Array.isArray(given)||Object.keys(given).length!==names.length||!names.every(n=>Object.hasOwn(given,n)&&paramTypes[op.params[n]](given[n])))return fail('INVALID');
 assertModelRoute(b.destination,route);
 return jsonDigest({provider:b.provider,operation:b.operationId,params:given});
}
type Row={consent_id:string;provider:string;operation_id:string;credential_id:string;params_digest:string;destination:string;expires_at:number;state:string;now:number};
const select=(db:D1Database,owner:string,id:string)=>db.prepare('SELECT consent_id,provider,operation_id,credential_id,params_digest,destination,expires_at,state,unixepoch()*1000 now FROM lookup_consents WHERE owner_id=? AND consent_id=?').bind(owner,id).first<Row>();
/** Why an UPDATE changed nothing, from a fresh owner-scoped read. */
async function refusal(db:D1Database,owner:string,id:string,want:'issued'|'confirmed'):Promise<never>{
 const r=await select(db,owner,id);
 if(!r)return fail('NOT_FOUND');
 if(r.state==='used')return fail('ALREADY_USED');
 if(r.state==='voided')return fail('VOIDED');
 if(r.expires_at<=r.now)return fail('EXPIRED');
 return fail(want==='issued'?'ALREADY_CONFIRMED':'NOT_CONFIRMED');
}

/** Issues an unconfirmed consent for one exact lookup and returns its ID; the owner still has to confirm it in Chat. */
export async function issueLookupConsent(db:D1Database,owner:string,input:LookupBinding,route:ModelRoute=currentModelRoute){
 const digest=await bind(input,route),id=crypto.randomUUID();
 try{
  await db.prepare("INSERT INTO lookup_consents(consent_id,owner_id,provider,operation_id,credential_id,params_digest,destination,created_at,expires_at,state,revision) VALUES(?,?,?,?,?,?,?,unixepoch()*1000,unixepoch()*1000+?,'issued',1)")
   .bind(id,owner,input.provider,input.operationId,input.credentialId,digest,input.destination,lookupConsentTtlMs).run();
 }catch(error){if(String(error).includes('lookup_consent_new'))fail('LIMIT');throw error;}
 return id;
}
/** The consent a card names, after proving the card is the owner's open, unreplaced lookup-consent interaction. Reading never confirms. */
async function cardConsent(db:D1Database,owner:string,card:LookupCard){
 const read=await readInteraction(db,owner,card.interactionId),e=read.envelope,found=lookupConsentCard(e.definition);
 if(!found||read.state!=='open'||read.replacementInteractionId||e.definitionDigest!==card.definitionDigest||card.cardId!==found.cardId)return fail('CARD');
 return found.consentId;
}
/** Owner confirmation, only through the WH-105 card that names this consent. */
export async function confirmLookupConsent(db:D1Database,owner:string,card:LookupCard,route:ModelRoute=currentModelRoute){
 const consentId=await cardConsent(db,owner,card),r=await select(db,owner,consentId);
 if(!r)return fail('NOT_FOUND');
 assertModelRoute(r.destination,route);
 const done=await db.prepare("UPDATE lookup_consents SET state='confirmed',confirmed_at=unixepoch()*1000,revision=revision+1 WHERE owner_id=? AND consent_id=? AND state='issued' AND expires_at>unixepoch()*1000").bind(owner,consentId).run();
 if(done.meta.changes!==1)await refusal(db,owner,consentId,'issued');
}
/** What the card may show: no digest, credential or parameters. */
export async function readLookupConsentSummary(db:D1Database,owner:string,card:LookupCard){
 const r=await select(db,owner,await cardConsent(db,owner,card));
 if(!r)return fail('NOT_FOUND');
 return {version:1 as const,provider:r.provider,operationId:r.operation_id,destination:r.destination,expiresAt:new Date(r.expires_at).toISOString(),state:r.state==='issued'&&r.expires_at<=r.now?'expired':r.state};
}
/** Consumes a confirmed consent exactly once for the identical lookup. The single UPDATE is the gate: it matches only a confirmed,
 * unexpired row with every binding equal, so a replay, expiry or any changed binding changes nothing. */
export async function consumeLookupConsent(db:D1Database,owner:string,consentId:string,input:LookupBinding,route:ModelRoute=currentModelRoute){
 if(typeof consentId!=='string'||!uuid.test(consentId))return fail('INVALID');
 const digest=await bind(input,route),r=await select(db,owner,consentId);
 if(!r)return fail('NOT_FOUND');
 if(r.provider!==input.provider||r.operation_id!==input.operationId||r.credential_id!==input.credentialId||r.params_digest!==digest||r.destination!==input.destination)return fail('MISMATCH');
 const done=await db.prepare("UPDATE lookup_consents SET state='used',settled_at=unixepoch()*1000,revision=revision+1 WHERE owner_id=? AND consent_id=? AND state='confirmed' AND expires_at>unixepoch()*1000 AND provider=? AND operation_id=? AND credential_id=? AND params_digest=? AND destination=?")
  .bind(owner,consentId,input.provider,input.operationId,input.credentialId,digest,input.destination).run();
 if(done.meta.changes!==1)await refusal(db,owner,consentId,'confirmed');
}

/** WH-143 A1: a disconnect voids every open consent the owner holds for that provider, in the disconnect's own committing batch, so a
 * disconnect between confirm and consume makes the consume refuse (VOIDED). Disconnect removes all of the owner's credentials for the
 * provider, so owner and provider select exactly the consents bound to them. Used, voided and other owners' rows are untouched. */
export const voidLookupConsents=(db:D1Database,owner:string,provider:string)=>
 db.prepare("UPDATE lookup_consents SET state='voided',settled_at=unixepoch()*1000,revision=revision+1 WHERE owner_id=? AND provider=? AND state IN ('issued','confirmed')").bind(owner,provider);

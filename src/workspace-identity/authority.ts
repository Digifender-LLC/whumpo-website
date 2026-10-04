import {hashToken} from '../security';

type Database=Pick<D1Database,'prepare'>;
type AuthorityKind='session'|'grant';
type Purpose='workspace'|'enrollment'|'recovery';
type ProofMethod='passkey'|'registration'|'recovery-key'|'recovery-commit';
export type IdentityProof=Readonly<{method:ProofMethod;verifiedAt:number;attemptRevision:number|null;credentialId:string|null}>;
export type IdentityPrincipal=Readonly<{
 accountId:string;authorityId:string;kind:AuthorityKind;purpose:Purpose;policyVersion:1;authEpoch:number;client:'web';
 stage:'enrolling'|'ready'|'recovering';credentialRevision:number;
 attempt:Readonly<{id:string;revision:number}>|null;proof:IdentityProof;expiresAt:number;
}>;
export type IdentityPolicy=Readonly<{purpose:Purpose;freshPasskey:boolean;bindIdentityRevision:boolean}>;
type Row={authority_id:string;kind:AuthorityKind;token_hash:string;account_id:string;purpose:Purpose;policy_version:1;
 auth_epoch:number;client:'web';stage:IdentityPrincipal['stage'];credential_revision:number;attempt_id:string|null;
 attempt_revision:number|null;proof_method:ProofMethod;proof_at:number;proof_revision:number|null;credential_id:string|null;expires_at:number};

// The object returned by the resolver is a server capability for this DB connection.
// Serializing, cloning or constructing the public shape cannot preserve that capability.
const resolved=new WeakMap<IdentityPrincipal,{db:Database;tokenHash:string}>();
export class IdentityError extends Error {
 constructor(readonly status:400|401|403|409|503,readonly code:'invalid_identity_request'|'proof_required'|'identity_incomplete'|'identity_changed'|'client_upgrade_required'|'identity_unavailable'|'request_conflict'|'account_closing',message:string){super(message);this.name='IdentityError';}
}
const proofRequired=()=>new IdentityError(401,'proof_required','Verify your current passkey or recovery proof to continue.');
const changed=()=>new IdentityError(409,'identity_changed','Your account access changed. Verify your current access and review this action again.');
function exactRecord(value:unknown,keys:readonly string[]):value is Record<string,unknown>{
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype
  &&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
}

/** Transport code selects one credential kind explicitly. No second token/policy is tried. */
export async function resolveIdentity(db:Database,input:unknown):Promise<IdentityPrincipal>{
 if(!exactRecord(input,['version','client','kind','token']))throw new IdentityError(400,'invalid_identity_request','Invalid identity request.');
 if(input.version!==1)throw new IdentityError(409,'client_upgrade_required','Update Whumpo to continue.');
 if(input.client!=='web'||(input.kind!=='session'&&input.kind!=='grant'))throw new IdentityError(400,'invalid_identity_request','Invalid identity request.');
 if(typeof input.token!=='string'||! /^[a-f0-9]{64}$/.test(input.token))throw proofRequired();
 const tokenHash=await hashToken(input.token);
 const row=await db.prepare('SELECT * FROM identity_current_authorities WHERE token_hash=? AND kind=?').bind(tokenHash,input.kind).first<Row>();
 if(!row)throw proofRequired();
 const principal:IdentityPrincipal=Object.freeze({accountId:row.account_id,authorityId:row.authority_id,kind:row.kind,purpose:row.purpose,
  policyVersion:row.policy_version,authEpoch:row.auth_epoch,client:row.client,stage:row.stage,credentialRevision:row.credential_revision,
  attempt:row.attempt_id===null?null:Object.freeze({id:row.attempt_id,revision:row.attempt_revision!}),
  proof:Object.freeze({method:row.proof_method,verifiedAt:row.proof_at,attemptRevision:row.proof_revision,credentialId:row.credential_id}),expiresAt:row.expires_at});
 resolved.set(principal,{db,tokenHash});
 return principal;
}

/** Compose into the effect's SQL, alongside ownership, inclusion and exact review predicates.
 * A prior successful assertCurrentIdentity() is not permission to commit a later write. */
export function identityPredicate(db:Database,principal:IdentityPrincipal,policy:IdentityPolicy){
 const source=resolved.get(principal);
 if(!source||source.db!==db)throw proofRequired();
 if(!exactRecord(policy,['purpose','freshPasskey','bindIdentityRevision'])
  ||!['workspace','enrollment','recovery'].includes(policy.purpose as string)
  ||typeof policy.freshPasskey!=='boolean'||typeof policy.bindIdentityRevision!=='boolean'){
  throw new IdentityError(400,'invalid_identity_request','Invalid identity action policy.');
 }
 if(policy.purpose!==principal.purpose)throw new IdentityError(403,'identity_incomplete','Complete the current identity flow before using this action.');
 const clauses=[`authority_id=? AND token_hash=? AND account_id=? AND kind=? AND purpose=?
  AND policy_version=? AND auth_epoch=? AND client=? AND stage=?
  AND proof_method=? AND proof_at=? AND proof_revision IS ? AND credential_id IS ? AND attempt_id IS ? AND expires_at=?`];
 const params:(string|number|null)[]=[principal.authorityId,source.tokenHash,principal.accountId,principal.kind,policy.purpose,
  principal.policyVersion,principal.authEpoch,principal.client,principal.stage,
  principal.proof.method,principal.proof.verifiedAt,principal.proof.attemptRevision,principal.proof.credentialId,principal.attempt?.id??null,principal.expiresAt];
 if(policy.bindIdentityRevision){clauses.push('credential_revision=? AND attempt_revision IS ?');params.push(principal.credentialRevision,principal.attempt?.revision??null);}
 if(policy.freshPasskey)clauses.push("proof_method='passkey' AND proof_at>unixepoch()-600 AND proof_revision IS attempt_revision");
 return {sql:`EXISTS(SELECT 1 FROM identity_current_authorities WHERE ${clauses.join(' AND ')})`,params};
}

/** For protected reads and immediately around external calls. Local writes use the predicate. */
export async function assertCurrentIdentity(db:Database,principal:IdentityPrincipal,policy:IdentityPolicy):Promise<void>{
 const gate=identityPredicate(db,principal,policy);
 if(await db.prepare(`SELECT 1 WHERE ${gate.sql}`).bind(...gate.params).first())return;
 if(policy.freshPasskey){
  const current=identityPredicate(db,principal,{...policy,freshPasskey:false});
  if(await db.prepare(`SELECT 1 WHERE ${current.sql}`).bind(...current.params).first())throw proofRequired();
 }
 throw changed();
}

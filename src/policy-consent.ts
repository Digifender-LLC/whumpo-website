/** WH-016 current policy consent. The Terms of Service, Acceptable Use Policy and Privacy Policy are adopted together as
 * one version (`policy_adoptions`, identified by the SHA-256 of the exact adopted documents). Adoption is an owner/counsel
 * decision and is not seeded by the schema, so until a version is adopted nothing can be accepted and publication and
 * activation are not gated. Once a version is adopted, the owner must accept that exact current version before any site
 * publication or restore, backend publication, application activation or CMS publication; the schema repeats the check
 * at each final write. Consent to an earlier version never satisfies a later one. Withdrawal stays available.
 * Consent is identity-only (no Chat, AI or onboarding dependency) and separate from the US-customer declaration. */
export class PolicyConsentError extends Error {constructor(public status:number,public code:string,message:string){super(message);}}
export const policyConsentPath='/api/policy-consent/v1';
export const policyConsentPage='/workspace/policies';
export const policyConsentMessage=`Review and accept the current Whumpo Terms of Service, Acceptable Use Policy and Privacy Policy before publishing or activating anything. Open ${policyConsentPage}.`;
export const policyDocuments=Object.freeze([
 {id:'terms',title:'Terms of Service',url:'https://digifender.com/legal/whumpo/terms'},
 {id:'acceptable-use',title:'Acceptable Use Policy',url:'https://digifender.com/legal/whumpo'},
 {id:'privacy',title:'Privacy Policy',url:'https://digifender.com/legal/whumpo/privacy'},
]);
type Current={version:string;documents_sha256:string;adopted_at:number};
export type PolicyConsentView={version:1;current:{version:string;documentsSha256:string;adoptedAt:number}|null;accepted:boolean;acceptedAt:number|null;documents:typeof policyDocuments};

export async function readPolicyConsent(db:D1Database,user:string):Promise<PolicyConsentView>{
 const current=await db.prepare('SELECT version,documents_sha256,adopted_at FROM policy_current').first<Current>();
 const consent=current?await db.prepare('SELECT accepted_at FROM policy_consents WHERE user_id=? AND policy_version=?').bind(user,current.version).first<{accepted_at:number}>():null;
 return {version:1,current:current?{version:current.version,documentsSha256:current.documents_sha256,adoptedAt:current.adopted_at}:null,accepted:!!consent,acceptedAt:consent?.accepted_at??null,documents:policyDocuments};
}
/** True when a current version is adopted and this account has not accepted it. */
export async function policyConsentRequired(db:D1Database,user:string){
 return !!await db.prepare('SELECT 1 FROM policy_consent_missing WHERE user_id=?').bind(user).first();
}
/** Raised by the schema gates; lets callers map a concurrent version change to the same clear refusal. */
export const policyConsentRefusal=(error:unknown)=>String(error instanceof Error?error.message:error).includes('policy_consent_required');
/** Accepts exactly the version and documents digest the owner reviewed. A stale version (a newer adoption landed) is
 * refused so the owner reviews the new documents; an exact retry is idempotent. */
export async function acceptPolicy(db:D1Database,user:string,data:unknown){
 const input=data as Record<string,unknown>|null;
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join()!=='documentsSha256,policyVersion,version'||input.version!==1
  ||typeof input.policyVersion!=='string'||!/^[a-z0-9.-]{1,64}$/.test(input.policyVersion)||typeof input.documentsSha256!=='string'||!/^[0-9a-f]{64}$/.test(input.documentsSha256))
  throw new PolicyConsentError(400,'invalid_input','Accept the exact policy version shown on the policies page.');
 const current=await db.prepare('SELECT version,documents_sha256 FROM policy_current').first<Current>();
 if(!current)throw new PolicyConsentError(409,'not_adopted','No policy version has been adopted yet, so there is nothing to accept.');
 if(current.version!==input.policyVersion||current.documents_sha256!==input.documentsSha256)throw new PolicyConsentError(409,'policy_changed','The policies changed. Review the current version before accepting.');
 try{await db.prepare('INSERT INTO policy_consents(user_id,policy_version,documents_sha256,accepted_at) VALUES(?,?,?,unixepoch()) ON CONFLICT(user_id,policy_version) DO NOTHING').bind(user,current.version,current.documents_sha256).run();}
 catch(error){if(String(error).includes('policy_version_stale'))throw new PolicyConsentError(409,'policy_changed','The policies changed. Review the current version before accepting.');throw error;}
 return readPolicyConsent(db,user);
}
export async function policyConsentRoute(db:D1Database,user:string,method:string,data:unknown):Promise<Response>{
 const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
 try{
  if(method==='GET')return new Response(JSON.stringify(await readPolicyConsent(db,user)),{headers});
  if(method==='POST')return new Response(JSON.stringify(await acceptPolicy(db,user,data)),{headers});
  return new Response(JSON.stringify({error:'Method not allowed',code:'method'}),{status:405,headers:{...headers,allow:'GET, POST'}});
 }catch(error){
  if(error instanceof PolicyConsentError)return new Response(JSON.stringify({error:error.message,code:error.code}),{status:error.status,headers});
  throw error;
 }
}
/** Clear refusal before a publication or activation starts; the schema gates repeat it at the final write. */
export async function requirePolicyConsent(db:D1Database,user:string,refuse:(status:number,message:string)=>Error){
 if(await policyConsentRequired(db,user))throw refuse(403,policyConsentMessage);
}

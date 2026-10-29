import {IdentityError} from './authority';

export type IdentityEnvironment=Pick<Env,'DB'|'ENVIRONMENT'|'TURNSTILE_SECRET'>;
export const identityUUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const invalidIdentityRequest=()=>new IdentityError(400,'invalid_identity_request','Invalid identity request.');
export const identityChanged=()=>new IdentityError(409,'identity_changed','Your identity or invitation changed. Read your current progress and start again.');
export const identityUnavailable=()=>new IdentityError(503,'identity_unavailable','Identity verification is temporarily unavailable.');
export function identityRecord(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype
  ||Object.keys(value).length!==keys.length||!keys.every(k=>Object.hasOwn(value,k)))throw invalidIdentityRequest();
 const data=value as Record<string,unknown>;
 if(data.version!==1)throw new IdentityError(409,'client_upgrade_required','Update Whumpo to continue.');
 return data;
}
export function identityRequestContext(request:Request,env:IdentityEnvironment){
 const mode=String(env.ENVIRONMENT);
 if(mode!=='local'&&mode!=='test')throw identityUnavailable();
 const origin=mode==='local'?'http://localhost:8787':'https://whumpo.com',rpID=new URL(origin).hostname;
 if(request.method!=='POST'||request.headers.get('origin')!==origin||new URL(request.url).origin!==origin)throw invalidIdentityRequest();
 return {origin,rpID};
}
export function identityDatabaseError(error:unknown):never{
 if(error instanceof IdentityError)throw error;
 if(/identity_request_conflict/.test(String(error)))throw new IdentityError(409,'request_conflict','This request ID already belongs to a different change.');
 if(/UNIQUE|FOREIGN KEY|CHECK constraint|identity_.*limit|user_quota|users_email_new/.test(String(error)))throw identityChanged();
 throw identityUnavailable();
}

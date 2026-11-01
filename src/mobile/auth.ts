// Bearer authority for /api/mobile/v1 only. The token is 256-bit hex, compared by its SHA-256 (resolveIdentity), never logged or echoed.
import {IdentityError,resolveIdentity,type IdentityPrincipal} from '../workspace-identity/authority';
import {MobileError,signin,type MobileCode} from './transport';

const bearer=/^Bearer ([a-f0-9]{64})$/;
/** The presented token, or null when the header is absent or not a 256-bit hex bearer. */
export const bearerToken=(request:Request)=>bearer.exec(request.headers.get('authorization')??'')?.[1]??null;
export async function mobilePrincipal(db:D1Database,token:string):Promise<IdentityPrincipal>{
 // Resolved with client 'android': a web session token (or a grant) is simply not found here.
 try{return await resolveIdentity(db,{version:1,client:'android',kind:'session',token});}
 catch(error){throw mapIdentityError(error,signin());}
}
const codes:Record<IdentityError['code'],MobileCode>={invalid_identity_request:'invalid_request',proof_required:'proof_required',identity_incomplete:'identity_incomplete',
 identity_changed:'identity_changed',client_upgrade_required:'client_update_required',identity_unavailable:'unavailable',request_conflict:'request_conflict',account_closing:'unavailable'};
/** Maps a domain failure into the mobile vocabulary; `proof` overrides what a proof_required carries (reauth failures ask for a fresh passkey, not sign-in). */
export function mapIdentityError(error:unknown,proof:MobileError):unknown{
 if(!(error instanceof IdentityError))return error;
 const code=codes[error.code];
 return code==='proof_required'?proof:new MobileError(code);
}

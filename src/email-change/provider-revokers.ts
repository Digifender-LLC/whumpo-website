/** WH-203 ProviderRevoker adapters over the existing GitHub and Cloudflare revocation (contract version 1,
 * docs/email-change-and-compromise.md section 3.1). Pure and unwired: every effect goes through injected seams, so this
 * file imports nothing from the Worker, D1, the connection vault or the existing connection modules.
 *
 * - `transport` is the provider call (the same `(url, init)` shape as the existing modules' `transport` parameter). Each
 *   adapter sends exactly the request the existing single-token revocation sends: GitHub
 *   `DELETE https://api.github.com/applications/{client_id}/token` (cleanupGitHub in src/github-connection.ts) and
 *   Cloudflare RFC 7009 `POST https://dash.cloudflare.com/oauth2/revoke` once per known token (cleanupCloudflare in
 *   src/cloudflare-connection.ts), with `redirect: 'manual'` and a ten-second deadline.
 * - `open` is the only place a held credential is decrypted. The WH-201 wiring reads the vault rows and unseals them
 *   with the existing purpose strings; this file never sees ciphertext or a key.
 * - `observe` receives one content-free event per revoke call: provider, connection ID, token hints, HTTP statuses and
 *   the outcome. Never a token, client secret, authorization header or response body.
 *
 * Receipt rules, mirroring what the existing code treats as revoked:
 * - GitHub: only an exact, non-redirected `204` to the single-token deletion. When the credential set also retains a
 *   separately encrypted refresh credential (github_refresh_custody), that `204` only revokes the access token, exactly as
 *   cleanupGitHub records `access_revoked_at` and keeps the refresh obligation. The adapter then reports
 *   `access-revoked-refresh-held`, which the dispatcher holds as an unknown outcome. It never sends the app-wide grant
 *   deletion: that broader effect needs the owner's separate reviewed consent (src/github-grant-revocation.ts), and its
 *   saved `204` receipt is reconciliation evidence (githubReconcileEvidence).
 * - Cloudflare: `revoked` only when every known token (access, then refresh) gets an exact, non-redirected `200`.
 * - Anything else after a request was sent (another status, a redirect, a throw, a timeout, a partial set) is
 *   `unknown`. The dispatcher records it as `uncertain` and never sends again. `not-revoked` is returned only when
 *   nothing was sent (no credential could be opened, or it belongs to another app client), which leaves the retired
 *   credential queued.
 * This is stricter than the existing background cleaners, which retry a non-receipt reply under their claim lease. */
import type {ProviderRevoker,ReconcileEvidence} from './revocation';

/** The part of a fetch Response the adapters read. */
export type ProviderReply={status:number;redirected?:boolean;type?:string;body?:{cancel():Promise<unknown>}|null};
export type RevocationRequest={method:'DELETE'|'POST';headers:Record<string,string>;body:string;redirect:'manual';signal:AbortSignal};
export type ProviderTransport=(url:string,init:RevocationRequest)=>Promise<ProviderReply>;
export const adapterOutcomes=Object.freeze(['revoked','not-revoked','unknown','access-revoked-refresh-held','refresh-held','grant-pending','unrecognized'] as const);
export type AdapterOutcome=typeof adapterOutcomes[number];
export type RevokerEvent={provider:'github'|'cloudflare';connectionId:string;calls:{hint:'access_token'|'refresh_token';status:number|null}[];outcome:AdapterOutcome};
export type RevokerRequest={provider:string;connectionId:string};

/** The existing modules' request deadline. */
export const revokeTimeoutMs=10000;
const clientPattern=/^[A-Za-z0-9_.-]{1,128}$/;
/** An exact provider status: the one reply, not a followed or manual redirect. */
const exact=(reply:ProviderReply|null|undefined,status:number)=>!!reply&&typeof reply==='object'&&reply.status===status&&reply.redirected!==true&&reply.type!=='opaqueredirect';
const discard=(reply:ProviderReply|null|undefined)=>{try{void reply?.body?.cancel().catch(()=>{});}catch{/* the body is never read */}};
const configured=(clientId:unknown,clientSecret:unknown,provider:string)=>{
 if(typeof clientId!=='string'||!clientPattern.test(clientId)||typeof clientSecret!=='string'||!clientSecret)throw new Error(`${provider} revoker is not configured`);
};
function reporter(provider:RevokerEvent['provider'],observe:((event:RevokerEvent)=>void)|undefined){
 return (connectionId:string,calls:RevokerEvent['calls'],outcome:AdapterOutcome):AdapterOutcome=>{
  try{observe?.({provider,connectionId,calls:calls.map(c=>({hint:c.hint,status:c.status})),outcome});}catch{/* observation never changes the outcome */}
  return outcome;
 };
}
async function opened<T>(open:(connectionId:string)=>Promise<T|null>|T|null,connectionId:string):Promise<T|null> {
 try{return await open(connectionId);}catch{return null;}
}

/** What the WH-201 wiring opens for one GitHub vault row: the decrypted access token, the app client it was issued to
 * (github_refresh_custody.client_id, or the configured client for a token without custody) and the custody facts.
 * The refresh credential itself is never opened: no adapter call sends it. */
export type GitHubHeldCredential={
 clientId:string;accessToken:string;
 /** A github_refresh_custody row exists for this token. */
 refreshHeld:boolean;
 /** github_refresh_custody.access_revoked_at is set: an earlier exact 204 already revoked the access token. */
 accessRevoked:boolean;
 /** A reviewed grant deletion naming this token is dispatching or uncertain (the existing cleanup fence). */
 grantPending:boolean;
};
export type GitHubRevokerOptions={clientId:string;clientSecret:string;transport:ProviderTransport;
 open:(connectionId:string)=>Promise<GitHubHeldCredential|null>|GitHubHeldCredential|null;observe?:(event:RevokerEvent)=>void};
/** Header values of the existing GitHub client (apiHeaders in src/github-connection.ts). */
export const githubRevocationHeaders=Object.freeze({'accept':'application/vnd.github+json','x-github-api-version':'2026-03-10','user-agent':'Whumpo-test'});

export function createGitHubRevoker({clientId,clientSecret,transport,open,observe}:GitHubRevokerOptions) {
 configured(clientId,clientSecret,'GitHub');
 const report=reporter('github',observe);
 return {
  async revoke({provider,connectionId}:RevokerRequest):Promise<AdapterOutcome>{
   if(provider!=='github')return report(connectionId,[],'unrecognized');
   const held=await opened(open,connectionId);
   // Nothing is sent: an unreadable credential, or one issued to another app client (the existing cleaners skip it too).
   if(!held||typeof held!=='object'||typeof held.accessToken!=='string'||!held.accessToken||held.clientId!==clientId)return report(connectionId,[],'not-revoked');
   // The reviewed app-wide deletion owns this credential set; its saved receipt settles it, never a second call.
   if(held.grantPending===true)return report(connectionId,[],'grant-pending');
   // The access token is already revoked; only the reviewed grant deletion can settle the retained refresh credential.
   if(held.accessRevoked===true)return report(connectionId,[],'refresh-held');
   let reply:ProviderReply;
   try{
    reply=await transport('https://api.github.com/applications/'+clientId+'/token',{method:'DELETE',
     headers:{...githubRevocationHeaders,authorization:'Basic '+btoa(clientId+':'+clientSecret),'content-type':'application/json'},
     body:JSON.stringify({access_token:held.accessToken}),redirect:'manual',signal:AbortSignal.timeout(revokeTimeoutMs)});
   }catch{return report(connectionId,[{hint:'access_token',status:null}],'unknown');}
   discard(reply);
   const status=typeof reply?.status==='number'?reply.status:null;
   if(!exact(reply,204))return report(connectionId,[{hint:'access_token',status}],'unknown');
   // A single-token 204 never settles a retained refresh credential.
   return report(connectionId,[{hint:'access_token',status}],held.refreshHeld===false?'revoked':'access-revoked-refresh-held');
  },
 } satisfies ProviderRevoker;
}

/** github_grant_revocations as stored (schema/platform.sql). */
export type GitHubGrantRow={user_id:string;client_id:string;token_ids:string;state:string;http_status:number|null};
/** Read-only reconciliation for a held GitHub credential: the saved receipt of a reviewed grant deletion that named this
 * exact token and app client. The schema admits `revoked` only with the direct `204`, so it is authenticated provider
 * evidence. Returns null when no such receipt exists: nothing is proven and no provider is called. */
export function githubReconcileEvidence({userId,clientId,tokenId,grants}:{userId:string;clientId:string;tokenId:string;grants:readonly GitHubGrantRow[]}):ReconcileEvidence|null {
 for(const grant of grants){
  let ids:unknown;
  try{ids=JSON.parse(grant.token_ids);}catch{continue;}
  if(grant.state==='revoked'&&grant.http_status===204&&grant.user_id===userId&&grant.client_id===clientId&&Array.isArray(ids)&&ids.includes(tokenId))
   return {authenticated:true,result:'revoked'};
 }
 return null;
}

/** What the WH-201 wiring opens for one Cloudflare vault row: the decrypted `{access, refresh?}` pair the existing
 * module seals as JSON. */
export type CloudflareHeldCredential={access:string;refresh?:string|null};
export type CloudflareRevokerOptions={clientId:string;clientSecret:string;transport:ProviderTransport;
 open:(connectionId:string)=>Promise<CloudflareHeldCredential|null>|CloudflareHeldCredential|null;observe?:(event:RevokerEvent)=>void};

export function createCloudflareRevoker({clientId,clientSecret,transport,open,observe}:CloudflareRevokerOptions) {
 configured(clientId,clientSecret,'Cloudflare');
 const report=reporter('cloudflare',observe);
 const authorization='Basic '+btoa(encodeURIComponent(clientId)+':'+encodeURIComponent(clientSecret));
 return {
  async revoke({provider,connectionId}:RevokerRequest):Promise<AdapterOutcome>{
   if(provider!=='cloudflare')return report(connectionId,[],'unrecognized');
   const held=await opened(open,connectionId);
   if(!held||typeof held!=='object'||typeof held.access!=='string'||!held.access)return report(connectionId,[],'not-revoked');
   const tokens=([[held.access,'access_token'],[held.refresh,'refresh_token']] as const).filter((x):x is readonly [string,'access_token'|'refresh_token']=>typeof x[0]==='string'&&x[0].length>0);
   const calls:RevokerEvent['calls']=[];
   let complete=true;
   for(const [token,hint] of tokens){
    let reply:ProviderReply;
    try{
     reply=await transport('https://dash.cloudflare.com/oauth2/revoke',{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded',authorization},
      body:new URLSearchParams({token,token_type_hint:hint}).toString(),redirect:'manual',signal:AbortSignal.timeout(revokeTimeoutMs)});
    }catch{calls.push({hint,status:null});return report(connectionId,calls,'unknown');}
    discard(reply);
    calls.push({hint,status:typeof reply?.status==='number'?reply.status:null});
    if(!exact(reply,200))complete=false;
   }
   return report(connectionId,calls,complete?'revoked':'unknown');
  },
 } satisfies ProviderRevoker;
}

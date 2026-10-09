/** WH-203 mapping of the existing connection states onto the revocation holds of revocation.ts (contract version 1,
 * docs/email-change-and-compromise.md section 3.1). Pure and read-only: it takes rows exactly as the current schema
 * stores them (schema/platform.sql, snake_case columns) and returns ProviderConnection records. It adds no table and
 * writes nothing; WH-201 decides where the compromise hold itself is stored.
 *
 * One ProviderConnection per held credential row (a GitHub or Cloudflare vault row), because revocation, receipts and
 * erasure are per credential. Its ID is `gh-<vault id>` or `cf-<vault id>`. A state the schema does not define is
 * refused rather than guessed.
 *
 * GitHub (github_token_vault, github_connections, github_refresh_custody, github_revocation_claims,
 * github_grant_revocations):
 * - a reviewed grant deletion naming the token: `dispatching` or `uncertain` as saved; `revoked` (its direct 204) is a
 *   receipt that permits erasure; `review` and `cancelled` changed nothing;
 * - `revoking` with refresh custody whose access token was already revoked (access_revoked_at): `uncertain`, because
 *   only the reviewed grant deletion can settle the retained refresh credential;
 * - `revoking` with an unexpired cleanup claim: `dispatching`; otherwise `queued`;
 * - `active`: no revocation; local access is active only for the connection's unexpired active token.
 * Cloudflare (cloudflare_token_vault): `revoking` with an unexpired revoke lease is `dispatching`, otherwise `queued`;
 * `active` and `staged` have no revocation.
 * connection_oauth_exchanges rows are lost token responses with no credential to revoke. They are reported separately
 * as unresolved exchanges, which also block account closure. */
import {check} from './policy';
import {closureHolds} from './revocation';
import type {ProviderConnection,RevocationReceipt,RevocationState} from './revocation';

export const githubCredentialStates=Object.freeze(['active','revoking'] as const);
export const githubGrantStates=Object.freeze(['review','dispatching','uncertain','revoked','cancelled'] as const);
export const cloudflareCredentialStates=Object.freeze(['staged','active','revoking'] as const);

export type GitHubVaultRow={id:string;user_id:string;expires_at:string;state:string};
export type GitHubCustodyRow={token_id:string;user_id:string;client_id:string;access_revoked_at:string|null};
export type GitHubClaimRow={token_id:string;expires_at:string};
export type GitHubGrantStateRow={user_id:string;token_ids:string;state:string;settled_at:string|null};
export type GitHubStateRows={
 connection:{user_id:string;active_token_id:string|null}|null;tokens:readonly GitHubVaultRow[];custody:readonly GitHubCustodyRow[];
 claims:readonly GitHubClaimRow[];grants:readonly GitHubGrantStateRow[];
};
export type CloudflareVaultRow={id:string;user_id:string;expires_at:string;state:string;revoke_after:string|null};
export type ExchangeRow={token_id:string;user_id:string;provider:string};

const vaultId=(value:unknown)=>{check(typeof value==='string'&&/^[A-Za-z0-9-]{1,61}$/.test(value),'UNKNOWN_STATE','vault id');return value;};
const iso=(now:number)=>new Date(now).toISOString();
const held=(accountId:string,connectionId:string,provider:string,access:'active'|'disabled',state:RevocationState,receipt:RevocationReceipt|null=null):ProviderConnection=>
 ({connectionId,accountId,provider,access,credentialHeld:true,revocation:{state,attempts:0,reads:0,since:null,receipt},revision:1});
const tokenIds=(value:string)=>{try{const ids:unknown=JSON.parse(value);return Array.isArray(ids)?ids:[];}catch{return [];}};

/** The account's GitHub credentials as revocation holds. Rows of another owner are refused. */
export function githubConnectionHolds({accountId,rows,now}:{accountId:string;rows:GitHubStateRows;now:number}):ProviderConnection[] {
 const at=iso(now);
 check(rows.connection===null||rows.connection.user_id===accountId,'FOREIGN_ROW','github_connections');
 return rows.tokens.map(token=>{
  check(token.user_id===accountId,'FOREIGN_ROW','github_token_vault');
  check((githubCredentialStates as readonly string[]).includes(token.state),'UNKNOWN_STATE',token.state);
  const id=vaultId(token.id),connectionId=`gh-${id}`;
  const grants=rows.grants.filter(g=>{
   check(g.user_id===accountId,'FOREIGN_ROW','github_grant_revocations');
   check((githubGrantStates as readonly string[]).includes(g.state),'UNKNOWN_STATE',g.state);
   return tokenIds(g.token_ids).includes(id);
  });
  const settled=grants.find(g=>g.state==='revoked');
  if(settled)return held(accountId,connectionId,'github','disabled','revoked',{connectionId,at:Date.parse(settled.settled_at??'')||now,evidence:'reconciled'});
  if(grants.some(g=>g.state==='uncertain'))return held(accountId,connectionId,'github','disabled','uncertain');
  if(grants.some(g=>g.state==='dispatching'))return held(accountId,connectionId,'github','disabled','dispatching');
  if(token.state==='active'){
   const current=rows.connection?.active_token_id===id&&token.expires_at>at;
   return held(accountId,connectionId,'github',current?'active':'disabled','none');
  }
  const custody=rows.custody.find(c=>c.token_id===id);
  if(custody){check(custody.user_id===accountId,'FOREIGN_ROW','github_refresh_custody');if(custody.access_revoked_at!==null)return held(accountId,connectionId,'github','disabled','uncertain');}
  if(rows.claims.some(c=>c.token_id===id&&c.expires_at>at))return held(accountId,connectionId,'github','disabled','dispatching');
  return held(accountId,connectionId,'github','disabled','queued');
 });
}

/** The account's Cloudflare credentials as revocation holds. Rows of another owner are refused. */
export function cloudflareConnectionHolds({accountId,tokens,now}:{accountId:string;tokens:readonly CloudflareVaultRow[];now:number}):ProviderConnection[] {
 const at=iso(now);
 return tokens.map(token=>{
  check(token.user_id===accountId,'FOREIGN_ROW','cloudflare_token_vault');
  check((cloudflareCredentialStates as readonly string[]).includes(token.state),'UNKNOWN_STATE',token.state);
  const connectionId=`cf-${vaultId(token.id)}`;
  if(token.state==='active')return held(accountId,connectionId,'cloudflare',token.expires_at>at?'active':'disabled','none');
  if(token.state==='staged')return held(accountId,connectionId,'cloudflare','disabled','none');
  return held(accountId,connectionId,'cloudflare','disabled',token.revoke_after!==null&&token.revoke_after>at?'dispatching':'queued');
 });
}

/** What blocks account closure among provider connections: revocation holds (closureHolds), credentials still live
 * (closure must queue their revocation first) and unresolved token exchanges (no credential, provider recovery needed). */
export function connectionClosureBlockers({accountId,connections,exchanges}:{accountId:string;connections:readonly ProviderConnection[];exchanges:readonly ExchangeRow[]}) {
 const own=connections.filter(c=>c.accountId===accountId);
 const unresolved=exchanges.filter(x=>x.user_id===accountId).map(x=>{
  check(x.provider==='github'||x.provider==='cloudflare','UNKNOWN_STATE',x.provider);
  return `exchange-${x.provider}-${vaultId(x.token_id)}`;
 }).sort();
 const holds=closureHolds(own),live=own.filter(c=>c.credentialHeld&&c.revocation.state==='none').map(c=>c.connectionId).sort();
 return {holds,live,exchanges:unresolved,blocked:holds.length+live.length+unresolved.length>0};
}

/** The connection metrics of the existing account-closure inventory (tools/account-closure-inventory.mjs) that block
 * closure while non-zero. */
export const closureInventoryConnectionMetrics=Object.freeze(['githubCredentials','cloudflareCredentials','githubRefreshCustody','githubGrantUncertain','unresolvedConnectionExchanges'] as const);
export function closureInventoryConnectionHolds(counts:Readonly<Record<string,unknown>>):string[] {
 return closureInventoryConnectionMetrics.filter(name=>{
  const n=counts[name];
  check(typeof n==='number'&&Number.isSafeInteger(n)&&n>=0,'UNKNOWN_STATE',name);
  return n>0;
 });
}

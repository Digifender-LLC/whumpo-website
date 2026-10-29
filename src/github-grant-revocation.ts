import {reviewedReplyGuard,type ReviewedReply} from './chat-review-receipts';
import {admitWithTurnover,compactedReview} from './review-turnover';
import {ConnectionError,type GitHubConfig} from './github-connection';
import type {GitHubGrantReview} from './github-grant-shape';
export type {GitHubGrantReview} from './github-grant-shape';
import {unseal} from './connection-vault';
import {requireFreshWorkspace,githubGrantCustody,workspaceTransport} from './workspace-identity/admission';

type Review={id:string;user_id:string;client_id:string;github_user_id:string;login:string;token_id:string;token_ids:string;state:'review'|'dispatching'|'uncertain'|'revoked'|'cancelled';created_at:string;expires_at:string;dispatched_at:string|null;settled_at:string|null};
const validID=(id:string)=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id);
const changed=()=>new ConnectionError(409,'GitHub authorization changed or has unresolved work. Refresh the connection and prepare a new review.');
const view=(r:Review):GitHubGrantReview=>({id:r.id,state:r.state==='review'&&r.expires_at<=new Date().toISOString()?'expired':r.state,githubUserId:r.github_user_id,login:r.login,credentialCount:(JSON.parse(r.token_ids) as string[]).length,expiresAt:r.expires_at,settledAt:r.settled_at,scope:'all-app-access' as const,disclosure:'Revoke all access granted to this Whumpo GitHub App for this GitHub account, including other authorizations outside this workspace. Repository files and the app installation are not deleted. You must authorize the app again before connecting. An uncertain result will require operator recovery.'});
async function owned(db:D1Database,user:string,id:string){
 if(!validID(id))throw new ConnectionError(400,'Choose a saved GitHub access review.');
 const row=await db.prepare('SELECT * FROM github_grant_revocations WHERE id=? AND user_id=?').bind(id,user).first<Review>();
 if(!row)throw await compactedReview(db,'github_grant_revocations',id,user,(s,m)=>new ConnectionError(s,m))??new ConnectionError(404,'GitHub access review not found.');return row;
}
export async function githubGrantReviews(db:D1Database,user:string){
 const {results}=await db.prepare('SELECT * FROM github_grant_revocations WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(user).all<Review>();return {reviews:results.map(view)};
}
export async function readGitHubGrant(db:D1Database,user:string,id:string){return view(await owned(db,user,id));}
export async function reviewGitHubGrant(db:D1Database,user:string,id:string,config:GitHubConfig|undefined){
 if(!validID(id))throw new ConnectionError(400,'Choose a unique GitHub access review ID.');
 const old=await db.prepare('SELECT * FROM github_grant_revocations WHERE id=? AND user_id=?').bind(id,user).first<Review>();if(old)return view(old);
 const gone=await compactedReview(db,'github_grant_revocations',id,user,(s,m)=>new ConnectionError(s,m));if(gone)throw gone;
 if(!config)throw new ConnectionError(503,'GitHub connection is not configured.');
 const current=await db.prepare("SELECT c.github_user_id,c.login,t.id FROM github_connections c JOIN github_token_vault t ON t.id=c.active_token_id JOIN github_refresh_custody r ON r.token_id=t.id WHERE c.user_id=? AND t.user_id=? AND t.state='active' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND r.client_id=? AND r.github_user_id=c.github_user_id").bind(user,user,config.clientId).first<{github_user_id:string;login:string;id:string}>();
 if(!current)throw changed();
 const rows=await db.prepare('SELECT token_id FROM github_refresh_custody WHERE user_id=? AND client_id=? AND github_user_id=? ORDER BY token_id').bind(user,config.clientId,current.github_user_id).all<{token_id:string}>();
 const created=new Date().toISOString(),expires=new Date(Date.now()+600000).toISOString();
 try{await admitWithTurnover(db,'github_grant_revocations',{user},db.prepare("INSERT INTO github_grant_revocations(id,user_id,client_id,github_user_id,login,token_id,token_ids,state,created_at,expires_at) VALUES(?,?,?,?,?,?,?,'review',?,?)").bind(id,user,config.clientId,current.github_user_id,current.login,current.id,JSON.stringify(rows.results.map(r=>r.token_id)),created,expires));}
 catch{const saved=await db.prepare('SELECT * FROM github_grant_revocations WHERE id=? AND user_id=? AND client_id=? AND token_id=? AND token_ids=?').bind(id,user,config.clientId,current.id,JSON.stringify(rows.results.map(r=>r.token_id))).first<Review>();if(saved)return view(saved);throw changed();}
 return view(await owned(db,user,id));
}
export async function cancelGitHubGrant(db:D1Database,user:string,id:string){
 const review=await owned(db,user,id);if(review.state!=='review')return view(review);
 await db.prepare("UPDATE github_grant_revocations SET state='cancelled' WHERE id=? AND user_id=? AND state='review'").bind(id,user).run();return view(await owned(db,user,id));
}
export async function confirmGitHubGrant(db:D1Database,user:string,id:string,confirmation:string,config:GitHubConfig|undefined,transport:typeof fetch=fetch,reviewed?:ReviewedReply){
 const review=await owned(db,user,id);if(review.state!=='review')return view(review);
 if(confirmation!=='REVOKE_APP_ACCESS')throw new ConnectionError(400,'Explicitly confirm the reviewed app-wide GitHub access removal.');
 if(!config||config.clientId!==review.client_id)throw changed();
 await requireFreshWorkspace(db,user);
 const token=await db.prepare("SELECT ciphertext FROM github_token_vault WHERE id=? AND user_id=? AND state='active' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(review.token_id,user).first<{ciphertext:string}>();if(!token)throw changed();
 const access=await unseal(config.key,`whumpo:github:token:${user}:${review.token_id}`,token.ciphertext),custody=await githubGrantCustody(db,user,id);
 let claimed;const guard=reviewedReplyGuard(user,reviewed);
 try{const results=await db.batch([
  db.prepare("UPDATE github_grant_revocations SET state='dispatching',dispatched_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND user_id=? AND state='review'"+guard.sql).bind(id,user,...guard.params),
  db.prepare("UPDATE github_connections SET active_token_id=NULL WHERE user_id=? AND active_token_id IN (SELECT value FROM github_grant_revocations a,json_each(a.token_ids) WHERE a.id=? AND a.state='dispatching')").bind(user,id),
  db.prepare("UPDATE github_token_vault SET state='revoking' WHERE user_id=? AND id IN (SELECT value FROM github_grant_revocations a,json_each(a.token_ids) WHERE a.id=? AND a.state='dispatching')").bind(user,id),
 ]);claimed=results[0].meta.changes===1;}
 catch{const state=await owned(db,user,id);if(state.state!=='review')return view(state);throw changed();}
 if(!claimed)return view(await owned(db,user,id));
 // The claim is the sole dispatch capability. A lost claim reply, retry or
 // uncertain provider response only reads the saved receipt; it never sends again.
 try{
  const response=await workspaceTransport(db,user,transport)('https://api.github.com/applications/'+config.clientId+'/grant',{method:'DELETE',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{accept:'application/vnd.github+json','x-github-api-version':'2026-03-10','user-agent':'Whumpo-test',authorization:'Basic '+btoa(config.clientId+':'+config.clientSecret),'content-type':'application/json'},body:JSON.stringify({access_token:access})});
  void response.body?.cancel().catch(()=>{});
  if(response.status===204&&!response.redirected)await custody.revoked();else await custody.uncertain();
 }catch{await custody.uncertain();}
 return view(await owned(db,user,id));
}

import {isConnectionHandoff,type ConnectionHandoff,type ConnectionProvider} from '../connection-handoff-shape';
import {assertWorkspace,workspacePrincipal} from '../workspace-identity/admission';
import {assertFeature,featurePredicate} from '../feature-admission';
import {hashToken} from '../security';
import {ConnectionError,connectionStatus,type GitHubConfig} from '../github-connection';
import {cloudflareStatus,type CloudflareConfig} from '../cloudflare-connection';
import {connectionIntakeProvider} from './maintained';
import {readInteraction,InteractionStoreError} from './store';
import {InteractionError} from './protocol';

export function connectionStartInput(input:unknown):ConnectionHandoff|null{
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).join(',')!=='handoff')throw new ConnectionError(400,'Read the current connection controls before continuing.');
 const handoff=(input as {handoff:unknown}).handoff;
 if(handoff!==null&&!isConnectionHandoff(handoff))throw new ConnectionError(400,'Read the current connection controls before continuing.');
 return handoff;
}
async function readHandoff(db:D1Database,user:string,provider:ConnectionProvider,handoff:ConnectionHandoff){
 if(!isConnectionHandoff(handoff))throw new ConnectionError(400,'Invalid connection handoff.');
 try{
  const form=await readInteraction(db,user,handoff.interactionId);
  if(form.envelope.definitionDigest!==handoff.definitionDigest||connectionIntakeProvider(form.envelope.definition)!==provider)throw new ConnectionError(409,'This connection handoff changed. Ask for a new one.');
  return form;
 }catch(error){
  if(error instanceof InteractionStoreError||error instanceof InteractionError)throw new ConnectionError(409,'This connection handoff is no longer available. Ask for a new one.');
  throw error;
 }
}
/** Fresh admission plus an atomic predicate for the existing OAuth state INSERT. */
export async function prepareConnectionHandoff(db:D1Database,user:string,provider:ConnectionProvider,handoff:ConnectionHandoff|null){
 await assertWorkspace(db,user);
 if(handoff===null)return {sql:'1',params:[] as unknown[],json:'null'};
 const form=await readHandoff(db,user,provider,handoff);
 if(form.state!=='open'||form.replacementInteractionId)throw new ConnectionError(409,'This connection handoff is closed. Ask for a new one.');
 const scope={userId:user,projectId:form.envelope.scope.projectId,featureId:'core.editing' as const,operation:'prepare' as const};
 await assertFeature(db,scope);const gate=featurePredicate(db,scope);
 return {json:JSON.stringify(handoff),sql:`(${gate.sql}) AND EXISTS(SELECT 1 FROM chat_interactions i WHERE i.id=? AND i.user_id=? AND i.definition_digest=? AND i.state='open' AND i.removed_at IS NULL AND i.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (i.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=i.project_id AND p.owner_user_id=i.user_id)) AND NOT EXISTS(SELECT 1 FROM chat_interactions child WHERE child.previous_interaction_id=i.id))`,params:[...gate.params,handoff.interactionId,user,handoff.definitionDigest]};
}
/** Saved metadata only: no token decryption, provider read or automatic continuation. */
export async function readConnectionHandoff(db:D1Database,user:string,provider:ConnectionProvider,handoff:ConnectionHandoff,config:{github?:GitHubConfig;cloudflare?:CloudflareConfig}){
 const form=await readHandoff(db,user,provider,handoff);
 const status=provider==='github'?(await connectionStatus(db,user,config.github)).github:await cloudflareStatus(db,user,config.cloudflare);
 const current=await readHandoff(db,user,provider,handoff);await assertWorkspace(db,user);
 return {version:1,provider,handoff,observedAt:new Date().toISOString(),canStart:form.state==='open'&&current.state==='open'&&!current.replacementInteractionId,status};
}
/** The saved, session-bound OAuth state supplies navigation only. Never accept a redirect URL. */
export async function connectionReturnPath(db:D1Database,user:string,provider:ConnectionProvider,state:string){
 const base='/workspace/?connection='+provider;
 if(!/^[0-9a-f]{64}$/.test(state))return base;
 const table=provider==='github'?'github_oauth_states':'cloudflare_oauth_states';
 const saved=await db.prepare(`SELECT handoff_json FROM ${table} WHERE user_id=? AND authority_id=? AND state_hash=?`).bind(user,workspacePrincipal(db,user).authorityId,await hashToken(state)).first<{handoff_json:string}>();
 if(!saved)return base;
 const handoff:unknown=JSON.parse(saved.handoff_json);
 return isConnectionHandoff(handoff)?base+'&interaction='+handoff.interactionId:base;
}

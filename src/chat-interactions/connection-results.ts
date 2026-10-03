import {readModelSubmission} from './task-context';
import {connectionStatus,type GitHubConfig} from '../github-connection';
import {cloudflareStatus,type CloudflareConfig} from '../cloudflare-connection';
import {describeSavedConnection} from '../connection-chat';
import {assertFeature,featurePredicate,connectionFeature} from '../feature-admission';
import type {ConnectionProvider} from '../connection-handoff-shape';
import {interactionGuard,InteractionStoreError} from './store';
import {draftRetentionDue} from './retention';

export type ConnectionReadOptions={github?:GitHubConfig;config?:CloudflareConfig};
export type TaskConnectionRequest={kind:'interaction';operation:'connectionStatus';taskId:string;submissionId:string;projectId:string;providers:ConnectionProvider[]};

// Only retained consent cards issued by this exact submitted task. These are
// provider-name locators, never consent evidence or connected-account content.
const taskProviders=`FROM chat_interactions i
 JOIN chat_turns t ON t.id=i.origin_turn_id AND t.user_id=i.user_id AND t.status='completed'
 JOIN chat_task_progress step ON step.turn_id=t.id AND step.user_id=t.user_id
 JOIN projects p ON p.id=i.project_id AND p.owner_user_id=i.user_id
 WHERE i.user_id=? AND i.project_id=? AND step.task_id=?
  AND i.removed_at IS NULL AND NOT (${draftRetentionDue})
  AND json_extract(i.envelope_json,'$.definition.kind')='view'
  AND json_extract(i.envelope_json,'$.definition.template')='status@1'
  AND json_array_length(i.envelope_json,'$.definition.cards')=1
  AND json_extract(i.envelope_json,'$.definition.cards[0].id')='connection-consent'
  AND json_extract(i.envelope_json,'$.definition.cards[0].display')='consent'`;

export async function taskConnectionProviders(db:D1Database,user:string,taskId:string,projectId:string):Promise<ConnectionProvider[]>{
 const rows=await db.prepare(`SELECT DISTINCT json_extract(i.envelope_json,'$.definition.cards[0].binding') binding ${taskProviders} ORDER BY binding`).bind(user,projectId,taskId).all<{binding:string}>();
 return rows.results.flatMap(({binding}):ConnectionProvider[]=>binding==='connection.github@1'?['github']:binding==='connection.cloudflare@1'?['cloudflare']:[]);
}

/** A transient fingerprint of the fields used by the existing saved-status
 * readers. Never decrypt credentials or expose this fingerprint to inference,
 * history, logs or clients. Time-dependent predicates fence expiry at commit. */
function statusSnapshot(db:D1Database,user:string,provider:ConnectionProvider){
 const connect=featurePredicate(db,connectionFeature(user,provider,null,'connect')),read=featurePredicate(db,connectionFeature(user,provider,null,'read'));
 const current=provider==='github'
  ? `SELECT json_object('login',c.login,'token',c.active_token_id,'state',t.state,'expires',t.expires_at,'unexpired',t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'),'refreshClient',r.client_id) FROM github_connections c LEFT JOIN github_token_vault t ON t.id=c.active_token_id AND t.user_id=c.user_id LEFT JOIN github_refresh_custody r ON r.token_id=t.id WHERE c.user_id=?`
  : `SELECT json_object('token',id,'expires',expires_at,'created',created_at,'unexpired',expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) FROM cloudflare_token_vault WHERE user_id=? AND state='active' ORDER BY expires_at DESC LIMIT 1`;
 const revoking=provider==='github'
  ? `SELECT count(*) FROM github_token_vault t WHERE user_id=? AND (expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') OR EXISTS(SELECT 1 FROM github_refresh_custody WHERE token_id=t.id)) AND (state='revoking' OR EXISTS(SELECT 1 FROM github_token_staging s WHERE s.token_id=t.id AND s.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))`
  : `SELECT count(*) FROM cloudflare_token_vault WHERE user_id=? AND state='revoking' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
 const sql=`SELECT json_object('current',(${current}),'revoking',(${revoking}),
  'pending',EXISTS(SELECT 1 FROM ${provider}_oauth_states WHERE user_id=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')${provider==='cloudflare'?' AND cancelled=0':''}),
  'recovery',EXISTS(SELECT 1 FROM connection_oauth_exchanges WHERE user_id=? AND provider=?),
  'canConnect',(${connect.sql}),'canRead',(${read.sql})) value`;
 return {sql,params:[user,user,user,user,provider,...connect.params,...read.params]};
}

/** Terminal read: the agent selects a scoped tool; only the server formats its
 * fresh facts. The result is not a second inference lookup or an OAuth action. */
export async function prepareTaskConnectionStatus(db:D1Database,user:string,turnId:string,input:TaskConnectionRequest,options:ConnectionReadOptions={}){
 const gate={userId:user,projectId:input.projectId,featureId:'core.editing' as const,operation:'prepare' as const};
 await assertFeature(db,gate);
 const form=await readModelSubmission(db,user,input.submissionId);
 if(form.envelope.scope.taskId!==input.taskId||form.projectId!==input.projectId||form.replacementInteractionId||form.state!=='submitted')throw new InteractionStoreError(409,'interaction_changed');
 const statements:D1PreparedStatement[]=[],descriptions:string[]=[];
 for(const provider of input.providers){
  const binding='connection.'+provider+'@1';
  const origin={sql:`EXISTS(SELECT 1 ${taskProviders} AND json_extract(i.envelope_json,'$.definition.cards[0].binding')=?)`,params:[user,input.projectId,input.taskId,binding]};
  if(!await db.prepare(`SELECT 1 WHERE ${origin.sql}`).bind(...origin.params).first())throw new InteractionStoreError(409,'interaction_changed');
  const snapshot=statusSnapshot(db,user,provider),before=await db.prepare(snapshot.sql).bind(...snapshot.params).first<{value:string}>();
  const status=provider==='github'?(await connectionStatus(db,user,options.github)).github:await cloudflareStatus(db,user,options.config);
  const after=await db.prepare(snapshot.sql).bind(...snapshot.params).first<{value:string}>();
  if(!before||before.value!==after?.value)throw new InteractionStoreError(409,'interaction_changed');
  descriptions.push(describeSavedConnection(provider==='github'?'GitHub':'Cloudflare',status));
  statements.push(interactionGuard(db,origin.sql,origin.params),interactionGuard(db,`(${snapshot.sql})=?`,[...snapshot.params,before.value]));
 }
 const current=featurePredicate(db,gate);
 return {reply:['For this task, here is the saved account status at this check:',...descriptions,
  'This describes your account now. It does not prove that a particular authorization attempt succeeded, or that access at the provider has been checked. Connecting does not publish your website or change DNS.',
  'Ask to show the connection controls here if you want to connect, disconnect, or check again.'].join('\n\n'),statements:[
   interactionGuard(db,current.sql,current.params),...statements,
   db.prepare('UPDATE chat_turns SET ai_context_allowed=0 WHERE id=? AND user_id=?').bind(turnId,user)
  ]};
}

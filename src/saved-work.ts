import {savedWorkKinds,type SavedWorkKind,type SavedWorkItem,type SavedWorkList} from './saved-work-shape';
import {BackendError} from './backend-error';
import {assertWorkspace} from './workspace-identity/admission';
import {draftRetentionDue} from './chat-interactions/retention';

const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
type Source={table:string;state?:string;phase?:string;project?:string|null;owner?:string;id?:string;expires?:string;turn?:string;interaction?:string;safety?:string;joins?:string;where?:string};
const directTurn="(SELECT id FROM chat_turns WHERE id=r.id AND user_id=r.user_id)";
const receiptTurn=(kind:string)=>`(SELECT turn_id FROM chat_review_receipts WHERE user_id=r.user_id AND review_id=r.id AND kind='${kind}' ORDER BY turn_id LIMIT 1)`;
const applied=(table:string)=>`CASE WHEN EXISTS(SELECT 1 FROM ${table} a WHERE a.proposal_id=r.id AND a.user_id=r.user_id) THEN 'applied' ELSE 'pending' END`;
/** Explicit current owner metadata, never a second operation ledger. Visitors,
 * operator-only records, credentials and deferred CMS work are not indexed. */
export const savedWorkSources:Record<SavedWorkKind,Source>={
 chat:{table:'chat_turns',project:null,state:'r.status',turn:'r.id',phase:"CASE r.status WHEN 'pending' THEN 'working' WHEN 'uncertain' THEN 'uncertain' WHEN 'failed' THEN 'attention' ELSE 'finished' END"},
 form:{table:'chat_interactions',state:"COALESCE(c.state,r.state)",turn:'r.origin_turn_id',interaction:'r.id',expires:'r.expires_at',joins:'LEFT JOIN chat_interaction_submissions s ON s.interaction_id=r.id AND s.user_id=r.user_id LEFT JOIN chat_interaction_continuations c ON c.id=s.id',
  where:`r.removed_at IS NULL AND r.envelope_json IS NOT NULL AND NOT (${draftRetentionDue.replaceAll('i.','r.')})`,phase:"CASE WHEN c.state='unknown' THEN 'uncertain' WHEN c.state='pending' THEN 'working' WHEN c.state='failed' THEN 'attention' WHEN c.state='not-started' OR r.state='open' THEN 'form' ELSE 'finished' END"},
 inference:{table:'standard_ai_requests',project:null,state:'r.state',phase:"CASE r.state WHEN 'uncertain' THEN 'uncertain' WHEN 'reserved' THEN 'working' WHEN 'dispatched' THEN 'working' ELSE 'finished' END"},
 website:{table:'publication_actions',expires:'r.expires_at',turn:'(SELECT turn_id FROM publication_chat_links WHERE review_id=r.id ORDER BY turn_id LIMIT 1)',safety:"CASE WHEN r.kind='unpublish' THEN 'website' END"},
 'website-change':{table:'project_spec_proposals',state:applied('project_spec_applies'),expires:'r.expires_at'},
 'website-save':{table:'project_spec_applies',state:"'applied'"},
 'service-change':{table:'service_client_proposals',state:applied('service_client_applies'),expires:'r.expires_at'},
 'service-save':{table:'service_client_applies',state:"'applied'"},
 'service-activation':{table:'service_client_activation_reviews',expires:'r.expires_at',state:"CASE WHEN EXISTS(SELECT 1 FROM contact_reviews a WHERE a.id=r.id AND a.user_id=r.user_id AND a.status='applied') OR EXISTS(SELECT 1 FROM backend_form_reviews a WHERE a.id=r.id AND a.user_id=r.user_id AND a.status='applied') THEN 'applied' ELSE 'pending' END",turn:'(SELECT turn_id FROM service_client_activation_links WHERE review_id=r.id ORDER BY turn_id LIMIT 1)'},
 'backend-test':{table:'backend_runs',state:'r.state'},
 'backend-data':{table:'backend_state_reviews',expires:'r.expires_at',turn:'(SELECT turn_id FROM backend_state_links WHERE review_id=r.id ORDER BY turn_id LIMIT 1)'},
 backend:{table:'backend_publication_reviews',expires:'r.expires_at',turn:receiptTurn('backendPublication'),safety:"CASE WHEN r.operation='unpublish' THEN 'backend' END"},
 'website-tool':{table:'backend_form_reviews',expires:'r.expires_at',turn:receiptTurn('backendForm')},
 'app-authority':{table:'app_activation_reviews',expires:'r.expires_at',turn:receiptTurn('application')},
 application:{table:'app_page_reviews',expires:'r.expires_at',turn:receiptTurn('appPage'),safety:"CASE WHEN r.config_json IS NULL THEN 'application' END"},
 'app-restore':{table:'app_restore_reviews',expires:'r.expires_at',turn:receiptTurn('appRestore')},
 'app-upgrade':{table:'app_migration_checks',expires:'r.expires_at',turn:'(SELECT turn_id FROM app_maintenance_chat_links WHERE review_id=r.id ORDER BY turn_id LIMIT 1)',state:"CASE WHEN EXISTS(SELECT 1 FROM app_migration_cancellations a WHERE a.id=r.id AND a.user_id=r.user_id) THEN 'cancelled' ELSE COALESCE((SELECT status FROM app_migration_approvals a WHERE a.id=r.id AND a.user_id=r.user_id),'check-recorded') END",phase:"CASE WHEN EXISTS(SELECT 1 FROM app_migration_cancellations a WHERE a.id=r.id AND a.user_id=r.user_id) OR EXISTS(SELECT 1 FROM app_migration_approvals a WHERE a.id=r.id AND a.user_id=r.user_id AND a.status='applied') THEN 'finished' ELSE 'attention' END"},
 backup:{table:'github_backups',state:'r.state',expires:'r.expires_at'},
 dns:{table:'cloudflare_dns_actions',state:'r.state',expires:'r.expires_at'},
 hosting:{table:'domain_connections',state:'r.state',expires:'r.expires_at'},
 'github-access':{table:'github_grant_revocations',project:null,state:'r.state',expires:'r.expires_at',turn:receiptTurn('githubGrant')},
 'source-import':{table:'backend_imports',state:'r.state',phase:"'attention'"},
 photo:{table:'project_files',owner:'p.owner_user_id',state:"CASE WHEN r.status='pending' THEN 'upload-pending' ELSE COALESCE((SELECT state FROM project_photo_safety WHERE file_id=r.id AND user_id=p.owner_user_id),'safety-unconfirmed') END",phase:"CASE WHEN r.status='ready' AND EXISTS(SELECT 1 FROM project_photo_safety WHERE file_id=r.id AND user_id=p.owner_user_id AND state='approved' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 'finished' ELSE 'attention' END",turn:'NULL',interaction:"json_extract(r.handoff_json,'$.interactionId')"},
 checkout:{table:'stripe_subscription_orders',project:null,state:'r.state',phase:"CASE WHEN r.state='pending' THEN 'attention' ELSE 'finished' END",turn:'NULL'},
 'usage-review':{table:'usage_review_requests',project:null,state:'r.state',phase:"CASE WHEN r.state='open' THEN 'working' ELSE 'finished' END"},
 'photo-removal':{table:'photo_removals',expires:'r.expires_at'},
 'version-removal':{table:'version_removals',expires:'r.expires_at'},
 'domain-proof':{table:'domain_proof_removals',expires:'r.expires_at'},
 contact:{table:'contact_reviews',expires:'r.expires_at'},
 directory:{table:'directory_reviews',expires:'r.expires_at'},
};
function kind(value:string):asserts value is SavedWorkKind{if(!Object.hasOwn(savedWorkKinds,value))throw new BackendError(400,'Choose a current saved-work type.');}
function key(value:string){const pieces=value.split(':');if(pieces.length!==2||!uuid.test(pieces[1]))throw new BackendError(400,'Choose a current saved-work link.');kind(pieces[0]);return {kind:pieces[0],id:pieces[1]};}
const now="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
function query(name:SavedWorkKind){
 const s=savedWorkSources[name],project=s.project===null?'NULL':s.project??'r.project_id',owner=s.owner??'r.user_id',state=s.state??'r.status';
 const phase=s.phase??`CASE WHEN (${state}) IN ('pending','review','ready') THEN 'review' WHEN (${state}) IN ('uncertain','unknown') THEN 'uncertain' WHEN (${state}) IN ('running','preparing','creating','provisioning','disconnecting','dispatching','applying') THEN 'working' WHEN (${state}) IN ('failed','blocked','requires_review') THEN 'attention' ELSE 'finished' END`;
 return `SELECT '${name}:'||r.${s.id??'id'} AS key,'${name}' AS kind,r.${s.id??'id'} AS id,${project} AS projectId,${project==='NULL'?'NULL':'p.name'} AS projectName,${state} AS state,
 CASE WHEN (${phase}) IN ('review','form') AND ${s.expires??'NULL'}<=${now} THEN 'expired' ELSE (${phase}) END AS phase,
 ${s.expires??'NULL'} AS expiresAt,${s.turn??directTurn} AS turnId,${s.interaction??'NULL'} AS interactionId,${s.safety??'NULL'} AS safety
 FROM ${s.table} r ${project==='NULL'?'':`JOIN projects p ON p.id=${project}`} ${s.joins??''}
 WHERE ${owner}=? ${project==='NULL'?'':`AND p.owner_user_id=${owner}`} ${s.where?'AND ('+s.where+')':''}`;
}
/** Reading saved metadata never reconciles, invokes a provider or changes state. */
export async function listSavedWork(db:D1Database,user:string,params:URLSearchParams):Promise<SavedWorkList>{
 for(const name of params.keys())if(!['kind','view','after'].includes(name)||params.getAll(name).length!==1)throw new BackendError(400,'Use the current saved-work filters.');
 const selected=params.get('kind'),view=params.get('view')??'open',after=params.get('after');
 if(selected!==null)kind(selected);if(!['open','all'].includes(view))throw new BackendError(400,'Choose open work or all saved work.');if(after!==null)key(after);
 const names=selected?[selected as SavedWorkKind]:Object.keys(savedWorkSources) as SavedWorkKind[];
 const {results}=await db.prepare(`SELECT * FROM (${names.map(query).join(' UNION ALL ')}) WHERE (?='all' OR phase NOT IN ('finished','expired')) AND (? IS NULL OR key>?) ORDER BY key LIMIT 31`).bind(...names.map(()=>user),view,after,after).all<SavedWorkItem>();
 await assertWorkspace(db,user);return {version:1,items:results.slice(0,30),next:results.length>30?results[29].key:null};
}
export async function readSavedWork(db:D1Database,user:string,value:string){
 const k=key(value),item=await db.prepare(`SELECT * FROM (${query(k.kind)}) WHERE id=?`).bind(user,k.id).first<SavedWorkItem>();
 if(!item)throw new BackendError(404,'This saved record is unavailable. A missing record does not confirm whether an interrupted request finished.');
 await assertWorkspace(db,user);return {version:1 as const,item};
}

import {savedWorkKinds,type SavedWorkKind,type SavedWorkItem,type SavedWorkList,type SavedWorkDetail} from './saved-work-shape';
import {BackendError} from './backend-error';
import {assertWorkspace} from './workspace-identity/admission';
import {draftRetentionDue} from './chat-interactions/retention';
import {photoSafetySQL} from './photo-safety';

const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
// Only canonical IDs are listed, so every listed key is also a valid cursor and detail link.
// Built from short patterns: D1 rejects long LIKE/GLOB patterns.
const canonicalID="length(r.id)=36 AND r.id NOT GLOB '*[^0-9a-f-]*' AND length(replace(r.id,'-',''))=32 AND substr(r.id,9,1)||substr(r.id,14,1)||substr(r.id,19,1)||substr(r.id,24,1)='----'";
/** project: undefined = required owned project; null = account scope; 'optional' = account
 * or owned project (account-wide Chat forms). Every project present must belong to the owner. */
type Source={table:string;state?:string;phase?:string;project?:null|'optional';owner?:string;expires?:string;turn?:string;interaction?:string;safety?:string;joins?:string;where?:string};
const directTurn="(SELECT id FROM chat_turns WHERE id=r.id AND user_id=r.user_id)";
const receiptTurn=(kind:string)=>`(SELECT turn_id FROM chat_review_receipts WHERE user_id=r.user_id AND review_id=r.id AND kind='${kind}' ORDER BY turn_id LIMIT 1)`;
const applied=(table:string)=>`CASE WHEN EXISTS(SELECT 1 FROM ${table} a WHERE a.proposal_id=r.id AND a.user_id=r.user_id) THEN 'applied' ELSE 'pending' END`;
// Service activation stores its effect as a contact/form review with the same ID; list it once.
const notActivation="NOT EXISTS(SELECT 1 FROM service_client_activation_reviews v WHERE v.id=r.id AND v.user_id=r.user_id)";
const migrationCancelled="EXISTS(SELECT 1 FROM app_migration_cancellations a WHERE a.id=r.id AND a.user_id=r.user_id)";
const migrationApproval="(SELECT status FROM app_migration_approvals a WHERE a.id=r.id AND a.user_id=r.user_id)";
const photoState=`CASE WHEN r.status='pending' THEN 'upload-unconfirmed' ELSE 'safety-'||(SELECT ${photoSafetySQL} FROM project_files f WHERE f.id=r.id) END`;
/** Explicit current owner metadata, never a second operation ledger. Visitors,
 * operator-only records, credentials and deferred CMS work are not indexed.
 * States are stored domain vocabulary; phases are navigation hints, not authority. */
export const savedWorkSources:Record<SavedWorkKind,Source>={
 chat:{table:'chat_turns',project:null,state:'r.status',turn:'r.id',phase:"CASE r.status WHEN 'pending' THEN 'working' WHEN 'uncertain' THEN 'uncertain' WHEN 'failed' THEN 'attention' ELSE 'finished' END"},
 // Admission expiry applies to an open form only. Submitted answers stay listed with their continuation state.
 form:{table:'chat_interactions',project:'optional',state:"COALESCE(c.state,r.state)",turn:'r.origin_turn_id',interaction:'r.id',expires:'r.expires_at',joins:'LEFT JOIN chat_interaction_submissions s ON s.interaction_id=r.id AND s.user_id=r.user_id LEFT JOIN chat_interaction_continuations c ON c.id=s.id',
  where:`r.removed_at IS NULL AND NOT (${draftRetentionDue.replaceAll('i.','r.')})`,phase:"CASE WHEN r.state='open' THEN 'form' WHEN c.state='unknown' THEN 'uncertain' WHEN c.state='pending' THEN 'working' WHEN c.state IN ('failed','not-started') THEN 'attention' ELSE 'finished' END"},
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
 'website-tool':{table:'backend_form_reviews',expires:'r.expires_at',turn:receiptTurn('backendForm'),where:notActivation},
 'app-authority':{table:'app_activation_reviews',expires:'r.expires_at',turn:receiptTurn('application')},
 application:{table:'app_page_reviews',expires:'r.expires_at',turn:receiptTurn('appPage'),safety:"CASE WHEN r.config_json IS NULL THEN 'application' END"},
 'app-restore':{table:'app_restore_reviews',expires:'r.expires_at',turn:receiptTurn('appRestore')},
 // A recorded upgrade check awaits explicit approval; its passing test is not an acceptance or applied result.
 'app-upgrade':{table:'app_migration_checks',expires:'r.expires_at',turn:"(SELECT turn_id FROM app_maintenance_chat_links WHERE user_id=r.user_id AND kind='upgrade' AND review_id=r.id ORDER BY turn_id LIMIT 1)",
  state:`CASE WHEN ${migrationCancelled} THEN 'cancelled' ELSE COALESCE(${migrationApproval},'check-recorded') END`,
  phase:`CASE WHEN ${migrationCancelled} THEN 'finished' WHEN ${migrationApproval}='applied' THEN 'finished' WHEN ${migrationApproval}='applying' THEN 'working' ELSE 'review' END`},
 backup:{table:'github_backups',state:'r.state',expires:'r.expires_at'},
 dns:{table:'cloudflare_dns_actions',state:'r.state',expires:'r.expires_at'},
 hosting:{table:'domain_connections',state:'r.state',expires:'r.expires_at'},
 'github-access':{table:'github_grant_revocations',project:null,state:'r.state',expires:'r.expires_at',turn:receiptTurn('githubGrant')},
 'source-import':{table:'backend_imports',state:'r.state',phase:"'attention'"},
 // Shares the trusted digest/policy/expiry view. Readiness or a stale scan never reads as clearance.
 photo:{table:'project_files',owner:'p.owner_user_id',where:'NOT EXISTS(SELECT 1 FROM module_files mf WHERE mf.file_id=r.id)',state:photoState,phase:`CASE (${photoState}) WHEN 'upload-unconfirmed' THEN 'uncertain' WHEN 'safety-approved' THEN 'finished' ELSE 'attention' END`,turn:'NULL',interaction:"json_extract(r.handoff_json,'$.interactionId')"},
 checkout:{table:'stripe_subscription_orders',project:null,state:'r.state',phase:"CASE r.state WHEN 'pending' THEN 'attention' WHEN 'expired' THEN 'expired' ELSE 'finished' END",turn:'NULL'},
 'usage-review':{table:'usage_review_requests',project:null,state:'r.state',phase:"CASE WHEN r.state='open' THEN 'working' ELSE 'finished' END"},
 'photo-removal':{table:'photo_removals',expires:'r.expires_at'},
 'version-removal':{table:'version_removals',expires:'r.expires_at'},
 'domain-proof':{table:'domain_proof_removals',expires:'r.expires_at'},
 contact:{table:'contact_reviews',expires:'r.expires_at',where:notActivation},
 directory:{table:'directory_reviews',expires:'r.expires_at'},
};
const now="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
/** Generic stored-status vocabulary. Every unlisted value must be a settled result. */
const genericPhase=(state:string)=>`CASE WHEN (${state}) IN ('pending','review','ready') THEN 'review' WHEN (${state}) IN ('uncertain','unknown') THEN 'uncertain'
 WHEN (${state}) IN ('running','preparing','creating','provisioning','disconnecting','dispatching','sending','applying') THEN 'working' WHEN (${state}) IN ('failed','blocked','requires_review') THEN 'attention' ELSE 'finished' END`;
function query(name:SavedWorkKind){
 const s=savedWorkSources[name],owner=s.owner??'r.user_id',state=s.state??'r.status',expires=s.expires??'NULL',base=s.phase??genericPhase(state);
 const join=s.project===null?'':`${s.project==='optional'?'LEFT ':''}JOIN projects p ON p.id=r.project_id AND p.owner_user_id=${owner}`;
 const scope=s.project===null?'':s.project==='optional'?'AND (r.project_id IS NULL OR p.id IS NOT NULL)':'';
 // An unapproved review/form past its expiry is expired; uncertain, working and settled phases never are.
 const phase=`CASE WHEN (${base}) IN ('review','form') AND ${expires}<=${now} THEN 'expired' ELSE (${base}) END`;
 return `SELECT '${name}:'||r.id AS key,'${name}' AS kind,r.id AS id,${s.project===null?'NULL':'p.id'} AS projectId,${s.project===null?'NULL':'p.name'} AS projectName,${state} AS state,
 ${phase} AS phase,CASE WHEN (${base}) IN ('review','form') THEN ${expires} END AS expiresAt,${s.turn??directTurn} AS turnId,${s.interaction??'NULL'} AS interactionId,${s.safety??'NULL'} AS safety
 FROM ${s.table} r ${join} ${s.joins??''}
 WHERE ${owner}=? AND ${canonicalID} ${scope} ${s.where?'AND ('+s.where+')':''}`;
}
function kind(value:string):asserts value is SavedWorkKind{if(!Object.hasOwn(savedWorkKinds,value))throw new BackendError(400,'Choose a current saved-work type.');}
function cursor(value:string){const at=value.indexOf(':');if(at<0||!uuid.test(value.slice(at+1)))throw new BackendError(400,'Use the current saved-work page link.');kind(value.slice(0,at));}
/** Reading saved metadata never reconciles, invokes a provider or changes state. */
export async function listSavedWork(db:D1Database,user:string,params:URLSearchParams):Promise<SavedWorkList>{
 for(const name of new Set(params.keys()))if(!['kind','view','after'].includes(name)||params.getAll(name).length!==1)throw new BackendError(400,'Use the current saved-work filters.');
 const selected=params.get('kind'),view=params.get('view')??'open',after=params.get('after');
 if(selected!==null)kind(selected);if(!['open','all'].includes(view))throw new BackendError(400,'Choose open work or all saved work.');if(after!==null)cursor(after);
 await assertWorkspace(db,user);
 const names=selected?[selected as SavedWorkKind]:Object.keys(savedWorkSources) as SavedWorkKind[];
 // D1 rejects one compound SELECT across every source; one batch is still one consistent read.
 const pages=await db.batch<SavedWorkItem>(names.map(name=>db.prepare(`SELECT * FROM (${query(name)}) WHERE (?='all' OR phase NOT IN ('finished','expired')) AND (? IS NULL OR key>?) ORDER BY key LIMIT 31`).bind(user,view,after,after)));
 // Keys are ASCII, so code-unit order equals SQLite BINARY order.
 const results=pages.flatMap(page=>page.results).sort((x,y)=>x.key<y.key?-1:x.key>y.key?1:0);
 await assertWorkspace(db,user);return {version:1,items:results.slice(0,30),next:results.length>30?results[29].key:null};
}
export async function readSavedWork(db:D1Database,user:string,name:string,id:string):Promise<SavedWorkDetail>{
 kind(name);if(!uuid.test(id))throw new BackendError(400,'Choose a current saved-work link.');
 await assertWorkspace(db,user);
 const item=await db.prepare(`SELECT * FROM (${query(name)}) WHERE id=?`).bind(user,id).first<SavedWorkItem>();
 await assertWorkspace(db,user);
 if(!item)throw new BackendError(404,'This saved record is unavailable. A missing record does not confirm whether an interrupted request finished.');
 return {version:1,item};
}

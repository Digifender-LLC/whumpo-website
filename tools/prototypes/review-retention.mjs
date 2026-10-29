// WH-061 offline review-retention reference (planned; docs/review-retention.md).
// Part 1 reads the canonical schema inputs and extracts every row-count capacity trigger, so the documented inventory
// cannot drift from the real triggers. Part 2 is a synthetic in-memory model of review/receipt tables that implements
// the proposed per-owner/per-project capacity, pruning, compaction and safety-withdrawal rules. No Worker imports it;
// it opens no D1 database, changes no schema and deletes nothing real.
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

/* ---------------------------------------------------------------- schema capacity inventory ---------------- */

const close=(s,open)=>{let depth=0;for(let i=open;i<s.length;i++){if(s[i]==='(')depth++;else if(s[i]===')'&&--depth===0)return i;}return -1;};
const skipSpace=(s,i)=>{while(i<s.length&&/\s/.test(s[i]))i++;return i;};
const countHead=/^\(\s*SELECT\s+(?:count|sum|coalesce\s*\(\s*sum)\s*\(/i;

const windowed=/\b(?:\w+\.)?(?:day|period)\s*=\s*NEW\.(?:day|period)\b|\b(?:created_at|started_at|occurred_at)\s*>|unixepoch\(\)\s*-|'-\d+ (?:hour|day|minutes?)'/i;
const stateFilter=/\b(?:status|state|kind|removed|revoked|sealed|cleanup|released_at|resolved_at|withdrawn|expires_at)\b\s*(?:=|!=|<>|IN\b|NOT\s+IN\b|IS\b|>|<)|\bNOT\s+EXISTS\b/i;
function subjectScope(where){
 const w=where.replace(/\b(?:\w+\.)?(?:day|period)\s*=\s*NEW\.(?:day|period)\b/ig,'').replace(/\s+/g,'');
 const scopes=[];
 if(/project_id=NEW\.project_id|project_id=\(SELECTproject_idFROM/i.test(w))scopes.push('project');
 if(/(?:user_id|owner_user_id)=NEW\.(?:user_id|owner_user_id)|owner_user_id=\(SELECTowner_user_idFROM\w+WHEREid=NEW\.\w+\)/i.test(w))scopes.push('owner');
 for(const [key,label] of [['account_id','account'],['visitor_id','visitor'],['case_id','case'],['instance_id','instance'],['link_id','link'],['destination_id','destination'],['job_id','job']])
  if(new RegExp(key+'=NEW\\.'+key,'i').test(w))scopes.push(label);
 // `project_id!=NEW.project_id` (every other project) and NEW.created_at windows are platform-wide.
 return scopes.length?scopes.join('+'):(/(?<![!<>])=NEW\./.test(w)?'other':'platform');
}
const qualifier=where=>windowed.test(where)?'window':stateFilter.test(where)?'filtered':'lifetime';
/** Every `(SELECT count(*)|sum(..) FROM t …)` (optionally added to further terms) compared with `>=`/`>` against an
 * integer literal inside a trigger. json_each/json_tree counts are shape validation, not storage capacity. */
export function capsInTrigger(name,on,sql){
 if(!/\b(?:count|sum)\s*\(/i.test(sql))return [];
 const s=sql.replace(/--[^\n]*/g,' ').replace(/\s+/g,' '),caps=[];
 let i=0;
 while((i=s.indexOf('(',i))!==-1){
  if(!countHead.test(s.slice(i,i+40))){i++;continue;}
  const terms=[];let j=i,end=-1,ok=true;
  for(;;){
   const e=close(s,j);if(e<0){ok=false;break;}
   const body=s.slice(j+1,e),from=body.match(/\bFROM\s+(\w+)/i);
   if(from&&countHead.test(s.slice(j,j+40)))terms.push({table:from[1],where:body.slice(from.index+from[0].length)});
   let k=skipSpace(s,e+1);
   const coalesceTail=s.slice(k).match(/^,\s*\d+\s*\)/);if(coalesceTail)k=skipSpace(s,k+coalesceTail[0].length);
   if(s[k]==='+'||s[k]==='-'){k=skipSpace(s,k+1);const call=s.slice(k).match(/^\w*\s*\(/);if(!call){ok=false;break;}j=k+call[0].length-1;end=-1;continue;}
   end=k;break;
  }
  if(!ok||!terms.length){i++;continue;}
  const cmp=s.slice(end).match(/^(>=|>)\s*(\d+)\b/);
  const real=terms.filter(t=>!/^json_(each|tree)$/i.test(t.table));
  if(cmp&&real.length){
   const scope=[...new Set(real.map(t=>subjectScope(t.where)))].join('|'),q=real.map(t=>qualifier(t.where));
   caps.push({trigger:name,on,counted:real.map(t=>t.table).join('+'),scope,limit:Number(cmp[2]),op:cmp[1],qualifier:q.includes('window')?'window':q.includes('filtered')?'filtered':'lifetime'});
  }
  i=end>0?end:i+1;
 }
 return caps;
}
const deletedTables=text=>[...text.matchAll(/\bDELETE\s+FROM\s+(\w+)/gi)].map(m=>m[1].toLowerCase());
/** Load the composed schema (files in canonical order) into an in-memory SQLite once and keep the facts the
 * inventory needs: every trigger (with its source file), view bases, tables with an ON DELETE CASCADE parent and
 * the tables any trigger deletes from. */
export function schemaFacts(files){
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(files.map(f=>f.sql).join('\n'));
  const sources=new Map(files.flatMap(f=>[...f.sql.matchAll(/CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)].map(m=>[m[1],f.path])));
  const triggers=db.prepare("SELECT name,tbl_name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all().map(r=>({name:r.name,on:r.tbl_name,sql:r.sql,source:sources.get(r.name)??null}));
  return {triggers,
   views:new Map(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='view'").all().map(v=>[v.name,v.sql.match(/\bFROM\s+(\w+)/i)[1]])),
   cascades:new Set(db.prepare("SELECT m.name FROM sqlite_master m WHERE m.type='table' AND EXISTS(SELECT 1 FROM pragma_foreign_key_list(m.name) f WHERE f.on_delete='CASCADE')").all().map(r=>r.name)),
   triggerDeletes:new Set(triggers.flatMap(t=>deletedTables(t.sql)))};
 }finally{db.close();}
}
export const schemaCaps=facts=>facts.triggers.flatMap(t=>capsInTrigger(t.name,t.on,t.sql).map(c=>({...c,source:t.source})));
const scopeOrder=['project','owner','account','visitor','visitor+instance','case','instance','link','destination','job','other','platform'];
const capText=c=>`${c.scope} ${c.op==='>'?'≤':''}${c.limit}${c.qualifier==='window'?' (window)':c.qualifier==='filtered'?' (filtered)':''}`;
const capOrder=(a,b)=>scopeOrder.indexOf(a.scope)-scopeOrder.indexOf(b.scope)||a.limit-b.limit||a.qualifier.localeCompare(b.qualifier);
/** One inventory row per counted table (or summed table set): the triggers and canonical caps cell. */
export function capInventory(caps){
 const rows=new Map();
 for(const c of caps){const r=rows.get(c.counted)??{table:c.counted,triggers:new Set(),sources:new Set(),caps:[]};r.triggers.add(c.trigger);if(c.source)r.sources.add(c.source);r.caps.push(c);rows.set(c.counted,r);}
 return [...rows.values()].map(r=>({table:r.table,triggers:[...r.triggers].sort(),sources:[...r.sources].sort(),
  caps:[...new Set([...r.caps].sort(capOrder).map(capText))].join(' · '),
  platformLifetime:r.caps.some(c=>c.qualifier==='lifetime'&&c.scope==='platform')})).sort((a,b)=>a.table.localeCompare(b.table));
}
/** Who can ever remove a row today: `app` (a DELETE in src/ or tools/), `trigger` (a schema trigger deletes it),
 * `cascade` (an ON DELETE CASCADE parent, i.e. project/account cleanup), else `none`. Views resolve to their base table. */
export function deleters(facts,appDeletes){
 return table=>{
  const kinds=new Set();
  for(const part of table.split('+').map(t=>facts.views.get(t)??t)){
   if(appDeletes.has(part))kinds.add('app');
   if(facts.triggerDeletes.has(part))kinds.add('trigger');
   if(facts.cascades.has(part))kinds.add('cascade');
  }
  return ['app','trigger','cascade'].filter(k=>kinds.has(k)).join('+')||'none';
 };
}
/** Base table for lifecycle lookup (summed rows use the first table; views use the table they read). */
export const lifecycleTable=table=>({app_migration_current:'app_migration_checks'})[table]??table.split('+')[0];

/* ---------------------------------------------------------------- classification registry ------------------ */
// class:    review (owner/visitor review that becomes an applied receipt) · receipt (applied/idempotency/run/link receipt)
//           operation (external dispatch with unknown-outcome states) · version (referenced artifact or live slot)
//           evidence (restricted safety/operator evidence) · inventory (live identity/resource rows) · rate (windowed counter)
// lane:     R1 active caps + compaction · R2 receipt ring + replay horizon · R3 reconcile first, then compact
//           R4 version retention (docs/version-retention.md) · R5 restricted (WH-015 cases or WH-050 operator records, never pruned here) · R6 unchanged
// turnover: how rows stop counting today. lifetime (terminal rows count until project/account cleanup) · pending-only
//           (cap excludes applied/expired rows) · expiring (a sweep deletes expired rows) · window (time-window counter)
//           · owner-removable (live rows the owner can remove) · restricted (WH-015 retention decisions or WH-050 reviewed operator cleanup)
//           · active-only (WH-181: caps count only pending/in-flight non-withdrawal rows; terminal rows never count)
// withdrawal: the rows that withdraw/disable/revoke and must be exempt from capacity (proposal).
const R=(cls,lane,turnover,lifecycle,withdrawal=null)=>Object.freeze({class:cls,lane,turnover,lifecycle,withdrawal});
export const capRegistry=Object.freeze({
 // WH-170/WH-201 tables with trigger caps: shadow cost evidence (deleted with the account), address-change rate evidence and compromise reviews.
 cost_events:R('inventory','R6','lifetime','cost-events'),
 owner_email_change_limits:R('rate','R6','expiring','owner-email-change-limits'),
 owner_security_reviews:R('inventory','R6','expiring','owner-security-reviews'),
 app_activation_reviews:R('review','R1','active-only','visitor-app-data','enabled=0'),
 app_auth_challenges:R('inventory','R6','expiring','visitor-identity'),
 app_daily_usage:R('rate','R6','window','visitor-app-data'),
 app_deletion_receipts:R('receipt','R2','expiring','visitor-identity'),
 app_deletion_reviews:R('review','R1','expiring','visitor-identity'),
 app_invitations:R('inventory','R6','expiring','visitor-identity'),
 app_migration_checks:R('review','R1','active-only','application-recovery'),
 app_migration_current:R('review','R1','pending-only','application-recovery'),
 app_owner_erasures:R('receipt','R2','expiring','visitor-identity'),
 app_page_reviews:R('review','R1','active-only','visitor-app-data','config_json IS NULL'),
 app_passkeys:R('inventory','R6','owner-removable','visitor-identity'),
 app_recovery_points:R('version','R4','lifetime','application-recovery'),
 app_restore_reviews:R('review','R1','active-only','application-recovery'),
 app_runs:R('receipt','R2','lifetime','visitor-app-data'),
 app_sessions:R('inventory','R6','expiring','visitor-identity'),
 app_visitors:R('inventory','R6','owner-removable','visitor-identity'),
 backend_form_reviews:R('review','R1','active-only','backend-artifacts','enabled=0'),
 backend_imports:R('inventory','R6','lifetime','import-quarantine'),
 backend_nominations:R('review','R1','active-only','shared-reuse'),
 backend_public_usage:R('rate','R6','window','backend-artifacts'),
 backend_publication_reviews:R('review','R1','active-only','backend-artifacts',"operation='unpublish'"),
 backend_runs:R('receipt','R2','lifetime','backend-artifacts'),
 backend_state_reviews:R('review','R1','active-only','backend-artifacts'),
 backend_versions:R('version','R4','lifetime','backend-artifacts'),
 build_jobs:R('operation','R3','pending-only','pooled-build-jobs'),
 cloudflare_dns_actions:R('operation','R3','active-only','domains-dns'),
 cloudflare_token_vault:R('inventory','R6','owner-removable','connections'),
 cms_discard_reviews:R('review','R1','active-only','cms-content'),
 cms_draft_requests:R('review','R1','lifetime','cms-content'),
 'cms_draft_requests+cms_edit_requests':R('review','R1','lifetime','cms-content'),
 cms_export_links:R('receipt','R2','lifetime','cms-content'),
 cms_import_reviews:R('review','R1','active-only','cms-media-imports'),
 cms_instances:R('inventory','R6','lifetime','cms-resources'),
 cms_media_uploads:R('inventory','R6','lifetime','cms-media-imports'),
 cms_preview_links:R('receipt','R2','lifetime','cms-content'),
 cms_publication_media:R('version','R4','lifetime','cms-media-imports'),
 cms_publication_reviews:R('review','R1','active-only','cms-content'),
 cms_setup_reviews:R('review','R1','active-only','cms-resources'),
 cms_unpublish_reviews:R('review','R1','active-only','cms-content','every row'),
 cms_wordpress_sources:R('inventory','R6','lifetime','cms-media-imports'),
 composition_plans:R('review','R1','active-only','backend-artifacts'),
 contact_notification_outbox:R('operation','R3','window','contact-notifications'),
 contact_receipts:R('receipt','R2','expiring','contacts'),
 content_risk_evidence:R('evidence','R5','restricted','safety-cases'),
 content_screening_decisions:R('evidence','R5','restricted','safety-checks'),
 directories:R('version','R4','owner-removable','directories'),
 directory_reviews:R('review','R1','active-only','directories',"kind='unpublish'"),
 domain_claims:R('inventory','R6','owner-removable','domains-dns'),
 domain_connections:R('operation','R3','active-only','domains-dns','disconnect'),
 feature_preview_grants:R('inventory','R6','lifetime','feature-preview-authority'),
 github_backups:R('operation','R3','active-only','github-backups'),
 github_grant_revocations:R('operation','R3','active-only','connections','every row'),
 github_token_vault:R('inventory','R6','owner-removable','connections'),
 guest_preview_feedback:R('inventory','R6','owner-removable','guest-feedback'),
 guest_preview_links:R('inventory','R6','owner-removable','guest-feedback'),
 identity_ceremony_receipts:R('receipt','R2','expiring','owner-identity-receipts'),
 identity_challenges:R('inventory','R6','expiring','owner-identity-admission'),
 identity_credentials:R('inventory','R6','owner-removable','owner-identity-progress'),
 identity_effect_receipts:R('receipt','R2','expiring','owner-identity-receipts'),
 identity_grants:R('inventory','R6','expiring','owner-identity-admission'),
 module_access_role_reviews:R('review','R1','active-only','project-roles',"action='revoke'"),
 module_activation_reviews:R('review','R1','active-only','module-registry',"action='disable'"),
 module_files:R('inventory','R6','window','module-files'),
 module_records:R('inventory','R6','expiring','module-records'),
 module_request_receipts:R('receipt','R2','window','module-registry'),
 operator_containments:R('evidence','R5','restricted','operator-containment'),
 operator_retention_receipts:R('evidence','R5','restricted','operator-containment'),
 operator_session_revocations:R('evidence','R5','restricted','operator-containment'),
 photo_scan_tickets:R('evidence','R5','lifetime','safety-checks'),
 project_files:R('inventory','R6','owner-removable','project-media'),
 'project_files+file_cleanup':R('inventory','R6','owner-removable','project-media'),
 project_spec_applies:R('receipt','R2','lifetime','configuration-authority'),
 project_spec_proposals:R('review','R1','expiring','project-configurations'),
 projects:R('inventory','R6','owner-removable','projects'),
 safety_case_audit:R('evidence','R5','restricted','safety-case-access'),
 safety_case_evidence:R('evidence','R5','restricted','restricted-safety-cases'),
 safety_case_roles:R('evidence','R5','restricted','safety-case-access'),
 safety_cases:R('evidence','R5','restricted','restricted-safety-cases'),
 safety_disclosures:R('evidence','R5','restricted','restricted-safety-cases'),
 safety_evidence_objects:R('evidence','R5','restricted','restricted-safety-cases'),
 safety_preservation_holds:R('evidence','R5','restricted','restricted-safety-cases'),
 safety_preserved_records:R('evidence','R5','restricted','restricted-safety-cases'),
 safety_retention_decisions:R('evidence','R5','restricted','restricted-safety-cases'),
 service_client_activation_reviews:R('review','R1','lifetime','configuration-authority','enabled=0'),
 service_client_applies:R('receipt','R2','lifetime','configuration-authority'),
 service_client_proposals:R('review','R1','expiring','project-configurations'),
 service_client_versions:R('version','R4','lifetime','project-configurations'),
 site_versions:R('version','R4','owner-removable','site-versions'),
 storage_project_usage:R('rate','R6','window','public-admission-counters'),
 users:R('inventory','R6','owner-removable','owner-identity'),
});
export const retentionClasses=Object.freeze(['review','receipt','operation']);
/** The WH-061 design set: retention-class families whose terminal rows counted against a cap forever (`lifetime`), or whose
 * caps WH-181 turned into active-only counts (`active-only`). Read from the registry, because a family whose every row is a
 * withdrawal (github_grant_revocations, cms_unpublish_reviews) has no count cap and so no inventory row. */
export const ceilingSet=()=>Object.keys(capRegistry).filter(t=>retentionClasses.includes(capRegistry[t].class)&&['lifetime','active-only'].includes(capRegistry[t].turnover)).sort((a,b)=>a.localeCompare(b));
/** Design-set families converted by WH-181 to active-only counts. */
export const convertedSet=()=>ceilingSet().filter(t=>capRegistry[t].turnover==='active-only');
/** The B1 class: design-set families that still have a platform-wide lifetime cap, so one owner can exhaust it for everyone. */
export const sharedCeilingSet=rows=>rows.filter(r=>r.platformLifetime&&ceilingSet().includes(r.table)).map(r=>r.table);
/** Other lifetime platform-wide caps (versions, inventory, evidence) that are routed to their owners, not pruned here. */
export const otherPlatformCeilings=rows=>rows.filter(r=>r.platformLifetime&&!retentionClasses.includes(capRegistry[r.table]?.class)&&capRegistry[r.table]?.turnover==='lifetime').map(r=>r.table);
/** Inventory markdown rows exactly as docs/review-retention.md must contain them. */
export function inventoryRows(rows,deletedBy,lifecycleOf){
 return rows.map(r=>{const g=capRegistry[r.table]??{};return `| \`${r.table}\` | ${r.triggers.map(t=>'`'+t+'`').join(', ')} | ${r.caps} | ${g.class??'?'} | ${g.lane??'?'} | ${g.turnover??'?'} | ${deletedBy(r.table)} | ${lifecycleOf(lifecycleTable(r.table))??'unclassified'} |`;});
}

/* ---------------------------------------------------------------- proposed policy: synthetic model ---------- */

export class RetentionError extends Error{constructor(code,detail=''){super(detail?`${code}: ${detail}`:code);this.code=code;}}
const check=(ok,code,detail)=>{if(!ok)throw new RetentionError(code,detail);};
function canonical(v){
 if(v===null||typeof v!=='object')return JSON.stringify(v??null);
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
}
export const seal=fields=>createHash('sha256').update(canonical(fields)).digest('hex');

/** Proposed constants (owner decision OD-1..OD-4). activeGlobal must stay ≥ invited-account cap × activePerOwner. */
export const proposedPolicy=Object.freeze({
 activePerProject:25,activePerOwner:100,activeGlobal:5000,fairShareFrom:2500,fairSharePerOwner:25,
 historyPerProject:25,receiptsPerProject:2000,replayHorizonMs:30*86_400_000,terminalGraceMs:3_600_000,
 reviewLifetimeMs:600_000,turnoverBatch:200,
});
/** Today's shape of the shared-ceiling review tables: lifetime per-project 100 and platform 1000, no turnover. */
export const currentPolicy=Object.freeze({lifetimePerProject:100,lifetimeGlobal:1000});

/** Row states and what each must remain. Only `compact` rows may leave the review table, and only as a sealed receipt. */
export const disposition=Object.freeze({
 pending:'active-authority',uncertain:'active-authority','applied-referenced':'active-authority',
 held:'retained-evidence','applied-history':'retained-evidence',
 'applied-unreferenced':'compact',superseded:'compact',expired:'compact',failed:'compact',
});
export const rowStates=Object.freeze(Object.keys(disposition));

export function createStore({policy='proposed',limits=proposedPolicy}={}){
 check(['proposed','current'].includes(policy),'UNKNOWN_POLICY',policy);
 return {policy,limits,now:0,seq:0,rows:new Map(),receipts:new Map(),current:new Map(),pins:new Map(),holds:[]};
}
const key=(family,id)=>family+':'+id;
const isHeld=(s,r)=>s.holds.some(h=>!h.released&&((h.scope==='account'&&h.ownerId===r.ownerId)||(h.scope==='project'&&h.projectId===r.projectId)||(h.scope==='object'&&h.rowKey===key(r.family,r.id))));
const isReferenced=(s,r)=>[...s.current.values()].includes(key(r.family,r.id))||(s.pins.get(key(r.family,r.id))?.size??0)>0;
function inHistory(s,r){
 if(r.kind!=='change')return false;
 // Memoized per family/project and mutation sequence: compaction only ever removes rows outside the window.
 const memo=`${r.family}\n${r.projectId}\n${s.seq}`;
 if(s.historyMemo?.key!==memo){
  const applied=[...s.rows.values()].filter(x=>x.family===r.family&&x.projectId===r.projectId&&x.status==='applied'&&x.kind==='change').sort((a,b)=>b.appliedSeq-a.appliedSeq);
  s.historyMemo={key:memo,rows:new Set(applied.slice(0,s.limits.historyPerProject))};
 }
 return s.historyMemo.rows.has(r);
}
const isActive=(s,r)=>r.status==='uncertain'||(r.status==='pending'&&r.expiresAt>s.now);
export function rowState(s,r){
 if(isActive(s,r))return r.status;
 if(isHeld(s,r))return 'held';
 if(r.status==='applied')return isReferenced(s,r)?'applied-referenced':inHistory(s,r)?'applied-history':'applied-unreferenced';
 if(r.status==='superseded'||r.status==='failed')return r.status;
 return 'expired';
}
const activeCount=(s,pred)=>[...s.rows.values()].filter(r=>r.kind!=='withdrawal'&&pred(r)&&isActive(s,r)).length;
function admit(s,{family,ownerId,projectId}){
 const L=s.limits,fam=r=>r.family===family;
 if(s.policy==='current'){
  const rows=[...s.rows.values()].filter(fam);
  check(rows.filter(r=>r.projectId===projectId).length<currentPolicy.lifetimePerProject,'REVIEW_CAPACITY','project');
  check(rows.length<currentPolicy.lifetimeGlobal,'REVIEW_CAPACITY','platform');
  return;
 }
 check(activeCount(s,r=>fam(r)&&r.projectId===projectId)<L.activePerProject,'REVIEW_CAPACITY','project');
 const mine=activeCount(s,r=>fam(r)&&r.ownerId===ownerId),all=activeCount(s,fam);
 check(mine<L.activePerOwner,'REVIEW_CAPACITY','owner');
 check(all<L.activeGlobal,'REVIEW_CAPACITY','platform');
 check(all<L.fairShareFrom||mine<L.fairSharePerOwner,'REVIEW_CAPACITY','fair-share');
 check([...s.receipts.values()].filter(c=>fam(c)&&c.projectId===projectId).length<L.receiptsPerProject,'RECEIPT_HORIZON','project');
}
function verify(c){const {seal:sealed,...fields}=c;check(seal(fields)===sealed,'RECEIPT_TAMPERED',c.id);}
/** Prepare a review. Same id + same request hash replays (from the row or its sealed receipt); a different hash conflicts.
 * Withdrawals (unpublish/disable/revoke, owner or safety) are never refused for capacity: they supersede the previous
 * pending withdrawal of the same target instead, so their storage is bounded by targets, not by a count. */
export function prepare(s,{family,id,ownerId,projectId,kind='change',target,payload,requestHash}){
 check(['change','withdrawal'].includes(kind),'UNKNOWN_KIND',kind);
 const k=key(family,id),existing=s.rows.get(k)??s.receipts.get(k);
 if(existing){if(existing.seal)verify(existing);check(existing.requestHash===requestHash,'REQUEST_CONFLICT',k);return {outcome:'replayed',id};}
 if(s.policy==='proposed')turnover(s,{projectId,family});
 if(kind==='withdrawal'&&s.policy==='proposed'){
  for(const r of s.rows.values())if(r.family===family&&r.kind==='withdrawal'&&r.target===target&&r.status==='pending')r.status='superseded';
 }else admit(s,{family,ownerId,projectId});
 s.rows.set(k,{id,family,ownerId,projectId,kind,target,payloadDigest:seal(payload??null),requestHash,status:'pending',expiresAt:s.now+s.limits.reviewLifetimeMs,seq:++s.seq,lifecycle:capRegistry[family]?.lifecycle??null});
 return {outcome:'prepared',id};
}
/** Confirm once. Retries return the original outcome from the row or the sealed receipt and never apply twice. */
export function confirm(s,{family,id,turn}){
 const k=key(family,id),r=s.rows.get(k);
 if(!r){
  const c=s.receipts.get(k);check(c,'NOT_FOUND',k);verify(c);
  if(['applied','withdrawn'].includes(c.outcome))return {outcome:c.confirmedBy===turn?'replayed':'already-applied',id};
  return {outcome:'expired',id};
 }
 if(r.status==='applied')return {outcome:r.confirmedBy===turn?'replayed':'already-applied',id};
 check(r.status==='pending'&&r.expiresAt>s.now,'REVIEW_EXPIRED',k);
 Object.assign(r,{status:'applied',confirmedBy:turn,appliedAt:s.now,appliedSeq:++s.seq});
 if(r.kind==='withdrawal')s.current.delete(key(family,r.target));else s.current.set(key(family,r.target),k);
 return {outcome:'applied',id};
}
/** External dispatch whose result was lost: the row becomes unknown-outcome authority until reconciled. */
export function markUncertain(s,{family,id}){const r=s.rows.get(key(family,id));check(r&&r.status==='pending','NOT_PENDING',id);r.status='uncertain';}
export function reconcile(s,{family,id,applied,turn=null}){
 const r=s.rows.get(key(family,id));check(r&&r.status==='uncertain','NOT_UNCERTAIN',id);
 if(!applied){r.status='failed';return;}
 Object.assign(r,{status:'applied',confirmedBy:turn,appliedAt:s.now,appliedSeq:++s.seq});
 if(r.kind==='withdrawal')s.current.delete(key(family,r.target));else s.current.set(key(family,r.target),key(family,id));
}
export const pin=(s,family,id,by)=>{const k=key(family,id);s.pins.set(k,new Set([...(s.pins.get(k)??[]),by]));};
export const unpin=(s,family,id,by)=>{s.pins.get(key(family,id))?.delete(by);};
export const hold=(s,h)=>{s.holds.push({...h,released:false});};
export const releaseHolds=s=>{for(const h of s.holds)h.released=true;};
/** Full recovery source still present (referenced or inside the history window); compacted rows are digest-only. */
export const restorable=(s,family,id)=>{const r=s.rows.get(key(family,id));return !!r&&r.status==='applied'&&r.kind==='change';};
function receiptFor(s,r,state){
 const outcome=state==='applied-unreferenced'?(r.kind==='withdrawal'?'withdrawn':'applied'):state;
 const fields={family:r.family,id:r.id,ownerId:r.ownerId,projectId:r.projectId,kind:r.kind,target:r.target,outcome,payloadDigest:r.payloadDigest,requestHash:r.requestHash,confirmedBy:r.confirmedBy??null,appliedAt:r.appliedAt??null,lifecycle:r.lifecycle,sealedAt:s.now};
 return Object.freeze({...fields,seal:seal(fields)});
}
/** Bounded turnover. Runs inside every admission for the caller's project (so no operator or scheduler is needed for
 * progress) and from the daily maintenance pass for idle projects. Every predicate is re-evaluated per row here, as the
 * real deleting statement must. Receipts leave only after the replay horizon and never while held. */
export function turnover(s,{projectId=null,family=null}={}){
 if(s.policy!=='proposed')return {compacted:0,evicted:0};
 const scope=r=>(projectId===null||r.projectId===projectId)&&(family===null||r.family===family);
 let budget=s.limits.turnoverBatch,compacted=0,evicted=0;
 for(const [k,r] of [...s.rows].sort((a,b)=>a[1].seq-b[1].seq)){
  if(budget<=0)break;
  if(!scope(r))continue;
  const state=rowState(s,r);
  if(disposition[state]!=='compact')continue;
  if(state==='expired'&&r.expiresAt+s.limits.terminalGraceMs>s.now)continue;
  s.receipts.set(k,receiptFor(s,r,state));s.rows.delete(k);budget--;compacted++;
 }
 // Receipts are sealed in time order, so the first one still inside the horizon ends the scan.
 for(const [k,c] of s.receipts){
  if(c.sealedAt+s.limits.replayHorizonMs>s.now)break;
  if(!scope(c)||isHeld(s,c))continue;
  s.receipts.delete(k);evicted++;
 }
 return {compacted,evicted};
}
/** Ordinary project cleanup (WH-009 cascade): rows and receipts go with the project unless a safety hold preserves them. */
export function deleteProject(s,projectId){
 for(const [k,r] of [...s.rows])if(r.projectId===projectId&&!isHeld(s,r))s.rows.delete(k);
 for(const [k,c] of [...s.receipts])if(c.projectId===projectId&&!isHeld(s,c))s.receipts.delete(k);
 for(const [t,k] of [...s.current])if(!s.rows.has(k))s.current.delete(t);
}

/* ---------------------------------------------------------------- repository readers (CLI and tests) -------- */

/** The canonical schema input list, read from tools/current-schema.mjs as text (this file imports builtins only). */
export const schemaInputList=root=>JSON.parse(readFileSync(join(root,'tools/current-schema.mjs'),'utf8').match(/currentSchemaFiles=Object\.freeze\((\[[^\]]*\])\)/)[1].replace(/'/g,'"'));
function walk(dir,out=[]){
 for(const name of readdirSync(dir)){const path=join(dir,name);if(statSync(path).isDirectory()){if(name!=='prototypes')walk(path,out);}else if(/\.(ts|mjs|js)$/.test(name))out.push(path);}
 return out;
}
/** Schema facts, tables deleted by any src/ or tools/ source (these prototypes excluded) and the WH-009 table → class map. */
export function loadRepository(root,schemaFiles=schemaInputList(root)){
 const files=schemaFiles.map(path=>({path,sql:readFileSync(join(root,path),'utf8')}));
 const appDeletes=new Set([...walk(join(root,'src')),...walk(join(root,'tools'))].flatMap(path=>deletedTables(readFileSync(path,'utf8'))));
 const lifecycle=new Map();
 for(const c of JSON.parse(readFileSync(join(root,'docs/data-lifecycle.json'),'utf8')).classes)for(const t of c.tables)lifecycle.set(t,c.id);
 return {files,facts:schemaFacts(files),appDeletes,lifecycle};
}
export function inventoryReport(repo){
 const rows=capInventory(schemaCaps(repo.facts));
 return {rows,lines:inventoryRows(rows,deleters(repo.facts,repo.appDeletes),t=>repo.lifecycle.get(t)),ceiling:ceilingSet(),converted:convertedSet(),shared:sharedCeilingSet(rows),other:otherPlatformCeilings(rows)};
}
if(import.meta.url.startsWith('file:')&&fileURLToPath(import.meta.url)===process.argv[1]&&process.argv[2]==='--inventory'){
 const report=inventoryReport(loadRepository(join(fileURLToPath(new URL('.',import.meta.url)),'../..')));
 console.log(report.lines.join('\n'));
 for(const name of ['ceiling','converted','shared','other'])console.log(`\n${name}: ${report[name].map(t=>'`'+t+'`').join(', ')}`);
}

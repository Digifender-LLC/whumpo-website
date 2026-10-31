/** WH-019 restore suppression replay. Operator-only: no Worker route, Chat control, agent action or model imports this
 * module; it runs from local operator tooling against an ISOLATED whole-database candidate (a restored backup) before any
 * admission or traffic switch.
 *
 * The ledger (`restore_suppressions`, src/restore-suppression/schema.sql) is written by database triggers inside every
 * erasure and revocation commit and is consulted by guard triggers inside later commits. A restored older database
 * also carries an older ledger, so the authority for a whole-database restore is the CURRENT ledger captured from the
 * live source (`captureRestoreSuppressions`). `replayRestoreSuppressions` runs only on a NAMED, ISOLATED candidate (the caller passes
 * the candidate and the live source, and the function refuses when they are the same database). It saves the candidate's trigger set,
 * drops the triggers (so the candidate's own guards, written for live traffic, cannot refuse an erasure the ledger already decided),
 * applies the ledger through foreign-key cascades in one atomic data batch, and recreates every trigger from the saved text.
 * The work is several batches (D1 limits a statement to 100 KB and a bound string to 2 MB), so a crash can leave the candidate
 * without triggers: `checkRestoreSuppressions` is the gate that must report `clear` before restored services may receive customer
 * traffic, and it refuses unless the candidate's trigger set equals the digest of the current schema artifact. Re-running the replay
 * resumes from the saved trigger set. Content-free: opaque identifiers, effects and staff revisions only. */

export type SuppressionKind='account'|'project'|'visitor'|'staff'|'record'|'file'|'github_token'|'cloudflare_token';
export type SuppressionEntry={kind:SuppressionKind;subjectId:string;effect:'deleted'|'revoked';revision:number|null;recordedAt:number};
export type SuppressionLedger={version:1;format:'whumpo-restore-suppressions-v1';entries:SuppressionEntry[];sha256:string};
const kinds:readonly SuppressionKind[]=['account','project','visitor','staff','record','file','github_token','cloudflare_token'];
const maxEntries=100000;

async function sha256(text:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
const canonical=(entries:SuppressionEntry[])=>JSON.stringify(entries.map(e=>[e.kind,e.subjectId,e.effect,e.revision,e.recordedAt]));

/** Reads the complete current ledger from the live source in one bounded query. */
export async function captureRestoreSuppressions(db:D1Database):Promise<SuppressionLedger>{
 const rows=(await db.prepare(`SELECT kind,subject_id,effect,revision,recorded_at FROM restore_suppressions ORDER BY kind,subject_id,effect LIMIT ${maxEntries+1}`).all<{kind:SuppressionKind;subject_id:string;effect:'deleted'|'revoked';revision:number|null;recorded_at:number}>()).results;
 if(rows.length>maxEntries)throw new Error('The suppression ledger exceeds this replay bound; use a reviewed compacted procedure.');
 const entries=rows.map(r=>({kind:r.kind,subjectId:r.subject_id,effect:r.effect,revision:r.revision,recordedAt:r.recorded_at}));
 return {version:1,format:'whumpo-restore-suppressions-v1',entries,sha256:await sha256(canonical(entries))};
}


const chunkBytes=1_500_000; // under D1's 2 MB bound-string limit
type TriggerRow={name:string;sql:string};

/** SHA-256 over the sorted (name, text) pairs of a trigger set. The operator computes the expected value from the current schema artifact. */
export async function triggerSetDigest(rows:readonly TriggerRow[]){return sha256(JSON.stringify([...rows].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0).map(r=>[r.name,r.sql])));}
const readTriggers=async(db:D1Database)=>(await db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all<TriggerRow>()).results;

async function verified(ledger:SuppressionLedger){
 if(!ledger||ledger.version!==1||ledger.format!=='whumpo-restore-suppressions-v1'||!Array.isArray(ledger.entries)||ledger.entries.length>maxEntries)throw new Error('Use a current suppression ledger capture.');
 for(const e of ledger.entries){
  if(!e||!kinds.includes(e.kind)||typeof e.subjectId!=='string'||!e.subjectId.length||e.subjectId.length>200||!['deleted','revoked'].includes(e.effect)
   ||(e.kind==='staff')!==(Number.isSafeInteger(e.revision)&&(e.revision as number)>=1)||(e.kind!=='staff'&&e.revision!==null)||!Number.isSafeInteger(e.recordedAt)||e.recordedAt<=0)throw new Error('Use a current suppression ledger capture.');
 }
 if(await sha256(canonical(ledger.entries))!==ledger.sha256)throw new Error('The suppression ledger capture changed.');
 // Bound parameters: JSON slices that each stay under chunkBytes.
 const out:string[]=[];let part:unknown[]=[],size=2;
 for(const e of ledger.entries){
  const item={kind:e.kind,subject:e.subjectId,effect:e.effect,revision:e.revision,at:e.recordedAt},bytes=new TextEncoder().encode(JSON.stringify(item)).length+1;
  if(part.length&&size+bytes>chunkBytes){out.push(JSON.stringify(part));part=[];size=2;}
  part.push(item);size+=bytes;
 }
 out.push(JSON.stringify(part));
 return out;
}

/** Subjects still present (or still active) in a database. `ledger` is one bound JSON slice of the current capture, so this works on
 * a candidate before and after replay. */
const presence:Record<SuppressionKind,string>={
 account:"SELECT count(*) n FROM users WHERE id IN (SELECT json_extract(value,'$.subject') FROM json_each(?1) WHERE json_extract(value,'$.kind')='account')",
 project:"SELECT count(*) n FROM projects WHERE id IN (SELECT json_extract(value,'$.subject') FROM json_each(?1) WHERE json_extract(value,'$.kind')='project')",
 visitor:"SELECT count(*) n FROM app_visitors v WHERE EXISTS(SELECT 1 FROM json_each(?1) WHERE json_extract(value,'$.kind')='visitor' AND json_extract(value,'$.subject')=v.id AND (json_extract(value,'$.effect')='deleted' OR v.revoked=0))",
 staff:"SELECT count(*) n FROM module_access_roles r WHERE r.state='granted' AND EXISTS(SELECT 1 FROM json_each(?1) WHERE json_extract(value,'$.kind')='staff' AND json_extract(value,'$.subject')=r.instance_id||'/'||r.visitor_id||'/'||r.role AND r.access_revision<json_extract(value,'$.revision'))",
 record:"SELECT count(*) n FROM module_records WHERE id IN (SELECT json_extract(value,'$.subject') FROM json_each(?1) WHERE json_extract(value,'$.kind')='record')",
 file:"SELECT count(*) n FROM project_files WHERE id IN (SELECT json_extract(value,'$.subject') FROM json_each(?1) WHERE json_extract(value,'$.kind')='file')",
 github_token:"SELECT count(*) n FROM github_token_vault t WHERE EXISTS(SELECT 1 FROM json_each(?1) WHERE json_extract(value,'$.kind')='github_token' AND json_extract(value,'$.subject')=t.id AND (json_extract(value,'$.effect')='deleted' OR t.state!='revoking'))",
 cloudflare_token:"SELECT count(*) n FROM cloudflare_token_vault t WHERE EXISTS(SELECT 1 FROM json_each(?1) WHERE json_extract(value,'$.kind')='cloudflare_token' AND json_extract(value,'$.subject')=t.id AND (json_extract(value,'$.effect')='deleted' OR t.state!='revoking'))",
};
/** The traffic gate: `clear` only when no suppressed subject is present or active, the candidate's own ledger holds every current
 * entry (so its guards keep refusing later logical restores), its trigger set equals `expected.triggerSha256` (the digest of the
 * current schema artifact, so a replay that was interrupted after dropping triggers can never read as clear) and no replay scratch
 * table is left behind. */
export async function checkRestoreSuppressions(db:D1Database,ledger:SuppressionLedger,expected:{triggerSha256:string}){
 const slices=await verified(ledger),order=[...kinds],pending:Partial<Record<SuppressionKind,number>>={};let missingLedgerEntries=0;
 for(const json of slices){
  const results=await db.batch([...order.map(k=>db.prepare(presence[k]).bind(json)),
   db.prepare("SELECT count(*) n FROM json_each(?1) j WHERE NOT EXISTS(SELECT 1 FROM restore_suppressions s WHERE s.kind=json_extract(j.value,'$.kind') AND s.subject_id=json_extract(j.value,'$.subject') AND s.effect=json_extract(j.value,'$.effect') AND (s.revision IS NULL OR s.revision>=json_extract(j.value,'$.revision')))").bind(json)]);
  order.forEach((k,i)=>{const n=(results[i].results[0] as {n:number}).n;if(n>0)pending[k]=(pending[k]??0)+n;});
  missingLedgerEntries+=(results.at(-1)!.results[0] as {n:number}).n;
 }
 const triggers=await readTriggers(db),scratch=await db.prepare("SELECT 1 x FROM sqlite_master WHERE name=?").bind('restore_replay_triggers').first();
 const triggersMatch=typeof expected?.triggerSha256==='string'&&await triggerSetDigest(triggers)===expected.triggerSha256&&!scratch;
 return {clear:Object.keys(pending).length===0&&missingLedgerEntries===0&&triggersMatch,pending,missingLedgerEntries,triggersMatch,ledgerSha256:ledger.sha256};
}

const ids=(kind:SuppressionKind,effect?:'deleted')=>`(SELECT subject_id FROM restore_suppressions WHERE kind='${kind}'${effect?` AND effect='${effect}'`:''})`;
const quoted=(name:string)=>'"'+name.replaceAll('"','""')+'"';
async function inBatches(db:D1Database,statements:D1PreparedStatement[],size=50){for(let i=0;i<statements.length;i+=size)await db.batch(statements.slice(i,i+size));}

/** Merges the current ledger into an isolated candidate and applies it. Refuses unless the caller names the candidate and passes the live source
 * as a different database. Idempotent: a duplicate replay changes nothing. Tokens whose revocation was only started become `revoking` (and leave the
 * connection pointer, so the scheduled cleanup claims them) with their keys; tokens whose revocation the provider confirmed are removed.
 * Sequence: save the trigger set, drop every trigger, apply the ledger in one atomic data batch (cascades follow the foreign keys; a statement that
 * cannot apply aborts the whole batch and leaves the data unchanged), recreate every trigger from its saved text. Any failure leaves the candidate
 * held: the gate refuses until the trigger set again equals the schema artifact, and a re-run resumes from the saved trigger set. */
export async function replayRestoreSuppressions(candidate:D1Database,ledger:SuppressionLedger,options:{source:D1Database;name:string}){
 if(!options||typeof options.name!=='string'||!options.name.trim()||!options.source)throw new Error('Name the isolated candidate and pass the live source.');
 if(options.source===candidate)throw new Error('The replay refuses to run on its own source; restore into an isolated candidate first.');
 const slices=await verified(ledger);
 // 1. The authoritative trigger set: reuse the saved one when a previous run was interrupted, otherwise save what the candidate has now.
 await candidate.batch([candidate.prepare('CREATE TABLE IF NOT EXISTS restore_replay_triggers(name TEXT PRIMARY KEY,sql TEXT NOT NULL) STRICT')]);
 if(!await candidate.prepare('SELECT 1 x FROM restore_replay_triggers LIMIT 1').first()){
  if(!await candidate.prepare("SELECT 1 x FROM sqlite_master WHERE type='trigger' LIMIT 1").first()){await candidate.prepare('DROP TABLE restore_replay_triggers').run();throw new Error('The candidate has no triggers to restore; it is not a restored copy of the current schema.');}
  await candidate.prepare("INSERT INTO restore_replay_triggers(name,sql) SELECT name,sql FROM sqlite_master WHERE type='trigger'").run();
 }
 const saved=(await candidate.prepare('SELECT name,sql FROM restore_replay_triggers ORDER BY name').all<TriggerRow>()).results;
 // 2. Drop them all.
 await inBatches(candidate,saved.map(t=>candidate.prepare(`DROP TRIGGER IF EXISTS ${quoted(t.name)}`)));
 // 3. The data batch.
 const staffRevisions="SELECT max(json_extract(value,'$.revision')) FROM json_each(?1) WHERE json_extract(value,'$.kind')='staff' AND json_extract(value,'$.subject')=restore_suppressions.subject_id AND json_extract(value,'$.effect')=restore_suppressions.effect";
 const merge=slices.flatMap(json=>[
  candidate.prepare("INSERT OR IGNORE INTO restore_suppressions(kind,subject_id,effect,revision,recorded_at) SELECT json_extract(value,'$.kind'),json_extract(value,'$.subject'),json_extract(value,'$.effect'),json_extract(value,'$.revision'),json_extract(value,'$.at') FROM json_each(?1)").bind(json),
  candidate.prepare(`UPDATE restore_suppressions SET revision=(${staffRevisions}) WHERE kind='staff' AND revision<(${staffRevisions})`).bind(json),
 ]);
 // With the candidate's triggers dropped, the cleanup its delete triggers would have done is stated here: private objects are queued for storage cleanup,
 // dependent visitor rows and attached files go first, and the notice, fair-use and access-revision bookkeeping follows the erasure.
 const doomedFiles=`f.id IN ${ids('file')} OR f.project_id IN ${ids('project')} OR p.owner_user_id IN ${ids('account')} OR f.id IN (SELECT file_id FROM module_record_files WHERE entry_id IN ${ids('record')}) OR f.id IN (SELECT file_id FROM module_files WHERE visitor_id IN ${ids('visitor','deleted')})`;
 const erasedVisitors=ids('visitor','deleted'),live=`(SELECT id FROM app_visitors WHERE revoked=0 AND id IN ${ids('visitor')})`;
 const statements=[...merge,
  // A revoking token must not stay the active connection: the cleanup only claims tokens no connection points at.
  candidate.prepare(`UPDATE github_connections SET active_token_id=NULL WHERE active_token_id IN ${ids('github_token')}`),
  candidate.prepare(`UPDATE github_token_vault SET state='revoking' WHERE state!='revoking' AND id IN ${ids('github_token')}`),
  candidate.prepare(`INSERT OR IGNORE INTO github_revocation_health(token_id,requested_at) SELECT id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM github_token_vault WHERE state='revoking' AND id IN ${ids('github_token')}`),
  candidate.prepare(`DELETE FROM github_refresh_custody WHERE token_id IN ${ids('github_token','deleted')}`),
  candidate.prepare(`DELETE FROM github_token_vault WHERE id IN ${ids('github_token','deleted')}`),
  candidate.prepare(`UPDATE cloudflare_token_vault SET state='revoking' WHERE state!='revoking' AND id IN ${ids('cloudflare_token')}`),
  candidate.prepare(`INSERT OR IGNORE INTO cloudflare_revocation_health(token_id,requested_at) SELECT id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM cloudflare_token_vault WHERE state='revoking' AND id IN ${ids('cloudflare_token')}`),
  candidate.prepare(`DELETE FROM cloudflare_token_vault WHERE id IN ${ids('cloudflare_token','deleted')}`),
  candidate.prepare("UPDATE module_access_roles SET state='revoked',review_id=NULL,updated_at=max(updated_at,unixepoch()) WHERE state='granted' AND EXISTS(SELECT 1 FROM restore_suppressions s WHERE s.kind='staff' AND s.subject_id=module_access_roles.instance_id||'/'||module_access_roles.visitor_id||'/'||module_access_roles.role AND module_access_roles.access_revision<s.revision)"),
  // Revoking a visitor ends its sessions, credentials and copies and revokes its staff grants (what the revocation triggers do), before the flag flips.
  candidate.prepare(`UPDATE module_access_roles SET state='revoked',review_id=NULL,access_revision=coalesce((SELECT revision+1 FROM module_access_states WHERE instance_id=module_access_roles.instance_id),access_revision),updated_at=max(updated_at,unixepoch()) WHERE state='granted' AND visitor_id IN ${live}`),
  candidate.prepare(`UPDATE module_access_states SET revision=revision+1,updated_at=max(updated_at,unixepoch()) WHERE instance_id IN (SELECT access_id FROM app_visitors WHERE id IN ${live})`),
  ...['app_sessions','app_passkeys','app_recovery_codes','app_auth_challenges','app_recovery_documents','app_migration_documents'].map(t=>candidate.prepare(`DELETE FROM ${t} WHERE visitor_id IN ${live}`)),
  candidate.prepare(`UPDATE app_visitors SET revoked=1 WHERE revoked=0 AND id IN ${ids('visitor')}`),
  candidate.prepare("DELETE FROM staff_notification_optins WHERE EXISTS(SELECT 1 FROM module_access_roles r WHERE r.instance_id=staff_notification_optins.instance_id AND r.visitor_id=staff_notification_optins.visitor_id AND r.state='revoked')"),
  candidate.prepare(`INSERT OR IGNORE INTO file_cleanup(object_key,created_at,project_id,owner_user_id) SELECT f.object_key,strftime('%Y-%m-%dT%H:%M:%fZ','now'),f.project_id,p.owner_user_id FROM project_files f JOIN projects p ON p.id=f.project_id WHERE ${doomedFiles}`),
  candidate.prepare(`UPDATE notification_notices SET sent_to=NULL WHERE sent_to IS NOT NULL AND recipient_key IN (SELECT prefix||visitor_id FROM visitor_notification_addresses, (SELECT 'project-staff:' prefix UNION ALL SELECT 'submitter:') WHERE visitor_id IN ${erasedVisitors})`),
  candidate.prepare(`UPDATE notification_notices SET state='cancelled',reason='record-removed',outcome_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE project_id IN ${ids('project')} AND state IN ('queued','deferred')`),
  candidate.prepare(`UPDATE fair_use_project_lifecycle SET removed_at=COALESCE(removed_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE project_id IN ${ids('project')}`),
  candidate.prepare(`DELETE FROM project_files WHERE id IN (SELECT file_id FROM module_record_files WHERE entry_id IN ${ids('record')}) OR id IN (SELECT file_id FROM module_files WHERE visitor_id IN ${erasedVisitors})`),
  ...['app_auth_challenges','app_passkeys','app_recovery_codes','app_sessions','app_runs','app_documents'].map(t=>candidate.prepare(`DELETE FROM ${t} WHERE visitor_id IN ${erasedVisitors}`)),
  candidate.prepare(`DELETE FROM app_invitations WHERE used_by IN ${erasedVisitors}`),
  candidate.prepare(`UPDATE module_access_states SET revision=revision+1,updated_at=max(updated_at,unixepoch()) WHERE instance_id IN (SELECT access_id FROM app_visitors WHERE id IN ${erasedVisitors})`),
  // A staff grant is revived only by an exact owner review that carries a newer access revision than the revocation, so the module's own revision must not lag the ledger.
  candidate.prepare("UPDATE module_access_states SET revision=(SELECT max(s.revision) FROM restore_suppressions s WHERE s.kind='staff' AND s.subject_id LIKE module_access_states.instance_id||'/%') WHERE revision<coalesce((SELECT max(s.revision) FROM restore_suppressions s WHERE s.kind='staff' AND s.subject_id LIKE module_access_states.instance_id||'/%'),0)"),
  candidate.prepare(`DELETE FROM module_records WHERE id IN ${ids('record')}`),
  candidate.prepare(`DELETE FROM app_visitors WHERE id IN ${erasedVisitors}`),
  candidate.prepare(`DELETE FROM projects WHERE id IN ${ids('project')}`),
  candidate.prepare(`DELETE FROM project_files WHERE id IN ${ids('file')}`),
  candidate.prepare(`DELETE FROM identity_challenges WHERE account_id IN ${ids('account')}`),
  candidate.prepare(`DELETE FROM users WHERE id IN ${ids('account')}`),
 ];
 const labels=['githubConnectionsDetached','githubTokensRevoking','githubRevocationHealth','githubRefreshCustodyRemoved','githubTokensRemoved','cloudflareTokensRevoking','cloudflareRevocationHealth','cloudflareTokensRemoved','staffGrantsRevoked','visitorGrantsRevoked','visitorAccessRevisionsBumped','visitorSessionsEnded','visitorPasskeysEnded','visitorRecoveryCodesEnded','visitorChallengesEnded','recoveryCopiesRemoved','migrationCopiesRemoved','visitorsRevoked','staffOptinsRemoved','objectsQueuedForCleanup','erasedAddressesCleared','noticesCancelled','fairUseMarkedRemoved','attachedFilesRemoved','visitorAuthRemoved','visitorPasskeysRemoved','visitorRecoveryRemoved','visitorSessionsRemoved','visitorRunsRemoved','visitorDocumentsRemoved','visitorInvitationsRemoved','accessRevisionsBumped','staffModuleRevisionsRaised','recordsRemoved','visitorsRemoved','projectsRemoved','filesRemoved','identityChallengesRemoved','accountsRemoved'];
 let results:D1Result[];
 try{results=await candidate.batch(statements);}
 finally{
  // 4. Recreate the triggers whether or not the data batch applied; a failure here leaves the gate refusing.
  await inBatches(candidate,saved.map(t=>candidate.prepare(t.sql)));
 }
 await candidate.prepare('DROP TABLE restore_replay_triggers').run();
 const added=results.slice(0,merge.length).filter((_,i)=>i%2===0).reduce((n,r)=>n+r.meta.changes,0),raised=results.slice(0,merge.length).filter((_,i)=>i%2===1).reduce((n,r)=>n+r.meta.changes,0);
 const rest=results.slice(merge.length);
 return {version:1 as const,ledgerSha256:ledger.sha256,triggersRestored:saved.length,applied:{ledgerEntriesAdded:added,staffRevisionsRaised:raised,...Object.fromEntries(labels.map((l,i)=>[l,rest[i].meta.changes]))} as Record<string,number>};
}

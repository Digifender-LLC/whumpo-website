/** WH-019 restore suppression replay. Operator-only: no Worker route, Chat control, agent action or model imports this
 * module; it runs from local operator tooling against an ISOLATED whole-database candidate (a restored backup) before any
 * admission or traffic switch.
 *
 * The ledger (`restore_suppressions`, src/account-lifecycle/schema.sql) is written by database triggers inside every
 * erasure and revocation commit and is consulted by guard triggers inside later commits. A restored older database
 * also carries an older ledger, so the authority for a whole-database restore is the CURRENT ledger captured from the
 * live source (`captureRestoreSuppressions`). `replayRestoreSuppressions` merges it into the candidate and applies it in
 * one atomic batch; `checkRestoreSuppressions` is the gate that must report `clear` before restored services may
 * receive customer traffic. A candidate whose own triggers refuse a replay statement (for example a photo still
 * referenced by a saved version whose removal happened after the backup) aborts as a whole and stays held. Content-free:
 * opaque identifiers, effects and staff revisions only. */

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

async function verified(ledger:SuppressionLedger){
 if(!ledger||ledger.version!==1||ledger.format!=='whumpo-restore-suppressions-v1'||!Array.isArray(ledger.entries)||ledger.entries.length>maxEntries)throw new Error('Use a current suppression ledger capture.');
 for(const e of ledger.entries){
  if(!e||!kinds.includes(e.kind)||typeof e.subjectId!=='string'||!e.subjectId.length||e.subjectId.length>200||!['deleted','revoked'].includes(e.effect)
   ||(e.kind==='staff')!==(Number.isSafeInteger(e.revision)&&(e.revision as number)>=1)||(e.kind!=='staff'&&e.revision!==null)||!Number.isSafeInteger(e.recordedAt)||e.recordedAt<=0)throw new Error('Use a current suppression ledger capture.');
 }
 if(await sha256(canonical(ledger.entries))!==ledger.sha256)throw new Error('The suppression ledger capture changed.');
 return JSON.stringify(ledger.entries.map(e=>({kind:e.kind,subject:e.subjectId,effect:e.effect,revision:e.revision,at:e.recordedAt})));
}

/** Subjects still present (or still active) in a database. `ledger` is the current capture; it is passed as a bound
 * JSON parameter, so this works on a candidate before and after replay. */
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
/** The traffic gate: `clear` only when no suppressed subject is present or active and the candidate's own ledger holds
 * every current entry (so its guards keep refusing later logical restores). */
export async function checkRestoreSuppressions(db:D1Database,ledger:SuppressionLedger){
 const json=await verified(ledger),order=[...kinds];
 const results=await db.batch([...order.map(k=>db.prepare(presence[k]).bind(json)),
  db.prepare("SELECT count(*) n FROM json_each(?1) j WHERE NOT EXISTS(SELECT 1 FROM restore_suppressions s WHERE s.kind=json_extract(j.value,'$.kind') AND s.subject_id=json_extract(j.value,'$.subject') AND s.effect=json_extract(j.value,'$.effect') AND (s.revision IS NULL OR s.revision>=json_extract(j.value,'$.revision')))").bind(json)]);
 const pending=Object.fromEntries(order.map((k,i)=>[k,(results[i].results[0] as {n:number}).n]).filter(([,n])=>(n as number)>0)) as Partial<Record<SuppressionKind,number>>;
 const missingLedgerEntries=(results.at(-1)!.results[0] as {n:number}).n;
 return {clear:Object.keys(pending).length===0&&missingLedgerEntries===0,pending,missingLedgerEntries,ledgerSha256:ledger.sha256};
}

const ids=(kind:SuppressionKind,effect?:'deleted')=>`(SELECT subject_id FROM restore_suppressions WHERE kind='${kind}'${effect?` AND effect='${effect}'`:''})`;
/** Merges the current ledger into the candidate and applies it in ONE batch (all or nothing). Idempotent: a duplicate
 * replay changes nothing. Tokens whose revocation was only started become `revoking` so the existing cleanup keeps
 * revoking them with their keys; tokens whose revocation the provider confirmed are removed. */
export async function replayRestoreSuppressions(db:D1Database,ledger:SuppressionLedger){
 const json=await verified(ledger);
 const statements=[
  db.prepare("INSERT OR IGNORE INTO restore_suppressions(kind,subject_id,effect,revision,recorded_at) SELECT json_extract(value,'$.kind'),json_extract(value,'$.subject'),json_extract(value,'$.effect'),json_extract(value,'$.revision'),json_extract(value,'$.at') FROM json_each(?1)").bind(json),
  db.prepare("UPDATE restore_suppressions SET revision=(SELECT json_extract(value,'$.revision') FROM json_each(?1) WHERE json_extract(value,'$.kind')='staff' AND json_extract(value,'$.subject')=restore_suppressions.subject_id AND json_extract(value,'$.effect')=restore_suppressions.effect) WHERE kind='staff' AND revision<(SELECT json_extract(value,'$.revision') FROM json_each(?1) WHERE json_extract(value,'$.kind')='staff' AND json_extract(value,'$.subject')=restore_suppressions.subject_id AND json_extract(value,'$.effect')=restore_suppressions.effect)").bind(json),
  db.prepare(`UPDATE github_token_vault SET state='revoking' WHERE state!='revoking' AND id IN ${ids('github_token')}`),
  db.prepare(`DELETE FROM github_refresh_custody WHERE token_id IN ${ids('github_token','deleted')}`),
  db.prepare(`DELETE FROM github_token_vault WHERE id IN ${ids('github_token','deleted')}`),
  db.prepare(`UPDATE cloudflare_token_vault SET state='revoking' WHERE state!='revoking' AND id IN ${ids('cloudflare_token')}`),
  db.prepare(`DELETE FROM cloudflare_token_vault WHERE id IN ${ids('cloudflare_token','deleted')}`),
  db.prepare("UPDATE module_access_roles SET state='revoked',review_id=NULL,updated_at=max(updated_at,unixepoch()) WHERE state='granted' AND EXISTS(SELECT 1 FROM restore_suppressions s WHERE s.kind='staff' AND s.subject_id=module_access_roles.instance_id||'/'||module_access_roles.visitor_id||'/'||module_access_roles.role AND module_access_roles.access_revision<s.revision)"),
  db.prepare(`UPDATE app_visitors SET revoked=1 WHERE revoked=0 AND id IN ${ids('visitor')}`),
  db.prepare(`DELETE FROM module_records WHERE id IN ${ids('record')}`),
  db.prepare(`DELETE FROM app_visitors WHERE id IN ${ids('visitor','deleted')}`),
  db.prepare(`DELETE FROM project_files WHERE id IN ${ids('file')}`),
  db.prepare(`DELETE FROM projects WHERE id IN ${ids('project')}`),
  db.prepare(`DELETE FROM identity_challenges WHERE account_id IN ${ids('account')}`),
  db.prepare(`DELETE FROM users WHERE id IN ${ids('account')}`),
 ];
 const labels=['ledgerEntriesAdded','staffRevisionsRaised','githubTokensRevoking','githubRefreshCustodyRemoved','githubTokensRemoved','cloudflareTokensRevoking','cloudflareTokensRemoved','staffGrantsRevoked','visitorsRevoked','recordsRemoved','visitorsRemoved','filesRemoved','projectsRemoved','identityChallengesRemoved','accountsRemoved'];
 const results=await db.batch(statements);
 return {version:1 as const,ledgerSha256:ledger.sha256,applied:Object.fromEntries(labels.map((l,i)=>[l,results[i].meta.changes])) as Record<string,number>};
}

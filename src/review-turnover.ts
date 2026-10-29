// WH-182 review turnover (docs/review-retention.md, "Turnover"). A terminal, superseded or expired review row leaves only
// together with a sealed receipt written in the same D1 batch, and only when the deleting statement itself still finds it
// terminal, unreferenced, unheld and outside the history window. The predicates are generated from the schema guards
// (tools/generate-review-turnover.mjs), so this file holds no hand-copied copy of them. SQLite cannot compute SHA-256, so the
// Worker reads the candidates, computes each digest and seal, and the batch re-checks everything in SQL: a row that changed
// meanwhile is simply skipped, and an ineligible row can never reach the delete guard's abort.
import {hashToken} from './security';
import {reviewFamilies,outcomeSql,scopeColumn,eligibleSql as eligible,type ReviewFamily} from './review-turnover.generated';

export const turnoverPolicy=Object.freeze({
 turnoverBatch:200,                 // rows compacted per admission (and per scope in a daily pass)
 replayHorizonMs:30*86_400_000,     // sealed receipts answer retries this long, then leave
 sweepRows:1000,                    // rows compacted per daily run, across all families
 sweepScopes:25,                    // projects (or owners) examined per family per daily run
});
export type ReviewFamilyName=keyof typeof reviewFamilies;
export const reviewFamilyNames=Object.keys(reviewFamilies) as ReviewFamilyName[];
export class ReviewReceiptError extends Error{status:number;constructor(status:number,message:string){super(message);this.status=status;}}

const canonical=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v??null):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';
/** Same field names and canonical form as the offline reference (tools/prototypes/review-retention.mjs). */
type Fields={family:string;id:string;ownerId:string;projectId:string|null;kind:string;target:string;outcome:string;payloadDigest:string;requestHash:string;confirmedBy:string|null;appliedAt:string|null;lifecycle:string;sealedAt:string};
const seal=(fields:Fields)=>hashToken(canonical(fields));
// Projects own most families; the four that carry no project (nominations, grant revocations, CMS unpublish and discard) are scoped to their owner.
const family=(name:string)=>{const f=reviewFamilies[name];if(!f)throw Error('Unknown review family');return f;};

/** The three statements of one family's turnover (placeholders only), exported so a test can compile every family. */
export function turnoverSql(name:string){
 const f=family(name);
 return {
  read:`SELECT ${f.digest?'':'r.*,'}r.id AS _id,r.user_id AS _owner,${f.project?'r.project_id':'NULL'} AS _project,${f.kind} AS _kind,${f.target} AS _target,${outcomeSql(f)} AS _outcome,${f.digest??'NULL'} AS _digest,${f.hash??'NULL'} AS _hash,${f.confirmed??'NULL'} AS _confirmed FROM ${f.table} r WHERE r.${scopeColumn(f)}=? AND ${eligible(f)} ORDER BY r.rowid LIMIT ?`,
  insert:`INSERT OR IGNORE INTO review_receipts(family,id,owner_user_id,project_id,kind,target,outcome,payload_digest,request_hash,confirmed_by,applied_at,lifecycle_class,sealed_at,seal) SELECT ?,?,?,?,?,?,?,?,?,?,NULL,?,?,? WHERE EXISTS(SELECT 1 FROM ${f.table} r WHERE r.id=? AND ${eligible(f)} AND ${outcomeSql(f)} IS ?)`,
  // Only a row whose receipt is present and consistent with its current state may go; the guard's own predicate is repeated here.
  remove:`DELETE FROM ${f.table} AS r WHERE r.${scopeColumn(f)}=? AND ${eligible(f)} AND EXISTS(SELECT 1 FROM review_receipts q WHERE q.family=? AND q.id=r.id AND q.outcome IS ${outcomeSql(f)} AND ${f.receipt})`,
 };
}
type Candidate=Record<string,unknown>&{_id:string;_owner:string;_project:string|null;_kind:string;_target:string;_outcome:string;_digest:string|null;_hash:string|null;_confirmed:string|null};
/** Statements that seal and delete this scope's eligible rows: one guarded receipt insert per row, then one guarded delete. Empty when nothing is eligible. */
export async function turnoverStatements(db:D1Database,name:string,scope:{user:string;project?:string|null},limit:number=turnoverPolicy.turnoverBatch):Promise<D1PreparedStatement[]>{
 const f=family(name),subject=f.project?scope.project:scope.user;
 if(!subject||limit<1)return [];
 const sql=turnoverSql(name),{results}=await db.prepare(sql.read).bind(subject,limit).all<Candidate>();
 if(!results.length)return [];
 const sealedAt=new Date().toISOString(),statements:D1PreparedStatement[]=[];
 for(const row of results){
  const fields:Fields={family:name,id:row._id,ownerId:row._owner,projectId:row._project,kind:row._kind,target:row._target,outcome:row._outcome,payloadDigest:'',requestHash:'',confirmedBy:row._confirmed,appliedAt:null,lifecycle:f.cls,sealedAt};
  // Where the source row carries no digest or request hash, the Worker derives it: the payload digest covers every column
  // of the row as read, the request hash the row's own identity.
  const content=Object.fromEntries(Object.entries(row).filter(([k])=>!k.startsWith('_')));
  fields.payloadDigest=row._digest??await hashToken(canonical(content));
  fields.requestHash=row._hash??await hashToken(canonical([name,row._id,row._owner,row._project,row._kind,row._target]));
  statements.push(db.prepare(sql.insert)
   .bind(name,row._id,row._owner,row._project,row._kind,row._target,row._outcome,fields.payloadDigest,fields.requestHash,row._confirmed,f.cls,sealedAt,await seal(fields),row._id,row._outcome));
 }
 statements.push(db.prepare(sql.remove).bind(subject,name));
 return statements;
}
/** Run one scope's turnover on its own (used by the daily pass). Returns the rows sealed. */
export async function compact(db:D1Database,name:string,scope:{user:string;project?:string|null},limit?:number){
 const statements=await turnoverStatements(db,name,scope,limit);
 if(statements.length)await db.batch(statements);
 return Math.max(0,statements.length-1);
}

/** Daily bounded pass: compacts eligible rows of projects (or owners) that had no admission to do it, then removes receipts past the replay horizon. */
export async function maintainReviews(db:D1Database){
 let budget=turnoverPolicy.sweepRows,failure:unknown;
 for(const name of reviewFamilyNames){
  if(budget<1)break;
  const f=family(name);
  try{
   const {results}=await db.prepare(`SELECT r.user_id AS u,${f.project?'r.project_id':'NULL'} AS p FROM ${f.table} r WHERE ${eligible(f)} GROUP BY u,p LIMIT ?`).bind(turnoverPolicy.sweepScopes).all<{u:string;p:string|null}>();
   for(const scope of results){if(budget<1)break;budget-=await compact(db,name,{user:scope.u,project:scope.p},Math.min(turnoverPolicy.turnoverBatch,budget));}
  }catch(error){failure??=error;}
 }
 // The replay horizon runs from sealing; the schema guard refuses an earlier delete or one inside a safety hold, and so does this statement.
 try{
  for(let pass=0;pass<5;pass++){
   const done=await db.prepare(`DELETE FROM review_receipts WHERE rowid IN (SELECT q.rowid FROM review_receipts q WHERE q.sealed_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days') AND NOT EXISTS(SELECT 1 FROM safety_preservation_holds WHERE released_at IS NULL AND scope='account' AND subject_user_id=q.owner_user_id) AND (q.project_id IS NULL OR NOT EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=q.project_id)) ORDER BY q.sealed_at LIMIT ?)`).bind(turnoverPolicy.turnoverBatch).run();
   if((done.meta?.changes??0)<turnoverPolicy.turnoverBatch)break;
  }
 }catch(error){failure??=error;}
 if(failure)throw failure;
}

export type VerifiedReceipt={family:string;id:string;ownerId:string;projectId:string|null;kind:'change'|'withdrawal';target:string;outcome:'applied'|'withdrawn'|'expired'|'superseded'|'failed';payloadDigest:string;requestHash:string;confirmedBy:string|null;sealedAt:string};
/** The sealed receipt for a compacted review, inside the replay horizon, with its seal recomputed. A receipt that fails its seal is an integrity failure, never a miss. */
export async function readReviewReceipt(db:D1Database,name:string,id:string,owner:string):Promise<VerifiedReceipt|null>{
 family(name);
 const row=await db.prepare("SELECT * FROM review_receipts WHERE family=? AND id=? AND owner_user_id=? AND sealed_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')").bind(name,id,owner).first<Record<string,string|null>>();
 if(!row)return null;
 const fields:Fields={family:name,id,ownerId:row.owner_user_id!,projectId:row.project_id,kind:row.kind!,target:row.target!,outcome:row.outcome!,payloadDigest:row.payload_digest!,requestHash:row.request_hash!,confirmedBy:row.confirmed_by,appliedAt:row.applied_at,lifecycle:row.lifecycle_class!,sealedAt:row.sealed_at!};
 if(await seal(fields)!==row.seal||fields.lifecycle!==family(name).cls)throw new ReviewReceiptError(503,'A saved review receipt failed its integrity check.');
 return {family:name,id,ownerId:fields.ownerId,projectId:fields.projectId,kind:fields.kind as VerifiedReceipt['kind'],target:fields.target,outcome:fields.outcome as VerifiedReceipt['outcome'],payloadDigest:fields.payloadDigest,requestHash:fields.requestHash,confirmedBy:fields.confirmedBy,sealedAt:fields.sealedAt};
}
/** A retry with the same request hash replays the original outcome; a different hash conflicts. */
export function requireReceiptMatch(receipt:VerifiedReceipt,expected:{requestHash?:string;payloadDigest?:string}){
 if(expected.requestHash!==undefined&&expected.requestHash!==receipt.requestHash||expected.payloadDigest!==undefined&&expected.payloadDigest!==receipt.payloadDigest)throw new ReviewReceiptError(409,'This review request ID was already used for a different request.');
 return receipt;
}
/** What a customer is told when a retried confirmation reaches a compacted review. */
export function receiptOutcomeMessage(r:VerifiedReceipt){
 return r.outcome==='applied'||r.outcome==='withdrawn'?'That review was already applied. Nothing was applied again.'
  :r.outcome==='expired'?'That review expired and was not applied. Prepare a fresh review.'
  :r.outcome==='superseded'?'That review was replaced by a newer one and was not applied. Use the newer review.'
  :'That review did not complete and was not applied. Prepare a fresh review.';
}

/** Run an admission insert with this scope's turnover in the same batch. A turnover problem never blocks the admission: the insert then runs alone and reports its own trigger error. */
export async function admitWithTurnover(db:D1Database,name:string,scope:{user:string;project?:string|null},insert:D1PreparedStatement|D1PreparedStatement[]){
 const inserts=Array.isArray(insert)?insert:[insert];
 let before:D1PreparedStatement[]=[];
 try{before=await turnoverStatements(db,name,scope);}catch{console.error(JSON.stringify({event:'review.turnover_failed',family:name}));}
 if(before.length)try{const results=await db.batch([...before,...inserts]);return results[results.length-1];}catch{console.error(JSON.stringify({event:'review.admission_without_turnover',family:name}));}
 return inserts.length===1?inserts[0].run():(await db.batch(inserts)).at(-1)!;
}
/** For a review id that no longer has a row: an error carrying the original outcome when it was compacted into a verified receipt inside the replay horizon, otherwise null. `make` builds the caller's own error class; a different `requestHash` than the sealed one is a conflict. */
export async function compactedReview<E extends Error>(db:D1Database,name:string,id:string,owner:string,make:(status:number,message:string)=>E,requestHash?:string):Promise<E|null>{
 try{const receipt=await readReviewReceipt(db,name,id,owner);if(!receipt)return null;requireReceiptMatch(receipt,{requestHash});return make(409,receiptOutcomeMessage(receipt));}
 catch(error){if(error instanceof ReviewReceiptError)return make(error.status,error.message);throw error;}
}

/** WH-052 P-2: the D1 job journal (schema/platform.sql `job_journal`, `job_journal_events`, `job_outbox`; docs/job-orchestration.md).
 * D1 cannot read and then branch inside one commit, so no function here does. Each transition is ONE guarded statement: its WHERE clause
 * is the fence/lease compare-and-set, `RETURNING` says whether it won, and the schema's triggers (job_journal_transition and friends)
 * re-check the transition and write the immutable event in the same statement. A caller that lost the race updates zero rows.
 * Nothing here is authority: a claim, a lease or a valid envelope never replaces the domain adapter's own admission (docs/job-envelope.md).
 * The offline contract validator (tools/prototypes/job-envelope.mjs) stays the full envelope check; admitJob only requires the fields
 * the journal itself depends on and lets the schema cross-check them against the stored envelope. */
type Db=Pick<D1Database,'prepare'|'batch'>;
export const jobPurposes=['platform-email','deterministic-rule','owner-push','account-cleanup','project-build','domain-registration'] as const;
export type JobPurpose=typeof jobPurposes[number];
export type JobState='ready'|'leased'|'awaiting'|'uncertain'|'complete'|'cancelled'|'operator'|'expired';
export type JobRow={id:string;owner_user_id:string;purpose:JobPurpose;envelope_json:string;envelope_digest:string;created_at:number;expires_at:number;max_attempts:number;
 due:number;initial_due:number;state:JobState;fence:number;lease_until:number;attempt:number;attempt_id:string|null;cancel_requested:number;cursor:number;
 result_ref:string|null;last_event:string;last_at:number;last_ref:string|null};
/** The holder's proof for a lease: the job, its owner and the fence the claim returned. */
export type JobLease={id:string;owner:string;fence:number};
export const jobLeaseMaxMs=60000;
/** Terminal jobs and their events are pruned this long after their last transition. Interim default (30 days) pending an owner decision on journal retention. */
export const jobJournalRetentionMs=30*24*3600*1000;
export class JobJournalError extends Error{constructor(readonly code:'invalid'|'conflict'|'lost'){super(`job_${code}`);}}
const ref=/^[a-zA-Z0-9_.:-]{1,128}$/,uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const bad=():never=>{throw new JobJournalError('invalid');};
const int=(n:unknown)=>Number.isSafeInteger(n)&&(n as number)>=0?n as number:bad();
const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');

/** Canonical JSON as the offline reference writes it: sorted keys, safe non-negative integers only, at most ten levels and 16 array items. */
function canonical(v:unknown,depth=0):string{
 if(depth>10)return bad();
 if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
 if(typeof v==='number')return JSON.stringify(int(v));
 if(Array.isArray(v)){if(v.length>16)return bad();return '['+v.map(x=>canonical(x,depth+1)).join(',')+']';}
 if(v&&typeof v==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(v)))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k],depth+1)).join(',')+'}';
 return bad();
}
export const canonicalEnvelopeJson=(envelope:unknown)=>canonical(envelope);
export async function envelopeDigest(envelope:unknown){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(envelope))));}

/** Admit an envelope: one batch inserts the job (the schema adds its outbox entry and first event) and reads it back. The same id with the same
 * digest and owner returns the existing job (a lost admission reply); anything else is a conflict. */
export async function admitJob(db:Db,envelope:Record<string,any>){
 const e=envelope as any;
 if(!(e&&e.contractVersion===1&&uuid.test(e.jobId)&&uuid.test(e.ownerAccountId)&&jobPurposes.includes(e.purpose)&&e.schedule&&e.limits))bad();
 const json=canonical(envelope);
 if(new TextEncoder().encode(json).length>8192)bad();
 const digest=await envelopeDigest(envelope),{createdAt,notBefore,expiresAt}=e.schedule;
 const [,read]=await db.batch([
  db.prepare("INSERT INTO job_journal(id,owner_user_id,purpose,envelope_json,envelope_digest,created_at,expires_at,max_attempts,due,initial_due,last_event,last_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,'enqueued',?6) ON CONFLICT(id) DO NOTHING")
   .bind(e.jobId,e.ownerAccountId,e.purpose,json,digest,int(createdAt),int(expiresAt),int(e.limits.maxAttempts),int(notBefore)),
  db.prepare('SELECT * FROM job_journal WHERE id=?1 AND owner_user_id=?2').bind(e.jobId,e.ownerAccountId)]);
 const row=read.results[0] as JobRow|undefined;
 if(!row||row.envelope_digest!==digest)throw new JobJournalError('conflict');
 return row;
}
export async function readJob(db:Db,owner:string,id:string){return await db.prepare('SELECT * FROM job_journal WHERE owner_user_id=?1 AND id=?2').bind(owner,id).first<JobRow>();}
const lease=(row:JobRow):JobLease=>({id:row.id,owner:row.owner_user_id,fence:row.fence});
const won=async(statement:D1PreparedStatement)=>await statement.first<JobRow>();

/** Take (or, after a pre-dispatch lease expired, retake) a lease. At most one of any number of racing claimers gets a row; its fence is new. */
export async function claimJob(db:Db,owner:string,id:string,now:number,leaseMs=jobLeaseMaxMs){
 int(now);if(int(leaseMs)<1||leaseMs>jobLeaseMaxMs)bad();
 const row=await won(db.prepare(`UPDATE job_journal SET state='leased',fence=fence+1,lease_until=?1+?2,last_event='claimed',last_at=?1,last_ref=NULL
  WHERE owner_user_id=?3 AND id=?4 AND cancel_requested=0 AND expires_at>?1 AND ((state='ready' AND due<=?1) OR (state='leased' AND lease_until<=?1)) RETURNING *`).bind(now,leaseMs,owner,id));
 return row?{row,lease:lease(row)}:null;
}
/** Bind values for statements whose ?1..?3 are the lease: job id, owner and fence. */
const holder=(l:JobLease,...values:unknown[])=>[l.id,l.owner,l.fence,...values];
/** Record the intent to call the outside world: leased -> awaiting, one attempt. From here an expired lease can only mean uncertain. */
export const beginStatement=(db:Db,l:JobLease,now:number)=>db.prepare(`UPDATE job_journal SET state='awaiting',attempt=attempt+1,attempt_id=id||'.'||(attempt+1),last_event='intent',last_at=?4,last_ref=id||'.'||(attempt+1)
  WHERE id=?1 AND owner_user_id=?2 AND fence=?3 AND state='leased' AND lease_until>?4 AND expires_at>?4 AND cancel_requested=0 AND attempt<max_attempts RETURNING *`).bind(...holder(l,now));
export async function beginExternal(db:Db,l:JobLease,now:number){
 int(now);
 const row=await won(beginStatement(db,l,now));
 if(!row)throw new JobJournalError('lost');
 return row;
}
/** The holder lost the reply (timeout or unknown error): the effect may have happened, so the job is held for reconciliation, never retried. */
export async function markUncertain(db:Db,l:JobLease,now:number){
 int(now);
 const row=await won(db.prepare("UPDATE job_journal SET state='uncertain',last_event='uncertain',last_at=?4,last_ref=NULL WHERE id=?1 AND owner_user_id=?2 AND fence=?3 AND state='awaiting' RETURNING *").bind(...holder(l,now)));
 if(!row)throw new JobJournalError('lost');
 return row;
}
/** Sweep: an `awaiting` job whose lease ran out becomes uncertain (never ready); an unsent job past its expiry becomes expired. Optionally for one purpose. */
export async function recoverExpiredJobs(db:Db,now:number,purpose?:JobPurpose){
 int(now);const p=purpose??null;
 const [uncertain,expired]=await db.batch([
  db.prepare("UPDATE job_journal SET state='uncertain',last_event='uncertain',last_at=?1,last_ref=NULL WHERE state='awaiting' AND lease_until<=?1 AND (?2 IS NULL OR purpose=?2) RETURNING id").bind(now,p),
  db.prepare("UPDATE job_journal SET state='expired',fence=fence+1,lease_until=0,last_event='expired',last_at=?1,last_ref=NULL WHERE state IN ('ready','leased') AND expires_at<=?1 AND (?2 IS NULL OR purpose=?2) RETURNING id").bind(now,p)]);
 // Counted from RETURNING: D1's meta.changes also counts the rows its triggers write.
 return {uncertain:uncertain.results.length,expired:expired.results.length};
}
/** Record the outside result (a provider reference) for an attempt: complete, or cancelled when a cancel was requested meanwhile. Works from awaiting, uncertain
 * or operator. A repeat with the same reference (a lost reply) returns the saved job; a different reference or attempt is a conflict. */
export const settleStatement=(db:Db,owner:string,id:string,attemptId:string,reference:string,now:number)=>db.prepare(`UPDATE job_journal SET state=CASE cancel_requested WHEN 1 THEN 'cancelled' ELSE 'complete' END,result_ref=?5,lease_until=0,last_event='external_result',last_at=?4,last_ref=?5
  WHERE id=?1 AND owner_user_id=?2 AND attempt_id=?3 AND state IN ('awaiting','uncertain','operator') AND result_ref IS NULL RETURNING *`).bind(id,owner,attemptId,now,reference);
export async function settleJob(db:Db,owner:string,id:string,attemptId:string,reference:string,now:number){
 int(now);if(!ref.test(reference)||!ref.test(attemptId))bad();
 const row=await won(settleStatement(db,owner,id,attemptId,reference,now));
 if(row)return row;
 const saved=await readJob(db,owner,id);
 if(saved&&saved.attempt_id===attemptId&&saved.result_ref===reference)return saved;
 throw new JobJournalError('conflict');
}
/** Trusted evidence that the attempt provably did not happen (a timeout or a 404 is not evidence). Fences out the old holder; the job is retried after a
 * bounded backoff, or goes to the operator lane once its attempts are used up, or is cancelled/expired. */
export async function confirmNotSent(db:Db,owner:string,id:string,attemptId:string,evidence:string,now:number){
 int(now);if(!ref.test(evidence)||!ref.test(attemptId))bad();
 const row=await won(db.prepare(`UPDATE job_journal SET fence=fence+1,lease_until=0,attempt_id=NULL,last_event='confirmed_not_sent',last_at=?4,last_ref=?5,
   state=CASE WHEN cancel_requested=1 THEN 'cancelled' WHEN expires_at<=?4 THEN 'expired' WHEN attempt>=max_attempts THEN 'operator' ELSE 'ready' END,
   due=?4+min(3600000,60000*(1<<(attempt-1)))
  WHERE id=?1 AND owner_user_id=?2 AND attempt_id=?3 AND state IN ('awaiting','uncertain','operator') AND result_ref IS NULL RETURNING *`).bind(id,owner,attemptId,now,evidence));
 if(row)return row;
 const saved=await readJob(db,owner,id);
 if(saved&&saved.attempt_id===null&&saved.last_event==='confirmed_not_sent'&&saved.last_ref===evidence)return saved;
 throw new JobJournalError('conflict');
}
/** Stop future work. A dispatched effect is still reconciled: awaiting/uncertain jobs keep their state and only remember the request. Repeats return the saved job. */
export const cancelStatement=(db:Db,owner:string,id:string,now:number)=>db.prepare(`UPDATE job_journal SET cancel_requested=1,fence=fence+1,last_event='cancel_requested',last_at=?3,last_ref=NULL,
   state=CASE WHEN state IN ('awaiting','uncertain') OR (state='operator' AND attempt_id IS NOT NULL) THEN state ELSE 'cancelled' END
  WHERE owner_user_id=?1 AND id=?2 AND cancel_requested=0 AND state NOT IN ('complete','cancelled','expired') RETURNING *`).bind(owner,id,now);
export async function cancelJob(db:Db,owner:string,id:string,now:number){
 int(now);
 const row=await won(cancelStatement(db,owner,id,now));
 if(row)return row;
 const saved=await readJob(db,owner,id);
 if(!saved)throw new JobJournalError('conflict');
 return saved;
}
/** Operator move: park a job that is not in flight (ready, leased) or whose outcome is unknown (uncertain). Nothing claims an operator job. */
export async function holdForOperator(db:Db,owner:string,id:string,reason:string,now:number){
 int(now);if(!ref.test(reason))bad();
 const row=await won(db.prepare(`UPDATE job_journal SET state='operator',fence=fence+1,lease_until=0,last_event='operator_hold',last_at=?3,last_ref=?4
  WHERE owner_user_id=?1 AND id=?2 AND state IN ('ready','leased','uncertain') RETURNING *`).bind(owner,id,now,reason));
 if(!row)throw new JobJournalError('lost');
 return row;
}
/** Operator move: re-drive a parked job that has no attempt in flight and attempts left. There is no bulk retry of uncertain jobs. */
export async function releaseFromOperator(db:Db,owner:string,id:string,reason:string,now:number){
 int(now);if(!ref.test(reason))bad();
 const row=await won(db.prepare(`UPDATE job_journal SET state='ready',fence=fence+1,lease_until=0,due=?3,last_event='operator_release',last_at=?3,last_ref=?4
  WHERE owner_user_id=?1 AND id=?2 AND state='operator' AND attempt_id IS NULL AND cancel_requested=0 AND attempt<max_attempts AND expires_at>?3 RETURNING *`).bind(owner,id,now,reason));
 if(!row)throw new JobJournalError('lost');
 return row;
}
/** Cleanup chunk (account-cleanup only): the local effect statements and the cursor move commit together, or not at all. The guarded UPDATE runs first;
 * if the lease was lost it updates nothing and the next statement fails the whole batch before any effect is applied. */
export async function commitChunk(db:Db,l:JobLease,through:number,done:boolean,now:number,effects:D1PreparedStatement[]){
 int(now);int(through);
 const results=await db.batch([
  db.prepare(`UPDATE job_journal SET cursor=?4,state=?5,due=?6,fence=fence+1,lease_until=0,last_event='chunk_committed',last_at=?6,last_ref=NULL
   WHERE id=?1 AND owner_user_id=?2 AND fence=?3 AND state='leased' AND purpose='account-cleanup' AND lease_until>?6 AND expires_at>?6 AND cancel_requested=0 AND ?4>cursor RETURNING *`).bind(...holder(l,through,done?'complete':'ready',now)),
  // Fails the batch (no such event) exactly when the statement above updated nothing.
  db.prepare("INSERT INTO job_journal_events(job_id,event,fence,attempt,at) SELECT ?1,'lease_lost',0,0,?2 WHERE changes()=0").bind(l.id,now),
  ...effects]).catch(()=>{throw new JobJournalError('lost');});
 return results[0].results[0] as JobRow;
}
/** The outbox entry saved at admission: the stable delivery identity of the wake (docs/job-envelope.md). */
export async function jobDelivery(db:Db,owner:string,id:string){
 const row=await db.prepare('SELECT o.delivery_id,o.job_id,o.envelope_digest,o.acknowledged_at FROM job_outbox o JOIN job_journal j ON j.id=o.job_id WHERE j.owner_user_id=?1 AND j.id=?2').bind(owner,id).first<{delivery_id:string;job_id:string;envelope_digest:string;acknowledged_at:number|null}>();
 return row?{contractVersion:1 as const,deliveryId:row.delivery_id,jobId:row.job_id,envelopeDigest:row.envelope_digest,acknowledgedAt:row.acknowledged_at}:null;
}
/** The producer's transport acknowledgement, set once; a repeat is a no-op. It is never completion. */
export async function acknowledgeDelivery(db:Db,owner:string,deliveryId:string,now:number){
 int(now);
 await db.prepare('UPDATE job_outbox SET acknowledged_at=?3 WHERE delivery_id=?2 AND acknowledged_at IS NULL AND job_id IN (SELECT id FROM job_journal WHERE owner_user_id=?1)').bind(owner,deliveryId,now).run();
}
/** Due jobs of one purpose, oldest due first, at most `perOwner` rows from any one owner so a single owner's backlog cannot fill the scan. */
export async function dueJobs(db:Db,purpose:JobPurpose,now:number,perOwner:number,limit:number){
 int(now);if(int(perOwner)<1||int(limit)<1||limit>100)bad();
 return (await db.prepare(`SELECT id,owner_user_id FROM (SELECT id,owner_user_id,due,row_number() OVER (PARTITION BY owner_user_id ORDER BY due,id) AS rank
   FROM job_journal WHERE purpose=?1 AND cancel_requested=0 AND expires_at>?2 AND ((state='ready' AND due<=?2) OR (state='leased' AND lease_until<=?2)))
  WHERE rank<=?3 ORDER BY due,id LIMIT ?4`).bind(purpose,now,perOwner,limit).all<{id:string;owner_user_id:string}>()).results;
}
/** Nightly maintenance ("jobs"): finished jobs, with their events and outbox entry, once `jobJournalRetentionMs` has passed since their last transition.
 * Unfinished (ready, leased, awaiting, uncertain, operator) jobs are never touched; the schema trigger refuses them too. At most `limit` jobs per run. */
export async function pruneJobJournal(db:Db,now:number=Date.now(),limit=200){
 int(now);if(int(limit)<1||limit>1000)bad();
 const deleted=await db.prepare("DELETE FROM job_journal WHERE id IN (SELECT id FROM job_journal WHERE state IN ('complete','cancelled','expired') AND last_at<=?1 ORDER BY last_at,id LIMIT ?2) RETURNING id").bind(now-jobJournalRetentionMs,limit).all();
 return {jobs:deleted.results.length};
}

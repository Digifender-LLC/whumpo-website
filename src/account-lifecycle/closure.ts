/** WH-018 resumable platform account closure. Callers pass a workspace database admitted with closure `permit`; every
 * statement shares its transaction with the current-identity assertion, and confirmation additionally needs a fresh
 * passkey proof. A model, Chat turn or agent action cannot reach these handlers.
 *
 * Sequence (docs/account-closure.md): exact review -> confirm (durable closure row; ordinary workspace batches now abort,
 * including delayed OAuth callbacks) -> withdraw public serving -> revoke provider credentials through the existing
 * disconnect paths (keys stay until the provider confirms) -> preservation holds -> unresolved operations -> purge.
 * Each step is idempotent and journaled; resume re-runs the first unfinished step. The closure row and journal have no
 * foreign key to users, so they remain as the final receipt after the account cascade. Customer-owned GitHub repositories,
 * Cloudflare zones and other external resources are never deleted; they are listed as remaining obligations. */
import {hashToken} from '../security';
import {IdentityError} from '../workspace-identity/authority';
import {assertWorkspace,assertMaintenanceDatabase,requireFreshWorkspace} from '../workspace-identity/admission';
import {revokeGitHubCustody,githubConfig} from '../github-connection';
import {revokeCloudflareCustody,cloudflareConfig} from '../cloudflare-connection';
import {closureCounts,closureMetricSQL,closureScopeSQL,type ClosureCounts} from './inventory';

export class AccountLifecycleError extends Error{
 constructor(readonly status:400|404|409|503,readonly code:'invalid_request'|'not_found'|'stale_review'|'request_conflict'|'action_required'|'closure_exists'|'closure_unavailable',message:string){super(message);this.name='AccountLifecycleError';}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const reviewSeconds=600;
export const closureSteps=['freeze','withdraw','credentials','holds','operations','purge'] as const;
type Step=typeof closureSteps[number];
type StepState='pending'|'done'|'waiting'|'blocked';
type StepResult={state:Exclude<StepState,'pending'>;detail:Record<string,number|string|boolean>};
type ClosureRow={id:string;account_id:string;review_digest:string;obligations_json:string;state:'closing'|'waiting'|'blocked'|'complete';revision:number;created_at:number;updated_at:number;completed_at:number|null};
/** Who ran a journal write: the owner's session (`closure/confirm`, `closure/resume`) or the hourly maintenance continuation. */
type Origin='owner'|'maintenance';
type StepRow={step:Step;position:number;state:StepState;detail_json:string;attempts:number;updated_at:number;last_origin:Origin|null};
const now=()=>Math.floor(Date.now()/1000);
const sum=(c:ClosureCounts,keys:readonly string[])=>keys.reduce((n,k)=>n+c[k],0);

/** Owner actions that must be completed through their existing reviewed controls BEFORE closure starts. Each has a
 * non-cascading reference that the purge cannot remove, and each controls an external resource or published service. */
const ownerActions={
 domainRecords:'Disconnect each custom domain in Domains. Your Cloudflare zone and DNS records outside Whumpo are not changed.',
 cmsInstances:'Remove each CMS site first. CMS teardown has its own reviewed path and is not part of account closure.',
 visitorApplications:'Remove each visitor application first. Visitor accounts and their data have their own reviewed erasure.',
 backendPublicationReviews:'Backend service publications have retained review history that account closure cannot remove yet. Contact support.',
 backendFormReviews:'Backend form reviews have retained history that account closure cannot remove yet. Contact support.',
 backendFormSettings:'Backend form settings must be removed with their service first. Contact support.',
 appActivationReviews:'Application activation history must be reconciled first. Contact support.',
} as const;
/** Retained records an operator must reconcile; closure may start, but the purge stops honestly at `blocked`. */
const operatorRecords=['gatewaySpendBuckets','gatewaySpendAttempts','githubGrantReviews'] as const;
/** Unresolved operations: never released or redispatched because closure was requested. */
const unresolved=['unresolvedContactNotifications','unresolvedStandardAI','unresolvedChatInteractionContinuations','pendingScanTickets','githubGrantUncertain','unresolvedConnectionExchanges','connectionRotationGuards','uncertainGitHubBackups','unresolvedDomainRecords'] as const;
const credentials=['githubCredentials','cloudflareCredentials','githubRefreshCustody'] as const;
/** Identity rows change with every reauthentication ceremony and funnel rows with hourly derivation; both are removed
 * by the purge and are excluded from the exact binding so a fresh-passkey retry does not invalidate the review.
 * Restricted safety state (preservation holds, risk-ledger evidence and corrections) is never shown to the subject, so it
 * is not part of what the owner reviews either: a hold placed or released never changes a review or makes it stale, and
 * the holds step pauses the closure with a generic retention reason instead. A hold is never disclosed. */
const restricted:ReadonlySet<string>=new Set(['activePreservationHolds','riskEvidence','riskCorrections']);
const bound=(counts:ClosureCounts)=>Object.fromEntries(Object.entries(counts).filter(([k])=>!k.startsWith('identity')&&k!=='funnelEvents'&&!restricted.has(k)).sort(([a],[b])=>a<b?-1:1));
// D1 limits expression depth to 100. Balance the complete conjunction instead of a left-deep chain of every metric.
const allSQL=(terms:string[]):string=>terms.length===0?'1':terms.length===1?terms[0]:`(${allSQL(terms.slice(0,Math.floor(terms.length/2)))} AND ${allSQL(terms.slice(Math.floor(terms.length/2)))})`;

function record(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new AccountLifecycleError(400,'invalid_request','Use the current account request.');
 const data=value as Record<string,unknown>;
 if(data.version!==1||Object.keys(data).length!==keys.length+1||!keys.every(k=>Object.hasOwn(data,k)))throw new AccountLifecycleError(400,'invalid_request','Use the current account request.');
 return data;
}
const id=(value:unknown)=>{if(typeof value!=='string'||!uuid.test(value))throw new AccountLifecycleError(400,'invalid_request','Use the current account request.');return value;};
const digest=(value:unknown)=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new AccountLifecycleError(400,'invalid_request','Use the current account request.');return value;};

async function closureBinding(db:D1Database,user:string){
 const counts=await closureCounts(db,user);
 const required=Object.entries(ownerActions).filter(([k])=>counts[k]>0).map(([k,action])=>({id:k,count:counts[k],action}));
 const repositories=(await db.prepare("SELECT DISTINCT repo_owner||'/'||repo_name AS name FROM github_backups WHERE user_id=? AND state='complete' ORDER BY 1 LIMIT 50").bind(user).all<{name:string}>()).results.map(r=>r.name);
 return {counts,required,repositories,binding:{version:1,kind:'closure',accountId:user,counts:bound(counts),required:required.map(r=>r.id)}};
}
/** What the owner reviews. Preservation holds are deliberately not shown (no case detail reaches the subject); the
 * holds step reports a generic retention pause instead. */
function presentClosure(id:string,reviewDigest:string,expiresAt:number,b:Awaited<ReturnType<typeof closureBinding>>){
 const c=b.counts;
 return {id,digest:reviewDigest,expiresAt,canConfirm:b.required.length===0,requiredBeforeClosure:b.required,
  removes:{projects:c.projects,liveWebsites:c.liveProjects,savedWebsiteVersions:c.specificationSnapshots,photos:c.projectFileRecords,chatTurns:c.chatTurns,moduleRecords:c.moduleRecords,moduleFiles:c.moduleFiles,guestPreviewLinks:c.guestPreviewLinks,connectedProviders:Number(c.githubCredentials>0)+Number(c.cloudflareCredentials>0)},
  effects:[
   'Closing starts immediately after you confirm. Chat, publishing, uploads, new connections and every other workspace action stop at once and are not restored automatically. There is no cancellation window in this test release.',
   'Live websites are taken offline, guest preview links are revoked and active website modules are suspended before anything is deleted.',
   'GitHub and Cloudflare authorizations are revoked through the existing disconnect path. Deletion waits until each provider revocation is confirmed.',
   'Unresolved AI, upload, provider or backup operations are reconciled first. They are never released or repeated because you asked to close.',
   'Then your account, projects, saved versions, Chat history, photos and module data are deleted. Deleted photos are queued for the existing private storage cleanup.',
   'Download your account export first: nothing can be exported after deletion.',
  ],
  remainsAfterClosure:[
   ...(b.repositories.length?[`GitHub repositories you backed up to stay in your GitHub account: ${b.repositories.join(', ')}. Whumpo does not delete repositories or rewrite their history.`]:[]),
   'Cloudflare zones, registrations and DNS records outside Whumpo are never deleted or changed by closure.',
   'Copies you downloaded, and data already processed by inference or payment providers under their terms, cannot be recalled by Whumpo.',
   'Platform database backups can retain deleted rows until they expire (up to 30 days for D1 Time Travel). Whumpo records a content-free suppression entry for your account and its deleted data so a restore from such a backup is reconciled before it serves anyone.',
   'A minimal closure receipt (step journal and counts, no content) is kept after deletion.',
  ]};
}

/** The client-visible review digest is opaque: a hash of a fresh server-side random value with the binding, so it
 * reveals nothing about the binding (equal bindings give different digests). Exactness is enforced server-side by the
 * stored digest and binding. */
async function saveReview(db:D1Database,user:string,kind:'export'|'closure',requestId:string,requestHash:string,binding:unknown){
 const reviewDigest=await hashToken(JSON.stringify([crypto.randomUUID(),crypto.randomUUID(),binding])),created=now(),expires=created+reviewSeconds;
 const existing=await db.prepare('SELECT request_hash,review_digest,binding_json,expires_at FROM account_lifecycle_reviews WHERE id=? AND user_id=? AND kind=?').bind(requestId,user,kind).first<{request_hash:string;review_digest:string;binding_json:string;expires_at:number}>();
 if(existing){
  if(existing.request_hash!==requestHash)throw new AccountLifecycleError(409,'request_conflict','This request ID was already used for a different review.');
  if(existing.expires_at<=created)throw new AccountLifecycleError(409,'stale_review','This review expired. Prepare a new review.');
  return {reviewDigest:existing.review_digest,expiresAt:existing.expires_at,binding:JSON.parse(existing.binding_json) as unknown};
 }
 try{
  await db.batch([
   db.prepare('DELETE FROM account_lifecycle_reviews WHERE user_id=? AND expires_at<=?').bind(user,created),
   db.prepare('INSERT INTO account_lifecycle_reviews(id,user_id,kind,request_hash,binding_json,review_digest,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').bind(requestId,user,kind,requestHash,JSON.stringify(binding),reviewDigest,created,expires),
  ]);
 }catch(error){
  if(String(error).includes('account_lifecycle_review_capacity'))throw new AccountLifecycleError(409,'request_conflict','Too many open account reviews. Wait ten minutes and try again.');
  if(/UNIQUE|PRIMARY KEY/.test(String(error)))throw new AccountLifecycleError(409,'request_conflict','This request ID was already used for a different review.');
  throw error;
 }
 return {reviewDigest,expiresAt:expires,binding};
}
export {saveReview as saveAccountReview};

export async function prepareClosure(db:D1Database,user:string,input:unknown){
 const data=record(input,['requestId']),requestId=id(data.requestId);
 if(await db.prepare('SELECT 1 FROM account_closures WHERE account_id=?').bind(user).first())throw new AccountLifecycleError(409,'closure_exists','This account is already closing. Open its closure status instead.');
 const b=await closureBinding(db,user),saved=await saveReview(db,user,'closure',requestId,await hashToken(JSON.stringify(['account-closure@1',user])),b.binding);
 if(JSON.stringify(saved.binding)!==JSON.stringify(b.binding))throw new AccountLifecycleError(409,'stale_review','Your account changed since this review. Prepare a new review.');
 return {version:1 as const,review:presentClosure(requestId,saved.reviewDigest,saved.expiresAt,b)};
}

/** Confirmation needs a fresh passkey proof, the unexpired exact review digest and an unchanged current binding. The
 * closure row, its full journal and the first step commit in one batch with the identity assertion; a replay of the
 * same review returns the existing closure. */
export async function confirmClosure(env:Pick<Env,'DB'>&Partial<Env>,user:string,input:unknown,transport?:typeof fetch){
 const db=env.DB,data=record(input,['reviewId','reviewDigest','confirmation']),reviewId=id(data.reviewId),reviewDigest=digest(data.reviewDigest);
 if(data.confirmation!=='close-account')throw new AccountLifecycleError(400,'invalid_request','Confirm with the account closure control.');
 await requireFreshWorkspace(db,user);
 const existing=await db.prepare('SELECT id,review_digest FROM account_closures WHERE account_id=?').bind(user).first<{id:string;review_digest:string}>();
 if(existing){
  if(existing.id!==reviewId||existing.review_digest!==reviewDigest)throw new AccountLifecycleError(409,'closure_exists','This account is already closing.');
  return runClosure(env,user,transport);
 }
 const review=await db.prepare("SELECT binding_json,review_digest FROM account_lifecycle_reviews WHERE id=? AND user_id=? AND kind='closure' AND expires_at>?").bind(reviewId,user,now()).first<{binding_json:string;review_digest:string}>();
 if(!review||review.review_digest!==reviewDigest)throw new AccountLifecycleError(409,'stale_review','This closure review is no longer current. Prepare a new review.');
 const b=await closureBinding(db,user);
 if(JSON.stringify(b.binding)!==review.binding_json)throw new AccountLifecycleError(409,'stale_review','Your account changed since this review. Prepare a new review.');
 if(b.required.length)throw new AccountLifecycleError(409,'action_required','Complete the listed actions before closing your account.');
 const obligations={githubRepositoriesPreserved:b.counts.githubBackupRepositories,cloudflareZonesPreserved:true,providerCopies:'not-recallable',downloadedExports:'not-recallable',platformBackups:'expire-up-to-30-days',restoreSuppression:'ledger-recorded'};
 const at=now(),statements=[
  // Counts and owner prerequisites must still match in the very statement that freezes the account. A preliminary
  // read alone cannot authorize deletion: another admitted session can commit work before this transaction starts.
  // One bound JSON value keeps this complete inventory fence below D1's parameter limit.
  db.prepare(`${closureScopeSQL} INSERT INTO account_closures(id,account_id,policy_version,review_digest,obligations_json,state,revision,created_at,updated_at)
   SELECT ?3,?1,1,?4,?5,'closing',1,?6,?6 WHERE EXISTS(SELECT 1 FROM account_lifecycle_reviews WHERE id=?3 AND user_id=?1 AND kind='closure' AND review_digest=?4 AND binding_json=?2 AND expires_at>unixepoch())
   AND ${allSQL(Object.keys(b.binding.counts).map(key=>`${closureMetricSQL(key)}=json_extract(?2,'$.counts.${key}')`))}`)
   .bind(user,review.binding_json,reviewId,reviewDigest,JSON.stringify(obligations),at),
  ...closureSteps.map((step,i)=>db.prepare("INSERT INTO account_closure_steps(closure_id,step,position,state,detail_json,attempts,updated_at,last_origin) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM account_closures WHERE id=? AND account_id=?)")
   .bind(reviewId,step,i+1,step==='freeze'?'done':'pending',step==='freeze'?JSON.stringify({newWorkStopped:true}):'{}',step==='freeze'?1:0,at,step==='freeze'?'owner':null,reviewId,user)),
 ];
 try{
  const results=await db.batch(statements);
  if(results[0].meta.changes!==1)throw new AccountLifecycleError(409,'stale_review','This closure review is no longer current. Prepare a new review.');
 }catch(error){
  if(/UNIQUE|PRIMARY KEY/.test(String(error))){const again=await db.prepare('SELECT id FROM account_closures WHERE account_id=?').bind(user).first<{id:string}>();if(again?.id===reviewId)return runClosure(env,user,transport);throw new AccountLifecycleError(409,'closure_exists','This account is already closing.');}
  throw error;
 }
 return runClosure(env,user,transport);
}

async function readClosure(db:D1Database,user:string){
 const closure=await db.prepare('SELECT * FROM account_closures WHERE account_id=?').bind(user).first<ClosureRow>();
 if(!closure)return null;
 const steps=(await db.prepare('SELECT step,position,state,detail_json,attempts,updated_at,last_origin FROM account_closure_steps WHERE closure_id=? ORDER BY position').bind(closure.id).all<StepRow>()).results;
 return {closure,steps};
}
const presentStep=(s:StepRow)=>({step:s.step,state:s.state,attempts:s.attempts,updatedAt:s.updated_at,origin:s.last_origin,detail:JSON.parse(s.detail_json) as Record<string,unknown>});
function presentStatus(closure:ClosureRow,steps:StepRow[]){
 return {version:1 as const,closure:{id:closure.id,state:closure.state,revision:closure.revision,createdAt:closure.created_at,updatedAt:closure.updated_at,completedAt:closure.completed_at,
  obligations:JSON.parse(closure.obligations_json) as Record<string,unknown>,
  steps:steps.map(presentStep)}};
}
export async function closureStatus(db:D1Database,user:string,input:unknown){
 record(input,[]);
 const current=await readClosure(db,user);
 if(!current)throw new AccountLifecycleError(404,'not_found','This account is not closing.');
 return presentStatus(current.closure,current.steps);
}
export async function resumeClosure(env:Pick<Env,'DB'>&Partial<Env>,user:string,input:unknown,transport?:typeof fetch){
 record(input,[]);return runClosure(env,user,transport);
}

const owned='SELECT id FROM projects WHERE owner_user_id=?';
async function withdraw(db:D1Database,user:string):Promise<StepResult>{
 const at=now(),results=await db.batch([
  db.prepare(`UPDATE publications SET version_id=NULL,revision=revision+1 WHERE version_id IS NOT NULL AND project_id IN (${owned})`).bind(user),
  db.prepare("UPDATE projects SET status='draft',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_user_id=? AND status!='draft'").bind(user),
  db.prepare('UPDATE guest_preview_links SET revoked_at=? WHERE owner_user_id=? AND revoked_at IS NULL').bind(at,user),
  db.prepare(`UPDATE module_activations SET state='suspended',revision=revision+1,updated_at=? WHERE state='active' AND instance_id IN (SELECT id FROM module_instances WHERE project_id IN (${owned}))`).bind(at,user),
 ]);
 return {state:'done',detail:{websitesWithdrawn:results[0].meta.changes,guestLinksRevoked:results[2].meta.changes,modulesSuspended:results[3].meta.changes}};
}
/** Reuses the existing disconnect effect (without its status read, which needs a session): they cancel pending authorization attempts, mark every token `revoking` and
 * attempt provider revocation when configured. Tokens and their encryption keys stay until the provider confirms; the
 * scheduled connection cleanup keeps retrying. The step waits until no credential custody remains. */
async function revokeCredentials(env:Pick<Env,'DB'>&Partial<Env>,user:string,transport:typeof fetch):Promise<StepResult>{
 const db=env.DB;let retry=false;
 for(const disconnect of [()=>revokeGitHubCustody(db,user,githubConfig(env as Env),transport),()=>revokeCloudflareCustody(db,user,cloudflareConfig(env as Env),transport)]){
  try{await disconnect();}catch(error){if(error instanceof IdentityError)throw error;retry=true;}
 }
 const counts=await closureCounts(db,user),pending=sum(counts,credentials);
 return pending?{state:'waiting',detail:{pendingProviderRevocations:pending,providerRetry:retry}}:{state:'done',detail:{providerRevocationsConfirmed:true}};
}
async function holds(db:D1Database,user:string):Promise<StepResult>{
 const row=await db.prepare(`SELECT count(*) n FROM safety_preservation_holds WHERE released_at IS NULL AND ((scope='account' AND subject_user_id=?) OR (scope IN ('project','object') AND project_id IN (${owned})))`).bind(user,user).first<{n:number}>();
 // Generic customer wording: no case, basis or scope detail reaches the account holder.
 return row&&row.n>0?{state:'blocked',detail:{reason:'retention_review',support:true}}:{state:'done',detail:{retentionReviewClear:true}};
}
async function operations(db:D1Database,user:string):Promise<StepResult>{
 const counts=await closureCounts(db,user),open=sum(counts,unresolved);
 return open?{state:'waiting',detail:{unresolvedOperations:open}}:{state:'done',detail:{unresolvedOperations:0}};
}

async function journal(db:D1Database,closure:ClosureRow,step:Step,result:StepResult,closureState:ClosureRow['state'],origin:Origin,extra:D1PreparedStatement[]=[]){
 const at=now(),complete=closureState==='complete';
 const results=await db.batch([
  db.prepare('UPDATE account_closure_steps SET state=?,detail_json=?,attempts=attempts+1,updated_at=?,last_origin=? WHERE closure_id=? AND step=? AND state!=\'done\' AND (SELECT revision FROM account_closures WHERE id=?)=?')
   .bind(result.state,JSON.stringify(result.detail),at,origin,closure.id,step,closure.id,closure.revision),
  db.prepare('UPDATE account_closures SET state=?,revision=revision+1,updated_at=?,completed_at=? WHERE id=? AND revision=?').bind(closureState,at,complete?at:null,closure.id,closure.revision),
  ...extra,
 ]);
 return results[1].meta.changes===1;
}

/** Runs unfinished steps in order until one waits, blocks or the account is purged. Safe to call concurrently or after
 * an interruption: every step is idempotent and each journal write is a compare-and-swap on the closure revision.
 * `owner` callers pass the admitted workspace database (closure `permit`); the maintenance continuation passes the raw
 * platform database, where the durable confirmed closure row is the only authority and no session is created. */
async function runClosure(env:Pick<Env,'DB'>&Partial<Env>,user:string,transport:typeof fetch=globalThis.fetch.bind(globalThis),origin:Origin='owner'){
 const db=env.DB;
 for(let guard=0;guard<closureSteps.length+1;guard++){
  const current=await readClosure(db,user);
  if(!current)throw new AccountLifecycleError(404,'not_found','This account is not closing.');
  const {closure,steps}=current,next=steps.find(s=>s.state!=='done');
  if(closure.state==='complete'||!next)return presentStatus(closure,steps);
  if(next.step==='purge'){
   // A hold placed after the holds step finished still stops the purge before any delete is attempted (the account,
   // project and file hold triggers refuse the cascade inside the batch as well).
   const held=await holds(db,user);
   if(held.state!=='done'){
    if(!await journal(db,closure,'purge',held,'blocked',origin))continue;
    const after=await readClosure(db,user);return presentStatus(after!.closure,after!.steps);
   }
   const counts=await closureCounts(db,user),retained=[...Object.keys(ownerActions),...operatorRecords].filter(k=>counts[k]>0);
   if(retained.length){
    const result:StepResult={state:'blocked',detail:{reason:'retained_records',retainedRecordKinds:retained.length,support:true}};
    if(!await journal(db,closure,'purge',result,'blocked',origin))continue;
    const after=await readClosure(db,user);return presentStatus(after!.closure,after!.steps);
   }
   const result:StepResult={state:'done',detail:{projectsRemoved:counts.projects,objectsQueuedForCleanup:counts.projectFileRecords,primaryAccountRowsDeleted:true}};
   const fence='EXISTS(SELECT 1 FROM account_closures WHERE id=? AND account_id=? AND revision=? AND state=\'complete\')';
   try{
    // The users cascade and the completed journal commit together, after the identity assertion; a hold, an unresolved
    // continuation guard or any non-cascading reference aborts the whole batch and the journal stays unfinished.
    const ok=await journal(db,closure,'purge',result,'complete',origin,[
     db.prepare(`DELETE FROM identity_challenges WHERE account_id=? AND ${fence}`).bind(user,closure.id,user,closure.revision+1),
     db.prepare(`DELETE FROM users WHERE id=? AND ${fence}`).bind(user,closure.id,user,closure.revision+1),
    ]);
    if(!ok)continue;
   }catch(error){
    if(error instanceof IdentityError)throw error;
    const text=String(error),hold=text.includes('safety_preservation_hold');
    // A transient failure leaves the journal unfinished for a plain retry; only a database refusal is journaled.
    if(!hold&&!/FOREIGN KEY|constraint|RAISE|_retained|_guard|unresolved/i.test(text))throw error;
    const blocked:StepResult={state:'blocked',detail:hold?{reason:'retention_review',support:true}:{reason:'retained_records',support:true}};
    const again=await readClosure(db,user);if(!again)throw error;
    await journal(db,again.closure,'purge',blocked,'blocked',origin);
    const after=await readClosure(db,user);return presentStatus(after!.closure,after!.steps);
   }
   // The account and its session are gone; read the receipt with the raw closure id (no account authority remains).
   return {version:1 as const,closure:{id:closure.id,state:'complete' as const,completedAt:now(),obligations:JSON.parse(closure.obligations_json) as Record<string,unknown>,
    steps:[...steps.filter(s=>s.step!=='purge').map(presentStep),{step:'purge' as const,state:'done' as const,attempts:next.attempts+1,updatedAt:now(),origin,detail:result.detail}]}};
  }
  const result=next.step==='withdraw'?await withdraw(db,user):next.step==='credentials'?await revokeCredentials(env,user,transport):next.step==='holds'?await holds(db,user):await operations(db,user);
  const state:ClosureRow['state']=result.state==='done'?'closing':result.state;
  if(!await journal(db,closure,next.step,result,state,origin))continue;
  if(result.state!=='done'){const after=await readClosure(db,user);return presentStatus(after!.closure,after!.steps);}
 }
 if(origin==='owner')await assertWorkspace(db,user);
 throw new AccountLifecycleError(503,'closure_unavailable','Account closure could not make progress. Try again shortly.');
}

/** Bounds for one maintenance continuation pass (hourly and daily `account_closures` job). */
export const closureContinuation=Object.freeze({batch:10,budgetMs:20000});
export type ClosureContinuationOutcome={selected:number;advanced:number;unchanged:number;completed:number;failed:number;deferred:number};
/** WH-018 background continuation of confirmed closures that wait on provider revocation, unresolved operations, a
 * released hold or an operator. It runs the SAME journaled compare-and-swap steps as `closure/resume` (no second
 * implementation), on the raw platform database: the confirmed closure row is the authority, so no session, Chat turn,
 * model or new provider capability is involved. Holds keep blocking exactly as for the owner. At most `limit` unfinished
 * closures are selected per pass, least recently journaled first (each journal write moves a closure to the back), and
 * no new closure starts after `budgetMs`; a closure in flight finishes its current step sequence. Each closure is
 * isolated: a failure is counted and the rest continue; the pass then throws a content-free error so maintenance health
 * records `failed`. A closure that only re-confirms its waiting/blocked state still journals the attempt and origin. */
export async function continueAccountClosures(env:Pick<Env,'DB'>&Partial<Env>,options:{limit?:number;budgetMs?:number;clock?:()=>number;transport?:typeof fetch}={}):Promise<ClosureContinuationOutcome>{
 assertMaintenanceDatabase(env.DB);
 const limit=options.limit??closureContinuation.batch,budgetMs=options.budgetMs??closureContinuation.budgetMs,clock=options.clock??Date.now;
 if(!Number.isSafeInteger(limit)||limit<1||limit>closureContinuation.batch||!Number.isSafeInteger(budgetMs)||budgetMs<1||budgetMs>closureContinuation.budgetMs)throw new Error('Invalid closure continuation bounds');
 const transport=options.transport??globalThis.fetch.bind(globalThis),started=clock();
 const {results}=await env.DB.prepare("SELECT account_id,revision FROM account_closures WHERE state!='complete' ORDER BY updated_at,id LIMIT ?").bind(limit).all<{account_id:string;revision:number}>();
 const outcome:ClosureContinuationOutcome={selected:results.length,advanced:0,unchanged:0,completed:0,failed:0,deferred:0};
 for(const row of results){
  if(clock()-started>=budgetMs){outcome.deferred++;continue;}
  try{
   const before=(await env.DB.prepare("SELECT count(*) n FROM account_closure_steps s JOIN account_closures c ON c.id=s.closure_id WHERE c.account_id=? AND s.state='done'").bind(row.account_id).first<{n:number}>())?.n??0;
   const status=await runClosure(env,row.account_id,transport,'maintenance');
   if(status.closure.state==='complete')outcome.completed++;
   else if(status.closure.steps.filter(s=>s.state==='done').length>before)outcome.advanced++;
   else outcome.unchanged++;
  }catch{
   // An overlapping pass or owner resume may have completed this closure between our read and our step (the account
   // rows are then gone); that is completion, not failure. Anything else is isolated to this closure.
   const latest=await env.DB.prepare('SELECT state FROM account_closures WHERE account_id=?').bind(row.account_id).first<{state:string}>().catch(()=>null);
   if(latest?.state==='complete')outcome.completed++;else outcome.failed++;
  }
 }
 if(outcome.failed)throw new Error('Account closure continuation failed');
 return outcome;
}

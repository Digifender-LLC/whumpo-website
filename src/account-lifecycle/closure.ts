/** WH-018 resumable platform account closure. Callers pass a workspace database admitted with closure `permit`; every
 * statement shares its transaction with the current-identity assertion, and confirmation additionally needs a fresh
 * passkey proof. A model, Chat turn or agent action cannot reach these handlers.
 *
 * The decisions are src/account-closure/{review,machine}.ts (pure, unchanged): the review, the owner-only confirm with a fresh proof,
 * the stop-new-work state and the close guards. This file is the durable side: `account_closures` (schema batch 2) holds the forward-only
 * state, `account_closure_steps` the ordered cleanup journal, and every committing statement repeats the predicate it relies on.
 *
 * Sequence (docs/account-closure.md): exact review -> confirm (requested, reviewed, confirmed, quiescing commit together; the admission fence
 * now aborts every ordinary workspace batch, including delayed OAuth callbacks) -> withdraw public serving -> revoke provider credentials
 * through the existing disconnect paths (keys stay until the provider confirms) -> preservation holds -> unresolved operations -> purge
 * and `closed`. Each step is idempotent and journaled; resume re-runs the first unfinished step. The closure row and journal have no
 * foreign key to users, so they remain as the final receipt after the account cascade. Customer-owned GitHub repositories, Cloudflare
 * zones and other external resources are never deleted; they are listed as remaining obligations.
 *
 * Not offered: owner cancel after confirmation (the machine allows it, but withdrawn sites and revoked credentials are not restored, so
 * there is no cancellation window in this test release) and the system `failed` state (a step that cannot proceed waits or blocks and is
 * retried; nothing here gives up on an owner's closure). Both stay documented gaps. */
import {hashToken} from '../security';
import {IdentityError} from '../workspace-identity/authority';
import {assertWorkspace,assertMaintenanceDatabase,requireFreshWorkspace,workspacePrincipal} from '../workspace-identity/admission';
import {revokeGitHubCustody,githubConfig} from '../github-connection';
import {revokeCloudflareCustody,cloudflareConfig} from '../cloudflare-connection';
import {closureCategories,settleFirstKeys,buildReview,ClosureError} from '../account-closure/review';
import {requestClosure,transition,checkClosable} from '../account-closure/machine';
import {closureCounts,closureQuietSQL,closureCountsMatchSQL,type ClosureCounts} from '../account-closure/inventory';
import {reconcileStandardChat} from '../standard-ai-recovery';
import {confirmBackup} from '../github-backups';

export class AccountLifecycleError extends Error{
 constructor(readonly status:400|404|409|503,readonly code:'invalid_request'|'not_found'|'stale_review'|'request_conflict'|'action_required'|'closure_exists'|'closure_unavailable',message:string){super(message);this.name='AccountLifecycleError';}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const reviewSeconds=600;
// Reconcile open work while the provider credentials are still valid, then revoke them: an uncertain GitHub backup can only be read with its token.
export const closureSteps=['freeze','withdraw','operations','credentials','holds','purge'] as const;
type Step=typeof closureSteps[number];
type StepState='pending'|'done'|'waiting'|'blocked';
type StepResult={state:Exclude<StepState,'pending'>;detail:Record<string,number|string|boolean>};
type ClosureRow={closure_id:string;account_id:string;state:'requested'|'reviewed'|'confirmed'|'quiescing'|'closed'|'cancelled'|'failed';revision:number;requested_at:number;updated_at:number;quiesced_at:number|null;closed_at:number|null};
/** Who ran a journal write: the owner's session (`closure/confirm`, `closure/resume`) or the hourly maintenance continuation. */
type Origin='owner'|'maintenance';
type StepRow={step:Step;position:number;state:StepState;detail_json:string;attempts:number;updated_at:number;last_origin:Origin|null};
const now=()=>Math.floor(Date.now()/1000);
const sum=(c:ClosureCounts,keys:readonly string[])=>keys.reduce((n,k)=>n+c[k],0);

/** The review's lifecycle classes, derived from the same category table the machine checks: the customer never sees the
 * unapproved retention wording of docs/data-lifecycle.json, and `tests/account-closure-contract.mjs` ties the table to that file. */
const classes=[...new Set(Object.values(closureCategories).map(x=>x[1]))].map(id=>({id,tables:Object.values(closureCategories).filter(x=>x[1]===id).map(x=>x[0])}));

/** What the owner can do before closing, each through its own reviewed control. Anything here refuses confirmation, so nothing
 * (site, authorizations) is taken away until it is done. */
const ownerActions={
 unresolvedDomainRecords:'Disconnect each custom domain in Domains. Your Cloudflare zone and DNS records outside Whumpo are not changed.',
 githubRefreshCustody:'Ask Chat to review and confirm removing Whumpo\'s GitHub access. That revokes all access granted to the Whumpo GitHub App for your GitHub account, including authorizations outside this workspace, and your repositories stay.',
 activeSubscriptions:'Your paid plan is still active. Cancel it and let the paid period end first: closing now would forfeit what you paid for.',
} as const;
/** Conditions only Whumpo support can clear (retained history with no owner control, an unresolved provider outcome or an
 * unfinished key rotation, or a paid invoice: invoice records follow a finance retention schedule nobody has approved, so closure never deletes one silently). Known at review time, so confirmation is refused before anything is taken away. One generic sentence
 * is shown for all of them and for a preservation hold alike: the review never says which, so it never discloses a hold. */
/** WINDOWS: `metrics.json` ends the wait for three kinds of work so one lost reply cannot stop a closure forever: an uncertain standard AI answer and an
 * unanswered form continuation after 24 hours, an unconfirmed GitHub backup after 24 hours, a scan ticket at its expiry, and a job-journal job after 72 hours
 * (`last_at`). That is right only for work whose lost outcome has no effect that must still be settled: every job type today is a content-free email notice.
 * A FUTURE JOB TYPE WITH A REAL SIDE EFFECT (money moved, a resource created) MUST NOT inherit the 72 hour window: exclude its purpose from the window in
 * metrics.json or add it to needsSupportKeys before it ships. */
const needsSupportKeys=['cmsInstances','visitorApplications','backendPublicationReviews','backendFormReviews','backendFormSettings','appActivationReviews','gatewaySpendBuckets','gatewaySpendAttempts','githubGrantUncertain','unresolvedConnectionExchanges','connectionRotationGuards','paidInvoices','activePreservationHolds'] as const;
/** The one support-only reason shown by name, because it is not sensitive and the owner needs to know that support cannot act yet either. */
const paidInvoiceNotice='You have paid invoices. Whumpo keeps paid invoice records until a finance retention schedule is approved, so this account cannot be closed yet, by you or by support. Nothing has been changed. You can still download your data.';
const supportMessage='Some records on this account need Whumpo support before it can be closed automatically. Nothing has been changed and your site stays online. Contact support from this page.';
const credentials=['githubCredentials','cloudflareCredentials','githubRefreshCustody'] as const;
/** Identity rows change with every reauthentication ceremony and funnel rows with hourly derivation; both are removed
 * by the purge and are excluded from the exact binding so a fresh-passkey retry does not invalidate the review.
 * Restricted safety state (preservation holds, risk-ledger evidence and corrections) is never shown to the subject, so it
 * is not part of what the owner reviews either: a hold placed or released never changes a review or makes it stale, and
 * the holds step pauses the closure with a generic retention reason instead. A hold is never disclosed. */
const restricted:ReadonlySet<string>=new Set(['activePreservationHolds','riskEvidence','riskCorrections']);
const excluded=(k:string)=>k.startsWith('identity')||k==='funnelEvents'||restricted.has(k);
const bound=(counts:ClosureCounts)=>Object.fromEntries(Object.entries(counts).filter(([k])=>!excluded(k)).sort(([a],[b])=>a<b?-1:1));
/** The machine's inventory view of the bound counts: every category present, the unbound ones zero. */
const reviewCounts=(counts:Record<string,number>)=>Object.fromEntries(Object.keys(closureCategories).map(k=>[k,excluded(k)?0:counts[k]??0]));

function record(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new AccountLifecycleError(400,'invalid_request','Use the current account request.');
 const data=value as Record<string,unknown>;
 if(data.version!==1||Object.keys(data).length!==keys.length+1||!keys.every(k=>Object.hasOwn(data,k)))throw new AccountLifecycleError(400,'invalid_request','Use the current account request.');
 return data;
}
const id=(value:unknown)=>{if(typeof value!=='string'||!uuid.test(value))throw new AccountLifecycleError(400,'invalid_request','Use the current account request.');return value;};
const digest=(value:unknown)=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new AccountLifecycleError(400,'invalid_request','Use the current account request.');return value;};

async function closureBinding(db:D1Database,user:string){
 const counts=await closureCounts(db,user),needsSupport=needsSupportKeys.some(k=>counts[k]>0);
 const required=Object.entries(ownerActions).filter(([k])=>counts[k]>0).map(([k,action])=>({id:k,count:counts[k],action}));
 const repositories=(await db.prepare("SELECT DISTINCT repo_owner||'/'||repo_name AS name FROM github_backups WHERE user_id=? AND state='complete' ORDER BY 1 LIMIT 50").bind(user).all<{name:string}>()).results.map(r=>r.name);
 return {counts,required,needsSupport,repositories,binding:{version:1,kind:'closure',accountId:user,counts:bound(counts),required:required.map(r=>r.id)}};
}
/** What the owner reviews. Preservation holds are deliberately not shown (no case detail reaches the subject); the
 * holds step reports a generic retention pause instead. */
function presentClosure(id:string,reviewDigest:string,expiresAt:number,b:Awaited<ReturnType<typeof closureBinding>>){
 const c=b.counts;
 return {id,digest:reviewDigest,expiresAt,canConfirm:b.required.length===0&&!b.needsSupport,requiredBeforeClosure:b.required,needsSupport:b.needsSupport,supportMessage:b.needsSupport?supportMessage:null,
  paidInvoiceNotice:c.paidInvoices>0?paidInvoiceNotice:null,
  removes:{projects:c.projects,liveWebsites:c.liveProjects,savedWebsiteVersions:c.specificationSnapshots,photos:c.projectFileRecords,chatTurns:c.chatTurns,moduleRecords:c.moduleRecords,moduleFiles:c.moduleFiles,guestPreviewLinks:c.guestPreviewLinks,connectedProviders:Number(c.githubCredentials>0)+Number(c.cloudflareCredentials>0)},
  effects:[
   'Closing starts immediately after you confirm. Chat, publishing, uploads, new connections and every other workspace action stop at once and are not restored automatically. There is no cancellation window in this test release.',
   'Live websites are taken offline, guest preview links are revoked and active website modules are suspended before anything is deleted.',
   'GitHub and Cloudflare authorizations are revoked through the existing disconnect path. Deletion waits until each provider revocation is confirmed.',
   'Unresolved AI, upload, provider or backup operations are reconciled first. They are never released or repeated because you asked to close.',
   'Contact inbox messages are kept for 30 days in your inbox and are deleted with the account.',
   'Then your account, projects, saved versions, Chat history, photos and module data are deleted. Deleted photos are queued for the existing private storage cleanup.',
   'Download your account export first: nothing can be exported after deletion.',
  ],
  remainsAfterClosure:[
   ...(b.repositories.length?[`GitHub repositories you backed up to stay in your GitHub account: ${b.repositories.join(', ')}. Whumpo does not delete repositories or rewrite their history.`]:[]),
   'Cloudflare zones, registrations and DNS records outside Whumpo are never deleted or changed by closure.',
   'Copies you downloaded, and data already processed by inference or payment providers under their terms, cannot be recalled by Whumpo.',
   'Platform database backups can retain deleted rows until they expire (up to 30 days for D1 Time Travel). Retention windows for these records are interim and not yet approved.',
   'A minimal closure receipt (step journal and counts, no content) is kept after deletion.',
  ]};
}

/** The client-visible review digest is opaque: a hash of a fresh server-side random value with the binding, so it
 * reveals nothing about the binding (equal bindings give different digests). Exactness is enforced server-side by the
 * stored digest and binding. `project` scope (WH-187) reuses this with a project id. */
async function saveReview(db:D1Database,user:string,kind:'export'|'closure',requestId:string,requestHash:string,binding:unknown,project:string|null=null){
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
   db.prepare('INSERT INTO account_lifecycle_reviews(id,user_id,kind,scope,project_id,request_hash,binding_json,review_digest,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(requestId,user,kind,project?'project':'account',project,requestHash,JSON.stringify(binding),reviewDigest,created,expires),
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
 if(await db.prepare("SELECT 1 FROM account_closures WHERE account_id=? AND state IN ('requested','reviewed','confirmed','quiescing')").bind(user).first())throw new AccountLifecycleError(409,'closure_exists','This account is already closing. Open its closure status instead.');
 const b=await closureBinding(db,user),saved=await saveReview(db,user,'closure',requestId,await hashToken(JSON.stringify(['account-closure@1',user])),b.binding);
 if(JSON.stringify(saved.binding)!==JSON.stringify(b.binding))throw new AccountLifecycleError(409,'stale_review','Your account changed since this review. Prepare a new review.');
 return {version:1 as const,review:presentClosure(requestId,saved.reviewDigest,saved.expiresAt,b)};
}

/** Confirmation needs a fresh passkey proof, the unexpired exact review digest and an unchanged current binding. The machine
 * runs review -> confirm (owner, fresh proof, matching digest) -> quiesce in memory; the four forward states, the full journal and its first
 * step then commit in one batch with the identity assertion. A replay of the same review returns the existing closure. */
export async function confirmClosure(env:Pick<Env,'DB'>&Partial<Env>,user:string,input:unknown,transport?:typeof fetch){
 const db=env.DB,data=record(input,['reviewId','reviewDigest','confirmation']),reviewId=id(data.reviewId),reviewDigest=digest(data.reviewDigest);
 if(data.confirmation!=='close-account')throw new AccountLifecycleError(400,'invalid_request','Confirm with the account closure control.');
 await requireFreshWorkspace(db,user);
 const existing=await db.prepare('SELECT closure_id FROM account_closures WHERE account_id=? ORDER BY requested_at DESC LIMIT 1').bind(user).first<{closure_id:string}>();
 if(existing){
  if(existing.closure_id!==reviewId)throw new AccountLifecycleError(409,'closure_exists','This account is already closing.');
  return runClosure(env,user,transport);
 }
 const review=await db.prepare("SELECT binding_json,review_digest FROM account_lifecycle_reviews WHERE id=? AND user_id=? AND kind='closure' AND expires_at>?").bind(reviewId,user,now()).first<{binding_json:string;review_digest:string}>();
 if(!review||review.review_digest!==reviewDigest)throw new AccountLifecycleError(409,'stale_review','This closure review is no longer current. Prepare a new review.');
 const b=await closureBinding(db,user);
 if(JSON.stringify(b.binding)!==review.binding_json)throw new AccountLifecycleError(409,'stale_review','Your account changed since this review. Prepare a new review.');
 if(b.required.length)throw new AccountLifecycleError(409,'action_required','Complete the listed actions before closing your account.');
 if(b.needsSupport)throw new AccountLifecycleError(409,'action_required',supportMessage);
 const at=Date.now(),principal=workspacePrincipal(db,user);
 let sealed:string;
 try{
  const reviewed=transition(requestClosure(user,at),{event:'review',actor:'owner',at,expectedRevision:1,classes,counts:reviewCounts(JSON.parse(review.binding_json).counts)});
  const confirmed=transition(reviewed,{event:'confirm',actor:'owner',at,expectedRevision:reviewed.revision,classes,counts:reviewCounts(b.counts),freshAuthAt:principal.proof.verifiedAt*1000,reviewDigest:reviewed.reviewDigest as string});
  transition(confirmed,{event:'quiesce',actor:'system',at,expectedRevision:confirmed.revision});
  sealed=await hashToken(reviewed.reviewDigest as string);
 }catch(error){
  if(error instanceof ClosureError)throw new AccountLifecycleError(409,error.code==='fresh-auth-required'?'action_required':'stale_review','This closure review is no longer current. Prepare a new review.');
  throw error;
 }
 const advance=(from:string,to:string,revision:number,set='',...bind:unknown[])=>db.prepare(`UPDATE account_closures SET state='${to}',revision=${revision+1},updated_at=?${set},history=json_insert(history,'$[#]','${to}') WHERE closure_id=? AND account_id=? AND revision=? AND state='${from}'`).bind(at,...bind,reviewId,user,revision);
 // What the owner saw (projects, versions, photos, Chat, records, uploads, guest links) must still be what exists when the closure is created.
 const same=closureCountsMatchSQL(b.counts,['projects','liveProjects','specificationSnapshots','projectFileRecords','chatTurns','moduleRecords','moduleFiles','guestPreviewLinks']);
 const statements=[
  db.prepare(`INSERT INTO account_closures(closure_id,account_id,state,revision,requested_at,updated_at,history) SELECT ?,?,'requested',1,?,?,'["requested"]' WHERE EXISTS(SELECT 1 FROM account_lifecycle_reviews WHERE id=? AND user_id=? AND kind='closure' AND review_digest=? AND expires_at>?) AND ${same.sql}`)
   .bind(reviewId,user,at,at,reviewId,user,reviewDigest,now(),user,...same.numbers),
  advance('requested','reviewed',1,',review_digest=?',sealed),
  advance('reviewed','confirmed',2),
  advance('confirmed','quiescing',3,',quiesced_at=?',at),
  ...closureSteps.map((step,i)=>db.prepare("INSERT INTO account_closure_steps(closure_id,step,position,state,detail_json,attempts,updated_at,last_origin) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM account_closures WHERE closure_id=? AND account_id=? AND state='quiescing')")
   .bind(reviewId,step,i+1,step==='freeze'?'done':'pending',step==='freeze'?JSON.stringify({newWorkStopped:true,githubRepositoriesLeftInPlace:b.counts.githubBackupRepositories,cloudflareZonesLeftInPlace:b.counts.domainZones}):'{}',step==='freeze'?1:0,at,step==='freeze'?'owner':null,reviewId,user)),
 ];
 try{
  const results=await db.batch(statements);
  if(results[0].meta.changes!==1||results[3].meta.changes!==1)throw new AccountLifecycleError(409,'stale_review','This closure review is no longer current. Prepare a new review.');
 }catch(error){
  if(error instanceof AccountLifecycleError)throw error;
  if(/UNIQUE|PRIMARY KEY/.test(String(error))){const again=await db.prepare('SELECT closure_id FROM account_closures WHERE account_id=? ORDER BY requested_at DESC LIMIT 1').bind(user).first<{closure_id:string}>();if(again?.closure_id===reviewId)return runClosure(env,user,transport);throw new AccountLifecycleError(409,'closure_exists','This account is already closing.');}
  throw error;
 }
 return runClosure(env,user,transport);
}

async function readClosure(db:D1Database,user:string){
 const closure=await db.prepare('SELECT closure_id,account_id,state,revision,requested_at,updated_at,quiesced_at,closed_at FROM account_closures WHERE account_id=? ORDER BY requested_at DESC LIMIT 1').bind(user).first<ClosureRow>();
 if(!closure)return null;
 const steps=(await db.prepare('SELECT step,position,state,detail_json,attempts,updated_at,last_origin FROM account_closure_steps WHERE closure_id=? ORDER BY position').bind(closure.closure_id).all<StepRow>()).results;
 return {closure,steps};
}
const presentStep=(s:StepRow)=>({step:s.step,state:s.state,attempts:s.attempts,updatedAt:s.updated_at,origin:s.last_origin,detail:JSON.parse(s.detail_json) as Record<string,unknown>});
/** closing: steps are running; waiting: an unresolved operation or provider revocation; blocked: a hold or retained record needs an operator. */
function presentStatus(closure:ClosureRow,steps:StepRow[]){
 const state=closure.state==='closed'?'complete' as const:steps.some(s=>s.state==='blocked')?'blocked' as const:steps.some(s=>s.state==='waiting')?'waiting' as const:'closing' as const;
 return {version:1 as const,closure:{id:closure.closure_id,state,overdue:state!=='complete'&&closure.quiesced_at!==null&&Date.now()-closure.quiesced_at>overdueMs,revision:closure.revision,createdAt:closure.requested_at,updatedAt:Math.max(closure.updated_at,...steps.map(s=>s.updated_at)),completedAt:closure.closed_at,
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

/** A closure still not finished this long after it began is shown as overdue to the owner and listed for the operator (tools/maintenance-inventory.mjs): 72 hour job window plus a day. */
export const overdueMs=96*3600000;
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
/** Closure's own reconciliation authority. The Chat and backup routes that normally settle these are behind the stop-new-work fence, so the
 * step settles them itself, read-only toward providers and never repeating a write: a pending Chat turn is released if it never reached
 * the model or marked uncertain if it did (src/standard-ai-recovery.ts), and an unconfirmed GitHub backup is re-read once per pass. Anything
 * still open then waits; the inventory's own windows end the wait (an uncertain AI answer after 24 hours can no longer be applied and uses no
 * customer credits, an unconfirmed backup after 24 hours is left to the owner's repository, an expired scan ticket is stale). */
async function operations(env:Pick<Env,'DB'>&Partial<Env>,user:string,transport:typeof fetch):Promise<StepResult>{
 const db=env.DB;let turnsChecked=0,backupsChecked=0;
 const turns=(await db.prepare("SELECT id,input_tokens,output_tokens,created_at FROM chat_turns WHERE user_id=? AND mode='ai' AND status='pending' ORDER BY created_at LIMIT 20").bind(user).all<{id:string;input_tokens:number|null;output_tokens:number|null;created_at:string}>()).results;
 for(const turn of turns){try{await reconcileStandardChat(db,user,turn);turnsChecked++;}catch(error){if(error instanceof IdentityError)throw error;}}
 const backups=(await db.prepare("SELECT id FROM github_backups WHERE user_id=? AND state IN ('dispatching','uncertain') ORDER BY created_at LIMIT 5").bind(user).all<{id:string}>()).results;
 for(const backup of backups){try{await confirmBackup(db,env.FILES,user,backup.id,githubConfig(env as Env),transport);backupsChecked++;}catch(error){if(error instanceof IdentityError)throw error;}}
 // A form-continued AI turn that has been pending or unknown for over 24 hours can no longer be applied (the fenced Chat route is its only resolver), so it is closed as
 // unavailable through the table's own legal transition; the inventory window ends the wait and this lets the database delete the row with the account.
 await db.prepare("UPDATE chat_interaction_continuations SET state='failed',reason='unavailable',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE state IN ('pending','unknown') AND started_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day') AND id IN (SELECT id FROM chat_interaction_submissions WHERE user_id=?)").bind(user).run();
 const counts=await closureCounts(db,user),open=sum(counts,settleFirstKeys);
 return open?{state:'waiting',detail:{unresolvedOperations:open,chatTurnsChecked:turnsChecked,backupsChecked}}:{state:'done',detail:{unresolvedOperations:0,chatTurnsChecked:turnsChecked,backupsChecked}};
}

/** One compare-and-swap on the step's attempt count, valid only while the closure is quiescing. Returns whether this caller won. */
async function journalBatch(db:D1Database,closure:ClosureRow,step:StepRow,result:StepResult,origin:Origin,extra:D1PreparedStatement[]=[],guard:{sql:string;binds:unknown[]}={sql:'1',binds:[]}){
 return db.batch([
  db.prepare(`UPDATE account_closure_steps SET state=?,detail_json=?,attempts=attempts+1,updated_at=?,last_origin=? WHERE closure_id=? AND step=? AND state!='done' AND attempts=? AND EXISTS(SELECT 1 FROM account_closures WHERE closure_id=? AND state='quiescing') AND ${guard.sql}`)
   .bind(result.state,JSON.stringify(result.detail),Date.now(),origin,closure.closure_id,step.step,step.attempts,closure.closure_id,...guard.binds),
  ...extra,
 ]);
}
const journal=async(...args:Parameters<typeof journalBatch>)=>(await journalBatch(...args))[0].meta.changes===1;

/** Runs unfinished steps in order until one waits, blocks or the account is purged. Safe to call concurrently or after
 * an interruption: every step is idempotent and each journal write is a compare-and-swap on the step's attempt count.
 * `owner` callers pass the admitted workspace database (closure `permit`); the maintenance continuation passes the raw
 * platform database, where the durable quiescing closure row is the only authority and no session is created. */
async function runClosure(env:Pick<Env,'DB'>&Partial<Env>,user:string,transport:typeof fetch=globalThis.fetch.bind(globalThis),origin:Origin='owner'){
 const db=env.DB;
 for(let guard=0;guard<closureSteps.length+2;guard++){
  const current=await readClosure(db,user);
  if(!current)throw new AccountLifecycleError(404,'not_found','This account is not closing.');
  const {closure,steps}=current,next=steps.find(s=>s.state!=='done');
  if(closure.state!=='quiescing'||!next)return presentStatus(closure,steps);
  if(next.step==='purge'){
   // A hold placed after the holds step finished still stops the purge before any delete is attempted (the account,
   // project and file hold triggers refuse the cascade inside the batch as well).
   const held=await holds(db,user);
   if(held.state!=='done'){
    if(!await journal(db,closure,next,held,origin))continue;
    const after=await readClosure(db,user);return presentStatus(after!.closure,after!.steps);
   }
   const counts=await closureCounts(db,user),retained=[...Object.keys(ownerActions),...needsSupportKeys.filter(k=>k!=='activePreservationHolds')].filter(k=>counts[k]>0);
   if(retained.length){
    const result:StepResult={state:'blocked',detail:{reason:'retained_records',retainedRecordKinds:retained.length,support:true}};
    if(!await journal(db,closure,next,result,origin))continue;
    const after=await readClosure(db,user);return presentStatus(after!.closure,after!.steps);
   }
   // The close guards of the state machine over facts observed after stop-new-work began; an active paid subscription is pending billing.
   try{checkClosable({counts,pendingBilling:counts.activeSubscriptions,observedAt:Date.now()},closure.quiesced_at as number);}
   catch(error){
    if(!(error instanceof ClosureError))throw error;
    const result:StepResult=error.code==='preservation-hold'?{state:'blocked',detail:{reason:'retention_review',support:true}}:error.code==='billing-pending'?{state:'blocked',detail:{reason:'paid_plan_active',support:true}}:{state:'waiting',detail:{unresolvedOperations:sum(counts,settleFirstKeys)}};
    if(!await journal(db,closure,next,result,origin))continue;
    const after=await readClosure(db,user);return presentStatus(after!.closure,after!.steps);
   }
   const result:StepResult={state:'done',detail:{projectsRemoved:counts.projects,objectsQueuedForCleanup:counts.projectFileRecords,primaryAccountRowsDeleted:true,githubRepositoriesLeftInPlace:counts.githubBackupRepositories,cloudflareZonesLeftInPlace:counts.domainZones}};
   const fence="EXISTS(SELECT 1 FROM account_closures WHERE closure_id=? AND account_id=? AND state='closed')";
   const at=Date.now();
   try{
    // The users cascade, the closed state and the completed journal commit together, after the identity assertion; a hold, an
    // unresolved continuation guard or any non-cascading reference aborts the whole batch and the journal stays unfinished.
    // The closed state depends on THIS batch having won the journal swap (the purge step is done at exactly the next attempt count) and on
    // the settle-first work still being absent, so a lost swap or work that appeared since the read closes and deletes nothing.
    const quiet=[...settleFirstKeys,'activeSubscriptions','paidInvoices'];
    const won=`EXISTS(SELECT 1 FROM account_closure_steps WHERE closure_id=? AND step='purge' AND state='done' AND attempts=?) AND ${closureQuietSQL(quiet)}`; // the journal write carries the same quiet check, so the two cannot disagree
    const results=await journalBatch(db,closure,next,result,origin,[
     db.prepare(`UPDATE account_closures SET state='closed',revision=revision+1,updated_at=?,closed_at=?,history=json_insert(history,'$[#]','closed') WHERE closure_id=? AND account_id=? AND revision=? AND state='quiescing' AND ${won}`).bind(at,at,closure.closure_id,user,closure.revision,closure.closure_id,next.attempts+1,user),
     db.prepare(`DELETE FROM identity_challenges WHERE account_id=? AND ${fence}`).bind(user,closure.closure_id,user),
     db.prepare(`DELETE FROM users WHERE id=? AND ${fence}`).bind(user,closure.closure_id,user),
    ],{sql:closureQuietSQL(quiet),binds:[user]});
    if(results[0].meta.changes!==1||results[1].meta.changes!==1)continue;
   }catch(error){
    if(error instanceof IdentityError)throw error;
    const text=String(error),hold=text.includes('safety_preservation_hold');
    // A transient failure leaves the journal unfinished for a plain retry; only a database refusal is journaled.
    if(!hold&&!/FOREIGN KEY|constraint|RAISE|_retained|_guard|unresolved/i.test(text))throw error;
    const blocked:StepResult={state:'blocked',detail:hold?{reason:'retention_review',support:true}:{reason:'retained_records',support:true}};
    const again=await readClosure(db,user);if(!again)throw error;
    const step=again.steps.find(s=>s.step==='purge');
    if(step&&step.state!=='done')await journal(db,again.closure,step,blocked,origin);
    const after=await readClosure(db,user);return presentStatus(after!.closure,after!.steps);
   }
   // The account and its session are gone; read the receipt with the raw closure id (no account authority remains).
   return {version:1 as const,closure:{id:closure.closure_id,state:'complete' as const,completedAt:at,
    steps:[...steps.filter(s=>s.step!=='purge').map(presentStep),{step:'purge' as const,state:'done' as const,attempts:next.attempts+1,updatedAt:at,origin,detail:result.detail}]}};
  }
  const result=next.step==='withdraw'?await withdraw(db,user):next.step==='credentials'?await revokeCredentials(env,user,transport):next.step==='holds'?await holds(db,user):await operations(env,user,transport);
  if(!await journal(db,closure,next,result,origin))continue;
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
 * implementation), on the raw platform database: the quiescing closure row is the authority, so no session, Chat turn,
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
 const {results}=await env.DB.prepare("SELECT c.account_id FROM account_closures c WHERE c.state='quiescing' ORDER BY (SELECT max(s.updated_at) FROM account_closure_steps s WHERE s.closure_id=c.closure_id),c.closure_id LIMIT ?").bind(limit).all<{account_id:string}>();
 const outcome:ClosureContinuationOutcome={selected:results.length,advanced:0,unchanged:0,completed:0,failed:0,deferred:0};
 for(const row of results){
  if(clock()-started>=budgetMs){outcome.deferred++;continue;}
  try{
   const before=(await env.DB.prepare("SELECT count(*) n FROM account_closure_steps s JOIN account_closures c ON c.closure_id=s.closure_id WHERE c.account_id=? AND c.state='quiescing' AND s.state='done'").bind(row.account_id).first<{n:number}>())?.n??0;
   const status=await runClosure(env,row.account_id,transport,'maintenance');
   if(status.closure.state==='complete')outcome.completed++;
   else if(status.closure.steps.filter(s=>s.state==='done').length>before)outcome.advanced++;
   else outcome.unchanged++;
  }catch{
   // An overlapping pass or owner resume may have completed this closure between our read and our step (the account
   // rows are then gone); that is completion, not failure. Anything else is isolated to this closure.
   const latest=await env.DB.prepare('SELECT state FROM account_closures WHERE account_id=? ORDER BY requested_at DESC LIMIT 1').bind(row.account_id).first<{state:string}>().catch(()=>null);
   if(latest?.state==='closed')outcome.completed++;else outcome.failed++;
  }
 }
 if(outcome.failed)throw new Error('Account closure continuation failed');
 return outcome;
}

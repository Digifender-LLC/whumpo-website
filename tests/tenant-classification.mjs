import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {loadRegistry,loadBaseline,observeSchema,checkRegistry,registryReport,freezeStatus,runChecks,typeOverlay} from '../tools/tenant-classification.mjs';

// WH-054 packet 1a registry gate. Everything here reads or copies the composed current schema in memory; negative
// controls mutate a clone of the registry or append statements to a disposable copy of the schema, never a file.
const registry=await loadRegistry(),baseline=await loadBaseline(),observed=await observeSchema();
const clone=value=>structuredClone(value);
const problemsOf=async(mutate,{extraSql}={})=>{
 const copy=clone(registry);mutate(copy);
 const seen=extraSql?await observeSchema(undefined,{extraSql}):observed;
 return (await checkRegistry(copy,seen)).problems;
};
const mention=(problems,pattern)=>assert.ok(problems.some(p=>pattern.test(p)),`expected ${pattern} in:\n${problems.join('\n')}`);
const entry=(r,id)=>r.columns.find(c=>c.column===id);

// ---- the committed registry matches the composed current schema ----
const clean=await checkRegistry(registry,observed);
assert.deepEqual(clean.problems,[]);
assert.equal(observed.usersColumns.length,127);assert.equal(clean.coverage.classified,127);
assert.deepEqual([clean.coverage.unclassified,clean.coverage.stale,clean.coverage.duplicates],[[],[],[]]);
assert.equal(new Set(observed.usersColumns.map(c=>c.table)).size,127,'no table has two users foreign keys');
assert.deepEqual(observed.usersColumns.reduce((n,c)=>({...n,[c.onDelete]:(n[c.onDelete]??0)+1}),{}),{CASCADE:104,'NO ACTION':17,RESTRICT:5,'SET NULL':1});

// ---- proposed and undecided are reported, never coverage failures ----
const report=registryReport(registry,observed);
assert.equal(report.currentColumns,127);
assert.equal(Object.values(report.byClass).reduce((a,b)=>a+b,0),127,'every current column is counted exactly once');
assert.equal(report.byStatus.accepted,undefined,'no entry is accepted at this baseline');
assert.ok(report.byStatus.proposed>0&&report.byStatus.undecided>0);
assert.equal(report.byStatus.proposed+report.byStatus.undecided,127);
assert.equal(report.byEvidenceLevel['source-reading'],25,'the WH-086 push device and event, the seven formerly undecided entries, two refinements, the four WH-170/WH-201 entries, the WH-145 rule approval and the WH-052 journal job, the WH-083 handoff and the WH-156 notice carry source-reading evidence only');
assert.equal(report.byClass['typed-subject'],2);assert.equal(report.byClass.split,1);assert.equal(report.byClass.account,13);
// Mixed entries add intended outputs beside the current column; they do not add to the 127.
assert.deepEqual(report.intended.typedSubjectColumns,['content_risk_evidence.account_id','content_risk_evidence.workspace_id','content_risk_reversals.account_id','content_risk_reversals.workspace_id']);
assert.deepEqual(report.intended.splitTables,['profile_photo_scan_tickets','content_scan_tickets']);
for(const table of report.intended.splitTables)assert.ok(!observed.tables.includes(table));
assert.equal(report.byRetarget['hand-written']+report.byRetarget.keep+report.byRetarget['typed-subject']+report.byRetarget.split,127);
assert.ok(!registry.columns.some(c=>c.retarget==='mechanical'),'no entry claims a mechanical rename');
// Indirect tenants: 78 reach a tenant (38 through a project_id foreign key), 32 do not (29 at ca17c6a plus the two WH-050
// operator receipt tables added on main and the WH-018 account_closures record), with the method recorded.
assert.deepEqual([report.derived.reachesTenant,report.derived.direct,report.derived.chained,report.derived.noTenantPath,report.derived.textualProjectIdWithoutForeignKey],[98,45,53,34,6]);
assert.match(report.derived.method,/Breadth-first search over foreign keys/);
assert.ok(registry.textualIdentity.some(t=>t.column==='file_cleanup.owner_user_id')&&registry.textualIdentity.some(t=>t.column==='cms_deployments.account_id'));
// Account, custody, payer and actor stay separate roles on separate intended columns.
for(const e of registry.columns.filter(c=>c.roles)){
 const names=Object.values(e.roles);assert.equal(new Set(names).size,names.length,e.column);
 if(e.class==='account')assert.deepEqual(Object.keys(e.roles),['account']);else assert.ok(!('account' in e.roles),e.column);
}
const stripe=entry(registry,'stripe_paid_invoices.user_id');
assert.deepEqual([stripe.class,stripe.status,stripe.roles.payer],['workspace+payer','undecided','payer_actor_ref']);assert.ok(!('actor' in stripe.roles));
assert.deepEqual(entry(registry,'github_connections.user_id').roles,{tenant:'workspace_id',custody:'authorizing_actor_ref'});
assert.equal(entry(registry,'backend_nominations.user_id').roles.epoch,'consent_epoch');
// Account-typed overlays for the lint come from the registry; a mixed subject is neither.
const overlay=typeOverlay(registry);
assert.equal(overlay.get('projects.owner_user_id'),'workspace');assert.equal(overlay.get('user_profiles.user_id'),'account');assert.equal(overlay.get('content_risk_evidence.user_id'),'mixed');
assert.equal(overlay.get('safety_preservation_holds.subject_user_id'),'account');

// ---- owner answers: exactly the two recorded in the contract, by semantic ID; the other four stay open ----
const answeredIds=registry.questions.filter(q=>q.ownerAnswerRecorded).map(q=>q.id);
assert.deepEqual(answeredIds,['member-only-accounts','member-limit']);
for(const q of registry.questions.filter(q=>q.ownerAnswerRecorded))assert.deepEqual([q.ownerAnswer.recordedOn,q.item],['2026-10-08',undefined]);
assert.deepEqual(registry.questions.filter(q=>!q.ownerAnswerRecorded).map(q=>[q.item,q.id]),[[1,'payer-on-transfer'],[2,'retention-and-closure-window'],[3,'late-payment-continuity'],[4,'funded-workspace-bound']],'the contract numbers the remaining questions 1 to 4');
// The answers moved no entry: the six undecided entries still wait on the open payer, late-payment and budget questions.
assert.deepEqual(report.undecided.map(u=>u.column).sort(),['inference_budgets.user_id','inference_calls.user_id','stripe_customers.user_id','stripe_paid_invoices.user_id','stripe_subscription_orders.user_id','stripe_subscriptions.user_id']);
for(const u of report.undecided)assert.ok(u.questions.every(id=>!answeredIds.includes(id)),u.column);
assert.deepEqual(report.answeredQuestions.find(q=>q.id==='member-only-accounts').dependent,['welcome_onboarding.user_id']);
assert.equal(entry(registry,'welcome_onboarding.user_id').status,'proposed');

// ---- freeze refusal, and a coherent path to a freeze that check also accepts ----
const refusal=freezeStatus(registry);
assert.equal(refusal.refused,true);assert.match(refusal.reasons.join('\n'),/127 of 127 entries are not accepted \(121 proposed, 6 undecided\)/);
assert.match(refusal.reasons.join('\n'),/4 owner questions have no recorded answer \(payer-on-transfer, retention-and-closure-window, late-payment-continuity, funded-workspace-bound\)/);
// Synthetic progression on a clone (the committed registry is never accepted here). An answer is recorded with its
// date and contract anchor, the entries are accepted, then the registry is frozen; both gates must agree at each step.
const answer=q=>{q.ownerAnswerRecorded=true;delete q.item;q.ownerAnswer??={recordedOn:'2026-10-09',answer:'Synthetic fixture answer for '+q.id,anchor:'docs/workspace-collaboration.md#owner-decisions-recorded'};};
const step1=clone(registry);step1.questions.forEach(answer);
mention((await checkRegistry(step1,observed)).problems,/undecided, but every question it names is answered; review it to proposed/);
const step2=clone(step1);step2.columns.forEach(c=>{if(c.status==='undecided')c.status='proposed';});
assert.deepEqual((await checkRegistry(step2,observed)).problems,[]);assert.equal(freezeStatus(step2).refused,true);
const step3=clone(step2);step3.columns.forEach(c=>{c.status='accepted';});
assert.deepEqual((await checkRegistry(step3,observed)).problems,[]);assert.deepEqual(freezeStatus(step3).reasons,['registry status is proposed-not-frozen']);
const frozen=clone(step3);frozen.status='frozen';
assert.deepEqual((await checkRegistry(frozen,observed)).problems,[],'a fully accepted, fully answered, frozen registry passes check');
assert.deepEqual(freezeStatus(frozen),{frozen:true,refused:false,reasons:[]});
// Incoherent states fail check and are refused by freeze.
const partial=clone(frozen);partial.columns[0].status='proposed';assert.equal(freezeStatus(partial).refused,true);
mention((await checkRegistry(partial,observed)).problems,/Registry is frozen but 1 entries are not accepted/);
const reopened=clone(frozen);const q0=reopened.questions.find(q=>q.id==='payer-on-transfer');q0.ownerAnswerRecorded=false;delete q0.ownerAnswer;q0.item=1;
assert.equal(freezeStatus(reopened).refused,true);
mention((await checkRegistry(reopened,observed)).problems,/Registry is frozen but owner questions payer-on-transfer are open/);
mention((await checkRegistry(reopened,observed)).problems,/stripe_customers\.user_id: accepted while owner question payer-on-transfer is open/);
// An entry cannot be accepted while its question is open, even before a freeze.
mention(await problemsOf(r=>{entry(r,'stripe_customers.user_id').status='accepted';}),/accepted while owner question payer-on-transfer is open/);
// Only a schema review edit freezes: a frozen status on the current registry fails check.
mention(await problemsOf(r=>{r.status='frozen';}),/Registry is frozen but 127 entries are not accepted/);

// ---- negative controls: coverage and drift ----
mention(await problemsOf(()=>{},{extraSql:'CREATE TABLE probe_new(id TEXT PRIMARY KEY, reviewer_id TEXT REFERENCES users(id));'}),/Unclassified users foreign key probe_new\.reviewer_id/);
mention(await problemsOf(()=>{},{extraSql:'ALTER TABLE projects ADD COLUMN reviewer_id TEXT REFERENCES users(id);'}),/Unclassified users foreign key projects\.reviewer_id/);
mention(await problemsOf(r=>{r.columns=r.columns.filter(c=>c.column!=='activity_events.user_id');}),/Unclassified users foreign key activity_events\.user_id/);
mention(await problemsOf(r=>{r.columns.push({...clone(entry(r,'activity_events.user_id')),column:'ghost_table.user_id'});}),/Stale registry entry ghost_table\.user_id/);
mention(await problemsOf(r=>{r.columns.push(clone(entry(r,'activity_events.user_id')));}),/Duplicate registry entry activity_events\.user_id/);
mention(await problemsOf(()=>{},{extraSql:'CREATE INDEX probe_projects_name ON projects(name);'}),/Schema fingerprint changed/);
mention(await problemsOf(()=>{},{extraSql:'CREATE TABLE probe_child(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id));'}),/new table probe_child is not reviewed/);
mention(await problemsOf(()=>{},{extraSql:'CREATE TABLE probe_loose(id TEXT PRIMARY KEY);'}),/noTenantPath: new table probe_loose is not reviewed/);
mention(await problemsOf(r=>{r.derived.noTenantPath.push('vanished_table');}),/noTenantPath: vanished_table is stale/);
mention(await problemsOf(r=>{entry(r,'activity_events.user_id').sourceFile='schema/other.sql';}),/defining schema file is schema\/platform\.sql/);
mention(await problemsOf(r=>{entry(r,'activity_events.user_id').onDelete='RESTRICT';}),/delete action is CASCADE/);
mention(await problemsOf(r=>{r.textualIdentity.push({column:'projects.no_such_column',kind:'tenant-textual'});}),/Textual identity projects\.no_such_column does not exist/);
mention(await problemsOf(r=>{r.textualIdentity.push({column:'projects.owner_user_id',kind:'tenant-textual'});}),/is a users foreign key and belongs in columns/);

// ---- negative controls: classification shape ----
mention(await problemsOf(r=>{entry(r,'user_profiles.user_id').roles.tenant='workspace_id';}),/must not carry a tenant role/);
mention(await problemsOf(r=>{delete entry(r,'chat_turns.user_id').roles.actor;}),/needs a actor role/);
mention(await problemsOf(r=>{entry(r,'chat_turns.user_id').roles.actor='workspace_id';}),/roles share one intended column/);
mention(await problemsOf(r=>{entry(r,'projects.owner_user_id').class='account';}),/subject workspace does not match class account/);
mention(await problemsOf(r=>{entry(r,'content_risk_evidence.user_id').subjects.pop();}),/exactly an account and a workspace column/);
mention(await problemsOf(r=>{entry(r,'photo_scan_tickets.user_id').split[1].table='photo_scan_tickets';}),/split table photo_scan_tickets already exists/);
mention(await problemsOf(r=>{entry(r,'github_connections.user_id').status='undecided';}),/an undecided entry must name its owner question/);
mention(await problemsOf(r=>{entry(r,'github_connections.user_id').questions=['made-up'];}),/unknown question made-up/);
// A recorded answer is a dated fact with an anchor, never a bare flag; an open question carries no answer.
mention(await problemsOf(r=>{r.questions[0].ownerAnswerRecorded=true;}),/payer-on-transfer: a recorded owner answer needs ownerAnswer\.recordedOn/);
mention(await problemsOf(r=>{r.questions[0].ownerAnswer={recordedOn:'2026-10-08',answer:'x',anchor:'docs/workspace-collaboration.md#remaining-product-questions'};}),/ownerAnswer is present but ownerAnswerRecorded is false/);
mention(await problemsOf(r=>{r.questions.find(q=>q.id==='member-limit').ownerAnswer.anchor='docs/workspace-collaboration.md#no-such-heading';}),/member-limit: answer anchor .*anchor does not exist/);
mention(await problemsOf(r=>{r.questions.find(q=>q.id==='member-limit').item=5;}),/answered question is no longer numbered/);
mention(await problemsOf(r=>{r.questions.find(q=>q.id==='funded-workspace-bound').item=6;}),/numbered 1 to 4/);
mention(await problemsOf(r=>{r.questions.find(q=>q.id==='funded-workspace-bound').ownerAnswerRecorded='yes';}),/must be true or false/);
mention(await problemsOf(r=>{entry(r,'github_connections.user_id').status='frozen';}),/unknown status frozen/);
mention(await problemsOf(r=>{entry(r,'github_connections.user_id').evidence.push('docs/workspace-collaboration.md#no-such-heading');}),/anchor does not exist/);
mention(await problemsOf(r=>{entry(r,'github_connections.user_id').evidence.push('src/not-a-file.ts');}),/file does not exist/);
mention(await problemsOf(r=>{entry(r,'github_connections.user_id').evidence.push('../outside.md');}),/not a repository path/);
mention(await problemsOf(r=>{r.status='final';}),/must be version 1 with status proposed-not-frozen or frozen/);
// A new column must not collide with, or double count, an existing one.
mention(await problemsOf(()=>{},{extraSql:'ALTER TABLE activity_events ADD COLUMN workspace_id TEXT;'}),/intended tenant column workspace_id already exists in activity_events/);
mention(await problemsOf(()=>{},{extraSql:'ALTER TABLE content_risk_evidence ADD COLUMN account_id TEXT;'}),/typed column account_id already exists in content_risk_evidence/);
mention(await problemsOf(()=>{},{extraSql:'CREATE TABLE content_scan_tickets(id TEXT PRIMARY KEY);'}),/split table content_scan_tickets already exists/);

// ---- the combined gate catches stale bodies and cross-type comparisons through the registry's own types ----
const stale=await runChecks(undefined,{extraSql:"CREATE TRIGGER canary_stale_column BEFORE INSERT ON projects BEGIN SELECT RAISE(ABORT,'x') WHERE NEW.owner_user_idx IS NULL; END;"});
mention(stale.problems,/trigger canary_stale_column no longer compiles: no such column: NEW\.owner_user_idx/);
const cross=await runChecks(undefined,{extraSql:"CREATE TRIGGER canary_cross_type BEFORE DELETE ON projects BEGIN SELECT RAISE(ABORT,'x') WHERE EXISTS(SELECT 1 FROM users u WHERE u.id=OLD.owner_user_id); END;"});
mention(cross.problems,/trigger canary_cross_type compares users\.id = projects\.owner_user_id \(account\/workspace\)/);
const unbaselined=clone(baseline);unbaselined.bodies.crossTypeFindings.pop();
mention((await runChecks(undefined,{baseline:unbaselined})).problems,/is not in the baseline/);
const outdated=clone(baseline);outdated.bodies.crossTypeFindings.push({fingerprint:'0000000000000000',object:'gone',kind:'trigger',comparison:'x = y',types:'account/workspace'});
mention((await runChecks(undefined,{baseline:outdated})).problems,/baseline exception 0000000000000000 no longer matches any finding/);
// The 19 retention guards and 3 hold triggers the feasibility spike found by renaming are all found structurally in the current tree.
const spike=['inference_delete_guard','cms_publication_media_retained','cms_import_retained','cms_wordpress_source_retained','app_owner_erasure_retention','usage_review_delete','contact_suppression_delete','cms_media_safety_retained','project_spec_apply_retained','service_client_apply_retained','service_client_activation_retained','project_spec_creation_retained','feature_preview_retained','chat_interaction_request_retained','chat_interaction_retained','chat_interaction_submission_retained','chat_task_created_project_retained','module_activation_review_retained','module_access_role_review_retained','safety_hold_chat_draft','safety_hold_guest_feedback_retained','safety_hold_guest_link_retained'];
const baselined=new Set(baseline.bodies.crossTypeFindings.map(f=>f.object));
for(const name of spike)assert.ok(baselined.has(name),name);
assert.ok(baselined.has('safety_held_projects')&&baselined.has('operator_contained_projects'),'the views the spike called uncounted are found too');
// 44 objects at ca17c6a plus WH-050's operator_containment_retained (same hold-subject comparison as the safety_hold_* triggers).
assert.ok(baselined.has('operator_containment_retained'));
// WH-181 adds 19 objects: the review_receipts delete guards (users.id and hold-subject comparisons with each family's user_id).  WH-091 adds four: the account hold guards (delete and rename) on brand kits and saved sections.
assert.equal(baselined.size,81);
const current=await runChecks();
assert.deepEqual(current.problems,[]);
assert.deepEqual([current.bodies.findings.total,current.bodies.findings.new,current.bodies.findings.stale],[90,0,0]);

// ---- the command line ----
const cli=args=>spawnSync(process.execPath,['tools/tenant-classification.mjs',...args],{encoding:'utf8'});
const check=cli([]);assert.equal(check.status,0,check.stderr);assert.match(check.stdout,/127\/127 users foreign keys classified, 0 unclassified, 0 stale/);assert.match(check.stdout,/schema freeze would be refused/);
const freeze=cli(['freeze']);assert.equal(freeze.status,3);assert.match(freeze.stderr,/FREEZE REFUSED/);
assert.equal(cli(['nonsense']).status,1);
console.log('Tenant classification registry gate verified: 127 columns, drift, shape and freeze canaries fire.');

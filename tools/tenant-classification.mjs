// WH-054 packet 1a: tenant classification registry gate. Local, read-only, no schema or runtime change.
//
//   node tools/tenant-classification.mjs [check]        coverage, drift and body gates (exit 1 on any problem)
//   node tools/tenant-classification.mjs report [--json] counts, statuses and open questions (never a failure by itself)
//   node tools/tenant-classification.mjs bodies [--json]  trigger/view reparse validator and cross-type lint
//   node tools/tenant-classification.mjs freeze          1b freeze preflight: refuses while any entry is not accepted (exit 3)
//
// The registry (docs/tenant-classification.json) is a proposal for the coordinated C2 schema, not a decision. Its
// gates fail on drift between the registry and the composed current schema (an unclassified or stale users
// foreign key, a changed defining file or delete action, a changed schema fingerprint). Proposed and undecided
// entries are reported but are not coverage failures; the freeze command is where they block.
//
// Progression (each step is a reviewed edit of the registry, never inferred): an owner answer is recorded on its
// question (ownerAnswerRecorded true plus the dated answer and its contract anchor); an entry leaves `undecided`
// only once none of its questions is open; the schema review sets entries `accepted` (never with an open question);
// the registry becomes `frozen` only when every entry is accepted and every question answered. `check` enforces
// the same rules, so a coherent frozen registry passes both `check` and `freeze`.
import {readFile,stat} from 'node:fs/promises';
import {resolve,dirname,isAbsolute,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {currentSchema,currentSchemaFiles,schemaSummary,schemaInventorySQL} from './current-schema.mjs';
import {currentLifecycleSchema} from './lifecycle-catalog.mjs';
import {tokenize} from './sql-structure.mjs';
import {validateBodies,schemaObjects} from './schema-body-validator.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const registryPath='docs/tenant-classification.json';
export const baselinePath='docs/tenant-checks-baseline.json';

const classes=['account','workspace','workspace+actor','workspace+custody','workspace+payer','typed-subject','split'];
const statuses=['proposed','undecided','accepted'];
const registryStatuses=['proposed-not-frozen','frozen'];
const day=/^\d{4}-\d{2}-\d{2}$/;
const evidenceLevels=['review-spike','source-reading'];
const retargets=['keep','hand-written','typed-subject','split'];
const subjects=['account','workspace','mixed'];
const roleNames=['tenant','account','actor','custody','payer','epoch'];
const requiredRoles={account:['account'],workspace:['tenant'],'workspace+actor':['tenant','actor'],'workspace+custody':['tenant','custody'],'workspace+payer':['tenant','payer'],'typed-subject':[],split:[]};
const subjectOfClass={account:'account',workspace:'workspace','workspace+actor':'workspace','workspace+custody':'workspace','workspace+payer':'workspace','typed-subject':'mixed',split:'mixed'};
const slug=heading=>heading.toLowerCase().replace(/[^\w\s-]/g,'').trim().replace(/\s/g,'-');

export async function loadRegistry(directory=root){return JSON.parse(await readFile(resolve(directory,registryPath),'utf8'));}
export async function loadBaseline(directory=root){return JSON.parse(await readFile(resolve(directory,baselinePath),'utf8'));}

/** Defining schema file of every table, found with the SQL tokenizer so comments and strings cannot count. */
async function tableOrigins(directory){
 const origin=new Map();
 for(const file of currentSchemaFiles){
  const tokens=tokenize(await readFile(resolve(directory,file),'utf8'));
  const word=(i,w)=>tokens[i]?.type==='id'&&!tokens[i].quoted&&tokens[i].value.toUpperCase()===w;
  for(let i=0;i<tokens.length;i++){
   if(!word(i,'CREATE'))continue;
   let j=i+1;if(word(j,'TEMP')||word(j,'TEMPORARY'))j++;
   if(!word(j,'TABLE'))continue;j++;
   if(word(j,'IF')&&word(j+1,'NOT')&&word(j+2,'EXISTS'))j+=3;
   if(tokens[j]?.type==='id'&&!origin.has(tokens[j].value))origin.set(tokens[j].value,file);
  }
 }
 return origin;
}

/**
 * The composed current schema in a disposable in-memory database. `extraSql` is for negative controls only: it
 * appends statements (a new foreign key, a stale trigger) to a copy, never to a file or a real database.
 */
async function schemaDatabase(directory,extraSql){
 if(!extraSql)return currentLifecycleSchema(directory);
 const db=new DatabaseSync(':memory:');
 try{db.exec((await currentSchema(directory))+'\n'+extraSql);return {db};}catch(error){db.close();throw error;}
}

/** Everything the gates need from the composed current schema, read from a disposable in-memory database. */
export async function observeSchema(directory=root,{extraSql}={}){
 const {db}=await schemaDatabase(directory,extraSql);
 try{
  const origin=await tableOrigins(directory);
  const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT IN ('_cf_KV','_cf_METADATA') ORDER BY name").all().map(r=>r.name);
  const columns=new Map(tables.map(t=>[t,db.prepare('SELECT name FROM pragma_table_info(?)').all(t).map(c=>c.name)]));
  const foreignKeys=new Map(tables.map(t=>[t,db.prepare('SELECT "from","table","on_delete" FROM pragma_foreign_key_list(?) ORDER BY id,seq').all(t)]));
  const usersColumns=tables.flatMap(t=>foreignKeys.get(t).filter(f=>f.table==='users').map(f=>({id:`${t}.${f.from}`,table:t,column:f.from,onDelete:f.on_delete,sourceFile:origin.get(t)??null})));
  const usersTables=new Set(usersColumns.map(c=>c.table));
  // Tenant derivation for tables that have no users foreign key (method: see registry.derived.method).
  const direct=[],chained=[],none=[];
  for(const t of tables){
   if(usersTables.has(t)||t==='users')continue;
   const seen=new Set([t]);let frontier=[t],found=false;
   while(frontier.length&&!found){
    const next=[];
    for(const n of frontier){for(const f of foreignKeys.get(n)??[]){if(seen.has(f.table))continue;seen.add(f.table);if(f.table==='projects'||usersTables.has(f.table)){found=true;break;}next.push(f.table);}if(found)break;}
    frontier=next;
   }
   if(!found)none.push(t);else if(foreignKeys.get(t).some(f=>f.from==='project_id'))direct.push(t);else chained.push(t);
  }
  const textualProjectId=tables.filter(t=>columns.get(t).includes('project_id')&&!foreignKeys.get(t).some(f=>f.from==='project_id'));
  const objects=schemaObjects(db);
  return {tables,columns,usersColumns,derived:{direct,chained,none,textualProjectId},fingerprint:schemaSummary(db.prepare(schemaInventorySQL).all()),
   counts:{tables:tables.length,triggers:objects.filter(o=>o.type==='trigger').length,views:objects.filter(o=>o.type==='view').length}};
 }finally{db.close();}
}

const sameSet=(a,b)=>a.length===b.length&&new Set([...a,...b]).size===a.length;
const diff=(expected,observed)=>({missing:observed.filter(x=>!expected.includes(x)).sort(),stale:expected.filter(x=>!observed.includes(x)).sort()});

async function resolveEvidence(directory,reference,cache){
 const [path,anchor]=reference.split('#');
 if(!path||isAbsolute(path)||relative(directory,resolve(directory,path)).startsWith('..'))return 'not a repository path';
 try{if(!(await stat(resolve(directory,path))).isFile())return 'not a file';}catch{return 'file does not exist';}
 if(anchor!==undefined){
  if(!path.endsWith('.md'))return 'anchor on a non-markdown file';
  if(!cache.has(path))cache.set(path,new Set([...(await readFile(resolve(directory,path),'utf8')).matchAll(/^#{1,6} (.+)$/gm)].map(m=>slug(m[1]))));
  if(!cache.get(path).has(anchor))return 'anchor does not exist';
 }
 return null;
}

/** Registry against the observed schema. Returns problems (gate failures) and a coverage summary. */
export async function checkRegistry(registry,observed,{directory=root}={}){
 const problems=[];
 const fail=m=>problems.push(m);
 if(registry.version!==1||!registryStatuses.includes(registry.status))fail(`Registry must be version 1 with status ${registryStatuses.join(' or ')}`);
 const cache=new Map();
 const questionIds=new Set(),openQuestions=new Set(),items=new Set();
 for(const q of registry.questions??[]){
  if(questionIds.has(q.id))fail('Duplicate question '+q.id);questionIds.add(q.id);
  if(typeof q.ownerAnswerRecorded!=='boolean')fail(`Question ${q.id}: ownerAnswerRecorded must be true or false`);
  else if(q.ownerAnswerRecorded){
   // An answer is a recorded fact with a date and the contract section that records it, never a bare flag.
   const a=q.ownerAnswer;
   if(!a||!day.test(a.recordedOn??'')||!a.answer||!a.anchor)fail(`Question ${q.id}: a recorded owner answer needs ownerAnswer.recordedOn (YYYY-MM-DD), answer and anchor`);
   else{const problem=await resolveEvidence(directory,a.anchor,cache);if(problem)fail(`Question ${q.id}: answer anchor ${a.anchor}: ${problem}`);}
   if(q.item!==undefined)fail(`Question ${q.id}: an answered question is no longer numbered among the remaining product questions`);
  }else{
   openQuestions.add(q.id);
   if(q.ownerAnswer!==undefined)fail(`Question ${q.id}: ownerAnswer is present but ownerAnswerRecorded is false`);
   if(!Number.isInteger(q.item)||items.has(q.item))fail(`Question ${q.id}: an open question needs a unique remaining-question number`);items.add(q.item);
  }
 }
 if(items.size&&[...items].sort((a,b)=>a-b).some((n,i)=>n!==i+1))fail(`Open questions must be numbered 1 to ${items.size} as in the contract`);
 const entries=new Map(),duplicates=[];
 for(const e of registry.columns??[]){if(entries.has(e.column))duplicates.push(e.column);entries.set(e.column,e);}
 for(const d of duplicates)fail('Duplicate registry entry '+d);
 const observedIds=observed.usersColumns.map(c=>c.id);
 const coverage=diff([...entries.keys()],observedIds);
 for(const id of coverage.missing)fail(`Unclassified users foreign key ${id}: add a registry entry`);
 for(const id of coverage.stale)fail(`Stale registry entry ${id}: no such users foreign key in the current schema`);
 for(const c of observed.usersColumns){
  const e=entries.get(c.id);if(!e)continue;
  if(e.sourceFile!==c.sourceFile)fail(`${c.id}: defining schema file is ${c.sourceFile}, registry says ${e.sourceFile}`);
  if(e.onDelete!==c.onDelete)fail(`${c.id}: delete action is ${c.onDelete}, registry says ${e.onDelete}`);
 }
 for(const e of entries.values()){
  const where=e.column;
  if(!classes.includes(e.class))fail(`${where}: unknown class ${e.class}`);
  if(!statuses.includes(e.status))fail(`${where}: unknown status ${e.status}`);
  if(!evidenceLevels.includes(e.evidenceLevel))fail(`${where}: unknown evidence level ${e.evidenceLevel}`);
  if(!retargets.includes(e.retarget))fail(`${where}: unknown retarget ${e.retarget}`);
  if(!subjects.includes(e.subject)||e.subject!==subjectOfClass[e.class])fail(`${where}: subject ${e.subject} does not match class ${e.class}`);
  if((e.class==='account')!==(e.retarget==='keep'))fail(`${where}: only account entries keep their column`);
  if((e.class==='typed-subject')!==(e.retarget==='typed-subject')||(e.class==='split')!==(e.retarget==='split'))fail(`${where}: retarget ${e.retarget} does not match class ${e.class}`);
  const [table,column]=e.column.split('.');
  const present=observed.columns.get(table)??[];
  // Roles stay separate: each names its own intended column, tenant-class roles never reuse the account column.
  const roles=e.roles??{};
  for(const name of Object.keys(roles))if(!roleNames.includes(name))fail(`${where}: unknown role ${name}`);
  const required=requiredRoles[e.class]??[];
  for(const name of required)if(!roles[name])fail(`${where}: class ${e.class} needs a ${name} role`);
  for(const name of Object.keys(roles))if(!required.includes(name)&&!(name==='epoch'&&e.class==='workspace+actor'))fail(`${where}: class ${e.class} must not carry a ${name} role`);
  const intended=Object.entries(roles).map(([name,col])=>[name,col]);
  if(new Set(intended.map(([,col])=>col)).size!==intended.length)fail(`${where}: roles share one intended column`);
  for(const [name,col] of intended){
   if(name==='account'){if(col!==column)fail(`${where}: the account role keeps its current column ${column}`);continue;}
   if(present.includes(col))fail(`${where}: intended ${name} column ${col} already exists in ${table}; a new column must not collide with, or double count, an existing one`);
  }
  if(e.class==='typed-subject'){
   const kinds=(e.subjects??[]).map(s=>s.subject).sort().join();
   if(kinds!=='account,workspace')fail(`${where}: a typed subject needs exactly an account and a workspace column`);
   for(const s of e.subjects??[]){
    if(present.includes(s.column))fail(`${where}: typed column ${s.column} already exists in ${table}`);
    if(s.references!==(s.subject==='account'?'users':'workspaces'))fail(`${where}: ${s.subject} subject must reference ${s.subject==='account'?'users':'workspaces'}`);
   }
   if(e.roles)fail(`${where}: a typed subject carries subjects, not roles`);
  }
  if(e.class==='split'){
   const kinds=(e.split??[]).map(s=>s.subject).sort().join();
   if((e.split??[]).length<2||kinds!=='account,workspace')fail(`${where}: a split needs an account table and a workspace table`);
   for(const s of e.split??[]){
    if(observed.tables.includes(s.table))fail(`${where}: split table ${s.table} already exists; it would be double counted`);
    if(s.references!==(s.subject==='account'?'users':'workspaces'))fail(`${where}: split ${s.table} must reference ${s.subject==='account'?'users':'workspaces'}`);
   }
   if(new Set((e.split??[]).map(s=>s.table)).size!==(e.split??[]).length)fail(`${where}: duplicate split table`);
   if(e.roles)fail(`${where}: a split carries tables, not roles`);
  }
  if(e.status==='undecided'&&!(e.questions?.length))fail(`${where}: an undecided entry must name its owner question`);
  for(const id of e.questions??[])if(!questionIds.has(id))fail(`${where}: unknown question ${id}`);
  const open=(e.questions??[]).filter(id=>openQuestions.has(id));
  if(e.status==='undecided'&&e.questions?.length&&!open.length)fail(`${where}: undecided, but every question it names is answered; review it to proposed`);
  if(e.status==='accepted'&&open.length)fail(`${where}: accepted while owner question ${open.join(', ')} is open`);
  if(!e.basis||!e.evidence?.length)fail(`${where}: basis and evidence are required`);
  for(const ref of e.evidence??[]){const problem=await resolveEvidence(directory,ref,cache);if(problem)fail(`${where}: evidence ${ref}: ${problem}`);}
 }
 // Indirect tenants and textual identity: reviewed lists must equal what the schema derives.
 const d=registry.derived??{};
 for(const [key,observedList] of [['derivesTenantDirect',observed.derived.direct],['derivesTenantChained',observed.derived.chained],['noTenantPath',observed.derived.none],['textualProjectIdWithoutForeignKey',observed.derived.textualProjectId]]){
  const drift=diff(d[key]??[],observedList);
  for(const t of drift.missing)fail(`Derived inventory ${key}: new table ${t} is not reviewed`);
  for(const t of drift.stale)fail(`Derived inventory ${key}: ${t} is stale`);
 }
 for(const item of registry.textualIdentity??[]){
  if(item.column){
   const [t,c]=item.column.split('.');
   if(!(observed.columns.get(t)??[]).includes(c))fail(`Textual identity ${item.column} does not exist`);
   if(observed.usersColumns.some(u=>u.id===item.column))fail(`Textual identity ${item.column} is a users foreign key and belongs in columns`);
  }else{const problem=await resolveEvidence(directory,item.path,cache);if(problem)fail(`Textual identity ${item.path}: ${problem}`);}
 }
 if(registry.status==='frozen'){
  const notAccepted=[...entries.values()].filter(e=>e.status!=='accepted').length;
  if(notAccepted)fail(`Registry is frozen but ${notAccepted} entries are not accepted`);
  if(openQuestions.size)fail(`Registry is frozen but owner questions ${[...openQuestions].join(', ')} are open`);
 }
 if(registry.baseline?.reviewedSchemaSha256!==observed.fingerprint.sha256)fail(`Schema fingerprint changed (${observed.fingerprint.sha256.slice(0,12)}, reviewed ${String(registry.baseline?.reviewedSchemaSha256).slice(0,12)}): review the schema change against the registry, then update baseline.reviewedSchemaSha256`);
 if(registry.baseline?.usersForeignKeyColumns!==observed.usersColumns.length)fail(`baseline.usersForeignKeyColumns is ${registry.baseline?.usersForeignKeyColumns}, schema has ${observed.usersColumns.length}`);
 if(registry.baseline?.tables!==observed.counts.tables)fail(`baseline.tables is ${registry.baseline?.tables}, schema has ${observed.counts.tables}`);
 return {problems,coverage:{current:observedIds.length,classified:observedIds.length-coverage.missing.length,unclassified:coverage.missing,stale:coverage.stale,duplicates}};
}

/** Types for the lint on the current schema: the registry says which `users` references are tenants. */
export function typeOverlay(registry){
 const overlay=new Map();
 for(const e of registry.columns)overlay.set(e.column.toLowerCase(),e.subject);
 for(const t of registry.textualIdentity)if(t.column&&t.type)overlay.set(t.column.toLowerCase(),t.type);
 return overlay;
}

function tally(list,key){const out={};for(const x of list){const k=typeof key==='function'?key(x):x[key];out[k]=(out[k]??0)+1;}return Object.fromEntries(Object.entries(out).sort());}

/** Counts and statuses. Proposed and undecided entries are reported here and are never a coverage failure. */
export function registryReport(registry,observed){
 const e=registry.columns;
 const question=q=>({id:q.id,item:q.item,summary:q.summary,undecided:e.filter(x=>x.status==='undecided'&&x.questions?.includes(q.id)).map(x=>x.column),dependent:e.filter(x=>x.status!=='undecided'&&x.questions?.includes(q.id)).map(x=>x.column)});
 const open=registry.questions.filter(q=>q.ownerAnswerRecorded!==true).map(question);
 const answered=registry.questions.filter(q=>q.ownerAnswerRecorded===true).map(q=>({...question(q),ownerAnswer:q.ownerAnswer}));
 return {
  status:registry.status,
  currentColumns:e.length,
  byClass:tally(e,'class'),byStatus:tally(e,'status'),byEvidenceLevel:tally(e,'evidenceLevel'),byRetarget:tally(e,'retarget'),byOnDelete:tally(e,'onDelete'),
  // Current columns are counted once above. Mixed entries introduce more than one intended column or table; these
  // are not additional current columns and must not be added to the 111.
  intended:{typedSubjectColumns:e.filter(x=>x.class==='typed-subject').flatMap(x=>x.subjects.map(s=>`${x.column.split('.')[0]}.${s.column}`)),splitTables:e.filter(x=>x.class==='split').flatMap(x=>x.split.map(s=>s.table)),
   note:'Intended outputs are listed beside, not instead of, the current column they replace. Only uniform tenant retargets follow the user_id to workspace_id pattern, and even those are hand-written because a mechanical rename is invalid.'},
  undecided:e.filter(x=>x.status==='undecided').map(x=>({column:x.column,questions:x.questions})),
  proposed:e.filter(x=>x.status==='proposed').length,
  openQuestions:open,answeredQuestions:answered,
  derived:{reachesTenant:observed.derived.direct.length+observed.derived.chained.length,direct:observed.derived.direct.length,chained:observed.derived.chained.length,noTenantPath:observed.derived.none.length,textualProjectIdWithoutForeignKey:observed.derived.textualProjectId.length,
   method:registry.derived.method},
  textualIdentity:{columns:registry.textualIdentity.filter(x=>x.column).length,custodyContextFiles:registry.textualIdentity.filter(x=>x.path).length},
  schema:{...observed.counts,sha256:observed.fingerprint.sha256},
 };
}

/** The 1b freeze preflight. Pure registry arithmetic over recorded answers: it never infers one. */
export function freezeStatus(registry){
 const notAccepted=registry.columns.filter(x=>x.status!=='accepted');
 const undecided=registry.columns.filter(x=>x.status==='undecided');
 const reasons=[];
 if(notAccepted.length)reasons.push(`${notAccepted.length} of ${registry.columns.length} entries are not accepted (${notAccepted.length-undecided.length} proposed, ${undecided.length} undecided)`);
 const unanswered=registry.questions.filter(q=>q.ownerAnswerRecorded!==true);
 if(unanswered.length)reasons.push(`${unanswered.length} owner questions have no recorded answer (${unanswered.map(q=>q.id).join(', ')})`);
 if(registry.status!=='frozen')reasons.push(`registry status is ${registry.status}`);
 return {frozen:!reasons.length,refused:reasons.length>0,reasons};
}

/** Trigger and view validators against the composed current schema, using registry types and the reviewed baseline. */
export async function checkBodies(directory=root,{registry,baseline,extraSql}={}){
 registry??=await loadRegistry(directory);baseline??=await loadBaseline(directory);
 const {db}=await schemaDatabase(directory,extraSql);
 try{return validateBodies(db,{overlay:typeOverlay(registry),baseline:baseline.bodies});}finally{db.close();}
}

export async function runChecks(directory=root,{registry,baseline,extraSql}={}){
 registry??=await loadRegistry(directory);baseline??=await loadBaseline(directory);
 const observed=await observeSchema(directory,{extraSql});
 const registryResult=await checkRegistry(registry,observed,{directory});
 const bodies=await checkBodies(directory,{registry,baseline,extraSql});
 return {registry,observed,registryResult,bodies,problems:[...registryResult.problems,...bodies.problems]};
}

async function main(argv){
 const [command='check',...rest]=argv;
 const json=rest.includes('--json');
 if(rest.some(a=>a!=='--json')||!['check','report','bodies','freeze'].includes(command))throw Error('Usage: node tools/tenant-classification.mjs [check|report|bodies|freeze] [--json]');
 if(command==='freeze'){
  const registry=await loadRegistry();const status=freezeStatus(registry);
  if(status.refused){console.error('FREEZE REFUSED (packet 1b must not freeze the coordinated schema):\n - '+status.reasons.join('\n - '));process.exitCode=3;}
  else console.log('Registry is accepted in full.');
  return;
 }
 if(command==='report'){
  const registry=await loadRegistry(),observed=await observeSchema();
  const report=registryReport(registry,observed);
  if(json){console.log(JSON.stringify(report,null,2));return;}
  console.log(`Tenant classification (proposed, not frozen): ${report.currentColumns} users foreign-key columns across ${new Set(registry.columns.map(c=>c.column.split('.')[0])).size} tables.`);
  console.log('By class: '+Object.entries(report.byClass).map(([k,v])=>`${k} ${v}`).join(', '));
  console.log('By status: '+Object.entries(report.byStatus).map(([k,v])=>`${k} ${v}`).join(', ')+' (reported, not coverage failures)');
  console.log('By evidence: '+Object.entries(report.byEvidenceLevel).map(([k,v])=>`${k} ${v}`).join(', '));
  console.log(`Intended outputs beside current columns: typed columns ${report.intended.typedSubjectColumns.join(', ')}; split tables ${report.intended.splitTables.join(', ')}.`);
  console.log(`Indirect tenants: ${report.derived.reachesTenant} tables reach a tenant (${report.derived.direct} through a project_id foreign key, ${report.derived.chained} through a longer chain), ${report.derived.noTenantPath} have no tenant path; ${report.derived.textualProjectIdWithoutForeignKey} carry a textual project_id.`);
  console.log(`Textual identity follow-up: ${report.textualIdentity.columns} columns and ${report.textualIdentity.custodyContextFiles} custody-context files, excluded from any mechanical rename.`);
  for(const q of report.answeredQuestions)console.log(`Question ${q.id}: owner answer recorded ${q.ownerAnswer.recordedOn} (${q.ownerAnswer.anchor}); dependent entries ${q.dependent.length}`);
  for(const q of report.openQuestions)console.log(`Question ${q.item} ${q.id}: no owner answer recorded; undecided ${q.undecided.length}, dependent ${q.dependent.length}`);
  return;
 }
 if(command==='bodies'){
  const result=await checkBodies();
  if(json){console.log(JSON.stringify({ok:result.ok,problems:result.problems,coverage:result.coverage,findings:result.findings,limitations:result.limitations},null,2));}
  else{
   const c=result.coverage;
   console.log(`Reparse: ${c.triggers.verified}/${c.triggers.total} triggers and ${c.views.verified}/${c.views.total} views compile (${c.triggers.statementsPrepared} statements prepared in a disposable database, none executed); ${c.triggers.updateOfMissing} UPDATE OF lists name a missing column, ${c.triggers.unsupported} triggers unsupported.`);
   console.log(`Lint: ${c.lint.comparisons} comparisons in ${c.lint.triggersAnalyzed} triggers and ${c.lint.viewsAnalyzed} views, ${c.lint.unresolvedOperands} unresolved operands, ${c.lint.unsupported} unsupported bodies; cross-type findings ${result.findings.total} (${result.findings.baselined} baselined, ${result.findings.new} new, ${result.findings.stale} stale exceptions).`);
   for(const p of result.problems.slice(0,20))console.error('  '+p);
  }
  if(!result.ok)process.exitCode=1;
  return;
 }
 const result=await runChecks();
 const r=result.registryResult.coverage;
 console.log(`Registry: ${r.classified}/${r.current} users foreign keys classified, ${r.unclassified.length} unclassified, ${r.stale.length} stale.`);
 const report=registryReport(result.registry,result.observed);
 console.log(`Status (reported, not failures): ${Object.entries(report.byStatus).map(([k,v])=>`${k} ${v}`).join(', ')}; schema freeze would be refused (node tools/tenant-classification.mjs freeze).`);
 const c=result.bodies.coverage;
 console.log(`Bodies: ${c.triggers.verified}/${c.triggers.total} triggers and ${c.views.verified}/${c.views.total} views compile; ${result.bodies.findings.baselined} baselined cross-type findings, ${result.bodies.findings.new} new.`);
 if(result.problems.length){for(const p of result.problems)console.error(' - '+p);process.exitCode=1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await main(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}
}

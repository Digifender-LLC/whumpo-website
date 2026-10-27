import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {currentSchemaFiles} from '../tools/current-schema.mjs';

// WH-061 / WH-180 offline review-retention conformance. Synthetic owners, projects and identifiers only: no D1,
// Worker, network, credential or model. Part 1 proves docs/review-retention.md agrees with the real capacity
// triggers (composed canonical schema inputs), code deleters and WH-009 classes, so the inventory cannot drift.
// Part 2 proves the proposed policy on the in-memory model. WH-181 put the active-only caps, sealed receipts and delete guards
// in the schema (tests/review-receipts.mjs proves their behaviour); this suite checks that the schema's caps match the policy
// constants. It does not prove deleting statements, routes, custom-host serving or deployment (WH-182–184). Every suite check also runs against deliberately broken
// copies of the reference (mutants below); each must be caught by the check written for that property.
const root=fileURLToPath(new URL('..',import.meta.url));
const prototypeURL=new URL('../tools/prototypes/review-retention.mjs',import.meta.url);
const prototypeSource=readFileSync(prototypeURL,'utf8');
const doc=readFileSync(new URL('../docs/review-retention.md',import.meta.url),'utf8');
const reference=await import(prototypeURL);
const repo=reference.loadRepository(root,currentSchemaFiles);

const section=name=>{const m=doc.match(new RegExp(`<!-- review-retention:${name}:start -->\\n([\\s\\S]*?)<!-- review-retention:${name}:end -->`));assert.ok(m,`missing ${name} section`);return m[1];};
const cells=line=>line.split('|').slice(1,-1).map(c=>c.trim());
const dataRows=text=>text.split('\n').filter(l=>l.startsWith('| ')&&!l.startsWith('| ---')).slice(1);
const unquote=c=>c.replace(/^`|`$/g,'');
const F='backend_publication_reviews',D='directory_reviews';

async function suite(m){
 let count=0;
 const test=async(name,fn)=>{try{await fn();count++;}catch(error){throw new Error(name,{cause:error});}};
 const code=(fn,c,detail)=>assert.throws(fn,e=>{assert.equal(e.code,c);if(detail)assert.match(e.message,new RegExp(detail));return true;});
 const small={...m.proposedPolicy,activePerProject:3,activePerOwner:6,activeGlobal:30,fairShareFrom:15,fairSharePerOwner:3,historyPerProject:3,receiptsPerProject:50,turnoverBatch:50};
 // Generous caps isolate retention properties from admission.
 const roomy={...small,activePerProject:50,activePerOwner:50,activeGlobal:500,fairShareFrom:500};
 let n=0;const next=()=>`id-${++n}`;
 const prep=(s,o)=>m.prepare(s,{family:F,kind:'change',target:'t',payload:{n:++n},requestHash:`h-${o.id}`,...o});
 const active=s=>[...s.rows.values()].filter(r=>r.kind!=='withdrawal'&&['pending','uncertain'].includes(m.rowState(s,r))).length;
 const report=m.inventoryReport(repo);

 // ---------- Part 1: the document agrees with the schema, the code and WH-009 ----------
 await test('inventory agrees with schema triggers',()=>{
  const rows=section('inventory').split('\n').filter(l=>l.startsWith('| `'));
  assert.deepEqual(rows,report.lines);
  assert.ok(report.rows.length>=80,'every row-count capacity trigger is inventoried');
  for(const t of ['directory_reviews','backend_form_reviews','app_page_reviews','backend_publication_reviews','backend_state_reviews','app_restore_reviews'])assert.ok(report.rows.some(r=>r.table===t),t);
 });
 await test('every capped table is classified consistently',()=>{
  const lanes={review:'R1',receipt:'R2',operation:'R3',version:'R4',evidence:'R5',inventory:'R6',rate:'R6'};
  const del=m.deleters(repo.facts,repo.appDeletes);
  // A family whose every row is a withdrawal has no count cap, so no inventory row.
  const exemptOnly=Object.keys(m.capRegistry).filter(t=>m.capRegistry[t].withdrawal==='every row');
  assert.deepEqual(exemptOnly,['cms_unpublish_reviews','github_grant_revocations']);
  assert.deepEqual(Object.keys(m.capRegistry).filter(t=>!exemptOnly.includes(t)).sort(),report.rows.map(r=>r.table).sort(),'no unregistered or stale registry entries');
  for(const r of report.rows){
   const g=m.capRegistry[r.table],d=del(r.table);
   assert.equal(g.lane,lanes[g.class],r.table);
   assert.equal(g.lifecycle,repo.lifecycle.get(m.lifecycleTable(r.table)),`${r.table} WH-009 class`);
   if(g.turnover==='lifetime')assert.ok(!d.includes('app'),`${r.table} has an application sweep; it is not lifetime`);
   if(g.turnover==='expiring')assert.ok(d.includes('app'),`${r.table} has no sweep`);
   if(g.turnover==='window')assert.ok(r.caps.includes('(window)'),r.table);
   const capList=r.caps.split(' · ');
   if(g.turnover==='lifetime')assert.ok(capList.some(c=>!c.includes('(filtered)')&&!c.includes('(window)')),`${r.table} has no lifetime cap; it is not lifetime`);
   if(g.turnover==='active-only')assert.ok(capList.every(c=>c.includes('(filtered)')||c.includes('(window)')),`${r.table} still has a lifetime cap`);
   if(g.turnover==='pending-only')assert.ok(r.caps.includes('(filtered)')||repo.facts.views.has(r.table),r.table);
   if(g.turnover==='restricted')assert.equal(g.class,'evidence',r.table);
  }
 });
 await test('derived sets agree with the document',()=>{
  const sets=section('sets'),list=label=>[...sets.split('\n').find(l=>l.startsWith(`- **${label}`)).matchAll(/`([^`]+)`/g)].map(x=>x[1]);
  assert.deepEqual(list('Ceiling set'),report.ceiling);assert.deepEqual(list('Converted set'),report.converted);assert.deepEqual(list('Shared ceiling set'),report.shared);assert.deepEqual(list('Other lifetime'),report.other);
  // WH-181 fixed B1 for these; what is left in the shared set is exactly the families it stopped on.
  for(const t of ['backend_form_reviews','app_page_reviews','backend_publication_reviews','backend_state_reviews','app_restore_reviews','app_activation_reviews'])assert.ok(report.converted.includes(t)&&!report.shared.includes(t),`B1 table ${t}`);
  assert.deepEqual(report.shared,['app_runs','backend_runs','cms_draft_requests','cms_draft_requests+cms_edit_requests','cms_export_links','cms_preview_links','project_spec_applies','service_client_activation_reviews','service_client_applies']);
  assert.deepEqual([...report.converted,...report.shared].sort((a,b)=>a.localeCompare(b)),report.ceiling.filter(t=>report.converted.includes(t)||report.shared.includes(t)));
  assert.ok(report.ceiling.includes(D)&&!report.shared.includes(D),'the directory ceiling is per project');
 });
 await test('policy and state tables agree with the reference',()=>{
  const policy=Object.fromEntries(dataRows(section('policy')).map(cells).map(([k,v])=>[unquote(k),Number(v)]));
  assert.deepEqual(policy,{...m.proposedPolicy});
  const states=Object.fromEntries(dataRows(section('states')).map(cells).map(([k,,d])=>[unquote(k),d]));
  assert.deepEqual(states,{...m.disposition});
 });
 await test('the global ceiling is unreachable by the invited cohort',()=>{
  const invited=Number(report.rows.find(r=>r.table==='users').caps.match(/^platform (\d+)$/)[1]),P=m.proposedPolicy;
  assert.ok(P.activeGlobal>=invited*P.activePerOwner,`activeGlobal ${P.activeGlobal} < ${invited} accounts × ${P.activePerOwner}`);
  assert.ok(P.fairShareFrom<P.activeGlobal&&P.fairSharePerOwner<P.activePerOwner&&P.activePerProject<=P.activePerOwner);
 });
 await test('references table covers the ceiling set and names exempt withdrawals',()=>{
  const rows=dataRows(section('references')).map(cells);
  assert.deepEqual(rows.map(r=>unquote(r[0])),report.ceiling);
  for(const [family,refs,withdrawal] of rows){
   assert.ok(refs.length>3,family);
   const w=m.capRegistry[unquote(family)].withdrawal;assert.equal(withdrawal,w?'`'+w+'`':'—',family);
  }
  for(const t of ['backend_publication_reviews','app_page_reviews','cms_unpublish_reviews','github_grant_revocations',D])assert.ok(m.capRegistry[t].withdrawal,`${t} withdrawals must be exempt`);
 });

 await test('converted families count active rows at the policy limits',()=>{
  const P=m.proposedPolicy,at=(scope,limit)=>`${scope} ${limit} (filtered)`;
  const standard=[at('project',P.activePerProject),at('owner',P.fairSharePerOwner),at('owner',P.activePerOwner),at('platform',P.fairShareFrom),at('platform',P.activeGlobal)];
  // Deliberate variations (docs/review-retention.md, "Schema and trigger changes"), each stricter than or outside the policy.
  const expected={
   backend_nominations:[at('owner',5),at('owner',P.fairSharePerOwner),at('platform',P.fairShareFrom),at('platform',P.activeGlobal)],
   app_migration_checks:[at('project',5)],
   cms_discard_reviews:standard.filter(c=>!c.startsWith('project')),
   domain_connections:[...standard,at('platform',80)],
  };
  const withdrawalOnly=new Set(['cms_unpublish_reviews','github_grant_revocations']);
  for(const t of report.converted){
   if(withdrawalOnly.has(t)){assert.ok(!report.rows.some(r=>r.table===t),`${t}: every row is a withdrawal, so nothing is counted`);continue;}
   const row=report.rows.find(r=>r.table===t);assert.ok(row,t);
   assert.deepEqual(row.caps.split(' · ').sort(),(expected[t]??standard).sort(),`${t} caps`);
  }
  for(const t of ['app_migration_current'])assert.equal(report.rows.find(r=>r.table===t).caps,'platform 50','migration current keeps its existing platform limit');
 });

 // ---------- Part 2: the proposed policy on the synthetic model ----------
 // Characterizes today's triggers; no mutant touches the current-policy branch, so it runs for the reference only.
 if(m===reference)await test('the former lifetime policy (before WH-181) reproduces the ceiling and B1',()=>{
  const s=m.createStore({policy:'current'});
  for(let i=0;i<100;i++){const id=next();prep(s,{id,ownerId:'a',projectId:'p0'});m.confirm(s,{family:F,id,turn:'t'+id});s.now+=3_600_000;}
  code(()=>prep(s,{id:next(),ownerId:'a',projectId:'p0'}),'REVIEW_CAPACITY','project');
  for(let p=1;p<10;p++)for(let i=0;i<100;i++)prep(s,{id:next(),ownerId:'a',projectId:'p'+p});
  code(()=>prep(s,{id:next(),ownerId:'b',projectId:'q'}),'REVIEW_CAPACITY','platform');
  code(()=>prep(s,{id:next(),ownerId:'b',projectId:'q',kind:'withdrawal'}),'REVIEW_CAPACITY','platform');
 });
 await test('pruning never removes active, unknown, held or referenced rows',()=>{
  const s=m.createStore({limits:roomy});
  const applied=(id,o)=>{prep(s,{id,ownerId:'a',projectId:'p',...o});m.confirm(s,{family:F,id,turn:'t-'+id});s.now+=1000;};
  prep(s,{id:'u1',ownerId:'a',projectId:'p',target:'dns'});m.markUncertain(s,{family:F,id:'u1'});
  applied('h1',{projectId:'held',target:'held'});m.hold(s,{scope:'project',projectId:'held'});
  applied('x1',{target:'x'});m.pin(s,F,'x1','export');
  for(const id of ['c1','c2','c3','c4','c5','c6'])applied(id,{target:'c'});
  prep(s,{id:'e1',ownerId:'a',projectId:'p',target:'e'});
  s.now+=2*small.terminalGraceMs;prep(s,{id:'p1',ownerId:'a',projectId:'p',target:'p'});m.turnover(s);m.turnover(s);
  for(const id of ['u1','h1','x1','c6','c5','c4','p1'])assert.ok(s.rows.has(`${F}:${id}`),`${id} must remain a full row`);
  assert.deepEqual(['u1','h1','x1','c6','p1'].map(id=>m.rowState(s,s.rows.get(`${F}:${id}`))),['uncertain','held','applied-referenced','applied-referenced','pending']);
  for(const id of ['c1','c2','c3','e1'])assert.ok(!s.rows.has(`${F}:${id}`)&&s.receipts.has(`${F}:${id}`),`${id} compacts to a sealed receipt`);
  s.now+=small.replayHorizonMs*2;m.turnover(s);m.turnover(s);
  for(const id of ['u1','h1','x1','c6'])assert.ok(s.rows.has(`${F}:${id}`),`${id} must outlive the replay horizon`);
  m.reconcile(s,{family:F,id:'u1',applied:false});s.now+=small.terminalGraceMs;m.turnover(s);
  assert.equal(s.receipts.get(`${F}:u1`).outcome,'failed');
 });
 await test('recent applied snapshots remain restorable; older ones become digest-only',()=>{
  const s=m.createStore({limits:roomy}),ids=[];
  for(let i=0;i<6;i++){const id=next();ids.push(id);m.prepare(s,{family:D,id,ownerId:'a',projectId:'p',target:'directory',payload:{listings:[i]},requestHash:'h'+id});m.confirm(s,{family:D,id,turn:'t'+id});s.now+=1000;}
  m.turnover(s);
  assert.deepEqual(ids.map(id=>m.restorable(s,D,id)),[false,false,false,true,true,true]);
  assert.equal(s.receipts.get(`${D}:${ids[0]}`).payloadDigest,m.seal({listings:[0]}));
 });
 await test('one owner at their cap cannot block another',()=>{
  const s=m.createStore({limits:small});
  for(const p of ['a1','a2'])for(let i=0;i<3;i++)prep(s,{id:next(),ownerId:'a',projectId:p});
  code(()=>prep(s,{id:next(),ownerId:'a',projectId:'a1'}),'REVIEW_CAPACITY','project');
  code(()=>prep(s,{id:next(),ownerId:'a',projectId:'a3'}),'REVIEW_CAPACITY','owner');
  assert.equal(prep(s,{id:next(),ownerId:'b',projectId:'b1'}).outcome,'prepared');
  s.now+=small.reviewLifetimeMs+small.terminalGraceMs+1;
  assert.equal(prep(s,{id:next(),ownerId:'a',projectId:'a3'}).outcome,'prepared','expired reviews stop counting without an operator');
 });
 await test('the global ceiling bounds every owner and fair share keeps a reserve',()=>{
  const s=m.createStore({limits:small}),refusals=[];
  for(let o=1;o<=12;o++)for(let i=0;i<6;i++){
   try{prep(s,{id:next(),ownerId:'o'+o,projectId:`o${o}-p${i%2}`});}catch(e){refusals.push(`${o}:${e.message.split(': ')[1]}`);}
   assert.ok(active(s)<=small.activeGlobal);
  }
  assert.equal(active(s),small.activeGlobal);
  assert.ok(refusals.includes('3:fair-share')&&refusals.includes('9:platform'),refusals.join());
  const admitted=o=>[...s.rows.values()].filter(r=>r.ownerId==='o'+o).length;
  assert.deepEqual(Array.from({length:12},(_,i)=>admitted(i+1)),[6,6,3,3,3,3,3,3,0,0,0,0],'light owners keep the reserve until the ceiling');
  assert.equal(prep(s,{id:next(),ownerId:'o12',projectId:'z',kind:'withdrawal',target:'svc'}).outcome,'prepared');
 });
 await test('withdrawals are exempt from capacity and bounded per target',()=>{
  const s=m.createStore({limits:{...small,receiptsPerProject:2}});
  for(let i=0;i<3;i++){const id=next();prep(s,{id,ownerId:'a',projectId:'p'});m.confirm(s,{family:F,id,turn:'t'+id});s.now+=small.reviewLifetimeMs;}
  m.turnover(s);for(let i=0;i<3;i++)prep(s,{id:next(),ownerId:'a',projectId:'p'});
  code(()=>prep(s,{id:next(),ownerId:'a',projectId:'p'}),'REVIEW_CAPACITY','project');
  let last;for(let i=0;i<40;i++){last=next();assert.equal(prep(s,{id:last,ownerId:'a',projectId:'p',kind:'withdrawal',target:'svc'}).outcome,'prepared');}
  assert.equal([...s.rows.values()].filter(r=>r.kind==='withdrawal'&&r.status==='pending').length,1);
  m.turnover(s);assert.ok([...s.rows.values()].filter(r=>r.kind==='withdrawal').length<=1);
  assert.equal(m.confirm(s,{family:F,id:last,turn:'w'}).outcome,'applied');
  s.now+=small.reviewLifetimeMs+small.terminalGraceMs;m.turnover(s);
  code(()=>prep(s,{id:next(),ownerId:'a',projectId:'p'}),'RECEIPT_HORIZON');
  assert.equal(prep(s,{id:next(),ownerId:'a',projectId:'p',kind:'withdrawal',target:'svc'}).outcome,'prepared','a full receipt ring never blocks a withdrawal');
 });
 await test('replay and idempotency survive compaction',()=>{
  const s=m.createStore({limits:roomy}),ids=[];
  for(let i=0;i<5;i++){const id=next();ids.push(id);prep(s,{id,ownerId:'a',projectId:'p',target:'c'});m.confirm(s,{family:F,id,turn:'t'+id});s.now+=1000;}
  const expired=next();prep(s,{id:expired,ownerId:'a',projectId:'p',target:'e'});s.now+=small.reviewLifetimeMs+small.terminalGraceMs;m.turnover(s);
  const [old]=ids,k=`${F}:${old}`;assert.ok(s.receipts.has(k)&&!s.rows.has(k));
  assert.equal(prep(s,{id:old,ownerId:'a',projectId:'p',target:'c'}).outcome,'replayed');
  code(()=>m.prepare(s,{family:F,id:old,ownerId:'a',projectId:'p',target:'c',payload:{},requestHash:'different'}),'REQUEST_CONFLICT');
  assert.equal(m.confirm(s,{family:F,id:old,turn:'t'+old}).outcome,'replayed');
  assert.equal(m.confirm(s,{family:F,id:old,turn:'another'}).outcome,'already-applied');
  assert.equal(m.confirm(s,{family:F,id:expired,turn:'late'}).outcome,'expired');
  assert.equal(s.receipts.get(`${F}:${expired}`).outcome,'expired');
  const sealed=s.receipts.get(k);s.receipts.set(k,{...sealed,payloadDigest:'0'.repeat(64)});
  code(()=>m.confirm(s,{family:F,id:old,turn:'t'+old}),'RECEIPT_TAMPERED');
  code(()=>prep(s,{id:old,ownerId:'a',projectId:'p',target:'c'}),'RECEIPT_TAMPERED');
  s.receipts.set(k,sealed);s.now=sealed.sealedAt+small.replayHorizonMs-1;m.turnover(s);
  assert.ok(s.receipts.has(k),'receipts answer retries for the whole replay horizon');
  s.now+=1;m.turnover(s);assert.ok(!s.receipts.has(k),'and then leave');
 });
 await test('routine turnover needs no operator edit and storage stays bounded',()=>{
  const s=m.createStore(),P=m.proposedPolicy;let maxRows=0,maxReceipts=0;
  for(let i=0;i<1000;i++){
   const id=next();m.prepare(s,{family:D,id,ownerId:'a',projectId:'p',target:'directory',payload:{i},requestHash:'h'+id});
   if(i%10)m.confirm(s,{family:D,id,turn:'t'+id});
   s.now+=3_600_000;maxRows=Math.max(maxRows,s.rows.size);maxReceipts=Math.max(maxReceipts,s.receipts.size);
  }
  assert.ok(maxRows<=P.historyPerProject+3,`rows ${maxRows}`);
  assert.ok(maxReceipts<=P.replayHorizonMs/3_600_000+1&&maxReceipts<P.receiptsPerProject,`receipts ${maxReceipts}`);
  for(let pass=0;pass<2;pass++){s.now+=P.replayHorizonMs+1;m.turnover(s);}
  assert.equal(s.receipts.size,0);assert.equal(s.rows.size,P.historyPerProject,'idle projects keep only the restorable window');
 });
 await test('receipts inherit WH-009 classes and follow project cleanup',()=>{
  const s=m.createStore({limits:roomy});
  for(const project of ['p','q','held'])for(let i=0;i<6;i++){const id=next();m.prepare(s,{family:D,id,ownerId:project==='q'?'b':'a',projectId:project,target:'directory',payload:{i},requestHash:'h'+id});m.confirm(s,{family:D,id,turn:'t'+id});s.now+=1000;}
  m.turnover(s);m.hold(s,{scope:'project',projectId:'held'});
  assert.ok(s.receipts.size>0);
  for(const c of s.receipts.values())assert.equal(c.lifecycle,repo.lifecycle.get(D));
  for(const project of ['p','held'])m.deleteProject(s,project);
  const left=[...s.rows.values(),...s.receipts.values()];
  assert.ok(!left.some(r=>r.projectId==='p'),'ordinary cleanup removes rows and receipts');
  assert.ok(left.some(r=>r.projectId==='held')&&left.some(r=>r.projectId==='q'),'holds preserve; other projects untouched');
 });
 return count;
}

let total=0;const once=async(name,fn)=>{try{await fn();total++;}catch(error){throw new Error(name,{cause:error});}};
const suiteCount=await suite(reference);total+=suiteCount;
await once('the schema input list matches tools/current-schema.mjs',()=>assert.deepEqual(reference.schemaInputList(root),[...currentSchemaFiles]));
await once('the reference imports only node builtins and touches no network or D1 binding',()=>{
 const specifiers=[...prototypeSource.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(x=>x[1]??x[2]);
 assert.deepEqual(specifiers.sort(),['node:crypto','node:fs','node:path','node:sqlite','node:url']);
 assert.ok(!/\bfetch\s*\(|env\.DB|D1Database|process\.env/.test(prototypeSource));
});
await once('the document is marked planned and keeps WH-033 with the parent',()=>{
 assert.match(doc,/\*\*Status: WH-181 .* implemented the schema in source; nothing is deployed\.\*\*/);assert.ok(!/<!-- (INVENTORY|CEILING|SHARED|OTHER) -->/.test(doc));
 assert.match(doc,/No child reaches WH-033, WH-049 or WH-104 acceptance/);
});

// ---------- Mutation check: each deliberately broken reference must fail the suite ----------
const mutants=[
 ['platform-wide caps dropped from the inventory','if(cmp&&real.length){',"if(cmp&&real.length&&real.some(t=>subjectScope(t.where)!=='platform')){"],
 ['time windows read as lifetime',"const qualifier=where=>windowed.test(where)?'window':","const qualifier=where=>false?'window':"],
 ['application deletes ignored',"if(appDeletes.has(part))kinds.add('app');",''],
 ['directory reviews declared lifetime',"directory_reviews:R('review','R1','active-only'","directory_reviews:R('review','R1','lifetime'"],
 ['backend unpublish not exempt',"backend_publication_reviews:R('review','R1','active-only','backend-artifacts',\"operation='unpublish'\")","backend_publication_reviews:R('review','R1','active-only','backend-artifacts')"],
 ['terminal rows counted against capacity','&&pred(r)&&isActive(s,r)).length;','&&pred(r)).length;'],
 ['no per-owner cap',"check(mine<L.activePerOwner,'REVIEW_CAPACITY','owner');",''],
 ['no fair share',"check(all<L.fairShareFrom||mine<L.fairSharePerOwner,'REVIEW_CAPACITY','fair-share');",''],
 ['no global ceiling',"check(all<L.activeGlobal,'REVIEW_CAPACITY','platform');",''],
 ['declared dispositions drift from the document',"pending:'active-authority',uncertain","pending:'compact',uncertain"],
 ['active authority compacted',"if(disposition[state]!=='compact')continue;","if(disposition[state]==='retained-evidence')continue;"],
 ['unknown outcomes treated as expired','if(isActive(s,r))return r.status;',"if(r.status==='pending'&&r.expiresAt>s.now)return r.status;"],
 ['references ignored','const isReferenced=(s,r)=>','const isReferenced=(s,r)=>false&&'],
 ['safety holds ignored','const isHeld=(s,r)=>','const isHeld=(s,r)=>false&&'],
 ['history window ignored','return s.historyMemo.rows.has(r);','return false;'],
 ['expired rows never compacted',"if(state==='expired'&&r.expiresAt+s.limits.terminalGraceMs>s.now)continue;","if(state==='expired')continue;"],
 ['withdrawals capped',"if(kind==='withdrawal'&&s.policy==='proposed'){",'if(false){'],
 ['withdrawals not superseded',"for(const r of s.rows.values())if(r.family===family&&r.kind==='withdrawal'&&r.target===target&&r.status==='pending')r.status='superseded';",''],
 ['receipt drops the request hash','payloadDigest:r.payloadDigest,requestHash:r.requestHash,','payloadDigest:r.payloadDigest,'],
 ['replay with a different request accepted',"check(existing.requestHash===requestHash,'REQUEST_CONFLICT',k);",''],
 ['receipt seal not verified',"function verify(c){const {seal:sealed,...fields}=c;check(seal(fields)===sealed,'RECEIPT_TAMPERED',c.id);}",'function verify(c){}'],
 ['receipts evicted inside the replay horizon','if(c.sealedAt+s.limits.replayHorizonMs>s.now)break;','if(false)break;'],
 ['no admission-time turnover',"if(s.policy==='proposed')turnover(s,{projectId,family});",''],
 ['receipts lose their lifecycle class','lifecycle:r.lifecycle,sealedAt:s.now','lifecycle:null,sealedAt:s.now'],
 ['project cleanup keeps receipts',"for(const [k,c] of [...s.receipts])if(c.projectId===projectId&&!isHeld(s,c))s.receipts.delete(k);",''],
];
const killedBy={
 'platform-wide caps dropped from the inventory':'inventory agrees','time windows read as lifetime':'inventory agrees','application deletes ignored':'inventory agrees',
 'directory reviews declared lifetime':'inventory agrees','backend unpublish not exempt':'references table',
 'terminal rows counted against capacity':'one owner at their cap','no per-owner cap':'one owner at their cap','no fair share':'the global ceiling',
 'no global ceiling':'the global ceiling','declared dispositions drift from the document':'policy and state tables',
 'active authority compacted':'pruning never removes','unknown outcomes treated as expired':'pruning never removes',
 'references ignored':'pruning never removes','safety holds ignored':'pruning never removes','history window ignored':'pruning never removes',
 'expired rows never compacted':'pruning never removes','withdrawals capped':'the global ceiling','withdrawals not superseded':'withdrawals are exempt',
 'receipt drops the request hash':'replay and idempotency','replay with a different request accepted':'replay and idempotency',
 'receipt seal not verified':'replay and idempotency','receipts evicted inside the replay horizon':'pruning never removes',
 'no admission-time turnover':'routine turnover','receipts lose their lifecycle class':'receipts inherit','project cleanup keeps receipts':'receipts inherit',
};
let killed=0;
for(const [name,find,replace] of mutants){
 assert.equal(prototypeSource.split(find).length,2,`mutant "${name}" must match the reference exactly once`);
 const mutant=await import('data:text/javascript;base64,'+Buffer.from(prototypeSource.replace(find,()=>replace)).toString('base64'));
 await assert.rejects(suite(mutant),e=>{
  if(process.argv.includes('--explain'))console.log(`${name} => ${e.message}`);
  assert.ok(killedBy[name]&&e.message.startsWith(killedBy[name]),`mutant "${name}" was caught by an unexpected check: ${e.message}`);return true;
 },`mutant survived: ${name}`);killed++;
}
assert.equal(killed,mutants.length);
console.log(`review-retention-contract: ${suiteCount} reference checks and ${total-suiteCount} static checks passed; inventory ${repo.facts.triggers.length} triggers → ${reference.inventoryReport(repo).rows.length} capped tables; ${killed}/${mutants.length} mutants caught (synthetic model; no D1, network or deployment).`);

import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {closureInventorySQL} from '../tools/account-closure-inventory.mjs';

// WH-018 slice 1 conformance harness for the account closure review, the stop-new-work state machine and its guards.
// Every decision runs in the unwired source src/account-closure/*.ts (bundled with esbuild); there is no database,
// network, credential or provider here. Synthetic counts only. Every check also runs against deliberately broken copies
// of the source (mutants below), and each mutant must be caught. It does not prove the durable table or any cleanup step.
const root=fileURLToPath(new URL('..',import.meta.url));
const read=file=>readFileSync(join(root,file),'utf8');
const files=['src/account-closure/review.ts','src/account-closure/machine.ts'];
const entry=`export * from './src/account-closure/review';export * from './src/account-closure/machine';`;
async function load(overrides={}){
 const plugin={name:'mutant',setup(b){b.onLoad({filter:/\.ts$/},args=>{const rel=relative(root,args.path).replaceAll('\\','/');if(Object.hasOwn(overrides,rel))return {contents:overrides[rel],loader:'ts'};});}};
 const out=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent',plugins:[plugin]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}
const lifecycle=JSON.parse(read('docs/data-lifecycle.json'));
const classes=lifecycle.classes;
const T0=Date.UTC(2026,9,29),MIN=60000;

const suite=async m=>{
 const seen=new Set();
 const refuse=(code,fn)=>{try{fn();}catch(e){assert.equal(e.name,'ClosureError');assert.equal(e.code,code,`expected ${code}, got ${e.code}`);seen.add(code);return;}assert.fail(`expected refusal ${code}`);};
 const zero=()=>Object.fromEntries(Object.keys(m.closureCategories).map(k=>[k,0]));
 const counts=(o={})=>({...zero(),accounts:1,projects:1,...o});
 const ev=(rec,event,extra={})=>({event,actor:'owner',at:rec.at+1000,expectedRevision:rec.revision,...extra});
 const reviewIn=(o={})=>({counts:counts(o),classes});
 const reviewed=(o={})=>{const r=m.requestClosure('acct-1',T0);return m.transition(r,ev(r,'review',reviewIn(o)));};
 const confirmed=(o={})=>{
  const r=reviewed(o);
  return m.transition(r,ev(r,'confirm',{...reviewIn(o),freshAuthAt:r.at,reviewDigest:r.reviewDigest}));
 };
 const quiescing=(o={})=>{const r=confirmed(o);return m.transition(r,ev(r,'quiesce',{actor:'system'}));};
 const facts=(rec,o={},extra={})=>({counts:counts(o),pendingBilling:0,observedAt:rec.quiescedAt+1,...extra});
 const closeIn=(rec,o={},extra={})=>ev(rec,'close',{actor:'system',facts:facts(rec,o,extra)});

 // ---- review ----
 const empty=m.buildReview(counts(),classes);
 assert.deepEqual(empty.items.map(i=>i.key),['accounts','projects']);
 assert.deepEqual(empty.blockers,[]);
 const rich=m.buildReview(counts({openEmailChanges:2,githubCredentials:1,activePreservationHolds:1,unresolvedStandardAI:3,riskEvidence:4}),classes);
 const by=Object.fromEntries(rich.items.map(i=>[i.key,i]));
 assert.equal(by.accounts.disposition,'delete');
 assert.equal(by.openEmailChanges.disposition,'cancel');assert.equal(by.openEmailChanges.count,2);
 assert.equal(by.githubCredentials.disposition,'cancel');
 assert.equal(by.riskEvidence.disposition,'retain');
 assert.equal(by.activePreservationHolds.disposition,'retain');assert.match(by.activePreservationHolds.reason,/preservation hold/);
 assert.equal(by.accounts.classId,'owner-identity');
 assert.equal(by.accounts.proposedRetention,classes.find(c=>c.id==='owner-identity').proposedRetention);
 assert.deepEqual(rich.blockers,['preservation-hold','provider-work-open']);
 assert.notEqual(rich.digest,empty.digest);
 assert.equal(m.buildReview(counts({chatTurns:2}),classes).digest,m.buildReview(counts({chatTurns:2}),classes).digest);
 assert.notEqual(m.buildReview(counts({chatTurns:2}),classes).digest,m.buildReview(counts({chatTurns:3}),classes).digest);
 // A class with no proposed window says so rather than inventing one.
 assert.equal(m.buildReview(counts(),classes.map(c=>c.id==='owner-identity'?{id:c.id,tables:c.tables}:c)).items[0].proposedRetention,'unapproved');
 refuse('invalid-inventory',()=>m.buildReview(null,classes));
 refuse('invalid-inventory',()=>m.buildReview({...counts(),chatTurns:-1},classes));
 refuse('invalid-inventory',()=>m.buildReview({...counts(),chatTurns:1.5},classes));
 refuse('invalid-inventory',()=>{const c=counts();delete c.chatTurns;m.buildReview(c,classes);});
 refuse('unknown-category',()=>m.buildReview({...counts(),surprise:1},classes));
 refuse('invalid-lifecycle',()=>m.buildReview(counts(),null));
 refuse('unknown-class',()=>m.buildReview(counts({accounts:1}),classes.filter(c=>c.id!=='owner-identity')));
 refuse('unknown-class',()=>m.buildReview(counts(),classes.map(c=>c.id==='owner-identity'?{...c,tables:[]}:c)));
 assert.deepEqual([...m.settleFirstKeys].sort(),['activeDomainRegistrations','cloudflarePendingRevocations','connectionRotationGuards','githubGrantUncertain','githubPendingRevocations','pendingScanTickets','uncertainGitHubBackups','unresolvedChatInteractionContinuations','unresolvedConnectionExchanges','unresolvedDomainOrders','unresolvedDomainRecords','unresolvedJobs','unresolvedStandardAI']);
 for(const k of m.settleFirstKeys)assert.ok(m.buildReview(counts({[k]:1}),classes).blockers.includes('provider-work-open'),k);

 // ---- transitions: every edge ----
 const r0=m.requestClosure('acct-1',T0);
 assert.equal(r0.state,'requested');assert.equal(r0.revision,1);
 refuse('invalid-input',()=>m.requestClosure('',T0));
 refuse('invalid-input',()=>m.requestClosure('a',-1));
 const r1=reviewed();
 assert.equal(r1.state,'reviewed');assert.equal(r1.revision,2);assert.equal(r1.reviewDigest,empty.digest);
 assert.equal(r0.state,'requested','transitions do not mutate their input');
 const r2=confirmed();
 assert.equal(r2.state,'confirmed');
 const r3=quiescing();
 assert.equal(r3.state,'quiescing');assert.equal(r3.quiescedAt,r3.at);
 const r4=m.transition(r3,closeIn(r3));
 assert.equal(r4.state,'closed');
 assert.deepEqual(r4.history,['requested','reviewed','confirmed','quiescing','closed']);
 assert.equal(r4.revision,5);
 for(const make of [()=>m.requestClosure('acct-1',T0),reviewed,confirmed,quiescing]){
  const r=make(),c=m.transition(r,ev(r,'cancel'));
  assert.equal(c.state,'cancelled');assert.equal(c.history.at(-1),'cancelled');
 }
 for(const make of [confirmed,quiescing]){
  const r=make(),f=m.transition(r,ev(r,'fail',{actor:'system',failure:'provider-timeout'}));
  assert.equal(f.state,'failed');assert.equal(f.failure,'provider-timeout');
 }
 // Anything not an edge above is an invalid transition.
 const at={requested:()=>r0,reviewed:()=>r1,confirmed:()=>r2,quiescing:()=>r3};
 const okEvents={requested:['review','cancel'],reviewed:['confirm','cancel'],confirmed:['quiesce','cancel','fail'],quiescing:['close','cancel','fail']};
 for(const [state,make] of Object.entries(at))for(const event of m.events){
  if(okEvents[state].includes(event))continue;
  const r=make();
  refuse('invalid-transition',()=>m.transition(r,ev(r,event,{actor:event==='review'||event==='confirm'||event==='cancel'?'owner':'system',...reviewIn(),freshAuthAt:r.at,reviewDigest:r.reviewDigest,facts:r.quiescedAt?facts(r):undefined,failure:'x'})));
 }
 // Terminal states accept nothing.
 const done=[r4,m.transition(r1,ev(r1,'cancel')),m.transition(r3,ev(r3,'fail',{actor:'system',failure:'x'}))];
 assert.deepEqual(done.map(r=>r.state),['closed','cancelled','failed']);
 for(const r of done)for(const event of m.events)refuse('terminal-state',()=>m.transition(r,ev(r,event,{actor:'system'})));
 assert.deepEqual([...m.terminalStates],['closed','cancelled','failed']);
 assert.deepEqual([...m.states].sort(),['cancelled','closed','confirmed','failed','quiescing','requested','reviewed']);

 // ---- actors, freshness, revision, input ----
 for(const actor of ['model','system'])refuse('owner-required',()=>m.transition(r0,ev(r0,'review',{actor,...reviewIn()})));
 for(const actor of ['model','system'])refuse('owner-required',()=>m.transition(r1,ev(r1,'confirm',{actor,...reviewIn(),freshAuthAt:r1.at,reviewDigest:r1.reviewDigest})));
 for(const actor of ['model','system'])refuse('owner-required',()=>m.transition(r2,ev(r2,'cancel',{actor})));
 for(const actor of ['owner','model'])refuse('invalid-transition',()=>m.transition(r2,ev(r2,'quiesce',{actor})));
 for(const actor of ['owner','model'])refuse('invalid-transition',()=>m.transition(r3,ev(r3,'close',{actor,facts:facts(r3)})));
 for(const actor of ['owner','model'])refuse('invalid-transition',()=>m.transition(r3,ev(r3,'fail',{actor,failure:'x'})));
 const conf=(extra)=>m.transition(r1,ev(r1,'confirm',{...reviewIn(),reviewDigest:r1.reviewDigest,...extra}));
 refuse('fresh-auth-required',()=>conf({}));
 refuse('fresh-auth-required',()=>conf({freshAuthAt:r1.at+1000+1}));
 refuse('fresh-auth-required',()=>conf({freshAuthAt:r1.at+1000-10*MIN-1}));
 conf({freshAuthAt:r1.at+1000-10*MIN});
 refuse('stale-revision',()=>m.transition(r1,{...ev(r1,'cancel'),expectedRevision:r1.revision-1}));
 refuse('stale-revision',()=>m.transition(r1,{...ev(r1,'cancel'),expectedRevision:r1.revision+1}));
 refuse('invalid-input',()=>m.transition(r1,ev(r1,'explode')));
 refuse('invalid-input',()=>m.transition(r1,{...ev(r1,'cancel'),actor:'root'}));
 refuse('invalid-input',()=>m.transition(r1,{...ev(r1,'cancel'),at:r1.at-1}));
 refuse('invalid-input',()=>m.transition(r1,{...ev(r1,'cancel'),expectedRevision:'2'}));
 refuse('invalid-input',()=>m.transition(r1,null));
 for(const failure of [undefined,'','Bad Code','x'.repeat(65)])refuse('invalid-input',()=>m.transition(r3,ev(r3,'fail',{actor:'system',failure})));

 // ---- guards ----
 // review-mismatch: the owner confirmed a different review, or the inventory changed after the review.
 refuse('review-mismatch',()=>conf({freshAuthAt:r1.at,reviewDigest:'[]'}));
 refuse('review-mismatch',()=>conf({freshAuthAt:r1.at,counts:counts({chatTurns:1})}));
 refuse('review-mismatch',()=>conf({freshAuthAt:r1.at,counts:counts({openEmailChanges:1})}));
 // preservation-hold blocks confirm and close.
 refuse('preservation-hold',()=>conf({freshAuthAt:r1.at,counts:counts({activePreservationHolds:1})}));
 refuse('preservation-hold',()=>m.transition(r3,closeIn(r3,{activePreservationHolds:1})));
 // Open provider work must settle before close; each key alone blocks, and only these keys.
 for(const k of m.settleFirstKeys)refuse('provider-work-open',()=>m.transition(r3,closeIn(r3,{[k]:1})),k);
 for(const k of Object.keys(m.closureCategories)){
  if(m.settleFirstKeys.includes(k)||k==='activePreservationHolds')continue;
  assert.equal(m.transition(r3,closeIn(r3,{[k]:1})).state,'closed',`${k} must not block close`);
 }
 refuse('billing-pending',()=>m.transition(r3,closeIn(r3,{},{pendingBilling:1})));
 refuse('invalid-input',()=>m.transition(r3,closeIn(r3,{},{pendingBilling:-1})));
 refuse('invalid-input',()=>m.transition(r3,ev(r3,'close',{actor:'system'})));
 refuse('invalid-inventory',()=>m.transition(r3,closeIn(r3,{},{counts:{accounts:1}})));
 // Facts older than stop-new-work are stale; equal is fresh.
 refuse('inventory-stale',()=>m.transition(r3,closeIn(r3,{},{observedAt:r3.quiescedAt-1})));
 assert.equal(m.transition(r3,closeIn(r3,{},{observedAt:r3.quiescedAt})).state,'closed');
 // Guard order is stable: hold first, then provider work, then billing.
 refuse('preservation-hold',()=>m.checkClosable(facts(r3,{activePreservationHolds:1,unresolvedStandardAI:1},{pendingBilling:1}),r3.quiescedAt));
 refuse('provider-work-open',()=>m.checkClosable(facts(r3,{unresolvedStandardAI:1},{pendingBilling:1}),r3.quiescedAt));
 // A failed guard leaves the record as it was.
 refuse('billing-pending',()=>m.transition(r3,closeIn(r3,{},{pendingBilling:2})));
 assert.equal(r3.state,'quiescing');

 // Every declared refusal code was exercised above.
 assert.deepEqual([...seen].sort(),[...m.refusalCodes].sort());
};

// ---- static checks on the source and its agreement with the repository ----
const checks=[];
const check=(name,fn)=>checks.push([name,fn]);
check('every inventory key is categorized and nothing else is',m=>{
 const keys=[...closureInventorySQL.matchAll(/\) AS (\w+)/g)].map(x=>x[1]);
 assert.ok(keys.length>80);
 assert.deepEqual(keys.sort(),Object.keys(m.closureCategories).sort());
});
check('every category table belongs to its named lifecycle class in docs/data-lifecycle.json',m=>{
 for(const [key,[table,classId]] of Object.entries(m.closureCategories)){
  const cls=classes.find(c=>c.id===classId);
  assert.ok(cls&&cls.tables.includes(table),`${key}: ${table} not in ${classId}`);
 }
});
check('open provider work keys and holds are real inventory keys',m=>{
 for(const k of [...m.settleFirstKeys,'activePreservationHolds'])assert.ok(k in m.closureCategories,k);
});
check('the source is pure: no storage, network, provider or Worker import and no clock',()=>{
 for(const f of files){
  const text=read(f);
  for(const [,spec] of text.matchAll(/from\s+'([^']+)'/g))assert.match(spec,/^\.\/(review|machine)$/,`${f} imports ${spec}`);
  assert.doesNotMatch(text,/\bfetch\(|Date\.now|new Date|crypto\.|\bD1|\.prepare\(|process\.|cloudflare:/,f);
 }
});
check('the closure modules are wired only through src/account-lifecycle, and the pure ones stay pure',()=>{
 const walk=d=>readdirSync(d).flatMap(n=>{const p=join(d,n);return statSync(p).isDirectory()?walk(p):[p];});
 for(const p of walk(join(root,'src')).filter(p=>!p.includes('account-closure')&&!p.includes('account-lifecycle')&&/\.(ts|tsx|mjs|js)$/.test(p)))assert.doesNotMatch(readFileSync(p,'utf8'),/from\s+['"][^'"]*account-closure\//,p);
 assert.doesNotMatch(read('wrangler.jsonc'),/account-closure/);
 // The inventory module carries the only database access; the metric list is the JSON the operator CLI reads.
 assert.match(read('src/account-closure/inventory.ts'),/from '\.\/metrics\.json'/);
 assert.match(read('tools/account-closure-inventory.mjs'),/account-closure\/metrics\.json/);
});
check('the inventory and the lifecycle contract still say nothing is enabled',()=>{
 assert.equal(lifecycle.runtimeEnforcement,false);
 assert.match(read('docs/account-closure.md'),/slice 1/i);
 assert.match(read('docs/account-closure.md'),/WH-018 runtime/i);
});

const staticModule=await load();
await suite(staticModule);
for(const [name,fn] of checks){try{fn(staticModule);}catch(e){e.message=`${name}: ${e.message}`;throw e;}}

// ---- mutants: each deliberately broken copy of the source must fail the suite or a static check ----
const [R,M]=files;
const mutants=[
 ['hold is not a review blocker',R,"if(counts.activePreservationHolds)blockers.push('preservation-hold');",''],
 ['provider work is not a review blocker',R,"if(settleFirstKeys.some(k=>counts[k]))blockers.push('provider-work-open');",''],
 ['standard AI may stay unresolved',R,"['unresolvedStandardAI',",'['],
 ['uncertainGitHubBackups may stay open',R,",'uncertainGitHubBackups']",']'],
 ['unknown lifecycle class accepted',R,"check(cls&&cls.tables.includes(table),'unknown-class',`${key} -> ${classId}`);",'if(!cls)continue;'],
 ['unknown category accepted',R,"check(Object.hasOwn(c,key),'unknown-category',key);",''],
 ['negative counts accepted',R,'Number.isSafeInteger(v)&&v>=0','Number.isSafeInteger(v)'],
 ['accounts retained instead of deleted',R,"accounts:['users','owner-identity','delete']","accounts:['users','owner-identity','retain']"],
 ['review digest ignores counts',R,'[i.key,i.count,i.disposition]','[i.key,i.disposition]'],
 ['no retention fallback',R,"cls.proposedRetention??'unapproved'","cls.proposedRetention"],
 ['billing may be pending at close',M,"check(facts.pendingBilling===0,'billing-pending');",''],
 ['hold does not block close',M,"check(!facts.counts.activePreservationHolds,'preservation-hold');",''],
 ['provider work does not block close',M,"check(!settleFirstKeys.some(k=>facts.counts[k]),'provider-work-open');",''],
 ['stale inventory accepted',M,"check(facts.observedAt>=quiescedAt,'inventory-stale');",''],
 ['fresh passkey window ignored',M,'input.at-input.freshAuthAt<=freshAuthMs','true'],
 ['future passkey proof accepted',M,'input.freshAuthAt<=input.at&&',''],
 ['anyone may act as owner',M,"input.actor==='owner','owner-required'","true,'owner-required'"],
 ['revision guard removed',M,"check(input.expectedRevision===rec.revision,'stale-revision');",''],
 ['terminal states accept events',M,"check(!terminalStates.includes(rec.state),'terminal-state',rec.state);",''],
 ['hold does not block confirm',M,"check(!review.blockers.includes('preservation-hold'),'preservation-hold');",''],
 ['confirm ignores a changed inventory',M,'input.reviewDigest===rec.reviewDigest&&review.digest===rec.reviewDigest','input.reviewDigest===rec.reviewDigest'],
 ['confirm ignores the digest the owner saw',M,'input.reviewDigest===rec.reviewDigest&&review.digest===rec.reviewDigest','review.digest===rec.reviewDigest'],
 ['quiesce open to any actor',M,"rec.state==='confirmed'&&input.actor==='system','invalid-transition');return next('quiescing'","rec.state==='confirmed','invalid-transition');return next('quiescing'"],
 ['close open to any actor',M,"rec.state==='quiescing'&&input.actor==='system','invalid-transition');\n   checkClosable","rec.state==='quiescing','invalid-transition');\n   checkClosable"],
 ['cancel not allowed while quiescing',M,"['requested','reviewed','confirmed','quiescing'].includes","['requested','reviewed','confirmed'].includes"],
 ['failure code unchecked',M,"typeof input.failure==='string'&&/^[a-z-]{1,64}$/.test(input.failure)",'true'],
 ['history not recorded',M,'history:[...rec.history,state]','history:rec.history'],
 ['time may go backwards',M,"check(input.at>=rec.at,'invalid-input','time went backwards');",''],
 ['quiesce time not recorded',M,"next('quiescing',{quiescedAt:input.at})","next('quiescing')"],
 ['review can skip to confirm',M,"check(rec.state==='reviewed','invalid-transition');owner();\n   check(time(input.freshAuthAt)","check(true,'invalid-transition');owner();\n   check(time(input.freshAuthAt)"],
];
const prepared=mutants.map(([name,file,find,replace])=>{
 assert.ok(files.includes(file));
 const text=read(file);
 assert.equal(text.split(find).length,2,`mutant "${name}" must match ${file} exactly once`);
 return [name,file,text.replace(find,()=>replace)];
});
let killed=0;
for(const [name,file,text] of prepared){
 let caught=false;
 try{
  const m=await load({[file]:text});
  await suite(m);
  for(const [,fn] of checks)try{fn(m);}catch{caught=true;}
 }catch{caught=true;}
 assert.ok(caught,`mutant survived: ${name}`);killed++;
}
console.log(`account-closure-contract: review, ${staticModule.states.length} states, every transition, guard and ${staticModule.refusalCodes.length} refusal codes passed; ${killed}/${mutants.length} mutants caught.`);

import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {databaseFixture} from './helpers/current-database.mjs';

// WH-171: statement import and aggregate reconciliation over cost events appended to the current schema (in-memory SQLite, or
// actual local D1 with --d1). Heads are read with the same read-only query as tools/cost-reconcile.mjs. Synthetic data only.
const bundle=await build({stdin:{contents:"export * from './src/cost-reconcile';export * from './src/cost-events';export * from './src/cost-event-store';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const store=await databaseFixture(),db=store.db;
const id=()=>crypto.randomUUID(),stamp=()=>new Date().toISOString();
const run=(sql,...v)=>db.prepare(sql).bind(...v).run();
const throws=(fn,code)=>assert.throws(fn,e=>e.code===code,code);
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
try{
 const user=async()=>{const u=id();await run('INSERT INTO users(id,email,created_at) VALUES(?,?,?)',u,u+'@example.test',stamp());return u;};
 const project=async o=>{const p=id();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Cost fixture','','draft',?,?)",p,o,stamp(),stamp());return p;};
 const A=await user(),B=await user(),pa=await project(A),pb=await project(B);
 let n=0;
 const platform={scope:'platform',pool:'shared-account'};
 const usage=async(over={})=>{
  const e={contractVersion:1,source:'cloudflare-usage-import',sourceEventId:`cf-${++n}`,providerEventId:null,revision:1,kind:'usage',dimension:'worker.requests',workload:'app-runtime',workClass:'standing',taskRef:null,attempt:1,
   attribution:platform,placementClass:'shared-api',quantity:{state:'known',value:1_000_000,unit:'request'},cost:{basis:'tariff',tariff:{id:'pool-proposal',version:1}},outcome:'settled',customerUnits:0,aiTier:null,detail:{},
   occurredAt:'2026-10-05T00:00:00.000Z',observedAt:'2026-10-06T00:00:00.000Z',idempotencyKey:'',...over};
  e.idempotencyKey=await m.idempotencyKey(e);
  await m.appendCostEvent(db,e);return e;
 };
 const liability=(dimension,cost,over={})=>usage({source:'liability-register',dimension,kind:'liability',workload:'platform-standing',placementClass:'platform',quantity:{state:'known',value:1,unit:'item'},cost,...over});
 // The tool's own read-only query.
 const heads=async()=>(await db.prepare('SELECT e.event_json FROM cost_events e WHERE e.revision=(SELECT MAX(revision) FROM cost_events WHERE idempotency_key=e.idempotency_key) ORDER BY e.seq LIMIT 10001').all()).results.map(r=>JSON.parse(r.event_json));
 const line=(lineKey,amountMicros,over={})=>({lineKey,category:'workers',kind:'usage',dimension:null,amountMicros,...over});
 const stmt=(lines,over={})=>({provider:'cloudflare',invoiceId:'inv-1',period:'2026-10',currency:'USD',lines,...over});
 const report=async(statements,opts)=>m.reconciliationReport(statements,await heads(),opts);
 const cf=r=>r.rows.find(x=>x.provider==='cloudflare'&&x.period==='2026-10');

 await check('exact match is reconciled; a residual is explicit and tolerance is stated',async()=>{
  await usage({attribution:{scope:'tenant',ownerId:A,projectId:pa,resourceId:null}});
  await usage({dimension:'r2.class_b_ops',workload:'storage-files',quantity:{state:'known',value:1_000_000,unit:'operation'}});
  await liability('liability.account-minimum',{basis:'provider-reported',micros:5_000_000,ref:'floor'});
  const ok=cf(await report([stmt([line('u1',660_000),line('f1',5_000_000,{category:'floor',kind:'liability',dimension:'liability.account-minimum'})])]));
  assert.equal(ok.recordedUsageMicros,660_000);assert.equal(ok.recordedLiabilityMicros,5_000_000);assert.equal(ok.residualMicros,0);assert.equal(ok.status,'reconciled');
  const short=cf(await report([stmt([line('u1',700_000),line('f1',5_000_000,{kind:'liability'})])]));
  assert.equal(short.residualMicros,40_000);assert.equal(short.usageResidualMicros,40_000);assert.equal(short.status,'unexplained-residual');
  assert.equal(cf(await report([stmt([line('u1',700_000),line('f1',5_000_000,{kind:'liability'})])],{toleranceMicros:40_000})).status,'reconciled');
  const credit=cf(await report([stmt([line('u1',600_000),line('f1',5_000_000,{kind:'liability'})])]));
  assert.equal(credit.residualMicros,-60_000);assert.equal(credit.status,'unexplained-residual');assert.match(credit.allowanceTreatment,/never allocated to tenants/);
  throws(()=>m.reconciliationReport([],[],{toleranceMicros:-1}),'INVALID_TOLERANCE');
  throws(()=>m.reconciliationReport([],[],{toleranceMicros:1.5}),'INVALID_TOLERANCE');
 });
 await check('dedupe by line key: identical repeats are dropped, conflicting repeats are refused',async()=>{
  const s=stmt([line('u1',660_000),line('f1',5_000_000,{kind:'liability'})]);
  const twice=await report([s,structuredClone(s),stmt([line('u1',660_000)])]);
  assert.equal(twice.duplicateLinesDropped,3);assert.equal(cf(twice).invoiceLines,2);assert.equal(cf(twice).invoiceUsageMicros,660_000);
  throws(()=>m.importStatements([s,stmt([line('u1',1)])]),'STATEMENT_CONFLICT');
  // The same line key under another invoice is a different line.
  assert.equal(m.importStatements([s,stmt([line('u1',660_000)],{invoiceId:'inv-2'})]).lines.length,3);
 });
 await check('unknown statement line: register shows unknown, never zero',async()=>{
  const r=cf(await report([stmt([line('u1',660_000),line('f1',5_000_000,{kind:'liability'}),line('s1',null,{category:'staging',kind:'liability',dimension:'liability.staging-retained'})])]));
  assert.equal(r.status,'incomplete');assert.equal(r.unknownInvoiceLines,1);assert.equal(r.invoiceLiabilityMicros,5_000_000);
  assert.deepEqual(r.liabilityRegister.find(x=>x.category==='staging'),{category:'staging',dimension:'liability.staging-retained',amountMicros:null,state:'unknown'});
  throws(()=>m.validateStatement(stmt([line('l1',1,{category:'license',kind:'liability',dimension:'liability.license'})])),'INVALID_LINE');
  throws(()=>m.validateStatement(stmt([line('l1',1,{kind:'liability',dimension:'worker.requests'})])),'INVALID_LINE');
 });
 await check('unknown and unfinished events hold the report incomplete; a later revision closes them',async()=>{
  const u=await usage({sourceEventId:'unknown-1',quantity:{state:'unknown',reason:'usage-not-reported'},cost:{basis:'unknown',reason:'usage-not-reported',exposureMicros:null}});
  const op=await liability('liability.uncertain-operation',{basis:'unknown',reason:'outcome-unknown',exposureMicros:10_000},{sourceEventId:'op-1',outcome:'uncertain'});
  const s=stmt([line('u1',660_000),line('f1',5_000_000,{kind:'liability'})]);
  const r=cf(await report([s]));
  assert.equal(r.status,'incomplete');assert.equal(r.unknownEvents,2);assert.equal(r.unfinishedEvents,1);assert.equal(r.unboundedExposureEvents,1);assert.equal(r.boundedExposureMicros,10_000);assert.equal(r.residualMicros,0);
  await usage({...u,revision:2,quantity:{state:'known',value:0,unit:'request'},cost:{basis:'receipt',micros:0,ref:'verified-none'},observedAt:'2026-10-07T00:00:00.000Z'});
  await liability('liability.uncertain-operation',{basis:'receipt',micros:0,ref:'verified-not-sent'},{sourceEventId:'op-1',revision:2,outcome:'settled',observedAt:'2026-10-07T00:00:00.000Z'});
  const after=cf(await report([s]));
  assert.equal(after.status,'reconciled');assert.equal(after.unknownEvents,0);assert.equal(after.unfinishedEvents,0);
 });
 await check('shadow estimates are excluded from the invoice comparison',async()=>{
  const before=cf(await report([stmt([line('u1',660_000),line('f1',5_000_000,{kind:'liability'})])]));
  await usage({source:'inference-receipt',sourceEventId:'shadow-1',dimension:'ai.inference.call',workload:'chat-ai',workClass:'standing',quantity:{state:'known',value:1,unit:'call'},cost:{basis:'shadow',micros:140,ref:'muse-shadow'},detail:{inputTokens:1000,outputTokens:200},aiTier:'standard'});
  const rows=(await report([stmt([line('u1',660_000),line('f1',5_000_000,{kind:'liability'})]),stmt([line('i0',0,{category:'inference'})],{provider:'inference-provider',invoiceId:'inv-i'})])).rows;
  const inf=rows.find(x=>x.provider==='inference-provider');
  assert.equal(inf.shadowExcludedMicros,140);assert.equal(inf.recordedUsageMicros,0);assert.equal(inf.status,'reconciled');
  const after=rows.find(x=>x.provider==='cloudflare');
  assert.deepEqual(after,before);
 });
 await check('floors and allowances are never split across tenants',async()=>{
  // Two tenants each use 6,000 requests: both are priced in full (no allowance subtracted or divided), and tenant-attributed
  // support cost joins its provider's account total without any per-tenant row.
  await usage({sourceEventId:'t-a',attribution:{scope:'tenant',ownerId:A,projectId:pa,resourceId:null},quantity:{state:'known',value:6000,unit:'request'}});
  await usage({sourceEventId:'t-b',attribution:{scope:'tenant',ownerId:B,projectId:pb,resourceId:null},quantity:{state:'known',value:6000,unit:'request'}});
  await liability('liability.support',{basis:'receipt',micros:12_000,ref:'support-q3'},{sourceEventId:'sup-a',attribution:{scope:'tenant',ownerId:A,projectId:pa,resourceId:null}});
  const r=await report([stmt([line('u1',660_000),line('f1',5_000_000,{kind:'liability'})])]),row=cf(r);
  assert.equal(row.recordedUsageMicros,660_000+3600);
  assert.equal(row.recordedLiabilities.find(x=>x.dimension==='liability.account-minimum').knownMicros,5_000_000,'the floor is one account-wide figure');
  assert.equal(row.residualMicros,-3600);
  assert.equal(r.rows.find(x=>x.provider==='company').recordedLiabilityMicros,12_000,'tenant-attributed support joins the company total');
  const text=JSON.stringify(r);
  for(const secret of [A,B,pa,pb])assert.ok(!text.includes(secret),'report holds aggregates only');
  assert.deepEqual(Object.keys(row).filter(k=>/owner|project|tenant|resource/i.test(k)),[]);
 });
 await check('malformed, tenant-mismatched and content-bearing rows are rejected',async()=>{
  const bad=(over,code)=>throws(()=>m.validateStatement(stmt([line('u1',1)],over)),code);
  bad({provider:'nobody'},'INVALID_STATEMENT');bad({period:'2026-13'},'INVALID_STATEMENT');bad({currency:'EUR'},'INVALID_STATEMENT');bad({invoiceId:'has space'},'INVALID_STATEMENT');
  bad({ownerId:A},'TENANT_FIELD');bad({projectId:pa},'TENANT_FIELD');bad({prompt:'x'},'CONTENT_FIELD');bad({email:'a@b.c'},'CONTENT_FIELD');bad({extra:1},'UNKNOWN_FIELD');
  throws(()=>m.validateStatement({provider:'cloudflare'}),'MISSING_FIELD');throws(()=>m.validateStatement(null),'INVALID_STATEMENT');
  const l=(over)=>m.validateStatement(stmt([{...line('u1',1),...over}]));
  for(const over of [{amountMicros:1.5},{amountMicros:'5'},{amountMicros:2**53},{amountMicros:Number.NaN},{kind:'other'},{lineKey:'a b'},{category:'x'.repeat(129)},{dimension:'nope'}])throws(()=>l(over),'INVALID_LINE');
  throws(()=>m.validateStatement(stmt([{...line('u1',1),ownerId:A}])),'TENANT_FIELD');
  throws(()=>m.validateStatement(stmt([{...line('u1',1),note:'x'}])),'UNKNOWN_FIELD');
  throws(()=>m.validateStatement(stmt([{...line('u1',1),displayName:'x'}])),'CONTENT_FIELD');
  // An exact sum beyond the safe-integer range is refused rather than rounded.
  const MAX=Number.MAX_SAFE_INTEGER;
  throws(()=>m.reconciliationReport([stmt([line('a',MAX),line('b',MAX)])],[]),'AMOUNT_UNSAFE');
 });
 await check('CSV statements parse to the same statements; malformed CSV is rejected',async()=>{
  const csv=[m.statementCsvHeader,'cloudflare,inv-9,2026-10,USD,u1,workers,usage,,660000','cloudflare,inv-9,2026-10,USD,s1,staging,liability,liability.staging-retained,','cloudflare,inv-9,2026-10,USD,c1,credit,usage,,-5',''].join('\n');
  const [s]=m.parseStatementCsv(csv);
  assert.equal(s.lines.length,3);assert.equal(s.lines[1].amountMicros,null);assert.equal(s.lines[2].amountMicros,-5);assert.equal(m.validateStatement(s).invoiceId,'inv-9');
  throws(()=>m.parseStatementCsv('a,b\n'),'INVALID_STATEMENT');
  throws(()=>m.parseStatementCsv(m.statementCsvHeader+'\ncloudflare,inv-9,2026-10,USD,u1,workers,usage,,1,extra'),'INVALID_STATEMENT');
  throws(()=>m.parseStatementCsv(m.statementCsvHeader+'\ncloudflare,"inv-9",2026-10,USD,u1,workers,usage,,1'),'INVALID_STATEMENT');
  throws(()=>m.parseStatementCsv(m.statementCsvHeader+'\ncloudflare,inv-9,2026-10,USD,u1,workers,usage,,1.5'),'INVALID_LINE');
 });
 await check('the report is read-only: no statement or report row is written',async()=>{
  const count=async()=>(await db.prepare('SELECT count(*) AS n FROM cost_events').first()).n;
  const before=await count();await report([stmt([line('u1',1)])]);assert.equal(await count(),before);
  assert.doesNotMatch(readFileSync('tools/cost-reconcile.mjs','utf8'),/INSERT|UPDATE|DELETE|CREATE|DROP/i);
 });
 console.log(`cost-reconcile: ${cases} cases passed`);
}finally{await store.close?.();}

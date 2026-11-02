import assert from 'node:assert/strict';
import {copyFileSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir,cpus,release} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {currentSchemaArtifact} from '../tools/current-schema.mjs';
import {sqliteD1Adapter} from './sqlite-d1.mjs';

assert.equal(process.argv.length,2,'No database paths or remote targets are accepted');
const source=readFileSync(new URL('../src/site-host.ts',import.meta.url),'utf8');
const extract=pattern=>{const match=source.match(pattern);assert.ok(match,'Site-host SQL changed; update the benchmark');assert.ok(!match[1].includes('${'));return match[1];};
const host=extract(/prepare\("(SELECT c\.project_id FROM domain_connections c JOIN projects p[^"]*)"\)/);
const page=extract(/prepare\(`(SELECT v\.id,v\.html,v\.component_id,EXISTS[^`]*)`\)/);
const beforeHost=sql=>{const before=sql.replace(/ AND (?:c\.)?state NOT IN \('review','disconnected'\)/,'');assert.notEqual(before,sql);return before;};
const schema=await currentSchemaArtifact(),directory=mkdtempSync(join(tmpdir(),'whumpo-hot-path-'));
// Isolate the exact review join too: the full page can short-circuit an empty activation-held view.
const reviewJoin=schema.sql.match(/CREATE VIEW service_client_blocked_contacts[^\n]*\n JOIN contact_reviews r ON ([^\n]*)/);
assert.ok(reviewJoin,'Contact review join changed; update the benchmark');
const contactReview=`SELECT r.id FROM contact_settings c JOIN contact_reviews r ON ${reviewJoin[1]} WHERE c.project_id=?`;
const now='2026-11-01T12:00:00.000Z',future='2099-01-01T00:00:00.000Z';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const warmup=20,batches=40,perBatch=10;
const quantile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*q)-1];
const summary=values=>({medianUs:quantile(values,.5),p95Us:quantile(values,.95)});
const plan=(db,sql,binds)=>db.prepare('EXPLAIN QUERY PLAN '+sql).all(...binds).map(r=>r.detail);
const scans=details=>details.filter(d=>/^SCAN /.test(d)&&!/VIRTUAL TABLE/.test(d));
const prepared=(db,sql,binds)=>{const statement=db.prepare(sql);return ()=>statement.get(...binds)??null;};
function compare(before,after){
 const values=[[],[]];
 for(let i=0;i<warmup;i++){before();after();}
 for(let i=0;i<batches;i++)for(const k of i%2?[1,0]:[0,1]){
  const start=performance.now();for(let j=0;j<perBatch;j++)(k?after:before)();
  values[k].push((performance.now()-start)*1000/perBatch);
 }
 return {before:summary(values[0]),current:summary(values[1])};
}
function seed(db,size){
 db.exec('PRAGMA foreign_keys=ON');db.exec(schema.sql);
 const run=(sql,...binds)=>db.prepare(sql).run(...binds);
 db.exec('BEGIN');
 for(let u=0;u<Math.ceil(size/20);u++)run('INSERT INTO users(id,email,created_at) VALUES(?,?,?)','u'+u,'u'+u+'@example.invalid',now);
 for(let i=0;i<size;i++){
  const p=uuid(i),u='u'+Math.floor(i/20),v='version-'+i;
  run("INSERT INTO projects(id,owner_user_id,name,status,created_at,updated_at) VALUES(?,?,'Synthetic performance fixture','live',?,?)",p,u,now,now);
  const html='<h1>Synthetic '+i+'</h1>'+' '.repeat(8192);
  run("INSERT INTO site_versions(id,project_id,component_id,config_json,html,digest,created_at) VALUES(?,?,'site-page@1','{}',?,?,?)",v,p,html,createHash('sha256').update(html).digest('hex'),now);
  run('INSERT INTO publications(project_id,revision,version_id) VALUES(?,1,?)',p,v);
  run('INSERT INTO contact_settings(project_id,revision,enabled,publication_revision) VALUES(?,10,1,1)',p);
  for(let r=0;r<10;r++)run("INSERT INTO contact_reviews(id,user_id,project_id,enabled,expected_revision,publication_revision,expires_at,status) VALUES(?,?,?,1,?,1,?,'applied')",'r'+i+'-'+r,u,p,r,now);
  for(let day=1;day<=30;day++){
   const date='2026-10-'+String(day).padStart(2,'0');
   run('INSERT INTO site_traffic_daily VALUES(?,?,100)',p,date);
   run('INSERT INTO site_traffic_quality VALUES(?,?,5,0,?)',p,date,now);
  }
 }
 // Forty claims spread across owners stay within current claim/active-host limits, with retained disconnect history.
 for(let h=0;h<40;h++){
  const i=Math.floor(h*size/40),p=uuid(i),u='u'+Math.floor(i/20),claim='claim-'+h,hostname='site-'+h+'.example.invalid';
  run('INSERT INTO domain_claims(id,project_id,hostname,token,expires_at,created_at) VALUES(?,?,?,?,?,?)',claim,p,hostname,'synthetic-proof',future,now);
  for(let r=0;r<size/10;r++){
   const id='d'+h+'-'+r,active=r===size/10-1;
   run("INSERT INTO domain_connections(id,user_id,claim_id,project_id,hostname,zone_id,target,proof_hash,state,created_at,expires_at) VALUES(?,?,?,?,?,'synthetic-zone','hosting.example.invalid','synthetic-proof','review',?,?)",id,u,claim,p,hostname,now,future);
   if(active)run("UPDATE domain_connections SET state='creating' WHERE id=?",id);
   run("UPDATE domain_connections SET state=?,provider_id=?,serve_until=? WHERE id=?",active?'active':'disconnected','provider-'+id,future,id);
  }
 }
 db.exec('COMMIT');
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
}
const bundle=await build({stdin:{contents:"export {measureTraffic} from './src/site-traffic';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
const {measureTraffic}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const report={environment:{node:process.version,sqlite:null,platform:process.platform,arch:process.arch,os:release(),cpu:cpus()[0]?.model,schemaSQLSha256:schema.sqlSha256},method:{sizes:[100,1000],warmupPairs:warmup,batches,queriesPerBatch:perBatch,samplesPerVariant:batches*perBatch,latency:'microseconds per prepared query (preparation excluded); read p95 of batch means, traffic p95 of individual calls including preparation, neither is request p95; alternating reads; warm OS cache; DELETE journal and synchronous FULL; no ANALYZE',contact:'Full page plus isolated exact schema review join; no service-client activation rows, so full-page view can short-circuit. Join timing is not page latency.',cost:'Production cost and rows read unknown; node:sqlite exposes neither D1 billing nor runtime scan/VM-step counters. Traffic rows changed and prepared/run operation counts are measured, not billed rows.'},datasets:[]};
try{
 for(const size of report.method.sizes){
  const seedPath=join(directory,'seed-'+size+'.sqlite'),seedDB=new DatabaseSync(seedPath);seed(seedDB,size);seedDB.close();
  const open=name=>{const path=join(directory,name+'-'+size+'.sqlite');copyFileSync(seedPath,path);return new DatabaseSync(path);};
  const current=open('current'),oldHost=open('old-host'),oldContact=open('old-contact'),traffic=open('traffic');
  try{
   oldContact.exec('DROP INDEX contact_reviews_project');
   assert.equal(traffic.prepare('PRAGMA journal_mode').get().journal_mode,'delete');
   assert.equal(traffic.prepare('PRAGMA synchronous').get().synchronous,2);
   report.environment.sqlite=current.prepare('SELECT sqlite_version() version').get().version;
   const result={projects:size,owners:Math.ceil(size/20),domainConnections:size*4,activeHosts:40,contactReviews:size*10,serviceClientActivationReviews:0,trafficDailyRows:size*30,trafficQualityRows:size*30,reads:[],traffic:[]};
   const cases=[
    ['hostname hit',oldHost,beforeHost(host),host,['site-39.example.invalid',now]],
    ['hostname miss',oldHost,beforeHost(host),host,['missing.example.invalid',now]],
    ['contact-enabled published page',oldContact,page,page,[uuid(size-1)]],
    ['isolated contact review join (not page latency)',oldContact,contactReview,contactReview,[uuid(size-1)]],
   ];
   for(const [name,beforeDB,beforeSQL,currentSQL,binds] of cases){
    const before=prepared(beforeDB,beforeSQL,binds),after=prepared(current,currentSQL,binds);
    assert.deepEqual(before(),after(),name+': equivalent rows');
    if(name.endsWith('miss'))assert.equal(after(),null);
    if(name.endsWith('hit'))assert.equal(after().project_id,uuid(Math.floor(39*size/40)));
    if(name==='contact-enabled published page')assert.equal(after().contact_enabled,1);
    if(name.startsWith('isolated contact'))assert.equal(after().id,'r'+(size-1)+'-9');
    const beforePlan=plan(beforeDB,beforeSQL,binds),currentPlan=plan(current,currentSQL,binds);
    assert.ok(scans(beforePlan).length,name+': pre-fix scan reproduced');
    assert.deepEqual(scans(currentPlan),[],name+': no current full scan');
    result.reads.push({name,...compare(before,after),beforePlan,currentPlan});
   }
   const adapter=sqliteD1Adapter(traffic);let runs=0,prepares=0,changes=0;
   const db={prepare(sql){prepares++;const statement=adapter.prepare(sql);return {bind(...args){const bound=statement.bind(...args);return {async run(){runs++;const r=await bound.run();changes+=r.meta.changes;return r;}};}};}};
   const trafficSQL=readFileSync(new URL('../src/site-traffic.ts',import.meta.url),'utf8');
   const countedSQL=trafficSQL.match(/prepare\('(INSERT INTO site_traffic_daily[^']*)'\)/)[1];
   const excludedSQL=trafficSQL.match(/prepare\('(INSERT INTO site_traffic_quality[^']*)'\)/)[1];
   for(const kind of ['counted','excluded']){
    const p=uuid(size-1),date=new Date(now),table=kind==='counted'?'site_traffic_daily':'site_traffic_quality',column=kind==='counted'?'requests':'excluded_requests';
    const counter=()=>traffic.prepare(`SELECT ${column} n FROM ${table} WHERE project_id=? AND day=?`).get(p,'2026-11-01')?.n??0;
    const startValue=counter(),beforeRuns=runs,beforePrepares=prepares,beforeChanges=changes,latencies=[];
    for(let i=0;i<warmup+batches*perBatch;i++){const start=performance.now();await measureTraffic(db,p,kind,date);if(i>=warmup)latencies.push((performance.now()-start)*1000);}
    assert.equal(counter()-startValue,warmup+batches*perBatch);
    assert.equal(prepares-beforePrepares,warmup+batches*perBatch);
    assert.equal(runs-beforeRuns,warmup+batches*perBatch);assert.equal(changes-beforeChanges,runs-beforeRuns);
    const sql=kind==='counted'?countedSQL:excludedSQL,binds=kind==='counted'?['2026-11-01',p]:['2026-11-01',1,0,now,p];
    const details=plan(traffic,sql,binds);assert.deepEqual(scans(details),[]);
    result.traffic.push({kind,...summary(latencies),prepares:prepares-beforePrepares,runs:runs-beforeRuns,rowsChanged:changes-beforeChanges,plan:details});
   }
   report.datasets.push(result);
  }finally{current.close();oldHost.close();oldContact.close();traffic.close();}
 }
 console.log(JSON.stringify(report,null,2));
}finally{rmSync(directory,{recursive:true,force:true});}

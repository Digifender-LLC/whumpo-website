// WH-004 slice 2 regression: cross-project and cross-visitor refusal through the mounted visitor gateway
// (applicationGateway, as the whumpo-apps Worker calls it), plus its shared host/query/method/Sec-Fetch-Site and
// API_LIMITER gates. Local D1, synthetic visitors and a stub runtime; no network or provider.
// Closes evidence gaps recorded in docs/boundary-audit.json (previously asserted only at domain-function level).
import assert from 'node:assert/strict';
import {deletionFixture} from './visitor-deletion-fixture.mjs';

const f=await deletionFixture(),{db,modules,id,app,visitor,env}=f;
const host=project=>`https://app-${project}.whumpo.site`;
function request(project,path,{method='GET',body,session='',cookieProject=project,headers={},origin=host(project),overrides={}}={}){
 return modules.applicationGateway(new Request(host(project)+'/'+path,{method,headers:{...(origin?{origin}:{}),'content-type':'application/json',cookie:`__Host-whumpo-app-session-${cookieProject}=${session}`,'cf-connecting-ip':'198.51.100.20',...headers},body:body===undefined?undefined:JSON.stringify(body)}),{...env,...overrides});
}
try{
 const a=await app(),b=await app();
 const v=await visitor(a),c=await visitor(b);
 // V writes data in A with a known operation ID, so a receipt exists.
 const op=id();
 const saved=await request(a.project,'data',{method:'POST',session:v.session,body:{id:op,revision:0,pageId:a.page,input:{note:'private A note'}}});
 assert.equal(saved.status,200,'positive control: V saves in A');
 assert.equal((await request(a.project,'receipts/'+op,{session:v.session})).status,200,'positive control: V reads its own receipt');
 // V's session presented on B's host under B's cookie name: no data, export, receipt or deletion review.
 for(const [path,method,body] of [['data','GET'],['export','GET'],['receipts/'+op,'GET'],['account/deletion-review','POST',{}]]){
  const response=await request(b.project,path,{method,body,session:v.session}),text=await response.text();
  assert.ok([401,404].includes(response.status),`${method} ${path} with A's session on B: ${response.status}`);
  assert.ok(!text.includes('private A note'));
 }
 // A's cookie name on B's host yields no token at all.
 assert.equal((await request(b.project,'data',{session:v.session,cookieProject:a.project})).status,401);
 // C, a visitor of B, cannot read V's receipt on B's host or on A's host with its B session.
 assert.equal((await request(b.project,'receipts/'+op,{session:c.session})).status,404);
 assert.ok([401,404].includes((await request(a.project,'receipts/'+op,{session:c.session,cookieProject:a.project})).status));
 // Shared gateway gates (each enforced before any handler).
 assert.equal((await request(a.project,'data?x=1',{session:v.session})).status,400,'query string');
 assert.equal((await request(a.project,'data',{method:'PUT',session:v.session,body:{}})).status,405,'method');
 assert.equal((await request(a.project,'data',{session:v.session,origin:null,headers:{'sec-fetch-site':'cross-site'}})).status,403,'Sec-Fetch-Site cross-site');
 assert.equal((await request(a.project,'data',{session:v.session,origin:null,headers:{'sec-fetch-site':'same-origin'}})).status,200,'positive control: same-origin GET without Origin');
 assert.equal((await request(a.project,'data',{session:v.session,overrides:{API_LIMITER:{limit:async()=>({success:false})}}})).status,429,'API_LIMITER');
 assert.equal((await modules.applicationGateway(new Request(`https://app-${a.project}.whumpo.com/data`,{headers:{cookie:`__Host-whumpo-app-session-${a.project}=${v.session}`}}),env)).status,404,'foreign host');
 // A stale page ID is refused before any run is admitted.
 const runs=async()=>(await db.prepare('SELECT count(*) n FROM app_runs WHERE visitor_id=?').bind(v.who).first()).n,before=await runs();
 assert.equal((await request(a.project,'data',{method:'POST',session:v.session,body:{id:id(),revision:1,pageId:id(),input:{note:'stale page'}}})).status,409,'stale pageId');
 assert.equal(await runs(),before);
 console.log('Visitor gateway isolation: another project\'s session/cookie name, another visitor\'s receipt, query strings, other methods, cross-site Sec-Fetch-Site, the API limiter, a foreign host and a stale page ID are all refused over HTTP.');
}finally{await f.close();}

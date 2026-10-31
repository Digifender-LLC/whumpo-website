import assert from 'node:assert/strict';
import {deletionFixture} from './visitor-deletion-fixture.mjs';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
Error.stackTraceLimit=Number(process.env.TRACE??0);
// WH-214: the visitor-origin notification routes (address, verification, staff opt-in) through the mounted visitor gateway, on SQLite or, with --d1,
// actual local D1. Synthetic projects and visitors only. The provider is simulated: the delivery lane runs against a stub sender that records what it
// was given, nothing is sent, and NOTIFICATION_CUSTOMER_CEILING_CENTS is set only inside this test's request environment (the suite asserts no tracked
// wrangler file sets it). Covers own-address-only, two-tenant isolation, foreign Origin and cookie refusal, no address in any response, replay,
// stale and rate-limit cases, consent and revocation.
const d1=process.argv.includes('--d1'),f=await deletionFixture({d1}),{db,id,app,visitor}=f,m=await currentSiteFixtureHandlers(),O=m.notificationOutbox,R=m.notificationRecipients;
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No network call is permitted');};
const run=(sql,...v)=>db.prepare(sql).bind(...v).run(),one=async(sql,...v)=>{const r=await db.prepare(sql).bind(...v).first();return r&&{...r}};
const sha256=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
const host=a=>`https://app-${a.project}.whumpo.site`,ceiling={NOTIFICATION_CUSTOMER_CEILING_CENTS:'500'};
const bodies=[],secrets=new Set(),refused='That address cannot receive notices from Whumpo.';
let cases=0,ip=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
/** One request through the mounted gateway. `body` makes it a POST. Every response body is kept for the no-address sweep. */
async function go(a,v,path,{body,origin=host(a),headers={},overrides={},db:use=db,cookieProject=a.project,url=host(a)+'/'+path,keep=true}={}){
 const response=await m.appGateway.applicationGateway(new Request(url,{method:body===undefined?'GET':'POST',headers:{...(origin?{origin}:{}),'content-type':'application/json','cf-connecting-ip':`198.51.100.${(ip++%200)+1}`,cookie:`__Host-whumpo-app-session-${cookieProject}=${v?.session??''}`,...headers},body:body===undefined?undefined:JSON.stringify(body)}),{...f.env,DB:use,...overrides});
 const text=await response.text();if(keep)bodies.push(text);
 let json=null;try{json=JSON.parse(text);}catch{}
 return {status:response.status,text,json};
}
const N='account/notifications/',P=s=>s?N+s:'account/notifications',steps=[['',undefined],['address',{address:'x@example.test'}],['address/remove',{}],['verify/start',{}],['verify/complete',{code:'AAAAAAAA'}],['staff/opt-in',{}],['staff/opt-out',{}]];
const snap=async()=>JSON.stringify([(await db.prepare('SELECT visitor_id,address,code_hash,code_expires_at,code_failures,verified_at FROM visitor_notification_addresses ORDER BY visitor_id').all()).results,
 (await db.prepare('SELECT instance_id,visitor_id FROM staff_notification_optins ORDER BY visitor_id').all()).results,(await one('SELECT count(*) n FROM notification_notices')).n]);
const row=visitorId=>one('SELECT * FROM visitor_notification_addresses WHERE visitor_id=?',visitorId);
const notices=async visitorId=>(await db.prepare("SELECT state,reason,sent_to,template FROM notification_notices WHERE recipient_key=? ORDER BY created_at").bind('submitter:'+visitorId).all()).results;
// The simulated provider: records the notice the lane hands it and accepts it. No message exists.
const sent=[],sender=async notice=>{sent.push({...notice});return {accepted:true,providerRef:'sim-'+sent.length};};
const deliver=async(cents=500)=>{for(let i=0;i<3;i++)await O.runNotificationDelivery(db,{provider:'cloudflare-email',review:'r',sendCeiling:1000,...(cents===null?{}:{customerCeilingCents:cents})},sender,{now:new Date()});};
const code=()=>sent.at(-1).verificationCode;
const address=async(a,v,value)=>{secrets.add(value);return go(a,v,N+'address',{body:{address:value}});};
// A verified address through the real path: start, deliver by the simulated provider, complete with the delivered code.
async function verified(a,v,value){
 assert.equal((await address(a,v,value)).status,200);
 assert.equal((await go(a,v,N+'verify/start',{body:{},overrides:ceiling})).json.status,'queued');await deliver();

 const done=await go(a,v,N+'verify/complete',{body:{code:sent.findLast(n=>n.recipient===value).verificationCode}});assert.equal(done.status,200);assert.equal(done.json.verified,true);
}
// Seeding a staff grant writes the row the reviewed Chat path writes; that path is off for the seed and restored after.
const roleTrigger=await one("SELECT sql FROM sqlite_master WHERE name='module_access_role_insert'");
// The caps cases leave codes queued behind the ones later cases wait for; cancel them as the lane would (a queued notice may be cancelled).
const dropQueued=()=>run("UPDATE notification_notices SET state='cancelled',reason='expired',outcome_at=? WHERE state='queued' AND event_ref GLOB 'verify:*'",Date.now());
const journalAttempts=async v=>(await one('SELECT j.attempt a FROM job_journal j JOIN notification_notices n ON n.job_id=j.id WHERE n.recipient_key=? ORDER BY n.created_at DESC LIMIT 1','submitter:'+v.who)).a;
const grant=async(a,v)=>{await run('DROP TRIGGER module_access_role_insert');try{await run("INSERT INTO module_access_roles(instance_id,visitor_id,project_id,role,state,review_id,access_revision,granted_at,updated_at) SELECT access_id,id,project_id,'staff','granted',?,1,unixepoch(),unixepoch() FROM app_visitors WHERE id=?",id(),v.who);}finally{await run(roleTrigger.sql);}};
try{
 const a=await app(),b=await app(),a1=await visitor(a),a2=await visitor(a),a3=await visitor(a),a4=await visitor(a),b1=await visitor(b);
 const ALICE='alice@example.test',BOB='bob@example.test';
 // Containment and serving stops are views over operator tables; the fixture swaps in one table it can fill.
 await run('CREATE TABLE fx_contained(project_id TEXT,scope TEXT)');await run('DROP VIEW operator_serving_stopped');await run('DROP VIEW operator_contained_projects');
 await run('CREATE VIEW operator_contained_projects AS SELECT project_id,scope FROM fx_contained');await run("CREATE VIEW operator_serving_stopped AS SELECT DISTINCT project_id FROM fx_contained WHERE scope='serving'");

 await check('every step needs a session; nothing is stored',async()=>{
  const before=await snap();
  for(const [step,body] of steps){
   const r=await go(a,null,P(step),{body});assert.equal(r.status,401,step);
   const wrong=await go(a,{session:'0'.repeat(64)},P(step),{body});assert.equal(wrong.status,401,step);
  }
  assert.equal(await snap(),before);
 });

 await check('a visitor sets, reads, changes and removes only their own address, and the response is a hint',async()=>{
  const r=await address(a,a1,' Alice@Example.test ');assert.equal(r.status,200);
  assert.deepEqual(r.json,{address:'a***@e***.test',verified:false,codePending:false,staffRole:false,staffOptIn:false,deliveryAvailable:false,stopped:false});
  assert.equal((await row(a1.who)).address,ALICE);
  assert.deepEqual((await go(a,a1,'account/notifications')).json,r.json);
  assert.equal((await go(a,a2,'account/notifications')).json.address,null,'another visitor of the same project sees nothing of it');
  assert.equal((await address(a,a1,'bob.alt@example.test')).json.address,'b***@e***.test');
  assert.equal((await row(a1.who)).address,'bob.alt@example.test');
  const removed=await go(a,a1,N+'address/remove',{body:{}});assert.equal(removed.status,200);assert.equal(removed.json.address,null);assert.equal(await row(a1.who),null);
  assert.equal((await go(a,a1,N+'address/remove',{body:{}})).status,200,'removing twice is harmless');
  assert.equal((await address(a,a1,ALICE)).status,200);
 });

 await check('a body can carry only the one field its step names; authority fields are refused and change nothing',async()=>{
  const before=await snap();
  for(const [step,extra] of [['address',{visitorId:a2.who}],['address',{projectId:b.project}],['address/remove',{visitorId:a2.who}],['verify/start',{visitorId:a2.who}],['verify/complete',{instanceId:id()}],['staff/opt-in',{instanceId:id()}],['staff/opt-out',{visitorId:a2.who}],['staff/opt-in',{role:'staff'}]]){
   const base=Object.fromEntries(Object.entries(steps.find(s=>s[0]===step)[1]).map(([k,v])=>[k,v]));
   const r=await go(a,a1,P(step),{body:{...base,...extra},overrides:ceiling});assert.equal(r.status,400,step+JSON.stringify(extra));
  }
  for(const [step,body] of [['address',{}],['verify/complete',{}],['address',{address:5}],['address',{address:'not an address'}],['address',{address:'a@b'}],['verify/complete',{code:5}]]){const r=await go(a,a1,P(step),{body});assert.ok([400].includes(r.status),step+JSON.stringify(body)+r.status);}
  assert.equal(await snap(),before);
 });

 await check('two tenants: the same address in another project is a different row; neither reaches or reveals the other',async()=>{
  assert.equal((await address(b,b1,ALICE)).status,200);
  assert.equal((await row(b1.who)).address,ALICE);
  assert.equal((await row(a1.who)).address,ALICE);
  // The session of one project at the other project's host and cookie name finds no visitor there.
  const before=await snap();
  for(const [step,body] of steps){
   assert.equal((await go(b,a1,P(step),{body})).status,401,'A session at B: '+step);
   assert.equal((await go(a,b1,P(step),{body})).status,401,'B session at A: '+step);
   assert.equal((await go(b,a1,P(step),{body,cookieProject:a.project})).status,401,'A cookie name at B: '+step);
   assert.equal((await go(b,{session:b1.session},P(step),{body,cookieProject:a.project})).status,401,'B token under A cookie name at B: '+step);
  }
  assert.equal(await snap(),before);
  await go(b,b1,N+'address/remove',{body:{}});assert.equal((await row(a1.who)).address,ALICE,'removing in B leaves A');assert.equal(await row(b1.who),null);
  assert.deepEqual((await R.notificationRecipients(db,b.project)).map(r=>r.address),[]);
  assert.equal((await address(b,b1,ALICE)).status,200);
 });

 await check('foreign Origin, missing Origin, cross-site and the owner origin are refused on every route and store nothing',async()=>{
  const before=await snap();
  for(const [step,body] of steps){
   assert.equal((await go(a,a1,P(step),{body,origin:'https://foreign.test',overrides:ceiling})).status,403,'foreign '+step);
   assert.equal((await go(a,a1,P(step),{body,origin:host(b),overrides:ceiling})).status,403,"another project's origin "+step);
   assert.equal((await go(a,a1,P(step),{body,origin:'https://whumpo.com',overrides:ceiling})).status,403,'owner origin as Origin '+step);
   assert.equal((await go(a,a1,P(step),{body,headers:{'sec-fetch-site':'cross-site'},overrides:ceiling})).status,403,'cross-site '+step);
   // The apps path on the owner origin is not an application host at all.
   assert.equal((await go(a,a1,P(step),{body,origin:'https://whumpo.com',url:`https://whumpo.com/apps/${a.project}/${P(step)}`,overrides:ceiling})).status,404,'owner host '+step);
   assert.equal((await go(a,a1,P(step),{body,url:`https://app-${b.project}.whumpo.site/${P(step)}`,overrides:ceiling})).status,403,"another project's host with this project's origin "+step);
  }
  for(const [step,body] of steps.slice(1))assert.equal((await go(a,a1,P(step),{body,origin:null,overrides:ceiling})).status,403,'no Origin '+step);
  assert.equal(await snap(),before);
 });

 await check('the step set is closed: unknown paths, wrong methods, queries and bodies are refused',async()=>{
  for(const path of [N+'other',N+'address/extra',N+'verify',N+'staff',N.slice(0,-1)+'/',N+'..']){assert.equal((await go(a,a1,path,{body:{}})).status,404,path);assert.equal((await go(a,a1,path)).status,404,path);}
  assert.equal((await go(a,a1,N+'address')).status,404,'GET on a POST step');
  assert.equal((await go(a,a1,'account/notifications',{body:{}})).status,404,'POST on the state read');
  assert.equal((await go(a,a1,'account/notifications?x=1')).status,400);
  const wrongType=await m.appGateway.applicationGateway(new Request(host(a)+'/'+N+'address',{method:'POST',headers:{origin:host(a),'content-type':'text/plain',cookie:`__Host-whumpo-app-session-${a.project}=${a1.session}`},body:'x'}),{...f.env,DB:db});
  assert.equal(wrongType.status,415);
 });

 await check('with no spending limit, verification answers delivery_unavailable, queues nothing and stores no code',async()=>{
  const r=await go(a,a1,N+'verify/start',{body:{}});
  assert.equal(r.status,200);assert.equal(r.json.status,'delivery_unavailable');assert.equal(r.json.deliveryAvailable,false);
  for(const bad of ['0','','-5','1e3','abc'])assert.equal((await go(a,a1,N+'verify/start',{body:{},overrides:{NOTIFICATION_CUSTOMER_CEILING_CENTS:bad}})).json.status,'delivery_unavailable','limit '+JSON.stringify(bad));
  assert.equal((await one('SELECT count(*) n FROM notification_notices')).n,0);assert.equal((await row(a1.who)).code_hash,null);
  assert.equal((await go(a,a1,N+'verify/complete',{body:{code:'ABCD2345'}})).status,400,'no code exists to complete');
  assert.equal((await go(a,null,N+'verify/start',{body:{},overrides:ceiling})).status,401);
  assert.equal((await go(a,a3,N+'verify/start',{body:{}})).status,404,'no address yet');
 });

 await check('with a limit set the code goes through the outbox; the simulated provider gets it once and only its hash is stored',async()=>{
  const first=await go(a,a1,N+'verify/start',{body:{},overrides:ceiling});
  assert.equal(first.status,200);assert.equal(first.json.status,'queued');assert.equal(first.json.deliveryAvailable,true);
  assert.equal(first.text.includes('ABCD'),false);assert.equal((await row(a1.who)).code_hash,null,'no code is stored until the attempt is claimed');
  assert.equal((await go(a,a1,N+'verify/start',{body:{},overrides:ceiling})).json.status,'pending','a second request while one is open queues nothing');
  assert.equal((await one('SELECT count(*) n FROM notification_notices')).n,1);
  assert.equal(sent.length,0,'nothing is sent until the lane runs');
  await deliver();
  assert.equal(sent.length,1);
  assert.deepEqual([sent[0].recipient,sent[0].template,sent[0].kind,sent[0].projectId],[ALICE,'visitor.address-verification@1','verification',a.project]);
  assert.match(code(),/^[A-Z2-9]{8}$/);
  const stored=await row(a1.who);assert.equal(stored.code_hash,await sha256(code()));assert.ok(stored.code_expires_at>Math.floor(Date.now()/1000)&&stored.code_expires_at<=Math.floor(Date.now()/1000)+3601);
  assert.deepEqual((await notices(a1.who)).map(n=>[n.state,n.sent_to]),[['accepted',ALICE]]);
  assert.equal((await go(a,a1,'account/notifications')).json.codePending,true);
  assert.equal(JSON.stringify(await one('SELECT * FROM notification_notices')).includes(code()),false,'the code is in no notice row');
 });

 await check('a wrong code, a replayed code and a stale code are refused; the right code verifies once',async()=>{
  const good=code();
  assert.equal((await go(a,a1,N+'verify/complete',{body:{code:'AAAAAAAA'}})).status,400);assert.equal((await row(a1.who)).code_failures,1);
  assert.equal((await go(a,a2,N+'verify/complete',{body:{code:good}})).status,400,"another visitor's code does not work for a visitor without an address");
  await address(a,a2,BOB);assert.equal((await go(a,a2,N+'verify/complete',{body:{code:good}})).status,400,"the code is for one visitor's address only");
  const ok=await go(a,a1,N+'verify/complete',{body:{code:good.toLowerCase()}});assert.equal(ok.status,200);assert.equal(ok.json.verified,true);assert.equal(ok.json.codePending,false);
  assert.equal((await row(a1.who)).code_hash,null);
  assert.equal((await go(a,a1,N+'verify/complete',{body:{code:good}})).status,400,'a used code is not reusable');
  assert.equal((await go(a,a1,N+'verify/start',{body:{},overrides:ceiling})).status,409,'already verified');
  assert.equal((await address(a,a1,ALICE.toUpperCase())).json.verified,true,'saving the same address again keeps it verified');
  assert.deepEqual((await R.notificationRecipients(db,a.project)).map(r=>[r.scope,r.address]),[]);
  // Expiry: a code past its hour is refused.
  await address(a,a3,'carol@example.test');await go(a,a3,N+'verify/start',{body:{},overrides:ceiling});await deliver();const late=code();
  await run('UPDATE visitor_notification_addresses SET code_expires_at=unixepoch()-1 WHERE visitor_id=?',a3.who);
  assert.equal((await go(a,a3,N+'verify/complete',{body:{code:late}})).status,400);assert.equal((await row(a3.who)).verified_at,null);
  // A changed address drops the code and the verification.
  await address(a,a3,'carol.two@example.test');const changed=await row(a3.who);assert.equal(changed.code_hash,null);
  assert.equal((await go(a,a3,N+'verify/complete',{body:{code:late}})).status,400);
 });

 await check('five wrong codes lock the code; a new request issues a new one',async()=>{
  await address(a,a2,BOB);await go(a,a2,N+'verify/start',{body:{},overrides:ceiling});await deliver();const first=code();
  for(let i=0;i<5;i++)assert.equal((await go(a,a2,N+'verify/complete',{body:{code:'ZZZZZZZZ'}})).status,400);
  assert.equal((await row(a2.who)).code_failures,5);
  assert.equal((await go(a,a2,N+'verify/complete',{body:{code:first}})).status,400,'the right code no longer works after five tries');
  await go(a,a2,N+'verify/start',{body:{},overrides:ceiling});await deliver();assert.notEqual(code(),first);assert.equal((await row(a2.who)).code_failures,0);
  assert.equal((await go(a,a2,N+'verify/complete',{body:{code:first}})).status,400,'the replaced code is dead');
  assert.equal((await go(a,a2,N+'verify/complete',{body:{code:code()}})).json.verified,true);
 });

 await check('rate limits: the per-IP and sign-in limiters refuse (verification and address steps), and the per-visitor hourly cap stops a fourth code',async()=>{
  const before=await snap(),no={limit:async()=>({success:false})};
  for(const [step,body] of steps)assert.equal((await go(a,a1,P(step),{body,overrides:{API_LIMITER:no,...ceiling}})).status,429,'API '+step);
  assert.equal((await go(a,a4,N+'verify/start',{body:{},overrides:{AUTH_LIMITER:no,...ceiling}})).status,429);
  assert.equal((await go(a,a1,N+'verify/complete',{body:{code:'AAAAAAAA'},overrides:{AUTH_LIMITER:no}})).status,429);
  assert.equal((await go(a,a1,N+'address',{body:{address:ALICE},overrides:{AUTH_LIMITER:no}})).status,429,'the address step can be probed (suppression, owner mailbox), so it is bounded too');
  assert.equal((await go(a,a1,N+'staff/opt-out',{body:{},overrides:{AUTH_LIMITER:no}})).status,200,'the sign-in limiter bounds only address and verification steps');
  assert.equal(await snap(),before);
  for(let i=0;i<3;i++){await address(a,a4,`dave${i}@example.test`);assert.equal((await go(a,a4,N+'verify/start',{body:{},overrides:ceiling})).json.status,'queued','request '+i);await deliver();}
  await address(a,a4,'dave3@example.test');
  const capped=await go(a,a4,N+'verify/start',{body:{},overrides:ceiling});assert.equal(capped.status,429);assert.equal((await notices(a4.who)).length,3);
 });

 // ---- The delivery lane re-reads everything at send time. Each case queues a real notice through the route, changes one fact, and runs the lane. ----
 const lane={provider:'cloudflare-email',review:'r',sendCeiling:1000,customerCeilingCents:500};
 // Runs the lane once; `hook` fires between the lane's read of the notice and its claim (the claim batch is the only four-statement batch it issues).
 const laneRace=async(hook,settings=lane)=>{let fired=false;const raced=new Proxy(db,{get(t,k){if(k==='batch')return async s=>{if(hook&&!fired&&s.length===4){fired=true;await hook();}return t.batch(s);};const v=t[k];return typeof v==='function'?v.bind(t):v;}});
  for(let i=0;i<3;i++)await O.runNotificationDelivery(raced,settings,sender,{now:new Date()});return fired;};
 let fresh=0;const queued=async(addressValue)=>{const v=await visitor(a);await address(a,v,addressValue??`lane${++fresh}@example.test`);assert.equal((await go(a,v,N+'verify/start',{body:{},overrides:ceiling})).json.status,'queued');return v;};
 const last=async v=>(await notices(v.who)).at(-1);
 const attempts=async v=>(await one('SELECT attempts,dispatched_at FROM notification_notices WHERE recipient_key=?','submitter:'+v.who));
 const nothingSent=async(v,reason,hook,settings)=>{const before=sent.length;await laneRace(hook,settings);assert.equal(sent.length,before,'nothing is sent');const n=await last(v);assert.deepEqual([n.state,n.reason],['cancelled',reason]);assert.equal((await row(v.who))?.code_hash??null,null,'no code is stored');};

 await check('the lane sends nothing while the owner limit is unset',async()=>{const v=await queued();await nothingSent(v,'ceiling-unset',null,{...lane,customerCeilingCents:undefined});assert.equal((await attempts(v)).attempts,0);});
 await check('the lane stops for an address removed, suppressed, verified, a revoked visitor, a contained project or a serving stop, before any attempt',async()=>{
  let v=await queued();await go(a,v,N+'address/remove',{body:{}});await nothingSent(v,'recipient-revoked');assert.equal((await attempts(v)).attempts,0);
  v=await queued();await run('INSERT INTO contact_notification_suppressions(user_id,address,reason,created_at) VALUES(?,?,?,?)',a.user,(await row(v.who)).address,'bounce',new Date().toISOString());await nothingSent(v,'suppressed');assert.equal((await attempts(v)).attempts,0);
  v=await queued();await run("UPDATE visitor_notification_addresses SET code_hash=?,code_expires_at=unixepoch()+600 WHERE visitor_id=?",await sha256('ABCD2345'),v.who);await run('UPDATE visitor_notification_addresses SET verified_at=unixepoch(),code_hash=NULL,code_expires_at=NULL WHERE visitor_id=?',v.who);
  await nothingSent(v,'recipient-revoked');assert.equal((await journalAttempts(v)),0,'an already verified address is stopped before the attempt is begun');
  v=await queued();await run('UPDATE app_visitors SET revoked=1 WHERE id=?',v.who);await nothingSent(v,'recipient-revoked');assert.equal((await journalAttempts(v)),0);
  for(const scope of ['contact','serving']){
   v=await queued();await run('INSERT INTO fx_contained VALUES(?,?)',a.project,scope);await nothingSent(v,'contained');assert.equal((await journalAttempts(v)),0,scope);await run('DELETE FROM fx_contained');
  }
 });
 await check('races: an address removed, changed or verified between the lane read and its claim is never sent to, and the notice is cancelled, not left queued',async()=>{
  let v=await queued();await nothingSent(v,'recipient-revoked',()=>go(a,v,N+'address/remove',{body:{}}));
  assert.equal((await go(a,v,N+'verify/start',{body:{},overrides:ceiling})).status,404,'no address to verify');
  v=await queued();const old=(await row(v.who)).address;await nothingSent(v,'recipient-revoked',()=>address(a,v,'moved'+fresh+'@example.test'));assert.notEqual((await row(v.who)).address,old);
  assert.equal((await go(a,v,N+'verify/start',{body:{},overrides:ceiling})).json.status,'queued','a cancelled notice is not "pending"');
  await go(a,v,N+'address/remove',{body:{}});await laneRace(null);
  v=await queued();await nothingSent(v,'recipient-revoked',async()=>{await run("UPDATE visitor_notification_addresses SET code_hash=?,code_expires_at=unixepoch()+600 WHERE visitor_id=?",await sha256('ABCD2345'),v.who);await run('UPDATE visitor_notification_addresses SET verified_at=unixepoch(),code_hash=NULL,code_expires_at=NULL WHERE visitor_id=?',v.who);});
  assert.ok((await row(v.who)).verified_at,'the race left the address verified and its code untouched');
 });

 await check('caps: three codes a day to one address across every owner, and the count survives removing the address',async()=>{
  const target='target.cap@example.test',owners=[a,b],visitors=[];
  for(let i=0;i<4;i++){const v=await visitor(owners[i%2]);visitors.push([owners[i%2],v]);await go(owners[i%2],v,N+'address',{body:{address:target}});secrets.add(target);}
  for(const [app_,v] of visitors.slice(0,3))assert.equal((await go(app_,v,N+'verify/start',{body:{},overrides:ceiling})).json.status,'queued');
  const fourth=visitors[3];assert.equal((await go(fourth[0],fourth[1],N+'verify/start',{body:{},overrides:ceiling})).status,429,'the fourth owner-visitor is refused for the same address');
  await deliver();
  // Sent, then removed: sent_to is erased with the address, and the cap still holds.
  for(const [app_,v] of visitors.slice(0,3)){await go(app_,v,N+'address/remove',{body:{}});}
  assert.ok((await db.prepare("SELECT sent_to FROM notification_notices WHERE event_ref GLOB 'verify:*'").all()).results.every(r=>r.sent_to!==target));
  await go(fourth[0],fourth[1],N+'address/remove',{body:{}});await go(fourth[0],fourth[1],N+'address',{body:{address:target}});
  assert.equal((await go(fourth[0],fourth[1],N+'verify/start',{body:{},overrides:ceiling})).status,429,'removing and re-adding the address does not reset the cap');
  assert.notEqual((await go(fourth[0],fourth[1],N+'address',{body:{address:'different.cap@example.test'}})).status,0);
  assert.equal((await go(fourth[0],fourth[1],N+'verify/start',{body:{},overrides:ceiling})).json.status,'queued','another address is not affected');
  await dropQueued();
 });
 await check('caps: one owner is limited to 50 codes a day however many visitors it has, and other owners are not affected',async()=>{
  const c=await app();let refusedAt=0;
  for(let i=1;i<=52&&!refusedAt;i++){const v=await visitor(c);await address(c,v,`bulk${i}@example.test`);const r=await go(c,v,N+'verify/start',{body:{},overrides:ceiling});if(r.status===429)refusedAt=i;else assert.equal(r.json.status,'queued');}
  assert.equal(refusedAt,51,'the 51st code of one owner is refused');
  const other=await visitor(a);await address(a,other,'bulk.other@example.test');assert.equal((await go(a,other,N+'verify/start',{body:{},overrides:ceiling})).json.status,'queued');
  await dropQueued();
 });
 await check('caps: five codes in a day per visitor, spaced beyond the hourly cap',async()=>{
  const v=await visitor(a),now=Date.now();
  for(let i=0;i<5;i++){await address(a,v,`spread${i}@example.test`);const r=await R.startVisitorVerification(db,a.project,v.who,{ceilingCents:500,now:now-(5-i)*4*3600000});assert.equal(r.status,'queued',String(i));await deliver();}
  await address(a,v,'spread5@example.test');
  await assert.rejects(R.startVisitorVerification(db,a.project,v.who,{ceilingCents:500,now}),e=>e.status===429,'the sixth in a day is refused');
 });
 await check('the owner\'s own mailboxes and suppressed addresses are refused at address with a fixed message',async()=>{
  const v=await visitor(a),email=(await one('SELECT email FROM users WHERE id=?',a.user)).email;
  assert.equal((await address(a,v,email.toUpperCase())).status,409);
  const d=id();await run('INSERT INTO contact_notification_destinations(id,user_id,project_id,address,created_at) VALUES(?,?,?,?,?)',d,a.user,a.project,'owner.inbox@example.test',new Date().toISOString());
  const r=await address(a,v,'owner.inbox@example.test');assert.equal(r.status,409);assert.equal(r.json.error,'That address cannot receive notices from Whumpo.');
  assert.equal(await row(v.who),null,'nothing stored');
  assert.equal((await go(a,v,N+'address',{body:{address:'owner.inbox@example.test'},overrides:{AUTH_LIMITER:{limit:async()=>({success:false})}}})).status,429,'the probe is bounded by the sign-in limiter');
 });

 await check('staff opt-in needs the role and a verified address, applies only to the caller, and ends with the address or the role',async()=>{
  assert.equal((await go(a,a1,N+'staff/opt-in',{body:{}})).status,403,'no staff role');
  await grant(a,a1);
  const state=await go(a,a1,'account/notifications');assert.equal(state.json.staffRole,true);assert.equal(state.json.staffOptIn,false);
  assert.equal((await go(a,a2,N+'staff/opt-in',{body:{}})).status,403,"a1's role is not a2's");
  const on=await go(a,a1,N+'staff/opt-in',{body:{}});assert.equal(on.status,200);assert.equal(on.json.staffOptIn,true);
  assert.equal((await go(a,a1,N+'staff/opt-in',{body:{}})).status,200,'opting in twice is harmless');
  assert.deepEqual((await R.notificationRecipients(db,a.project,'staff')).map(r=>[r.ref,r.address]),[[a1.who,ALICE]]);
  assert.equal((await go(a,a2,'account/notifications')).json.staffOptIn,false);
  assert.equal((await go(a,a2,N+'staff/opt-out',{body:{}})).json.staffOptIn,false);assert.equal((await R.notificationRecipients(db,a.project,'staff')).length,1,"a2's opt-out does not touch a1");
  const off=await go(a,a1,N+'staff/opt-out',{body:{}});assert.equal(off.json.staffOptIn,false);assert.equal((await R.notificationRecipients(db,a.project,'staff')).length,0);
  await go(a,a1,N+'staff/opt-in',{body:{}});
  // A different address drops the verification and with it the opt-in; removing it does too. A re-grant of the role opts nobody in.
  assert.equal((await address(a,a1,'alice.new@example.test')).json.staffOptIn,false);assert.equal((await R.notificationRecipients(db,a.project)).length,0);
  assert.equal((await go(a,a1,N+'staff/opt-in',{body:{}})).status,403,'unverified again');
  await verified(a,a1,ALICE);await go(a,a1,N+'staff/opt-in',{body:{}});
  await run("UPDATE module_access_roles SET state='revoked' WHERE visitor_id=? AND role='staff'",a1.who);
  assert.equal((await go(a,a1,'account/notifications')).json.staffOptIn,false,'role revocation removes the opt-in');
  assert.equal((await R.notificationRecipients(db,a.project,'staff')).length,0);
  await run("UPDATE module_access_roles SET state='granted' WHERE visitor_id=? AND role='staff'",a1.who);
  assert.equal((await go(a,a1,'account/notifications')).json.staffOptIn,false,'granting the role again does not opt in');
  await go(a,a1,N+'staff/opt-in',{body:{}});assert.equal((await go(a,a1,N+'address/remove',{body:{}})).json.staffOptIn,false);assert.equal((await R.notificationRecipients(db,a.project)).length,0);
  assert.equal((await one('SELECT count(*) n FROM staff_notification_optins WHERE visitor_id=?',a1.who)).n,0);
  assert.ok((await notices(a1.who)).every(n=>n.sent_to===null),'the last address a notice went to leaves with the address');
 });

 await check('consent withdrawal and reads stay available during a serving stop; setting, verifying and opting in do not',async()=>{
  const stopped=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>target.prepare(sql.replace('FROM operator_serving_stopped WHERE project_id=?','FROM (SELECT ? AS project_id)'));const v=target[key];return typeof v==='function'?v.bind(target):v;}});
  await verified(a,a1,'alice.stop@example.test');await go(a,a1,N+'staff/opt-in',{body:{}});
  const s={db:stopped};
  const paused=await go(a,a1,'account/notifications',s);assert.equal(paused.status,200);assert.equal(paused.json.stopped,true,'the page is told, so it can hide what would be refused');assert.equal((await go(a,a1,'account/notifications')).json.stopped,false);
  for(const [step,body] of [['address',{address:BOB}],['verify/start',{}],['verify/complete',{code:'AAAAAAAA'}],['staff/opt-in',{}]])assert.equal((await go(a,a1,P(step),{body,...s,overrides:ceiling})).status,404,step);
  assert.equal((await go(a,a1,N+'staff/opt-out',{body:{},...s})).json.staffOptIn,false);
  assert.equal((await go(a,a1,N+'address/remove',{body:{},...s})).json.address,null);assert.equal(await row(a1.who),null);
 });

 await check("a visitor's export carries only their own notification settings, never a code",async()=>{
  const a6=await visitor(a);await verified(a,a6,'gina@example.test');
  const read=async(who,v)=>{const r=await go(a,v,'export',{keep:false});assert.equal(r.status,200);return r.text;};
  const mine=JSON.parse(await read(a,a6));assert.deepEqual(mine.notifications,{address:'gina@example.test',verified:true,staffOptIn:false});
  assert.deepEqual(mine.notices.map(n=>[n.template,n.state,n.sentTo]),[['visitor.address-verification@1','accepted','gina@example.test']],'the address a notice went to is part of the visitor\'s own export');
  assert.equal(JSON.parse(await read(a,a2)).notices.some(n=>n.sentTo==='gina@example.test'),false);
  const theirs=await read(a,a2);assert.equal(theirs.includes('gina@example.test'),false);assert.equal(JSON.parse(theirs).notifications.address,BOB);
  assert.equal(JSON.parse(await read(a,a4)).notifications.verified,false);
  assert.equal(JSON.parse(await read(a,await visitor(a))).notifications,null);
  assert.equal((await go(a,b1,'export',{keep:false})).status,401);
  assert.equal(JSON.stringify(mine).includes('code'),false);
 });

 await check('the verification reserve: the lane never uses the last fifth of the platform ceiling',async()=>{
  // The ledger keeps the lowest ceiling any run applied for the day, so this runs last. S calls are counted in the 32-day window; a ceiling C gives the lane floor(0.8 C) of them.
  const S=(await one("SELECT coalesce(sum(sends),0) n FROM notification_send_ledger WHERE provider='cloudflare-email'")).n,ceilingFor=limit=>Math.ceil(limit/0.8);
  const v=await queued();await nothingSent(v,'ceiling',null,{...lane,sendCeiling:ceilingFor(S)});
  const w=await queued();const before=sent.length;await laneRace(null,{...lane,sendCeiling:ceilingFor(S+1)});assert.equal(sent.length,before+1,'one call under the reserve is sent');
 });

 await check('no response carries a full address (the visitor sees a hint of their own)',async()=>{
  assert.ok(bodies.length>150,String(bodies.length));
  for(const text of bodies)for(const secret of secrets)assert.equal(text.toLowerCase().includes(secret.trim().toLowerCase()),false,'a response carried '+secret+': '+text);
  for(const text of bodies)assert.equal(/[a-z0-9._-]+@[a-z0-9-]+\.[a-z]+/i.test(text),false,'an address-shaped value in a response: '+text);
 });

 console.log(`Visitor notification routes: ${cases} groups passed on ${d1?'local D1':'SQLite'} — session and body shape, own address only, two tenants, foreign Origin and cookie, owner origin, closed step set, delivery unavailable without a limit, outbox delivery to a simulated provider with a hash-only code, replay, stale, lockout and rate limits, staff opt-in and revocation, serving stop, export and no address in any response. Nothing was sent.`);
}finally{
 globalThis.fetch=originalFetch;await f.close();
}

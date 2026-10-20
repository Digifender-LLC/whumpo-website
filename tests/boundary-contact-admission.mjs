// WH-004 slice 8 regression: the two untested admission branches of the public contact form (src/contact-page.ts),
// recorded in docs/boundary-audit.json (public contact form, admission cell: "The per-IP 429 and missing-token branches
// are untested"). Local SQLite (default) or local D1 (`--d1`); synthetic account, no network.
//   1. Per-IP API_LIMITER refusal: GET, HEAD and POST answer 429 "Too many requests. Please try again later." with the
//      hardened page headers; the limiter key is `contact:<cf-connecting-ip>` (`contact:local` without the header); the
//      refusal happens before the per-client daily allowance is counted, before Siteverify and before anything is stored;
//      a cross-origin POST is refused (403) before the limiter is consulted.
//   2. Missing Turnstile token outside local: no field, an empty value or a value over 2,048 characters answers 400
//      "Complete verification before sending." without calling Siteverify and without storing a message. The attempt is
//      counted against the daily client allowance first (by design: "counted before verification").
// Negative controls: the identical POST with an admitting limiter is stored; a 2,048-character token reaches Siteverify
// unchanged and the message is stored. No expected-failure case: both branches behave as the source states.
import assert from 'node:assert/strict';
import {createFixtureProject,currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';

const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db;
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No network is allowed');};
// Fixture configuration values are built at runtime (no credential-shaped literals).
const fixtureValue=part=>['fixture',part].join('-');
let admit=true;const keys=[];
const limiter={limit:async({key})=>{keys.push(key);return {success:admit};}};
const env={DB:db,ENVIRONMENT:'test',TURNSTILE_SECRET:fixtureValue('turnstile'),TURNSTILE_SITE_KEY:fixtureValue('site'),API_LIMITER:limiter};
const scalar=async(sql,...values)=>Number((await db.prepare(sql).bind(...values).first()).n);
const tooMany='Too many requests. Please try again later.',noToken='Complete verification before sending.';
try{
 const actor=await workspaceFixture(db,m),scope=await actor.scope();
 await paidPlan(db,actor.account,'personal');
 const site=await createFixtureProject(scope,actor.account,'Admission studio','A synthetic website for contact admission checks.');
 // Published version with an enabled contact form (seeded rows, as tests/boundary-origin-routes.mjs does).
 await db.prepare('INSERT INTO publications(project_id,version_id,revision) VALUES(?,?,1)').bind(site.project,site.version).run();
 await db.prepare('INSERT INTO contact_settings(project_id,revision,enabled,publication_revision) VALUES(?,1,1,1)').bind(site.project).run();
 const target=await m.contacts.activeContact(db,site.project);
 assert.equal(Number(target?.revision),1,'fixture: the contact form is active');

 const url='https://whumpo.com/contact/'+site.project,origin='https://whumpo.com';
 let calls=0;const forwarded=[];
 const siteverify=async(_url,options)=>{calls++;forwarded.push(options.body.get('response'));return Response.json({success:true,hostname:'whumpo.com',action:'contact',cdata:site.project});};
 const fields=(extra={})=>({id:crypto.randomUUID(),revision:'1',name:'Synthetic visitor',email:'visitor@example.invalid',message:'Synthetic message for the admission check.',...extra});
 const withToken=(token=fixtureValue('token'))=>fields({'cf-turnstile-response':token});
 const request=(method,{ip,data,from=origin}={})=>new Request(url,{method,headers:{...(from===null?{}:{origin:from}),...(ip?{'cf-connecting-ip':ip}:{})},...(data?{body:new URLSearchParams(data)}:{})});
 const send=req=>m.contactPage(req,env,site.project,siteverify);
 const messages=()=>scalar('SELECT count(*) n FROM contact_submissions WHERE project_id=?',site.project);
 const uses=()=>scalar('SELECT coalesce(sum(uses),0) n FROM public_client_usage WHERE scope=? AND project_id=?','contact',site.project);
 const state=async()=>JSON.stringify({messages:await messages(),uses:await uses()});
 async function refusedWith(response,status,text,label){
  assert.equal(response.status,status,label);
  if(text)assert.ok((await response.text()).includes(text),`${label}: says "${text}"`);
  assert.equal(response.headers.get('cache-control'),'no-store',`${label}: not cached`);
  assert.equal(response.headers.get('x-frame-options'),'DENY',`${label}: not framed`);
 }

 // 1. Per-IP limiter refusal.
 admit=false;
 const before=await state();
 for(const method of ['GET','HEAD','POST']){
  keys.length=0;
  const response=await send(request(method,{ip:'198.51.100.40',data:method==='POST'?withToken():undefined}));
  await refusedWith(response,429,method==='HEAD'?undefined:tooMany,`limited ${method}`);
  assert.deepEqual(keys,['contact:198.51.100.40'],`limited ${method}: the limiter is keyed by the connecting address`);
 }
 keys.length=0;
 await refusedWith(await send(request('POST',{data:withToken()})),429,tooMany,'limited POST without cf-connecting-ip');
 assert.deepEqual(keys,['contact:local'],'without cf-connecting-ip the limiter uses the shared local bucket');
 assert.equal(calls,0,'a limited request never reaches Siteverify');
 assert.equal(await state(),before,'a limited request stores nothing and is not counted against the daily client allowance');
 keys.length=0;
 assert.equal((await send(request('POST',{ip:'198.51.100.40',data:withToken(),from:'https://evil.example'}))).status,403,'a cross-origin POST is refused');
 assert.deepEqual(keys,[],'the Origin check runs before the limiter is consulted');

 // Negative control: the same POST with an admitting limiter is stored.
 admit=true;
 assert.equal((await send(request('POST',{ip:'198.51.100.40',data:withToken()}))).status,200,'negative control: an admitted POST is accepted');
 assert.equal(calls,1,'negative control: the admitted POST was verified');
 assert.equal(await messages(),1,'negative control: the admitted POST stored one message');

 // 2. Missing Turnstile token (ENVIRONMENT is not local, so verification is required).
 calls=0;
 const stored=await messages(),counted=await uses();
 const missing=[['no cf-turnstile-response field',fields()],['an empty cf-turnstile-response',withToken('')],['a 2,049-character token',withToken('t'.repeat(2049))]];
 for(const [index,[label,data]] of missing.entries()){
  await refusedWith(await send(request('POST',{ip:'198.51.100.41',data})),400,noToken,`POST with ${label}`);
  assert.equal(await uses(),counted+index+1,`POST with ${label}: the attempt is counted before verification`);
 }
 assert.equal(calls,0,'a missing or oversized token never reaches Siteverify');
 assert.equal(await messages(),stored,'a missing or oversized token stores nothing');

 // Negative control: a token of exactly 2,048 characters is forwarded unchanged and the message is stored.
 const longest='t'.repeat(2048);
 assert.equal((await send(request('POST',{ip:'198.51.100.41',data:withToken(longest)}))).status,200,'negative control: a 2,048-character token is accepted');
 assert.deepEqual(forwarded.slice(-1),[longest],'negative control: the submitted token reached Siteverify unchanged');
 assert.equal(await messages(),stored+1,'negative control: the verified message is stored');

 console.log(`Contact admission on ${process.argv.includes('--d1')?'local D1':'SQLite'}: a per-IP limited GET, HEAD or POST answers 429 before the daily allowance, Siteverify or storage (keyed contact:<ip>, contact:local without the header, after the Origin check); a POST with no, an empty or an over-long Turnstile token answers 400 without Siteverify or storage (counted against the daily allowance first); the admitted and 2,048-character controls are stored.`);
}catch(error){console.error(String(error?.stack??error).split('\n').filter(line=>!line.includes('data:text/javascript')).join('\n'));process.exitCode=1;}
finally{globalThis.fetch=originalFetch;await store.close?.();}

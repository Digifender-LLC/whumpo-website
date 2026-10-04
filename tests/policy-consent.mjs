import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {currentSiteFixtureHandlers,createFixtureWebsite,changeFixtureWebsite} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
// WH-016 current policy consent: inert until a version is adopted, then required before publication/activation at the
// TypeScript entry points and at each final schema write; re-consent on every version change. SQLite by default, `--d1`.
Error.stackTraceLimit=0;
const d1=process.argv.includes('--d1');
const m=await currentSiteFixtureHandlers();
const built=await build({stdin:{contents:`export * as consent from './src/policy-consent.ts';export * as client from './frontend/src/lib/policy-consent.ts';`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {consent:k,client}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const fixture=await databaseFixture({d1}),{db}=fixture;
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
let checks=0;const ok=()=>checks++;
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}};
const api=async(owner,method,data)=>{const response=await m.worker.fetch(new Request('https://whumpo.com/api/policy-consent/v1',{method,headers:{origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+owner.token,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),env,{waitUntil(){}});return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};};
const digest=n=>String(n).repeat(64).slice(0,64);
const adopt=(version,sha,ago)=>run('INSERT INTO policy_adoptions(version,documents_sha256,adopted_at,adoption_ref) VALUES(?,?,unixepoch()-?,?)',version,sha,ago,'fixture-'+version);
async function owner(){
 const f=await workspaceFixture(db,m),scope=await f.scope(),project=crypto.randomUUID(),now=new Date().toISOString();
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden fixture','Testing','draft',?,?)",project,f.account,now,now);
 await m.readChat(scope,f.account);
 const chat=async content=>{const state=await m.readChat(scope,f.account),input={id:crypto.randomUUID(),revision:state.state.revision,content};const result=await m.sendChat(scope,f.account,input);const turn=await row('SELECT assistant_text FROM chat_turns WHERE id=?',input.id);return {id:input.id,result,reply:turn?.assistant_text??''};};
 let edits=0;
 const website=async()=>edits++?changeFixtureWebsite(scope,f.account,project,[{type:'content.replace',contentId:'headline',text:'Garden revision '+edits}],m)
  :createFixtureWebsite(scope,f.account,project,{name:'Garden',headline:'Garden',description:'Testing',theme:'ocean',aboutTitle:'About',aboutText:'Testing',sections:[],photos:[]},m);
 return {...f,scope,project,chat,website,live:async()=>(await row('SELECT version_id FROM publications WHERE project_id=?',project))?.version_id??null};
}
try{
 // ---- No adopted version: nothing to accept, and publication is not gated (the documents are still drafts).
 const a=await owner(),b=await owner();
 const empty=await api(a,'GET');assert.equal(empty.status,200);assert.equal(empty.cache,'no-store');assert.equal(empty.body.current,null);assert.equal(empty.body.accepted,false);ok();
 assert.equal(empty.body.documents.length,3);ok();
 assert.equal((await api(a,'POST',{version:1,policyVersion:'v1',documentsSha256:digest(1)})).body.code,'not_adopted');ok();
 const v0=await a.website(),r0=await a.chat('/publish '+v0);assert.equal((await a.chat('/confirm '+r0.id)).result.status,200);assert.equal(await a.live(),v0);ok();

 // ---- Adopt v1: publication now needs current consent. The route works before onboarding/Chat (identity only).
 await adopt('whumpo-policies-2026-10-01',digest(1),20);
 assert.equal(await k.policyConsentRequired(db,a.account),true);ok();
 const v1=await a.website();
 const refusedReview=await a.chat('/publish '+v1);assert.match(refusedReview.reply,/accept the current Whumpo Terms of Service, Acceptable Use Policy and Privacy Policy/);
 assert.equal(await row('SELECT 1 AS x FROM publication_actions WHERE id=?',refusedReview.id),null,'No review is created');assert.equal(await a.live(),v0);ok();
 // The final write refuses even when the TypeScript check is bypassed.
 await assert.rejects(()=>run('UPDATE publications SET version_id=? WHERE project_id=?',v1,a.project),/policy_consent_required/);ok();
 // Withdrawal always stays available without consent.
 const down=await a.chat('/unpublish '+a.project);assert.equal((await a.chat('/confirm '+down.id)).result.status,200);assert.equal(await a.live(),null);ok();
 // Other gates exist at every final write.
 const triggers=(await db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'policy_%' ORDER BY name").all()).results.map(t=>t.name);
 for(const name of ['policy_site_publication_insert','policy_site_publication_update','policy_backend_publication','policy_backend_publication_insert','policy_app_activation','policy_cms_publication'])assert.ok(triggers.includes(name),name);ok();
 const backend=crypto.randomUUID();await run("INSERT INTO backend_versions(id,project_id,source,digest,created_at) VALUES(?,?,'export default x=>x',?,'2026-10-04')",backend,a.project,'e'.repeat(64));
 await assert.rejects(()=>run("INSERT INTO backend_publications(project_id,revision,review_id,version_id) VALUES(?,0,'r',?)",a.project,backend),/policy_consent_required/);ok();

 // ---- Accept exactly the current version and digest.
 const view=(await api(a,'GET')).body;assert.equal(view.current.version,'whumpo-policies-2026-10-01');assert.equal(view.accepted,false);ok();
 for(const bad of [{version:1,policyVersion:'whumpo-policies-2026-10-01'},{version:2,policyVersion:'whumpo-policies-2026-10-01',documentsSha256:digest(1)},{version:1,policyVersion:'whumpo-policies-2026-10-01',documentsSha256:digest(1),extra:1},{version:1,policyVersion:'BAD VERSION',documentsSha256:digest(1)}])
  assert.equal((await api(a,'POST',bad)).status,400);ok();
 assert.equal((await api(a,'POST',{version:1,policyVersion:'whumpo-policies-2026-10-01',documentsSha256:digest(2)})).body.code,'policy_changed');ok();
 const accepted=await api(a,'POST',{version:1,policyVersion:view.current.version,documentsSha256:view.current.documentsSha256});
 assert.equal(accepted.status,200);assert.equal(accepted.body.accepted,true);ok();
 const replay=await api(a,'POST',{version:1,policyVersion:view.current.version,documentsSha256:view.current.documentsSha256});assert.equal(replay.body.acceptedAt,accepted.body.acceptedAt,'Exact retry is idempotent');ok();
 // Tenant isolation: A's consent does not cover B.
 assert.equal(await k.policyConsentRequired(db,a.account),false);assert.equal(await k.policyConsentRequired(db,b.account),true);ok();
 const rb=await b.chat('/publish '+await b.website());assert.match(rb.reply,/Terms of Service/);ok();
 const r1=await a.chat('/publish '+v1);assert.equal((await a.chat('/confirm '+r1.id)).result.status,200);assert.equal(await a.live(),v1);ok();

 // ---- A new version requires re-consent, including for a review prepared under the old one.
 const v2=await a.website(),r2=await a.chat('/publish '+v2);assert.ok(await row('SELECT 1 AS x FROM publication_actions WHERE id=?',r2.id));
 await adopt('whumpo-policies-2026-11-01',digest(3),10);
 const stale=await a.chat('/confirm '+r2.id);assert.match(stale.reply,/Terms of Service/);assert.equal(await a.live(),v1);ok();
 await assert.rejects(()=>run("UPDATE publication_actions SET status='applied',confirmed_by=? WHERE id=?",r2.id,r2.id),/policy_consent_required/,'The confirmation write itself refuses');assert.equal(await a.live(),v1);ok();
 assert.equal((await api(a,'POST',{version:1,policyVersion:view.current.version,documentsSha256:view.current.documentsSha256})).body.code,'policy_changed','The old version cannot be accepted again');ok();
 await assert.rejects(()=>run('INSERT INTO policy_consents(user_id,policy_version,documents_sha256,accepted_at) VALUES(?,?,?,unixepoch())',b.account,view.current.version,view.current.documentsSha256),/policy_version_stale/);ok();
 const current=(await api(a,'GET')).body;assert.equal(current.current.version,'whumpo-policies-2026-11-01');assert.equal(current.accepted,false);ok();
 await api(a,'POST',{version:1,policyVersion:current.current.version,documentsSha256:current.current.documentsSha256});
 // The owner page's client drives the same route (identity only; no Chat or AI) and accepts exactly what it read.
 const viaPage=(owner)=>(url,init)=>m.worker.fetch(new Request('https://whumpo.com'+url,{...init,headers:{...init.headers,origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+owner.token}}),env,{waitUntil(){}});
 const pageRead=await client.readPolicies(viaPage(b));assert.equal(pageRead.state,'ok');assert.equal(pageRead.value.accepted,false);
 assert.equal((await client.acceptPolicies(view.current,viaPage(b))).code,'policy_changed','The page cannot accept a version it did not read');
 const pageAccept=await client.acceptPolicies(pageRead.value.current,viaPage(b));assert.equal(pageAccept.state,'ok');assert.equal(pageAccept.value.accepted,true);ok();
 const page=await (await import('node:fs/promises')).readFile('frontend/src/policies.tsx','utf8');
 assert.ok(page.includes('readPolicies')&&page.includes('acceptPolicies')&&!/chat|sendAI/i.test(page.replace(/without Chat/g,'')),'Policies page is identity-only');
 assert.match(await (await import('node:fs/promises')).readFile('frontend/src/workspace.tsx','utf8'),/'\/workspace\/policies'\?<PoliciesPage\/>/);ok();
 const r3=await a.chat('/publish '+v2);assert.equal((await a.chat('/confirm '+r3.id)).result.status,200);assert.equal(await a.live(),v2);ok();

 // ---- Records are immutable; adoptions are ordered and retained; consent is separate from the US declaration.
 await assert.rejects(()=>run('UPDATE policy_consents SET accepted_at=0 WHERE user_id=?',a.account),/policy_consent_immutable/);ok();
 await assert.rejects(()=>run("UPDATE policy_adoptions SET adoption_ref='x'"),/policy_adoption_immutable/);ok();
 await assert.rejects(()=>run('DELETE FROM policy_adoptions'),/policy_adoption_immutable/);ok();
 await assert.rejects(()=>adopt('whumpo-policies-old',digest(4),1000),/policy_adoption_order/);ok();
 await assert.rejects(()=>adopt('whumpo-policies-future',digest(5),-1000),/policy_adoption_order/);ok();
 assert.equal((await row('SELECT count(*) AS n FROM policy_consents WHERE user_id=?',a.account)).n,2,'Both acceptances are kept');ok();
 console.log(`policy consent: ${checks} checks passed (${d1?'local D1':'SQLite'})`);
}finally{await fixture.close?.();}

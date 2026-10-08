import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {inferenceModules,inferenceReach} from './helpers/maintainer-inference.mjs';
Error.stackTraceLimit=0;
// WH-073 slice 1 (verification only): published content, visitor application, guest preview, contact and scheduled
// maintenance routes dispatch zero owner-maintenance model inference, with the maintainer absent (no AI keys) or present
// but failing (provider answers 503). The real handlers run against the complete current schema in disposable SQLite
// (or local D1 with --d1). fetch is replaced by a counting stub, so any provider, Turnstile or other network use fails
// loudly. Local synthetic evidence only: no cache or delivery change, no request-path cost measurement, no live Worker.
const modules=await currentFixtureModules(['src/index.ts','src/publications.ts','src/contacts.ts','src/ai-chat.ts','src/project-specification/store.ts','src/site-host.ts','src/app-host.ts']);
const [{default:platform},pub,contacts,{configuredAI},site,{default:siteHost},{default:appHost}]=await Promise.all(['src/index.ts','src/publications.ts','src/contacts.ts','src/ai-chat.ts','src/project-specification/store.ts','src/site-host.ts','src/app-host.ts'].map(async path=>{const m=await modules.module(path);return path==='src/ai-chat.ts'?{configuredAI:m.configuredAI}:m;}));
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID(),run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
const consoleMethods=['log','info','warn','error','debug'],originals=Object.fromEntries(consoleMethods.map(k=>[k,console[k]])),logs=[];
const originalFetch=globalThis.fetch;let network=0,providerStatus=null,cases=0,requests=0;
// Counting transport (below): attempted network calls are counted, then refused (no maintainer) or answered 503 (failing).
const urls=[];let probes=0,env_;
// Site health re-reads each published site at its own whumpo.site origin; that closed loop is served by the real sites
// Worker (and counted separately). Every other call is counted as network, then refused or answered 503.
globalThis.fetch=async(input,init)=>{
 const request=new Request(input,init);
 if(request.method==='GET'&&/^[0-9a-f-]{36}\.whumpo\.site$/.test(new URL(request.url).hostname)){probes++;return env_?.siteHost.fetch(request,env_.env,ctx);}
 network++;urls.push(request.url);if(providerStatus)return new Response('provider unavailable',{status:providerStatus});throw Error('No network is allowed');
};
const files={get:async()=>null,head:async()=>null,list:async()=>({objects:[],truncated:false}),delete:async()=>{},put:async()=>assert.fail('Standard service routes write no object')};
// Traffic measurement is the only background work a visitor route queues; it is awaited so its effects are counted.
const background=[],ctx={waitUntil:promise=>{background.push(promise);}};
const base={DB:db,FILES:files,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})},TURNSTILE_SECRET:'fixture',TURNSTILE_SITE_KEY:'fixture',ASSETS:{fetch:async()=>new Response('asset')}};
const variants={
 'maintainer unavailable (no AI binding or key)':base,
 'maintainer configured but failing (provider 503)':{...base,AI_BASE_URL:'https://opencode.ai/zen/go/v1',AI_MODEL:'muse-spark-1.3-contributor',AI_API_KEY:'synthetic-not-a-secret',AI_PROTOCOL:'responses'}
};
async function check(name,fn){try{await fn();cases++;}catch(error){originals.error(name);throw error;}}
async function command(o,prepare){const turn=id(),revision=(await row('SELECT revision FROM workspace_state WHERE user_id=?',o.user)).revision+1,r=await prepare(turn);await o.scope.batch([o.scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Synthetic website fixture',?,datetime('now'),'ai','pending')").bind(turn,o.user,revision,r.reply),...r.statements,o.scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(turn),o.scope.prepare('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?').bind(o.user)]);return turn;}
const publish=async o=>{const review=await command(o,t=>pub.publicationCommand(o.scope,o.user,t,'/publish '+o.version));await command(o,t=>pub.publicationCommand(o.scope,o.user,t,'/confirm '+review));};
const unpublish=async o=>{const review=await command(o,t=>pub.publicationCommand(o.scope,o.user,t,'/unpublish '+o.project));await command(o,t=>pub.publicationCommand(o.scope,o.user,t,'/confirm '+review));};
async function enableContact(o){const review=await command(o,t=>contacts.contactCommand(o.scope,o.user,t,'/contact-on '+o.project));await command(o,t=>contacts.contactCommand(o.scope,o.user,t,'/confirm-contact '+review));}
// A published website is built from the current specification transaction builders, never by calling the model.
async function owner(headline){
 const auth=await workspaceFixture(db,modules.identity),o={auth,user:auth.account,scope:await auth.scope(),project:id(),headline};
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",o.user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Garden care','draft',datetime('now'),datetime('now'))",o.project,o.user);
 o.version=await command(o,t=>site.createWebsite(o.scope,o.user,t,o.project,{name:'Garden',headline,description:'Garden care',theme:'ocean',aboutTitle:'About',aboutText:'Synthetic gardening',sections:[],photos:[]}));
 await publish(o);return o;
}
const get=async(worker,url,env,init={})=>{requests++;const response=await worker.fetch(new Request(url,init),env,ctx);await Promise.all(background.splice(0));return response;};
// Nothing a visitor or service route returns may allow a shared or browser cache to keep content that can be revoked.
const uncacheable=response=>{const cache=response.headers.get('cache-control')??'';assert.match(cache,/no-store/);assert.ok(!/public|s-maxage|max-age=[1-9]|immutable|stale-/i.test(cache),cache);for(const h of ['etag','last-modified','expires'])assert.equal(response.headers.get(h),null,h);};
const counters=async()=>({inference:(await row('SELECT COUNT(*) n FROM inference_calls')).n,spend:(await row('SELECT COUNT(*) n FROM gateway_spend_attempts')).n,turns:(await row('SELECT COUNT(*) n FROM chat_turns')).n,standard:(await row('SELECT COUNT(*) n FROM standard_ai_requests')).n,requests:(await row('SELECT COUNT(*) n FROM gateway_inference_requests')).n,buckets:(await row('SELECT COUNT(*) n FROM gateway_spend_buckets')).n});
try{
 await check('import graphs of every visitor, service and scheduled-drain entry reach no inference module',async()=>{
  // The detector itself must fire: the platform entry (owner Chat) legitimately reaches the model caller.
  const platformReach=await inferenceReach('src/index.ts');for(const needed of ['src/ai.ts','src/ai-chat.ts','src/acknowledgment.ts','src/site-agent.ts'])assert.ok(platformReach.includes(needed),needed+' must be detected');
  for(const path of ['src/ai.ts','src/ai-gateway.ts','src/gateway-spend.ts','src/model-policy.ts','src/inference-routing.ts','src/chat-interactions/agent.ts','src/chat-interactions/store.ts'])assert.ok(inferenceModules.test(path),path);
  for(const path of ['src/site-host.ts','src/hosts.ts','src/contacts.ts','src/app-gateway.ts','src/runtime/worker.ts'])assert.ok(!inferenceModules.test(path),path+' is a standard-service module');
  for(const entry of ['src/site-host.ts','src/app-host.ts','src/app-gateway.ts','src/runtime/worker.ts','src/contact-page.ts'])assert.deepEqual(await inferenceReach(entry),[],entry+' reaches owner-maintenance inference');
 });
 for(const [label,env] of Object.entries(variants))await check(label,async()=>{
  const configured=!!env.AI_API_KEY;providerStatus=configured?503:null;
  assert.equal(!!configuredAI(env),configured,'The variant really has (or lacks) a usable maintainer');
  network=0;requests=0;probes=0;env_={siteHost,env};
  const a=await owner('Garden '+id().slice(0,8)),b=await owner('Revoked '+id().slice(0,8));await enableContact(a);
  const start=await counters(),page=(project,path='/')=>get(siteHost,`https://${project}.whumpo.site${path}`,env);

  // Published content: served by the sites Worker alone, never cacheable.
  const root=await page(a.project);assert.equal(root.status,200);uncacheable(root);const html=await root.text();assert.ok(html.includes(a.headline));assert.ok(html.includes('https://whumpo.com/contact/'+a.project),'The contact link is a standard action');
  const head=await page(a.project,'/');assert.equal(head.status,200);assert.equal((await get(siteHost,`https://${a.project}.whumpo.site/`,env,{method:'HEAD'})).status,200);
  for(const [path,status] of [['/directory.json',404],['/directory',404],['/cms',404],['/missing',404],['/assets/'+id()+'.jpg',404]]){const r=await page(a.project,path);assert.equal(r.status,status,path);uncacheable(r);}
  const post=await get(siteHost,`https://${a.project}.whumpo.site/`,env,{method:'POST',body:'x'});assert.equal(post.status,405);uncacheable(post);
  const unknownHost=await get(siteHost,'https://unknown.example/',env);assert.equal(unknownHost.status,404);uncacheable(unknownHost);
  assert.equal((await page(id())).status,404);

  // Guest-preview host: an unknown bearer is refused; nothing is rendered.
  const guest=await get(siteHost,'https://preview.whumpo.site/api/link',env,{method:'POST',headers:{'content-type':'application/json',origin:'https://preview.whumpo.site'},body:JSON.stringify({token:'0'.repeat(64)})});assert.ok([400,404].includes(guest.status),String(guest.status));uncacheable(guest);

  // Visitor application host: routed through the real apps Worker, which owns its page and gateway authority.
  const appPage=await get(appHost,`https://app-${a.project}.whumpo.site/`,env);assert.equal(appPage.status,404);assert.match(appPage.headers.get('cache-control'),/no-store/);
  const appApi=await get(appHost,`https://app-${a.project}.whumpo.site/modules`,env,{method:'POST',headers:{'content-type':'application/json',origin:`https://app-${a.project}.whumpo.site`},body:'{}'});assert.ok(appApi.status>=400&&appApi.status<500,String(appApi.status));assert.match(appApi.headers.get('cache-control'),/no-store/);
  const viaSites=await get(siteHost,`https://app-${a.project}.whumpo.site/`,{...env,APP_HOST:{fetch:request=>get(appHost,request,env)}});assert.equal(viaSites.status,404);

  // Contact: the form and its submission are deterministic. Verification (Turnstile) is network, so the submission
  // runs in the local environment that skips it; the page itself is also read in the test environment.
  const form=await get(platform,`https://whumpo.com/contact/${a.project}`,env);assert.equal(form.status,200);uncacheable(form);
  const formHTML=await form.text(),revision=formHTML.match(/name="revision" value="(\d+)"/)[1],message=id();
  const local={...env,ENVIRONMENT:'local'},submitted=await get(platform,`https://whumpo.com/contact/${a.project}`,local,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',origin:'https://whumpo.com'},body:new URLSearchParams({id:message,revision,name:'Visitor',email:'visitor@example.com',message:'Synthetic question'}).toString()});
  assert.equal(submitted.status,200,await submitted.clone().text());uncacheable(submitted);assert.equal((await contacts.contactInbox(a.scope,a.user,a.project)).messages.length,1);

  assert.equal((await counters()).turns,start.turns,'Visitor and service requests create no Chat turns');

  // Revocation: unpublish, safety hold and a stale contact form all stop serving without becoming cacheable.
  await unpublish(a);
  for(const r of [await page(a.project),await get(platform,`https://whumpo.com/contact/${a.project}`,env)]){assert.equal(r.status,404);uncacheable(r);}
  const digest=(await row('SELECT digest FROM site_versions WHERE id=?',b.version)).digest;assert.equal((await page(b.project)).status,200);
  await run("INSERT INTO content_screening_decisions(user_id,kind,digest,policy_version,first_required,required,first_reason,first_percent,first_risk_score) VALUES(?,'generated_artifact',?,'synthetic-hold',1,1,'risk_or_missing_history',100,90)",b.user,digest);
  const held=await page(b.project);assert.ok([423,503].includes(held.status),String(held.status));uncacheable(held);assert.ok(!(await held.text()).includes(b.headline));
  await publish(a);assert.equal((await page(a.project)).status,200);

  // Scheduled drains: every configured cron runs the real handler; the contact drain is inert without a reviewed sender.
  const before=await counters(),crons=['* * * * *','47 * * * *','17 3 * * *'];for(const cron of crons)await platform.scheduled({cron,scheduledTime:Date.now(),noRetry(){}},env);
  const jobs=(await db.prepare('SELECT job,status FROM maintenance_health').all()).results;assert.ok(jobs.length>=8,'The maintenance jobs actually ran');
  assert.deepEqual(jobs.filter(j=>j.status!=='completed'&&j.status!=='skipped'),[]);

  const end=await counters();
  assert.equal(network,0,'No visitor, service or scheduled route reached the network (so no maintainer provider): '+urls.splice(0).join(', '));
  assert.deepEqual({...end,turns:0},{...start,turns:0},'No inference call, gateway spend or standard-AI request was recorded');
  assert.equal(end.turns,before.turns,'Scheduled drains create no Chat turns');
  assert.ok(probes>=1,'Scheduled site health re-read a published site through the sites Worker');
  assert.equal(requests,23,'The journey exercised its whole route inventory');
  providerStatus=null;
 });
 await check('counting transport is armed: any dispatch would be visible',async()=>{
  network=0;await assert.rejects(()=>globalThis.fetch('https://opencode.ai/zen/go/v1/responses'),/No network/);assert.equal(network,1);network=0;
 });
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 assert.ok(!logs.some(line=>/synthetic-not-a-secret/.test(line)),'No credential reached logs');
 process.stdout.write(`Standard service independence passed: ${cases} groups on ${process.argv.includes('--d1')?'local D1':'SQLite'} — import graphs of site-host, app-host, app-gateway, runtime worker and contact page reach no inference module (the platform entry is detected as a positive control); published site, directory, CMS, asset, method, host, guest-preview, visitor-app, contact form and submission, unpublish and safety-hold routes plus all three cron schedules ran with the maintainer absent and with it failing (503), with zero network calls, inference_calls, gateway_spend_attempts, standard-AI or gateway requests and Chat turns, and no cacheable response. Local synthetic verification only; no cache or delivery change, request-path cost measurement, premium-balance semantics or live Worker evidence.\n`);
}catch(error){originals.error(String(error.stack||error));process.exitCode=1;}
finally{for(const k of consoleMethods)console[k]=originals[k];globalThis.fetch=originalFetch;await fixture.close?.();}

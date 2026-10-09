// WH-004 finding B3 regression: a typed guest-preview delete control used to apply its effect before the Chat
// turn's revision-checked batch, so a request that returned 409 had already deleted the link. Since #178 the effect
// rides in the turn batch, so a refused request leaves the link and its comments unchanged (exit 0). Not in
// package.json scripts or any tools/verify.mjs profile; tests/guest-preview-chat-atomic.mjs is the maintained
// regression. Offline: disposable SQLite fixture, synthetic owner, no network. See docs/boundary-audit.md#b3.
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';

const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}};
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No network is allowed');};
const api=(actor,path,method='GET',data)=>m.worker.fetch(new Request('https://whumpo.com/api'+path,{method,headers:{origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+actor.token,...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),env,{waitUntil:()=>{}});
const ok=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
try{
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;
 await paidPlan(db,user,'personal');
 const site=await createFixtureProject(scope,user,'Race studio','Synthetic guest preview race');
 const body={id:id(),versionId:site.version,expiresInHours:24,feedback:true};
 const prepared=await ok(await api(actor,`/projects/${site.project}/guest-previews/prepare`,'POST',body));
 const {link}=await ok(await api(actor,`/projects/${site.project}/guest-previews`,'POST',{...body,confirmation:prepared.confirmation}));
 assert.ok(await db.prepare('SELECT id FROM guest_preview_links WHERE id=?').bind(link.id).first());
 // Pause the delete request just before its Chat turn batch; meanwhile another control from the same owner commits.
 let raced=false;
 const paused=await actor.scope(interceptDatabase(db,/INSERT INTO chat_turns/,async()=>{
  if(raced)return;raced=true;
  const state=await m.readChat(scope,user);
  const other=await m.sendChatControl(scope,user,{id:id(),revision:state.state.revision,action:{type:'shortcut',kind:'versions',projectId:site.project}});
  assert.equal(other.status,200,other.error);
 }));
 const revision=(await m.readChat(scope,user)).state.revision;
 const result=await m.sendChatControl(paused,user,{id:id(),revision,action:{type:'guestPreview',operation:'delete',linkId:link.id,confirmation:'DELETE'}});
 assert.ok(raced,'the competing control did not run');
 assert.equal(result.status,409,'the delete request should report a conversation conflict');
 const remaining=await db.prepare('SELECT id FROM guest_preview_links WHERE id=?').bind(link.id).first();
 assert.ok(remaining,'B3 regressed: the request returned 409 and saved no Chat turn, but the guest preview link and its comments were already deleted.');
 console.log('B3 resolved: a guest-preview delete refused with 409 left the link unchanged.');
}catch(error){console.error(error.message);process.exitCode=1;}
finally{globalThis.fetch=originalFetch;await fixture.close?.();}

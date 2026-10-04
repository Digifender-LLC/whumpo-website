// WH-018 owner account page client against the actual platform Worker routes: export review -> fresh-passkey download,
// closure review -> fresh-passkey confirm -> waiting journal -> resume -> final receipt. Disposable SQLite by default,
// local D1 with --d1. Synthetic identities and tokens only; no provider, model or network.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {unzipSync,strFromU8} from 'fflate';
import {currentSiteFixtureHandlers,createFixtureProject} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,workspaceSession} from './helpers/workspace-identity.mjs';
import {initializeFixtureKeys,fixtureKeyring,fixtureCiphertext} from './helpers/connection-keyring.mjs';
const d1=process.argv.includes('--d1');
const built=await build({stdin:{contents:`export * as client from './frontend/src/lib/account-lifecycle.ts';export {accountLifecycleActions,accountLifecyclePrefix} from './src/account-lifecycle/http.ts';`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {client,accountLifecycleActions,accountLifecyclePrefix}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),{db}=fixture;
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network is allowed');};
const FILES={get:async()=>null,head:async()=>null,put:async()=>assert.fail('No upload'),delete:async()=>{},list:async()=>({objects:[],truncated:false})};
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},FILES};
const base='https://whumpo.com',run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
/** The page's transport: its same-origin fetch routed into the real Worker with the session cookie, and the ordinary
 * reauthentication ceremony stood in by issuing a fresh passkey session for the same credential. */
function owner(session){
 const state={token:session.token,reauths:0,paths:[]};
 const t={fetch:(url,init)=>{state.paths.push(url);return m.worker.fetch(new Request(base+url,{...init,headers:{...init.headers,origin:base,cookie:'__Host-whumpo_session='+state.token}}),env,{waitUntil:()=>{}});},
  reauth:async()=>{state.reauths++;state.token=(await workspaceSession(db,m,{account:session.account,credential:session.credential})).token;}};
 return {...session,state,t};
}
let checks=0;
try{
 await initializeFixtureKeys(db);
 // The client names exactly the server's six actions and nothing else; no Chat, agent or generated page reaches them.
 assert.deepEqual([...client.accountLifecycleActions],[...accountLifecycleActions]);assert.equal(client.accountLifecyclePrefix,accountLifecyclePrefix);checks++;
 const sources=async dir=>(await readdir(dir,{recursive:true})).filter(f=>/\.tsx?$/.test(f)).map(f=>dir+'/'+f);
 for(const file of [...await sources('src'),...await sources('frontend/src')]){
  const text=await readFile(file,'utf8');
  if(text.includes('/api/account/v1/')||text.includes("'/account/v1/'")||/from '\.\/(?:lib\/)?account-lifecycle'/.test(text))
   assert.ok(['src/account-lifecycle/http.ts','frontend/src/lib/account-lifecycle.ts','frontend/src/account-lifecycle.tsx','frontend/src/workspace.tsx'].includes(file),'Only the account page reaches the account routes: '+file);
 }
 for(const file of ['src/chat-controls.ts','src/site-agent.ts','src/workspace-shortcuts.ts','src/chat.ts'])assert.ok(!/account-lifecycle|account\/v1|closure\/confirm/.test(await readFile(file,'utf8')),file);
 const page=await readFile('frontend/src/account-lifecycle.tsx','utf8');assert.ok(!/useWorkspace|\/chat|api<|send\(/.test(page),'The page is identity-only: no Chat, profile or workspace reads');checks++;

 // A fresh owner with a project and a stale passkey proof: status says not closing; export review needs no proof.
 const a=owner(await workspaceFixture(db,m,crypto.randomUUID(),-700)),b=owner(await workspaceFixture(db,m));
 const scope=await a.scope();await createFixtureProject(scope,a.account,'Garden studio','Neighborhood garden care');
 let status=await client.readAccountClosure(a.t);assert.deepEqual(status,{state:'ok',value:null});assert.equal(a.state.reauths,0);checks++;
 const request=client.newAccountRequestId();
 let review=await client.prepareAccountExport(request,false,a.t);assert.equal(review.state,'ok');assert.equal(review.value.projects,1);assert.equal(review.value.visitorData,false);
 assert.ok(review.value.excludes.some(x=>/Passkeys/.test(x)));assert.equal(a.state.reauths,0);
 const replay=await client.prepareAccountExport(request,false,a.t);assert.equal(replay.value.digest,review.value.digest,'Same request, same exact review');
 assert.equal((await client.prepareAccountExport(request,true,a.t)).code,'request_conflict');checks++;
 // Download: the stale proof runs one reauthentication and the identical request then streams a complete archive.
 let download=await client.downloadAccountExport(review.value,a.t);assert.equal(download.state,'ok');assert.equal(a.state.reauths,1);
 const files=unzipSync(new Uint8Array(await download.value.arrayBuffer())),manifest=JSON.parse(strFromU8(files['manifest.json']));
 assert.equal(manifest.format,'whumpo-account-export-v1');assert.equal(manifest.accountId,a.account);assert.equal(manifest.complete,true);assert.equal(manifest.exportReview,request);checks++;
 // A wrong digest, another owner's review and an unrefreshable proof are refused with plain messages.
 assert.equal((await client.downloadAccountExport({id:review.value.id,digest:'0'.repeat(64)},a.t)).code,'stale_review');
 assert.equal((await client.downloadAccountExport(review.value,b.t)).code,'stale_review');
 const stuck=owner(await workspaceSession(db,m,{account:a.account,credential:a.credential},-700));stuck.t.reauth=async()=>{stuck.state.reauths++;};
 const refused=await client.downloadAccountExport(review.value,stuck.t);assert.equal(refused.code,'proof_required');assert.equal(refused.message,'Your passkey check did not finish. Try again.');assert.equal(stuck.state.reauths,1,'Only one reauthentication per request');
 await assert.rejects(()=>client.downloadAccountExport({id:'not-a-review',digest:review.value.digest},a.t),/current account review/);checks++;

 // Closure review lists what is removed, what remains and blockers; an owner action blocks confirmation.
 const tokenSecret='gho_SYNTHETIC_CLIENT',ciphertext=await fixtureCiphertext(fixtureKeyring(),`whumpo:github:token:${a.account}:token-client`,tokenSecret);
 await run("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES('token-client',?,?,'2027-01-01','active')",a.account,ciphertext);
 a.state.token=(await workspaceSession(db,m,{account:a.account,credential:a.credential},-700)).token;a.state.reauths=0;
 let closure=await client.prepareAccountClosure(client.newAccountRequestId(),a.t);assert.equal(closure.state,'ok');
 assert.equal(closure.value.canConfirm,true);assert.deepEqual(closure.value.requiredBeforeClosure,[]);assert.equal(closure.value.removes.projects,1);assert.equal(closure.value.removes.connectedProviders,1);
 assert.ok(closure.value.remainsAfterClosure.some(x=>/Cloudflare zones/.test(x)));assert.ok(closure.value.effects.length>3);assert.ok(!JSON.stringify(closure.value).includes(tokenSecret));checks++;
 // A wrong digest is refused after the proof check (one reauthentication); the exact review then confirms without another.
 a.state.reauths=0;assert.equal((await client.confirmAccountClosure({id:closure.value.id,digest:'f'.repeat(64)},a.t)).code,'stale_review');assert.equal(a.state.reauths,1);
 // Confirm: the durable closure waits on provider revocation with its step journal.
 let started=await client.confirmAccountClosure(closure.value,a.t);assert.equal(started.state,'ok');assert.equal(a.state.reauths,1);
 assert.equal(started.value.state,'waiting');assert.deepEqual(started.value.steps.map(s=>[s.step,s.state]),[['freeze','done'],['withdraw','done'],['credentials','waiting'],['holds','pending'],['operations','pending'],['purge','pending']]);
 assert.ok(client.closureDetail(started.value.steps[2].detail).some(x=>x==='Provider revocations pending: 1'));checks++;
 // Status and replay return the same closure; a second review is refused; export stays available while closing.
 status=await client.readAccountClosure(a.t);assert.equal(status.value.id,closure.value.id);assert.equal(status.value.state,'waiting');
 assert.equal((await client.confirmAccountClosure(closure.value,a.t)).value.id,closure.value.id);
 assert.equal((await client.prepareAccountClosure(client.newAccountRequestId(),a.t)).code,'closure_exists');
 const late=await client.prepareAccountExport(client.newAccountRequestId(),false,a.t);assert.equal(late.state,'ok');assert.equal((await client.downloadAccountExport(late.value,a.t)).state,'ok');checks++;
 // Resume while the provider has not confirmed: still waiting, nothing repeated. Then the confirmation lands.
 let resumed=await client.resumeAccountClosure(a.t);assert.equal(resumed.value.state,'waiting');assert.equal(resumed.value.steps[2].state,'waiting');
 await run("DELETE FROM github_token_vault WHERE id='token-client'");
 resumed=await client.resumeAccountClosure(a.t);assert.equal(resumed.state,'ok');assert.equal(resumed.value.state,'complete');assert.ok(resumed.value.steps.every(s=>s.state==='done'));
 assert.equal(await row('SELECT id FROM users WHERE id=?',a.account),null);assert.equal((await row('SELECT state FROM account_closures WHERE id=?',closure.value.id)).state,'complete');checks++;
 // The session is gone with the account: later reads are refused rather than reporting "not closing".
 a.t.reauth=async()=>{a.state.reauths++;};status=await client.readAccountClosure(a.t);assert.equal(status.state,'error');checks++;
 // The other owner is untouched, and a required owner action is listed as a blocker that refuses confirmation.
 const bScope=await b.scope(),bProject=await createFixtureProject(bScope,b.account,'Bakery','Bread');
 await run('INSERT INTO backend_form_settings(project_id,revision) VALUES(?,0)',bProject.project);
 const blocked=await client.prepareAccountClosure(client.newAccountRequestId(),b.t);assert.equal(blocked.value.canConfirm,false);
 assert.deepEqual(blocked.value.requiredBeforeClosure.map(r=>[r.id,r.count]),[['backendFormSettings',1]]);assert.ok(blocked.value.requiredBeforeClosure[0].action.length>10);
 assert.equal((await client.confirmAccountClosure(blocked.value,b.t)).code,'action_required');assert.equal(await row('SELECT 1 x FROM account_closures WHERE account_id=?',b.account),null);
 await run('DELETE FROM backend_form_settings WHERE project_id=?',bProject.project);
 assert.deepEqual(await client.readAccountClosure(b.t),{state:'ok',value:null});assert.ok(await row('SELECT id FROM users WHERE id=?',b.account));checks++;
 assert.ok(a.state.paths.every(p=>p.startsWith(accountLifecyclePrefix)));assert.equal(network,0);
 console.log(`Account lifecycle client passed (${d1?'local D1':'SQLite'}): ${checks} checks. Six-action client only reachable from the identity-only account page; export review replay/conflict and one-reauth download of a complete archive; stale, foreign and unrefreshable proofs refused; closure review with removals, remains and blockers; one-reauth confirm, waiting journal, status/replay, export while closing, resume to the final receipt; other tenant intact; no network.`);
}finally{globalThis.fetch=originalFetch;await fixture.close();}

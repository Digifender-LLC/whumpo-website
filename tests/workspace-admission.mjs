import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase,completeWelcome} from './helpers/workspace-identity.mjs';
const built=await build({stdin:{resolveDir:process.cwd(),contents:"export * from './src/workspace-identity/admission';export * from './src/workspace-identity/authority';export * from './src/security';export {sendConversation,sendChatControl} from './src/chat';export {default as worker} from './src/index';"},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();let checks=0;
async function refused(fn,code='identity_changed'){await assert.rejects(fn,e=>e.code===code);checks++;}
const effect=(scope,user,name=id())=>scope.prepare("INSERT INTO activity_events(id,user_id,action,summary,created_at) VALUES(?,?,'fixture','Fixture',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(name,user);
try{
 const one=await workspaceFixture(db,m),scope=await one.scope(),principal=m.workspacePrincipal(scope,one.account);
 assert.throws(()=>m.admitWorkspace(db,{...principal}),e=>e.code==='proof_required');checks++;
 assert.throws(()=>m.workspacePrincipal(db,one.account),e=>e.code==='proof_required');checks++;
 assert.throws(()=>m.workspacePrincipal(scope,id()),e=>e.code==='proof_required');checks++;
 assert.throws(()=>scope.exec('SELECT 1'));assert.throws(()=>scope.withSession());assert.throws(()=>scope.dump());checks+=3;
 await refused(()=>scope.batch([db.prepare('SELECT 1')]),'proof_required');
 assert.equal(await scope.prepare('SELECT 41 n').first('n'),41);
 assert.equal((await scope.prepare('SELECT 42 n').all()).results[0].n,42);
 const event=id(),r=await scope.batch([effect(scope,one.account,event),scope.prepare('SELECT changes() n')]);assert.equal(r.length,2);assert.equal(r[0].meta.changes,1);assert.equal(r[1].results[0].n,1);checks++;
 // A failing domain statement rolls back its entire transaction, with guard rows absent.
 const rolled=id();await assert.rejects(()=>scope.batch([effect(scope,one.account,rolled),effect(scope,one.account,event)]));assert.equal(await db.prepare('SELECT 1 FROM activity_events WHERE id=?').bind(rolled).first(),null);checks++;
 const prepared=effect(scope,one.account);await m.assertWorkspace(scope,one.account);await one.revoke();
 await refused(()=>prepared.run());await refused(()=>scope.prepare('SELECT email FROM users').all());await refused(()=>scope.prepare('SELECT email FROM users').first());
 let sent=0;const transport=m.workspaceTransport(scope,one.account,async()=>{sent++;return new Response('never')});await refused(()=>transport('https://example.invalid'));assert.equal(sent,0);
 await refused(()=>m.sendConversation(scope,one.account,{id:id(),revision:0,content:'Build a landscaping site.'}));await refused(()=>m.sendChatControl(scope,one.account,{}));
 await refused(()=>m.sendConversation(db,one.account,{id:id(),revision:0,content:'Build a landscaping site.'}),'proof_required');
 // Revocation between preflight and the actual D1 batch still denies every effect.
 const two=await workspaceFixture(db,m);let paused=0;
 const racing=interceptDatabase(db,/INSERT INTO activity_events/,async()=>{paused++;await two.revoke()});const fenced=await two.scope(racing);await m.assertWorkspace(fenced,two.account);
 const before=await db.prepare('SELECT count(*) n FROM activity_events WHERE user_id=?').bind(two.account).first();await refused(()=>fenced.batch([effect(fenced,two.account),effect(fenced,two.account)]));assert.equal(paused,1);assert.equal((await db.prepare('SELECT count(*) n FROM activity_events WHERE user_id=?').bind(two.account).first()).n,before.n);
 // Actual proof age, not request or session creation time, gates sensitive commits.
 const aged=await workspaceFixture(db,m,undefined,-601),old=await aged.scope();await m.assertWorkspace(old,aged.account);await refused(()=>m.requireFreshWorkspace(old,aged.account),'proof_required');await refused(()=>effect(old,aged.account).run());
 const epoch=await workspaceFixture(db,m),held=await epoch.scope();await db.prepare('UPDATE identity_accounts SET auth_epoch=auth_epoch+1 WHERE account_id=?').bind(epoch.account).run();await refused(()=>effect(held,epoch.account).run());
 // The actual HTTP root cannot outlive revocation while reading an asynchronous request body.
 const http=await workspaceFixture(db,m);await completeWelcome(db,http.account);let writes=0;
 const workerDB=interceptDatabase(db,/INSERT INTO projects/,async()=>{writes++;await http.revoke()});
 const env={DB:workerDB,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}};
 const response=await m.worker.fetch(new Request('https://whumpo.com/api/projects',{method:'POST',headers:{origin:'https://whumpo.com','content-type':'application/json',cookie:'__Host-whumpo_session='+http.token},body:JSON.stringify({name:'Held HTTP request',purpose:'A landscaping site'})}),env,{waitUntil:()=>{}});
 assert.equal(response.status,409);assert.equal((await response.json()).code,'identity_changed');assert.equal(writes,1);assert.equal(await db.prepare('SELECT id FROM projects WHERE owner_user_id=? AND name=?').bind(http.account,'Held HTTP request').first(),null);checks++;
 // WH-207: a fresh account is refused before any write; the negative control (finished welcome) succeeds.
 const gated=await workspaceFixture(db,m),post=owner=>m.worker.fetch(new Request('https://whumpo.com/api/projects',{method:'POST',headers:{origin:'https://whumpo.com','content-type':'application/json',cookie:'__Host-whumpo_session='+owner.token},body:JSON.stringify({name:'Gated project'})}),{DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}},{waitUntil:()=>{}});
 const count=async()=>Object.values(await db.prepare("SELECT (SELECT count(*) FROM projects WHERE owner_user_id=?1)+(SELECT count(*) FROM welcome_onboarding WHERE user_id=?1)+(SELECT count(*) FROM activity_events WHERE user_id=?1) n").bind(gated.account).first())[0];
 const refusal=await post(gated);assert.equal(refusal.status,409);const refused409=await refusal.json();assert.equal(refused409.code,'onboarding_required');assert.ok(refused409.support);assert.equal(await count(),0);
 await completeWelcome(db,gated.account);const welcomeRows=await count();assert.equal((await post(gated)).status,201);assert.equal(await count(),welcomeRows+2);checks++;
 assert.equal((await db.prepare('SELECT count(*) n FROM identity_admission_checks').first()).n,0);
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 console.log(`Workspace admission: ${checks} checks, atomic HTTP/Chat revocation, proof age, epoch, batch rollback and provider dispatch (${process.argv.includes('--d1')?'local D1':'SQLite'}).`);
}catch(error){console.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}finally{await fixture.close();}

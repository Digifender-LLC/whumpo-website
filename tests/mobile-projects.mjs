import assert from 'node:assert/strict';
import {timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {authenticator} from './helpers/webauthn-authenticator.mjs';
import {createFixtureWebsite,proposeFixtureWebsite} from './current-site-fixture.mjs';

// WH-084 M4: projects, versions, activity and the eight interaction aliases of /api/mobile/v1 through the REAL Worker, over the shared mobile-v1
// fixtures, on disposable SQLite and, with --d1, actual local D1. Each operation reuses the web handler; this proves the mapping, the
// request-ID and revision rules, fresh-passkey proof, two-owner isolation and that confirm never reaches the model.
const bundle=await build({stdin:{contents:[
 "export {default as worker} from './src/index';export {androidPasskeyOrigins} from './src/android-signing';",
 "export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';",
 "export {newSessionToken,hashToken} from './src/security';",
 "export {createWebsite,prepareSpecification,readSpecificationProposal} from './src/project-specification/store';export {issueContentBrief,issueProjectIntake} from './src/chat-interactions/store';export {readChat,sendChat,sendChatControl} from './src/chat';"
 ].join(''),resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fixtures=name=>JSON.parse(readFileSync(new URL('./fixtures/mobile-v1/'+name,import.meta.url),'utf8'));
const operations=Object.fromEntries(fixtures('operations.json').cases.map(c=>[c.operation,c])),errors=fixtures('errors.json').cases,clients=fixtures('client.json');
const clientHeader=JSON.stringify(clients.current),clientWith=o=>JSON.stringify({...clients.current,...o});
const fixture=await databaseFixture(),db=fixture.db;
const id=()=>crypto.randomUUID(),run=(sql,...v)=>db.prepare(sql).bind(...v).run(),one=(sql,...v)=>db.prepare(sql).bind(...v).first();
const count=async(sql,...v)=>(await one(`SELECT count(*) n FROM (${sql})`,...v)).n;
const androidOrigin=m.androidPasskeyOrigins[0];
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const env={DB:db,ENVIRONMENT:'test',MOBILE_MINIMUM_BUILD:'40',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}};
const ctx={waitUntil(){}};
async function mobile(path,{method='GET',token,body,client=clientHeader,headers={}}={}){
 const h={...(client===null?{}:{'whumpo-client':client}),...(token?{authorization:'Bearer '+token}:{}),...headers};
 if(body!==undefined)h['content-type']='application/json';
 const response=await m.worker.fetch(new Request('https://whumpo.com/api/mobile/v1'+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}),env,ctx);
 const text=await response.text();let data=null;try{data=JSON.parse(text);}catch{}
 assert.equal(response.headers.get('cache-control'),'no-store');
 return {status:response.status,data,text};
}
// Every fixture key is present in the live body with the same JSON type (null in a fixture accepts any value).
function shaped(live,fixture,at='body'){
 if(fixture===null||live===null)return; // a nullable member may be null live where the fixture shows an example
 assert.equal(typeof live,typeof fixture,at);
 if(Array.isArray(fixture)){assert(Array.isArray(live),at);if(fixture.length&&live.length)shaped(live[0],fixture[0],at+'[0]');return;}
 if(fixture&&typeof fixture==='object')for(const k of Object.keys(fixture)){assert(Object.hasOwn(live,k),`${at}.${k} missing`);shaped(live[k],fixture[k],at+'.'+k);}
}
const fixtureCall=(name,live)=>{assert.equal(live.status,operations[name].response.status,live.text);shaped(live.data,operations[name].response.body);};
const same=(live,fixture)=>assert.deepEqual(live,fixture);
const handleOf=account=>Buffer.from(account).toString('base64url');
let counter=0;
async function session(o,{proofAge=5,method='passkey',lifetime=3600}={}){
 const token=m.newSessionToken(),authority=id();
 await run("INSERT INTO identity_sessions VALUES(?,?,?,1,(SELECT auth_epoch FROM identity_accounts WHERE account_id=?),'android',?,?,unixepoch()-?,unixepoch(),unixepoch()+?)",authority,await m.hashToken(token),o.account,o.account,o.key.id,method,proofAge,lifetime);
 return {token,authority};
}
// An owner with a ready account, a real passkey, a private website and a core.editing read grant.
async function owner({project=true}={}){
 const account=id(),key=authenticator();
 await run("INSERT INTO users(id,email,created_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",account,`owner${++counter}${account.slice(0,6)}@example.test`);
 await run("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,kit_generation,kit_verifier,completion_receipt_id) VALUES(?,1,'ready',1,1,?,?)",account,'a'.repeat(64),id());
 await run("INSERT INTO identity_credentials VALUES(?,?,?,0,'Synthetic passkey','active',NULL,unixepoch(),NULL)",key.id,account,key.publicKey);
 const o={account,key,n:0};
 o.assert=(options)=>key.assertion(options,++o.n,{atOrigin:androidOrigin,handle:handleOf(account)});
 o.setup=await session(o);
 o.scope=async()=>m.admitWorkspace(db,await m.resolveIdentity(db,{version:1,client:'android',kind:'session',token:o.setup.token}));
 if(project){
  o.project=id();const now=new Date().toISOString();
  await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Landscaping','draft',?,?)",o.project,account,now,now);
  await createFixtureWebsite(await o.scope(),account,o.project,{name:'Garden',headline:'Neighborhood gardens',description:'Local gardening',theme:'ocean',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[],photos:[]},m);
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','read','private-test-acceptance','synthetic mobile slice fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),account,o.project);
 }
 return o;
}
const revisionOf=async o=>(await m.readChat(await o.scope(),o.account)).state.revision;
const spec=async(o,text)=>{const q=await proposeFixtureWebsite(await o.scope(),o.account,o.project,[{type:'content.replace',contentId:'headline',text}],m);return {q,control:{type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision}};};
const inference=()=>count('SELECT 1 FROM inference_calls');
const get=(path,token,client)=>mobile(path,{token,client});
const post=(path,token,body,client)=>mobile('/interactions/'+path,{method:'POST',token,body,client});
// A server-maintained form issued from a fresh Chat turn (no model): the content brief carries the site-content continuation, the intake templates need no grant.
async function prepared(o){if(o.prepared)return;o.prepared=true;await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','prepare','private-test-acceptance','synthetic mobile projects fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),o.account,o.project);await run("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.editing','prepare','private-test-acceptance','synthetic mobile projects fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),o.account);await run("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.editing','read','private-test-acceptance','synthetic mobile projects fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),o.account);}
async function origin(o){
 await prepared(o);
 const turn=id();
 await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) SELECT ?,user_id,revision+1,'Change the headline','Review this form',datetime('now') FROM workspace_state WHERE user_id=?",turn,o.account);
 await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.account);
 return turn;
}
async function brief(o){
 return m.issueContentBrief(await o.scope(),o.account,{originTurnId:await origin(o),projectId:o.project,contentIds:['headline']});
}
const intake=async(o,template)=>m.issueProjectIntake(await o.scope(),o.account,{originTurnId:await origin(o),template});
const client=JSON.parse(clientHeader).interaction;
const submit=(f,answers,requestId=id(),revision=f.answerRevision,operation='submit')=>({version:1,requestId,interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:revision,operation,...(operation==='cancel'?{}:{answers})});
const rows=(table,user)=>count(`SELECT 1 FROM ${table} WHERE user_id=?`,user);
try{
 const a=await owner(),b=await owner(),sa=await session(a),sb=await session(b);
 // Version rows for the fixture: the website created by the owner() fixture is the first saved version.
 await run("UPDATE projects SET updated_at='2026-10-04T12:00:00.000Z',created_at='2026-10-04T12:00:00.000Z' WHERE id=?",a.project);

 await check('project list: fixture shape, only the caller projects, paged by an opaque account-bound cursor',async()=>{
  const r=await get('/projects?limit=25',sa.token);fixtureCall('project.list',r);
  assert.deepEqual(r.data.items.map(p=>p.id),[a.project]);assert.equal(r.data.items[0].name,'Garden');assert.equal(r.data.items[0].siteLive,false);assert.equal(r.data.nextCursor,null);
  assert.deepEqual((await get('/projects',sb.token)).data.items.map(p=>p.id),[b.project],'owner B sees only owner B projects');
  const second=id(),now=new Date().toISOString();
  await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Second','','draft',?,?)",second,a.account,now,now);
  const one1=await get('/projects?limit=1',sa.token);assert.equal(one1.data.items.length,1);assert.equal(typeof one1.data.nextCursor,'string');
  const two=await get('/projects?limit=1&cursor='+one1.data.nextCursor,sa.token);assert.equal(two.status,200,two.text);assert.notEqual(two.data.items[0].id,one1.data.items[0].id);assert.equal(two.data.nextCursor,null);
  const foreign=await get('/projects?cursor='+one1.data.nextCursor,sb.token);assert.equal(foreign.status,400);same(foreign.data,errors.invalid_cursor.body);
  const wrongEndpoint=await get('/activity?cursor='+one1.data.nextCursor,sa.token);assert.equal(wrongEndpoint.status,400);
  for(const bad of ['?limit=0','?limit=51','?limit=x','?x=1','?limit=1&limit=2'])assert.equal((await get('/projects'+bad,sa.token)).status,400,bad);
  await run('DELETE FROM projects WHERE id=?',second);
 });

 await check('project read: fixture shape; a foreign or unknown project is not_found',async()=>{
  const r=await get('/projects/'+a.project,sa.token);fixtureCall('project.read',r);assert.equal(r.data.project.id,a.project);
  for(const [token,project] of [[sb.token,a.project],[sa.token,id()]]){const miss=await get('/projects/'+project,token);assert.equal(miss.status,404);same(miss.data,errors.not_found.body);}
  assert.equal((await get('/projects/not-an-id',sa.token)).status,404);
  assert.equal((await get('/projects/'+a.project+'?x=1',sa.token)).status,400);
 });

 await check('versions: fixture shape with the allowlisted preview path; foreign project is not_found; limit is bounded',async()=>{
  const r=await get('/projects/'+a.project+'/versions?limit=10',sa.token);fixtureCall('project.versions',r);
  assert(r.data.items.length>=1);for(const v of r.data.items)assert.equal(v.preview.path,`/api/site-versions/${v.id}/preview`);
  const web=await count('SELECT 1 FROM site_versions WHERE project_id=?',a.project);assert.equal(r.data.items.length,Math.min(web,10));
  assert.equal((await get('/projects/'+a.project+'/versions?limit=1',sa.token)).data.items.length,1);
  const miss=await get('/projects/'+a.project+'/versions',sb.token);assert.equal(miss.status,404);same(miss.data,errors.not_found.body);
  for(const bad of ['?limit=26','?limit=0','?cursor=x'])assert.equal((await get('/projects/'+a.project+'/versions'+bad,sa.token)).status,400,bad);
 });

 await check('activity: fixture shape, only the caller records, paged',async()=>{
  const r=await get('/activity?limit=25',sa.token);fixtureCall('activity.list',r);
  const own=await count('SELECT 1 FROM activity_events WHERE user_id=?',a.account);assert.equal(r.data.items.length,Math.min(own,25));
  const now=new Date().toISOString();
  for(let n=0;n<3;n++)await run("INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES(?,?,?,'project.updated',?,?)",id(),a.account,a.project,'Change '+n,now);
  const one1=await get('/activity?limit=2',sa.token);assert.equal(one1.data.items.length,2);assert.equal(typeof one1.data.nextCursor,'string');
  const rest=await get('/activity?limit=50&cursor='+one1.data.nextCursor,sa.token);assert.equal(rest.status,200,rest.text);
  assert.equal(new Set([...one1.data.items,...rest.data.items].map(x=>x.id)).size,one1.data.items.length+rest.data.items.length,'pages do not overlap');
  assert.equal((await get('/activity?limit=50',sa.token)).data.items.length,own+3);
  const bActivity=(await get('/activity',sb.token)).data.items;assert(bActivity.every(x=>x.projectId!==a.project),'owner B never sees owner A activity');
  assert.equal((await get('/activity?cursor='+one1.data.nextCursor,sb.token)).status,400);
 });

 await check('interaction list, read, resources: fixture shapes, isolation, the read client must equal the header, read-only calls never touch the model',async()=>{
  const before=await inference(),f=await intake(a,'project-brief@1'),g=await intake(a,'project-select@1');
  const listed=await post('list',sa.token,{version:1,projectId:a.project,limit:10,before:null});fixtureCall('interaction.list',listed);
  const read=await post('read',sa.token,{version:1,interactionId:f.envelope.id,client});assert.equal(read.status,200,read.text);assert.equal(read.data.version,1);assert.equal(read.data.state,'open');assert.equal(read.data.envelope.id,f.envelope.id);
  assert.equal((await post('read',sb.token,{version:1,interactionId:f.envelope.id,client})).status,404,'owner B cannot read owner A form');
  same((await post('read',sb.token,{version:1,interactionId:f.envelope.id,client})).data,errors.not_found.body);
  assert.equal((await post('read',sa.token,{version:1,interactionId:f.envelope.id,client:{...client,bindings:client.bindings.slice(1)}})).status,400,'a client that differs from the header is refused');
  assert.equal((await post('read',sa.token,{version:1,interactionId:f.envelope.id,client:{...client,versions:[2]}})).status,400);
  const needsMore=await brief(a),old=await post('read',sa.token,{version:1,interactionId:needsMore.envelope.id,client});
  assert.equal(old.status,426,old.text);assert.equal(old.data.error.code,'client_update_required');
  const res=await post('resources',sa.token,{version:1,interactionId:g.envelope.id,definitionDigest:g.envelope.definitionDigest,fieldId:'project',limit:10,before:null});
  assert.equal(res.status,200,res.text);assert(res.data.items.some(i=>i.id===a.project));assert(res.data.items.every(i=>i.id!==b.project),'owner A resources never include owner B projects');
  same((await post('resources',sb.token,{version:1,interactionId:g.envelope.id,definitionDigest:g.envelope.definitionDigest,fieldId:'project',limit:10,before:null})).data,errors.not_found.body);
  const bForm=await intake(b,'project-select@1');
  assert((await post('resources',sb.token,{version:1,interactionId:bForm.envelope.id,definitionDigest:bForm.envelope.definitionDigest,fieldId:'project',limit:10,before:null})).data.items.every(i=>i.id!==a.project));
  const foreignList=await post('list',sa.token,{version:1,projectId:b.project,limit:10,before:null});assert.equal(foreignList.status,404);same(foreignList.data,errors.not_found.body);
  assert.equal(await inference(),before,'read-only operations never call the model');
 });

 await check('interaction mutate and receipt: submit, same-ID replay, changed-payload conflict, stale answer revision, foreign receipt',async()=>{
  const before=await inference(),f=await intake(a,'project-brief@1'),answers={name:'Garden',purpose:'A website about gardening.'},requestId=id();
  const saved=await post('mutate',sa.token,submit(f,answers,id(),f.answerRevision,'save-draft'));assert.equal(saved.status,200,saved.text);assert.equal(saved.data.operation,'save-draft');
  const body=submit(f,answers,requestId,saved.data.answerRevision),first=await post('mutate',sa.token,body);assert.equal(first.status,200,first.text);
  assert.equal(first.data.requestId,requestId);assert.equal(first.data.operation,'submit');assert.equal(first.data.answerRevision,saved.data.answerRevision+1);
  const rowsBefore=await rows('chat_interaction_requests',a.account);
  same((await post('mutate',sa.token,body)).data,first.data);assert.equal(await rows('chat_interaction_requests',a.account),rowsBefore,'a replay writes nothing');
  const conflict=await post('mutate',sa.token,{...body,answers:{...answers,name:'Changed'}});assert.equal(conflict.status,409);same(conflict.data,errors.request_conflict.body);
  const stale=await post('mutate',sa.token,submit(f,answers,id(),saved.data.answerRevision,'cancel'));assert.equal(stale.status,409,stale.text);assert.equal(stale.data.version,1);assert.equal(typeof stale.data.error.code,'string');assert.notEqual(stale.data.error.code,'request_conflict');
  const receipt=await post('receipt',sa.token,{version:1,requestId});assert.equal(receipt.status,200,receipt.text);shaped(receipt.data,operations['interaction.receipt'].response.body);assert.equal(receipt.data.requestId,requestId);assert.equal(receipt.data.answerRevision,first.data.answerRevision);
  const foreign=await post('receipt',sb.token,{version:1,requestId});assert.equal(foreign.status,404);same(foreign.data,errors.not_found.body);
  assert.equal((await post('receipt',sa.token,{version:1,requestId:id()})).status,404,'an unknown request has no receipt');
  const theirs=await post('mutate',sb.token,body);assert.notEqual(theirs.status,200,'owner B cannot mutate owner A form');
  assert.equal(await inference(),before);
 });

 await check('interaction bodies: unknown actions, wrong methods, bad bodies, cookies and oversized payloads are refused',async()=>{
  assert.equal((await mobile('/interactions/nope',{method:'POST',token:sa.token,body:{version:1}})).status,404);
  assert.equal((await mobile('/interactions/list',{token:sa.token})).status,404);
  assert.equal((await post('receipt',sa.token,{version:1,requestId:'nope'})).status,400);
  assert.equal((await post('receipt',sa.token,{version:1,requestId:id(),extra:1})).status,400);
  assert.equal((await post('receipt',null,{version:1,requestId:id()})).status,401);
  assert.equal((await mobile('/interactions/receipt',{method:'POST',token:sa.token,headers:{cookie:'__Host-whumpo_session='+sa.token},body:{version:1,requestId:id()}})).status,400);
  const big=await post('mutate',sa.token,{version:1,pad:'x'.repeat(33000)});assert.equal(big.status,413);same(big.data,errors.payload_too_large.body);
  assert.equal((await post('receipt',sa.token,{version:1,requestId:id()},clientWith({build:39}))).status,426);
 });

 await check('submit, continue, reconcile and stop: a handoff session may answer a form, but the review it prepares still needs a fresh passkey',async()=>{
  const handoff=await session(a,{proofAge:5,method:'handoff'}),f=await brief(a),before=await inference(),answers={'field-1':'Fresh garden headline'};
  const sub=await post('mutate',handoff.token,submit(f,answers));assert.equal(sub.status,200,sub.text);
  const submission=await one('SELECT id FROM chat_interaction_submissions WHERE interaction_id=? AND user_id=?',f.envelope.id,a.account);assert(submission);
  const g=await brief(a),gSub=await post('mutate',handoff.token,submit(g,{'field-1':'Stale garden headline'}));assert.equal(gSub.status,200,gSub.text);
  const gId=(await one('SELECT id FROM chat_interaction_submissions WHERE interaction_id=? AND user_id=?',g.envelope.id,a.account)).id;
  const revision=await revisionOf(a),bodyOf={version:1,submissionId:submission.id,expectedChatRevision:revision};
  // A stale chat revision is the web outcome unchanged: the continuation settles as failed/changed and prepares nothing.
  const stale=await post('continue',handoff.token,{version:1,submissionId:gId,expectedChatRevision:revision-1});assert.equal(stale.status,200,stale.text);assert.equal(stale.data.continuation.state,'failed');assert.equal(stale.data.continuation.reason,'changed');
  const foreign=await post('continue',sb.token,bodyOf);assert.equal(foreign.status,404);same(foreign.data,errors.not_found.body);
  const started=await post('continue',handoff.token,bodyOf);fixtureCall('interaction.continue',started);assert.equal(started.data.submissionId,submission.id);
  const again=await post('continue',handoff.token,bodyOf);assert.equal(again.status,200,again.text);assert.equal(again.data.continuation.id,started.data.continuation.id,'continue is idempotent per submission');
  const reconciled=await post('reconcile',handoff.token,{version:1,submissionId:submission.id});fixtureCall('interaction.reconcile',reconciled);
  assert.equal((await post('reconcile',sb.token,{version:1,submissionId:submission.id})).status,404);
  assert.equal(await inference(),before,'the content brief prepares a review without the model');
  // The continuation prepared an exact review; confirming it is the fresh-passkey step, and a handoff session never has one.
  const pending=(await get('/reviews',handoff.token)).data.items.find(i=>i.project.id===a.project&&i.control&&i.control.type==='specificationApply');
  assert(pending,'the prepared review is offered');
  const refused=await mobile('/reviews/confirm',{method:'POST',token:handoff.token,body:{version:1,requestId:id(),expectedRevision:await revisionOf(a),control:pending.control}});
  assert.equal(refused.status,401);same(refused.data,errors.proof_required_fresh.body);
  const stopped=await post('stop',handoff.token,{version:1,submissionId:submission.id});assert.equal(stopped.status,200,stopped.text);shaped(stopped.data,operations['interaction.stop'].response.body);
  assert.equal((await post('stop',sb.token,{version:1,submissionId:submission.id})).status,404);
 });

 console.log(`Mobile projects M4: ${cases} checks over the twelve operations on ${process.argv.includes('--d1')?'local D1':'SQLite'}.`);
}catch(error){console.error(error);process.exitCode=1;}
finally{await fixture.close();}

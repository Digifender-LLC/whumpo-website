import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {createFixtureWebsite,proposeFixtureWebsite,enableFixtureVisitorAccess} from './current-site-fixture.mjs';
import {operations,validateResponse,controlCapabilities,fieldTypes,interactionBindings} from '../tools/prototypes/mobile-v1.mjs';
Error.stackTraceLimit=0;
const paths=['src/index.ts','src/chat.ts','src/project-specification/store.ts','src/chat-interactions/store.ts','src/app-activation.ts','src/backend-versions.ts','src/app-document-recovery.ts','src/app-data.ts','src/app-recovery-chat.ts','src/chat-review-receipts.ts','src/site-host.ts'];
const modules=await currentFixtureModules(paths),[http,chat,spec,forms,apps,backend,recovery,data,restoreChat,receipts,siteHost]=await Promise.all(paths.map(p=>modules.module(p))),m={...modules.identity,...chat,...spec};
const fixture=await databaseFixture(),db=fixture.db,id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();let cases=0,network=0,healthReads=0;
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
const networkCalls=[],previousFetch=globalThis.fetch;globalThis.fetch=async(input,init)=>{const u=new URL(typeof input==='string'?input:input.url??input);if(/^https:\/\/[0-9a-f-]{36}\.whumpo\.site$/.test(u.origin)){healthReads++;return siteHost.default.fetch(new Request(input,init),{DB:db});}network++;networkCalls.push(u.origin+u.pathname);throw Error('Unexpected provider or inference request');};
const env={DB:db,ENVIRONMENT:'test',MOBILE_ANDROID_PACKAGE:'com.whumpo.fixture',MOBILE_ANDROID_CERT_SHA256:Array(32).fill('B1').join(':'),API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
const client={contract:1,build:4,platform:'android',controls:[...controlCapabilities],interaction:{versions:[1],fieldTypes:[...fieldTypes],bindings:[...interactionBindings]}};
const background=[],ctx={waitUntil(promise){background.push(promise);}};
async function native(o,offset=-5){const token=m.newSessionToken(),authority=id();await run("INSERT INTO identity_sessions VALUES(?,?,?,?,?,'android',?,'passkey',unixepoch()+?,unixepoch(),unixepoch()+3600)",authority,await m.hashToken(token),o.user,1,1,o.authority.credential,offset);return {token,nativeAuthority:authority};}
async function owner(withProject=true){
 const authority=await workspaceFixture(db,m),user=authority.account,scope=await authority.scope(),o={authority,user,scope};
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
 for(const operation of ['read','prepare','confirm'])await run("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.editing',?,'private-test-acceptance','synthetic native workspace',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,operation);
 Object.assign(o,await native(o));if(withProject)o.project=await project(o);return o;
}
async function project(o,name='Garden'){const p=id();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,?,'Private garden purpose','draft',?,?)",p,o.user,name,now(),now());for(const operation of ['read','prepare','confirm'])await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing',?,'private-test-acceptance','synthetic native project',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),o.user,p,operation);return p;}
async function origin(o,text='Review these details'){const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,'Prepare current work',?,?,'guided','completed' FROM workspace_state WHERE user_id=?",turn,text,now(),o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);return turn;}
const revision=async o=>(await row('SELECT revision FROM workspace_state WHERE user_id=?',o.user)).revision;
async function call(o,path,body,expected=200,{header=client,environment=env,method=body===undefined?'GET':'POST',headers={}}={}){
 const r=await http.default.fetch(new Request('https://whumpo.com/api/mobile/v1'+path,{method,headers:{'whumpo-client':JSON.stringify(header),...(o?{authorization:'Bearer '+o.token}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),environment,ctx),value=await r.json();
 assert.equal(r.status,expected,`${path}: ${JSON.stringify(value)}`);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('set-cookie'),null);
 if(expected===200){const pathname=path.split('?')[0],op=operations.find(op=>op.method===method&&new RegExp('^'+op.path.replace(/\{\w+\}/g,'[0-9a-f-]{36}')+'$').test(pathname));assert(op,path);validateResponse(op.id,value);}
 return value;
}
async function no(o,path,body,status,code,options){const r=await call(o,path,body,status,options);assert.equal(r.error.code,code);return r;}
async function test(name,fn){try{await fn();cases++;}catch(error){console.error(name,error);throw error;}}
const send=async(o,content,requestId=id(),expectedRevision)=>call(o,'/chat/messages',{version:1,requestId,expectedRevision:expectedRevision??await revision(o),content});
const confirm=async(o,control,requestId=id(),expectedRevision)=>({version:1,requestId,expectedRevision:expectedRevision??await revision(o),control});
const website=async o=>createFixtureWebsite(o.scope,o.user,o.project,{name:'Garden',headline:'Local gardens',description:'Garden care',theme:'ocean',aboutTitle:'About',aboutText:'Seasonal care',sections:[],photos:[]},m);
const mutate=(form,operation='submit',answers={tone:'friendly'})=>({version:1,requestId:id(),interactionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:form.answerRevision,operation,...(operation==='cancel'?{}:{answers})});
try{
 const a=await owner(),b=await owner(),early=await owner(false);
 await test('welcome gate precedes every native workspace operation except bootstrap',async()=>{
  const boot=await call(early,'/bootstrap');assert.deepEqual(boot.onboarding,{complete:false,browserPath:'/workspace/'});assert.equal(boot.chat,null);
  for(const p of ['/chat','/reviews','/projects','/activity'])await no(early,p,undefined,409,'onboarding_required');
  await no(early,'/chat/messages',{version:1,requestId:id(),expectedRevision:0,content:'Hello'},409,'onboarding_required');
  assert.equal((await call(a,'/bootstrap')).projectCount,1);
 });
 await test('cookie, Origin, web bearer and foreign resources never cross the native boundary',async()=>{
  await no(null,'/projects',undefined,401,'proof_required');await no({...a,token:a.authority.token},'/projects',undefined,401,'proof_required');
  for(const headers of [{origin:'https://whumpo.com'},{cookie:'any=1'}])await no(a,'/projects',undefined,400,'invalid_request',{headers});
  await no(b,'/projects/'+a.project,undefined,404,'not_found');await no(b,'/projects/'+a.project+'/versions',undefined,404,'not_found');
  await no(a,'/chat/export',undefined,404,'not_found');await no(a,'/interactions/card',{version:1},404,'not_found');
 });
 await test('closing accounts refuse native workspace with a fixed browser destination while identity read, reauth and logout remain available',async()=>{
  const o=await owner(),requestId=id();
  await run("INSERT INTO account_closures(id,account_id,policy_version,review_digest,obligations_json,state,revision,created_at,updated_at) VALUES(?,?,1,?,'{}','waiting',1,unixepoch(),unixepoch())",id(),o.user,'a'.repeat(64));
  for(const path of ['/bootstrap','/projects','/chat','/activity','/reviews']){
   const result=await no(o,path,undefined,409,'account_closing');assert.equal(result.error.browserPath,'/workspace/account');assert.equal(result.error.next,'browser');
  }
  await no(o,'/chat/messages',{version:1,requestId,expectedRevision:1,content:'Hello'},409,'account_closing');
  assert.equal(await row('SELECT id FROM chat_turns WHERE id=?',requestId),null);
  assert.equal((await call(o,'/session')).account.id,o.user);
  assert.ok((await call(o,'/session/reauth/options',{version:1})).challengeId);
  assert.equal((await call(o,'/session/logout',{version:1})).signedOut,true);await no(o,'/session',undefined,401,'proof_required');
 });
 await test('project/activity pages use exact owner and route-bound stable cursors, including equal timestamps',async()=>{
  await project(a,'Second');await project(a,'Third');const stamp=now();await run('UPDATE projects SET updated_at=? WHERE owner_user_id=?',stamp,a.user);
  const first=await call(a,'/projects?limit=1'),seen=[...first.items];let cursor=first.nextCursor;
  while(cursor){const next=await call(a,'/projects?limit=1&cursor='+cursor);seen.push(...next.items);cursor=next.nextCursor;}
  assert.equal(seen.length,3);assert.equal(new Set(seen.map(x=>x.id)).size,3);assert(!seen.some(x=>x.id===b.project));
  await no(b,'/projects?cursor='+first.nextCursor,undefined,400,'invalid_cursor');await no(a,'/activity?cursor='+first.nextCursor,undefined,400,'invalid_cursor');
  for(const query of ['limit=0','limit=51','limit=1&limit=2','secret=1','cursor=evil'])await no(a,'/projects?'+query,undefined,400,query==='cursor=evil'?'invalid_cursor':'invalid_request');
  for(let n=0;n<3;n++){const turn=id();const result=await chat.sendChat(a.scope,a.user,{id:turn,revision:await revision(a),content:'/domain native'+n+'.example.com '+a.project});assert.equal(result.status,200,result.error);assert(await row('SELECT 1 FROM activity_events WHERE id=?','domain:'+turn));}
  await run('UPDATE activity_events SET created_at=? WHERE user_id=?',stamp,a.user);
  const page=await call(a,'/activity?limit=2'),next=await call(a,'/activity?limit=2&cursor='+page.nextCursor);assert.equal(page.items.length,2);assert.equal(next.items.length,1);assert.equal(next.nextCursor,null);
 });
 await test('native plain messages use shared exact request identity and never interpret slash commands',async()=>{
  const request=id(),rev=await revision(a),one=await send(a,'export my chat',request,rev);assert.equal(one.turnStatus,'completed');assert.deepEqual(await send(a,'export my chat',request,rev),one);
  await no(a,'/chat/messages',{version:1,requestId:request,expectedRevision:rev,content:'different'},409,'request_conflict');
  const turn=await call(a,'/chat/turns/'+request);assert.equal(turn.turn.userText,'export my chat');assert.equal(turn.turn.review,null);
  await no(b,'/chat/turns/'+request,undefined,404,'not_found');
  const before=await revision(a);await no(a,'/chat/messages',{version:1,requestId:id(),expectedRevision:before,content:'/unpublish '+a.project},503,'unavailable');assert.equal(await revision(a),before);
  await no(a,'/chat/messages',{version:1,requestId:id(),expectedRevision:0,content:'export my chat'},409,'stale_revision');
  await no(a,'/chat/messages',{version:1,requestId:id(),expectedRevision:before,content:'hello',action:{type:'unpublish'}},400,'unknown_field');
 });
 await test('simultaneous same-ID sends create one exact saved turn; lost response is recovered by GET',async()=>{
  const request=id(),rev=await revision(a),result=await Promise.all([send(a,'download my chat',request,rev),send(a,'download my chat',request,rev)]);assert.deepEqual(result[0],result[1]);assert.equal((await row('SELECT count(*) n FROM chat_turns WHERE id=?',request)).n,1);
  assert.equal((await call(a,'/chat/turns/'+request)).turn.revision,rev+1);
 });
 await test('version reads are bounded, private and use existing preview destinations',async()=>{
  const v=await website(a),versions=await call(a,'/projects/'+a.project+'/versions?limit=1');assert.equal(versions.items[0].id,v);assert.equal(versions.items[0].preview.path,'/api/site-versions/'+v+'/preview');
  await no(a,'/projects/'+a.project+'/versions?limit=26',undefined,400,'invalid_request');await no(a,'/projects/'+a.project+'/versions?cursor=bad',undefined,400,'invalid_request');
 });
 await test('exact specification controls require capability, current digest and actual recent passkey',async()=>{
  const q=await proposeFixtureWebsite(a.scope,a.user,a.project,[{type:'content.replace',contentId:'headline',text:'Native reviewed gardens'}],m);
  const reviews=await call(a,'/reviews'),r=reviews.items.find(x=>x.reviewId===q.id);assert(r?.canApprove,JSON.stringify({reviews,detail:await spec.specificationReviewDetails(a.scope,a.user,q.id)}));assert.equal(r.artifact,null);assert.equal(r.requiresFreshPasskey,true);
  const restricted={...client,controls:[]},hidden=(await call(a,'/reviews',undefined,200,{header:restricted})).items.find(x=>x.reviewId===q.id);assert.equal(hidden.canApprove,false);assert.equal(hidden.control,null);
  const body=await confirm(a,r.control);await no(a,'/reviews/confirm',body,426,'client_update_required',{header:restricted});
  await no(a,'/reviews/confirm',{...body,control:{...r.control,proposalDigest:'a'.repeat(64)}},409,'review_unavailable');
  await no(b,'/reviews/confirm',await confirm(b,r.control),409,'review_unavailable');
  const old={...a,...await native(a,-601)},stale=await no(old,'/reviews/confirm',body,401,'proof_required');assert.equal(stale.error.proof,'fresh_passkey');
  const result=await call(a,'/reviews/confirm',body);assert.equal(result.accepted,true);assert.equal((await row('SELECT revision FROM project_spec_heads WHERE project_id=?',a.project)).revision,q.expected_revision+1);
  assert.deepEqual(await call(a,'/reviews/confirm',body),result);await no(a,'/reviews/confirm',await confirm(a,r.control),409,'review_unavailable');
  const saved=await call(a,'/chat/turns/'+body.requestId);assert.equal(saved.turn.revision,result.revision);assert.equal(saved.turn.status,'completed');
 });
 await test('only the four exact native controls are reachable, never equivalent unpublish/disable aliases',async()=>{
  for(const control of [{type:'unpublish',projectId:a.project},{type:'confirm',kind:'backup',reviewId:id()},{type:'shortcut',kind:'project',projectId:a.project},{type:'specificationApply',reviewId:id(),proposalDigest:'a'.repeat(64),expectedRevision:1,command:'/confirm evil'}])await no(a,'/reviews/confirm',await confirm(a,control),400,'unsupported_control');
  const current=await row('SELECT version_id FROM project_spec_heads WHERE project_id=?',a.project),publish=id();assert.equal((await chat.sendChat(a.scope,a.user,{id:publish,revision:await revision(a),content:'/publish '+current.version_id})).status,200);
  const r=(await call(a,'/reviews')).items.find(r=>r.reviewId===publish);assert(r?.canApprove);const body=await confirm(a,r.control);await call(a,'/reviews/confirm',body);assert.equal((await row('SELECT version_id FROM publications WHERE project_id=?',a.project)).version_id,current.version_id);
  const off=id();await chat.sendChat(a.scope,a.user,{id:off,revision:await revision(a),content:'/unpublish '+a.project});assert(!(await call(a,'/reviews')).items.some(r=>r.reviewId===off));await no(a,'/reviews/confirm',await confirm(a,{type:'confirm',kind:'site',reviewId:off}),409,'review_unavailable');
 });
 await test('application review returns complete verified source and exact activation disclosure; disable stays browser-only',async()=>{
  const o=await owner();await enableFixtureVisitorAccess(o.scope,o.user,o.project,{handlers:m});const version=id(),test=id(),source='export default ({state})=>({state,result:null})';
  await backend.saveBackend(o.scope,o.user,o.project,version,source);await backend.testBackend(o.scope,{fetch:async()=>Response.json({ok:true,value:{state:{},result:null}})},o.user,o.project,version,test,{state:{},input:{}});
  const review=id(),prepared=await apps.prepareApplication(o.scope,o.user,o.project,review,'enable',version,test),turn=await origin(o,apps.describeApplicationReview(prepared));await receipts.linkChatReviewReply(o.scope,o.user,turn,apps.describeApplicationReview(prepared));
  const r=(await call(o,'/reviews')).items.find(r=>r.reviewId===review);assert(r?.canApprove);assert.equal(r.artifact.source,source);assert.equal(r.artifact.digest,await m.hashToken(source));assert(r.disclosure.lines.some(x=>x.includes('4 KiB')));
  await call(o,'/reviews/confirm',await confirm(o,r.control));assert.equal((await row('SELECT enabled FROM app_spaces WHERE project_id=?',o.project)).enabled,1);
  const off=id(),disable=await apps.prepareApplication(o.scope,o.user,o.project,off,'disable',null,null),offTurn=await origin(o,apps.describeApplicationReview(disable));await receipts.linkChatReviewReply(o.scope,o.user,offTurn,apps.describeApplicationReview(disable));
  await no(o,'/reviews/confirm',await confirm(o,{type:'confirm',kind:'application',reviewId:off}),409,'review_unavailable');
  const point=id();await recovery.createRecoveryPoint(o.scope,o.user,o.project,point);await apps.confirmApplication(o.scope,o.user,off);
  const restore=id(),preparedRestore=await recovery.prepareAppRestore(o.scope,o.user,o.project,point,restore),restoreTurn=await origin(o,restoreChat.describeAppRestore(preparedRestore));await receipts.linkChatReviewReply(o.scope,o.user,restoreTurn,restoreChat.describeAppRestore(preparedRestore));
  const rr=(await call(o,'/reviews')).items.find(r=>r.reviewId===restore);assert(rr?.canApprove);assert.equal(rr.requiresFreshPasskey,true);
  const stale={...o,...await native(o,-601)};await no(stale,'/reviews/confirm',await confirm(o,rr.control),401,'proof_required');await call(o,'/reviews/confirm',await confirm(o,rr.control));assert.equal((await row('SELECT status FROM app_restore_reviews WHERE id=?',restore)).status,'applied');
 });
 await test('maintained forms keep exact definitions, drafts, receipts, owner checks and capability refusals',async()=>{
  const form=await forms.issueProjectIntake(a.scope,a.user,{originTurnId:await origin(a),template:'choice@1'}),read={version:1,interactionId:form.envelope.id,client:client.interaction};
  assert.equal((await call(a,'/interactions/read',read)).envelope.definitionDigest,form.envelope.definitionDigest);
  await no(b,'/interactions/read',read,404,'not_found');
  await no(a,'/interactions/list',{version:1,projectId:null,limit:20,before:{createdAt:'x'.repeat(5000),interactionId:id()}},400,'invalid_request');
  const reduced={...client,interaction:{...client.interaction,fieldTypes:[]}};await no(a,'/interactions/read',{...read,client:reduced.interaction},426,'client_update_required',{header:reduced});
  await no(a,'/interactions/read',{...read,client:{...client.interaction,fieldTypes:[]}},400,'invalid_request');
  await no(a,'/interactions/mutate',mutate(form),426,'client_update_required',{header:reduced});
  const invalid=await no(a,'/interactions/mutate',mutate(form,'submit',{tone:'invented'}),422,'value');assert.equal(invalid.error.fieldId,'tone');
  const input=mutate(form),before=await revision(a),saved=await call(a,'/interactions/mutate',input);assert.deepEqual(await call(a,'/interactions/mutate',input),saved);
  assert.deepEqual(await call(a,'/interactions/receipt',{version:1,requestId:input.requestId}),saved);assert.equal(await revision(a),before);
  await no(a,'/interactions/mutate',{...input,answers:{tone:'professional'}},409,'request_conflict');await no(b,'/interactions/receipt',{version:1,requestId:input.requestId},404,'not_found');
  const next=await forms.issueProjectIntake(a.scope,a.user,{originTurnId:await origin(a),template:'choice@1'}),cancel=mutate(next,'cancel'),receipt=await call(a,'/interactions/mutate',cancel);
  assert.deepEqual(await call(a,'/interactions/mutate',cancel),receipt);await no(a,'/interactions/read',{version:1,interactionId:next.envelope.id,client:client.interaction},410,'draft_removed');
 });
 await test('resource selection, resumed index and information continuation preserve shared state without hidden effects',async()=>{
  const form=await forms.issueProjectIntake(a.scope,a.user,{originTurnId:await origin(a),template:'project-select@1'}),query={version:1,interactionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,fieldId:'project',limit:2,before:null};
  const options=await call(a,'/interactions/resources',query);assert.equal(options.items.length,2);assert(!options.items.some(x=>x.id===b.project));
  await no(a,'/interactions/mutate',mutate(form,'submit',{project:b.project}),422,'resource_unavailable');
  const input=mutate(form,'submit',{project:a.project});await call(a,'/interactions/mutate',input);
  const current=await call(a,'/interactions/read',{version:1,interactionId:form.envelope.id,client:client.interaction});assert.equal(current.submission.continuation.state,'not-started');
  const index=await call(a,'/interactions/list',{version:1,projectId:null,limit:20,before:null});assert(index.items.some(x=>x.interactionId===form.envelope.id));
  await no(a,'/interactions/continue',{version:1,submissionId:input.requestId,expectedChatRevision:await revision(a)},503,'continuation_unavailable');
  for(const action of ['stop','reconcile'])assert.equal((await call(a,'/interactions/'+action,{version:1,submissionId:input.requestId})).continuation.reason,'stopped');
 });
 await test('unsupported view/card forms refuse read and mutation without downgrade or approval',async()=>{
  const turn=await origin(a),plan=await forms.preparePhotoIntake(a.scope,a.user,{originTurnId:turn,projectId:a.project});await a.scope.batch(plan.statements);
  await no(a,'/interactions/read',{version:1,interactionId:plan.interactionId,client:client.interaction},426,'client_update_required');
  const form=await forms.readInteraction(a.scope,a.user,plan.interactionId);await no(a,'/interactions/mutate',mutate(form,'cancel'),426,'client_update_required');
  assert.equal((await forms.readInteraction(a.scope,a.user,plan.interactionId)).state,'open');
 });
 await test('history beyond the recent window paginates and searches without losing exact saved-turn readback',async()=>{
  const start=await revision(a),stamp=now(),turns=Array.from({length:105},(_,i)=>({id:id(),revision:start+i+1}));
  await db.batch([...turns.map(t=>db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'History needle','Saved plain reply',?,'guided','completed')").bind(t.id,a.user,t.revision,stamp)),db.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(start+105,a.user)]);
  let cursor=null,count=0;do{const page=await call(a,'/chat?limit=50&q=needle'+(cursor?'&cursor='+cursor:''));assert(page.items.every((t,i,list)=>i===0||t.revision>list[i-1].revision));count+=page.items.length;cursor=page.nextCursor;}while(cursor);assert.equal(count,105);
  const first=await call(a,'/chat?limit=1&q=needle');await no(a,'/chat?cursor='+first.nextCursor,undefined,400,'invalid_cursor');await no(b,'/chat?q=needle&cursor='+first.nextCursor,undefined,400,'invalid_cursor');
  assert.equal((await call(a,'/chat/turns/'+turns[0].id)).turn.userText,'History needle');
 });
 await test('revocation at the exact native specification commit rolls back every effect',async()=>{
  const o=await owner();await website(o);const q=await proposeFixtureWebsite(o.scope,o.user,o.project,[{type:'content.replace',contentId:'headline',text:'A fenced native change'}],m),control={type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision},body=await confirm(o,control);let hit=false;
  const guarded=interceptDatabase(db,/INSERT INTO project_spec_applies/,async()=>{if(hit)return;hit=true;await run('DELETE FROM identity_sessions WHERE id=?',o.nativeAuthority);});
  await no(o,'/reviews/confirm',body,409,'identity_changed',{environment:{...env,DB:guarded}});assert(hit);assert.equal(await row('SELECT id FROM project_spec_applies WHERE proposal_id=?',q.id),null);assert.equal(await row('SELECT id FROM site_versions WHERE id=?',body.requestId),null);assert.equal((await row('SELECT revision FROM project_spec_heads WHERE project_id=?',o.project)).revision,q.expected_revision);
 });
 await test('late signout before a project query releases no cached native data',async()=>{
  const o=await owner();let hit=false;
  const guarded=interceptDatabase(db,/FROM project_service_status WHERE owner_user_id=/,async()=>{if(hit)return;hit=true;await run('DELETE FROM identity_sessions WHERE id=?',o.nativeAuthority);});
  await no(o,'/projects',undefined,409,'identity_changed',{environment:{...env,DB:guarded}});assert(hit);
 });
 await Promise.all(background);assert(healthReads>=1);assert.equal(network,0,JSON.stringify(networkCalls));console.log(`mobile-workspace: ${cases} HTTP journeys passed (${process.argv.includes('--d1')?'local D1':'SQLite'}): tenant/cursor/Chat idempotency, four exact reviewed controls, full source, actual fresh proof, information forms/readback/continuation, current capabilities and late revocation; no provider or device acceptance.`);
}finally{globalThis.fetch=previousFetch;await fixture.close();}

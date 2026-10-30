import assert from 'node:assert/strict';
import {timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {authenticator} from './helpers/webauthn-authenticator.mjs';
import {createFixtureWebsite,proposeFixtureWebsite} from './current-site-fixture.mjs';

// WH-084 M2: bootstrap, Chat list/turn/send and review list/confirm of /api/mobile/v1 through the REAL Worker, over the shared mobile-v1
// fixtures, on disposable SQLite and, with --d1, actual local D1. Each operation reuses the web handler; this proves the mapping, the
// request-ID and revision rules, fresh-passkey proof, two-owner isolation and that confirm never reaches the model.
const bundle=await build({stdin:{contents:[
 "export {default as worker} from './src/index';export {androidPasskeyOrigins} from './src/android-signing';",
 "export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';",
 "export {newSessionToken,hashToken} from './src/security';",
 "export {createWebsite,prepareSpecification,readSpecificationProposal} from './src/project-specification/store';export {readChat,sendChat,sendChatControl} from './src/chat';"
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
// A pending exact website-change review (recent passkey required) and a publication review (no passkey), prepared without a model.
async function siteReview(o){
 const scope=await o.scope(),turn=id(),version=(await one('SELECT version_id FROM project_spec_heads WHERE project_id=?',o.project)).version_id;
 assert.equal((await m.sendChat(scope,o.account,{id:turn,revision:await revisionOf(o),content:'/publish '+version})).status,200);
 return {turn,review:(await one('SELECT review_id FROM publication_chat_links WHERE turn_id=?',turn)).review_id,version};
}
const spec=async(o,text)=>{const q=await proposeFixtureWebsite(await o.scope(),o.account,o.project,[{type:'content.replace',contentId:'headline',text}],m);return {q,control:{type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision}};};
const send=(token,content,requestId=id(),expectedRevision=0,client)=>mobile('/chat/messages',{method:'POST',token,client,body:{version:1,requestId,expectedRevision,content}});
const confirm=(token,control,requestId=id(),expectedRevision=0,client)=>mobile('/reviews/confirm',{method:'POST',token,client,body:{version:1,requestId,expectedRevision,control}});
const inference=()=>count('SELECT 1 FROM inference_calls');
try{
 const a=await owner(),b=await owner(),sa=await session(a),sb=await session(b);

 await check('bootstrap: fixture shape; an owner without a project is not onboarded and Chat is refused with onboarding_required',async()=>{
  const r=await mobile('/bootstrap',{token:sa.token});fixtureCall('bootstrap.read',r);
  assert.deepEqual(r.data.onboarding,{complete:true,browserPath:null});assert.equal(r.data.chat.revision,await revisionOf(a));assert.equal(r.data.chat.mode,'guided');assert.equal(r.data.projectCount,1);assert.equal(r.data.pendingReviewCount,0);
  const fresh=await owner({project:false}),sf=await session(fresh);
  const boot=await mobile('/bootstrap',{token:sf.token});assert.equal(boot.status,200,boot.text);assert.deepEqual(boot.data.onboarding,{complete:false,browserPath:'/workspace/'});assert.equal(boot.data.chat,null);
  for(const path of ['/chat','/reviews'])same((await mobile(path,{token:sf.token})).data,errors.onboarding_required.body);
  assert.equal((await mobile('/chat',{token:sf.token})).status,409);
  assert.equal((await mobile('/bootstrap?x=1',{token:sa.token})).status,400);
 });

 await check('chat list: fixture shape, oldest-first, paging by opaque cursor, search, foreign cursor refused',async()=>{
  const r=await mobile('/chat?limit=25',{token:sa.token});fixtureCall('chat.read',r);
  const revisions=r.data.items.map(t=>t.revision);assert.deepEqual(revisions,[...revisions].sort((x,y)=>x-y));assert.equal(r.data.revision,await revisionOf(a));
  const turns=await count('SELECT 1 FROM chat_turns WHERE user_id=?',a.account);assert.equal(r.data.items.length,Math.min(turns,25));
  const reply=await send(sa.token,'export my chat',id(),r.data.revision);assert.equal(reply.status,200,reply.text);
  const all=(await mobile('/chat',{token:sa.token})).data.items,last=all.length;
  const one1=await mobile('/chat?limit=1',{token:sa.token});assert.equal(one1.data.items.length,1);assert.equal(one1.data.items[0].id,all[last-1].id);assert.equal(typeof one1.data.nextCursor,'string');
  const older=await mobile('/chat?limit=1&cursor='+one1.data.nextCursor,{token:sa.token});assert.equal(older.status,200,older.text);assert.equal(older.data.items[0].id,all[last-2].id);
  const found=await mobile('/chat?q=Neighborhood',{token:sa.token});assert.equal(found.status,200,found.text);
  assert.equal((await mobile('/chat?cursor='+one1.data.nextCursor,{token:sb.token})).status,400);
  same((await mobile('/chat?cursor='+one1.data.nextCursor,{token:sb.token})).data,errors.invalid_cursor.body);
  assert.equal((await mobile('/chat?cursor=@@',{token:sa.token})).status,400);
  assert.equal((await mobile('/chat?limit=51',{token:sa.token})).status,400);
  assert.equal((await mobile('/chat?x=1',{token:sa.token})).status,400);
  assert.equal((await mobile('/chat',{token:sb.token})).data.items.every(t=>!all.some(x=>x.id===t.id)),true,'owner B never sees owner A turns');
 });

 await check('chat turn: fixture shape, foreign and unknown ids are not_found',async()=>{
  const own=(await mobile('/chat',{token:sa.token})).data.items.at(-1),r=await mobile('/chat/turns/'+own.id,{token:sa.token});
  assert.equal(r.status,200,r.text);shaped(r.data,operations['chat.turn'].response.body);assert.equal(r.data.turn.id,own.id);
  for(const [token,turn] of [[sb.token,own.id],[sa.token,id()]]){const miss=await mobile('/chat/turns/'+turn,{token});assert.equal(miss.status,404);same(miss.data,errors.not_found.body);}
  assert.equal((await mobile('/chat/turns/not-an-id',{token:sa.token})).status,404);
 });

 await check('send message: fixture shape, same-ID replay is the original result, a different payload is request_conflict',async()=>{
  const before=await inference(),requestId=id(),revision=await revisionOf(a);
  const first=await send(sa.token,'export my chat',requestId,revision);fixtureCall('chat.send',first);
  assert.equal(first.data.requestId,requestId);assert.equal(first.data.accepted,true);assert.equal(first.data.revision,revision+1);assert.equal(first.data.turnStatus,'completed');
  const turns=await count('SELECT 1 FROM chat_turns WHERE user_id=?',a.account);
  const replay=await send(sa.token,'export my chat',requestId,revision);same(replay.data,first.data);assert.equal(await count('SELECT 1 FROM chat_turns WHERE user_id=?',a.account),turns,'a replay writes nothing');
  const conflict=await send(sa.token,'download my chat',requestId,revision);assert.equal(conflict.status,409);same(conflict.data,errors.request_conflict.body);
  const read=await mobile('/chat/turns/'+requestId,{token:sa.token});assert.equal(read.data.turn.status,'completed','the lost-reply readback exposes the committed turn');
  assert.equal(await inference(),before);
 });

 await check('send message: a stale revision returns stale_revision with the current one; a pending reply is chat_busy; no model is unavailable',async()=>{
  const stale=await send(sa.token,'export my chat',id(),0);assert.equal(stale.status,409);
  same(stale.data,{...errors.stale_revision.body,error:{...errors.stale_revision.body.error,currentRevision:await revisionOf(a)}});
  const noModel=await send(sa.token,'Add a ceramic coating service.',id(),await revisionOf(a));assert.equal(noModel.status,503);same(noModel.data,errors.unavailable.body);
  const rev=await revisionOf(b),pending=id();
  await db.batch([db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Hello','',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'ai','pending')").bind(pending,b.account,rev+1),db.prepare('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?').bind(b.account)]);
  const busy=await send(sb.token,'export my chat',id(),rev+1);assert.equal(busy.status,409);same(busy.data,errors.chat_busy.body);
  const turn=await mobile('/chat/turns/'+pending,{token:sb.token});assert.equal(turn.data.turn.status,'pending');assert.equal(turn.data.turn.assistantText,null);
  await run("UPDATE chat_turns SET status='completed',assistant_text='Done' WHERE id=?",pending);
  for(const bad of [{content:''},{content:'x'.repeat(1001)},{requestId:'nope'},{expectedRevision:-1},{extra:1}])assert.equal((await mobile('/chat/messages',{method:'POST',token:sa.token,body:{version:1,requestId:id(),expectedRevision:1,content:'hi',...bad}})).status,400);
 });

 await check('a request ID is global to the turn: owner B cannot read, replay or overwrite owner A turn with it',async()=>{
  const mine=(await mobile('/chat',{token:sa.token})).data.items.at(-1),text=mine.userText;
  const attempt=await send(sb.token,text,mine.id,await revisionOf(b));assert.notEqual(attempt.status,200,attempt.text);assert(!attempt.text.includes(mine.assistantText??'\u0000nothing'));
  assert.equal((await one('SELECT user_text FROM chat_turns WHERE id=?',mine.id)).user_text,text);assert.equal((await one('SELECT user_id FROM chat_turns WHERE id=?',mine.id)).user_id,a.account);
 });

 await check('review list: a pending exact review with server-issued metadata; owner B sees none; an undeclared capability disables it',async()=>{
  const empty=await mobile('/reviews',{token:sa.token});assert.equal(empty.status,200,empty.text);assert.deepEqual(empty.data.items,[]);
  const {q,control}=await spec(a,'Seasonal garden care');
  const r=await mobile('/reviews',{token:sa.token});fixtureCall('review.list',r);
  const item=r.data.items[0];assert.equal(item.reviewId,q.id);assert.equal(item.kind,'specification');assert.equal(item.state,'pending');assert.equal(item.canApprove,true);assert.deepEqual(item.control,control);
  assert.equal(item.requiresFreshPasskey,true);assert.equal(item.unavailableReason,null);assert.equal(item.preview.path,`/api/specification-reviews/${q.id}/preview`);assert.equal(item.project.id,a.project);
  assert.equal(r.data.denied,0);assert.equal(r.data.unavailable,0);
  assert.deepEqual((await mobile('/reviews',{token:sb.token})).data.items,[],'owner B sees none of owner A reviews');
  const old=await mobile('/reviews',{token:sa.token,client:clientWith({controls:['site.confirm']})});
  assert.equal(old.data.items[0].canApprove,false);assert.equal(old.data.items[0].control,null);assert.equal(old.data.items[0].unavailableReason,'client_update_required');
  assert.equal((await mobile('/bootstrap',{token:sa.token})).data.pendingReviewCount,1);
  const inChat=(await mobile('/chat/turns/'+q.id,{token:sa.token})).data.turn.review;assert.deepEqual(inChat,item);
  assert.equal((await mobile('/chat/turns/'+q.id,{token:sb.token})).status,404,'owner B cannot read owner A review turn');
 });

 await check('confirm without a fresh passkey: proof_required fresh_passkey, nothing changes, the model is untouched; stale and handoff proof never count',async()=>{
  const {q,control}=await spec(a,'Fresh passkey garden');
  const stale=await session(a,{proofAge:3000}),handoff=await session(a,{proofAge:5,method:'handoff'}),requestId=id();
  const versions=await count('SELECT 1 FROM project_spec_applies WHERE project_id=?',a.project),before=await inference(),turns=await count('SELECT 1 FROM chat_turns WHERE user_id=?',a.account);
  for(const s of [stale,handoff]){
   const r=await confirm(s.token,control,requestId,await revisionOf(a));assert.equal(r.status,401);same(r.data,errors.proof_required_fresh.body);
  }
  assert.equal(await count('SELECT 1 FROM project_spec_applies WHERE project_id=?',a.project),versions);assert.equal(await count('SELECT 1 FROM chat_turns WHERE user_id=?',a.account),turns);assert.equal(await inference(),before);
  assert.equal((await mobile('/session',{token:handoff.token})).data.session.freshUntil,null,'a handoff session reports no freshness');
  // Reauthenticate the stale session with a real passkey assertion, then retry the SAME request ID.
  const options=await mobile('/session/reauth/options',{method:'POST',token:stale.token,body:{version:1}});assert.equal(options.status,200,options.text);
  const done=await mobile('/session/reauth/verify',{method:'POST',token:stale.token,body:{version:1,challengeId:options.data.challengeId,credential:a.assert(options.data.options)}});assert.equal(done.status,200,done.text);
  const ok=await confirm(stale.token,control,requestId,await revisionOf(a));fixtureCall('review.confirm',ok);
  assert.equal(ok.data.requestId,requestId);assert.equal(ok.data.turnStatus,'completed');assert.equal(await count('SELECT 1 FROM project_spec_applies WHERE project_id=?',a.project),versions+1);assert.equal(await inference(),before,'confirm never calls the model');
  // Reply lost: the readback exposes the committed turn and the review as applied.
  const read=await mobile('/chat/turns/'+requestId,{token:stale.token}).then(r=>r.data.turn);assert.equal(read.status,'completed');assert.equal(read.review.state,'applied');assert.equal(read.review.canApprove,false);assert.equal(read.review.control,null);assert.equal(read.review.reviewId,q.id);
  const replay=await confirm(stale.token,control,requestId,ok.data.revision-1);same(replay.data,ok.data);assert.equal(await count('SELECT 1 FROM project_spec_applies WHERE project_id=?',a.project),versions+1,'a replay applies nothing twice');
  const conflict=await confirm(stale.token,{...control,expectedRevision:control.expectedRevision+1},requestId,ok.data.revision-1);assert.equal(conflict.status,409);
  assert.deepEqual((await mobile('/reviews',{token:sa.token})).data.items.filter(i=>i.reviewId===q.id),[],'an applied review leaves the pending list');
 });

 await check('confirm: a publication review needs no fresh passkey; replay and conflict; foreign owner cannot confirm it',async()=>{
  const {turn,review}=await siteReview(a),control={type:'confirm',kind:'site',reviewId:review};
  const view=(await mobile('/chat/turns/'+turn,{token:sa.token})).data.turn.review;
  assert.equal(view.kind,'site');assert.equal(view.canApprove,true);assert.equal(view.requiresFreshPasskey,false);assert.deepEqual(view.control,control);assert.match(view.preview.path,/^\/api\/site-versions\/[0-9a-f-]{36}\/preview$/);
  const handoff=await session(a,{proofAge:5,method:'handoff'}),before=await inference(),requestId=id(),revision=await revisionOf(a);
  // B holds a valid session, but this is not B's review: nothing is published.
  const pub=async()=>JSON.stringify(await one('SELECT * FROM publications WHERE project_id=?',a.project)),pubBefore=await pub();
  const foreign=await confirm(sb.token,control,id(),await revisionOf(b));
  assert.equal(await one('SELECT status FROM publication_actions WHERE id=?',review).then(r=>r.status),'pending','owner B cannot apply owner A review');assert.equal(await pub(),pubBefore);
  assert.equal((await mobile('/chat/turns/'+turn,{token:sb.token})).status,404);assert.notEqual(foreign.status,500,foreign.text);
  const ok=await confirm(handoff.token,control,requestId,revision);fixtureCall('review.confirm',ok);assert.equal(ok.data.revision,revision+1);
  assert.equal(await one('SELECT status FROM publication_actions WHERE id=?',review).then(r=>r.status),'applied');assert.notEqual(await pub(),pubBefore);assert.equal(await inference(),before);
  const read=(await mobile('/chat/turns/'+requestId,{token:sa.token})).data.turn;assert.equal(read.review.state,'applied');assert.equal(read.review.kind,'site');
  same((await confirm(handoff.token,control,requestId,revision)).data,ok.data);
  const conflict=await confirm(handoff.token,{...control,reviewId:id()},requestId,revision);assert.equal(conflict.status,409);same(conflict.data,errors.request_conflict.body);
 });

 await check('confirm: stale revision, unsupported controls, undeclared capability and bad bodies are refused',async()=>{
  const {control}=await spec(a,'Another garden headline'),s=await session(a);
  const stale=await confirm(s.token,control,id(),0);assert.equal(stale.status,409);assert.equal(stale.data.error.code,'stale_revision');assert.equal(stale.data.error.currentRevision,await revisionOf(a));
  for(const unsupported of [{type:'unpublish'},{type:'confirm',kind:'backup',reviewId:id()},{type:'shortcut',kind:'project',projectId:id()},{type:'githubGrant',operation:'cancel',reviewId:id()},{type:'reviewDetail',kind:'backend',targetId:id()}]){
   const r=await confirm(s.token,unsupported,id(),await revisionOf(a));assert.equal(r.status,400);same(r.data,errors.unsupported_control.body);
  }
  assert.equal((await confirm(s.token,{type:'specificationApply',reviewId:'x'},id(),0)).status,400);
  assert.equal((await confirm(s.token,'/confirm x',id(),0)).status,400);
  const undeclared=await confirm(s.token,control,id(),await revisionOf(a),clientWith({controls:['site.confirm']}));assert.equal(undeclared.status,426);assert.equal(undeclared.data.error.code,'client_update_required');
  assert.equal((await mobile('/reviews/confirm',{method:'POST',token:s.token,body:{version:1,requestId:id(),expectedRevision:1}})).status,400);
 });

 await check('routing: bearer only, cookies and web tokens refused, unknown or wrong-method routes are not_found',async()=>{
  for(const [path,method] of [['/bootstrap','GET'],['/chat','GET'],['/reviews','GET'],['/chat/messages','POST'],['/reviews/confirm','POST']]){
   const r=await mobile(path,{method,body:method==='POST'?{version:1}:undefined});assert.equal(r.status,401,path);same(r.data,errors.proof_required_signin.body);
   assert.equal((await mobile(path,{method,token:sa.token,headers:{cookie:'__Host-whumpo_session='+sa.token},body:method==='POST'?{version:1}:undefined})).status,400,path+' cookie');
   assert.equal((await mobile(path,{method,token:sa.token,client:null,body:method==='POST'?{version:1}:undefined})).status,400,path+' client header');
  }
  assert.equal((await mobile('/bootstrap',{method:'POST',token:sa.token,body:{version:1}})).status,404);
  assert.equal((await mobile('/reviews/confirm',{token:sa.token})).status,404);
  const webCookie=await m.worker.fetch(new Request('https://whumpo.com/api/mobile/v1/bootstrap',{headers:{'whumpo-client':clientHeader,authorization:'Bearer '+'0'.repeat(64)}}),env,ctx);assert.equal(webCookie.status,401);
  assert.equal((await mobile('/bootstrap',{token:sa.token,client:clientWith({build:39})})).status,426);
 });

 console.log(`Mobile slice M2: ${cases} checks over the six operations on ${process.argv.includes('--d1')?'local D1':'SQLite'}.`);
}catch(error){console.error(error);process.exitCode=1;}
finally{await fixture.close();}

import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject,changeFixtureWebsite,enableFixtureVisitorAccess} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {fixtureKeyring,initializeFixtureKeys} from './helpers/connection-keyring.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
// WH-212 / D-5: with no model binding, a Chat-prepared review is confirmed the way Saved work does it:
// a fresh read of `/api/chat/turns/:id`, then the existing `/api/chat/actions` confirm using that turn's own
// revision as the conversation fence. No Chat read, no model, no second approval path.
//
// Coverage by `confirmationControls` kind (src/chat-controls.ts, 18 kinds):
//  Covered, prepared by a typed command and confirmed locally:
//   site, application (first sections), then version, photo, contact, contactNotification, domainProof, directory,
//   backendForm, backendPublication, backendState, cmsSetup (the per-kind table below, each with one negative control).
//  Also covered at the end (D6): appPage (prepared by the scripted-model harness, confirmed model-free) and backup
//   (GitHub provider boundary stubbed through global fetch), each with stale and foreign negative controls.
//  NOT covered, owner-deferred CMS testing (D6):
//   cmsImport     prepare reads a live WordPress site.
//   cmsPublish, cmsUnpublish, cmsDiscard   prepare reads the live EmDash/WordPress CMS instance and its staged content.
//  The dashboard /confirm-dns and /confirm-hosting routes and the appMaintenance controls are out of scope here.
// Run `node tests/saved-review-confirm-outage.mjs` (SQLite) or add `--d1`.
const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db;
const calls={n:0},service={fetch:async(_url,init)=>{calls.n++;const d=JSON.parse(init.body);return Response.json({ok:true,value:d.input?.state?{state:{count:(d.input.state.count??0)+(d.input.input.add??1)},result:'prepared'}:d.input});}};
const env={DB:db,BACKEND_RUNTIME:service,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}};
const origin='https://whumpo.com';
let checks=0;
const equal=(a,b,msg)=>{assert.equal(a,b,msg);checks++;};
async function http(account,path,method='GET',body){
 const response=await m.worker.fetch(new Request(origin+path,{method,headers:{origin,'content-type':'application/json',cookie:'__Host-whumpo_session='+account.token},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{waitUntil:()=>{}});
 return {status:response.status,json:await response.json().catch(()=>null)};
}
const count=async(sql,...values)=>(await db.prepare(sql).bind(...values).first()).n;
const published=project=>db.prepare('SELECT version_id,revision FROM publications WHERE project_id=?').bind(project).first().then(row=>row??null);
const served=project=>m.host.fetch(new Request('https://'+project+'.whumpo.site/'),{DB:db});
async function review(account,name){
 const scope=await account.scope(),{project,version}=await createFixtureProject(scope,account.account,name,'A synthetic website.');
 const id=crypto.randomUUID(),state=await m.readChat(scope,account.account);
 equal((await m.sendChat(scope,account.account,{id,revision:state.state.revision,content:'/publish '+version})).status,200,name+' review prepared without a model');
 return {project,version,id,scope};
}
// What Saved work does: read the turn fresh, keep only its own revision and review id.
const read=async(account,id)=>{const r=await http(account,'/api/chat/turns/'+id);return {status:r.status,turn:r.json?.turn};};
const control=reviewId=>({type:'confirm',kind:'site',reviewId});
try{
 const owner=await workspaceFixture(db,m),foreign=await workspaceFixture(db,m);
 const a=await review(owner,'Alpha');let modelCalls=await count('SELECT count(*) n FROM inference_calls');
 await createFixtureProject(await foreign.scope(),foreign.account,'Beta','A synthetic beta website.');

 // Cross-owner: the foreign account cannot read the turn or use the review.
 equal((await read(foreign,a.id)).status,404,'A foreign account cannot read the saved turn');
 const fs=(await http(foreign,'/api/chat')).json.state.revision;
 const wrong=await http(foreign,'/api/chat/actions','POST',{id:crypto.randomUUID(),revision:fs,action:control(a.id)});
 assert.ok(wrong.status!==200||/No matching|not found|expired|unavailable/i.test(JSON.stringify(wrong.json)));checks++;
 equal((await served(a.project)).status,404,'Foreign attempt published nothing');

 // Not offered: no prepare control exists, and typed prepare needs the model.
 const fresh=await read(owner,a.id);equal(fresh.status,200,'Fresh read of the saved turn');
 assert.equal(fresh.turn.confirmation_id,a.id);checks++;
 for(const action of [{type:'firstDraft',projectId:a.project},{type:'prepare',kind:'site',projectId:a.project}])
  equal((await http(owner,'/api/chat/actions','POST',{id:crypto.randomUUID(),revision:fresh.turn.revision,action})).status,400,'No model-free prepare control: '+action.type);
 equal((await http(owner,'/api/chat','POST',{id:crypto.randomUUID(),revision:fresh.turn.revision,content:'/first-draft '+a.project})).status,503,'Typed prepare needs the model');

 // Stale: the conversation moved on after the read, so the old revision is refused and nothing publishes.
 const shortcut=await http(owner,'/api/chat/actions','POST',{id:crypto.randomUUID(),revision:(await http(owner,'/api/chat')).json.state.revision,action:{type:'shortcut',kind:'versions',projectId:a.project}});
 equal(shortcut.status,200,'Conversation advances');
 const stale=await http(owner,'/api/chat/actions','POST',{id:crypto.randomUUID(),revision:fresh.turn.revision,action:control(a.id)});
 equal(stale.status,409,'A stale revision is refused');
 equal((await published(a.project))?.version_id??null,null,'Stale refusal published nothing');

 // A different review id at the latest revision approves nothing.
 await http(owner,'/api/chat/actions','POST',{id:crypto.randomUUID(),revision:(await http(owner,'/api/chat')).json.state.revision,action:control(crypto.randomUUID())});
 equal((await served(a.project)).status,404,'An unknown review id publishes nothing');
 // A new review that is the latest message: confirm once from the fresh read; a different review id is refused.
 const b=await review(owner,'Gamma'),read2=await read(owner,b.id);
 equal((await served(b.project)).status,404,'Still private');
 const requestId=crypto.randomUUID(),body={id:requestId,revision:read2.turn.revision,action:control(b.id)};
 equal((await http(owner,'/api/chat/actions','POST',body)).status,200,'Confirm from the fresh read succeeds without the model');
 const live=await published(b.project);equal(live.version_id,b.version,'The exact reviewed version is live');equal((await served(b.project)).status,200,'Public');

 // Lost reply: the retry reuses the request ID and replays the receipt without a second effect.
 equal((await http(owner,'/api/chat/actions','POST',body)).status,200,'Same-ID retry reads the saved result');
 equal(await count('SELECT count(*) n FROM chat_turns WHERE id=?',requestId),1,'No duplicate turn');
 equal(JSON.stringify(await published(b.project)),JSON.stringify(live),'No duplicate effect');
 // A fresh request ID after the commit is refused (revision moved), so reload never re-approves.
 equal((await http(owner,'/api/chat/actions','POST',{...body,id:crypto.randomUUID()})).status,409,'A new request after the commit is refused');
 // Second kind (application): the model-free /enable-application command prepares it; same fresh-read confirm path.
 const scope=await owner.scope(),app=crypto.randomUUID(),program=crypto.randomUUID(),run=crypto.randomUUID(),now=new Date().toISOString();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Notebook','','draft',?,?)").bind(app,owner.account,now,now).run();
 await m.backend.saveBackend(scope,owner.account,app,program,'export default ({state,input})=>({state:input,result:"saved"})');
 await m.backend.testBackend(scope,{fetch:()=>Response.json({ok:true,value:{state:{},result:'saved'}})},owner.account,app,program,run,{state:{},input:{}});
 await enableFixtureVisitorAccess(scope,owner.account,app);
 const enabled=async()=>(await db.prepare('SELECT enabled FROM app_spaces WHERE project_id=?').bind(app).first())?.enabled??0;
 const prepare=async()=>{const id=crypto.randomUUID();equal((await m.sendChat(scope,owner.account,{id,revision:(await m.readChat(scope,owner.account)).state.revision,content:`/enable-application ${program} ${run}`})).status,200,'Application review prepared without a model');return id;};
 const staleApp=await prepare(),staleRead=await read(owner,staleApp);
 equal(staleRead.turn.application_confirmation_id,staleApp,'Fresh read offers the application review');
 const appControl=reviewId=>({type:'confirm',kind:'application',reviewId});
 await http(owner,'/api/chat/actions','POST',{id:crypto.randomUUID(),revision:(await http(owner,'/api/chat')).json.state.revision,action:{type:'shortcut',kind:'versions',projectId:a.project}});
 equal((await http(owner,'/api/chat/actions','POST',{id:crypto.randomUUID(),revision:staleRead.turn.revision,action:appControl(staleApp)})).status,409,'A stale application revision is refused');
 equal(await enabled(),0,'Stale refusal enabled nothing');
 const appId=await prepare(),appRead=await read(owner,appId),appBody={id:crypto.randomUUID(),revision:appRead.turn.revision,action:appControl(appId)};
 equal(appRead.turn.application_confirmation_id,appId,'Latest application review is offered');equal(await enabled(),0,'Still disabled before confirm');
 // Digest mismatch. Site reviews have no chat_review_receipts row (their gate is publication_actions), so this uses
 // the application kind: change the stored reply away from reply_digest and the turn offers and honours nothing.
 const original=(await db.prepare('SELECT assistant_text t FROM chat_turns WHERE id=?').bind(appId).first()).t;
 await db.prepare('UPDATE chat_turns SET assistant_text=? WHERE id=?').bind(original+' (altered)',appId).run();
 const altered=await read(owner,appId);equal(altered.status,200,'Altered turn still reads');
 equal(altered.turn.application_confirmation_id??null,null,'Digest mismatch offers no confirm control');
 // POST /api/chat/actions re-checks chat_review_receipts.reply_digest, so an altered reply confirms nothing.
 const refused=await http(owner,'/api/chat/actions','POST',{id:crypto.randomUUID(),revision:altered.turn.revision,action:appControl(appId)});
 equal(refused.status,409,'Digest mismatch must not confirm');
 equal(await enabled(),0,'Digest mismatch enabled nothing');
 await db.prepare('UPDATE chat_turns SET assistant_text=? WHERE id=?').bind(original,appId).run();
 equal((await read(owner,appId)).turn.application_confirmation_id,appId,'Restored reply offers the control again');
 equal((await http(owner,'/api/chat/actions','POST',appBody)).status,200,'Application confirm succeeds without the model');equal(await enabled(),1,'Application is enabled');
 equal((await http(owner,'/api/chat/actions','POST',appBody)).status,200,'Same-ID application retry reads the saved result');
 equal(await count('SELECT count(*) n FROM chat_turns WHERE id=?',appBody.id),1,'No duplicate application turn');
 equal(await count('SELECT count(*) n FROM app_spaces WHERE project_id=? AND enabled=1',app),1,'No duplicate application effect');
 // Every other locally preparable kind: typed prepare, fresh read, confirm with the turn's own revision, same-ID replay,
 // zero inference calls, and one negative control per kind (stale, foreign, expired or digest mismatch).
 const jid=()=>crypto.randomUUID(),stamp=()=>new Date().toISOString();
 const atPast=async(ms,fn)=>{const clock=Date.now;Date.now=()=>clock()-ms;try{return await fn();}finally{Date.now=clock;}};
 const typed=async(o,content)=>{const id=jid(),r=await m.sendChat(await o.scope(),o.account,{id,revision:(await http(o,'/api/chat')).json.state.revision,content},undefined,{backendRuntime:service});equal(r.status,200,'Prepared by typed command: '+content.split(' ')[0]);return id;};
 const confirmSite=async(o,version)=>{const id=await typed(o,'/publish '+version),t=await read(o,id);equal((await http(o,'/api/chat/actions','POST',{id:jid(),revision:t.turn.revision,action:{type:'confirm',kind:'site',reviewId:id}})).status,200,'Site published for the fixture');};
 const site=async(o,publish=true)=>{const created=await createFixtureProject(await o.scope(),o.account,'Kind '+jid().slice(0,6),'A synthetic website.');if(publish)await confirmSite(o,created.version);return created;};
 const backend=async(o,source='export default x=>x')=>{const s=await o.scope(),created=await site(o),b=jid(),r=jid();await m.backend.saveBackend(s,o.account,created.project,b,source);await m.backend.testBackend(s,service,o.account,created.project,b,r,{});return {...created,backend:b,run:r};};
 const kinds=[
  {kind:'version',table:'version_removals',negative:'foreign',setup:async o=>{const c=await site(o,false);await changeFixtureWebsite(await o.scope(),o.account,c.project,[{type:'content.replace',contentId:'headline',text:'Second draft'}]);return c;},prepare:(o,c)=>typed(o,'/delete-version '+c.version)},
  {kind:'photo',table:'photo_removals',negative:'stale',setup:site,prepare:async(o,c)=>{const f=jid();await db.prepare("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,created_at) VALUES(?,?,'Pending',?,'fixture',10,1,1,?)").bind(f,c.project,`photos/${c.project}/${f}.jpg`,stamp()).run();return typed(o,'/delete-photo '+f);}},
  {kind:'contact',table:'contact_reviews',negative:'expired',setup:site,prepare:(o,c)=>typed(o,'/contact-on '+c.project)},
  {kind:'contactNotification',table:'contact_destination_reviews',negative:'digest',setup:site,prepare:(o,c)=>typed(o,'/contact-notify '+c.project+' owner@example.com')},
  {kind:'domainProof',table:'domain_proof_removals',negative:'expired',setup:site,prepare:async(o,c)=>{c.claim??=await typed(o,`/domain www.${jid().slice(0,8)}.example.com ${c.project}`);return typed(o,'/remove-domain-proof '+c.claim);}},
  {kind:'directory',table:'directory_reviews',negative:'digest',setup:site,prepare:(o,c)=>typed(o,`/directory-add ${c.project} | Garden club | Saturday mornings | https://example.com/`)},
  {kind:'backendForm',table:'backend_form_reviews',negative:'stale',setup:async o=>{const c=await backend(o),p=jid(),s=await o.scope();await m.backendPublication.prepareBackendPublication(s,o.account,c.project,p,'publish',c.backend,c.run);await m.backendPublication.confirmBackendPublication(s,o.account,p);return c;},prepare:(o,c)=>typed(o,'/configure-backend-form '+c.project+' '+JSON.stringify({title:'Estimate',description:'Try it.',buttonLabel:'Go',fields:[{key:'quantity',label:'Quantity',type:'number'}]}))},
  {kind:'backendPublication',table:'backend_publication_reviews',negative:'digest',setup:backend,prepare:(o,c)=>typed(o,`/publish-backend ${c.backend} ${c.run}`)},
  {kind:'backendState',table:'backend_state_reviews',pending:'ready',negative:'digest',setup:o=>backend(o,'export default ({state,input})=>({state:{count:(state.count??0)+input.add},result:null})'),prepare:(o,c)=>typed(o,`/review-backend-state ${c.backend} {"add":5}`)},
  {kind:'cmsSetup',done:'approved',table:'cms_setup_reviews',negative:'foreign',setup:o=>site(o,false),prepare:(o,c)=>typed(o,`/setup-cms ${c.project} | Blog | Our updates`)},
 ];
 for(const k of kinds){
  const o=await workspaceFixture(db,m),other=await workspaceFixture(db,m),c=await k.setup(o),label=k.kind+': ',_=await createFixtureProject(await other.scope(),other.account,'Foreign','A synthetic foreign website.'),spent=await count('SELECT count(*) n FROM inference_calls');
  const status=async id=>(await db.prepare(`SELECT status s FROM ${k.table} WHERE id=?`).bind(id).first())?.s??null;
  const post=async(who,revision,reviewId,id=jid())=>{const body={id,revision,action:{type:'confirm',kind:k.kind,reviewId}};return {body,res:await http(who,'/api/chat/actions','POST',body)};};
  const latest=who=>http(who,'/api/chat').then(r=>r.json.state.revision);
  const open=async id=>{const t=await read(o,id);equal(t.status,200,label+'fresh read');equal(t.turn.id,id,label+'fresh read returns the prepared turn');return t.turn.revision;};
  let id;
  if(k.negative==='stale'){
   id=await k.prepare(o,c);const rev=await open(id);
   equal((await http(o,'/api/chat/actions','POST',{id:jid(),revision:await latest(o),action:{type:'shortcut',kind:'versions',projectId:c.project}})).status,200,label+'conversation advances');
   equal((await post(o,rev,id)).res.status,409,label+'stale revision refused');equal(await status(id),k.pending??'pending',label+'stale refusal applied nothing');
   id=await k.prepare(o,c);
  }else if(k.negative==='expired'){
   const old=await atPast(700000,()=>k.prepare(o,c)),rev=await open(old);
   await post(o,rev,old);equal(await status(old),k.pending??'pending',label+'expired review applied nothing');
   id=await k.prepare(o,c);
  }else{
   id=await k.prepare(o,c);
   if(k.negative==='foreign'){
    equal((await read(other,id)).status,404,label+'foreign account cannot read the turn');
    await post(other,await latest(other),id);equal(await status(id),k.pending??'pending',label+'foreign confirm applied nothing');
   }else{
    const original=(await db.prepare('SELECT assistant_text t FROM chat_turns WHERE id=?').bind(id).first()).t;
    await db.prepare('UPDATE chat_turns SET assistant_text=? WHERE id=?').bind(original+' (altered)',id).run();
    equal((await post(o,await open(id),id)).res.status,409,label+'digest mismatch refused');equal(await status(id),k.pending??'pending',label+'digest mismatch applied nothing');
    await db.prepare('UPDATE chat_turns SET assistant_text=? WHERE id=?').bind(original,id).run();
   }
  }
  const confirmation=await post(o,await open(id),id);equal(confirmation.res.status,200,label+'confirm from the fresh read');
  equal(await status(id),k.done??'applied',label+'review applied');
  const events=await count('SELECT count(*) n FROM activity_events WHERE user_id=?',o.account),turns=await count('SELECT count(*) n FROM chat_turns WHERE user_id=?',o.account),runs=calls.n;
  equal((await http(o,'/api/chat/actions','POST',confirmation.body)).status,200,label+'same-ID replay reads the saved result');
  equal(await count('SELECT count(*) n FROM activity_events WHERE user_id=?',o.account),events,label+'replay ran no second effect');
  equal(await count('SELECT count(*) n FROM chat_turns WHERE user_id=?',o.account),turns,label+'replay added no turn');equal(calls.n,runs,label+'replay ran no backend');
  equal(await count('SELECT count(*) n FROM inference_calls'),spent,label+'no inference call');
 }
 // appPage: the only prepare path is the scripted model (/design-app-page); the confirm that follows is model-free.
 {
  const o=await workspaceFixture(db,m),other=await workspaceFixture(db,m),s=await o.scope(),p=jid(),v=jid(),t=jid(),rv=jid(),label='appPage: ';
  await createFixtureProject(await other.scope(),other.account,'Foreign','A synthetic foreign website.');
  const form={title:'Private notebook',description:'A private note',buttonLabel:'Save note',fields:[{key:'note',label:'Your note',type:'text'}]};
  await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Private notebook','A private note','draft',?,?)").bind(p,o.account,stamp(),stamp()).run();
  await m.backend.saveBackend(s,o.account,p,v,'export default ({input})=>({state:{note:input.note},result:"Saved"})');
  await m.backend.testBackend(s,{fetch:async()=>Response.json({ok:true,value:{state:{},result:'Saved'}})},o.account,p,v,t,{state:{},input:{note:'x'}});
  await enableFixtureVisitorAccess(s,o.account,p);
  await m.appActivation.prepareApplication(s,o.account,p,rv,'enable',v,t);await m.appActivation.confirmApplication(s,o.account,rv);
  const ai={baseURL:'https://opencode.ai/zen/go/v1',apiKey:'synthetic',model:'muse-spark-1.3-contributor',protocol:'responses'};
  const scripted=async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'Proposed page',action:{kind:'backend',operation:'reviewAppPage',projectId:p,form}})}]}],usage:{input_tokens:10,output_tokens:10}});
  const prepare=async()=>{const id=jid();equal((await m.sendAIChat(s,o.account,id,(await http(o,'/api/chat')).json.state.revision,'/design-app-page '+p,ai,scripted,undefined,true)).status,200,label+'prepared by the scripted model');return id;};
  const status=async id=>(await db.prepare('SELECT status s FROM app_page_reviews WHERE id=?').bind(id).first())?.s??null;
  const post=async(who,revision,reviewId,id=jid())=>{const body={id,revision,action:{type:'confirm',kind:'appPage',reviewId}};return {body,res:await http(who,'/api/chat/actions','POST',body)};};
  const stale=await prepare(),staleRead=await read(o,stale);
  equal(staleRead.turn.app_page_confirmation_id,stale,label+'fresh read offers the review');
  equal((await http(o,'/api/chat/actions','POST',{id:jid(),revision:(await http(o,'/api/chat')).json.state.revision,action:{type:'shortcut',kind:'versions',projectId:a.project}})).status,200,label+'conversation advances');
  equal((await post(o,staleRead.turn.revision,stale)).res.status,409,label+'stale revision refused');equal(await status(stale),'pending',label+'stale refusal applied nothing');
  const id=await prepare();modelCalls=await count('SELECT count(*) n FROM inference_calls');
  equal((await read(other,id)).status,404,label+'foreign account cannot read the turn');
  await post(other,(await http(other,'/api/chat')).json.state.revision,id);equal(await status(id),'pending',label+'foreign confirm applied nothing');
  const confirmation=await post(o,(await read(o,id)).turn.revision,id);equal(confirmation.res.status,200,label+'confirm from the fresh read');equal(await status(id),'applied',label+'review applied');
  const turns=await count('SELECT count(*) n FROM chat_turns WHERE user_id=?',o.account);
  equal((await http(o,'/api/chat/actions','POST',confirmation.body)).status,200,label+'same-ID replay reads the saved result');
  equal(await count('SELECT count(*) n FROM chat_turns WHERE user_id=?',o.account),turns,label+'replay added no turn');
  equal(await count('SELECT count(*) n FROM inference_calls'),modelCalls,label+'confirm and replay made no model call');
 }
 // backup: the GitHub provider boundary is a stubbed global fetch (the Worker's githubTransport); preparing and confirming stay model-free.
 {
  const o=await workspaceFixture(db,m),other=await workspaceFixture(db,m),label='backup: ',config={clientId:'Iv1.test',clientSecret:'synthetic-secret',appId:123,slug:'test',key:fixtureKeyring('ab'.repeat(32))};
  await createFixtureProject(await other.scope(),other.account,'Foreign','A synthetic foreign website.');
  await initializeFixtureKeys(db,config.key);
  Object.assign(env,{GITHUB_CLIENT_ID:config.clientId,GITHUB_CLIENT_SECRET:config.clientSecret,GITHUB_APP_ID:'123',GITHUB_APP_SLUG:'test',CONNECTION_ENCRYPTION_KEYRING:config.key,FILES:{get:async()=>null}});
  await paidPlan(db,o.account,'business');
  const token=jid();
  await db.prepare('INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES(?,?,?,?,?)').bind(token,o.account,await m.seal(config.key,`whumpo:github:token:${o.account}:${token}`,'ghu_synthetic_private'),new Date(Date.now()+3600000).toISOString(),'active').run();
  await db.prepare('INSERT INTO github_connections(user_id,github_user_id,login,active_token_id,connected_at) VALUES(?,?,?,?,?)').bind(o.account,'44','test',token,stamp()).run();
  const {version}=await createFixtureProject(await o.scope(),o.account,'Bakery','A local bakery','clay');
  const repo={id:17,owner:{login:'test'},name:'backup',private:true,default_branch:'main',permissions:{push:true}};let writes=0,committedTree=null,reviewedTree=null;const realFetch=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{
   if(url==='https://api.github.com/user/installations?per_page=100')return Response.json({total_count:1,installations:[{id:1,app_id:123,suspended_at:null,account:{login:'test'},repository_selection:'selected'}]});
   if(url==='https://api.github.com/user/installations/1/repositories?per_page=20&page=1')return Response.json({repositories:[repo]});
   if(url==='https://api.github.com/repos/test/backup')return Response.json(repo);
   if(String(url).includes('/git/ref/heads/'))return Response.json({object:{sha:'a'.repeat(40)}});
   assert.equal(url,'https://api.github.com/graphql');
   if(JSON.parse(init.body).query.startsWith('query'))return Response.json({data:{repository:{p0:null,p1:null,p2:null,p3:committedTree?{__typename:'Tree',oid:committedTree}:null}}});
   writes++;committedTree=reviewedTree;return Response.json({data:{createCommitOnBranch:{commit:{oid:'b'.repeat(40)}}}});
  };
  try{
   const status=async id=>(await db.prepare('SELECT state s FROM github_backups WHERE id=?').bind(id).first())?.s??null;
   const options={github:config,githubTransport:globalThis.fetch,files:env.FILES};
   const prepare=async()=>{const id=jid();equal((await m.sendChat(await o.scope(),o.account,{id,revision:(await http(o,'/api/chat')).json.state.revision,content:'/review-backup '+version+' test/backup 17'},undefined,options)).status,200,label+'review prepared without a model');return id;};
   const post=async(who,revision,reviewId,id=jid())=>{const body={id,revision,action:{type:'confirm',kind:'backup',reviewId}};return {body,res:await http(who,'/api/chat/actions','POST',body)};};
   const spent=await count('SELECT count(*) n FROM inference_calls');
   const stale=await prepare(),staleRead=await read(o,stale);equal(staleRead.turn.backup_confirmation_id,stale,label+'fresh read offers the review');
   equal((await http(o,'/api/chat/actions','POST',{id:jid(),revision:(await http(o,'/api/chat')).json.state.revision,action:{type:'shortcut',kind:'versions',projectId:a.project}})).status,200,label+'conversation advances');
   equal((await post(o,staleRead.turn.revision,stale)).res.status,409,label+'stale revision refused');equal(await status(stale),'pending',label+'stale refusal applied nothing');equal(writes,0,label+'stale refusal wrote nothing to GitHub');
   const id=await prepare();
   equal((await read(other,id)).status,404,label+'foreign account cannot read the turn');
   await post(other,(await http(other,'/api/chat')).json.state.revision,id);equal(await status(id),'pending',label+'foreign confirm applied nothing');equal(writes,0,label+'foreign confirm wrote nothing to GitHub');
   reviewedTree=(await db.prepare('SELECT tree_sha t FROM github_backups WHERE id=?').bind(id).first()).t;
   const confirmation=await post(o,(await read(o,id)).turn.revision,id);equal(confirmation.res.status,200,label+'confirm from the fresh read');equal(await status(id),'complete',label+'review applied');equal(writes,1,label+'one GitHub write');
   equal((await http(o,'/api/chat/actions','POST',confirmation.body)).status,200,label+'same-ID replay reads the saved result');equal(writes,1,label+'replay made no second GitHub write');
   equal(await count('SELECT count(*) n FROM inference_calls'),spent,label+'no model call');
  }finally{globalThis.fetch=realFetch;}
 }
 equal(await count('SELECT count(*) n FROM inference_calls'),modelCalls,'No model call was recorded');
 console.log(`Saved review confirm outage passed (${checks} checks, ${process.argv.includes('--d1')?'local D1':'SQLite'}).`);
}catch(error){console.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{await store.close();}

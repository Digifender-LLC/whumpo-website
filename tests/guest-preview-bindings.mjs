import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
Error.stackTraceLimit=0;
// WH-151 owner bindings for guest previews on the shared Chat/view surface. The actual platform worker, sites host,
// view registry, Chat control path and WH-150 handlers run against the complete current schema in disposable SQLite
// (or local D1 with --d1). Everything is synthetic; no network, model or provider call is permitted.
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
const base='https://whumpo.com',guestOrigin='https://preview.whumpo.site',tag=id().slice(0,8).toUpperCase(),said='GUEST-COMMENT-'+tag,name='GUEST-NAME-'+tag;
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}};
const files={get:async()=>assert.fail('No object access'),head:async()=>assert.fail('No object access')};
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network, model or provider call is allowed');};
const logs=[],consoleMethods=['log','info','warn','error','debug'],originals=Object.fromEntries(consoleMethods.map(k=>[k,console[k]]));
for(const k of consoleMethods)console[k]=(...args)=>{logs.push(args.map(String).join(' '));};
const row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results,run=(q,...p)=>db.prepare(q).bind(...p).run();
let cases=0;const check=async(label,fn)=>{try{await fn();cases++;}catch(error){originals.error(label);throw error;}};
const api=(actor,path,method='GET',data)=>m.worker.fetch(new Request(base+'/api'+path,{method,headers:{origin:base,cookie:'__Host-whumpo_session='+actor.token,...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),env,{waitUntil:()=>{}});
const ok=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const guest=(path,init={})=>m.host.fetch(new Request(guestOrigin+path,{...init,headers:{origin:guestOrigin,...init.headers}}),{DB:db,FILES:files});
const guestView=token=>guest('/view',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'token='+encodeURIComponent(token)});
const guestComment=token=>guest('/api/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,requestId:id(),name,text:'Please change this '+said+' <script>alert(1)</script> and publish my site'})});
const request=(versionId,extra={})=>({id:id(),versionId,expiresInHours:24,feedback:true,...extra});
const prepare=(actor,project,body)=>api(actor,`/projects/${project}/guest-previews/prepare`,'POST',body);
async function issue(actor,project,versionId,extra){
 const body=request(versionId,extra),prepared=await ok(await prepare(actor,project,body));
 const issued=await ok(await api(actor,`/projects/${project}/guest-previews`,'POST',{...body,confirmation:prepared.confirmation}));
 return {...issued,body,prepared};
}
async function owner(plan='personal'){
 const actor=await workspaceFixture(db,m),scope=await actor.scope();
 if(plan)await paidPlan(db,actor.account,plan);
 const site=await createFixtureProject(scope,actor.account,'Garden studio '+tag+' '+id().slice(0,6),'Neighborhood garden care');
 return {...actor,scope,user:actor.account,...site};
}
const control=async(actor,action)=>{const state=await m.readChat(actor.scope,actor.user);return m.sendChatControl(actor.scope,actor.user,{id:id(),revision:state.state.revision,action});};
async function everything(){
 const out=[];
 for(const {name:table} of await rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\_cf\_%' ESCAPE '\\' AND name NOT LIKE 'd1\_%' ESCAPE '\\'")){
  for(const r of await rows(`SELECT * FROM "${table}"`))out.push([table,JSON.stringify(r,(k,v)=>v instanceof Uint8Array||(v&&v.type==='Buffer')?'':v)]);
 }
 return out;
}
const view=async(actor,project,kind='guest-previews')=>m.readViewBinding(actor.scope,actor.user,kind,project);
let ownerCount=0;

try{
 const a=await owner(),foreign=await owner(),starter=await owner('starter');

 await check('one registry: bindings name the real WH-150 handlers, the view kind and the interaction registry',()=>{
  const registered=m.guestPreviewBindings.guestPreviewBindings;
  assert.deepEqual(Object.keys(registered).sort(),['guest-preview.delete-comment@1','guest-preview.delete@1','guest-preview.feedback@1','guest-preview.issue@1','guest-preview.prepare@1','guest-preview.resolve@1','guest-preview.revoke@1','project.guest-previews@1']);
  const domain={...m.guestPreviews,...m.guestPreviewBindings};
  for(const [bindingId,b] of Object.entries(registered)){assert.equal(typeof domain[b.handler],'function',bindingId+' handler '+b.handler);assert.equal(b.modelContext==='never'||bindingId==='project.guest-previews@1',true);}
  assert.equal(registered['project.guest-previews@1'].modelContext,'link state and counts');
  assert.equal(m.interactionBindings['project.guest-previews@1'].handler,'readViewBinding');
  assert.equal(m.interactionBindings['project.guest-previews@1'].mode,'read');
  // Owner actions are never interaction bindings or agent actions: a model cannot reach them.
  for(const key of Object.keys(m.interactionBindings))assert.doesNotMatch(key,/guest-preview\.(issue|revoke|delete|resolve)/);
  const prompt=m.agentPrompt({});assert.match(prompt,/guest-previews/);assert.match(prompt,/cannot create, revoke or delete links or read guest comments/);
  assert.ok(!/guest-preview\.|\/guest-preview-|guest-previews\/prepare/.test(prompt));
 });

 await check('issuance needs the exact prepared confirmation; preparing writes nothing',async()=>{
  const body=request(a.version,{label:'For Sam',expiresInHours:48,feedback:false}),before=(await row('SELECT count(*) n FROM guest_preview_links')).n;
  const prepared=await ok(await prepare(a,a.project,body));
  assert.equal((await row('SELECT count(*) n FROM guest_preview_links')).n,before);
  const version=await row('SELECT id,digest,created_at FROM site_versions WHERE id=?',a.version);
  assert.deepEqual(prepared.readout,{requestId:body.id,project:{id:a.project,name:(await row('SELECT name FROM projects WHERE id=?',a.project)).name},savedVersion:{id:version.id,createdAt:version.created_at,digest:version.digest},expiresInHours:48,commentsAllowed:false,label:'For Sam',effect:prepared.readout.effect});
  assert.match(prepared.readout.effect,/48 hour\(s\) from the moment you confirm/);assert.match(prepared.readout.effect,/cannot comment/);
  assert.match(prepared.confirmation,/^[0-9a-f]{64}$/);assert.ok(!JSON.stringify(prepared).includes('token'));
  const post=(data,actor=a,project=a.project)=>api(actor,`/projects/${project}/guest-previews`,'POST',data);
  // No confirmation, malformed, wrong digest, and every displayed field changed after review all refuse without a row.
  assert.equal((await post(body)).status,400);assert.equal((await post({...body,confirmation:'x'})).status,400);
  assert.equal((await post({...body,confirmation:'0'.repeat(64)})).status,409);
  for(const patch of [{expiresInHours:49},{feedback:true},{label:'Other'},{id:id()}])assert.equal((await post({...body,...patch,confirmation:prepared.confirmation})).status,409,JSON.stringify(patch));
  const other=await createFixtureProject(a.scope,a.user,'Second','Other');
  assert.equal((await post({...body,versionId:other.version,confirmation:prepared.confirmation})).status,404);
  // The confirmation is bound to the owner: another owner cannot use it, with the same generic denial as any foreign project.
  assert.equal((await post({...body,confirmation:prepared.confirmation},foreign)).status,404);
  assert.equal((await prepare(foreign,a.project,body)).status,404);
  assert.equal((await row('SELECT count(*) n FROM guest_preview_links')).n,before);
  const done=await ok(await post({...body,confirmation:prepared.confirmation}));
  assert.equal(done.replayed,false);assert.equal(done.link.expiresAt-done.link.createdAt,48*3600);assert.equal(done.link.versionId,a.version);assert.equal(done.link.feedbackEnabled,false);assert.equal(done.link.label,'For Sam');
  assert.match(done.token,/^[A-Za-z0-9_-]{43}$/);
  const replay=await ok(await post({...body,confirmation:prepared.confirmation}));assert.equal(replay.token,null);assert.equal(replay.replayed,true);
  assert.equal((await row('SELECT count(*) n FROM guest_preview_links WHERE id=?',body.id)).n,1);
  // Starter is denied at preparation (no readout is offered) and nothing exists.
  assert.equal((await prepare(starter,starter.project,request(starter.version))).status,403);
  assert.equal((await row('SELECT count(*) n FROM guest_preview_links WHERE owner_user_id=?',starter.user)).n,0);
  // Inclusion lost between review and confirmation: refused, no link.
  const grantee=await owner(null);
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'creator.guest-feedback','dispatch','private-test-acceptance','synthetic WH-151 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),grantee.user,grantee.project);
  const gbody=request(grantee.version),gprepared=await ok(await prepare(grantee,grantee.project,gbody));
  await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=?',grantee.user);
  assert.equal((await api(grantee,`/projects/${grantee.project}/guest-previews`,'POST',{...gbody,confirmation:gprepared.confirmation})).status,403);
  assert.equal((await row('SELECT count(*) n FROM guest_preview_links WHERE owner_user_id=?',grantee.user)).n,0);
 });

 let first,second;
 await check('the one-time token reaches only the issuing owner response and no stored Chat, transcript or model context',async()=>{
  const turnsBefore=(await row('SELECT count(*) n FROM chat_turns WHERE user_id=?',a.user)).n;
  first=await issue(a,a.project,a.version,{label:'Reviewer one'});
  const {token}=first;assert.match(token,/^[A-Za-z0-9_-]{43}$/);
  assert.equal((await guestView(token)).status,200);
  const comment=await guestComment(token);assert.equal(comment.status,200);
  // Issuing, viewing and a guest comment create no Chat turn, no inference and no stored copy of the secret.
  assert.equal((await row('SELECT count(*) n FROM chat_turns WHERE user_id=?',a.user)).n,turnsBefore);
  const hits=(await everything()).filter(([,text])=>text.includes(token)).map(([table])=>table);
  assert.deepEqual(hits,[],'the raw token is not stored in any table');
  const chat=await m.readChat(a.scope,a.user);assert.ok(!JSON.stringify(chat).includes(token));assert.ok(!JSON.stringify(chat).includes(said));
  const transcript=await (await m.exportChatTranscript(new Request(base+'/api/chat/transcript'),a.scope,a.user)).text();
  assert.ok(!transcript.includes(token));assert.ok(!transcript.includes(said));
  const context=await m.siteContext(a.scope,a.user),modelInput=JSON.stringify([context,m.agentWorkspaceData(context,'all'),m.agentPrompt(context)]);
  assert.ok(!modelInput.includes(token));assert.ok(!modelInput.includes(said));assert.ok(!modelInput.includes(name));
  // Every view read (the model-reachable surface) omits token, hash and comment text.
  const shown=JSON.stringify(await view(a,a.project));assert.ok(!shown.includes(token));assert.ok(!shown.includes(said));assert.ok(!shown.includes(name));
  assert.ok(!shown.includes((await row('SELECT token_hash FROM guest_preview_links WHERE id=?',first.link.id)).token_hash));
  // A lost response cannot recover the token; a replay is token-free.
  const replay=await ok(await api(a,`/projects/${a.project}/guest-previews`,'POST',{...first.body,confirmation:first.prepared.confirmation}));assert.equal(replay.token,null);
  assert.ok(!logs.join('\n').includes(token));assert.ok(!logs.join('\n').includes(said));
 });

 await check('the shared read binding equals the HTTP list, in Chat and on a saved page, and refuses forged scope',async()=>{
  const facts=await view(a,a.project),http=await ok(await api(a,`/projects/${a.project}/guest-previews`));
  assert.equal(facts.status,'ready');assert.equal(facts.binding,'project.guest-previews@1');assert.equal(facts.projectId,a.project);assert.ok(m.readViewComponentData(facts));
  assert.deepEqual(facts.data.links,http.links.map(l=>({id:l.id,versionId:l.versionId,label:l.label,feedbackEnabled:l.feedbackEnabled,createdAt:l.createdAt,expiresAt:l.expiresAt,revokedAt:l.revokedAt,state:l.state,feedbackCount:l.feedbackCount,openFeedbackCount:l.openFeedbackCount})));
  assert.equal(facts.data.canIssue,true);assert.ok(facts.data.versions.some(v=>v.id===a.version));
  assert.ok(facts.data.links.some(l=>l.id===first.link.id&&l.feedbackCount===1&&l.openFeedbackCount===1));
  // Forged project IDs: foreign owner, random UUID, null scope and non-UUID never return another owner's rows.
  assert.equal((await view(foreign,a.project)).status,'unavailable');assert.equal((await view(foreign,a.project)).data,null);
  assert.equal((await view(a,id())).status,'unavailable');
  assert.equal((await view(a,null)).status,'unavailable');
  await assert.rejects(()=>m.readViewBinding(a.scope,a.user,'guest-previews','not-a-uuid'));
  await assert.rejects(()=>m.readViewBinding(a.scope,a.user,'guestPreviewz',a.project));
  assert.ok(!JSON.stringify(await view(foreign,foreign.project)).includes(first.link.id));
  // Saved page and temporary Chat view resolve the identical registered component.
  const layout=await m.readLayout(a.scope,a.user);
  await m.mutateLayout(a.scope,a.user,{version:1,requestId:id(),expectedRevision:layout.revision,operation:'createPage',page:{id:'tab-guests',label:'Guests',view:{version:1,projectId:a.project,widgets:['guest-previews'],shortcuts:[]}}});
  const revision=(await m.readLayout(a.scope,a.user)).revision,saved=await m.readSavedViewComponent(a.scope,a.user,{version:1,pageId:'tab-guests',revision,kind:'guest-previews'});
  const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,'Show my guest links','Pending',datetime('now'),'ai','pending' FROM workspace_state WHERE user_id=?",turn,a.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',a.user);
  const plan=await m.prepareWorkspaceView(a.scope,a.user,{originTurnId:turn,view:{version:1,projectId:a.project,widgets:['guest-previews'],shortcuts:[]}});
  await a.scope.batch([...plan.statements,a.scope.prepare("UPDATE chat_turns SET status='completed',assistant_text='Here is your overview.' WHERE id=?").bind(turn)]);
  const interaction=await m.readInteraction(a.scope,a.user,plan.interactionId);
  const temp=await m.readTemporaryViewComponent(a.scope,a.user,{version:1,interactionId:interaction.envelope.id,definitionDigest:interaction.envelope.definitionDigest,kind:'guest-previews'});
  for(const x of [saved,temp])assert.deepEqual({...x,asOf:0},{...facts,asOf:0});
  // Facts are strict: extra fields, wrong binding and malformed rows are rejected by the shared validator.
  assert.equal(m.readViewComponentData({...facts,data:{...facts.data,token:'x'}}),null);
  assert.equal(m.readViewComponentData({...facts,binding:'project.status@1'}),null);
  assert.equal(m.readViewComponentData({...facts,data:{...facts.data,links:[{...facts.data.links[0],text:'hello'}]}}),null);
  assert.equal(m.readViewComponentData({...facts,projectId:null,binding:'project.guest-previews@1'}),null);
  // A layout for a null project cannot be given this component to read links across projects.
  const dashboard=await m.readLayout(a.scope,a.user);
  await assert.rejects(()=>m.mutateLayout(a.scope,a.user,{version:1,requestId:id(),expectedRevision:dashboard.revision,operation:'setDashboard',view:{version:1,projectId:id(),widgets:['guest-previews'],shortcuts:[]}}));
 });

 await check('Chat controls: ids only, exact confirmation to delete, forged and foreign IDs fail, no inference',async()=>{
  const l=first.link.id;
  assert.equal(m.chatControl({type:'guestPreview',operation:'revoke',linkId:l}).command,'/guest-preview-revoke '+l);
  for(const bad of [{type:'guestPreview',operation:'revoke',linkId:'x'},{type:'guestPreview',operation:'revoke',linkId:l,token:'x'},{type:'guestPreview',operation:'delete',linkId:l},{type:'guestPreview',operation:'delete',linkId:l,confirmation:'delete'},{type:'guestPreview',operation:'issue',linkId:l},{type:'guestPreview',operation:'issue',projectId:a.project,versionId:a.version,expiresInHours:1,feedback:true},{type:'guestPreview',operation:'revoke'},{type:'guestPreview',operation:'revoke',linkId:l,confirmation:'DELETE'}])
   assert.equal(m.chatControl(bad),undefined,JSON.stringify(bad));
  // Typed text is never a command, including the exact internal string.
  const state=await m.readChat(a.scope,a.user);
  const typed=await m.sendConversation(a.scope,a.user,{id:id(),revision:state.state.revision,content:'/guest-preview-revoke '+l});
  assert.equal((await row('SELECT revoked_at FROM guest_preview_links WHERE id=?',l)).revoked_at,null,JSON.stringify(typed));
  // A forged ID, another owner's link, and a delete without the exact word do nothing.
  const foreignIssued=await issue(foreign,foreign.project,foreign.version);
  for(const action of [{type:'guestPreview',operation:'revoke',linkId:foreignIssued.link.id},{type:'guestPreview',operation:'revoke',linkId:id()},{type:'guestPreview',operation:'delete',linkId:foreignIssued.link.id,confirmation:'DELETE'}]){
   const r=await control(a,action);assert.equal(r.status,404,JSON.stringify(r));
  }
  assert.equal((await row('SELECT revoked_at FROM guest_preview_links WHERE id=?',foreignIssued.link.id)).revoked_at,null);
  assert.equal((await control(a,{type:'guestPreview',operation:'delete',linkId:l,confirmation:'delete'})).status,400);
  assert.equal((await row('SELECT count(*) n FROM guest_preview_links WHERE id=?',l)).n,1);
  // Real revoke: immediate for the guest, idempotent on replay, recorded without secrets.
  second=await issue(a,a.project,a.version,{label:'Reviewer two'});
  const turnsBefore=(await row('SELECT count(*) n FROM chat_turns WHERE user_id=?',a.user)).n,state2=await m.readChat(a.scope,a.user),actionId=id();
  const act={type:'guestPreview',operation:'revoke',linkId:second.link.id};
  assert.equal((await m.sendChatControl(a.scope,a.user,{id:actionId,revision:state2.state.revision,action:act})).status,200);
  assert.equal((await m.sendChatControl(a.scope,a.user,{id:actionId,revision:state2.state.revision,action:act})).status,200);
  assert.equal((await row('SELECT count(*) n FROM chat_turns WHERE user_id=?',a.user)).n,turnsBefore+1);
  const turn=await row('SELECT user_text,assistant_text,action_json,ai_context_allowed FROM chat_turns WHERE id=?',actionId);
  assert.equal(turn.user_text,'Revoke this guest preview link now.');assert.equal(turn.action_json,JSON.stringify(act));assert.match(turn.assistant_text,/revoked/);
  for(const secret of [second.token,first.token,said,name])assert.ok(!JSON.stringify(turn).includes(secret));
  assert.equal((await guestView(second.token)).status,404);assert.equal((await row("SELECT count(*) n FROM chat_turns WHERE id=? AND mode='ai'",actionId)).n,0);
  // The same control over HTTP uses the same path and recent-auth rules as every other Chat control.
  const viaHttp=await api(a,'/chat/actions','POST',{id:id(),revision:(await m.readChat(a.scope,a.user)).state.revision,action:{type:'guestPreview',operation:'revoke',linkId:first.link.id}});
  assert.equal(viaHttp.status,200,await viaHttp.clone().text());assert.equal((await guestView(first.token)).status,404);
 });

 await check('comments are inert owner-only text, absent from Chat and model context, and no route sends them to a model',async()=>{
  const third=await issue(a,a.project,a.version,{label:'Reviewer three'});
  assert.equal((await guestComment(third.token)).status,200);
  const read=await ok(await api(a,`/guest-previews/${third.link.id}/feedback`));
  assert.equal(read.feedback.length,1);assert.ok(read.feedback[0].text.includes('<script>alert(1)</script>'));assert.equal(read.feedback[0].displayNameVerified,false);
  // Foreign owner and forged IDs: generic 404, no text.
  assert.equal((await api(foreign,`/guest-previews/${third.link.id}/feedback`)).status,404);
  assert.equal((await api(a,`/guest-previews/${id()}/feedback`)).status,404);
  assert.equal((await api(foreign,`/guest-previews/${third.link.id}/feedback/${read.feedback[0].id}`,'PATCH',{resolved:true})).status,404);
  assert.equal((await api(foreign,`/guest-previews/${third.link.id}/feedback/${read.feedback[0].id}`,'DELETE')).status,404);
  assert.equal((await row('SELECT resolved_at FROM guest_preview_feedback WHERE id=?',read.feedback[0].id)).resolved_at,null);
  // Reading comments is not an inference, Chat or model-context event.
  const ai=(await row("SELECT count(*) n FROM chat_turns WHERE user_id=? AND mode='ai'",a.user)).n,turns=(await row('SELECT count(*) n FROM chat_turns WHERE user_id=?',a.user)).n;
  const context=JSON.stringify([await m.siteContext(a.scope,a.user),m.agentPrompt({}),await m.readChat(a.scope,a.user)]);
  assert.ok(!context.includes(said));assert.ok(!context.includes('publish my site'));
  assert.equal((await row("SELECT count(*) n FROM chat_turns WHERE user_id=? AND mode='ai'",a.user)).n,ai);assert.equal((await row('SELECT count(*) n FROM chat_turns WHERE user_id=?',a.user)).n,turns);
  // Resolve/reopen and delete one comment, through the same handlers.
  assert.ok((await ok(await api(a,`/guest-previews/${third.link.id}/feedback/${read.feedback[0].id}`,'PATCH',{resolved:true}))).feedback.resolvedAt!==null);
  assert.equal((await ok(await api(a,`/guest-previews/${third.link.id}/feedback/${read.feedback[0].id}`,'DELETE'))).deleted,true);
  // Only the guest surface text and the owner JSON route exist; there is no model-context privacy route yet.
  assert.deepEqual(Object.keys(m.guestPreviewBindings.guestPreviewBindings).filter(k=>m.guestPreviewBindings.guestPreviewBindings[k].modelContext!=='never'),['project.guest-previews@1']);
 });

 await check('revocation, comments and deletion remain after inclusion ends; issuing does not',async()=>{
  const grantee=await owner(null);
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'creator.guest-feedback','dispatch','private-test-acceptance','synthetic WH-151 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),grantee.user,grantee.project);
  const kept=await issue(grantee,grantee.project,grantee.version),gone=await issue(grantee,grantee.project,grantee.version);
  assert.equal((await guestComment(kept.token)).status,200);
  assert.equal((await view(grantee,grantee.project)).data.canIssue,true);
  await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=?',grantee.user);
  // Guests stop immediately; the owner's management view, comments and controls stay.
  assert.equal((await guestView(kept.token)).status,404);
  const lost=await view(grantee,grantee.project);assert.equal(lost.status,'ready');assert.equal(lost.data.canIssue,false);assert.equal(lost.data.links.length,2);
  assert.equal((await prepare(grantee,grantee.project,request(grantee.version))).status,403);
  assert.equal((await api(grantee,`/projects/${grantee.project}/guest-previews`,'POST',{...request(grantee.version),confirmation:'a'.repeat(64)})).status,403);
  const comments=await ok(await api(grantee,`/guest-previews/${kept.link.id}/feedback`));assert.equal(comments.feedback.length,1);
  assert.ok((await ok(await api(grantee,`/guest-previews/${kept.link.id}/feedback/${comments.feedback[0].id}`,'PATCH',{resolved:true}))).feedback.resolvedAt);
  assert.equal((await control(grantee,{type:'guestPreview',operation:'revoke',linkId:kept.link.id})).status,200);
  assert.equal((await ok(await api(grantee,`/guest-previews/${kept.link.id}/revoke`,'POST'))).link.state,'revoked');
  assert.equal((await control(grantee,{type:'guestPreview',operation:'delete',linkId:gone.link.id,confirmation:'DELETE'})).status,200);
  assert.equal((await ok(await api(grantee,`/guest-previews/${kept.link.id}`,'DELETE'))).deleted,true);
  assert.equal((await row('SELECT count(*) n FROM guest_preview_links WHERE owner_user_id=?',grantee.user)).n,0);
  assert.equal((await row('SELECT count(*) n FROM guest_preview_feedback f JOIN guest_preview_links l ON l.id=f.link_id WHERE l.owner_user_id=?',grantee.user)).n,0);
 });

 await check('lost identity stops every binding and effect',async()=>{
  const o=await owner(),issued=await issue(o,o.project,o.version);
  await o.revoke();
  for(const [path,method,data] of [[`/projects/${o.project}/guest-previews/prepare`,'POST',request(o.version)],[`/projects/${o.project}/guest-previews`,'POST',{...request(o.version),confirmation:'a'.repeat(64)}],[`/guest-previews/${issued.link.id}/revoke`,'POST'],[`/guest-previews/${issued.link.id}`,'DELETE'],[`/guest-previews/${issued.link.id}/feedback`,'GET']])
   assert.equal((await api(o,path,method,data)).status,401,path);
  await assert.rejects(()=>view(o,o.project));
  await assert.rejects(()=>control(o,{type:'guestPreview',operation:'revoke',linkId:issued.link.id}));
  assert.equal((await row('SELECT revoked_at FROM guest_preview_links WHERE id=?',issued.link.id)).revoked_at,null);
  assert.equal((await guestView(issued.token)).status,200);
 });

 assert.equal(network,0);assert.equal(cases,8);
 for(const k of consoleMethods)console[k]=originals[k];
 console.log(`Guest preview bindings passed: ${cases} groups on ${process.argv.includes('--d1')?'local D1':'SQLite'} — one registry over the WH-150 handlers, exact prepared confirmation before issuance, token only in the issuing response (never in any table, Chat turn, transcript, view or model context), shared view parity in Chat and on a saved page, forged/foreign/null IDs, ids-only Chat controls, inert comments out of model context, management after lost inclusion, and lost identity. No network or model call.`);
}catch(error){originals.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{for(const k of consoleMethods)console[k]=originals[k];globalThis.fetch=originalFetch;await fixture.close();}

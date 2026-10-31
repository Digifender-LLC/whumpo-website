// Explicit opt-in (WH-067 / WH-130 outstanding item, D25-D27): the first time the shared-module surface runs on the real
// test deployment. Two synthetic example.test owners each get a project with the access, records, files and content
// instances of tests/fixtures/module-compositions/instances.mjs. Both compositions (staff portal, visitor intake) are
// fetched from the deployed visitor origin, imported from the served bytes and run against it with a fetch bound to that
// origin and only that origin's cookie. Owner confirmations go through POST /api/chat/actions; the module proposal and the
// publish review are prepared in place by the fixture handlers (no model turn, and /publish has no HTTP interpreter).
// Anonymous public intake is asserted to FAIL CLOSED and write no row: no Turnstile token is sent or faked and no secret
// is touched (D26). No synthetic safety clearance is written (D27): the one JPEG must stay pending and unreadable.
// Hard cap of 200 requests to whumpo.com and *.whumpo.site, one at a time. No payment, provider, model or email.
// Cleanup: exact-id deletes only, then every table is re-read, the R2 object is deleted with wrangler and re-read.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
if(process.env.RUN_LIVE_MODULES!=='1')throw Error('Set RUN_LIVE_MODULES=1 for the live shared-module acceptance check');
const {requireCurrentProbeSchema,liveWorkspaceBrowser,seedCurrentProbeIdentity}=await import('./helpers/live-workspace.mjs');
const {cloudflareClient,remoteD1}=await import('../tools/cms-cloudflare.mjs');
const {currentSiteFixtureHandlers,createFixtureProject,proposeFixtureWebsite}=await import('./current-site-fixture.mjs');
const {authenticator}=await import('./app-authenticator.mjs');
const {moduleInstances}=await import('./fixtures/module-compositions/instances.mjs');
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));assert.equal(config.vars.ENVIRONMENT,'test');
const bucket=config.r2_buckets.find(b=>b.binding==='FILES').bucket_name;
const SITE_CAP=200;let site=0,controlPlane=0;
const countedControl=(url,init)=>{controlPlane++;return fetch(url,init);};
const db=remoteD1(cloudflareClient(config.account_id,countedControl),config.d1_databases.find(d=>d.binding==='DB').database_id);
await requireCurrentProbeSchema(db);
const base='https://whumpo.com',sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Pacing: AUTH_LIMITER is 10 per minute per key on both Workers. A 429 is a pacing fault, never a pass.
const paced={workspace:[],visitor:[]};
async function pace(kind){const t=paced[kind],now=Date.now();while(t.length&&now-t[0]>60000)t.shift();if(t.length>=8){await sleep(61000-(now-t[0]));t.length=0;}t.push(Date.now());}
async function counted(url,init={}){
 const u=new URL(url);assert.ok(u.hostname==='whumpo.com'||/^app-[0-9a-f-]{36}\.whumpo\.site$/.test(u.hostname),'Only the platform and its visitor hosts are called');
 if(u.hostname==='whumpo.com'&&u.pathname.startsWith('/api/auth/identity/'))await pace('workspace');
 if(u.hostname!=='whumpo.com'&&/\/auth\//.test(u.pathname))await pace('visitor');
 if(++site>SITE_CAP)throw Error('Stopped at the '+SITE_CAP+' request cap');
 const response=await fetch(url,{...init,redirect:'manual',signal:init.signal??AbortSignal.timeout(60000)});
 assert.notEqual(response.status,429,'Rate limited: a pacing fault, not a pass ('+u.pathname.replace(/[0-9a-f-]{36}/g,':id')+')');
 return response;
}
const ids=[crypto.randomUUID(),crypto.randomUUID()],tags=ids.map(i=>i.slice(0,8));
const emails=ids.map((i,n)=>`module-${'ab'[n]}-fixture-${i}@example.test`);
const cleanupFile='.secrets/module-live-accounts.json',evidenceFile='.secrets/module-live-evidence.json';
try{await readFile(cleanupFile);throw Error('Resolve the previous module fixture cleanup before a new run');}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir('.secrets',{recursive:true});
const record={owners:ids.map((id,n)=>({id,email:emails[n]})),projects:[],objectKeys:[]};
const saveRecord=()=>writeFile(cleanupFile,JSON.stringify(record),{mode:0o600});
await saveRecord();
const tmp=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-module-live-');
execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(32,24),(80,120,60)).save(sys.argv[1]+'/a.jpg')",tmp]);
const jpeg=new Uint8Array(await readFile(tmp+'/a.jpg'));await rm(tmp,{recursive:true,force:true});
const m=await currentSiteFixtureHandlers(),{accessInstance,recordsInstance,filesInstance,contentInstance}=moduleInstances(kind=>{const e=m.moduleCatalog.find(x=>x.kind===kind);return {module:{...e.module},schema:{...e.schema}};});
const instances=[accessInstance,recordsInstance(),filesInstance,contentInstance];
const row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results,run=(q,...p)=>db.prepare(q).bind(...p).run();
const hex=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
const markers=[],value=n=>{const v=`VISITOR-VALUE-${n}-${crypto.randomUUID().slice(0,8)}`;markers.push(v);return v;};
const sent=[],steps={},seen={};
let success=false,originalFailure;

async function owner(n,listing){
 const id=ids[n],email=emails[n];let session;
 const transport=async(url,init)=>{const r=await counted(url,init);for(const c of r.headers.getSetCookie()){const mm=/^__Host-whumpo_session=([^;]*)/.exec(c);if(mm)session=mm[1];}return r;};
 const browser=liveWorkspaceBrowser(base,transport);
 const [key]=await seedCurrentProbeIdentity(db,id,email);
 await run("INSERT INTO user_profiles(user_id,name) VALUES(?,'Module fixture')",id);
 await run("INSERT INTO welcome_onboarding(user_id,stage,prompt,project_id,project_name,idea,completed_at) VALUES(?,'complete','review',?,'Example','Example',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",id,crypto.randomUUID());
 await run("INSERT OR IGNORE INTO workspace_state(user_id,step) VALUES(?,'ready')",id);
 let logins=1,loginAt=Date.now();await browser.login(key,id,logins);assert.ok(session,'No session cookie captured');
 const scope=await m.admitWorkspace(db,await m.resolveIdentity(db,{version:1,client:'web',kind:'session',token:session}));
 const name='Module fixture '+'AB'[n]+' '+tags[n],made=await createFixtureProject(scope,id,name,'Neighborhood repairs');
 record.projects[n]=made.project;await saveRecord();
 for(const feature of ['core.editing','core.forms'])for(const operation of ['prepare','confirm'])
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic WH-130 live fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",crypto.randomUUID(),id,made.project,feature,operation);
 const o={n,id,email,key,browser,scope,project:made.project,host:'https://app-'+made.project+'.whumpo.site',get session(){return session;},listing};
 // Owner confirmations: always a deployed route, never an in-process handler.
 // Recent sign-in lasts 10 minutes; sign in again with the same synthetic key (higher counter) after 6.
 o.fresh=async()=>{if(Date.now()-loginAt>360000){await browser.login(key,id,++logins);loginAt=Date.now();}};
 o.action=async action=>{
  await o.fresh();
  const turn=crypto.randomUUID(),revision=(await m.readChat(scope,id)).state.revision;
  const r=await browser.call('/api/chat/actions','POST',{id:turn,revision,action});
  assert.equal(r.status,200,'POST /api/chat/actions '+action.type+' answered '+r.status+' '+JSON.stringify(await r.json().then(j=>j.error??j.code,()=>null)));
  return turn;
 };
 // Module proposal: prepared in place (no model turn), applied by the typed recent-sign-in control on the deployed Worker.
 const q=await proposeFixtureWebsite(scope,id,made.project,instances.map(instance=>({type:'modules.put',instance})),m);
 const version=await o.action({type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision});
 assert.equal(await row('SELECT version_id FROM project_spec_heads WHERE project_id=?',made.project).then(r=>r?.version_id),version,'The deployed specificationApply saved the version');
 // Publish review: prepared in place; the confirmation is the deployed typed control.
 const turn=crypto.randomUUID(),sentChat=await m.sendChat(scope,id,{id:turn,revision:(await m.readChat(scope,id)).state.revision,content:'/publish '+version});assert.equal(sentChat.status,200,JSON.stringify(sentChat));
 await o.action({type:'confirm',kind:'site',reviewId:turn});
 assert.ok(await row('SELECT 1 FROM publications WHERE project_id=? AND version_id IS NOT NULL',made.project),'Published');
 for(const instanceId of ['members','requests','media','listings']){
  const review=await o.action({type:'moduleActivationReview',projectId:made.project,instanceId,action:'activate'});
  const saved=await row('SELECT * FROM module_activation_reviews WHERE id=?',review);assert.ok(saved,'Activation review '+instanceId);
  await o.action({type:'moduleActivationApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_activation_revision});
  assert.equal((await row("SELECT a.state FROM module_activations a JOIN module_instances i ON i.id=a.instance_id WHERE i.project_id=? AND i.local_id=?",made.project,instanceId))?.state,'active',instanceId+' is active');
 }
 o.setRole=async(visitorId,action)=>{
  const review=await o.action({type:'accessRoleReview',projectId:made.project,instanceId:'members',visitorId,action});
  const saved=await row('SELECT * FROM module_access_role_reviews WHERE id=?',review);assert.ok(saved,'Role review');
  await o.action({type:'accessRoleApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_access_revision});
 };
 o.call=(path,payload)=>browser.call(path,'POST',payload);
 return o;
}
const cookieOf=(r,name)=>{for(const c of r.headers.getSetCookie()){const mm=new RegExp('^'+name+'=([0-9a-f]{64})').exec(c);if(mm)return mm[1];}};
// Visitor passkey sign-up on the project's own origin, from an owner invitation. The recovery code is discarded unread.
async function visitor(o){
 await o.fresh();const invite=await o.browser.call(`/api/projects/${o.project}/application-access/invitations`,'POST',{});assert.equal(invite.status,201);
 const code=(await invite.json()).code,before=new Set((await rows('SELECT id FROM app_visitors WHERE project_id=?',o.project)).map(r=>r.id));
 const post=(path,body,cookie)=>counted(o.host+path,{method:'POST',headers:{origin:o.host,'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
 const opened=await post('/auth/signup/options',{inviteCode:code});assert.equal(opened.status,200);
 const challenge=cookieOf(opened,'__Host-whumpo-app-challenge-'+o.project);assert.ok(challenge,'challenge cookie');
 const options=(await opened.json()).options,key=authenticator();
 const verified=await post('/auth/signup/verify',{credential:key.registration(options,o.host)},`__Host-whumpo-app-challenge-${o.project}=${challenge}`);assert.equal(verified.status,200);
 const session=cookieOf(verified,'__Host-whumpo-app-session-'+o.project);assert.ok(session,'visitor session cookie');
 const visitorId=(await rows('SELECT id FROM app_visitors WHERE project_id=?',o.project)).map(r=>r.id).find(x=>!before.has(x));assert.ok(visitorId,'visitor row');
 return {visitorId,cookie:`__Host-whumpo-app-session-${o.project}=${session}`};
}
const manifest=async o=>({instances:Object.fromEntries((await rows('SELECT id,local_id,config_revision FROM module_instances WHERE project_id=?',o.project)).map(r=>[r.local_id,{resourceId:r.id,configRevision:r.config_revision}]))});
// The browser: relative URLs resolve against the page's visitor origin, POSTs carry that Origin, and only that origin's
// cookie is attached. Everything a composition sends is recorded for the envelope-shape check.
function browserFor(o,v,page=o){
 return async(input,init={})=>{
  const url=new URL(input,page.host);assert.equal(url.origin,page.host,'Compositions only call their own origin');assert.equal(init.credentials,'same-origin');
  const headers=new Headers(init.headers);headers.set('origin',page.host);if(v?.cookie)headers.set('cookie',v.cookie);
  const envelope=url.pathname==='/modules'?JSON.parse(init.body):JSON.parse(Buffer.from(headers.get('whumpo-module-request'),'base64url').toString());
  sent.push({path:url.pathname,body:envelope,headers:[...headers.keys()]});
  const response=await counted(url.href,{...init,headers});
  assert.equal(response.headers.get('access-control-allow-origin'),null);return response;
 };
}
async function raw(o,body,{cookie='',origin=o.host,path='/modules'}={}){
 const response=await counted(o.host+path,{method:'POST',headers:{'content-type':'application/json',origin,...(cookie?{cookie}:{})},body:typeof body==='string'?body:JSON.stringify(body)});
 assert.equal(response.headers.get('access-control-allow-origin'),null);
 return {status:response.status,body:await response.json()};
}
const envelope=(instance,operation,target=null,input=null)=>({api:'whumpo-modules',version:1,operation,resourceId:instance.resourceId,configRevision:instance.configRevision,requestId:m.modulePolicy.moduleOperations[operation].write?crypto.randomUUID():null,target,input});

const owners=[];let r2Before=null;
try{
 const a=await owner(0,'Garden club'),b=await owner(1,'Chess club');owners.push(a,b);steps.owners=2;steps.activated=8;steps.published=2;
 const [staff,v1]=[await visitor(a),await visitor(a)],bStaff=await visitor(b);steps.visitorsSignedUp=3;
 await a.setRole(staff.visitorId,'grant');await b.setRole(bStaff.visitorId,'grant');steps.staffRolesGranted=2;
 assert.ok(await row('SELECT 1 FROM module_access_roles WHERE visitor_id=?',staff.visitorId),'Staff role row');
 // The composition sources, served by the deployed visitor origin, are the fixtures byte for byte.
 const modules={};
 for(const name of ['staff-portal','visitor-intake']){
  const served=await counted(a.host+'/compositions/'+name+'.js'),text=await served.text(),fixture=await readFile('tests/fixtures/module-compositions/'+name+'.mjs','utf8');
  assert.equal(served.status,200);assert.equal(text,fixture,name+' is served byte for byte from the fixture');
  assert.match(served.headers.get('content-type'),/^text\/javascript/);assert.equal(served.headers.get('cache-control'),'private, no-store');assert.equal(served.headers.get('x-content-type-options'),'nosniff');
  assert.match(served.headers.get('content-security-policy'),/sandbox/);assert.ok(!served.headers.has('set-cookie'));
  modules[name]=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
 }
 steps.compositionsServed=2;
 const man=await manifest(a),portal=(v,page=a,pm=man)=>modules['staff-portal'].staffPortal({fetch:browserFor(page,v,page),manifest:pm}),intake=(v,page=a,pm=man)=>modules['visitor-intake'].visitorIntake({fetch:browserFor(page,v,page),manifest:pm});
 const manB=await manifest(b);

 // Visitor intake composition.
 const page=intake(v1);let entry,fileId;
 const me=await page.me();assert.equal(me.ok,true,me.code);assert.deepEqual(me.result.roles,[]);
 const values={name:'<img src=x onerror=alert(1)> '+value('name'),topic:'repair',note:value('note'),urgent:true,count:2};
 const accepted=await page.submit(values);assert.equal(accepted.ok,true,accepted.code);entry=accepted.result.entryId;
 assert.ok(!markers.some(x=>JSON.stringify(accepted).includes(x)),'Receipts never echo values');
 const mine=await page.myRequests();assert.deepEqual(mine.result.items.map(i=>i.entryId),[entry]);
 assert.deepEqual(Object.keys(mine.result.items[0].values).sort(),['topic','urgent'],'A visitor sees only submitter fields of their own record');
 assert.deepEqual(Object.keys((await page.myRequest(entry)).result.values).sort(),['topic','urgent']);
 const photo=await page.addPhoto(jpeg);assert.equal(photo.ok,true,photo.code);assert.equal(photo.result.safety,'pending');fileId=photo.result.fileId;steps.jpegUploaded=true;
 const stored=await row('SELECT object_key FROM project_files WHERE id=?',fileId);assert.ok(stored.object_key.startsWith('photos/'+a.project+'/'),'Exact photos/<project>/ key');
 record.objectKeys.push(stored.object_key);await saveRecord();
 r2Before=r2('get',stored.object_key);assert.equal(r2Before.ok,true,'The pending object exists in R2 before cleanup');
 assert.deepEqual((await page.myGallery()).result.items,[],'Pending uploads are absent from the gallery');
 assert.equal((await page.myPhoto(fileId)).code,'unavailable','files.read is unavailable while pending');
 assert.equal((await row('SELECT state FROM project_photo_safety WHERE file_id=?',fileId)).state,'pending','No safety clearance was written');
 // No directory publication is part of this run, so the content collection answers its documented unpublished state.
 const directory=await page.directory();assert.equal(directory.code,'unavailable');
 steps.visitorIntake=true;

 // Staff portal over the same instances.
 const desk=portal(staff);
 assert.deepEqual((await desk.me()).result.roles,['staff']);
 const list=await desk.desk(),item=list.result.items.find(i=>i.entryId===entry);assert.ok(item,'The visitor submission is on the staff desk');
 assert.deepEqual(Object.keys(item.values).sort(),['count','note','topic'],'Staff see staff fields, never owner-only fields');
 assert.ok(!desk.renderDesk(list.result.items).includes('<img'),'Visitor values render as text');
 const staffNote=value('staff-note'),done=await desk.note(entry,1,staffNote);assert.equal(done.ok,true,done.code);assert.deepEqual(done.result,{entryId:entry,revision:2});
 assert.equal((await desk.change(entry,2,{name:'changed'})).code,'forbidden','Only staffWrite fields');
 assert.equal((await desk.note(entry,1,'late')).code,'stale_configuration','Compare-and-swap on the record revision');
 assert.equal((await desk.entry(entry)).result.values.note,staffNote);
 const requestId=crypto.randomUUID(),replayed=value('replayed'),first=await desk.note(entry,2,replayed,{requestId});assert.equal(first.ok,true,first.code);
 const again=await desk.note(entry,2,replayed,{requestId});assert.equal(again.receipt.replayed,true);assert.deepEqual(again.result,first.result);
 assert.equal((await desk.note(entry,2,'different',{requestId})).code,'request_conflict');
 assert.equal((await desk.logCall({name:value('caller'),topic:'visit',urgent:false,count:1})).ok,true);
 steps.staffPortal=true;

 // Owner reads on the workspace origin.
 const resource=man.instances.requests.resourceId,ownerList=await a.browser.call(`/api/projects/${a.project}/module-records/${resource}/request`);
 assert.equal(ownerList.status,200);const ownerItems=(await ownerList.json()).items,ownerEntry=ownerItems.find(i=>i.entryId===entry);
 assert.ok(ownerEntry&&ownerEntry.values.name===values.name&&ownerEntry.values.note===replayed,'The owner sees every field');
 assert.equal((await b.browser.call(`/api/projects/${a.project}/module-records/${resource}/request`)).status,404,'Owner B gets 404 for A\'s records');
 const summary=await (await a.browser.call(`/api/projects/${a.project}/module-records`)).json();
 assert.equal(summary.items.find(i=>i.localId==='requests').publicForm,'bound');
 steps.ownerReads=true;

 // WH-093: deployed leads.update on the owner route. The Business gate (business.leads) is observed first with no grant.
 // It is then opened the way core.editing/core.forms are above: a synthetic private-test preview grant on this run's own owner and
 // project (deleted with the owner at cleanup). The gate itself is neither edited nor bypassed.
 const leadPath=`/api/projects/${a.project}/modules`,leadEdit=(revision,changes)=>envelope(man.instances.requests,'leads.update',{recordId:'request',entryId:entry,revision,changes});
 const leadRead=async()=>(await (await a.browser.call(`/api/projects/${a.project}/module-records/${resource}/request`)).json()).items.find(i=>i.entryId===entry).lead;
 const ungranted=await a.call(leadPath,leadEdit(0,{stage:'contacted'})),ungrantedBody=await ungranted.json();
 seen.leadsGateWithoutGrant={status:ungranted.status,code:ungrantedBody.code};
 assert.equal(ungranted.status,403,'No business.leads grant: '+JSON.stringify(ungrantedBody));assert.equal(ungrantedBody.code,'forbidden');
 assert.equal(await row('SELECT 1 FROM module_record_leads WHERE entry_id=?',entry),null,'A refused lead write leaves no row');
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'business.leads','confirm','private-test-acceptance','synthetic WH-093 live fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",crypto.randomUUID(),a.id,a.project);
 await a.fresh();
 const leadNote=value('lead-note'),dueDate=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
 const set=await a.call(leadPath,leadEdit(0,{stage:'contacted',note:leadNote,dueDate})),setBody=await set.json();
 assert.equal(set.status,200,JSON.stringify(setBody));assert.deepEqual(setBody.result,{entryId:entry,revision:1});assert.ok(!JSON.stringify(setBody).includes(leadNote),'The reply carries no lead value');
 assert.deepEqual(await leadRead(),{stage:'contacted',note:leadNote,dueDate,revision:1},'Owner reads the lead back through the deployed list route');
 const savedLead=await row('SELECT stage,note,due_date,revision,project_id FROM module_record_leads WHERE entry_id=?',entry);
 assert.deepEqual([savedLead.stage,savedLead.note,savedLead.due_date,savedLead.revision,savedLead.project_id],['contacted',leadNote,dueDate,1,a.project]);
 const stale=await a.call(leadPath,leadEdit(0,{stage:'won'}));assert.equal(stale.status,409,'A stale revision is refused');assert.equal((await stale.json()).code,'stale_configuration');
 assert.equal((await row('SELECT stage FROM module_record_leads WHERE entry_id=?',entry)).stage,'contacted');
 for(const [who,cookie] of [['visitor',v1.cookie],['staff',staff.cookie]]){
  const refusal=await raw(a,leadEdit(1,{stage:'won'}),{cookie});assert.equal(refusal.body.code,'forbidden',who+' is refused lead writes');
 }
 assert.ok((await raw(a,leadEdit(1,{stage:'won'}))).status>=400,'Anonymous callers are refused');
 assert.equal((await b.call(leadPath,leadEdit(1,{stage:'won'}))).status>=400,true,'Owner B is refused on A\'s project');
 assert.equal((await row('SELECT stage FROM module_record_leads WHERE entry_id=?',entry)).stage,'contacted','No refused caller changed the lead');
 steps.leadsUpdate=true;

 // Turnstile (D26): fail closed, no token, no row.
 const rowsBefore=(await row('SELECT count(*) c FROM module_records WHERE project_id=?',a.project)).c,anon=intake(null);
 assert.equal((await anon.me()).code,'forbidden');assert.equal((await anon.submit(values)).code,'forbidden','Visitor forms refuse anonymous callers');assert.equal((await anon.myRequests()).code,'forbidden');
 const publicTry=await anon.submitAnonymously({name:value('public'),topic:'visit',urgent:false,count:1},'');
 assert.equal(publicTry.ok,false);assert.ok(['unavailable','forbidden'].includes(publicTry.code),'Closed state: '+publicTry.code);seen.turnstileClosedState=publicTry.code;
 const probe=await raw(a,envelope(man.instances.requests,'forms.submit',{formId:'public-form'},{values:{name:value('public-raw'),topic:'visit',urgent:false,count:1}}));
 seen.turnstileMessage=probe.body.error??probe.body.message??null;
 if(probe.body.code==='unavailable')assert.equal(seen.turnstileMessage,'Public form submissions are temporarily unavailable.');
 assert.equal((await row('SELECT count(*) c FROM module_records WHERE project_id=?',a.project)).c,rowsBefore,'No row was written');
 assert.equal((await row("SELECT count(*) c FROM module_records WHERE project_id=? AND submitter_kind='public'",a.project)).c,0);
 steps.turnstileFailClosed=true;

 // Refusals.
 const cross=await portal(bStaff,a,man);
 for(const call of [()=>cross.desk(),()=>cross.entry(entry)])assert.equal((await call()).code,'forbidden','B\'s cookie on A\'s origin is anonymous');
 const aOnB=portal(bStaff,b,man),visitorOnB=intake(bStaff,b,man);
 for(const call of [()=>aOnB.desk(),()=>aOnB.entry(entry),()=>visitorOnB.submit(values)])assert.equal((await call()).code,'not_found',"A's resource on B's origin");
 assert.equal((await raw(a,envelope(man.instances.requests,'records.view',{viewId:'desk',cursor:null}),{cookie:staff.cookie,origin:'https://evil.example'})).status,403,'Foreign Origin refused');
 assert.equal((await raw(a,envelope(man.instances.requests,'records.view',{viewId:'desk',cursor:null}),{cookie:`__Host-whumpo_session=${a.session}`})).body.code,'forbidden','A workspace cookie never authenticates on the visitor origin');
 const onWorkspace=await counted(base+`/api/projects/${a.project}/modules`,{method:'POST',headers:{origin:base,'content-type':'application/json',cookie:v1.cookie},body:JSON.stringify(envelope(man.instances.requests,'records.get',{recordId:'request',entryId:entry}))});
 assert.ok([401,403].includes(onWorkspace.status),'A visitor cookie never authenticates on whumpo.com, answered '+onWorkspace.status);
 assert.equal((await raw(a,envelope(man.instances.media,'files.putBytes',{collectionId:'mine'},{mediaType:'image/jpeg',byteLength:jpeg.length,sha256:await hex(jpeg)}),{cookie:v1.cookie})).body.code,'invalid_request','files.putBytes on the JSON route');
 assert.equal((await raw(a,envelope(man.instances.requests,'records.view',{viewId:'desk',cursor:null,projectId:'x'}),{cookie:v1.cookie})).body.code,'invalid_request','An authority key in the envelope');
 steps.refusals=true;

 // Staff role revoke, then the desk is refused.
 await a.setRole(staff.visitorId,'revoke');
 assert.equal((await desk.desk()).code,'forbidden');assert.deepEqual((await desk.me()).result.roles,[]);
 steps.staffRevoked=true;

 // Envelope shape: no authority key travelled in any request the compositions made.
 for(const s of sent){assert.deepEqual(Object.keys(s.body).sort(),['api','configRevision','input','operation','requestId','resourceId','target','version']);assert.ok(!s.headers.includes('authorization'));}

 // Off-switches: nothing sent, charged or inferred.
 const both=[a.project,b.project];
 for(const [t,col] of [['notification_notices','project_id'],['cost_events','project_id']])for(const p of both)assert.equal((await row(`SELECT count(*) c FROM ${t} WHERE ${col}=?`,p)).c,0,t+' stays empty');
 for(const u of ids){
  assert.equal((await row('SELECT count(*) c FROM notification_notices WHERE user_id=?',u)).c,0);
  assert.deepEqual((await rows("SELECT DISTINCT user_text FROM chat_turns WHERE user_id=? AND mode='ai'",u)).map(r=>r.user_text),['Synthetic current website fixture'],'Only the in-place fixture proposals; no model turn');
  for(const marker of markers)assert.equal(await row('SELECT 1 FROM chat_turns WHERE user_id=? AND (instr(user_text,?)>0 OR instr(assistant_text,?)>0)',u,marker,marker),null,'A visitor value reached Chat');
 }
 steps.offSwitches=true;
 for(const o of owners)await o.browser.logout();
 success=true;
}catch(error){originalFailure=error;}
finally{
 let objectDeleted=null,cleanupVerified=false,cleanupFailure=null;const deletedKeys=[];
 try{
  for(const project of record.projects.filter(Boolean))for(const k of (await rows('SELECT object_key FROM project_files WHERE project_id=?',project)))if(!record.objectKeys.includes(k.object_key))record.objectKeys.push(k.object_key);
  for(const key of record.objectKeys)assert.ok(record.projects.some(p=>key.startsWith('photos/'+p+'/')),'Only this run\'s object keys');
  for(const [n,id] of ids.entries())await run('DELETE FROM users WHERE id=? AND email=?',id,emails[n]);
  for(const id of ids)for(const t of ['users WHERE id','identity_accounts WHERE account_id','identity_sessions WHERE account_id','identity_credentials WHERE account_id','projects WHERE owner_user_id','feature_preview_grants WHERE user_id','chat_turns WHERE user_id','workspace_state WHERE user_id','notification_notices WHERE user_id'])assert.equal(await row('SELECT 1 FROM '+t+'=?',id),null,'Cleanup left rows in '+t.split(' ')[0]);
  for(const p of record.projects.filter(Boolean))for(const t of ['module_instances','module_records','module_record_leads','module_files','app_visitors','project_files','publications','project_spec_heads'])assert.equal(await row('SELECT 1 FROM '+t+' WHERE project_id=?',p),null,'Cleanup left rows in '+t);
  objectDeleted=true;
  for(const key of record.objectKeys){
   assert.ok(await row('SELECT 1 FROM file_cleanup WHERE object_key=?',key),'The object is queued in file_cleanup');
   const del=r2('delete',key);
   if(!del.ok||r2('get',key).ok){objectDeleted=false;continue;}
   await run('DELETE FROM file_cleanup WHERE object_key=?',key);assert.equal(await row('SELECT 1 FROM file_cleanup WHERE object_key=?',key),null);deletedKeys.push(key);
  }
  cleanupVerified=objectDeleted!==false;
  if(cleanupVerified)await rm(cleanupFile);
 }catch(error){cleanupFailure=error.message;cleanupVerified=false;}
 // Neither tokens, cookies, values nor object keys are recorded.
 const evidence={at:new Date().toISOString(),success:success&&cleanupVerified,steps,...seen,requests:{site,siteCap:SITE_CAP,controlPlane},objectsCreated:record.objectKeys.length,objectDeleted:record.objectKeys.length?objectDeleted:null,cleanupVerified,
  ...(originalFailure?{failure:originalFailure.message}:{}),...(cleanupFailure?{cleanupFailure,leftBehind:{cleanupFile,owners:ids,projects:record.projects.filter(Boolean),objectKeys:record.objectKeys.length-deletedKeys.length}}:{})};
 await writeFile(evidenceFile,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(evidence));
 if(!evidence.success)process.exitCode=1;
}
function r2(verb,key){
 try{execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','r2','object',verb,bucket+'/'+key,'--remote',...(verb==='get'?['--pipe']:[])],{stdio:['ignore','ignore','pipe'],timeout:120000});return {ok:true};}
 catch(error){return {ok:false};}
}

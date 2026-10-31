import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'vite';
import {authenticator} from './app-authenticator.mjs';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';
import {validateDescriptor} from '../tools/prototypes/workload-placement.mjs';
Error.stackTraceLimit=0;
// WH-093 record leads (schema batch 6): the owner-only module_record_leads table, leads.update, the owner list filters and the counts-only binding. Actual handlers (visitor gateway POST /modules, the workspace-origin owner routes,
// the module engine, records handlers, commit triggers, retention expiry, Chat role reviews and activation reviews) run
// against the complete current schema in disposable SQLite, or local D1 with --d1, with two owners/projects. Every
// identity and submitted value is synthetic. No model, provider or network is used: fetch throws.
const logs=[],consoleMethods=['log','info','warn','error','debug'],originals=Object.fromEntries(consoleMethods.map(k=>[k,console[k]]));
for(const k of consoleMethods)console[k]=(...args)=>{logs.push(args.map(String).join(' '));};
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network or inference is available');};
const row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results,run=(q,...p)=>db.prepare(q).bind(...p).run();
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(error){originals.error(name);throw error;}};
const {appAuth:auth,appActivation,appGateway,appLifecycle,moduleAccess,sharedModules}=m,{saveBackend,testBackend}=m.backend;
const runtime={fetch:async()=>Response.json({ok:true,value:{state:{},result:{}}})};
const env={DB:db,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:runtime};
const pins=kind=>{const e=m.moduleCatalog.find(x=>x.kind===kind);return {module:{...e.module},schema:{...e.schema}};};
const marker=n=>`VISITOR-VALUE-${n}-${id().slice(0,8)}`,markers=[];
const value=n=>{const v=marker(n);markers.push(v);return v;};
const accessInstance={id:'members',kind:'access',...pins('access'),dependencies:[],config:{roles:['staff'],enrollment:'invitation'}};
const fields=[{key:'name',label:'Name',type:'text',optional:false,read:'owner'},
 {key:'topic',label:'Topic',type:'choice',options:[{value:'repair',label:'Repair'},{value:'visit',label:'Visit'}],optional:false,read:'submitter'},
 {key:'note',label:'Note',type:'text',optional:true,read:'staff'},{key:'urgent',label:'Urgent',type:'boolean',optional:false,read:'submitter'},
 {key:'count',label:'Count',type:'number',optional:false,read:'staff'}];
const recordsInstance=(schemaFields=fields,fieldsRevision=1)=>({id:'requests',kind:'records',...pins('records'),dependencies:['members'],config:{retentionDays:30,
 schemas:[{id:'request',fieldsRevision,fields:schemaFields,staffWrite:['note','count']}],
 forms:[{id:'request-form',recordId:'request',submit:'visitor',uploadCollectionId:null},{id:'staff-form',recordId:'request',submit:'staff',uploadCollectionId:null},{id:'public-form',recordId:'request',submit:'public',uploadCollectionId:null}],
 views:[{id:'mine',recordId:'request',audience:'visitor',scope:'own',fields:['topic','urgent'],limit:2},{id:'desk',recordId:'request',audience:'staff',scope:'all',fields:['topic','note','count'],limit:50}]}});

async function owner(){
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;
 const site=await createFixtureProject(scope,user,'Repair desk '+id().slice(0,6),'Neighborhood repairs');
 for(const feature of ['core.editing','core.forms'])for(const operation of ['prepare','confirm'])
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic WH-127 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,site.project,feature,operation);
 // WH-126: visitor identity belongs to the access instance; no visitor application is needed.
 return {...actor,scope,user,...site,host:'https://app-'+site.project+'.whumpo.site'};
}
async function visitor(o){
 const invite=await auth.createAppInvitation(o.scope,o.user,o.project),options=await auth.appPasskeyOptions(db,o.project,'signup',false,invite.code),key=authenticator();
 const result=await auth.appPasskeyVerify(db,o.project,'signup',options.challengeToken,key.registration(options.options),false);
 return {...result,cookie:`__Host-whumpo-app-session-${o.project}=${result.session}`};
}
const revision=async o=>(await m.readChat(o.scope,o.user)).state.revision;
async function control(o,action){const turn=id();return {id:turn,...await m.sendChatControl(o.scope,o.user,{id:turn,revision:await revision(o),action})};}
async function activation(o,instanceId,action='activate'){
 const r=await control(o,{type:'moduleActivationReview',projectId:o.project,instanceId,action});assert.equal(r.status,200,r.error);
 const saved=await row('SELECT * FROM module_activation_reviews WHERE id=?',r.id);
 const a=await control(o,{type:'moduleActivationApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_activation_revision});assert.equal(a.status,200,a.error);
}
async function roleReview(o,visitorId,action){const r=await control(o,{type:'accessRoleReview',projectId:o.project,instanceId:'members',visitorId,action});assert.equal(r.status,200,r.error);return row('SELECT * FROM module_access_role_reviews WHERE id=?',r.id);}
const applyRole=(o,r)=>control(o,{type:'accessRoleApply',reviewId:r.id,reviewDigest:r.review_digest,expectedRevision:r.expected_access_revision});
async function setRole(o,visitorId,action){const a=await applyRole(o,await roleReview(o,visitorId,action));assert.equal(a.status,200,a.error);}
const instance=(o,localId)=>row('SELECT i.*,a.state,a.revision activation_revision FROM module_instances i JOIN module_activations a ON a.instance_id=i.id WHERE i.project_id=? AND i.local_id=?',o.project,localId);
const envelope=(resource,operation,{target=null,input=null,configRevision=resource.config_revision,requestId}={})=>({api:'whumpo-modules',version:1,operation,resourceId:resource.id,configRevision,requestId:requestId??(m.modulePolicy.moduleOperations[operation].write?id():null),target,input});
/** Visitor origin through the actual gateway with the visitor's own cookie. */
async function gateway(o,payload,v){
 const response=await appGateway.applicationGateway(new Request(o.host+'/modules',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.9','content-type':'application/json',origin:o.host,cookie:v?.cookie??''},body:JSON.stringify(payload)}),env);
 assert.equal(response.headers.get('access-control-allow-origin'),null);
 return {status:response.status,body:await response.json()};
}
/** Anonymous visitor-origin request with the public intake admission inputs: connection, Turnstile header and Siteverify. */
async function publicGateway(o,payload,{ip='192.0.2.20',token='fixture-token',verify,secret='fixture-secret'}={}){
 const response=await appGateway.applicationGateway(new Request(o.host+'/modules',{method:'POST',headers:{'cf-connecting-ip':ip,'content-type':'application/json',origin:o.host,...(token?{'whumpo-turnstile-response':token}:{})},body:JSON.stringify(payload)}),{...env,TURNSTILE_SECRET:secret},verify);
 return {status:response.status,body:await response.json()};
}
const ownerSummary=async o=>(await m.readViewBinding(o.scope,o.user,'records-summary',o.project)).data;
async function publish(o){
 const head=await row('SELECT version_id FROM project_spec_heads WHERE project_id=?',o.project),chat=async content=>{const turn=id();return {turn,result:await m.sendChat(o.scope,o.user,{id:turn,revision:await revision(o),content})};};
 const review=await chat('/publish '+head.version_id);assert.equal((await chat('/confirm '+review.turn)).result.status,200);
}
/** Workspace origin through the actual platform Worker with the owner's workspace session cookie. */
async function workspace(o,path,{method='GET',payload,cookie=`__Host-whumpo_session=${o.token}`}={}){
 const response=await m.worker.fetch(new Request('https://whumpo.com'+path,{method,headers:{cookie,origin:'https://whumpo.com',...(payload?{'content-type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined}),{...(fixture.env??{}),...env},{waitUntil(){}});
 return {status:response.status,body:await response.json()};
}
const ownerCall=(o,payload,options)=>workspace(o,`/api/projects/${o.project}/modules`,{method:'POST',payload,...options});
const submission=(records,form='request-form',values)=>envelope(records,'forms.submit',{target:{formId:form},input:{values:values??{name:value('name'),topic:'repair',note:value('note'),urgent:true,count:2}}});
const get=(records,entryId)=>envelope(records,'records.get',{target:{recordId:'request',entryId}});
const listView=(records,viewId,cursor=null)=>envelope(records,'records.view',{target:{viewId,cursor}});
const change=(records,entryId,rev,changes)=>envelope(records,'records.update',{target:{recordId:'request',entryId,revision:rev,changes}});
const removal=(records,entryId)=>envelope(records,'records.remove',{target:{recordId:'request',entryId}});
const fails=async(promise,code)=>{await assert.rejects(promise,e=>{assert.equal(e?.code,code,String(e?.stack??e));return true;});};
const count=o=>row('SELECT count(*) n FROM module_records WHERE project_id=?',o.project).then(r=>r.n);

const leadEdit=(records,entryId,revision,changes,requestId)=>envelope(records,'leads.update',{target:{recordId:'request',entryId,revision,changes},requestId});
const leadRow=entry=>row('SELECT * FROM module_record_leads WHERE entry_id=?',entry);
const list=(o,resource,query='')=>workspace(o,`/api/projects/${o.project}/module-records/${resource.id}/request${query}`);
const grant=(o,feature='business.leads')=>run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,'confirm','private-test-acceptance','synthetic WH-093 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),o.user,o.project,feature);
const today=new Date().toISOString().slice(0,10),day=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);

// WH-093 connected journey: the actual built RecordList in Chromium, every /api call answered by the actual platform Worker over disposable SQLite
// (Playwright interception, no listening port, no network). Inbox record -> stage -> due date -> note -> save -> reload -> filter -> stale refusal.
const {chromium}=createRequire(import.meta.url)(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-leads-journey-'),html=`frontend/leads-journey-${process.pid}.html`,root=resolve(dir,'web');
let browser,phase='setup';const errors=[],apiCalls=[];
try{
 const a=await owner(),b=await owner();
 for(const o of [a,b]){await configureFixtureModules(o.scope,o.user,o.project,[accessInstance,recordsInstance()]);await activation(o,'members');await activation(o,'requests');}
 const v1=await visitor(a),bv=await visitor(b);
 const records=await instance(a,'requests'),theirs=await instance(b,'requests');
 const submit=async(o,resource,v)=>{const r=await gateway(o,submission(resource),v);assert.equal(r.status,200,JSON.stringify(r.body));return r.body.result.entryId;};
 const first=await submit(a,records,v1),second=await submit(a,records,v1),foreign=await submit(b,theirs,bv);
 await grant(a);
 await writeFile(html,'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whumpo record leads journey</title></head><body><div id="root"></div><script type="module" src="/@fs/'+resolve('tests/fixtures/record-leads-journey.tsx')+'"></script></body></html>');
 await build({build:{outDir:root,rollupOptions:{input:resolve(html)}},logLevel:'error'});
 browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},locale:'en-US',timezoneId:'UTC'}),page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await context.route('https://owner.test/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.startsWith('/api/')){
   const req=route.request(),body=req.postData();apiCalls.push(req.method()+' '+url.pathname+url.search);
   const r=await m.worker.fetch(new Request('https://whumpo.com'+url.pathname+url.search,{method:req.method(),headers:{cookie:`__Host-whumpo_session=${a.token}`,origin:'https://whumpo.com',...(body?{'content-type':'application/json'}:{})},body:body??undefined}),{...(fixture.env??{}),...env},{waitUntil(){}});
   return route.fulfill({status:r.status,headers:{'content-type':'application/json'},body:Buffer.from(await r.arrayBuffer())});
  }
  const name=url.pathname==='/'?html.split('/').at(-1):decodeURIComponent(url.pathname).slice(1),file=resolve(root,name);
  if(!file.startsWith(root+sep))return route.fulfill({status:404});
  try{const ext=file.split('.').at(-1);return route.fulfill({status:200,contentType:{html:'text/html',js:'text/javascript',css:'text/css',woff2:'font/woff2'}[ext]??'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404});}
 });
 const url=`https://owner.test/?project=${a.project}&resource=${records.id}`;
 const section=entry=>page.getByText('Reference '+entry.slice(0,8).toUpperCase()).locator('xpath=ancestor::*[.//fieldset][1]');
 const stage=e=>section(e).getByLabel('Stage',{exact:true}),date=e=>section(e).getByLabel('Follow-up date',{exact:true}),note=e=>section(e).getByLabel('Private note',{exact:true}),save=e=>section(e).getByRole('button',{name:'Save lead',exact:true});
 phase="inbox lists this owner's records as New and nothing of the other owner";
 await page.goto(url);await section(first).waitFor();await section(second).waitFor();
 assert.equal(await page.getByText('Reference '+foreign.slice(0,8).toUpperCase()).count(),0,"Another owner's record is never listed");
 await section(first).getByText('Saved stage: New').waitFor();assert.equal(await stage(first).inputValue(),'new');
 phase='stage, due date and note are set and saved';
 const noteText=value('journey-note'),due=day(3);
 await stage(first).focus();await page.keyboard.type('Contacted');
 await date(first).fill(due);
 await note(first).fill(noteText);
 await save(first).focus();await page.keyboard.press('Enter');
 await section(first).getByRole('status').filter({hasText:'Lead saved.'}).waitFor();
 const saved=await leadRow(first);assert.deepEqual([saved.stage,saved.note,saved.due_date,saved.revision,saved.project_id],['contacted',noteText,due,1,a.project],'The server row holds exactly what the browser sent');
 assert.equal(await leadRow(second),null,'The untouched record gets no lead row');
 phase='a reload shows the saved lead from the server, and the filter narrows the inbox to it';
 await page.reload();await section(first).waitFor();
 assert.equal(await stage(first).inputValue(),'contacted');assert.equal(await date(first).inputValue(),due);assert.equal(await note(first).inputValue(),noteText);
 await section(first).getByText('Saved stage: Contacted').waitFor();await section(second).getByText('Saved stage: New').waitFor();
 await page.getByLabel('Stage',{exact:true}).first().selectOption('contacted');
 await section(second).waitFor({state:'detached'});await section(first).waitFor();
 phase='a stale save (changed elsewhere) is refused in place and nothing is overwritten';
 assert.equal((await ownerCall(a,leadEdit(records,first,1,{note:'Changed elsewhere'}))).status,200);
 await note(first).fill('Mine, from the old screen');await save(first).click();
 await section(first).getByRole('alert').getByText('This lead changed in another window').waitFor();
 assert.equal((await leadRow(first)).note,'Changed elsewhere','The stale save wrote nothing');
 assert.equal(errors.length,0,errors.join('\n'));
 assert.ok(apiCalls.every(c=>c.includes(a.project)),"Every call named the owner's own project: "+apiCalls.join(' | '));
 process.stdout.write(`Record leads journey passed on ${process.argv.includes('--d1')?'local D1':'SQLite'}: the built RecordList in Chromium against the actual Worker, inbox -> stage -> due date -> note -> save -> reload -> filter -> stale refusal; ${apiCalls.length} owner API calls, no other owner's record.\n`);
}catch(error){originals.error('Journey phase: '+phase);if(browser)for(const p of browser.contexts().flatMap(c=>c.pages()))await p.screenshot({path:(process.env.WHUMPO_SHOTS||'/tmp')+'/whumpo-record-leads-journey-failure.png',fullPage:true}).catch(()=>{});originals.error(String(error.stack||error));process.exitCode=1;}
finally{for(const k of consoleMethods)console[k]=originals[k];globalThis.fetch=originalFetch;await browser?.close();await rm(html,{force:true});await rm(dir,{recursive:true,force:true});await fixture.close();}

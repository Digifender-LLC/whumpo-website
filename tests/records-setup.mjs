import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
Error.stackTraceLimit=0;
// WH-070 standard appointment request form. The typed `appointmentFormReview` control, the commit trigger
// `project_spec_appointment_setup_admit`, the existing save/publish/activation reviews, the hosted `GET /forms/appointment` page on the
// application host, a real anonymous submission through the visitor gateway (Siteverify stubbed; no token is faked against a
// deployed host) and the published-site link run against the complete current schema: disposable SQLite, or local D1 with --d1.
// Two owners/projects. No model, provider or network except the stubbed Siteverify: fetch throws for everything else.
const d1=process.argv.includes('--d1');
const logs=[],consoleMethods=['log','info','warn','error','debug'],originals=Object.fromEntries(consoleMethods.map(k=>[k,console[k]]));
for(const k of consoleMethods)console[k]=(...args)=>{logs.push(args.map(String).join(' '));};
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(d1?{d1:true}:{}),{db}=fixture,id=()=>crypto.randomUUID();
let network=0,siteverify=[],verdict=null;
globalThis.fetch=async(input,init)=>{
 const url=String(input?.url??input);
 if(url==='https://challenges.cloudflare.com/turnstile/v0/siteverify'){siteverify.push(init);return Response.json(verdict(new URLSearchParams(init.body)));}
 network++;throw Error('No network or inference is available');
};
const row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results,run=(q,...p)=>db.prepare(q).bind(...p).run();
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(error){originals.error(name);throw error;}};
const {appGateway}=m;
const runtime={fetch:async()=>Response.json({ok:true,value:{state:{},result:{}}})};
const env={DB:db,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:runtime};
const pins=kind=>{const e=m.moduleCatalog.find(x=>x.kind===kind);return {module:{...e.module},schema:{...e.schema}};};
const STRICT="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";
const closedText='This form isn’t open yet';

async function owner(){
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;
 const site=await createFixtureProject(scope,user,'Salon '+id().slice(0,6),'Appointments');
 for(const feature of ['core.editing','core.forms'])for(const operation of ['prepare','confirm'])
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic WH-070 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,site.project,feature,operation);
 return {...actor,scope,user,...site,host:'https://app-'+site.project+'.whumpo.site'};
}
const revision=async o=>(await m.readChat(o.scope,o.user)).state.revision;
async function control(o,action){const turn=id();return {id:turn,...await m.sendChatControl(o.scope,o.user,{id:turn,revision:await revision(o),action})};}
async function chat(o,content){const turn=id();return {turn,result:await m.sendChat(o.scope,o.user,{id:turn,revision:await revision(o),content})};}
async function activation(o,instanceId,action='activate'){
 const r=await control(o,{type:'moduleActivationReview',projectId:o.project,instanceId,action});assert.equal(r.status,200,r.error);
 const saved=await row('SELECT * FROM module_activation_reviews WHERE id=?',r.id);
 const a=await control(o,{type:'moduleActivationApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_activation_revision});assert.equal(a.status,200,a.error);
}
async function publish(o){
 const head=await row('SELECT version_id FROM project_spec_heads WHERE project_id=?',o.project);
 const review=await chat(o,'/publish '+head.version_id);assert.equal(review.result.status,200,review.result.error);assert.equal((await chat(o,'/confirm '+review.turn)).result.status,200);
}
async function workspace(o,path){
 const response=await m.worker.fetch(new Request('https://whumpo.com'+path,{headers:{cookie:`__Host-whumpo_session=${o.token}`,origin:'https://whumpo.com'}}),{...(fixture.env??{}),...env},{waitUntil(){}});
 return {status:response.status,body:await response.json()};
}
const panel=async o=>(await workspace(o,`/api/projects/${o.project}/module-records`)).body;
const hostedPage=(o,{secret,site='0x4AAAAAAFIoE2toIv5N36J5',ip='192.0.2.50'}={})=>m.appHost.fetch(new Request(o.host+'/forms/appointment',{headers:{'cf-connecting-ip':ip}}),{...env,TURNSTILE_SECRET:secret,TURNSTILE_SITE_KEY:site});
const localPage=o=>m.appHost.fetch(new Request(`http://localhost:8787/apps/${o.project}/forms/appointment`,{headers:{'cf-connecting-ip':'192.0.2.51'}}),{...env,ENVIRONMENT:'local'});
const siteHtml=async o=>{const r=await m.host.fetch(new Request(`http://localhost/s/${o.project}/`),{...env,FILES:null},{waitUntil(){}});return {status:r.status,csp:r.headers.get('content-security-policy'),text:await r.text()};};
const count=o=>row('SELECT count(*) n FROM module_records WHERE project_id=?',o.project).then(r=>r.n);
const values=(extra={})=>({name:'Ada Lovelace',contact:'ada@example.test',service:'first-visit',day:'weekday',note:'Ground floor please',...extra});
const submit=(resource,requestId=id(),input={values:values()})=>({api:'whumpo-modules',version:1,operation:'forms.submit',resourceId:resource.id,configRevision:resource.config_revision,requestId,target:{formId:'appointment'},input});
async function post(o,payload,{secret,token='fixture-token',ip='192.0.2.60'}={}){
 const response=await appGateway.applicationGateway(new Request(o.host+'/modules',{method:'POST',headers:{'cf-connecting-ip':ip,'content-type':'application/json',origin:o.host,...(token?{'whumpo-turnstile-response':token}:{})},body:JSON.stringify(payload)}),{...env,TURNSTILE_SECRET:secret});
 return {status:response.status,body:await response.json()};
}
const instance=(o,localId)=>row('SELECT i.*,a.state FROM module_instances i JOIN module_activations a ON a.instance_id=i.id WHERE i.project_id=? AND i.local_id=?',o.project,localId);

try{
 const built=await build({entryPoints:['frontend/src/lib/appointment-form.ts'],bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
 const ui=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 const a=await owner(),b=await owner(),setup={type:'appointmentFormReview',projectId:a.project};
 let proposal,spec,standard;

 await check('the control is typed and carries the project id only; the model cannot prepare or apply it',async()=>{
  assert.deepEqual(ui.appointmentSetupView(a.project,{state:'not-configured',instanceId:null,publicForm:'none'}).action.control,setup);
  assert.ok(m.chatControl(setup));
  for(const action of [{...setup,instanceId:'appointments'},{...setup,config:{}},{type:'appointmentFormReview',projectId:'not-a-project'},{type:'appointmentFormReview'}])assert.ok(!m.chatControl(action));
  // Text commands are not controls: the command exists only behind the typed control, and the agent is never told about it.
  const typed=await chat(a,`/review-appointment-form-setup ${a.project}`);
  assert.equal(await count(a),0);assert.equal((await rows('SELECT id FROM project_spec_proposals WHERE project_id=?',a.project)).length,0,'A typed command string prepares nothing');
  assert.ok(typed.result.status===200||typed.result.status>=400);
  const prompt=m.agentPrompt({})+m.agentPrompt({},'website');for(const word of ['appointmentFormReview','review-appointment-form-setup','Add an appointment form','modules.put'])assert.ok(!prompt.includes(word),word);
  // No inference: the setup, page and link modules import no provider, model or network code.
  for(const file of ['src/shared-modules/records-setup.ts','src/appointment-page.ts','src/appointment-link.ts']){
   const source=await readFile(file,'utf8');assert.ok(!/from '\.\.?\/(?:ai|site-agent|inference|gateway|model)[^']*'|\bfetch\(|AI_API_KEY|\bsendAIChat\b/.test(source),file);
  }
  const predicate=/appointmentLinkSQL="([^"]*)"/.exec(await readFile('src/appointment-link.ts','utf8'))[1];for(const file of ['src/site-host.ts','src/site-health.ts'])assert.ok((await readFile(file,'utf8')).includes(predicate),file+' repeats the link predicate');
  assert.equal((await control(b,{...setup})).status,404,'A foreign owner project id is not found');
  assert.equal((await rows('SELECT id FROM project_spec_proposals WHERE project_id=?',b.project)).length,0);
 });

 await check('the control prepares the exact standard review; nothing is saved, registered or published',async()=>{
  assert.deepEqual((await panel(a)).appointment,{state:'not-configured',instanceId:null,publicForm:'none'});
  const prepared=await control(a,setup);assert.equal(prepared.status,200,prepared.error);
  proposal=await row('SELECT * FROM project_spec_proposals WHERE id=?',prepared.id);spec=JSON.parse(proposal.spec_json);standard=spec.instances.at(-1);
  assert.equal(proposal.operation,'change');
  assert.deepEqual({id:standard.id,kind:standard.kind,dependencies:standard.dependencies},{id:'appointments',kind:'records',dependencies:[]});
  assert.deepEqual({module:standard.module,schema:standard.schema},pins('records'),'Current catalog pin');
  const cfg=standard.config;assert.equal(cfg.retentionDays,90);assert.deepEqual(cfg.views,[]);assert.deepEqual(cfg.forms,[{id:'appointment',recordId:'appointment',submit:'public',uploadCollectionId:null}]);
  assert.deepEqual(cfg.schemas[0].fields.map(f=>[f.key,f.type,f.optional,f.read]),[['name','text',false,'owner'],['contact','text',false,'owner'],['service','choice',false,'owner'],['day','choice',false,'owner'],['note','text',true,'owner']]);
  assert.deepEqual(JSON.parse(proposal.diff_json).map(r=>[r.label,r.before]),[['Module appointments',null]]);
  const turn=(await m.readChat(a.scope,a.user)).turns.find(t=>t.id===prepared.id);assert.deepEqual(turn.specification_review,{id:proposal.id,proposalDigest:proposal.proposal_digest,expectedRevision:proposal.expected_revision});
  assert.equal((await rows('SELECT id FROM module_instances WHERE project_id=?',a.project)).length,0,'Preparing registers nothing');
  assert.equal((await panel(a)).appointment.state,'not-configured','Preparing saves nothing');
  assert.equal((await hostedPage(a,{secret:'s'})).headers.get('content-security-policy'),STRICT,'Still closed, still the strict policy');
 });

 await check('the commit trigger refuses any other shape, a duplicate, a stale base, another project and a held digest',async()=>{
  const synthetic=async(o,project)=>{const t=id(),r=await revision(o)+1;await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,action_json) VALUES(?,?,?,'Synthetic setup turn','',strftime('%Y-%m-%dT%H:%M:%fZ','now'),?)",t,o.user,r,JSON.stringify({type:'appointmentFormReview',projectId:project}));await run('UPDATE workspace_state SET revision=? WHERE user_id=?',r,o.user);return t;};
  const copy=(turnId,specJSON,base=proposal.id)=>run('INSERT INTO project_spec_proposals SELECT ?,user_id,project_id,operation,expected_revision,draft_revision,base_version_id,target_version_id,base_digest,request_hash,proposal_digest,spec_digest,manifest_digest,policy_version,expires_at,?,lock_json,manifest_json,config_json,html,html_digest,diff_json,envelope_json FROM project_spec_proposals WHERE id=?',turnId,specJSON,base);
  const withConfig=c=>({...spec,instances:[...spec.instances.slice(0,-1),{...standard,config:c}]}),cfg=standard.config,schema=cfg.schemas[0];
  const field=(key,patch)=>({...schema,fields:schema.fields.map(f=>f.key===key?{...f,...patch}:f)});
  const tampered=[
   withConfig({...cfg,retentionDays:365}),withConfig({...cfg,forms:[{...cfg.forms[0],submit:'visitor'}]}),withConfig({...cfg,forms:[{...cfg.forms[0],uploadCollectionId:'x'}]}),
   withConfig({...cfg,forms:[{...cfg.forms[0],id:'other'}]}),withConfig({...cfg,forms:[...cfg.forms,{...cfg.forms[0],id:'second'}]}),
   withConfig({...cfg,schemas:[field('name',{read:'submitter'})]}),withConfig({...cfg,schemas:[field('name',{read:'staff'})]}),withConfig({...cfg,schemas:[field('name',{optional:true})]}),
   withConfig({...cfg,schemas:[field('service',{options:[{value:'x',label:'X'}]})]}),withConfig({...cfg,schemas:[{...schema,staffWrite:['note']}]}),withConfig({...cfg,schemas:[{...schema,fields:schema.fields.slice(0,4)}]}),
   withConfig({...cfg,schemas:[{...schema,fieldsRevision:2}]}),withConfig({...cfg,views:[{id:'v',recordId:'appointment',audience:'staff',scope:'all',fields:['note'],limit:5}]}),withConfig({...cfg,extra:true}),
   {...spec,instances:[...spec.instances.slice(0,-1),{...standard,id:'bookings'}]},{...spec,instances:[...spec.instances.slice(0,-1),{...standard,dependencies:['members']}]},{...spec,instances:[...spec.instances.slice(0,-1),{...standard,note:'x'}]},
   {...spec,name:'Renamed'},{...spec,instances:spec.instances.slice(0,-1)},{...spec,instances:[...spec.instances,standard]}];
  for(const t of tampered)await assert.rejects(copy(await synthetic(a,a.project),JSON.stringify(t)),/specification_changed/);
  await assert.rejects(copy(await synthetic(b,b.project),proposal.spec_json),/specification_changed/,'A proposal for another project admits nothing');
  await assert.rejects(copy(await synthetic(b,a.project),proposal.spec_json),/specification_changed/,'Another owner cannot prepare for this project');
  await run('UPDATE projects SET site_draft_revision=site_draft_revision+1 WHERE id=?',a.project);
  await assert.rejects(copy(await synthetic(a,a.project),proposal.spec_json),/specification_changed/,'A stale base is refused');
  await run('UPDATE projects SET site_draft_revision=site_draft_revision-1 WHERE id=?',a.project);
  await run("INSERT INTO content_screening_decisions(user_id,kind,digest,policy_version,first_required,required,first_reason,first_percent,first_risk_score) VALUES(?,'generated_artifact',?,'synthetic-policy',1,1,'risk_or_missing_history',100,60)",a.user,proposal.spec_digest);
  await assert.rejects(copy(await synthetic(a,a.project),proposal.spec_json),/specification_held/,'A held digest is refused');
  await run("DELETE FROM content_screening_decisions WHERE user_id=? AND digest=?",a.user,proposal.spec_digest);
  assert.equal((await rows('SELECT id FROM project_spec_proposals WHERE project_id=? AND id!=?',a.project,proposal.id)).length,0);
 });

 await check('saving, publishing and activating are the separate existing reviews; the owner sees each step',async()=>{
  const saved=await control(a,{type:'specificationApply',reviewId:proposal.id,proposalDigest:proposal.proposal_digest,expectedRevision:proposal.expected_revision});assert.equal(saved.status,200,saved.error);
  assert.deepEqual((await panel(a)).appointment,{state:'saved',instanceId:'appointments',publicForm:'none'});
  assert.equal(ui.appointmentSetupView(a.project,(await panel(a)).appointment).action.control.type,'moduleActivationReview');
  assert.equal((await rows('SELECT id FROM module_instances WHERE project_id=?',a.project)).length,0,'Saving registers nothing');
  const again=await control(a,setup);assert.equal(again.status,400);assert.match(again.error,/already has an appointment form/);
  await publish(a);await activation(a,'appointments');
  const facts=await panel(a);assert.deepEqual(facts.appointment,{state:'registered',instanceId:'appointments',publicForm:'bound'});
  assert.equal(ui.appointmentSetupView(a.project,facts.appointment).link,`https://app-${a.project}.whumpo.site/forms/appointment`);
  assert.equal(ui.appointmentSetupView(a.project,facts.appointment).action,null);
  assert.match((await control(a,setup)).error,/already has an appointment form/);
  const other=await owner();await configureFixtureModules(other.scope,other.user,other.project,[{id:'appointments',kind:'content',...pins('content'),dependencies:[],config:{collections:[{id:'directory',type:'directory-listing@1'}]}}]);
  assert.match((await control(other,{type:'appointmentFormReview',projectId:other.project})).error,/already uses the “appointments” id/);
  const bare=await workspaceFixture(db,m),bareScope=await bare.scope(),bareProject=id();
  await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'No site','','draft',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))",bareProject,bare.account);
  assert.equal((await workspace({token:bare.token},`/api/projects/${bareProject}/module-records`)).body.appointment.state,'website-required');
  const none=await m.sendChatControl(bareScope,bare.account,{id:id(),revision:(await m.readChat(bareScope,bare.account)).state.revision,action:{type:'appointmentFormReview',projectId:bareProject}});assert.equal(none.status,404);assert.match(none.error,/private website first/);
  assert.deepEqual((await panel(b)).appointment,{state:'not-configured',instanceId:null,publicForm:'none'},'Another tenant sees nothing of this project');
 });

 await check('the hosted page: closed without the Turnstile secret, open with it, strict policy everywhere else, copy says request',async()=>{
  const resource=await instance(a,'appointments');
  // Deployed host without TURNSTILE_SECRET: the same closed page for a bound form, with no submit, no widget and no business name.
  for(const response of [await hostedPage(a,{secret:undefined}),await hostedPage(a,{secret:''}),await hostedPage(b,{secret:'s'}),await hostedPage({...a,project:id(),host:'https://app-'+id()+'.whumpo.site'},{secret:'s'})]){
   const text=await response.text();assert.equal(response.status,200);assert.ok(text.includes(closedText),text.slice(0,300));
   assert.ok(!/<form|<button|<input|<textarea|turnstile|Request an appointment/i.test(text.replace(closedText,'')),'No form, no widget, no submit');
   assert.equal(response.headers.get('content-security-policy'),STRICT);assert.ok(!text.includes('Salon'),'Nothing about the business is disclosed');
  }
  const open=await hostedPage(a,{secret:'s'}),text=await open.text();
  assert.equal(open.status,200);assert.equal(open.headers.get('cache-control'),'private, no-store');
  const policy=open.headers.get('content-security-policy');
  assert.equal(policy,"default-src 'none'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
  assert.ok(text.includes(`data-resource="${resource.id}"`)&&text.includes(`data-revision="${resource.config_revision}"`)&&text.includes('data-modules="/modules"')&&text.includes('data-site-key="0x4AAAAAAFIoE2toIv5N36J5"'));
  for(const label of ['Your name','Email or phone','What do you need?','Preferred day','Anything we should know?','(optional)','First visit','A weekend day','Send request'])assert.ok(text.includes(label),label);
  assert.ok(text.includes('Nothing is booked until they agree a time')&&text.includes('up to 90 days'));
  assert.ok(!/confirmed booking|we will email|you will receive an email|booked for you/i.test(text.replace('Nothing is booked yet, and this page does not send you an email.','')),'Never a confirmed booking, never an email promise');
  assert.ok(!/<script(?![^>]*src=)|<style|\sstyle=|\son\w+=/i.test(text),'No inline script, style or handler');
  assert.ok(!/Whumpo|whumpo\.com/i.test(text),'No platform chrome');
  // The other visitor routes keep the strict policy.
  for(const path of ['/','/visitor.js','/design-tokens.css','/appointment.css','/appointment.js'])assert.equal((await m.appHost.fetch(new Request(a.host+path),{...env,ASSETS:{fetch:async()=>new Response('x')}})).headers.get('content-security-policy'),STRICT,path);
  {const q=await m.appHost.fetch(new Request(a.host+'/forms/appointment?x=1'),{...env});assert.ok(!q.headers.get('content-security-policy').includes('challenges'));assert.ok(!(await q.text()).includes('Request an appointment'));}
  // Local mode: no widget, the module route carries the project prefix.
  const local=await (await localPage(a)).text();assert.ok(local.includes(`data-modules="/apps/${a.project}/modules"`)&&local.includes('data-site-key=""')&&!local.includes('id="widget"'));
  for(const file of ['public-app/appointment.js','public-app/appointment.css'])assert.ok((await readFile(file,'utf8')).length>500);
  const script=await readFile('public-app/appointment.js','utf8');assert.ok(script.includes("'whumpo-turnstile-response'")&&script.includes("action:'module-form'")&&!/localStorage|sessionStorage|document\.cookie|eval\(/.test(script));
 });

 await check('a real anonymous submission: Turnstile is required on a deployed host, never bypassed, and the request reaches the owner list',async()=>{
  const resource=await instance(a,'appointments'),before=await count(a);
  // No secret on a deployed host: fails closed, nothing stored, Siteverify never asked.
  siteverify=[];const closed=await post(a,submit(resource),{secret:undefined});assert.equal(closed.status,409);assert.equal(closed.body.code,'unavailable');assert.equal(closed.body.error,'Public form submissions are temporarily unavailable.');
  assert.equal(await count(a),before);assert.equal(siteverify.length,0);
  // Secret set but no token: forbidden before any Siteverify call; a failed verdict stores nothing.
  assert.equal((await post(a,submit(resource),{secret:'s',token:null})).body.code,'forbidden');assert.equal(siteverify.length,0);
  verdict=()=>({success:false});assert.equal((await post(a,submit(resource),{secret:'s',ip:'192.0.2.61'})).body.code,'forbidden');assert.equal(await count(a),before);
  verdict=p=>({success:true,hostname:new URL(a.host).hostname,action:'module-form',cdata:'not-this-form'});assert.equal((await post(a,submit(resource),{secret:'s',ip:'192.0.2.62'})).body.code,'forbidden','Siteverify must name this exact resource');
  assert.equal(await count(a),before);
  // The stubbed Siteverify names this host, action and resource: accepted, once, and replayed without a second record.
  verdict=p=>({success:true,hostname:new URL(a.host).hostname,action:'module-form',cdata:resource.id});
  const requestId=id(),sent=await post(a,submit(resource,requestId),{secret:'s',ip:'192.0.2.63'});assert.equal(sent.status,200,JSON.stringify(sent.body));assert.equal(sent.body.result.accepted,true);assert.equal(sent.body.result.formId,'appointment');
  assert.ok(!JSON.stringify(sent.body).includes('Ada Lovelace'),'The receipt never echoes values');
  assert.equal((await post(a,submit(resource,requestId),{secret:'s',ip:'192.0.2.63'})).body.receipt.replayed,true);assert.equal(await count(a),before+1);
  const stored=await row('SELECT * FROM module_records WHERE id=?',sent.body.result.entryId);assert.equal(stored.submitter_kind,'public');assert.equal(stored.expires_at-stored.created_at,90*86400);
  // The record appears in the owner list, owner only.
  const list=await workspace(a,`/api/projects/${a.project}/module-records/${resource.id}/appointment`);assert.equal(list.status,200);
  assert.deepEqual(list.body.items.map(i=>[i.submittedBy,i.values.name,i.values.service,i.values.day]),[['public','Ada Lovelace','first-visit','weekday']]);
  assert.equal((await workspace(b,`/api/projects/${b.project}/module-records/${resource.id}/appointment`)).status,404,'Another tenant cannot read it');
  assert.equal((await panel(a)).items[0].schemas[0].records.public,1);
  for(const bad of [values({service:'nope'}),values({day:'someday'}),{...values(),extra:1},values({name:''}),values({contact:'x'.repeat(301)})])assert.equal((await post(a,submit(resource,id(),{values:bad}),{secret:'s',ip:'192.0.2.64'})).body.code,'invalid_request');
  // Local environments skip Turnstile by design, but still need the bound public form.
  const localSent=await appGateway.applicationGateway(new Request(`http://localhost:8787/apps/${a.project}/modules`,{method:'POST',headers:{'cf-connecting-ip':'192.0.2.65','content-type':'application/json',origin:'http://localhost:8787'},body:JSON.stringify(submit(resource))}),{...env,ENVIRONMENT:'local'});
  assert.equal(localSent.status,200);assert.equal(await count(a),before+2);
  assert.equal(network,0);
 });

 await check('closed at every non-bound step and the site link follows the form: disabled, unpublished, republished (stale), re-activated',async()=>{
  const text=async()=>(await (await hostedPage(a,{secret:'s'})).text()),link=`https://app-${a.project}.whumpo.site/forms/appointment`;
  const state=async(want,open)=>{assert.equal((await panel(a)).appointment.publicForm,want);assert.equal(!(await text()).includes(closedText),open,want);assert.equal((await siteHtml(a)).text.includes(link),open,'link on the site root: '+want);};
  const attempt=async ip=>{const r=await instance(a,'appointments');verdict=()=>({success:true,hostname:new URL(a.host).hostname,action:'module-form',cdata:r.id});return (await post(a,submit(r),{secret:'s',ip})).body.code;};
  await state('bound',true);
  const site=await siteHtml(a);assert.equal(site.status,200);assert.ok(site.text.includes('Request an appointment ↗')&&site.text.includes('rel="noopener noreferrer"'));
  assert.ok(site.csp.includes('allow-popups')&&!site.csp.includes('allow-scripts'),'The link opens in a new tab; no script is added to the site');
  assert.equal((await siteHtml(b)).text.includes('forms/appointment'),false,'Another project’s site has no link');
  await activation(a,'appointments','disable');await state('inactive',false);assert.equal(await attempt('192.0.2.70'),'unavailable');
  assert.equal(ui.appointmentSetupView(a.project,(await panel(a)).appointment).action.control.type,'moduleActivationReview');
  await activation(a,'appointments');await state('bound',true);
  const un=await chat(a,'/unpublish '+a.project);assert.equal(un.result.status,200,un.result.error);assert.equal((await chat(a,'/confirm '+un.turn)).result.status,200);
  await state('unpublished',false);assert.equal(await attempt('192.0.2.71'),'unavailable');
  assert.match(ui.appointmentSetupView(a.project,(await panel(a)).appointment).note,/not published/);
  await publish(a);await state('stale',false);assert.equal(await attempt('192.0.2.72'),'unavailable');
  assert.match(ui.appointmentSetupView(a.project,(await panel(a)).appointment).note,/changed after/);
  await activation(a,'appointments');await state('bound',true);
 });

 console.log=originals.log;
 process.stdout.write(`Records setup passed: ${cases} groups on ${d1?'local D1':'SQLite'} — typed control and static no-inference check, exact standard review and commit trigger (tamper, duplicate, stale, other tenant, held), separate save/publish/activate, hosted page closed without the Turnstile secret and open with it, strict policy elsewhere, stubbed-Siteverify submission into the owner list and closed at every non-bound step.\n`);
}catch(error){originals.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{for(const k of consoleMethods)console[k]=originals[k];await fixture.close();}

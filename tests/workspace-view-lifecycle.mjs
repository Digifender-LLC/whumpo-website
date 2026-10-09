// Connected owner Chat -> saved page -> Chat lifecycle. Real Muse is opt-in;
// default responses are scripted. Both modes use the actual Worker and local D1.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {build as viteBuild} from 'vite';
import {chromium} from '@playwright/test';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {readBuildInputs} from '../tools/build-snapshot.mjs';

const live=process.env.RUN_LIVE_MUSE==='1';
if(live&&!process.env.WHUMPO_MUSE_KEY_FILE)throw Error('Real Muse requires WHUMPO_MUSE_KEY_FILE');
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-view-lifecycle-'),id=()=>crypto.randomUUID();
const reportDir=process.env.WHUMPO_LIFECYCLE_EVIDENCE??dir;
await mkdir(reportDir,{recursive:true,mode:0o700});
const fixtureDigest=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const inputSnapshot=await readBuildInputs(),source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const pendingHandlers=new Set();
const originalFetch=globalThis.fetch,background=[],requests=[],calls=[],steps=[],errors=[];
let fixture,browser,server,page,currentStep,script=[],success=false,phase='build',scope,user,project,layout,store,db;
let temporary,originalTemporary,savedPage,removalRevision,originalLayout,origin;
const row=(q,...p)=>db.prepare(q).bind(...p).first();
const run=(q,...p)=>db.prepare(q).bind(...p).run();
const view=widgets=>({version:1,projectId:project,widgets,shortcuts:[]});
const assertView=(actual,widgets)=>assert.deepEqual({...actual,widgets:[...actual.widgets].sort()},{...view(widgets),widgets:[...widgets].sort()});
const current=()=>layout.readLayout(scope,user);
const currentTemporary=()=>store.readInteraction(scope,user,temporary);
const operation=async(operation,data)=>({kind:'workspace',version:1,expectedRevision:(await current()).revision,operation,...data});
const outputText=body=>body.output?.flatMap(x=>x.content??[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');

try{
 await viteBuild({build:{outDir:dir+'/web'},logLevel:'error'});
 const m=await currentFixtureModules(['src/index.ts','src/workspace-layout.ts','src/chat-interactions/store.ts']);
 const worker=(await m.module('src/index.ts')).default;
 layout=await m.module('src/workspace-layout.ts');store=await m.module('src/chat-interactions/store.ts');
 fixture=await databaseFixture({d1:true});db=fixture.db;
 const authority=await workspaceFixture(db,m.identity);user=authority.account;scope=await authority.scope();project=id();
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Meadow Garden','A synthetic landscaping business','draft',datetime('now'),datetime('now'))",project,user);
 for(const projectId of [null,project])for(const op of ['read','prepare'])await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing',?,'private-test-acceptance','synthetic view lifecycle',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,projectId,op);
 await layout.mutateLayout(scope,user,{version:1,requestId:id(),expectedRevision:0,operation:'createPage',page:{id:'tab-kept',label:'Keep this page',view:view(['storage'])}});
 originalLayout=(await current()).layout;
 const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})},AI_BASE_URL:'https://opencode.ai/zen/go/v1',AI_MODEL:'muse-spark-1.3-contributor',AI_PROTOCOL:'responses',AI_API_KEY:live?(await readFile(process.env.WHUMPO_MUSE_KEY_FILE,'utf8')).trim():'synthetic-only'};
 globalThis.fetch=async(url,init)=>{
  assert.equal(String(url),env.AI_BASE_URL+'/responses','Unexpected provider or publication');
  assert(calls.length<28,'Frozen lifecycle provider call ceiling');
  const request=JSON.parse(init.body),ack=request.max_output_tokens===256;
  const call={step:currentStep,role:ack?'acknowledgment':'main',status:'dispatched'};calls.push(call);
  const started=performance.now();
  try{
   let response;
   if(live)response=await originalFetch(url,init);
   else{
    assert(ack||script.length,'Unexpected scripted inference');
    const next=ack?null:script.shift(),output=ack?{intent:'editing'}:{reply:'Scripted selection; the server supplies the saved result.',action:typeof next==='function'?await next(request):next};
    response=Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}],usage:{input_tokens:1000,output_tokens:100}});
   }
   call.httpStatus=response.status;call.elapsedMs=Math.round(performance.now()-started);
   try{const body=await response.clone().json();call.providerStatus=body.status;call.incompleteReason=body.incomplete_details?.reason;call.usage=body.usage;call.messages=body.output?.filter(x=>x.type==='message');call.outputText=outputText(body);call.answerText=outputText({...body,output:body.output?.filter(x=>x.type!=='message'||x.phase!=='commentary')});call.output=JSON.parse(call.answerText);}catch{call.responseParseFailed=true;}
   call.status='received';return response;
  }catch(error){call.status='unknown';call.error=error.name;throw error;}
 };
 const root=resolve(dir+'/web');
 async function handle(req,res){try{
  const url=new URL(req.url,origin);
  if(req.headers.host!==new URL(origin).host){res.writeHead(403).end();return;}
  if(url.pathname==='/_fixture/start'){res.writeHead(302,{'set-cookie':'__Host-whumpo_session='+authority.token+'; Secure; HttpOnly; SameSite=Lax; Path=/',location:'/workspace'}).end();return;}
  if(url.pathname.startsWith('/api/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks),input=body.length?JSON.parse(body):null;
   const trace={path:url.pathname,method:req.method,...(url.pathname==='/api/chat'&&req.method==='POST'?{input}:{})};requests.push(trace);
   // The loopback browser fixture proxies only to the canonical test origin.
   // ENVIRONMENT=local intentionally disables inference in product code.
   const headers={...req.headers,host:'whumpo.com',...(req.headers.origin===origin?{origin:'https://whumpo.com'}:{})};
   const response=await worker.fetch(new Request('https://whumpo.com'+url.pathname+url.search,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body})}),env,{waitUntil(p){background.push(p);}});
   for(const cookie of response.headers.getSetCookie())res.appendHeader('set-cookie',cookie);
   const bytes=Buffer.from(await response.arrayBuffer());trace.status=response.status;
   res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([key])=>key!=='set-cookie'))).end(bytes);return;
  }
  const name=url.pathname.startsWith('/workspace')||url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);
  if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  const bytes=await readFile(path),ext=path.split('.').at(-1);
  res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store'}).end(bytes);
 }catch(error){errors.push({phase,error:error.message});if(!res.headersSent)res.writeHead(500);res.end('Local lifecycle fixture failed');}}
 server=createServer((req,res)=>{const pending=handle(req,res);pendingHandlers.add(pending);void pending.finally(()=>pendingHandlers.delete(pending));});
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',done);});origin='http://localhost:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push({phase,error:error.message}));
 await page.goto(origin+'/_fixture/start');
 async function chat(name,text,actions,verify){
  phase=currentStep=name;script=actions;const before=calls.length;
  const record={name,text,success:false};steps.push(record);
  await page.getByRole('link',{name:'Chat',exact:true}).click();
  await page.getByRole('textbox',{name:'Message Whumpo',exact:true}).fill(text);
  const responsePromise=page.waitForResponse(r=>r.url()===origin+'/api/chat'&&r.request().method()==='POST',{timeout:150000});
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  const response=await responsePromise;assert.equal(response.status(),200,await response.text());
  const input=response.request().postDataJSON(),body=await response.json();
  let turn=body.turns?.find(t=>t.id===input.id);
  for(let n=0;n<130&&(!turn||turn.status==='pending');n++){await new Promise(done=>setTimeout(done,1000));turn=await row('SELECT * FROM chat_turns WHERE id=?',input.id);}
  record.turn={id:input.id,status:turn?.status,reply:turn?.assistant_text};record.calls=calls.length-before;
  assert.equal(turn?.status,'completed');if(!live)assert.equal(script.length,0);
  await verify(turn,input);
  const callsBeforeReplay=calls.length,replay=await context.request.post(origin+'/api/chat',{headers:{origin},data:input});assert.equal(replay.status(),200);assert.equal(calls.length,callsBeforeReplay);
  assert.deepEqual((await current()).layout.tabs.find(t=>t.id==='tab-kept'),originalLayout.tabs[0]);
  record.success=true;console.log(JSON.stringify({step:name,passed:true,calls:record.calls,realProvider:live}));
 }
 async function openPage(name){
  await page.getByRole('button',{name:'Your pages',exact:true}).click();
  await page.getByRole('dialog').getByRole('link',{name,exact:true}).click();
 }
 await chat('temporary','Show me just the project status and recent activity for Meadow Garden here in Chat. Do not add a sidebar page or change my dashboard.',[{kind:'interaction',operation:'showView',view:view(['projects','activity'])}],async(turn)=>{
  temporary=(await row('SELECT id FROM chat_interactions WHERE origin_turn_id=?',turn.id)).id;originalTemporary=temporary;
  assertView((await currentTemporary()).envelope.definition.workspaceView,['projects','activity']);assert.deepEqual((await current()).layout,originalLayout);
 });
 await chat('correct-temporary','Change that Chat overview to show just project status and page requests instead of recent activity. Keep it in Chat.',[{kind:'interaction',operation:'read',interactionId:temporary},async()=>{const f=await currentTemporary();return {kind:'interaction',operation:'replaceView',previousInteractionId:temporary,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:f.answerRevision,view:view(['projects','traffic'])};}],async(turn)=>{
  temporary=(await row('SELECT id FROM chat_interactions WHERE origin_turn_id=?',turn.id)).id;const f=await currentTemporary();assertView(f.envelope.definition.workspaceView,['projects','traffic']);assert.equal((await store.readInteraction(scope,user,originalTemporary)).state,'superseded');
 });
 await chat('save-view','Save this same corrected overview as a sidebar page called Garden desk. Keep my dashboard and Keep this page unchanged.',[{kind:'interaction',operation:'read',interactionId:temporary},()=>operation('createPage',{page:{id:'tab-garden-desk',label:'Garden desk',view:view(['projects','traffic'])}})],async()=>{
  const state=await current();savedPage=state.layout.tabs.find(t=>t.label==='Garden desk');assert(savedPage);assert.deepEqual(savedPage.view,(await currentTemporary()).envelope.definition.workspaceView);assert.deepEqual(state.layout.dashboard,originalLayout.dashboard);
 });
 const saved=()=>page.locator('[data-view-component="projects"]');
 await openPage('Garden desk');await saved().getByText('Meadow Garden',{exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Message Whumpo'}).count(),0);
 const readCalls=calls.length;await saved().getByRole('button',{name:'Refresh projects',exact:true}).click();await saved().getByText('Meadow Garden',{exact:true}).waitFor();assert.equal(calls.length,readCalls);
 for(const width of [360,390]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:reportDir+'/saved-'+width+'.png'});}
 await chat('update-view','Add recent activity to Garden desk, keeping its existing project status and page requests. Leave all my other pages and my dashboard as they are.',[()=>operation('updatePage',{pageId:savedPage.id,view:view(['projects','traffic','activity'])})],async()=>{
  savedPage=(await current()).layout.tabs.find(t=>t.id===savedPage.id);assert.deepEqual(new Set(savedPage.view.widgets),new Set(['projects','traffic','activity']));assert.deepEqual((await current()).layout.dashboard,originalLayout.dashboard);
 });
 await chat('rename-view','Rename Garden desk to Garden pulse. Do not change its contents or any other page.',[()=>operation('renamePage',{pageId:savedPage.id,label:'Garden pulse'})],async()=>{
  const next=(await current()).layout.tabs.find(t=>t.id===savedPage.id);assert.equal(next.label,'Garden pulse');assert.deepEqual(next.view,savedPage.view);savedPage=next;
 });
 await chat('dashboard','Show only projects and recent activity on my main Dashboard. Keep Garden pulse and Keep this page unchanged.',[()=>operation('setDashboard',{view:{version:1,projectId:null,widgets:['projects','activity'],shortcuts:[]}})],async()=>{
  const state=await current();assert.deepEqual(new Set(state.layout.dashboard.widgets),new Set(['projects','activity']));assert.deepEqual(state.layout.tabs.find(t=>t.id===savedPage.id),savedPage);
 });
 const dashboard=(await current()).layout.dashboard;
 await chat('remove-view','Remove Garden pulse from my sidebar. Keep its project and my other page and Dashboard.',[()=>operation('removePage',{pageId:savedPage.id})],async(_turn,input)=>{
  removalRevision=(await current()).revision;assert(!(await current()).layout.tabs.some(t=>t.id===savedPage.id));assert(await row('SELECT id FROM projects WHERE id=?',project));assert.deepEqual((await current()).layout.dashboard,dashboard);
 });
 await chat('undo-removal','Undo that removal so Garden pulse is back with the same contents. Leave the rest alone.',[{kind:'workspace',operation:'read'},()=>operation('undo',{receiptRevision:removalRevision})],async()=>{
  const state=await current();assert.deepEqual(state.layout.tabs.find(t=>t.id===savedPage.id),savedPage);assert.deepEqual(state.layout.dashboard,dashboard);
 });
 phase='dismiss and reload';const temp=()=>page.locator('[data-interaction-id="'+temporary+'"]');
 await temp().getByRole('button',{name:'Dismiss view',exact:true}).click();await temp().getByText('This Chat item is no longer available.',{exact:false}).waitFor();
 await openPage('Garden pulse');await saved().getByText('Meadow Garden',{exact:true}).waitFor();await page.reload();await saved().getByText('Meadow Garden',{exact:true}).waitFor();
 await page.getByRole('link',{name:'Chat',exact:true}).click();await temp().getByText('This Chat item is no longer available.',{exact:false}).waitFor();
 const beforeNavigation=calls.length;
 await page.getByRole('link',{name:'Settings',exact:true}).click();await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();await page.getByRole('button',{name:'Help and account',exact:true}).click();await page.getByRole('dialog',{name:'Help and account'}).getByRole('link',{name:'Your profile',exact:true}).click();await page.getByRole('heading',{name:'Your profile',exact:true}).waitFor();
 assert.equal(calls.length,beforeNavigation);assert.equal((await row('SELECT count(*) n FROM workspace_layout_receipts WHERE user_id=?',user)).n,7);
 for(const table of ['publications','site_versions','project_spec_proposals'])assert.equal((await row('SELECT count(*) n FROM '+table)).n,0);
 assert.equal((await row('SELECT count(*) n FROM standard_ai_requests WHERE user_id=? AND state<>?',user,'completed')).n,0);
 assert(!requests.some(r=>r.path==='/api/chat/actions'),'No direct action substitutes for the natural-language lifecycle');assert.deepEqual(errors,[]);
 await Promise.all(background);assert.deepEqual(await readBuildInputs(),inputSnapshot,'Source changed during lifecycle verification');success=true;
}catch(error){if(page)await page.screenshot({path:reportDir+'/failure.png'}).catch(()=>{});console.error(JSON.stringify({phase,error:error.message}));throw error;}
finally{
 await browser?.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}await Promise.allSettled([...pendingHandlers]);await Promise.allSettled(background);globalThis.fetch=originalFetch;await fixture?.close();
 const report={at:new Date().toISOString(),source,fixtureDigest,realProvider:live,success,phase,steps,calls,errors,localFixtureRemoved:true,scope:'Built 360/390px Chromium, actual Worker and synthetic local D1. Natural-language temporary/correct/save/update/rename/dashboard/remove/undo, unrelated content preservation, exact replay, zero-inference reads and durable dismissal. No deployed environment, physical device, customer publication, CMS or scanner acceptance.'};
 await writeFile(reportDir+'/report.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({success,realProvider:live,steps:steps.filter(s=>s.success).length,calls:calls.length,evidence:reportDir}));
 if(reportDir!==dir)await rm(dir,{recursive:true,force:true});
}

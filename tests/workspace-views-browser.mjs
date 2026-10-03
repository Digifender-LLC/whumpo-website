// Built current client + actual Worker and disposable D1. Synthetic identity
// authority; no passkey ceremony, provider, model or publication acceptance.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {build as viteBuild} from 'vite';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const dir=await mkdtemp('/tmp/whumpo-views-browser-'),html=`frontend/views-fixture-${process.pid}.html`,id=()=>crypto.randomUUID();
let browser,server,fixture,page,origin,fail=false,hold=false,releaseHeld,network=0,phase='build',loseDismiss=false,blockReceipt=false,holdDismiss=false,releaseDismiss;const originalFetch=globalThis.fetch,requests=[],errors=[];
try{
 await writeFile(html,'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content"><title>Whumpo view acceptance</title></head><body><div id="root"></div><script type="module" src="/@fs/'+resolve('frontend/src/main.tsx')+'"></script><script type="module">import {queryClient} from "/@fs/'+resolve('frontend/src/lib/api.ts')+'";window.fixtureQueryKeys=()=>queryClient.getQueryCache().getAll().map(q=>q.queryKey);window.fixtureRefreshSession=()=>queryClient.invalidateQueries({queryKey:["session"]});window.fixtureRefreshChat=()=>queryClient.invalidateQueries({queryKey:["chat"]});</script></body></html>');
 await viteBuild({build:{outDir:dir+'/web',rollupOptions:{input:resolve(html)}},logLevel:'error'});
 const modules=await currentFixtureModules(['src/index.ts','src/workspace-layout.ts','src/chat-interactions/store.ts','src/project-specification/store.ts']);
 const worker=(await modules.module('src/index.ts')).default,layout=await modules.module('src/workspace-layout.ts'),store=await modules.module('src/chat-interactions/store.ts'),site=await modules.module('src/project-specification/store.ts');
 fixture=await databaseFixture({d1:true});const {db}=fixture,run=(q,...p)=>db.prepare(q).bind(...p).run();
 async function owner(name){
  const authority=await workspaceFixture(db,modules.identity),user=authority.account,scope=await authority.scope(),project=id(),readGrant=id();
  await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
  await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,?,'Gardening','draft',datetime('now'),datetime('now'))",project,user,name);
  for(const projectId of [null,project])for(const operation of ['read','prepare'])await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing',?,'private-test-acceptance','synthetic browser view',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",projectId&&operation==='read'?readGrant:id(),user,projectId,operation);
  const turn=id(),prepared=await site.createWebsite(scope,user,turn,project,{name,headline:name,description:'Local gardening',theme:'ocean',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[],photos:[]});
  await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,'Create a site',?,datetime('now'),'ai','pending')").bind(turn,user,prepared.reply),...prepared.statements,scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(turn),scope.prepare('UPDATE workspace_state SET revision=1 WHERE user_id=?').bind(user)]);
  await layout.mutateLayout(scope,user,{version:1,requestId:id(),expectedRevision:0,operation:'createPage',page:{id:'tab-garden',label:'Garden overview',view:{version:1,projectId:project,widgets:['projects','activity','storage','reviews','performance'],shortcuts:[]}}});
  const review=id(),proposal=await site.prepareSpecification(scope,user,review,{kind:'specification',operation:'change',projectId:project,expectedRevision:1,operations:[{type:'content.replace',contentId:'headline',text:'Proposed garden headline'}]});
  await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,2,'Change my headline',?,datetime('now'),'ai','pending')").bind(review,user,proposal.reply),...proposal.statements,scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(review),scope.prepare('UPDATE workspace_state SET revision=2 WHERE user_id=?').bind(user)]);
  const origin=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) VALUES(?,?,3,'Change my headline','Review the brief.',datetime('now'))",origin,user);await run('UPDATE workspace_state SET revision=3 WHERE user_id=?',user);
  const form=await store.issueContentBrief(scope,user,{originTurnId:origin,projectId:project,contentIds:['headline']});
  const viewTurn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,4,'Show my project status in Chat','Pending',datetime('now'),'ai','pending')",viewTurn,user);await run('UPDATE workspace_state SET revision=4 WHERE user_id=?',user);
  const plan=await store.prepareWorkspaceView(scope,user,{originTurnId:viewTurn,view:{version:1,projectId:project,widgets:['projects','activity','reviews','performance'],shortcuts:[]}});
  await scope.batch([...plan.statements,scope.prepare("UPDATE chat_turns SET status='completed',assistant_text='Here is your overview.' WHERE id=?").bind(viewTurn)]);
  return {authority,user,scope,project,readGrant,form,review,temporary:plan.interactionId};
 }
 const a=await owner('Private garden A'),b=await owner('Private garden B');
 const env={DB:db,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}},root=resolve(dir+'/web');
 globalThis.fetch=async()=>{network++;throw Error('No external request allowed');};
 server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,origin);if(req.headers.host!==new URL(origin).host){res.writeHead(403).end();return;}
  if(url.pathname==='/_fixture/correct'){
   const old=await store.readInteraction(a.scope,a.user,a.temporary),turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,'Just show project status','Pending',datetime('now'),'ai','pending' FROM workspace_state WHERE user_id=?",turn,a.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',a.user);
   const plan=await store.prepareReplacementWorkspaceView(a.scope,a.user,{originTurnId:turn,previousInteractionId:old.envelope.id,definitionDigest:old.envelope.definitionDigest,expectedAnswerRevision:old.answerRevision,view:{version:1,projectId:a.project,widgets:['projects'],shortcuts:[]}});
   await a.scope.batch([...plan.statements,a.scope.prepare("UPDATE chat_turns SET status='completed',assistant_text='Updated overview.' WHERE id=?").bind(turn)]);a.temporary=plan.interactionId;
   res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({interactionId:a.temporary}));return;
  }
  if(url.pathname.startsWith('/_fixture/')){const selected=url.pathname==='/_fixture/other'?b:a;res.writeHead(url.pathname==='/_fixture/start'?302:204,{'set-cookie':'__Host-whumpo_session='+selected.authority.token+'; Secure; HttpOnly; SameSite=Lax; Path=/',...(url.pathname==='/_fixture/start'?{location:'/workspace/tab-garden'}:{})}).end();return;}
  if(url.pathname.startsWith('/api/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks),input=body.length?JSON.parse(body):null;const trace={path:url.pathname,kind:input?.kind,method:req.method,operation:input?.operation};requests.push(trace);
   if(fail&&url.pathname.endsWith('/views/v1/component')){res.writeHead(503,{'content-type':'application/json'}).end('{"error":"View information could not be checked."}');return;}
   if(blockReceipt&&url.pathname.endsWith('/interactions/v1/receipt')){res.writeHead(503,{'content-type':'application/json'}).end('{"error":"Receipt check temporarily unavailable."}');return;}
   const response=await worker.fetch(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body})}),env,{waitUntil(){throw Error('No background action expected');}}),bytes=Buffer.from(await response.arrayBuffer());trace.status=response.status;
   if(input?.operation==='cancel'&&url.pathname.endsWith('/interactions/v1/mutate')){
    if(holdDismiss){holdDismiss=false;await new Promise(done=>{releaseDismiss=done;});}
    if(loseDismiss){loseDismiss=false;res.writeHead(503,{'content-type':'application/json'}).end('{"error":"Dismissal confirmation was interrupted."}');return;}
   }
   if(hold&&input?.kind==='projects'&&url.pathname.endsWith('/views/v1/component')){hold=false;await new Promise(done=>{releaseHeld=done;});}
   for(const value of response.headers.getSetCookie())res.appendHeader('set-cookie',value);res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([key])=>key!=='set-cookie')));res.end(bytes);return;
  }
  const name=url.pathname.startsWith('/workspace')||url.pathname==='/'?html.split('/').at(-1):decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  const bytes=await readFile(path),ext=path.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store'}).end(bytes);
 }catch{if(!res.headersSent)res.writeHead(500);res.end('Local view fixture failed');}});
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',done);});origin='http://localhost:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 const project=()=>page.locator('[data-view-component="projects"]'),refresh=()=>project().getByRole('button',{name:'Refresh projects',exact:true});
 phase='shared saved project display';await page.goto(origin+'/_fixture/start');await project().getByText('Not published',{exact:true}).waitFor();
 for(const width of [360,390]){await page.setViewportSize({width,height:844});await project().scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert((await refresh().boundingBox()).height>=44);await page.screenshot({path:'/tmp/whumpo-shared-view-'+width+'.png'});}
 phase='saved view shares the existing exact comparison';const savedReviews=()=>page.locator('[data-view-component="reviews"]');
 await savedReviews().getByText('Private garden A',{exact:true}).waitFor();await savedReviews().locator('summary').focus();await page.keyboard.press('Enter');await savedReviews().getByText('Proposed garden headline',{exact:true}).waitFor();const comparison=await savedReviews().locator('ol').innerText();
 assert.equal(await savedReviews().getByRole('button',{name:/approve|save.*version|publish/i}).count(),0);
 for(const width of [360,390]){await page.setViewportSize({width,height:844});await savedReviews().locator('h4').evaluate(el=>el.scrollIntoView({block:'start'}));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/whumpo-view-review-'+width+'.png'});}
 fail=true;await savedReviews().getByRole('button',{name:'Refresh website reviews',exact:true}).click();await savedReviews().getByText('View information could not be checked.',{exact:true}).waitFor();assert.equal(await savedReviews().getByText('Proposed garden headline',{exact:true}).count(),0);fail=false;await savedReviews().getByRole('button',{name:'Refresh website reviews',exact:true}).click();await savedReviews().getByText('Private garden A',{exact:true}).waitFor();
 phase='refresh failure hides old facts';fail=true;await refresh().focus();await page.keyboard.press('Enter');await project().getByText('View information could not be checked.',{exact:true}).waitFor();assert.equal(await project().getByText('Private garden A',{exact:true}).count(),0);
 fail=false;await run("UPDATE projects SET status='building' WHERE id=?",a.project);await refresh().click();await project().getByText('Building',{exact:true}).waitFor();
 phase='Chat uses the same project status';await page.getByRole('link',{name:'Chat',exact:true}).click();await page.waitForFunction(()=>!window.fixtureQueryKeys().some(k=>k[0]==='workspace-view-component'));
 const form=page.locator('section[aria-label="Website change brief"]'),panel=form.locator('details').filter({has:page.getByText('Current project status',{exact:true})});
 await panel.locator('summary').focus();await page.keyboard.press('Enter');await panel.getByText('Building',{exact:true}).waitFor();assert.equal(await panel.getByText('Private garden A',{exact:true}).count(),1);
 phase='temporary view shares components at phone widths';const temporary=()=>page.locator('[data-interaction-id="'+a.temporary+'"]');
 await temporary().getByText('Building',{exact:true}).waitFor();assert.equal(await temporary().getByRole('button',{name:'Save answers',exact:true}).count(),0);
 for(const width of [360,390]){await page.setViewportSize({width,height:844});await temporary().getByRole('heading',{name:'Project overview',exact:true}).evaluate(el=>el.scrollIntoView({block:'start'}));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/whumpo-temporary-view-'+width+'.png'});}
 phase='temporary view opens the same authoritative comparison';const temporaryReviews=temporary().locator('[data-view-component="reviews"]');await temporaryReviews.locator('summary').focus();await page.keyboard.press('Enter');await temporaryReviews.getByText('Proposed garden headline',{exact:true}).waitFor();assert.equal(await temporaryReviews.locator('ol').innerText(),comparison);
 assert.equal(await temporaryReviews.getByRole('button',{name:/approve|save.*version|publish/i}).count(),0);
 phase='feature denial on both surfaces';await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=?',a.readGrant);await panel.getByRole('button',{name:'Refresh status'}).click();await panel.getByText('This status is not available with your current access.',{exact:true}).waitFor();assert.equal(await panel.getByText('Private garden A',{exact:true}).count(),0);
 await page.goto(origin+'/workspace/tab-garden');await project().getByText('This information is not available with your current access.',{exact:true}).waitFor();assert.equal(await project().getByText('Private garden A',{exact:true}).count(),0);
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','read','private-test-acceptance','restored synthetic view grant',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),a.user,a.project);await refresh().click();await project().getByText('Building',{exact:true}).waitFor();
 phase='late response cannot repopulate a previous account';hold=true;await refresh().click();await page.waitForFunction(()=>document.querySelector('[data-view-component="projects"]')?.textContent.includes('Checking current information'));
 for(let i=0;i<100&&!releaseHeld;i++)await new Promise(done=>setTimeout(done,10));assert(releaseHeld);
 await context.request.get(origin+'/_fixture/other');await page.evaluate(()=>window.fixtureRefreshSession());await project().getByText('Private garden B',{exact:true}).waitFor();releaseHeld();releaseHeld=null;
 await page.waitForFunction(user=>!window.fixtureQueryKeys().some(k=>k.includes(user)),a.user);assert.equal(await page.getByText('Private garden A',{exact:true}).count(),0);
 await refresh().click();await project().getByText('Private garden B',{exact:true}).waitFor();assert.equal(await page.getByText('Private garden A',{exact:true}).count(),0);
 phase='temporary view dismissal survives response loss, navigation and reload';
 await context.request.get(origin+'/_fixture/current');await page.goto(origin+'/workspace/chat');await temporary().getByText('Building',{exact:true}).waitFor();
 phase='corrected view retires earlier facts without requiring navigation';const previousView=temporary();const response=await context.request.get(origin+'/_fixture/correct');const updated=await response.json();await page.evaluate(()=>window.fixtureRefreshChat());
 await previousView.getByText('A newer view continues this task.',{exact:false}).waitFor();assert.equal(await previousView.locator('[data-view-component]').count(),0);
 a.temporary=updated.interactionId;await temporary().getByText('Building',{exact:true}).waitFor();assert.equal(await temporary().locator('[data-view-component]').count(),1);
 const dismissal=temporary().getByRole('button',{name:'Dismiss view',exact:true});assert((await dismissal.boundingBox()).height>=44);await dismissal.scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/whumpo-temporary-view-dismiss-390.png'});await dismissal.focus();holdDismiss=true;loseDismiss=true;blockReceipt=true;await page.keyboard.press('Enter');
 for(let i=0;i<100&&!releaseDismiss;i++)await new Promise(done=>setTimeout(done,10));assert(releaseDismiss);await page.getByRole('link',{name:'Dashboard',exact:true}).focus();releaseDismiss();releaseDismiss=null;
 await temporary().getByRole('button',{name:'Check saved status',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Dashboard');assert.equal(await temporary().locator('[data-view-component]').count(),0);
 await page.reload();await temporary().getByRole('button',{name:'Check saved status',exact:true}).waitFor();assert.equal(await temporary().locator('[data-view-component]').count(),0);assert.equal(await temporary().getByRole('button',{name:'Dismiss view',exact:true}).count(),0);
 blockReceipt=false;await temporary().getByRole('button',{name:'Check saved status',exact:true}).click();await temporary().getByRole('button',{name:'Check saved status',exact:true}).waitFor({state:'detached'});
 await page.goto(origin+'/workspace/tab-garden');await project().getByText('Building',{exact:true}).waitFor();await page.getByRole('link',{name:'Chat',exact:true}).click();await temporary().getByText('This Chat item is no longer available.',{exact:false}).waitFor();assert.equal(await temporary().locator('[data-view-component]').count(),0);
 assert.equal((await db.prepare('SELECT count(*) n FROM chat_interaction_requests WHERE interaction_id=?').bind(a.temporary).first()).n,1);
 assert.equal(network,0);assert.equal(errors.length,0,errors.join('\n'));assert(!requests.some(r=>r.path==='/api/chat/actions'||r.path==='/api/chat'&&r.method==='POST'));assert.deepEqual(requests.filter(r=>r.path.endsWith('/mutate')).map(r=>r.operation),['cancel']);
 for(const table of ['inference_calls','standard_ai_requests','publications'])assert.equal((await db.prepare('SELECT count(*) n FROM '+table).first()).n,0);
 console.log('Shared views browser passed: actual Worker/local D1, built 360/390px pages, identical Chat/project display, keyboard reads, outage/denial hides old facts, cache eviction on navigation, account-switch late-response protection; temporary views at both widths and exact durable dismissal after response loss/reload, no late focus stealing, linked view correction retires earlier facts without navigation, shared exact website comparisons on saved/temporary surfaces with no approvals, one cancel receipt and zero model/publication effects. Screenshots in /tmp/whumpo-shared-view-{360,390}.png.');
}catch(error){console.error('Shared views browser phase:',phase);console.error(JSON.stringify({url:page?.url(),body:page?await page.locator('body').innerText().catch(()=>'(unavailable)'):null,requests:requests.slice(-16),errors}));throw error;}
finally{releaseDismiss?.();releaseHeld?.();globalThis.fetch=originalFetch;await browser?.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}await fixture?.close();await rm(dir,{recursive:true,force:true});await rm(html,{force:true});}

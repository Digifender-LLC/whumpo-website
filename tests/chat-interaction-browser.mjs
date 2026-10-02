// Actual current Worker + built workspace. Identity rows and website content are
// synthetic; no passkey ceremony, live provider, inference or remote schema use.
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
const dir=await mkdtemp('/tmp/whumpo-form-browser-'),html=`frontend/form-fixture-${process.pid}.html`;
let browser,server,fixture,page,phase='build',network=0,loseOperation=null,receiptsUnavailable=false,holdOperation=null,releaseHeld=null;
const originalFetch=globalThis.fetch,requests=[],errors=[];
try{
 await writeFile(html,'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whumpo form acceptance</title></head><body><div id="root"></div><script type="module" src="/@fs/'+resolve('frontend/src/main.tsx')+'"></script><script type="module">import {queryClient} from "/@fs/'+resolve('frontend/src/lib/api.ts')+'";window.fixtureQueryKeys=()=>queryClient.getQueryCache().getAll().map(q=>q.queryKey);</script></body></html>');
 await viteBuild({build:{outDir:dir+'/web',rollupOptions:{input:resolve(html)}},logLevel:'error'});
 const modules=await currentFixtureModules(['src/index.ts','src/chat-interactions/store.ts','src/project-specification/store.ts']);
 const worker=(await modules.module('src/index.ts')).default,store=await modules.module('src/chat-interactions/store.ts'),site=await modules.module('src/project-specification/store.ts');
 fixture=await databaseFixture();const db=fixture.db,run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
 async function owner(){
  const authority=await workspaceFixture(db,modules.identity),user=authority.account,scope=await authority.scope(),project=crypto.randomUUID();
  await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
  await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Landscaping','draft',datetime('now'),datetime('now'))",project,user);
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','prepare','private-test-acceptance','synthetic browser fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",crypto.randomUUID(),user,project);
  const turn=crypto.randomUUID(),prepared=await site.createWebsite(scope,user,turn,project,{name:'Garden',headline:'A greener neighborhood',description:'Care for local gardens',theme:'ocean',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[{heading:'Services',text:'Planting and care.'}],photos:[]});
  await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,'Create my website',?,datetime('now'),'ai','pending')").bind(turn,user,prepared.reply),...prepared.statements,scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(turn),scope.prepare('UPDATE workspace_state SET revision=1 WHERE user_id=?').bind(user)]);
  return {authority,user,scope,project};
 }
 const a=await owner(),b=await owner();
 async function issue(o,previous){
  const turn=crypto.randomUUID();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) SELECT ?,user_id,revision+1,'Change my page','Please review the text.',datetime('now') FROM workspace_state WHERE user_id=?",turn,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);
  return previous?store.replaceContentBrief(o.scope,o.user,{originTurnId:turn,previousInteractionId:previous.envelope.id,definitionDigest:previous.envelope.definitionDigest,expectedAnswerRevision:previous.answerRevision,contentIds:['headline','section-1-text']}):store.issueContentBrief(o.scope,o.user,{originTurnId:turn,projectId:o.project,contentIds:['headline','section-1-text']});
 }
 let form=await issue(a);const env={DB:db,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil(){}};
 globalThis.fetch=async()=>{network++;throw Error('Unexpected external request');};
 const root=resolve(dir+'/web');let origin;
 server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,origin);if(req.headers.host!==new URL(origin).host){res.writeHead(403).end();return;}
  if(url.pathname.startsWith('/_fixture/')){const selected=url.pathname==='/_fixture/other'?b:a;res.writeHead(302,{'set-cookie':'__Host-whumpo_session='+selected.authority.token+'; Secure; HttpOnly; SameSite=Lax; Path=/',location:'/workspace'}).end();return;}
  if(url.pathname.startsWith('/api/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks),input=body.length?JSON.parse(body):null;requests.push({path:url.pathname,operation:input?.operation});
   if(receiptsUnavailable&&url.pathname.endsWith('/interactions/v1/receipt')){res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Synthetic lost read'}));return;}
   const response=await worker.fetch(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body})}),env,ctx);
   if(holdOperation&&input?.operation===holdOperation&&url.pathname.endsWith('/mutate')){holdOperation=null;await new Promise(done=>{releaseHeld=done;});}
   if(loseOperation&&input?.operation===loseOperation&&url.pathname.endsWith('/mutate')&&response.status===200){loseOperation=null;res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end();return;}
   const headers=Object.fromEntries(response.headers);headers['set-cookie']=response.headers.getSetCookie();res.writeHead(response.status,headers).end(Buffer.from(await response.arrayBuffer()));return;
  }
  const name=url.pathname==='/'||url.pathname.startsWith('/workspace')?html.split('/').at(-1):decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);
  if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}const bytes=await readFile(path),ext=path.split('.').at(-1);
  res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',svg:'image/svg+xml',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store'}).end(bytes);
 }catch(error){errors.push('Server: '+String(error));res.writeHead(500).end('Fixture error');}});
 origin='http://localhost:8787';await new Promise((done,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',done);});
 browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 const field=(n=1)=>page.locator('#form-'+form.envelope.id+'-field-'+n),card=()=>page.locator('section[aria-label="Website change brief"]').filter({has:field()}),mutations=()=>requests.filter(r=>r.path.endsWith('/interactions/v1/mutate')).length,continuations=()=>requests.filter(r=>r.path.endsWith('/interactions/v1/continue')).length;
 const post=(path,data)=>context.request.post(origin+path,{headers:{origin},data});
 phase='current form and keyboard validation';await page.goto(origin+'/_fixture/start');await field().waitFor();assert.equal(await field().inputValue(),'A greener neighborhood');
 await field().fill('');await card().getByRole('button',{name:'Prepare preview',exact:true}).click();await field().evaluate(e=>{if(document.activeElement!==e)throw Error('Invalid field did not receive focus');});assert.equal(await field().getAttribute('aria-invalid'),'true');assert.match(await card().ariaSnapshot(),/Required/);assert.equal(mutations(),0);
 await field().fill('Gardens, cared for.');await field(2).fill('Seasonal care and planting.');
 await card().getByRole('button',{name:'Collapse form'}).click();await page.reload();await page.getByRole('button',{name:'Resume form'}).click();assert.equal(await field().inputValue(),'Gardens, cared for.');assert.equal(mutations(),0);
 await page.goto(origin+'/workspace/dashboard');await page.getByRole('textbox',{name:'Message Whumpo'}).waitFor({state:'detached'});await page.goto(origin+'/workspace');await field().waitFor();assert.equal(await field().inputValue(),'Gardens, cared for.');assert.equal(mutations(),0);
 phase='mobile layout';
 for(const width of [360,390]){await page.setViewportSize({width,height:844});await field().scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));for(const button of await card().getByRole('button').all()){const box=await button.boundingBox();if(box)assert(box.height>=44);}await page.screenshot({path:`/tmp/whumpo-chat-form-${width}.png`,fullPage:true});}
 await card().evaluate(e=>e.scrollIntoView({block:'start'}));await page.screenshot({path:'/tmp/whumpo-chat-form-mobile-header.png',fullPage:true});
 await page.setViewportSize({width:1280,height:900});await card().evaluate(e=>e.scrollIntoView({block:'start'}));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/whumpo-chat-form-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});
 phase='lost draft response';loseOperation='save-draft';await card().getByRole('button',{name:'Save draft',exact:true}).click();await card().getByText('Draft saved.',{exact:true}).waitFor();assert.equal(mutations(),1);assert.equal(continuations(),0);
 assert.equal((await store.readInteraction(a.scope,a.user,form.envelope.id)).draft['field-1'],'Gardens, cared for.');
 phase='concurrent edit refusal';
 await field().fill('My local correction');const saved=await store.readInteraction(a.scope,a.user,form.envelope.id);
 await store.mutateInteraction(a.scope,a.user,{version:1,requestId:crypto.randomUUID(),interactionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:saved.answerRevision,operation:'submit',answers:{'field-1':'An edit from another tab','field-2':'Seasonal care and planting.'}});
 await card().getByRole('button',{name:'Prepare preview',exact:true}).click();await card().getByText('This form changed after your local edits.',{exact:false}).waitFor();assert.equal(await field().inputValue(),'My local correction');
 await card().getByRole('button',{name:'Use latest saved answers'}).click();assert.equal(await field().inputValue(),'An edit from another tab');assert.equal(continuations(),0);
 form=await issue(a,await store.readInteraction(a.scope,a.user,form.envelope.id));await page.reload();await field().waitFor();assert.equal(await field().inputValue(),'An edit from another tab');
 phase='unresolved submission reload';await field().fill('Gardens, cared for.');loseOperation='submit';receiptsUnavailable=true;await card().getByRole('button',{name:'Prepare preview',exact:true}).click();await card().getByRole('button',{name:'Check saved status'}).waitFor();const sent=mutations();assert.equal(continuations(),0);
 await page.reload();await field().waitFor();await card().getByText('The request is still unconfirmed.',{exact:false}).waitFor();assert.equal(mutations(),sent);assert.equal(continuations(),0);
 receiptsUnavailable=false;await card().getByRole('button',{name:'Check saved status'}).click();await card().getByRole('button',{name:'Prepare saved answers'}).waitFor();assert.equal(continuations(),0);
 phase='private preview and exact review';await card().getByRole('button',{name:'Prepare saved answers'}).click();await page.getByRole('button',{name:'Save reviewed private version',exact:true}).waitFor();assert.equal(continuations(),1);
 const preview=page.getByRole('link',{name:'Preview proposed website',exact:true});assert.match(await(await context.request.get(new URL(await preview.getAttribute('href'),origin).href)).text(),/Gardens, cared for/);
 const chat=await(await context.request.get(origin+'/api/chat')).json(),review=chat.turns.find(t=>t.specification_review).specification_review;
 assert.equal((await post('/api/chat/actions',{id:crypto.randomUUID(),revision:chat.state.revision,action:{type:'specificationApply',reviewId:review.id,proposalDigest:review.proposalDigest,expectedRevision:review.expectedRevision}})).status(),200);
 assert.equal(await row('SELECT project_id FROM publications WHERE project_id=?',a.project),null,'Private save did not publish');
 phase='discard payload';form=await issue(a);await page.reload();await field().waitFor();await field().fill('Discard this unsent text');await card().getByRole('button',{name:'Discard form',exact:true}).click();loseOperation='cancel';await card().getByRole('button',{name:'Discard this form',exact:true}).click();await page.getByText('This form is no longer available.',{exact:false}).waitFor();
 assert.equal((await row('SELECT envelope_json FROM chat_interactions WHERE id=?',form.envelope.id)).envelope_json,null);
 phase='retained forms outside recent Chat';
 const historyDraft=await issue(a);
 await store.mutateInteraction(a.scope,a.user,{version:1,requestId:crypto.randomUUID(),interactionId:historyDraft.envelope.id,definitionDigest:historyDraft.envelope.definitionDigest,expectedAnswerRevision:0,operation:'save-draft',answers:{'field-1':'PRIVATE_HISTORY_DEFAULT_CANARY'}});
 const copied=await issue(a,await store.readInteraction(a.scope,a.user,historyDraft.envelope.id));
 const copiedHistory=await(await context.request.get(origin+'/api/chat/history?before=10000')).text();assert(!copiedHistory.includes('PRIVATE_HISTORY_DEFAULT_CANARY'),'Unsubmitted defaults never appear in history');
 await store.mutateInteraction(a.scope,a.user,{version:1,requestId:crypto.randomUUID(),interactionId:copied.envelope.id,definitionDigest:copied.envelope.definitionDigest,expectedAnswerRevision:0,operation:'submit',answers:{'field-1':'ARCHIVED_FORM_ANSWER','field-2':'Saved submitted services.'}});
 for(let i=0;i<6;i++){
  const f=await issue(a);await store.mutateInteraction(a.scope,a.user,{version:1,requestId:crypto.randomUUID(),interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:0,operation:'submit',answers:{'field-1':'Pending website '+i,'field-2':'Pending services '+i}});
 }
 const oldOpen=await issue(a),beforeFill=(await row('SELECT revision FROM workspace_state WHERE user_id=?',a.user)).revision;
 for(let start=1;start<=110;start+=50)await db.batch(Array.from({length:Math.min(50,111-start)},(_,i)=>db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) VALUES(?,?,?,'Later conversation','Saved response',datetime('now'))").bind(crypto.randomUUID(),a.user,beforeFill+start+i)));
 await run('UPDATE workspace_state SET revision=revision+110 WHERE user_id=?',a.user);
 await page.reload();await page.getByRole('textbox',{name:'Message Whumpo'}).waitFor();assert.equal(await page.locator('section[aria-label="Website change brief"]').count(),0);
 const dialog=()=>page.getByRole('dialog'),openHistory=async()=>{await page.getByRole('button',{name:'Find past messages'}).click();await dialog().getByRole('heading',{name:'Past messages & forms'}).waitFor();};
 const beforeHistoryMutations=mutations(),beforeHistoryContinuations=continuations();
 await openHistory();await dialog().getByRole('searchbox',{name:'Search saved messages'}).fill('Change my page');await dialog().getByRole('button',{name:'Search',exact:true}).click();
 await dialog().getByText('ARCHIVED_FORM_ANSWER',{exact:true}).waitFor();assert.equal(await dialog().getByRole('button',{name:'Prepare preview',exact:true}).count(),0);assert(!await dialog().getByText('PRIVATE_HISTORY_DEFAULT_CANARY',{exact:true}).count());
 assert(await dialog().getByText('Form removed',{exact:true}).count());
 await page.screenshot({path:'/tmp/whumpo-form-history-390.png',fullPage:true});
 await dialog().getByRole('tab',{name:'Saved forms',exact:true}).click();await dialog().getByRole('button',{name:'More forms',exact:true}).waitFor();
 await dialog().getByRole('button',{name:'More forms',exact:true}).click();await dialog().locator('[data-resume-id="'+copied.envelope.id+'"]').waitFor();
 assert.equal(mutations(),beforeHistoryMutations);assert.equal(continuations(),beforeHistoryContinuations);
 for(const width of [360,390]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const box=await dialog().boundingBox();assert(box.width<=width);for(const button of await dialog().getByRole('button').all()){const bounds=await button.boundingBox();if(bounds)assert(bounds.height>=44);}await page.screenshot({path:`/tmp/whumpo-saved-forms-${width}.png`,fullPage:true});}
 await dialog().locator('[data-resume-id="'+copied.envelope.id+'"]').click();form=copied;await field().waitFor();assert.equal(await field().inputValue(),'ARCHIVED_FORM_ANSWER');assert.equal(await field().getAttribute('readonly'),'');await dialog().getByText('Project: Garden',{exact:true}).waitFor();
 assert.equal(await page.getByRole('dialog').count(),1);assert.equal(continuations(),beforeHistoryContinuations);
 await dialog().getByRole('button',{name:'Prepare saved answers',exact:true}).click();await dialog().getByText('Your preview is ready in Chat.',{exact:false}).waitFor();assert.equal(continuations(),beforeHistoryContinuations+1);
 await dialog().getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Save reviewed private version',exact:true}).waitFor();assert.equal(await row('SELECT project_id FROM publications WHERE project_id=?',a.project),null);
 await page.waitForFunction(()=>!window.fixtureQueryKeys().some(k=>['chat-history','chat-interaction-index','chat-interaction'].includes(k[0])));
 phase='dismissed resumed form retains local edits without redispatch';
 await openHistory();await dialog().getByRole('tab',{name:'Saved forms',exact:true}).click();await dialog().locator('[data-resume-id="'+oldOpen.envelope.id+'"]').click();form=oldOpen;await field().waitFor();await field().fill('LOCAL_RESUMED_DRAFT');
 await page.screenshot({path:'/tmp/whumpo-resumed-form-390.png',fullPage:true});const beforeDismiss=mutations();await page.keyboard.press('Escape');await dialog().waitFor({state:'detached'});
 assert.equal(await page.getByRole('button',{name:'Find past messages'}).evaluate(e=>document.activeElement===e),true);await page.waitForFunction(()=>!window.fixtureQueryKeys().some(k=>['chat-history','chat-interaction-index','chat-interaction'].includes(k[0])));
 await openHistory();assert.equal(await dialog().getByRole('heading',{name:'Continue your saved form'}).count(),0);await dialog().getByRole('tab',{name:'Saved forms',exact:true}).click();await dialog().locator('[data-resume-id="'+oldOpen.envelope.id+'"]').click();await field().waitFor();assert.equal(await field().inputValue(),'LOCAL_RESUMED_DRAFT');assert.equal(mutations(),beforeDismiss);
 loseOperation='save-draft';await dialog().getByRole('button',{name:'Save draft',exact:true}).click();await dialog().getByText('Draft saved.',{exact:true}).waitFor();assert.equal(mutations(),beforeDismiss+1);assert.equal((await store.readInteraction(a.scope,a.user,oldOpen.envelope.id)).draft['field-1'],'LOCAL_RESUMED_DRAFT');
 phase='discarded form between history and current read';
 await dialog().getByRole('button',{name:'Back to saved forms',exact:true}).click();await dialog().locator('[data-resume-id="'+oldOpen.envelope.id+'"]').waitFor();
 const current=await store.readInteraction(a.scope,a.user,oldOpen.envelope.id);await store.mutateInteraction(a.scope,a.user,{version:1,requestId:crypto.randomUUID(),interactionId:oldOpen.envelope.id,definitionDigest:oldOpen.envelope.definitionDigest,expectedAnswerRevision:current.answerRevision,operation:'cancel'});
 await dialog().locator('[data-resume-id="'+oldOpen.envelope.id+'"]').click();await dialog().getByText('This form is no longer available.',{exact:false}).waitFor();assert.equal(await dialog().getByRole('textbox').count(),0);await dialog().getByRole('button',{name:'Close',exact:true}).click();
 phase='existing Chat card remains the only editor';form=await issue(a);await page.reload();await field().waitFor();await field().fill('Private local draft');
 await openHistory();await dialog().getByRole('tab',{name:'Saved forms',exact:true}).click();assert.match(await dialog().ariaSnapshot(),/tablist "Find past work"/);await dialog().locator('[data-resume-id="'+form.envelope.id+'"]').click();await dialog().waitFor({state:'detached'});await field().waitFor();assert.equal(await field().count(),1);assert.equal(await field().inputValue(),'Private local draft');await page.waitForFunction(id=>document.activeElement?.getAttribute('data-interaction-id')===id,form.envelope.id);
 phase='account switch without any forms';await page.goto(origin+'/_fixture/other');await page.getByRole('textbox',{name:'Message Whumpo'}).waitFor();assert.equal(await page.evaluate(()=>sessionStorage.getItem('whumpo.chat-forms.v1')),null);assert(!(await page.locator('body').innerText()).includes('Private local draft'));
 phase='sign-out during a held response';await page.goto(origin+'/_fixture/start');await field().waitFor();await field().fill('Private pending draft');holdOperation='save-draft';await card().getByRole('button',{name:'Save draft',exact:true}).click();for(let i=0;!releaseHeld&&i<50;i++)await new Promise(done=>setTimeout(done,20));assert(releaseHeld);
 assert.equal((await post('/api/auth/identity/v1/logout',{version:1})).status(),200);await page.evaluate(()=>window.dispatchEvent(new Event('whumpo:identity-changed')));await page.getByRole('button',{name:'Sign in with a passkey',exact:true}).waitFor();releaseHeld();releaseHeld=null;await page.waitForLoadState('networkidle');assert.equal(await page.evaluate(()=>sessionStorage.getItem('whumpo.chat-forms.v1')),null);assert.equal(await page.locator('section[aria-label="Website change brief"]').count(),0);
 assert.equal(network,0);assert.deepEqual(errors,[]);
 console.log(`Chat form browser passed (${process.argv.includes('--d1')?'local D1':'SQLite'}): real current HTTP/built workspace, 360/390px layouts, keyboard error focus, collapse/navigation/reload, draft and submission response loss, concurrent edit refusal, linked correction, private compiler preview/exact HTTP save, current history and paged resume beyond 100 turns, private query eviction, dialog dismissal/focus/local recovery, late discard, account switch and sign-out fencing. No inference/provider calls or publication; synthetic identity, no physical-device/screen-reader ceremony acceptance.`);
}catch(error){console.error('Phase:',phase);if(page)await page.screenshot({path:'/tmp/whumpo-chat-form-failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{releaseHeld?.();await browser?.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}globalThis.fetch=originalFetch;await fixture?.close();await rm(html,{force:true});await rm(dir,{recursive:true,force:true});}

// WH-050 operator serving stop (owner decision October 8, 2026) in real Chromium: the stopped project's visitor page is
// the same built visitor client (public-app) served by the actual app-host handler, which then offers only the visitor's
// own account. Fresh-browser sign-in through recovery (with a lost response and retry), passkey replacement, sign-out and
// passkey sign-in, saved data, the last request's lost-response receipt, export and deletion (with a lost response and
// readback). Configuration, execution, modules and signup stay refused; nothing discloses the operator or reason.
// Synthetic owner and visitor, disposable SQLite or actual local D1 (--d1), loopback only (127.0.0.1:8787, the local
// visitor origin), Chromium virtual authenticators. No network, provider, deployed resource or real credential.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {currentSiteFixtureHandlers,enableFixtureVisitorAccess} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {runContainment} from '../tools/operator-containment-input.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:process.argv.includes('--d1')}),db=store.db;
const id=()=>crypto.randomUUID(),origin='http://localhost:8787';
const OPERATOR='human:PRIVATE-OPERATOR-CANARY',REASON='PRIVATE-REASON-CANARY abusive visitor application';
const service={fetch:async(_url,init)=>{const body=JSON.parse(init.body);return Response.json({ok:true,value:{state:body.input.input,result:'saved'}});}};
const assets={fetch:async request=>{const p=new URL(request.url).pathname,file=['/visitor.js','/visitor.css','/design-tokens.css'].includes(p)?p:'/index.html';return new Response(await readFile('public-app'+file),{headers:{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'}});}};
const env={DB:db,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:service,ASSETS:assets};
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No external request allowed');};
let phase='setup',server,browser;const seen=[],external=[];
const disclosed=text=>['PRIVATE-','CANARY','human:','operator','contain','suspend','stopped','abusive'].filter(marker=>text.toLowerCase().includes(marker.toLowerCase()));
try{
 // Synthetic owner with an authorized application, visitor access and a published page.
 const owner=id(),authority=await workspaceFixture(db,m,owner),scope=await authority.scope(),project=id(),now=new Date().toISOString();
 await m.readChat(scope,owner);
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Serving stop journal','Testing','draft',?,?)").bind(project,owner,now,now).run();
 const version=id(),test=id(),review=id(),pageReview=id();
 await m.backend.saveBackend(scope,owner,project,version,'export default ({state,input})=>({state:input,result:"saved"})');
 await m.backend.testBackend(scope,service,owner,project,version,test,{state:{},input:{}});
 await enableFixtureVisitorAccess(scope,owner,project);
 await m.appActivation.prepareApplication(scope,owner,project,review,'enable',version,test);await m.appActivation.confirmApplication(scope,owner,review);
 await m.appPages.prepareAppPage(scope,owner,project,pageReview,{title:'Garden journal',description:'Private garden notes',buttonLabel:'Save note',fields:[{key:'note',label:'Note',type:'text'}]});await m.appPages.confirmAppPage(scope,owner,pageReview);
 const invite=await m.appAuth.createAppInvitation(scope,owner,project),pageURL=`${origin}/apps/${project}/`;

 server=createServer(async(req,res)=>{
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(typeof v==='string')headers.set(k,v);
   const response=await m.appHost.fetch(new Request(origin+req.url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)}),env);
   const out={};response.headers.forEach((v,k)=>{if(k!=='set-cookie')out[k]=v;});const cookies=response.headers.getSetCookie();if(cookies.length)out['set-cookie']=cookies;
   const body=Buffer.from(await response.arrayBuffer());seen.push({phase,method:req.method,path:new URL(origin+req.url).pathname.replace(`/apps/${project}`,''),status:response.status,body:body.toString('utf8').slice(0,4000)});
   res.writeHead(response.status,out);res.end(body);
  }catch{res.writeHead(500,{'content-type':'application/json'});res.end('{"error":"Local fixture unavailable"}');}
 });
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',done);});
 browser=await chromium.launch({...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
 async function context(){
  const ctx=await browser.newContext({acceptDownloads:true});
  await ctx.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===origin)return route.continue();external.push(u.href);return route.abort();});
  const page=await ctx.newPage(),cdp=await ctx.newCDPSession(page);await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  page.on('pageerror',error=>{throw error;});return {ctx,page};
 }
 // Answer reaches the server and commits, but the browser never receives it.
 const loseNext=(page,path)=>page.route(origin+`/apps/${project}/`+path,async route=>{await route.fetch();await route.abort('connectionreset');},{times:1});
 const text=page=>page.evaluate(()=>document.body.innerText);

 // ---- Before the stop: a visitor joins with a passkey, saves a code and a note, then loses one save response.
 phase='before';
 const first=await context(),p1=first.page;
 await p1.goto(pageURL);await p1.locator('#signin').waitFor();
 await p1.getByText('I have an invitation').click();await p1.getByLabel('Invitation code').fill(invite.code);await p1.getByRole('button',{name:'Join with a passkey'}).click();
 await p1.locator('#recovery').waitFor();const recoveryCode=await p1.locator('#recovery-code').inputValue();assert.match(recoveryCode,/^[0-9a-f]{64}$/);
 await p1.getByRole('button',{name:'I’ve saved my code'}).click();await p1.locator('#application-form').waitFor();
 await p1.getByLabel('Note').fill('First note');await p1.getByRole('button',{name:'Save note'}).click();await p1.locator('#result').getByText('saved').waitFor();
 await loseNext(p1,'data');await p1.getByLabel('Note').fill('Note whose answer was lost');await p1.getByRole('button',{name:'Save note'}).click();
 await p1.waitForFunction(()=>document.querySelector('#status').textContent.length>0);await p1.locator('#check-request').waitFor();assert.equal(await p1.locator('#application-form').isHidden(),true);
 const lost=seen.filter(r=>r.phase==='before'&&r.method==='POST'&&r.path==='/data');assert.equal(lost.length,2);assert.ok(lost.every(r=>r.status===200),'Both saves committed on the server');

 // ---- Operator serving stop with exact preview and apply.
 const stop={action:'stop-serving',id:id(),project,expiresAt:new Date(Date.now()+7200000).toISOString(),operator:OPERATOR,reason:REASON};
 assert.equal((await runContainment(db,stop,(await runContainment(db,stop)).applyDigest)).containments[0].state,'active');

 // ---- Same browser, fresh navigation: the account view reads back the lost request and the saved data.
 phase='stopped-same-browser';
 await p1.goto(pageURL);await p1.locator('#workspace').waitFor();
 await p1.getByRole('heading',{name:'Your application account'}).waitFor();
 assert.equal(await p1.locator('#application-form').isHidden(),true,'No program form while stopped');
 await p1.locator('#saved-data').getByText('Note whose answer was lost').waitFor();
 await p1.locator('#result').getByText('saved').waitFor();
 assert.deepEqual(disclosed(await text(p1)),[]);
 // The page's own requests: configuration refused, data and receipt read, nothing executed.
 const direct=await p1.evaluate(async base=>{const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.status);return {config:await fetch(base+'config').then(r=>r.status),data:await post('data',{}),modules:await post('modules',{}),signup:await post('auth/signup/options',{inviteCode:'0'.repeat(64)})};},`/apps/${project}/`);
 assert.deepEqual(direct,{config:404,data:404,modules:404,signup:404});
 await first.ctx.close();

 // ---- A fresh browser with no session or passkey: recover (losing the first response), replace the passkey,
 // sign out and sign in with it, export, then delete (losing that response too) and read the outcome back.
 phase='stopped-fresh-browser';
 const second=await context(),p2=second.page;
 await p2.goto(pageURL);await p2.locator('#signin').waitFor();
 await p2.getByRole('heading',{name:'Your application account'}).waitFor();
 assert.match(await p2.locator('#description').innerText(),/isn’t available right now/);
 assert.equal(await p2.getByText('I have an invitation').isHidden(),true,'No new signup while stopped');
 assert.deepEqual(disclosed(await text(p2)),[]);
 await p2.getByText('Recover my account').click();await p2.getByLabel('Recovery code',{exact:true}).fill(recoveryCode);await p2.getByRole('button',{name:'Recover account'}).click();
 await p2.locator('#recovery').waitFor();const replacement=await p2.locator('#recovery-code').inputValue();assert.notEqual(replacement,recoveryCode);
 await loseNext(p2,'auth/recover');await p2.getByRole('button',{name:'I’ve saved this code. Recover my account'}).click();
 await p2.waitForFunction(()=>document.querySelector('#status').textContent.length>0);assert.equal(await p2.locator('#recovery').isVisible(),true,'The lost answer keeps the recovery step');
 await p2.getByRole('button',{name:'I’ve saved this code. Recover my account'}).click();
 await p2.locator('#workspace').waitFor();await p2.getByText('Account access').click();await p2.getByText('Add a replacement passkey now.').waitFor();
 const recoveries=seen.filter(r=>r.phase==='stopped-fresh-browser'&&r.path==='/auth/recover');assert.deepEqual(recoveries.map(r=>r.status),[200,200],'The retry reads back the committed recovery');
 await p2.getByRole('button',{name:'Add a passkey'}).click();await p2.getByText('Passkey added.').waitFor();
 await p2.getByRole('button',{name:'Sign out'}).click();await p2.getByText('You’re signed out.').waitFor();
 await p2.getByRole('button',{name:'Sign in with a passkey'}).click();await p2.locator('#workspace').waitFor();
 await p2.locator('#saved-data').getByText('Note whose answer was lost').waitFor();
 const [download]=await Promise.all([p2.waitForEvent('download'),p2.getByText('Download my data').click()]);
 const exported=JSON.parse(await readFile(await download.path(),'utf8'));
 assert.equal(exported.format,'whumpo-visitor-export-v1');assert.equal(exported.document.value.note,'Note whose answer was lost');assert.equal(exported.operations.length,2);
 await p2.getByText('Delete my application account').click();await p2.getByRole('button',{name:'Review account deletion'}).click();
 await p2.getByLabel('Type DELETE to confirm').fill('DELETE');await loseNext(p2,'account/delete');
 await p2.getByRole('button',{name:'Permanently delete my account'}).click();await p2.locator('#deletion-pending').waitFor();
 await p2.reload();await p2.locator('#deleted').waitFor();
 assert.deepEqual(disclosed(await text(p2)),[]);
 assert.equal((await db.prepare('SELECT count(*) n FROM app_visitors WHERE project_id=?').bind(project).first()).n,0,'The deletion committed once');
 await second.ctx.close();

 // ---- Server-side evidence: nothing executed or configured during the stop; no answer disclosed the action.
 const during=seen.filter(r=>r.phase.startsWith('stopped'));
 assert.ok(during.filter(r=>r.path==='/config').every(r=>r.status===404)&&during.some(r=>r.path==='/config'));
 assert.equal(during.some(r=>(r.method==='POST'&&['/data','/modules','/modules/upload'].includes(r.path)||r.path.startsWith('/auth/signup'))&&r.status<400),false);
 assert.deepEqual(during.flatMap(r=>disclosed(r.body)),[]);
 assert.deepEqual(external,[],'No request left the local visitor origin');
 // The owner workspace still reads the unchanged live page and the stop is still active.
 const ownerView=await m.appPages.readAppPage(scope,owner,project);assert.equal(ownerView.page.id,pageReview);
 assert.equal((await runContainment(db,{action:'status',subject:{kind:'project',id:project}})).usage.projects[0].serving.stopped,true);
 console.log(`Operator serving stop browser journey passed in Chromium ${browser.version()} on ${process.argv.includes('--d1')?'actual local D1':'SQLite'}: same built visitor client on the stopped page, account-only view without program form or signup, lost data-save receipt read back after the stop, fresh-browser recovery with a lost response and retry, replacement passkey, sign-out and passkey sign-in, saved data, export, deletion with a lost response read back after reload; configuration, execution, modules and signup refused; no operator, reason or stop disclosed; loopback only.`);
}finally{
 await browser?.close();if(server)await new Promise(done=>{server.closeAllConnections();server.close(done);});
 globalThis.fetch=originalFetch;await store.close();
}

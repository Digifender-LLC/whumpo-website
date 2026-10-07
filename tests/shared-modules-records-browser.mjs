// Maintained Records/Chat UI + current Worker/current D1. Owners and signed passkey visitors are synthetic.
// Visitor requests use the actual gateway through a loopback origin proxy; this is transport acceptance, not
// acceptance of a published visitor page (the WH-070 portal owns that rendered journey). No model/provider.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {build as viteBuild} from 'vite';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {authenticator} from './app-authenticator.mjs';
import {authenticator as workspaceAuthenticator} from './helpers/webauthn-authenticator.mjs';
Error.stackTraceLimit=0;
const {chromium}=createRequire(import.meta.url)(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const dir=await mkdtemp('/tmp/whumpo-records-browser-'),html=`frontend/records-fixture-${process.pid}.html`,id=()=>crypto.randomUUID();
let fixture,browser,server,page,phase='build',network=0,loseSetup=true,loseSubmission=true;const errors=[],requests=[],background=[],originalFetch=globalThis.fetch;
try{
 await writeFile(html,'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Records acceptance</title></head><body><div id="root"></div><script type="module" src="/@fs/'+resolve('frontend/src/main.tsx')+'"></script></body></html>');
 await viteBuild({build:{outDir:dir+'/web',rollupOptions:{input:resolve(html)}},logLevel:'error'});
 const m=await currentSiteFixtureHandlers();fixture=await databaseFixture({d1:true});const db=fixture.db;
 const row=(q,...p)=>db.prepare(q).bind(...p).first(),run=(q,...p)=>db.prepare(q).bind(...p).run();
 const authority=await workspaceFixture(db,m),user=authority.account,scope=await authority.scope(),site=await createFixtureProject(scope,user,'Enquiry browser','Synthetic enquiries'),project=site.project;
 await run("UPDATE workspace_state SET step='ready' WHERE user_id=?",user);
 for(const feature of ['core.editing','core.forms'])for(const operation of ['read','prepare','confirm'])await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic records browser',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,project,feature,operation);
 for(const operation of ['read','prepare'])await run("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.editing',?,'private-test-acceptance','synthetic records browser',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,operation);
 const pins=m.moduleCatalog.find(x=>x.kind==='access');
 await configureFixtureModules(scope,user,project,[{id:'visitors',kind:'access',module:pins.module,schema:pins.schema,dependencies:[],config:{roles:[],enrollment:'invitation'}}]);
 const control=async action=>{const turn=id(),result=await m.sendChatControl(scope,user,{id:turn,revision:(await m.readChat(scope,user)).state.revision,action});assert.equal(result.status,200,result.error);return turn;};
 const review=await control({type:'moduleActivationReview',projectId:project,instanceId:'visitors',action:'activate'}),q=await row('SELECT * FROM module_activation_reviews WHERE id=?',review);
 await control({type:'moduleActivationApply',reviewId:q.id,reviewDigest:q.review_digest,expectedRevision:q.expected_activation_revision});
 const env={...fixture.env,DB:db,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil(p){background.push(p);}};
 globalThis.fetch=async()=>{network++;throw Error('No inference/provider in this journey');};
 const root=resolve(dir+'/web'),visitorHost='https://app-'+project+'.whumpo.site';let origin,visitorToken;
 server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,origin);if(req.headers.host!==new URL(origin).host){res.writeHead(403).end();return;}
  if(url.pathname==='/_fixture/owner'){res.writeHead(302,{'set-cookie':'__Host-whumpo_session='+authority.token+'; Secure; HttpOnly; SameSite=Lax; Path=/',location:'/workspace/records?project='+project}).end();return;}
  if(url.pathname==='/_fixture/visitor'){res.writeHead(200,{'set-cookie':'__Host-whumpo-app-session-'+project+'='+visitorToken+'; Secure; HttpOnly; SameSite=Lax; Path=/','content-type':'text/plain'}).end('Synthetic signed visitor transport fixture');return;}
  if(url.pathname.startsWith('/api/')||url.pathname==='/_visitor/modules'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks),input=body.length&&req.headers['content-type']?.includes('application/json')?JSON.parse(body):null;
   requests.push({path:url.pathname,method:req.method,action:input?.action?.type,requestId:input?.requestId});
   const visitor=url.pathname==='/_visitor/modules',target=visitor?visitorHost+'/modules':url;
   const response=visitor?await m.appGateway.applicationGateway(new Request(target,{method:req.method,headers:{...req.headers,host:new URL(visitorHost).host,origin:visitorHost},body}),{...env,ENVIRONMENT:'test'})
    :await m.worker.fetch(new Request(target,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body})}),env,ctx);
   if(response.status===500)errors.push('Unexpected HTTP500 '+url.pathname);
   if(loseSetup&&input?.action?.type==='recordsModuleReview'&&response.status===200){loseSetup=false;res.writeHead(200,{'content-type':'application/json'}).end();return;}
   if(loseSubmission&&visitor&&input?.operation==='forms.submit'&&response.status===200){loseSubmission=false;res.writeHead(200,{'content-type':'application/json'}).end();return;}
   const headers=Object.fromEntries(response.headers);headers['set-cookie']=response.headers.getSetCookie();res.writeHead(response.status,headers).end(Buffer.from(await response.arrayBuffer()));return;
  }
  const name=url.pathname==='/'||url.pathname.startsWith('/workspace')?html.split('/').at(-1):decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);
  if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  let bytes;try{bytes=await readFile(path);}catch(error){if(error.code==='ENOENT'){res.writeHead(404).end();return;}throw error;}
  res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',svg:'image/svg+xml',woff2:'font/woff2'}[path.split('.').at(-1)]??'application/octet-stream','cache-control':'no-store'}).end(bytes);
 }catch(e){errors.push(String(e));res.writeHead(500).end('Fixture failure');}});
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',done);});origin='http://localhost:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
 const owner=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});page=await owner.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 const ownerKey=workspaceAuthenticator(origin),cdp=await owner.newCDPSession(page);await run("INSERT INTO identity_credentials VALUES(?,?,?,0,'Enquiry browser passkey','active',NULL,unixepoch(),NULL)",ownerKey.id,user,ownerKey.publicKey);await cdp.send('WebAuthn.enable');
 const {authenticatorId}=await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});await cdp.send('WebAuthn.addCredential',{authenticatorId,credential:ownerKey.virtualCredential('localhost',user)});
 phase='owner setup panel';await page.goto(origin+'/_fixture/owner');const setup=page.getByRole('button',{name:'Set up visitor enquiries',exact:true});await setup.waitFor();
 for(const width of [360,390,1280]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert((await setup.boundingBox()).height>=44);assert((await page.getByLabel('Optional photo attachments').boundingBox()).height>=44);await page.screenshot({path:'/tmp/whumpo-records-setup-'+width+'.png',fullPage:true});}
 phase='lost setup response recovers exact review';await setup.click();const save=page.getByRole('button',{name:'Save reviewed private version',exact:true}).last();await save.waitFor();
 const prepared=await row("SELECT p.* FROM project_spec_proposals p JOIN chat_turns t ON t.id=p.id WHERE p.project_id=? AND json_extract(t.action_json,'$.type')='recordsModuleReview'",project);assert.ok(prepared);
 assert.equal(requests.filter(r=>r.action==='recordsModuleReview').length,1);assert.equal((await row("SELECT count(*) n FROM project_spec_proposals p JOIN chat_turns t ON t.id=p.id WHERE p.project_id=? AND json_extract(t.action_json,'$.type')='recordsModuleReview'",project)).n,1);
 assert.equal(await row("SELECT id FROM module_instances WHERE project_id=? AND local_id='visitor-enquiries'",project),null);
 await page.getByText('Proposed website changes',{exact:true}).last().click();await page.getByRole('heading',{name:'Module visitor-enquiries',exact:true}).waitFor();
 phase='save separate exact review';const savedResponse=page.waitForResponse(r=>r.url().endsWith('/api/chat/actions')&&r.request().postDataJSON()?.action?.type==='specificationApply'&&r.request().postDataJSON()?.action?.reviewId===prepared.id);await save.click();assert.equal((await savedResponse).status(),200);assert.equal((await row('SELECT revision FROM project_spec_heads WHERE project_id=?',project)).revision,prepared.expected_revision+1);await page.goto(origin+'/workspace/records?project='+project);
 const activate=page.getByRole('button',{name:'Review enquiry activation',exact:true});await activate.waitFor();assert.equal(await row("SELECT id FROM module_instances WHERE project_id=? AND local_id='visitor-enquiries'",project),null);
 phase='activate separate exact review';await activate.click();const confirm=page.getByRole('button',{name:'Activate reviewed module',exact:true}).last();await confirm.waitFor();const activatedResponse=page.waitForResponse(r=>r.url().endsWith('/api/chat/actions')&&r.request().postDataJSON()?.action?.type==='moduleActivationApply');await confirm.click();assert.equal((await activatedResponse).status(),200);
 await page.goto(origin+'/workspace/records?project='+project);await page.getByText('Visitor enquiries are active.',{exact:false}).waitFor();
 const records=await row("SELECT * FROM module_instances WHERE project_id=? AND local_id='visitor-enquiries'",project);assert.ok(records);assert.equal((await row('SELECT count(*) n FROM publications WHERE project_id=?',project)).n,0);
 const browserScope=async()=>{const token=(await owner.cookies(origin)).find(c=>c.name==='__Host-whumpo_session').value;return m.admitWorkspace(db,await m.resolveIdentity(db,{version:1,client:'web',kind:'session',token}));};
 phase='maintained portal editor and exact private review';const portal=page.getByRole('region',{name:'Visitor portal setup',exact:true});await portal.getByLabel('Layout',{exact:true}).selectOption('journal');await portal.getByLabel('Portal title',{exact:true}).fill('Community enquiries');await portal.getByRole('button',{name:'Add a custom welcome card',exact:true}).click();await portal.getByLabel('Card text',{exact:true}).fill('A synthetic welcome <script>plain text</script>.');
 for(const width of [390,1280]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/whumpo-portal-setup-'+width+'.png',fullPage:true});}
 await portal.getByRole('button',{name:'Review visitor portal design',exact:true}).click();const savePortal=page.getByRole('button',{name:'Save reviewed private version',exact:true}).last();await savePortal.waitFor();
 const portalReview=await row("SELECT p.* FROM project_spec_proposals p JOIN chat_turns t ON t.id=p.id WHERE p.project_id=? AND json_extract(t.action_json,'$.type')='presentationReview'",project);assert.ok(portalReview);const portalBefore=JSON.parse(portalReview.spec_json).presentation;assert.equal(portalBefore.layout,'journal');assert.equal(portalBefore.title,'Community enquiries');
 const preview=await owner.request.get(origin+'/api/specification-reviews/'+portalReview.id+'/presentation');assert.equal(preview.status(),200);const previewHTML=await preview.text();assert(previewHTML.includes('Private preview'));assert(previewHTML.includes('&lt;script&gt;plain text&lt;/script&gt;'));assert(!previewHTML.includes('<script'));
 const portalSavedResponse=page.waitForResponse(r=>r.url().endsWith('/api/chat/actions')&&r.request().postDataJSON()?.action?.type==='specificationApply'&&r.request().postDataJSON()?.action?.reviewId===portalReview.id);await savePortal.click();assert.equal((await portalSavedResponse).status(),200);await page.goto(origin+'/workspace/records?project='+project);await page.getByRole('link',{name:'Preview saved visitor portal',exact:true}).waitFor();assert.equal((await row('SELECT count(*) n FROM publications WHERE project_id=?',project)).n,0);
 phase='signed visitor transport and lost accepted response';const invite=await m.appAuth.createAppInvitation(await browserScope(),user,project),options=await m.appAuth.appPasskeyOptions(db,project,'signup',false,invite.code),key=authenticator(),visitor=await m.appAuth.appPasskeyVerify(db,project,'signup',options.challengeToken,key.registration(options.options),false);visitorToken=visitor.session;
 const visitorContext=await browser.newContext();await visitorContext.request.get(origin+'/_fixture/visitor');
 const values={name:'Synthetic enquiry visitor',message:'Private <script>not executable</script> & browser message'},payload={api:'whumpo-modules',version:1,operation:'forms.submit',resourceId:records.id,configRevision:records.config_revision,requestId:id(),target:{formId:'enquiry'},input:{values}};
 const submit=()=>visitorContext.request.post(origin+'/_visitor/modules',{headers:{origin},data:payload});const lost=await submit();assert.equal(lost.status(),200,await lost.text());assert.equal(await lost.text(),'');
 const replay=await submit(),accepted=await replay.json();assert.equal(replay.status(),200,JSON.stringify(accepted));assert.equal(accepted.receipt.replayed,true);assert.equal((await row('SELECT count(*) n FROM module_records WHERE project_id=?',project)).n,1);
 assert.ok(!JSON.stringify(accepted).includes(values.message));
 phase='owner private panel renders visitor values as text';await page.reload();await page.getByText(values.name,{exact:true}).waitFor();await page.getByText(values.message,{exact:true}).waitFor();assert.equal(await page.locator('script').filter({hasText:'not executable'}).count(),0);
 for(const width of [360,390,1280]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/whumpo-records-values-'+width+'.png',fullPage:true});}
 const summary=await (await owner.request.get(origin+'/api/projects/'+project+'/module-records')).json();assert.equal(summary.items[0].schemas[0].records.visitor,1);
 const chat=await (await owner.request.get(origin+'/api/chat')).text();for(const marker of Object.values(values)){assert.ok(!chat.includes(marker));assert.ok(!JSON.stringify(summary).includes(marker));}
 phase='revocation denies saved request replay';await m.appAuth.revokeAppVisitor(await browserScope(),user,project,visitor.visitorId);const denied=await submit();assert.equal(denied.status(),403);assert.equal((await denied.json()).code,'forbidden');
 await page.reload();await page.getByText(values.message,{exact:true}).waitFor();assert.equal((await row('SELECT count(*) n FROM module_records WHERE project_id=?',project)).n,1);
 assert.equal((await row('SELECT count(*) n FROM module_access_roles WHERE project_id=?',project)).n,0);assert.equal((await row("SELECT count(*) n FROM identity_ceremony_receipts WHERE account_id=? AND kind='reauth'",user)).n,3);assert.equal(network,0);assert.deepEqual(errors,[]);
 process.stdout.write('Records browser passed on current local D1: maintained owner Records setup and exact Chat save/activation, lost setup response recovery, signed visitor transport with lost-submit replay, private text-only owner readback, maintained portal editor/exact private preview/save, mobile/desktop layout, revoked visitor denial, no publication/grants/model calls. Published visitor page acceptance belongs to WH-070.\n');
}catch(error){console.error('Records browser phase: '+phase);console.error(String(error.stack??error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));if(page)console.error((await page.locator('body').innerText().catch(()=>'' )).slice(-4000));process.exitCode=1;}
finally{globalThis.fetch=originalFetch;await browser?.close();if(server)await new Promise(done=>server.close(done));await Promise.allSettled(background);await fixture?.close();await rm(dir,{recursive:true,force:true});await rm(html,{force:true});}

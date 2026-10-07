// Real shared maintained connection controls + actual Worker + synthetic external read. Loopback only.
Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {fixtureKeyring,initializeFixtureKeys,fixtureCiphertext} from './helpers/connection-keyring.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const serverBuild=await build({stdin:{resolveDir:process.cwd(),contents:"export {default as worker} from './src/index';export {hashToken,newSessionToken} from './src/security';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';"},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(serverBuild.outputFiles[0].text).toString('base64'));
const clientBuild=await build({tsconfig:'tsconfig.frontend.json',stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ConnectionConsent} from './frontend/src/connection-consent';import {queryClient} from './frontend/src/lib/api';
window.fixtureCache=()=>JSON.stringify(queryClient.getQueryCache().getAll().map(q=>q.state.data));const root=createRoot(document.getElementById('root'));const status={inclusion:{connect:true,read:true,planId:'business',source:'invoice'},enabled:true,connected:true,expired:false,expiresAt:null,revocationPending:false,authorizationPending:false,recoveryPending:false};window.fixtureRender=(disabled=false)=>root.render(<ConnectionConsent provider="cloudflare" status={status} disabled={disabled} refresh={async()=>{}}/>);window.fixtureRender();`},bundle:true,format:'esm',platform:'browser',write:false,jsx:'automatic'});
const fixture=await databaseFixture(),db=fixture.db,key=fixtureKeyring(),actor=await workspaceFixture(db,m),token=crypto.randomUUID(),canary='private-zone.example';
const originalFetch=globalThis.fetch;let providerCalls=0,loseReply=false,holdReply=false,entered,release,browser,server,origin;const requests=[],errors=[];
try{
 await paidPlan(db,actor.account,'business');await initializeFixtureKeys(db,key);await db.prepare("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')").bind(actor.account).run();
 await db.prepare("INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES(?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'active')").bind(token,actor.account,await fixtureCiphertext(key,`whumpo:cloudflare:token:${actor.account}:${token}`,JSON.stringify({access:'synthetic-browser-access'}))).run();
 globalThis.fetch=async(url,init)=>{assert.equal(new URL(url).origin,'https://api.cloudflare.com');assert.equal(new URL(url).pathname,'/client/v4/zones');assert.equal(init.redirect,'manual');providerCalls++;return Response.json({success:true,result:[{id:'a'.repeat(32),name:canary,status:'active'}],result_info:{total_pages:1}});};
 const env={DB:db,ENVIRONMENT:'local',CLOUDFLARE_CLIENT_ID:'synthetic-client',CLOUDFLARE_CLIENT_SECRET:'synthetic-secret',CONNECTION_ENCRYPTION_KEYRING:key,API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
 server=createServer(async(req,res)=>{try{
  if(req.url==='/client.js'){res.writeHead(200,{'content-type':'text/javascript'}).end(clientBuild.outputFiles[0].text);return;}
  if(req.url==='/'){res.writeHead(200,{'content-type':'text/html','set-cookie':`__Host-whumpo_session=${actor.token}; Secure; HttpOnly; SameSite=Lax; Path=/`}).end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/client.js"></script></body></html>');return;}
  if(!req.url.startsWith('/api/')){res.writeHead(404).end();return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);requests.push({path:req.url,body:body.toString(),method:req.method});
  const response=await m.worker.fetch(new Request(origin+req.url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body})}),env,{waitUntil(){}});
  if(req.url.endsWith('/execute')&&loseReply){loseReply=false;res.destroy();return;}
  if(req.url.endsWith('/execute')&&holdReply){holdReply=false;entered?.();await new Promise(done=>{release=done;});}
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){errors.push('server '+String(error));res.writeHead(500).end('Fixture error');}});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));origin='http://localhost:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.getByRole('button',{name:'Review lookup',exact:true}).waitFor();assert.equal(providerCalls,0);assert.equal(requests.length,0);
 await page.getByRole('button',{name:'Review lookup',exact:true}).click();await page.getByRole('button',{name:'Allow this lookup once',exact:true}).waitFor();assert.equal(providerCalls,0);assert.match(await page.locator('#root').innerText(),/Destination: this owner panel/);
 // Editing the visible query invalidates the saved approval instead of changing its meaning.
 await page.getByRole('textbox',{name:'Page',exact:true}).fill('2');assert.equal(await page.getByRole('button',{name:'Allow this lookup once',exact:true}).count(),0);
 await page.getByRole('button',{name:'Review lookup',exact:true}).click();await page.getByRole('button',{name:'Allow this lookup once',exact:true}).click();await page.getByText(canary,{exact:false}).waitFor();assert.equal(providerCalls,1);
 assert.equal(await page.evaluate(()=>window.fixtureCache()),'[]');assert.equal((await db.prepare('SELECT count(*) n FROM chat_turns WHERE user_id=?').bind(actor.account).first()).n,0);
 const row=await db.prepare("SELECT * FROM connector_lookup_consents WHERE user_id=? AND state='consumed'").bind(actor.account).first();assert.ok(row);assert.ok(!JSON.stringify(row).includes(canary));assert.ok(!JSON.stringify(row).includes('"page"'));
 await page.getByRole('button',{name:'Discard result',exact:true}).click();assert.equal(await page.getByText(canary,{exact:false}).count(),0);
 // A lost execution response does not retry, and the used review button stays absent.
 loseReply=true;await page.getByRole('button',{name:'Review lookup',exact:true}).click();await page.getByRole('button',{name:'Allow this lookup once',exact:true}).click();await page.getByRole('alert').filter({hasText:'A lost reply is not retried'}).waitFor();assert.equal(providerCalls,2);assert.equal(await page.getByRole('button',{name:'Allow this lookup once',exact:true}).count(),0);
 // Revoking UI scope while its reply is in flight cannot restore the old external result.
 holdReply=true;const started=new Promise(done=>{entered=done;});await page.getByRole('button',{name:'Review lookup',exact:true}).click();await page.getByRole('button',{name:'Allow this lookup once',exact:true}).click();await started;await page.evaluate(()=>window.fixtureRender(true));release();await page.getByRole('button',{name:'Review lookup',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('button')?.disabled);assert.equal(await page.getByText(canary,{exact:false}).count(),0);
 await page.evaluate(()=>window.fixtureRender(false));await page.getByRole('button',{name:'Review lookup',exact:true}).click();await page.getByRole('button',{name:'Allow this lookup once',exact:true}).click();await page.getByText(canary,{exact:false}).waitFor();await page.evaluate(()=>window.dispatchEvent(new Event('whumpo:workspace-reset')));assert.equal(await page.getByText(canary,{exact:false}).count(),0);
 // Reload never restores params/results or silently starts another read.
 const before=providerCalls;await page.reload();await page.getByRole('button',{name:'Review lookup',exact:true}).waitFor();assert.equal(providerCalls,before);assert.equal(await page.getByText(canary,{exact:false}).count(),0);assert.deepEqual(errors,[]);
 const apiURL=origin+'/api/connectors/lookups/v1/prepare',requestBody={version:1,provider:'cloudflare',operationId:'zones.list',params:{page:1},destination:'owner-panel'};
 assert.equal((await context.request.post(apiURL,{data:requestBody,headers:{origin:'https://evil.example'}})).status(),403);
 const anonymous=await browser.newContext();assert.equal((await anonymous.request.post(apiURL,{data:requestBody,headers:{origin}})).status(),401);await anonymous.close();
 console.log('Connector lookup browser passed: shared maintained connection controls, explicit exact review, changed-query invalidation, one provider read, transient display/discard, lost response without retry, disabled/workspace-reset late-result refusal, reload without fetch, no Chat/cache persistence, authenticated same-origin Worker admission. Synthetic provider only.');
}finally{release?.();await browser?.close();await new Promise(done=>server?server.close(done):done());globalThis.fetch=originalFetch;await fixture.close();}

// Explicit opt-in: real test deployment + configured Muse, synthetic private work only.
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {requireCurrentProbeSchema,liveWorkspaceBrowser,seedCurrentProbeIdentity} from './helpers/live-workspace.mjs';
import {cloudflareClient,remoteD1} from '../tools/cms-cloudflare.mjs';
if(process.env.RUN_LIVE_SERVICE_CLIENTS!=='1')throw Error('Set RUN_LIVE_SERVICE_CLIENTS=1 for the private live service-client check');
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));assert.equal(config.vars.ENVIRONMENT,'test');
const db=remoteD1(cloudflareClient(config.account_id),config.d1_databases.find(d=>d.binding==='DB').database_id);
await requireCurrentProbeSchema(db);
const base='https://whumpo.com',id=crypto.randomUUID(),email='service-client-fixture-'+id+'@example.test';
const now=()=>new Date().toISOString(),browser=liveWorkspaceBrowser(base),{call,json}=browser;
async function chat(content,key='service_client_review'){const state=await json('/api/chat'),input={id:crypto.randomUUID(),revision:state.state.revision,content};const out=await json('/api/chat','POST',input),turn=out.turns.find(t=>t.id===input.id);assert.equal(turn?.status,'completed','Live interpretation did not complete');assert.ok(turn[key],'Live interpretation did not prepare the expected owned review');return turn[key];}
async function approve(q){const state=await json('/api/chat'),input={id:crypto.randomUUID(),revision:state.state.revision,action:{type:'serviceClientApply',reviewId:q.id,proposalDigest:q.proposalDigest,expectedRevision:q.expectedRevision}};await json('/api/chat/actions','POST',input);await json('/api/chat/actions','POST',input);return input.id;}
async function preview(version){const r=await call('/api/service-client-versions/'+version+'/preview');assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/private/);return r.text();}
let project,success=false,originalFailure;
const cleanupFile='.secrets/service-client-live-account.json';
try{await readFile(cleanupFile);throw Error('Resolve the previous service-client fixture cleanup before a new run');}catch(error){if(error.code!=='ENOENT')throw error;}
await writeFile(cleanupFile,JSON.stringify({id,email}),{mode:0o600});
try{
 const [key]=await seedCurrentProbeIdentity(db,id,email);
 await browser.login(key,id);
 await json('/api/profile','PATCH',{revision:0,name:'River',avatar_id:'sun',about_me:'',share_context:false});await json('/api/onboarding');
 await json('/api/onboarding','PUT',{revision:0,stage:'review',prompt:'review',project_name:'Example Garden',idea:'A synthetic landscaping website for private deployment verification.',audience:'Neighbors',preferred_theme:'forest'});await json('/api/onboarding/complete','POST',{revision:1});
 project=(await db.prepare('SELECT id FROM projects WHERE owner_user_id=?').bind(id).first()).id;
 const original=await chat('Create my first private landscaping homepage in project '+project+'. Do not publish or activate anything.','version_id');
 const q=await chat('Prepare private website service settings for saved homepage '+original+' in project '+project+'. Start with neither contact intake nor a website tool requested (both null). Use serviceClients prepare at the current revision. Do not publish or activate anything.');
 const privatePath='/api/service-client-reviews/'+q.id+'/preview';assert.equal((await fetch(base+privatePath)).status,401);const proposed=await call(privatePath);assert.equal(proposed.status,200);assert.match(proposed.headers.get('cache-control'),/private/);
 const v1=await approve(q),first=await preview(v1);assert.equal((await call(privatePath)).status,409);
 const change=await chat('In project '+project+', inspect my current saved service settings and prepare a private change requesting contact-link@1 contact intake only. Keep the website tool null and the same saved homepage. Do not activate or publish.');
 const diff=await call('/api/service-client-reviews/'+change.id+'/diff');assert.equal(diff.status,200);assert.match(await diff.text(),/Contact intake/);
 const v2=await approve(change);assert.notEqual(await preview(v2),first);assert.equal(await preview(v1),first);
 const restore=await chat('Restore private service settings version '+v1+' for project '+project+' as a new forward private revision. Use serviceClients restore after inspecting the current settings. Do not publish or activate.');
 const v3=await approve(restore);assert.equal(await preview(v3),first);
 const activation=await chat('For project '+project+', prepare the separate contact activation review from current saved service settings '+v3+'. Its contact setting is null, so this must only review disabling contact intake. Use serviceClients reviewActivation with service contact. Do not confirm it, publish anything, or use a standalone contactReview action.','service_client_activation');
 assert.equal(activation.service,'contact');assert.equal(activation.enabled,false);
 for(const suffix of ['preview','diff']){const path='/api/service-client-activations/'+activation.id+'/'+suffix;assert.equal((await fetch(base+path)).status,401);const response=await call(path);assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/sandbox;.*form-action 'none'/);}
 const state=await json('/api/chat'),confirmation={id:crypto.randomUUID(),revision:state.state.revision,action:{type:'confirm',kind:'contact',reviewId:activation.id}};await json('/api/chat/actions','POST',confirmation);await json('/api/chat/actions','POST',confirmation);
 const head=await db.prepare('SELECT revision,version_id FROM service_client_heads WHERE project_id=?').bind(project).first();assert.equal(head.revision,3);assert.equal(head.version_id,v3);
 assert.equal((await db.prepare('SELECT count(*) n FROM service_client_applies WHERE project_id=?').bind(project).first()).n,3);
 assert.equal((await db.prepare("SELECT count(*) n FROM service_client_activation_state WHERE id=? AND status='applied'").bind(activation.id).first()).n,1);
 assert.equal((await db.prepare('SELECT enabled FROM contact_settings WHERE project_id=?').bind(project).first()).enabled,0);
 assert.equal((await db.prepare('SELECT count(*) n FROM publications WHERE project_id=? AND version_id IS NOT NULL').bind(project).first()).n,0);
 assert.equal((await fetch('https://'+project+'.whumpo.site/')).status,404);
 const billing=await json('/api/billing');assert.equal(billing.standardAI.creditCharge,0);assert.equal(billing.standardAI.creditCharge,0);
 await browser.logout();success=true;
}catch(error){originalFailure=error;throw error;}finally{
 // Only this fixture identity is eligible for cleanup; no customer publications/resources exist.
 try{await db.prepare('DELETE FROM users WHERE id=? AND email=?').bind(id,email).run();}catch{await writeFile('.secrets/service-client-live-evidence.json',JSON.stringify({at:now(),success:false,cleanupVerified:false,originalFailure:originalFailure?.message??null}),{mode:0o600});throw Error('Synthetic fixture cleanup failed; preserve its identity file and inspect the recorded original outcome.');}
 assert.equal(await db.prepare('SELECT id FROM users WHERE id=?').bind(id).first(),null);
 if(project)assert.equal(await db.prepare('SELECT id FROM projects WHERE id=?').bind(project).first(),null);
 await rm(cleanupFile);
 const evidence={at:now(),success,...(originalFailure?{failure:originalFailure.message}:{}),scope:'Real test Workers/D1, current signed passkey login for synthetic completed identity (not enrollment/device acceptance), configured model interpretation, private service settings prepare/read/change/preview/apply/forward restore, exact retries and reviewed disabling of already-inactive contact intake; no public content, enabled runtime, provider activation or CMS work.',cleanupVerified:true};
 await writeFile('.secrets/service-client-live-evidence.json',JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(evidence));
}

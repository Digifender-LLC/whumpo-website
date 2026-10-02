// Explicit opt-in: real test deployment + configured Muse, synthetic private work only.
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {requireCurrentProbeSchema,liveWorkspaceBrowser,seedCurrentProbeIdentity} from './helpers/live-workspace.mjs';
import {cloudflareClient,remoteD1} from '../tools/cms-cloudflare.mjs';
if(process.env.RUN_LIVE_SPECIFICATION!=='1')throw Error('Set RUN_LIVE_SPECIFICATION=1 for the private live specification check');
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));assert.equal(config.vars.ENVIRONMENT,'test');
const db=remoteD1(cloudflareClient(config.account_id),config.d1_databases.find(d=>d.binding==='DB').database_id);
await requireCurrentProbeSchema(db);
const base='https://whumpo.com',id=crypto.randomUUID(),email='specification-fixture-'+id+'@example.test';
const now=()=>new Date().toISOString(),browser=liveWorkspaceBrowser(base),{call,json}=browser;
async function chat(content,first=false){const state=await json('/api/chat'),input={id:crypto.randomUUID(),revision:state.state.revision,content};const out=await json('/api/chat','POST',input),turn=out.turns.find(t=>t.id===input.id);assert.equal(turn?.status,'completed','Live interpretation did not complete');if(first){assert.ok(turn.version_id,'Live interpretation did not create a current first draft');return turn.version_id;}assert.ok(turn.specification_review,'Live interpretation did not prepare a specification review');return turn.specification_review;}
async function approve(q){const state=await json('/api/chat'),input={id:crypto.randomUUID(),revision:state.state.revision,action:{type:'specificationApply',reviewId:q.id,proposalDigest:q.proposalDigest,expectedRevision:q.expectedRevision}};await json('/api/chat/actions','POST',input);await json('/api/chat/actions','POST',input);return input.id;}
async function preview(version){const r=await call('/api/site-versions/'+version+'/preview');assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/private/);return r.text();}
let project,success=false,originalFailure;
const cleanupFile='.secrets/specification-live-account.json';
try{await readFile(cleanupFile);throw Error('Resolve the previous specification fixture cleanup before a new run');}catch(error){if(error.code!=='ENOENT')throw error;}
await writeFile(cleanupFile,JSON.stringify({id,email}),{mode:0o600});
try{
 const [key]=await seedCurrentProbeIdentity(db,id,email);
 await browser.login(key,id);
 await json('/api/profile','PATCH',{revision:0,name:'River',avatar_id:'sun',about_me:'',share_context:false});await json('/api/onboarding');
 await json('/api/onboarding','PUT',{revision:0,stage:'review',prompt:'review',project_name:'Example Garden',idea:'A synthetic landscaping website for private deployment verification.',audience:'Neighbors',preferred_theme:'forest'});await json('/api/onboarding/complete','POST',{revision:1});
 project=(await db.prepare('SELECT id FROM projects WHERE owner_user_id=?').bind(id).first()).id;
 const v1=await chat('Create my first private landscaping website in project '+project+'. Include an Hours section with the exact text "Monday through Friday". Do not publish.',true),html=await preview(v1);
 assert.match(html,/Monday through Friday/);assert.equal((await fetch(base+'/api/site-versions/'+v1+'/preview')).status,401);
 assert.equal((await db.prepare('SELECT count(*) n FROM project_spec_creations WHERE project_id=?').bind(project).first()).n,1);
 const change=await chat('Change only my Hours section to “Monday through Saturday” in the saved website configuration for project '+project+'. Inspect its current specification first and prepare the exact private review. Do not publish.');
 const privatePath='/api/specification-reviews/'+change.id+'/preview';assert.equal((await fetch(base+privatePath)).status,401);assert.equal((await call(privatePath)).status,200);
 const diff=await call('/api/specification-reviews/'+change.id+'/diff');assert.equal(diff.status,200);assert.match(await diff.text(),/Monday through Saturday/);
 const v2=await approve(change);assert.match(await preview(v2),/Monday through Saturday/);assert.equal(await preview(v1),html);
 const restore=await chat('Prepare a private configuration restore to saved version '+v1+' in project '+project+'. Save it as a new forward version only after I approve the review; do not publish.');
 const v3=await approve(restore);assert.equal(await preview(v3),html);
 const head=await db.prepare('SELECT revision,version_id FROM project_spec_heads WHERE project_id=?').bind(project).first();assert.equal(head.revision,3);assert.equal(head.version_id,v3);
 assert.equal((await db.prepare('SELECT count(*) n FROM project_spec_applies WHERE project_id=?').bind(project).first()).n,2);
 assert.equal((await db.prepare('SELECT count(*) n FROM publications WHERE project_id=? AND version_id IS NOT NULL').bind(project).first()).n,0);
 assert.equal((await fetch('https://'+project+'.whumpo.site/')).status,404);
 const billing=await json('/api/billing');assert.equal(billing.standardAI.creditCharge,0);assert.equal(billing.standardAI.creditCharge,0);
 await browser.logout();success=true;
}catch(error){originalFailure=error;throw error;}finally{
 // Only this fixture identity is eligible for cleanup; no customer publications/resources exist.
 try{await db.prepare('DELETE FROM users WHERE id=? AND email=?').bind(id,email).run();}catch{await writeFile('.secrets/specification-live-evidence.json',JSON.stringify({at:now(),success:false,cleanupVerified:false,originalFailure:originalFailure?.message??null}),{mode:0o600});throw Error('Synthetic fixture cleanup failed; preserve its identity file and inspect the recorded original outcome.');}
 assert.equal(await db.prepare('SELECT id FROM users WHERE id=?').bind(id).first(),null);
 if(project)assert.equal(await db.prepare('SELECT id FROM projects WHERE id=?').bind(project).first(),null);
 await rm(cleanupFile);
 const evidence={at:now(),success,...(originalFailure?{failure:originalFailure.message}:{}),scope:'Real test Workers/D1, current signed passkey login for synthetic completed identity (not enrollment/device acceptance), configured model interpretation, current first specification creation/change/preview/apply/forward restore and exact retries; no public content, provider activation or CMS work.',cleanupVerified:true};
 await writeFile('.secrets/specification-live-evidence.json',JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(evidence));
}

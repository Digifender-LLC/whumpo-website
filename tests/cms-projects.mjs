// Owner-deferred CMS acceptance. Current-schema setup only; do not run without resumption.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const {module,identity}=await currentFixtureModules(["src/ai-chat.ts", "src/chat.ts", "src/cms-projects.ts"]);
const {prepareCMS,confirmCMS,readCMSReview,listCMS,cmsAction}=await module('src/cms-projects.ts'),{sendChat,readChat}=await module('src/chat.ts');
const {sendAIChat}=await module('src/ai-chat.ts');
const dir=await mkdtemp('/tmp/whumpo-cms-projects-');
const store=await databaseFixture({d1:true,r2:true}),db=store.db,id=()=>crypto.randomUUID();
const accounts=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
async function accountAuthority(user){if(!accounts.has(user)){const authority=await workspaceFixture(db,identity,user);accounts.set(user,authority);scopes.set(user,await authority.scope());}return accounts.get(user);}
async function project(user){user??=id();const now=new Date().toISOString(),p=id();await accountAuthority(user);await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'CMS fixture','','draft',?,?)").bind(p,user,now,now).run();return {user,project:p};}
async function guided(a,content){const request={id:id(),revision:(await readChat(scope(a.user),a.user)).state.revision,content};assert.equal((await sendChat(scope(a.user),a.user,request)).status,200);return {request,turn:(await readChat(scope(a.user),a.user)).turns.at(-1)};}
try{
 const a=await project(),b=await project(),r=id();
 const review=await prepareCMS(scope(a.user),a.user,r,a.project,'My CMS','Tagline');assert.equal(review.status,'pending');assert.equal((await listCMS(scope(a.user),a.user)).length,0);
 await assert.rejects(readCMSReview(scope(b.user),b.user,r),e=>e.status===404);await assert.rejects(confirmCMS(scope(b.user),b.user,r),e=>e.status===404);
 await assert.rejects(prepareCMS(scope(b.user),b.user,id(),a.project,'No',''),e=>e.status===404);
 assert.equal((await prepareCMS(scope(a.user),a.user,r,a.project,'My CMS','Tagline')).id,r);await assert.rejects(prepareCMS(scope(a.user),a.user,r,a.project,'Changed',''),e=>e.status===409);
 await assert.rejects(db.prepare('UPDATE cms_setup_reviews SET title=? WHERE id=?').bind('Forged',r).run(),/immutable/);
 const competing=await prepareCMS(scope(a.user),a.user,id(),a.project,'Alternative','');const race=await Promise.allSettled([confirmCMS(scope(a.user),a.user,r),confirmCMS(scope(a.user),a.user,competing.id)]);assert.equal(race.filter(v=>v.status==='fulfilled').length,1);
 const winner=race.find(v=>v.status==='fulfilled').value.id;await Promise.all(Array.from({length:5},()=>confirmCMS(scope(a.user),a.user,winner)));
 const instances=await listCMS(scope(a.user),a.user);assert.equal(instances.length,1);assert.equal(instances[0].state,'queued');assert.equal((await listCMS(scope(b.user),b.user)).length,0);
 const registry=await db.prepare('SELECT * FROM cms_instances WHERE project_id=?').bind(a.project).first();assert.equal(registry.worker_name,'whumpo-cms-'+a.project.replaceAll('-',''));assert.equal(registry.database_id,null);
 await assert.rejects(db.prepare("UPDATE cms_instances SET state='ready' WHERE project_id=?").bind(a.project).run(),/cms_readiness_not_verified/);
 await assert.rejects(db.prepare('UPDATE cms_instances SET user_id=? WHERE project_id=?').bind(b.user,a.project).run(),/immutable/);
 await assert.rejects(cmsAction(scope(a.user),a.user,id(),{kind:'cms',operation:'confirm',reviewId:winner}),e=>e.status===400);
 const expired=id();await db.prepare("INSERT INTO cms_setup_reviews(id,project_id,user_id,title,tagline,expires_at) VALUES(?,?,?,'Expired','','2000-01-01T00:00:00.000Z')").bind(expired,b.project,b.user).run();await assert.rejects(confirmCMS(scope(b.user),b.user,expired),e=>e.status===409);
 const chat=await guided(b,'/setup-cms '+b.project+' | Blog | Our updates');assert.equal(chat.turn.cms_confirmation_id,chat.request.id);assert.match(chat.turn.assistant_text,/does not promise an immediately available CMS/);
 const approved=await guided(b,'/confirm-cms '+chat.request.id);assert.match(approved.turn.assistant_text,/queued/);assert.equal((await readChat(scope(b.user),b.user)).turns.find(t=>t.id===chat.request.id).cms_confirmation_id,null);
 await sendChat(scope(b.user),b.user,approved.request);assert.equal((await listCMS(scope(b.user),b.user)).length,1);
 assert.match((await guided(b,'/cms')).turn.assistant_text,/queued/);assert.equal((await readChat(scope(b.user),b.user)).state.step,'idea');
 // Two-per-account cap rolls back approval as well as insertion.
 const second=await project(a.user),third=await project(a.user);const r2=await prepareCMS(scope(a.user),a.user,id(),second.project,'Second','');await confirmCMS(scope(a.user),a.user,r2.id);const r3=await prepareCMS(scope(a.user),a.user,id(),third.project,'Third','');await assert.rejects(confirmCMS(scope(a.user),a.user,r3.id),e=>e.status===409);assert.equal((await readCMSReview(scope(a.user),a.user,r3.id)).status,'pending');
 const c=await project();await readChat(scope(c.user),c.user);const aiId=id(),context=(await readChat(scope(c.user),c.user)).state;
 const config={baseURL:'https://provider.test/v1',apiKey:'fixture',model:'fixture',protocol:'responses'};
 const transport=async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'Your CMS is ready and public',action:{kind:'cms',operation:'setup',projectId:c.project,title:'AI blog',tagline:''}})}]}],usage:{input_tokens:300,output_tokens:200}});
 assert.equal((await sendAIChat(scope(c.user),c.user,aiId,context.revision,'Prepare an EmDash blog for this project',config,transport)).status,200);
 const turn=(await readChat(scope(c.user),c.user)).turns.at(-1);assert.equal(turn.cms_confirmation_id,aiId);assert.doesNotMatch(turn.assistant_text,/Your CMS is ready and public/);assert.equal((await listCMS(scope(c.user),c.user)).length,0);
 console.log('CMS setup checks passed: owned immutable reviews, competing confirmations, expiry, replay, deterministic isolated resource registry, no false ready state, agent/user separation, chat controls and atomic capacity.');
}finally{await store.close();await rm(dir,{recursive:true,force:true});}

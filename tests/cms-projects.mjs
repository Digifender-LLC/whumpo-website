import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {prepareCMS,confirmCMS,readCMSReview,listCMS,cmsAction}=await module('src/cms-projects.ts'),{sendChat,readChat}=await module('src/chat.ts');
const {sendAIChat}=await module('src/ai-chat.ts');
const dir=await mkdtemp('/tmp/townhello-cms-projects-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB,id=()=>crypto.randomUUID();
async function project(user){user??=id();const now=new Date().toISOString(),p=id();await db.prepare("INSERT OR IGNORE INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now).run();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'CMS fixture','','draft',?,?)").bind(p,user,now,now).run();return {user,project:p};}
async function guided(a,content){const request={id:id(),revision:(await readChat(db,a.user)).state.revision,content};assert.equal((await sendChat(db,a.user,request)).status,200);return {request,turn:(await readChat(db,a.user)).turns.at(-1)};}
try{
 const a=await project(),b=await project(),r=id();
 const review=await prepareCMS(db,a.user,r,a.project,'My CMS','Tagline');assert.equal(review.status,'pending');assert.equal((await listCMS(db,a.user)).length,0);
 await assert.rejects(readCMSReview(db,b.user,r),e=>e.status===404);await assert.rejects(confirmCMS(db,b.user,r),e=>e.status===404);
 await assert.rejects(prepareCMS(db,b.user,id(),a.project,'No',''),e=>e.status===404);
 assert.equal((await prepareCMS(db,a.user,r,a.project,'My CMS','Tagline')).id,r);await assert.rejects(prepareCMS(db,a.user,r,a.project,'Changed',''),e=>e.status===409);
 await assert.rejects(db.prepare('UPDATE cms_setup_reviews SET title=? WHERE id=?').bind('Forged',r).run(),/immutable/);
 const competing=await prepareCMS(db,a.user,id(),a.project,'Alternative','');const race=await Promise.allSettled([confirmCMS(db,a.user,r),confirmCMS(db,a.user,competing.id)]);assert.equal(race.filter(v=>v.status==='fulfilled').length,1);
 const winner=race.find(v=>v.status==='fulfilled').value.id;await Promise.all(Array.from({length:5},()=>confirmCMS(db,a.user,winner)));
 const instances=await listCMS(db,a.user);assert.equal(instances.length,1);assert.equal(instances[0].state,'queued');assert.equal((await listCMS(db,b.user)).length,0);
 const registry=await db.prepare('SELECT * FROM cms_instances WHERE project_id=?').bind(a.project).first();assert.equal(registry.worker_name,'townhello-cms-'+a.project.replaceAll('-',''));assert.equal(registry.database_id,null);
 await assert.rejects(db.prepare("UPDATE cms_instances SET state='ready' WHERE project_id=?").bind(a.project).run(),/cms_readiness_not_verified/);
 await assert.rejects(db.prepare('UPDATE cms_instances SET user_id=? WHERE project_id=?').bind(b.user,a.project).run(),/immutable/);
 await assert.rejects(cmsAction(db,a.user,id(),{kind:'cms',operation:'confirm',reviewId:winner}),e=>e.status===400);
 const expired=id();await db.prepare("INSERT INTO cms_setup_reviews(id,project_id,user_id,title,tagline,expires_at) VALUES(?,?,?,'Expired','','2000-01-01T00:00:00.000Z')").bind(expired,b.project,b.user).run();await assert.rejects(confirmCMS(db,b.user,expired),e=>e.status===409);
 const chat=await guided(b,'/setup-cms '+b.project+' | Blog | Our updates');assert.equal(chat.turn.cms_confirmation_id,chat.request.id);assert.match(chat.turn.assistant_text,/does not promise an immediately available CMS/);
 const approved=await guided(b,'/confirm-cms '+chat.request.id);assert.match(approved.turn.assistant_text,/queued/);assert.equal((await readChat(db,b.user)).turns.find(t=>t.id===chat.request.id).cms_confirmation_id,null);
 await sendChat(db,b.user,approved.request);assert.equal((await listCMS(db,b.user)).length,1);
 assert.match((await guided(b,'/cms')).turn.assistant_text,/queued/);assert.equal((await readChat(db,b.user)).state.step,'idea');
 // Two-per-account cap rolls back approval as well as insertion.
 const second=await project(a.user),third=await project(a.user);const r2=await prepareCMS(db,a.user,id(),second.project,'Second','');await confirmCMS(db,a.user,r2.id);const r3=await prepareCMS(db,a.user,id(),third.project,'Third','');await assert.rejects(confirmCMS(db,a.user,r3.id),e=>e.status===409);assert.equal((await readCMSReview(db,a.user,r3.id)).status,'pending');
 const c=await project();await readChat(db,c.user);const aiId=id(),context=(await readChat(db,c.user)).state;
 const config={baseURL:'https://provider.test/v1',apiKey:'fixture',model:'fixture',protocol:'responses'};
 const transport=async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'Your CMS is ready and public',action:{kind:'cms',operation:'setup',projectId:c.project,title:'AI blog',tagline:''}})}]}],usage:{input_tokens:300,output_tokens:200}});
 assert.equal((await sendAIChat(db,c.user,aiId,context.revision,'Prepare an EmDash blog for this project',config,transport)).status,200);
 const turn=(await readChat(db,c.user)).turns.at(-1);assert.equal(turn.cms_confirmation_id,aiId);assert.doesNotMatch(turn.assistant_text,/Your CMS is ready and public/);assert.equal((await listCMS(db,c.user)).length,0);
 console.log('CMS setup checks passed: owned immutable reviews, competing confirmations, expiry, replay, deterministic isolated resource registry, no false ready state, agent/user separation, chat controls and atomic capacity.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}

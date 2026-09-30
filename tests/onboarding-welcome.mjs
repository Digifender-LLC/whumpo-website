import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const b=await build({stdin:{contents:"export * from './src/onboarding';export * from './src/profile';export {hashToken} from './src/security';export {default as platform} from './src/index';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {readOnboarding,saveOnboarding,completeOnboarding,readProfile,updateProfile,agentProfile,platform,hashToken}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-welcome-');let proxy;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB,id=()=>crypto.randomUUID(),user=id(),other=id(),now=new Date().toISOString();
 for(const u of [user,other])await db.prepare("INSERT INTO users VALUES(?,?,'00','passkey-only',?)").bind(u,u+'@example.test',now).run();
 const first=await readOnboarding(db,user);assert.equal(first.complete,false);assert.equal(first.state.stage,'profile');assert.equal((await readProfile(db,user)).onboardingComplete,false);assert.equal((await readProfile(db,user)).avatar_id,'cloud');
 await assert.rejects(completeOnboarding(db,user,{revision:0}),e=>e.status===409);
 await updateProfile(db,user,{revision:0,name:'  River  ',about_me:'Private biography',avatar_id:'moon',share_context:false});assert.equal(await agentProfile(db,user),null);assert.equal((await readProfile(db,user)).avatar_id,'moon');
 await assert.rejects(updateProfile(db,user,{revision:1,avatar_id:'../../secret'}),e=>e.status===400);
 const draft={revision:0,stage:'review',project_name:' Studio ',idea:' A useful studio site ',audience:' My neighborhood ',preferred_theme:'forest'};
 const review=await saveOnboarding(db,user,draft);assert.equal(review.state.project_name,'Studio');assert.equal((await readOnboarding(db,user)).state.idea,'A useful studio site');assert.equal((await readOnboarding(db,other)).state.idea,'');assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects').first()).n,0);
 await assert.rejects(saveOnboarding(db,user,draft),e=>e.status===409);
 await assert.rejects(saveOnboarding(db,other,{...draft,project_name:''}),e=>e.status===400);
 await assert.rejects(saveOnboarding(db,other,{...draft,idea:'x'.repeat(1001)}),e=>e.status===400);
 await assert.rejects(saveOnboarding(db,other,{...draft,user_id:user}),e=>e.status===400);
 const completions=await Promise.all([completeOnboarding(db,user,{revision:1}),completeOnboarding(db,user,{revision:1})]);assert.ok(completions.every(r=>r.complete));
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects WHERE owner_user_id=?').bind(user).first()).n,1);const project=await db.prepare('SELECT * FROM projects WHERE owner_user_id=?').bind(user).first();assert.equal(project.name,'Studio');assert.equal(project.audience,'My neighborhood');assert.equal(project.preferred_theme,'forest');assert.equal(project.status,'draft');
 assert.equal((await db.prepare('SELECT step FROM workspace_state WHERE user_id=?').bind(user).first()).step,'ready');assert.equal((await db.prepare('SELECT COUNT(*) n FROM chat_turns WHERE user_id=?').bind(user).first()).n,1);assert.equal((await readProfile(db,user)).onboardingComplete,true);
 await completeOnboarding(db,user,{revision:1});assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects').first()).n,1);
 // Completion is historical: removing the first project must not restart welcome.
 await db.prepare('DELETE FROM projects WHERE id=?').bind(project.id).run();assert.equal((await readProfile(db,user)).onboardingComplete,true);
 const savedProfile=await readProfile(db,other);await updateProfile(db,other,{revision:savedProfile.revision,name:'Other',avatar_id:'leaf'});await saveOnboarding(db,other,{...draft});
 const lost=new Proxy(db,{get(target,key){
  if(key==='prepare')return sql=>{
   const stmt=target.prepare(sql);if(!sql.includes("stage='complete'"))return stmt;
   return {bind(...args){const bound=stmt.bind(...args);return {async run(){await bound.run();throw Error('Lost commit');}};}};
  };
  const value=target[key];return typeof value==='function'?value.bind(target):value;
 }});
 assert.equal((await completeOnboarding(lost,other,{revision:1})).complete,true);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects WHERE owner_user_id=?').bind(other).first()).n,1);
 const fresh=id();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(fresh,fresh+'@example.test',now).run();const token='d'.repeat(64);await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken(token),fresh,new Date(Date.now()+3600000).toISOString(),now).run();
 const env={DB:db,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})}};
 const call=(path,method='GET',body,cookie=token,origin='http://localhost')=>platform.fetch(new Request('http://localhost'+path,{method,headers:{origin,cookie:'tellumo_session='+cookie,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(){throw Error('No AI work expected');}});
 assert.equal((await call('/api/onboarding','GET',undefined,'')).status,401);assert.equal((await call('/api/onboarding','PUT',draft,token,'https://foreign.test')).status,403);assert.equal((await call('/api/onboarding')).status,200);
 assert.equal((await call('/api/profile','PATCH',{revision:0,name:'Welcome tester',avatar_id:'sun'})).status,200);assert.equal((await call('/api/onboarding','PUT',draft)).status,200);assert.equal((await call('/api/onboarding/complete','POST',{revision:1})).status,200);assert.equal((await(await call('/api/profile')).json()).onboardingComplete,true);
 for(const table of ['publications','inference_calls'])assert.equal((await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0);
 console.log('Welcome passed: persisted private profile/project steps, avatar allowlist, opt-in context, owned reads, validation, atomic single-project creation, concurrent/lost-response recovery, historical completion, session/origin checks and no inference/publication.');
}finally{if(proxy)await proxy.dispose();await rm(dir,{recursive:true,force:true});}

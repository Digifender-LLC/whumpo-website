import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {timingSafeEqual} from 'node:crypto';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
const b=await build({stdin:{contents:"export * from './src/onboarding';export * from './src/profile';export {hashToken,newSessionToken} from './src/security';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';export {default as platform} from './src/index';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const {readOnboarding,saveOnboarding,completeOnboarding,readProfile,updateProfile,agentProfile,platform}=m;
const fixture=await databaseFixture();
try{
 const db=fixture.db,id=()=>crypto.randomUUID(),user=id(),other=id();
 const owner=await workspaceFixture(db,m,user),otherOwner=await workspaceFixture(db,m,other);
 const ownerDB=await owner.scope(),otherDB=await otherOwner.scope();
 const first=await readOnboarding(ownerDB,user);assert.equal(first.complete,false);assert.equal(first.state.stage,'profile');assert.equal((await readProfile(ownerDB,user)).onboardingComplete,false);assert.equal((await readProfile(ownerDB,user)).avatar_id,'cloud');
 assert.equal(first.state.prompt,'name','Every new row starts at the current name question');
 await assert.rejects(completeOnboarding(ownerDB,user,{revision:0}),e=>e.status===409);
 await updateProfile(ownerDB,user,{revision:0,name:'  River  ',about_me:'Private biography',avatar_id:'moon',share_context:false});assert.equal(await agentProfile(ownerDB,user),null);assert.equal((await readProfile(ownerDB,user)).avatar_id,'moon');
 await assert.rejects(updateProfile(ownerDB,user,{revision:1,avatar_id:'../../secret'}),e=>e.status===400);
 const draft={revision:0,stage:'review',prompt:'review',project_name:' Studio ',idea:' A useful studio site ',audience:' My neighborhood ',preferred_theme:'forest'};
 const review=await saveOnboarding(ownerDB,user,draft);assert.equal(review.state.project_name,'Studio');assert.equal((await readOnboarding(ownerDB,user)).state.idea,'A useful studio site');assert.equal((await readOnboarding(otherDB,other)).state.idea,'');assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects').first()).n,0);
 await assert.rejects(saveOnboarding(ownerDB,user,draft),e=>e.status===409);
 await assert.rejects(saveOnboarding(otherDB,other,{...draft,project_name:''}),e=>e.status===400);
 await assert.rejects(saveOnboarding(otherDB,other,{...draft,idea:'x'.repeat(1001)}),e=>e.status===400);
 await assert.rejects(saveOnboarding(otherDB,other,{...draft,user_id:user}),e=>e.status===400);
 const completions=await Promise.all([completeOnboarding(ownerDB,user,{revision:1}),completeOnboarding(ownerDB,user,{revision:1})]);assert.ok(completions.every(r=>r.complete));
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects WHERE owner_user_id=?').bind(user).first()).n,1);const project=await db.prepare('SELECT * FROM projects WHERE owner_user_id=?').bind(user).first();assert.equal(project.name,'Studio');assert.equal(project.audience,'My neighborhood');assert.equal(project.preferred_theme,'forest');assert.equal(project.status,'draft');
 assert.equal((await db.prepare('SELECT step FROM workspace_state WHERE user_id=?').bind(user).first()).step,'ready');assert.equal((await db.prepare('SELECT COUNT(*) n FROM chat_turns WHERE user_id=?').bind(user).first()).n,1);assert.equal((await readProfile(ownerDB,user)).onboardingComplete,true);
 await completeOnboarding(ownerDB,user,{revision:1});assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects').first()).n,1);
 // Completion is historical: removing the first project must not restart welcome.
 await db.prepare('DELETE FROM projects WHERE id=?').bind(project.id).run();assert.equal((await readProfile(ownerDB,user)).onboardingComplete,true);
 const savedProfile=await readProfile(otherDB,other);await updateProfile(otherDB,other,{revision:savedProfile.revision,name:'Other',avatar_id:'leaf'});await saveOnboarding(otherDB,other,{...draft});
 let lostReplies=0;
 const lost=interceptDatabase(db,/UPDATE welcome_onboarding.*stage='complete'/,()=>{},()=>{if(lostReplies===0){lostReplies++;throw Error('Lost completion reply');}});
 assert.equal((await completeOnboarding(await otherOwner.scope(lost),other,{revision:1})).complete,true);assert.equal(lostReplies,1);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects WHERE owner_user_id=?').bind(other).first()).n,1);
 const fresh=id(),freshOwner=await workspaceFixture(db,m,fresh),token=freshOwner.token;
 const env={DB:db,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})}};
 const call=(path,method='GET',body,cookie=token,origin='http://localhost:8787')=>platform.fetch(new Request('http://localhost:8787'+path,{method,headers:{origin,cookie:'__Host-whumpo_session='+cookie,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(){throw Error('No AI work expected');}});
 assert.equal((await call('/api/onboarding','GET',undefined,'')).status,401);assert.equal((await call('/api/onboarding','PUT',draft,token,'https://foreign.test')).status,403);assert.equal((await call('/api/onboarding')).status,200);
 // Direct links/requests cannot bypass welcome or dispatch paid work.
 for(const [path,method] of [['/api/chat','GET'],['/api/chat','POST'],['/api/chat/history','GET'],['/api/workspace/dashboard','GET'],['/api/workspace/views/v1/layout','GET'],['/api/workspace/views/v1/mutate','POST'],['/api/workspace/capacity','PUT']]){
  const response=await call(path,method,method==='GET'?undefined:{content:'Build me a site',revision:0,requestId:id()});
  assert.equal(response.status,409,path);assert.equal((await response.json()).code,'onboarding_required');
 }
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM chat_turns WHERE user_id=?').bind(fresh).first()).n,0);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects WHERE owner_user_id=?').bind(fresh).first()).n,0);
 assert.equal((await call('/api/profile','PATCH',{revision:0,name:'Welcome tester',avatar_id:'sun'})).status,200);assert.equal((await call('/api/onboarding','PUT',draft)).status,200);assert.equal((await call('/api/onboarding/complete','POST',{revision:1})).status,200);assert.equal((await(await call('/api/profile')).json()).onboardingComplete,true);
 for(const path of ['/api/chat','/api/workspace/dashboard','/api/workspace/views/v1/layout'])assert.equal((await call(path)).status,200,path+' unlocks after project creation');
 for(const table of ['publications','inference_calls'])assert.equal((await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0);
 // Questions resume from server state, including on a different browser/device.
 const conversational=id(),conversationalOwner=await workspaceFixture(db,m,conversational),conversationalDB=await conversationalOwner.scope();
 const empty={revision:0,stage:'profile',project_name:'',idea:'',audience:'',preferred_theme:'ocean'};
 await saveOnboarding(conversationalDB,conversational,{...empty,prompt:'picture'});
 assert.equal((await readOnboarding(conversationalDB,conversational)).state.prompt,'picture');
 await assert.rejects(saveOnboarding(conversationalDB,conversational,{...empty,revision:1,prompt:'idea'}),e=>e.status===400);
 await assert.rejects(saveOnboarding(conversationalDB,conversational,{...empty,revision:1,prompt:'not-a-question'}),e=>e.status===400);
 await assert.rejects(saveOnboarding(conversationalDB,conversational,{...empty,revision:1,prompt:null}),e=>e.status===400);
 await assert.rejects(saveOnboarding(conversationalDB,conversational,{...empty,prompt:'bio'}),e=>e.status===409);
 await saveOnboarding(conversationalDB,conversational,{...empty,revision:1,prompt:'bio'});
 assert.equal((await readOnboarding(conversationalDB,conversational)).state.prompt,'bio');
 await saveOnboarding(conversationalDB,conversational,{...empty,revision:2,stage:'project',prompt:'project-name',idea:'A community garden site'});
 assert.equal((await readOnboarding(conversationalDB,conversational)).state.idea,'A community garden site');
 assert.equal((await readOnboarding(conversationalDB,conversational)).state.prompt,'project-name');
 await assert.rejects(completeOnboarding(conversationalDB,conversational,{revision:3}),e=>e.status===409);
 // Missing or mismatched current checkpoints reject; neither the API nor
 // storage can reinterpret a retired chapter-only client as a valid answer.
 await assert.rejects(saveOnboarding(conversationalDB,conversational,{...empty,revision:3}),e=>e.status===400);
 await assert.rejects(()=>db.prepare("UPDATE welcome_onboarding SET revision=revision+1,stage='profile' WHERE user_id=?").bind(conversational).run(),/CHECK constraint/);
 await assert.rejects(()=>db.prepare("UPDATE welcome_onboarding SET revision=revision+1,prompt=NULL WHERE user_id=?").bind(conversational).run(),/NOT NULL constraint/);
 assert.equal((await readOnboarding(conversationalDB,conversational)).state.prompt,'project-name');
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects WHERE owner_user_id=?').bind(conversational).first()).n,0);
 // A revoked session cannot finish welcome or create its project.
 await updateProfile(conversationalDB,conversational,{revision:0,name:'Revoked welcome'});
 await saveOnboarding(conversationalDB,conversational,{...draft,revision:3});
 const beforeCommit=interceptDatabase(db,/UPDATE welcome_onboarding.*stage='complete'/,()=>conversationalOwner.revoke());
 const commitScope=await conversationalOwner.scope(beforeCommit);
 await assert.rejects(()=>completeOnboarding(commitScope,conversational,{revision:4}),e=>e.code==='identity_changed');
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects WHERE owner_user_id=?').bind(conversational).first()).n,0);
 assert.equal((await db.prepare('SELECT stage FROM welcome_onboarding WHERE user_id=?').bind(conversational).first()).stage,'review');
 console.log('Welcome passed: persisted private profile/project steps, avatar allowlist, opt-in context, owned reads, validation, atomic single-project creation, concurrent/lost-response recovery, historical completion, session/origin checks and no inference/publication.');
 console.log('Conversation checkpoints passed: exact question resume, strict stage/question validation, stale-tab rejection, retired-client refusal and commit-time identity revocation and no early project creation.');
}finally{await fixture.close();}

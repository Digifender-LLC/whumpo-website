import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,scopes=new Map(),scope=user=>scopes.get(user);
const {saveBackend,testBackend}=m.backend,{prepareApplication:prepare,confirmApplication:confirm,readApplication:read,readApplicationReview:review}=m.appActivation,{issueAppSession,readAppData}=m.appData,{backendAction}=m.backendChat;
const id=()=>crypto.randomUUID(),stamp=()=>new Date().toISOString();
async function fixture(){const authority=await workspaceFixture(db,m),user=authority.account,project=id();scopes.set(user,await authority.scope());await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Fixture','','draft',?,?)").bind(project,user,stamp(),stamp()).run();return {...authority,user,project};}
async function version(a,value={state:{},result:null}){const v=id(),test=id();await saveBackend(scope(a.user),a.user,a.project,v,'export default input=>({state:input.state,result:null})');await testBackend(scope(a.user),{fetch:()=>Response.json({ok:true,value})},a.user,a.project,v,test,{state:{},input:{}});return {v,test};}
const lossy=async(a,prefix)=>{let lost=false;return a.scope(interceptDatabase(db,{test:q=>q.startsWith(prefix)},async()=>{},async()=>{if(!lost){lost=true;throw Error('lost acknowledgment');}}));};

try{
 const a=await fixture(),b=await fixture(),av=await version(a),bv=await version(b);
 assert.equal((await read(scope(a.user),a.user,a.project)).publicAccessReady,false);
 await assert.rejects(()=>prepare(scope(b.user),b.user,a.project,id(),'enable',av.v,av.test));
 await assert.rejects(()=>prepare(scope(a.user),a.user,a.project,id(),'enable',bv.v,bv.test));
 await assert.rejects(()=>prepare(scope(a.user),a.user,a.project,id(),'enable',av.v,bv.test));
 for(const value of [{state:{}},{state:{},result:null,extra:true},[{},null],{state:'x'.repeat(4097),result:null},{state:{},result:'é'.repeat(2200)}]){
  const bad=await version(a,value);await assert.rejects(()=>prepare(scope(a.user),a.user,a.project,id(),'enable',bad.v,bad.test));
 }
 const r=id();await prepare(await lossy(a,'INSERT INTO app_activation_reviews'),a.user,a.project,r,'enable',av.v,av.test);
 assert.equal((await read(scope(a.user),a.user,a.project)).configuration.enabled,0);
 await assert.rejects(()=>review(scope(b.user),b.user,r));
 await assert.rejects(()=>confirm(scope(b.user),b.user,r));
 await assert.rejects(()=>prepare(scope(a.user),a.user,a.project,r,'disable',null,null));
 await assert.rejects(()=>db.prepare('UPDATE app_activation_reviews SET enabled=0 WHERE id=?').bind(r).run());
 await assert.rejects(()=>db.prepare('DELETE FROM app_activation_reviews WHERE id=?').bind(r).run());
 await assert.rejects(()=>db.prepare('UPDATE app_spaces SET enabled=1,revision=revision+1 WHERE project_id=?').bind(a.project).run());
 const competing=id();await prepare(scope(a.user),a.user,a.project,competing,'enable',av.v,av.test);
 const confirmations=await Promise.allSettled([confirm(await lossy(a,'UPDATE app_activation_reviews'),a.user,r),confirm(scope(a.user),a.user,competing)]);
 assert.equal(confirmations.filter(x=>x.status==='fulfilled').length,1);
 const winner=confirmations[0].status==='fulfilled'?r:competing;
 let app=await read(scope(a.user),a.user,a.project);assert.equal(app.configuration.enabled,1);assert.equal(app.configuration.revision,1);assert.equal(app.publicAccessReady,false);
 await confirm(scope(a.user),a.user,winner);assert.equal((await read(scope(a.user),a.user,a.project)).configuration.revision,1);
 // Before visitors exist the owner can approve a replacement.
 const replacement=await version(a),replace=id();await prepare(scope(a.user),a.user,a.project,replace,'enable',replacement.v,replacement.test);await confirm(scope(a.user),a.user,replace);
 const visitor=id();await db.prepare('INSERT INTO app_visitors(id,project_id) VALUES(?,?)').bind(visitor,a.project).run();const token=await issueAppSession(db,visitor);assert.deepEqual(await readAppData(db,token,a.project),{revision:0,state:{}});
 const blocked=id();await prepare(scope(a.user),a.user,a.project,blocked,'enable',av.v,av.test);await assert.rejects(()=>confirm(scope(a.user),a.user,blocked),e=>e.status===409);
 // Disabling is allowed with data present and revokes every visitor session atomically.
 const off=id();await prepare(scope(a.user),a.user,a.project,off,'disable',null,null);await confirm(scope(a.user),a.user,off);assert.equal((await read(scope(a.user),a.user,a.project)).configuration.enabled,0);assert.equal((await db.prepare('SELECT count(*) n FROM app_sessions WHERE visitor_id=?').bind(visitor).first()).n,0);
 await assert.rejects(()=>readAppData(db,token,a.project));await confirm(scope(a.user),a.user,winner);assert.equal((await read(scope(a.user),a.user,a.project)).configuration.enabled,0);
 // Same version can be enabled again, but old tokens remain invalid.
 const again=id();await prepare(scope(a.user),a.user,a.project,again,'enable',replacement.v,replacement.test);await confirm(scope(a.user),a.user,again);await assert.rejects(()=>readAppData(db,token,a.project));
 // Expiry is immutable; insert an already-expired review to exercise the apply guard.
 const expired=id(),current=(await read(scope(a.user),a.user,a.project)).configuration;
 await db.prepare("INSERT INTO app_activation_reviews(id,project_id,user_id,version_id,run_id,enabled,base_revision,expires_at) VALUES(?,?,?,?,?,1,?,'2000-01-01T00:00:00.000Z')").bind(expired,a.project,a.user,replacement.v,replacement.test,current.revision).run();await assert.rejects(()=>confirm(scope(a.user),a.user,expired));
 await assert.rejects(()=>backendAction(scope(a.user),a.user,id(),{kind:'backend',operation:'confirmApplication',reviewId:again}));
 const pending=id();await prepare(scope(a.user),a.user,a.project,pending,'disable',null,null);await db.prepare('UPDATE projects SET owner_user_id=? WHERE id=?').bind(b.user,a.project).run();await assert.rejects(()=>confirm(scope(a.user),a.user,pending));
 console.log('Application activation passed: ownership, test result/size admission, immutable reviews, lost acknowledgments, concurrent/stale approval, version replacement, migration gate, atomic session revocation and no model confirmation.');
}finally{await store.close();}

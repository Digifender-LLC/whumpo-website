import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules,withFixtureEditingGrant} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
// Module activation and staff-role reviews store their own reply_digest (module_*_links). A confirm must not apply
// after the reviewed reply text changed: it is refused before any effect, and the effect statement re-checks the text.
// Every call goes through the platform Worker (`/api/chat/actions`) as the owner. Run `node tests/digest-gap-modules.mjs` or add `--d1`.
const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db,id=()=>crypto.randomUUID();
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}},origin='https://whumpo.com';
let checks=0;const equal=(a,b,msg)=>{assert.equal(a,b,msg);checks++;};
const row=(q,...p)=>db.prepare(q).bind(...p).first();
async function http(o,path,method='GET',body){
 const response=await m.worker.fetch(new Request(origin+path,{method,headers:{origin,'content-type':'application/json',cookie:'__Host-whumpo_session='+o.token},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{waitUntil:()=>{}});
 return {status:response.status,json:await response.json().catch(()=>null)};
}
const control=async(o,action)=>{const turn=id(),r=await http(o,'/api/chat/actions','POST',{id:turn,revision:(await http(o,'/api/chat')).json.state.revision,action});return {turn,...r};};
const pins=kind=>{const e=m.moduleCatalog.find(x=>x.kind===kind);return {module:{...e.module},schema:{...e.schema}};};
const access={id:'members',kind:'access',...pins('access'),dependencies:[],config:{roles:['staff'],enrollment:'invitation'}};
const text=turn=>row('SELECT assistant_text t FROM chat_turns WHERE id=?',turn).then(r=>r.t);
const setText=(turn,t)=>db.prepare('UPDATE chat_turns SET assistant_text=? WHERE id=?').bind(t,turn).run();
try{
 const o=await workspaceFixture(db,m),scope=await o.scope(),site=await createFixtureProject(scope,o.account,'Digest desk','A synthetic website.');
 await configureFixtureModules(scope,o.account,site.project,[access]);
 await withFixtureEditingGrant(scope,o.account,site.project,async()=>{
  // Module activation: altered reviewed reply is refused with no effect; the restored reply applies.
  const review=await control(o,{type:'moduleActivationReview',projectId:site.project,instanceId:'members',action:'activate'});equal(review.status,200,'Activation review prepared');
  const saved=await row('SELECT * FROM module_activation_reviews WHERE id=?',review.turn),apply={type:'moduleActivationApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_activation_revision};
  const original=await text(review.turn);await setText(review.turn,original+' (altered)');
  equal((await control(o,apply)).status,409,'Altered activation reply is not confirmed');
  equal(await row('SELECT count(*) n FROM module_activation_applies WHERE review_id=?',saved.id).then(r=>r.n),0,'Altered activation reply applied nothing');
  await setText(review.turn,original);
  equal((await control(o,apply)).status,200,'Restored activation reply confirms');
  equal((await row('SELECT a.state FROM module_activations a JOIN module_instances i ON i.id=a.instance_id WHERE i.project_id=?',site.project)).state,'active','Module is active');
  // Staff role review.
  const invite=await m.appAuth.createAppInvitation(scope,o.account,site.project),options=await m.appAuth.appPasskeyOptions(db,site.project,'signup',false,invite.code);
  const {authenticator}=await import('./app-authenticator.mjs'),key=authenticator();
  const visitor=await m.appAuth.appPasskeyVerify(db,site.project,'signup',options.challengeToken,key.registration(options.options),false);
  const role=await control(o,{type:'accessRoleReview',projectId:site.project,instanceId:'members',visitorId:visitor.visitorId??visitor.visitor?.id??visitor.id,action:'grant'});equal(role.status,200,'Role review prepared');
  const r=await row('SELECT * FROM module_access_role_reviews WHERE id=?',role.turn),applyRole={type:'accessRoleApply',reviewId:r.id,reviewDigest:r.review_digest,expectedRevision:r.expected_access_revision};
  const roleText=await text(role.turn);await setText(role.turn,roleText+' (altered)');
  equal((await control(o,applyRole)).status,409,'Altered role reply is not confirmed');
  equal(await row('SELECT count(*) n FROM module_access_role_applies WHERE review_id=?',r.id).then(x=>x.n),0,'Altered role reply applied nothing');
  await setText(role.turn,roleText);
  equal((await control(o,applyRole)).status,200,'Restored role reply confirms');
  equal(await row('SELECT count(*) n FROM module_access_role_applies WHERE review_id=?',r.id).then(x=>x.n),1,'Role applied once');
 });
 console.log(`Digest gap modules passed (${checks} checks, ${process.argv.includes('--d1')?'local D1':'SQLite'}).`);
}catch(error){console.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{await store.close();}

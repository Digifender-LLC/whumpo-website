// WH-004 slice 3 regression: owner-route authority, through the platform Worker's real default export and the
// real typed-control / route handlers. Local SQLite (default) or local D1 (`--d1`); synthetic accounts, no network.
// Closes evidence gaps recorded in docs/boundary-audit.json:
//   1. a foreign owner cannot apply another owner's specification review or service-client review;
//   2. a foreign caller cannot read `GET /api/projects/:id/versions`;
//   5. a visitor application session is not an owner credential on owner routes, and an owner session is not a
//      visitor credential on the visitor gateway.
// Every refusal check has a negative control in which the same request is made by the legitimate holder.
import assert from 'node:assert/strict';
import {createFixtureProject,proposeFixtureWebsite,enableFixtureVisitorAccess,currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';

const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db,id=()=>crypto.randomUUID();
const env={DB:db,FILES:store.env?.FILES,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
const ctx={waitUntil(){throw Error('No background work is expected');}};
const owners=new Map();
async function owner(){
 const a=await workspaceFixture(db,m),scope=await a.scope(),o={id:a.account,token:a.token,scope,credential:a.credential};
 owners.set(o.id,o);return o;
}
const cookie=(name,value)=>name+'='+value;
function platform(path,{token,cookies,method='GET',body,origin='https://whumpo.com'}={}){
 const jar=cookies??(token?[cookie('__Host-whumpo_session',token)]:[]);
 return m.worker.fetch(new Request('https://whumpo.com'+path,{method,headers:{origin,'content-type':'application/json',...(jar.length?{cookie:jar.join('; ')}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,ctx);
}
const scalar=async(sql,...values)=>Number((await db.prepare(sql).bind(...values).first()).n);
const chatRevision=async o=>(await m.readChat(o.scope,o.id)).state.revision;
try{
 const a=await owner(),b=await owner();
 const siteA=await createFixtureProject(a.scope,a.id,'Owner A','A synthetic website for owner A.'),siteB=await createFixtureProject(b.scope,b.id,'Owner B','A synthetic website for owner B.');

 // 1a. Specification review: owner A prepares, owner B applies.
 const spec=await proposeFixtureWebsite(a.scope,a.id,siteA.project,[{type:'design.setTheme',theme:'clay'}]);
 const specAction={type:'specificationApply',reviewId:spec.id,proposalDigest:spec.proposal_digest,expectedRevision:spec.expected_revision};
 const specState=async()=>JSON.stringify({
  applies:await scalar('SELECT count(*) n FROM project_spec_applies'),versions:await scalar('SELECT count(*) n FROM project_spec_versions'),
  sites:await scalar('SELECT count(*) n FROM site_versions'),head:(await db.prepare('SELECT revision,version_id FROM project_spec_heads WHERE project_id=?').bind(siteA.project).first()),
  turnsB:await scalar('SELECT count(*) n FROM chat_turns WHERE user_id=?',b.id),turnsA:await scalar('SELECT count(*) n FROM chat_turns WHERE user_id=?',a.id)
 });
 const specBefore=await specState();
 const foreignSpec=await platform('/api/chat/actions',{token:b.token,method:'POST',body:{id:id(),revision:await chatRevision(b),action:specAction}});
 // The current code answers 404; a second SQL layer would answer 409. Either way the review is refused unchanged.
 assert.ok([403,404,409].includes(foreignSpec.status),`foreign specification apply must be refused, got ${foreignSpec.status}`);
 assert.equal(typeof (await foreignSpec.json()).error,'string');
 assert.equal(await specState(),specBefore,'a refused foreign specification apply changed nothing');
 // The same request from the review's owner is admitted (negative control).
 const ownSpec=await platform('/api/chat/actions',{token:a.token,method:'POST',body:{id:id(),revision:await chatRevision(a),action:specAction}});
 assert.equal(ownSpec.status,200,'negative control: the owner applies the same review: '+await ownSpec.clone().text());
 assert.notEqual(await specState(),specBefore,'negative control: the owner apply recorded a version');
 assert.equal(await scalar('SELECT count(*) n FROM project_spec_applies WHERE project_id=?',siteA.project),1);
 assert.equal(await scalar('SELECT count(*) n FROM project_spec_applies WHERE project_id=?',siteB.project),0,'owner B\'s project was never touched');

 // 1b. Service-client review: owner A prepares, owner B applies.
 const serviceTurn=id(),revision=await chatRevision(a);
 const prepared=await m.serviceClientStore.prepareServiceClients(a.scope,a.id,serviceTurn,{kind:'serviceClients',operation:'prepare',projectId:siteA.project,expectedRevision:0,websiteVersionId:siteA.version,configuration:{schemaVersion:1,contact:{component:'contact-link@1'},statelessForm:null}});
 await a.scope.batch([
  a.scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,mode,status,created_at) VALUES(?,?,?,'Synthetic review fixture','','ai','pending',?)").bind(serviceTurn,a.id,revision+1,new Date().toISOString()),
  ...prepared.statements,
  a.scope.prepare("UPDATE chat_turns SET assistant_text=?,status='completed' WHERE id=?").bind(prepared.reply,serviceTurn),
  a.scope.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(revision+1,a.id)
 ]);
 const service=await m.serviceClientStore.readServiceClientProposal(a.scope,a.id,serviceTurn);
 const serviceAction={type:'serviceClientApply',reviewId:service.id,proposalDigest:service.proposal_digest,expectedRevision:service.expected_revision};
 const serviceState=async()=>JSON.stringify({
  versions:await scalar('SELECT count(*) n FROM service_client_versions'),applies:await scalar('SELECT count(*) n FROM service_client_applies'),
  head:await db.prepare('SELECT revision,version_id FROM service_client_heads WHERE project_id=?').bind(siteA.project).first(),
  turnsB:await scalar('SELECT count(*) n FROM chat_turns WHERE user_id=?',b.id)
 });
 const serviceBefore=await serviceState();
 const foreignService=await platform('/api/chat/actions',{token:b.token,method:'POST',body:{id:id(),revision:await chatRevision(b),action:serviceAction}});
 assert.ok([403,404,409].includes(foreignService.status),`foreign service-client apply must be refused, got ${foreignService.status}`);
 assert.equal(typeof (await foreignService.json()).error,'string');
 assert.equal(await serviceState(),serviceBefore,'a refused foreign service-client apply changed nothing');
 const ownService=await platform('/api/chat/actions',{token:a.token,method:'POST',body:{id:id(),revision:await chatRevision(a),action:serviceAction}});
 assert.equal(ownService.status,200,'negative control: the owner applies the same service-client review: '+await ownService.clone().text());
 assert.notEqual(await serviceState(),serviceBefore,'negative control: the owner apply saved service settings');

 // 2. Foreign `GET /api/projects/:id/versions`.
 const listed=await platform(`/api/projects/${siteA.project}/versions`,{token:a.token});
 assert.equal(listed.status,200,'negative control: the owner lists their versions');
 const ownVersions=(await listed.json()).versions;
 assert.ok(ownVersions.length>=1&&ownVersions.every(v=>v.id&&v.digest),'negative control: owner A has version metadata to leak');
 const foreign=await platform(`/api/projects/${siteA.project}/versions`,{token:b.token}),foreignText=await foreign.text();
 assert.equal(foreign.status,404);
 for(const v of ownVersions)assert.ok(!foreignText.includes(v.id)&&!foreignText.includes(v.digest),'no version metadata reaches a foreign caller');
 const missing=await platform(`/api/projects/${id()}/versions`,{token:b.token});
 assert.equal(missing.status,404);assert.equal(await missing.text(),foreignText,'a foreign project is indistinguishable from a missing one');
 assert.equal((await platform(`/api/projects/${siteA.project}/versions`)).status,401,'unauthenticated');
 const ownB=await platform(`/api/projects/${siteB.project}/versions`,{token:b.token});
 assert.equal(ownB.status,200);assert.ok(!(await ownB.text()).includes(ownVersions[0].id),'owner B lists only their own versions');

 // 5. A visitor application session is not an owner credential, and the owner session is not a visitor credential.
 await enableFixtureVisitorAccess(a.scope,a.id,siteA.project);
 const visitor=id();
 await db.prepare("INSERT INTO app_visitors(id,project_id,access_id) SELECT ?,?,id FROM module_instances WHERE project_id=? AND kind='access'").bind(visitor,siteA.project,siteA.project).run();
 const session=await m.appData.issueAppSession(db,visitor),visitorCookie='__Host-whumpo-app-session-'+siteA.project;
 const gateway=(path,{session:value,name=visitorCookie,method='GET',body,project=siteA.project}={})=>{
  const origin=`https://app-${project}.whumpo.site`;
  return m.appGateway.applicationGateway(new Request(origin+'/'+path,{method,headers:{origin,'content-type':'application/json','cf-connecting-ip':'198.51.100.30',...(value===undefined?{}:{cookie:cookie(name,value)})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
 };
 const exported=await gateway('export',{session});
 assert.equal(exported.status,200,'negative control: the visitor session is valid at the gateway: '+await exported.clone().text());
 const ownerRoutes=[['GET','/api/workspace/dashboard'],['GET',`/api/projects/${siteA.project}/versions`],['GET','/api/chat'],['GET','/api/domain-hosting'],['POST','/api/domain-hosting/review',{id:id(),claimId:id()}],['POST','/api/chat/actions',{id:id(),revision:0,action:{type:'unpublish',projectId:siteA.project}}]];
 for(const [method,path,body] of ownerRoutes){
  // Negative control: the owner session reaches each route (the route itself may refuse the payload, never the identity).
  const control=await platform(path,{token:a.token,method,body});
  assert.notEqual(control.status,401,`negative control: owner session is authenticated on ${method} ${path}`);
  for(const [label,jar] of [['visitor token in the owner cookie',[cookie('__Host-whumpo_session',session)]],['visitor cookie under its own name',[cookie(visitorCookie,session)]],['both cookies',[cookie('__Host-whumpo_session',session),cookie(visitorCookie,session)]]]){
   const response=await platform(path,{cookies:jar,method,body}),text=await response.text();
   assert.equal(response.status,401,`${method} ${path} with ${label}: ${response.status} ${text}`);
   assert.ok(!text.includes(siteA.project),`${method} ${path} with ${label} exposes no project data`);
  }
 }
 // The owner session presented to the visitor gateway, under the owner's cookie name or the visitor's. Only routes the
 // gateway serves before its live-page check are used, so a refusal can only come from the session.
 const reviews=()=>scalar('SELECT count(*) n FROM app_deletion_reviews WHERE visitor_id=?',visitor);
 for(const [path,method,body] of [['export','GET'],['account/deletion-review','POST',{}]]){
  for(const [label,name,value] of [['owner token under the visitor cookie name',visitorCookie,a.token],['owner token under the owner cookie name','__Host-whumpo_session',a.token]]){
   const response=await gateway(path,{session:value,name,method,body}),text=await response.text();
   assert.equal(response.status,401,`${method} ${path} with ${label}: ${response.status} ${text}`);
   assert.ok(!text.includes(a.id),'no owner identity is echoed');
  }
 }
 assert.equal(await reviews(),0,'a refused credential prepared no deletion review');
 const control=await gateway('account/deletion-review',{session,method:'POST',body:{}});
 assert.equal(control.status,200,'negative control: the visitor session prepares its own deletion review: '+await control.clone().text());
 assert.equal(await reviews(),1);
 console.log('Owner authority: a foreign owner cannot apply another owner\'s specification or service-client review, a foreign caller gets 404 and no metadata from the versions route, and visitor/owner session cookies are not interchangeable between owner routes and the visitor gateway (each refusal has an owner/visitor positive control).');
}catch(error){console.error(String(error?.stack??error).split('\n').filter(line=>!line.includes('data:text/javascript')).join('\n'));process.exitCode=1;}
finally{await store.close?.();}

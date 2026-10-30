// WH-004 slice 5 regression: route-specific cross-origin refusals, through the platform Worker's real default export,
// the sites Worker's real default export (guest preview host) and the real visitor gateway. Local SQLite (default) or
// local D1 (`--d1`); synthetic accounts, no network. Closes the route-specific Origin evidence gaps recorded in
// docs/boundary-audit.md ("Evidence gaps", slice 3 and "Still open (slice 2)"):
//   1. owner guest-preview routes: prepare, confirm, revoke, delete link, resolve comment, delete comment;
//   2. guest POST /api/feedback on the guest preview host (its own exact-Origin check in src/guest-previews/guest.ts);
//   3. DELETE /api/contact-messages/:id;
//   4. contact notifications: PUT, DELETE, POST verification, POST confirm;
//   5. owner POST /api/projects/:id/modules and POST /api/projects/:id/module-files/remove;
//   6. visitor POST modules/upload on the visitor gateway (its own Origin/Sec-Fetch-Site check in src/app-gateway.ts).
// Every refusal asserts the exact status and message the source returns (403 "Origin check failed") and that the
// refused request changed nothing. Every route has a negative control: the same request from the correct origin by the
// legitimate holder is not refused by the Origin gate. Where a fixture can reach the effect, the control also shows it.
// Not covered here (no fixture reaches it cheaply): a module-files/remove or modules request that actually mutates a
// files or records instance. Those two controls show the request passed the gate and reached the module handler, which
// answered for an unknown resource. No route was skipped and no missing Origin control was found, so there is no
// expected-failure case in this file.
import assert from 'node:assert/strict';
import {createFixtureProject,enableFixtureVisitorAccess,currentSiteFixtureHandlers,fixtureVisitorSQL} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';

const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db,id=()=>crypto.randomUUID();
const env={DB:db,FILES:store.env?.FILES,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
const ctx={waitUntil(){throw Error('No background work is expected');}};
const noFiles={get:async()=>assert.fail('No object read is expected'),head:async()=>assert.fail('No object read is expected'),put:async()=>assert.fail('No object write is expected'),delete:async()=>assert.fail('No object delete is expected')};
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No network is allowed');};
const evil='https://evil.example',refusal='Origin check failed';
const cookie=(name,value)=>name+'='+value;
// `origin: null` sends no Origin header; the string 'null' is the opaque origin a sandboxed or privacy-redirected page sends.
function platform(path,{token,method='GET',body,origin='https://whumpo.com'}={}){
 return m.worker.fetch(new Request('https://whumpo.com'+path,{method,headers:{'content-type':'application/json',...(origin===null?{}:{origin}),...(token?{cookie:cookie('__Host-whumpo_session',token)}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,ctx);
}
const scalar=async(sql,...values)=>Number((await db.prepare(sql).bind(...values).first()).n);
const errorOf=text=>{try{return JSON.parse(text).error;}catch{return undefined;}};
async function refusedBy(response,label){
 const text=await response.text();
 assert.equal(response.status,403,`${label}: ${response.status} ${text}`);
 assert.equal(errorOf(text),refusal,`${label} is refused by the Origin check`);
}
/** Negative control: the legitimate request is not refused by the Origin check (and has `status` when given). */
async function admitted(label,response,status){
 const text=await response.clone().text();
 assert.notEqual(errorOf(text),refusal,`negative control: ${label} passes the Origin check`);
 if(status!==undefined)assert.equal(response.status,status,`negative control: ${label}: ${text}`);
 return response;
}
async function refused(label,path,options,state,origins){
 const before=await state();
 for(const [name,origin] of origins)await refusedBy(await platform(path,{...options,origin}),`${label} from ${name}`);
 assert.equal(await state(),before,`${label}: a refused cross-origin request changed nothing`);
}
try{
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),a={id:actor.account,token:actor.token,scope};
 await paidPlan(db,a.id,'personal');
 const site=await createFixtureProject(scope,a.id,'Origin studio','A synthetic website for cross-origin checks.');
 const owner=(path,method,body)=>platform(path,{token:a.token,method,body});
 const foreign=[['a foreign site',evil],['the opaque null origin','null'],['plain http','http://whumpo.com'],['a Whumpo sibling host','https://preview.whumpo.site'],['no Origin header',null]];
 const deny=(label,path,method,body,state)=>refused(label,path,{token:a.token,method,body},state,foreign);

 // 1. Owner guest-preview routes (platform Worker, global exact-Origin gate in handle()).
 const linkWhere='FROM guest_preview_links WHERE project_id=?',feedbackWhere='FROM guest_preview_feedback f JOIN guest_preview_links l ON l.id=f.link_id WHERE l.project_id=?';
 const guestState=async()=>JSON.stringify({
  links:await scalar('SELECT count(*) n '+linkWhere,site.project),revoked:await scalar('SELECT count(*) n '+linkWhere+' AND revoked_at IS NOT NULL',site.project),
  feedback:await scalar('SELECT count(*) n '+feedbackWhere,site.project),resolved:await scalar('SELECT count(*) n '+feedbackWhere+' AND f.resolved_at IS NOT NULL',site.project)
 });
 const issue={id:id(),versionId:site.version,expiresInHours:24,feedback:true};
 const preparePath=`/api/projects/${site.project}/guest-previews/prepare`,issuePath=`/api/projects/${site.project}/guest-previews`;
 await deny('POST guest-previews/prepare',preparePath,'POST',issue,guestState);
 const prepared=await admitted('the owner prepares a guest link',await owner(preparePath,'POST',issue),200);
 const confirmed={...issue,confirmation:(await prepared.json()).confirmation};
 await deny('POST guest-previews (confirm)',issuePath,'POST',confirmed,guestState);
 const issued=await (await admitted('the owner confirms the guest link',await owner(issuePath,'POST',confirmed),200)).json();
 assert.equal(await scalar('SELECT count(*) n '+linkWhere,site.project),1,'negative control: the owner\'s confirm issued one link');

 // 2. Guest POST /api/feedback (sites Worker, guest preview host's own exact-Origin check).
 const guestOrigin=new URL(issued.url).origin,hostEnv={DB:db,FILES:noFiles};
 const guest=(data,origin=guestOrigin)=>m.host.fetch(new Request(guestOrigin+'/api/feedback',{method:'POST',headers:{'content-type':'application/json',...(origin===null?{}:{origin})},body:JSON.stringify(data)}),hostEnv);
 const comment={token:issued.token,requestId:id(),name:'Synthetic guest',text:'Synthetic comment for the Origin check.'};
 const beforeComment=await guestState();
 for(const [name,origin] of [['a foreign site',evil],['the opaque null origin','null'],['the workspace origin','https://whumpo.com'],['a project host',`https://app-${site.project}.whumpo.site`],['no Origin header',null]])
  await refusedBy(await guest(comment,origin),`guest POST /api/feedback from ${name}`);
 assert.equal(await guestState(),beforeComment,'a refused cross-origin guest comment stored nothing');
 const sent=await (await admitted('the link holder sends a comment',await guest(comment),200)).json();
 assert.equal(await scalar('SELECT count(*) n '+feedbackWhere,site.project),1,'negative control: the guest comment was stored');

 // 1 (continued). Comment resolve and delete, link revoke and delete.
 const commentPath=`/api/guest-previews/${issued.link.id}/feedback/${sent.id}`;
 await deny('PATCH guest feedback (resolve)',commentPath,'PATCH',{resolved:true},guestState);
 await admitted('the owner resolves the comment',await owner(commentPath,'PATCH',{resolved:true}),200);
 assert.equal(await scalar('SELECT count(*) n '+feedbackWhere+' AND f.resolved_at IS NOT NULL',site.project),1,'negative control: the comment is resolved');
 await deny('DELETE guest feedback',commentPath,'DELETE',undefined,guestState);
 await admitted('the owner deletes the comment',await owner(commentPath,'DELETE'),200);
 assert.equal(await scalar('SELECT count(*) n '+feedbackWhere,site.project),0,'negative control: the comment is deleted');
 const linkPath=`/api/guest-previews/${issued.link.id}`;
 await deny('POST guest-previews/:id/revoke',linkPath+'/revoke','POST',undefined,guestState);
 await admitted('the owner revokes the link',await owner(linkPath+'/revoke','POST'),200);
 assert.equal(await scalar('SELECT count(*) n '+linkWhere+' AND revoked_at IS NOT NULL',site.project),1,'negative control: the link is revoked');
 await deny('DELETE guest-previews/:id',linkPath,'DELETE',undefined,guestState);
 await admitted('the owner deletes the link',await owner(linkPath,'DELETE'),200);
 assert.equal(await scalar('SELECT count(*) n '+linkWhere,site.project),0,'negative control: the link is deleted');

 // 3. DELETE /api/contact-messages/:id. The message is stored by the real intake function on a published version with an
 // enabled contact form (publication and contact settings are seeded rows, as tests/site-diagnostics.mjs does).
 await db.prepare('INSERT INTO publications(project_id,version_id,revision) VALUES(?,?,1)').bind(site.project,site.version).run();
 await db.prepare('INSERT INTO contact_settings(project_id,revision,enabled,publication_revision) VALUES(?,1,1,1)').bind(site.project).run();
 const message=id();
 await m.contacts.saveContact(db,site.project,1,{id:message,name:'Synthetic visitor',email:'visitor@example.invalid',message:'Synthetic message for the Origin check.'});
 const messages=async()=>String(await scalar('SELECT count(*) n FROM contact_submissions WHERE id=?',message));
 assert.equal(await messages(),'1');
 await deny('DELETE contact-messages/:id',`/api/contact-messages/${message}`,'DELETE',undefined,messages);
 await admitted('the owner deletes the message',await owner(`/api/contact-messages/${message}`,'DELETE'),200);
 assert.equal(await messages(),'0','negative control: the message is deleted');

 // 4. Contact notifications. No provider is configured, so verification answers provider_not_configured and stores nothing.
 const notify=`/api/projects/${site.project}/contact-notifications`;
 const destination=()=>db.prepare('SELECT id,address,state,verification_code,verification_failures FROM contact_notification_destinations WHERE project_id=?').bind(site.project).first();
 const notifyState=async()=>JSON.stringify({destination:(await destination())??null,outbox:await scalar('SELECT count(*) n FROM notification_notices WHERE project_id=?',site.project)});
 const address={address:'owner@example.invalid'};
 await deny('PUT contact-notifications',notify,'PUT',address,notifyState);
 await admitted('the owner proposes an address',await owner(notify,'PUT',address),200);
 assert.equal((await destination())?.state,'unverified','negative control: the address is saved unverified');
 await deny('POST contact-notifications/verification',notify+'/verification','POST',{},notifyState);
 const verification=await admitted('the owner requests verification',await owner(notify+'/verification','POST',{}),200);
 assert.equal((await verification.json()).status,'provider_not_configured');
 await deny('POST contact-notifications/confirm',notify+'/confirm','POST',{code:'AAAAAAAA'},notifyState);
 await admitted('the owner confirms a wrong code',await owner(notify+'/confirm','POST',{code:'AAAAAAAA'}),400);
 assert.equal(Number((await destination()).verification_failures),1,'negative control: the owner\'s code reached the handler and was counted');
 await deny('DELETE contact-notifications',notify,'DELETE',undefined,notifyState);
 await admitted('the owner removes the address',await owner(notify,'DELETE'),200);
 assert.equal((await destination())??null,null,'negative control: the address is removed');

 // 5. Owner shared-module routes. No fixture here activates a records or files instance, so the controls name an unknown
 // resource: the request passes the gate and the module handler (not the gate) answers with its typed `not_found`.
 const moduleState=async()=>JSON.stringify({
  records:await scalar('SELECT count(*) n FROM module_records'),files:await scalar('SELECT count(*) n FROM module_files'),
  receipts:await scalar('SELECT count(*) n FROM module_request_receipts'),projectFiles:await scalar('SELECT count(*) n FROM project_files')
 });
 const modulesPath=`/api/projects/${site.project}/modules`,envelope={api:'whumpo-modules',version:1,operation:'records.view',resourceId:id(),configRevision:1,requestId:null,target:null,input:null};
 await deny('POST projects/:id/modules',modulesPath,'POST',envelope,moduleState);
 const ownModules=await (await admitted('the owner module request',await owner(modulesPath,'POST',envelope),404)).json();
 assert.equal(ownModules.code,'not_found','negative control: the module handler answered');
 const removePath=`/api/projects/${site.project}/module-files/remove`,removal={resourceId:id(),collectionId:'gallery',fileId:id()};
 await deny('POST projects/:id/module-files/remove',removePath,'POST',removal,moduleState);
 const ownRemoval=await (await admitted('the owner collection removal',await owner(removePath,'POST',removal),404)).json();
 assert.equal(ownRemoval.code,'not_found','negative control: the collection handler answered past the ownership check');

 // 6. Visitor POST modules/upload on the visitor gateway, with the project's own visitor session.
 await enableFixtureVisitorAccess(scope,a.id,site.project);
 const visitor=id();
 await db.prepare(fixtureVisitorSQL).bind(visitor,site.project,site.project).run();
 const session=await m.appData.issueAppSession(db,visitor),visitorCookie='__Host-whumpo-app-session-'+site.project,visitorOrigin=`https://app-${site.project}.whumpo.site`;
 const uploadEnvelope={api:'whumpo-modules',version:1,operation:'files.putBytes',resourceId:id(),configRevision:1,requestId:id(),target:null,input:null};
 const header=Buffer.from(JSON.stringify(uploadEnvelope)).toString('base64url'),jpeg=new Uint8Array([0xff,0xd8,0xff,0xd9]);
 const upload=(origin=visitorOrigin,fetchSite='')=>m.appGateway.applicationGateway(new Request(visitorOrigin+'/modules/upload',{method:'POST',headers:{
  'content-type':'image/jpeg','cf-connecting-ip':'198.51.100.31','whumpo-module-request':header,cookie:cookie(visitorCookie,session),
  ...(origin===null?{}:{origin}),...(fetchSite?{'sec-fetch-site':fetchSite}:{})},body:jpeg}),{...env,FILES:noFiles});
 const beforeUpload=await moduleState();
 for(const [name,origin,fetchSite] of [['a foreign site',evil],['another project\'s visitor host',`https://app-${id()}.whumpo.site`],['the workspace origin','https://whumpo.com'],['the opaque null origin','null'],['no Origin header',null],['cross-site fetch metadata',visitorOrigin,'cross-site']])
  await refusedBy(await upload(origin,fetchSite),`visitor POST modules/upload from ${name}`);
 assert.equal(await moduleState(),beforeUpload,'a refused cross-origin upload stored nothing');
 const ownUpload=await admitted('the visitor upload',await upload());
 assert.equal(typeof (await ownUpload.json()).code,'string','negative control: the module upload handler answered');
 assert.equal(await moduleState(),beforeUpload,'an upload naming an unknown resource stored nothing');

 console.log(`Origin routes on ${process.argv.includes('--d1')?'local D1':'SQLite'}: owner guest-preview routes, guest feedback, contact message delete, contact notifications, owner modules and module-files/remove, and visitor modules/upload each refuse a foreign, null, downgraded or missing Origin with 403 "Origin check failed" and no state change, while the legitimate holder's identical request from the correct origin passes the check.`);
}catch(error){console.error(String(error?.stack??error).split('\n').filter(line=>!line.includes('data:text/javascript')).join('\n'));process.exitCode=1;}
finally{globalThis.fetch=originalFetch;await store.close?.();}

import assert from 'node:assert/strict';
import {authenticator} from '../app-authenticator.mjs';
import {enableFixtureVisitorAccess,createFixtureProject} from '../current-site-fixture.mjs';
import {workspaceFixture} from './workspace-identity.mjs';
// WH-073: layers the services behind the successful (non-404) visitor routes onto an owner's already published synthetic
// site, through the real owner paths (Chat commands and reviews, the CMS bridge with a stub service, backend and
// application activation, a passkey visitor). Synthetic data only; no network, provider or model. Returns what a request needs.
// `m` is the current-site fixture handlers; `o` is {scope,user,project} with the site already published.
const master='local-master-fixture-'.repeat(4),account='a'.repeat(32),nativeId='01ARZ3NDEKTSV4RRFFQ69G5FAV',digest='b'.repeat(64);
export async function seedSuccessPaths({db,m,o}){
 const id=()=>crypto.randomUUID(),{scope,user,project}=o;
 const chatTurn=async content=>{const turn=id();const r=await m.sendChat(scope,user,{id:turn,revision:(await m.readChat(scope,user)).state.revision,content});assert.equal(r.status,200,JSON.stringify(r));return turn;};
 const confirm=async(kind,reviewId)=>{const r=await m.sendChatControl(scope,user,{id:id(),revision:(await m.readChat(scope,user)).state.revision,action:{type:'confirm',kind,reviewId}});assert.equal(r.status,200,JSON.stringify(r));};

 // Directory: one listing, published.
 const listing=await chatTurn(`/directory-add ${project} | Garden club | Saturday mornings | https://example.com/`);await confirm('directory',listing);
 await confirm('directory',await chatTurn('/directory-publish '+project));

 // Backend: a tested program, published, with a live website form; the same program backs the visitor application.
 const service={fetch:async(_url,init)=>Response.json({ok:true,value:{state:JSON.parse(init.body).input.input??{},result:'Saved'}})};
 const backend=id(),run=id(),publication=id(),formReview=id();
 await m.backend.saveBackend(scope,user,project,backend,'export default ({state,input})=>({state:input,result:"Saved"})');
 await m.backend.testBackend(scope,service,user,project,backend,run,{state:{},input:{}});
 await m.backendPublication.prepareBackendPublication(scope,user,project,publication,'publish',backend,run);await m.backendPublication.confirmBackendPublication(scope,user,publication);
 await m.backendForms.prepareBackendForm(scope,user,project,formReview,{title:'Estimate',description:'Try a quantity.',buttonLabel:'Calculate',fields:[{key:'quantity',label:'Quantity',type:'number'}]});
 await m.backendForms.confirmBackendForm(scope,user,formReview);

 // CMS: a ready instance (stub service) and one published post.
 const resources=new Map(),origin='https://whumpo-cms-'+project.replaceAll('-','')+'.whumpo.site';
 const cmsReview=await m.cmsProjects.prepareCMS(scope,user,id(),project,'My CMS','Our updates');await m.cmsProjects.confirmCMS(scope,user,cmsReview.id);
 await m.cmsProvision.allocateCMSResources(db,project,{accountId:account,find:async(k,n)=>resources.get(k+n)??null,create:async(k,n)=>resources.set(k+n,k==='database'?id():k==='session'?id().replaceAll('-',''):n)});
 const config={projectId:project,ownerId:user,origin,secret:await m.cmsBridge.deriveCMSSecret(master,project,user,origin)};
 let initialized=false,tag=null,version=null,item=null;
 const cms={fetch:async request=>{
  const v=await m.cmsBridge.verifyCMSRequest(request,config);let data;
  if(v.path==='/_emdash/api/setup/status')data={needsSetup:!initialized};
  else if(v.path==='/_emdash/api/setup'){initialized=true;data={setupComplete:true,seedComplete:true};}
  else if(v.path==='/_emdash/api/auth/me')data={email:user+'@owners.whumpo.invalid',role:50};
  else if(v.path==='/_emdash/api/schema/collections')data={items:[{slug:'posts'},{slug:'pages'}]};
  else if(v.path==='/_emdash/api/content/posts'){item={id:nativeId,status:'draft',data:JSON.parse(v.body).data};data={item};}
  else if(v.path==='/_emdash/api/content/posts/'+nativeId)data={item,_rev:'cmV2LTE='};
  else if(v.path.endsWith('/publish')){item={...item,status:'published'};data={item,_rev:'cHVibGlzaGVk'};}
  else throw Error('unexpected CMS path '+v.path);
  return Response.json({success:true,data});}};
 const provider={accountId:account,exists:async()=>version!==null,deploy:async(_n,t)=>{tag=t;version=id();},activeVersion:async(_n,t)=>tag===t?version:null,replaceVersion:()=>{version=id();},service:cms};
 await m.cmsDeploy.deployCMS(db,project,digest,config,provider);await m.cmsDeploy.connectCMS(db,project,id());
 const cmsEnv={CMS_BRIDGE_MASTER_KEY:master,['CMS_'+project.replaceAll('-','')]:cms};
 const draft=id();await m.cmsContent.createCMSDraft(scope,user,project,draft,'posts','A quieter corner','Good things take shape slowly.',cmsEnv);
 const review=await m.cmsPublication.prepareCMSPublication(scope,user,project,draft,id(),cmsEnv);await m.cmsPublication.confirmCMSPublication(scope,user,review.id,cmsEnv);

 // Application: visitor access, the activated program, a live page, and one signed-in passkey visitor.
 await enableFixtureVisitorAccess(scope,user,project,{handlers:m});
 const enable=id();await m.appActivation.prepareApplication(scope,user,project,enable,'enable',backend,run);await m.appActivation.confirmApplication(scope,user,enable);
 const page=id();await m.appPages.prepareAppPage(scope,user,project,page,{title:'Private journal',description:'Test',buttonLabel:'Save',fields:[{key:'note',label:'Note',type:'text'}]});await m.appPages.confirmAppPage(scope,user,page);
 const invite=await m.appAuth.createAppInvitation(scope,user,project),options=await m.appAuth.appPasskeyOptions(db,project,'signup',false,invite.code),key=authenticator();
 const signedUp=await m.appAuth.appPasskeyVerify(db,project,'signup',options.challengeToken,key.registration(options.options),false);
 const access=await db.prepare("SELECT id,config_revision FROM module_instances WHERE project_id=? AND kind='access'").bind(project).first();assert.ok(access);
 return {publication,article:'/cms/posts/'+nativeId,cookie:`__Host-whumpo-app-session-${project}=${signedUp.session}`,
  me:{api:'whumpo-modules',version:1,operation:'access.me',resourceId:access.id,configRevision:access.config_revision,requestId:null,target:null,input:null}};
}

/** A fresh owner with a published synthetic site, built with the same handler bundle as the success-path services (a scope
 * is only accepted by the bundle that issued it). Returns {scope,user,project}. */
export async function publishedFixtureSite({db,m}){
 const auth=await workspaceFixture(db,m),user=auth.account,scope=await auth.scope();
 await db.prepare("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')").bind(user).run();
 const {project,version}=await createFixtureProject(scope,user,'Garden','Garden care','ocean');
 const chat=async content=>{const turn=crypto.randomUUID(),r=await m.sendChat(scope,user,{id:turn,revision:(await m.readChat(scope,user)).state.revision,content});assert.equal(r.status,200,JSON.stringify(r));return turn;};
 await chat('/confirm '+await chat('/publish '+version));
 return {scope,user,project,version};
}

// Synthetic local D1 + mounted visitor gateway. No real credentials/providers.
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
export async function deletionFixture(){
 const store=await databaseFixture({d1:true});
 try{
  const db=store.db,m=await currentSiteFixtureHandlers(),modules={...m.appLifecycle,...m.appData,...m.appPages,...m.backend,...m.appActivation,...m.appGateway,hashToken:m.hashToken};
  const id=()=>crypto.randomUUID(),service={fetch:async(_url,init)=>Response.json({ok:true,value:{state:JSON.parse(init.body).input.input,result:'saved'}})};
  async function app(){
   const authority=await workspaceFixture(db,m),user=authority.account,scope=await authority.scope(),project=id(),version=id(),test=id(),review=id(),page=id(),now=new Date().toISOString();
   await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Deletion fixture','','draft',?,?)").bind(project,user,now,now).run();
   await modules.saveBackend(scope,user,project,version,'export default ({state,input})=>({state:input,result:"saved"})');
   await modules.testBackend(scope,service,user,project,version,test,{state:{},input:{}});
   await modules.prepareApplication(scope,user,project,review,'enable',version,test);await modules.confirmApplication(scope,user,review);
   await modules.prepareAppPage(scope,user,project,page,{title:'Private deletion fixture',description:'Synthetic account safety check',buttonLabel:'Save',fields:[{key:'note',label:'Note',type:'text'}]});await modules.confirmAppPage(scope,user,page);
   return {user,project,page,ownerDB:scope};
  }
  async function visitor(a,note){const who=id();await db.prepare('INSERT INTO app_visitors(id,project_id) VALUES(?,?)').bind(who,a.project).run();const session=await modules.issueAppSession(db,who);if(note)await modules.transitionAppData(db,service,session,a.project,id(),0,{note});return {who,session};}
  const env={DB:db,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:service};
  async function call(a,v,path,body,settings={}){const origin=`https://app-${a.project}.whumpo.site`;return modules.applicationGateway(new Request(origin+'/'+path,{method:body===undefined?'GET':'POST',headers:{origin:settings.origin??origin,'content-type':'application/json',cookie:`__Host-whumpo-app-session-${a.project}=${v?.session??''}`},body:body===undefined?undefined:JSON.stringify(body)}),{...env,DB:settings.db??db});}
  return {db,modules,id,app,visitor,call,service,env,async close(){await store.close();}};
 }catch(error){await store.close();throw error;}
}

// Synthetic local D1 + mounted visitor gateway. No real credentials/providers.
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
export async function deletionFixture(){
 const dir=await mkdtemp('/tmp/whumpo-deletion-');let proxy;
 try{
  execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
  proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
  const b=await build({stdin:{contents:"export * from './src/app-lifecycle';export * from './src/app-data';export * from './src/app-pages';export * from './src/backend-versions';export * from './src/app-activation';export * from './src/app-gateway';export {hashToken} from './src/security';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
  const modules=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
  const id=()=>crypto.randomUUID(),service={fetch:async(_url,init)=>Response.json({ok:true,value:{state:JSON.parse(init.body).input.input,result:'saved'}})};
  async function app(){
   const user=id(),project=id(),version=id(),test=id(),review=id(),page=id(),now=new Date().toISOString();
   await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now).run();
   await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Deletion fixture','','draft',?,?)").bind(project,user,now,now).run();
   await modules.saveBackend(db,user,project,version,'export default ({state,input})=>({state:input,result:"saved"})');
   await modules.testBackend(db,service,user,project,version,test,{state:{},input:{}});
   await modules.prepareApplication(db,user,project,review,'enable',version,test);await modules.confirmApplication(db,user,review);
   await modules.prepareAppPage(db,user,project,page,{title:'Private deletion fixture',description:'Synthetic account safety check',buttonLabel:'Save',fields:[{key:'note',label:'Note',type:'text'}]});await modules.confirmAppPage(db,user,page);
   return {user,project,page};
  }
  async function visitor(a,note){const who=id();await db.prepare('INSERT INTO app_visitors(id,project_id) VALUES(?,?)').bind(who,a.project).run();const session=await modules.issueAppSession(db,who);if(note)await modules.transitionAppData(db,service,session,a.project,id(),0,{note});return {who,session};}
  const env={DB:db,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:service};
  async function call(a,v,path,body,settings={}){const origin=`https://app-${a.project}.whumpo.site`;return modules.applicationGateway(new Request(origin+'/'+path,{method:body===undefined?'GET':'POST',headers:{origin:settings.origin??origin,'content-type':'application/json',cookie:`__Host-whumpo-app-session-${a.project}=${v?.session??''}`},body:body===undefined?undefined:JSON.stringify(body)}),{...env,DB:settings.db??db});}
  return {db,modules,id,app,visitor,call,service,env,async close(){await proxy.dispose();await rm(dir,{recursive:true,force:true});}};
 }catch(error){await proxy?.dispose();await rm(dir,{recursive:true,force:true});throw error;}
}

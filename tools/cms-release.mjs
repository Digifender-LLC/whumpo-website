import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir,lstat,cp,rename} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {resolve,join} from 'node:path';
import {createServer} from 'node:net';
export async function runWrangler(args,logFile){
 const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{stdio:['ignore','pipe','pipe']});let log='';
 for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{log=(log+chunk.toString()).slice(-1000000);});
 let force;const timer=setTimeout(()=>{child.kill('SIGTERM');force=setTimeout(()=>child.kill('SIGKILL'),5000);},180000);
 try{const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});await writeFile(logFile,log,{mode:0o600});if(status!==0)throw Error('Wrangler operation was not confirmed; inspect the private operation log');}finally{clearTimeout(timer);if(force)clearTimeout(force);}
}
export async function artifactDigest(directory){
 const hash=createHash('sha256');
 async function walk(path,prefix=''){for(const name of (await readdir(path)).sort()){const file=join(path,name),stat=await lstat(file),relative=prefix+name;if(stat.isSymbolicLink())throw Error('CMS artifacts cannot contain symlinks');if(stat.isDirectory())await walk(file,relative+'/');else{const data=await readFile(file);hash.update(relative+'\0'+data.length+'\0');hash.update(data);}}}
 await walk(directory);return hash.digest('hex');
}
export async function frozenArtifact(project){
 if(!/^[0-9a-f-]{36}$/.test(project))throw Error('Invalid CMS project');
 const dir=resolve('.secrets/cms',project),artifact=join(dir,'artifact');await mkdir(dir,{recursive:true,mode:0o700});
 try{await lstat(artifact);}catch(error){if(error.code!=='ENOENT')throw error;const pending=join(dir,'artifact-'+randomBytes(8).toString('hex'));await artifactDigest('integrations/emdash/dist');await cp('integrations/emdash/dist',pending,{recursive:true});await rename(pending,artifact);}
 return {dir,artifact,digest:await artifactDigest(artifact)};
}
export async function cmsMasterKey(db){
 const file=resolve('.secrets/cms/master.key');await mkdir(resolve('.secrets/cms'),{recursive:true,mode:0o700});
 try{const key=(await readFile(file,'utf8')).trim();if(!/^[A-Za-z0-9_-]{43}$/.test(key))throw Error('Invalid CMS master key');return key;}catch(error){if(error.code!=='ENOENT')throw error;}
 const existing=await db.prepare('SELECT count(*) n FROM cms_deployments').first();if(existing.n>0)throw Error('Restore the existing CMS master key; a replacement would invalidate deployed instances');
 try{await writeFile(file,randomBytes(32).toString('base64url')+'\n',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
 return (await readFile(file,'utf8')).trim();
}
export function instanceConfig(template,artifact,row,account){
 const expected='whumpo-cms-'+row.project_id.replaceAll('-','');
 if(row.worker_name!==expected||row.database_name!==expected||row.bucket_name!==expected+'-media'||!row.database_id||!row.session_namespace_id)throw Error('CMS resource registry is incomplete');
 const c={...template,name:expected,account_id:account,main:join(artifact,'server',template.main),workers_dev:false,preview_urls:false,routes:[],triggers:{crons:[]},vars:{WHUMPO_CMS_PROJECT_ID:row.project_id,WHUMPO_CMS_OWNER_ID:row.user_id,WHUMPO_CMS_ORIGIN:'https://'+expected+'.whumpo.site',EMDASH_SITE_URL:'https://'+expected+'.whumpo.site'},assets:{...template.assets,directory:join(artifact,'client')},d1_databases:[{binding:'DB',database_name:expected,database_id:row.database_id}],r2_buckets:[{binding:'MEDIA',bucket_name:row.bucket_name}],kv_namespaces:[{binding:'SESSION',id:row.session_namespace_id}]};
 for(const key of ['worker_loaders','services','dispatch_namespaces','send_email'])if((c[key]??[]).length)throw Error('Unapproved CMS binding');if(c.images?.binding)throw Error('CMS Images binding is not enabled');return c;
}
export async function workerExists(api,name){try{await api('/workers/scripts/'+name+'/versions');return true;}catch(error){if(error.status===404)return false;throw error;}}
export async function activeWorker(api,name,tag){
 let data;try{data=(await api('/workers/scripts/'+name+'/deployments')).result;}catch(error){if(error.status===404)return null;throw error;}
 const versions=data?.deployments?.[0]?.versions;if(!Array.isArray(versions)||versions.length!==1||versions[0].percentage!==100)return null;
 const id=versions[0].version_id,v=(await api('/workers/scripts/'+name+'/versions/'+id)).result;
 if(tag&&v.annotations?.['workers/tag']!==tag)return null;return {id,bindings:v.resources?.bindings??[]};
}
export async function privateCMSProbe(account,worker,origin,directory){
 const port=await new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
 const entry=join(directory,'probe.mjs'),config=join(directory,'probe.json');
 await writeFile(entry,'export default {fetch(request,env){const u=new URL(request.url);return env.CMS.fetch(new Request('+JSON.stringify(origin)+'+u.pathname+u.search,request));}};');
 await writeFile(config,JSON.stringify({name:'whumpo-cms-probe-'+worker.slice(-8),account_id:account,main:entry,compatibility_date:'2026-09-29',workers_dev:false,preview_urls:false,services:[{binding:'CMS',service:worker}]}));
 const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--remote','--config',config,'--ip','127.0.0.1','--port',String(port)],{stdio:['ignore','pipe','pipe']});let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{log=(log+data.toString()).slice(-20000);});
 const close=async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},4000);child.once('exit',()=>{clearTimeout(timer);resolve();});});}await writeFile(join(directory,'probe.log'),log,{mode:0o600});};
 try{
  let ready=false;for(let i=0;i<120;i++){if(child.exitCode!==null)throw Error('Private CMS probe exited');try{await fetch('http://127.0.0.1:'+port+'/_emdash/api/setup/status',{signal:AbortSignal.timeout(1000)});ready=true;break;}catch{}await new Promise(r=>setTimeout(r,250));}if(!ready)throw Error('Private CMS probe did not start');
  return {close,service:{async fetch(request){const url=new URL(request.url);return fetch('http://127.0.0.1:'+port+url.pathname,{method:request.method,headers:request.headers,...(request.method!=='GET'?{body:await request.text()}:{}),signal:request.signal,redirect:'error'});}}};
 }catch(error){await close();throw error;}
}

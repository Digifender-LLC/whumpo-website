import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
import {cmsCloudflareProvider} from '../tools/cms-cloudflare.mjs';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {allocateCMSResources}=await module('src/cms-provision.ts'),{prepareCMS,confirmCMS}=await module('src/cms-projects.ts');
const dir=await mkdtemp('/tmp/townhello-cms-provision-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB,id=()=>crypto.randomUUID(),account='a'.repeat(32);
async function fixture(){const user=id(),project=id(),now=new Date().toISOString();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now).run();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Provision fixture','','draft',?,?)").bind(project,user,now,now).run();const r=await prepareCMS(db,user,id(),project,'CMS','');await confirmCMS(db,user,r.id);return project;}
function provider(){const resources=new Map(),calls=[];return {resources,calls,accountId:account,find:async(kind,name)=>resources.get(kind+':'+name)??null,create:async(kind,name)=>{calls.push(kind);resources.set(kind+':'+name,kind==='database'?id():kind==='session'?id().replaceAll('-',''):name);}};}
try{
 const denied=provider();await assert.rejects(allocateCMSResources(db,id(),denied),/not approved/);assert.equal(denied.calls.length,0);
 const a=await fixture(),p=provider();await Promise.allSettled(Array.from({length:5},()=>allocateCMSResources(db,a,p)));await allocateCMSResources(db,a,p);assert.deepEqual(p.calls,['database','media','session']);const recorded=await db.prepare('SELECT * FROM cms_instances WHERE project_id=?').bind(a).first();assert.equal(recorded.state,'provisioning');assert.ok(recorded.database_id);assert.ok(recorded.session_namespace_id);assert.equal(recorded.deployed_version_id,null);
 await allocateCMSResources(db,a,p);assert.equal(p.calls.length,3);await assert.rejects(allocateCMSResources(db,a,{...p,accountId:'b'.repeat(32)}),/account or identity/);assert.equal(p.calls.length,3);
 const b=await fixture(),lost=provider();const create=lost.create;lost.create=async(...args)=>{await create(...args);throw Error('lost create acknowledgement');};await allocateCMSResources(db,b,lost);assert.equal(lost.calls.length,3);
 const c=await fixture(),unknown=provider();unknown.create=async(kind)=>{unknown.calls.push(kind);throw Error('unknown before creation');};await assert.rejects(allocateCMSResources(db,c,unknown),/unresolved/);await assert.rejects(allocateCMSResources(db,c,unknown),/unresolved/);assert.deepEqual(unknown.calls,['database']);assert.equal((await db.prepare('SELECT state FROM cms_instances WHERE project_id=?').bind(c).first()).state,'uncertain');
 const d=await fixture(),collision=provider();collision.resources.set('database:townhello-cms-'+d.replaceAll('-',''),id());await assert.rejects(allocateCMSResources(db,d,collision),/already exists/);assert.equal(collision.calls.length,0);
 const e=await fixture(),reserved=provider();let lose=true;
 const lossy=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{const s=target.prepare(sql);if(!sql.startsWith('INSERT INTO cms_resource_jobs'))return s;return {bind(...args){const bound=s.bind(...args);return {async run(){const result=await bound.run();if(lose){lose=false;throw Error('lost reservation acknowledgment');}return result;}};}};};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 await assert.rejects(allocateCMSResources(lossy,e,reserved),/unresolved/);await assert.rejects(allocateCMSResources(db,e,reserved),/unresolved/);assert.equal(reserved.calls.length,0);
 // A late provider result can be reconciled without repeating the original create.
 unknown.resources.set('database:townhello-cms-'+c.replaceAll('-',''),id());unknown.create=async(kind,name)=>{unknown.calls.push(kind);unknown.resources.set(kind+':'+name,kind==='session'?id().replaceAll('-',''):name);};await allocateCMSResources(db,c,unknown);assert.deepEqual(unknown.calls,['database','media','session']);
 // Resource identities cannot be swapped after a successful receipt.
 await assert.rejects(db.prepare("UPDATE cms_resource_jobs SET provider_id=? WHERE project_id=? AND kind='database'").bind(id(),a).run(),/immutable/);
 p.resources.set('database:'+recorded.database_name,id());await assert.rejects(allocateCMSResources(db,a,p),/replaced or mismatched/);
 // Provider adapter follows all pages and refuses ambiguous titles.
 let requests=0;const paged=cmsCloudflareProvider(account,async(path)=>{requests++;const page=new URL('https://fixture'+path).searchParams.get('page');return {result:page==='1'?Array.from({length:100},(_,i)=>({title:'unrelated-'+i,id:String(i)})):[{title:'chosen',id:'c'.repeat(32)}]};});assert.equal(await paged.find('session','chosen'),'c'.repeat(32));assert.equal(requests,2);
 const ambiguous=cmsCloudflareProvider(account,async()=>({result:[{title:'chosen',id:'a'.repeat(32)},{title:'chosen',id:'b'.repeat(32)}]}));await assert.rejects(ambiguous.find('session','chosen'),/Ambiguous/);
 console.log('CMS allocator passed: approved-only isolated resources, creation receipts, lost provider replies, unresolved no-repeat, collision rejection, concurrency, immutable IDs, account pinning and paginated reconciliation.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}

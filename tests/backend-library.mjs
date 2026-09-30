import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const b=await build({stdin:{contents:"export * from './src/backend-library';export {inspectionRequest} from './src/agent-inspection';export * from './src/backend-chat';export * from './src/backend-versions';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {inspectionRequest,backendLibrary,readBackendComponent,installBackendComponent,backendChatCommand,backendAction,saveBackend}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
for(const operation of ['library','component'])assert.equal(inspectionRequest(JSON.stringify({reply:'Inspect reusable helper',action:{kind:'backend',operation,...(operation==='component'?{reference:'line-total@1'}:{})}})),true);
assert.equal(inspectionRequest(JSON.stringify({reply:'Copy helper',action:{kind:'backend',operation:'useComponent',reference:'line-total@1',projectId:crypto.randomUUID()}})),false);
const dir=await mkdtemp('/tmp/whumpo-library-');let proxy,runtime;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir+'/db'],{stdio:'pipe',maxBuffer:16*1024*1024});
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/db/v3'},remoteBindings:false});const db=proxy.env.DB,id=()=>crypto.randomUUID();
 async function fixture(){const user=id(),project=id(),now=new Date().toISOString();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now).run();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Private fixture','','draft',?,?)").bind(project,user,now,now).run();return {user,project};}
 const a=await fixture(),other=await fixture(),version=id();
 const concurrent=await Promise.all([installBackendComponent(db,a.user,a.project,version,'line-total@1'),installBackendComponent(db,a.user,a.project,version,'line-total@1')]);assert.equal(concurrent[0],concurrent[1]);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM backend_component_instances').first()).n,1);
 await assert.rejects(installBackendComponent(db,other.user,a.project,id(),'line-total@1'),e=>e.status===404);
 await assert.rejects(installBackendComponent(db,a.user,a.project,version,'text-statistics@1'),e=>e.status===409);
 await assert.rejects(readBackendComponent('https://example.test/source.js'),e=>e.status===404);
 await assert.rejects(backendAction(db,a.user,id(),{kind:'backend',operation:'useComponent',projectId:a.project,reference:'line-total@1',source:'export default ()=>1'}),e=>e.status===400);
 const isolated=id();await installBackendComponent(db,other.user,other.project,isolated,'line-total@1');assert.notEqual(isolated,version);
 await assert.rejects(db.prepare("UPDATE backend_component_instances SET component_version=2 WHERE version_id=?").bind(version).run());
 await assert.rejects(db.prepare('DELETE FROM backend_component_instances WHERE version_id=?').bind(version).run());
 await db.prepare('DELETE FROM projects WHERE id=? AND owner_user_id=?').bind(other.project,other.user).run();assert.equal((await db.prepare('SELECT COUNT(*) n FROM backend_component_instances WHERE version_id=?').bind(isolated).first()).n,0);
 const customized=id();await saveBackend(db,a.user,a.project,customized,'export default () => 42');assert.equal((await db.prepare('SELECT COUNT(*) n FROM backend_component_instances WHERE version_id=?').bind(customized).first()).n,0);
 assert.match(await backendChatCommand(db,a.user,id(),'/backend '+version)(),/Library origin: line-total@1/);
 assert.match(await backendChatCommand(db,a.user,id(),'/backend-library')(),/line-total@1/);
 assert.match(await backendChatCommand(db,a.user,id(),'/backend-component text-statistics@1')(),/Synthetic check/);
 assert.match((await backendAction(db,a.user,id(),{kind:'backend',operation:'component',reference:'line-total@1'})).reply,/SHA-256/);
 const lost=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{await target.batch(statements);throw Error('Lost commit response');};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 assert.match(await installBackendComponent(lost,a.user,a.project,id(),'text-statistics@1'),/Copied text-statistics/);
 const invalid=id();await assert.rejects(installBackendComponent(db,a.user,a.project,invalid,'line-total@99'),e=>e.status===404);assert.equal((await db.prepare('SELECT COUNT(*) n FROM backend_versions WHERE id=?').bind(invalid).first()).n,0);
 for(const table of ['backend_runs','backend_publications'])assert.equal((await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0);
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.runtime.jsonc','--dry-run','--outdir',dir+'/runtime'],{stdio:'pipe',maxBuffer:16*1024*1024});
 const req=createRequire(import.meta.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=req('miniflare');runtime=new Miniflare(convertV4MiniflareOptions({modulesRoot:dir+'/runtime',modules:[{type:'ESModule',path:dir+'/runtime/worker.js'},...(await readdir(dir+'/runtime')).filter(p=>p.endsWith('.wasm')).map(p=>({type:'CompiledWasm',path:dir+'/runtime/'+p}))],compatibilityDate:'2026-09-29'}));
 async function run(reference,input){const e=await readBackendComponent(reference);return (await runtime.dispatchFetch('http://runtime/execute',{method:'POST',body:JSON.stringify({version:1,source:e.source,input})})).json();}
 for(const e of backendLibrary){assert.equal(e.artifactDigest,(await readBackendComponent(e.reference)).digest);assert.deepEqual(await run(e.reference,e.example.input),{ok:true,value:e.example.expected});assert.deepEqual(e.capabilities,[]);}
 assert.deepEqual(await run('line-total@1',{items:[]}),{ok:true,value:{totalCents:0}});
 assert.deepEqual(await run('line-total@1',{items:Array.from({length:50},()=>({unitCents:100000000,quantity:1000}))}),{ok:true,value:{totalCents:5000000000000}});
 for(const input of [{items:[{unitCents:1.5,quantity:2}]},{items:[{unitCents:-1,quantity:1}]},{items:[{unitCents:1,quantity:0}]},{items:[{unitCents:1,quantity:1001}]},{items:[],source:'malicious'},null])assert.equal((await run('line-total@1',input)).ok,false);
 assert.deepEqual(await run('text-statistics@1',{text:'🌿 hi\r\nthere'}),{ok:true,value:{characters:11,words:3,lines:2}});
 assert.deepEqual(await run('text-statistics@1',{text:''}),{ok:true,value:{characters:0,words:0,lines:0}});
 assert.equal((await run('text-statistics@1',{text:'x'.repeat(2401)})).ok,false);
 const taskReference='private-task-list@1',task=async(state,input)=>run(taskReference,{state,input});
 let taskState={};
 for(const text of ['First private task','Second private task']){const response=await task(taskState,{action:'add',text});assert.equal(response.ok,true);taskState=response.value.state;}
 assert.deepEqual(taskState.items.map(t=>t.id),[1,2]);
 for(const [action,done]of [['complete',true],['reopen',false]]){const response=await task(taskState,{action,id:1});assert.equal(response.ok,true);taskState=response.value.state;assert.equal(taskState.items[0].done,done);assert.equal(taskState.items[1].text,'Second private task');}
 taskState=(await task(taskState,{action:'remove',id:1})).value.state;
 taskState=(await task(taskState,{action:'add',text:'Third task'})).value.state;assert.deepEqual(taskState.items.map(t=>t.id),[2,3]);
 assert.deepEqual((await task(taskState,{action:'list'})).value.state,taskState);
 const separate=await task({}, {action:'add',text:'Other visitor'});assert.deepEqual(separate.value.state.items,[{id:1,text:'Other visitor',done:false}]);assert.ok(!JSON.stringify(separate).includes('Second private task'));
 const maximum={nextId:1000000000,items:Array.from({length:12},(_,i)=>({id:999999988+i,text:'界'.repeat(80),done:false}))};
 const maxResult=await task(maximum,{action:'list'});assert.equal(maxResult.ok,true);assert.ok(Buffer.byteLength(JSON.stringify(maxResult.value.state))<=4096);assert.ok(Buffer.byteLength(JSON.stringify(maxResult.value.result))<=4096);
 for(const [state,input]of [[maximum,{action:'add',text:'Full'}],[taskState,{action:'remove',id:999}],[taskState,{action:'destroy'}],[taskState,{action:'add',text:'x'.repeat(81)}],[taskState,{action:'add',text:' '}],[taskState,{action:'add',text:'bad\u0000text'}],[taskState,{action:'add',text:'\ud800'}],[taskState,{action:'list',source:'not allowed'}],[{items:[{id:1,text:'a',done:false},{id:1,text:'b',done:false}],nextId:2},{action:'list'}],[{nextId:1,items:[{id:1,text:'invalid next ID',done:false}]},{action:'list'}],[{secret:'unexpected'}, {action:'list'}]])assert.equal((await task(state,input)).ok,false);
 const unicode=await task({}, {action:'add',text:' 🌿 Plan the page '});assert.equal(unicode.ok,true);assert.equal(unicode.value.state.items[0].text,'🌿 Plan the page');
 const taskVersion=id(),taskOwner=await fixture();await installBackendComponent(db,a.user,a.project,taskVersion,taskReference);await installBackendComponent(db,taskOwner.user,taskOwner.project,id(),taskReference);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM backend_component_instances WHERE component_id=?').bind('private-task-list').first()).n,2);
 assert.match(await backendChatCommand(db,a.user,id(),'/backend-component '+taskReference)(),/Application transition/);
 for(const table of ['backend_runs','backend_publications','app_spaces'])assert.equal((await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0);
 console.log('Backend library passed: exact artifact digests, actual QuickJS examples and bounds, private tenant copies, immutable provenance, concurrent replay, lost commit recovery, forged source/URL refusal, chat/model discovery and no automatic execution/publication.');
}finally{if(runtime)await runtime.dispose();if(proxy)await proxy.dispose();await rm(dir,{recursive:true,force:true});}

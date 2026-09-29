import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {sendChat,readChat}=await module('src/chat.ts'),{sendAIChat}=await module('src/ai-chat.ts'),{getBilling}=await module('src/billing.ts');
const dir=await mkdtemp('/tmp/whumpo-backend-chat-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe'});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB,id=()=>crypto.randomUUID();
async function account(){const user=id(),project=id(),now=new Date().toISOString();await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.com',now).run();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Calculator','Quote estimates','draft',?,?)").bind(project,user,now,now).run();await readChat(db,user);return {user,project};}
let executions=0;const backendRuntime={fetch:async(_url,init)=>{executions++;const data=JSON.parse(init.body);return Response.json({ok:true,value:{total:data.input.quantity*data.input.price}});}};
async function guided(a,content){const revision=(await readChat(db,a.user)).state.revision,request={id:id(),revision,content};const result=await sendChat(db,a.user,request,undefined,{backendRuntime});assert.equal(result.status,200,JSON.stringify(result));return {request,turn:(await readChat(db,a.user)).turns.at(-1)};}
async function ai(a,action){const request={id:id(),revision:(await readChat(db,a.user)).state.revision,content:'Prepare my requested private backend operation'};let calls=0;const transport=async()=>{calls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'Already deployed',action})}]}],usage:{input_tokens:800,output_tokens:300}});};const config={baseURL:'https://provider.test/v1',apiKey:'synthetic',model:'fixture',protocol:'responses'};assert.equal((await sendAIChat(db,a.user,request.id,request.revision,request.content,config,transport,{backendRuntime})).status,200);await sendAIChat(db,a.user,request.id,request.revision,request.content,config,transport,{backendRuntime});assert.equal(calls,1);return {request,turn:(await readChat(db,a.user)).turns.at(-1)};}
try{
 const a=await account(),b=await account(),source='export default input=>({total:input.quantity*input.price})';
 const created=await ai(a,{kind:'backend',operation:'create',projectId:a.project,source}),version=created.request.id;
 assert.match(created.turn.assistant_text,/untested private backend draft/);assert.doesNotMatch(created.turn.assistant_text,/Already deployed/);
 assert.equal((await db.prepare('SELECT source FROM backend_versions WHERE id=?').bind(version).first()).source,source);
 assert.equal((await db.prepare('SELECT count(*) n FROM publications WHERE project_id=? AND version_id IS NOT NULL').bind(a.project).first()).n,0);
 const spent=(await getBilling(db,a.user)).quota.spent;
 assert.match((await guided(a,'/backends '+a.project)).turn.assistant_text,new RegExp(version));
 assert.ok((await guided(a,'/backend '+version)).turn.assistant_text.includes(source));
 const run=await guided(a,'/test-backend '+version+' {"quantity":3,"price":7}');assert.match(run.turn.assistant_text,/"total":21/);assert.equal(executions,1);
 await sendChat(db,a.user,run.request,undefined,{backendRuntime});assert.equal(executions,1);
 assert.match((await guided(a,'/backend-result '+run.request.id)).turn.assistant_text,/"total":21/);assert.equal((await getBilling(db,a.user)).quota.spent,spent);
 assert.match((await guided(b,'/backend '+version)).turn.assistant_text,/not found/);
 assert.match((await guided(b,'/test-backend '+version+' null')).turn.assistant_text,/not found/);assert.equal(executions,1);
 assert.match((await guided(b,'/backend-result '+run.request.id)).turn.assistant_text,/not found/);
 const aiRun=await ai(a,{kind:'backend',operation:'test',versionId:version,input:{quantity:4,price:5}});assert.match(aiRun.turn.assistant_text,/"total":20/);assert.equal(executions,2);
 for(const action of [{kind:'backend',operation:'publish',versionId:version},{kind:'backend',operation:'test',versionId:version,input:{},confirm:true},{kind:'backend',operation:'create',projectId:b.project,source}]){const denied=await ai(a,action);assert.equal(await db.prepare('SELECT id FROM backend_versions WHERE id=?').bind(denied.request.id).first(),null);}
 assert.equal(executions,2);
 // Simultaneous guided requests with the same ID reserve one turn and one invocation.
 const request={id:id(),revision:(await readChat(db,a.user)).state.revision,content:'/test-backend '+version+' {"quantity":2,"price":8}'};
 await Promise.all(Array.from({length:5},()=>sendChat(db,a.user,request,undefined,{backendRuntime})));assert.equal(executions,3);
 assert.equal((await db.prepare('SELECT count(*) n FROM backend_runs WHERE id=?').bind(request.id).first()).n,1);
 console.log('Backend chat checks passed: AI immutable drafts, exact server receipts, guided inspect/test/result, free guided usage, owner isolation, rejected publication/extra fields and replay-safe execution.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}

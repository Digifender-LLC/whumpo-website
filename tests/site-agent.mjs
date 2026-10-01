Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {sendAIChat,reconcileChat}=await module('src/ai-chat.ts');const {readChat,sendChatControl}=await module('src/chat.ts');const {getBilling}=await module('src/billing.ts');
const dir=await mkdtemp('/tmp/tellumo-agent-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
const cfg={baseURL:'https://provider.test/v1',apiKey:'fake-key',model:'fake-model',protocol:'responses'};
async function account(){const id=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,'test',?)").bind(id,id+'@example.com','00',new Date().toISOString()).run();await db.prepare("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')").bind(id).run();const project=crypto.randomUUID();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Bakery','Fresh bread','draft',?,?)").bind(project,id,new Date().toISOString(),new Date().toISOString()).run();return {id,project};}
const config={name:'Bakery',headline:'Fresh bread, every morning',description:'Bread for the neighborhood.',theme:'clay',aboutTitle:'Our story',aboutText:'A neighborhood bakery.',sections:[{heading:'Visit us',text:'Ask us about today’s bread.'}],photos:[]};
let calls=0;
const provider=action=>async(_url,options)=>{const payload=JSON.parse(options.body);assert.ok(payload.input.every(m=>m.content.length<=16000));assert.ok(payload.input.filter(m=>m.role==='system').map(m=>m.content).join('').includes('Workspace dashboard actions:'));calls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:typeof action==='string'?action:JSON.stringify({reply:'Proposed change',action})}]}],usage:{input_tokens:100,output_tokens:200}});};
async function send(dbx,user,action){const state=await readChat(db,user.id);const id=crypto.randomUUID();const result=await sendAIChat(dbx,user.id,id,state.state.revision,'Make a warm bakery site',cfg,provider(action));assert.equal(result.status,200,JSON.stringify(result));return id;}
async function change(user,operations,dbx=db){
 const head=await db.prepare('SELECT revision FROM project_spec_heads WHERE project_id=?').bind(user.project).first();
 const request=await send(db,user,{kind:'specification',operation:'change',projectId:user.project,expectedRevision:head.revision,operations});
 const q=(await readChat(db,user.id)).turns.find(t=>t.id===request).specification_review;assert.ok(q);
 const version=crypto.randomUUID(),revision=(await readChat(db,user.id)).state.revision;
 assert.equal((await sendChatControl(dbx,user.id,{id:version,revision,action:{type:'specificationApply',reviewId:q.id,proposalDigest:q.proposalDigest,expectedRevision:q.expectedRevision}})).status,200);return version;
}
try{
 const owner=await account(),other=await account();
 const id=await send(db,owner,{kind:'specification',operation:'create',projectId:owner.project,config});
 let row=await db.prepare('SELECT * FROM site_versions WHERE id=?').bind(id).first();assert.equal(row.source,'ai');assert.equal(row.component_id,'site-page@1');assert.ok(row.html.includes('Fresh bread, every morning'));assert.ok(row.html.includes('Visit us'));
 assert.equal((await getBilling(db,owner.id)).standardAI.creditCharge,0);assert.equal((await readChat(db,owner.id)).turns.at(-1).version_id,id);
 await sendAIChat(db,owner.id,id,0,'Make a warm bakery site',cfg,provider(null));assert.equal(calls,1);
 const review=await send(db,owner,{kind:'review',operation:'publish',targetId:id});assert.equal((await readChat(db,owner.id)).turns.at(-1).confirmation_id,review);assert.equal((await db.prepare('SELECT version_id FROM publications WHERE project_id=?').bind(owner.project).first()).version_id,null);
 for(const action of [
  {kind:'specification',operation:'create',projectId:other.project,config},
  {kind:'confirm',targetId:review},
  {kind:'project',purpose:'Another bakery',config:{...config,script:'alert(1)'}},
  {kind:'project',purpose:'Another bakery',config:{...config,theme:'red; background:url(https://evil.test)'}},
  {kind:'preview',projectId:owner.project,config},
  {kind:'edit',baseVersionId:id,changes:{theme:'forest'}},
  'not JSON'
 ]){
  const rejected=await send(db,owner,action);assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(rejected).first()).status,action?.kind==='specification'?'completed':'failed');assert.equal(await db.prepare('SELECT id FROM site_versions WHERE id=?').bind(rejected).first(),null);assert.equal((await getBilling(db,owner.id)).standardAI.creditCharge,0);
 }
 const escaped=await change(owner,[{type:'content.replace',contentId:'headline',text:'<script>alert(1)</script>'}]);
 row=await db.prepare('SELECT html,base_version_id FROM site_versions WHERE id=?').bind(escaped).first();assert.ok(row.html.includes('&lt;script&gt;'));assert.ok(!row.html.includes('<script>'));assert.equal(row.base_version_id,id);
 // Lost first-save acknowledgement reuses the committed initial specification.
 const fresh=await account();let lost=false;const lossy=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{const result=await target.batch(statements);if(!lost&&await target.prepare('SELECT id FROM project_spec_creations WHERE project_id=?').bind(fresh.project).first()){lost=true;throw Error('Simulated lost commit acknowledgement');}return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const beforeCalls=calls,recovered=await send(lossy,fresh,{kind:'specification',operation:'create',projectId:fresh.project,config:{...config,theme:'forest'}});assert.ok(lost);assert.equal(calls,beforeCalls+1);assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(recovered).first()).status,'completed');await reconcileChat(db,fresh.id);assert.equal(calls,beforeCalls+1);
 const edited=await change(fresh,[{type:'content.replace',contentId:'headline',text:'A new headline'}]);
 const editedRow=await db.prepare('SELECT config_json,base_version_id FROM site_versions WHERE id=?').bind(edited).first();const {photos,...textConfig}=config;
 assert.deepEqual(JSON.parse(editedRow.config_json),{...textConfig,theme:'forest',headline:'A new headline'});assert.equal(editedRow.base_version_id,recovered);
 const foreign=await send(db,other,{kind:'specification',operation:'change',projectId:fresh.project,expectedRevision:2,operations:[{type:'design.setTheme',theme:'clay'}]});assert.match((await db.prepare('SELECT assistant_text FROM chat_turns WHERE id=?').bind(foreign).first()).assistant_text,/not found/);assert.equal(await db.prepare('SELECT id FROM project_spec_proposals WHERE id=?').bind(foreign).first(),null);
 for(const operations of [[],[{type:'script',source:'alert(1)'}],[{type:'design.setTheme',theme:'invalid'}],[{type:'pages.setSections',pageId:'home',sections:null}]]){
  const invalid=await send(db,fresh,{kind:'specification',operation:'change',projectId:fresh.project,expectedRevision:2,operations});assert.equal(await db.prepare('SELECT id FROM project_spec_proposals WHERE id=?').bind(invalid).first(),null);assert.match((await db.prepare('SELECT assistant_text FROM chat_turns WHERE id=?').bind(invalid).first()).assistant_text,/not supported/);
 }
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM site_versions WHERE project_id=?').bind(other.project).first()).n,0);
 console.log('Site agent passed: current first saves and exact reviewed edits, retired action/schema refusal, ownership, escaped output, immutable ancestry, lost creation acknowledgement and non-billable retries. Scripted interpretation only.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}

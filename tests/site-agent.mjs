import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {sendAIChat,reconcileChat}=await module('src/ai-chat.ts');const {readChat}=await module('src/chat.ts');const {getBilling}=await module('src/billing.ts');
const dir=await mkdtemp('/tmp/tellumo-agent-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
const cfg={baseURL:'https://provider.test/v1',apiKey:'fake-key',model:'fake-model',protocol:'responses'};
async function account(){const id=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,'test',?)").bind(id,id+'@example.com','00',new Date().toISOString()).run();await db.prepare("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')").bind(id).run();const project=crypto.randomUUID();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Bakery','Fresh bread','draft',?,?)").bind(project,id,new Date().toISOString(),new Date().toISOString()).run();return {id,project};}
const config={name:'Bakery',headline:'Fresh bread, every morning',description:'Bread for the neighborhood.',theme:'clay',aboutTitle:'Our story',aboutText:'A neighborhood bakery.',sections:[{heading:'Visit us',text:'Ask us about today’s bread.'}]};
let calls=0;
const provider=action=>async(_url,options)=>{const payload=JSON.parse(options.body);assert.ok(payload.input.every(m=>m.content.length<=16000));assert.ok(payload.input.filter(m=>m.role==='system').map(m=>m.content).join('').includes('Workspace dashboard actions:'));calls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:typeof action==='string'?action:JSON.stringify({reply:'Proposed change',action})}]}],usage:{input_tokens:100,output_tokens:200}});};
async function send(dbx,user,action){const state=await readChat(db,user.id);const id=crypto.randomUUID();const result=await sendAIChat(dbx,user.id,id,state.state.revision,'Make a warm bakery site',cfg,provider(action));assert.equal(result.status,200,JSON.stringify(result));return id;}
try{
 const owner=await account(),other=await account();
 // Keep this long action suite funded so its final version-limit check reaches that gate.
 // Free-tier reservation exhaustion is independently exercised in billing.mjs.
 const id=await send(db,owner,{kind:'preview',projectId:owner.project,config});
 let row=await db.prepare('SELECT * FROM site_versions WHERE id=?').bind(id).first();assert.equal(row.source,'ai');assert.equal(row.component_id,'site-page@1');assert.ok(row.html.includes('Fresh bread, every morning'));assert.ok(row.html.includes('Visit us'));
 assert.equal((await getBilling(db,owner.id)).standardAI.creditCharge,0);assert.equal((await readChat(db,owner.id)).turns.at(-1).version_id,id);
 await sendAIChat(db,owner.id,id,0,'Make a warm bakery site',cfg,provider(null));assert.equal(calls,1);
 const review=await send(db,owner,{kind:'review',operation:'publish',targetId:id});assert.equal((await readChat(db,owner.id)).turns.at(-1).confirmation_id,review);assert.equal((await db.prepare('SELECT version_id FROM publications WHERE project_id=?').bind(owner.project).first()).version_id,null);
 for(const action of [
  {kind:'preview',projectId:other.project,config},
  {kind:'confirm',targetId:review},
  {kind:'preview',projectId:owner.project,config:{...config,script:'alert(1)'}},
  {kind:'preview',projectId:owner.project,config:{...config,theme:'red; background:url(https://evil.test)'}},
  'not JSON'
 ]){
  const before=await getBilling(db,owner.id);const rejected=await send(db,owner,action);const turn=await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(rejected).first();assert.equal(turn.status,'failed');assert.equal(await db.prepare('SELECT id FROM site_versions WHERE id=?').bind(rejected).first(),null);assert.equal((await getBilling(db,owner.id)).standardAI.creditCharge,before.standardAI.creditCharge);assert.equal((await getBilling(db,owner.id)).standardAI.creditCharge,0);
 }
 const escaped=await send(db,owner,{kind:'preview',projectId:owner.project,config:{...config,headline:'<script>alert(1)</script>',sections:[{heading:'<img src=x>',text:'& "hello"'}]}});
 row=await db.prepare('SELECT html,base_version_id FROM site_versions WHERE id=?').bind(escaped).first();assert.ok(row.html.includes('&lt;script&gt;'));assert.ok(!row.html.includes('<script>'));assert.equal(row.base_version_id,id);
 // Lose the acknowledgement after the answer and draft have committed.
 let lost=false;const lossy=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{const result=await target.batch(statements);if(!lost&&result.some(x=>x.meta.changes)&&await target.prepare("SELECT id FROM site_versions WHERE project_id=? AND id NOT IN (?,?)").bind(owner.project,id,escaped).first()){lost=true;throw Error('Simulated lost commit acknowledgement');}return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const beforeCalls=calls;const recovered=await send(lossy,owner,{kind:'preview',projectId:owner.project,config:{...config,theme:'forest'}});assert.equal(lost,true);assert.equal(calls,beforeCalls+1);assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(recovered).first()).status,'completed');assert.ok(await db.prepare('SELECT id FROM site_versions WHERE id=?').bind(recovered).first());assert.equal((await getBilling(db,owner.id)).standardAI.creditCharge,0);
 await reconcileChat(db,owner.id);assert.equal(calls,beforeCalls+1);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM site_versions WHERE project_id=?').bind(other.project).first()).n,0);
 // A narrow edit preserves every omitted field and retains exact base ancestry.
 const edited=await send(db,owner,{kind:'edit',baseVersionId:recovered,changes:{headline:'A new headline'}});
 const editedRow=await db.prepare('SELECT config_json,base_version_id FROM site_versions WHERE id=?').bind(edited).first();
 assert.deepEqual(JSON.parse(editedRow.config_json),{...config,theme:'forest',headline:'A new headline'});assert.equal(editedRow.base_version_id,recovered);
 const foreignEdit=await send(db,other,{kind:'edit',baseVersionId:edited,changes:{theme:'clay'}});assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(foreignEdit).first()).status,'failed');
 for(const changes of [{},{script:'alert(1)'},{theme:'invalid'},{sections:null}]){
  const invalid=await send(db,owner,{kind:'edit',baseVersionId:edited,changes});assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(invalid).first()).status,'failed');
 }
 const photoId=crypto.randomUUID(),foreignPhoto=crypto.randomUUID();
 for(const [pid,projectId] of [[photoId,owner.project],[foreignPhoto,other.project]])await db.prepare("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at) VALUES(?,?,'Synthetic photo',?,'fixture',1,1,1,'ready',?)").bind(pid,projectId,'photos/'+pid,new Date().toISOString()).run();
 const illustrated=await send(db,owner,{kind:'edit',baseVersionId:edited,changes:{photos:[{id:photoId,alt:'Synthetic photo'}]}});const illustratedRow=await db.prepare('SELECT component_id,config_json FROM site_versions WHERE id=?').bind(illustrated).first();assert.equal(illustratedRow.component_id,'photo-page@1');assert.equal((await db.prepare('SELECT file_id FROM version_photos WHERE version_id=?').bind(illustrated).first()).file_id,photoId);
 const rethemed=await send(db,owner,{kind:'edit',baseVersionId:illustrated,changes:{theme:'ocean'}});assert.deepEqual(JSON.parse((await db.prepare('SELECT config_json FROM site_versions WHERE id=?').bind(rethemed).first()).config_json).photos,[{id:photoId,alt:'Synthetic photo'}]);
 const unauthorized=await send(db,owner,{kind:'edit',baseVersionId:illustrated,changes:{photos:[{id:foreignPhoto,alt:'No'}]}});assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(unauthorized).first()).status,'failed');
 const without=await send(db,owner,{kind:'edit',baseVersionId:rethemed,changes:{photos:[]}});assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM version_photos WHERE version_id=?').bind(without).first()).n,0);
 const count=(await db.prepare('SELECT COUNT(*) AS n FROM site_versions WHERE project_id=?').bind(owner.project).first()).n;
 for(let n=count;n<25;n++)await db.prepare("INSERT INTO site_versions(id,project_id,component_id,config_json,html,digest,created_at) VALUES(?,?,'launch-page@1','{}','synthetic quota fixture','fixture',?)").bind(crypto.randomUUID(),owner.project,new Date().toISOString()).run();
 const beforeQuota=await getBilling(db,owner.id);const limited=await send(db,owner,{kind:'preview',projectId:owner.project,config});assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(limited).first()).status,'failed');assert.equal((await getBilling(db,owner.id)).standardAI.creditCharge,beforeQuota.standardAI.creditCharge);assert.equal((await getBilling(db,owner.id)).standardAI.creditCharge,0);
 console.log('Site agent checks passed: metered drafts, replay, publication review without publication, ownership, action/schema rejection, injection escaping, version ancestry and lost-commit recovery without inference.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const bundled=await build({stdin:{resolveDir:process.cwd(),contents:"export * from './src/standard-ai-history';export * from './src/standard-ai-usage';export {readChat,sendChat} from './src/chat';export {inspectWorkspace} from './src/workspace-read';"},bundle:true,format:'esm',platform:'node',write:false});
const {readStandardAIHistory,readStandardAIRequest,describeStandardAIHistory,standardAIStatus,reserveStandardAI,dispatchStandardAI,completeStandardAI,markStandardAIUncertain,cancelStandardAI,readChat,sendChat,inspectWorkspace}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-standard-history-');let proxy;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 const owner=crypto.randomUUID(),other=crypto.randomUUID(),now=new Date().toISOString(),ids=[];
 for(const user of [owner,other])await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now).run();
 assert.equal((await readStandardAIHistory(db,owner)).rows.length,0);
 for(const page of [0,-1,1.5,1001,NaN])await assert.rejects(()=>readStandardAIHistory(db,owner,page),e=>e.status===400);
 for(let i=0;i<25;i++){
  const id=crypto.randomUUID();ids.push(id);await reserveStandardAI(db,owner,id,'a'.repeat(64));
  if(i===0)await cancelStandardAI(db,owner,id);
  else if(i===1){await dispatchStandardAI(db,owner,id);await markStandardAIUncertain(db,owner,id);}
  else{await dispatchStandardAI(db,owner,id);await completeStandardAI(db,owner,id,100,200);}
  // Deliberately include a failed action with completed provider accounting.
  await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Private fixture prompt','Private fixture response',?,'ai',?)").bind(id,owner,i+1,now,i===0||i===2?'failed':i===1?'uncertain':'completed').run();
 }
 const foreign=crypto.randomUUID();await reserveStandardAI(db,other,foreign,'b'.repeat(64));
 const readonly={prepare(sql){assert.ok(sql.startsWith('SELECT '));return db.prepare(sql);}};
 const first=await readStandardAIHistory(readonly,owner),second=await readStandardAIHistory(readonly,owner,2);assert.equal(first.rows.length,20);assert.equal(first.hasMore,true);assert.equal(second.rows.length,5);assert.equal(second.hasMore,false);assert.equal(new Set([...first.rows,...second.rows].map(r=>r.id)).size,25);
 assert.equal(await readStandardAIRequest(readonly,owner,foreign),null);assert.equal(await readStandardAIRequest(readonly,owner,crypto.randomUUID()),null);assert.equal((await readStandardAIHistory(readonly,other)).rows.length,1);
 const failed=await readStandardAIRequest(readonly,owner,ids[2]);assert.equal(failed.state,'completed');assert.equal(standardAIStatus(failed),'Could not complete the requested work');assert.equal(standardAIStatus(await readStandardAIRequest(readonly,owner,ids[1])),'Outcome needs review');
 const rendered=describeStandardAIHistory(first);for(const hidden of ['Private fixture prompt','Private fixture response',owner,foreign,'a'.repeat(64),'input_tokens','estimated_micros'])assert.ok(!rendered.includes(hidden));assert.match(rendered,/No units or credits charged/);assert.match(rendered,/Next: \/ai-history 2/);
 for(const table of ['inference_calls'])assert.equal((await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0);
 await readChat(db,owner);await db.prepare("UPDATE workspace_state SET step='ready',revision=25 WHERE user_id=?").bind(owner).run();
 const ledgerBefore=(await db.prepare('SELECT * FROM stripe_paid_invoices ORDER BY id').all()).results;
 const fetchBefore=globalThis.fetch;globalThis.fetch=()=>{throw Error('No inference permitted');};
 try{
  for(const content of ['show my AI requests','show recent AI requests','/ai-history 2','/ai-request '+ids[2]]){
   const chat=await readChat(db,owner),input={id:crypto.randomUUID(),revision:chat.state.revision,content};assert.equal((await sendChat(db,owner,input,{baseURL:'https://invalid.test/v1',apiKey:'unused',model:'unused'})).status,200);assert.equal((await sendChat(db,owner,input)).status,200);const turn=await db.prepare('SELECT mode,assistant_text FROM chat_turns WHERE id=?').bind(input.id).first();assert.equal(turn.mode,'guided');assert.match(turn.assistant_text,/No units or credits charged/);
  }
  for(const [content,status] of [['/ai-history 0',400],['/ai-history 1 extra',400],['/ai-request malformed',400],['/ai-request '+foreign,404]]){const chat=await readChat(db,owner);assert.equal((await sendChat(db,owner,{id:crypto.randomUUID(),revision:chat.state.revision,content})).status,status);assert.equal((await readChat(db,owner)).state.revision,chat.state.revision);}
 }finally{globalThis.fetch=fetchBefore;}
 assert.match(await inspectWorkspace(db,owner,'usage'),/Standard AI requests/);
 for(const table of ['inference_calls'])assert.equal((await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0);
 assert.deepEqual((await db.prepare('SELECT * FROM stripe_paid_invoices ORDER BY id').all()).results,ledgerBefore);
 console.log('Standard AI history passed: owner isolation, pagination, metadata-only reads, failed-work versus completed-cost distinction, guided natural aliases, exact replay, malformed/foreign refusal, agent usage inspection and zero inference or charges.');
}finally{await proxy?.dispose();await rm(dir,{recursive:true,force:true});}

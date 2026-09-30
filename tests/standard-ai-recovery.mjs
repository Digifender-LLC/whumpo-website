import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {reconcileChat,sendAIChat}=await module('src/ai-chat.ts');
const {reconcileStandardChat}=await module('src/standard-ai-recovery.ts');
const {reserveStandardAI,dispatchStandardAI,readStandardAI,closeStandardAIAttempt}=await module('src/standard-ai-usage.ts');
const {ensureInferenceBudget,inferenceReservation,dispatchInference,observeInference}=await module('src/model-costs.ts');
const dir=await mkdtemp('/tmp/whumpo-standard-recovery-');
execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
const config={baseURL:'https://opencode.ai/zen/go/v1',apiKey:'synthetic',model:'muse-spark-1.3-contributor',protocol:'responses'};
const now=new Date().toISOString(),old=new Date(Date.now()-180000).toISOString();
async function fixture(dispatch=true){
 const user=crypto.randomUUID(),id=crypto.randomUUID();
 await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now).run();
 await reserveStandardAI(db,user,id,'a'.repeat(64));
 await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,'Synthetic','Pending',?,'ai','pending')").bind(id,user,old).run();
 await ensureInferenceBudget(db,user,now.slice(0,7),'explore');
 await inferenceReservation(db,user,id,now.slice(0,7),config,10000,2000).run();
 if(dispatch){await dispatchStandardAI(db,user,id);await dispatchInference(db,user,id);}
 return {user,id};
}
const turn=f=>db.prepare('SELECT * FROM chat_turns WHERE id=? AND user_id=?').bind(f.id,f.user).first();
async function persist(f){await observeInference(db,f.user,f.id,{text:'Saved answer',inputTokens:1000,outputTokens:200});await db.prepare("UPDATE chat_turns SET assistant_text='Saved answer',input_tokens=1000,output_tokens=200 WHERE id=? AND user_id=?").bind(f.id,f.user).run();}
try{
 const saved=await fixture();await persist(saved);await reconcileChat(db,saved.user);
 assert.equal((await turn(saved)).status,'completed');assert.equal((await readStandardAI(db,saved.user,saved.id)).state,'completed');
 await reconcileChat(db,saved.user);assert.equal((await turn(saved)).assistant_text,'Saved answer');
 // A receipt commit with a lost acknowledgment must recover on a later read.
 const lost=await fixture();await persist(lost);let injected=false;
 const flaky={prepare(sql){const stmt=db.prepare(sql);if(!sql.startsWith("UPDATE standard_ai_requests SET state='completed'"))return stmt;return {bind(...args){const bound=stmt.bind(...args);return {async run(){await bound.run();if(!injected){injected=true;throw Error('Synthetic lost acknowledgment');}return {meta:{changes:0}};}};}};}};
 await assert.rejects(()=>reconcileChat(flaky,lost.user),/lost acknowledgment/);
 assert.equal((await turn(lost)).status,'pending');await reconcileChat(db,lost.user);assert.equal((await turn(lost)).status,'completed');
 // A failed action can settle its known provider usage before losing the Chat update.
 const rejected=await fixture();await observeInference(db,rejected.user,rejected.id,{text:'Invalid action',inputTokens:100,outputTokens:200});await closeStandardAIAttempt(db,rejected.user,rejected.id);await reconcileChat(db,rejected.user);assert.equal((await turn(rejected)).status,'failed');assert.equal((await readStandardAI(db,rejected.user,rejected.id)).state,'completed');
 const reserved=await fixture(false);await reconcileChat(db,reserved.user);
 assert.equal((await turn(reserved)).status,'failed');assert.equal((await readStandardAI(db,reserved.user,reserved.id)).state,'released');assert.equal((await db.prepare('SELECT status FROM inference_calls WHERE id=?').bind(reserved.id).first()).status,'released');
 const unknown=await fixture();await reconcileChat(db,unknown.user);
 assert.equal((await turn(unknown)).status,'uncertain');assert.equal((await readStandardAI(db,unknown.user,unknown.id)).state,'uncertain');assert.equal((await db.prepare('SELECT status FROM inference_calls WHERE id=?').bind(unknown.id).first()).status,'uncertain');assert.ok((await db.prepare('SELECT reserved_micros FROM inference_budgets WHERE user_id=?').bind(unknown.user).first()).reserved_micros>0);
 // A late draft and result must roll back as one transaction after timeout.
 const event=crypto.randomUUID();await assert.rejects(()=>db.batch([db.prepare("INSERT INTO activity_events(id,user_id,action,summary,created_at) VALUES(?,?,'test','Synthetic late draft',?)").bind(event,unknown.user,now),db.prepare('UPDATE chat_turns SET input_tokens=10,output_tokens=10 WHERE id=?').bind(unknown.id)]),/chat_result_closed/);assert.equal(await db.prepare('SELECT id FROM activity_events WHERE id=?').bind(event).first(),null);
 let calls=0;await sendAIChat(db,unknown.user,unknown.id,0,'Synthetic',config,async()=>{calls++;throw Error('No retry allowed');});assert.equal(calls,0);
 // Stale recovery snapshots cannot close a response committed in the meantime.
 const race=await fixture(),snapshot=await turn(race);await persist(race);await reconcileStandardChat(db,race.user,snapshot);assert.equal((await turn(race)).status,'pending');await reconcileChat(db,race.user);assert.equal((await turn(race)).status,'completed');
 const foreign=await fixture();assert.equal(await reconcileStandardChat(db,saved.user,await turn(foreign)),false);assert.equal((await readStandardAI(db,foreign.user,foreign.id)).state,'dispatched');
 const early=await fixture(false);await assert.rejects(()=>db.prepare('UPDATE chat_turns SET input_tokens=1,output_tokens=1 WHERE id=?').bind(early.id).run(),/chat_result_closed/);
 for(const table of ['billing_accounts','usage_periods','usage_operations','billing_ledger','credit_grants'])assert.equal((await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0,table);
 console.log('Standard Chat recovery passed: persisted answer, lost settlement acknowledgment, pre-dispatch cleanup, uncertain cost retention, late-result rollback, no redispatch, stale-snapshot race, foreign ownership and zero customer billing mutations.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}

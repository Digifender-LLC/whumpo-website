import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
const bundled=await build({stdin:{resolveDir:process.cwd(),contents:"export {reconcileChat,sendAIChat} from './src/ai-chat.ts';export {reconcileStandardChat} from './src/standard-ai-recovery.ts';export {reserveStandardAI,dispatchStandardAI,readStandardAI,closeStandardAIAttempt} from './src/standard-ai-usage.ts';export {ensureInferenceBudget,inferenceReservation,dispatchInference,observeInference} from './src/model-costs.ts';export {hashToken,newSessionToken} from './src/security';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';"},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const {reconcileChat,sendAIChat,reconcileStandardChat,reserveStandardAI,dispatchStandardAI,readStandardAI,closeStandardAIAttempt,ensureInferenceBudget,inferenceReservation,dispatchInference,observeInference}=m;
const database=await databaseFixture({d1:true}),db=database.db,identities=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
const config={baseURL:'https://opencode.ai/zen/go/v1',apiKey:'synthetic',model:'muse-spark-1.3-contributor',protocol:'responses'};
const now=new Date().toISOString(),old=new Date(Date.now()-180000).toISOString();
async function fixture(dispatch=true){
 const a=await workspaceFixture(db,m),user=a.account,id=crypto.randomUUID();identities.set(user,a);scopes.set(user,await a.scope());
 await reserveStandardAI(scope(user),user,id,'a'.repeat(64));
 await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,'Synthetic','Pending',?,'ai','pending')").bind(id,user,old).run();
 await ensureInferenceBudget(scope(user),user,now.slice(0,7),'explore');
 await inferenceReservation(scope(user),user,id,now.slice(0,7),config,10000,2000).run();
 if(dispatch){await dispatchStandardAI(scope(user),user,id);await dispatchInference(scope(user),user,id);}
 return {user,id};
}
const turn=f=>db.prepare('SELECT * FROM chat_turns WHERE id=? AND user_id=?').bind(f.id,f.user).first();
async function persist(f){await observeInference(scope(f.user),f.user,f.id,{text:'Saved answer',inputTokens:1000,outputTokens:200});await db.prepare("UPDATE chat_turns SET assistant_text='Saved answer',input_tokens=1000,output_tokens=200 WHERE id=? AND user_id=?").bind(f.id,f.user).run();}
try{
 const saved=await fixture();await persist(saved);await reconcileChat(scope(saved.user),saved.user);
 assert.equal((await turn(saved)).status,'completed');assert.equal((await readStandardAI(scope(saved.user),saved.user,saved.id)).state,'completed');
 await reconcileChat(scope(saved.user),saved.user);assert.equal((await turn(saved)).assistant_text,'Saved answer');
 // A receipt commit with a lost acknowledgment must recover on a later read.
 const lost=await fixture();await persist(lost);let injected=false;
 const flaky=await identities.get(lost.user).scope(interceptDatabase(db,/UPDATE standard_ai_requests SET state='completed'/,async()=>{},async()=>{if(!injected){injected=true;throw Error('Synthetic lost acknowledgment');}}));
 await assert.rejects(()=>reconcileChat(flaky,lost.user),/lost acknowledgment/);assert.equal(injected,true);
 assert.equal((await turn(lost)).status,'pending');await reconcileChat(scope(lost.user),lost.user);assert.equal((await turn(lost)).status,'completed');
 // A failed action can settle its known provider usage before losing the Chat update.
 const rejected=await fixture();await observeInference(scope(rejected.user),rejected.user,rejected.id,{text:'Invalid action',inputTokens:100,outputTokens:200});await closeStandardAIAttempt(scope(rejected.user),rejected.user,rejected.id);await reconcileChat(scope(rejected.user),rejected.user);assert.equal((await turn(rejected)).status,'failed');assert.equal((await readStandardAI(scope(rejected.user),rejected.user,rejected.id)).state,'completed');
 const reserved=await fixture(false);await reconcileChat(scope(reserved.user),reserved.user);
 assert.equal((await turn(reserved)).status,'failed');assert.equal((await readStandardAI(scope(reserved.user),reserved.user,reserved.id)).state,'released');assert.equal((await db.prepare('SELECT status FROM inference_calls WHERE id=?').bind(reserved.id).first()).status,'released');
 const unknown=await fixture();await reconcileChat(scope(unknown.user),unknown.user);
 assert.equal((await turn(unknown)).status,'uncertain');assert.equal((await readStandardAI(scope(unknown.user),unknown.user,unknown.id)).state,'uncertain');assert.equal((await db.prepare('SELECT status FROM inference_calls WHERE id=?').bind(unknown.id).first()).status,'uncertain');assert.ok((await db.prepare('SELECT reserved_micros FROM inference_budgets WHERE user_id=?').bind(unknown.user).first()).reserved_micros>0);
 for(const failed of [rejected,unknown]){const reply=(await turn(failed)).assistant_text;assert.doesNotMatch(reply,/credits/i);assert.match(reply,/Check your saved work/);}
 assert.match((await turn(unknown)).assistant_text,/not be sent twice/);
 // A late draft and result must roll back as one transaction after timeout.
 const event=crypto.randomUUID();await assert.rejects(()=>db.batch([db.prepare("INSERT INTO activity_events(id,user_id,action,summary,created_at) VALUES(?,?,'test','Synthetic late draft',?)").bind(event,unknown.user,now),db.prepare('UPDATE chat_turns SET input_tokens=10,output_tokens=10 WHERE id=?').bind(unknown.id)]),/chat_result_closed/);assert.equal(await db.prepare('SELECT id FROM activity_events WHERE id=?').bind(event).first(),null);
 let calls=0;await sendAIChat(scope(unknown.user),unknown.user,unknown.id,0,'Synthetic',config,async()=>{calls++;throw Error('No retry allowed');});assert.equal(calls,0);
 // Stale recovery snapshots cannot close a response committed in the meantime.
 const race=await fixture(),snapshot=await turn(race);await persist(race);await reconcileStandardChat(scope(race.user),race.user,snapshot);assert.equal((await turn(race)).status,'pending');await reconcileChat(scope(race.user),race.user);assert.equal((await turn(race)).status,'completed');
 const foreign=await fixture();assert.equal(await reconcileStandardChat(scope(saved.user),saved.user,await turn(foreign)),false);assert.equal((await readStandardAI(scope(foreign.user),foreign.user,foreign.id)).state,'dispatched');
 const early=await fixture(false);await assert.rejects(()=>db.prepare('UPDATE chat_turns SET input_tokens=1,output_tokens=1 WHERE id=?').bind(early.id).run(),/chat_result_closed/);
 assert.equal(await db.prepare("SELECT name FROM sqlite_schema WHERE name='usage_operations'").first(),null);
 console.log('Standard Chat recovery passed: persisted answer, lost settlement acknowledgment, pre-dispatch cleanup, uncertain cost retention, late-result rollback, no redispatch, stale-snapshot race, foreign ownership and zero customer billing mutations.');
}finally{await database.close();}

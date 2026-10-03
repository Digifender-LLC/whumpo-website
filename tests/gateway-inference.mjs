import {gatewayEvidenceReport} from '../tools/report-gateway.mjs';
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
const built=await build({stdin:{contents:"export * from './src/gateway-provider-receipt';export * from './src/gateway-inference';export * from './src/gateway-spend';export * from './src/inference-routing';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {captureGatewayReceipt,runGatewayInference,reserveGatewaySpend,releaseGatewaySpend,planInferenceRoute}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const scenario=JSON.parse(await readFile('tests/fixtures/inference-routing-scenario.json','utf8'));
const store=await databaseFixture({d1:true}),db=store.db;
try{
 const owner=crypto.randomUUID(),other=crypto.randomUUID(),task=crypto.randomUUID();
 for(const user of [owner,other])await db.prepare("INSERT INTO users(id,email,created_at) VALUES(?,?,?)").bind(user,user+'@example.test',new Date().toISOString()).run();
 const now=Date.now(),candidate={...scenario.candidates[0],model:'@cf/example/model',rateValidFrom:now-1,rateValidUntil:now+3600000,benchmark:{...scenario.candidates[0].benchmark,validUntil:now+3600000}};
 const decision=planInferenceRoute([candidate],{...scenario.request,ownerId:owner,taskId:task,now});
 const buckets={task:crypto.randomUUID(),account:crypto.randomUUID(),platform:crypto.randomUUID()};
 for(const [scope,id] of Object.entries(buckets))await db.prepare('INSERT INTO gateway_spend_buckets(id,scope,user_id,task_id,limit_micros) VALUES(?,?,?,?,1000000)').bind(id,scope,scope==='platform'?null:owner,scope==='task'?task:null).run();
 const reserve=async()=>{const id=crypto.randomUUID();await reserveGatewaySpend(db,owner,id,decision,buckets);return id;};
 const config={accountId:'a'.repeat(32),gatewayId:'whumpo-test',apiToken:'synthetic-private-token',model:candidate.model,protocol:'chat',maxOutputTokens:1000};
 const messages=[{role:'user',content:'Create a synthetic bakery draft.'}],count=()=>100;
 let calls=0;const response=(input=100,output=200)=>Response.json({model:candidate.model,choices:[{finish_reason:'stop',message:{role:'assistant',content:'A private bakery draft.'}}],usage:{prompt_tokens:input,completion_tokens:output}},{headers:{'cf-aig-event-id':'synthetic-event-123','cf-aig-log-id':'synthetic-log-456'}});
 const fetcher=async()=>{calls++;return response();};
 const read=async id=>db.prepare('SELECT a.*,r.request_hash,r.result_json FROM gateway_spend_attempts a LEFT JOIN gateway_inference_requests r ON r.attempt_id=a.id WHERE a.id=?').bind(id).first();
 const id=await reserve();
 const concurrent=await Promise.all([runGatewayInference(db,owner,id,config,messages,count,fetcher),runGatewayInference(db,owner,id,config,messages,count,fetcher)]);
 assert.equal(calls,1);assert.equal(concurrent.filter(r=>r.status==='settled'&&!r.replayed).length,1);
 const repeat=await runGatewayInference(db,owner,id,config,messages,count,fetcher);assert.equal(repeat.replayed,true);assert.equal(repeat.result.text,'A private bakery draft.');assert.equal(repeat.costs.providerMicros,400);assert.equal(calls,1);
 for(const [who,settings,input,measure] of [[other,config,messages,count],[owner,{...config,model:'@cf/example/other'},messages,count],[owner,{...config,gatewayId:'other'},messages,count],[owner,config,[{role:'user',content:'Different request'}],count],[owner,config,messages,()=>1001]])await assert.rejects(runGatewayInference(db,who,id,settings,input,measure,fetcher));
 assert.equal(calls,1);
 const evidence=await db.prepare('SELECT * FROM gateway_provider_receipts WHERE attempt_id=?').bind(id).first();
 assert.equal(evidence.event_id,'synthetic-event-123');assert.equal(evidence.log_id,'synthetic-log-456');assert.equal(evidence.http_status,200);assert.equal(evidence.gateway_id,config.gatewayId);
 await captureGatewayReceipt(db,owner,id,config,response()); // exact readback is idempotent after settlement
 await assert.rejects(captureGatewayReceipt(db,other,id,config,response()));
 await assert.rejects(captureGatewayReceipt(db,owner,id,{...config,gatewayId:'other'},response()));
 await assert.rejects(db.prepare("UPDATE gateway_provider_receipts SET event_id='changed' WHERE attempt_id=?").bind(id).run());
 await assert.rejects(db.prepare('DELETE FROM gateway_provider_receipts WHERE attempt_id=?').bind(id).run());
 const stored=await read(id);assert.ok(!JSON.stringify(stored).includes(config.apiToken));assert.ok(!JSON.stringify(stored).includes(messages[0].content));
 await assert.rejects(db.prepare('UPDATE gateway_inference_requests SET result_json=? WHERE attempt_id=?').bind(JSON.stringify({text:'changed',inputTokens:100,outputTokens:200}),id).run());
 await assert.rejects(db.prepare('DELETE FROM gateway_inference_requests WHERE attempt_id=?').bind(id).run());
 // Inject one database response loss at an exact statement, preserving actual D1 effects.
 function faultDB(pattern,after){let armed=true;return {prepare(sql){const original=db.prepare(sql);function wrap(statement){return new Proxy(statement,{get(target,key){if(key==='bind')return (...args)=>wrap(target.bind(...args));if(key==='run')return async()=>{if(armed&&sql.includes(pattern)){armed=false;if(after)await target.run();throw Error('Synthetic lost database response');}return target.run();};const value=target[key];return typeof value==='function'?value.bind(target):value;}});}return wrap(original);}};}
 for(const [pattern,after] of [['INSERT INTO gateway_provider_receipts',true],['SET result_json=',true],["SET status='settled'",false],["SET status='settled'",true]]){
  const attempt=await reserve(),before=calls;
  assert.equal((await runGatewayInference(faultDB(pattern,after),owner,attempt,config,messages,count,fetcher)).status,pattern==='INSERT INTO gateway_provider_receipts'?'settled':'uncertain');
  assert.equal((await runGatewayInference(db,owner,attempt,config,messages,count,fetcher)).status,'settled');assert.equal(calls,before+1);
 }
 const lostInsert=await reserve(),beforeInsert=calls;
 assert.equal((await runGatewayInference(faultDB('INSERT INTO gateway_inference_requests',true),owner,lostInsert,config,messages,count,fetcher)).status,'settled');assert.equal(calls,beforeInsert+1);
 const changedRace=await reserve(),beforeRace=calls;
 const competitors=await Promise.allSettled([runGatewayInference(db,owner,changedRace,config,messages,count,fetcher),runGatewayInference(db,owner,changedRace,config,[{role:'user',content:'A different synthetic project.'}],count,fetcher)]);
 assert.equal(competitors.filter(result=>result.status==='fulfilled').length,1);assert.equal(calls,beforeRace+1);
 const lostResult=await reserve(),beforeResult=calls;
 assert.equal((await runGatewayInference(faultDB('SET result_json=',false),owner,lostResult,config,messages,count,fetcher)).status,'uncertain');
 assert.equal((await runGatewayInference(db,owner,lostResult,config,messages,count,fetcher)).status,'uncertain');assert.equal(calls,beforeResult+1);assert.equal((await read(lostResult)).result_json,null);
 const claim=await reserve(),beforeClaim=calls;
 await assert.rejects(runGatewayInference(faultDB("SET status='dispatched'",true),owner,claim,config,messages,count,fetcher));
 assert.equal((await runGatewayInference(db,owner,claim,config,messages,count,fetcher)).status,'dispatched');assert.equal(calls,beforeClaim);assert.equal((await read(claim)).status,'dispatched');
 const failed=await reserve();let failedCalls=0;
 const failure=async()=>{failedCalls++;throw new DOMException('synthetic private upstream error','TimeoutError');};
 assert.equal((await runGatewayInference(db,owner,failed,config,messages,count,failure)).status,'uncertain');
 assert.equal((await runGatewayInference(db,owner,failed,config,messages,count,failure)).status,'uncertain');assert.equal(failedCalls,1);assert.equal((await read(failed)).result_json,null);
 const over=await reserve();assert.equal((await runGatewayInference(db,owner,over,config,messages,count,async()=>response(1001,200))).status,'uncertain');assert.equal((await read(over)).provider_actual,null);await assert.rejects(runGatewayInference(db,owner,over,config,messages,count,fetcher));
 const invalid=await reserve();await assert.rejects(runGatewayInference(db,owner,invalid,config,messages,()=>NaN,fetcher));assert.equal((await read(invalid)).request_hash,null);
 const released=await reserve();await releaseGatewaySpend(db,owner,released);await assert.rejects(runGatewayInference(db,owner,released,config,messages,count,fetcher));
 const lostEvidence=await reserve();let bodyCanceled=false,evidenceCalls=0;
 assert.equal((await runGatewayInference(faultDB('INSERT INTO gateway_provider_receipts',false),owner,lostEvidence,config,messages,count,async()=>{evidenceCalls++;return new Response(new ReadableStream({cancel(){bodyCanceled=true;}}),{headers:{'cf-aig-event-id':'synthetic-unrecorded'}});})).status,'uncertain');
 assert.equal(bodyCanceled,true);assert.equal((await runGatewayInference(db,owner,lostEvidence,config,messages,count,fetcher)).status,'uncertain');assert.equal(evidenceCalls,1);
 const rejection=await reserve();let rejectedCalls=0;
 assert.equal((await runGatewayInference(db,owner,rejection,config,messages,count,async()=>{rejectedCalls++;return new Response('private raw body',{status:500,headers:{'cf-aig-event-id':config.apiToken,'cf-aig-log-id':'x'.repeat(129)}});})).status,'uncertain');
 assert.equal((await runGatewayInference(db,owner,rejection,config,messages,count,fetcher)).status,'uncertain');assert.equal(rejectedCalls,1);
 const rejectedEvidence=await db.prepare('SELECT * FROM gateway_provider_receipts WHERE attempt_id=?').bind(rejection).first();assert.equal(rejectedEvidence.http_status,500);assert.equal(rejectedEvidence.event_id,null);assert.equal(rejectedEvidence.log_id,null);assert.equal((await read(rejection)).result_json,null);
 assert.equal(await db.prepare('SELECT attempt_id FROM gateway_provider_receipts WHERE attempt_id=?').bind(failed).first(),null,'Timeout without headers must not invent provider evidence');
 const balance=await db.prepare('SELECT held_micros,spent_micros FROM gateway_spend_buckets WHERE id=?').bind(buckets.account).first();
 assert.deepEqual(balance,{held_micros:7*2100,spent_micros:7*400}); // claim, timeout, overrun, unused invalid input, response lost before persistence
 const report=await gatewayEvidenceReport(db,2);assert.equal(report.totals.unresolved,6);assert.equal(report.totals.providerHeldMicros,6*2100);assert.equal(report.totals.customerHeldMicros,0);assert.equal(report.attempts.length,2);assert.equal(report.truncated,true);
 const full=await gatewayEvidenceReport(db,100);assert.equal(full.truncated,false);assert.ok(full.attempts.some(row=>row.httpStatus===500));assert.ok(full.attempts.some(row=>row.httpStatus===null));
 for(const secret of [config.apiToken,messages[0].content,'A private bakery draft.',owner+'@example.test'])assert.ok(!JSON.stringify(full).includes(secret));
 await assert.rejects(gatewayEvidenceReport(db,101));assert.deepEqual(await db.prepare('SELECT held_micros,spent_micros FROM gateway_spend_buckets WHERE id=?').bind(buckets.account).first(),balance);
 console.log('Actual D1 dispatch passed: one concurrent call, immutable request/result, owner/route isolation, replayed answers, database-loss recovery, unknown holds and overrun refusal. No real provider calls.');
}finally{await store.close();}

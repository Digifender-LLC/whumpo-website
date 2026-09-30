import assert from 'node:assert/strict';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {build} from 'esbuild';import wrangler from 'wrangler';
const built=await build({stdin:{contents:"export * from './src/gateway-inference';export * from './src/gateway-spend';export * from './src/inference-routing';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {runGatewayInference,reserveGatewaySpend,releaseGatewaySpend,planInferenceRoute}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const scenario=JSON.parse(await readFile('tests/fixtures/inference-routing-scenario.json','utf8'));
const dir=await mkdtemp('/tmp/whumpo-gateway-inference-');let proxy;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 const owner=crypto.randomUUID(),other=crypto.randomUUID(),task=crypto.randomUUID();
 for(const user of [owner,other])await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,'test','test',?)").bind(user,user+'@example.test',new Date().toISOString()).run();
 const now=Date.now(),candidate={...scenario.candidates[0],model:'@cf/example/model',rateValidFrom:now-1,rateValidUntil:now+3600000,benchmark:{...scenario.candidates[0].benchmark,validUntil:now+3600000}};
 const decision=planInferenceRoute([candidate],{...scenario.request,ownerId:owner,taskId:task,now});
 const buckets={task:crypto.randomUUID(),account:crypto.randomUUID(),platform:crypto.randomUUID()};
 for(const [scope,id] of Object.entries(buckets))await db.prepare('INSERT INTO gateway_spend_buckets(id,scope,user_id,task_id,limit_micros) VALUES(?,?,?,?,1000000)').bind(id,scope,scope==='platform'?null:owner,scope==='task'?task:null).run();
 const reserve=async()=>{const id=crypto.randomUUID();await reserveGatewaySpend(db,owner,id,decision,buckets);return id;};
 const config={accountId:'a'.repeat(32),gatewayId:'whumpo-test',apiToken:'synthetic-private-token',model:candidate.model,protocol:'chat',maxOutputTokens:1000};
 const messages=[{role:'user',content:'Create a synthetic bakery draft.'}],count=()=>100;
 let calls=0;const response=(input=100,output=200)=>Response.json({model:candidate.model,choices:[{finish_reason:'stop',message:{role:'assistant',content:'A private bakery draft.'}}],usage:{prompt_tokens:input,completion_tokens:output}});
 const fetcher=async()=>{calls++;return response();};
 const read=async id=>db.prepare('SELECT a.*,r.request_hash,r.result_json FROM gateway_spend_attempts a LEFT JOIN gateway_inference_requests r ON r.attempt_id=a.id WHERE a.id=?').bind(id).first();
 const id=await reserve();
 const concurrent=await Promise.all([runGatewayInference(db,owner,id,config,messages,count,fetcher),runGatewayInference(db,owner,id,config,messages,count,fetcher)]);
 assert.equal(calls,1);assert.equal(concurrent.filter(r=>r.status==='settled'&&!r.replayed).length,1);
 const repeat=await runGatewayInference(db,owner,id,config,messages,count,fetcher);assert.equal(repeat.replayed,true);assert.equal(repeat.result.text,'A private bakery draft.');assert.equal(repeat.costs.providerMicros,400);assert.equal(calls,1);
 for(const [who,settings,input,measure] of [[other,config,messages,count],[owner,{...config,model:'@cf/example/other'},messages,count],[owner,{...config,gatewayId:'other'},messages,count],[owner,config,[{role:'user',content:'Different request'}],count],[owner,config,messages,()=>1001]])await assert.rejects(runGatewayInference(db,who,id,settings,input,measure,fetcher));
 assert.equal(calls,1);
 const stored=await read(id);assert.ok(!JSON.stringify(stored).includes(config.apiToken));assert.ok(!JSON.stringify(stored).includes(messages[0].content));
 await assert.rejects(db.prepare('UPDATE gateway_inference_requests SET result_json=? WHERE attempt_id=?').bind(JSON.stringify({text:'changed',inputTokens:100,outputTokens:200}),id).run());
 await assert.rejects(db.prepare('DELETE FROM gateway_inference_requests WHERE attempt_id=?').bind(id).run());
 // Inject one database response loss at an exact statement, preserving actual D1 effects.
 function faultDB(pattern,after){let armed=true;return {prepare(sql){const original=db.prepare(sql);function wrap(statement){return new Proxy(statement,{get(target,key){if(key==='bind')return (...args)=>wrap(target.bind(...args));if(key==='run')return async()=>{if(armed&&sql.includes(pattern)){armed=false;if(after)await target.run();throw Error('Synthetic lost database response');}return target.run();};const value=target[key];return typeof value==='function'?value.bind(target):value;}});}return wrap(original);}};}
 for(const [pattern,after] of [['SET result_json=',true],["SET status='settled'",false],["SET status='settled'",true]]){
  const attempt=await reserve(),before=calls;
  assert.equal((await runGatewayInference(faultDB(pattern,after),owner,attempt,config,messages,count,fetcher)).status,'uncertain');
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
 const balance=await db.prepare('SELECT held_micros,spent_micros FROM gateway_spend_buckets WHERE id=?').bind(buckets.account).first();
 assert.deepEqual(balance,{held_micros:5*2100,spent_micros:6*400}); // claim, timeout, overrun, unused invalid input, response lost before persistence
 console.log('Actual D1 dispatch passed: one concurrent call, immutable request/result, owner/route isolation, replayed answers, database-loss recovery, unknown holds and overrun refusal. No real provider calls.');
}finally{await proxy?.dispose();await rm(dir,{recursive:true,force:true});}

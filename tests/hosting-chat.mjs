import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {reviewHosting,confirmHosting,disconnectHosting,refreshHosting}=await module('src/domain-hosting.ts'),{sendChat,readChat}=await module('src/chat.ts'),host=(await module('src/site-host.ts')).default;
const {sendAIChat}=await module('src/ai-chat.ts'),{getBilling}=await module('src/billing.ts');
const dir=await mkdtemp('/tmp/whumpo-hosting-chat-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
const config={token:'synthetic-token',zone:'a'.repeat(32),target:'hosting.whumpo.site'};
async function account(){const id=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,'test',?)").bind(id,id+'@example.com','00',new Date().toISOString()).run();return id;}
async function chat(user,content){const id=crypto.randomUUID(),state=await readChat(db,user);assert.equal((await sendChat(db,user,{id,content,revision:state.state.revision})).status,200);return id;}
let writes=0,deletes=0,mode='ok',proof=true,cname=true,remoteStatus='active',sslStatus='active',existing=0,total=0;
let remoteId=crypto.randomUUID();let claim,username,reviewId;
const transport=async(input,init)=>{const u=new URL(input);assert.equal(init.redirect,'manual');assert.ok(init.signal);
 if(u.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{name:u.searchParams.get('name')+'.',type:u.searchParams.get('type')==='TXT'?16:5,data:u.searchParams.get('type')==='TXT'?JSON.stringify(proof?'whumpo-verification='+claim.token:'wrong'):(cname?config.target+'.':'elsewhere.example.com.')}]});
 assert.equal(u.origin,'https://api.cloudflare.com');assert.equal(init.headers.authorization,'Bearer synthetic-token');
 if(init.method==='POST'){writes++;remoteId=crypto.randomUUID();assert.deepEqual(JSON.parse(init.body),{hostname:claim.hostname,ssl:{method:'http',type:'dv'}});if(mode==='timeout')throw Error('timeout');if(mode==='disconnect')await disconnectHosting(db,username,reviewId,undefined,transport);return Response.json({success:true,result:{id:remoteId,hostname:claim.hostname,status:remoteStatus,ssl:{status:sslStatus}}});}
 if(init.method==='DELETE'){deletes++;if(mode==='deletefail')return new Response('',{status:503});return Response.json({success:true,result:{id:remoteId}});}
 if(u.pathname.endsWith(remoteId)){if(mode==='mismatch')return Response.json({success:true,result:{id:remoteId,hostname:'foreign.example.com',status:'active',ssl:{status:'active'}}});return Response.json({success:true,result:{id:remoteId,hostname:claim.hostname,status:remoteStatus,ssl:{status:sslStatus}}});}
 return Response.json({success:true,result:existing?[{}]:[],result_info:{total_count:u.searchParams.has('hostname')?existing:total}});
};
try{
 const user=username=await account(),other=await account();await chat(user,'A garden website');const project=await chat(user,'Garden');const claimId=await chat(user,'/domain www.example.com '+project);claim=await db.prepare('SELECT * FROM domain_claims WHERE id=?').bind(claimId).first();
 const options={hosting:config,hostingTransport:transport};
 async function message(content,id=crypto.randomUUID(),revision,database=db,who=user){const state=await readChat(db,who);const result=await sendChat(database,who,{id,content,revision:revision??state.state.revision},undefined,options);return {result,id,text:(await readChat(db,who)).turns.at(-1)?.assistant_text};}
 let r=await message('/review-hosting '+claimId);reviewId=r.id;assert.equal(r.result.status,200);assert.match(r.text,/Confirming requests a hostname and TLS certificate/);assert.equal(writes,0);
 await message('/check-hosting '+reviewId);assert.equal(writes,0);assert.equal(deletes,0);
 assert.match((await message('/hosting')).text,new RegExp(reviewId));
 assert.match((await message('/hosting',crypto.randomUUID(),undefined,db,other)).text,/No hosting connections/);
 assert.match((await message('/check-hosting '+reviewId,crypto.randomUUID(),undefined,db,other)).text,/not found/);
 assert.equal((await message('/confirm-hosting '+reviewId,crypto.randomUUID(),0)).result.status,409);assert.equal(writes,0);
 const state=await readChat(db,user),confirmId=crypto.randomUUID();
 const results=await Promise.all([message('/confirm-hosting '+reviewId,confirmId,state.state.revision),message('/confirm-hosting '+reviewId,confirmId,state.state.revision)]);assert.ok(results.every(r=>r.result.status===200));assert.equal(writes,1);
 await message('/confirm-hosting '+reviewId,confirmId,state.state.revision);assert.equal(writes,1);
 assert.match((await message('/check-hosting '+reviewId)).text,/connected/);assert.ok((await db.prepare('SELECT serve_until FROM domain_connections WHERE id=?').bind(reviewId).first()).serve_until);
 mode='deletefail';assert.match((await message('/disconnect-hosting '+reviewId)).text,/Local routing is disabled/);assert.equal(deletes,1);assert.equal((await db.prepare('SELECT serve_until FROM domain_connections WHERE id=?').bind(reviewId).first()).serve_until,null);
 mode='ok';await message('/check-hosting '+reviewId);assert.equal(deletes,1);await refreshHosting(db,user,reviewId,config,transport,false);assert.equal(deletes,1);
 assert.match((await message('/disconnect-hosting '+reviewId)).text,/disconnected/);assert.equal(deletes,2);
 // Cancel an unconfirmed review without any provider mutation.
 const cancel=await message('/review-hosting '+claimId);await message('/disconnect-hosting '+cancel.id);assert.equal(writes,1);assert.equal(deletes,2);
 assert.equal((await getBilling(db,user)).standardAI.creditCharge,0);
 // A lost chat-claim acknowledgement leaves a durable provisional receipt, but performs no hosting work.
 const lost=crypto.randomUUID(),lossy=new Proxy(db,{get(t,k){if(k==='batch')return async statements=>{await t.batch(statements);throw Error('Lost claim acknowledgement');};const v=t[k];return typeof v==='function'?v.bind(t):v;}});
 await message('/review-hosting '+claimId,lost,undefined,lossy);assert.equal(await db.prepare('SELECT id FROM domain_connections WHERE id=?').bind(lost).first(),null);assert.match((await readChat(db,user)).turns.at(-1).assistant_text,/not yet been saved/);
 // Model actions cannot dispatch a provider write, accept extra authority, or expose the hosting token.
 const ai={baseURL:'https://model.invalid/v1',apiKey:'synthetic',model:'fixture',protocol:'responses'};
 for(const action of [{kind:'hosting',operation:'list'},{kind:'hosting',operation:'review',claimId},{kind:'hosting',operation:'confirm',connectionId:reviewId},{kind:'hosting',operation:'disconnect',connectionId:reviewId},{kind:'hosting',operation:'check',connectionId:reviewId},{kind:'hosting',operation:'review',claimId,target:'evil.example'}]){
  const state=await readChat(db,user),id=crypto.randomUUID(),allowed=['list','review'].includes(action.operation)&&!action.target;
  await sendAIChat(db,user,id,state.state.revision,'Manage hosting for my domain',ai,async(url,init)=>{assert.ok(!init.body.includes('synthetic-token'));return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'I activated hosting.',action})}]}],usage:{input_tokens:100,output_tokens:100}});},options);
  const turn=(await readChat(db,user)).turns.at(-1);assert.equal(turn.status,allowed?'completed':'failed');assert.ok(!turn.assistant_text.includes('I activated hosting.'));assert.equal(writes,1);assert.equal(deletes,2);
 }
 const disabledState=await readChat(db,other);await sendChat(db,other,{id:crypto.randomUUID(),revision:disabledState.state.revision,content:'/review-hosting '+claimId});assert.match((await readChat(db,other)).turns.at(-1).assistant_text,/awaiting platform configuration/);
 console.log('Hosting chat passed: review/confirm/check/disconnect lifecycle, explicit authority, owner isolation, concurrency/replay, stale revision, free guided usage, lost chat acknowledgement, AI action allowlist and no credential leakage.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}

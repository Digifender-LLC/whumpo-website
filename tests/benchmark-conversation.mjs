import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
import {recordFixtureBenchmark} from '../tools/benchmark-evidence.mjs';
const bundle=await build({stdin:{contents:"export {sendAIChat} from './src/ai-chat';export {readChat} from './src/chat';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {sendAIChat,readChat}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-benchmark-conversation-');let proxy;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 let calls=0;
 const config={baseURL:'https://opencode.ai/zen/go/v1',apiKey:'synthetic',model:'muse-spark-1.3-contributor',protocol:'responses'};
 const cases=[
  {prompt:'Make a tool for my business.',reply:'What is the main job you want this tool to help you do?'},
  {prompt:'Run an always-on FFmpeg video encoder for my uploaded home videos.',reply:'Whumpo cannot run an always-on FFmpeg process yet. I can help plan that workflow, but I have not deployed a video server.'}
 ];
 for(const fixture of cases){
  const user=crypto.randomUUID(),turn=crypto.randomUUID();
  await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',new Date().toISOString()).run();
  const {state}=await readChat(db,user);
  const provider=async()=>{calls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:fixture.reply,action:null})}]}],usage:{input_tokens:200,output_tokens:80}});};
  const result=await sendAIChat(db,user,turn,state.revision,fixture.prompt,config,provider);assert.equal(result.status,200);
  const saved=(await readChat(db,user)).turns.at(-1);assert.equal(saved.status,'completed');assert.equal(saved.assistant_text,fixture.reply);
  const before=calls;await sendAIChat(db,user,turn,state.revision,fixture.prompt,config,provider);assert.equal(calls,before);
 }
 for(const table of ['projects','site_versions','backend_versions','publications','app_activation_reviews'])assert.equal((await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0);
 await recordFixtureBenchmark(db,'conversation',{transportCalls:calls,runtimeCalls:0});
 console.log('Conversation fixture passed: saved clarification and unsupported-work replies, no fabricated artifacts/activation, exact replay. Replies are scripted; real-model judgment is unmeasured.');
}finally{await proxy?.dispose();await rm(dir,{recursive:true,force:true});}

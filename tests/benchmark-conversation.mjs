import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {recordFixtureBenchmark} from '../tools/benchmark-evidence.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,scopes=new Map(),scope=user=>scopes.get(user);
async function accountAuthority(user=crypto.randomUUID()){const authority=await workspaceFixture(db,m,user);scopes.set(user,await authority.scope());return authority;}
const {sendAIChat,readChat}=m;
try{
 let calls=0;
 const config={baseURL:'https://opencode.ai/zen/go/v1',apiKey:'synthetic',model:'muse-spark-1.3-contributor',protocol:'responses'};
 const cases=[
  {prompt:'Make a tool for my business.',reply:'What is the main job you want this tool to help you do?'},
  {prompt:'Run an always-on FFmpeg video encoder for my uploaded home videos.',reply:'Whumpo cannot run an always-on FFmpeg process yet. I can help plan that workflow, but I have not deployed a video server.'}
 ];
 for(const fixture of cases){
  const user=crypto.randomUUID(),turn=crypto.randomUUID();
  await accountAuthority(user);
  const {state}=await readChat(scope(user),user);
  const provider=async()=>{calls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:fixture.reply,action:null})}]}],usage:{input_tokens:200,output_tokens:80}});};
  const result=await sendAIChat(scope(user),user,turn,state.revision,fixture.prompt,config,provider);assert.equal(result.status,200);
  const saved=(await readChat(scope(user),user)).turns.at(-1);assert.equal(saved.status,'completed');assert.equal(saved.assistant_text,fixture.reply);
  const before=calls;await sendAIChat(scope(user),user,turn,state.revision,fixture.prompt,config,provider);assert.equal(calls,before);
 }
 for(const table of ['projects','site_versions','backend_versions','publications','app_activation_reviews'])assert.equal((await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0);
 await recordFixtureBenchmark(db,'conversation',{transportCalls:calls,runtimeCalls:0});
 console.log('Conversation fixture passed: saved clarification and unsupported-work replies, no fabricated artifacts/activation, exact replay. Replies are scripted; real-model judgment is unmeasured.');
}finally{await store.close();}

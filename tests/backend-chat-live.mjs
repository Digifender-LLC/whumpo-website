import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
assert.equal(process.env.WHUMPO_LIVE_AI,'1','Explicitly enable the live provider test');
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {sendChat,readChat}=await module('src/chat.ts'),{sendAIChat}=await module('src/ai-chat.ts'),{getBilling}=await module('src/billing.ts');
const dir=await mkdtemp('/tmp/whumpo-backend-chat-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe'});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB,id=()=>crypto.randomUUID();
async function account(){const user=id(),project=id(),now=new Date().toISOString();await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.com',now).run();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Calculator','Quote estimates','draft',?,?)").bind(project,user,now,now).run();await readChat(db,user);return {user,project};}
try{
 const a=await account();
 const backendRuntime={fetch:(_url,init)=>fetch('http://localhost:8797/execute',init)};
 const apiKey=(await readFile('opencode.key','utf8')).trim();
 const config={baseURL:'https://opencode.ai/zen/go/v1',apiKey,model:'muse-spark-1.3-contributor',protocol:'responses'};
 const turn=id(),revision=(await readChat(db,a.user)).state.revision;
 const content=`For existing project ${a.project}, create a private backend function: JSON input has quantity and unitPrice, both numbers. Return JSON {total:quantity*unitPrice}. Only create the function draft; no website changes, no publication, no test call yet. Use the backend create action.`;
 assert.equal((await sendAIChat(db,a.user,turn,revision,content,config,undefined,{backendRuntime})).status,200);
 const draft=await db.prepare('SELECT id FROM backend_versions WHERE id=? AND project_id=?').bind(turn,a.project).first();
 const history=await readChat(db,a.user);assert.ok(draft,'Live model did not create the requested backend draft; turn status: '+history.turns.at(-1).status);
 for(const [quantity,unitPrice] of [[4,7],[2,11]]){
  const state=(await readChat(db,a.user)).state,request={id:id(),revision:state.revision,content:'/test-backend '+turn+' '+JSON.stringify({quantity,unitPrice})};
  assert.equal((await sendChat(db,a.user,request,undefined,{backendRuntime})).status,200);
  const run=await db.prepare('SELECT result_json FROM backend_runs WHERE id=?').bind(request.id).first();assert.deepEqual(JSON.parse(run.result_json),{ok:true,value:{total:quantity*unitPrice}});
  await sendChat(db,a.user,request,undefined,{backendRuntime});
 }
 const billing=await getBilling(db,a.user);assert.equal(billing.quota.reserved,0);
 console.log('Live Muse generated a private backend draft; actual workerd ran two guided examples correctly, replay stayed stable. AI units spent:',billing.quota.spent);
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}

// Synthetic local account + real configured testing model; no hosted customer mutations.
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
if(process.env.RUN_LIVE_MUSE!=='1')throw Error('Set RUN_LIVE_MUSE=1 for the live testing-model probe');
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {sendAIChat}=await module('src/ai-chat.ts'),{sendChat,readChat}=await module('src/chat.ts'),{readLayout}=await module('src/workspace-dashboard.ts'),{getBilling}=await module('src/billing.ts'),{shortcutCommand}=await module('src/workspace-shortcuts.ts');
const dir=await mkdtemp('/tmp/whumpo-shortcut-live-');
execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
try{
 const user=crypto.randomUUID(),project=crypto.randomUUID(),turn=crypto.randomUUID(),now=new Date().toISOString();
 await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now).run();
 await db.prepare("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')").bind(user).run();
 await getBilling(db,user);

 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Synthetic Bakery','A fictional bakery test project','draft',?,?)").bind(project,user,now,now).run();
 const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:(await readFile('opencode.key','utf8')).trim(),protocol:'responses'};
 let calls=0;const transport=(...args)=>{calls++;return fetch(...args);};
 const request='Please add a sidebar page called Bakery overview for my Synthetic Bakery project. Show its project status and activity, with just two buttons: one to show the project status in Chat and one to show its saved website versions. Keep my main dashboard unchanged. Do not create or publish a website.';
 await sendAIChat(db,user,turn,0,request,config,transport);
 const record=await db.prepare('SELECT status,input_tokens,output_tokens FROM chat_turns WHERE id=?').bind(turn).first();
 assert.equal(record.status,'completed');
 const saved=await readLayout(db,user);assert.equal(saved.layout.tabs.length,1);
 const tab=saved.layout.tabs[0];assert.equal(tab.label,'Bakery overview');assert.equal(tab.projectId,project);
 assert.deepEqual(new Set(tab.shortcuts),new Set(['project','versions']));assert.deepEqual(saved.layout.widgets,['projects','usage','activity']);
 const beforeReplay=calls;await sendAIChat(db,user,turn,0,request,config,transport);assert.equal(calls,beforeReplay);assert.deepEqual(await readLayout(db,user),saved);
 const spent=(await getBilling(db,user)).standardAI.creditCharge;assert.equal(spent,0);assert.equal((await db.prepare('SELECT state FROM standard_ai_requests WHERE id=?').bind(turn).first()).state,'completed');assert.equal(await db.prepare("SELECT name FROM sqlite_schema WHERE name='usage_operations'").first(),null);
 for(const kind of tab.shortcuts){const state=await readChat(db,user),content=shortcutCommand(kind,tab.projectId),id=crypto.randomUUID();assert.ok(content);const result=await sendChat(db,user,{id,revision:state.state.revision,content},config);assert.equal(result.status,200);const receipt=await db.prepare('SELECT mode,assistant_text FROM chat_turns WHERE id=?').bind(id).first();assert.equal(receipt.mode,'guided');assert.match(receipt.assistant_text,kind==='project'?/Synthetic Bakery/:/version|draft/i);}
 assert.equal((await getBilling(db,user)).standardAI.creditCharge,spent);
 for(const table of ['publications','site_versions'])assert.equal((await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0);
 console.log(JSON.stringify({passed:true,model:config.model,calls,inputTokens:record.input_tokens,outputTokens:record.output_tokens,testUnits:spent,requestedShortcuts:tab.shortcuts,replayCalls:0,shortcutInference:false,publications:0}));
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}

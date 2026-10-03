// Explicit opt-in provider probe. Current schema, synthetic local owner, private work only.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
if(process.env.RUN_LIVE_MUSE!=='1')throw Error('Set RUN_LIVE_MUSE=1 for the live testing-model probe');
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db;
const {sendAIChat,sendChat,readChat,readLayout,getBilling,shortcutCommand}=m;
try{
 const user=crypto.randomUUID(),project=crypto.randomUUID(),turn=crypto.randomUUID(),now=new Date().toISOString();
 const authority=await workspaceFixture(db,m,user),owned=await authority.scope();
 await db.prepare("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')").bind(user).run();
 await getBilling(owned,user);
 await db.prepare("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.editing','prepare','private-test-acceptance','synthetic layout fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)").bind(crypto.randomUUID(),user).run();

 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Synthetic Bakery','A fictional bakery test project','draft',?,?)").bind(project,user,now,now).run();
 const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:(await readFile('opencode.key','utf8')).trim(),protocol:'responses'};
 let calls=0;const transport=(...args)=>{calls++;return fetch(...args);};
 const request='Please add a sidebar page called Bakery overview for my Synthetic Bakery project. Show its project status and activity, with just two buttons: one to show the project status in Chat and one to show its saved website versions. Keep my main dashboard unchanged. Do not create or publish a website.';
 await sendAIChat(owned,user,turn,0,request,config,transport);
 const record=await db.prepare('SELECT status,input_tokens,output_tokens FROM chat_turns WHERE id=?').bind(turn).first();
 assert.equal(record.status,'completed');
 const saved=await readLayout(owned,user);assert.equal(saved.layout.tabs.length,1);
 const tab=saved.layout.tabs[0];assert.equal(tab.label,'Bakery overview');assert.equal(tab.view.projectId,project);
 assert.deepEqual(new Set(tab.view.shortcuts),new Set(['project','versions']));assert.deepEqual(saved.layout.dashboard.widgets,['projects','usage','activity']);
 const beforeReplay=calls;await sendAIChat(owned,user,turn,0,request,config,transport);assert.equal(calls,beforeReplay);assert.deepEqual(await readLayout(owned,user),saved);
 const spent=(await getBilling(owned,user)).standardAI.creditCharge;assert.equal(spent,0);assert.equal((await db.prepare('SELECT state FROM standard_ai_requests WHERE id=?').bind(turn).first()).state,'completed');assert.equal(await db.prepare("SELECT name FROM sqlite_schema WHERE name='usage_operations'").first(),null);
 for(const kind of tab.view.shortcuts){const state=await readChat(owned,user),content=shortcutCommand(kind,tab.view.projectId),id=crypto.randomUUID();assert.ok(content);const result=await sendChat(owned,user,{id,revision:state.state.revision,content},config);assert.equal(result.status,200);const receipt=await db.prepare('SELECT mode,assistant_text FROM chat_turns WHERE id=?').bind(id).first();assert.equal(receipt.mode,'guided');assert.match(receipt.assistant_text,kind==='project'?/Synthetic Bakery/:/version|draft/i);}
 assert.equal((await getBilling(owned,user)).standardAI.creditCharge,spent);
 for(const table of ['publications','site_versions'])assert.equal((await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0);
 console.log(JSON.stringify({passed:true,model:config.model,calls,inputTokens:record.input_tokens,outputTokens:record.output_tokens,testUnits:spent,requestedShortcuts:tab.view.shortcuts,replayCalls:0,shortcutInference:false,publications:0}));
}finally{await store.close();}

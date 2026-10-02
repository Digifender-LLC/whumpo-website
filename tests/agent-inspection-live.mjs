// Explicit opt-in provider probe. Current schema, synthetic local owner, private work only.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
if(process.env.RUN_LIVE_MUSE!=='1')throw Error('Set RUN_LIVE_MUSE=1 to authorize this live provider probe');
const backendMode=process.env.LIVE_INSPECTION_KIND==='backend';
const runtime=process.env.RUNTIME_URL??'http://localhost:8794';if(backendMode)assert.equal(runtime,'http://localhost:8794','Only the local isolated runtime is allowed');
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db;
const {sendAIChat,getBilling,backend:{saveBackend}}=m;
try{
 const user=crypto.randomUUID(),project=crypto.randomUUID(),turn=crypto.randomUUID(),now=new Date().toISOString();const authority=await workspaceFixture(db,m,user),owned=await authority.scope();await db.prepare("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')").bind(user).run();await getBilling(owned,user);await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Synthetic Bakery','A fictional bakery for an isolated acceptance test','draft',?,?)").bind(project,user,now,now).run();
 const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:(await readFile('opencode.key','utf8')).trim(),protocol:'responses'};
 let calls=0;const transport=(...args)=>{calls++;return fetch(...args);};
 const original=crypto.randomUUID();if(backendMode)await saveBackend(owned,user,project,original,'export default input=>({value:input.value+1,label:"Original label",metadata:{unit:"items"}})');
 const request=backendMode?'First inspect backend version '+original+' in project '+project+'. Then save a new private version that increments input.value by 2 instead of 1. Preserve every other returned field exactly. Do not execute or publish. Complete this in the same request if a follow-up step is available.':'First inspect the project record for '+project+'. Then make its first private website draft, using forest colors and a friendly introduction. Use only the fictional details already supplied. Do not publish. Complete this in the same request if a follow-up step is available.';
 await sendAIChat(owned,user,turn,0,request,config,transport);
 const row=await db.prepare('SELECT status,input_tokens,output_tokens FROM chat_turns WHERE id=?').bind(turn).first();const draft=await db.prepare(backendMode?'SELECT id,source FROM backend_versions WHERE id=? AND project_id=?':'SELECT id FROM site_versions WHERE id=? AND project_id=?').bind(turn,project).first();const receipt=await db.prepare('SELECT turn_id FROM agent_inspections WHERE turn_id=?').bind(turn).first();assert.equal(row.status,'completed');assert.equal(calls,2);assert.ok(receipt);assert.ok(draft);assert.equal((await db.prepare('SELECT count(*) n FROM publications').first()).n,0);if(backendMode){assert.equal((await db.prepare('SELECT count(*) n FROM backend_runs').first()).n,0);assert.equal((await db.prepare('SELECT count(*) n FROM backend_publications').first()).n,0);for(const value of [3,-4,0]){const result=await fetch(runtime+'/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:1,source:draft.source,input:{value}}),signal:AbortSignal.timeout(5000)});assert.equal(result.status,200);assert.deepEqual(await result.json(),{ok:true,value:{value:value+2,label:'Original label',metadata:{unit:'items'}}});}}console.log(JSON.stringify({passed:true,kind:backendMode?'backend':'website',model:config.model,calls,inputTokens:row.input_tokens,outputTokens:row.output_tokens,privateDraft:true,published:false}));
}finally{await store.close();}

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
assert.equal(process.env.TOWNHELLO_LIVE_AI,'1','Explicitly enable the live provider test');
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,owners=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
async function accountAuthority(user=crypto.randomUUID()){const authority=await workspaceFixture(db,m,user);owners.set(user,authority);scopes.set(user,await authority.scope());return authority;}
const {sendChat,readChat,sendAIChat,getBilling}=m,id=()=>crypto.randomUUID();
async function account(){const user=id(),project=id(),now=new Date().toISOString();await accountAuthority(user);await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Calculator','Quote estimates','draft',?,?)").bind(project,user,now,now).run();await readChat(scope(user),user);return {user,project};}
try{
 const a=await account();
 const backendRuntime={fetch:(_url,init)=>fetch('http://localhost:8797/execute',init)};
 const apiKey=(await readFile('opencode.key','utf8')).trim();
 const config={baseURL:'https://opencode.ai/zen/go/v1',apiKey,model:'muse-spark-1.3-contributor',protocol:'responses'};
 const turn=id(),revision=(await readChat(scope(a.user),a.user)).state.revision;
 const content=`For existing project ${a.project}, create a private backend function: JSON input has quantity and unitPrice, both numbers. Return JSON {total:quantity*unitPrice}. Inspect the capability catalog, record any missing computation, and create only the private function draft. Do not change the website, publish, or execute a test yet.`;
 assert.equal((await sendAIChat(scope(a.user),a.user,turn,revision,content,config,undefined,{backendRuntime})).status,200);
 const draft=await db.prepare('SELECT id FROM backend_versions WHERE id=? AND project_id=?').bind(turn,a.project).first();
 const history=await readChat(scope(a.user),a.user);assert.ok(draft,'Live model did not create the requested backend draft; turn status: '+history.turns.at(-1).status);
 for(const [quantity,unitPrice] of [[4,7],[2,11]]){
  const state=(await readChat(scope(a.user),a.user)).state,request={id:id(),revision:state.revision,content:'/test-backend '+turn+' '+JSON.stringify({quantity,unitPrice})};
  assert.equal((await sendChat(scope(a.user),a.user,request,undefined,{backendRuntime})).status,200);
  const run=await db.prepare('SELECT result_json FROM backend_runs WHERE id=?').bind(request.id).first();assert.deepEqual(JSON.parse(run.result_json),{ok:true,value:{total:quantity*unitPrice}});
  await sendChat(scope(a.user),a.user,request,undefined,{backendRuntime});
 }
 const billing=await getBilling(scope(a.user),a.user);assert.equal(billing.standardAI.creditCharge,0);
 console.log('Live Muse generated a private backend draft; actual workerd ran two guided examples correctly, replay stayed stable. Standard AI customer charge:',billing.standardAI.creditCharge);
}finally{await store.close();}

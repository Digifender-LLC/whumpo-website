import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
Error.stackTraceLimit=0;
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
const run=(sql,...p)=>db.prepare(sql).bind(...p).run(),row=(sql,...p)=>db.prepare(sql).bind(...p).first();
let cases=0;const test=async(name,fn)=>{try{await fn();cases++;}catch(error){console.error(name,String(error));throw error;}};
const view=(projectId=null,widgets=['projects','activity'],shortcuts=[])=>({version:1,projectId,widgets,shortcuts});
const page=(o,name='garden')=>({id:'tab-'+name,label:name,view:view(o.project)});
const change=(operation,expectedRevision,data={})=>({version:1,requestId:id(),expectedRevision,operation,...data});
const apply=(o,input)=>m.mutateLayout(o.scope,o.user,input);
async function owner(){
 const authority=await workspaceFixture(db,m),user=authority.account,scope=await authority.scope(),project=id(),grant=id();
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Landscaping','draft',datetime('now'),datetime('now'))",project,user);
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.editing','prepare','private-test-acceptance','synthetic layout fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",grant,user);
 return {authority,user,scope,project,grant};
}
const revoked=o=>run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=?',o.grant);
const count=async(o,table)=>(await row('SELECT count(*) n FROM '+table+' WHERE user_id=?',o.user)).n;
async function turn(o){const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,mode,status,created_at) VALUES(?,?,1,'Add my garden page','', 'ai','pending',datetime('now'))",turn,o.user);await run("INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,datetime('now'),datetime('now'))",turn,o.user,'a'.repeat(64));await run("UPDATE standard_ai_requests SET state='dispatched' WHERE id=?",turn);return turn;}
try{
 await test('scoped page lifecycle preserves unrelated pages and dashboard; undo has a new receipt',async()=>{
  const o=await owner(),initial=await m.readLayout(o.scope,o.user);
  const create=change('createPage',0,{page:page(o)}),one=await apply(o,create);
  assert.deepEqual(await apply(o,create),one);assert.equal(one.revision,1);
  const two=await apply(o,change('createPage',1,{page:page(o,'second')}));
  const three=await apply(o,change('updatePage',2,{pageId:'tab-garden',view:view(o.project,['traffic'],['project'])}));
  assert.deepEqual(three.layout.tabs[1],two.layout.tabs[1]);assert.deepEqual(three.layout.dashboard,initial.layout.dashboard);
  const rename=await apply(o,change('renamePage',3,{pageId:'tab-garden',label:'My garden'}));
  assert.equal(rename.layout.tabs[0].id,'tab-garden');assert.deepEqual(rename.layout.tabs[0].view,three.layout.tabs[0].view);
  const remove=await apply(o,change('removePage',4,{pageId:'tab-garden'}));assert.deepEqual(remove.layout.tabs,[two.layout.tabs[1]]);
  const undo=await apply(o,change('undo',5,{receiptId:remove.requestId}));assert.deepEqual(undo.layout,rename.layout);assert.equal(undo.revision,6);
  const dashboard=await apply(o,change('setDashboard',6,{view:view(null,['usage'])}));assert.deepEqual(dashboard.layout.tabs,undo.layout.tabs);
  const history=await m.readLayoutHistory(o.scope,o.user);assert.deepEqual(history.items.map(x=>x.revision),[7,6,5,4,3,2,1]);
  assert.deepEqual(await m.readLayoutReceipt(o.scope,o.user,one.requestId),one);
  await assert.rejects(apply(o,change('undo',7,{receiptId:remove.requestId})),{code:'workspace_layout_changed'});
 });
 await test('current closed schema rejects executable data, old contracts, scope retargeting and no-op saves',async()=>{
  const o=await owner(),input=change('createPage',0,{page:page(o)});
  for(const value of [
   {...input,version:0},{...input,expectedRevision:-1},{...input,url:'https://example.invalid'},
   {...input,page:{...input.page,html:'<script/>'}},
   {...input,page:{...input.page,view:{...input.page.view,widgets:['sql']}}},
   {...input,page:{...input.page,view:{...input.page.view,shortcuts:['publish']}}},
   {...input,page:{...input.page,view:{...input.page.view,shortcuts:['project','project']}}},
   {...input,page:{...input.page,view:{...input.page.view,projectId:null,shortcuts:['project']}}},
   {operation:'save',revision:0,layout:{widgets:['projects'],tabs:[]}},
  ])await assert.rejects(apply(o,value),{code:'invalid_view'});
  assert.equal(await count(o,'workspace_layout_receipts'),0);assert.equal(await count(o,'workspace_preferences'),0);
  const saved=await apply(o,input);
  await assert.rejects(apply(o,{...input,page:{...input.page,label:'Changed request'}}),{code:'request_conflict'});
  await assert.rejects(apply(o,change('updatePage',1,{pageId:'tab-garden',view:view(null)})),{code:'page_scope'});
  await assert.rejects(apply(o,change('renamePage',1,{pageId:'tab-garden',label:'garden'})),{code:'no_change'});
  await assert.rejects(apply(o,change('setDashboard',1,{view:view(o.project)})),{code:'invalid_view'});
  assert.deepEqual((await m.readLayout(o.scope,o.user)).layout,saved.layout);
 });
 await test('owner isolation applies to definitions, requests and undo',async()=>{
  const a=await owner(),b=await owner(),saved=await apply(a,change('createPage',0,{page:page(a)}));
  await assert.rejects(apply(b,change('createPage',0,{page:page(a)})),{code:'project_missing'});
  await assert.rejects(m.readLayoutReceipt(b.scope,b.user,saved.requestId),{code:'receipt_missing'});
  await assert.rejects(apply(b,change('undo',0,{receiptId:saved.requestId})),{code:'workspace_layout_changed'});
  assert.equal((await m.readLayout(b.scope,b.user)).revision,0);
 });
 await test('stale concurrent edits cannot clobber another page',async()=>{
  const o=await owner(),requests=['one','two'].map(name=>change('createPage',0,{page:page(o,name)}));
  const prepared=await Promise.all(requests.map(r=>m.prepareLayoutChange(o.scope,o.user,r)));
  const outcomes=await Promise.allSettled(prepared.map(p=>o.scope.batch(p.statements)));
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  const saved=await m.readLayout(o.scope,o.user);assert.equal(saved.revision,1);assert.equal(saved.layout.tabs.length,1);assert.equal(await count(o,'workspace_layout_receipts'),1);
 });
 await test('lost acknowledgment recovers exactly one receipt, including concurrent identical requests',async()=>{
  const o=await owner(),input=change('createPage',0,{page:page(o)});let intercepted=false;
  const scope=await o.authority.scope(interceptDatabase(db,/^INSERT INTO workspace_layout_receipts\(/,async()=>{},async()=>{intercepted=true;throw Error('Lost response');}));
  const saved=await m.mutateLayout(scope,o.user,input);assert(intercepted);assert.equal(saved.revision,1);
  assert.deepEqual(await apply(o,input),saved);assert.equal(await count(o,'workspace_layout_receipts'),1);
  const second=change('renamePage',1,{pageId:'tab-garden',label:'Renamed'});
  const results=await Promise.all([apply(o,second),apply(o,second)]);assert.deepEqual(results[0],results[1]);assert.equal(await count(o,'workspace_layout_receipts'),2);
 });
 await test('readback stays available after feature loss; new operations and undo are denied',async()=>{
  const o=await owner(),input=change('createPage',0,{page:page(o)}),saved=await apply(o,input);await revoked(o);
  assert.deepEqual(await apply(o,input),saved);assert.deepEqual(await m.readLayoutReceipt(o.scope,o.user,saved.requestId),saved);
  await assert.rejects(apply(o,change('removePage',1,{pageId:'tab-garden'})));
  await assert.rejects(apply(o,change('undo',1,{receiptId:saved.requestId})));
  assert.equal((await m.readLayout(o.scope,o.user)).revision,1);
 });
 await test('late project, feature and identity revocation rolls back even the initial preferences row',async()=>{
  for(const kind of ['project','feature','identity']){
   const o=await owner(),other=await owner(),input=change('createPage',0,{page:page(o)});let intercepted=false;
   const scope=await o.authority.scope(interceptDatabase(db,/^INSERT INTO workspace_layout_receipts\(/,async()=>{intercepted=true;if(kind==='project')await run('UPDATE projects SET owner_user_id=? WHERE id=?',other.user,o.project);else if(kind==='feature')await revoked(o);else await o.authority.revoke();}));
   await assert.rejects(m.mutateLayout(scope,o.user,input));assert(intercepted);assert.equal(await count(o,'workspace_preferences'),0);assert.equal(await count(o,'workspace_layout_receipts'),0);
  }
 });
 await test('removing a stale page remains possible; undo cannot restore its lost project authority',async()=>{
  for(const loss of ['transfer','delete']){
   const o=await owner(),other=await owner();await apply(o,change('createPage',0,{page:page(o)}));
   if(loss==='transfer')await run('UPDATE projects SET owner_user_id=? WHERE id=?',other.user,o.project);
   else await run('DELETE FROM projects WHERE id=?',o.project);
   const removed=await apply(o,change('removePage',1,{pageId:'tab-garden'}));
   await assert.rejects(apply(o,change('undo',2,{receiptId:removed.requestId})),{code:'project_missing'});
   assert.deepEqual((await m.readLayout(o.scope,o.user)).layout.tabs,[]);
  }
 });
 await test('agent preparation performs no layout writes; a failed final Chat transaction saves nothing',async()=>{
  const o=await owner(),turnId=await turn(o),action={kind:'workspace',version:1,operation:'createPage',expectedRevision:0,page:page(o)};
  const prepared=await m.prepareSiteAction(o.scope,o.user,turnId,JSON.stringify({reply:'Model claim',action}),await m.siteContext(o.scope,o.user));
  assert(prepared.statements.length);assert.equal(await count(o,'workspace_preferences'),0);assert.equal(await count(o,'workspace_layout_receipts'),0);
  await assert.rejects(o.scope.batch([...prepared.statements,o.scope.prepare("UPDATE chat_turns SET status='invalid' WHERE id=?").bind(turnId)]));
  assert.equal(await count(o,'workspace_preferences'),0);assert.equal(await count(o,'workspace_layout_receipts'),0);
  await o.scope.batch([...prepared.statements,o.scope.prepare('UPDATE chat_turns SET assistant_text=?,input_tokens=10,output_tokens=20 WHERE id=?').bind(prepared.reply,turnId)]);
  assert.equal((await m.readLayout(o.scope,o.user)).revision,1);assert.match((await row('SELECT assistant_text FROM chat_turns WHERE id=?',turnId)).assistant_text,/saved/);
  // No inference usage rows exist in this narrowly prepared domain fixture.
  await run('DELETE FROM chat_turns WHERE id=?',turnId);assert.equal(await count(o,'workspace_layout_receipts'),1);
  await assert.rejects(run('UPDATE workspace_layout_receipts SET origin_turn_id=NULL WHERE request_id=?',turnId),/immutable/);
 });
 await test('closed Chat turns and mismatched turn identities cannot commit prepared writes',async()=>{
  const o=await owner(),turnId=await turn(o),input={...change('createPage',0,{page:page(o)}),requestId:turnId};
  await assert.rejects(m.prepareLayoutChange(o.scope,o.user,input,id()),{code:'workspace_layout_changed'});
  const prepared=await m.prepareLayoutChange(o.scope,o.user,input,turnId);await run("UPDATE chat_turns SET status='failed' WHERE id=?",turnId);
  await assert.rejects(o.scope.batch(prepared.statements),/workspace_layout_changed/);assert.equal(await count(o,'workspace_preferences'),0);
 });
 await test('page limits and version requirements are enforced without silently dropping pages',async()=>{
  const o=await owner();for(let i=0;i<8;i++)await apply(o,change('createPage',i,{page:page(o,'page-'+i)}));
  await assert.rejects(apply(o,change('createPage',8,{page:page(o,'overflow')})),{code:'workspace_layout_changed'});
  assert.equal((await m.readLayout(o.scope,o.user)).layout.tabs.length,8);
  await assert.rejects(run('INSERT INTO workspace_preferences(user_id,layout_json,updated_at) VALUES(?,?,datetime(\'now\'))',(await owner()).user,JSON.stringify({widgets:[],tabs:[]})));
 });
 await test('maximum saved layout and recent receipts fit the bounded model lookup',async()=>{
  const o=await owner(),widgets=['projects','usage','storage','activity','traffic','cms','performance'],shortcuts=['project','versions','health','checkWebsite','application'];
  for(let i=0;i<8;i++)await apply(o,change('createPage',i,{page:{id:'tab-'+String(i).repeat(40),label:'庭'.repeat(40),view:view(o.project,widgets,shortcuts)}}));
  for(let i=8;i<28;i++)await apply(o,change('setDashboard',i,{view:view(null,i%2===0?['projects']:widgets)}));
  assert.equal((await m.readLayoutHistory(o.scope,o.user)).items.length,20);
  const lookup=await m.workspaceAction(o.scope,o.user,id(),{kind:'workspace',operation:'read'});
  assert.equal(JSON.parse(lookup.inspection).data.history.items.length,5);
  assert(m.inspectionMessages([{role:'user',content:'Undo my latest layout change'}],lookup.inspection));
  assert.equal(lookup.statements.length,0);
 });
 assert.equal((await row('SELECT count(*) n FROM workspace_layout_checks')).n,0);
 console.log(`Workspace layout: ${cases} domain cases passed on ${process.argv.includes('--d1')?'local D1':'SQLite'}; current-only contracts, lifecycle, atomic Chat preparation, replay, concurrency, revoked authority and undo. No provider inference or deployment.`);
}finally{await fixture.close();}

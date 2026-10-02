import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),{sendAIChat,readChat,sendChat,getBilling,siteContext,prepareSiteAction}=m;
const fixture=await databaseFixture({d1:true}),db=fixture.db,scopes=new Map(),scopeFor=user=>scopes.get(user);
const cfg={baseURL:'https://provider.test/v1',apiKey:'fake-key',model:'fake-model',protocol:'responses'};
async function account(){const a=await workspaceFixture(db,m),id=a.account;scopes.set(id,await a.scope());await db.prepare("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')").bind(id).run();const project=crypto.randomUUID();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Bakery','Fresh bread','draft',?,?)").bind(project,id,new Date().toISOString(),new Date().toISOString()).run();return {id,project};}
const config={name:'Bakery',headline:'Fresh bread, every morning',description:'Bread for the neighborhood.',theme:'clay',aboutTitle:'Our story',aboutText:'A neighborhood bakery.',sections:[{heading:'Visit us',text:'Ask us about today’s bread.'}],photos:[]};
let calls=0;
const provider=action=>async()=>{calls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:typeof action==='string'?action:JSON.stringify({reply:'Proposed change',action})}]}],usage:{input_tokens:100,output_tokens:200}});};
async function send(dbx,user,action){const state=await readChat(scopeFor(user.id),user.id);const id=crypto.randomUUID();await sendAIChat(dbx,user.id,id,state.state.revision,'Make a warm bakery site',cfg,provider(action));return id;}
try{
 const owner=await account(),other=await account();const created=await send(scopeFor(owner.id),owner,{kind:'specification',operation:'create',projectId:owner.project,config});
 async function inspect(user,scope,targetId){const context=await siteContext(scopeFor(user.id),user.id);return prepareSiteAction(scopeFor(user.id),user.id,crypto.randomUUID(),JSON.stringify({reply:'Untrusted model summary',action:{kind:'inspect',scope,...(targetId?{targetId}:{})}}),context);}
 const awaitContext=await siteContext(scopeFor(owner.id),owner.id);
 const before=await db.prepare('SELECT COUNT(*) n FROM site_versions').first();
 for(const scope of ['projects','activity','usage','domains']){const r=await inspect(owner,scope);assert.equal(r.statements.length,0);assert.ok(!r.reply.includes('Untrusted model summary'));}
 const project=await inspect(owner,'project',owner.project);assert.ok(project.reply.includes(owner.project));assert.ok(project.reply.includes('Saved versions: 1'));
 const version=await inspect(owner,'version',created);assert.ok(version.reply.includes(config.headline));assert.ok(version.reply.includes('Not currently live'));
 const versions=await inspect(owner,'versions',owner.project);assert.ok(versions.reply.includes(created));assert.ok(!versions.reply.includes(other.project));
 assert.equal((await inspect(other,'project',owner.project)).reply,'Project not found.');assert.equal((await inspect(other,'version',created)).reply,'Saved version not found.');assert.ok((await inspect(other,'versions',owner.project)).reply.startsWith('No saved versions'));
 for(const action of [{kind:'inspect',scope:'sql',sql:'SELECT * FROM users'},{kind:'inspect',scope:'version'},{kind:'inspect',scope:'project',targetId:'bad'},{kind:'inspect',scope:'usage',targetId:owner.project},{kind:'inspect',scope:'projects',url:'https://evil.test'}])await assert.rejects(()=>prepareSiteAction(scopeFor(owner.id),owner.id,crypto.randomUUID(),JSON.stringify({reply:'No',action}),awaitContext));
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM site_versions').first()).n,before.n);
 // Internally costed natural-language inspection returns the server record, and replay does not call the model again.
 const inspected=await send(scopeFor(owner.id),owner,{kind:'inspect',scope:'version',targetId:created});const record=await db.prepare('SELECT * FROM chat_turns WHERE id=?').bind(inspected).first();assert.equal(record.status,'completed');assert.ok(record.assistant_text.includes(config.headline));const priorCalls=calls;await sendAIChat(scopeFor(owner.id),owner.id,inspected,record.revision-1,'Make a warm bakery site',cfg,provider(null));assert.equal(calls,priorCalls);
 // Private exact-handler dispatch has no inference cost. The public input
 // boundary remains natural language and is covered by natural-chat.mjs.
 for(const content of ['/project '+owner.project,'/inspect '+created,'/versions '+owner.project]){const state=await readChat(scopeFor(owner.id),owner.id),units=(await getBilling(scopeFor(owner.id),owner.id)).standardAI.creditCharge;const r=await sendChat(scopeFor(owner.id),owner.id,{content,id:crypto.randomUUID(),revision:state.state.revision},cfg);assert.equal(r.status,200);assert.equal((await getBilling(scopeFor(owner.id),owner.id)).standardAI.creditCharge,units);}
 // All twenty project identities remain discoverable; preview authorization no longer depends on top five context membership.
 for(let i=1;i<20;i++)await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Other project','Fixture','draft',?,?)").bind(crypto.randomUUID(),owner.id,new Date().toISOString(),new Date().toISOString()).run();
 const context=await siteContext(scopeFor(owner.id),owner.id);assert.equal(context.projectIndex.length,20);assert.ok(context.projectIndex.some(p=>p.id===owner.project));assert.ok(!context.projects.some(p=>p.id===owner.project));assert.ok(context.projectIndex.every(p=>p.id!==other.project));
 const preview=await prepareSiteAction(scopeFor(owner.id),owner.id,crypto.randomUUID(),JSON.stringify({reply:'Preview',action:{kind:'specification',operation:'change',projectId:owner.project,expectedRevision:1,operations:[{type:'design.setTheme',theme:'forest'}]}}),context);assert.ok(preview.statements.length>0);
 const unknown=await send(scopeFor(owner.id),owner,{kind:'inspect',scope:'version',targetId:crypto.randomUUID()});assert.equal((await db.prepare('SELECT assistant_text FROM chat_turns WHERE id=?').bind(unknown).first()).assistant_text,'Saved version not found.');
 console.log('Workspace inspections passed: server-derived records, read-only statements, tenant boundaries, rejected query/URL fields, missing IDs, AI replay, free guided access and full project index.');
}finally{await fixture.close();}

import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,owners=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
async function owner(user=crypto.randomUUID()){if(!owners.has(user)){const authority=await workspaceFixture(db,m,user);owners.set(user,authority);scopes.set(user,await authority.scope());}return user;}
const {backendLineChanges,compareBackends,describeBackendComparison}=m.backendDiff,{saveBackend,testBackend}=m.backend,{backendAction,backendChatCommand}=m.backendChat;
for(const [before,after]of [['a\nb\nc','a\nx\nc'],['same','same'],['a\n','a'],['a','a\nb'],['','x'],['🌿\r\nx','🌿\r\ny'],['x\n'.repeat(4000),'y\n'.repeat(4000)]]){const c=backendLineChanges(before,after),lines=before.split('\n');assert.equal([...lines.slice(0,c.unchangedBefore),...c.added,...(c.unchangedAfter?lines.slice(-c.unchangedAfter):[])].join('\n'),after);}
const id=()=>crypto.randomUUID();
async function project(user=id()){await owner(user);const project=id();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Comparison','','draft',?,?)").bind(project,user,new Date().toISOString(),new Date().toISOString()).run();return {user,project};}
try{const a=await project(),b=await project(),sameOwner=await project(a.user),old=id(),next=id(),foreign=id(),other=id();const source='export default input => {\n return input.value + 1;\n}';await saveBackend(scope(a.user),a.user,a.project,old,source);await saveBackend(scope(a.user),a.user,a.project,next,source.replace('+ 1','+ 2'));await saveBackend(scope(b.user),b.user,b.project,foreign,'export default ()=>1');await saveBackend(scope(a.user),a.user,sameOwner.project,other,'export default ()=>2');
 let value=await compareBackends(scope(a.user),a.user,next,old);assert.equal(value.latestTest.status,'untested');assert.deepEqual(value.changes.removed,[' return input.value + 1;']);assert.deepEqual(value.changes.added,[' return input.value + 2;']);assert.equal(value.changes.startLine,2);assert.equal((await compareBackends(scope(a.user),a.user,old,old)).changed,false);
 for(const base of [foreign,other,id()])await assert.rejects(compareBackends(scope(a.user),a.user,next,base),e=>e.status===404);await assert.rejects(compareBackends(scope(b.user),b.user,next,old),e=>e.status===404);
 const success='11111111-1111-4111-8111-111111111111',failure='ffffffff-ffff-4fff-8fff-ffffffffffff';await testBackend(scope(a.user),{fetch:()=>Response.json({ok:true,value:3})},a.user,a.project,next,success,{value:1});assert.equal((await compareBackends(scope(a.user),a.user,next,old)).latestTest.status,'passed');await testBackend(scope(a.user),{fetch:()=>Response.json({ok:false,error:'execution_failed'},{status:422})},a.user,a.project,next,failure,{value:1});assert.equal((await compareBackends(scope(a.user),a.user,next,old)).latestTest.status,'failed');
 const before=(await db.prepare('SELECT count(*) n FROM backend_runs').first()).n;const action=await backendAction(scope(a.user),a.user,id(),{kind:'backend',operation:'compare',versionId:next,baselineId:old});assert.equal(action.statements.length,0);assert.match(action.reply,/Latest saved test for new version: failed/);assert.match(action.reply,/No code was executed/);assert.equal((await db.prepare('SELECT count(*) n FROM backend_runs').first()).n,before);assert.equal(await backendChatCommand(scope(a.user),a.user,id(),`/backend-diff ${next} ${old}`)(),action.reply);await assert.rejects(backendAction(scope(a.user),a.user,id(),{kind:'backend',operation:'compare',versionId:next,baselineId:old,source:'bad'}),e=>e.status===400);
 // Corrupt only the saved-source read, including the admitted batch transport.
 const originals=new WeakMap(),corrupt=result=>{result.results[0].source='corrupted';return result;};
 const altered={
  prepare(query){
   const original=db.prepare(query);if(!query.startsWith('SELECT v.id,v.project_id,v.source,v.digest'))return original;
   function wrap(statement){const value={bind:(...args)=>wrap(statement.bind(...args)),all:async()=>corrupt(await statement.all())};originals.set(value,statement);return value;}
   return wrap(original);
  },
  async batch(statements){const results=await db.batch(statements.map(statement=>originals.get(statement)??statement));return results.map((result,i)=>originals.has(statements[i])?corrupt(result):result);}
 };
 await assert.rejects(compareBackends(await owners.get(a.user).scope(altered),a.user,next,old),e=>e.status===503);

 assert.equal((await db.prepare('SELECT count(*) n FROM backend_publications').first()).n,0);console.log('Backend comparison passed: exact linear replacement, unchanged/Unicode/newline cases, owner/project isolation, source integrity, latest test status, chat/model routing and no execution/publication.');
}finally{await store.close();}

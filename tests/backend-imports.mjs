import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),{worker:platform}=m,{quarantineBackendImport,listBackendImports,scanBackendImports}=m.backendImports,{testBackend}=m.backend,{backendChatCommand,ownedBackend}=m.backendChat;
const store=await databaseFixture({d1:true}),db=store.db;
try{
 const owner=await workspaceFixture(db,m),foreign=await workspaceFixture(db,m),user=owner.account,other=foreign.account,project=crypto.randomUUID(),now=new Date().toISOString(),scopes=new Map([[user,await owner.scope()],[other,await foreign.scope()]]),scope=user=>scopes.get(user);
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Fixture','Fixture','draft',?,?)").bind(project,user,now,now).run();
 const session=owner.token;
 const env={...store.env,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:{fetch(){throw Error('No imported source may execute');}}};
 const call=(path,body)=>platform.fetch(new Request('https://whumpo.com'+path,{method:body?'POST':'GET',headers:{origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+session,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{});
 const httpID=crypto.randomUUID(),httpSource='export default () => "HTTP_PRIVATE_MARKER";';
 for(let i=0;i<2;i++){const r=await call('/api/projects/'+project+'/backends',{id:httpID,source:httpSource});assert.equal(r.status,202);const value=await r.json();assert.equal(value.state,'pending');assert.equal(value.usable,false);assert.ok(!JSON.stringify(value).includes('HTTP_PRIVATE_MARKER'));}
 assert.equal((await call('/api/projects/'+project+'/backends/'+httpID+'/test',{id:crypto.randomUUID(),input:{}})).status,404);
 const inventory=await (await call('/api/projects/'+project+'/backends')).json();assert.equal(inventory.versions.length,0);assert.equal(inventory.imports.length,1);
 const id=crypto.randomUUID(),source='export default input => input; // PRIVATE_IMPORT_MARKER';
 const first=await quarantineBackendImport(scope(user),user,project,id,source);assert.equal(first.state,'pending');assert.equal(first.usable,false);assert.ok(!JSON.stringify(first).includes('PRIVATE_IMPORT_MARKER'));
 assert.deepEqual(await quarantineBackendImport(scope(user),user,project,id,source),first);
 await assert.rejects(()=>quarantineBackendImport(scope(user),user,project,id,source+'changed'),e=>e.status===409);
 await assert.rejects(()=>quarantineBackendImport(scope(other),other,project,crypto.randomUUID(),source),e=>e.status===404);
 await assert.rejects(()=>listBackendImports(scope(other),other,project),e=>e.status===404);
 await assert.rejects(()=>testBackend(scope(user),{fetch(){throw Error('Quarantine must not execute');}},user,project,id,crypto.randomUUID(),{}),e=>e.status===404);
 await assert.rejects(()=>ownedBackend(scope(user),user,id),e=>e.status===404);
 await assert.rejects(()=>db.prepare('INSERT INTO backend_versions(id,project_id,source,digest,created_at) VALUES(?,?,?,?,?)').bind(id,project,source,first.digest,now).run());
 await assert.rejects(()=>db.prepare("UPDATE backend_imports SET source='changed' WHERE id=?").bind(id).run());
 await assert.rejects(()=>db.prepare("UPDATE backend_imports SET state='approved' WHERE id=?").bind(id).run());
 const blocked=crypto.randomUUID();await quarantineBackendImport(scope(user),user,project,blocked,'export default () => eval("1");');
 const beforeFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Background triage must not contact providers or external content');};try{assert.equal((await scanBackendImports(db)).examined,3);assert.equal((await scanBackendImports(db)).examined,0);}finally{globalThis.fetch=beforeFetch;}
 const rows=await listBackendImports(scope(user),user,project);assert.equal(rows.find(r=>r.id===id).state,'requires_review');assert.equal(rows.find(r=>r.id===blocked).state,'blocked');assert.ok(rows.every(r=>!r.usable));
 assert.ok(!JSON.stringify(rows).includes('PRIVATE_IMPORT_MARKER'));
 const chat=await backendChatCommand(scope(user),user,crypto.randomUUID(),'/backend-imports '+project)();assert.match(chat,/quarantined/i);assert.ok(!chat.includes('PRIVATE_IMPORT_MARKER'));
 await assert.rejects(()=>db.prepare("UPDATE backend_imports SET state='pending',reason=NULL,scanned_at=NULL WHERE id=?").bind(id).run());
 assert.equal((await db.prepare('SELECT count(*) n FROM backend_versions').first()).n,0);assert.equal((await db.prepare('SELECT count(*) n FROM backend_runs').first()).n,0);
 // Atomic per-project quota bounds quarantined storage; retries do not consume another slot.
 for(let i=3;i<25;i++)await quarantineBackendImport(scope(user),user,project,crypto.randomUUID(),source);
 await assert.rejects(()=>quarantineBackendImport(scope(user),user,project,crypto.randomUUID(),source),e=>e.status===409);
 assert.equal((await scanBackendImports(db)).examined,10);
 console.log('Backend import quarantine passed: immutable ownership/digest, replay, no execution/source disclosure, fail-closed triage, terminal states, bounded jobs and storage quota.');
}finally{await store.close();}

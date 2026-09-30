import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {build} from 'esbuild';import wrangler from 'wrangler';
const code=await build({stdin:{resolveDir:process.cwd(),contents:"export {default as platform} from './src/index';export {hashToken} from './src/security';export * from './src/backend-imports';export {testBackend} from './src/backend-versions';export {backendChatCommand,ownedBackend} from './src/backend-chat';"},bundle:true,platform:'node',format:'esm',write:false});
const {platform,hashToken,quarantineBackendImport,listBackendImports,scanBackendImports,testBackend,backendChatCommand,ownedBackend}=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-import-quarantine-');let proxy;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 const user=crypto.randomUUID(),other=crypto.randomUUID(),project=crypto.randomUUID(),now=new Date().toISOString();
 for(const id of [user,other])await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(id,id+'@example.test',now).run();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Fixture','Fixture','draft',?,?)").bind(project,user,now,now).run();
 const session='a'.repeat(64);await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(await hashToken(session),user,new Date(Date.now()+60000).toISOString(),now).run();
 const env={...proxy.env,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:{fetch(){throw Error('No imported source may execute');}}};
 const call=(path,body)=>platform.fetch(new Request('https://whumpo.com'+path,{method:body?'POST':'GET',headers:{origin:'https://whumpo.com',cookie:'whumpo_session='+session,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{});
 const httpID=crypto.randomUUID(),httpSource='export default () => "HTTP_PRIVATE_MARKER";';
 for(let i=0;i<2;i++){const r=await call('/api/projects/'+project+'/backends',{id:httpID,source:httpSource});assert.equal(r.status,202);const value=await r.json();assert.equal(value.state,'pending');assert.equal(value.usable,false);assert.ok(!JSON.stringify(value).includes('HTTP_PRIVATE_MARKER'));}
 assert.equal((await call('/api/projects/'+project+'/backends/'+httpID+'/test',{id:crypto.randomUUID(),input:{}})).status,404);
 const inventory=await (await call('/api/projects/'+project+'/backends')).json();assert.equal(inventory.versions.length,0);assert.equal(inventory.imports.length,1);
 const id=crypto.randomUUID(),source='export default input => input; // PRIVATE_IMPORT_MARKER';
 const first=await quarantineBackendImport(db,user,project,id,source);assert.equal(first.state,'pending');assert.equal(first.usable,false);assert.ok(!JSON.stringify(first).includes('PRIVATE_IMPORT_MARKER'));
 assert.deepEqual(await quarantineBackendImport(db,user,project,id,source),first);
 await assert.rejects(()=>quarantineBackendImport(db,user,project,id,source+'changed'),e=>e.status===409);
 await assert.rejects(()=>quarantineBackendImport(db,other,project,crypto.randomUUID(),source),e=>e.status===404);
 await assert.rejects(()=>listBackendImports(db,other,project),e=>e.status===404);
 await assert.rejects(()=>testBackend(db,{fetch(){throw Error('Quarantine must not execute');}},user,project,id,crypto.randomUUID(),{}),e=>e.status===404);
 await assert.rejects(()=>ownedBackend(db,user,id),e=>e.status===404);
 await assert.rejects(()=>db.prepare('INSERT INTO backend_versions(id,project_id,source,digest,created_at) VALUES(?,?,?,?,?)').bind(id,project,source,first.digest,now).run());
 await assert.rejects(()=>db.prepare("UPDATE backend_imports SET source='changed' WHERE id=?").bind(id).run());
 await assert.rejects(()=>db.prepare("UPDATE backend_imports SET state='approved' WHERE id=?").bind(id).run());
 const blocked=crypto.randomUUID();await quarantineBackendImport(db,user,project,blocked,'export default () => eval("1");');
 const beforeFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Background triage must not contact providers or external content');};try{assert.equal((await scanBackendImports(db)).examined,3);assert.equal((await scanBackendImports(db)).examined,0);}finally{globalThis.fetch=beforeFetch;}
 const rows=await listBackendImports(db,user,project);assert.equal(rows.find(r=>r.id===id).state,'requires_review');assert.equal(rows.find(r=>r.id===blocked).state,'blocked');assert.ok(rows.every(r=>!r.usable));
 assert.ok(!JSON.stringify(rows).includes('PRIVATE_IMPORT_MARKER'));
 const chat=await backendChatCommand(db,user,crypto.randomUUID(),'/backend-imports '+project)();assert.match(chat,/quarantined/i);assert.ok(!chat.includes('PRIVATE_IMPORT_MARKER'));
 await assert.rejects(()=>db.prepare("UPDATE backend_imports SET state='pending',reason=NULL,scanned_at=NULL WHERE id=?").bind(id).run());
 assert.equal((await db.prepare('SELECT count(*) n FROM backend_versions').first()).n,0);assert.equal((await db.prepare('SELECT count(*) n FROM backend_runs').first()).n,0);
 // Atomic per-project quota bounds quarantined storage; retries do not consume another slot.
 for(let i=3;i<25;i++)await quarantineBackendImport(db,user,project,crypto.randomUUID(),source);
 await assert.rejects(()=>quarantineBackendImport(db,user,project,crypto.randomUUID(),source),e=>e.status===409);
 assert.equal((await scanBackendImports(db)).examined,10);
 console.log('Backend import quarantine passed: immutable ownership/digest, replay, no execution/source disclosure, fail-closed triage, terminal states, bounded jobs and storage quota.');
}finally{await proxy?.dispose();await rm(dir,{recursive:true,force:true});}

// Owner-deferred acceptance; only fixture initialization is aligned here.
Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const bundle=await build({stdin:{resolveDir:process.cwd(),contents:"export {hashToken,newSessionToken} from './src/security';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';export * from './src/cms-pending';export {sendChat,readChat} from './src/chat';export {getBilling} from './src/billing';export {cmsContentAction} from './src/cms-content';export {prepareSiteAction} from './src/site-agent';"},bundle:true,format:'esm',platform:'node',write:false});
const identity=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const {pendingCMSWork,describePendingCMS,cmsPendingRequest,sendChat,readChat,getBilling,cmsContentAction,prepareSiteAction}=identity;
const dir=await mkdtemp('/tmp/whumpo-cms-pending-');let store;
try{
 store=await databaseFixture({d1:true,r2:true});const db=store.db,id=()=>crypto.randomUUID(),owner=id(),other=id(),project=id(),foreign=id();
 const accounts=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
 async function accountAuthority(user){const authority=await workspaceFixture(db,identity,user);accounts.set(user,authority);scopes.set(user,await authority.scope());}
 const now=Date.now(),date=new Date(now).toISOString(),future=new Date(now+86400000).toISOString(),past='2000-01-01T00:00:00.000Z';
 for(const user of [owner,other]){await accountAuthority(user);await db.prepare("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')").bind(user).run();}
 for(const [p,u,name] of [[project,owner,'My publishing space'],[foreign,other,'FOREIGN_NAME_CANARY']])await db.prepare('INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').bind(p,u,name,date,date).run();
 // Read-path fixture: disable only write-admission triggers while seeding all lifecycle states.
 // Production write invariants are covered by the actual import/publication suites.
 const triggers=(await db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND (tbl_name LIKE 'cms_%')").all()).results;
 for(const {name} of triggers)await db.prepare('DROP TRIGGER "'+name+'"').run();
 async function setup(p,u){const review=id();await db.prepare("INSERT INTO cms_setup_reviews(id,project_id,user_id,title,tagline,status,expires_at) VALUES(?,?,?,'Hidden setup title','PRIVATE_TAGLINE','approved',?)").bind(review,p,u,future).run();await db.prepare("INSERT INTO cms_instances(project_id,user_id,review_id,worker_name,database_name,bucket_name) VALUES(?,?,?,?,?,?)").bind(p,u,review,'worker-'+p,'db-'+p,'bucket-'+p).run();return review;}
 const setupId=await setup(project,owner);await setup(foreign,other);
 const draft=id(),saved=id();for(const [d,item] of [[draft,null],[saved,'01ARZ3NDEKTSV4RRFFQ69G5FAV']])await db.prepare("INSERT INTO cms_draft_requests(id,project_id,user_id,collection,body,item_id) VALUES(?,?,?,'posts',?,?)").bind(d,project,owner,JSON.stringify({private:'PRIVATE_ARTICLE_CANARY'}),item).run();
 const edit=id();await db.prepare("INSERT INTO cms_edit_requests(id,draft_request_id,body) VALUES(?,?,'PRIVATE_EDIT_CANARY')").bind(edit,saved).run();
 const source=id();await db.prepare("INSERT INTO cms_wordpress_sources(id,user_id,project_id,filename,digest,size,state) VALUES(?,?,?,'private.xml',?,1,'ready')").bind(source,owner,project,'a'.repeat(64)).run();
 const imported=id();await db.prepare("INSERT INTO cms_import_reviews(id,user_id,project_id,source_digest,source_id,collection,body,provenance,status,source_upload_id,expires_at) VALUES(?,?,?, ?,1,'posts','{}','{}','approved',?,?)").bind(imported,owner,project,'a'.repeat(64),source,past).run();await db.prepare("INSERT INTO cms_draft_requests(id,project_id,user_id,collection,body) VALUES(?,?,?,'posts','{}')").bind(imported,project,owner).run();
 const publication=id();await db.prepare("INSERT INTO cms_publication_reviews(id,draft_request_id,user_id,project_id,collection,item_id,revision,snapshot,preview_html,public_html,digest,status,expires_at) VALUES(?,?,?,?,'posts',?,'rev1','{}','PRIVATE_HTML','PRIVATE_HTML',?,'approved',?)").bind(publication,saved,owner,project,'01ARZ3NDEKTSV4RRFFQ69G5FAV','a'.repeat(64),past).run();
 const unpublish=id(),discard=id();await db.prepare("INSERT INTO cms_unpublish_reviews(id,publication_id,user_id,revision,status,expires_at) VALUES(?,?,?,'rev1','approved',?)").bind(unpublish,publication,owner,past).run();await db.prepare("INSERT INTO cms_discard_reviews(id,publication_id,user_id,revision,snapshot,status,expires_at) VALUES(?,?,?,'rev1','{}','pending',?)").bind(discard,publication,owner,future).run();
 const expired=id();await db.prepare("INSERT INTO cms_setup_reviews(id,project_id,user_id,title,tagline,expires_at) VALUES(?,?,?,'Expired','',?)").bind(expired,project,owner,past).run();
 const imageUpload=id(),sourceUpload=id(),foreignImage=id();
 for(const [upload,p,u] of [[imageUpload,project,owner],[foreignImage,foreign,other]])await db.prepare("INSERT INTO cms_media_uploads(id,user_id,project_id,origin,filename,digest,size,width,height) VALUES(?,?,?,'https://PRIVATE_ORIGIN','PRIVATE_FILENAME.jpg',?,20,1,1)").bind(upload,u,p,'f'.repeat(64)).run();
 await db.prepare("INSERT INTO cms_wordpress_sources(id,user_id,project_id,filename,digest,size) VALUES(?,?,?,'PRIVATE_EXPORT.xml',?,1)").bind(sourceUpload,owner,project,'b'.repeat(64)).run();
 const readOnly={prepare(sql){assert.match(sql,/^(SELECT|WITH)\b/);return db.prepare(sql);}};
 let work=await pendingCMSWork(readOnly,owner,undefined,1,now);assert.deepEqual(work.rows.map(r=>r.kind).sort(),['discard','draft','edit','image-upload','import','publish','setup','source-upload','unpublish']);assert.equal(work.rows.filter(r=>r.id===imported).length,1);assert.ok(work.rows.every(r=>r.id!==expired));assert.equal(work.rows.at(-1).id,discard);
 assert.match(await cmsContentAction(scope(owner),owner,{kind:'cms',operation:'pendingWork',projectId:project},id(),{}),/Unfinished publishing work/);
 await assert.rejects(cmsContentAction(scope(other),other,{kind:'cms',operation:'pendingWork',projectId:project},id(),{}),e=>e.status===404);
 await assert.rejects(cmsContentAction(scope(owner),owner,{kind:'cms',operation:'pendingWork',projectId:project,confirm:true},id(),{}),e=>e.status===400);
 const proposed=await prepareSiteAction(scope(owner),owner,id(),JSON.stringify({reply:'FICTIONAL_CONFIRMATION',action:{kind:'cms',operation:'pendingWork',projectId:project}}),{}, {cmsContent:(action,request)=>cmsContentAction(scope(owner),owner,action,request,{})});assert.match(proposed.reply,/Unfinished publishing work/);assert.ok(!proposed.reply.includes('FICTIONAL_CONFIRMATION'));assert.deepEqual(proposed.statements,[]);
 const text=describePendingCMS(work);for(const canary of ['FOREIGN_NAME_CANARY','PRIVATE_ARTICLE_CANARY','PRIVATE_EDIT_CANARY','PRIVATE_HTML','PRIVATE_TAGLINE','PRIVATE_FILENAME','PRIVATE_EXPORT','PRIVATE_ORIGIN'])assert.ok(!text.includes(canary));assert.ok(text.includes('Saved request: '+imported));assert.ok(!text.includes('/confirm-'));assert.ok(text.includes('/workspace/cms?project='+project));assert.ok(text.includes('Saved request: '+imageUpload));assert.ok(text.includes('Saved request: '+sourceUpload));assert.ok(!text.includes(foreignImage));
 await assert.rejects(pendingCMSWork(readOnly,other,project),e=>e.status===404);assert.equal((await pendingCMSWork(readOnly,other)).rows.length,2);
 await db.prepare('UPDATE cms_discard_reviews SET expires_at=? WHERE id=?').bind(past,discard).run();assert.ok(!(await pendingCMSWork(readOnly,owner)).rows.some(r=>r.id===discard));assert.ok((await pendingCMSWork(readOnly,owner)).rows.some(r=>r.id===publication));
 await db.prepare("UPDATE cms_import_reviews SET status='imported' WHERE id=?").bind(imported).run();await db.prepare("UPDATE cms_edit_requests SET result='{}' WHERE id=?").bind(edit).run();await db.prepare("UPDATE cms_publication_reviews SET status='published' WHERE id=?").bind(publication).run();await db.prepare("UPDATE cms_unpublish_reviews SET status='complete' WHERE id=?").bind(unpublish).run();await db.prepare("UPDATE cms_discard_reviews SET status='complete' WHERE id=?").bind(discard).run();
 await db.prepare("UPDATE cms_media_uploads SET result='{}' WHERE id=?").bind(imageUpload).run();await db.prepare("UPDATE cms_wordpress_sources SET state='ready' WHERE id=?").bind(sourceUpload).run();
 assert.deepEqual((await pendingCMSWork(readOnly,owner)).rows.map(r=>r.kind).sort(),['draft','setup']);
 for(let i=0;i<23;i++)await db.prepare("INSERT INTO cms_draft_requests(id,project_id,user_id,collection,body) VALUES(?,?,?,'posts','{}')").bind(id(),project,owner).run();
 const first=await pendingCMSWork(readOnly,owner,project,1),second=await pendingCMSWork(readOnly,owner,project,2);assert.equal(first.rows.length,20);assert.equal(second.rows.length,5);assert.ok(first.hasMore);assert.equal(second.hasMore,false);assert.equal(new Set([...first.rows,...second.rows].map(r=>r.id)).size,25);assert.match(describePendingCMS(first,project),new RegExp('page 2 of unfinished publishing work for project '+project));
 assert.equal((await pendingCMSWork(readOnly,owner,project,3)).rows.length,0);
 await db.prepare("UPDATE cms_instances SET state='ready',database_id=?,session_namespace_id=?,deployed_version_id=? WHERE project_id=?").bind(id(),id(),id(),project).run();assert.ok((await pendingCMSWork(readOnly,owner)).rows.some(r=>r.id===setupId));
 await db.prepare("INSERT INTO cms_deployments(project_id,account_id,source_digest,secret_digest,origin,tag,state,worker_version_id,platform_version_id) VALUES(?,?,?,?,?,?,'connected',?,?)").bind(project,'a'.repeat(32),'b'.repeat(64),'c'.repeat(64),'https://cms.test','test',id(),id()).run();assert.ok(!(await pendingCMSWork(readOnly,owner)).rows.some(r=>r.id===setupId));

 for(const command of ['/cms-pending','show unfinished publishing work','show pending cms work','/cms-pending all 2','/cms-pending '+project])assert.ok(cmsPendingRequest(command));
 for(const command of ['/cms-pending bad','/cms-pending all 0','/cms-pending all 101','/cms-pending all 1 extra'])assert.ok(cmsPendingRequest(command).error);
 assert.equal(cmsPendingRequest('help me fix unfinished publishing work'),undefined);
 // Restore triggers before exercising the real Chat write path.
 // Dropping these CMS-only triggers never affects the workspace receipt/billing guards.
 for(const {sql} of triggers)await db.prepare(sql).run();
 const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('No inference or provider calls allowed');};
 try{const before=(await getBilling(scope(owner),owner)).standardAI.creditCharge;for(const content of ['/cms-pending','show unfinished publishing work','/cms-pending '+foreign]){const state=await readChat(scope(owner),owner),request=id(),result=await sendChat(scope(owner),owner,{id:request,revision:state.state.revision,content},{baseURL:'https://invalid.example/v1',apiKey:'not-used',model:'not-used',protocol:'responses'});assert.equal(result.status,content.includes(foreign)?404:200);if(result.status===200){const turn=await db.prepare('SELECT mode,status,assistant_text FROM chat_turns WHERE id=?').bind(request).first();assert.equal(turn.mode,'guided');assert.equal(turn.status,'completed');assert.match(turn.assistant_text,/Unfinished publishing work/);const replay=await sendChat(scope(owner),owner,{id:request,revision:state.state.revision,content});assert.equal(replay.status,200);}}assert.equal((await getBilling(scope(owner),owner)).standardAI.creditCharge,before);}finally{globalThis.fetch=originalFetch;}
 console.log('Pending CMS work passed: read-only owner-scoped inventory, nine operation families including private upload recovery, mapped-import deduplication, expiry/completion filtering, deterministic pagination, no content leakage, no auto-confirmation/retry, guided Chat/replay with configured AI and unchanged usage.');
}finally{if(store)await store.close();await rm(dir,{recursive:true,force:true});}

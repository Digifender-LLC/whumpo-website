// Owner-deferred CMS acceptance. Current-schema setup only; do not run without resumption.
import {analyzeWordPress} from '../tools/cms-wordpress-stage.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const {module,identity}=await currentFixtureModules(["src/cms-bridge.ts", "src/cms-deploy.ts", "src/cms-gateway.ts", "src/cms-imports.ts", "src/cms-pending.ts", "src/cms-projects.ts", "src/cms-provision.ts", "src/cms-wordpress-import.ts", "src/cms-wordpress-sources.ts"]);
const {deployCMS,connectCMS}=await module('src/cms-deploy.ts'),{prepareCMS,confirmCMS}=await module('src/cms-projects.ts'),{allocateCMSResources}=await module('src/cms-provision.ts'),{deriveCMSSecret,verifyCMSRequest}=await module('src/cms-bridge.ts');
const dir=await mkdtemp('/tmp/townhello-cms-deploy-');
const store=await databaseFixture({d1:true,r2:true}),db=store.db,id=()=>crypto.randomUUID(),account='a'.repeat(32),master='local-master-fixture-'.repeat(4),digest='b'.repeat(64);
const accounts=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
async function accountAuthority(user){if(!accounts.has(user)){const authority=await workspaceFixture(db,identity,user);accounts.set(user,authority);scopes.set(user,await authority.scope());}return accounts.get(user);}
const fixtureStranger=id();await accountAuthority(fixtureStranger);
async function fixture(){const user=id(),project=id(),now=new Date().toISOString();await accountAuthority(user);await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Deploy fixture','','draft',?,?)").bind(project,user,now,now).run();const review=await prepareCMS(scope(user),user,id(),project,'My CMS','Our updates');await confirmCMS(scope(user),user,review.id);const resources=new Map();await allocateCMSResources(db,project,{accountId:account,find:async(k,n)=>resources.get(k+n)??null,create:async(k,n)=>resources.set(k+n,k==='database'?id():k==='session'?id().replaceAll('-',''):n)});const origin='https://townhello-cms-'+project.replaceAll('-','')+'.whumpo.site',config={projectId:project,ownerId:user,origin,secret:await deriveCMSSecret(master,project,user,origin)};return {user,project,review,config};}
function provider(a){let tag=null,version=null,initialized=false,setupId=null;const p={accountId:account,uploads:0,setups:0,owner:a.user,missingPages:false,unresolved:false,lostUpload:false,exists:async()=>version!==null,deploy:async(_name,t)=>{p.uploads++;if(p.unresolved)throw Error('unknown');tag=t;version=id();if(p.lostUpload)throw Error('lost upload acknowledgement');},activeVersion:async(_name,t)=>tag===t?version:null,replaceVersion:()=>{version=id();},service:{fetch:async request=>{const verified=await verifyCMSRequest(request,a.config);let data;
 if(verified.path==='/_emdash/api/setup/status')data={needsSetup:!initialized};
 else if(verified.path==='/_emdash/api/setup'){assert.deepEqual(JSON.parse(verified.body),{title:'My CMS',tagline:'Our updates',includeContent:false});if(setupId&&setupId!==verified.id)throw Error('unexpected setup ID');if(!initialized)p.setups++;initialized=true;setupId=verified.id;data={setupComplete:true,seedComplete:true};}
 else if(verified.path==='/_emdash/api/auth/me')data={email:p.owner+'@owners.townhello.invalid',role:50};
 else if(verified.path==='/_emdash/api/schema/collections')data={items:p.missingPages?[{slug:'posts'}]:[{slug:'posts'},{slug:'pages'}]};
 else throw Error('unexpected path');return Response.json({success:true,data});}}};return p;}
const {pendingCMSWork}=await module('src/cms-pending.ts');
const {uploadCMSWordPressSource,captureCMSWordPressSource,listCMSWordPressSources,downloadCMSWordPressSource,cmsWordPressSourceKey}=await module('src/cms-wordpress-sources.ts');
try{
 const a=await fixture(),p=provider(a);await deployCMS(db,a.project,digest,a.config,p);await connectCMS(db,a.project,id());
 const env={CMS_BRIDGE_MASTER_KEY:master,['CMS_'+a.project.replaceAll('-','')]:p.service},files=store.env.FILES,bytes=new TextEncoder().encode('<rss><channel><title>Private source</title></channel></rss>'),request=id();let puts=0,reads=0,drop=true;
 const storage={get:async(...args)=>{reads++;return files.get(...args);},put:async(...args)=>{puts++;const result=await files.put(...args);if(drop){drop=false;throw Error('Lost R2 put acknowledgement');}return result;}};
 await assert.rejects(uploadCMSWordPressSource(scope(a.user),storage,a.user,a.project,request,'export.xml',bytes,env),e=>e.status===503);assert.equal(puts,1);
 const listing=await listCMSWordPressSources(scope(a.user),a.user,a.project,env);assert.equal(listing[0].state,'pending');assert.ok(!JSON.stringify(listing).includes('Private source'));
 const unfinished=await pendingCMSWork(scope(a.user),a.user,a.project);assert.equal(unfinished.rows.filter(r=>r.kind==='source-upload'&&r.id===request).length,1);assert.equal(puts,1);
 const saved=await uploadCMSWordPressSource(scope(a.user),storage,a.user,a.project,request,'export.xml',bytes,env);assert.equal(saved.state,'ready');assert.equal(puts,1);
 assert.ok(!(await pendingCMSWork(scope(a.user),a.user,a.project)).rows.some(r=>r.id===request));
 assert.deepEqual(await uploadCMSWordPressSource(scope(a.user),storage,a.user,a.project,id(),'renamed.xml',bytes,env),saved);assert.equal(puts,1);
 assert.deepEqual((await captureCMSWordPressSource(scope(a.user),storage,a.user,request)).bytes,bytes);
 const downloaded=await downloadCMSWordPressSource(scope(a.user),storage,a.user,request);assert.equal(downloaded.headers.get('content-type'),'application/octet-stream');assert.equal(downloaded.headers.get('cache-control'),'private, no-store');assert.match(downloaded.headers.get('content-disposition'),/^attachment;/);assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()),bytes);
 const before=reads;await assert.rejects(captureCMSWordPressSource(scope(fixtureStranger),storage,fixtureStranger,request),e=>e.status===404);assert.equal(reads,before);
 await assert.rejects(uploadCMSWordPressSource(scope(a.user),storage,a.user,a.project,request,'changed.xml',bytes,env),e=>e.status===409);
 await assert.rejects(uploadCMSWordPressSource(scope(a.user),storage,a.user,a.project,request,'export.xml',new TextEncoder().encode('changed'),env),e=>e.status===409);
 await assert.rejects(uploadCMSWordPressSource(scope(a.user),storage,a.user,a.project,id(),'../escape.xml',bytes,env),e=>e.status===400);
 await assert.rejects(uploadCMSWordPressSource(scope(a.user),storage,a.user,a.project,id(),'export.xml',new Uint8Array([255]),env),e=>e.status===400);
 await assert.rejects(uploadCMSWordPressSource(scope(a.user),storage,a.user,a.project,id(),'export.xml',new Uint8Array(1048577),env),e=>e.status===400);
 const row=await db.prepare('SELECT * FROM cms_wordpress_sources WHERE id=?').bind(request).first(),key=cmsWordPressSourceKey(row);
 const changed=bytes.slice();changed[10]^=1;await files.put(key,changed);await assert.rejects(captureCMSWordPressSource(scope(a.user),storage,a.user,request),e=>e.status===503);const priorPuts=puts;await assert.rejects(uploadCMSWordPressSource(scope(a.user),storage,a.user,a.project,request,'export.xml',bytes,env),e=>e.status===503);assert.equal(puts,priorPuts);assert.deepEqual(new Uint8Array(await(await files.get(key)).arrayBuffer()),changed);
 await files.delete(key);const repaired=await uploadCMSWordPressSource(scope(a.user),storage,a.user,a.project,request,'export.xml',bytes,env);assert.equal(repaired.id,request);assert.equal(puts,priorPuts+1);
 await assert.rejects(db.prepare("UPDATE cms_wordpress_sources SET digest=? WHERE id=?").bind('f'.repeat(64),request).run());await assert.rejects(db.prepare('DELETE FROM cms_wordpress_sources WHERE id=?').bind(request).run());
 const {prepareCMSWordPressImport}=await module('src/cms-wordpress-import.ts'),{confirmCMSImport,readCMSImport}=await module('src/cms-imports.ts'),{cmsGateway}=await module('src/cms-gateway.ts');
 const nativeEnv={DB:db,TOWNHELLO_CMS_PROJECT_ID:a.project,TOWNHELLO_CMS_OWNER_ID:a.user,TOWNHELLO_CMS_ORIGIN:a.config.origin,TOWNHELLO_CMS_BRIDGE_KEY:a.config.secret};let nativeWrites=0;
 env['CMS_'+a.project.replaceAll('-','')]={fetch:request=>cmsGateway(request,nativeEnv,async request=>{nativeWrites++;const body=await request.json();return Response.json({success:true,data:{_rev:'rev1',item:{id:'01ARZ3NDEKTSV4RRFFQ69G5FAV',slug:body.slug,status:'draft',version:1,data:body.data}}},{status:201});})};
 const xml='<rss xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>Stored article</title><wp:post_id>7</wp:post_id><wp:post_type>post</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>Preserved source.</p>]]></content:encoded></item></channel></rss>',xmlBytes=new TextEncoder().encode(xml),xmlId=id();
 await uploadCMSWordPressSource(scope(a.user),storage,a.user,a.project,xmlId,'wordpress.xml',xmlBytes,env);
 const review=await prepareCMSWordPressImport(scope(a.user),storage,a.user,a.project,xmlId,7,id(),env,analyzeWordPress);assert.equal(review.source_upload_id,xmlId);assert.equal(nativeWrites,0);
 assert.equal((await prepareCMSWordPressImport(scope(a.user),storage,a.user,a.project,xmlId,7,id(),env,analyzeWordPress)).id,review.id);
 await assert.rejects(prepareCMSWordPressImport(scope(a.user),storage,a.user,a.project,xmlId,99,id(),env,analyzeWordPress),e=>e.status===409);
 await assert.rejects(db.prepare('UPDATE cms_import_reviews SET source_upload_id=? WHERE id=?').bind(request,review.id).run());
 const sourceRow=await db.prepare('SELECT * FROM cms_wordpress_sources WHERE id=?').bind(xmlId).first(),sourceKey=cmsWordPressSourceKey(sourceRow);await files.put(sourceKey,'corrupt');
 await assert.rejects(confirmCMSImport(scope(a.user),a.user,review.id,{...env,FILES:storage}),e=>e.status===503);assert.equal((await readCMSImport(scope(a.user),a.user,review.id)).status,'pending');assert.equal(nativeWrites,0);
 await files.delete(sourceKey);await uploadCMSWordPressSource(scope(a.user),storage,a.user,a.project,xmlId,'wordpress.xml',xmlBytes,env);
 assert.equal((await confirmCMSImport(scope(a.user),a.user,review.id,{...env,FILES:storage})).status,'imported');assert.equal(nativeWrites,1);
 for(let n=0;n<2;n++)await uploadCMSWordPressSource(scope(a.user),storage,a.user,a.project,id(),'batch.xml',new TextEncoder().encode('<rss>'+n+'</rss>'),env);
 const last=await Promise.allSettled([4,5].map(n=>uploadCMSWordPressSource(scope(a.user),storage,a.user,a.project,id(),'batch.xml',new TextEncoder().encode('<rss>'+n+'</rss>'),env)));assert.equal(last.filter(r=>r.status==='fulfilled').length,1);assert.equal((await listCMSWordPressSources(scope(a.user),a.user,a.project,env)).length,5);
 console.log('WordPress source storage passed on actual D1/R2: private bounded bytes, server digest, lost-put recovery, exact/deduplicated upload, ownership before bucket reads, immutable receipts, attachment-only download, corrupt-object refusal, missing-object recovery and concurrent final-slot admission.');
}finally{await store.close();await rm(dir,{recursive:true,force:true});}

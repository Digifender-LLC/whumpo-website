import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {deployCMS,connectCMS}=await module('src/cms-deploy.ts'),{prepareCMS,confirmCMS}=await module('src/cms-projects.ts'),{allocateCMSResources}=await module('src/cms-provision.ts'),{deriveCMSSecret,verifyCMSRequest}=await module('src/cms-bridge.ts');
const dir=await mkdtemp('/tmp/whumpo-cms-deploy-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB,id=()=>crypto.randomUUID(),account='a'.repeat(32),master='local-master-fixture-'.repeat(4),digest='b'.repeat(64);
async function fixture(){const user=id(),project=id(),now=new Date().toISOString();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now).run();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Deploy fixture','','draft',?,?)").bind(project,user,now,now).run();const review=await prepareCMS(db,user,id(),project,'My CMS','Our updates');await confirmCMS(db,user,review.id);const resources=new Map();await allocateCMSResources(db,project,{accountId:account,find:async(k,n)=>resources.get(k+n)??null,create:async(k,n)=>resources.set(k+n,k==='database'?id():k==='session'?id().replaceAll('-',''):n)});const origin='https://whumpo-cms-'+project.replaceAll('-','')+'.whumpo.site',config={projectId:project,ownerId:user,origin,secret:await deriveCMSSecret(master,project,user,origin)};return {user,project,review,config};}
function provider(a){let tag=null,version=null,initialized=false,setupId=null;const p={accountId:account,uploads:0,setups:0,owner:a.user,missingPages:false,unresolved:false,lostUpload:false,exists:async()=>version!==null,deploy:async(_name,t)=>{p.uploads++;if(p.unresolved)throw Error('unknown');tag=t;version=id();if(p.lostUpload)throw Error('lost upload acknowledgement');},activeVersion:async(_name,t)=>tag===t?version:null,replaceVersion:()=>{version=id();},service:{fetch:async request=>{const verified=await verifyCMSRequest(request,a.config);let data;
 if(verified.path==='/_emdash/api/setup/status')data={needsSetup:!initialized};
 else if(verified.path==='/_emdash/api/setup'){assert.deepEqual(JSON.parse(verified.body),{title:'My CMS',tagline:'Our updates',includeContent:false});if(setupId&&setupId!==verified.id)throw Error('unexpected setup ID');if(!initialized)p.setups++;initialized=true;setupId=verified.id;data={setupComplete:true,seedComplete:true};}
 else if(verified.path==='/_emdash/api/auth/me')data={email:p.owner+'@owners.whumpo.invalid',role:50};
 else if(verified.path==='/_emdash/api/schema/collections')data={items:p.missingPages?[{slug:'posts'}]:[{slug:'posts'},{slug:'pages'}]};
 else throw Error('unexpected path');return Response.json({success:true,data});}}};return p;}
const {prepareCMSImport,confirmCMSImport,readCMSImport,cmsImportPage}=await module('src/cms-imports.ts'),{cmsGateway}=await module('src/cms-gateway.ts');
try{
 const a=await fixture(),p=provider(a);await deployCMS(db,a.project,digest,a.config,p);await connectCMS(db,a.project,id());
 let writes=0,drop=false,capable=true;
 const nativeEnv={DB:db,WHUMPO_CMS_PROJECT_ID:a.project,WHUMPO_CMS_OWNER_ID:a.user,WHUMPO_CMS_ORIGIN:a.config.origin,WHUMPO_CMS_BRIDGE_KEY:a.config.secret};
 const env={CMS_BRIDGE_MASTER_KEY:master,['CMS_'+a.project.replaceAll('-','')]:{fetch:async request=>{
  if(!capable&&new URL(request.url).pathname.endsWith('/capabilities'))return Response.json({error:'old'},{status:403});
  const response=await cmsGateway(request,nativeEnv,async request=>{assert.equal(request.method,'POST');assert.ok(request.url.endsWith('/content/posts'));writes++;const body=await request.json();return Response.json({success:true,data:{item:{id:'01ARZ3NDEKTSV4RRFFQ69G5FAV',status:'draft',data:body.data}}},{status:201});});
  if(drop&&request.method==='POST'){drop=false;throw Error('Lost native receipt');}return response;
 }}};
 const candidate={sourceDigest:'c'.repeat(64),sourceId:123,collection:'posts',title:'Imported story',content:[{_type:'block',style:'normal',markDefs:[],children:[{_type:'span',text:'Original story',marks:[]}]}],provenance:{sourceHTML:'<p>Original story</p><script>bad()</script>',author:'Source writer',sourceURL:'https://old.example/story',sourceStatus:'publish',sourceDate:'2026-09-01',sourceSlug:'story'}};
 const {canonicalImportProvenance}=await module('src/cms-import-provenance.ts');
 assert.equal(canonicalImportProvenance(candidate.provenance),JSON.stringify(candidate.provenance));
 for(const extra of [{tags:['x'.repeat(201)]},{categories:Array(51).fill('tag')},{excerpt:'x'.repeat(4001)},{tags:[null]},{unexpected:'field'}])assert.throws(()=>canonicalImportProvenance({...candidate.provenance,...extra}));
 candidate.provenance={...candidate.provenance,excerpt:'<script>excerpt marker</script>',categories:['Research & notes'],tags:['<img onerror=bad()>','Long term']};
 const review=id();capable=false;await assert.rejects(prepareCMSImport(db,a.user,a.project,review,candidate,env),e=>e.status===409);capable=true;
 const row=await prepareCMSImport(db,a.user,a.project,review,candidate,env);assert.equal(row.status,'pending');assert.deepEqual(JSON.parse(row.provenance),candidate.provenance);assert.ok(!row.body.includes('excerpt marker'));assert.equal(writes,0);assert.equal((await db.prepare('SELECT count(*) n FROM cms_draft_requests').first()).n,0);
 assert.equal((await prepareCMSImport(db,a.user,a.project,id(),candidate,env)).id,review);
 await assert.rejects(prepareCMSImport(db,a.user,a.project,id(),{...candidate,title:'Changed'},env),e=>e.status===409);
 await assert.rejects(readCMSImport(db,id(),review),e=>e.status===404);await assert.rejects(confirmCMSImport(db,id(),review,env),e=>e.status===404);
 await assert.rejects(db.prepare("INSERT INTO cms_draft_requests(id,project_id,user_id,collection,body,content_format) VALUES(?,?,?,'posts',?,'structured')").bind(review,a.project,a.user,row.body).run());
 const page=await cmsImportPage(db,a.user,review),html=await page.text();assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('Research &amp; notes'));assert.ok(html.includes('&lt;img onerror=bad()&gt;'));assert.ok(html.includes('excerpt marker'));assert.ok(!html.includes('<img'));assert.match(page.headers.get('content-security-policy'),/sandbox/);
 await assert.rejects(db.prepare("UPDATE cms_import_reviews SET status='imported' WHERE id=?").bind(review).run());
 await assert.rejects(db.prepare("UPDATE cms_import_reviews SET provenance='{}' WHERE id=?").bind(review).run());
 drop=true;await assert.rejects(confirmCMSImport(db,a.user,review,env),e=>e.status===503);assert.equal(writes,1);assert.equal((await readCMSImport(db,a.user,review)).status,'approved');
 assert.equal((await confirmCMSImport(db,a.user,review,env)).status,'imported');assert.equal(writes,1);assert.equal((await db.prepare('SELECT count(*) n FROM cms_draft_requests').first()).n,1);
 capable=false;assert.equal((await confirmCMSImport(db,a.user,review,env)).status,'imported');assert.equal(writes,1);capable=true;
 await assert.rejects(db.prepare('DELETE FROM cms_import_reviews WHERE id=?').bind(review).run());
 const expired=id();await db.prepare("INSERT INTO cms_import_reviews(id,user_id,project_id,source_digest,source_id,collection,body,provenance,expires_at) VALUES(?,?,?, ?,124,'posts',?,?,'2000-01-01T00:00:00.000Z')").bind(expired,a.user,a.project,candidate.sourceDigest,row.body,row.provenance).run();await assert.rejects(confirmCMSImport(db,a.user,expired,env),e=>e.status===409);assert.equal(writes,1);
 const renewed=await prepareCMSImport(db,a.user,a.project,id(),{...candidate,sourceId:124},env);assert.equal(renewed.status,'pending');assert.equal((await readCMSImport(db,a.user,expired)).status,'superseded');await assert.rejects(confirmCMSImport(db,a.user,expired,env),e=>e.status===409);
 const competing=await Promise.all([id(),id()].map(request=>prepareCMSImport(db,a.user,a.project,request,{...candidate,sourceId:127},env)));assert.equal(competing[0].id,competing[1].id);
 const pending=await prepareCMSImport(db,a.user,a.project,id(),{...candidate,sourceId:125},env);
 for(let n=0;n<89;n++)await db.prepare("INSERT INTO cms_draft_requests(id,project_id,user_id,collection,body,content_format) VALUES(?,?,?,'posts',?,'structured')").bind(id(),a.project,a.user,row.body).run();
 await assert.rejects(confirmCMSImport(db,a.user,pending.id,env),e=>e.status===409);assert.equal((await readCMSImport(db,a.user,pending.id)).status,'pending');assert.equal(writes,1);assert.equal(await db.prepare('SELECT id FROM cms_draft_requests WHERE id=?').bind(pending.id).first(),null);
 await assert.rejects(prepareCMSImport(db,a.user,a.project,id(),{...candidate,sourceId:126,content:[...candidate.content,{_type:'image',_key:'img',asset:{_ref:'01ARZ3NDEKTSV4RRFFQ69G5FAV'},alt:'Photo'}]},env),e=>e.status===400);
 console.log('Import reviews passed on actual D1: private immutable provenance, source deduplication, tenant isolation, no draft before approval, exact lost-response recovery, no duplicate native write, completed replay, expiry, atomic capacity rollback and image denial.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}

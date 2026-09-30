import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}

export async function verifyMappedImport(native){
const {deployCMS,connectCMS}=await module('src/cms-deploy.ts'),{prepareCMS,confirmCMS}=await module('src/cms-projects.ts'),{allocateCMSResources}=await module('src/cms-provision.ts'),{deriveCMSSecret,verifyCMSRequest}=await module('src/cms-bridge.ts');
const dir=await mkdtemp('/tmp/townhello-cms-deploy-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB,id=()=>crypto.randomUUID(),account='a'.repeat(32),master='local-master-fixture-'.repeat(4),digest='b'.repeat(64);
async function fixture(){const user=native?.identity.ownerId??id(),project=native?.identity.projectId??id(),now=new Date().toISOString();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now).run();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Deploy fixture','','draft',?,?)").bind(project,user,now,now).run();const review=await prepareCMS(db,user,id(),project,'My CMS','Our updates');await confirmCMS(db,user,review.id);const resources=new Map();await allocateCMSResources(db,project,{accountId:account,find:async(k,n)=>resources.get(k+n)??null,create:async(k,n)=>resources.set(k+n,k==='database'?id():k==='session'?id().replaceAll('-',''):n)});const origin='https://townhello-cms-'+project.replaceAll('-','')+'.whumpo.site',config={projectId:project,ownerId:user,origin,secret:await deriveCMSSecret(master,project,user,origin)};return {user,project,review,config};}
function provider(a){let tag=null,version=null,initialized=false,setupId=null;const p={accountId:account,uploads:0,setups:0,owner:a.user,missingPages:false,unresolved:false,lostUpload:false,exists:async()=>version!==null,deploy:async(_name,t)=>{p.uploads++;if(p.unresolved)throw Error('unknown');tag=t;version=id();if(p.lostUpload)throw Error('lost upload acknowledgement');},activeVersion:async(_name,t)=>tag===t?version:null,replaceVersion:()=>{version=id();},service:{fetch:async request=>{const verified=await verifyCMSRequest(request,a.config);let data;
 if(verified.path==='/_emdash/api/setup/status')data={needsSetup:!initialized};
 else if(verified.path==='/_emdash/api/setup'){assert.deepEqual(JSON.parse(verified.body),{title:'My CMS',tagline:'Our updates',includeContent:false});if(setupId&&setupId!==verified.id)throw Error('unexpected setup ID');if(!initialized)p.setups++;initialized=true;setupId=verified.id;data={setupComplete:true,seedComplete:true};}
 else if(verified.path==='/_emdash/api/auth/me')data={email:p.owner+'@owners.townhello.invalid',role:50};
 else if(verified.path==='/_emdash/api/schema/collections')data={items:p.missingPages?[{slug:'posts'}]:[{slug:'posts'},{slug:'pages'}]};
 else throw Error('unexpected path');return Response.json({success:true,data});}}};return p;}
const {prepareCMSImport,confirmCMSImport,readCMSImport,cmsImportPage}=await module('src/cms-imports.ts'),{cmsGateway}=await module('src/cms-gateway.ts');
 const {pendingCMSWork}=await module('src/cms-pending.ts');
 const {prepareCMSWordPressImport}=await module('src/cms-wordpress-import.ts'),{analyzeWordPress}=await module('src/cms-wordpress-analysis.ts'),{uploadCMSWordPressSource}=await module('src/cms-wordpress-sources.ts'),{listCMSDrafts,readCMSDraft,createCMSDraft}=await module('src/cms-content.ts'),{signCMSRequest,callCMS}=await module('src/cms-bridge.ts');
 try{
  const beforePosts=native?.db?(await native.db.prepare('SELECT count(*) n FROM ec_posts').first()).n:null;
  const a=await fixture(),p=provider(a);await deployCMS(db,a.project,digest,a.config,p);await connectCMS(db,a.project,id());
  let seq=0,dropAssignment=false,unsupported=false,posts=0;
  const nativeEnv={DB:db,TOWNHELLO_CMS_PROJECT_ID:a.project,TOWNHELLO_CMS_OWNER_ID:a.user,TOWNHELLO_CMS_ORIGIN:a.config.origin,TOWNHELLO_CMS_BRIDGE_KEY:a.config.secret};
  const documents=new Map(),defs=new Map(),terms=new Map();
  if(!native)for(const sql of [
   'CREATE TABLE ec_posts(id TEXT PRIMARY KEY,slug TEXT,status TEXT,version INTEGER,locale TEXT,translation_group TEXT,deleted_at TEXT,draft_revision_id TEXT,live_revision_id TEXT,published_at TEXT,scheduled_at TEXT,updated_at TEXT)',
   'CREATE TABLE content_taxonomies(collection TEXT,entry_id TEXT,taxonomy_id TEXT,PRIMARY KEY(collection,entry_id,taxonomy_id))',
   'CREATE TABLE taxonomies(id TEXT PRIMARY KEY,name TEXT,slug TEXT,label TEXT,locale TEXT,translation_group TEXT,parent_id TEXT,data TEXT)',
   'CREATE TABLE _emdash_taxonomy_defs(name TEXT,locale TEXT,translation_group TEXT,label TEXT,label_singular TEXT)',
   'CREATE TABLE _emdash_taxonomy_def_groups(id TEXT,name TEXT,collections TEXT,hierarchical INTEGER)',
  ])await db.prepare(sql).run();
  async function dispatch(request){
   const path=new URL(request.url).pathname,body=request.method==='GET'?null:await request.json();let data;
   const termPath=/^\/_emdash\/api\/taxonomies\/(categories|tags)\/terms(?:\/([^/]+))?$/.exec(path),definition=/^\/_emdash\/api\/taxonomies\/(categories|tags)$/.exec(path);
   if(path==='/_emdash/api/taxonomies'){
    if(defs.has(body.name))return Response.json({error:'exists'},{status:409});const taxonomy={id:String(++seq).padStart(26,'0'),...body};defs.set(body.name,taxonomy);
    await db.prepare("INSERT INTO _emdash_taxonomy_defs VALUES(?,'en',?,?,?)").bind(body.name,taxonomy.id,body.label,body.labelSingular).run();await db.prepare('INSERT INTO _emdash_taxonomy_def_groups VALUES(?,?,?,?)').bind(taxonomy.id,body.name,JSON.stringify(body.collections),body.hierarchical?1:0).run();data={taxonomy};
   }else if(definition)data={taxonomy:defs.get(definition[1])};
   else if(termPath){const name=termPath[1],slug=termPath[2]??body.slug,key=name+'/'+slug;
    if(request.method==='POST'){if(terms.has(key))return Response.json({error:'exists'},{status:409});const term={id:String(++seq).padStart(26,'0'),name,...body,parentId:null,description:''};terms.set(key,term);await db.prepare("INSERT INTO taxonomies VALUES(?,?,?,?,'en',?,NULL,NULL)").bind(term.id,name,slug,body.label,term.id).run();}
    data={term:terms.get(key)};
   }else if(path==='/_emdash/api/content/posts'){
    posts++;const item={id:String(++seq).padStart(26,'0'),slug:body.slug,status:'draft',version:1,locale:'en',data:body.data};documents.set(item.id,item);await db.prepare("INSERT INTO ec_posts VALUES(?,?,'draft',1,'en',?,NULL,NULL,NULL,NULL,NULL,'initial')").bind(item.id,item.slug,item.id).run();data={item,_rev:'rev1'};
   }else if(path.startsWith('/_emdash/api/content/posts/')){const key=path.split('/').at(-1),item=documents.get(key)||[...documents.values()].find(d=>d.slug===key);data={item,_rev:'rev1'};}
   else throw Error('Unexpected native path '+path);
   return Response.json({success:true,data});
  }
  const service={fetch:async request=>{
   const verified=await verifyCMSRequest(request,a.config);
   if(unsupported&&verified.path.endsWith('/capabilities'))return Response.json({success:true,data:{}});
   // Actual-artifact fixture uses its own fixed test origin/key, after verifying the control signature.
   const response=native?await native.service.fetch(await signCMSRequest(native.identity,verified.path,verified.id,request.method==='GET'?undefined:JSON.parse(verified.body))):await cmsGateway(request,nativeEnv,dispatch);
   if(dropAssignment&&verified.path.endsWith('/import-taxonomies')){dropAssignment=false;throw Error('Lost assignment response');}return response;
  }};
  const env={FILES:proxy.env.FILES,CMS_BRIDGE_MASTER_KEY:master,['CMS_'+a.project.replaceAll('-','')]:service};
  const xml=(itemId,label='Studio notes')=>`<rss xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><wp:wxr_version>1.2</wp:wxr_version><language>en</language><wp:category><wp:term_id>1</wp:term_id><wp:category_nicename>studio-notes</wp:category_nicename><wp:cat_name>${label}</wp:cat_name></wp:category><wp:tag><wp:term_id>2</wp:term_id><wp:tag_slug>import-tests</wp:tag_slug><wp:tag_name>Import tests</wp:tag_name></wp:tag><item><title>Mapped import ${itemId}</title><wp:post_id>${itemId}</wp:post_id><wp:post_type>post</wp:post_type><wp:status>draft</wp:status><content:encoded><![CDATA[<p>Keep my article.</p>]]></content:encoded><category domain="category" nicename="studio-notes">${label}</category><category domain="post_tag" nicename="import-tests">Import tests</category></item></channel></rss>`;
  const prepare=async(n,label)=>{const bytes=new TextEncoder().encode(xml(n,label)),source=await uploadCMSWordPressSource(db,env.FILES,a.user,a.project,id(),'source.xml',bytes,env);return prepareCMSWordPressImport(db,env.FILES,a.user,a.project,source.id,n,id(),env,analyzeWordPress);};
  const first=await prepare(1);assert.equal(JSON.parse(first.taxonomy_plan).length,2);assert.equal((await listCMSDrafts(db,a.user,a.project,env)).length,0);
  assert.match(await(await cmsImportPage(db,a.user,first.id)).text(),/will be attached to the private post/);
  await assert.rejects(confirmCMSImport(db,id(),first.id,env),e=>e.status===404);
  await assert.rejects(db.prepare("UPDATE cms_import_reviews SET taxonomy_plan='[]' WHERE id=?").bind(first.id).run());
  unsupported=true;await assert.rejects(confirmCMSImport(db,a.user,first.id,env),e=>e.status===409);assert.equal((await readCMSImport(db,a.user,first.id)).status,'pending');unsupported=false;
  dropAssignment=true;await assert.rejects(confirmCMSImport(db,a.user,first.id,env),e=>e.status===503);
  const job=await db.prepare('SELECT * FROM cms_import_taxonomy_jobs WHERE review_id=?').bind(first.id).first();assert.equal(job.state,'prepared');assert.equal((await pendingCMSWork(db,a.user)).rows.filter(r=>r.id===first.id&&r.kind==='import').length,1);const nativeId=JSON.parse(job.body).itemId;
  assert.equal((await listCMSDrafts(db,a.user,a.project,env)).length,0);await assert.rejects(readCMSDraft(db,a.user,a.project,first.id,env),e=>e.status===404);
  const data=JSON.parse(first.body).data;await assert.rejects(createCMSDraft(db,a.user,a.project,first.id,'posts',data.title,data.content,env,'structured'),e=>e.status===409);
  await assert.rejects(db.prepare('UPDATE cms_draft_requests SET item_id=? WHERE id=?').bind(nativeId,first.id).run());
  await assert.rejects(db.prepare("UPDATE cms_import_taxonomy_jobs SET body='{}' WHERE review_id=?").bind(first.id).run());
  assert.equal((await confirmCMSImport(db,a.user,first.id,env)).status,'imported');assert.equal((await listCMSDrafts(db,a.user,a.project,env)).length,1);assert.ok(!(await pendingCMSWork(db,a.user)).rows.some(r=>r.id===first.id));assert.equal((await readCMSDraft(db,a.user,a.project,first.id,env)).item.id,nativeId);
  assert.equal((await confirmCMSImport(db,a.user,first.id,env)).status,'imported');
  const conflict=await prepare(2,'Renamed source category');await assert.rejects(confirmCMSImport(db,a.user,conflict.id,env),e=>e.status===503);assert.equal((await readCMSImport(db,a.user,conflict.id)).status,'approved');assert.equal(await db.prepare('SELECT * FROM cms_import_taxonomy_jobs WHERE review_id=?').bind(conflict.id).first(),null);
  const lost=await prepare(3);let dropped=false;const lostDB=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{const result=await target.batch(statements);if(!dropped){dropped=true;throw Error('Lost completion acknowledgement');}return result;};const v=target[key];return typeof v==='function'?v.bind(target):v;}});
  assert.equal((await confirmCMSImport(lostDB,a.user,lost.id,env)).status,'imported');assert.ok(dropped);
  const atomic=await prepare(4);await db.prepare(`CREATE TRIGGER fail_import_completion BEFORE UPDATE OF status ON cms_import_reviews WHEN NEW.id='${atomic.id}' AND NEW.status='imported' BEGIN SELECT RAISE(ABORT,'fixture failure'); END`).run();await assert.rejects(confirmCMSImport(db,a.user,atomic.id,env),e=>e.status===503);
  assert.equal((await db.prepare('SELECT item_id FROM cms_draft_requests WHERE id=?').bind(atomic.id).first()).item_id,null);assert.equal((await db.prepare('SELECT state FROM cms_import_taxonomy_jobs WHERE review_id=?').bind(atomic.id).first()).state,'prepared');await db.prepare('DROP TRIGGER fail_import_completion').run();assert.equal((await confirmCMSImport(db,a.user,atomic.id,env)).status,'imported');
  const race=await prepare(5);await Promise.allSettled([confirmCMSImport(db,a.user,race.id,env),confirmCMSImport(db,a.user,race.id,env)]);assert.equal((await confirmCMSImport(db,a.user,race.id,env)).status,'imported');
  assert.equal((await listCMSDrafts(db,a.user,a.project,env)).length,4);
  if(!native){assert.equal(posts,4);assert.equal((await db.prepare('SELECT count(*) n FROM content_taxonomies').first()).n,8);}
  else {if(native.db)assert.equal((await native.db.prepare('SELECT count(*) n FROM ec_posts').first()).n,beforePosts+4);}
  if(native)for(const r of [first,lost,atomic,race]){const draft=await readCMSDraft(db,a.user,a.project,r.id,env);assert.equal(draft.item.version,2);for(const name of ['categories','tags']){const mapped=await callCMS(service,a.config,'/_emdash/api/content/posts/'+draft.item.id+'/terms/'+name,id());assert.equal(mapped.terms.length,1);assert.equal(mapped.terms[0].slug,name==='categories'?'studio-notes':'import-tests');}}
  console.log((native?'Actual native':'Disposable D1')+' mapped import passed: source-bound review, explicit approval, capability gate, exact existing-term reconciliation, conflicting-label refusal, lost assignment/completion recovery, atomic visibility, generic retry denial, concurrent confirmation and no duplicate posts.');
 }finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])await verifyMappedImport();

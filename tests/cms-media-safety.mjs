// WH-013 benign local safety verification only. Synthetic JPEGs, synthetic native replies and synthetic
// scan evidence on disposable D1/R2. This is not CMS feature acceptance, live CMS testing or detector testing.
Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const {module,identity}=await currentFixtureModules(['src/cms-bridge.ts','src/cms-content-shape.ts','src/cms-deploy.ts','src/cms-gateway.ts','src/cms-imports.ts','src/cms-media-preview.ts','src/cms-media-uploads.ts','src/cms-media.ts','src/cms-preview.ts','src/cms-projects.ts','src/cms-provision.ts','src/cms-publication.ts','src/cms-wordpress-import.ts','src/cms-wordpress-sources.ts','src/photo-format.ts','src/photo-scan-results.ts','src/site-host.ts']);
const {deployCMS,connectCMS}=await module('src/cms-deploy.ts'),{prepareCMS,confirmCMS}=await module('src/cms-projects.ts'),{allocateCMSResources}=await module('src/cms-provision.ts'),{deriveCMSSecret,verifyCMSRequest}=await module('src/cms-bridge.ts');
const {cmsGateway}=await module('src/cms-gateway.ts'),{uploadCMSMedia,readCMSUploads}=await module('src/cms-media-uploads.ts'),{listCMSMedia}=await module('src/cms-media.ts'),{readCMSMediaPreview}=await module('src/cms-media-preview.ts');
const {cmsPreview}=await module('src/cms-preview.ts'),{prepareCMSPublication,confirmCMSPublication,cmsPublicationPage}=await module('src/cms-publication.ts'),{default:siteHost}=await module('src/site-host.ts');
const {reservePhotoScan,recordPhotoScan}=await module('src/photo-scan-results.ts'),{cleanPhoto}=await module('src/photo-format.ts'),{cmsDraftBody}=await module('src/cms-content-shape.ts');
const {uploadCMSWordPressSource}=await module('src/cms-wordpress-sources.ts'),{prepareCMSWordPressMediaImport}=await module('src/cms-wordpress-import.ts'),{cmsImportPage}=await module('src/cms-imports.ts');
const dir=await mkdtemp('/tmp/whumpo-cms-media-safety-'),store=await databaseFixture({d1:true,r2:true}),db=store.db,files=store.env.FILES,id=()=>crypto.randomUUID();
const account='a'.repeat(32),master='local-master-fixture-'.repeat(4),scopes=new Map(),scope=user=>scopes.get(user);
let checks=0;const check=async(label,fn)=>{await fn();checks++;};
const held=e=>e.status===423&&/held for a safety review/.test(e.message),blocked=e=>e.status===423&&/did not pass/.test(e.message);
async function account_(user){const authority=await workspaceFixture(db,identity,user);scopes.set(user,await authority.scope());}
try{
 // Current fixture setup: an owned, connected CMS instance (no live provisioning, no Cloudflare calls).
 const user=id(),project=id(),stranger=id(),now=new Date().toISOString();await account_(user);await account_(stranger);
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Safety fixture','','draft',?,?)").bind(project,user,now,now).run();
 const setup=await prepareCMS(scope(user),user,id(),project,'My CMS','Our updates');await confirmCMS(scope(user),user,setup.id);
 const resources=new Map();await allocateCMSResources(db,project,{accountId:account,find:async(k,n)=>resources.get(k+n)??null,create:async(k,n)=>resources.set(k+n,k==='database'?id():k==='session'?id().replaceAll('-',''):n)});
 const origin='https://townhello-cms-'+project.replaceAll('-','')+'.whumpo.site',config={projectId:project,ownerId:user,origin,secret:await deriveCMSSecret(master,project,user,origin)};
 let tag=null,version=null,initialized=false;
 const provider={accountId:account,exists:async()=>version!==null,deploy:async(_n,t)=>{tag=t;version=id();},activeVersion:async(_n,t)=>tag===t?version:null,service:{fetch:async request=>{const v=await verifyCMSRequest(request,config);let data;
  if(v.path==='/_emdash/api/setup/status')data={needsSetup:!initialized};else if(v.path==='/_emdash/api/setup'){initialized=true;data={setupComplete:true,seedComplete:true};}
  else if(v.path==='/_emdash/api/auth/me')data={email:user+'@owners.townhello.invalid',role:50};else if(v.path==='/_emdash/api/schema/collections')data={items:[{slug:'posts'},{slug:'pages'}]};else throw Error('unexpected setup path');
  return Response.json({success:true,data});}}};
 await deployCMS(db,project,'b'.repeat(64),config,provider);await connectCMS(db,project,id());

 // Synthetic native CMS: exact uploaded bytes by native ID, articles and a metadata listing.
 const jpeg=async(name,rgb)=>{execFileSync('python3',['-c',`from PIL import Image; import sys; Image.new('RGB',(32,24),(${rgb})).save(sys.argv[1])`,dir+'/'+name]);return new Uint8Array(await readFile(dir+'/'+name));};
 const ids=['01ARZ3NDEKTSV4RRFFQ69G5FAV','01ARZ3NDEKTSV4RRFFQ69G5FAW','01ARZ3NDEKTSV4RRFFQ69G5FAX','01ARZ3NDEKTSV4RRFFQ69G5FAY'],nativeOnly='01ARZ3NDEKTSV4RRFFQ69G5FAZ';
 const native=new Map(),articles=new Map(),tamper=new Set();let previewReads=0,publishes=0,nextUpload=0;
 const nativeEnv={DB:db,TOWNHELLO_CMS_PROJECT_ID:project,TOWNHELLO_CMS_OWNER_ID:user,TOWNHELLO_CMS_ORIGIN:origin,TOWNHELLO_CMS_BRIDGE_KEY:config.secret};
 const dispatch=async request=>{const path=new URL(request.url).pathname+new URL(request.url).search;
  if(request.method==='POST'&&path==='/_emdash/api/media'){const file=(await request.formData()).get('file'),bytes=new Uint8Array(await file.arrayBuffer()),photo=cleanPhoto(bytes),mediaId=ids[nextUpload++];native.set(mediaId,bytes);return Response.json({success:true,data:{item:{id:mediaId,status:'ready',filename:file.name,mimeType:'image/jpeg',size:bytes.length,width:photo.width,height:photo.height}}},{status:201});}
  if(request.method==='GET'&&path.startsWith('/_emdash/api/media?'))return Response.json({success:true,data:{items:[...native.keys(),nativeOnly].map(m=>({id:m,filename:m+'.jpg',mimeType:'image/jpeg',size:native.get(m)?.length??100,width:32,height:24})),totalCount:native.size+1}});
  const content=path.match(/^\/_emdash\/api\/content\/posts\/([0-9A-Z]{26})(\/publish)?$/);
  if(content){const article=articles.get(content[1]);if(content[2]){publishes++;article.item={...article.item,status:'published'};}return Response.json({success:true,data:{item:article.item,_rev:article.rev}});}
  throw Error('unexpected native path '+request.method+' '+path);};
 const binding='CMS_'+project.replaceAll('-','');
 const env={CMS_BRIDGE_MASTER_KEY:master,FILES:files,[binding]:{fetch:async request=>{
  if(request.method==='GET'&&new URL(request.url).pathname.endsWith('/preview')){const v=await verifyCMSRequest(request,config),mediaId=v.path.split('/')[5];previewReads++;const body=native.get(mediaId).slice();if(tamper.has(mediaId))body[body.length-4]^=1;return new Response(body,{headers:{'content-type':'image/jpeg'}});}
  return cmsGateway(request,nativeEnv,dispatch);}}};

 const photoA=await jpeg('a.jpg','80,120,60'),photoB=await jpeg('b.jpg','30,60,140'),photoC=await jpeg('c.jpg','140,40,40');
 const uploadA=id(),uploadB=id(),uploadC=id();
 const a=await uploadCMSMedia(scope(user),user,project,uploadA,photoA,'a.jpg',env),b=await uploadCMSMedia(scope(user),user,project,uploadB,photoB,'b.jpg',env),c=await uploadCMSMedia(scope(user),user,project,uploadC,photoC,'c.jpg',env);
 const [mA,mB,mC]=[a.result.mediaId,b.result.mediaId,c.result.mediaId];
 const instancesBefore=Number((await db.prepare('SELECT count(*) n FROM cms_instances').first()).n);
 const safetyOf=async upload=>(await db.prepare('SELECT * FROM cms_media_safety WHERE upload_id=?').bind(upload).first());

 await check('every new receipt starts pending, bound to the exact cleaned digest and policy',async()=>{
  for(const [upload,bytes] of [[uploadA,photoA],[uploadB,photoB]]){const row=await safetyOf(upload),digest=Buffer.from(await crypto.subtle.digest('SHA-256',cleanPhoto(bytes).bytes)).toString('hex');
   assert.equal(row.state,'pending');assert.equal(row.digest,digest);assert.equal(row.policy_version,'2026-09-30');assert.equal(row.csam_check,'unknown');assert.equal(row.project_id,project);}
  assert.equal(a.safety,'pending');assert.ok((await readCMSUploads(scope(user),user,project,env)).uploads.every(u=>u.safety==='pending'));
 });
 await check('missing coverage: a native item without a Whumpo receipt is pending in metadata and denied as bytes',async()=>{
  const listing=await listCMSMedia(scope(user),user,project,1,env);assert.deepEqual(Object.fromEntries(listing.items.map(i=>[i.id,i.safety])),{[mA]:'pending',[mB]:'pending',[mC]:'pending',[nativeOnly]:'pending'});
  native.set(nativeOnly,photoA);const before=previewReads;await assert.rejects(readCMSMediaPreview(scope(user),user,project,nativeOnly,env),held);assert.equal(previewReads,before);native.delete(nativeOnly);
 });
 await check('client/model/upload paths cannot mint, rewrite or remove clearance',async()=>{
  await assert.rejects(db.prepare("INSERT INTO cms_media_safety(upload_id,user_id,project_id,digest,policy_version,state,csam_check,sexual_check,scanner_reference,expires_at) VALUES(?,?,?,?,'2026-09-30','approved','clear','clear','forged','2099-01-01T00:00:00Z')").bind(id(),user,project,'f'.repeat(64)).run());
  await assert.rejects(db.prepare("UPDATE cms_media_safety SET state='approved' WHERE upload_id=?").bind(uploadA).run());
  await assert.rejects(db.prepare("UPDATE cms_media_safety SET digest=? WHERE upload_id=?").bind('f'.repeat(64),uploadA).run());
  await assert.rejects(db.prepare("UPDATE cms_media_safety SET policy_version='2026-10-01' WHERE upload_id=?").bind(uploadA).run());
  await assert.rejects(db.prepare('DELETE FROM cms_media_safety WHERE upload_id=?').bind(uploadA).run());
  await assert.rejects(reservePhotoScan(db,'cms',stranger,uploadA),e=>e.status===404);
 });

 // Pending content denies every alias before bytes leave the control plane.
 const image=m=>({_type:'image',_key:'k'+m.slice(-2),asset:{_ref:m},alt:'Synthetic image'}),para={_type:'block',style:'normal',markDefs:[],children:[{_type:'span',text:'A synthetic story.',marks:[]}]};
 const draftFor=async(item,mediaId)=>{const draft=id();articles.set(item,{rev:'rev-'+item,item:{id:item,status:'draft',data:{title:'Story '+item.slice(-2),content:[para,image(mediaId)]}}});
  await db.prepare("INSERT INTO cms_draft_requests(id,project_id,user_id,collection,body) VALUES(?,?,?,'posts',?)").bind(draft,project,user,JSON.stringify(cmsDraftBody('Story','Text'))).run();
  await db.prepare('UPDATE cms_draft_requests SET item_id=? WHERE id=?').bind(item,draft).run();return draft;};
 const draftA=await draftFor('01ARZ3NDEKTSV4RRFFQ69G5FB1',mA),draftB=await draftFor('01ARZ3NDEKTSV4RRFFQ69G5FB2',mB);
 const host=(path,method='GET')=>siteHost.fetch(new Request(`https://${project}.whumpo.site${path}`,{method}),{DB:db,FILES:files});
 await check('pending: owner preview, draft preview and publication review are held; no review, freeze or native publish occurs',async()=>{
  const before=previewReads;await assert.rejects(readCMSMediaPreview(scope(user),user,project,mA,env),held);assert.equal(previewReads,before);
  await assert.rejects(cmsPreview(scope(user),user,project,draftA,env),held);
  await assert.rejects(prepareCMSPublication(scope(user),user,project,draftA,id(),env),held);
  assert.equal(Number((await db.prepare('SELECT count(*) n FROM cms_publication_reviews').first()).n),0);assert.equal((await files.list()).objects.filter(o=>o.key.startsWith('cms-publications/')).length,0);assert.equal(publishes,0);
 });
 await check('SQL admission refuses a publication manifest naming uncleared media even when the receipt matches',async()=>{
  const receipt=await db.prepare('SELECT digest,size,width,height FROM cms_media_uploads WHERE id=?').bind(uploadA).first();
  await assert.rejects(db.prepare("INSERT INTO cms_publication_reviews(id,draft_request_id,user_id,project_id,collection,item_id,revision,snapshot,preview_html,public_html,digest,media_manifest) VALUES(?,?,?,?,'posts',?,'r',?,'p','p',?,?)").bind(id(),draftA,user,project,'01ARZ3NDEKTSV4RRFFQ69G5FB1',JSON.stringify({item:{data:{title:'x',content:[image(mA)]}}}),'c'.repeat(64),JSON.stringify([{mediaId:mA,...receipt}])).run(),/cms_media_safety_required/);
 });

 // WordPress mapped media: preparing a private review is allowed, but the comparison inlines bytes and is held.
 const sourceHTML='<!-- wp:paragraph --><p>A local story.</p><!-- /wp:paragraph --><!-- wp:image {"id":2} --><figure class="wp-block-image"><img src="https://old.example/image.jpg" alt="Bread"/><figcaption>Fresh bread</figcaption></figure><!-- /wp:image -->';
 const wxr=new TextEncoder().encode(`<rss xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>Story</title><wp:post_id>1</wp:post_id><wp:post_type>post</wp:post_type><wp:status>draft</wp:status><content:encoded><![CDATA[${sourceHTML}]]></content:encoded></item><item><title>Photo</title><wp:post_id>2</wp:post_id><wp:post_type>attachment</wp:post_type><wp:attachment_url>https://old.example/image.jpg</wp:attachment_url></item></channel></rss>`);
 const source=await uploadCMSWordPressSource(scope(user),files,user,project,id(),'images.xml',wxr,env);
 const importReview=await prepareCMSWordPressMediaImport(scope(user),files,user,project,source.id,1,id(),[{position:0,mediaId:mA}],env);
 await check('WordPress mapped media: the private comparison alias is held while pending',async()=>{assert.equal(importReview.status,'pending');await assert.rejects(cmsImportPage(scope(user),user,importReview.id,env),held);});

 // Trusted synthetic clearance through the existing photo scan ticket contract.
 const evidence=(t,csam='clear',sexual='clear')=>({digest:t.digest,policyVersion:t.policyVersion,csam:{verdict:csam,reference:'synthetic-csam'},sexual:{verdict:sexual,reference:'synthetic-sexual'}});
 const ticketA=await reservePhotoScan(db,'cms',user,uploadA);
 await check('incomplete coverage (inconclusive check) stays held and creates no clearance',async()=>{
  const ticketC=await reservePhotoScan(db,'cms',user,uploadC),result=await recordPhotoScan(db,ticketC.id,ticketC.authority,evidence(ticketC,'clear','inconclusive'));
  assert.equal(result.outcome,'held');assert.equal((await safetyOf(uploadC)).state,'pending');await assert.rejects(readCMSMediaPreview(scope(user),user,project,mC,env),held);
  await assert.rejects(recordPhotoScan(db,ticketA.id,ticketA.authority,{...evidence(ticketA),digest:'f'.repeat(64)}),e=>e.status===409);
 });
 await check('clear evidence approves only the exact receipt; owner preview releases exact bytes and rejects changed native bytes',async()=>{
  const result=await recordPhotoScan(db,ticketA.id,ticketA.authority,evidence(ticketA));assert.equal(result.outcome,'approved');
  const preview=await readCMSMediaPreview(scope(user),user,project,mA,env);assert.equal(preview.status,200);assert.deepEqual(new Uint8Array(await preview.arrayBuffer()),native.get(mA));
  assert.equal((await readCMSUploads(scope(user),user,project,env)).uploads.find(u=>u.requestId===uploadA).safety,'approved');
  await assert.rejects(readCMSMediaPreview(scope(stranger),stranger,project,mA,env),e=>e.status===404);
  tamper.add(mA);await assert.rejects(readCMSMediaPreview(scope(user),user,project,mA,env),e=>e.status===423);tamper.delete(mA);
  await assert.rejects(readCMSMediaPreview(scope(user),user,project,mB,env),held);
  const page=await (await cmsImportPage(scope(user),user,importReview.id,env)).text();assert.ok(page.includes('src="data:image/jpeg;base64,'));
 });
 await check('clearing media grants no CMS publication and provisions nothing',async()=>{
  assert.equal(Number((await db.prepare('SELECT count(*) n FROM cms_publication_reviews').first()).n),0);assert.equal(publishes,0);
  assert.equal(Number((await db.prepare('SELECT count(*) n FROM cms_instances').first()).n),instancesBefore);assert.equal((await host(`/cms/posts/01ARZ3NDEKTSV4RRFFQ69G5FB1`)).status,404);
 });
 let reviewA;
 await check('cleared media can follow the separate explicit publication review; GET/HEAD public aliases serve exact frozen bytes',async()=>{
  reviewA=(await prepareCMSPublication(scope(user),user,project,draftA,id(),env)).id;assert.equal(publishes,0);
  assert.ok((await (await cmsPublicationPage(scope(user),user,reviewA,files)).text()).includes('src="data:image/jpeg;base64,'));
  await confirmCMSPublication(scope(user),user,reviewA,env);assert.equal(publishes,1);
  const digest=(await safetyOf(uploadA)).digest,served=await host(`/cms/media/${reviewA}/${digest}.jpg`);assert.equal(served.status,200);assert.deepEqual(new Uint8Array(await served.arrayBuffer()),native.get(mA));
  assert.equal((await host(`/cms/media/${reviewA}/${digest}.jpg`,'HEAD')).status,200);assert.equal((await host('/cms/posts/01ARZ3NDEKTSV4RRFFQ69G5FB1')).status,200);assert.equal((await host('/cms')).status,200);
 });
 await check('custom-host aliases never route CMS media or articles',async()=>{
  const digest=(await safetyOf(uploadA)).digest;for(const path of [`/cms/media/${reviewA}/${digest}.jpg`,'/cms/posts/01ARZ3NDEKTSV4RRFFQ69G5FB1','/cms'])assert.equal((await siteHost.fetch(new Request('https://customer.example'+path),{DB:db,FILES:files})).status,404);
 });

 // Stale coverage: a synthetic direct receipt with a short server-time expiry.
 await db.prepare("UPDATE cms_media_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-short',expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 seconds') WHERE upload_id=?").bind(uploadB).run();
 const reviewB=(await prepareCMSPublication(scope(user),user,project,draftB,id(),env)).id;await confirmCMSPublication(scope(user),user,reviewB,env);
 const digestB=(await safetyOf(uploadB)).digest;assert.equal((await host(`/cms/media/${reviewB}/${digestB}.jpg`)).status,200);
 const expiryB=new Date((await safetyOf(uploadB)).expires_at).getTime();await new Promise(r=>setTimeout(r,Math.max(0,expiryB-Date.now())+1500));
 await check('stale (expired) coverage denies preview, inline review and both public methods; reservation resets it to pending',async()=>{
  const reads=previewReads;await assert.rejects(readCMSMediaPreview(scope(user),user,project,mB,env),held);assert.equal(previewReads,reads);
  await assert.rejects(cmsPublicationPage(scope(user),user,reviewB,files),held);
  for(const method of ['GET','HEAD'])assert.equal((await host(`/cms/media/${reviewB}/${digestB}.jpg`,method)).status,404);
  assert.equal((await listCMSMedia(scope(user),user,project,1,env)).items.find(i=>i.id===mB).safety,'pending');
  await reservePhotoScan(db,'cms',user,uploadB);assert.equal((await safetyOf(uploadB)).state,'pending');
 });

 await check('blocked coverage revokes every alias and withdraws referencing articles; it cannot be rescanned or re-approved',async()=>{
  await db.prepare("UPDATE cms_media_safety SET state='blocked',sexual_check='matched' WHERE upload_id=?").bind(uploadA).run();
  const digest=(await safetyOf(uploadA)).digest;let bucketReads=0;
  for(const method of ['GET','HEAD'])assert.equal((await host(`/cms/media/${reviewA}/${digest}.jpg`,method)).status,404);
  assert.equal((await siteHost.fetch(new Request(`https://${project}.whumpo.site/cms/media/${reviewA}/${digest}.jpg`),{DB:db,FILES:{get(){bucketReads++;throw Error('no private read');}}})).status,404);assert.equal(bucketReads,0);
  assert.equal((await host('/cms/posts/01ARZ3NDEKTSV4RRFFQ69G5FB1')).status,404);assert.ok(!((await (await host('/cms')).text()).includes('01ARZ3NDEKTSV4RRFFQ69G5FB1')));
  await assert.rejects(readCMSMediaPreview(scope(user),user,project,mA,env),blocked);await assert.rejects(cmsPublicationPage(scope(user),user,reviewA,files),blocked);
  await assert.rejects(cmsImportPage(scope(user),user,importReview.id,env),blocked);await assert.rejects(cmsPreview(scope(user),user,project,draftA,env),blocked);
  assert.equal((await listCMSMedia(scope(user),user,project,1,env)).items.find(i=>i.id===mA).safety,'blocked');
  await assert.rejects(reservePhotoScan(db,'cms',user,uploadA),e=>e.status===404);
  await assert.rejects(db.prepare("UPDATE cms_media_safety SET state='approved' WHERE upload_id=?").bind(uploadA).run());
  // Withdrawal is a safety hold, not deletion: the frozen object and receipts are retained for restricted handling.
  assert.ok(await files.head(`cms-publications/${project}/${reviewA}/${digest}.jpg`));
 });

 await check('ambiguous native identity (a second receipt claiming the same native ID) is held',async()=>{
  const t=await reservePhotoScan(db,'cms',user,uploadC);await recordPhotoScan(db,t.id,t.authority,evidence(t));
  native.set(mC,native.get(mC));assert.equal((await readCMSMediaPreview(scope(user),user,project,mC,env)).status,200);
  const forged=id(),receipt=await db.prepare('SELECT * FROM cms_media_uploads WHERE id=?').bind(uploadC).first();
  await db.prepare('INSERT INTO cms_media_uploads(id,user_id,project_id,origin,filename,digest,size,width,height) VALUES(?,?,?,?,?,?,?,?,?)').bind(forged,user,project,receipt.origin,'d.jpg',receipt.digest,receipt.size,receipt.width,receipt.height).run();
  await db.prepare('UPDATE cms_media_uploads SET result=? WHERE id=?').bind(receipt.result,forged).run();
  await assert.rejects(readCMSMediaPreview(scope(user),user,project,mC,env),held);
 });

 await check('owner metadata never exposes digests, scanner references or bucket keys',async()=>{
  const text=JSON.stringify(await readCMSUploads(scope(user),user,project,env))+JSON.stringify(await listCMSMedia(scope(user),user,project,1,env));
  for(const secret of ['synthetic-csam','synthetic-sexual','synthetic-short','cms-publications/',(await safetyOf(uploadA)).digest])assert.ok(!text.includes(secret));
 });
 console.log(`CMS media safety passed (${checks} checks): pending, missing, stale, incomplete, ambiguous and blocked coverage hold owner preview, draft preview, WordPress comparison, publication review/freeze/inline and GET/HEAD public CMS media; blocked media withdraw referencing articles; custom hosts never route CMS media; clearance grants no publication. Synthetic local D1/R2 only.`);
}finally{await store.close();await rm(dir,{recursive:true,force:true});}

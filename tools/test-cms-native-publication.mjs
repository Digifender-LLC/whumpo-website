// Disposable owner-control + actual native EmDash image-publication acceptance.
import assert from 'node:assert/strict';
import {analyzeWordPress} from './cms-wordpress-stage.mjs';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const built=spawnSync(process.execPath,['tools/build-emdash.mjs'],{stdio:'inherit'});if(built.status!==0)process.exit(built.status||1);
try{await fetch('http://localhost:8798');throw Error('Port 8798 is already in use');}catch(e){if(e.message.includes('already in use'))throw e;}
const bundle=await build({stdin:{resolveDir:process.cwd(),contents:[
 'cms-bridge','cms-projects','cms-provision','cms-deploy','cms-media-uploads','cms-content','cms-edits','cms-publication','cms-unpublish','cms-imports','cms-wordpress-sources','cms-wordpress-import',
].map(n=>`export * from './src/${n}';`).join('\n')+"\nexport {default as platform} from './src/index'; export {hashToken} from './src/security'; export {cleanPhoto} from './src/files'; export {default as siteHost} from './src/site-host';"},bundle:true,format:'esm',platform:'node',write:false});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-native-publication-'),id=()=>crypto.randomUUID();let control,server,logs='';
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',join(dir,'control')],{stdio:'pipe',maxBuffer:16*1024*1024});
 control=await wrangler.getPlatformProxy({persist:{path:join(dir,'control','v3')},remoteBindings:false});
 const db=control.env.DB,files=control.env.FILES,user=id(),project=id(),now=new Date().toISOString(),master='local-publication-master-'.repeat(4),account='a'.repeat(32);
 await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now).run();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Native publication fixture','','draft',?,?)").bind(project,user,now,now).run();
 const setup=await api.prepareCMS(db,user,id(),project,'Studio stories','Private local acceptance');await api.confirmCMS(db,user,setup.id);
 const resources=new Map();await api.allocateCMSResources(db,project,{accountId:account,find:async(k,n)=>resources.get(k+n)??null,create:async(k,n)=>resources.set(k+n,k==='database'?id():k==='session'?id().replaceAll('-',''):n)});
 const origin='https://whumpo-cms-'+project.replaceAll('-','')+'.whumpo.site',identity={projectId:project,ownerId:user,origin,secret:await api.deriveCMSSecret(master,project,user,origin)};
 const source=resolve('integrations/emdash/dist/server/wrangler.json'),config=JSON.parse(await readFile(source,'utf8'));
 config.main=resolve(dirname(source),config.main);config.assets.directory=resolve(dirname(source),config.assets.directory);delete config.triggers;
 config.vars={WHUMPO_CMS_PROJECT_ID:project,WHUMPO_CMS_OWNER_ID:user,WHUMPO_CMS_BRIDGE_KEY:identity.secret,WHUMPO_CMS_ORIGIN:origin,EMDASH_SITE_URL:origin};
 await writeFile(join(dir,'cms.json'),JSON.stringify(config));
 await writeFile(join(dir,'probe.mjs'),`export default {fetch(request,env){const u=new URL(request.url);return env.CMS.fetch(new Request(${JSON.stringify(origin)}+u.pathname+u.search,request));}};`);
 await writeFile(join(dir,'probe.json'),JSON.stringify({name:'whumpo-publication-probe',main:'probe.mjs',compatibility_date:'2026-09-29',workers_dev:false,preview_urls:false,services:[{binding:'CMS',service:config.name}]}));
 server=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config',join(dir,'probe.json'),'--config',join(dir,'cms.json'),'--local','--port','8798','--persist-to',join(dir,'native')],{stdio:['ignore','pipe','pipe']});
 for(const stream of [server.stdout,server.stderr])stream.on('data',d=>{logs=(logs+d.toString()).slice(-12000);});
 let ready=false;for(let i=0;i<120;i++){if(server.exitCode!==null)throw Error('Local CMS exited: '+logs);try{if((await fetch('http://localhost:8798/_emdash/api/setup/status')).status===403){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}if(!ready)throw Error('Local CMS failed to start: '+logs);
 let dropPublish=false,publishDispatches=0,dropImport=false,importDispatches=0,dropAssignment=false,assignmentDispatches=0,corruptImage=false;
 const service={fetch:async request=>{const path=new URL(request.url).pathname;const response=await fetch('http://localhost:8798'+path+new URL(request.url).search,{method:request.method,headers:request.headers,...(request.method==='GET'?{}:{body:await request.arrayBuffer()}),redirect:'error'});if(path.endsWith('/preview')&&corruptImage){const altered=new Uint8Array(await response.arrayBuffer());altered[altered.length-4]^=1;return new Response(altered,{status:response.status,headers:response.headers});}if(path.endsWith('/import-taxonomies')){assignmentDispatches++;if(dropAssignment){dropAssignment=false;throw Error('Synthetic lost taxonomy assignment acknowledgement');}}if(path.endsWith('/content/posts')&&request.method==='POST'){importDispatches++;if(dropImport){dropImport=false;throw Error('Synthetic lost native import acknowledgement');}}if(path.endsWith('/publish')){publishDispatches++;if(dropPublish){dropPublish=false;throw Error('Synthetic lost native publication acknowledgement');}}return response;}};
 let version=null;const provider={accountId:account,exists:async()=>false,deploy:async()=>{version=id();},activeVersion:async()=>version,service};
 await api.deployCMS(db,project,'b'.repeat(64),identity,provider);await api.connectCMS(db,project,id());
 const env={CMS_BRIDGE_MASTER_KEY:master,FILES:files,['CMS_'+project.replaceAll('-','')]:service};
 execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(32,24),(80,120,60)).save(sys.argv[1])",join(dir,'photo.jpg')]);
 const bytes=new Uint8Array(await readFile(join(dir,'photo.jpg'))),uploadId=id(),uploaded=await api.uploadCMSMedia(db,user,project,uploadId,bytes,'studio.jpg',env);
 assert.equal(uploaded.status,'saved');assert.deepEqual(await api.uploadCMSMedia(db,user,project,uploadId,bytes,'studio.jpg',env),uploaded);
 const content=[{_type:'block',_key:'intro',style:'normal',markDefs:[],children:[{_type:'span',_key:'text',text:'Studio story from the complete owner flow.',marks:[]}]},{_type:'image',_key:'photo',asset:{_ref:uploaded.result.mediaId},alt:'Green studio backdrop',caption:'Original caption'}],draft=id();
 const created=await api.createCMSDraft(db,user,project,draft,'posts','Studio story',content,env,'structured');
 assert.deepEqual((await api.readCMSDraft(db,user,project,draft,env)).item.data.content,content);
 const review=await api.prepareCMSPublication(db,user,project,draft,id(),env),manifest=JSON.parse(review.media_manifest);
 assert.equal(manifest.length,1);assert.match(await(await api.cmsPublicationPage(db,user,review.id,files)).text(),/src="data:image\/jpeg;base64,/);
 const publicArticle=`https://${project}.whumpo.site/cms/posts/${created.itemId}`;
 const publicImage=r=>`https://${project}.whumpo.site/cms/media/${r}/${manifest[0].digest}.jpg`;
 const hosted=url=>api.siteHost.fetch(new Request(url),{DB:db,FILES:files});
 assert.equal((await hosted(publicArticle)).status,404);assert.equal((await hosted(publicImage(review.id))).status,404);
 dropPublish=true;await assert.rejects(api.confirmCMSPublication(db,user,review.id,env));
 assert.equal((await hosted(publicArticle)).status,404);await api.confirmCMSPublication(db,user,review.id,env);
 const article=await hosted(publicArticle);assert.equal(article.status,200);assert.match(await article.text(),/Original caption/);
 const image=await hosted(publicImage(review.id));assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/jpeg');assert.deepEqual(new Uint8Array(await image.arrayBuffer()),api.cleanPhoto(bytes).bytes);
 await assert.rejects(api.cmsPublicationPage(db,id(),review.id,files),e=>e.status===404);
 const before=await api.readCMSDraft(db,user,project,draft,env),changed=structuredClone(content);changed[1].caption='Reviewed replacement';
 await api.editCMSDraft(db,user,project,id(),draft,'Studio story',changed,before.revision,env,'structured');
 assert.match(await(await hosted(publicArticle)).text(),/Original caption/);
 const replacement=await api.prepareCMSPublication(db,user,project,draft,id(),env);assert.equal(replacement.replaces_publication_id,review.id);
 await api.confirmCMSPublication(db,user,replacement.id,env);assert.match(await(await hosted(publicArticle)).text(),/Reviewed replacement/);
 assert.equal((await hosted(publicImage(review.id))).status,404);assert.equal((await hosted(publicImage(replacement.id))).status,200);
 const dispatches=publishDispatches;await api.confirmCMSPublication(db,user,replacement.id,env);assert.equal(publishDispatches,dispatches);
 const withdrawal=await api.prepareCMSUnpublish(db,user,replacement.id,id(),env);await api.confirmCMSUnpublish(db,user,withdrawal.id,env);
 assert.equal((await hosted(publicArticle)).status,404);assert.equal((await hosted(publicImage(replacement.id))).status,404);
 assert.equal((await api.readCMSDraft(db,user,project,draft,env)).item.status,'draft');
 const wxr=`<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>Imported studio story</title><dc:creator>Original writer</dc:creator><wp:post_id>42</wp:post_id><wp:post_type>post</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>A <strong>WordPress</strong> story.</p>]]></content:encoded></item></channel></rss>`;
 const stage=await analyzeWordPress(new TextEncoder().encode(wxr)),sourceArticle=stage.articles[0];assert.ok(sourceArticle.candidate);
 const session=id().replaceAll('-','')+id().replaceAll('-','');await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await api.hashToken(session),user,new Date(Date.now()+3600000).toISOString(),now).run();
 const httpEnv={...env,DB:db,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})}};
 const request=(path,method='GET',body,headers={})=>api.platform.fetch(new Request('http://localhost'+path,{method,headers:{origin:'http://localhost',cookie:'whumpo_session='+session,'content-type':'application/json',...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),httpEnv,{waitUntil(){throw Error('Unexpected background task');}});
 const sourceUpload=id(),sourcePath=`/api/cms/${project}/wordpress/sources/${sourceUpload}`;
 const sourceResponse=await request(sourcePath,'PUT',wxr,{'content-type':'application/xml','x-source-name':'wordpress.xml'});assert.equal(sourceResponse.status,200,await sourceResponse.clone().text());assert.equal((await sourceResponse.json()).state,'ready');
 const inspection=await request(sourcePath);assert.equal(inspection.status,200);assert.equal((await inspection.json()).report.summary.reviewable,1);
 assert.equal(await(await request(sourcePath+'/download')).text(),wxr);
 const chat=async(content,turn=id())=>{const snapshot=await(await request('/api/chat')).json();const response=await request('/api/chat','POST',{content,id:turn,revision:snapshot.state.revision});assert.equal(response.status,200,await response.clone().text());return (await(await request('/api/chat')).json()).turns.find(row=>row.id===turn);};
 const prepared=await chat(`/import-wordpress ${project} ${sourceUpload} ${sourceArticle.sourceId}`),reviewId=prepared.cms_import_review_id;
 assert.ok(reviewId);assert.equal(prepared.cms_import_confirmation_id,reviewId);
 const importReview=await api.readCMSImport(db,user,reviewId);assert.equal(importReview.status,'pending');assert.equal(importReview.source_upload_id,sourceUpload);
 await assert.rejects(api.readCMSDraft(db,user,project,reviewId,env),e=>e.status===404);
 const comparison=await request(`/api/cms-import-reviews/${reviewId}/preview`);assert.equal(comparison.status,200);assert.match(await comparison.text(),/Original writer/);
 const priorDispatches=importDispatches;dropImport=true;
 await chat('/confirm-cms-import '+reviewId);
 assert.equal((await api.readCMSImport(db,user,reviewId)).status,'approved');
 const recovered=await chat('/confirm-cms-import '+reviewId);assert.equal(recovered.cms_preview_request_id,reviewId);assert.equal((await api.readCMSImport(db,user,reviewId)).status,'imported');
 const imported=await api.readCMSDraft(db,user,project,reviewId,env);assert.equal(imported.item.status,'draft');assert.deepEqual(imported.item.data.content,sourceArticle.candidate.data.content);
 const recoveredDispatches=importDispatches;assert.ok(recoveredDispatches>priorDispatches);
 await chat('/confirm-cms-import '+reviewId);assert.equal(importDispatches,recoveredDispatches);
 assert.equal((await api.prepareCMSWordPressImport(db,files,user,project,sourceUpload,sourceArticle.sourceId,id(),env,analyzeWordPress)).id,reviewId);
 assert.equal((await hosted(`https://${project}.whumpo.site/cms/posts/${imported.item.id}`)).status,404);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM cms_draft_requests WHERE id=?').bind(reviewId).first()).n,1);
 console.log('Connected HTTP/Chat WordPress import passed: authenticated upload/download/analysis, source-derived comparison, explicit approval, lost native response recovery, actual native private draft, replay without dispatch and no publication.');
 // Combined source-derived images, excerpt, category and tag against the actual native artifact.
 const illustratedXML=`<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"><channel><wp:wxr_version>1.2</wp:wxr_version><language>en</language><wp:category><wp:term_id>1</wp:term_id><wp:category_nicename>studio-notes</wp:category_nicename><wp:cat_name>Studio notes</wp:cat_name></wp:category><wp:tag><wp:term_id>2</wp:term_id><wp:tag_slug>local-import</wp:tag_slug><wp:tag_name>Local import</wp:tag_name></wp:tag><item><title>Illustrated studio import</title><wp:post_id>84</wp:post_id><wp:post_type>post</wp:post_type><wp:status>publish</wp:status><excerpt:encoded><![CDATA[<p>A retained studio excerpt.</p>]]></excerpt:encoded><content:encoded><![CDATA[<!-- wp:paragraph --><p>Our <strong>studio</strong> story.</p><!-- /wp:paragraph --><!-- wp:image {"id":85} --><figure class="wp-block-image"><img src="https://old.example/studio.jpg" alt="Studio backdrop"/><figcaption>Caption from WordPress</figcaption></figure><!-- /wp:image -->]]></content:encoded><category domain="category" nicename="studio-notes">Studio notes</category><category domain="post_tag" nicename="local-import">Local import</category></item><item><title>Studio photo</title><wp:post_id>85</wp:post_id><wp:post_type>attachment</wp:post_type><wp:attachment_url>https://old.example/studio.jpg</wp:attachment_url></item></channel></rss>`;
 const illustratedSource=id(),illustratedPath=`/api/cms/${project}/wordpress/sources/${illustratedSource}`;
 assert.equal((await request(illustratedPath,'PUT',illustratedXML,{'content-type':'application/xml','x-source-name':'illustrated.xml'})).status,200);
 const illustratedReport=(await(await request(illustratedPath)).json()).report.articles[0];assert.equal(illustratedReport.mediaPlan.status,'needs_local_media');assert.equal(illustratedReport.taxonomyPlan.terms.length,2);
 const illustratedTurn=await chat(`/import-wordpress ${project} ${illustratedSource} 84 | ${uploaded.result.mediaId}`),illustratedReviewId=illustratedTurn.cms_import_review_id;
 assert.ok(illustratedReviewId,illustratedTurn.assistant_text);assert.equal(illustratedTurn.cms_import_confirmation_id,illustratedReviewId);
 const illustratedReview=await api.readCMSImport(db,user,illustratedReviewId);assert.equal(JSON.parse(illustratedReview.media_plan).length,1);assert.equal(JSON.parse(illustratedReview.taxonomy_plan).length,2);assert.equal(JSON.parse(illustratedReview.body).data.excerpt,'A retained studio excerpt.');
 const illustratedComparison=await request(`/api/cms-import-reviews/${illustratedReviewId}/preview`);assert.equal(illustratedComparison.status,200);const illustratedHTML=await illustratedComparison.text();assert.ok(illustratedHTML.includes('src="data:image/jpeg;base64,'));assert.ok(illustratedHTML.includes('Caption from WordPress'));assert.ok(illustratedHTML.includes('Studio notes'));assert.ok(!illustratedHTML.includes('src="https://old.example'));
 const beforeIllustrated=importDispatches;corruptImage=true;
 await chat('/confirm-cms-import '+illustratedReviewId);assert.equal((await api.readCMSImport(db,user,illustratedReviewId)).status,'pending');assert.equal(importDispatches,beforeIllustrated);corruptImage=false;
 dropAssignment=true;await chat('/confirm-cms-import '+illustratedReviewId);assert.equal((await api.readCMSImport(db,user,illustratedReviewId)).status,'approved');
 const incompleteJob=await db.prepare('SELECT state,body FROM cms_import_taxonomy_jobs WHERE review_id=?').bind(illustratedReviewId).first();assert.equal(incompleteJob.state,'prepared');
 const incompleteNative=JSON.parse(incompleteJob.body).itemId;await assert.rejects(api.readCMSDraft(db,user,project,illustratedReviewId,env),e=>e.status===404);assert.ok(!(await api.listCMSDrafts(db,user,project,env)).some(r=>r.id===illustratedReviewId));
 assert.equal((await hosted(`https://${project}.whumpo.site/cms/posts/${incompleteNative}`)).status,404);
 const afterCreate=importDispatches;corruptImage=true;await chat('/confirm-cms-import '+illustratedReviewId);assert.equal((await api.readCMSImport(db,user,illustratedReviewId)).status,'approved');assert.equal(importDispatches,afterCreate);corruptImage=false;
 const resumed=await chat('/confirm-cms-import '+illustratedReviewId);assert.equal(resumed.cms_preview_request_id,illustratedReviewId);assert.equal(importDispatches,afterCreate,'Assignment recovery must not recreate the article');
 const finalImport=await api.readCMSDraft(db,user,project,illustratedReviewId,env);assert.equal(finalImport.item.status,'draft');assert.equal(finalImport.item.version,2);assert.deepEqual(finalImport.item.data,JSON.parse(illustratedReview.body).data);
 for(const [taxonomy,slug] of [['categories','studio-notes'],['tags','local-import']]){const assigned=await api.callCMS(service,identity,'/_emdash/api/content/posts/'+finalImport.item.id+'/terms/'+taxonomy,id());assert.equal(assigned.terms.length,1);assert.equal(assigned.terms[0].slug,slug);}
 const afterAssignment=assignmentDispatches;await chat('/confirm-cms-import '+illustratedReviewId);assert.equal(importDispatches,afterCreate);assert.equal(assignmentDispatches,afterAssignment);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM cms_draft_requests WHERE id=?').bind(illustratedReviewId).first()).n,1);
 assert.equal((await hosted(`https://${project}.whumpo.site/cms/posts/${finalImport.item.id}`)).status,404);
 console.log('Combined actual-native WordPress import passed: retained source, confirmed JPEG, source caption/alt/excerpt, category and tag assignment, owner comparison, changed-byte refusal, hidden interrupted import, exact assignment recovery, single version increment and completed replay without publication.');
 if(process.env.CMS_BROWSER==='1'){
  const browserSource=id(),browserXML=illustratedXML.replace('Illustrated studio import','Browser studio import').replace('<wp:post_id>84</wp:post_id>','<wp:post_id>184</wp:post_id>');
  assert.equal((await request(`/api/cms/${project}/wordpress/sources/${browserSource}`,'PUT',browserXML,{'content-type':'application/xml','x-source-name':'browser-import.xml'})).status,200);
  const {cmsBrowserAcceptance}=await import('./cms-browser-acceptance.mjs');
  await cmsBrowserAcceptance({platform:api.platform,env:httpEnv,session,project,source:browserSource,db,readDraft:review=>api.readCMSDraft(db,user,project,review,env)});
 }
 console.log('Connected actual-native acceptance passed: owner upload/draft, frozen private review, lost publication acknowledgement recovery, public article/image, staged edit, replacement/replay and unpublish revocation.');
}finally{
 if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>{const timer=setTimeout(()=>{server.kill('SIGKILL');r();},4000);server.once('exit',()=>{clearTimeout(timer);r();});});}
 if(control)await control.dispose();await rm(dir,{recursive:true,force:true});
}

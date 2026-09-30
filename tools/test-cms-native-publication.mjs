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
 'cms-bridge','cms-projects','cms-provision','cms-deploy','cms-media-uploads','cms-content','cms-edits','cms-publication','cms-unpublish','cms-imports',
].map(n=>`export * from './src/${n}';`).join('\n')+"\nexport {cleanPhoto} from './src/files'; export {default as siteHost} from './src/site-host';"},bundle:true,format:'esm',platform:'node',write:false});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-native-publication-'),id=()=>crypto.randomUUID();let control,server,logs='';
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',join(dir,'control')],{stdio:'pipe'});
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
 let dropPublish=false,publishDispatches=0;
 const service={fetch:async request=>{const path=new URL(request.url).pathname;const response=await fetch('http://localhost:8798'+path+new URL(request.url).search,{method:request.method,headers:request.headers,...(request.method==='GET'?{}:{body:await request.arrayBuffer()}),redirect:'error'});if(path.endsWith('/publish')){publishDispatches++;if(dropPublish){dropPublish=false;throw Error('Synthetic lost native publication acknowledgement');}}return response;}};
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
 const importCandidate={sourceDigest:stage.source.digest,sourceId:sourceArticle.sourceId,collection:sourceArticle.collection,title:sourceArticle.candidate.data.title,content:sourceArticle.candidate.data.content,provenance:{sourceHTML:sourceArticle.sourceHTML,author:sourceArticle.sourceAuthor??'',sourceURL:sourceArticle.sourceURL??'',sourceStatus:sourceArticle.sourceStatus,sourceDate:sourceArticle.sourceDate??'',sourceSlug:sourceArticle.sourceSlug??''}};
 const importReview=await api.prepareCMSImport(db,user,project,id(),importCandidate,env);assert.equal(importReview.status,'pending');
 await assert.rejects(api.readCMSDraft(db,user,project,importReview.id,env),e=>e.status===404);
 assert.equal((await api.confirmCMSImport(db,user,importReview.id,env)).status,'imported');
 const imported=await api.readCMSDraft(db,user,project,importReview.id,env);assert.equal(imported.item.status,'draft');assert.deepEqual(imported.item.data.content,sourceArticle.candidate.data.content);
 assert.equal((await api.prepareCMSImport(db,user,project,id(),importCandidate,env)).id,importReview.id);assert.equal((await api.confirmCMSImport(db,user,importReview.id,env)).status,'imported');
 assert.equal((await hosted(`https://${project}.whumpo.site/cms/posts/${imported.item.id}`)).status,404);
 console.log('Connected WordPress import passed: upstream WXR conversion, immutable owner review, explicit approval, actual native private draft, exact replay and no publication.');
 console.log('Connected actual-native acceptance passed: owner upload/draft, frozen private review, lost publication acknowledgement recovery, public article/image, staged edit, replacement/replay and unpublish revocation.');
}finally{
 if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>{const timer=setTimeout(()=>{server.kill('SIGKILL');r();},4000);server.once('exit',()=>{clearTimeout(timer);r();});});}
 if(control)await control.dispose();await rm(dir,{recursive:true,force:true});
}

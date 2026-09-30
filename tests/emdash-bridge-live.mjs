// Local multi-Worker acceptance against the actual built EmDash application.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const b=await build({entryPoints:['src/cms-bridge.ts'],bundle:true,format:'esm',platform:'node',write:false});const {signCMSRequest,verifyCMSInitialization}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const config={projectId:'11111111-1111-4111-8111-111111111111',ownerId:'22222222-2222-4222-8222-222222222222',secret:'local-cms-bridge-fixture-'.repeat(3),origin:'https://cms.test'};
const renderBuild=await build({entryPoints:['src/cms-preview.ts'],bundle:true,format:'esm',platform:'node',write:false});const {renderCMSDraft}=await import('data:text/javascript;base64,'+Buffer.from(renderBuild.outputFiles[0].text).toString('base64'));
const base='http://localhost:8799',id=()=>crypto.randomUUID();
async function call(path,body,requestId=id(),identity=config,verb){const request=await signCMSRequest(identity,path,requestId,body,Date.now(),verb);return fetch(base+path,{method:request.method,headers:request.headers,...(body===undefined?{}:{body:await request.text()})});}
const capabilityPath='/_emdash/api/whumpo/capabilities';
assert.equal((await fetch(base+capabilityPath)).status,403);
assert.equal((await call(capabilityPath,undefined,id(),{...config,ownerId:id()})).status,403);
assert.equal((await call(capabilityPath,{})).status,403);
const capability=await call(capabilityPath);assert.equal(capability.status,200);assert.equal(capability.headers.get('cache-control'),'no-store');
assert.deepEqual((await capability.json()).data,{contract:'whumpo-cms-capabilities',version:1,media:{uploadVersion:1,uploadMaxBytes:1048576,uploadMimeType:'image/jpeg',metadataVersion:1,pageSize:20,previewVersion:1,previewMaxBytes:5242880},taxonomyManagement:{version:1,names:['categories','tags'],locale:'en',collection:'posts',articleAssignments:false},structuredContent:{excerptVersion:1,excerptMaxChars:512,excerptCollections:['posts'],imageVersion:1,version:1,collections:['posts','pages'],maxRequestBytes:4096,revisionRequired:true,stagedEdits:true}});
assert.equal((await fetch(base+'/_emdash/api/setup/status')).status,403);
assert.equal((await call('/_emdash/api/setup/status',undefined,id(),{...config,ownerId:id()})).status,403);
const before=await call('/_emdash/api/setup/status');assert.equal(before.status,200);const initial=await before.json();assert.equal(initial.data.needsSetup,true,JSON.stringify(initial));
const requestId=id(),body={title:'TownHello CMS bridge fixture',tagline:'Private isolated CMS',includeContent:false};
const setup=await call('/_emdash/api/setup',body,requestId);const setupData=await setup.json();assert.equal(setup.status,200,JSON.stringify(setupData));assert.equal(setupData.data.setupComplete,true);assert.equal(setupData.data.seedComplete,true);
assert.deepEqual(await (await call('/_emdash/api/setup',body,requestId)).json(),setupData);
assert.equal((await call('/_emdash/api/setup',{...body,title:'Forged replay'},requestId)).status,409);
const me=await call('/_emdash/api/auth/me');const owner=await me.json();assert.equal(me.status,200,JSON.stringify(owner));assert.equal(owner.data.email,config.ownerId+'@owners.townhello.invalid');assert.equal(owner.data.role,50);
const collections=await call('/_emdash/api/schema/collections');assert.equal(collections.status,200);const schema=await collections.json();assert.ok(JSON.stringify(schema).includes('posts'));
const media=await call('/_emdash/api/media?page=1&limit=20');assert.equal(media.status,200);const mediaData=await media.json();assert.deepEqual(mediaData.data.items,[]);assert.equal(mediaData.data.totalCount,0);
const after=await (await call('/_emdash/api/setup/status')).json();assert.equal(after.data.needsSetup,false);
assert.equal((await call('/_emdash/api/setup/admin',{email:'attacker@example.test'})).status,403);
assert.equal((await call('/_emdash/api/plugins')).status,403);
assert.equal((await fetch(base+'/_emdash/admin/setup')).status,403);
const service={fetch:async request=>{const u=new URL(request.url);return fetch(base+u.pathname+u.search,{method:request.method,headers:request.headers,...(request.method!=='GET'?{body:await request.text()}:{}),signal:request.signal});}};assert.deepEqual((await verifyCMSInitialization(service,config)).collections.sort(),['pages','posts']);
console.log('Actual EmDash bridge passed: unsigned/wrong-owner denial, empty-content setup, replay/conflict handling, pinned owner administration, schema reads, setup closed and other management routes denied.');
const shapeBuild=await build({entryPoints:['src/cms-content-shape.ts'],bundle:true,format:'esm',platform:'node',write:false});const {cmsDraftBody,cmsEditBody,cmsStagedEditBody,cmsRichDraftBody,cmsRichEditBody}=await import('data:text/javascript;base64,'+Buffer.from(shapeBuild.outputFiles[0].text).toString('base64'));
const taxonomyBuild=await build({entryPoints:['src/cms-taxonomy-shape.ts'],bundle:true,format:'esm',platform:'node',write:false});const {cmsTaxonomyDefinition,cmsTaxonomyTerm}=await import('data:text/javascript;base64,'+Buffer.from(taxonomyBuild.outputFiles[0].text).toString('base64'));
for(const name of ['categories','tags']){
 const defPath='/_emdash/api/taxonomies/'+name,definition=cmsTaxonomyDefinition(name),definitionId=id();
 const existing=await call(defPath);
 if(existing.status===404){const created=await call('/_emdash/api/taxonomies',definition,definitionId);assert.equal(created.status,201,await created.clone().text());assert.deepEqual(await(await call('/_emdash/api/taxonomies',definition,definitionId)).json(),await created.json());}
 else assert.equal(existing.status,200,await existing.text());
 const term=cmsTaxonomyTerm('studio-notes','Studio notes'),termId=id(),termPath=defPath+'/terms';
 const created=await call(termPath,term,termId);assert.equal(created.status,201,await created.clone().text());const result=await created.json();assert.deepEqual(await(await call(termPath,term,termId)).json(),result);
 assert.equal((await call(termPath,cmsTaxonomyTerm('studio-notes','Changed'),termId)).status,409);
 assert.equal((await call(termPath+'/studio-notes')).status,200);
 assert.equal((await call(termPath,{...term,parentId:'unreviewed'})).status,403);
 assert.equal((await call(defPath,definition,id(),config,'PUT')).status,403);
}
const unsupportedMapping={...cmsDraftBody('Mapped post','A categorized article'),taxonomies:{tags:['studio-notes']}};
assert.equal((await call('/_emdash/api/content/posts',unsupportedMapping)).status,403);
console.log('Native taxonomy terms passed: bounded definitions and terms, exact replay/conflict protection, assignment writes denied pending D1 recovery support.');
for(const collection of ['posts','pages']){
 const rid=id(),initial=cmsDraftBody('Native '+collection,'A private paragraph. <script>plain text only</script>');
 initial.data.content.push({_type:'block',_key:'heading',style:'h2',markDefs:[],children:[{_type:'span',_key:'heading-text',text:'A formatted heading',marks:['strong']}]});
 const draftBody=cmsRichDraftBody('Native '+collection,initial.data.content,collection==='posts'?'Native excerpt <script>text only</script>':undefined);
 const created=await call('/_emdash/api/content/'+collection,draftBody,rid),data=await created.json();assert.equal(created.status,201,JSON.stringify(data));assert.equal(data.data.item.status,'draft');assert.deepEqual(data.data.item.data.content,initial.data.content);
 assert.deepEqual(await (await call('/_emdash/api/content/'+collection,draftBody,rid)).json(),data);
 assert.equal((await call('/_emdash/api/content/'+collection,cmsDraftBody('Changed','Different'),rid)).status,409);
 if(collection==='posts')assert.equal(data.data.item.data.excerpt,draftBody.data.excerpt);
 else assert.equal((await call('/_emdash/api/content/pages',cmsRichDraftBody('Page',initial.data.content,'No page excerpt'))).status,403);
 const item=data.data.item,read=await call('/_emdash/api/content/'+collection+'/'+item.id);assert.equal(read.status,200);const snapshot=(await read.json()).data;assert.equal(snapshot.item.data.title,'Native '+collection);assert.ok(renderCMSDraft({collection,revision:snapshot._rev,item:snapshot.item}).includes('&lt;script&gt;plain text only&lt;/script&gt;'));
 const editId=id(),editBody=cmsEditBody('Edited '+collection,'Changed paragraph',snapshot._rev),path='/_emdash/api/content/'+collection+'/'+item.id;
 const edited=await call(path,editBody,editId,config,'PUT'),editData=await edited.json();assert.equal(edited.status,200,JSON.stringify(editData));assert.equal(editData.data.item.data.title,'Edited '+collection);if(collection==='posts')assert.equal(editData.data.item.data.excerpt,draftBody.data.excerpt);assert.notEqual(editData.data._rev,snapshot._rev);
 assert.deepEqual(await (await call(path,editBody,editId,config,'PUT')).json(),editData);
 assert.equal((await call(path,cmsEditBody('Changed replay','Other',snapshot._rev),editId,config,'PUT')).status,409);
 assert.equal((await call(path,cmsEditBody('Stale edit','Lost update',snapshot._rev),id(),config,'PUT')).status,409);
 assert.equal((await call(path,cmsDraftBody('No revision','Body'),id(),config,'PUT')).status,403);
 const contenders=await Promise.all(['One','Two'].map(title=>call(path,cmsEditBody(title,'Race',editData.data._rev),id(),config,'PUT')));assert.deepEqual(contenders.map(r=>r.status).sort(),[200,409]);
 assert.equal((await call('/_emdash/api/content/'+collection,{...draftBody,status:'published'})).status,403);
 assert.equal((await call('/_emdash/api/content/'+collection+'/'+item.id+'/publish',{})).status,403);
 const latest=(await (await call(path)).json()).data,publishPath=path+'/publish',publishId=id();
 assert.equal((await call(publishPath,{_rev:snapshot._rev})).status,409);
 const published=await call(publishPath,{_rev:latest._rev},publishId),publishedData=await published.json();assert.equal(published.status,200,JSON.stringify(publishedData));assert.equal(publishedData.data.item.status,'published');assert.equal(JSON.stringify(publishedData.data.item.data),JSON.stringify(latest.item.data));
 assert.deepEqual(await (await call(publishPath,{_rev:latest._rev},publishId)).json(),publishedData);
 const stagedId=id(),stagedContent=[{_type:'block',_key:'staged',style:'normal',markDefs:[{_key:'link',_type:'link',href:'https://example.test/'}],children:[{_type:'span',_key:'text',text:'Unpublished replacement text',marks:['em','link']}]},{_type:'block',_key:'item',style:'normal',listItem:'bullet',level:1,markDefs:[],children:[{_type:'span',_key:'item-text',text:'Keep the formatting',marks:['strong']}]}],stagedBody=cmsRichEditBody('Private replacement '+collection,stagedContent,publishedData.data._rev);
 assert.equal(Object.hasOwn(stagedBody,'status'),false);
 const staged=await call(path,stagedBody,stagedId,config,'PUT'),stagedData=await staged.json();assert.equal(staged.status,200,JSON.stringify(stagedData));
 assert.equal(stagedData.data.item.status,'published');assert.ok(stagedData.data.item.draftRevisionId);assert.deepEqual(stagedData.data.item.liveData,publishedData.data.item.data);assert.equal(stagedData.data.item.data.title,'Private replacement '+collection);
 assert.deepEqual(await (await call(path,stagedBody,stagedId,config,'PUT')).json(),stagedData);
 assert.equal((await call(path,stagedBody,id(),config,'PUT')).status,409);
 const stagedRead=(await (await call(path)).json()).data;assert.deepEqual(stagedRead.item.liveData,publishedData.data.item.data);assert.equal(stagedRead.item.data.title,'Private replacement '+collection);assert.deepEqual(stagedRead.item.data.content,stagedContent);
 assert.ok(renderCMSDraft({collection,revision:stagedRead._rev,item:stagedRead.item}).includes('Private replacement'));assert.ok(renderCMSDraft({collection,item:stagedRead.item},true).includes('Private replacement'));
 const discardPath=path+'/discard-draft',discardId=id();assert.equal((await call(discardPath,{})).status,403);assert.equal((await call(discardPath,{_rev:publishedData.data._rev})).status,409);
 const discarded=await call(discardPath,{_rev:stagedRead._rev},discardId),discardedData=await discarded.json();assert.equal(discarded.status,200,JSON.stringify(discardedData));assert.equal(discardedData.data.item.status,'published');assert.ok(!discardedData.data.item.draftRevisionId);assert.deepEqual(discardedData.data.item.data,publishedData.data.item.data);
 assert.deepEqual(await (await call(discardPath,{_rev:stagedRead._rev},discardId)).json(),discardedData);
 const restaged=await call(path,cmsStagedEditBody('Private replacement '+collection,'Unpublished replacement text',discardedData.data._rev),id(),config,'PUT');assert.equal(restaged.status,200);stagedRead._rev=(await restaged.json()).data._rev;
 assert.equal((await call(discardPath,{_rev:discardedData.data._rev},discardId)).status,409);
 // Native promotion is separately verified here; platform replacement still needs its own review ledger.
 const replaced=await call(publishPath,{_rev:stagedRead._rev}),replacement=await replaced.json();assert.equal(replaced.status,200,JSON.stringify(replacement));assert.equal(replacement.data.item.data.title,'Private replacement '+collection);assert.equal(replacement.data.item.status,'published');
 publishedData.data=replacement.data;
 const unpublishPath=path+'/unpublish',unpublishId=id();assert.equal((await call(unpublishPath,{_rev:latest._rev})).status,409);
 const unpublished=await call(unpublishPath,{_rev:publishedData.data._rev},unpublishId),unpublishedData=await unpublished.json();assert.equal(unpublished.status,200,JSON.stringify(unpublishedData));assert.equal(unpublishedData.data.item.status,'draft');assert.deepEqual(unpublishedData.data.item.data,publishedData.data.item.data);
 assert.deepEqual(await (await call(unpublishPath,{_rev:publishedData.data._rev},unpublishId)).json(),unpublishedData);
 assert.equal((await call(unpublishPath,{})).status,403);

 assert.equal((await fetch(base+'/posts/'+item.slug)).status,403);
}
console.log('Actual native EmDash drafts passed: posts/pages create, read, exact replay, changed-request conflict, forced draft state, revision-bound editing, stale/concurrent edit conflicts and revision-bound native publication/unpublication, reviewed-revision discard, retained live content and exact receipt replay.');

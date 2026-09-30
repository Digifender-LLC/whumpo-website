import assert from 'node:assert/strict';import {build} from 'esbuild';
const b=await build({stdin:{contents:"export * from './src/cms-media-preview';export * from './src/cms-media-preview-shape';export * from './src/cms-bridge';export * from './src/cms-gateway';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {callCMS,readCMSMediaPreview,cmsPreviewLimit,signCMSRequest,verifyCMSRequest,cmsRequestAllowed,cmsGateway,deriveCMSSecret}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const project=crypto.randomUUID(),owner=crypto.randomUUID(),origin='https://cms.test',master='preview-test-key-'.repeat(4),config={projectId:project,ownerId:owner,origin,secret:await deriveCMSSecret(master,project,owner,origin)},id='01ARZ3NDEKTSV4RRFFQ69G5FAV',path='/_emdash/api/whumpo/media/'+id+'/preview';
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6ioAAAAASUVORK5CYII=','base64'));
let item={id,status:'ready',storageKey:id+'.png',size:png.length,mimeType:'image/png'},bytes=png,gets=0,dispatches=0;
const nativeEnv={TOWNHELLO_CMS_PROJECT_ID:project,TOWNHELLO_CMS_OWNER_ID:owner,TOWNHELLO_CMS_ORIGIN:origin,TOWNHELLO_CMS_BRIDGE_KEY:config.secret,DB:{prepare(){throw Error('Preview must not write');}},MEDIA:{get:async key=>{gets++;assert.equal(key,id+'.png');return {size:bytes.length,body:new Response(bytes).body,httpMetadata:{}};}}};
const dispatch=async request=>{dispatches++;assert.equal((await verifyCMSRequest(request,config)).path,'/_emdash/api/media/'+id);return Response.json({success:true,data:{item}});};
await assert.rejects(callCMS({fetch:async request=>{assert.equal(request.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://elsewhere.test'}});}},config,'/_emdash/api/media/'+id,crypto.randomUUID()),e=>e.status===502);
const signed=()=>signCMSRequest(config,path,crypto.randomUUID());
const preview=()=>signed().then(r=>cmsGateway(r,nativeEnv,dispatch));
const response=await preview();assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),png);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('set-cookie'),null);
assert.equal((await cmsGateway(new Request(origin+path),nativeEnv,dispatch)).status,403);
assert.equal(cmsRequestAllowed('POST',path,'{}'),false);assert.equal(cmsRequestAllowed('GET',path+'?key=secret',''),false);assert.equal(cmsRequestAllowed('GET','/_emdash/api/media/file/'+id+'.png',''),false);
for(const patch of [{id:'different'},{status:'pending'},{storageKey:'backups/'+id+'.png'},{storageKey:'%2e%2e/'+id+'.png'},{mimeType:'image/svg+xml'},{size:cmsPreviewLimit+1}]){const before=gets,old=item;item={...item,...patch};assert.equal((await preview()).status,404);assert.equal(gets,before);item=old;}
bytes=new TextEncoder().encode('<script>alert(1)</script>');item={...item,size:bytes.length};assert.equal((await preview()).status,404);bytes=png;item={...item,size:png.length};
const db={prepare(){return {bind(p,u,o){return {first:async()=>p===project&&u===owner&&o===owner?{origin,user_id:owner}:null};}};}};
const env={CMS_BRIDGE_MASTER_KEY:master,['CMS_'+project.replaceAll('-','')]:{fetch:r=>cmsGateway(r,nativeEnv,dispatch)}};
const endToEnd=await readCMSMediaPreview(db,owner,project,id,env);assert.equal(endToEnd.status,200);assert.deepEqual(new Uint8Array(await endToEnd.arrayBuffer()),png);
const before=dispatches;await assert.rejects(readCMSMediaPreview(db,crypto.randomUUID(),project,id,env),e=>e.status===404);assert.equal(dispatches,before);
for(const fake of [()=>new Response('<html>bad</html>',{headers:{'content-type':'text/html'}}),()=>new Response(png,{status:302,headers:{location:'https://example.com','content-type':'image/png'}}),()=>new Response(new Uint8Array(cmsPreviewLimit+1),{headers:{'content-type':'image/png'}})]){env['CMS_'+project.replaceAll('-','')].fetch=fake;await assert.rejects(readCMSMediaPreview(db,owner,project,id,env),e=>e.status===503);}
env['CMS_'+project.replaceAll('-','')].fetch=()=>new Response(png,{headers:{'content-type':'image/png','set-cookie':'secret=canary','cache-control':'public','x-secret':'canary'}});
const stripped=await readCMSMediaPreview(db,owner,project,id,env);assert.equal(stripped.headers.get('set-cookie'),null);assert.equal(stripped.headers.get('x-secret'),null);assert.equal(stripped.headers.get('cache-control'),'private, no-store');
console.log('CMS private preview passed: signed native metadata and R2 read, ownership, private headers, body limits, format checks, staging/path denial, no writes and no public file route.');

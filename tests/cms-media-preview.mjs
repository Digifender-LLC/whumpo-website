import assert from 'node:assert/strict';import {build} from 'esbuild';
const b=await build({stdin:{contents:"export * from './src/cms-media-preview';export * from './src/cms-media-preview-shape';export * from './src/cms-bridge';export * from './src/cms-gateway';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {callCMS,readCMSMediaPreview,cmsPreviewLimit,signCMSRequest,verifyCMSRequest,cmsRequestAllowed,cmsGateway,deriveCMSSecret}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const project=crypto.randomUUID(),owner=crypto.randomUUID(),origin='https://cms.test',master='preview-test-key-'.repeat(4),config={projectId:project,ownerId:owner,origin,secret:await deriveCMSSecret(master,project,owner,origin)},id='01ARZ3NDEKTSV4RRFFQ69G5FAV',path='/_emdash/api/whumpo/media/'+id+'/preview';
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6ioAAAAASUVORK5CYII=','base64'));
let item={id,status:'ready',storageKey:id+'.png',size:png.length,mimeType:'image/png'},bytes=png,gets=0,dispatches=0;
const nativeEnv={WHUMPO_CMS_PROJECT_ID:project,WHUMPO_CMS_OWNER_ID:owner,WHUMPO_CMS_ORIGIN:origin,WHUMPO_CMS_BRIDGE_KEY:config.secret,DB:{prepare(){throw Error('Preview must not write');}},MEDIA:{get:async key=>{gets++;assert.equal(key,id+'.png');return {size:bytes.length,body:new Response(bytes).body,httpMetadata:{}};}}};
const dispatch=async request=>{dispatches++;assert.equal((await verifyCMSRequest(request,config)).path,'/_emdash/api/media/'+id);return Response.json({success:true,data:{item}});};
await assert.rejects(callCMS({fetch:async request=>{assert.equal(request.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://elsewhere.test'}});}},config,'/_emdash/api/media/'+id,crypto.randomUUID()),e=>e.status===502);
const signed=()=>signCMSRequest(config,path,crypto.randomUUID());
const preview=()=>signed().then(r=>cmsGateway(r,nativeEnv,dispatch));
const response=await preview();assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),png);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('set-cookie'),null);
assert.equal((await cmsGateway(new Request(origin+path),nativeEnv,dispatch)).status,403);
assert.equal(cmsRequestAllowed('POST',path,'{}'),false);assert.equal(cmsRequestAllowed('GET',path+'?key=secret',''),false);assert.equal(cmsRequestAllowed('GET','/_emdash/api/media/file/'+id+'.png',''),false);
for(const patch of [{id:'different'},{status:'pending'},{storageKey:'backups/'+id+'.png'},{storageKey:'%2e%2e/'+id+'.png'},{mimeType:'image/svg+xml'},{size:cmsPreviewLimit+1}]){const before=gets,old=item;item={...item,...patch};assert.equal((await preview()).status,404);assert.equal(gets,before);item=old;}
bytes=new TextEncoder().encode('<script>alert(1)</script>');item={...item,size:bytes.length};assert.equal((await preview()).status,404);bytes=png;item={...item,size:png.length};
// WH-013: the owner preview alias is held unless the trusted clearance view releases this exact receipt.
const jpeg=Uint8Array.from([255,216,255,224,0,16,74,70,73,70,0,1,1,0,0,1]),jpegDigest=Buffer.from(await crypto.subtle.digest('SHA-256',jpeg)).toString('hex');
let cleared=null,blocked=false;
const db={prepare(sql){return {bind(...a){return {first:async()=>a[0]===project&&a[1]===owner&&a[2]===owner?{origin,user_id:owner}:null,all:async()=>({results:sql.includes('FROM approved_cms_media a JOIN json_each')?(cleared?[{media_id:id,...cleared}]:[]):[{media_id:id,safety:cleared?'approved':blocked?'blocked':'pending'}]})};}};}};
const env={CMS_BRIDGE_MASTER_KEY:master,['CMS_'+project.replaceAll('-','')]:{fetch:r=>cmsGateway(r,nativeEnv,dispatch)}};
let before=dispatches;
await assert.rejects(readCMSMediaPreview(db,owner,project,id,env),e=>e.status===423&&/held for a safety review/.test(e.message));assert.equal(dispatches,before);
blocked=true;await assert.rejects(readCMSMediaPreview(db,owner,project,id,env),e=>e.status===423&&/did not pass/.test(e.message));blocked=false;assert.equal(dispatches,before);
// Cleared metadata cannot release different native bytes (PNG native reply here) or a changed digest.
cleared={digest:jpegDigest,size:jpeg.length,width:1,height:1};
await assert.rejects(readCMSMediaPreview(db,owner,project,id,env),e=>e.status===423);
env['CMS_'+project.replaceAll('-','')].fetch=()=>new Response(jpeg,{headers:{'content-type':'image/jpeg'}});
const endToEnd=await readCMSMediaPreview(db,owner,project,id,env);assert.equal(endToEnd.status,200);assert.deepEqual(new Uint8Array(await endToEnd.arrayBuffer()),jpeg);
cleared={...cleared,digest:'0'.repeat(64)};await assert.rejects(readCMSMediaPreview(db,owner,project,id,env),e=>e.status===423);cleared={...cleared,digest:jpegDigest};
before=dispatches;await assert.rejects(readCMSMediaPreview(db,crypto.randomUUID(),project,id,env),e=>e.status===404);assert.equal(dispatches,before);
for(const fake of [()=>new Response('<html>bad</html>',{headers:{'content-type':'text/html'}}),()=>new Response(jpeg,{status:302,headers:{location:'https://example.com','content-type':'image/jpeg'}}),()=>new Response(new Uint8Array(cmsPreviewLimit+1),{headers:{'content-type':'image/jpeg'}})]){env['CMS_'+project.replaceAll('-','')].fetch=fake;await assert.rejects(readCMSMediaPreview(db,owner,project,id,env),e=>e.status===503);}
env['CMS_'+project.replaceAll('-','')].fetch=()=>new Response(jpeg,{headers:{'content-type':'image/jpeg','set-cookie':'secret=canary','cache-control':'public','x-secret':'canary'}});
const stripped=await readCMSMediaPreview(db,owner,project,id,env);assert.equal(stripped.headers.get('set-cookie'),null);assert.equal(stripped.headers.get('x-secret'),null);assert.equal(stripped.headers.get('cache-control'),'private, no-store');
console.log('CMS private preview passed: signed native metadata and R2 read, ownership, private headers, body limits, format checks, staging/path denial, no writes, no public file route and safety-held owner previews.');

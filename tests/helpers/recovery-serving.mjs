// Shared fixture for the WH-008 execution probe: boots RESTORED Worker bundles and their restored asset
// trees in workerd (Miniflare) with disposable D1/R2/service/rate-limit bindings. Loopback only; every
// outbound request from any Worker is refused and counted. Synthetic data only. This never routes,
// deploys or serves customer traffic, and it reads no secret, credential or provider.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {restoreControlD1,restoreObjects} from '../../tools/recovery-drill.mjs';

const require=createRequire(import.meta.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
// Disposable binding identities: the configured production database/bucket IDs and names are never used.
const CONTROL='recovery-probe-control',BUCKET='recovery-probe-files';

/** `bundles[role]`: restored compiled output directory; `entries[role]`: its entry file;
 * `configs[role]`: the release configuration; `assets[role]`: restored asset tree (apps, platform). */
export async function startRestoredStack({bundles,entries,configs,assets,persist,roles}){
 const outbound={count:0};
 const refuse=async()=>{outbound.count++;return new Response('Outbound requests are refused in the recovery probe',{status:502});};
 const worker=async role=>{
  const config=configs[role],directory=bundles[role];
  return {
   name:config.name,modulesRoot:directory,compatibilityDate:config.compatibility_date,
   modules:[{type:'ESModule',path:join(directory,entries[role])},...(await readdir(directory)).filter(p=>p.endsWith('.wasm')).map(p=>({type:'CompiledWasm',path:join(directory,p)}))],
   bindings:{...(config.vars??{})},
   ...(config.d1_databases?{d1Databases:Object.fromEntries(config.d1_databases.map(b=>[b.binding,CONTROL]))}:{}),
   ...(config.r2_buckets?{r2Buckets:Object.fromEntries(config.r2_buckets.map(b=>[b.binding,BUCKET]))}:{}),
   ...(config.services?{serviceBindings:Object.fromEntries(config.services.map(s=>[s.binding,s.service]))}:{}),
   ...(config.ratelimits?{ratelimits:Object.fromEntries(config.ratelimits.map(r=>[r.name,{namespace_id:r.namespace_id,simple:r.simple}]))}:{}),
   ...(config.assets?{assets:{directory:assets[role],binding:config.assets.binding,run_worker_first:config.assets.run_worker_first,routerConfig:{has_user_worker:true},...(config.assets.not_found_handling?{assetConfig:{not_found_handling:config.assets.not_found_handling}}:{})}}:{}),
   ...(config.routes?{routes:config.routes.map(r=>r.pattern.includes('/')?r.pattern:r.pattern+'/*')}:{}),
   outboundService:refuse,
  };
 };
 const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',resourcePersistencePath:persist,workers:await Promise.all(roles.map(worker))}));
 const origin=await mf.ready;
 if(!['127.0.0.1','localhost','[::1]'].includes(origin.hostname))throw Error('The recovery probe must listen on loopback only');
 const fetchers={};for(const role of roles)fetchers[role]=await mf.getWorker(configs[role].name);
 return {
  mf,outbound,origin:origin.origin,
  call:(role,url,init)=>fetchers[role].fetch(url,init),
  route:(url,init)=>mf.dispatchFetch(url,init),
  d1:async role=>mf.getD1Database('DB',configs[role].name),
  bucket:async role=>mf.getR2Bucket('FILES',configs[role].name),
  dispose:()=>mf.dispose(),
 };
}

/** Restore the recovery point into disposable bindings, then drive the restored Workers through
 * route-matched in-process requests. Asserts as it goes and returns counts only. Candidate-serving
 * authority is not involved: this is a separate throwaway copy that nothing routes to.
 *
 * Miniflare resolves static assets by request path across every Worker in one instance (the apps and
 * platform trees both contain /index.html, and the apps Worker was served the platform page), which production does
 * not do. So the sites + apps + runtime Workers run in one instance and the platform + runtime Workers in a
 * second one over the same on-disk disposable D1/R2 state, never at the same time. `launch(roles)` starts one. */
export async function exerciseRestoredStacks({launch,point,ids,assetDirs,photos,publishedHTML,documents,makeStranger}){
 const stack=await launch(['sites','apps','runtime']);
 const first=await exerciseSitesAndApps({stack,point,ids,assetDirs,photos,publishedHTML,documents}).finally(()=>stack.dispose());
 const second=await launch(['platform','runtime']);
 try{const platform=await exercisePlatform({stack:second,ids,assetDirs,makeStranger});return {...first.counts,...platform.counts,requests:first.requests+platform.requests,restoredStatements:first.restoredStatements,restoredObjects:first.restoredObjects,outboundRequests:first.outbound+second.outbound.count};}
 finally{await second.dispose();}
}

async function exerciseSitesAndApps({stack,point,ids,assetDirs,photos,publishedHTML,documents}){
 const hash=v=>createHash('sha256').update(v).digest('hex'),seen=[];
 const send=async(url,init)=>{const response=await stack.route(url,init),bytes=new Uint8Array(await response.arrayBuffer());seen.push(Buffer.from(bytes).toString('latin1'));return {status:response.status,headers:response.headers,bytes,text:()=>Buffer.from(bytes).toString('utf8'),json:()=>JSON.parse(Buffer.from(bytes).toString('utf8'))};};
 const siteHost=`https://${ids.site}.whumpo.site`,appHost=`https://app-${ids.app}.whumpo.site`;
 const visitorCookie=(i,project=ids.app)=>`__Host-whumpo-app-session-${project}=${ids.visitors[i].session}`;
 const app=(path,{visitor,method='GET',body,origin=appHost,cookie}={})=>send(appHost+path,{method,headers:{'cf-connecting-ip':'192.0.2.7',origin,...(method==='POST'?{'content-type':'application/json'}:{}),...(visitor!==undefined||cookie?{cookie:cookie??visitorCookie(visitor)}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const secure=r=>{assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.ok(r.headers.get('content-security-policy'));};
 const counts={};const count=name=>{counts[name]=(counts[name]??0)+1;};

 // Empty bindings first: a restored bundle carries no data, so nothing is served before the restore.
 const before=[await send(siteHost+'/'),await send(appHost+'/')];
 assert.deepEqual(before.map(r=>r.status),[503,503],'An empty control database serves nothing');count('emptyBindingRefusals');

 // Restore the point into the stack's own D1/R2 with the same tools the candidate used.
 const d1=await stack.d1('sites'),files=await stack.bucket('sites');
 const control=await restoreControlD1(d1,point.directory,point.digest);assert.equal(control.digest,point.controlDigest);
 const restored=await restoreObjects(files,point.directory,point.digest);assert.deepEqual([restored.written,restored.skipped],[restored.objects,0]);

 // Sites Worker: published HTML and photos, never anything else.
 const home=await send(siteHost+'/');assert.equal(home.status,200);assert.equal(home.text(),publishedHTML,'The restored sites bundle serves the exact published version');secure(home);assert.match(home.headers.get('content-security-policy'),/sandbox/);assert.equal(home.headers.get('cache-control'),'no-store');
 const photoPath=i=>`/assets/${ids.gardenPhotos[i]}.jpg`;
 for(const [i,photo] of photos.entries()){
  const r=await send(siteHost+photoPath(i));assert.equal(r.status,200);assert.deepEqual(r.bytes,photo.bytes,'Exact uploaded photo bytes');assert.equal(hash(r.bytes),photo.digest);assert.equal(r.headers.get('content-type'),'image/jpeg');secure(r);
 }
 count('publishedPhotosServed');
 assert.equal((await send(siteHost+`/assets/${ids.strayPhoto}.jpg`)).status,404,'A photo outside the published version is not served');
 assert.equal((await send(`https://${ids.neighbour}.whumpo.site${photoPath(0)}`)).status,404,'A photo is not served through another project');
 assert.equal((await send(`https://${ids.neighbour}.whumpo.site/`)).status,404,'An unpublished project serves nothing');
 const privateFiles=(await d1.prepare("SELECT id FROM project_files WHERE status<>'ready'").all()).results;assert.equal(privateFiles.length,2,'Both private bodies are unpublished');
 for(const file of privateFiles)assert.equal((await send(siteHost+`/assets/${file.id}.jpg`)).status,404,'Private project files are not served by the public host');
 count('crossProjectAndPrivateRefusals');
 // The restored Worker's own integrity checks refuse damaged bodies; restoring the exact body returns service.
 const key=(await d1.prepare('SELECT object_key,digest FROM project_files WHERE id=?').bind(ids.gardenPhotos[0]).first()).object_key,stored=await files.get(key),storedOptions={httpMetadata:stored.httpMetadata,customMetadata:stored.customMetadata};
 const good=photos[0].bytes,flipped=Uint8Array.from(good);flipped[flipped.length-4]^=1;
 for(const [label,put] of [['missing',null],['altered',[flipped,storedOptions]],['metadata-lost',[good,{}]]]){
  await files.delete(key);if(put)await files.put(key,...put);
  assert.equal((await send(siteHost+photoPath(0))).status,503,'Photo '+label+' is refused by the restored sites bundle');count('photoDamageRefusals');
 }
 await files.delete(key);await files.put(key,good,storedOptions);assert.equal((await send(siteHost+photoPath(0))).status,200);

 // Apps Worker, with the restored runtime. Like production, the apps Worker has no route of its own: visitor-host
 // traffic reaches it only through the sites Worker's APP_HOST service binding, and the runtime only by service binding.
 const shell=await send(appHost+'/'),indexBytes=await readFile(join(assetDirs.apps,'index.html'));
 assert.equal(shell.status,200);assert.deepEqual(shell.bytes,new Uint8Array(indexBytes),'The restored apps asset is the served page');secure(shell);
 for(const id of ['signin','login','join','recover','recovery','recovery-code','saved-code','cancel-recovery','application-form','logout','review-deletion'])assert.ok(shell.text().includes(`id="${id}"`),'Recovery and sign-in shell element '+id);
 const script=await send(appHost+'/visitor.js');assert.deepEqual(script.bytes,new Uint8Array(await readFile(join(assetDirs.apps,'visitor.js'))));
 assert.equal((await send(appHost+'/visitor.js?x=1')).status,400,'Only the exact asset path is served; queries are refused');
 count('applicationAssetsServed');
 assert.equal((await app('/data')).status,401,'No session: sign-in required');
 for(const [label,cookie] of [['malformed',`__Host-whumpo-app-session-${ids.app}=not-a-session`],['tampered',visitorCookie(0).slice(0,-1)+(ids.visitors[0].session.endsWith('0')?'1':'0')],['another-project-name',visitorCookie(0,ids.site)]])assert.equal((await app('/data',{cookie})).status,401,label+' session is refused');
 assert.equal((await app('/data',{visitor:0,method:'POST',body:{},origin:'https://wrong.example'})).status,403,'Cross-origin write refused');
 assert.equal((await app('/auth/recover',{method:'POST',body:{code:'a'.repeat(64),nonce:'5'.repeat(64)}})).status,401,'An unknown recovery code is refused');
 assert.equal((await app('/auth/recover',{method:'POST',body:{code:'short'}})).status,400,'A malformed recovery request is refused');
 assert.equal((await send(`https://app-${ids.site}.whumpo.site/`)).status,404,'A project that is not an application serves no application');
 assert.equal((await send(`https://app-${ids.site}.whumpo.site/data`,{headers:{cookie:visitorCookie(0,ids.site)}})).status,404,'A visitor session never opens another project');
 count('identityDenials');
 for(const i of [0,1]){const r=await app('/data',{visitor:i});assert.equal(r.status,200);assert.deepEqual(r.json(),documents[i],'Restored visitor session reads that visitor\'s own restored document');}
 assert.notDeepEqual(documents[0],documents[1]);
 // A restored visitor writes through the restored apps -> runtime chain; the runtime is only reachable by service binding.
 const operation=crypto.randomUUID(),written=await app('/data',{visitor:0,method:'POST',body:{id:operation,revision:documents[0].revision,pageId:ids.page,input:{note:'restored probe note'}}});
 assert.equal(written.status,200,written.text());assert.deepEqual([written.json().state,written.json().result.value],['complete','Saved']);
 assert.deepEqual((await app('/data',{visitor:0})).json(),{revision:documents[0].revision+1,state:{note:'restored probe note',edits:documents[0].state.edits+1}},'The restored QuickJS program ran in the restored runtime bundle');
 assert.equal((await app('/receipts/'+operation,{visitor:0})).status,200);assert.equal((await app('/receipts/'+operation,{visitor:1})).status,404,'Another visitor cannot read the receipt');
 assert.deepEqual((await app('/data',{visitor:1})).json(),documents[1],'The other visitor\'s document is untouched');
 count('applicationRuntimeWrites');
 assert.equal((await send('https://runtime.example/execute')).status,404,'An unmapped host is not served and the runtime Worker has no public route');
 assert.equal((await send('https://runtime.example/execute',{method:'POST',body:'{}'})).status,405);

 // No restored response carried private bodies, keys or the canary; no Worker reached the network.
 const body=seen.join('\n');assert.ok(!body.includes(ids.canary),'Private object bodies are never served');
 for(const key of ids.objectKeys)assert.ok(!body.includes(key),'Private object keys are never served');
 assert.equal(stack.outbound.count,0,'No restored Worker made an outbound request');
 return {counts,requests:seen.length,restoredStatements:control.statements,restoredObjects:restored.objects,outbound:stack.outbound.count};
}

async function exercisePlatform({stack,ids,assetDirs,makeStranger}){
 const seen=[],counts={};const count=name=>{counts[name]=(counts[name]??0)+1;};
 const send=async(url,init)=>{const response=await stack.route(url,init),bytes=new Uint8Array(await response.arrayBuffer());seen.push(Buffer.from(bytes).toString('latin1'));return {status:response.status,headers:response.headers,bytes,text:()=>Buffer.from(bytes).toString('utf8'),json:()=>JSON.parse(Buffer.from(bytes).toString('utf8'))};};
 const platform='https://whumpo.com',owner={cookie:'__Host-whumpo_session='+ids.ownerToken},d1=await stack.d1('platform');
 assert.equal((await send(platform+'/api/health')).json().status,'ok','The restored platform answers health');
 const index=await send(platform+'/'),dist=await readFile(join(assetDirs.platform,'index.html'));assert.equal(index.status,200);assert.deepEqual(index.bytes,new Uint8Array(dist));
 assert.equal((await send(platform+'/api/profile')).status,401);
 assert.equal((await send(platform+'/api/onboarding/complete',{method:'POST',headers:{...owner,'content-type':'application/json'},body:'{}'})).status,403,'Write without a same-origin header refused');
 assert.equal((await send('https://whumpo.example/api/health')).status,404,'Only the platform origin is served');
 for(const path of ['/api/profile','/api/onboarding','/api/workspace/saved-work','/api/chat','/api/workspace/dashboard'])assert.equal((await send(platform+path,{headers:owner})).status,200,path);
 const items=(await send(platform+'/api/workspace/saved-work',{headers:owner})).json().items;
 assert.ok(items.length===2&&items.every(item=>item.projectId===ids.site&&item.projectName==='Recovered garden'),'The restored owner sees the restored project\'s own unconfirmed uploads');
 const stranger=await makeStranger(d1),other={cookie:'__Host-whumpo_session='+stranger.token},mine=[];
 for(const path of ['/api/profile','/api/onboarding','/api/workspace/saved-work','/api/chat','/api/workspace/dashboard']){const r=await send(platform+path,{headers:other});assert.equal(r.status,200,path);mine.push(r.text());}
 for(const text of mine)for(const secret of [ids.site,ids.app,ids.neighbour,ids.ownerAccount,...ids.gardenPhotos,ids.strayPhoto])assert.ok(!text.includes(secret),'A second owner never sees the restored owner\'s records');
 count('ownerBoundaryChecks');

 // No restored response carried private bodies, keys or the canary; no Worker reached the network.
 const body=seen.join('\n');assert.ok(!body.includes(ids.canary));
 assert.equal(stack.outbound.count,0,'No restored Worker made an outbound request');
 return {counts,requests:seen.length};
}

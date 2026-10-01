import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {buildPwa} from '../tools/build-pwa.mjs';

const manifest=JSON.parse(await readFile('dist/manifest.webmanifest','utf8'));
assert.equal(manifest.id,'/workspace');assert.equal(manifest.start_url,'/workspace');assert.equal(manifest.scope,'/workspace');assert.equal(manifest.display,'standalone');assert.equal(manifest.prefer_related_applications,false);
for(const size of [192,512]){
 const icon=manifest.icons.find(i=>i.sizes===`${size}x${size}`);assert(icon);assert.equal(icon.purpose,'any');
 const bytes=await readFile('dist'+icon.src);assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);
}
const html=await readFile('dist/index.html','utf8');assert(html.includes('rel="manifest"'));assert(html.includes('apple-touch-icon'));
const source=await readFile('dist/workspace-sw.js','utf8');assert(!source.includes('__OFFLINE_VERSION__'));
const origin='https://whumpo.com',handlers=new Map(),stores=new Map([['other-app-cache',new Map()],['whumpo-dashboard-offline-old',new Map()]]),network=[];
let online=true,claimed=false,skipped=false,serverStatus=200;
const normalize=request=>new URL(typeof request==='string'?request:request.url,origin).href;
const cacheFor=key=>{if(!stores.has(key))stores.set(key,new Map());const data=stores.get(key);return {put:async(r,v)=>{data.set(normalize(r),v.clone());},match:async r=>data.get(normalize(r))?.clone()};};
const cacheStorage={keys:async()=>[...stores.keys()],open:async key=>cacheFor(key),delete:async key=>stores.delete(key)};
async function networkFetch(request){
 network.push(request);if(!online)throw TypeError('Synthetic offline');
 const url=new URL(request.url??request,origin);
 if(url.pathname.startsWith('/pwa/')||url.pathname==='/brand/whumpo-mark-96.png'){
  const content=await readFile('dist'+url.pathname);const type=url.pathname.endsWith('.html')?'text/html':url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.js')?'text/javascript':'image/png';
  return new Response(content,{headers:{'content-type':type}});
 }
 return new Response('synthetic-private-network-response',{status:serverStatus,headers:{'cache-control':'no-store'}});
}
vm.runInNewContext(source,{self:{location:{origin},addEventListener:(name,fn)=>handlers.set(name,fn),skipWaiting:async()=>{skipped=true;},clients:{claim:async()=>{claimed=true;}}},caches:cacheStorage,fetch:networkFetch,Request,Response,URL,Map,Promise,Error});
const lifecycle=async name=>{let work;handlers.get(name)({waitUntil:p=>{work=p;}});await work;};
await lifecycle('install');assert(skipped);assert.equal(network.length,4);assert(network.every(r=>r.credentials==='omit'));
await lifecycle('activate');assert(claimed);assert(stores.has('other-app-cache'));assert(!stores.has('whumpo-dashboard-offline-old'));
const cacheName=[...stores.keys()].find(k=>k.startsWith('whumpo-dashboard-offline-'));assert.match(cacheName,/^whumpo-dashboard-offline-[a-f0-9]{24}$/);
assert.deepEqual([...stores.get(cacheName).keys()].sort(),['/pwa/offline.html','/pwa/offline.css','/pwa/offline.js','/brand/whumpo-mark-96.png'].map(p=>origin+p).sort());
function route(path,options={}){let result;handlers.get('fetch')({request:{url:new URL(path,origin).href,method:'GET',mode:'cors',...options},respondWith:p=>{result=p;}});return result;}
for(const path of ['/api/session','/api/chat','/api/profile/avatar','/api/connections/github/callback?code=synthetic','/','/contact/synthetic','/workspace-extra','https://example.test/workspace'])assert.equal(route(path,{mode:'navigate'}),undefined,path);
assert.equal(route('/workspace',{method:'POST',mode:'navigate'}),undefined);
assert.equal(route('/pwa/offline.css?private=synthetic'),undefined);
assert.equal(await (await route('/workspace',{mode:'navigate'})).text(),'synthetic-private-network-response');
serverStatus=401;assert.equal((await route('/workspace/security',{mode:'navigate'})).status,401);serverStatus=503;assert.equal((await route('/workspace',{mode:'navigate'})).status,503);
assert.equal(stores.get(cacheName).size,4,'Network HTML must never be cached');
online=false;
assert((await (await route('/workspace/settings',{mode:'navigate'})).text()).includes('We couldn’t connect'));
assert((await route('/pwa/offline.css')).headers.get('content-type').includes('css'));
stores.get(cacheName).delete(origin+'/pwa/offline.html');assert.equal((await route('/workspace',{mode:'navigate'})).status,503);

const temp=await mkdtemp('/tmp/whumpo-pwa-build-');
try{
 const paths=['workspace-sw.js','pwa/offline.html','pwa/offline.css','pwa/offline.js','brand/whumpo-mark-96.png'];
 for(const dir of ['pwa','brand'])await mkdir(temp+'/'+dir);
 const template=await readFile('frontend/public/workspace-sw.js');
 for(const p of paths)await writeFile(temp+'/'+p,await readFile('frontend/public/'+p));
 const base=pathToFileURL(temp+'/');await buildPwa(base);const first=await readFile(temp+'/workspace-sw.js','utf8');assert.equal(first,source);
 await writeFile(temp+'/workspace-sw.js',template);await writeFile(temp+'/pwa/offline.css','changed public styling');await buildPwa(base);
 assert.notEqual(await readFile(temp+'/workspace-sw.js','utf8'),first,'Offline asset changes must update worker/cache');
}finally{await rm(temp,{recursive:true,force:true});}
console.log('PWA checks passed: manifest/icons, bounded public cache, private/API/callback exclusion, network-first navigation, honest HTTP failures, offline recovery, safe cache updates.');

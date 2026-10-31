// WH-004 (D2) read-only live routing check. Opt in with RUN_LIVE_BOUNDARY_ROUTING=1; otherwise it exits 0 without a request.
// Only GETs and refused requests with no session: nothing here can create or change data. Not exhaustive: it proves that the deployed
// routes refuse the anonymous cases below, not that any authenticated path works. Prints one line per probe.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

if(process.env.RUN_LIVE_BOUNDARY_ROUTING!=='1'){console.log('Skipped: set RUN_LIVE_BOUNDARY_ROUTING=1 to probe the deployed routes (read-only).');process.exit(0);}
const client=JSON.stringify(JSON.parse(readFileSync(new URL('./fixtures/mobile-v1/client.json',import.meta.url),'utf8')).current);
const unknown='app-'+crypto.randomUUID()+'.whumpo.site';
const probes=[
 {name:'platform /api/me without a session',url:'https://whumpo.com/api/me',expect:[401]},
 {name:'mobile route without a bearer',url:'https://whumpo.com/api/mobile/v1/bootstrap',init:{headers:{'whumpo-client':client}},expect:[401]},
 {name:'unknown app host, GET',url:'https://'+unknown+'/',expect:[404]},
 {name:'unknown app host, foreign-Origin POST',url:'https://'+unknown+'/modules',init:{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{}'},expect:[403,404]},
 {name:'preview host root is the static token-less shell (200, no-store, frame-ancestors none)',url:'https://preview.whumpo.site/',expect:[200],headers:{'cache-control':/no-store/,'content-security-policy':/frame-ancestors 'none'/}},
 {name:'/modules on the platform origin is not mounted',url:'https://whumpo.com/modules',init:{method:'POST',headers:{origin:'https://whumpo.com','content-type':'application/json'},body:'{}'},expect:[401,403,404,405]}
];
const results=[];
for(const p of probes){
 const r=await fetch(p.url,{redirect:'manual',...p.init});const body=await r.text();
 for(const [h,re] of Object.entries(p.headers??{}))assert.match(r.headers.get(h)??'',re,p.name+': '+h);
 results.push({...p,status:r.status,cache:r.headers.get('cache-control'),json:/^\s*[{[]/.test(body)});
 console.log(`${p.name}: ${r.status}`);
}
for(const r of results)assert.ok(r.expect.includes(r.status),`${r.name}: got ${r.status}, expected ${r.expect.join('/')}`);
const mod=results.at(-1);assert.ok(!(mod.json&&mod.status<300),'a module operation answered on the platform origin');
console.log(`Live routing: ${results.length} read-only probes as expected.`);

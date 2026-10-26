import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {currentFixtureModules} from './helpers/current-modules.mjs';
// WH-003: Node accepts fetch options that the Workers runtime rejects (PR #356: redirect:'error' made every Turnstile
// siteverify throw a TypeError in production while Node and the local stubs accepted it). This check has two parts:
// 1. a static scan of every fetch(/new Request(/transport(/fetcher( init literal in src/**/*.ts against ALLOWED below;
// 2. a probe Worker in workerd (Miniflare, compatibility date from wrangler.jsonc) that builds a Request from each allowed
//    shape and sends it to a capturing outbound service, and must see the known-bad shapes throw.
// Local synthetic evidence only (workerd under Miniflare), not a deployed Worker. Not in a verification profile (boots workerd).
// `--probe-redirect=error` adds {redirect:'error'} to the allowlisted shapes, to prove the workerd part fails when one is inserted.
const ALLOWED={
 method:/./,
 headers:/./,body:/./,
 redirect:/^['"](follow|manual)['"]$/,
 signal:/^(AbortSignal\.timeout\(.+\)|[\w$]+(\.[\w$]+)*)$/,
 credentials:/^['"](omit|same-origin|include)['"]$/,
 cache:/^['"](no-store|no-cache)['"]$/
};
// Shapes sent through workerd. `signal` is rebuilt inside the Worker (AbortSignal.timeout) because it cannot cross as JSON.
const SHAPES=[{method:'GET'},{method:'POST',headers:{'content-type':'application/json'},body:'{}'},{redirect:'follow'},{redirect:'manual'},{signal:'$timeout'},{credentials:'omit'},{credentials:'same-origin'},{credentials:'include'},{cache:'no-store'},{cache:'no-cache'},{method:'POST',redirect:'manual',signal:'$timeout',headers:{accept:'application/json'},body:'x=1'}];
// Known-bad shapes: workerd must reject these, which proves the probe can see a rejection at all.
const REJECTED=[{redirect:'error'},{cache:'default'}];
const extra=process.argv.filter(a=>a.startsWith('--probe-redirect=')).map(a=>({redirect:a.slice(17)}));

// ---- Part 1: static scan --------------------------------------------------------------------------------------------
// shortcut: hand-rolled scanner (quotes/templates/brackets only, no TypeScript parser); upgrade if a call site defeats it.
function skipString(s,i){const q=s[i];for(i++;i<s.length;i++){if(s[i]==='\\')i++;else if(s[i]===q)return i;else if(q==='`'&&s[i]==='$'&&s[i+1]==='{'){i=close(s,i+1)-1;}}return i;}
function close(s,i){let d=0;for(;i<s.length;i++){const c=s[i];if(c==="'"||c==='"'||c==='`')i=skipString(s,i);else if('([{'.includes(c))d++;else if(')]}'.includes(c)&&--d===0)return i+1;}throw Error('Unbalanced source');}
function split(s){const out=[];let d=0,start=0;for(let i=0;i<s.length;i++){const c=s[i];if(c==="'"||c==='"'||c==='`')i=skipString(s,i);else if('([{'.includes(c))d++;else if(')]}'.includes(c))d--;else if(c===','&&d===0){out.push(s.slice(start,i));start=i+1;}}out.push(s.slice(start));return out.map(x=>x.trim()).filter(Boolean);}
const CALL=/(?:\bnew Request|(?<![\w$])(?:fetch|transport|fetcher)|\.fetch)\(/g;
export function scan(file,text){
 // Browser scripts held in template strings (backendFormScript, guestShellScript) are skipped: browsers accept redirect:'error'.
 const skipped=[];for(const m of text.matchAll(/export const \w*Script=`/g)){const end=skipString(text,m.index+m[0].length-1);skipped.push([m.index,end]);}
 const calls=[];
 for(const m of text.matchAll(CALL)){
  if(skipped.some(([a,b])=>m.index>a&&m.index<b))continue;
  const open=m.index+m[0].length-1,args=split(text.slice(open+1,close(text,open)-1));
  if(/^\w+\s*:/.test(args[0]||'')||!args.length)continue; // a declaration such as fetch(request:Request,...)
  const line=text.slice(0,m.index).split('\n').length,init=args[1],options=[],problems=[];
  if(init?.startsWith('{')){
   for(const entry of split(init.slice(1,-1))){
    if(entry.startsWith('...')){options.push({key:entry,note:'spread, not checked'});continue;}
    const at=entry.indexOf(':'),key=(at<0?entry:entry.slice(0,at)).trim(),value=(at<0?key:entry.slice(at+1)).trim();
    const rule=ALLOWED[key];options.push({key,value});
    if(!rule)problems.push(`option '${key}' is not in the Workers allowlist`);else if(!rule.test(value))problems.push(`${key}:${value} is not an allowed Workers shape`);
   }
  }else if(init)options.push({key:'(init)',note:'non-literal init, not checked'});
  calls.push({file,line,callee:m[0].slice(0,-1).replace('.',''),options,problems});
 }
 return calls;
}
async function sourceFiles(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())out.push(...await sourceFiles(p));else if(p.endsWith('.ts'))out.push(p);}return out;}
// The scanner itself must see the PR #356 shape, otherwise a silent scanner would pass.
assert.equal(scan('self-check',"await fetch('https://x',{method:'POST',redirect:'error'})")[0].problems.length,1,'scanner flags redirect:error');
assert.equal(scan('self-check',"new Request(u,{redirect:'manual',signal:controller.signal})")[0].problems.length,0,'scanner accepts manual');
const calls=[];for(const file of (await sourceFiles('src')).sort())calls.push(...scan(file,await readFile(file,'utf8')));
const withInit=calls.filter(c=>c.options.length);
for(const c of calls)console.log(`${c.file}:${c.line} ${c.callee}(${c.options.map(o=>o.note?`${o.key} [${o.note}]`:`${o.key}:${o.value.length>40?o.value.slice(0,37)+'...':o.value}`).join(', ')||'no init'})${c.problems.length?'  <-- '+c.problems.join('; '):''}`);
const violations=calls.filter(c=>c.problems.length);
assert.deepEqual(violations.map(c=>`${c.file}:${c.line} ${c.problems.join('; ')}`),[],'Workers-incompatible fetch options in src');
console.log(`static scan: ${calls.length} calls, ${withInit.length} with an init literal or option, ${violations.length} violations`);

// ---- Part 2: workerd ------------------------------------------------------------------------------------------------
const wrangler=JSON.parse((await readFile('wrangler.jsonc','utf8')).replace(/^\s*\/\/.*$/gm,''));
const compatibilityDate=wrangler.compatibility_date,compatibilityFlags=wrangler.compatibility_flags;
assert.match(compatibilityDate,/^\d{4}-\d\d-\d\d$/);
const req=createRequire(import.meta.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=req('miniflare');
const dir=await mkdtemp(join(tmpdir(),'whumpo-workers-fetch-'));
// The probe builds both a Request from the init and a direct fetch(url,init), the two forms src/ uses.
await writeFile(dir+'/probe.js',`const fix=i=>i.signal==='$timeout'?{...i,signal:AbortSignal.timeout(5000)}:i;
export default{async fetch(r){const {init,url}=await r.json();const out={};
 for(const [form,run] of [['new Request',()=>fetch(new Request(url,fix(init)))],['fetch(url,init)',()=>fetch(url,fix(init))]])try{await run();out[form]='ok'}catch(e){out[form]=String(e)}
 return Response.json(out)}};`);
const captured=[];
const options=convertV4MiniflareOptions({modulesRoot:dir,modules:[{type:'ESModule',path:dir+'/probe.js'}],compatibilityDate,...(compatibilityFlags?{compatibilityFlags}:{})});
const mf=new Miniflare({...options,workers:[{...options.workers[0],dev:{...options.workers[0].dev,outboundService:{type:'fetcher',handler:async request=>{captured.push({url:request.url,method:request.method,redirect:request.redirect,headers:Object.fromEntries(request.headers),body:await request.text()});return new Response('{"success":true}');}}}}]});
const send=async(init,url='https://example.com/probe')=>(await mf.dispatchFetch('http://probe/',{method:'POST',body:JSON.stringify({init,url})})).json();
let checked=0;
try{
 await mf.ready;
 for(const shape of [...SHAPES,...extra]){
  captured.length=0;const result=await send(shape);
  assert.deepEqual(result,{'new Request':'ok','fetch(url,init)':'ok'},'workerd rejected '+JSON.stringify(shape)+': '+JSON.stringify(result));
  assert.equal(captured.length,2,'workerd sent both requests outbound for '+JSON.stringify(shape));
  checked++;console.log('workerd accepts '+JSON.stringify(shape));
 }
 for(const shape of REJECTED){
  captured.length=0;const result=await send(shape);
  for(const form of Object.keys(result))assert.match(result[form],/TypeError/,`workerd must reject ${JSON.stringify(shape)} via ${form}`);
  assert.equal(captured.length,0,'a rejected shape never reaches the outbound service');
  console.log('workerd rejects '+JSON.stringify(shape)+': '+result['new Request']);
 }
 // Stretch: the real Turnstile siteverify call (src/turnstile.ts) records the init it builds in Node; that exact shape is replayed in workerd.
 const {module}=await currentFixtureModules(['src/turnstile.ts']),{verifyTurnstile}=await module('src/turnstile.ts');
 let seen;const verdict=await verifyTurnstile(async(url,init)=>{seen={url:String(url),init};return new Response('{"success":true,"hostname":"h","action":"a","cdata":"c"}');},'secret','token','203.0.113.1',{hostname:'h',action:'a',cdata:'c'});
 assert.equal(verdict,'verified');
 const replay={...seen.init,body:String(seen.init.body),signal:seen.init.signal?'$timeout':undefined};
 captured.length=0;const result=await send(replay,seen.url);
 assert.deepEqual(result,{'new Request':'ok','fetch(url,init)':'ok'},'workerd rejected the real Turnstile siteverify init '+JSON.stringify(result));
 assert.equal(captured[0].url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');assert.equal(captured[0].method,'POST');assert.match(captured[0].body,/secret=secret&response=token&remoteip=203\.0\.113\.1/);
 console.log('workerd accepts the real Turnstile siteverify request: '+JSON.stringify({method:captured[0].method,url:captured[0].url}));
 console.log(`Workers fetch compatibility passed: ${calls.length} calls scanned (${violations.length} violations); ${checked} allowlisted shapes accepted and ${REJECTED.length} known-bad shapes rejected in workerd (compatibility date ${compatibilityDate}); real Turnstile siteverify request accepted. Local workerd under Miniflare only; Stripe customer-email update not run (needs the billing database fixture).`);
}catch(error){console.error(String(error.stack||error));process.exitCode=1;}
finally{await mf.dispose().catch(()=>{});await rm(dir,{recursive:true,force:true});}

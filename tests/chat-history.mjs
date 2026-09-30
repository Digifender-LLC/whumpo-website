// Connected handler acceptance: actual platform HTTP boundary and visitor host, disposable D1.
import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {build} from 'esbuild';import {unzipSync,strFromU8} from 'fflate';import wrangler from 'wrangler';
const b=await build({stdin:{contents:"export {default as platform} from './src/index';export {default as host} from './src/site-host';export {hashToken} from './src/security';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {platform,host,hashToken}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-customer-journey-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
const env={DB:db,FILES:proxy.env.FILES,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil(){throw Error('No external work expected')}};
async function account(){const id=crypto.randomUUID(),token=(crypto.randomUUID()+crypto.randomUUID()).replaceAll('-',''),now=new Date().toISOString();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(id,id+'@example.test',now).run();await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken(token),id,new Date(Date.now()+3600000).toISOString(),now).run();return {id,token};}
const call=(a,path,method='GET',body,origin='http://localhost')=>platform.fetch(new Request('http://localhost'+path,{method,headers:{origin,cookie:'whumpo_session='+(a?.token??''),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
async function json(a,path,method='GET',body){const r=await call(a,path,method,body);assert.equal(r.status,200,await r.clone().text());return r.json();}
async function chat(a,content){const state=await json(a,'/api/chat'),input={id:crypto.randomUUID(),revision:state.state.revision,content};return {input,data:await json(a,'/api/chat','POST',input)};}
const served=p=>host.fetch(new Request('https://'+p+'.whumpo.site/'),{DB:db,FILES:proxy.env.FILES});
try{
 const owner=await account(),foreign=await account(),now=new Date().toISOString();
 const insert=(u,n)=>db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),u,n,'Question '+n,'Answer '+n,now);
 for(let start=1;start<=155;start+=50)await db.batch(Array.from({length:Math.min(50,156-start)},(_,i)=>insert(owner.id,start+i)));
 await insert(foreign.id,54).run();
 const first=await json(owner,'/api/chat/history?before=156');assert.equal(first.turns.length,50);assert.equal(first.turns[0].revision,106);assert.equal(first.turns.at(-1).revision,155);assert.equal(first.nextBefore,106);
 // New messages do not move the historical boundary or duplicate prior pages.
 await insert(owner.id,156).run();
 const seen=[...first.turns];let cursor=first.nextBefore;
 while(cursor){const page=await json(owner,'/api/chat/history?before='+cursor);assert.ok(page.turns.length<=50);seen.push(...page.turns);cursor=page.nextBefore;}
 assert.equal(seen.length,155);assert.equal(new Set(seen.map(t=>t.id)).size,155);assert.equal(Math.max(...seen.map(t=>t.revision)),155);
 for(const t of seen)assert.deepEqual(Object.keys(t).sort(),['id','revision','user_text','assistant_text','created_at','status'].sort());
 assert.equal((await json(foreign,'/api/chat/history?before=156')).turns.length,1);
 assert.equal((await json(owner,'/api/chat/history?before=1')).turns.length,0);
 for(const suffix of ['', '?before=0','?before=-1','?before=1.5','?before=1e2','?before=9007199254740992','?before=1%20OR%201=1'])assert.equal((await call(owner,'/api/chat/history'+suffix)).status,400);
 assert.equal((await call(null,'/api/chat/history?before=156')).status,401);
 assert.equal((await call(owner,'/api/chat/history?before=156')).headers.get('cache-control'),'no-store');
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM chat_turns WHERE user_id=?').bind(owner.id).first()).n,156);
 console.log('Chat history passed: authenticated HTTP, tenant isolation, bounded complete pagination, concurrent new messages, strict cursors and read-only transcript fields.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}

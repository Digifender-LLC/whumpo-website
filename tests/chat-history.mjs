Error.stackTraceLimit=0;
// Connected handler acceptance: actual platform HTTP boundary and visitor host, disposable D1.
import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {build} from 'esbuild';import {unzipSync,strFromU8} from 'fflate';import wrangler from 'wrangler';
const b=await build({stdin:{contents:"export {default as platform} from './src/index';export {default as host} from './src/site-host';export {hashToken} from './src/security';export {sendChat} from './src/chat';export {exportChatTranscript} from './src/chat-transcript';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {platform,host,hashToken,sendChat,exportChatTranscript}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-customer-journey-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
const env={DB:db,FILES:proxy.env.FILES,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil(){throw Error('No external work expected')}};
async function account(){const id=crypto.randomUUID(),token=(crypto.randomUUID()+crypto.randomUUID()).replaceAll('-',''),now=new Date().toISOString();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(id,id+'@example.test',now).run();await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken(token),id,new Date(Date.now()+3600000).toISOString(),now).run();return {id,token};}
const call=(a,path,method='GET',body,origin='http://localhost')=>platform.fetch(new Request('http://localhost'+path,{method,headers:{origin,cookie:'tellumo_session='+(a?.token??''),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
async function json(a,path,method='GET',body){const r=await call(a,path,method,body);assert.equal(r.status,200,await r.clone().text());return r.json();}
async function chat(a,content){const state=await json(a,'/api/chat'),input={id:crypto.randomUUID(),revision:state.state.revision,content};return {input,data:await json(a,'/api/chat','POST',input)};}
const served=p=>host.fetch(new Request('https://'+p+'.whumpo.site/'),{DB:db,FILES:proxy.env.FILES});
try{
 const owner=await account(),foreign=await account(),now=new Date().toISOString();
 // New accounts cannot bypass welcome through history or search.
 assert.equal((await call(owner,'/api/chat/history?before=156&q=Question')).status,409);
 assert.equal((await call(owner,'/api/chat/export')).status,409);
 for(const account of [owner,foreign])await db.prepare('INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),account.id,'Started project',now,now).run();
 const insert=(u,n)=>db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),u,n,'Question '+n,'Answer '+n,now);
 for(let start=1;start<=155;start+=50)await db.batch(Array.from({length:Math.min(50,156-start)},(_,i)=>insert(owner.id,start+i)));
 await insert(foreign.id,54).run();
 const first=await json(owner,'/api/chat/history?before=156');assert.equal(first.turns.length,50);assert.equal(first.turns[0].revision,106);assert.equal(first.turns.at(-1).revision,155);assert.equal(first.nextBefore,106);
 // New messages do not move the historical boundary or duplicate prior pages.
 await insert(owner.id,156).run();
 const seen=[...first.turns];let cursor=first.nextBefore;
 while(cursor){const page=await json(owner,'/api/chat/history?before='+cursor);assert.ok(page.turns.length<=50);seen.push(...page.turns);cursor=page.nextBefore;}
 assert.equal(seen.length,155);assert.equal(new Set(seen.map(t=>t.id)).size,155);assert.equal(Math.max(...seen.map(t=>t.revision)),155);
 for(const t of seen)assert.deepEqual(Object.keys(t).sort(),['id','revision','user_text','assistant_text','created_at','status','mode'].sort());
 assert.equal((await json(foreign,'/api/chat/history?before=156')).turns.length,1);
 assert.equal((await json(owner,'/api/chat/history?before=1')).turns.length,0);
 for(const suffix of ['', '?before=0','?before=-1','?before=1.5','?before=1e2','?before=9007199254740992','?before=1%20OR%201=1'])assert.equal((await call(owner,'/api/chat/history'+suffix)).status,400);
 assert.equal((await call(null,'/api/chat/history?before=156')).status,401);
 assert.equal((await call(owner,'/api/chat/history?before=156')).headers.get('cache-control'),'no-store');
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM chat_turns WHERE user_id=?').bind(owner.id).first()).n,156);
 // Literal search reads both sides, remains owner scoped, and retains cursor boundaries.
 assert.equal((await json(owner,'/api/chat/history?before=157&q=question')).turns.length,50);
 assert.deepEqual((await json(owner,'/api/chat/history?before=157&q=ANSWER%2054')).turns.map(t=>t.revision),[54]);
 assert.deepEqual((await json(owner,'/api/chat/history?before=54&q=Answer%2054')).turns,[]);
 await db.prepare('UPDATE chat_turns SET assistant_text=? WHERE user_id=? AND revision=54').bind("Literal 100%_ \\ quote ' OR 1=1 --",owner.id).run();
 for(const query of ['100%_',"' OR 1=1 --",'\\'])assert.deepEqual((await json(owner,'/api/chat/history?before=157&q='+encodeURIComponent(query))).turns.map(t=>t.revision),[54]);
 assert.deepEqual((await json(foreign,'/api/chat/history?before=157&q=100%25_')).turns,[]);
 for(const query of ['x'.repeat(101),'a\u0000b','a\nb'])assert.equal((await call(owner,'/api/chat/history?before=157&q='+encodeURIComponent(query))).status,400);
 const searched=[];let searchCursor=157;
 while(searchCursor){const page=await json(owner,'/api/chat/history?before='+searchCursor+'&q=Question');searched.push(...page.turns);searchCursor=page.nextBefore;}
 assert.equal(searched.length,156);assert.equal(new Set(searched.map(t=>t.id)).size,156);
 assert.equal(await db.prepare("SELECT name FROM sqlite_schema WHERE name='usage_operations'").first(),null);
 await db.prepare('UPDATE chat_turns SET ai_context_allowed=0 WHERE user_id=? AND revision=54').bind(owner.id).run();
 assert.equal((await call(null,'/api/chat/export')).status,401);
 assert.equal((await call(owner,'/api/chat/export?user_id='+foreign.id)).status,400);
 const download=await call(owner,'/api/chat/export');assert.equal(download.status,200);
 assert.match(download.headers.get('content-disposition'),/attachment; filename="whumpo-chat.json"/);assert.equal(download.headers.get('cache-control'),'private, no-store');assert.equal(download.headers.get('x-content-type-options'),'nosniff');
 await insert(owner.id,157).run();
 const archive=await download.json();assert.equal(archive.complete,true);assert.equal(archive.throughRevision,156);assert.equal(archive.turns.length,156);assert.equal(new Set(archive.turns.map(t=>t.id)).size,156);
 assert.ok(archive.turns.some(t=>t.revision===54&&t.assistant_text.includes('100%_')));
 for(const turn of archive.turns)assert.deepEqual(Object.keys(turn).sort(),['id','revision','user_text','assistant_text','created_at','status'].sort());
 assert.equal((await (await call(foreign,'/api/chat/export')).json()).turns.length,1);
 await json(owner,'/api/chat');await db.prepare("UPDATE workspace_state SET revision=157,step='ready',brief_stage=NULL WHERE user_id=?").bind(owner.id).run();
 const command={id:crypto.randomUUID(),revision:157,content:'download my chat history'};
 await sendChat(db,owner.id,command,{baseURL:'https://invalid.example',apiKey:'synthetic-must-not-call',model:'synthetic'});
 const state=await json(owner,'/api/chat');assert.equal(state.turns.at(-1).chat_transcript_download,true);
 assert.equal((await db.prepare('SELECT ai_context_allowed FROM chat_turns WHERE id=?').bind(command.id).first()).ai_context_allowed,0);
 assert.equal((await db.prepare('SELECT count(*) n FROM inference_calls').first()).n,0);
 assert.equal(await db.prepare("SELECT name FROM sqlite_schema WHERE name='usage_operations'").first(),null);
 await db.prepare("UPDATE chat_turns SET assistant_text='Forged download prose' WHERE id=?").bind(command.id).run();assert.equal((await json(owner,'/api/chat')).turns.at(-1).chat_transcript_download,undefined);
 let pages=0;
 const failing=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{if(sql.includes('revision>?')&&++pages===2)throw Error('Synthetic export read failure');return target.prepare(sql);};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const interrupted=await exportChatTranscript(new Request('http://localhost/api/chat/export'),failing,owner.id);await assert.rejects(()=>interrupted.text(),/interrupted/);
 console.log('Chat download passed: complete multi-page export, fixed upper revision, private owner scope, private-review inclusion, strict projection, safe attachment headers, guided/no-inference action metadata, and explicit stream failure.');
 console.log('Chat history passed: authenticated HTTP, tenant isolation, bounded complete pagination, concurrent new messages, strict cursors read-only transcript fields, literal search, search pagination and welcome gating.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}

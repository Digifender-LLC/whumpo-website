import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {hostname,verifyDNS,listDomains}=await module('src/domains.ts'),{sendChat,readChat}=await module('src/chat.ts');
for(const invalid of ['whumpo.com','a.whumpo.com','whumpo.site','a.whumpo.site','https://foo.com','foo.com/path','127.0.0.1','localhost','foo.local','x..com','-x.com','x-.com','x.com:443','user@x.com','*.x.com','x'.repeat(64)+'.com'])assert.throws(()=>hostname(invalid));
assert.equal(hostname(' WWW.EXAMPLE.COM '),'www.example.com');
const dnsName='_whumpo.www.example.com',proof='whumpo-verification=abc';
const response=(answer,status=0)=>async()=>new Response(JSON.stringify({Status:status,Answer:answer}));
assert.equal(await verifyDNS(dnsName,proof,response([{name:dnsName+'.',type:16,data:JSON.stringify(proof)}])),true);
for(const a of [{name:'_whumpo.other.com',type:16,data:JSON.stringify(proof)},{name:dnsName,type:5,data:JSON.stringify(proof)},{name:dnsName,type:16,data:JSON.stringify(proof+'wrong')}])assert.equal(await verifyDNS(dnsName,proof,response([a])),false);
assert.equal(await verifyDNS(dnsName,proof,response([],3)),false);
for(const provider of [async()=>new Response('null'),async()=>new Response('bad'),async()=>new Response('x'.repeat(32769)),async()=>new Response('',{status:302,headers:{location:'https://other.com'}}),response([],2)])await assert.rejects(verifyDNS(dnsName,proof,provider),{status:503});
const dir=await mkdtemp('/tmp/whumpo-domains-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;const realFetch=globalThis.fetch;let mode='match',dnsCalls=0;
globalThis.fetch=async(url,options)=>{if(new URL(url instanceof Request?url.url:url).hostname!=='cloudflare-dns.com')return realFetch(url,options);dnsCalls++;assert.equal(options.redirect,'manual');const name=new URL(url).searchParams.get('name');const row=await db.prepare('SELECT token FROM domain_claims WHERE hostname=? ORDER BY created_at DESC LIMIT 1').bind(name.slice(9)).first();return new Response(JSON.stringify({Status:0,Answer:[{name:name+'.',type:16,data:JSON.stringify(mode==='match'?'whumpo-verification='+row.token:'wrong')}]}));};
async function account(){const id=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,'test',?)").bind(id,id+'@example.com','00',new Date().toISOString()).run();return id;}
async function chat(user,content,id=crypto.randomUUID(),revision){const state=await readChat(db,user);return {id,result:await sendChat(db,user,{id,content,revision:revision??state.state.revision})};}
async function project(user){await chat(user,'A useful business website');return (await chat(user,'Domain Test')).id;}
try{
 const owner=await account(),other=await account(),p=await project(owner),q=await project(other);
 const created=await chat(owner,'/domain www.example.com '+p);assert.equal(created.result.status,200);
 const before=(await readChat(db,owner)).state.revision;await chat(owner,'/domain www.example.com '+p,created.id,before-1);assert.equal((await readChat(db,owner)).state.revision,before);
 let domains=await listDomains(db,owner);assert.equal(domains.domains.length,1);const claim=domains.domains[0];assert.equal(claim.status,'awaiting_dns');assert.equal(claim.connected,false);assert.equal(claim.record.value.length,85);
 await chat(owner,'/domain www.example.com '+p);assert.equal((await listDomains(db,owner)).domains.length,1);assert.equal((await listDomains(db,other)).domains.length,0);
 await assert.rejects(chat(other,'/verify-domain '+claim.id),{status:404});await assert.rejects(chat(other,'/domain www.other.com '+p),{status:404});assert.equal(dnsCalls,0);
 const checked=await chat(owner,'/verify-domain '+claim.id);assert.equal(checked.result.status,200);assert.equal((await listDomains(db,owner)).domains[0].status,'ownership_verified');assert.equal(dnsCalls,1);
 await chat(owner,'/verify-domain '+claim.id,checked.id);assert.equal(dnsCalls,1);
 mode='wrong';await chat(owner,'/verify-domain '+claim.id);assert.equal((await listDomains(db,owner)).domains[0].status,'awaiting_dns');
 // A pending claim never locks a different account out of proving the same hostname.
 assert.equal((await chat(other,'/domain www.example.com '+q)).result.status,200);
 await db.prepare("UPDATE domain_claims SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(claim.id).run();await assert.rejects(chat(owner,'/verify-domain '+claim.id),{status:409});
 const beforeStatus=dnsCalls;await db.prepare("UPDATE workspace_state SET step='ready' WHERE user_id=?").bind(owner).run();
 const statusRequest={id:crypto.randomUUID(),revision:(await readChat(db,owner)).state.revision,content:'show domains'},ai={baseURL:'https://unused.example/v1',apiKey:'unused',model:'unused',protocol:'responses'};
 assert.equal((await sendChat(db,owner,statusRequest,ai)).status,200);const snapshot=await db.prepare('SELECT assistant_text,mode FROM chat_turns WHERE id=?').bind(statusRequest.id).first();assert.match(snapshot.assistant_text,/www.example.com — expired/);assert.match(snapshot.assistant_text,/Renew proof: \/domain www.example.com/);assert.ok(!snapshot.assistant_text.includes(claim.record.value));assert.equal(snapshot.mode,'guided');assert.equal(dnsCalls,beforeStatus,'Status is a local read, not a DNS or AI request');
 await chat(other,'/domain foreign-only.example.com '+q);const status=await chat(owner,'/domains');const ownReply=(await db.prepare('SELECT assistant_text FROM chat_turns WHERE id=?').bind(status.id).first()).assistant_text;assert.ok(!ownReply.includes('foreign-only.example.com'));
 await chat(owner,'/domain www.example.com '+p);const renewed=(await listDomains(db,owner)).domains[0];assert.notEqual(renewed.record.value,claim.record.value);assert.equal(renewed.id,claim.id);
 assert.equal((await sendChat(db,owner,statusRequest,ai)).status,200);assert.equal((await db.prepare('SELECT assistant_text FROM chat_turns WHERE id=?').bind(statusRequest.id).first()).assistant_text,snapshot.assistant_text,'Replay retains the explicitly historical status');
 const current=await chat(owner,'/domains');const currentText=(await db.prepare('SELECT assistant_text FROM chat_turns WHERE id=?').bind(current.id).first()).assistant_text;assert.match(currentText,/awaiting dns/);assert.match(currentText,/Check ownership: \/verify-domain/);assert.equal(dnsCalls,beforeStatus);
 await chat(owner,'/domain two.example.com '+p);await chat(owner,'/domain three.example.com '+p);assert.equal((await chat(owner,'/domain four.example.com '+p)).result.status,409);assert.equal((await listDomains(db,owner)).domains.length,3);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM publications WHERE version_id IS NOT NULL').first()).n,0);assert.equal((await readChat(db,owner)).usage.available,50);
 console.log('Domain checks passed: strict hostname validation, fixed bounded DNS resolver, exact TXT proof, tenant isolation, retries without repeated checks, expiry/rotation, no global name squatting, quotas and no publication or AI charge.');
}finally{globalThis.fetch=realFetch;await proxy.dispose();await rm(dir,{recursive:true,force:true});}

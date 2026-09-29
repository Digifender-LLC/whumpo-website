import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {reviewHosting,confirmHosting,disconnectHosting,refreshHosting}=await module('src/domain-hosting.ts'),{sendChat,readChat}=await module('src/chat.ts'),host=(await module('src/site-host.ts')).default;
const dir=await mkdtemp('/tmp/tellumo-hosting-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe'});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
const config={token:'synthetic-token',zone:'a'.repeat(32),target:'hosting.digifender.com'};
async function account(){const id=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,'test',?)").bind(id,id+'@example.com','00',new Date().toISOString()).run();return id;}
async function chat(user,content){const id=crypto.randomUUID(),state=await readChat(db,user);assert.equal((await sendChat(db,user,{id,content,revision:state.state.revision})).status,200);return id;}
let writes=0,deletes=0,mode='ok',proof=true,cname=true,remoteStatus='active',sslStatus='active',existing=0,total=0;
let remoteId=crypto.randomUUID();let claim,username,reviewId;
const transport=async(input,init)=>{const u=new URL(input);assert.equal(init.redirect,'manual');assert.ok(init.signal);
 if(u.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{name:u.searchParams.get('name')+'.',type:u.searchParams.get('type')==='TXT'?16:5,data:u.searchParams.get('type')==='TXT'?JSON.stringify(proof?'tellumo-verification='+claim.token:'wrong'):(cname?config.target+'.':'elsewhere.example.com.')}]});
 assert.equal(u.origin,'https://api.cloudflare.com');assert.equal(init.headers.authorization,'Bearer synthetic-token');
 if(init.method==='POST'){writes++;remoteId=crypto.randomUUID();assert.deepEqual(JSON.parse(init.body),{hostname:claim.hostname,ssl:{method:'http',type:'dv'}});if(mode==='timeout')throw Error('timeout');if(mode==='disconnect')await disconnectHosting(db,username,reviewId,undefined,transport);return Response.json({success:true,result:{id:remoteId,hostname:claim.hostname,status:remoteStatus,ssl:{status:sslStatus}}});}
 if(init.method==='DELETE'){deletes++;if(mode==='deletefail')return new Response('',{status:503});return Response.json({success:true,result:{id:remoteId}});}
 if(u.pathname.endsWith(remoteId)){if(mode==='mismatch')return Response.json({success:true,result:{id:remoteId,hostname:'foreign.example.com',status:'active',ssl:{status:'active'}}});return Response.json({success:true,result:{id:remoteId,hostname:claim.hostname,status:remoteStatus,ssl:{status:sslStatus}}});}
 return Response.json({success:true,result:existing?[{}]:[],result_info:{total_count:u.searchParams.has('hostname')?existing:total}});
};
try{
 const user=username=await account(),other=await account();await chat(user,'A garden website');const project=await chat(user,'Garden');const version=await chat(user,'/build forest');const claimId=await chat(user,'/domain www.example.com '+project);claim=await db.prepare('SELECT * FROM domain_claims WHERE id=?').bind(claimId).first();
 const review=()=>reviewHosting(db,user,crypto.randomUUID(),claimId,config);
 await assert.rejects(()=>reviewHosting(db,user,crypto.randomUUID(),claimId,undefined));await assert.rejects(()=>reviewHosting(db,other,crypto.randomUUID(),claimId,config));
 const r=await review();assert.equal(r.state,'review');assert.equal(writes,0);assert.deepEqual(await reviewHosting(db,user,r.id,claimId,config),r);await assert.rejects(()=>confirmHosting(db,other,r.id,config,transport));
 proof=false;await assert.rejects(()=>confirmHosting(db,user,r.id,config,transport));assert.equal(writes,0);proof=true;
 existing=1;await assert.rejects(()=>confirmHosting(db,user,r.id,config,transport));existing=0;total=80;await assert.rejects(()=>confirmHosting(db,user,r.id,config,transport));total=0;
 const confirmed=await Promise.all([confirmHosting(db,user,r.id,config,transport),confirmHosting(db,user,r.id,config,transport)]);assert.equal(writes,1);assert.ok(confirmed.some(x=>x.state==='provisioning'));await confirmHosting(db,user,r.id,config,transport);assert.equal(writes,1);
 // Publishing remains separate. A connected hostname with no publication exposes nothing.
 let refreshed=await refreshHosting(db,user,r.id,config,transport);assert.equal(refreshed.connected,true);const get=path=>host.fetch(new Request('https://www.example.com'+path),{DB:db,FILES:proxy.env.FILES});assert.equal((await get('/')).status,404);
 const publication=await chat(user,'/publish '+version);await chat(user,'/confirm '+publication);assert.equal((await get('/')).status,200);assert.equal((await get('/api/chat')).status,404);assert.equal((await get('/s/'+project)).status,404);assert.equal((await host.fetch(new Request('https://foreign.example.com/'),{DB:db,FILES:proxy.env.FILES})).status,404);
 for(const failure of ['proof','cname','certificate','identity']){proof=true;cname=true;sslStatus='active';mode='ok';if(failure==='proof')proof=false;if(failure==='cname')cname=false;if(failure==='certificate')sslStatus='pending_validation';if(failure==='identity')mode='mismatch';refreshed=await refreshHosting(db,user,r.id,config,transport);assert.equal(refreshed.connected,false);assert.equal((await get('/')).status,404);}
 proof=true;cname=true;sslStatus='active';mode='ok';await refreshHosting(db,user,r.id,config,transport);await db.prepare("UPDATE domain_connections SET serve_until='2000-01-01' WHERE id=?").bind(r.id).run();assert.equal((await get('/')).status,404);
 mode='deletefail';assert.equal((await disconnectHosting(db,user,r.id,config,transport)).state,'disconnecting');assert.equal((await get('/')).status,404);mode='ok';assert.equal((await disconnectHosting(db,user,r.id,config,transport)).state,'disconnected');assert.equal(deletes,2);assert.equal((await refreshHosting(db,user,r.id,config,transport)).connected,false);
 const race=await review();reviewId=race.id;mode='disconnect';const racing=await confirmHosting(db,user,race.id,config,transport);assert.equal(racing.state,'disconnecting');assert.ok((await db.prepare('SELECT provider_id FROM domain_connections WHERE id=?').bind(race.id).first()).provider_id);mode='ok';await disconnectHosting(db,user,race.id,config,transport);assert.equal(deletes,3);
 // Uncertain creates keep the hostname reserved and never retry POST.
 const uncertain=await review();mode='timeout';assert.equal((await confirmHosting(db,user,uncertain.id,config,transport)).state,'uncertain');assert.equal(writes,3);await confirmHosting(db,user,uncertain.id,config,transport);assert.equal(writes,3);await disconnectHosting(db,user,uncertain.id,config,transport);assert.equal(deletes,3);assert.equal((await db.prepare('SELECT state FROM domain_connections WHERE id=?').bind(uncertain.id).first()).state,'disconnecting');
 const blocked=await review();await assert.rejects(()=>confirmHosting(db,user,blocked.id,config,transport));assert.equal(writes,3);
 await assert.rejects(()=>db.prepare("UPDATE domain_connections SET hostname='foreign.example.com' WHERE id=?").bind(r.id).run());
 console.log('Domain hosting passed: disabled configuration, ownership, review replay, fresh proof, provider inventory limits, no adoption, single concurrent create, exact ID/certificate/CNAME checks, published-only host isolation, lease expiry, immediate disconnect, retried deletion and uncertain-create no-retry.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}

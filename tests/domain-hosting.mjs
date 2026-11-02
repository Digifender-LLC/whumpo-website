import {createFixtureProject,currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {build} from 'esbuild';
const m=await currentSiteFixtureHandlers(),{reviewHosting,confirmHosting,disconnectHosting,refreshHosting,sendChat,readChat,host,listDomains}=m;
// The scheduled job is not exported by the shared fixture; like the cron it uses only the raw database.
const {maintainHosting}=await import('data:text/javascript,'+encodeURIComponent((await build({stdin:{contents:"export {maintainHosting} from './src/domain-hosting';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false})).outputFiles[0].text));
const replyOf=async id=>(await db.prepare('SELECT assistant_text FROM chat_turns WHERE id=?').bind(id).first()).assistant_text;
const fixture=await databaseFixture({d1:true,r2:true}),db=fixture.db,scopes=new Map(),scope=user=>scopes.get(user);
const config={token:'synthetic-token',zone:'a'.repeat(32),target:'hosting.whumpo.site'};
async function account(){const a=await workspaceFixture(db,m);scopes.set(a.account,await a.scope());return a.account;}
async function chat(user,content){const id=crypto.randomUUID(),state=await readChat(scope(user),user);assert.equal((await sendChat(scope(user),user,{id,content,revision:state.state.revision})).status,200);return id;}
let writes=0,deletes=0,mode='ok',proof=true,cname=true,remoteStatus='active',sslStatus='active',existing=0,total=0;
let remoteId=crypto.randomUUID();let claim,username,reviewId;
const transport=async(input,init)=>{const u=new URL(input);assert.equal(init.redirect,'manual');assert.ok(init.signal);
 if(u.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{name:u.searchParams.get('name')+'.',type:u.searchParams.get('type')==='TXT'?16:5,data:u.searchParams.get('type')==='TXT'?JSON.stringify(proof?'whumpo-verification='+claim.token:'wrong'):(cname?config.target+'.':'elsewhere.example.com.')}]});
 assert.equal(u.origin,'https://api.cloudflare.com');assert.equal(init.headers.authorization,'Bearer synthetic-token');
 if(init.method==='POST'){writes++;remoteId=crypto.randomUUID();assert.deepEqual(JSON.parse(init.body),{hostname:claim.hostname,ssl:{method:'http',type:'dv'}});if(mode==='timeout')throw Error('timeout');if(mode==='disconnect')await disconnectHosting(scope(username),username,reviewId,undefined,transport);return Response.json({success:true,result:{id:remoteId,hostname:claim.hostname,status:remoteStatus,ssl:{status:sslStatus}}});}
 if(init.method==='DELETE'){deletes++;if(mode==='deletefail')return new Response('',{status:503});return Response.json({success:true,result:{id:remoteId}});}
 if(u.pathname.endsWith(remoteId)){if(mode==='mismatch')return Response.json({success:true,result:{id:remoteId,hostname:'foreign.example.com',status:'active',ssl:{status:'active'}}});return Response.json({success:true,result:{id:remoteId,hostname:claim.hostname,status:remoteStatus,ssl:{status:sslStatus}}});}
 return Response.json({success:true,result:existing?[{}]:[],result_info:{total_count:u.searchParams.has('hostname')?existing:total}});
};
try{
 const user=username=await account(),other=await account();const {project,version}=await createFixtureProject(scope(user),user,'Garden','A garden website','forest');const claimId=await chat(user,'/domain www.example.com '+project);claim=await db.prepare('SELECT * FROM domain_claims WHERE id=?').bind(claimId).first();
 const review=()=>reviewHosting(scope(user),user,crypto.randomUUID(),claimId,config);
 await assert.rejects(()=>reviewHosting(scope(user),user,crypto.randomUUID(),claimId,undefined));await assert.rejects(()=>reviewHosting(scope(other),other,crypto.randomUUID(),claimId,config));
 const r=await review();assert.equal(r.state,'review');assert.equal(writes,0);assert.deepEqual(await reviewHosting(scope(user),user,r.id,claimId,config),r);await assert.rejects(()=>confirmHosting(scope(other),other,r.id,config,transport));
 proof=false;await assert.rejects(()=>confirmHosting(scope(user),user,r.id,config,transport));assert.equal(writes,0);proof=true;
 existing=1;await assert.rejects(()=>confirmHosting(scope(user),user,r.id,config,transport));existing=0;total=80;await assert.rejects(()=>confirmHosting(scope(user),user,r.id,config,transport));total=0;
 const confirmed=await Promise.all([confirmHosting(scope(user),user,r.id,config,transport),confirmHosting(scope(user),user,r.id,config,transport)]);assert.equal(writes,1);assert.ok(confirmed.some(x=>x.state==='provisioning'));await confirmHosting(scope(user),user,r.id,config,transport);assert.equal(writes,1);
 // Publishing remains separate. A connected hostname with no publication exposes nothing.
 let refreshed=await refreshHosting(scope(user),user,r.id,config,transport);assert.equal(refreshed.connected,true);const get=path=>host.fetch(new Request('https://www.example.com'+path),{DB:db,FILES:fixture.env.FILES});assert.equal((await get('/')).status,404);
 const publication=await chat(user,'/publish '+version);await chat(user,'/confirm '+publication);assert.equal((await get('/')).status,200);assert.equal((await get('/api/chat')).status,404);assert.equal((await get('/s/'+project)).status,404);assert.equal((await host.fetch(new Request('https://foreign.example.com/'),{DB:db,FILES:fixture.env.FILES})).status,404);
 // WH-033: the connected host reaches only its own project. Another account's published project is not reachable through it,
 // and that account proving the same name cannot take the reserved hostname over: refused before any provider request.
 const rival=await account(),{project:rivalProject,version:rivalVersion}=await createFixtureProject(scope(rival),rival,'Rival','Another website','forest');await chat(rival,'/confirm '+await chat(rival,'/publish '+rivalVersion));
 const local=path=>host.fetch(new Request('http://localhost'+path),{DB:db,FILES:fixture.env.FILES});assert.equal((await local('/s/'+rivalProject+'/')).status,200);
 for(const path of ['/s/'+rivalProject,'/s/'+rivalProject+'/','/s/'+rivalProject+'/directory.json','/s/'+rivalProject+'/cms/','/s/'+project+'/'])assert.equal((await get(path)).status,404);
 const ownPage=await (await local('/s/'+project+'/')).text(),ownerClaim=claim,rivalClaimId=await chat(rival,'/domain www.example.com '+rivalProject);claim=await db.prepare('SELECT * FROM domain_claims WHERE id=?').bind(rivalClaimId).first();assert.notEqual(claim.project_id,project);
 const rivalReview=await reviewHosting(scope(rival),rival,crypto.randomUUID(),rivalClaimId,config);await assert.rejects(()=>confirmHosting(scope(rival),rival,rivalReview.id,config,transport),{status:409});assert.equal(writes,1);claim=ownerClaim;
 assert.equal((await db.prepare('SELECT state FROM domain_connections WHERE id=?').bind(rivalReview.id).first()).state,'review');const served=await get('/');assert.equal(served.status,200);assert.equal(await served.text(),ownPage);
 // WH-183: /directory and /directory.json follow the same mapping and publication; the ETag is the approved live_digest.
 const dirConfirm=async id=>{const state=await readChat(scope(user),user);assert.equal((await m.sendChatControl(scope(user),user,{id:crypto.randomUUID(),revision:state.state.revision,action:{type:'confirm',kind:'directory',reviewId:id}})).status,200);};
 assert.equal((await get('/directory.json')).status,404);assert.equal((await get('/directory')).status,404);
 await dirConfirm(await chat(user,`/directory-add ${project} | Garden Club | Weekly meetups | https://example.com/`));await dirConfirm(await chat(user,'/directory-publish '+project));
 const live=await db.prepare('SELECT live_digest FROM directories WHERE project_id=?').bind(project).first(),dj=await get('/directory.json');assert.equal(dj.status,200);assert.equal(dj.headers.get('etag'),'"'+live.live_digest+'"');assert.equal((await dj.json()).listings[0].title,'Garden Club');assert.equal((await get('/directory')).status,200);assert.equal((await get('/directory')).headers.get('etag'),'"'+live.live_digest+'"');assert.equal((await get('/directory.json?x=1')).status,200);assert.equal((await get('/directory/extra')).status,404);
 const foreignDirectory=await host.fetch(new Request('https://foreign.example.com/directory.json'),{DB:db,FILES:fixture.env.FILES});assert.equal(foreignDirectory.status,404);
 await dirConfirm(await chat(user,'/directory-off '+project));assert.equal((await get('/directory.json')).status,404);await dirConfirm(await chat(user,'/directory-publish '+project));assert.equal((await get('/directory.json')).status,200);
 for(const failure of ['proof','cname','certificate','identity']){proof=true;cname=true;sslStatus='active';mode='ok';if(failure==='proof')proof=false;if(failure==='cname')cname=false;if(failure==='certificate')sslStatus='pending_validation';if(failure==='identity')mode='mismatch';refreshed=await refreshHosting(scope(user),user,r.id,config,transport);assert.equal(refreshed.connected,false);assert.equal((await get('/')).status,404);}
 proof=true;cname=true;sslStatus='active';mode='ok';await refreshHosting(scope(user),user,r.id,config,transport);await db.prepare("UPDATE domain_connections SET serve_until='2000-01-01' WHERE id=?").bind(r.id).run();assert.equal((await get('/')).status,404);
 mode='deletefail';assert.equal((await disconnectHosting(scope(user),user,r.id,config,transport)).state,'disconnecting');assert.equal((await get('/')).status,404);mode='ok';assert.equal((await disconnectHosting(scope(user),user,r.id,config,transport)).state,'disconnected');assert.equal(deletes,2);assert.equal((await refreshHosting(scope(user),user,r.id,config,transport)).connected,false);
 const race=await review();reviewId=race.id;mode='disconnect';const racing=await confirmHosting(scope(user),user,race.id,config,transport);assert.equal(racing.state,'disconnecting');assert.ok((await db.prepare('SELECT provider_id FROM domain_connections WHERE id=?').bind(race.id).first()).provider_id);mode='ok';await disconnectHosting(scope(user),user,race.id,config,transport);assert.equal(deletes,3);
 // Uncertain creates keep the hostname reserved and never retry POST.
 const uncertain=await review();mode='timeout';assert.equal((await confirmHosting(scope(user),user,uncertain.id,config,transport)).state,'uncertain');assert.equal(writes,3);await confirmHosting(scope(user),user,uncertain.id,config,transport);assert.equal(writes,3);
 // WH-033: neither a user check nor the hourly job re-sends the create, adopts a hostname or deletes anything for an unknown outcome.
 mode='ok';assert.equal((await refreshHosting(scope(user),user,uncertain.id,config,transport)).state,'uncertain');await maintainHosting(db,config,transport);assert.equal(writes,3);assert.equal(deletes,3);
 const unknown=await db.prepare('SELECT state,provider_id,serve_until FROM domain_connections WHERE id=?').bind(uncertain.id).first();assert.deepEqual({...unknown},{state:'uncertain',provider_id:null,serve_until:null});
 const unknownReply=await replyOf(await chat(user,'/hosting'));assert.match(unknownReply,/Creation is unresolved; it will not be automatically retried or adopted by hostname/);mode='timeout';
 await disconnectHosting(scope(user),user,uncertain.id,config,transport);assert.equal(deletes,3);assert.equal((await db.prepare('SELECT state FROM domain_connections WHERE id=?').bind(uncertain.id).first()).state,'disconnecting');
 const blocked=await review();await assert.rejects(()=>confirmHosting(scope(user),user,blocked.id,config,transport));assert.equal(writes,3);
 await assert.rejects(()=>db.prepare("UPDATE domain_connections SET hostname='foreign.example.com' WHERE id=?").bind(r.id).run());
 // WH-033: ownership proof alone, a hosting review and a created hostname still awaiting its certificate are never shown or served as working hosting.
 // The control differs only in the certificate becoming active.
 mode='ok';const proven=await account(),{project:provenProject,version:provenVersion}=await createFixtureProject(scope(proven),proven,'Bakery','A bakery website','forest');await chat(proven,'/confirm '+await chat(proven,'/publish '+provenVersion));
 const provenClaimId=await chat(proven,'/domain shop.example.net '+provenProject);claim=await db.prepare('SELECT * FROM domain_claims WHERE id=?').bind(provenClaimId).first();
 const savedFetch=globalThis.fetch;globalThis.fetch=transport;try{await chat(proven,'/verify-domain '+provenClaimId);}finally{globalThis.fetch=savedFetch;}
 const shop=()=>host.fetch(new Request('https://shop.example.net/'),{DB:db,FILES:fixture.env.FILES});
 const notLive=async state=>{const d=(await listDomains(scope(proven),proven)).domains.find(d=>d.id===provenClaimId);assert.equal(d.status,'ownership_verified');assert.equal(d.connected,false);assert.equal((await shop()).status,404);
  const domainsReply=await replyOf(await chat(proven,'/domains'));assert.match(domainsReply,/Hosting: not connected/);assert.doesNotMatch(domainsReply,/saved connection is active/);
  const hostingReply=await replyOf(await chat(proven,'/hosting'));if(state)assert.match(hostingReply,new RegExp('Hosting for shop\\.example\\.net: '+state+'\\n'));else assert.match(hostingReply,/No hosting connections yet/);assert.doesNotMatch(hostingReply,/: connected\n/);};
 await notLive();const shopReview=await reviewHosting(scope(proven),proven,crypto.randomUUID(),provenClaimId,config);assert.equal(shopReview.connected,false);await notLive('review');
 sslStatus='pending_validation';const shopCreated=await confirmHosting(scope(proven),proven,shopReview.id,config,transport);assert.equal(shopCreated.state,'provisioning');assert.equal(shopCreated.connected,false);
 const pending=await refreshHosting(scope(proven),proven,shopReview.id,config,transport);assert.equal(pending.connected,false);assert.equal(pending.certificateStatus,'pending_validation');await notLive('provisioning');
 sslStatus='active';assert.equal((await refreshHosting(scope(proven),proven,shopReview.id,config,transport)).connected,true);assert.equal((await shop()).status,200);assert.match(await replyOf(await chat(proven,'/hosting')),/Hosting for shop\.example\.net: connected\n/);assert.equal((await listDomains(scope(proven),proven)).domains.find(d=>d.id===provenClaimId).connected,true);assert.match(await replyOf(await chat(proven,'/domains')),/saved connection is active/);sslStatus='active';
 console.log('Domain hosting passed: disabled configuration, ownership, review replay, fresh proof, provider inventory limits, no adoption, single concurrent create, exact ID/certificate/CNAME checks, published-only host isolation, lease expiry, immediate disconnect, retried deletion, uncertain-create no-retry by check or hourly job, cross-project/cross-account host isolation and ownership-proof-is-not-hosting (WH-033).');
}finally{await fixture.close();}

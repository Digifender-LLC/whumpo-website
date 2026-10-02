import {createFixtureProject,currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),{reviewHosting,confirmHosting,disconnectHosting,refreshHosting,sendChat,readChat,host}=m;
const fixture=await databaseFixture({d1:true,r2:true}),db=fixture.db,scopes=new Map(),scope=user=>scopes.get(user);
const config={token:'synthetic-token',zone:'a'.repeat(32),target:'hosting.whumpo.site'};
async function account(){const a=await workspaceFixture(db,m);scopes.set(a.account,await a.scope());return a.account;}
async function chat(user,content){const id=crypto.randomUUID(),state=await readChat(scope(user),user);assert.equal((await sendChat(scope(user),user,{id,content,revision:state.state.revision})).status,200);return id;}
let writes=0,deletes=0,mode='ok',proof=true,cname=true,remoteStatus='active',sslStatus='active',existing=0,total=0;
let remoteId=crypto.randomUUID();let claim,username,reviewId;
const transport=async(input,init)=>{const u=new URL(input);assert.equal(init.redirect,'manual');assert.ok(init.signal);
 if(u.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{name:u.searchParams.get('name')+'.',type:u.searchParams.get('type')==='TXT'?16:5,data:u.searchParams.get('type')==='TXT'?JSON.stringify(proof?'tellumo-verification='+claim.token:'wrong'):(cname?config.target+'.':'elsewhere.example.com.')}]});
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
 for(const failure of ['proof','cname','certificate','identity']){proof=true;cname=true;sslStatus='active';mode='ok';if(failure==='proof')proof=false;if(failure==='cname')cname=false;if(failure==='certificate')sslStatus='pending_validation';if(failure==='identity')mode='mismatch';refreshed=await refreshHosting(scope(user),user,r.id,config,transport);assert.equal(refreshed.connected,false);assert.equal((await get('/')).status,404);}
 proof=true;cname=true;sslStatus='active';mode='ok';await refreshHosting(scope(user),user,r.id,config,transport);await db.prepare("UPDATE domain_connections SET serve_until='2000-01-01' WHERE id=?").bind(r.id).run();assert.equal((await get('/')).status,404);
 mode='deletefail';assert.equal((await disconnectHosting(scope(user),user,r.id,config,transport)).state,'disconnecting');assert.equal((await get('/')).status,404);mode='ok';assert.equal((await disconnectHosting(scope(user),user,r.id,config,transport)).state,'disconnected');assert.equal(deletes,2);assert.equal((await refreshHosting(scope(user),user,r.id,config,transport)).connected,false);
 const race=await review();reviewId=race.id;mode='disconnect';const racing=await confirmHosting(scope(user),user,race.id,config,transport);assert.equal(racing.state,'disconnecting');assert.ok((await db.prepare('SELECT provider_id FROM domain_connections WHERE id=?').bind(race.id).first()).provider_id);mode='ok';await disconnectHosting(scope(user),user,race.id,config,transport);assert.equal(deletes,3);
 // Uncertain creates keep the hostname reserved and never retry POST.
 const uncertain=await review();mode='timeout';assert.equal((await confirmHosting(scope(user),user,uncertain.id,config,transport)).state,'uncertain');assert.equal(writes,3);await confirmHosting(scope(user),user,uncertain.id,config,transport);assert.equal(writes,3);await disconnectHosting(scope(user),user,uncertain.id,config,transport);assert.equal(deletes,3);assert.equal((await db.prepare('SELECT state FROM domain_connections WHERE id=?').bind(uncertain.id).first()).state,'disconnecting');
 const blocked=await review();await assert.rejects(()=>confirmHosting(scope(user),user,blocked.id,config,transport));assert.equal(writes,3);
 await assert.rejects(()=>db.prepare("UPDATE domain_connections SET hostname='foreign.example.com' WHERE id=?").bind(r.id).run());
 console.log('Domain hosting passed: disabled configuration, ownership, review replay, fresh proof, provider inventory limits, no adoption, single concurrent create, exact ID/certificate/CNAME checks, published-only host isolation, lease expiry, immediate disconnect, retried deletion and uncertain-create no-retry.');
}finally{await fixture.close();}

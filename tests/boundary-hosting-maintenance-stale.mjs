// WH-004 boundary audit, `scheduled-provider-cleanup` / `stale`: the hourly hosting sweep (`maintainHosting`, run by
// the platform `scheduled()` handler on the raw database) end to end, through the real domain-hosting handlers and the
// sites Worker's default export. Local SQLite (default) or local D1 (`--d1`); synthetic accounts, no network (Cloudflare
// and DNS calls go to a recording stub; global fetch throws). One sweep over five due records asserts that:
//   - records are re-checked stalest first (ORDER BY checked_at ASC, batches of four);
//   - an active connection whose serving window lapsed is re-checked, renewed and serves again;
//   - an active connection whose ownership proof no longer resolves, or whose provider hostname is gone, is demoted to
//     provisioning with no serving window and stops serving within the run;
//   - a connection left in `disconnecting` by a failed cleanup has its exact provider hostname removed and is closed;
//   - a hosting review is never touched, and a second sweep does not act on the closed record again.
// Negative control: the same sweep without hosting configuration makes no call and changes no row.
// All temporary, cache and Wrangler/miniflare state stays under the worktree's ignored `.wrangler/` directory.
import assert from 'node:assert/strict';
import {mkdirSync,rmSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const sandbox=resolve(dirname(fileURLToPath(import.meta.url)),'../.wrangler/boundary-hosting-maintenance-stale');
rmSync(sandbox,{recursive:true,force:true});
for(const [key,path] of [['HOME','home'],['XDG_CONFIG_HOME','config'],['XDG_CACHE_HOME','cache'],['XDG_DATA_HOME','data'],['XDG_STATE_HOME','state'],['TMPDIR','tmp']]){mkdirSync(sandbox+'/'+path,{recursive:true});process.env[key]=sandbox+'/'+path;}
process.env.WRANGLER_LOG_PATH=sandbox+'/logs';process.env.WRANGLER_SEND_METRICS='false';
const {build}=await import('esbuild');
const {createFixtureProject,currentSiteFixtureHandlers}=await import('./current-site-fixture.mjs');
const {databaseFixture}=await import('./helpers/current-database.mjs');
const {workspaceFixture}=await import('./helpers/workspace-identity.mjs');

const m=await currentSiteFixtureHandlers(),{sendChat,readChat,host,reviewHosting,confirmHosting,refreshHosting,disconnectHosting}=m;
// `maintainHosting` is not exported by the shared fixture; it uses only the raw database, as the scheduled job does.
const bundled=await build({stdin:{contents:"export {maintainHosting} from './src/domain-hosting';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {maintainHosting}=await import('data:text/javascript,'+encodeURIComponent(bundled.outputFiles[0].text));
const store=await databaseFixture(),db=store.db,scopes=new Map(),scope=u=>scopes.get(u),id=()=>crypto.randomUUID();
// Fixture values are built at runtime from short, obviously fake parts; none is a real or credential-shaped literal.
const fixtureValue=['fixture','value'].join('-'),fixtureZone=id().replaceAll('-','');
const config={token:fixtureValue,zone:fixtureZone,target:'hosting.whumpo.site'};
const expectedAuthorization=['Bearer',fixtureValue].join(' ');
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No network is allowed');};

// Provider and DNS stub: one custom hostname per provider id; TXT answers the claim's current proof, CNAME the target.
// Every provider call is recorded as [method, provider id] in order.
const providers=new Map(),proofs=new Map(),calls=[];
const transport=async(input,init)=>{
 const u=new URL(input);assert.equal(init.redirect,'manual');
 if(u.hostname==='cloudflare-dns.com'){
  const name=u.searchParams.get('name'),txt=u.searchParams.get('type')==='TXT',hostname=txt?name.replace(/^_whumpo\./,''):name;
  return Response.json({Status:0,Answer:[{name:name+'.',type:txt?16:5,data:txt?JSON.stringify('whumpo-verification='+proofs.get(hostname)):config.target+'.'}]});
 }
 assert.equal(u.origin,'https://api.cloudflare.com');assert.equal(init.headers.authorization,expectedAuthorization);
 if(init.method==='POST'){const hostname=JSON.parse(init.body).hostname,providerId=id();providers.set(providerId,hostname);calls.push(['POST',providerId]);return Response.json({success:true,result:{id:providerId,hostname,status:'active',ssl:{status:'active'}}});}
 const providerId=u.pathname.split('/').pop();
 if(providerId==='custom_hostnames')return Response.json({success:true,result:[],result_info:{total_count:0}});
 calls.push([init.method,providerId]);
 if(!providers.has(providerId))return Response.json({success:false,errors:[{code:1436,message:'Custom hostname not found'}]},{status:404});
 if(init.method==='DELETE'){providers.delete(providerId);return Response.json({success:true,result:{id:providerId}});}
 return Response.json({success:true,result:{id:providerId,hostname:providers.get(providerId),status:'active',ssl:{status:'active'}}});
};
const unavailable=async()=>{throw Error('provider unavailable');};

async function account(){const a=await workspaceFixture(db,m);scopes.set(a.account,await a.scope());return a.account;}
async function chat(user,content){const turn=id(),state=await readChat(scope(user),user);const sent=await sendChat(scope(user),user,{id:turn,content,revision:state.state.revision});assert.equal(sent.status,200,content);return turn;}
async function publish(user,name){const site=await createFixtureProject(scope(user),user,name,'A synthetic '+name+' website.');await chat(user,'/confirm '+await chat(user,'/publish '+site.version));return site;}
/** Claims the hostname and prepares a hosting review through the real handlers. */
async function review(user,project,hostname){
 const claimId=await chat(user,`/domain ${hostname} ${project}`);
 // The proof value is the random one the real `/domain` handler stored; it is read back, never written in this file.
 proofs.set(hostname,(await db.prepare('SELECT token AS proof FROM domain_claims WHERE id=?').bind(claimId).first()).proof);
 return (await reviewHosting(scope(user),user,id(),claimId,config)).id;
}
/** Confirms and refreshes the review until the hostname serves. */
async function connect(user,project,hostname){
 const reviewId=await review(user,project,hostname);
 assert.equal((await confirmHosting(scope(user),user,reviewId,config,transport)).state,'provisioning');
 assert.equal((await refreshHosting(scope(user),user,reviewId,config,transport)).connected,true,hostname+' is connected');
 return reviewId;
}
const serve=url=>host.fetch(new Request(url,{headers:{'cf-connecting-ip':'198.51.100.62'}}),{DB:db,FILES:store.env?.FILES});
const connection=connectionId=>db.prepare('SELECT * FROM domain_connections WHERE id=?').bind(connectionId).first();
const rows=async ids=>JSON.stringify(await Promise.all(ids.map(connection)));
const hostname=label=>`${label}-${id().slice(0,8)}.example.com`;

try{
 const a=await account(),b=await account();
 const lapsedSite=await publish(a,'Lapsed window'),proofSite=await publish(b,'Withdrawn proof');
 const goneSite=await createFixtureProject(scope(a),a,'Provider gone','A synthetic website.');
 const leavingSite=await createFixtureProject(scope(b),b,'Leaving','A synthetic website.');
 const freshSite=await createFixtureProject(scope(a),a,'Fresh','A synthetic website.');
 const pendingSite=await createFixtureProject(scope(b),b,'Pending review','A synthetic website.');
 const names={lapsed:hostname('lapsed'),proof:hostname('proof'),gone:hostname('gone'),leaving:hostname('leaving'),fresh:hostname('fresh'),pending:hostname('pending')};
 const lapsed=await connect(a,lapsedSite.project,names.lapsed),proof=await connect(b,proofSite.project,names.proof);
 const gone=await connect(a,goneSite.project,names.gone),leaving=await connect(b,leavingSite.project,names.leaving);
 const fresh=await connect(a,freshSite.project,names.fresh),pending=await review(b,pendingSite.project,names.pending);
 const providerOf=async connectionId=>(await connection(connectionId)).provider_id;
 const ids={lapsed:await providerOf(lapsed),proof:await providerOf(proof),gone:await providerOf(gone),leaving:await providerOf(leaving),fresh:await providerOf(fresh)};

 // A cleanup whose provider call failed leaves the record in `disconnecting` with its exact provider id kept.
 const stuck=await disconnectHosting(scope(b),b,leaving,config,unavailable);
 assert.equal(stuck.state,'disconnecting','a failed provider cleanup stays pending');
 assert.equal((await connection(leaving)).provider_id,ids.leaving);
 assert.ok(providers.has(ids.leaving),'the provider hostname still exists');
 // The stale states the sweep must handle. `fresh` was checked most recently, so it falls in the second batch.
 const checked=(connectionId,at)=>db.prepare('UPDATE domain_connections SET checked_at=? WHERE id=?').bind(at,connectionId).run();
 await checked(leaving,'2000-01-01T00:00:01.000Z');await checked(lapsed,'2000-01-01T00:00:02.000Z');
 await checked(proof,'2000-01-01T00:00:03.000Z');await checked(gone,'2000-01-01T00:00:04.000Z');
 await db.prepare("UPDATE domain_connections SET serve_until='2000-01-02T00:00:00.000Z' WHERE id=?").bind(lapsed).run();
 proofs.set(names.proof,'withdrawn-'+id());
 providers.delete(ids.gone);
 assert.equal((await serve('https://'+names.lapsed+'/')).status,404,'a lapsed serving window stops serving until a successful check');
 assert.equal((await serve('https://'+names.proof+'/')).status,200,'the connection with the withdrawn proof still serves before the sweep');
 for(const [connectionId,state] of [[lapsed,'active'],[proof,'active'],[gone,'active'],[leaving,'disconnecting'],[fresh,'active'],[pending,'review']])assert.equal((await connection(connectionId)).state,state);

 // Negative control: without hosting configuration the scheduled job is skipped; nothing is read or written.
 const everything=[lapsed,proof,gone,leaving,fresh,pending],before=await rows(everything);
 const callsBefore=calls.length;
 await maintainHosting(db,undefined,transport);
 assert.equal(calls.length,callsBefore,'negative control: no provider call without configuration');
 assert.equal(await rows(everything),before,'negative control: no row changes without configuration');

 const pendingBefore=JSON.stringify(await connection(pending)),started=new Date().toISOString();
 await maintainHosting(db,config,transport);
 const sweep=calls.slice(callsBefore);

 // Stalest first: the four oldest records are all read before the most recently checked one.
 const reads=sweep.filter(([method])=>method==='GET').map(([,providerId])=>providerId);
 assert.deepEqual(new Set(reads.slice(0,4)),new Set([ids.leaving,ids.lapsed,ids.proof,ids.gone]),'the first batch is the four stalest records');
 assert.equal(reads[4],ids.fresh,'the most recently checked record is re-checked last');
 assert.equal(reads.length,5,'each due record is read once');

 // Lapsed window: re-checked and renewed, and the custom hostname serves again.
 const renewed=await connection(lapsed);
 assert.equal(renewed.state,'active');assert.ok(renewed.checked_at>=started,'the lapsed record was re-checked');
 assert.ok(renewed.serve_until>new Date().toISOString(),'its serving window was renewed');
 assert.equal((await serve('https://'+names.lapsed+'/')).status,200,'the renewed hostname serves again');
 // Withdrawn proof: demoted fail-closed within the run.
 const demoted=await connection(proof);
 assert.equal(demoted.state,'provisioning');assert.equal(demoted.serve_until,null);assert.ok(demoted.checked_at>=started);
 assert.equal(demoted.detail,'Awaiting active hostname, certificate, current TXT proof and direct CNAME');
 assert.equal((await serve('https://'+names.proof+'/')).status,404,'a withdrawn proof stops serving after the sweep');
 // Provider hostname gone: demoted, no serving window, nothing recreated.
 const orphaned=await connection(gone);
 assert.equal(orphaned.state,'provisioning');assert.equal(orphaned.serve_until,null);
 assert.equal(orphaned.detail,'Hosting could not be verified. Local routing is disabled until a successful check.');
 assert.equal(sweep.filter(([method])=>method==='POST').length,0,'the sweep never creates a hostname');
 // Pending cleanup: the exact provider hostname is removed and the record closed.
 const closed=await connection(leaving);
 assert.equal(closed.state,'disconnected');assert.equal(closed.provider_id,ids.leaving);assert.equal(closed.serve_until,null);
 assert.deepEqual(sweep.filter(([method])=>method==='DELETE'),[['DELETE',ids.leaving]],'only the pending cleanup is deleted, by its exact id');
 assert.ok(!providers.has(ids.leaving));
 // Fresh record: re-checked and still serving authorization.
 const kept=await connection(fresh);
 assert.equal(kept.state,'active');assert.ok(kept.checked_at>=started&&kept.serve_until>new Date().toISOString());
 // A review is not a hosting record yet; the sweep never touches it.
 assert.equal(JSON.stringify(await connection(pending)),pendingBefore,'the hosting review is untouched');
 console.log('maintainHosting stale records: the four stalest records are re-checked before the most recent; a lapsed window is renewed and serves again; a withdrawn proof and a missing provider hostname are demoted to provisioning with no serving window (the withdrawn one stops serving); a pending cleanup removes its exact provider hostname and closes; a review is untouched. Without configuration the sweep makes no call and changes no row.');

 // A second sweep does not act on the closed record again and keeps the demoted records demoted.
 const second=calls.length;
 await maintainHosting(db,config,transport);
 const again=calls.slice(second);
 assert.ok(!again.some(([,providerId])=>providerId===ids.leaving),'the closed record is not selected again');
 assert.equal(again.filter(([method])=>method==='DELETE').length,0);
 assert.equal((await connection(leaving)).state,'disconnected');
 assert.equal((await connection(proof)).serve_until,null,'a still-withdrawn proof stays without a serving window');
 assert.equal((await connection(gone)).serve_until,null,'a still-missing provider hostname stays without a serving window');
 assert.equal((await serve('https://'+names.lapsed+'/')).status,200);
 console.log('Second sweep: the closed record is not selected again, no deletion repeats, and demoted records stay without a serving window.');
}catch(error){console.error(String(error?.stack??error).split('\n').filter(line=>!line.includes('data:text/javascript')).join('\n'));process.exitCode=1;}
finally{globalThis.fetch=originalFetch;await store.close?.();rmSync(sandbox,{recursive:true,force:true});}

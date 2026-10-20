// WH-004 slice 6: custom-domain serving after a project changes owner, through the sites Worker's real default export
// and the real domain-hosting handlers. Local SQLite (default) or local D1 (`--d1`); synthetic accounts, no network
// (Cloudflare and DNS calls go to a recording stub; global fetch throws).
//   1. Regression for the gap recorded at docs/boundary-audit.json ("owner-join refusal itself is untested"): an active,
//      unexpired custom-domain connection stops serving as soon as its creator no longer owns the project, while the
//      project host keeps serving the same publication; moving the project back serves the custom host again.
//   2. Characterization of finding S6-1 (docs/boundary-audit-custom-domain-owner-2026-10-20.md): the connection left
//      behind by that transfer makes every hourly `maintainHosting` run reject in its first batch, so connections in
//      later batches (other tenants) are never re-checked and their serving window lapses. Neither the old nor the new
//      owner can refresh or disconnect it. The control runs the identical maintenance with the project moved back.
// Every refusal check has a negative control in which only the property under test differs.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createFixtureProject,currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';

const m=await currentSiteFixtureHandlers(),{sendChat,readChat,host,reviewHosting,confirmHosting,refreshHosting,disconnectHosting}=m;
// `maintainHosting` is not exported by the shared fixture; it uses only the raw database, as the scheduled job does.
const bundled=await build({stdin:{contents:"export {maintainHosting} from './src/domain-hosting';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {maintainHosting}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].contents).toString('base64'));
const store=await databaseFixture(),db=store.db,scopes=new Map(),scope=u=>scopes.get(u),id=()=>crypto.randomUUID();
const config={token:'synthetic-token',zone:'a'.repeat(32),target:'hosting.whumpo.site'};
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No network is allowed');};

// Provider and DNS stub: one custom hostname per provider id; TXT answers the claim's current token, CNAME the target.
const providers=new Map(),tokens=new Map(),calls={create:0,remove:0,read:0};
const transport=async(input,init)=>{
 const u=new URL(input);assert.equal(init.redirect,'manual');
 if(u.hostname==='cloudflare-dns.com'){
  const name=u.searchParams.get('name'),txt=u.searchParams.get('type')==='TXT',hostname=txt?name.replace(/^_whumpo\./,''):name;
  return Response.json({Status:0,Answer:[{name:name+'.',type:txt?16:5,data:txt?JSON.stringify('whumpo-verification='+tokens.get(hostname)):config.target+'.'}]});
 }
 assert.equal(u.origin,'https://api.cloudflare.com');assert.equal(init.headers.authorization,'Bearer synthetic-token');
 if(init.method==='POST'){calls.create++;const hostname=JSON.parse(init.body).hostname,providerId=id();providers.set(providerId,hostname);return Response.json({success:true,result:{id:providerId,hostname,status:'active',ssl:{status:'active'}}});}
 const providerId=u.pathname.split('/').pop();
 if(providers.has(providerId)){
  if(init.method==='DELETE'){calls.remove++;return Response.json({success:true,result:{id:providerId}});}
  calls.read++;return Response.json({success:true,result:{id:providerId,hostname:providers.get(providerId),status:'active',ssl:{status:'active'}}});
 }
 return Response.json({success:true,result:[],result_info:{total_count:0}});
};

async function account(){const a=await workspaceFixture(db,m);scopes.set(a.account,await a.scope());return a.account;}
async function chat(user,content){const turn=id(),state=await readChat(scope(user),user);const sent=await sendChat(scope(user),user,{id:turn,content,revision:state.state.revision});assert.equal(sent.status,200,content);return turn;}
async function publish(user,name){const site=await createFixtureProject(scope(user),user,name,'A synthetic '+name+' website.');await chat(user,'/confirm '+await chat(user,'/publish '+site.version));return site;}
/** Claims the hostname, then reviews, confirms and refreshes hosting through the real handlers until it serves. */
async function connect(user,project,hostname){
 const claimId=await chat(user,`/domain ${hostname} ${project}`);
 tokens.set(hostname,(await db.prepare('SELECT token FROM domain_claims WHERE id=?').bind(claimId).first()).token);
 const review=await reviewHosting(scope(user),user,id(),claimId,config);
 assert.equal((await confirmHosting(scope(user),user,review.id,config,transport)).state,'provisioning');
 const refreshed=await refreshHosting(scope(user),user,review.id,config,transport);
 assert.equal(refreshed.connected,true,hostname+' is connected');return review.id;
}
const serve=(url,method='GET')=>host.fetch(new Request(url,{method,headers:{'cf-connecting-ip':'198.51.100.61'}}),{DB:db,FILES:store.env?.FILES});
const connection=connectionId=>db.prepare('SELECT * FROM domain_connections WHERE id=?').bind(connectionId).first();
const transfer=(project,user)=>db.prepare('UPDATE projects SET owner_user_id=? WHERE id=?').bind(user,project).run();
const refused=async(promise,status)=>{await assert.rejects(promise,e=>e?.status===status,`expected ${status}`);};

try{
 const a=await account(),b=await account(),c=await account();
 const siteA=await publish(a,'Tenant A'),hostA='shop-'+id().slice(0,8)+'.example.com';
 const connA=await connect(a,siteA.project,hostA);

 // 1. Owner-join refusal on the custom-domain serving mapping (src/site-host.ts).
 const control=await serve('https://'+hostA+'/');
 assert.equal(control.status,200,'negative control: the creator\'s connected hostname serves the publication');
 const published=await control.text();
 const before=JSON.stringify(await connection(connA));
 assert.ok(JSON.parse(before).serve_until>new Date().toISOString(),'the connection is active and inside its serving window');
 await transfer(siteA.project,c);
 for(const method of ['GET','HEAD']){
  const response=await serve('https://'+hostA+'/',method);
  assert.equal(response.status,404,`${method} on the custom host after the project changed owner`);
  if(method==='GET')assert.ok(!(await response.text()).includes(published.slice(0,200)),'no published bytes on the refused host');
 }
 assert.equal((await serve('https://'+hostA+'/assets/'+id()+'.jpg')).status,404,'photo paths are refused before any lookup');
 assert.equal(JSON.stringify(await connection(connA)),before,'the refusal comes from the owner join; the connection row is unchanged');
 const projectHost=await serve(`https://${siteA.project}.whumpo.site/`);
 assert.equal(projectHost.status,200,'negative control: the project host still serves the same publication');
 assert.equal(await projectHost.text(),published);
 await transfer(siteA.project,a);
 assert.equal((await serve('https://'+hostA+'/')).status,200,'negative control: moving the project back serves the custom host again');
 console.log('Custom-domain owner join: an active connection stops serving (GET/HEAD/photo 404) once its creator no longer owns the project, with the connection row unchanged; the project host keeps serving and moving the project back restores the custom host.');

 // 2. S6-1: the orphaned connection and hourly maintenance.
 // Four connections for another tenant; the last is published and stands for every connection in a later batch.
 const others=[];
 for(let i=0;i<4;i++){
  const site=i===3?await publish(b,'Tenant B '+i):await createFixtureProject(scope(b),b,'Tenant B '+i,'A synthetic website.');
  const hostname=`b${i}-${id().slice(0,8)}.example.com`;others.push({project:site.project,hostname,id:await connect(b,site.project,hostname)});
 }
 const late=others[3];
 assert.equal((await serve('https://'+late.hostname+'/')).status,200,'tenant B\'s later-batch hostname serves before the run');
 // Fix the batch order (ORDER BY checked_at ASC, batches of four): the orphan first, B's last connection in batch two.
 // The later-batch connection is due: its two-hour window has elapsed since its last check.
 async function arrange(){
  await db.prepare("UPDATE domain_connections SET checked_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(connA).run();
  for(const [i,o] of others.entries())await db.prepare('UPDATE domain_connections SET checked_at=? WHERE id=?').bind(`2000-01-01T00:00:0${i+1}.000Z`,o.id).run();
  await db.prepare("UPDATE domain_connections SET serve_until='2000-01-02T00:00:00.000Z' WHERE id=?").bind(late.id).run();
  assert.equal((await serve('https://'+late.hostname+'/')).status,404,'a lapsed window stops serving until the next successful check');
 }
 const settled=async ids=>{for(let i=0;i<100;i++){const rows=await Promise.all(ids.map(connection));if(rows.every(r=>!r.checked_at.startsWith('2000-')&&r.state==='active'))return;await new Promise(r=>setTimeout(r,50));}assert.fail('batch-one siblings did not finish');};

 await transfer(siteA.project,c);await arrange();
 const reads=calls.read;
 await refused(maintainHosting(db,config,transport),404);
 // Batch one's other members were already dispatched and finish on their own; batch two never starts.
 await settled(others.slice(0,3).map(o=>o.id));
 const stranded=await connection(late.id);
 assert.equal(stranded.checked_at,'2000-01-01T00:00:04.000Z','S6-1: the later-batch connection was never re-checked');
 assert.equal(stranded.serve_until,'2000-01-02T00:00:00.000Z','S6-1: its serving window was not renewed');
 assert.equal((await serve('https://'+late.hostname+'/')).status,404,'S6-1: another tenant\'s custom domain stays offline');
 assert.equal(calls.read-reads,3,'only the three batch-one siblings reached the provider');
 const orphan=await connection(connA);
 assert.equal(orphan.checked_at,'2000-01-01T00:00:00.000Z','the orphan is not updated, so it stays first in the next run');
 assert.equal(orphan.state,'active');
 // Nobody can clean the orphan up through the owner handlers: the creator no longer owns the project and the new
 // owner did not create the connection. The provider hostname is never deleted.
 await refused(refreshHosting(scope(a),a,connA,config,transport),404);
 await refused(disconnectHosting(scope(a),a,connA,config,transport),404);
 await refused(disconnectHosting(scope(c),c,connA,config,transport),404);
 assert.equal(calls.remove,0,'no provider deletion was attempted');
 assert.equal((await connection(connA)).state,'active');

 // Negative control: the identical arrangement with the project moved back to the connection's creator.
 await transfer(siteA.project,a);await arrange();
 await maintainHosting(db,config,transport);
 const renewed=await connection(late.id);
 assert.ok(!renewed.checked_at.startsWith('2000-')&&renewed.serve_until>new Date().toISOString(),'negative control: the later batch is re-checked and renewed');
 assert.equal((await serve('https://'+late.hostname+'/')).status,200,'negative control: tenant B\'s custom domain serves again');
 console.log('S6-1 reproduced (characterization): after a project changes owner, its custom-domain connection makes maintainHosting reject in the first batch, so a due connection of another tenant in a later batch is not re-checked and stays offline; neither the old nor the new owner can refresh or disconnect the orphan. With the project moved back, the identical run renews and serves it.');
}catch(error){console.error(String(error?.stack??error).split('\n').filter(line=>!line.includes('data:text/javascript')).join('\n'));process.exitCode=1;}
finally{globalThis.fetch=originalFetch;await store.close?.();}

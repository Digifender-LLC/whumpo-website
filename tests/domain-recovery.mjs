import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),{inspectRecovery,applyRecovery,reviewHosting,refreshHosting,disconnectHosting}=m;
const database=await databaseFixture({d1:true}),db=database.db,scopes=new Map(),scope=user=>scopes.get(user),config={token:'synthetic-token',zone:'a'.repeat(32),target:'hosting.whumpo.site'};
const operator='test-operator',evidence='Controlled provider audit fixture establishes the request identity.';
async function fixture(){const identity=await workspaceFixture(db,m),user=identity.account,project=crypto.randomUUID(),claim=crypto.randomUUID(),id=crypto.randomUUID(),now=new Date().toISOString(),name='host-'+id+'.example.com';
 scopes.set(user,await identity.scope());
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Recovery','Fixture','draft',?,?)").bind(project,user,now,now).run();
 await db.prepare('INSERT INTO domain_claims(id,project_id,hostname,token,expires_at,created_at) VALUES(?,?,?,?,?,?)').bind(claim,project,name,'fixture-proof',new Date(Date.now()+86400000).toISOString(),now).run();
 await reviewHosting(scope(user),user,id,claim,config);await db.prepare("UPDATE domain_connections SET state='uncertain' WHERE id=?").bind(id).run();return {id,user,name,resource:crypto.randomUUID(),createdAt:new Date().toISOString()};}
function provider(f,{old=false,wrong=false,proof=true,pause}={}){return async(url,init)=>{assert.equal(init.redirect,'manual');assert.equal(init.method??'GET','GET');const u=new URL(url);
 if(u.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{name:u.searchParams.get('name'),type:u.searchParams.get('type')==='TXT'?16:5,data:u.searchParams.get('type')==='TXT'?JSON.stringify(proof?'tellumo-verification=fixture-proof':'wrong'):config.target}]});
 assert.equal(u.href,'https://api.cloudflare.com/client/v4/zones/'+config.zone+'/custom_hostnames/'+f.resource);assert.equal(init.headers.authorization,'Bearer synthetic-token');if(pause)await pause();return Response.json({success:true,result:{id:f.resource,hostname:wrong?'foreign.example.com':f.name,created_at:old?'2000-01-01':f.createdAt,status:'active',ssl:{status:'active'}}});};}
// Operator recovery retains its separately authorized raw database capability.
const inspect=(f,action='resume',transport=provider(f))=>inspectRecovery(db,f.id,f.resource,action,config,transport);
const apply=(r,f,database=db)=>applyRecovery(database,r,r.digest,operator,evidence,config,provider(f));
try{
 const f=await fixture();await assert.rejects(()=>inspect(f,'resume',provider(f,{old:true})));await assert.rejects(()=>inspect(f,'resume',provider(f,{wrong:true})));await assert.rejects(()=>inspectRecovery(db,f.id,f.resource,'resume',{...config,zone:'b'.repeat(32)},provider(f)));
 const r=await inspect(f);assert.equal((await db.prepare('SELECT provider_id FROM domain_connections WHERE id=?').bind(f.id).first()).provider_id,null);
 await assert.rejects(()=>apply({...r,action:'cleanup'},f));await assert.rejects(()=>applyRecovery(db,r,r.digest,operator,'short',config,provider(f)));
 const outcomes=await Promise.all([apply(r,f),apply(r,f)]);assert.ok(outcomes.some(o=>!o.replayed));assert.equal((await db.prepare('SELECT COUNT(*) n FROM domain_reconciliations WHERE connection_id=?').bind(f.id).first()).n,1);
 const saved=await db.prepare('SELECT * FROM domain_connections WHERE id=?').bind(f.id).first();assert.equal(saved.provider_id,f.resource);assert.equal(saved.state,'provisioning');assert.equal(saved.serve_until,null);
 assert.equal((await apply(r,f)).replayed,true);await assert.rejects(()=>applyRecovery(db,r,r.digest,'different',evidence,config,provider(f)));
 await assert.rejects(()=>db.prepare("UPDATE domain_reconciliations SET evidence='altered' WHERE id=?").bind(r.id).run());await assert.rejects(()=>db.prepare('DELETE FROM domain_reconciliations WHERE id=?').bind(r.id).run());
 const cleanup=await fixture();await disconnectHosting(scope(cleanup.user),cleanup.user,cleanup.id,undefined);await assert.rejects(()=>inspect(cleanup));const cr=await inspect(cleanup,'cleanup');await apply(cr,cleanup);assert.equal((await db.prepare('SELECT state FROM domain_connections WHERE id=?').bind(cleanup.id).first()).state,'disconnecting');
 const changed=await fixture(),changeReview=await inspect(changed);await disconnectHosting(scope(changed.user),changed.user,changed.id,undefined);await assert.rejects(()=>apply(changeReview,changed));
 const lost=await fixture(),lr=await inspect(lost);let dropped=false;
 const lossy=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.startsWith('UPDATE domain_connections SET provider_id='))return statement;return {bind(...values){const bound=statement.bind(...values);return {async first(){const result=await bound.first();dropped=true;throw Error('Lost acknowledgement');}};}};};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 assert.equal((await apply(lr,lost,lossy)).replayed,true);assert.ok(dropped);
 const atomic=await fixture();await assert.rejects(()=>db.prepare("UPDATE domain_connections SET provider_id=?,state='provisioning',reconciliation_id=?,reconciliation_operator='operator',reconciliation_evidence='bad' WHERE id=?").bind(atomic.resource,crypto.randomUUID(),atomic.id).run());assert.equal((await db.prepare('SELECT provider_id FROM domain_connections WHERE id=?').bind(atomic.id).first()).provider_id,null);
 // Hold an older successful check while a newer check observes missing proof.
 let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const older=refreshHosting(scope(f.user),f.user,f.id,config,provider(f,{pause:async()=>{entered();await gate;}}));await started;
 assert.equal((await refreshHosting(scope(f.user),f.user,f.id,config,provider(f,{proof:false}))).connected,false);release();await older;assert.equal((await db.prepare('SELECT serve_until FROM domain_connections WHERE id=?').bind(f.id).first()).serve_until,null);
 // A disconnect invalidates a previously started status check as well.
 let release2,entered2;const gate2=new Promise(resolve=>release2=resolve),started2=new Promise(resolve=>entered2=resolve);
 const stale=refreshHosting(scope(f.user),f.user,f.id,config,provider(f,{pause:async()=>{entered2();await gate2;}}));await started2;await disconnectHosting(scope(f.user),f.user,f.id,undefined);release2();assert.equal((await stale).connected,false);assert.equal((await db.prepare('SELECT state FROM domain_connections WHERE id=?').bind(f.id).first()).state,'disconnecting');
 // A proof rotation during DNS IO invalidates the old proof result.
 let release3,entered3;const gate3=new Promise(resolve=>release3=resolve),started3=new Promise(resolve=>entered3=resolve),baseProvider=provider(lost);
 const rotated=refreshHosting(scope(lost.user),lost.user,lost.id,config,async(url,init)=>{if(new URL(url).searchParams.get('type')==='CNAME'){entered3();await gate3;}return baseProvider(url,init);});await started3;
 await db.prepare("UPDATE domain_claims SET token='rotated-proof' WHERE id=(SELECT claim_id FROM domain_connections WHERE id=?)").bind(lost.id).run();release3();assert.equal((await rotated).connected,false);assert.equal((await db.prepare('SELECT serve_until FROM domain_connections WHERE id=?').bind(lost.id).first()).serve_until,null);
 console.log('Hosting recovery passed: exact provider identity/time, no provider mutations, reviewed digest, immutable atomic audit, replay/concurrent/lost-ack recovery, cleanup-only disconnect, changed-state rejection and stale-check fencing.');
}finally{await database.close();}

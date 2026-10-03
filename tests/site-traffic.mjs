import {createFixtureProject,currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),{sendChat,readChat,host,readTraffic,recordTraffic,cleanupTraffic,inspectWorkspace}=m;
const fixture=await databaseFixture({d1:true}),db=fixture.db,scopes=new Map(),scope=user=>scopes.get(user);
async function account(){const a=await workspaceFixture(db,m);scopes.set(a.account,await a.scope());return a.account;}
async function chat(user,content,id=crypto.randomUUID(),revision){const state=await readChat(scope(user),user);return {id,result:await sendChat(scope(user),user,{content,id,revision:revision??state.state.revision})};}
async function create(user,name){return createFixtureProject(scope(user),user,name,'A synthetic '+name+' website.');}
const url=id=>'https://'+id+'.whumpo.site/';
const served=id=>host.fetch(new Request(url(id)),{DB:db});
try{
 const user=await account(),other=await account(),a=await create(user,'Traffic fixture');
 await db.prepare("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.insights','read','private-test-acceptance','synthetic traffic reader',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)").bind(crypto.randomUUID(),user).run();
 assert.equal((await served(a.project)).status,404);assert.deepEqual((await readTraffic(scope(user),user)).rows,[]);
 const review=await chat(user,'/publish '+a.version);await chat(user,'/confirm '+review.id);
 await Promise.all(Array.from({length:12},()=>served(a.project)));
 let report=await readTraffic(scope(user),user);assert.equal(report.rows.length,1);assert.equal(report.rows[0].requests,12);assert.ok(report.enabledAt);
 for(const [path,method] of [['','HEAD'],['','POST'],['missing','GET'],['assets/'+crypto.randomUUID()+'.jpg','GET'],['s/'+a.project,'GET']])await host.fetch(new Request(url(a.project)+path,{method}),{DB:db});
 assert.equal((await readTraffic(scope(user),user)).rows[0].requests,12);
 assert.deepEqual((await readTraffic(scope(other),other)).rows,[]);
 const ctxTasks=[];const ctx={waitUntil:p=>ctxTasks.push(p)};
 assert.equal((await host.fetch(new Request(url(a.project)+'?private=query'),{DB:db},ctx)).status,200);await Promise.all(ctxTasks);assert.equal(ctxTasks.length,1);
 assert.equal((await readTraffic(scope(user),user)).rows[0].requests,13);
 const columns=(await db.prepare('PRAGMA table_info(site_traffic_daily)').all()).results.map(r=>r.name);assert.deepEqual(columns,['project_id','day','requests']);
 assert.match(await inspectWorkspace(scope(user),user,'traffic'),/Recorded page requests: 13/);
 const turn=await chat(user,'/traffic');assert.equal(turn.result.status,200);assert.match((await readChat(scope(user),user)).turns.at(-1).assistant_text,/Recorded page requests: 13/);
 const cutoff=new Date();cutoff.setUTCDate(cutoff.getUTCDate()-30);await recordTraffic(db,a.project,cutoff);
 assert.equal((await readTraffic(scope(user),user)).rows.length,1);await cleanupTraffic(db);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM site_traffic_daily').first()).n,1);
 // Counter failure must not take down an otherwise healthy page.
 const broken={prepare(sql){if(sql.startsWith('INSERT INTO site_traffic_daily'))throw Error('synthetic counter failure');return db.prepare(sql)}};
 assert.equal((await host.fetch(new Request(url(a.project)),{DB:broken})).status,200);
 assert.equal((await readTraffic(scope(user),user)).rows[0].requests,13);
 const off=await chat(user,'/unpublish '+a.project);await chat(user,'/confirm '+off.id);assert.equal((await served(a.project)).status,404);assert.equal((await readTraffic(scope(user),user)).rows[0].requests,13);
 await db.prepare('DELETE FROM users WHERE id=?').bind(user).run();assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM site_traffic_daily').first()).n,0);
 console.log('Traffic passed: live HTML only, concurrent exact counts, no identifiers, owner isolation, chat inspection, retention, deletion cascade, waitUntil and fail-open serving.');
}finally{await fixture.close();}

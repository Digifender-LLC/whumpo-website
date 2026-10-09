import {currentSiteFixtureHandlers,createFixtureProject,changeFixtureWebsite} from './current-site-fixture.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {unzipSync,strFromU8} from 'fflate';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),{sendChat,readChat,getBilling,hashToken,worker}=m;
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-export-'),fixture=await databaseFixture({d1:true,r2:true}),db=fixture.db,scopes=new Map(),scope=user=>scopes.get(user);
const env={...fixture.env,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
async function account(){const a=await workspaceFixture(db,m);scopes.set(a.account,await a.scope());return {...a,id:a.account,session:a.token};}
async function send(user,content,id=crypto.randomUUID(),revision){const state=await readChat(scope(user.id),user.id);const result=await sendChat(scope(user.id),user.id,{id,revision:revision??state.state.revision,content},{baseURL:'https://never-called.test',apiKey:'never-export-this-key',model:'test'});return {result,id};}
async function request(path,user){return worker.fetch(new Request('https://whumpo.com/api'+path,{headers:user?{cookie:'__Host-whumpo_session='+user.session}:{}}),env);}
try{
 const owner=await account(),other=await account();
 const {project,version}=await createFixtureProject(scope(owner.id),owner.id,'Bread & <Butter>','A neighborhood bakery','clay');await createFixtureProject(scope(other.id),other.id,'Other owner','Other-owner-private-brief');
 const original=await db.prepare('SELECT * FROM site_versions WHERE id=?').bind(version).first();
 const revision=(await readChat(scope(owner.id),owner.id)).state.revision,id=crypto.randomUUID();const concurrent=await Promise.all([send(owner,'/export '+version,id,revision),send(owner,'/export '+version,id,revision)]);assert.ok(concurrent.every(x=>x.result.status===200));const chat=await readChat(scope(owner.id),owner.id);assert.equal(chat.state.revision,revision+1);assert.equal(chat.turns.at(-1).export_version_id,version);
 const response=await request('/site-versions/'+version+'/export',owner);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/zip');assert.ok(response.headers.get('cache-control').includes('no-store'));assert.equal(response.headers.get('content-disposition'),`attachment; filename="whumpo-site-${version}.zip"`);
 const bytes=new Uint8Array(await response.arrayBuffer());assert.ok(bytes.length<50000);const files=unzipSync(bytes);assert.deepEqual(Object.keys(files).sort(),['README.txt','public/_headers','public/index.html','whumpo/site.json']);assert.equal(strFromU8(files['public/index.html']),original.html);const manifest=JSON.parse(strFromU8(files['whumpo/site.json']));assert.equal(manifest.htmlSha256,await hashToken(strFromU8(files['public/index.html'])));assert.equal(manifest.version,version);assert.equal(manifest.configuration.name,'Bread & <Butter>');assert.ok(strFromU8(files['public/_headers']).includes("sandbox; default-src 'none'"));
 const all=Object.values(files).map(file=>strFromU8(file)).join('\n');for(const secret of [owner.session,owner.id,other.id,'private-email-','never-export-this-key','Other-owner-private-brief'])assert.ok(!all.includes(secret));
 // Use Python's independent ZIP implementation to validate directory, CRCs and exact contents.
 await writeFile(dir+'/source.zip',bytes);execFileSync('python3',['-c',"import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert set(z.namelist())=={'README.txt','public/_headers','public/index.html','whumpo/site.json'}",dir+'/source.zip']);
 assert.deepEqual(new Uint8Array(await(await request('/site-versions/'+version+'/export',owner)).arrayBuffer()),bytes);
 assert.equal((await request('/site-versions/'+version+'/export',other)).status,404);assert.equal((await request('/site-versions/'+version+'/export')).status,401);
 const denied=await send(other,'/export '+version);assert.equal(denied.result.status,200);assert.equal((await readChat(scope(other.id),other.id)).turns.at(-1).export_version_id,null);
 await assert.rejects(db.prepare('INSERT INTO chat_exports(turn_id,version_id) VALUES(?,?)').bind(denied.id,version).run(),/export_owner/);
 assert.equal((await send(owner,'/export ../../secrets')).result.status,400);
 const newer=await changeFixtureWebsite(scope(owner.id),owner.id,project,[{type:'design.setTheme',theme:'forest'}]);await send(owner,'/export '+newer);assert.equal((await readChat(scope(owner.id),owner.id)).turns.at(-1).export_version_id,newer);
 assert.equal(strFromU8(unzipSync(new Uint8Array(await(await request('/site-versions/'+version+'/export',owner)).arrayBuffer()))['public/index.html']),original.html);
 assert.equal((await getBilling(scope(owner.id),owner.id)).standardAI.creditCharge,0);assert.equal((await db.prepare('SELECT count(*) n FROM inference_calls').first()).n,0);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM publications WHERE version_id IS NOT NULL').first()).n,0);
 // Follow the version review contract introduced after this export regression test.
 await db.prepare('INSERT INTO version_removals(id,user_id,project_id,version_id,digest,component_id,version_created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').bind(version,owner.id,original.project_id,version,original.digest,original.component_id,original.created_at,new Date(Date.now()+60000).toISOString()).run();
 await db.prepare("UPDATE version_removals SET status='applied',confirmed_by=? WHERE id=?").bind(newer,version).run();assert.equal((await request('/site-versions/'+version+'/export',owner)).status,404);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM chat_exports WHERE version_id=?').bind(version).first()).n,0);
 console.log('Export checks passed: exact ZIP contents, independent CRC validation, deterministic downloads, metadata/secret exclusion, ownership, chat replay, historical versions, zero AI billing and deletion.');
}finally{await fixture.close();await rm(dir,{recursive:true,force:true});}

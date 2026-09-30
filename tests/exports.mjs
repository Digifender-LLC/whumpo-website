import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {unzipSync,strFromU8} from 'fflate';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {sendChat,readChat}=await module('src/chat.ts');const {getBilling}=await module('src/billing.ts');const {hashToken}=await module('src/security.ts');const worker=(await module('src/index.ts')).default;
const dir=await mkdtemp('/tmp/tellumo-export-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
const env={...proxy.env,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
async function account(){const id=crypto.randomUUID(),session=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,'test',?)").bind(id,'private-email-'+id+'@example.com','00',new Date().toISOString()).run();await db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').bind(await hashToken(session),id,new Date().toISOString(),new Date(Date.now()+600000).toISOString()).run();return {id,session};}
async function send(user,content,id=crypto.randomUUID(),revision){const state=await readChat(db,user.id);const result=await sendChat(db,user.id,{id,revision:revision??state.state.revision,content},{baseURL:'https://never-called.test',apiKey:'never-export-this-key',model:'test'});return {result,id};}
async function request(path,user){return worker.fetch(new Request('https://whumpo.com/api'+path,{headers:user?{cookie:'tellumo_session='+user.session}:{}}),env);}
try{
 const owner=await account(),other=await account();
 await send(owner,'A neighborhood bakery');await send(owner,'Bread & <Butter>');await send(other,'Other-owner-private-brief');await send(other,'Other owner');
 const {id:version}=await send(owner,'/build clay');const original=await db.prepare('SELECT * FROM site_versions WHERE id=?').bind(version).first();
 const revision=(await readChat(db,owner.id)).state.revision,id=crypto.randomUUID();const concurrent=await Promise.all([send(owner,'/export '+version,id,revision),send(owner,'/export '+version,id,revision)]);assert.ok(concurrent.every(x=>x.result.status===200));const chat=await readChat(db,owner.id);assert.equal(chat.state.revision,revision+1);assert.equal(chat.turns.at(-1).export_version_id,version);
 const response=await request('/site-versions/'+version+'/export',owner);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/zip');assert.ok(response.headers.get('cache-control').includes('no-store'));assert.equal(response.headers.get('content-disposition'),`attachment; filename="tellumo-site-${version}.zip"`);
 const bytes=new Uint8Array(await response.arrayBuffer());assert.ok(bytes.length<50000);const files=unzipSync(bytes);assert.deepEqual(Object.keys(files).sort(),['README.txt','public/_headers','public/index.html','tellumo/site.json']);assert.equal(strFromU8(files['public/index.html']),original.html);const manifest=JSON.parse(strFromU8(files['tellumo/site.json']));assert.equal(manifest.htmlSha256,await hashToken(strFromU8(files['public/index.html'])));assert.equal(manifest.version,version);assert.equal(manifest.configuration.name,'Bread & <Butter>');assert.ok(strFromU8(files['public/_headers']).includes("sandbox; default-src 'none'"));
 const all=Object.values(files).map(file=>strFromU8(file)).join('\n');for(const secret of [owner.session,owner.id,other.id,'private-email-','never-export-this-key','Other-owner-private-brief'])assert.ok(!all.includes(secret));
 // Use Python's independent ZIP implementation to validate directory, CRCs and exact contents.
 await writeFile(dir+'/source.zip',bytes);execFileSync('python3',['-c',"import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert set(z.namelist())=={'README.txt','public/_headers','public/index.html','tellumo/site.json'}",dir+'/source.zip']);
 assert.deepEqual(new Uint8Array(await(await request('/site-versions/'+version+'/export',owner)).arrayBuffer()),bytes);
 assert.equal((await request('/site-versions/'+version+'/export',other)).status,404);assert.equal((await request('/site-versions/'+version+'/export')).status,401);
 const denied=await send(other,'/export '+version);assert.equal(denied.result.status,200);assert.equal((await readChat(db,other.id)).turns.at(-1).export_version_id,null);
 await assert.rejects(db.prepare('INSERT INTO chat_exports(turn_id,version_id) VALUES(?,?)').bind(denied.id,version).run(),/export_owner/);
 assert.equal((await send(owner,'/export ../../secrets')).result.status,400);
 const {id:newer}=await send(owner,'/build forest');await send(owner,'download my website');assert.equal((await readChat(db,owner.id)).turns.at(-1).export_version_id,newer);
 assert.equal(strFromU8(unzipSync(new Uint8Array(await(await request('/site-versions/'+version+'/export',owner)).arrayBuffer()))['public/index.html']),original.html);
 assert.equal((await getBilling(db,owner.id)).quota.spent,0);assert.equal((await getBilling(db,owner.id)).quota.reserved,0);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM publications WHERE version_id IS NOT NULL').first()).n,0);
 // Follow the version review contract introduced after this export regression test.
 await db.prepare('INSERT INTO version_removals(id,user_id,project_id,version_id,digest,component_id,version_created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').bind(version,owner.id,original.project_id,version,original.digest,original.component_id,original.created_at,new Date(Date.now()+60000).toISOString()).run();
 await db.prepare("UPDATE version_removals SET status='applied',confirmed_by=? WHERE id=?").bind(newer,version).run();assert.equal((await request('/site-versions/'+version+'/export',owner)).status,404);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM chat_exports WHERE version_id=?').bind(version).first()).n,0);
 console.log('Export checks passed: exact ZIP contents, independent CRC validation, deterministic downloads, metadata/secret exclusion, ownership, chat replay, historical versions, zero AI billing and deletion.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyCMSRecoveryCapture} from '../tools/verify-cms-recovery.mjs';
import {captureCMSMedia} from '../tools/cms-media-snapshot.mjs';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import wrangler from 'wrangler';
import {captureCMSDatabase,restoreCapturedCMSD1} from '../tools/cms-database-snapshot.mjs';
const dir=await mkdtemp(join(tmpdir(),'cms-d1-restore-'));let proxy;const source=new DatabaseSync(':memory:');
try{
 source.exec(`CREATE TABLE child(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES parent(id));CREATE TABLE parent(id TEXT PRIMARY KEY);INSERT INTO parent VALUES('p');INSERT INTO child VALUES('c','p');CREATE VIRTUAL TABLE search USING fts5(title);INSERT INTO search VALUES('Private article');CREATE TABLE counted(id INTEGER PRIMARY KEY AUTOINCREMENT);INSERT INTO counted DEFAULT VALUES;DELETE FROM counted;`);
 const captured=await captureCMSDatabase(async sql=>source.prepare(sql).all());const config=join(dir,'wrangler.json');await writeFile(config,JSON.stringify({name:'cms-restore-local',compatibility_date:'2026-09-29',d1_databases:[{binding:'TARGET',database_name:'fixture-target',database_id:'11111111-1111-4111-8111-111111111111'},{binding:'FAILED',database_name:'fixture-failed',database_id:'22222222-2222-4222-8222-222222222222'}]}));
 proxy=await wrangler.getPlatformProxy({configPath:config,persist:{path:join(dir,'state')},remoteBindings:false});
 const restored=await restoreCapturedCMSD1(proxy.env.TARGET,captured.snapshot);assert.equal(restored.digest,captured.digest);assert.equal((await proxy.env.TARGET.prepare("SELECT count(*) n FROM search WHERE search MATCH 'Private'").first()).n,1);
 await assert.rejects(restoreCapturedCMSD1(proxy.env.TARGET,captured.snapshot),/must be empty/);
 const invalid=structuredClone(captured.snapshot);invalid.schema.push({type:'index',name:'bad',sql:'CREATE INDEX invalid ON absent(column)'});await assert.rejects(restoreCapturedCMSD1(proxy.env.FAILED,invalid));assert.equal((await proxy.env.FAILED.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='child'").first()).n,0);
 assert.equal((await restoreCapturedCMSD1(proxy.env.FAILED,captured.snapshot)).digest,captured.digest);
 const artifact=join(dir,'capture');await mkdir(artifact);const bytes=new TextEncoder().encode('Private media'),etag=createHash('md5').update(bytes).digest('hex');const media=await captureCMSMedia({list:async()=>({success:true,result:[{key:'photo.bin',size:bytes.length,etag,last_modified:'2026-09-29T00:00:00Z',http_metadata:{contentType:'application/octet-stream',cacheExpiry:'2030-01-01T00:00:00.000Z'},custom_metadata:{caption:'Private'}}],result_info:{is_truncated:false}}),get:async()=>new Response(bytes,{headers:{etag:'\"'+etag+'\"'}})},join(artifact,'media'));
 await writeFile(join(artifact,'database.json'),JSON.stringify(captured.snapshot));await writeFile(join(artifact,'media.json'),JSON.stringify(media));await writeFile(join(artifact,'manifest.json'),JSON.stringify({format:'whumpo-cms-database-manifest-v1',digest:captured.digest,media:{digest:createHash('sha256').update(JSON.stringify(media)).digest('hex')}}));
 await assert.rejects(verifyCMSRecoveryCapture(artifact,{projectId:'11111111-1111-4111-8111-111111111111'}),/identity mismatch/);
 const evidence=await verifyCMSRecoveryCapture(artifact);assert.equal(evidence.databaseDigest,captured.digest);assert.equal(evidence.mediaObjects,1);assert.equal(evidence.productionRecoveryVerified,false);
 await writeFile(join(artifact,'database.json'),'{}');await assert.rejects(verifyCMSRecoveryCapture(artifact),/checksum/);
 console.log('Local D1 restore passed: forward foreign keys, FTS, identical digest, occupied-target refusal and batch rollback/recovery.');
}finally{source.close();await proxy?.dispose();await rm(dir,{recursive:true,force:true});}

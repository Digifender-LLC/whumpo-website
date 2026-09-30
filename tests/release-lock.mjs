import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {withPlatformLock} from '../tools/deploy-platform.mjs';

const sqlite=new DatabaseSync(':memory:');
sqlite.exec("CREATE TABLE cms_platform_deploy_lock(id INTEGER PRIMARY KEY,token TEXT,expires_at TEXT); INSERT INTO cms_platform_deploy_lock VALUES(1,'','2000-01-01T00:00:00.000Z')");
const db={prepare(sql){let params=[];return {bind(...values){params=values;return this;},async run(){return sqlite.prepare(sql).run(...params);},async first(){return sqlite.prepare(sql).get(...params)??null;}};}};
try{
 await withPlatformLock(db,async guard=>{
  const first=sqlite.prepare('SELECT * FROM cms_platform_deploy_lock').get();assert.ok(first.token);
  await guard();assert.equal(sqlite.prepare('SELECT token FROM cms_platform_deploy_lock').get().token,first.token);
  await assert.rejects(()=>withPlatformLock(db,async()=>assert.fail('Concurrent deployment entered')),/Another platform deployment/);
 });
 assert.ok(sqlite.prepare('SELECT expires_at FROM cms_platform_deploy_lock').get().expires_at<=new Date().toISOString());
 await assert.rejects(()=>withPlatformLock(db,async()=>{throw Error('operation failed');}),/operation failed/);
 await withPlatformLock(db,async guard=>{
  sqlite.exec("UPDATE cms_platform_deploy_lock SET expires_at='2000-01-01T00:00:00.000Z'");
  await assert.rejects(guard,/lease expired/);
  sqlite.exec("UPDATE cms_platform_deploy_lock SET token='new-operator',expires_at='2999-01-01T00:00:00.000Z'");
  await assert.rejects(guard,/lease expired/);
 });
 assert.equal(sqlite.prepare('SELECT expires_at FROM cms_platform_deploy_lock').get().expires_at,'2999-01-01T00:00:00.000Z');
 console.log('Deployment lease passed: renewal, competing operator exclusion, failure cleanup, expired lease refusal and ownership-safe release.');
}finally{sqlite.close();}

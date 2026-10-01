import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';
const {outputFiles}=await build({stdin:{contents:"export {default as worker} from './src/index.ts';export {agentProfile,readProfile,updateProfile} from './src/profile.ts';export {hashToken} from './src/security.ts';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {worker,agentProfile,readProfile,updateProfile,hashToken}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const sql=new DatabaseSync(':memory:');const db={prepare:q=>{const bind=p=>({run:async()=>{const r=sql.prepare(q).run(...p);return {meta:{changes:r.changes}};},first:async()=>sql.prepare(q).get(...p)??null,all:async()=>({results:sql.prepare(q).all(...p)})});return {...bind([]),bind:(...p)=>bind(p)};}};
const owner=crypto.randomUUID(),other=crypto.randomUUID(),now=new Date().toISOString(),token='1'.repeat(64);
try{
 for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort())sql.exec(await readFile('migrations/'+file,'utf8'));
 for(const user of [owner,other])sql.prepare("INSERT INTO users VALUES(?,?,'00','passkey-only',?)").run(user,user+'@example.invalid',now);
 assert.equal((await readProfile(db,owner)).accountId,owner);assert.equal((await readProfile(db,other)).accountId,other);
 await assert.rejects(updateProfile(db,owner,{revision:0,accountId:other}),/Invalid profile fields/);
 await updateProfile(db,owner,{revision:0,name:'River',about_me:'Garden services',share_context:true});assert.deepEqual({...await agentProfile(db,owner)},{name:'River',about_me:'Garden services'});
 sql.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(await hashToken(token),owner,new Date(Date.now()+60000).toISOString(),now);
 const request=cookie=>new Request('https://whumpo.com/api/profile',{headers:cookie?{cookie:'whumpo_session='+cookie}: {}}),env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil(){}};
 assert.equal((await worker.fetch(request(''),env,ctx)).status,401);
 const response=await worker.fetch(request(token),env,ctx);assert.equal(response.status,200);const profile=await response.json();assert.equal(profile.accountId,owner);assert.notEqual(profile.accountId,other);
 console.log('Recovery account identity passed: authenticated owner only, distinct accounts, client mutation refused, identity excluded from opted-in agent profile. Disposable SQLite, no media/provider calls.');
}finally{sql.close();}

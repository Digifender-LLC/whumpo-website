import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';
const sql=new DatabaseSync(':memory:');
try{
 for(const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort())sql.exec(await readFile(`migrations/${name}`,'utf8'));
 sql.exec(`INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES
 ('owner-a','a@example.invalid','PRIVATE','PRIVATE','2026-09-30'),('owner-b','b@example.invalid','PRIVATE','PRIVATE','2026-09-30');
 INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES ('project-b','owner-b','PRIVATE','2026-09-30','2026-09-30');
 INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES ('token-b','owner-b','PRIVATE','2027-01-01','revoking');`);
 sql.exec(`INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,mode,status,created_at) VALUES('plan-b','owner-b',1,'PRIVATE','PRIVATE','ai','pending','2026-09-30');
 INSERT INTO composition_plans(id,user_id,project_id,request_hash,catalog_digest,plan_json,details_revision,backend_count,backend_revision,extension_scope,expires_at)
 VALUES('plan-b','owner-b','project-b',printf('%064d',0),printf('%064d',0),'{"purpose":"PRIVATE"}',0,0,0,'none',1);`);
 const db={prepare:query=>({bind:(...params)=>({first:async()=>sql.prepare(query).get(...params)})})};
 sql.exec("INSERT INTO github_token_staging VALUES('token-b','PRIVATE','2027-01-01');");
 sql.exec('PRAGMA query_only=ON'); // Enforce no writes, including accidental future mutations.
 const all=await accountClosureInventory(db),a=await accountClosureInventory(db,'owner-a'),b=await accountClosureInventory(db,'owner-b');
 assert.equal(all.counts.accounts,2);assert.equal(all.counts.projects,1);
 assert.equal(a.counts.projects,0);assert.equal(a.counts.githubCredentials,0);
 assert.equal(b.counts.projects,1);assert.equal(b.counts.githubCredentials,1);assert.equal(b.counts.githubPendingRevocations,1);assert.equal(b.counts.githubStagedCredentials,1);assert.equal(a.counts.githubStagedCredentials,0);
 // Expired planning authority still has retained bytes; do not hide it from closure.
 assert.equal(all.counts.compositionPlans,1);assert.equal(b.counts.compositionPlans,1);assert.equal(a.counts.compositionPlans,0);
 for(const r of [all,a,b]){assert.equal(r.readyForDeletion,false);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|owner-[ab]|example.invalid|token-b/);}
 await assert.rejects(()=>accountClosureInventory(db,"' OR 1=1 --"));
 await assert.rejects(()=>accountClosureInventory(db,''));
 await assert.rejects(()=>accountClosureInventory({prepare(){throw Error('unavailable');}}));
 const invalid={prepare(){return {bind(){return {first:async()=>({...all.counts,accounts:null})};}};}};
 await assert.rejects(()=>accountClosureInventory(invalid));
 console.log('Account closure inventory passed: full migrated schema, read-only queries, owner isolation, safe output and failure handling.');
}finally{sql.close();}

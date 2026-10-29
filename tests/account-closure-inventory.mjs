import {sqliteD1} from './sqlite-d1.mjs';
import {initializeFixtureKeys,fixtureKeyring,fixtureCiphertext} from './helpers/connection-keyring.mjs';
import assert from 'node:assert/strict';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';
const keyFixture=await sqliteD1(),sql=keyFixture.sql;
try{
 await initializeFixtureKeys(keyFixture.db);
 sql.exec(`INSERT INTO users(id,email,created_at) VALUES
 ('owner-a','a@example.invalid','2026-09-30'),('owner-b','b@example.invalid','2026-09-30');
 INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES ('project-b','owner-b','PRIVATE','2026-09-30','2026-09-30');
 `);
 sql.prepare("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES ('token-b','owner-b',?,'2027-01-01','revoking')").run(await fixtureCiphertext(fixtureKeyring(),'whumpo:github:token:owner-b:token-b','PRIVATE'));
 sql.exec(`INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,mode,status,created_at) VALUES('plan-b','owner-b',1,'PRIVATE','PRIVATE','ai','pending','2026-09-30');
 INSERT INTO composition_plans(id,user_id,project_id,request_hash,catalog_digest,plan_json,details_revision,backend_count,backend_revision,extension_scope,expires_at)
 VALUES('plan-b','owner-b','project-b',printf('%064d',0),printf('%064d',0),'{"purpose":"PRIVATE"}',0,0,0,'none',1);`);
 const db={prepare:query=>({bind:(...params)=>({first:async()=>sql.prepare(query).get(...params)})})};
 sql.exec("INSERT INTO github_token_staging VALUES('token-b','PRIVATE','2027-01-01');");
 sql.exec("INSERT INTO feature_preview_grants(id,contract_version,user_id,project_id,feature_id,operation,purpose,review_reference,starts_at,ends_at,created_at) VALUES('00000000-0000-4000-8000-000000000001',1,'owner-b','project-b','connections.github','read','private-test-acceptance','PRIVATE',1,2,1)");
 sql.exec("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,kit_generation,kit_verifier,completion_receipt_id) VALUES('owner-b',1,'ready',1,1,printf('%064d',0),'receipt-b'); INSERT INTO identity_credentials VALUES('credential-b','owner-b',X'010203',0,'PRIVATE','active',NULL,unixepoch(),NULL); INSERT INTO identity_sessions VALUES('00000000-0000-4000-8000-000000000002',printf('%064d',0),'owner-b',1,1,'web','credential-b','passkey',unixepoch(),unixepoch(),unixepoch()+3600);");
 // WH-170/WH-201 classes: an open address change with its limit evidence, a compromise-review snapshot and a shadow cost event.
 const now=Date.now(),key='a'.repeat(64);
 sql.exec(`INSERT INTO owner_email_change_limits(kind,account_id,at) VALUES('request','owner-b',${now});
  INSERT INTO owner_email_changes(change_id,account_id,request_id,request_hash,new_address,new_address_hash,epoch,created_at,expires_at,state,revision,history,deliverable) VALUES('change-b1','owner-b','request-b1','${key}','new-private@example.invalid','${key}',1,${now},${now+3600000},'pending',1,'["pending"]',0);
  INSERT INTO owner_security_reviews(review_id,account_id,epoch,credential_revision,kit_generation,credentials,connections,created_at,expires_at,state,revision) SELECT 'review-b1',account_id,auth_epoch,credential_revision,kit_generation,'[]','[]',${now},${now+600000},'open',1 FROM identity_accounts WHERE account_id='owner-b';
  INSERT INTO cost_events(idempotency_key,revision,source,dimension,scope,owner_id,project_id,workload,work_class,outcome,quantity_value,cost_basis,cost_micros,occurred_at,observed_at,event_json) VALUES('${key}',1,'storage-operations','r2.class_b_ops','tenant','owner-b','project-b','storage-files','standing','settled',1,'receipt',5,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z','{"contractVersion":1,"customerUnits":0,"idempotencyKey":"${key}","revision":1}');`);
 sql.exec('PRAGMA query_only=ON'); // Enforce no writes, including accidental future mutations.
 const all=await accountClosureInventory(db),a=await accountClosureInventory(db,'owner-a'),b=await accountClosureInventory(db,'owner-b');
 assert.equal(all.counts.featurePreviewGrants,1);assert.equal(a.counts.featurePreviewGrants,0);assert.equal(b.counts.featurePreviewGrants,1);
 for(const key of ['identityAccounts','identityCredentials','identitySessions'])assert.deepEqual([all,a,b].map(r=>r.counts[key]),[1,0,1]);
 assert.equal(all.counts.accounts,2);assert.equal(all.counts.projects,1);
 assert.equal(a.counts.projects,0);assert.equal(a.counts.githubCredentials,0);
 assert.equal(b.counts.projects,1);assert.equal(b.counts.githubCredentials,1);assert.equal(b.counts.githubPendingRevocations,1);assert.equal(b.counts.githubStagedCredentials,1);assert.equal(a.counts.githubStagedCredentials,0);
 // Expired planning authority still has retained bytes; do not hide it from closure.
 assert.equal(all.counts.compositionPlans,1);assert.equal(b.counts.compositionPlans,1);assert.equal(a.counts.compositionPlans,0);
 for(const key of ['costEvents','emailChanges','openEmailChanges','emailChangeLimits','securityReviews'])assert.deepEqual([all,a,b].map(r=>r.counts[key]),[1,0,1],key);
 for(const r of [all,a,b]){assert.equal(r.readyForDeletion,false);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|owner-[ab]|example.invalid|token-b|change-b1|review-b1/);}
 await assert.rejects(()=>accountClosureInventory(db,"' OR 1=1 --"));
 await assert.rejects(()=>accountClosureInventory(db,''));
 await assert.rejects(()=>accountClosureInventory({prepare(){throw Error('unavailable');}}));
 const invalid={prepare(){return {bind(){return {first:async()=>({...all.counts,accounts:null})};}};}};
 await assert.rejects(()=>accountClosureInventory(invalid));
 console.log('Account closure inventory passed: complete current schema, read-only queries, owner isolation, safe output and failure handling.');
}finally{sql.close();}

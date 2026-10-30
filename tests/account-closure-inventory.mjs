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
 sql.exec("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,kit_generation,kit_verifier,completion_receipt_id) VALUES('owner-b',1,'ready',1,1,printf('%064d',0),'receipt-b'); INSERT INTO identity_credentials VALUES('credential-b','owner-b',X'010203',0,'PRIVATE','active',NULL,unixepoch(),NULL); INSERT INTO identity_sessions(id,token_hash,account_id,policy_version,auth_epoch,client,credential_id,proof_method,proof_at,issued_at,expires_at) VALUES('00000000-0000-4000-8000-000000000002',printf('%064d',0),'owner-b',1,1,'web','credential-b','passkey',unixepoch(),unixepoch(),unixepoch()+3600);");
 // WH-170/WH-201 classes: an open address change with its limit evidence, a compromise-review snapshot and a shadow cost event.
 const now=Date.now(),key='a'.repeat(64);
 sql.exec(`INSERT INTO owner_email_change_limits(kind,account_id,at) VALUES('request','owner-b',${now});
  INSERT INTO owner_email_changes(change_id,account_id,request_id,request_hash,new_address,new_address_hash,epoch,created_at,expires_at,state,revision,history,deliverable) VALUES('change-b1','owner-b','request-b1','${key}','new-private@example.invalid','${key}',1,${now},${now+3600000},'pending',1,'["pending"]',0);
  INSERT INTO owner_security_reviews(review_id,account_id,epoch,credential_revision,kit_generation,credentials,connections,created_at,expires_at,state,revision) SELECT 'review-b1',account_id,auth_epoch,credential_revision,kit_generation,'[]','[]',${now},${now+600000},'open',1 FROM identity_accounts WHERE account_id='owner-b';
  INSERT INTO cost_events(idempotency_key,revision,source,dimension,scope,owner_id,project_id,workload,work_class,outcome,quantity_value,cost_basis,cost_micros,occurred_at,observed_at,event_json) VALUES('${key}',1,'storage-operations','r2.class_b_ops','tenant','owner-b','project-b','storage-files','standing','settled',1,'receipt',5,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z','{"contractVersion":1,"customerUnits":0,"idempotencyKey":"${key}","revision":1}');`);
 sql.exec(`INSERT INTO lookup_consents(consent_id,owner_id,provider,operation_id,credential_id,params_digest,destination,created_at,expires_at,state,revision) VALUES('consent-b1','owner-b','gmail','messages.search','credential-b','${key}','owner-panel',${now},${now+600000},'issued',1);
  INSERT INTO rule_approvals(approval_id,owner_id,rule_id,rule_revision,provider,operation_id,destination_digest,template_digest,credential_id,max_per_period,period_start,used_count,created_at,revision) VALUES('approval-b1','owner-b','rule-b',1,'hubspot','contact.create','${key}','${key}','credential-b',2,0,0,${now},1);
  INSERT INTO connector_receipts(receipt_id,owner_id,provider,operation_id,authority,credential_id,provider_account_id,destination_id,operation_digest,request_digest,review_digest,price_units,price_basis,state,created_at,expires_at,updated_at,revision) VALUES('receipt-b1','owner-b','gmail','message.send','owner-request','credential-b','account-b','dest-b','${key}','${key}','${key}',0,'plan-inclusion','review',${now},${now+3600000},${now},1);`);
 // WH-052 P-2: one unfinished ready job and one with a dispatch intent recorded (an unresolved outside effect).
 for(const id of ['0b0b0b0b-0000-4000-8000-00000000000a','0b0b0b0b-0000-4000-8000-00000000000b']){
  const envelope=JSON.stringify({jobId:id,limits:{maxAttempts:3},ownerAccountId:'owner-b',purpose:'platform-email',schedule:{createdAt:0,expiresAt:604800000,notBefore:0}});
  sql.prepare("INSERT INTO job_journal(id,owner_user_id,purpose,envelope_json,envelope_digest,created_at,expires_at,max_attempts,due,initial_due,last_event,last_at) VALUES(?,'owner-b','platform-email',?,?,0,604800000,3,0,0,'enqueued',0)").run(id,envelope,key);
 }
 sql.exec("UPDATE job_journal SET state='leased',fence=1,lease_until=60000,last_event='claimed',last_at=0 WHERE id LIKE '%00b';UPDATE job_journal SET state='awaiting',attempt=1,attempt_id=id||'.1',last_event='intent',last_at=1,last_ref=id||'.1' WHERE id LIKE '%00b';");
 sql.exec('PRAGMA query_only=ON'); // Enforce no writes, including accidental future mutations.
 const all=await accountClosureInventory(db),a=await accountClosureInventory(db,'owner-a'),b=await accountClosureInventory(db,'owner-b');
 assert.equal(all.counts.featurePreviewGrants,1);assert.equal(a.counts.featurePreviewGrants,0);assert.equal(b.counts.featurePreviewGrants,1);
 for(const key of ['identityAccounts','identityCredentials','identitySessions'])assert.deepEqual([all,a,b].map(r=>r.counts[key]),[1,0,1]);
 assert.equal(all.counts.accounts,2);assert.equal(all.counts.projects,1);
 assert.equal(a.counts.projects,0);assert.equal(a.counts.githubCredentials,0);
 assert.equal(b.counts.projects,1);assert.equal(b.counts.githubCredentials,1);assert.equal(b.counts.githubPendingRevocations,1);assert.equal(b.counts.githubStagedCredentials,1);assert.equal(a.counts.githubStagedCredentials,0);
 // Expired planning authority still has retained bytes; do not hide it from closure.
 assert.deepEqual([all,a,b].map(r=>[r.counts.jobJournal,r.counts.openJobJournal,r.counts.unresolvedJobs]),[[2,2,1],[0,0,0],[2,2,1]]);assert.equal(all.counts.compositionPlans,1);assert.equal(b.counts.compositionPlans,1);assert.equal(a.counts.compositionPlans,0);
 for(const key of ['costEvents','emailChanges','openEmailChanges','emailChangeLimits','securityReviews','lookupConsents','openLookupConsents','connectorReceipts','openConnectorReceipts','ruleApprovals','activeRuleApprovals'])assert.deepEqual([all,a,b].map(r=>r.counts[key]),[1,0,1],key);
 for(const r of [all,a,b]){assert.equal(r.readyForDeletion,false);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|owner-[ab]|example.invalid|token-b|change-b1|review-b1|consent-b1|receipt-b1|credential-b|approval-b1|0b0b0b0b/);}
 await assert.rejects(()=>accountClosureInventory(db,"' OR 1=1 --"));
 await assert.rejects(()=>accountClosureInventory(db,''));
 await assert.rejects(()=>accountClosureInventory({prepare(){throw Error('unavailable');}}));
 const invalid={prepare(){return {bind(){return {first:async()=>({...all.counts,accounts:null})};}};}};
 await assert.rejects(()=>accountClosureInventory(invalid));
 console.log('Account closure inventory passed: complete current schema, read-only queries, owner isolation, safe output and failure handling.');
}finally{sql.close();}

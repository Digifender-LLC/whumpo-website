import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';

// Schema batch 3c (WH-157 notification recipients) over the current schema on disposable in-memory SQLite and, with --d1, actual local D1:
// the two tables, their keys and cascades, the receipt_consent column and CHECK, the eight triggers, the notification_recipients view and its
// columns. The recipient behaviour through the source is tests/notification-recipients.mjs. Synthetic rows only.
const fixture=await databaseFixture(),db=fixture.db;
const all=async(sql,...v)=>(await db.prepare(sql).bind(...v).all()).results.map(r=>({...r}));
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
try{
 await check('both tables, their index and triggers exist with the declared keys',async()=>{
  const names=(await all("SELECT type,name FROM sqlite_master WHERE name LIKE 'visitor\\_notification%' ESCAPE '\\' OR name LIKE 'staff\\_notification%' ESCAPE '\\' OR name IN ('notification_recipients','module_record_consent_admit') ORDER BY type,name")).map(r=>r.type+':'+r.name);
  assert.deepEqual(names,['index:staff_notification_optins_visitor','table:staff_notification_optins','table:visitor_notification_addresses','trigger:module_record_consent_admit',
   'trigger:staff_notification_optin_admit','trigger:staff_notification_optin_immutable','trigger:staff_notification_optin_revoked',
   'trigger:visitor_notification_address_admit','trigger:visitor_notification_address_changed','trigger:visitor_notification_address_removed','trigger:visitor_notification_address_update','view:notification_recipients']);
  assert.deepEqual((await all("SELECT name,pk FROM pragma_table_info('visitor_notification_addresses') ORDER BY cid")).map(r=>[r.name,r.pk]),[['visitor_id',1],['address',0],['code_hash',0],['code_expires_at',0],['code_failures',0],['verified_at',0]]);
  assert.deepEqual((await all("SELECT name,pk FROM pragma_table_info('staff_notification_optins') ORDER BY cid")).map(r=>[r.name,r.pk]),[['instance_id',1],['visitor_id',2],['opted_in_at',0]]);
  assert.deepEqual((await all("SELECT \"from\",\"table\",on_delete FROM pragma_foreign_key_list('staff_notification_optins') ORDER BY \"from\"")).map(r=>[r.from,r.table,r.on_delete]),[['instance_id','module_instances','CASCADE'],['visitor_id','app_visitors','CASCADE']]);
  assert.deepEqual((await all("SELECT name FROM pragma_table_info('notification_recipients') ORDER BY cid")).map(r=>r.name),['project_id','scope','ref','address']);
 });
 await check('receipt_consent is a 0/1 column defaulting to 0, and the public CHECK is in the table definition',async()=>{
  const [column]=await all("SELECT \"notnull\" n,dflt_value d FROM pragma_table_info('module_records') WHERE name='receipt_consent'");assert.deepEqual([column.n,column.d],[1,'0']);
  const [{sql}]=await all("SELECT sql FROM sqlite_master WHERE name='module_records'");
  assert.match(sql,/receipt_consent IN \(0,1\)/);assert.match(sql,/submitter_kind!='public' OR receipt_consent=0/);
 });
 await check('the view reads the existing suppression list (D5): no new suppression table, keyed by the project owner',async()=>{
  const [{sql}]=await all("SELECT sql FROM sqlite_master WHERE name='notification_recipients'");
  assert.equal((sql.match(/contact_notification_suppressions/g)??[]).length,3);assert.equal((sql.match(/s\.user_id=/g)??[]).length,3);
  assert.equal((await all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%suppression%' ORDER BY name")).map(r=>r.name).join(),'contact_notification_suppression_resets,contact_notification_suppressions');
  assert.deepEqual(await all('SELECT * FROM notification_recipients'),[]);
 });
 console.log(`Schema batch 3c: ${cases} cases passed on ${process.argv.includes('--d1')?'local D1':'SQLite'}; visitor_notification_addresses, staff_notification_optins, module_records.receipt_consent with its public CHECK, eight triggers and the notification_recipients view reusing the shared suppression list. No provider call.`);
}finally{await fixture.close();}

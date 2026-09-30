import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {taskCostReport} from '../src/task-cost-report.ts';
// Actual SQLite query semantics; intentionally minimal read-side fixture, no billing writes tested here.
const sql=new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE chat_turns(id TEXT,user_id TEXT,status TEXT,mode TEXT,created_at TEXT);
CREATE TABLE inference_calls(id TEXT,turn_id TEXT,user_id TEXT,status TEXT,cost_basis TEXT,input_tokens INTEGER,output_tokens INTEGER,estimated_micros INTEGER,reserved_micros INTEGER,created_at TEXT);`);
const db={prepare(query){const s=sql.prepare(query);return {bind(...args){return {async all(){return {results:s.all(...args)}}}}}}};
const owner='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002';
const from='2026-09-01T00:00:00.000Z',to='2026-10-01T00:00:00.000Z';
function turn(id,state='completed',user=owner,date=from,mode='ai'){sql.prepare('INSERT INTO chat_turns VALUES(?,?,?,?,?)').run(id,user,state,mode,date);}
function call(turn,id,cost,status='observed',basis='subscription-shadow',user=owner){sql.prepare('INSERT INTO inference_calls VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,turn,user,status,basis,status==='observed'?100: null,status==='observed'?10:null,status==='observed'?cost:null,cost,from);}
try {
 turn('a');call('a','main',100);call('a','ack',20); // one sample, two calls
 sql.prepare('UPDATE inference_calls SET created_at=? WHERE id=?').run(to,'ack'); // late acknowledgment stays part of the task
 turn('b');call('b','main-b',200);call('b','released',100,'released');
 turn('c');call('c','main-c',500);call('c','ack-c',90,'uncertain');
 turn('d');call('d','unpriced',0,'observed','unpriced');
 turn('e','failed');call('e','failure',300);
 turn('f'); // no receipt cannot mean free
 turn('g','pending');call('g','reserved',40,'reserved');
 turn('h');call('h','cross-owner',900,'observed','subscription-shadow',other);
 turn('foreign','completed',other);call('foreign','foreign-main',700,'observed','subscription-shadow',other);
 turn('end','completed',owner,to);call('end','end-main',800);
 turn('guided','completed',owner,from,'guided');call('guided','guided-main',800);
 const result=await taskCostReport(db,from,to,owner);
 assert.equal(result.turns,8);assert.equal(result.completedFullyObserved.shadowCostMicros.samples,2);
 assert.deepEqual(result.completedFullyObserved.shadowCostMicros,{samples:2,total:320,mean:160,p50:120,p95:200,max:200});
 assert.equal(result.groups.failed.observedShadowMicros,300);assert.equal(result.groups.completed.heldShadowMicros,90);
 assert.equal(result.excluded.noReceipts,2);assert.equal(result.excluded.unfinishedCalls,2);assert.equal(result.excluded.unpriced,1);
 assert.equal(result.actualProviderExpenseMicros,null);assert.equal(result.customerUnits,null);
 const serialized=JSON.stringify(result);assert.ok(!serialized.includes(owner));assert.ok(!serialized.includes(other));assert.ok(!serialized.includes('foreign-main'));
 assert.equal((await taskCostReport(db,from,to)).completedFullyObserved.shadowCostMicros.samples,3);
 assert.equal((await taskCostReport(db,'2026-08-01T00:00:00.000Z',from)).completedFullyObserved.shadowCostMicros,null);
 for(const dates of [[to,from],['2026-02-30T00:00:00.000Z',to],['2025-01-01T00:00:00.000Z',to]])await assert.rejects(taskCostReport(db,...dates));
 await assert.rejects(taskCostReport(db,from,to,'bad'));
 call('a','overflow',Number.MAX_SAFE_INTEGER);await assert.rejects(taskCostReport(db,from,to,owner));
 console.log('Task calibration passed: per-turn aggregation, ack/release/failure coverage, uncertainty/unpriced exclusions, owner joins, time boundaries, empty samples and overflow rejection.');
}finally{sql.close();}

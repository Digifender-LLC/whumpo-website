import assert from 'node:assert/strict';
import {remoteD1} from '../tools/cms-cloudflare.mjs';
import {sqliteD1} from './sqlite-d1.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {fixtureKeyring} from './helpers/connection-keyring.mjs';

const database='11111111-1111-4111-8111-111111111111',fixture=await sqliteD1(),requests=[];
let fail=false,afterCommit=false,mutateResult;
const api=async(path,body)=>{
 assert.equal(path,'/d1/database/'+database+'/query');requests.push(structuredClone(body));
 if(fail)throw Error('Unavailable');
 const inputs=body.batch??[body],bound=inputs.map(x=>fixture.db.prepare(x.sql).bind(...x.params));
 const result=await fixture.db.batch(bound);
 if(afterCommit){afterCommit=false;throw Error('Lost response');}
 return {success:true,result:mutateResult?mutateResult(result):result};
};
const db=remoteD1(api,database);let refusals=0;
const rejected=async task=>{await assert.rejects(task);refusals++;};
try{
 // Independent immutable bindings: reusing a template cannot change a queued statement.
 const statement=db.prepare('SELECT ? AS value'),first=statement.bind('first'),second=statement.bind('second');
 assert.equal(await first.first('value'),'first');assert.equal((await second.first()).value,'second');
 assert.equal((await statement.bind('latest').all()).results[0].value,'latest');assert.equal(await first.first('value'),'first');
 assert.equal(await db.prepare('SELECT id FROM users WHERE id=?').bind('missing').first(),null);
 const before=requests.length,result=await db.batch([first,second]);assert.equal(requests.length,before+1);
 assert.deepEqual(result.map(r=>r.results[0].value),['first','second']);assert.equal(requests.at(-1).batch.length,2);
 const foreign=remoteD1(api,database).prepare('SELECT 1');
 for(const items of [[],[{}],[foreign],[{sql:'SELECT 1',params:[]}],null]){
  const n=requests.length;await rejected(()=>db.batch(items));assert.equal(requests.length,n,'Invalid capabilities never reach transport');
 }
 // A real late SQL failure rolls back the synthetic batch; no sequential fallback.
 await rejected(()=>db.batch([db.prepare("INSERT INTO users VALUES('atomic','atomic@example.invalid','2026-10-02')"),db.prepare("INSERT INTO users VALUES('atomic','duplicate@example.invalid','2026-10-02')")]));
 assert.equal(await db.prepare("SELECT id FROM users WHERE id='atomic'").first(),null);
 for(const change of [()=>[],rows=>[...rows,...rows],rows=>rows.map(r=>({...r,success:false})),rows=>rows.map(r=>({...r,results:null}))]){
  mutateResult=change;await rejected(()=>first.all());
 }
 mutateResult=undefined;fail=true;let sent=requests.length;await rejected(()=>db.batch([first,second]));assert.equal(requests.length,sent+1);fail=false;
 // A lost committed mutation is reported, never sent twice. Exact domain
 // readback remains responsible for resolving a previously admitted operation.
 afterCommit=true;sent=requests.length;await rejected(()=>db.batch([db.prepare("INSERT INTO users VALUES('lost','lost@example.invalid','2026-10-02')")]));
 assert.equal(requests.length,sent+1);assert.equal((await db.prepare("SELECT count(*) AS n FROM users WHERE id='lost'").first()).n,1);
 // Exercise the actual current key initializer through this REST adapter shape.
 const m=await currentFixtureModules(['src/connection-rotation.ts']),rotation=await m.module('src/connection-rotation.ts');
 assert.ok(rotation,'Current fixture module exports the rotation handlers');
 const key=fixtureKeyring(),policy=await rotation.initializeConnectionKeys(db,key,'synthetic-operator-review');
 assert.equal(policy.active_key,'fixture-current');assert.equal(policy.revision,1);
 assert.deepEqual(await rotation.initializeConnectionKeys(db,key,'synthetic-operator-review'),policy);
 const encoded=JSON.stringify(requests);assert.ok(!encoded.includes(JSON.parse(key).keys[0].secret));
 console.log(JSON.stringify({suite:'remote-d1',refusals,atomicBatchRequests:true,immutableBindings:true,mutationRetries:0,actualKeyInitializer:true,liveProviderAccess:false}));
}finally{await fixture.close();}

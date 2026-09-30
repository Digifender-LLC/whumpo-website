import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {build} from 'esbuild';import {createHash} from 'node:crypto';
const code=await build({entryPoints:['src/backend-nomination-intake.ts'],bundle:true,format:'esm',platform:'node',write:false});const {nominationQueue,inspectNominationIntegrity}=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
const sql=new DatabaseSync(':memory:');sql.exec(`CREATE TABLE projects(id TEXT,owner_user_id TEXT); CREATE TABLE backend_versions(id TEXT,project_id TEXT,source TEXT,digest TEXT); CREATE TABLE backend_nominations(id TEXT,version_id TEXT,user_id TEXT,digest TEXT,state TEXT,consent_at TEXT,withdrawn_at TEXT);`);
let sourceReads=0,withdrawDuringRead=false;
const db={prepare(query){
 const statement=sql.prepare(query);
 return {bind(...args){return {
  async all(){return {results:statement.all(...args)};},
  async first(){
   const result=statement.get(...args)??null;
   if(query.includes('SELECT v.source')){
    sourceReads++;
    if(withdrawDuringRead)sql.prepare("UPDATE backend_nominations SET state='withdrawn',withdrawn_at='2026-09-30' WHERE id=?").run(args[0]);
   }
   return result;
  }
 };}};
}};
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');const source='export default input => input; // CUSTOMER_SECRET_CANARY';const digest=createHash('sha256').update(source).digest('hex');
function fixture(n,state='nominated',owner='owner'){sql.prepare('INSERT INTO projects VALUES(?,?)').run(id(n),owner);sql.prepare('INSERT INTO backend_versions VALUES(?,?,?,?)').run(id(n),id(n),source,digest);sql.prepare('INSERT INTO backend_nominations VALUES(?,?,?,?,?,?,?)').run(id(n),id(n),'owner',digest,state,state==='review'?null:'2026-09-30T00:00:00.000Z',state==='withdrawn'?'2026-09-30T01:00:00.000Z':null);}
try {
 fixture(1);fixture(2,'review');fixture(3,'withdrawn');fixture(4,'nominated','someone-else');
 let queue=await nominationQueue(db);assert.equal(sourceReads,0);assert.deepEqual(queue.items.map(x=>x.id),[id(1)]);
 const result=await inspectNominationIntegrity(db,id(1));assert.equal(result.integrity,'verified_at_read');assert.equal(result.sharingAuthorized,false);assert.ok(!JSON.stringify(result).includes('CUSTOMER_SECRET_CANARY'));assert.ok(!JSON.stringify(result).includes('owner'));
 for(const n of [2,3,4,99])await assert.rejects(inspectNominationIntegrity(db,id(n)));
 sql.prepare('UPDATE backend_versions SET source=? WHERE id=?').run('tampered',id(1));await assert.rejects(inspectNominationIntegrity(db,id(1)),/integrity/);sql.prepare('UPDATE backend_versions SET source=? WHERE id=?').run(source,id(1));
 withdrawDuringRead=true;await assert.rejects(inspectNominationIntegrity(db,id(1)),/changed/);withdrawDuringRead=false;
 for(let n=10;n<61;n++)fixture(n);
 queue=await nominationQueue(db);assert.equal(queue.items.length,50);assert.equal(queue.nextCursor,id(59));const next=await nominationQueue(db,queue.nextCursor);assert.deepEqual(next.items.map(x=>x.id),[id(60)]);assert.equal(next.nextCursor,null);
 await assert.rejects(nominationQueue(db,'bad'));await assert.rejects(inspectNominationIntegrity(db,'bad'));
 console.log('Nomination intake passed: consent filtering, no source in queue/output, ownership, integrity, withdrawal race and bounded cursor pagination.');
}finally{sql.close();}

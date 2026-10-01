import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['frontend/src/lib/chat-recovery.ts'],bundle:true,format:'esm',write:false});
const {readRecovery,writeRecovery,recoveryKey,draftLifetime}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const pending={id:crypto.randomUUID(),revision:7,content:'Add a garden page.'};
const now=2000000000000,values=new Map(),store={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
const value={draft:'My next unsent thought',pending,updatedAt:now};
writeRecovery(store,owner,value);assert.deepEqual(readRecovery(store,owner,now),value);
assert.equal(readRecovery(store,other,now),null);assert.equal(values.size,0,'Different account clears retained state');
writeRecovery(store,owner,{...value,pending:null});assert.equal(readRecovery(store,owner,now+draftLifetime),null);assert.equal(values.size,0);
writeRecovery(store,owner,value);assert.deepEqual(readRecovery(store,owner,now+draftLifetime),{...value,draft:''},'Unresolved identity outlives the unsent draft');assert.equal(JSON.parse(store.getItem(recoveryKey)).draft,'','Expired draft bytes are removed while the receipt remains');
assert.deepEqual(readRecovery(store,owner,now-1),{...value,draft:''},'Clock rollback does not forget an unresolved request');
const action={type:'confirm',kind:'site',reviewId:other},approval={id:crypto.randomUUID(),revision:9,action,content:'Confirm the reviewed website change.'};
writeRecovery(store,owner,{...value,pending:approval});assert.deepEqual(readRecovery(store,owner,now).pending,approval);
for(const bad of [{...pending,id:'bad'},{...pending,revision:-1},{...pending,content:' '},{...pending,secret:'unexpected'},{...approval,content:'Different label'},{...approval,content:'/confirm '+other},{...approval,action:{...action,override:true}},{...approval,action:{type:'deleteEverything'}}]){
 store.setItem(recoveryKey,JSON.stringify({version:2,owner,...value,pending:bad}));assert.equal(readRecovery(store,owner,now),null);assert.equal(values.size,0);
}
for(const raw of ['{','[]',JSON.stringify({version:1,owner,...value}),JSON.stringify({version:2,owner,...value,draft:'x'.repeat(16001)}),JSON.stringify({version:2,owner,...value,extra:'private'}),'x'.repeat(100001)]){store.setItem(recoveryKey,raw);assert.equal(readRecovery(store,owner,now),null);}
writeRecovery(store,owner,{draft:'',pending:null,updatedAt:now});assert.equal(values.size,0);
assert.throws(()=>writeRecovery(store,owner,{...value,draft:'x'.repeat(16001)}));
const failed={getItem(){throw Error('blocked')},setItem(){throw Error('full')},removeItem(){throw Error('blocked')}};
assert.throws(()=>readRecovery(failed,owner,now));assert.throws(()=>writeRecovery(failed,owner,value));
writeRecovery(store,owner,value);
assert.throws(()=>readRecovery({...store,setItem(){throw Error('quota');}},owner,now+draftLifetime));
assert.deepEqual(JSON.parse(store.getItem(recoveryKey)).pending,pending,'Failed expiry cleanup must not delete a valid unresolved request');
console.log('Chat recovery passed: exact natural/action request preservation, account separation, bounded/invalid input, draft expiry, unresolved retention, clock changes, clearing and unavailable storage. No network calls.');

import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({entryPoints:['frontend/src/lib/welcome-delivery.ts'],bundle:true,format:'esm',write:false});
const {saveWelcomeProfile,saveWelcomeProgress,finishWelcome}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const owner='11111111-1111-4111-8111-111111111111',before={accountId:owner,revision:4};
const profile={accountId:owner,revision:5,name:'River',about_me:'Garden studio',share_context:0};
const input={revision:7,stage:'project',prompt:'audience',project_name:' River Garden ',idea:' Local landscaping ',audience:'',preferred_theme:'forest'};
const saved={complete:false,state:{...input,revision:8,project_name:'River Garden',idea:'Local landscaping'}};
let writes=0,reads=0;
const failure=status=>Object.assign(new Error('original failure'),status===undefined?{}:{status});
async function recover(run,value,status){const error=failure(status);writes=0;reads=0;const result=await run(async()=>{writes++;throw error;},async()=>{reads++;return value;});assert.equal(writes,1);assert.equal(reads,1);assert.deepEqual(result,value);}
for(const status of [undefined,408,409,500,503]){
 await recover((write,read)=>saveWelcomeProfile(before,{name:'River'},write,read),profile,status);
 await recover((write,read)=>saveWelcomeProfile(before,{about_me:'Garden studio',share_context:false},write,read),profile,status);
 await recover((write,read)=>saveWelcomeProgress(input,write,read),saved,status);
 await recover(finishWelcome,{complete:true},status);
}
async function refuses(run,value,status=503){const error=failure(status);writes=0;reads=0;await assert.rejects(run(async()=>{writes++;throw error;},async()=>{reads++;return value;}),e=>e===error);assert.equal(writes,1);assert.equal(reads,1);}
for(const changed of [{...profile,accountId:'other'},{...profile,revision:4},{...profile,revision:6},{...profile,name:'Someone else'}])await refuses((write,read)=>saveWelcomeProfile(before,{name:'River'},write,read),changed);
await refuses((write,read)=>saveWelcomeProfile({revision:4},{name:'River'},write,read),profile);
await refuses((write,read)=>saveWelcomeProfile(before,{about_me:'Garden studio',share_context:false},write,read),{...profile,share_context:1});
// WH-025 measurement choice is part of the exact bio-step readback when submitted.
await recover((write,read)=>saveWelcomeProfile(before,{about_me:'Garden studio',share_context:false,measurement_consent:true},write,read),{...profile,measurement_consent:1});
await refuses((write,read)=>saveWelcomeProfile(before,{about_me:'Garden studio',share_context:false,measurement_consent:true},write,read),{...profile,measurement_consent:0});
for(const change of [{revision:7},{revision:9},{prompt:'review'},{project_name:'Other'},{idea:'Other'},{audience:'Other'},{preferred_theme:'clay'},{stage:'profile'}])await refuses((write,read)=>saveWelcomeProgress(input,write,read),{...saved,state:{...saved.state,...change}});
await refuses((write,read)=>saveWelcomeProgress(input,write,read),{complete:true});await refuses(finishWelcome,{complete:false});
for(const status of [400,401,403,404,422,429]){const error=failure(status);reads=0;await assert.rejects(finishWelcome(async()=>{throw error;},async()=>{reads++;return {complete:true};}),e=>e===error);assert.equal(reads,0,'Definitive rejection must not appear successful');}
const error=failure(503);await assert.rejects(finishWelcome(async()=>{throw error;},async()=>{throw Error('Read unavailable');}),e=>e===error);
reads=0;assert.deepEqual(await finishWelcome(async()=>({complete:true}),async()=>{reads++;throw Error('Not needed');}),{complete:true});assert.equal(reads,0);
console.log('Welcome delivery passed: one write only, exact profile owner/revision/fields, exact normalized question snapshot, completion readback, stale/conflicting/foreign rejection, unavailable reads and definitive errors. No network.');

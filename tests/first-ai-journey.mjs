Error.stackTraceLimit=0;
import {recordFixtureBenchmark} from '../tools/benchmark-evidence.mjs';
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,scopes=new Map(),scope=user=>scopes.get(user);
async function accountAuthority(user=crypto.randomUUID()){const authority=await workspaceFixture(db,m,user);scopes.set(user,await authority.scope());return authority;}
const {sendAIChat,readChat,sendChatControl,getBilling}=m;
try{
 const user=crypto.randomUUID();await accountAuthority(user);
 await readChat(scope(user),user);assert.equal((await getBilling(scope(user),user)).standardAI.creditCharge,0);
 const config={name:'Copper Oven',headline:'Welcome to Copper Oven',description:'Sourdough and pastries daily.',theme:'ocean',aboutTitle:'Our bakery',aboutText:'A neighborhood bakery.',sections:[],photos:[]};
 let base,project,calls=0;const {photos,...expected}=structuredClone(config);
 for(let step=0;step<4;step++){
  const changes=step===1?{theme:'forest'}:step===2?{headline:'Fresh bread, every morning.'}:{sections:[{heading:'Visit us',text:'Open Tuesday through Sunday, 7am to 2pm.'}]};
  const operations=step===1?[{type:'design.setTheme',theme:changes.theme}]:step===2?[{type:'content.replace',contentId:'headline',text:changes.headline}]:[{type:'pages.setSections',pageId:'home',sections:changes.sections}];
  const action=step===0?{kind:'project',purpose:'Neighborhood bakery',config}:{kind:'specification',operation:'change',projectId:project,expectedRevision:step,operations};
  const state=(await readChat(scope(user),user)).state;const id=crypto.randomUUID();
  const content=step===0?'Create a new Copper Oven bakery website':step===1?'Change the theme to forest':step===2?'Change the headline to Fresh bread, every morning.':'Add a Visit us section: Open Tuesday through Sunday, 7am to 2pm.';
  const transport=async(_url,init)=>{
   calls++;const request=JSON.parse(init.body);
   assert.ok(request.max_output_tokens>=1024);
   // Representative provider usage is recorded internally without a customer charge.
   return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'Proposed draft',action})}]}],usage:{input_tokens:2400,output_tokens:step===0?1900:600}});
  };
  const result=await sendAIChat(scope(user),user,id,state.revision,content,{baseURL:'https://provider.test/v1',apiKey:'synthetic',model:'fixture',protocol:'responses'},transport);
  assert.equal(result.status,200,`Step ${step}: ${JSON.stringify(result)}`);
  let version=id;if(step){const q=(await readChat(scope(user),user)).turns.at(-1).specification_review;assert.ok(q);version=crypto.randomUUID();assert.equal((await sendChatControl(scope(user),user,{id:version,revision:(await readChat(scope(user),user)).state.revision,action:{type:'specificationApply',reviewId:q.id,proposalDigest:q.proposalDigest,expectedRevision:q.expectedRevision}})).status,200);}else project=id;
  const row=await db.prepare('SELECT config_json,base_version_id FROM site_versions WHERE id=?').bind(version).first();assert.ok(row);
  if(step)Object.assign(expected,changes);assert.deepEqual(JSON.parse(row.config_json),{...expected,sections:expected.sections.map(s=>({variant:'plain',...s}))});assert.equal(row.base_version_id,base??null);
  assert.equal((await readChat(scope(user),user)).turns.at(-1).status,'completed');
  const billing=await getBilling(scope(user),user);assert.equal(billing.standardAI.creditCharge,0);
  await sendAIChat(scope(user),user,id,state.revision,content,{baseURL:'https://provider.test/v1',apiKey:'synthetic',model:'fixture',protocol:'responses'},transport);assert.equal(calls,step+1);
  base=version;
 }
 assert.equal((await getBilling(scope(user),user)).standardAI.creditCharge,0);
 // A bare action is not a valid assistant envelope, even when its edit is otherwise valid.
 const state=(await readChat(scope(user),user)).state,bad=crypto.randomUUID();
 await sendAIChat(scope(user),user,bad,state.revision,'Change theme',{baseURL:'https://provider.test/v1',apiKey:'synthetic',model:'fixture',protocol:'responses'},async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({kind:'edit',baseVersionId:base,changes:{theme:'clay'}})}]}],usage:{input_tokens:2400,output_tokens:600}}));
 assert.equal((await readChat(scope(user),user)).turns.at(-1).status,'failed');
 assert.equal(await db.prepare('SELECT id FROM site_versions WHERE id=?').bind(bad).first(),null);
 assert.equal((await getBilling(scope(user),user)).standardAI.creditCharge,0);

 await recordFixtureBenchmark(db,'edits',{transportCalls:calls+1,runtimeCalls:0});
 console.log('Standard AI journey passes creation + three edits without spending customer units, exact ancestry/content, zero customer debits and replay without extra calls. Provider behavior is synthetic; live model acceptance is separate.');
}finally{await store.close();}

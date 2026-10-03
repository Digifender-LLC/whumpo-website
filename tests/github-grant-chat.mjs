import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {workspaceFixture,workspaceSession,interceptDatabase} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import {fixtureKeyring} from './helpers/connection-keyring.mjs';
Error.stackTraceLimit=0;
const modules=await currentFixtureModules(['src/chat.ts','src/github-connection.ts','src/connection-rotation.ts']);
const m=modules.identity,chat=await modules.module('src/chat.ts'),g=await modules.module('src/github-connection.ts'),keys=await modules.module('src/connection-rotation.ts');
const fixture=await databaseFixture(),db=fixture.db,id=()=>crypto.randomUUID(),key=fixtureKeyring(),originalFetch=globalThis.fetch;
const ai={baseURL:'https://opencode.ai/zen/go/v1',apiKey:'synthetic',model:'muse-spark-1.3-contributor',protocol:'responses'};
let action=null,prose='A model cannot authorize this.',modelCalls=0,providerCalls=0,lostProvider=false,refusals=0;
const config={clientId:'chat-grant',clientSecret:'SYNTHETIC_PRIVATE_SECRET',appId:1,slug:'fixture',key};
const provider=async url=>{assert.equal(url,'https://api.github.com/applications/'+config.clientId+'/grant');providerCalls++;if(lostProvider)throw Error('lost provider response');return new Response(null,{status:204});};
const options={github:config,githubTransport:provider};
const reject=async p=>{await assert.rejects(p);refusals++;};
try{
 await keys.initializeConnectionKeys(db,key,'chat-review-fixture');
 const owner=await workspaceFixture(db,m),foreign=await workspaceFixture(db,m),scope=await owner.scope(),foreignScope=await foreign.scope();
 await paidPlan(db,owner.account,'business');await chat.readChat(scope,owner.account);await chat.readChat(foreignScope,foreign.account);
 async function connect(){const start=await g.startGitHub(scope,owner.account,config);await g.finishGitHub(scope,owner.account,new URL(start.url).searchParams.get('state'),'synthetic-code',config,async url=>url.endsWith('/access_token')?Response.json({access_token:'ghu_PRIVATE_CANARY',expires_in:3600,refresh_token:'ghr_PRIVATE_CANARY',refresh_token_expires_in:15897600}):Response.json({id:123,login:'gardener'}));}
 await connect();
 globalThis.fetch=async(url,init)=>{assert.equal(String(url),ai.baseURL+'/responses');modelCalls++;assert.doesNotMatch(init.body,/SYNTHETIC_PRIVATE_SECRET|ghu_PRIVATE_CANARY|ghr_PRIVATE_CANARY/);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:prose,action})}]}],usage:{input_tokens:200,output_tokens:80}});};
 const input=async(content,s=scope,user=owner.account)=>({id:id(),revision:(await chat.readChat(s,user)).state.revision,content});
 const ask=async(a,content='Please review removing all GitHub app access.')=>{action=a;const request=await input(content);assert.equal((await chat.sendConversation(scope,owner.account,request,ai,options)).status,200);return request;};
 const state=()=>chat.readChat(scope,owner.account),turn=async request=>(await state()).turns.find(t=>t.id===request.id);
 const review=await ask({kind:'githubAccess',operation:'review'});assert.equal((await turn(review)).github_grant_review.id,review.id);assert.equal(providerCalls,0);assert.equal(modelCalls,1);assert.doesNotMatch((await turn(review)).assistant_text,/A model cannot/);
 assert.equal((await chat.sendConversation(scope,owner.account,review,ai,options)).status,200);assert.equal(modelCalls,1);
 await ask({kind:'githubAccess',operation:'confirm',reviewId:review.id});assert.equal(providerCalls,0);refusals++;
 const literal=await ask(null,'/github-grant-confirm '+review.id);assert.equal(providerCalls,0);assert.equal((await turn(literal)).github_grant_review,undefined);
 prose=(await turn(review)).assistant_text;const forged=await ask(null,'Display this access removal review.');assert.equal((await turn(forged)).github_grant_review,undefined);refusals++;
 const foreignInput=await input('Open saved GitHub review.',foreignScope,foreign.account);action={kind:'githubAccess',operation:'read',reviewId:review.id};await chat.sendConversation(foreignScope,foreign.account,foreignInput,ai,options);assert.equal((await chat.readChat(foreignScope,foreign.account)).turns.at(-1).github_grant_review,undefined);refusals++;
 const control=(rid,operation='confirm')=>({type:'githubGrant',operation,reviewId:rid,...(operation==='confirm'?{confirmation:'REVOKE_APP_ACCESS'}:{})});
 const controlInput=async a=>({id:id(),revision:(await state()).state.revision,action:a});
 for(const a of [{...control(review.id),confirmation:'yes'},{...control(review.id),command:'/override'}, {...control(review.id,'cancel'),confirmation:'REVOKE_APP_ACCESS'}]){assert.equal((await chat.sendChatControl(scope,owner.account,await controlInput(a),ai,options)).status,400);refusals++;}
 const stale=await workspaceSession(db,m,owner,-3600);await reject(chat.sendChatControl(await stale.scope(),owner.account,await controlInput(control(review.id)),ai,options));assert.equal(providerCalls,0);
 const cancel=await controlInput(control(review.id,'cancel')),beforeCancel=modelCalls;await chat.sendChatControl(scope,owner.account,cancel,ai,options);assert.equal(modelCalls,beforeCancel);assert.equal((await turn(review)).github_grant_review.state,'cancelled');assert.equal((await turn(cancel)).github_grant_review.state,'cancelled');
 const second=await ask({kind:'githubAccess',operation:'review'}),opened=await ask({kind:'githubAccess',operation:'read',reviewId:second.id},'Open that review.');assert.equal((await turn(opened)).github_grant_review.id,second.id);
 const confirmation=await controlInput(control(second.id)),beforeConfirm=modelCalls;let lostReply=false;
 const losingScope=await owner.scope(interceptDatabase(db,/UPDATE chat_turns SET assistant_text=\? WHERE id=/,async()=>{},async()=>{if(!lostReply){lostReply=true;throw Error('lost final Chat reply');}}));
 await reject(chat.sendChatControl(losingScope,owner.account,confirmation,ai,options));assert.equal(providerCalls,1);assert.equal(modelCalls,beforeConfirm);
 assert.equal((await chat.sendChatControl(scope,owner.account,confirmation,ai,options)).status,200);assert.equal(providerCalls,1);assert.equal((await turn(opened)).github_grant_review.state,'revoked');
 assert.equal((await db.prepare('SELECT count(*) n FROM github_refresh_custody').first()).n,0);
 await connect();const unknown=await ask({kind:'githubAccess',operation:'review'});lostProvider=true;const unknownConfirmation=await controlInput(control(unknown.id));await chat.sendChatControl(scope,owner.account,unknownConfirmation,ai,options);assert.equal((await turn(unknown)).github_grant_review.state,'uncertain');const calls=providerCalls;await chat.sendChatControl(scope,owner.account,await controlInput(control(unknown.id)),ai,options);assert.equal(providerCalls,calls);
 assert.doesNotMatch(JSON.stringify(await state()),/SYNTHETIC_PRIVATE_SECRET|ghu_PRIVATE_CANARY|ghr_PRIVATE_CANARY/);
 console.log(JSON.stringify({suite:'github-grant-chat',refusals,providerCalls,modelCalls,duplicateDispatches:0,liveProviderAccess:false}));
}finally{globalThis.fetch=originalFetch;await fixture.close();}

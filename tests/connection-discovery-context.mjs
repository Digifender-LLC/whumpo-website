import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtureKeyring,initializeFixtureKeys} from './helpers/connection-keyring.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';

// WH-142 slice (A): does provider discovery metadata shown in Chat re-enter later model context? This drives the real
// Chat handlers (sendChat guided discovery, sendAIChat with a model-selected discovery action) and the real next-turn
// prompt builder in src/ai-chat.ts on a disposable current-schema database (SQLite by default, local D1 with --d1).
// GitHub/Cloudflare are synthetic transports returning invented canary names and IDs; the model is a scripted transport
// that records every prompt. No network, provider account, real credential or real model.
//
// It pins the CURRENT behaviour, registered in docs/connectors.md as known exposure G-C6: discovery replies are saved
// as ordinary Chat turns with ai_context_allowed=1, so the next AI turn sends them back as assistant history (the last
// four completed turns, first 900 characters each). This is not fixed here; it is a finding for the owner. A source
// change that stops the exposure fails the "known exposure" checks, which must then be rewritten with the doc.
const root=fileURLToPath(new URL('..',import.meta.url));
const read=file=>readFileSync(join(root,file),'utf8');
const entry=`export {sendChat,readChat} from './src/chat';
export {sendAIChat} from './src/ai-chat';
export {seal} from './src/connection-vault';
export {hashToken,newSessionToken} from './src/security';
export {admitWorkspace} from './src/workspace-identity/admission';
export {resolveIdentity} from './src/workspace-identity/authority';`;
async function load(overrides={}){
 const plugin={name:'mutant',setup(b){b.onLoad({filter:/\.ts$/},args=>{const rel=relative(root,args.path).replaceAll('\\','/');if(Object.hasOwn(overrides,rel))return {contents:overrides[rel],loader:'ts'};});}};
 const out=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent',external:['cloudflare:*'],plugins:[plugin]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}

const fixture=await databaseFixture({allowedArguments:['--explain']}),{db}=fixture;
const key=fixtureKeyring('9a'.repeat(32));
const github={clientId:'Iv1.discovery',clientSecret:'synthetic-secret',appId:123,slug:'synthetic',key},cloudflare={clientId:'synthetic-client',clientSecret:'synthetic-secret',key};
const ai={baseURL:'https://model.invalid/v1',apiKey:'synthetic-model-key',model:'synthetic',protocol:'responses'};
// Canaries. GitHub logins, repository and branch names allow the SYNTHETIC-<KIND>-<NNNN> form; Cloudflare zone names
// must be lowercase hostnames and zone IDs 32 hex digits, so those use the closest valid form.
const canary={
 installation:'SYNTHETIC-INSTALL-0101',installationId:731900101,
 repo:'SYNTHETIC-REPO-0201',branch:'SYNTHETIC-BRANCH-0202',repoId:731900203,repoOwner:'SYNTHETIC-OWNER-0204',
 lateRepo:'SYNTHETIC-REPO-0299',
 zone:'synthetic-zone-0301.example',zoneId:'5e000000000000000000000000c00301',
 modelZone:'synthetic-zone-0401.example',modelZoneId:'5e000000000000000000000000c00401',
 excluded:'SYNTHETIC-PRIVATE-0901',
};
const guided=['installation','installationId','repo','branch','repoId','repoOwner','zone','zoneId'];
const now=()=>new Date().toISOString(),later=()=>new Date(Date.now()+3600e3).toISOString();

let total=0;
async function test(name,fn){try{await fn();total++;}catch(error){throw new Error(name,{cause:error});}}

function githubTransport(){
 const repo=(name,id,owner='synthetic-filler',branch='main')=>({id,owner:{login:owner},name,private:true,default_branch:branch,permissions:{push:true}});
 const repositories=[repo(canary.repo,canary.repoId,canary.repoOwner,canary.branch),...Array.from({length:18},(_,i)=>repo('filler-repository-'+String(i).padStart(2,'0'),731901000+i)),repo(canary.lateRepo,731900299)];
 return async url=>{
  url=String(url);
  if(url==='https://api.github.com/user/installations?per_page=100')return Response.json({total_count:1,installations:[{id:canary.installationId,app_id:github.appId,suspended_at:null,account:{login:canary.installation},repository_selection:'selected'}]});
  assert.equal(url,`https://api.github.com/user/installations/${canary.installationId}/repositories?per_page=20&page=1`);
  return Response.json({repositories});
 };
}
const zonesTransport=(name,id)=>async url=>{
 assert.equal(String(url),'https://api.cloudflare.com/client/v4/zones?per_page=50&page=1');
 return Response.json({success:true,result:[{id,name,status:'active'}],result_info:{total_pages:1}});
};
/** Scripted model: records each prompt and replies with the next scripted {reply,action}. */
function model(){
 const prompts=[],script=[];
 const transport=async(_url,init)=>{
  const payload=JSON.parse(init.body);prompts.push(payload.input);
  const next=script.shift()??{reply:'Noted.',action:null};
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(next)}]}],usage:{input_tokens:100,output_tokens:20}});
 };
 return {prompts,script,transport};
}
const text=messages=>messages.map(message=>typeof message.content==='string'?message.content:JSON.stringify(message.content));
const inRole=(messages,role,value)=>messages.some(message=>message.role===role&&text([message])[0].includes(value));
const anywhere=(messages,value)=>text(messages).some(content=>content.includes(value));

async function suite(m){
 const before=total,owner=await workspaceFixture(db,m),user=owner.account;await paidPlan(db,user,'business');
 const scope=await owner.scope();await m.readChat(scope,user);
 await db.prepare("UPDATE workspace_state SET step='ready' WHERE user_id=?").bind(user).run();
 const ghToken=crypto.randomUUID(),cfToken=crypto.randomUUID();
 await db.prepare("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES(?,?,?,?,'active')").bind(ghToken,user,await m.seal(key,`whumpo:github:token:${user}:${ghToken}`,'ghu_synthetic_discovery'),later()).run();
 await db.prepare('INSERT INTO github_connections(user_id,github_user_id,login,active_token_id,connected_at) VALUES(?,?,?,?,?)').bind(user,'44','synthetic-org',ghToken,now()).run();
 await db.prepare("INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES(?,?,?,?,?,'active')").bind(cfToken,user,await m.seal(key,`whumpo:cloudflare:token:${user}:${cfToken}`,JSON.stringify({access:'cf_synthetic_discovery'})),later(),now()).run();
 const options={github,githubTransport:githubTransport(),config:cloudflare,transport:zonesTransport(canary.zone,canary.zoneId)};
 const revision=async()=>(await m.readChat(scope,user)).state.revision;
 const guidedTurn=async content=>{const id=crypto.randomUUID(),r=await m.sendChat(scope,user,{id,content,revision:await revision()},undefined,options);assert.equal(r.status,200,r.error);return db.prepare('SELECT assistant_text,ai_context_allowed,status FROM chat_turns WHERE id=?').bind(id).first();};
 const aiTurn=async(content,brain,dnsOptions)=>{const r=await m.sendAIChat(scope,user,crypto.randomUUID(),await revision(),content,ai,brain.transport,dnsOptions);assert.equal(r.status,200,r.error);return brain.prompts.at(-1);};

 // Guided discovery: the owner asks for installations, repositories and zones. Server-formatted replies are saved.
 const installations=await guidedTurn('/github-installations'),repositories=await guidedTurn(`/github-repos ${canary.installationId} 1`),zones=await guidedTurn('/dns-zones');
 for(const [turn,values] of [[installations,['installation','installationId']],[repositories,['repo','branch','repoId','repoOwner','lateRepo']],[zones,['zone','zoneId']]]){
  assert.equal(turn.status,'completed');
  for(const value of values)assert.ok(turn.assistant_text.includes(String(canary[value])),value);
 }
 assert.ok(repositories.assistant_text.indexOf(canary.lateRepo)>900,'the late repository is beyond the 900-character history slice');
 // A turn saved outside AI context (fixture row, as tests/processing-boundaries.mjs does) is the control.
 const control=await revision()+1;
 await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,mode,status,created_at,ai_context_allowed) VALUES(?,?,?,'Private control',?,'guided','completed',?,0)").bind(crypto.randomUUID(),user,control,canary.excluded,now()).run();
 await db.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(control,user).run();

 const brain=model();const first=await aiTurn('Which repository should I back up to, and which zone holds my domain?',brain);
 assert.equal(brain.prompts.length,1,'one main model call; no acknowledgement or lookup');
 await test('known exposure G-C6: guided discovery replies re-enter the next model prompt as assistant history',()=>{
  for(const turn of [installations,repositories,zones])assert.equal(turn.ai_context_allowed,1);
  for(const value of guided)assert.ok(inRole(first,'assistant',String(canary[value])),`${value} is in assistant history`);
  // Only history carries them: not the system policy or the workspace data message.
  for(const value of guided)assert.ok(!first.filter(message=>message.role!=='assistant'&&!text([message])[0].startsWith('/github-repos')).some(message=>text([message])[0].includes(String(canary[value]))),`${value} only in history`);
 });
 await test('turns excluded from AI context stay out of the next prompt',()=>assert.ok(!anywhere(first,canary.excluded)));
 await test('only the first 900 characters of a discovery reply re-enter',()=>{assert.ok(!anywhere(first,canary.lateRepo));assert.ok(anywhere(first,canary.repo));});

 // AI path: the model itself selects the owner-control zone lookup; the server-formatted reply becomes the saved turn.
 brain.script.push({reply:'Here are your authorized zones.',action:{kind:'dns',operation:'zones',page:1}});
 await aiTurn('List my Cloudflare zones.',brain,{...options,transport:zonesTransport(canary.modelZone,canary.modelZoneId)});
 const selected=await db.prepare("SELECT assistant_text,ai_context_allowed,mode FROM chat_turns WHERE user_id=? ORDER BY revision DESC LIMIT 1").bind(user).first();
 assert.equal(selected.mode,'ai');assert.ok(selected.assistant_text.includes(canary.modelZone)&&selected.assistant_text.includes(canary.modelZoneId));
 const third=await aiTurn('Thanks. Which zone was that?',brain);
 await test('known exposure G-C6: an AI-selected discovery reply re-enters the next model prompt',()=>{
  assert.equal(selected.ai_context_allowed,1);
  for(const value of [canary.modelZone,canary.modelZoneId])assert.ok(inRole(third,'assistant',value),value);
 });

 // Bounded window: after four newer completed turns, no discovery value is sent.
 for(let i=0;i<4;i++)await guidedTurn('/usage');
 const last=await aiTurn('What should I do next?',brain);
 await test('discovery leaves model context after four newer completed turns',()=>{
  for(const value of [...guided.map(k=>String(canary[k])),canary.modelZone,canary.modelZoneId,canary.lateRepo,canary.excluded])assert.ok(!anywhere(last,value),value);
 });
 assert.equal(brain.prompts.length,4);
 return total-before;
}

try{
 await initializeFixtureKeys(db,key);
 const checks=await suite(await load());
 // ---------- Mutation check: each broken copy of the history builder must be caught by its named check ----------
 const AI='src/ai-chat.ts',CHAT='src/chat.ts';
 const mutants=[
  ['guided discovery turns kept out of AI context',CHAT,"usageReview||isTranscriptRequest(content)?0:1","0",'known exposure G-C6: guided discovery replies re-enter'],
  ['excluded turns read into history',AI,"status = 'completed' AND ai_context_allowed=1 ORDER BY","status = 'completed' ORDER BY",'turns excluded from AI context stay out of the next prompt'],
  ['untruncated assistant history',AI,"turn.assistant_text.slice(0, 900)","turn.assistant_text.slice(0, 9000)",'only the first 900 characters of a discovery reply re-enter'],
  ['AI turns kept out of AI context',AI,"now, task?0:1, userId","now, 0, userId",'known exposure G-C6: an AI-selected discovery reply re-enters'],
  ['longer history window',AI,"ai_context_allowed=1 ORDER BY revision DESC LIMIT 4","ai_context_allowed=1 ORDER BY revision DESC LIMIT 8",'discovery leaves model context after four newer completed turns'],
 ];
 let killed=0;
 for(const [name,file,find,replace,killedBy] of mutants){
  const source=read(file);
  assert.equal(source.split(find).length,2,`mutant "${name}" must match ${file} exactly once`);
  await assert.rejects(suite(await load({[file]:source.replace(find,()=>replace)})),e=>{
   if(process.argv.includes('--explain'))console.log(`${name} => ${e.message}${e.cause?' / '+e.cause.message:''}`);
   assert.ok(e.message.startsWith(killedBy),`mutant "${name}" was caught by an unexpected check: ${e.message}${e.cause?' / '+e.cause.message:''}`);return true;
  },`mutant survived: ${name}`);killed++;
 }
 assert.equal(killed,mutants.length);
 console.log(`connection-discovery-context: ${checks} checks passed on ${process.argv.includes('--d1')?'local D1':'SQLite'}. Known exposure G-C6 pinned: GitHub installation, repository, branch and owner names/IDs and Cloudflare zone names/IDs from guided and model-selected discovery replies re-enter the next model prompt as assistant history (last four completed turns, first 900 characters each). ${killed}/${mutants.length} history-builder mutants caught. Synthetic providers and scripted model only.`);
}finally{await fixture.close();}

// Disposable loopback UI fixture: synthetic account/data, no inference or database.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
const reloadMode=process.argv.includes('--reload');
const origin='http://localhost:8174',root=resolve('dist'),now=new Date().toISOString();
const project='11111111-1111-4111-8111-111111111111';
const profile={accountId:'33333333-3333-4333-8333-333333333333',revision:0,avatar_id:'cloud',onboardingComplete:true,name:'Alex',about_me:'',email:'ui-fixture@example.invalid',share_context:0,theme:'light',hasPhoto:0,passwordEnabled:true};
const dashboard={revision:0,layout:{version:1,dashboard:{version:1,projectId:null,widgets:['projects','activity'],shortcuts:[]},tabs:[]},projects:[{id:project,name:'Garden studio',status:'draft',purpose:'A landscaping website',cms_articles:0}],measuredAt:now,billing:{plan:{id:'explore',name:'Explore'},quota:{allowance:0,available:0,spent:0,reserved:0}},activity:[],storage:[],capacity:{preferences:{revision:0,preferred_plan:'starter',billing_interval:'month',draft_overage_cents:0}}};
const chat={greeting:'Let’s work on your garden studio.',state:{revision:1},turns:[{id:'22222222-2222-4222-8222-222222222222',user_text:'Help me plan a landscaping site.',assistant_text:'We can start with your services and a contact page.',status:'completed',mode:'ai'}],stats:{projects:1,live:0},mode:'ai',usage:{available:0,reserved:0}};
let failChat=!reloadMode,failDashboard=!reloadMode,firstPost=true,failBeforeNext=false,signedOut=false,otherAccount=false;const posts=[],reads=[];let finish;
const finished=new Promise(resolve=>{finish=resolve;});
const json=(res,status,value)=>res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(value));
const server=createServer(async(req,res)=>{try{
 if(req.headers.host!=='localhost:8174'){res.writeHead(403).end();return;}
 const url=new URL(req.url,origin);
 if(url.pathname==='/_fixture'){
  res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'}).end(`<h1>Workspace recovery fixture</h1><p>Synthetic local UI data only.</p><p>Chat reads: ${failChat?'failing':'available'}. Dashboard reads: ${failDashboard?'failing':'available'}.</p><form method="post" action="/_fixture/chat-ready"><button>Restore Chat reads</button></form><form method="post" action="/_fixture/dashboard-ready"><button>Restore Dashboard reads</button></form><form method="post" action="/_fixture/dashboard-fail"><button>Fail Dashboard reads</button></form><form method="post" action="/_fixture/chat-fail"><button>Fail Chat reads</button></form><form method="post" action="/_fixture/complete"><button>Complete pending reply</button></form><form method="post" action="/_fixture/finish"><button>Finish fixture checks</button></form><form method="post" action="/_fixture/lose-before"><button>Lose next send before acceptance</button></form><form method="post" action="/_fixture/other-account"><button>Use other fixture account</button></form><form method="post" action="/_fixture/owner-account"><button>Use original fixture account</button></form><p><a href="/workspace">Open workspace</a></p>`);return;
 }
 if(url.pathname.startsWith('/_fixture/')&&req.method==='POST'){
  const action=url.pathname.split('/').at(-1);
  if(action==='chat-ready')failChat=false;else if(action==='dashboard-ready')failDashboard=false;else if(action==='chat-fail')failChat=true;else if(action==='dashboard-fail')failDashboard=true;
  else if(action==='complete'){const pending=chat.turns.find(t=>t.status==='pending');assert.ok(pending);pending.status='completed';pending.assistant_text='Your private draft is ready to review. It has not been published.';failChat=false;}
  else if(action==='lose-before')failBeforeNext=true;
  else if(action==='other-account'){otherAccount=true;signedOut=false;}
  else if(action==='owner-account'){otherAccount=false;signedOut=false;}
  else if(action==='finish'){res.writeHead(200,{'content-type':'text/plain'}).end('Checking fixture assertions.');finish();return;}
  else{res.writeHead(404).end();return;}
  res.writeHead(303,{location:'/_fixture'}).end();return;
 }
 if(url.pathname.startsWith('/api/')){
  if(req.method==='GET'){
   reads.push(url.pathname);
   if(url.pathname==='/api/profile')return json(res,signedOut?401:200,signedOut?{error:'Sign in to continue.'}:otherAccount?{...profile,accountId:'44444444-4444-4444-8444-444444444444',email:'other-fixture@example.invalid',name:'Other account'}:profile);
   if(url.pathname==='/api/config')return json(res,200,{inviteRequired:false,turnstileSiteKey:null});
   if(url.pathname==='/api/workspace/dashboard')return json(res,failDashboard?503:200,failDashboard?{error:'Fixture dashboard unavailable'}:otherAccount?{...dashboard,projects:[]}:dashboard);
   if(url.pathname==='/api/chat')return json(res,failChat?503:200,failChat?{error:'Fixture conversation unavailable'}:otherAccount?{...chat,greeting:'Other account workspace',state:{revision:0},turns:[],stats:{projects:0,live:0}}:chat);
   if(/^\/api\/chat\/[^/]+\/ack$/.test(url.pathname))return json(res,200,{ack:null});
   return json(res,404,{error:'Fixture endpoint not supported'});
  }
  if(url.pathname==='/api/auth/logout'&&req.method==='POST'){signedOut=true;return json(res,200,{ok:true});}
  if(url.pathname==='/api/chat'&&req.method==='POST'){
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>32768)return json(res,413,{error:'Fixture request too large'});chunks.push(chunk);}const body=JSON.parse(Buffer.concat(chunks).toString());
   const earlier=posts.find(p=>p.id===body.id);if(earlier)assert.deepEqual(body,earlier);posts.push(body);if(failBeforeNext){failBeforeNext=false;failChat=true;return json(res,503,{error:'Fixture request not received'});}const saved=chat.turns.find(t=>t.id===body.id);
   if(saved)return json(res,200,chat);
   assert.equal(body.revision,chat.state.revision);chat.state.revision++;
   chat.turns.push({id:body.id,user_text:body.content,assistant_text:firstPost?'':'I can help with that next change.',status:firstPost?'pending':'completed',mode:'ai'});
   if(firstPost){firstPost=false;failChat=true;return json(res,503,{error:'Fixture response lost after acceptance'});}
   return json(res,200,chat);
  }
  return json(res,405,{error:'Fixture mutation not supported'});
 }
 if(req.method!=='GET'){res.writeHead(405).end();return;}
 const name=url.pathname==='/'||url.pathname.startsWith('/workspace')?'index.html':decodeURIComponent(url.pathname).slice(1),file=resolve(root,name);
 if(!file.startsWith(root+sep)){res.writeHead(404).end();return;}
 const bytes=await readFile(file),ext=file.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',webp:'image/webp',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store'}).end(bytes);
 }catch(error){if(error.code==='ENOENT'){res.writeHead(404).end();return;}console.error('Fixture failed:',error.message);json(res,500,{error:'Fixture failed'});}
});
const input=createInterface({input:process.stdin});input.on('line',line=>{if(line.trim()==='finish')finish();});
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(8174,'127.0.0.1',resolve);});
 console.log('Workspace UI fixture ready at '+origin+'/workspace and controls at /_fixture. Type finish after inspection.');
 await finished;
 assert.ok(posts.length>=3,'Exercise lost delivery, explicit retry and a subsequent message');if(reloadMode){assert.deepEqual(posts[1],posts[2]);assert.notEqual(posts[0].id,posts[1].id);}else{assert.deepEqual(posts[0],posts[1]);assert.notEqual(posts[2].id,posts[0].id);}assert.equal(chat.turns.length,3);
 await mkdir('.secrets',{recursive:true});await writeFile(reloadMode?'.secrets/chat-reload-browser.json':'.secrets/workspace-recovery-browser.json',JSON.stringify({checkedAt:new Date().toISOString(),scope:'Synthetic loopback API fixture; no provider or customer actions',reloadMode,posts,reads,turns:chat.turns},null,2),{mode:0o600});
 console.log('Fixture assertions passed: exact same-ID/payload retry, subsequent distinct message, three saved turns including history.');
}finally{input.close();await new Promise(resolve=>server.close(resolve));}

// Local-only, disposable visitor deletion UI fixture. Launch through fixtureEnvironment.
// It holds synthetic credentials server-side; the browser chooses A/B/C by label.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {deletionFixture} from '../tests/visitor-deletion-fixture.mjs';
if(process.env.WHUMPO_FIXTURE!=='1')throw Error('Use tools/verify.mjs fixtureEnvironment; never load operator credentials.');
const f=await deletionFixture(),app=await f.app(),actors={};
for(const name of ['A','B','C'])actors[name]=await f.visitor(app,'Synthetic account '+name);
let mode='pass';const requests=[];
async function state(){return {mode,requests,accounts:Object.fromEntries(await Promise.all(Object.entries(actors).map(async([name,v])=>[name,!!await f.db.prepare('SELECT id FROM app_visitors WHERE id=?').bind(v.who).first()])))};}
const server=createServer(async(req,res)=>{
 try{
  if(req.headers.host!==address)throw Error('Fixture host mismatch');
  const url=new URL(req.url,'http://'+address),cookie=req.headers.cookie??'',name=cookie.match(/(?:^|; )whumpo_a3_fixture=([ABC])(?:;|$)/)?.[1]??'A';
  res.setHeader('cache-control','no-store');
  if(url.pathname==='/fixture'){
   if(req.method==='POST'){
    if(req.headers.origin!=='http://'+address)throw Error('Fixture origin mismatch');
    const buffers=[];for await(const chunk of req){buffers.push(chunk);if(Buffer.concat(buffers).length>1024)throw Error('Large fixture body');}
    const form=new URLSearchParams(Buffer.concat(buffers).toString());
    if(form.has('actor')){if(!actors[form.get('actor')])throw Error('Unknown actor');res.setHeader('set-cookie','whumpo_a3_fixture='+form.get('actor')+'; Path=/; HttpOnly; SameSite=Strict');}
    if(form.has('mode')){if(!['pass','drop-before','drop-after'].includes(form.get('mode')))throw Error('Unknown mode');mode=form.get('mode');}
    res.writeHead(303,{location:'/fixture'});res.end();return;
   }
   res.setHeader('content-type','text/html');res.end('<!doctype html><title>Disposable deletion controls</title><h1>Synthetic deletion fixture</h1><p>Current browser account: '+name+'</p><form method="post">'+['A','B','C'].map(n=>'<button name="actor" value="'+n+'">Switch to '+n+'</button>').join(' ')+'</form><form method="post">'+['pass','drop-before','drop-after'].map(n=>'<button name="mode" value="'+n+'">'+n+'</button>').join(' ')+'</form><a href="/">Open visitor page</a><pre>'+JSON.stringify(await state(),null,2)+'</pre>');return;
  }
  if(url.pathname==='/fixture/state'){res.setHeader('content-type','application/json');res.end(JSON.stringify(await state()));return;}
  if(['/','/visitor.js','/visitor.css'].includes(url.pathname)){
   const file=url.pathname==='/'?'index.html':url.pathname.slice(1);res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile('public-app/'+file));return;
  }
  if(req.method==='POST'&&req.headers.origin!=='http://'+address)throw Error('Fixture origin mismatch');
  const buffers=[];for await(const chunk of req){buffers.push(chunk);if(Buffer.concat(buffers).length>16384)throw Error('Large fixture body');}
  const text=Buffer.concat(buffers).toString(),body=req.method==='POST'?JSON.parse(text):undefined;
  const row={actor:name,method:req.method,path:url.pathname};requests.push(row);
  if(url.pathname==='/account/delete'&&mode==='drop-before'){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'Synthetic response loss before dispatch'}));row.result='not dispatched';return;}
  const response=await f.call(app,actors[name],url.pathname.slice(1),body);row.result=response.status;
  if(url.pathname==='/account/delete'&&mode==='drop-after'&&response.ok){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'Synthetic response loss after commit'}));return;}
  res.writeHead(response.status,{'content-type':response.headers.get('content-type')});res.end(await response.text());
 }catch{res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'Local fixture unavailable'}));}
});
let address;await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));address='127.0.0.1:'+server.address().port;
console.log('Disposable visitor fixture: http://'+address+'/fixture');
async function close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await f.close();process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);

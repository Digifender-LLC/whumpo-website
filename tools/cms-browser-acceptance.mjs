// Opt-in loopback browser acceptance over disposable control and native CMS state.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createInterface} from 'node:readline';
export async function cmsBrowserAcceptance({platform,env,session,project,source,db,readDraft}){
 const origin='http://localhost:8167',root=resolve('dist'),requests=[];
 const server=createServer(async(req,res)=>{try{
  if(req.headers.host!=='localhost:8167'){res.writeHead(403).end();return;}
  const url=new URL(req.url,origin);
  if(url.pathname==='/_acceptance/start'&&req.method==='GET'){res.writeHead(302,{'set-cookie':`__Host-whumpo_session=${session}; Secure; HttpOnly; SameSite=Lax; Path=/`,'location':'/workspace/cms?project='+project,'cache-control':'no-store'}).end();return;}
  if(url.pathname.startsWith('/api/')){
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1048576){res.writeHead(413).end();return;}chunks.push(chunk);}
   const response=await platform.fetch(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),env,{waitUntil(){throw Error('No background inference expected');}});
   requests.push({path:url.pathname,method:req.method,status:response.status});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  const name=url.pathname==='/'||url.pathname.startsWith('/workspace')?'index.html':decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);
  if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  const bytes=await readFile(path),ext=path.split('.').at(-1),type={html:'text/html; charset=utf-8',js:'text/javascript',css:'text/css',svg:'image/svg+xml',woff2:'font/woff2',png:'image/png'}[ext]??'application/octet-stream';res.writeHead(200,{'content-type':type,'cache-control':'no-store'}).end(bytes);
 }catch(error){res.writeHead(500,{'content-type':'application/json'}).end(JSON.stringify({error:'Local acceptance request failed'}));console.error('Browser acceptance request failed:',error.message);}});
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(8167,'127.0.0.1',done);});
 const input=createInterface({input:process.stdin});
 try{
  console.log('Connected disposable CMS browser ready: '+origin+'/_acceptance/start');console.log('Import the article in browser-import.xml, then type finish in this terminal.');
  await new Promise(resolve=>input.on('line',line=>{if(line.trim()==='finish')resolve();}));
  const reviews=(await db.prepare('SELECT * FROM cms_import_reviews WHERE source_upload_id=?').bind(source).all()).results;assert.equal(reviews.length,1);assert.equal(reviews[0].status,'imported');
  const draft=await readDraft(reviews[0].id);assert.equal(draft.item.status,'draft');assert.equal(draft.item.version,2);assert.deepEqual(draft.item.data,JSON.parse(reviews[0].body).data);
  assert.equal((await db.prepare('SELECT count(*) n FROM cms_publication_reviews WHERE draft_request_id=?').bind(reviews[0].id).first()).n,0);
  assert.equal((await db.prepare('SELECT count(*) n FROM cms_draft_requests WHERE id=?').bind(reviews[0].id).first()).n,1);
  const evidence={project,source,review:reviews[0].id,item:draft.item.id,status:'private draft',version:draft.item.version,requests};await writeFile('.secrets/connected-cms-browser-evidence.json',JSON.stringify(evidence,null,2));
  console.log('Connected browser acceptance passed: one source-bound import, exact native content/image/excerpt, taxonomy version 2, one private draft and no publication.');
 }finally{input.close();await new Promise(done=>server.close(done));}
}

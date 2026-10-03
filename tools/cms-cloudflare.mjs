// Fixed-account control-plane client. Never print credentials or raw provider errors.
import {execFileSync} from 'node:child_process';
export function cloudflareCredentials(credentials){
 if(!credentials){try{credentials=JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','auth','token','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}catch{throw Error('Wrangler credentials could not be loaded');}}
 if(!['oauth','api_token'].includes(credentials.type)||typeof credentials.token!=='string')throw Error('A Wrangler OAuth or API token is required');
 return credentials;
}
export function cloudflareClient(accountId,transport=fetch,credentials,loadCredentials=cloudflareCredentials){
 if(!/^[0-9a-f]{32}$/.test(accountId))throw Error('Invalid Cloudflare account');
 const ambient=credentials===undefined;
 credentials=loadCredentials(credentials);
 return async function api(path,body){
  if(!path.startsWith('/')||path.includes('..'))throw Error('Invalid Cloudflare API path');
  let response,data;
  for(let attempt=0;attempt<2;attempt++){
   try{response=await transport('https://api.cloudflare.com/client/v4/accounts/'+accountId+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+credentials.token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000),redirect:'error'});data=await response.json();}catch{throw Error('Cloudflare request outcome is unavailable');}
   // Wrangler can rotate its ambient OAuth token during a deployment. Only a
   // confirmed authorization refusal with a changed local token is retried.
   // Never retry timeouts, malformed responses, other errors or explicit keys.
   if(attempt===0&&response.status===403&&data.success===false&&ambient&&credentials.type==='oauth'){
    const fresh=loadCredentials();
    if(fresh.type==='oauth'&&fresh.token!==credentials.token){credentials=fresh;continue;}
   }
   break;
  }
  if(!response.ok||data.success!==true){const error=Error('Cloudflare request was not confirmed (HTTP '+response.status+')');error.status=response.status;throw error;}return data;
 };
}
export function cmsCloudflareProvider(accountId,api){
 const paths={database:'/d1/database',media:'/r2/buckets',session:'/storage/kv/namespaces'};
 return {accountId,async find(kind,name){
  if(!paths[kind])throw Error('Unsupported CMS resource');
  const matches=[];let cursor='';
  for(let page=1;page<=20;page++){
   const query=kind==='media'?new URLSearchParams({per_page:'100',...(cursor?{cursor}:{})}):new URLSearchParams({per_page:'100',page:String(page)});
   const response=await api(paths[kind]+'?'+query),rows=kind==='media'?response.result?.buckets:response.result;
   if(!Array.isArray(rows))throw Error('Invalid resource inventory');
   for(const row of rows)if((kind==='session'?row.title:row.name)===name)matches.push(kind==='database'?row.uuid:kind==='session'?row.id:row.name);
   if(kind==='media'){const next=response.result_info?.cursor;if(next&&next===cursor)throw Error('Resource inventory cursor did not advance');cursor=next??'';if(cursor)continue;}
   else if(rows.length>=100)continue;
   if(matches.length>1)throw Error('Ambiguous CMS resource identity');return matches[0]??null;
  }
  throw Error('Resource inventory exceeds the reconciliation bound');
 },async create(kind,name){if(!paths[kind])throw Error('Unsupported CMS resource');await api(paths[kind],kind==='session'?{title:name}:{name});}};
}
/** Current D1 REST statements and atomic batch request. Bound statements are
 * immutable capabilities belonging to this exact adapter; no SQL/parameter
 * interpolation, sequential batch emulation or mutation retry. */
export function remoteD1(api,databaseId){
 if(!/^[0-9a-f-]{36}$/.test(databaseId))throw Error('Invalid control database');
 const statements=new WeakMap(),denied=()=>Error('Control database query failed');
 const query=async(body,count)=>{
  const response=await api('/d1/database/'+databaseId+'/query',body),results=response.result;
  if(!Array.isArray(results)||results.length!==count||results.some(r=>r?.success!==true||!Array.isArray(r.results)))throw denied();
  return results;
 };
 const prepared=(sql,params)=>{
  const input={sql,params:structuredClone(params)};
  const statement=Object.freeze({
   bind:(...values)=>prepared(sql,values),
   run:async()=>(await query(structuredClone(input),1))[0],
   all:async()=>(await query(structuredClone(input),1))[0],
   first:async column=>{const row=(await query(structuredClone(input),1))[0].results[0]??null;return row&&column!==undefined?row[column]:row;},
  });
  statements.set(statement,input);return statement;
 };
 return Object.freeze({
  prepare:sql=>{if(typeof sql!=='string'||!sql.trim())throw denied();return prepared(sql,[]);},
  batch:async items=>{
   if(!Array.isArray(items)||!items.length||items.some(item=>!statements.has(item)))throw denied();
   const batch=items.map(item=>structuredClone(statements.get(item)));
   return query({batch},batch.length);
  },
 });
}

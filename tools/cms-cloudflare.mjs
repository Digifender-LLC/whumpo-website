// Fixed-account control-plane client. Never print credentials or raw provider errors.
import {execFileSync} from 'node:child_process';
export function cloudflareClient(accountId,transport=fetch,credentials){
 if(!/^[0-9a-f]{32}$/.test(accountId))throw Error('Invalid Cloudflare account');
 if(!credentials){try{credentials=JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','auth','token','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}catch{throw Error('Wrangler credentials could not be loaded');}}
 if(!['oauth','api_token'].includes(credentials.type)||typeof credentials.token!=='string')throw Error('A Wrangler OAuth or API token is required');
 return async function api(path,body){
  if(!path.startsWith('/')||path.includes('..'))throw Error('Invalid Cloudflare API path');
  let response,data;
  try{response=await transport('https://api.cloudflare.com/client/v4/accounts/'+accountId+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+credentials.token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000),redirect:'error'});data=await response.json();}catch{throw Error('Cloudflare request outcome is unavailable');}
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
export function remoteD1(api,databaseId){
 if(!/^[0-9a-f-]{36}$/.test(databaseId))throw Error('Invalid control database');
 return {prepare(sql){let params=[];const statement={bind(...values){params=values;return statement;},async run(){const response=await api('/d1/database/'+databaseId+'/query',{sql,params}),result=response.result?.[0];if(result?.success!==true)throw Error('Control database query failed');return result;},async first(){return (await statement.run()).results?.[0]??null;},async all(){return statement.run();}};return statement;}};
}

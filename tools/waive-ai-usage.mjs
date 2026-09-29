import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {build} from 'esbuild';
const usage=`Operator-only waiver of unresolved AI usage. Never calls the model or changes saved artifacts.
List:    node tools/waive-ai-usage.mjs list --remote
Inspect: node tools/waive-ai-usage.mjs inspect OPERATION_ID --remote
Apply:   node tools/waive-ai-usage.mjs apply REVIEW_FILE --confirm DIGEST --operator NAME --reason "Why TellUmo is absorbing this unresolved cost" --remote
Only unknown usage unchanged for ten minutes is eligible. Saved token receipts and settled charges are excluded.
Read the review first. A waiver does not establish provider usage or authorize a retry.
Database access uses the existing local Wrangler login. Keep personal data and credentials out of the reason.`;
const args=process.argv.slice(2),command=args[0];
if(args.includes('--help')||!command){console.log(usage);process.exit(0);}
function option(name){const i=args.indexOf(name);return i<0?undefined:args[i+1];}
try{
 if(!args.includes('--remote')||!['list','inspect','apply'].includes(command))throw Error(usage);
 const wrangler=await readFile(resolve(homedir(),'.config/.wrangler/config/default.toml'),'utf8'),oauth=wrangler.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];if(!oauth)throw Error('An authenticated local Wrangler login is required.');
 const db={prepare(sql){let params=[];const statement={bind(...values){params=values;return statement;},async first(){
  const response=await fetch('https://api.cloudflare.com/client/v4/accounts/f94d28e88a63fb6f34c3ecbc05aa3faf/d1/database/680f98b9-a769-467f-8b6f-06c10195c263/query',{method:'POST',headers:{authorization:'Bearer '+oauth,'content-type':'application/json'},body:JSON.stringify({sql,params}),redirect:'manual',signal:AbortSignal.timeout(30000)});
  if(!response.ok){await response.body?.cancel();throw Error('Database request failed.');}const data=await response.json();if(data.success!==true||data.result?.[0]?.success!==true)throw Error('Database statement failed. Inspect current state before retrying.');return data.result[0].results?.[0]??null;
 }};return statement;}};
 const compiled=await build({entryPoints:['src/usage-recovery.ts'],bundle:true,format:'esm',platform:'node',write:false});const {inspectWaiver,applyWaiver,listWaiverCandidates}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
 if(command==='list'){console.log(JSON.stringify({candidates:await listWaiverCandidates(db),limit:100},null,2));}
 else if(command==='inspect'){
  const review=await inspectWaiver(db,args[1]);await mkdir('.secrets',{recursive:true,mode:0o700});const file=resolve('.secrets/usage-waiver-'+review.id+'.json');await writeFile(file,JSON.stringify(review,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({reviewFile:file,operationId:review.operation.id,userId:review.operation.user_id,period:review.operation.period,quotaHold:review.operation.quota_reserved,creditHold:review.operation.credits_reserved,providerUsage:'unknown',action:review.action,expiresAt:review.expiresAt,digest:review.digest},null,2));
 }else{
  const review=JSON.parse(await readFile(args[1],'utf8'));const result=await applyWaiver(db,review,option('--confirm'),option('--operator'),option('--reason'));
  console.log(JSON.stringify({...result,message:'Customer hold waived with an atomic audit receipt. Provider usage remains unknown. No model request was sent; saved work remains unchanged.'}));
 }
}catch(error){console.error(error?.code==='ENOENT'?'Review file or Wrangler configuration is missing. See --help.':error?.message===usage?usage:typeof error?.status==='number'&&error.message.length<1500?error.message:'Waiver could not be confirmed. Inspect current state before retrying.');process.exitCode=1;}

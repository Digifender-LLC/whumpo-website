import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {build} from 'esbuild';
const usage=`Operator-only hostname recovery. No Cloudflare resource is created or deleted.
Inspect: node tools/reconcile-domain-hosting.mjs inspect CONNECTION_ID PROVIDER_ID resume|cleanup --remote
Apply:   node tools/reconcile-domain-hosting.mjs apply REVIEW_FILE --confirm DIGEST --operator NAME --evidence "Audit reference and reason this resource belongs to this request" --remote
Read the review first. A hostname/time match alone does not establish resource ownership.
Provider key: .secrets/cloudflare-domains.key. Database access: existing local Wrangler login.
Never put credentials or personal data in the evidence note.`;
const args=process.argv.slice(2),command=args[0];
if(args.includes('--help')||!command){console.log(usage);process.exit(0);}
function option(name){const i=args.indexOf(name);return i<0?undefined:args[i+1];}
try{
 if(!args.includes('--remote')||!['inspect','apply'].includes(command))throw Error(usage);
 const providerToken=(await readFile('.secrets/cloudflare-domains.key','utf8')).trim();if(!providerToken)throw Error('The zone-scoped domain key file is empty.');
 const wrangler=await readFile(resolve(homedir(),'.config/.wrangler/config/default.toml'),'utf8'),oauth=wrangler.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];if(!oauth)throw Error('An authenticated local Wrangler login is required.');
 // The control database comes from wrangler.jsonc like every other remote operator tool (WH-004 B4); never pin an ID here.
 const bound=JSON.parse(await readFile('wrangler.jsonc','utf8')),account=bound.account_id,database=bound.d1_databases?.find(d=>d.binding==='DB')?.database_id;
 if(!/^[0-9a-f]{32}$/.test(account??'')||!/^[0-9a-f-]{36}$/.test(database??''))throw Error('wrangler.jsonc must bind the control database as DB with an account id.');
 const config={token:providerToken,zone:'8d46ee4e394514402479acf16579f7b5',target:'hosting.whumpo.site'};
 const db={prepare(sql){let params=[];const statement={bind(...values){params=values;return statement;},async first(){
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,{method:'POST',headers:{authorization:'Bearer '+oauth,'content-type':'application/json'},body:JSON.stringify({sql,params}),redirect:'manual',signal:AbortSignal.timeout(30000)});
  if(!response.ok){await response.body?.cancel();throw Error('Database request failed.');}const data=await response.json();if(data.success!==true||data.result?.[0]?.success!==true)throw Error('Database statement failed. Inspect current state before retrying.');return data.result[0].results?.[0]??null;
 }};return statement;}};
 const compiled=await build({entryPoints:['src/domain-recovery.ts'],bundle:true,format:'esm',platform:'node',write:false});const {inspectRecovery,applyRecovery}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
 if(command==='inspect'){
  if(!['resume','cleanup'].includes(args[3]))throw Error(usage);
  const review=await inspectRecovery(db,args[1],args[2],args[3],config);
  await mkdir('.secrets',{recursive:true,mode:0o700});const file=resolve('.secrets/hosting-recovery-'+review.id+'.json');await writeFile(file,JSON.stringify(review,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({reviewFile:file,connectionId:review.connection.id,hostname:review.connection.hostname,providerId:review.resource.id,providerCreatedAt:review.resource.createdAt,action:review.action,currentState:review.connection.state,expiresAt:review.expiresAt,digest:review.digest},null,2));
 }else{
  const review=JSON.parse(await readFile(args[1],'utf8'));const result=await applyRecovery(db,review,option('--confirm'),option('--operator'),option('--evidence'),config);
  console.log(JSON.stringify({...result,routingEnabled:false,message:'Provider ID attached with an atomic audit receipt. Normal verification or cleanup must still run.'}));
 }
}catch(error){console.error(error?.code==='ENOENT'?'Required key, review file or Wrangler configuration is missing. See --help.':error?.message===usage?usage:typeof error?.status==='number'&&error.message.length<1500?error.message:'Recovery could not be confirmed. Inspect current state before retrying.');process.exitCode=1;}

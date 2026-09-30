import {readFile} from 'node:fs/promises';
import {spawnSync,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';
import {connectionReadiness} from './report-connections.mjs';

export function githubAppSecrets(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='appId,clientId,clientSecret,slug')throw Error('Use the documented GitHub App credential fields.');
 if(!/^[1-9][0-9]{0,15}$/.test(String(value.appId))||!Number.isSafeInteger(Number(value.appId))||typeof value.slug!=='string'||!/^[a-z0-9-]{1,100}$/.test(value.slug)||typeof value.clientId!=='string'||!/^[A-Za-z0-9_.-]{1,100}$/.test(value.clientId)||typeof value.clientSecret!=='string'||!/^[\x21-\x7e]{1,4096}$/.test(value.clientSecret))throw Error('GitHub App credential format is invalid.');
 return {GITHUB_APP_ID:String(value.appId),GITHUB_APP_SLUG:value.slug,GITHUB_CLIENT_ID:value.clientId,GITHUB_CLIENT_SECRET:value.clientSecret};
}
export function verifyGitHubApp(app,secrets){
 if(!app||app.id!==Number(secrets.GITHUB_APP_ID)||app.slug!==secrets.GITHUB_APP_SLUG||app.external_url!=='https://whumpo.com'||app.client_id!==undefined&&app.client_id!==secrets.GITHUB_CLIENT_ID)throw Error('Registered GitHub App identity does not match.');
 const p=app.permissions;
 if(!p||p.contents!=='write'||p.metadata!=='read'||Object.keys(p).some(k=>!['contents','metadata'].includes(k))||!Array.isArray(app.events)||app.events.length)throw Error('GitHub App must have only Contents write, Metadata read and no webhook events.');
}
export function requireFreshGitHubSetup(report){
 const g=report.providers.github;
 if(g.retainedCredentials!==0||g.pendingRevocations!==0||g.missing.includes('CONNECTION_ENCRYPTION_KEY')||g.missing.length!==4)throw Error('Existing GitHub or vault configuration requires reconciliation; no secrets changed.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let db,lock,locked=false;
 try{
  const args=process.argv.slice(2);if(args.length&&!(args.length===1&&args[0]==='--apply'))throw Error('Use no arguments for inspection or --apply to install.');
  const bytes=await readFile('.secrets/github-app.json');if(bytes.length>8192)throw Error('Credential file exceeds its bound.');
  const secrets=githubAppSecrets(JSON.parse(bytes.toString('utf8')));
  // The operator login reads app metadata only. It is never installed or used for customer work.
  const app=JSON.parse(execFileSync('gh',['api','/apps/'+secrets.GITHUB_APP_SLUG],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:131072}));verifyGitHubApp(app,secrets);
  const c=JSON.parse(await readFile('wrangler.jsonc','utf8'));
  if(c.name!=='whumpo-platform')throw Error('Expected the Whumpo platform Worker.');
  const credentials=process.env.CLOUDFLARE_API_TOKEN?{type:'api_token',token:process.env.CLOUDFLARE_API_TOKEN}:undefined;
  const api=cloudflareClient(c.account_id,fetch,credentials);db=remoteD1(api,c.d1_databases.find(b=>b.binding==='DB').database_id);
  requireFreshGitHubSetup(await connectionReadiness(api,db,c.name));
  if(!args.length){console.log('GitHub App identity and permission metadata verified. First-time configuration can install four app secrets while preserving the existing vault key. Verify the exact Whumpo callback and expiring user tokens in GitHub before running with --apply. No settings changed.');}
  else{
   lock=crypto.randomUUID();await db.prepare("UPDATE cms_platform_deploy_lock SET token=?,expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+15 minutes') WHERE id=1 AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(lock).run();
   if((await db.prepare('SELECT token FROM cms_platform_deploy_lock WHERE id=1').first())?.token!==lock)throw Error('Another deployment is active.');locked=true;
   requireFreshGitHubSetup(await connectionReadiness(api,db,c.name));
   const before=(await api('/workers/scripts/'+c.name+'/secrets')).result.map(v=>v.name);
   const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','bulk','--name',c.name],{input:JSON.stringify(secrets),encoding:'utf8',env:process.env,stdio:['pipe','pipe','pipe']});
   if(result.status!==0)throw Error('Secret installation needs reconciliation.');
   const after=(await api('/workers/scripts/'+c.name+'/secrets')).result.map(v=>v.name);
   if([...before,...Object.keys(secrets)].some(name=>!after.includes(name)))throw Error('Secret-name readback is incomplete.');
   console.log('GitHub App secrets installed; existing secret names preserved. Real customer consent, selected-repository backup and disconnect still require acceptance.');
  }
 }catch{
  // Errors from JSON parsing, gh or Wrangler may contain private input. Never reflect them.
  console.error('GitHub setup did not complete. Check the private credential file, app identity/permissions, operator access and existing configuration with report:connections. No credentials were printed. Reconcile any attempted installation before retrying.');process.exitCode=1;
 }finally{if(locked)try{await db.prepare("UPDATE cms_platform_deploy_lock SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1 AND token=?").bind(lock).run();}catch{console.error('Deployment lock release needs inspection.');process.exitCode=1;}}
}

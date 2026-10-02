import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';

const required={
 github:['GITHUB_APP_ID','GITHUB_APP_SLUG','GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET','CONNECTION_ENCRYPTION_KEY'],
 cloudflare:['CLOUDFLARE_CLIENT_ID','CLOUDFLARE_CLIENT_SECRET','CONNECTION_ENCRYPTION_KEY'],
};

// Presence is deliberately not credential validation or proof of provider consent.
// Only aggregate counts leave D1; no identities, token values or ciphertext are read.
export async function connectionReadiness(api,db,worker){
 if(!/^[a-z0-9-]{1,63}$/.test(worker))throw Error('Invalid Worker name');
 const inventory=await api(`/workers/scripts/${worker}/secrets`);
 if(!Array.isArray(inventory.result)||inventory.result.some(s=>typeof s?.name!=='string'))throw Error('Secret inventory unavailable');
 const names=new Set(inventory.result.map(s=>s.name));
 const providers={};
 for(const provider of ['github','cloudflare']){
  const row=await db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN state='revoking' THEN 1 ELSE 0 END),0) AS revoking FROM ${provider}_token_vault`).first();
  if(!row||![row.total,row.revoking].every(n=>Number.isSafeInteger(n)&&n>=0)||row.revoking>row.total)throw Error('Vault inventory unavailable');
  const missing=required[provider].filter(name=>!names.has(name));
  providers[provider]={bindingPresence:missing.length?'incomplete':'present_unvalidated',missing,
   callback:`https://whumpo.com/api/connections/${provider}/callback`,
   retainedCredentials:row.total,pendingRevocations:row.revoking,
   recoveryRequired:row.total>0&&!names.has('CONNECTION_ENCRYPTION_KEY'),
   nextStep:missing.length?'Complete operator setup before offering customer consent.':'Verify registered callback, permissions, real consent and disconnect; names alone do not validate credentials.'};
 }
 return {observedAt:new Date().toISOString(),worker,scope:'Secret names and aggregate vault counts only; no provider consent or writes.',providers,
  vaultGuidance:'Preserve an existing encryption key. If encrypted rows exist without it, recover the original key; never generate a replacement as a repair.'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==2)throw Error('Unexpected arguments');
  const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
  const credentials=process.env.CLOUDFLARE_API_TOKEN?{type:'api_token',token:process.env.CLOUDFLARE_API_TOKEN}:undefined;
  const api=cloudflareClient(config.account_id,fetch,credentials);
  const db=remoteD1(api,config.d1_databases.find(b=>b.binding==='DB').database_id);
  const report=await connectionReadiness(api,db,config.name);
  console.log(JSON.stringify(report,null,2));
  if(Object.values(report.providers).some(p=>p.missing.length||p.recoveryRequired))process.exitCode=2;
 }catch{console.error('Connection readiness could not be verified. Check operator authorization, Worker configuration and the current schema. No settings were changed.');process.exitCode=1;}
}

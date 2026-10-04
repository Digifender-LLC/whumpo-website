import {readFile,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// Required custody, not a record that backups or provider access exist. Names and
// references only: this tool never opens local credential files or Worker values.
export const secretCustody=Object.freeze([
 {name:'CONNECTION_ENCRYPTION_KEYRING',classes:['connections'],readers:['src/github-connection.ts','src/cloudflare-connection.ts'],recovery:'retain-exact-key-versions',dependency:'Every live credential, unresolved exchange and permitted restore source; account recovery cannot reconstruct these keys.'},
 {name:'GITHUB_CLIENT_SECRET',classes:['connections','github-backups'],readers:['src/github-connection.ts'],recovery:'provider-reissue',dependency:'Reconcile issued grants, staged/revoking tokens and uncertain exchanges before replacing OAuth configuration.'},
 {name:'CLOUDFLARE_CLIENT_SECRET',classes:['connections','domains-dns'],readers:['src/cloudflare-connection.ts'],recovery:'provider-reissue',dependency:'Reconcile issued grants, retained revocation authority and uncertain exchanges before replacing OAuth configuration.'},
 {name:'CLOUDFLARE_DOMAINS_TOKEN',classes:['domains-dns'],readers:['src/domain-hosting.ts'],recovery:'provider-reissue',dependency:'Revalidate scoped zone authority and saved provider outcomes before domain operations resume.'},
 {name:'TURNSTILE_SECRET',classes:['owner-identity','contacts','abuse-reports'],readers:['src/workspace-identity/ceremonies.ts','src/contact-page.ts','src/abuse-report-page.ts','src/app-gateway.ts'],recovery:'provider-reissue',dependency:'Installed on whumpo-platform (signup, contact forms, WH-016 public abuse reports) and whumpo-apps (public module forms through app-gateway; both pass it to the shared src/turnstile.ts verifier). Paired site key and provider configuration; no restored challenge/session bypass.'},
 {name:'AI_API_KEY',classes:['standard-ai'],readers:['src/ai-chat.ts'],recovery:'provider-reissue',dependency:'Approved non-sensitive testing route and existing request/outcome receipts; no automatic replay.'},
 {name:'STRIPE_TEST_KEY',classes:['billing'],readers:['src/stripe-billing.ts','src/stripe-common.ts'],recovery:'provider-reissue',dependency:'The same sandbox account and reconciled invoice/subscription/idempotency state; no real billing.'},
 {name:'STRIPE_WEBHOOK_SECRET',classes:['billing'],readers:['src/stripe-common.ts'],recovery:'provider-reissue',dependency:'The configured sandbox endpoint and authenticated event reconciliation; no unsigned webhook admission.'},
 {name:'CMS_BRIDGE_MASTER_KEY',classes:['cms-resources'],readers:['src/cms-status.ts','tools/deploy-platform.mjs'],recovery:'retain-exact-key-versions',dependency:'Registered instance derivation digests and separately protected master material. CMS functional acceptance remains deferred.'},
].map(entry=>Object.freeze({...entry,backupResponsibility:'platform-operator',backupBoundary:'separately-protected-from-data-and-release-archives'})));

export const publicVariableNames=Object.freeze(['ENVIRONMENT','TURNSTILE_SITE_KEY','AI_BASE_URL','AI_MODEL','AI_PROTOCOL','CLOUDFLARE_CLIENT_ID','DOMAIN_HOSTING_READY','GITHUB_CLIENT_ID','GITHUB_APP_ID','GITHUB_APP_SLUG','STRIPE_SANDBOX_CATALOG','SUPPORT_HOURS','SUPPORT_NOTIFICATION_PROVIDER','SUPPORT_NOTIFICATION_REVIEW','CONTACT_NOTIFICATION_PROVIDER','CONTACT_NOTIFICATION_REVIEW']);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const denied=()=>Error('Secret custody inventory does not match current source; review metadata locally.');

/** Source files under src/ that read a secret from an environment object (`env.NAME`, `env['NAME']`). Type-only
 * mentions such as `Pick<Env,'NAME'>` pass a binding through and are not reads. */
async function sourceReaders(directory,names){
 const found=new Map(names.map(n=>[n,new Set()]));
 for(const entry of await readdir(resolve(directory,'src'),{recursive:true,withFileTypes:true})){
  if(!entry.isFile()||!entry.name.endsWith('.ts')||entry.name.endsWith('.d.ts'))continue;
  const path=resolve(entry.parentPath,entry.name),text=await readFile(path,'utf8'),relative=path.slice(resolve(directory).length+1).split('\\').join('/');
  for(const name of names)if(new RegExp(`\\.${name}\\b|\\[\\s*['"\`]${name}['"\`]\\s*\\]`).test(text))found.get(name).add(relative);
 }
 return found;
}

export async function validateSecretCustody(directory=root){
 const names=secretCustody.map(x=>x.name),catalog=JSON.parse(await readFile(resolve(directory,'docs/data-lifecycle.json'),'utf8'));
 if(new Set(names).size!==names.length||names.some(n=>publicVariableNames.includes(n)))throw denied();
 const declarations=[...(await readFile(resolve(directory,'src/secrets.d.ts'),'utf8')).matchAll(/^\s+([A-Z][A-Z0-9_]+)\?: string;/gm)].map(m=>m[1]);
 if(declarations.some(n=>!names.includes(n)&&!publicVariableNames.includes(n))||names.some(n=>!declarations.includes(n)))throw denied();
 for(const entry of secretCustody){
  if(entry.classes.some(id=>!catalog.classes.some(c=>c.id===id&&c.storageStatus==='current')))throw denied();
  for(const path of entry.readers)if(!(await readFile(resolve(directory,path),'utf8')).includes(entry.name))throw denied();
 }
 // Every Worker source file that reads a secret must be a declared reader, so no runtime holder is missed.
 for(const [name,files] of await sourceReaders(directory,names))if([...files].some(f=>!secretCustody.find(e=>e.name===name).readers.includes(f)))throw denied();
 return {version:1,scope:'source-metadata-only',secrets:secretCustody,backupCustodyVerified:false,retirementAllowed:false};
}

/** Provider metadata is untrusted. Keep only names/types; never spread values. */
export function secretBindingReadback(bindings){
 if(!Array.isArray(bindings))throw denied();
 const seen=new Set(),installed=new Set();
 for(const binding of bindings){
  if(!binding||typeof binding.name!=='string'||seen.has(binding.name))throw denied();seen.add(binding.name);
  const known=secretCustody.some(s=>s.name===binding.name);
  if(known&&binding.type!=='secret_text')throw denied();
  if(binding.type==='secret_text'){
   if(!known&&!publicVariableNames.includes(binding.name))throw denied();
   if(known)installed.add(binding.name);
  }
 }
 return {scope:'binding-names-only',secrets:secretCustody.map(s=>({name:s.name,configured:installed.has(s.name)})),backupCustodyVerified:false,retirementAllowed:false};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==2)throw denied();console.log(JSON.stringify(await validateSecretCustody(),null,2));}
 catch{console.error('Secret custody inventory unavailable; no values were read or printed.');process.exitCode=1;}
}

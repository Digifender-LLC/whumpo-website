import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// WH-190 offline checks for docs/portable-migration-guides.md. Reads the frozen capability list from the WH-186
// reference (tools/prototypes/portable-export.mjs), parses the guide and the contract, and runs the guide's own
// verify-bundle.mjs script against a bundle built by the reference from invented data. No network, database,
// provider, credential or model. It proves document structure and the script, not any destination or provider.
// Every document check also runs against deliberately broken copies (mutants below); each must be caught by its
// named check. `--explain` prints the mutant-to-check mapping.
const root=fileURLToPath(new URL('..',import.meta.url));
const reference=await import(new URL('../tools/prototypes/portable-export.mjs',import.meta.url).href);
const {capabilities,capabilityCatalog}=reference;
const GUIDE='docs/portable-migration-guides.md',CONTRACT='docs/portable-exports.md';
const guideText=readFileSync(join(root,GUIDE),'utf8');
const contractText=readFileSync(join(root,CONTRACT),'utf8');

// Official hosts (and repository prefixes) a guide may cite. Anything else fails `external-links-allowlisted`.
const ALLOWED_PREFIXES=[
 'https://developers.cloudflare.com/','https://github.com/cloudflare/workerd','https://github.com/justjake/quickjs-emscripten',
 'https://docs.github.com/','https://www.w3.org/TR/','https://www.rfc-editor.org/rfc/','https://www.icann.org/',
 'https://nodejs.org/docs/','https://sqlite.org/','https://bellard.org/quickjs/','https://docs.python.org/3/',
];
const REQUIRED_SECTIONS=['Report status','In the bundle','Does not port','Replacement','Your steps','Secrets','Costs','Offline check'];
const STATUS_WORDS=['runnable','data-only','unavailable','not-used'];
const RETRIEVED='October 9, 2026';

const slug=h=>h.toLowerCase().replace(/[^a-z0-9 -]/g,'').trim().replace(/ /g,'-');
const anchorsOf=text=>new Set([...text.replace(/```[\s\S]*?```/g,'').matchAll(/^#{1,6} (.+)$/gm)].map(m=>slug(m[1])));
const stripCode=text=>text.replace(/```[\s\S]*?```/g,'');
const linksOf=text=>[...stripCode(text).matchAll(/\]\(([^)\s]+)\)|<(https?:\/\/[^>\s]+)>/g)].map(m=>m[1]??m[2]);
const sentencesOf=text=>stripCode(text).split('\n').flatMap(line=>line.replace(/`[^`]*`/g,m=>m.replace(/[.!?]/g,' ')).split(/(?<=[.!?;])\s+/));
const NEGATION=/\b(not|never|no|none|nothing|cannot|can't|isn't|aren't|doesn't|don't|won't|without|unavailable|only inside)\b/i;
const PRICE=/\$\d|\b(price|prices|pricing|priced|per month|monthly|minimum|free tier|free plan|at-cost|billed|fees?)\b/i;
const LABEL=/\brequir(?:es|e|ing) verification\b/i;

function parseGuide(text){
 const entries=new Map(),order=[];
 const parts=stripCode(text).split(/^## /m).slice(1);
 for(const part of parts){
  const heading=part.slice(0,part.indexOf('\n'));
  const m=/^(.+) \(([a-z-]+)\)$/.exec(heading.trim());
  if(!m)continue;
  const sections={};
  const body=part.slice(heading.length+1);
  const chunks=body.split(/^(?=- \*\*[^*]+:\*\*)/m);
  for(const chunk of chunks){
   const s=/^- \*\*([^*]+):\*\*\s*([\s\S]*)$/.exec(chunk);
   if(s)sections[s[1]]=s[2].trim();
  }
  order.push(m[2]);
  entries.set(m[2],{heading:heading.trim(),anchor:slug(heading.trim()),sections,count:(entries.get(m[2])?.count??0)+1});
 }
 return {entries,order};
}

// Each check returns a list of failure details; an empty list passes.
function documentChecks({guide,contract,exists=p=>existsSync(join(root,p)),read=p=>readFileSync(join(root,p),'utf8')}){
 const {entries,order}=parseGuide(guide);
 const failures=[];
 const fail=(check,detail)=>failures.push({check,detail});

 // dated-status: the guide is marked planned and dated.
 const head=guide.split('\n').slice(0,4).join('\n');
 if(!/\bPlanned\b/.test(head)||!head.includes(RETRIEVED))fail('dated-status','title block must say Planned and October 9, 2026');

 // entry-per-capability: exactly one entry per frozen capability, none extra.
 for(const c of capabilities)if(!entries.has(c))fail('entry-per-capability',`missing ${c}`);
 for(const c of order)if(!capabilities.includes(c))fail('entry-per-capability',`unknown ${c}`);
 for(const [c,e] of entries)if(e.count!==1)fail('entry-per-capability',`duplicate ${c}`);

 for(const [c,e] of entries){
  const entry=capabilityCatalog[c];
  if(!entry)continue;
  // required-sections
  for(const s of REQUIRED_SECTIONS)if(!e.sections[s]||e.sections[s].length<4)fail('required-sections',`${c}: ${s}`);
  const status=e.sections['Report status']??'';
  // status-matches-report: the status codes named equal the report's allowed set.
  const named=new Set([...status.matchAll(/`([a-z-]+)`/g)].map(m=>m[1]).filter(w=>STATUS_WORDS.includes(w)));
  const allowed=new Set(entry.allowed);
  if(named.size!==allowed.size||[...named].some(w=>!allowed.has(w)))fail('status-matches-report',`${c}: names ${[...named]} but the report allows ${entry.allowed}`);
  // cost-flag-matches
  const flag=/Report cost flag: `([a-z-]+)`/.exec(status)?.[1];
  if(flag!==entry.cost)fail('cost-flag-matches',`${c}: ${flag} vs ${entry.cost}`);
  // cost-labelled: provider costs are labelled; a `none` flag says None.
  const costs=e.sections.Costs??'';
  if(entry.cost==='customer-provider'&&!LABEL.test(costs))fail('cost-labelled',`${c}: provider costs not labelled requires verification`);
  if(entry.cost==='none'&&!/^None\b/.test(costs))fail('cost-labelled',`${c}: cost flag none but Costs does not start with None`);
  // replacement-matches-status: no replacement label beyond what the report allows.
  const replacement=e.sections.Replacement??'';
  const live=entry.allowed.filter(s=>s!=='not-used');
  const label=/^(Supported replacement|Migration path only|Unavailable)\b/.exec(replacement)?.[1];
  const expected=live.includes('runnable')?'Supported replacement':live.includes('data-only')?'Migration path only':'Unavailable';
  if(label!==expected)fail('replacement-matches-status',`${c}: "${label}" but status allows only "${expected}"`);
  // report-links-guide: the contract's migration section (the report's link target) links to this entry.
  const anchors=[...contract.matchAll(/^(#{2,4}) (.+)$/gm)];
  const idx=anchors.findIndex(m=>slug(m[2])===entry.migration);
  if(idx<0){fail('report-links-guide',`${c}: contract has no #${entry.migration}`);continue;}
  const start=anchors[idx].index,end=idx+1<anchors.length?anchors[idx+1].index:contract.length;
  if(!contract.slice(start,end).includes(`](portable-migration-guides.md#${e.anchor})`))fail('report-links-guide',`${c}: #${entry.migration} does not link to #${e.anchor}`);
 }

 // global-unavailability-statement
 if(!/No Whumpo API, route, credential or model is available outside Whumpo\./.test(guide))fail('global-unavailability-statement','missing the explicit statement');

 // Links: external https + allow-listed + listed in the dated source table; local files and anchors resolve.
 const sourcesStart=guide.indexOf('## Sources (retrieved October 9, 2026 UTC)');
 const sourcesEnd=sourcesStart<0?-1:guide.indexOf('\n## ',sourcesStart+5);
 const sources=sourcesStart<0?'':guide.slice(sourcesStart,sourcesEnd<0?guide.length:sourcesEnd);
 if(!sources)fail('sources-dated','no dated Sources section');
 const sourceLinks=new Set(linksOf(sources).map(u=>u.split('#')[0]));
 const guideAnchors=anchorsOf(guide);
 for(const link of linksOf(guide)){
  if(/^[a-z][a-z0-9+.-]*:/i.test(link)||link.startsWith('//')){
   if(!link.startsWith('https://'))fail('external-links-https',link);
   else if(!ALLOWED_PREFIXES.some(p=>link.startsWith(p)))fail('external-links-allowlisted',link);
   if(!sourceLinks.has(link.split('#')[0]))fail('sources-dated',`${link} is not in the dated source table`);
   continue;
  }
  const [path,fragment]=link.split('#');
  if(!path){if(!guideAnchors.has(fragment))fail('local-links-resolve',`#${fragment}`);continue;}
  const target=relative(root,resolve(join(root,dirname(GUIDE)),path)).split('\\').join('/');
  if(!exists(target)){fail('local-links-resolve',`${link} (missing ${target})`);continue;}
  if(fragment&&target.endsWith('.md')&&!anchorsOf(target===CONTRACT?contract:read(target)).has(fragment))fail('local-links-resolve',`${link} (no anchor)`);
 }

 // price-claims-labelled: every line with a price, plan or minimum claim is labelled.
 for(const line of stripCode(guide).split('\n'))if(PRICE.test(line.replace(/`[^`]*`/g,''))&&!LABEL.test(line))fail('price-claims-labelled',line.slice(0,120));

 // no-whumpo-api-after-export: no sentence claims a Whumpo API/route/service keeps working.
 const API=/\b(apis?|routes?|endpoints?|servers?|services?|backends?|modules?|senders?|runtimes?|gateways?|hosts?|origins?)\b/i;
 const WORKS=/\b(remains?|stays?|keeps?|continues?|still|works?|working|available|reachable|accessible|usable|callable)\b/i;
 for(const s of sentencesOf(guide))if(/\bwhumpo\b/i.test(s)&&API.test(s)&&WORKS.test(s)&&!NEGATION.test(s))fail('no-whumpo-api-after-export',s.slice(0,140));

 // no-secret-to-whumpo: no sentence asks the customer to hand a secret to Whumpo, support or Chat.
 const GIVE=/\b(send|share|paste|give|upload|enter|provide|email|forward|hand)\b/i;
 const SECRET=/\b(secrets?|passwords?|tokens?|keys?|auth(?:orization|info)? codes?|credentials?|passkeys?|recovery codes?)\b/i;
 const TO=/\b(whumpo|support|chat)\b/i;
 for(const s of sentencesOf(guide))if(GIVE.test(s)&&SECRET.test(s)&&TO.test(s)&&!NEGATION.test(s))fail('no-secret-to-whumpo',s.slice(0,140));

 return failures;
}

// ---------- Offline script against a reference-built bundle ----------
function scriptOf(guide){
 const m=/```js\n(\/\/ verify-bundle\.mjs[\s\S]*?)```/.exec(guide);
 return m?m[1]:null;
}
const hex=b=>createHash('sha256').update(b).digest('hex');
function referenceBundle(){
 const P='11111111-1111-4111-8111-111111111111';
 const spec={schemaVersion:3,name:'Harbor Bakery',pages:[{id:'home',path:'/',component:'photo-page@1',audience:'public'}]};
 const jpeg=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.from('synthetic-photo'),Buffer.from([0xff,0xd9])]);
 const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Harbor Bakery</title></head><body><h1>Harbor Bakery</h1><img src="/assets/ph-1.jpg" alt="Bread"></body></html>';
 const program='export default function(input){return {total:input.items.length};}\n';
 const store={projects:{[P]:{ownerId:'owner-a',name:'Harbor Bakery',specification:spec,specificationDigest:hex(reference.canonicalJSON(spec)),
  specificationVersionId:'44444444-4444-4444-8444-000000000001',compiler:{name:'project-content',version:1,digest:hex('project-content')},components:[],
  headers:{'content-security-policy':"default-src 'none'; img-src 'self'; form-action 'none'"},
  pages:[{id:'home',path:'/',audience:'public',html,digest:hex(html),photos:['ph-1']}],
  photos:{'ph-1':{projectId:P,bytes:new Uint8Array(jpeg),digest:hex(jpeg),approval:'approved',hold:false}},
  instances:[],programs:[{id:'order-count',projectId:P,source:program,digest:hex(program),cleared:true}],
  contactInbox:{present:true},domains:[{hostname:'bakery.example'}],connections:[{provider:'github'}]}}};
 return reference.buildExport(store,{actor:{kind:'owner',ownerId:'owner-a'},projectId:P,scope:{visitorData:false},cutoff:'2026-10-09T00:00:00.000Z'});
}
function runScript(script,{mutateFiles=()=>{},mutateManifest,digest}={}){
 const base=mkdtempSync(join(tmpdir(),'wh190-'));
 try{
  const bundle=referenceBundle();
  const dir=join(base,'extracted');mkdirSync(dir);
  for(const [path,data] of reference.unpackEntries(bundle.bytes)){
   mkdirSync(join(dir,dirname(path)),{recursive:true});
   writeFileSync(join(dir,path),data);
  }
  if(mutateManifest){const m=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));mutateManifest(m);writeFileSync(join(dir,'manifest.json'),JSON.stringify(m));}
  mutateFiles(dir);
  const zip=join(base,'bundle.zip');writeFileSync(zip,bundle.bytes);
  const file=join(base,'verify-bundle.mjs');writeFileSync(file,script);
  const r=spawnSync(process.execPath,[file,dir,zip,digest??bundle.sha256],{encoding:'utf8',env:{},timeout:20000});
  return {status:r.status,out:r.stdout+r.stderr};
 }finally{rmSync(base,{recursive:true,force:true});}
}
function scriptChecks(guide){
 const failures=[];
 const fail=(check,detail)=>failures.push({check,detail});
 const script=scriptOf(guide);
 if(!script){fail('offline-script-accepts','no verify-bundle.mjs block');return failures;}
 const ok=runScript(script);
 if(ok.status!==0||!/^ok: \d+ files match manifest\.json$/m.test(ok.out))fail('offline-script-accepts',ok.out.slice(0,300));
 for(const c of capabilities)if(!new RegExp(`^report ${c} (runnable|data-only|unavailable|not-used)$`,'m').test(ok.out))fail('offline-script-accepts',`no report line for ${c}`);
 if(!/^report content-pages runnable$/m.test(ok.out))fail('offline-script-accepts','reference static page not reported runnable');
 if(!/^excluded credentials-and-sessions not counted$/m.test(ok.out))fail('offline-script-accepts','credentials exclusion line');
 // Same-length edit, so only the SHA-256 comparison can notice it.
 const changed=runScript(script,{mutateFiles:dir=>{const p=join(dir,'site/public/index.html');writeFileSync(p,readFileSync(p,'utf8').replace('<h1>Harbor','<h1>Harbur'));}});
 if(changed.status!==1||!changed.out.includes('changed site/public/index.html'))fail('offline-script-detects-tamper',changed.out.slice(0,200));
 const extra=runScript(script,{mutateFiles:dir=>writeFileSync(join(dir,'site/public/extra.html'),'x')});
 if(extra.status!==1||!extra.out.includes('unlisted site/public/extra.html'))fail('offline-script-detects-tamper',extra.out.slice(0,200));
 const digest=runScript(script,{digest:'0'.repeat(64)});
 if(digest.status!==1||!digest.out.includes('bundle digest differs'))fail('offline-script-detects-tamper',digest.out.slice(0,200));
 const version=runScript(script,{mutateManifest:m=>{m.formatVersion=2;}});
 if(version.status!==2||!version.out.startsWith('REFUSED'))fail('offline-script-current-version-only',version.out.slice(0,200));
 const unsafe=runScript(script,{mutateManifest:m=>{m.files[0].path='../outside.txt';}});
 if(unsafe.status!==1||!unsafe.out.includes('unsafe path'))fail('offline-script-detects-tamper',unsafe.out.slice(0,200));
 return failures;
}

// ---------- Mutants: each must be caught by its named check ----------
const replaceOnce=(text,from,to)=>{assert.ok(text.includes(from),`mutant anchor missing: ${from.slice(0,60)}`);return text.replace(from,to);};
const entrySlice=(text,cap)=>{const i=text.search(new RegExp(`^## .+ \\(${cap}\\)$`,'m'));const j=text.indexOf('\n## ',i+3);return [i,j];};
const docMutants=[
 ['delete an entry','entry-per-capability',g=>{const [i,j]=entrySlice(g,'domains');return g.slice(0,i)+g.slice(j+1);}],
 ['drop a section','required-sections',g=>{const [i,j]=entrySlice(g,'records');const e=g.slice(i,j);return g.slice(0,i)+e.replace(/^- \*\*Offline check:\*\*.*$/m,'')+g.slice(j);}],
 ['add an http link','external-links-https',g=>replaceOnce(g,'One documented option is [Workers static assets](https://developers.cloudflare.com/workers/static-assets/)','One documented option is [Workers static assets](http://developers.cloudflare.com/workers/static-assets/)')],
 ['add an unofficial host','external-links-allowlisted',g=>replaceOnce(g,'Use your own email provider.','Use your own email provider ([guide](https://example.com/email)).')],
 ['add an undated official link','sources-dated',g=>replaceOnce(g,'Use your own email provider.','Use your own email provider ([email](https://developers.cloudflare.com/email-service/)).')],
 ["add an 'API remains available' sentence",'no-whumpo-api-after-export',g=>replaceOnce(g,'Migration path only: import the JSON into your own database.','Migration path only: the Whumpo records API remains available to the exported site after export. Import the JSON into your own database.')],
 ['ask for a secret','no-secret-to-whumpo',g=>replaceOnce(g,'Create your own OAuth apps and API tokens; never give them to Whumpo.','Create your own OAuth apps and paste the API tokens into Whumpo Chat so support can reconnect them.')],
 ['unlabelled price','price-claims-labelled',g=>replaceOnce(g,'- **Secrets:** None. `_headers` contains response headers, not credentials.','- **Secrets:** None. `_headers` contains response headers, not credentials.\n  - A typical host costs $3 per month.')],
 ['unlabelled provider cost','cost-labelled',g=>replaceOnce(g,"Your identity provider's charges require verification.","Your identity provider's charges apply.")],
 ['overclaim a status','status-matches-report',g=>replaceOnce(g,'`data-only` when the project has a records instance','`runnable` when the project has a records instance')],
 ['overclaim a replacement','replacement-matches-status',g=>replaceOnce(g,'Unavailable: Whumpo publishes no standalone form handler.','Supported replacement: the exported form handler.')],
 ['wrong cost flag','cost-flag-matches',g=>replaceOnce(g,'Report cost flag: `none`. Contract: [maintainer AI]','Report cost flag: `customer-provider`. Contract: [maintainer AI]')],
 ['broken local anchor','local-links-resolve',g=>replaceOnce(g,'[inbox and retention](contact-forms.md#inbox-and-retention)','[inbox and retention](contact-forms.md#inbox-retention)')],
 ['drop the global statement','global-unavailability-statement',g=>replaceOnce(g,'No Whumpo API, route, credential or model is available outside Whumpo.','Whumpo APIs are listed per capability.')],
 ['undated guide','dated-status',g=>replaceOnce(g,'**WH-190 documentation slice, October 9, 2026 UTC. Planned:','**WH-190 documentation slice. Draft:')],
];
const contractMutants=[
 ['contract section loses its guide link','report-links-guide',c=>replaceOnce(c,' Customer migration guide: [contact inbox](portable-migration-guides.md#contact-inbox-contact-inbox).','')],
];
const scriptMutants=[
 ['script skips hash comparison','offline-script-detects-tamper',g=>replaceOnce(g,"if(bytes.length!==f.bytes||sha256(bytes)!==f.sha256)problems.push(`changed ${f.path}`);","if(bytes.length!==f.bytes)problems.push(`changed ${f.path}`);")],
 ['script accepts any version','offline-script-current-version-only',g=>replaceOnce(g,"manifest.formatVersion!==1||","")],
];

const explain=process.argv.includes('--explain');
let passed=0;
const docFailures=documentChecks({guide:guideText,contract:contractText});
assert.deepEqual(docFailures,[],`document checks failed:\n${docFailures.map(f=>`${f.check}: ${f.detail}`).join('\n')}`);
passed++;
const scriptFailures=scriptChecks(guideText);
assert.deepEqual(scriptFailures,[],`script checks failed:\n${scriptFailures.map(f=>`${f.check}: ${f.detail}`).join('\n')}`);
passed++;

let caught=0;
const total=docMutants.length+contractMutants.length+scriptMutants.length;
const expect=(name,check,failures)=>{
 const hit=failures.some(f=>f.check===check);
 assert.ok(hit,`mutant "${name}" was not caught by ${check}; got ${JSON.stringify(failures.map(f=>f.check))}`);
 caught++;
 if(explain)console.log(`  mutant "${name}" -> ${check}`);
};
for(const [name,check,mutate] of docMutants)expect(name,check,documentChecks({guide:mutate(guideText),contract:contractText}));
for(const [name,check,mutate] of contractMutants)expect(name,check,documentChecks({guide:guideText,contract:mutate(contractText)}));
for(const [name,check,mutate] of scriptMutants)expect(name,check,scriptChecks(mutate(guideText)));

console.log(`portable migration guides: ${passed} check groups passed (${capabilities.length} capabilities, ${REQUIRED_SECTIONS.length} sections each); ${caught} of ${total} mutants caught by their named checks`);

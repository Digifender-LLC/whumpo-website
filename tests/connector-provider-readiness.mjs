import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// The frozen catalog is source (src/connector-catalog/catalog.ts, WH-141); bundle it once to read its declarations.
const bundled=await build({entryPoints:[fileURLToPath(new URL('../src/connector-catalog/catalog.ts',import.meta.url))],bundle:true,format:'esm',platform:'neutral',write:false,logLevel:'silent'});
const {connectorCatalog}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));

// WH-096–100 provider readiness plan: offline document check. It reads docs/connector-provider-readiness.md and the
// frozen connector catalog only. No network, OAuth client, credential, provider account or model is used, and passing
// it proves the plan's structure and sourcing discipline, not any provider requirement or approval.
const docURL=new URL('../docs/connector-provider-readiness.md',import.meta.url);
const docPath=fileURLToPath(docURL);
const source=readFileSync(docURL,'utf8');
const fetchedOn='2026-10-09';

// The five planned adapters, in catalog order. The test fails if the catalog's planned set changes without this plan.
const expected=[
 {key:'gmail',heading:'Gmail (WH-096)',name:'Gmail'},
 {key:'google-calendar',heading:'Google Calendar (WH-097)',name:'Google Calendar'},
 {key:'outlook-email',heading:'Outlook email (WH-098)',name:'Outlook email'},
 {key:'microsoft-calendar',heading:'Microsoft Calendar (WH-099)',name:'Microsoft Calendar'},
 {key:'hubspot',heading:'HubSpot contact lookup (WH-100)',name:'HubSpot contact lookup'},
];
const requiredTop=['Cross-provider matrix',...expected.map(p=>p.heading),'Recommended adapter order','Risks','Open owner decisions','Sources','Verification'];
const requiredSub=['Scopes and sensitivity','Verification and approvals','Tokens, refresh and revocation','Rate limits and quotas','Push alternatives (not used)','Data use and AI policy','Contract mapping','Conflicts needing owner or counsel decision','Owner and counsel actions','Prepare now versus blocked','Customer-visible cost flags'];
// Official documentation hosts only. A new host needs a deliberate edit here and a dated row in the Sources table.
const allowedHosts=new Set(['developers.google.com','support.google.com','appdefensealliance.dev','learn.microsoft.com','support.microsoft.com','developers.hubspot.com','legal.hubspot.com','knowledge.hubspot.com']);

// ---------- Parsing helpers ----------
const withoutFences=t=>t.replace(/^```[\s\S]*?^```/gm,'');
const withoutCode=t=>withoutFences(t).replace(/`[^`\n]*`/g,'``');
function split(text,marker){
 const out=new Map();let name=null,body=[];
 for(const line of text.split('\n')){
  if(line.startsWith(marker+' ')&&!line.startsWith(marker+'#')){if(name!==null)out.set(name,body.join('\n'));name=line.slice(marker.length+1).trim();body=[];}
  else if(name!==null&&!(marker==='###'&&line.startsWith('## ')))body.push(line);
 }
 if(name!==null)out.set(name,body.join('\n'));
 return out;
}
const top=t=>split(t,'##');
const sub=t=>split(t,'###');
function table(body){
 const rows=body.split('\n').filter(l=>l.trim().startsWith('|')).map(l=>l.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim()));
 if(rows.length<2)return {header:[],rows:[]};
 return {header:rows[0],rows:rows.slice(2)};
}
const codeSpans=s=>[...s.matchAll(/`([^`\n]+)`/g)].map(m=>m[1]);
const sameSet=(a,b)=>a.length===new Set(a).size&&a.length===b.length&&b.every(x=>a.includes(x));
const urlPattern=/\b[a-z][a-z0-9+.-]*:\/\/[^\s)<>\]|"'`]+/gi;
const urls=t=>[...withoutCode(t).matchAll(urlPattern)].map(m=>m[0].replace(/[.,;:]+$/,''));
const noFragment=u=>u.split('#')[0];
// Sentences from prose lines and individual table cells; headings and separator rows are not claims.
function sentences(text){
 const out=[];
 // Link targets are addresses, not prose: a local path such as pricing-and-model-policy.md is not a pricing claim.
 for(const line of withoutFences(text).replace(/\]\([^)\s]*\)/g,']').split('\n')){
  if(/^#{1,6} /.test(line)||/^\|?\s*:?-{3,}/.test(line.trim()))continue;
  const units=line.trim().startsWith('|')?line.trim().replace(/^\||\|$/g,'').split('|'):[line];
  for(const unit of units)for(const s of unit.split(/(?<=[.!?])\s+(?=[A-Z(`*[])/))if(s.trim())out.push(s.trim());
 }
 return out;
}
// GitHub-style heading anchors, used to check local links.
function anchors(markdown){
 const seen=new Map(),out=new Set();
 for(const line of withoutFences(markdown).split('\n')){
  const m=/^#{1,6} (.*)$/.exec(line);if(!m)continue;
  const base=m[1].trim().toLowerCase().replace(/<[^>]+>/g,'').replace(/[^\p{L}\p{N} _-]/gu,'').replace(/ /g,'-');
  const n=seen.get(base)??0;seen.set(base,n+1);out.add(n?`${base}-${n}`:base);
 }
 return out;
}
function sourcesTable(text){
 const body=top(text).get('Sources');
 if(body===undefined)throw new Error('sources: missing Sources section');
 const {header,rows}=table(body);
 const col=n=>header.findIndex(h=>h.toLowerCase().startsWith(n));
 const [id,src,date,status]=['id','source','fetched','status'].map(col);
 if([id,src,date,status].some(i=>i<0))throw new Error('sources: table needs ID, Source, Fetched and Status columns');
 return rows.map(r=>({id:r[id],url:(urls(r[src])[0]??''),urls:urls(r[src]),date:r[date],status:r[status]}));
}
const fail=(name,detail)=>{throw new Error(`${name}: ${detail}`);};

// ---------- Named checks ----------
const checks={
 header(text){
  const head=text.split('\n').slice(0,6).join('\n');
  if(!/^# .+/.test(text))fail('header','missing title');
  if(!/\*\*Planned\b/.test(head))fail('header','the plan must be marked Planned at the top');
  if(!head.includes('October 9, 2026'))fail('header','the plan must carry its October 9, 2026 review date at the top');
 },
 sections(text){
  const t=top(text);
  for(const h of requiredTop)if(!t.has(h))fail('sections',`missing top-level section "${h}"`);
  for(const p of expected){
   const s=sub(t.get(p.heading));
   for(const h of requiredSub)if(!s.has(h)||!s.get(h).trim())fail('sections',`${p.heading} lacks a non-empty "${h}" subsection`);
  }
 },
 providers(text){
  const planned=Object.entries(connectorCatalog.providers).filter(([,e])=>e.readiness==='planned').map(([k])=>k);
  if(!sameSet(planned,expected.map(p=>p.key)))fail('providers',`catalog planned providers ${planned} differ from the plan's ${expected.map(p=>p.key)}`);
  const t=top(text);
  for(const p of expected){
   const body=t.get(p.heading);
   if(body===undefined)fail('providers',`missing provider section ${p.heading}`);
   if(!body.includes(`Catalog key: \`${p.key}\``))fail('providers',`${p.heading} must name catalog key ${p.key}`);
  }
  const named=[...t.keys()].filter(h=>/\(WH-(?:09[6-9]|100)\)$/.test(h));
  if(!sameSet(named,expected.map(p=>p.heading)))fail('providers',`provider sections ${named} differ from the expected five`);
  const {header,rows}=table(t.get('Cross-provider matrix')??'');
  if(!sameSet(rows.map(r=>r[0]),expected.map(p=>p.name)))fail('providers',`matrix rows ${rows.map(r=>r[0])} differ from the expected five`);
  if(header[0]!=='Provider')fail('providers','matrix must start with a Provider column');
 },
 scopes(text){
  const t=top(text);
  for(const p of expected){
   const catalog=connectorCatalog.providers[p.key].scopes;
   const {rows}=table(sub(t.get(p.heading)??'').get('Scopes and sensitivity')??'');
   const documented=rows.map(r=>codeSpans(r[0])[0]);
   if(!sameSet(documented,catalog))fail('scopes',`${p.heading} scope table ${documented} must equal the catalog scopes ${catalog}`);
   for(const r of rows)if(!/\[S\d+\]|requires verification|unverified/i.test(r.slice(1).join(' ')))fail('scopes',`${p.heading} scope ${r[0]} needs a source or an explicit verification label`);
  }
  const {header,rows}=table(t.get('Cross-provider matrix')??'');
  const col=header.indexOf('Catalog scopes');
  if(col<0)fail('scopes','matrix lacks a Catalog scopes column');
  for(const p of expected){
   const row=rows.find(r=>r[0]===p.name);
   if(!row||!sameSet(codeSpans(row[col]),connectorCatalog.providers[p.key].scopes))fail('scopes',`matrix scopes for ${p.name} must equal the catalog`);
  }
 },
 operations(text){
  const t=top(text);
  for(const p of expected){
   const mapping=sub(t.get(p.heading)??'').get('Contract mapping')??'';
   const spans=codeSpans(mapping);
   for(const id of Object.keys(connectorCatalog.providers[p.key].operations))if(!spans.includes(id))fail('operations',`${p.heading} contract mapping must name catalog operation ${id}`);
  }
 },
 links(text){
  for(const u of urls(text)){
   let parsed;try{parsed=new URL(u);}catch{fail('links',`unparseable link ${u}`);}
   if(parsed.protocol!=='https:')fail('links',`non-https link ${u}`);
   if(!allowedHosts.has(parsed.hostname))fail('links',`host ${parsed.hostname} is not an allow-listed official documentation host`);
   if(parsed.username||parsed.password||parsed.port)fail('links',`link ${u} has userinfo or a port`);
  }
 },
 sources(text){
  const rows=sourcesTable(text);
  if(!rows.length)fail('sources','empty Sources table');
  const ids=rows.map(r=>r.id);
  if(new Set(ids).size!==ids.length||!ids.every(i=>/^S\d+$/.test(i)))fail('sources','source IDs must be unique S<n> values');
  for(const r of rows){
   if(r.urls.length!==1)fail('sources',`${r.id} must cite exactly one URL`);
   if(r.date!==fetchedOn)fail('sources',`${r.id} must be dated ${fetchedOn}, found "${r.date}"`);
   if(!['fetched','unverified'].includes(r.status))fail('sources',`${r.id} status must be fetched or unverified, found "${r.status}"`);
  }
  const listed=new Set(rows.map(r=>noFragment(r.url)));
  const body=text.replace(/^## Sources\n[\s\S]*?(?=^## )/m,'');
  for(const u of urls(body))if(!listed.has(noFragment(u)))fail('sources',`external link ${u} is not in the dated Sources table`);
  const cited=new Set([...body.matchAll(/\[(S\d+)\]/g)].map(m=>m[1]));
  for(const c of cited)if(!ids.includes(c))fail('sources',`[${c}] is cited but missing from the Sources table`);
  for(const i of ids)if(!cited.has(i))fail('sources',`${i} is listed but never cited`);
 },
 claims(text){
  const body=text.replace(/^## Sources\n[\s\S]*?(?=^## )/m,'');
  const claim=/\$\s?\d|\bUSD\b|\bcosts?\b|\bfees?\b|\bpric(?:e|es|ed|ing)\b|\btimelines?\b|\b\d+\s*(?:business\s+|calendar\s+|working\s+)?(?:days?|weeks?|months?)\b|\bentitle(?:d|ment|ments)\b|\blicen[cs](?:e|es|ed|ing)\b/i;
  const bad=sentences(body).filter(s=>claim.test(s)&&!/\[S\d+\]|requires verification/i.test(s));
  if(bad.length)fail('claims',`pricing/timeline/entitlement claims need a source or "requires verification":\n${bad.map(s=>`  "${s.slice(0,160)}"`).join('\n')}`);
 },
 'approval-claims'(text){
  const claim=/\b(?:is|are|was|were|has been|have been)\s+(?:now\s+|already\s+)?(?:verified|approved|certified|accepted|assessed|granted|listed|publisher[- ]verified)\b|\b(?:is|are)\s+(?:now\s+|already\s+)?(?:an?\s+)?(?:verified|approved|certified|listed)\s+(?:publisher|app|application|partner|client)\b|\b(?:has|have)\s+(?:now\s+|already\s+)?(?:approved|verified|certified|granted|passed|completed)\b|\b(?:approval|verification|assessment|certification|listing)\s+(?:exists|is in place|is complete|was completed|was granted|was obtained|has been obtained|passed)\b|\b(?:we|whumpo)\s+(?:holds?|has|have|obtained|received)\s+(?:an?\s+|the\s+)?(?:approval|verification|certification|assessment|letter of validation)\b/i;
  const qualified=/\b(?:not|no|never|none|nothing|nor|until|unless|before|once|when|whenever|if|whether|without|requires?|required|must|needs?|pending|planned|would|will|can|could|may|might|should|after|cannot|only)\b/i;
  const bad=sentences(text).filter(s=>claim.test(s)&&!qualified.test(s));
  if(bad.length)fail('approval-claims',`sentences claim an approval or verification exists:\n${bad.map(s=>`  "${s.slice(0,160)}"`).join('\n')}`);
 },
 'local-links'(text){
  for(const m of withoutCode(text).matchAll(/\]\(([^)\s]+)\)/g)){
   const target=m[1];if(/^[a-z][a-z0-9+.-]*:/i.test(target))continue;
   const [file,anchor]=target.split('#');
   const path=file?resolve(dirname(docPath),file):docPath;
   if(!existsSync(path))fail('local-links',`missing local target ${target}`);
   if(anchor&&path.endsWith('.md')){
    const markdown=path===docPath?text:readFileSync(path,'utf8');
    if(!anchors(markdown).has(anchor))fail('local-links',`missing anchor ${target}`);
   }
  }
 },
};
const failures=text=>Object.entries(checks).flatMap(([name,fn])=>{try{fn(text);return [];}catch(e){return [[name,e.message]];}});

// ---------- The real plan passes every check ----------
const real=failures(source);
assert.deepEqual(real,[],`connector provider readiness plan fails:\n${real.map(f=>f[1]).join('\n')}`);

// ---------- Mutation set: each broken copy must be caught by the named check ----------
const section=(t,heading)=>{const start=t.indexOf(`\n## ${heading}\n`);assert.ok(start>=0,heading);const end=t.indexOf('\n## ',start+1);return [start,end<0?t.length:end];};
const inSection=(t,heading,find,replace)=>{const [a,b]=section(t,heading);const part=t.slice(a,b);assert.ok(part.includes(find),`${heading} lacks ${find}`);return t.slice(0,a)+part.replace(find,replace)+t.slice(b);};
const allInSection=(t,heading,find,replace)=>{const [a,b]=section(t,heading);const part=t.slice(a,b);assert.ok(part.includes(find),`${heading} lacks ${find}`);return t.slice(0,a)+part.split(find).join(replace)+t.slice(b);};
const append=(t,heading,line)=>{const [,b]=section(t,heading);return t.slice(0,b)+'\n'+line+'\n'+t.slice(b);};
const sourceRow=(t,id)=>t.split('\n').find(l=>l.startsWith(`| ${id} |`));
const mutants=[
 ['drop a provider','providers',t=>{const [a,b]=section(t,'HubSpot contact lookup (WH-100)');return t.slice(0,a)+t.slice(b);}],
 ['change a provider scope','scopes',t=>inSection(t,'Microsoft Calendar (WH-099)','| `Calendars.ReadWrite` |','| `Calendars.Read` |')],
 ['change a matrix scope','scopes',t=>inSection(t,'Cross-provider matrix','`crm.objects.contacts.write`','`crm.objects.contacts.write.all`')],
 ['add a scope the catalog lacks','scopes',t=>inSection(t,'Gmail (WH-096)','| `https://www.googleapis.com/auth/gmail.send` |','| `https://www.googleapis.com/auth/gmail.modify` | Restricted [S1] | none |\n| `https://www.googleapis.com/auth/gmail.send` |')],
 ['drop a catalog operation','operations',t=>allInSection(t,'Gmail (WH-096)','`messages.search`','`messages.list`')],
 ['add an http link','links',t=>append(t,'Gmail (WH-096)','See [the policy](http://developers.google.com/terms/api-services-user-data-policy).')],
 ['add a non-official host','links',t=>append(t,'Outlook email (WH-098)','See [a blog](https://example.com/graph-oauth-tips).')],
 ['add an unlisted official link','sources',t=>append(t,'Google Calendar (WH-097)','See [an extra page](https://developers.google.com/workspace/calendar/api/unlisted-page).')],
 ['remove a source row','sources',t=>t.replace(sourceRow(t,'S1')+'\n','')],
 ['invalid source status','sources',t=>t.replace(sourceRow(t,'S2'),sourceRow(t,'S2').replace('| fetched |','| assumed |'))],
 ['stale source date','sources',t=>t.replace(sourceRow(t,'S3'),sourceRow(t,'S3').replace(`| ${fetchedOn} |`,'| 2026-09-30 |'))],
 ['add an is-verified claim','approval-claims',t=>append(t,'Gmail (WH-096)','The Whumpo Google OAuth client is verified.')],
 ['add an approved claim','approval-claims',t=>append(t,'HubSpot contact lookup (WH-100)','HubSpot has approved the Whumpo marketplace listing.')],
 ['add a publisher-verified claim','approval-claims',t=>append(t,'Microsoft Calendar (WH-099)','The Whumpo Entra application is publisher verified.')],
 ['add a verified-publisher claim','approval-claims',t=>append(t,'Outlook email (WH-098)','Whumpo is a verified publisher in Microsoft Entra.')],
 ['add an assessment-passed claim','approval-claims',t=>append(t,'Gmail (WH-096)','The CASA assessment passed for the Whumpo client.')],
 ['add an unsourced cost claim','claims',t=>append(t,'Gmail (WH-096)','The annual security assessment costs $540.')],
 ['add an unsourced timeline claim','claims',t=>append(t,'Outlook email (WH-098)','Publisher verification takes 5 business days.')],
 ['drop a required subsection','sections',t=>inSection(t,'Outlook email (WH-098)','### Data use and AI policy','#### Data use and AI policy')],
 ['drop a top-level section','sections',t=>t.replace('\n## Open owner decisions\n','\n## Owner decisions\n')],
 ['break a local link','local-links',t=>t.replace('](connectors.md','](connector.md')],
 ['break a local anchor','local-links',t=>t.replace('connectors.md#request-bound-lookup-and-data-use-consent','connectors.md#request-bound-lookup')],
 ['remove the review date','header',t=>{const [first,...rest]=t.split('October 9, 2026');assert.ok(rest.length);return first+'October 2026'+rest.join('October 9, 2026');}],
];
let killed=0;
for(const [name,check,mutate] of mutants){
 const mutated=mutate(source);
 assert.notEqual(mutated,source,`mutant "${name}" must change the plan`);
 const caught=failures(mutated).map(f=>f[0]);
 assert.ok(caught.includes(check),`mutant "${name}" must be caught by the ${check} check; caught by [${caught}]`);
 if(process.argv.includes('--explain'))console.log(`${name} => ${caught.join(', ')}`);
 killed++;
}
const sources=sourcesTable(source);
console.log(`connector-provider-readiness: ${Object.keys(checks).length} named checks passed on the plan (${expected.length} providers, ${sources.length} dated sources: ${sources.filter(s=>s.status==='fetched').length} fetched, ${sources.filter(s=>s.status==='unverified').length} unverified); ${killed}/${mutants.length} mutants caught by their named check. Offline: no network, credential or provider account.`);

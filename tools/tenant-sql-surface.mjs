// WH-054 packet 1a: AST report of the SQL surface and tenant-taking helpers in `src`, with the reviewed dynamic
// allowlist. It parses TypeScript with the TypeScript 7 syntax tree (typescript/unstable/sync, the method the
// open boundary audit uses), never imports or runs the source, and never touches a database.
//
//   node tools/tenant-sql-surface.mjs [check]          gate: dynamic SQL sites must match the reviewed allowlist
//   node tools/tenant-sql-surface.mjs report [--json]  the full surface report
//
// What it can and cannot show is part of the report. It enumerates `.prepare(...)` call sites and helper calls
// by name; it cannot resolve dynamic or composed SQL, trigger-side writes, SQL passed to anything but
// `.prepare`, or which tenant a bound parameter carries. It is a map of where tenant SQL is, never a proof that
// every tenant access is scoped.
import {mkdtempSync,rmSync,writeFileSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,join,relative,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {API} from 'typescript/unstable/sync';
import {SyntaxKind} from 'typescript/unstable/ast';
import {tokenize} from './sql-structure.mjs';

export const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const baselinePath='docs/tenant-checks-baseline.json';
export const workerConfigs=['wrangler.jsonc','wrangler.sites.jsonc','wrangler.apps.jsonc','wrangler.runtime.jsonc'];
// Helpers that take an account ID as the tenant today (feature-admission.ts and workspace-identity/admission.ts).
export const tenantHelpers=['assertWorkspace','workspacePredicate','requireFreshWorkspace','workspaceTransport','workspaceBindings','workspacePrincipal','admitWorkspace','assertFeature','featurePredicate','requireFeature','connectionInclusion','inclusionPredicate','requireFeatureScope','featureRequest'];
export const surfaceLimitations=Object.freeze([
 'Only calls named prepare on a property (`x.prepare(...)`) in src/**/*.ts are SQL sites. SQL passed to exec, batch strings, or built by another function and passed on is not seen.',
 'Interpolated and non-literal statements are listed, not resolved. Each is an allowlist entry with a reviewed reason; a new one fails the gate.',
 'Trigger-side writes (a statement can fire triggers that touch other tables) are invisible here; the validator and the SQLite authorizer probe cover trigger text and executed paths.',
 'Helper calls are matched by callee name from the syntax tree, without type resolution, so a same-named local function would be counted.',
 'Table names are read from the SQL text of literal and static-template statements after FROM, JOIN, INTO, UPDATE and TABLE. A table reached only through an interpolation, a view or a trigger is not named.',
 'Nothing here proves that a statement is scoped to the acting tenant, or that all tenant access has been found; two-workspace fixtures with unique markers are the value-level check.',
]);

const lower=s=>s.toLowerCase();
const hash=text=>createHash('sha256').update(text).digest('hex').slice(0,16);
const isKind=(node,kind)=>node?.kind===SyntaxKind[kind];
const walk=(node,visit)=>{visit(node);node.forEachChild(child=>{walk(child,visit);});};
const collapse=text=>text.replace(/\s+/g,' ').trim();

function listTs(directory,base){
 const out=[];
 const visit=dir=>{for(const name of readdirSync(dir).sort()){const path=join(dir,name);if(statSync(path).isDirectory())visit(path);else if(/\.ts$/.test(name)&&!/\.d\.ts$/.test(name))out.push(relative(base,path).split('\\').join('/'));}};
 visit(join(base,directory));return out;
}

// Enclosing named function, method or class member, for a stable site identity that does not move with line numbers.
function symbolOf(node){
 const names=[];
 for(let p=node.parent;p;p=p.parent){
  if(isKind(p,'FunctionDeclaration')||isKind(p,'MethodDeclaration')||isKind(p,'ClassDeclaration')){if(p.name?.text)names.unshift(p.name.text);}
  else if((isKind(p,'ArrowFunction')||isKind(p,'FunctionExpression'))&&isKind(p.parent,'VariableDeclaration')&&p.parent.name?.text)names.unshift(p.parent.name.text);
  else if((isKind(p,'ArrowFunction')||isKind(p,'FunctionExpression'))&&isKind(p.parent,'PropertyAssignment')&&p.parent.name?.text)names.unshift(p.parent.name.text);
 }
 return names.length?names.join('.'):'<module>';
}

const SQL_TABLE_KEYWORDS=new Set(['FROM','JOIN','INTO','UPDATE','TABLE']);
/** Table names read after FROM/JOIN/INTO/UPDATE/TABLE; interpolation markers are reported as dynamic. */
function sqlTables(sql){
 const names=new Set();let dynamicTable=0;
 let tokens;try{tokens=tokenize(sql);}catch{return {names:[],dynamicTable:0,unreadable:true};}
 for(let i=0;i<tokens.length-1;i++){
  const t=tokens[i];
  if(t.type!=='id'||t.quoted||!SQL_TABLE_KEYWORDS.has(t.value.toUpperCase()))continue;
  let j=i+1;
  if(tokens[j]?.type==='id'&&!tokens[j].quoted&&['IF','ONLY'].includes(tokens[j].value.toUpperCase())){while(tokens[j]?.type==='id'&&['IF','NOT','EXISTS','ONLY'].includes(tokens[j].value.toUpperCase()))j++;}
  let n=tokens[j];if(n?.type!=='id')continue;
  if(!n.quoted&&['SET','SELECT','VALUES','DEFAULT','WHERE'].includes(n.value.toUpperCase()))continue;
  if(tokens[j+1]?.type==='punct'&&tokens[j+1].value==='.'&&tokens[j+2]?.type==='id'){n=tokens[j+2];}
  if(n.value.includes('__INTERP_'))dynamicTable++;else names.add(n.value);
 }
 return {names:[...names],dynamicTable,unreadable:false};
}

function classifyArgument(file,node){
 const text=collapse(file.text.slice(node.getStart(),node.end));
 if(isKind(node,'StringLiteral'))return {kind:'literal',sql:node.text,argument:text};
 if(isKind(node,'NoSubstitutionTemplateLiteral'))return {kind:'static-template',sql:node.text,argument:text};
 if(isKind(node,'TemplateExpression')){
  let sql=node.head.text,i=0;
  for(const span of node.templateSpans){sql+=`__INTERP_${i++}__`+span.literal.text;}
  // A table name can also be interpolated by a template nested inside an interpolation:
  // `... AND ${stores.map(s=>`NOT EXISTS(SELECT 1 FROM ${s.table})`).join(' AND ')}`.
  let nested=0;
  for(const span of node.templateSpans)walk(span.expression,inner=>{
   if(!isKind(inner,'TemplateExpression'))return;
   let innerSql=inner.head.text,k=0;for(const part of inner.templateSpans)innerSql+=`__INTERP_${k++}__`+part.literal.text;
   nested+=sqlTables(innerSql).dynamicTable;
  });
  const probe=sqlTables(sql);
  return {kind:'interpolated-template',sql,interpolations:node.templateSpans.length,tableInterpolations:probe.dynamicTable+nested,argument:text};
 }
 // 'a' + 'b' is statically known; anything else concatenated or passed through a variable is not.
 const parts=[];const flatten=n=>{if(isKind(n,'ParenthesizedExpression'))return flatten(n.expression);if(isKind(n,'BinaryExpression')&&n.operatorToken.kind===SyntaxKind.PlusToken){return flatten(n.left)&&flatten(n.right);}if(isKind(n,'StringLiteral')||isKind(n,'NoSubstitutionTemplateLiteral')){parts.push(n.text);return true;}return false;};
 if(isKind(node,'BinaryExpression')&&flatten(node))return {kind:'literal-concatenation',sql:parts.join(''),argument:text};
 return {kind:isKind(node,'BinaryExpression')?'concatenation':'non-literal',argument:text};
}

/** Parse the project's src (and tools/*.mjs listing) and return the raw surface. `overrides` maps a path to replacement source. */
export function extractSurface({cwd=root,overrides={}}={}){
 const work=mkdtempSync(join(tmpdir(),'whumpo-sql-surface-'));
 const srcFiles=[...new Set([...listTs('src',cwd),...Object.keys(overrides).filter(f=>/^src\/.*\.ts$/.test(f))])].sort();
 const mapped=Object.fromEntries(srcFiles.map(f=>{
  if(!Object.hasOwn(overrides,f))return [f,resolve(cwd,f)];
  const copy=join(work,f.replaceAll('/','__'));writeFileSync(copy,overrides[f]);return [f,copy];
 }));
 writeFileSync(join(work,'tsconfig.json'),JSON.stringify({compilerOptions:{noResolve:true,noLib:true,types:[],skipLibCheck:true},files:Object.values(mapped)}));
 const api=new API({cwd:work});
 try{
  const snapshot=api.updateSnapshot({openProject:join(work,'tsconfig.json')}),project=snapshot.getProjects()[0];
  const sites=[],helperCalls=Object.fromEntries(tenantHelpers.map(h=>[h,{calls:0,byFile:{},definedIn:[]}])),imports=new Map(),exportsOf=new Map();
  for(const path of srcFiles){
   const file=project.program.getSourceFile(mapped[path]);
   if(!file)throw Error(`Could not parse ${path}.`);
   const seen=new Map();
   const specifiers=new Set(),exported=new Set();
   walk(file,node=>{
    if(isKind(node,'ImportDeclaration')||isKind(node,'ExportDeclaration')){const s=node.moduleSpecifier;if(s&&isKind(s,'StringLiteral')&&s.text.startsWith('.'))specifiers.add(s.text);}
    if(isKind(node,'FunctionDeclaration')&&node.name&&tenantHelpers.includes(node.name.text))helperCalls[node.name.text].definedIn.push(path);
    if(isKind(node,'VariableDeclaration')&&isKind(node.name,'Identifier')&&tenantHelpers.includes(node.name.text))helperCalls[node.name.text].definedIn.push(path);
    if(!isKind(node,'CallExpression'))return;
    const callee=node.expression;
    const name=isKind(callee,'Identifier')?callee.text:isKind(callee,'PropertyAccessExpression')?callee.name.text:null;
    if(name&&Object.hasOwn(helperCalls,name)){const h=helperCalls[name];h.calls++;h.byFile[path]=(h.byFile[path]??0)+1;}
    if(name==='prepare'&&isKind(callee,'PropertyAccessExpression')&&node.arguments.length){
     const c=classifyArgument(file,node.arguments[0]);
     const symbol=symbolOf(node),base=`${path}|${symbol}|${c.kind}|${c.argument}`,n=seen.get(base)??0;seen.set(base,n+1);
     const tables=c.sql===undefined?{names:[],dynamicTable:0}:sqlTables(c.sql);
     sites.push({file:path,symbol,line:file.text.slice(0,node.getStart()).split('\n').length,...c,sql:undefined,tables:tables.names,fingerprint:hash(`${base}|${n}`),unreadableSql:tables.unreadable===true});
    }
   });
   for(const statement of file.statements){
    if(isKind(statement,'ExportAssignment')){
     let target=statement.expression;
     while(target&&(isKind(target,'SatisfiesExpression')||isKind(target,'AsExpression')||isKind(target,'ParenthesizedExpression')))target=target.expression;
     if(isKind(target,'ObjectLiteralExpression'))for(const p of target.properties)if(p.name?.text)exported.add('default.'+p.name.text);
    }
    else if(isKind(statement,'FunctionDeclaration')||isKind(statement,'ClassDeclaration')){if(statement.name&&statement.modifiers?.some(m=>m.kind===SyntaxKind.ExportKeyword))exported.add(statement.name.text);}
    else if(isKind(statement,'FirstStatement')||isKind(statement,'VariableStatement')){if(statement.modifiers?.some(m=>m.kind===SyntaxKind.ExportKeyword))for(const d of statement.declarationList.declarations)if(isKind(d.name,'Identifier'))exported.add(d.name.text);}
   }
   imports.set(path,[...specifiers]);exportsOf.set(path,[...exported].sort());
  }
  snapshot.dispose();
  return {srcFiles,sites,helperCalls,imports,exportsOf};
 }finally{api.close();rmSync(work,{recursive:true,force:true});}
}

/** Local import closure from a worker's main module (relative specifiers only; the TypeScript `.js` form maps to `.ts`). */
function closure(main,imports,files){
 const set=new Set(files),seen=new Set(),stack=[main];
 while(stack.length){
  const file=stack.pop();if(seen.has(file)||!set.has(file))continue;seen.add(file);
  for(const spec of imports.get(file)??[]){
   const target=posix.normalize(posix.join(posix.dirname(file),spec.replace(/\.js$/,'.ts')));
   for(const candidate of [target,target.replace(/\.ts$/,'')+'.ts',target+'.ts',posix.join(target,'index.ts')])if(set.has(candidate)){stack.push(candidate);break;}
  }
 }
 return seen;
}
function stripJsonComments(text){return text.replace(/^\s*\/\/.*$/gm,'').replace(/,(\s*[}\]])/g,'$1');}

export function workerEntries(cwd,surface){
 const entries=[];
 for(const config of workerConfigs){
  let parsed;try{parsed=JSON.parse(stripJsonComments(readFileSync(resolve(cwd,config),'utf8')));}catch{entries.push({config,error:'unreadable'});continue;}
  const main=parsed.main;
  const reach=closure(main,surface.imports,surface.srcFiles);
  const sites=surface.sites.filter(s=>reach.has(s.file));
  entries.push({config,worker:parsed.name,main,exports:surface.exportsOf.get(main)??[],reachableFiles:reach.size,reachableSqlSites:sites.length,reachableDynamicSites:sites.filter(isDynamic).length});
 }
 return entries;
}

export const isTableInterpolation=s=>s.kind==='interpolated-template'&&s.tableInterpolations>0;
export const isDynamic=s=>isTableInterpolation(s)||s.kind==='concatenation'||s.kind==='non-literal';
const dynamicKind=s=>isTableInterpolation(s)?'table-interpolation':'non-literal';

export function loadBaseline(cwd=root){return JSON.parse(readFileSync(resolve(cwd,baselinePath),'utf8')).sqlSurface;}

/** Allowlist drift: every dynamic site needs a reviewed entry; every entry must still match a site. */
export function checkAllowlist(surface,baseline){
 const problems=[];
 const allowed=new Map((baseline.allowlist??[]).map(a=>[a.fingerprint,a]));
 if(allowed.size!==(baseline.allowlist??[]).length)problems.push('Allowlist contains a duplicate fingerprint');
 for(const a of baseline.allowlist??[])if(!a.reason||a.reason.length<20||!a.kind||!a.file)problems.push(`Allowlist entry ${a.fingerprint} needs a file, kind and a reviewed reason`);
 const dynamic=surface.sites.filter(isDynamic);
 const found=new Set(dynamic.map(s=>s.fingerprint));
 for(const s of dynamic){
  const entry=allowed.get(s.fingerprint);
  if(!entry)problems.push(`New ${dynamicKind(s)} SQL site in ${s.file} (${s.symbol}): ${s.argument.slice(0,90)}; add a reviewed allowlist entry (fingerprint ${s.fingerprint})`);
  else if(entry.kind!==dynamicKind(s))problems.push(`Allowlist entry ${s.fingerprint} is ${entry.kind}, the site is now a ${dynamicKind(s)}`);
 }
 for(const a of baseline.allowlist??[])if(!found.has(a.fingerprint))problems.push(`Stale allowlist entry ${a.fingerprint} (${a.file} ${a.symbol}): no matching dynamic site`);
 return problems;
}

/** Counts, observed beside the numbers the contract documents (information, never a gate). */
export function surfaceReport(surface,{baseline,tenantTables,cwd=root}={}){
 const byKind={};for(const s of surface.sites)byKind[s.kind]=(byKind[s.kind]??0)+1;
 const named=new Set(surface.sites.flatMap(s=>s.tables.map(lower)));
 const tenant=new Set((tenantTables??[]).map(lower));
 const tenantSites=surface.sites.filter(s=>s.tables.some(t=>tenant.has(lower(t))));
 const helpers=Object.fromEntries(Object.entries(surface.helperCalls).map(([name,h])=>{
  const outside=Object.entries(h.byFile).filter(([file])=>!h.definedIn.includes(file));
  return [name,{calls:h.calls,files:Object.keys(h.byFile).length,definedIn:h.definedIn,outsideDefiningFile:{calls:outside.reduce((n,[,c])=>n+c,0),files:outside.length}}];
 }));
 const documented=baseline?.documented;
 return {
  scope:{srcFiles:surface.srcFiles.length,prepareCalls:surface.sites.length},
  byKind,
  tableInterpolations:surface.sites.filter(isTableInterpolation).length,
  nonLiteral:surface.sites.filter(s=>s.kind==='concatenation'||s.kind==='non-literal').length,
  otherInterpolatedTemplates:surface.sites.filter(s=>s.kind==='interpolated-template'&&!s.tableInterpolations).length,
  sitesNamingATenantTable:tenantSites.length,
  tenantTablesNeverNamedInStaticSql:[...tenant].filter(t=>!named.has(t)).sort(),
  helpers,
  documented:documented?{...documented,note:'The contract quotes counts from an ast-grep text inventory at ca17c6a. The syntax tree can differ; observed counts are authoritative for this commit.'}:undefined,
  workers:workerEntries(cwd,surface),
  sqlBearingExports:Object.entries(surface.sites.reduce((m,s)=>{(m[`${s.file}::${s.symbol}`]??=[]).push(s);return m;},{})).map(([key,list])=>({entry:key,sites:list.length,dynamic:list.filter(isDynamic).length})).sort((a,b)=>b.sites-a.sites).slice(0,25),
  limitations:surfaceLimitations,
 };
}

async function tenantTableNames(){
 const {loadRegistry,observeSchema}=await import('./tenant-classification.mjs');
 const registry=await loadRegistry(),observed=await observeSchema();
 return [...new Set([...registry.columns.map(c=>c.column.split('.')[0]),...observed.derived.direct,...observed.derived.chained])];
}

async function main(argv){
 const [command='check',...rest]=argv;
 const json=rest.includes('--json');
 if(rest.some(a=>a!=='--json')||!['check','report'].includes(command))throw Error('Usage: node tools/tenant-sql-surface.mjs [check|report] [--json]');
 const baseline=loadBaseline(),surface=extractSurface();
 const problems=checkAllowlist(surface,baseline);
 if(command==='report'){
  const report=surfaceReport(surface,{baseline,tenantTables:await tenantTableNames()});
  if(json){console.log(JSON.stringify({...report,problems},null,2));}
  else{
   console.log(`SQL surface: ${report.scope.prepareCalls} prepare calls in ${report.scope.srcFiles} files; ${Object.entries(report.byKind).map(([k,v])=>`${k} ${v}`).join(', ')}.`);
   console.log(`Dynamic: ${report.tableInterpolations} interpolate a table name, ${report.nonLiteral} pass a non-literal; allowlist ${baseline.allowlist.length} entries, ${problems.length} problems.`);
   console.log(`${report.sitesNamingATenantTable} statements name a tenant-bearing table in literal text; ${report.tenantTablesNeverNamedInStaticSql.length} tenant-bearing tables are never named in static SQL: ${report.tenantTablesNeverNamedInStaticSql.join(', ')}.`);
   for(const [name,h] of Object.entries(report.helpers))console.log(`  ${name}: ${h.calls} calls in ${h.files} files (${h.outsideDefiningFile.calls} in ${h.outsideDefiningFile.files} outside ${h.definedIn.join(', ')||'a defining file'})`);
   for(const w of report.workers)console.log(`  worker ${w.worker}: main ${w.main}, ${w.reachableFiles} files and ${w.reachableSqlSites} SQL sites reachable by import (${w.reachableDynamicSites} dynamic)`);
   console.log('Limitations: '+surfaceLimitations.join(' '));
  }
 }else console.log(`SQL surface: ${surface.sites.length} prepare calls, ${surface.sites.filter(isDynamic).length} dynamic sites, allowlist ${baseline.allowlist.length} entries.`);
 for(const p of problems)console.error(' - '+p);
 if(problems.length)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await main(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}
}

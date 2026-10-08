// WH-004 boundary audit: structural inventory of the platform Worker's mounted request surface,
// compared against the checked-in evidence registry docs/boundary-audit.json.
//
// Extraction uses the TypeScript 7 syntax tree (typescript/unstable/sync), not text search, so comments,
// string contents and fixtures cannot create or hide a route. It is offline: the native compiler parses a
// temporary project that lists only the dispatcher files (noResolve), and nothing is executed or deployed.
//
//   node tools/boundary-audit.mjs check     validate the registry against current source (default)
//   node tools/boundary-audit.mjs list      print the extracted surface as JSON
//   node tools/boundary-audit.mjs summary   print the matrix summary block used in docs/boundary-audit.md
import {mkdtempSync,rmSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {API} from 'typescript/unstable/sync';
import {SyntaxKind} from 'typescript/unstable/ast';

export const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const registryPath='docs/boundary-audit.json';
export const reportPath='docs/boundary-audit.md';
export const cellNames=['authority','origin','freshness','target','replay','stale'];
export const cellStates=['evidenced','gap','n/a','unverified'];
export const privilegeClasses=['publish','activation','dns-hosting','backup','cms','billing','deletion','connection','safety-operator','credential','data-change','access'];

// Every file that decides which handler a platform request reaches. `prefix` is the mounted path the
// sub-dispatcher strips before comparing; `pathVars` are the identifiers holding the remaining path.
export const dispatchers=[
 {id:'platform',file:'src/index.ts',pathVars:['pathname']},
 {id:'identity',file:'src/workspace-identity/http.ts',fn:'handleIdentityRequest',prefix:'/api/auth/identity/v1/',pathVars:['action'],methods:['POST']},
 {id:'operator',file:'src/safety-case-http.ts',prefix:'/api/operator/safety-cases/v1/',tableKeys:'actions',methods:['POST']},
 {id:'interactions',file:'src/chat-interactions/http.ts',fn:'handleInteractionRequest',prefix:'/api/chat/interactions/v1/',pathVars:['action'],methods:['POST']},
 {id:'support',file:'src/support.ts',fn:'supportRoute',prefix:'/api/support/v1',pathVars:['rest']},
 // Body-dispatched: one mounted route (POST /api/projects/:id/modules) selects an operation from this table.
 {id:'modules',file:'src/shared-modules/policy.ts',prefix:'/api/projects/:id/modules#',tableKeys:'moduleOperations',methods:['POST']},
];
export const controlsFile='src/chat-controls.ts';

const walk=(node,visit)=>{visit(node);node.forEachChild(child=>{walk(child,visit);});};
const isKind=(node,kind)=>node?.kind===SyntaxKind[kind];
const stringValue=node=>isKind(node,'StringLiteral')||isKind(node,'NoSubstitutionTemplateLiteral')?node.text:undefined;
const lineOf=(file,node)=>file.text.slice(0,node.getStart()).split('\n').length;
const equality=op=>op===SyntaxKind.EqualsEqualsEqualsToken||op===SyntaxKind.EqualsEqualsToken;
function isPathExpression(node,vars){
 if(isKind(node,'Identifier'))return vars.includes(node.text);
 // `new URL(request.url).pathname` and `url.pathname`.
 return isKind(node,'PropertyAccessExpression')&&node.name.text==='pathname';
}
function isMethodExpression(node){
 return isKind(node,'Identifier')&&node.text==='method'||isKind(node,'PropertyAccessExpression')&&node.name.text==='method';
}
// A ternary such as `method==='POST'?await body(request):undefined` selects an argument, not a route.
function inTernaryCondition(n,boundary){
 for(let p=n.parent,child=n;p&&child!==boundary;child=p,p=p.parent)if(isKind(p,'ConditionalExpression')&&p.condition===child)return true;
 return false;
}
function methodLiterals(node){
 const found=new Set();
 walk(node,n=>{
  if(!isKind(n,'BinaryExpression')||!equality(n.operatorToken.kind)||inTernaryCondition(n,node))return;
  const value=isMethodExpression(n.left)?stringValue(n.right):isMethodExpression(n.right)?stringValue(n.left):undefined;
  if(value)found.add(value);
 });
 return found;
}
const statementList=node=>isKind(node,'Block')||isKind(node,'SourceFile')||isKind(node,'CaseClause')||isKind(node,'DefaultClause')||isKind(node,'ModuleBlock');
function contains(outer,inner){for(let n=inner;n;n=n.parent)if(n===outer)return true;return false;}
function references(node,name){let hit=false;walk(node,n=>{if(!hit&&isKind(n,'Identifier')&&n.text===name)hit=true;});return hit;}

const calls=(node,name)=>{let hit=false;walk(node,n=>{if(!hit&&isKind(n,'CallExpression')&&isKind(n.expression,'Identifier')&&n.expression.text===name)hit=true;});return hit;};
// The code that consumes a matcher: the `if` it guards, or (for a regex assigned to a const) every later
// sibling statement that reads the const.
function consumers(matcher){
 let statement=matcher;while(statement.parent&&!statementList(statement.parent))statement=statement.parent;
 const declared=isKind(statement,'VariableStatement')?statement.declarationList.declarations.find(d=>contains(d,matcher))?.name:undefined;
 if(declared&&isKind(declared,'Identifier')){
  const siblings=statement.parent.statements,start=siblings.indexOf(statement);
  return siblings.slice(start+1).filter(sibling=>references(sibling,declared.text));
 }
 let scope=matcher;while(scope.parent&&scope!==statement&&!isKind(scope,'IfStatement'))scope=scope.parent;
 return [scope];
}
// Methods that can reach a matcher: comparisons in enclosing `if` conditions plus those in its consumers.
function reachableMethods(matcher){
 const methods=new Set();
 for(let n=matcher.parent;n;n=n.parent){
  if(isKind(n,'IfStatement')&&!contains(n.expression,matcher)&&contains(n.thenStatement,matcher))for(const m of methodLiterals(n.expression))methods.add(m);
 }
 for(const scope of consumers(matcher))for(const m of methodLiterals(scope))methods.add(m);
 return methods;
}
const enclosingFunction=node=>{for(let n=node.parent;n;n=n.parent)if((isKind(n,'FunctionDeclaration')||isKind(n,'MethodDeclaration'))&&n.name)return n.name.text;};
function functionBody(file,name){
 let body;walk(file,n=>{if(!body&&isKind(n,'FunctionDeclaration')&&n.name?.text===name)body=n;});
 if(!body)throw Error(`Dispatcher function ${name} not found.`);
 return body;
}
function objectKeys(file,constName){
 let literal;
 walk(file,n=>{
  if(literal||!isKind(n,'VariableDeclaration')||n.name.text!==constName)return;
  let init=n.initializer;
  while(init&&(isKind(init,'CallExpression')||isKind(init,'AsExpression')||isKind(init,'SatisfiesExpression')||isKind(init,'ParenthesizedExpression')))init=isKind(init,'CallExpression')?init.arguments[0]:init.expression;
  if(isKind(init,'ObjectLiteralExpression'))literal=init;
 });
 if(!literal)throw Error(`Route table ${constName} is not a static object literal.`);
 return literal.properties.map(p=>({key:stringValue(p.name)??p.name.text,node:p}));
}

// The platform's shared gates, read from handle(): sub-dispatchers called before the exact-Origin check must
// carry their own check; everything handleWorkspace() reaches is behind both the gate and session admission.
function platformGates(file){
 const handle=functionBody(file,'handle');
 let origin;walk(handle,n=>{if(!origin&&isKind(n,'IfStatement')&&calls(n.expression,'sameOrigin'))origin=n;});
 if(!origin)throw Error('The exact-Origin gate was not found in handle().');
 const order={'exact-origin-gate':origin.getStart()};
 walk(handle,n=>{if(isKind(n,'CallExpression')&&isKind(n.expression,'Identifier')&&['handleIdentityRequest','handleSafetyCaseRequest','workspaceIdentity','handleWorkspace'].includes(n.expression.text))order[n.expression.text]??=n.getStart();});
 return {origin:origin.getStart(),originLine:lineOf(file,origin),order};
}
function beforeOrigin(node,gates){
 const fn=enclosingFunction(node);
 if(fn==='handle')return node.getStart()<gates.origin;
 // fetch() runs before handle(); handleWorkspace() is only called after the gate.
 return fn!=='handleWorkspace';
}

function extractDispatcher(file,d){
 const gates=d.id==='platform'?platformGates(file):undefined;
 const routes=[],scope=d.fn?functionBody(file,d.fn):file,add=(kind,match,node,methods)=>{
  const path=d.prefix&&kind!=='regex'?d.prefix+match:match;
  const route={dispatcher:d.id,file:d.file,kind,match,path,methods:[...(d.methods??(methods.size?[...methods]:['ANY']))].sort(),line:lineOf(file,node)};
  if(!d.tableKeys&&!isKind(node,'CaseClause')&&consumers(node).some(c=>calls(c,'requireFreshWorkspace')))route.freshnessCall=true;
  if(gates&&beforeOrigin(node,gates))route.beforeOriginGate=true;
  routes.push(route);
 };
 if(d.tableKeys){for(const {key,node} of objectKeys(file,d.tableKeys))add('exact',key,node,new Set());return routes;}
 walk(scope,n=>{
  if(isKind(n,'BinaryExpression')&&equality(n.operatorToken.kind)){
   const value=isPathExpression(n.left,d.pathVars)?stringValue(n.right):isPathExpression(n.right,d.pathVars)?stringValue(n.left):undefined;
   if(value!==undefined)add('exact',value,n,reachableMethods(n));
  }else if(isKind(n,'CallExpression')&&isKind(n.expression,'PropertyAccessExpression')){
   const name=n.expression.name.text,target=n.expression.expression,arg=n.arguments[0];
   if(name==='startsWith'&&isPathExpression(target,d.pathVars)&&stringValue(arg)!==undefined)add('prefix',stringValue(arg),n,reachableMethods(n));
   else if(name==='match'&&isPathExpression(target,d.pathVars)&&isKind(arg,'RegularExpressionLiteral'))add('regex',arg.text,n,reachableMethods(n));
   else if((name==='exec'||name==='test')&&isKind(target,'RegularExpressionLiteral')&&arg&&isPathExpression(arg,d.pathVars))add('regex',target.text,n,reachableMethods(n));
  }else if(isKind(n,'CaseClause')&&isKind(n.parent?.parent,'SwitchStatement')&&isPathExpression(n.parent.parent.expression,d.pathVars)&&stringValue(n.expression)!==undefined){
   add('exact',stringValue(n.expression),n,new Set());
  }
 });
 return routes;
}

// Typed Chat controls are the only path from Chat to confirmation verbs. Each `a.type==='x'` branch in
// chatControl() is a control; confirmationControls keys are the reviewed `confirm` kinds. recentAuth is read
// from the literal returned by each branch so a silent change to the freshness requirement is detected.
function extractControls(file){
 const controls=new Map(),body=functionBody(file,'chatControl');
 const typeOf=n=>{
  for(let p=n.parent;p&&p!==body;p=p.parent){
   if(!isKind(p,'IfStatement'))continue;
   let type,operation;
   walk(p.expression,c=>{
    if(!isKind(c,'BinaryExpression')||!equality(c.operatorToken.kind)||!isKind(c.left,'PropertyAccessExpression'))return;
    if(c.left.name.text==='type'&&stringValue(c.right))type=stringValue(c.right);
    if(c.left.name.text==='operation'&&stringValue(c.right))operation=stringValue(c.right);
   });
   if(type){
    // A nested operation branch refines its enclosing type branch.
    if(!operation)for(let q=n.parent;q&&q!==p;q=q.parent)if(isKind(q,'IfStatement'))walk(q.expression,c=>{if(isKind(c,'BinaryExpression')&&isKind(c.left,'PropertyAccessExpression')&&c.left.name.text==='operation'&&stringValue(c.right))operation=stringValue(c.right);});
    return operation?`${type}/${operation}`:type;
   }
  }
 };
 walk(body,n=>{
  if(!isKind(n,'ObjectLiteralExpression'))return;
  const recent=n.properties.find(p=>p.name?.text==='recentAuth');
  if(!recent||!n.properties.some(p=>p.name?.text==='command'))return;
  const id=typeOf(n);if(!id)throw Error(`Chat control at ${controlsFile}:${lineOf(file,n)} has no type branch.`);
  const value=recent.initializer.kind===SyntaxKind.TrueKeyword?true:recent.initializer.kind===SyntaxKind.FalseKeyword?false:undefined;
  if(value===undefined)throw Error(`Chat control ${id} recentAuth is not a literal.`);
  const previous=controls.get(id);
  if(previous&&previous.recentAuth!==value)throw Error(`Chat control ${id} has inconsistent recentAuth.`);
  controls.set(id,{id,recentAuth:value,line:lineOf(file,n)});
 });
 const confirm=controls.get('confirm');
 if(!confirm)throw Error('The reviewed confirm control was not found.');
 controls.delete('confirm');
 for(const {key,node} of objectKeys(file,'confirmationControls'))controls.set('confirm:'+key,{id:'confirm:'+key,recentAuth:confirm.recentAuth,line:lineOf(file,node)});
 return [...controls.values()].sort((a,b)=>a.id.localeCompare(b.id));
}

/** Parse the dispatcher files. `overrides` maps a repository path to replacement source (mutation checks). */
export function extractSurface({cwd=root,overrides={}}={}){
 const work=mkdtempSync(join(tmpdir(),'whumpo-boundary-'));
 const files=[...dispatchers.map(d=>d.file),controlsFile];
 const mapped=Object.fromEntries(files.map(f=>{
  if(!Object.hasOwn(overrides,f))return [f,resolve(cwd,f)];
  const copy=join(work,f.replaceAll('/','__'));writeFileSync(copy,overrides[f]);return [f,copy];
 }));
 writeFileSync(join(work,'tsconfig.json'),JSON.stringify({compilerOptions:{noResolve:true,noLib:true,types:[],allowJs:false,skipLibCheck:true},files:Object.values(mapped)}));
 const api=new API({cwd:work});
 try{
  const snapshot=api.updateSnapshot({openProject:join(work,'tsconfig.json')}),project=snapshot.getProjects()[0];
  const parse=f=>{const file=project.program.getSourceFile(mapped[f]);if(!file)throw Error(`Could not parse ${f}.`);return file;};
  const routes=dispatchers.flatMap(d=>extractDispatcher(parse(d.file),d));
  const {order,originLine}=platformGates(parse('src/index.ts'));
  const surface={routes,controls:extractControls(parse(controlsFile)),gates:{originLine,order:Object.entries(order).sort((a,b)=>a[1]-b[1]).map(([name])=>name)}};
  snapshot.dispose();
  return surface;
 }finally{api.close();rmSync(work,{recursive:true,force:true});}
}

export const routeKey=r=>`${r.file} ${r.kind} ${r.match} [${r.methods.join(',')}]`;
export function loadRegistry(cwd=root){return JSON.parse(readFileSync(resolve(cwd,registryPath),'utf8'));}

function anchorProblems(where,anchors,cwd,cache){
 const problems=[];
 for(const anchor of anchors??[]){
  if(typeof anchor?.file!=='string'||typeof anchor.contains!=='string'||anchor.contains.length<12){problems.push(`${where}: anchor needs file and a distinctive contains string`);continue;}
  const path=resolve(cwd,anchor.file);
  if(!path.startsWith(cwd+'/')||!existsSync(path)){problems.push(`${where}: ${anchor.file} does not exist`);continue;}
  if(!cache.has(path))cache.set(path,readFileSync(path,'utf8'));
  if(!cache.get(path).includes(anchor.contains))problems.push(`${where}: ${anchor.file} no longer contains ${JSON.stringify(anchor.contains)}`);
 }
 return problems;
}

/** Every problem that makes the registry an inaccurate account of the current mounted surface. */
export function registryProblems(registry,surface,{cwd=root,report}={}){
 const problems=[],cache=new Map(),entries=new Map(),controls=new Map(),ids=new Set(),findings=new Set();
 if(registry.version!==1)problems.push('registry version must be 1');
 const doc=report??(existsSync(resolve(cwd,reportPath))?readFileSync(resolve(cwd,reportPath),'utf8'):'');
 for(const finding of registry.findings??[]){
  if(!/^B\d+$/.test(finding.id??'')||findings.has(finding.id))problems.push(`finding ${finding.id}: invalid or duplicate id`);
  findings.add(finding.id);
  if(!doc.includes(`### ${finding.id} `))problems.push(`finding ${finding.id}: missing "### ${finding.id} " section in ${reportPath}`);
  problems.push(...anchorProblems(`finding ${finding.id}`,finding.evidence,cwd,cache));
 }
 for(const family of registry.families??[]){
  const where=`family ${family.id}`;
  if(!family.id||ids.has(family.id))problems.push(`${where}: missing or duplicate id`);
  ids.add(family.id);
  if(!Array.isArray(family.privileged)||family.privileged.some(c=>!privilegeClasses.includes(c)))problems.push(`${where}: privileged must list known classes (${privilegeClasses.join(', ')})`);
  if(typeof family.authorityClass!=='string'||!family.authorityClass)problems.push(`${where}: authorityClass is required`);
  if(!(family.entries?.length||family.controls?.length))problems.push(`${where}: no entry points`);
  for(const entry of family.entries??[]){
   const key=routeKey(entry);
   if(entries.has(key))problems.push(`${where}: ${key} is also registered by ${entries.get(key)}`);
   entries.set(key,family.id);
  }
  for(const control of family.controls??[]){
   if(controls.has(control.id))problems.push(`${where}: control ${control.id} is also registered by ${controls.get(control.id).family}`);
   controls.set(control.id,{...control,family:family.id});
  }
  const required=family.privileged?.length?cellNames:['authority','origin'];
  for(const name of cellNames){
   const cell=family.cells?.[name],at=`${where} cell ${name}`;
   if(!cell){if(required.includes(name))problems.push(`${at}: required for ${family.privileged?.length?'privileged':'every'} family`);continue;}
   if(!cellStates.includes(cell.state)){problems.push(`${at}: state must be one of ${cellStates.join(', ')}`);continue;}
   if(typeof cell.detail!=='string'||cell.detail.length<10)problems.push(`${at}: detail is required`);
   if(cell.state==='evidenced'&&(!cell.enforcedAt?.length||!cell.tests?.length))problems.push(`${at}: evidenced needs enforcedAt and tests anchors`);
   if(cell.state==='gap'&&!['control','test'].includes(cell.gapKind))problems.push(`${at}: gap needs gapKind control or test`);
   if(cell.state==='gap'&&cell.gapKind==='control'&&!findings.has(cell.finding))problems.push(`${at}: a control gap must name a recorded finding`);
   if(cell.state==='unverified'&&!cell.needs)problems.push(`${at}: unverified needs a "needs" statement`);
   for(const t of cell.tests??[])if(!/^tests\/[\w./-]+\.mjs$/.test(t.file??'')||typeof t.asserts!=='string')problems.push(`${at}: test anchors must name a tests/*.mjs file and what it asserts`);
   problems.push(...anchorProblems(at,cell.enforcedAt,cwd,cache),...anchorProblems(at,cell.tests,cwd,cache));
  }
 }
 const extracted=new Map();
 for(const r of surface.routes){
  const key=routeKey(r),seen=extracted.get(key);
  // Repeated comparisons of one matcher (e.g. inside a ternary) merge; any gate flag on an occurrence counts.
  extracted.set(key,seen?{...seen,freshnessCall:seen.freshnessCall||r.freshnessCall,beforeOriginGate:seen.beforeOriginGate||r.beforeOriginGate}:r);
 }
 const registered=new Map((registry.families??[]).flatMap(f=>(f.entries??[]).map(e=>[routeKey(e),e])));
 for(const [key,r] of extracted){
  if(!entries.has(key)){problems.push(`unregistered route: ${key} (${r.file}:${r.line}, path ${r.path})`);continue;}
  const e=registered.get(key);
  if(!!e.freshnessCall!==!!r.freshnessCall)problems.push(`${key}: registry says freshnessCall ${!!e.freshnessCall}, source says ${!!r.freshnessCall} (${r.file}:${r.line})`);
  if(!!e.beforeOriginGate!==!!r.beforeOriginGate)problems.push(`${key}: registry says beforeOriginGate ${!!e.beforeOriginGate}, source says ${!!r.beforeOriginGate} (${r.file}:${r.line})`);
 }
 for(const [key,family] of entries)if(!extracted.has(key))problems.push(`registered route no longer mounted: ${key} (family ${family})`);
 if(JSON.stringify(registry.gates?.order)!==JSON.stringify(surface.gates.order))problems.push(`platform dispatch order changed: registry ${JSON.stringify(registry.gates?.order)}, source ${JSON.stringify(surface.gates.order)} (exact-Origin gate at src/index.ts:${surface.gates.originLine})`);
 const mounted=new Map(surface.controls.map(c=>[c.id,c]));
 for(const [id,c] of mounted){
  const registered=controls.get(id);
  if(!registered)problems.push(`unregistered Chat control: ${id} (${controlsFile}:${c.line})`);
  else if(registered.recentAuth!==c.recentAuth)problems.push(`Chat control ${id}: registry says recentAuth ${registered.recentAuth}, source says ${c.recentAuth}`);
 }
 for(const id of controls.keys())if(!mounted.has(id))problems.push(`registered Chat control no longer exists: ${id}`);
 return problems;
}

export function summarize(registry){
 const counts=Object.fromEntries(cellNames.map(n=>[n,Object.fromEntries(cellStates.map(s=>[s,0]))]));
 let privileged=0,entries=0,controls=0,missing=0;
 for(const family of registry.families){
  if(family.privileged.length)privileged++;
  entries+=family.entries?.length??0;controls+=family.controls?.length??0;
  for(const n of cellNames){const s=family.cells[n]?.state;if(s)counts[n][s]++;else missing++;}
 }
 const lines=[
  `Families: ${registry.families.length} (${privileged} privileged). Registered route matchers: ${entries}. Typed Chat controls: ${controls}. Recorded findings: ${(registry.findings??[]).length}.`,
  '',
  `| Cell | ${cellStates.join(' | ')} |`,
  `| --- | ${cellStates.map(()=>'---:').join(' | ')} |`,
  ...cellNames.map(n=>`| ${n} | ${cellStates.map(s=>counts[n][s]).join(' | ')} |`),
  '',
  `Cells not recorded (allowed only for non-privileged families): ${missing}.`,
  '',
  `| Family | Privileged | Matchers / controls | ${cellNames.join(' | ')} |`,
  `| --- | --- | ---: | ${cellNames.map(()=>'---').join(' | ')} |`,
  ...registry.families.map(f=>`| ${f.id} | ${f.privileged.join(', ')||'no'} | ${f.entries?.length??0} / ${f.controls?.length??0} | ${cellNames.map(n=>{const c=f.cells[n];return c?c.state+(c.gapKind?` (${c.gapKind}${c.finding?' '+c.finding:''})`:''):'—';}).join(' | ')} |`),
 ];
 return lines.join('\n');
}
export const summaryStart='<!-- boundary-audit summary: generated by `node tools/boundary-audit.mjs summary`; checked by tests/boundary-audit.mjs -->';
export const summaryEnd='<!-- /boundary-audit summary -->';
export function summaryBlock(registry){return `${summaryStart}\n${summarize(registry)}\n${summaryEnd}`;}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const command=process.argv[2]??'check';
  if(command==='list'){const s=extractSurface();console.log(JSON.stringify(s,null,1));}
  else if(command==='summary')console.log(summaryBlock(loadRegistry()));
  else if(command==='check'){
   const problems=registryProblems(loadRegistry(),extractSurface());
   if(problems.length){console.error(problems.join('\n'));process.exitCode=1;}
   else console.log('Boundary registry matches the mounted platform surface.');
  }else throw Error('Usage: node tools/boundary-audit.mjs [check|list|summary]');
 }catch(error){console.error(error.message);process.exitCode=1;}
}

// WH-004 boundary audit: structural inventory of the request surface of all four Workers (platform, sites, apps,
// runtime), the platform's scheduled jobs, the Worker reachability declared in wrangler*.jsonc and the operator CLI
// tools that can reach remote state, compared against the checked-in evidence registry docs/boundary-audit.json.
//
// Extraction uses the TypeScript 7 syntax tree (typescript/unstable/sync), not text search, so comments,
// string contents and fixtures cannot create or hide a route. It is offline: the native compiler parses a
// temporary project that lists only the audited files (noResolve), and nothing is executed or deployed. Tool
// files are parsed, never imported or run.
//
//   node tools/boundary-audit.mjs check     validate the registry against current source (default)
//   node tools/boundary-audit.mjs list      print the extracted surface as JSON
//   node tools/boundary-audit.mjs summary   print the matrix summary block used in docs/boundary-audit.md
import {mkdtempSync,rmSync,writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {API} from 'typescript/unstable/sync';
import {SyntaxKind} from 'typescript/unstable/ast';

export const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const registryPath='docs/boundary-audit.json';
export const reportPath='docs/boundary-audit.md';
// `admission` (Turnstile, rate limits, per-client/fairness controls) and `tenant` (tenant/visitor scoping with
// cross-tenant refusal evidence) were added in slice 2 for the visitor, service, scheduled and operator surfaces.
export const cellNames=['authority','origin','freshness','target','replay','stale','admission','tenant'];
export const cellStates=['evidenced','gap','n/a','unverified'];
export const privilegeClasses=['publish','activation','dns-hosting','backup','cms','billing','deletion','connection','safety-operator','credential','data-change','access','visitor-data','execution','release','operator','notification'];
// Which cells each family must record, by the surface it belongs to. Slice-1 families have no `surface` field
// and are `platform-api`. `reach` (who can reach the family) is required for every non-platform-api surface.
export const surfaces={
 'platform-api':{privileged:['authority','origin','freshness','target','replay','stale'],other:['authority','origin']},
 visitor:{privileged:['authority','origin','admission','tenant','target','replay','stale'],other:['authority','origin','admission','tenant']},
 service:{privileged:['authority','origin','admission','tenant','target','replay','stale'],other:['authority','origin','admission','tenant']},
 scheduled:{privileged:['authority','tenant','target','replay','stale'],other:['authority','tenant']},
 'operator-tool':{privileged:['authority','target','replay','stale','tenant'],other:['authority']},
};

// Every file that decides which handler a request reaches. `prefix` is the mounted path the sub-dispatcher strips
// before comparing; `pathVars` are the identifiers holding the remaining path. `hosts` also extracts host/origin
// dispatch (true for the whole scope, or a list of function names); `methodGates` applies early-return method
// refusals (`if(method!=='GET'&&method!=='HEAD')return`) to the matchers they dominate; `negatedGates` reads
// `if(method!=='POST'||pathname!=='/execute')return` as the single accepted route; `originGate` flags matchers
// that run before the dispatcher's own Origin/Sec-Fetch-Site refusal.
export const dispatchers=[
 {id:'platform',worker:'whumpo-platform',file:'src/index.ts',pathVars:['pathname'],hosts:['fetch']},
 {id:'mobile',file:'src/mobile/router.ts',fn:'handleMobileRequest',prefix:'/api/mobile/v1/',pathVars:['action']},
 {id:'identity',file:'src/workspace-identity/http.ts',fn:'handleIdentityRequest',prefix:'/api/auth/identity/v1/',pathVars:['action'],methods:['POST']},
 {id:'operator',file:'src/safety-case-http.ts',prefix:'/api/operator/safety-cases/v1/',tableKeys:'actions',methods:['POST']},
 {id:'account-lifecycle',file:'src/account-lifecycle/http.ts',fn:'handleAccountLifecycleRequest',prefix:'/api/account/v1/',tableKeys:'actions',methods:['POST']},
 {id:'interactions',file:'src/chat-interactions/http.ts',fn:'handleInteractionRequest',prefix:'/api/chat/interactions/v1/',pathVars:['action'],methods:['POST']},
 {id:'support',file:'src/support.ts',fn:'supportRoute',prefix:'/api/support/v1',pathVars:['rest']},
 // Body-dispatched: one mounted route (POST /api/projects/:id/modules) selects an operation from this table.
 {id:'modules',file:'src/shared-modules/policy.ts',prefix:'/api/projects/:id/modules#',tableKeys:'moduleOperations',methods:['POST']},
 // Slice 2: the visitor-facing Workers and the service-binding-only runtime.
 {id:'sites',worker:'whumpo-sites',file:'src/site-host.ts',pathVars:[],hosts:true,methodGates:true},
 {id:'apps-host',worker:'whumpo-apps',file:'src/app-host.ts',pathVars:[],hosts:true,methodGates:true},
 {id:'apps-gateway',worker:'whumpo-apps',file:'src/app-gateway.ts',fn:'applicationGateway',prefix:'/apps/:project/',pathVars:['path'],hosts:true,methodGates:true,originGate:true},
 {id:'runtime',worker:'whumpo-runtime',file:'src/runtime/worker.ts',pathVars:[],methodGates:true,negatedGates:true},
];
export const controlsFile='src/chat-controls.ts';
export const scheduledFile='src/index.ts';
export const workerConfigs=['wrangler.jsonc','wrangler.sites.jsonc','wrangler.apps.jsonc','wrangler.runtime.jsonc'];
// String literals (never comments) that let an operator tool reach remote state directly. Wrangler subprocesses
// without --remote are local. A tool that imports a remote-capable tools/ module is remote-capable through it.
export const remoteMarkers=[
 ['cloudflare-api',/https:\/\/api\.cloudflare\.com/],
 ['github-api',/https:\/\/api\.github\.com|https:\/\/github\.com\/login\/oauth/],
 ['stripe-api',/https:\/\/api\.stripe\.com/],
 ['wrangler-remote',/^--remote$|\s--remote(\s|$)/],
];
const subprocessCalls=['execFileSync','execFile','spawnSync','spawn','execSync','exec'];

const walk=(node,visit)=>{visit(node);node.forEachChild(child=>{walk(child,visit);});};
const isKind=(node,kind)=>node?.kind===SyntaxKind[kind];
const stringValue=node=>isKind(node,'StringLiteral')||isKind(node,'NoSubstitutionTemplateLiteral')?node.text:undefined;
const lineOf=(file,node)=>file.text.slice(0,node.getStart()).split('\n').length;
const sourceText=(file,node)=>file.text.slice(node.getStart(),node.end).replace(/\s+/g,' ');
const equality=op=>op===SyntaxKind.EqualsEqualsEqualsToken||op===SyntaxKind.EqualsEqualsToken;
const inequality=op=>op===SyntaxKind.ExclamationEqualsEqualsToken||op===SyntaxKind.ExclamationEqualsToken;
function isPathExpression(node,vars){
 if(isKind(node,'Identifier'))return vars.includes(node.text);
 if(isKind(node,'ParenthesizedExpression'))return isPathExpression(node.expression,vars);
 // `(local?url.pathname:'/apps/'+project+url.pathname)` selects or prefixes the request path; it is still the path.
 if(isKind(node,'ConditionalExpression'))return isPathExpression(node.whenTrue,vars)||isPathExpression(node.whenFalse,vars);
 if(isKind(node,'BinaryExpression')&&node.operatorToken.kind===SyntaxKind.PlusToken)return isPathExpression(node.right,vars);
 // `new URL(request.url).pathname` and `url.pathname`.
 return isKind(node,'PropertyAccessExpression')&&node.name.text==='pathname';
}
// `url.hostname` / `url.origin` read in a dispatch decision (not `{hostname:url.hostname}` passed as data).
const isHostAccess=node=>isKind(node,'PropertyAccessExpression')&&['hostname','origin'].includes(node.name.text);
function constInitializer(file,name){
 let init;walk(file,n=>{if(!init&&isKind(n,'VariableDeclaration')&&isKind(n.name,'Identifier')&&n.name.text===name)init=n.initializer;});
 return init;
}
// A matcher regex: a literal, `new RegExp(template)`, or a const holding either.
function regexText(file,arg){
 if(isKind(arg,'RegularExpressionLiteral'))return arg.text;
 if(isKind(arg,'NewExpression')&&isKind(arg.expression,'Identifier')&&arg.expression.text==='RegExp'&&arg.arguments?.[0])return `new RegExp(${sourceText(file,arg.arguments[0])})`;
 if(isKind(arg,'Identifier')){const init=constInitializer(file,arg.text);if(init&&init!==arg)return regexText(file,init);}
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
// A property name (`path.match`) is not a reference to a variable called `match`.
function references(node,name){let hit=false;walk(node,n=>{if(!hit&&isKind(n,'Identifier')&&n.text===name&&!(isKind(n.parent,'PropertyAccessExpression')&&n.parent.name===n))hit=true;});return hit;}

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
const functionLike=n=>['FunctionDeclaration','MethodDeclaration','ArrowFunction','FunctionExpression'].some(k=>isKind(n,k));
const returns=s=>isKind(s,'ReturnStatement')||isKind(s,'Block')&&Array.from(s.statements).some(c=>isKind(c,'ReturnStatement'));
// The methods an early-return refusal lets through, if its condition is purely a method refusal:
// `method!=='GET'&&method!=='HEAD'` or `!['GET','POST'].includes(method)`.
function gateMethods(cond){
 if(isKind(cond,'ParenthesizedExpression'))return gateMethods(cond.expression);
 if(isKind(cond,'PrefixUnaryExpression')&&cond.operator===SyntaxKind.ExclamationToken){
  const c=cond.operand;
  if(isKind(c,'CallExpression')&&isKind(c.expression,'PropertyAccessExpression')&&c.expression.name.text==='includes'&&isKind(c.expression.expression,'ArrayLiteralExpression')&&c.arguments[0]&&isMethodExpression(c.arguments[0])){
   const values=Array.from(c.expression.expression.elements).map(stringValue);
   return values.every(v=>v!==undefined)?new Set(values):undefined;
  }
  return;
 }
 if(!isKind(cond,'BinaryExpression'))return;
 if(cond.operatorToken.kind===SyntaxKind.AmpersandAmpersandToken){const a=gateMethods(cond.left),b=gateMethods(cond.right);return a&&b?new Set([...a,...b]):undefined;}
 if(!inequality(cond.operatorToken.kind))return;
 const value=isMethodExpression(cond.left)?stringValue(cond.right):isMethodExpression(cond.right)?stringValue(cond.left):undefined;
 return value?new Set([value]):undefined;
}
const methodGate=s=>isKind(s,'IfStatement')&&!s.elseStatement&&returns(s.thenStatement)?gateMethods(s.expression):undefined;
// Method refusals that run before the matcher (earlier siblings in any enclosing block of the same function) or at
// the top of the handler it guards.
function dominatingGates(matcher){
 const sets=[];
 for(let child=matcher,p=matcher.parent;p&&!functionLike(child);child=p,p=p.parent){
  if(!statementList(p)||!p.statements)continue;
  const siblings=Array.from(p.statements);
  for(const s of siblings.slice(0,siblings.indexOf(child))){const g=methodGate(s);if(g)sets.push(g);}
 }
 for(const scope of consumers(matcher))if(isKind(scope,'IfStatement')&&isKind(scope.thenStatement,'Block'))for(const s of scope.thenStatement.statements){const g=methodGate(s);if(g)sets.push(g);}
 return sets;
}
function gatedMethods(matcher){
 const positive=reachableMethods(matcher),gates=dominatingGates(matcher);
 if(!gates.length)return positive;
 const allowed=gates.reduce((a,g)=>new Set([...a].filter(m=>g.has(m))));
 const result=positive.size?new Set([...positive].filter(m=>allowed.has(m))):allowed;
 return result.size?result:new Set(['NONE']);
}
const headerRead=(node,name)=>{let hit=false;walk(node,n=>{if(!hit&&isKind(n,'CallExpression')&&isKind(n.expression,'PropertyAccessExpression')&&n.expression.name.text==='get'&&stringValue(n.arguments[0])?.toLowerCase()===name)hit=true;});return hit;};
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
 walk(handle,n=>{if(isKind(n,'CallExpression')&&isKind(n.expression,'Identifier')&&['handleMobileRequest','handleIdentityRequest','handleSafetyCaseRequest','handleAccountLifecycleRequest','workspaceIdentity','handleWorkspace'].includes(n.expression.text))order[n.expression.text]??=n.getStart();});
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
 const scope=d.fn?functionBody(file,d.fn):file;
 let ownOrigin;if(d.originGate)walk(scope,n=>{if(!ownOrigin&&isKind(n,'IfStatement')&&returns(n.thenStatement)&&headerRead(n.expression,'origin'))ownOrigin=n;});
 const methodsOf=n=>d.methodGates?gatedMethods(n):reachableMethods(n);
 const routes=[],add=(kind,match,node,methods)=>{
  const path=d.prefix&&kind!=='regex'&&kind!=='host'?d.prefix+match:match;
  const route={dispatcher:d.id,file:d.file,kind,match,path,methods:[...(d.methods??(methods.size?[...methods]:['ANY']))].sort(),line:lineOf(file,node)};
  if(!d.tableKeys&&!isKind(node,'CaseClause')&&kind!=='host'&&consumers(node).some(c=>calls(c,'requireFreshWorkspace')))route.freshnessCall=true;
  if(gates&&beforeOrigin(node,gates))route.beforeOriginGate=true;
  // A dispatcher with its own Origin refusal: a matcher before it (or every matcher, if it disappears) is flagged.
  if(d.originGate&&(!ownOrigin||node.getStart()<ownOrigin.getStart()))route.beforeOriginGate=true;
  routes.push(route);
 };
 if(d.tableKeys){for(const {key,node} of objectKeys(file,d.tableKeys))add('exact',key,node,new Set());return routes;}
 const hostScan=n=>d.hosts===true||Array.isArray(d.hosts)&&d.hosts.includes(enclosingFunction(n));
 walk(scope,n=>{
  if(d.hosts&&hostScan(n)){
   if(isKind(n,'CallExpression')&&Array.from(n.arguments).some(a=>isKind(a,'PropertyAccessExpression')&&a.name.text==='hostname'))add('host',sourceText(file,n),n,new Set());
   else if(isKind(n,'BinaryExpression')&&(equality(n.operatorToken.kind)||inequality(n.operatorToken.kind))&&(isHostAccess(n.left)||isHostAccess(n.right)))add('host',sourceText(file,n),n,new Set());
  }
  if(isKind(n,'BinaryExpression')&&equality(n.operatorToken.kind)){
   const value=isPathExpression(n.left,d.pathVars)?stringValue(n.right):isPathExpression(n.right,d.pathVars)?stringValue(n.left):undefined;
   if(value!==undefined)add('exact',value,n,methodsOf(n));
  }else if(d.negatedGates&&isKind(n,'BinaryExpression')&&inequality(n.operatorToken.kind)){
   // `if(method!=='POST'||pathname!=='/execute')return refusal`: the only accepted route is POST /execute.
   const value=isPathExpression(n.left,d.pathVars)?stringValue(n.right):isPathExpression(n.right,d.pathVars)?stringValue(n.left):undefined;
   if(value===undefined)return;
   let top=n;while(isKind(top.parent,'ParenthesizedExpression')||isKind(top.parent,'BinaryExpression')&&top.parent.operatorToken.kind===SyntaxKind.BarBarToken)top=top.parent;
   if(!isKind(top.parent,'IfStatement')||top.parent.expression!==top||!returns(top.parent.thenStatement))return;
   const leaves=[],collect=x=>{if(isKind(x,'ParenthesizedExpression'))collect(x.expression);else if(isKind(x,'BinaryExpression')&&x.operatorToken.kind===SyntaxKind.BarBarToken){collect(x.left);collect(x.right);}else leaves.push(x);};
   collect(top);
   add('exact',value,n,new Set(leaves.map(l=>isKind(l,'BinaryExpression')&&inequality(l.operatorToken.kind)?gateMethods(l):undefined).filter(Boolean).flatMap(s=>[...s])));
  }else if(isKind(n,'CallExpression')&&isKind(n.expression,'PropertyAccessExpression')){
   const name=n.expression.name.text,target=n.expression.expression,arg=n.arguments[0];
   if(name==='startsWith'&&isPathExpression(target,d.pathVars)&&stringValue(arg)!==undefined)add('prefix',stringValue(arg),n,methodsOf(n));
   else if(name==='match'&&isPathExpression(target,d.pathVars)&&arg&&regexText(file,arg)!==undefined)add('regex',regexText(file,arg),n,methodsOf(n));
   else if((name==='exec'||name==='test')&&isKind(target,'RegularExpressionLiteral')&&arg&&isPathExpression(arg,d.pathVars))add('regex',target.text,n,methodsOf(n));
   // `['/visitor.js','/visitor.css'].includes(url.pathname)`: one exact matcher per literal.
   else if(name==='includes'&&isKind(target,'ArrayLiteralExpression')&&arg&&isPathExpression(arg,d.pathVars))for(const e of target.elements){const v=stringValue(e);if(v!==undefined)add('exact',v,n,methodsOf(n));}
  }else if(isKind(n,'CaseClause')&&isKind(n.parent?.parent,'SwitchStatement')&&isPathExpression(n.parent.parent.expression,d.pathVars)&&stringValue(n.expression)!==undefined){
   add('exact',stringValue(n.expression),n,new Set());
  }
 });
 return routes;
}

// The platform's scheduled handler: each cron branch and the maintenance jobs it runs. A job is a
// `{name,run[,enabled]}` entry in a runMaintenance() list, or an awaited call in a branch without one.
function extractScheduled(file){
 let method;walk(file,n=>{if(!method&&isKind(n,'MethodDeclaration')&&n.name?.text==='scheduled')method=n;});
 if(!method)throw Error(`The scheduled handler was not found in ${scheduledFile}.`);
 const cronLiteral=expr=>{let v;walk(expr,c=>{if(v===undefined&&isKind(c,'BinaryExpression')&&equality(c.operatorToken.kind)){const side=isKind(c.left,'PropertyAccessExpression')&&c.left.name.text==='cron'?c.right:isKind(c.right,'PropertyAccessExpression')&&c.right.name.text==='cron'?c.left:undefined;if(side)v=stringValue(side);}});return v;};
 const branches=new Set();walk(method,n=>{if(isKind(n,'IfStatement')){const v=cronLiteral(n.expression);if(v)branches.add(v);}});
 const cronOf=n=>{for(let p=n.parent;p&&p!==method;p=p.parent)if(isKind(p,'IfStatement')&&contains(p.thenStatement,n)){const v=cronLiteral(p.expression);if(v)return v;}return 'default';};
 const jobs=[],job=(cron,name,node,conditional)=>jobs.push({dispatcher:'scheduled',file:scheduledFile,kind:'job',match:`${cron} ${name}`,path:`scheduled ${cron} ${name}`,methods:['SCHEDULED'],line:lineOf(file,node),...(conditional?{conditional:true}:{})});
 const withLists=new Set();
 walk(method,n=>{
  if(!isKind(n,'CallExpression')||!isKind(n.expression,'Identifier')||n.expression.text!=='runMaintenance')return;
  const cron=cronOf(n),list=n.arguments[1];withLists.add(cron);
  if(!isKind(list,'ArrayLiteralExpression'))throw Error(`runMaintenance at ${scheduledFile}:${lineOf(file,n)} has no static job list.`);
  for(const element of list.elements){
   const object=isKind(element,'Identifier')?constInitializer(method,element.text):element;
   const props=isKind(object,'ObjectLiteralExpression')?Array.from(object.properties):[];
   let value=props.find(p=>p.name?.text==='name')?.initializer;while(isKind(value,'AsExpression'))value=value.expression;
   const name=stringValue(value);
   if(!name)throw Error(`Maintenance job at ${scheduledFile}:${lineOf(file,element)} has no literal name.`);
   job(cron,name,element,props.some(p=>p.name?.text==='enabled'));
  }
 });
 walk(method,n=>{
  if(!isKind(n,'AwaitExpression')||!isKind(n.expression,'CallExpression')||!isKind(n.expression.expression,'Identifier'))return;
  const cron=cronOf(n);if(withLists.has(cron)||n.expression.expression.text==='runMaintenance')return;
  let conditional=false;for(let p=n.parent;p&&p!==method;p=p.parent)if(isKind(p,'IfStatement')&&!cronLiteral(p.expression))conditional=true;
  job(cron,n.expression.expression.text,n,conditional);
 });
 return {branches:[...branches].sort(),jobs};
}

// Operator tools that can reach remote state: a remote marker in a string literal, or a static import of a
// remote-capable tools/ module.
function extractTools(parsed){
 const info=new Map();
 for(const [path,file] of parsed){
  const markers=new Set(),imports=new Set();
  walk(file,n=>{
   const text=isKind(n,'StringLiteral')||isKind(n,'NoSubstitutionTemplateLiteral')||isKind(n,'TemplateHead')||isKind(n,'TemplateMiddle')||isKind(n,'TemplateTail')?n.text:undefined;
   const specifier=isKind(n,'ImportDeclaration')||isKind(n,'ExportDeclaration')?stringValue(n.moduleSpecifier):isKind(n,'CallExpression')&&n.expression.kind===SyntaxKind.ImportKeyword?stringValue(n.arguments[0]):undefined;
   if(specifier?.startsWith('./'))imports.add('tools/'+specifier.slice(2));
   else if(text!==undefined&&!(isKind(n.parent,'ImportDeclaration')||isKind(n.parent,'ExportDeclaration')))for(const [name,re] of remoteMarkers)if(re.test(text))markers.add(name);
   // Subprocesses that are remote without --remote: the GitHub CLI, and Wrangler deploy/versions/secret commands.
   if(isKind(n,'CallExpression')&&isKind(n.expression,'Identifier')&&subprocessCalls.includes(n.expression.text)){
    if(stringValue(n.arguments[0])==='gh')markers.add('gh-cli');
    const args=isKind(n.arguments[1],'ArrayLiteralExpression')?Array.from(n.arguments[1].elements).map(stringValue):[];
    if(args.some(a=>a==='wrangler'||a?.endsWith('wrangler/bin/wrangler.js'))){
     if(args.includes('secret'))markers.add('wrangler-secret');
     if((args.includes('deploy')||args.includes('versions'))&&!args.includes('--dry-run'))markers.add('wrangler-deploy');
    }
   }
  });
  info.set(path,{markers,imports});
 }
 const remote=new Set([...info].filter(([,i])=>i.markers.size).map(([p])=>p));
 for(let changed=true;changed;){changed=false;for(const [p,i] of info)if(!remote.has(p)&&[...i.imports].some(x=>remote.has(x))){remote.add(p);changed=true;}}
 return [...remote].sort().map(path=>{
  const {markers,imports}=info.get(path);
  return {dispatcher:'tools',file:path,kind:'tool',match:markers.size?[...markers].sort().join('+'):'via-import',path,methods:['CLI'],line:1,via:[...imports].filter(x=>remote.has(x)).sort()};
 });
}

// Who can reach each Worker, from its wrangler config: public routes, workers.dev/preview URLs, service bindings, crons.
function readWorkers(cwd,overrides){
 return workerConfigs.map(config=>{
  const c=JSON.parse(Object.hasOwn(overrides,config)?overrides[config]:readFileSync(resolve(cwd,config),'utf8'));
  const routes=(c.routes??[]).map(r=>typeof r==='string'?r:r.pattern+(r.custom_domain?' [custom domain]':'')).sort();
  return {name:c.name,config,main:c.main,routes,workersDev:c.workers_dev??'unset',previewUrls:c.preview_urls??'unset',
   publicInternet:routes.length>0||c.workers_dev!==false||c.preview_urls!==false,
   services:(c.services??[]).map(s=>`${s.binding}->${s.service}${s.entrypoint?'#'+s.entrypoint:''}`).sort(),crons:[...(c.triggers?.crons??[])]};
 });
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
 const tools=[...new Set([...readdirSync(resolve(cwd,'tools')).filter(f=>f.endsWith('.mjs')).map(f=>'tools/'+f),...Object.keys(overrides).filter(f=>/^tools\/[^/]+\.mjs$/.test(f))])].sort();
 const files=[...new Set([...dispatchers.map(d=>d.file),controlsFile,scheduledFile,...tools])];
 const mapped=Object.fromEntries(files.map(f=>{
  if(!Object.hasOwn(overrides,f))return [f,resolve(cwd,f)];
  const copy=join(work,f.replaceAll('/','__'));writeFileSync(copy,overrides[f]);return [f,copy];
 }));
 // allowJs lets the compiler parse tools/*.mjs; nothing is type-checked, resolved or executed.
 writeFileSync(join(work,'tsconfig.json'),JSON.stringify({compilerOptions:{noResolve:true,noLib:true,types:[],allowJs:true,checkJs:false,skipLibCheck:true},files:Object.values(mapped)}));
 const api=new API({cwd:work});
 try{
  const snapshot=api.updateSnapshot({openProject:join(work,'tsconfig.json')}),project=snapshot.getProjects()[0];
  const parse=f=>{const file=project.program.getSourceFile(mapped[f]);if(!file)throw Error(`Could not parse ${f}.`);return file;};
  const scheduled=extractScheduled(parse(scheduledFile));
  const routes=[...dispatchers.flatMap(d=>extractDispatcher(parse(d.file),d)),...scheduled.jobs,...extractTools(tools.map(t=>[t,parse(t)]))];
  const {order,originLine}=platformGates(parse('src/index.ts'));
  const surface={routes,controls:extractControls(parse(controlsFile)),gates:{originLine,order:Object.entries(order).sort((a,b)=>a[1]-b[1]).map(([name])=>name)},
   workers:readWorkers(cwd,overrides),cronBranches:scheduled.branches};
  snapshot.dispose();
  return surface;
 }finally{api.close();rmSync(work,{recursive:true,force:true});}
}

export const routeKey=r=>`${r.file} ${r.kind} ${r.match} [${r.methods.join(',')}]`;
// Per-entry facts the registry must state exactly: recent-auth call, position before an Origin refusal, and
// (scheduled jobs) whether the job runs only when its provider configuration or reviewed binding is present.
export const routeFlags=['freshnessCall','beforeOriginGate','conditional'];
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
  const area=family.surface??'platform-api';
  if(!surfaces[area])problems.push(`${where}: surface must be one of ${Object.keys(surfaces).join(', ')}`);
  if(area!=='platform-api'&&(typeof family.reach!=='string'||family.reach.length<10))problems.push(`${where}: reach (who can reach this family) is required for the ${area} surface`);
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
  const rule=surfaces[area]??surfaces['platform-api'],required=family.privileged?.length?rule.privileged:rule.other;
  for(const name of Object.keys(family.cells??{}))if(!cellNames.includes(name))problems.push(`${where}: unknown cell ${name}`);
  for(const name of cellNames){
   const cell=family.cells?.[name],at=`${where} cell ${name}`;
   if(!cell){if(required.includes(name))problems.push(`${at}: required for ${family.privileged?.length?'privileged':'every'} family on the ${area} surface`);continue;}
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
  extracted.set(key,seen?{...seen,...Object.fromEntries(routeFlags.map(f=>[f,seen[f]||r[f]]))}:r);
 }
 const registered=new Map((registry.families??[]).flatMap(f=>(f.entries??[]).map(e=>[routeKey(e),e])));
 for(const [key,r] of extracted){
  if(!entries.has(key)){problems.push(`unregistered ${r.kind==='tool'?'remote-capable tool':r.kind==='job'?'scheduled job':r.kind==='host'?'host dispatch':'route'}: ${key} (${r.file}:${r.line}, path ${r.path})`);continue;}
  const e=registered.get(key);
  for(const flag of routeFlags)if(!!e[flag]!==!!r[flag])problems.push(`${key}: registry says ${flag} ${!!e[flag]}, source says ${!!r[flag]} (${r.file}:${r.line})`);
 }
 for(const [key,family] of entries)if(!extracted.has(key))problems.push(`registered route no longer mounted: ${key} (family ${family})`);
 if(JSON.stringify(registry.gates?.order)!==JSON.stringify(surface.gates.order))problems.push(`platform dispatch order changed: registry ${JSON.stringify(registry.gates?.order)}, source ${JSON.stringify(surface.gates.order)} (exact-Origin gate at src/index.ts:${surface.gates.originLine})`);
 // Worker reachability: a new public route, workers.dev/preview URL, service binding, entry file or cron is reported.
 const recorded=new Map((registry.workers??[]).map(w=>[w.name,w]));
 for(const w of surface.workers){
  const r=recorded.get(w.name);
  if(!r){problems.push(`unregistered Worker ${w.name} (${w.config})`);continue;}
  for(const field of Object.keys(w))if(JSON.stringify(r[field])!==JSON.stringify(w[field]))problems.push(`Worker ${w.name}: registry says ${field} ${JSON.stringify(r[field])}, ${w.config} says ${JSON.stringify(w[field])}`);
  if(!dispatchers.some(d=>d.file===w.main&&d.worker===w.name))problems.push(`Worker ${w.name}: entry ${w.main} is not an audited dispatcher`);
 }
 for(const name of recorded.keys())if(!surface.workers.some(w=>w.name===name))problems.push(`registered Worker ${name} no longer has a config`);
 const crons=surface.workers.find(w=>w.name==='whumpo-platform')?.crons??[];
 for(const branch of surface.cronBranches)if(!crons.includes(branch))problems.push(`scheduled branch ${JSON.stringify(branch)} is not a configured cron in wrangler.jsonc`);
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
 let privileged=0,controls=0,missing=0;
 const kinds={},bySurface={};
 for(const family of registry.families){
  if(family.privileged.length)privileged++;
  const surface=family.surface??'platform-api';bySurface[surface]=(bySurface[surface]??0)+1;
  for(const e of family.entries??[]){const k=e.kind==='tool'?'tools':e.kind==='job'?'jobs':e.kind==='host'?'hosts':'routes';kinds[k]=(kinds[k]??0)+1;}
  controls+=family.controls?.length??0;
  for(const n of cellNames){const s=family.cells[n]?.state;if(s)counts[n][s]++;else missing++;}
 }
 const lines=[
  `Families: ${registry.families.length} (${privileged} privileged; ${Object.keys(surfaces).filter(s=>bySurface[s]).map(s=>`${s} ${bySurface[s]}`).join(', ')}). Workers: ${(registry.workers??[]).length}. Registered route matchers: ${kinds.routes??0}; host/origin dispatch matchers: ${kinds.hosts??0}; scheduled jobs: ${kinds.jobs??0}; remote-capable operator tools: ${kinds.tools??0}. Typed Chat controls: ${controls}. Recorded findings: ${(registry.findings??[]).length}.`,
  '',
  `| Cell | ${cellStates.join(' | ')} |`,
  `| --- | ${cellStates.map(()=>'---:').join(' | ')} |`,
  ...cellNames.map(n=>`| ${n} | ${cellStates.map(s=>counts[n][s]).join(' | ')} |`),
  '',
  `Cells not recorded (not required for that family's surface and privilege): ${missing}.`,
  '',
  `| Family | Surface | Privileged | Entries / controls | ${cellNames.join(' | ')} |`,
  `| --- | --- | --- | ---: | ${cellNames.map(()=>'---').join(' | ')} |`,
  ...registry.families.map(f=>`| ${f.id} | ${f.surface??'platform-api'} | ${f.privileged.join(', ')||'no'} | ${f.entries?.length??0} / ${f.controls?.length??0} | ${cellNames.map(n=>{const c=f.cells[n];return c?c.state+(c.gapKind?` (${c.gapKind}${c.finding?' '+c.finding:''})`:''):'—';}).join(' | ')} |`),
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
   else console.log('Boundary registry matches the mounted Worker, scheduled and operator-tool surface.');
  }else throw Error('Usage: node tools/boundary-audit.mjs [check|list|summary]');
 }catch(error){console.error(error.message);process.exitCode=1;}
}

// Trigger and view body validator (WH-054 packet 1a). SQLite accepts CREATE TRIGGER and CREATE VIEW bodies that
// name columns which do not exist and fails only when a statement that uses them is prepared, so the
// current-schema artifact check (execute plus foreign_key_check) cannot see a stale body.
//
// Two independent checks, both read-only:
//  1. reparse  - rebuild the tables, indexes and views in a disposable in-memory database (never the database
//     passed in), then for every trigger install it alone, PREPARE the INSERT/UPDATE/DELETE that fires it, and
//     drop it again; for every view PREPARE a SELECT. Statements are only compiled, never stepped, so no row is
//     written anywhere. `UPDATE OF <missing column>` is silently inert in SQLite (the body is never compiled),
//     so the OF list is checked against the table and the body is probed through a variant without the missing
//     columns.
//  2. lint     - parse each body with tools/sql-structure.mjs, resolve every column reference (aliases, OLD/NEW,
//     correlated subqueries, views, derived tables) to its base column, and report comparisons between an
//     `account`-typed and a `workspace`-typed operand. Types come from the foreign-key graph (structural) plus an
//     optional overlay for the current schema, where the registry says which `users` references are tenants.
//     This is a resolver over a parsed tree, not a text match, but it is not a proof: see `limitations`.
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {parseObject,parseTriggerHeader,tokenize,Analyzer,UnsupportedSQL} from './sql-structure.mjs';

const quote=name=>'"'+name.replaceAll('"','""')+'"';
const lower=s=>s.toLowerCase();
const digest=text=>createHash('sha256').update(text).digest('hex').slice(0,16);
const message=error=>String(error?.message??error).replace(/\s+/g,' ').slice(0,200);

export const validatorLimitations=Object.freeze([
 'The reparse check compiles statements; it proves a body resolves against the schema, not that it is correct.',
 'Each trigger is compiled in isolation, so nested trigger chains are checked per trigger, not as a combined program.',
 'The lint compares column operands it can resolve to base columns (row values element by element). Function results other than COALESCE/IFNULL/NULLIF, CASE branches, CAST results, literals and parameters are untyped and never reported.',
 'Assignments (SET, INSERT ... VALUES/SELECT) between account- and workspace-typed columns are not compared, only comparison operators, IN, BETWEEN, NULLIF and CASE-operand matching.',
 'Types describe columns, not values. A comparison of two columns with the same type can still join the wrong rows.',
 'An unsupported SQL construct is reported as unsupported; it is never silently skipped and never counted as clean.',
]);

/** Application schema objects, excluding SQLite internals and the D1/Wrangler bookkeeping tables. */
export function schemaObjects(db){
 return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' AND name NOT IN ('_cf_KV','_cf_METADATA') AND sql IS NOT NULL ORDER BY rowid").all();
}
const columnsOf=(db,name)=>db.prepare('SELECT name,hidden FROM pragma_table_xinfo(?)').all(name);

/** Tables, indexes and views only; triggers are installed one at a time. */
function scratchDatabase(objects){
 const scratch=new DatabaseSync(':memory:');
 const failures=[];
 for(const type of ['table','index','view'])for(const o of objects.filter(o=>o.type===type)){
  try{scratch.exec(o.sql);}catch(error){failures.push({type,name:o.name,error:message(error)});}
 }
 return {scratch,failures};
}

function probeStatements(header,columns){
 const target=quote(header.table);
 if(header.event==='INSERT')return [`INSERT INTO ${target} DEFAULT VALUES`];
 if(header.event==='DELETE')return [`DELETE FROM ${target}`];
 const settable=columns.filter(c=>c.hidden===0).map(c=>quote(c.name));
 return settable.length?[`UPDATE ${target} SET ${settable.map(c=>`${c}=${c}`).join(',')}`]:[];
}

export function reparseTriggers(objects,{scratch,failures:setupFailures}){
 const result={total:0,verified:0,failed:[],updateOfMissing:[],unsupported:[],setupFailures,statementsPrepared:0};
 for(const object of objects.filter(o=>o.type==='trigger')){
  result.total++;
  let header;
  try{header=parseTriggerHeader(object.sql);}catch(error){result.unsupported.push({name:object.name,reason:'trigger header: '+message(error)});continue;}
  const columns=columnsOf(scratch,header.table);
  if(!columns.length){result.unsupported.push({name:object.name,reason:`trigger target ${header.table} is not a table or view in the disposable database`});continue;}
  let sql=object.sql;
  if(header.event==='UPDATE'&&header.ofColumns){
   const known=new Set(columns.map(c=>lower(c.name)));
   const missing=header.ofColumns.filter(c=>!known.has(lower(c)));
   if(missing.length){
    result.updateOfMissing.push({name:object.name,table:header.table,columns:missing});
    // Compile the body anyway: drop the missing names (or the whole OF list) from a throwaway copy.
    const present=header.ofColumns.filter(c=>known.has(lower(c)));
    const [from,to]=header.ofRange;
    sql=object.sql.slice(0,from)+(present.length?' OF '+present.map(quote).join(', ')+' ':' ')+object.sql.slice(to);
   }
  }
  const statements=probeStatements(header,columns);
  if(!statements.length){result.unsupported.push({name:object.name,reason:'no settable column to fire an UPDATE trigger'});continue;}
  let error=null;
  try{scratch.exec(sql);}catch(e){error={stage:'create',error:message(e)};}
  if(!error)for(const statement of statements){
   try{scratch.prepare(statement);result.statementsPrepared++;}catch(e){error={stage:'prepare',statement:statement.split(' ')[0],error:message(e)};break;}
  }
  try{scratch.exec(`DROP TRIGGER IF EXISTS ${quote(object.name)}`);}catch{/* a failed CREATE leaves nothing to drop */}
  if(error)result.failed.push({name:object.name,table:header.table,...error});else result.verified++;
 }
 return result;
}

export function reparseViews(objects,{scratch},parsedViews){
 const result={total:0,verified:0,failed:[]};
 const dependencies=name=>{
  const view=parsedViews.get(lower(name));if(!view)return [];
  const found=new Set();
  const scan=node=>{
   if(Array.isArray(node))node.forEach(scan);
   else if(node&&typeof node==='object'){
    if(node.kind==='table'&&parsedViews.has(lower(node.name)))found.add(lower(node.name));
    for(const value of Object.values(node))scan(value);
   }
  };
  scan(view.select);return [...found];
 };
 const failed=new Set();
 // Dependencies first, so a view that fails only because a view it selects from is broken is attributed to that view.
 const views=objects.filter(o=>o.type==='view'),done=new Set(),ordered=[];
 const visit=o=>{if(done.has(o.name))return;done.add(o.name);for(const d of dependencies(o.name)){const dep=views.find(v=>lower(v.name)===d);if(dep)visit(dep);}ordered.push(o);};
 views.forEach(visit);
 for(const object of ordered){
  result.total++;
  try{scratch.prepare(`SELECT * FROM ${quote(object.name)}`);result.verified++;}
  catch(error){
   failed.add(lower(object.name));
   const via=dependencies(object.name).filter(d=>failed.has(d));
   result.failed.push({name:object.name,error:message(error),...(via.length?{brokenDependencies:via}:{})});
  }
 }
 return result;
}

/** Column type: overlay first, then the foreign-key graph (users -> account, workspaces -> workspace). */
export function typeResolver(db,overlay=new Map()){
 const structural=new Map();
 for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'").all()){
  for(const fk of db.prepare('SELECT "from","table" FROM pragma_foreign_key_list(?)').all(name)){
   const type={users:'account',workspaces:'workspace'}[lower(fk.table)];
   if(type)structural.set(`${lower(name)}.${lower(fk.from)}`,type);
  }
 }
 return (table,column)=>{
  const key=`${lower(table)}.${lower(column)}`;
  if(overlay.has(key))return overlay.get(key);
  if(key==='users.id')return 'account';
  if(key==='workspaces.id')return 'workspace';
  return structural.get(key);
 };
}

const describe=side=>side.refs.length?side.refs.map(r=>`${r.table}.${r.column}`).sort().join('|'):side.text;
// A side that can carry several types (COALESCE, a UNION view column) is cross-type if any pairing is.
const crossType=(l,r)=>(l.includes('account')&&r.includes('workspace'))||(l.includes('workspace')&&r.includes('account'));

export function lintBodies(objects,{tables,typeOf}){
 const parsedViews=new Map(),triggers=[],unsupported=[];
 for(const o of objects.filter(o=>o.type==='view'||o.type==='trigger')){
  try{const parsed=parseObject(o.sql);if(parsed.kind==='view')parsedViews.set(lower(o.name),parsed);else triggers.push(parsed);}
  catch(error){unsupported.push({name:o.name,kind:o.type,reason:message(error)});}
 }
 const analyzer=new Analyzer({tables,views:parsedViews,typeOf});
 const report={triggersAnalyzed:0,viewsAnalyzed:0,comparisons:0,byTypePair:{},unresolvedOperands:0,findings:[],unsupported};
 const occurrences=new Map();
 const take=(object,kind,analysis)=>{
  report.comparisons+=analysis.comparisons.length;report.unresolvedOperands+=analysis.unresolved.length;
  for(const c of analysis.comparisons){
   const pair=[c.left.type,c.right.type].sort().join('/');
   report.byTypePair[pair]=(report.byTypePair[pair]??0)+1;
   if(!crossType(c.left.types,c.right.types))continue;
   const [a,b]=[describe(c.left),describe(c.right)].sort(),op=c.op;
   const base=`${object}|${a}|${op}|${b}`,n=occurrences.get(base)??0;occurrences.set(base,n+1);
   report.findings.push({fingerprint:digest(`${base}|${n}`),object,kind,comparison:`${describe(c.left)} ${op} ${describe(c.right)}`,types:`${c.left.type}/${c.right.type}`});
  }
 };
 for(const trigger of triggers){
  try{take(trigger.name,'trigger',analyzer.analyzeTrigger(trigger));report.triggersAnalyzed++;}
  catch(error){unsupported.push({name:trigger.name,kind:'trigger',reason:message(error)});}
 }
 for(const [name,view] of parsedViews){
  try{take(view.name,'view',analyzer.analyzeView(view));report.viewsAnalyzed++;}
  catch(error){unsupported.push({name:view.name,kind:'view',reason:message(error)});}
 }
 report.findings.sort((x,y)=>x.object.localeCompare(y.object)||x.comparison.localeCompare(y.comparison)||x.fingerprint.localeCompare(y.fingerprint));
 return {report,parsedViews};
}

/**
 * Validate every trigger and view of `db`. `overlay` types extra columns (Map "table.column" -> type) and
 * `baseline` lists accepted findings by stable fingerprint; both are optional.
 */
export function validateBodies(db,{overlay=new Map(),baseline={}}={}){
 const objects=schemaObjects(db);
 const tables=new Map(objects.filter(o=>o.type==='table').map(o=>[lower(o.name),columnsOf(db,o.name).filter(c=>c.hidden!==1).map(c=>c.name)]));
 const typeOf=typeResolver(db,overlay);
 const {report:lint,parsedViews}=lintBodies(objects,{tables,typeOf});
 const scratch=scratchDatabase(objects);
 try{
  const triggers=reparseTriggers(objects,scratch);
  const views=reparseViews(objects,scratch,parsedViews);
  const accepted=new Map((baseline.crossTypeFindings??[]).map(f=>[f.fingerprint,f]));
  const found=new Map(lint.findings.map(f=>[f.fingerprint,f]));
  const newFindings=lint.findings.filter(f=>!accepted.has(f.fingerprint));
  const staleExceptions=[...accepted.keys()].filter(f=>!found.has(f));
  const acceptedReparse=new Set((baseline.reparseFailures??[]).map(f=>`${f.kind}:${f.name}:${f.error}`));
  const reparseFailures=[...triggers.failed.map(f=>({kind:'trigger',...f})),...views.failed.map(f=>({kind:'view',...f}))].filter(f=>!acceptedReparse.has(`${f.kind}:${f.name}:${f.error}`));
  const problems=[
   ...reparseFailures.map(f=>`${f.kind} ${f.name} no longer compiles: ${f.error}`),
   ...triggers.updateOfMissing.map(f=>`trigger ${f.name} is UPDATE OF ${f.columns.join(', ')}, which ${f.table} does not have; it can never fire for that column`),
   ...triggers.unsupported.map(f=>`trigger ${f.name} could not be probed: ${f.reason}`),
   ...triggers.setupFailures.map(f=>`${f.type} ${f.name} could not be created in the disposable database: ${f.error}`),
   ...lint.unsupported.map(f=>`${f.kind} ${f.name} uses unsupported SQL: ${f.reason}`),
   ...newFindings.map(f=>`${f.kind} ${f.object} compares ${f.comparison} (${f.types}); fingerprint ${f.fingerprint} is not in the baseline`),
   ...staleExceptions.map(f=>`baseline exception ${f} no longer matches any finding`),
  ];
  return {
   ok:!problems.length,problems,
   coverage:{triggers:{total:triggers.total,verified:triggers.verified,failed:triggers.failed.length,updateOfMissing:triggers.updateOfMissing.length,unsupported:triggers.unsupported.length,statementsPrepared:triggers.statementsPrepared},
    views:{total:views.total,verified:views.verified,failed:views.failed.length},
    lint:{triggersAnalyzed:lint.triggersAnalyzed,viewsAnalyzed:lint.viewsAnalyzed,comparisons:lint.comparisons,unresolvedOperands:lint.unresolvedOperands,unsupported:lint.unsupported.length,byTypePair:lint.byTypePair}},
   reparse:{triggers,views},lint,
   findings:{total:lint.findings.length,baselined:lint.findings.length-newFindings.length,new:newFindings.length,stale:staleExceptions.length},
   limitations:validatorLimitations,
  };
 }finally{scratch.scratch.close();}
}
export {tokenize,UnsupportedSQL};

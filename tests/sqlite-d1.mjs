import {DatabaseSync,constants} from 'node:sqlite';
import {currentSchema} from '../tools/current-schema.mjs';
/** Disposable SQLite adapter for fast checks of the actual D1 queries and transactions. */
export async function sqliteD1({probe=false}={}){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 sql.exec(await currentSchema());
 const authorizer=probe?authorizerProbe(sql):undefined;
 // Without `probe` the returned shape and every code path are exactly what they were before the probe existed.
 return {sql,db:sqliteD1Adapter(sql,{probe:authorizer}),close:()=>{authorizer?.restore();sql.close();},...(authorizer?{authorizer}:{})};
}
/** The same query adapter can read an actual restored, read-only SQLite copy. */
export function sqliteD1Adapter(sql,{probe}={}){
 const compile=probe?query=>probe.compile(query):query=>sql.prepare(query);
 const prepare=query=>{
  const bound=params=>({query,params,
   run:async()=>{const r=compile(query).run(...params);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};},
   all:async()=>({success:true,results:compile(query).all(...params),meta:{changes:0}}),
   first:async column=>{const row=compile(query).get(...params);return row?(column===undefined?row:row[column]):null;},
   bind:(...values)=>bound(values)});
  return bound([]);
 };
 const db={prepare,batch:async statements=>{
  sql.exec('BEGIN');try{const results=[];for(const statement of statements){const q=compile(statement.query);if(q.columns().length)results.push({success:true,results:q.all(...statement.params),meta:{changes:0}});else{const r=q.run(...statement.params);results.push({success:true,results:[],meta:{changes:Number(r.changes)}});}}sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}
 }};
 return db;
}

export const authorizerLimitations=Object.freeze([
 'Report only: the hook always allows the action and never denies or rewrites a statement.',
 'It records which tables and columns a statement references when it is prepared, including access made by triggers and views (tagged with the trigger or view name). It does not see predicates or bound values, so it cannot show that a statement is filtered to one workspace, and a reference to a tenant column is not proof of isolation.',
 'It covers only statements prepared while a scope is active, that is only the paths a test actually exercised.',
 'It exists only for the in-memory SQLite adapter. Local D1 through miniflare (--d1) exposes opaque prepared statements and has no authorizer.',
 'Isolation of values needs two-workspace fixtures with unique markers.',
]);
const installed=new WeakSet();
const actionNames=new Map([[constants.SQLITE_READ,'read'],[constants.SQLITE_INSERT,'insert'],[constants.SQLITE_UPDATE,'update'],[constants.SQLITE_DELETE,'delete']]);

/**
 * Report-only SQLite authorizer scoped to named blocks. Install it per fixture and call `restore()` (or the
 * fixture's `close()`) to remove the hook; Node offers no way to read the previous authorizer, so restoring
 * means clearing it, and the probe refuses to wrap an authorizer it did not install itself.
 */
export function authorizerProbe(sql){
 if(installed.has(sql))throw Error('An authorizer probe is already installed on this database');
 let scope=null,statement=null,ignored=0;
 const seen=new Map();
 sql.setAuthorizer((action,first,second,database,source)=>{
  try{
   const kind=actionNames.get(action);
   if(kind&&database!=='temp'){
    if(scope===null)ignored++;
    else{
     const key=[scope,statement??'',kind,first??'',second??'',source??''].join('\u0000');
     const hit=seen.get(key);
     if(hit)hit.count++;else seen.set(key,{scope,statement,action:kind,table:first||null,column:second||null,via:source||null,count:1});
    }
   }
  }catch{/* a report-only hook must never fail a statement */}
  return constants.SQLITE_OK;
 });
 installed.add(sql);
 const probe={
  available:true,
  /** Compile a statement with a label (string literals masked, so a seeded value never enters a report) attached to every action it triggers. */
  compile(query){const before=statement;statement=query.replace(/'(?:[^']|'')*'/g,"'?'").replace(/\s+/g,' ').slice(0,160);try{return sql.prepare(query);}finally{statement=before;}},
  /** Record only while `body` runs; scopes may nest (the innermost name wins). */
  scope(name,body){
   const before=scope;scope=name;
   let result;try{result=body();}catch(error){scope=before;throw error;}
   if(result&&typeof result.then==='function')return result.finally(()=>{scope=before;});
   scope=before;return result;
  },
  actions(name){return [...seen.values()].filter(a=>name===undefined||a.scope===name);},
  /** Tables referenced in a scope with direct and trigger/view-originated actions, most useful for assertions. */
  report(name){
   const types=new Map(sql.prepare("SELECT name,type FROM sqlite_master WHERE type IN ('trigger','view')").all().map(r=>[r.name,r.type]));
   const tables={};
   for(const a of probe.actions(name)){
    if(!a.table)continue;
    const origin=a.via?(types.get(a.via)??'unknown'):'direct';
    const entry=tables[a.table]??={direct:{},trigger:{},view:{}};
    const into=origin==='direct'?entry.direct:((entry[origin]??={})[a.via]??={});
    (into[a.action]??=[]);if(a.column&&!into[a.action].includes(a.column))into[a.action].push(a.column);
   }
   return {available:true,scope:name??null,ignoredOutsideScope:ignored,statements:new Set(probe.actions(name).map(a=>a.statement)).size,tables,limitations:authorizerLimitations,proof:'none: a report of references, not a proof of tenant isolation'};
  },
  /** True when some recorded action in `name` references table.column (any action, direct or through a trigger/view). */
  references(table,column,name){return probe.actions(name).some(a=>a.table===table&&a.column===column);},
  restore(){if(installed.delete(sql))sql.setAuthorizer(null);},
 };
 return probe;
}
/** What a --d1/R2 (miniflare) fixture reports: the hook cannot exist there, and saying so is the result. */
export const unavailableAuthorizerProbe=Object.freeze({
 available:false,
 reason:'The SQLite authorizer exists only for the in-memory SQLite fixture. Local D1 (miniflare, --d1) exposes opaque prepared statements and cannot be probed.',
 compile(){throw Error(this.reason);},
 scope(name,body){return body();},
 actions(){return [];},
 report(){return {available:false,reason:this.reason,tables:{},limitations:authorizerLimitations,proof:'none'};},
 references(){return false;},
 restore(){},
});

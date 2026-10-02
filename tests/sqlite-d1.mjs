import {DatabaseSync} from 'node:sqlite';
import {currentSchema} from '../tools/current-schema.mjs';
/** Disposable SQLite adapter for fast checks of the actual D1 queries and transactions. */
export async function sqliteD1(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 sql.exec(await currentSchema());
 const prepare=query=>{
  const bound=params=>({query,params,
   run:async()=>{const r=sql.prepare(query).run(...params);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};},
   all:async()=>({success:true,results:sql.prepare(query).all(...params),meta:{changes:0}}),
   first:async column=>{const row=sql.prepare(query).get(...params);return row?(column===undefined?row:row[column]):null;},
   bind:(...values)=>bound(values)});
  return bound([]);
 };
 const db={prepare,batch:async statements=>{
  sql.exec('BEGIN');try{const results=[];for(const statement of statements){const q=sql.prepare(statement.query);if(q.columns().length)results.push({success:true,results:q.all(...statement.params),meta:{changes:0}});else{const r=q.run(...statement.params);results.push({success:true,results:[],meta:{changes:Number(r.changes)}});}}sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}
 }};
 return {sql,db,close:()=>sql.close()};
}

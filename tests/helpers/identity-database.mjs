import {DatabaseSync} from 'node:sqlite';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

/** The isolated current schema has only a canonical user FK, never old auth tables. */
export async function identityDatabase(){
 const schema=`${await readFile('src/workspace-identity/canonical-inputs.sql','utf8')}
 CREATE TABLE test_effects(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE) STRICT;
 ${await readFile('src/workspace-identity/schema.sql','utf8')}`;
 if(process.argv.length===2){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');sql.exec(schema);
  const prepare=query=>{
   const bound=params=>({query,params,bind:(...values)=>bound(values),
    run:async()=>{const r=sql.prepare(query).run(...params);return {success:true,meta:{changes:Number(r.changes)}};},
    all:async()=>({success:true,results:sql.prepare(query).all(...params)}),
    first:async column=>{const row=sql.prepare(query).get(...params);return row?(column===undefined?row:row[column]):null;}});
   return bound([]);
  };
  const db={prepare,batch:async statements=>{
   sql.exec('BEGIN');try{
    const results=[];for(const statement of statements){
     const query=sql.prepare(statement.query);
     if(query.columns().length)results.push({success:true,results:query.all(...statement.params)});
     else{const changed=query.run(...statement.params);results.push({success:true,results:[],meta:{changes:Number(changed.changes)}});}
    }
    sql.exec('COMMIT');return results;
   }catch(error){sql.exec('ROLLBACK');throw error;}
  }};
  return {db,close:async()=>sql.close()};
 }
 if(process.argv.length!==3||process.argv[2]!=='--d1')throw Error('Choose SQLite or --d1');
 const directory=await mkdtemp('/tmp/whumpo-identity-'),config=directory+'/wrangler.json';
 try{
  await writeFile(directory+'/schema.sql',schema);
  await writeFile(config,JSON.stringify({name:'whumpo-identity-local',compatibility_date:'2026-09-29',d1_databases:[{binding:'DB',database_name:'identity-local',database_id:crypto.randomUUID()}]}));
  execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','identity-local','--local','--file',directory+'/schema.sql','--config',config,'--persist-to',directory+'/state'],{stdio:'pipe',maxBuffer:4*1024*1024,env:{PATH:process.env.PATH,CI:'true',WRANGLER_SEND_METRICS:'false'}});
  const {getPlatformProxy}=await import('wrangler'),proxy=await getPlatformProxy({configPath:config,persist:{path:directory+'/state/v3'},remoteBindings:false});
  return {db:proxy.env.DB,close:async()=>{await proxy.dispose();await rm(directory,{recursive:true,force:true});}};
 }catch(error){await rm(directory,{recursive:true,force:true});throw error;}
}

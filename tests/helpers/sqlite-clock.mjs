// Test-only SQLite clock shim for WH-050 operator action identity. It does not touch the system clock and has no product use.
// SQLite reads `'now'` from the host and offers no way to move it, so the complete current schema and every statement a test
// prepares are rewritten textually: each time source (`'now'`, `unixepoch()`) becomes `shim_now()`, an application function that
// answers from `clock.ms`. Nothing else changes, so the real triggers, the real tool queries and the real inputs run unmodified
// against a clock the test sets, which lets an action be applied "100 days ago" by the actual tool and then cleaned today with
// its id never renamed. SQLite only: the actual local D1 runs the same triggers on the real clock in the other test variants.
import {DatabaseSync} from 'node:sqlite';
import {currentSchema} from '../../tools/current-schema.mjs';
import {sqliteD1Adapter} from '../sqlite-d1.mjs';
const iso=ms=>new Date(ms).toISOString().replace('T',' ').replace('Z','');
/** The complete current schema never reads time any other way (checked below), so this rewrite is total. */
export const shimSql=text=>text.replaceAll("'now'",'shim_now()').replaceAll('unixepoch()','unixepoch(shim_now())');
export async function sqliteClockD1(startMs){
 const clock={ms:startMs},sql=new DatabaseSync(':memory:');
 sql.function('shim_now',{deterministic:false},()=>iso(clock.ms));
 sql.exec('PRAGMA foreign_keys=ON');
 const schema=shimSql(await currentSchema());
 if(/'now'|unixepoch\(\)|CURRENT_(TIMESTAMP|DATE|TIME)|\bdatetime\(\)|\bjulianday\(\)/i.test(schema))throw Error('Clock shim missed a time source');
 sql.exec(schema);
 const shimmed={prepare:query=>sql.prepare(shimSql(query)),exec:query=>sql.exec(shimSql(query))};
 return {sql,db:sqliteD1Adapter(shimmed),clock,at:ms=>{clock.ms=ms;},close:()=>sql.close()};
}

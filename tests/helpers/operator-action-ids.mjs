// Fixture helpers for WH-050 operator action identity (UUIDv7 minted within a day of the database clock).
// Ids are always minted for the moment the fixture row claims to have been created, so an aged fixture is consistent
// (id time = created_at) instead of a young id on an old row. Fixture-only: the product mints ids with `--new-id`.
import {newActionId,actionIdWindowMs,actionIdFutureMs} from '../../tools/operator-containment-input.mjs';
export {newActionId};
/** An id as it would have been minted `ageMs` ago (negative values are in the future). */
export const actionIdAged=(ageMs,now=Date.now())=>newActionId(now-ageMs);
/** Runs `work` with the named triggers dropped, then restores them exactly as stored (fixture-only clock and history writes). */
export async function withoutTriggers(db,names,work){
 const saved=[];
 for(const name of names){saved.push((await db.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').bind('trigger',name).first()).sql);await db.prepare('DROP TRIGGER '+name).run();}
 try{return await work();}finally{for(const sql of saved)await db.prepare(sql).run();}
}
/**
 * Candidate ids around the schema window, minted for the given instant. Accepted ids sit well inside the window and
 * refused ones well outside (not at the millisecond edge, so the database clock may differ from this process by seconds), plus
 * shape variants including embedded-NUL ids, which the old text-length checks alone admitted.
 */
export function windowIds(now=Date.now()){
 const good=newActionId(now),swap=(id,index,char)=>id.slice(0,index)+char+id.slice(index+1);
 return {
  accepted:{'minted now':good,'23 hours old':newActionId(now-23*3600000),'30 seconds ahead':newActionId(now+30000)},
  refused:{'25 hours old':newActionId(now-actionIdWindowMs-3600000),'2 minutes ahead':newActionId(now+actionIdFutureMs+60000),'epoch zero':newActionId(0),'far future':newActionId(2**47),'random v4':crypto.randomUUID(),
   'upper-case hex':good.toUpperCase(),'version 4 nibble on a v7 time':swap(good,14,'4'),'wrong variant nibble':swap(good,19,'c'),'non-hex digit':swap(good,0,'g'),'extra hyphen':swap(good,2,'-'),'misplaced hyphen':good.slice(0,7)+'-'+good[7]+good.slice(9),'no hyphens':good.replaceAll('-','')+'0000'.slice(0,4),'empty':'',
   // SQLite's text length() and GLOB stop at the first NUL, so these look like a fresh canonical v7 to them: only the byte length tells.
   'trailing NUL':good+'\u0000','NUL then trailing bytes':good+'\u0000abc','NUL then a second fresh v7':good+'\u0000'+newActionId(now)}
 };
}

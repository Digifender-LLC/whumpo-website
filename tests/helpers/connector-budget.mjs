// Synthetic quota snapshots. A future minute prevents a wall-clock boundary from weakening a refusal case.
// These raw fixture writes grant no authority; runtime has no reset or caller-supplied window API.
export async function fillConnectorBudget(db,user,provider,kind,used,{past=false}={}){
 await db.prepare('DELETE FROM connector_request_budgets WHERE user_id=? AND provider=? AND kind=?').bind(user,provider,kind).run();
 await db.prepare(`INSERT INTO connector_request_budgets(user_id,provider,kind,window_start,used) VALUES(?,?,?,(unixepoch()/60${past?'-2':'+1'})*60,1)`).bind(user,provider,kind).run();
 if(used>1)await db.batch(Array.from({length:used-1},()=>db.prepare('UPDATE connector_request_budgets SET used=used+1 WHERE user_id=? AND provider=? AND kind=?').bind(user,provider,kind)));
}
export const resetConnectorBudgets=(db,user)=>db.prepare('DELETE FROM connector_request_budgets WHERE user_id=?').bind(user).run();

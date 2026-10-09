/** WH-050 operator serving stop (owner decision October 8, 2026; tools/operator-containment.mjs `stop-serving`).
 * One predicate, read by every public serving path. Reviewed content, publications and stored data are unchanged;
 * callers answer with their existing generic unavailable response and never disclose the stop. */
export async function servingStopped(db:D1Database,projectId:string):Promise<boolean>{
 return !!await db.prepare('SELECT 1 FROM operator_serving_stopped WHERE project_id=?').bind(projectId).first();
}

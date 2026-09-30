import {BackendError} from './backend-error';
/** A persisted required check is a hold, never an approval. Detector dispatch is separate. */
export async function requireSpecificationAvailable(db:D1Database,version:string){
 if(await db.prepare('SELECT 1 FROM project_spec_held WHERE version_id=?').bind(version).first())throw new BackendError(423,'This website content is held for safety review.');
}

import {BackendError} from './backend-error';
import {testBackend} from './backend-versions';

/** WH-014: the single fail-closed admission gate for generated and imported artifacts.
 *
 * `artifact_screening_holds` (schema/platform.sql) holds an exact owner+digest when either
 * - a required `content_screening_decisions` row of kind `generated_artifact` or `imported_code` exists under ANY
 *   policy version (a policy change or risk decay never releases it; there is no completion receipt yet), or
 * - the same exact bytes are in `backend_imports` quarantine (pending, requires_review or blocked; imports have
 *   no approval state), so pasting or regenerating quarantined source cannot launder it into execution.
 * No row in this view, and no absence of a row, is ever an approval. Imported formats with mandatory checks
 * (backend imports, WordPress-imported CMS articles) are denied separately because no clearance exists for them.
 * SQL triggers repeat these checks inside every final write; the TypeScript checks only give a clear refusal. */
export const artifactHeldMessage='This code or content is held for safety review. It cannot be run, activated or published until the required checks are complete.';
export const importedContentMessage='Imported content stays private until its required import safety checks are available. It cannot be published.';
const digestPattern=/^[0-9a-f]{64}$/;

export async function requireArtifactsAvailable(db:D1Database,user:string,digests:(string|null|undefined)[],message=artifactHeldMessage){
 const exact=[...new Set(digests.filter((d):d is string=>typeof d==='string'))];
 // A malformed digest has no exact identity, so it cannot be admitted either.
 if(exact.some(d=>!digestPattern.test(d)))throw new BackendError(423,message);
 if(!exact.length)return;
 if(await db.prepare(`SELECT 1 FROM artifact_screening_holds WHERE user_id=? AND digest IN (${exact.map(()=>'?').join(',')}) LIMIT 1`).bind(user,...exact).first())throw new BackendError(423,message);
}

/** Saved backend version (the owner is the project's owner). Used before every private test, publication,
 * activation, migration and visitor execution; the database triggers enforce the same predicate at commit. */
export async function requireBackendVersionAvailable(db:D1Database,version:string){
 if(await db.prepare('SELECT 1 FROM held_backend_versions WHERE id=?').bind(version).first())throw new BackendError(423,artifactHeldMessage);
}

/** True when a write was refused by a WH-014 hold trigger, so callers can return 423 instead of a generic conflict. */
export const heldRefusal=(error:unknown)=>/artifact_held|imported_content_held/.test(String(error instanceof Error?error.message:error));

/** Every private test (owner test, Chat check, state-transition test, application build) goes through this wrapper,
 * so a held version is refused before reservation; the backend_runs trigger repeats the check atomically.
 * backend-versions.ts itself is an input of the pinned service-client compiler identity and stays unchanged. */
export async function testAdmittedBackend(...args:Parameters<typeof testBackend>){
 const [db,,,,version]=args;
 if(typeof version==='string')await requireBackendVersionAvailable(db,version);
 try{return await testBackend(...args);}
 catch(error){if(error instanceof BackendError&&error.status===429&&typeof version==='string')await requireBackendVersionAvailable(db,version);throw error;}
}

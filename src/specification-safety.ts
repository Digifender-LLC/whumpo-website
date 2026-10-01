import {BackendError} from './backend-error';
import {assertCompilerAvailable} from './project-specification/compiler';
import {compilerCatalog} from './project-specification/catalog';
/** Only the current specification/compiler can be served, previewed, restored or exported.
 * A required screening decision remains a hold; absence of one is not a detector approval. */
export async function requireSpecificationAvailable(db:D1Database,version:string){
 const current=await db.prepare("SELECT lock_json,json_extract(spec_json,'$.schemaVersion') schema_version FROM project_spec_versions WHERE version_id=?").bind(version).first<{lock_json:string;schema_version:number}>();
 if(!current||current.schema_version!==2)throw new BackendError(409,'This saved website uses a retired format. Create a current website draft.');
 try{assertCompilerAvailable(JSON.parse(current.lock_json),compilerCatalog);}catch{throw new BackendError(409,'This saved website uses an unavailable compiler. Create a current website draft.');}
 if(await db.prepare('SELECT 1 FROM project_spec_held WHERE version_id=?').bind(version).first())throw new BackendError(423,'This website content is held for safety review.');
}

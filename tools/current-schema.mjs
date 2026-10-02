import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export const currentSchemaFiles=Object.freeze(['src/workspace-identity/canonical-inputs.sql','schema/platform.sql','src/workspace-identity/schema.sql']);
/** One current policy; initialize an empty DB, never convert an old account. */
export async function currentSchema(directory=resolve(dirname(fileURLToPath(import.meta.url)),'..')){
 return (await Promise.all(currentSchemaFiles.map(file=>readFile(resolve(directory,file),'utf8')))).join('\n');
}

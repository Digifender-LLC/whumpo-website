import {compileProjectSpecification} from '../project-specification/compiler';
import {compilerArtifacts} from '../project-specification/compiler-artifacts.generated';
import {canonicalJSON,requireSpec,sha256} from '../project-specification/v2/json';
/** WH-077 adapter contract. Caller supplies separately authorized owner configuration and exact maintained client bytes.
 * This is a portable frontend artifact, not an export of visitor identities/data or a replacement backend. */
export async function serializePortal(specification:unknown,lock:unknown,client:string){
 const compiled=await compileProjectSpecification(specification,lock),portal=compiled.presentation;
 requireSpec(portal,'MISSING_REFERENCE','presentation');
 requireSpec(new TextEncoder().encode(client).length===compilerArtifacts.portalClient.bytes&&await sha256(client)===compilerArtifacts.portalClient.digest,'COMPILER_LOCK_MISMATCH','presentation.client');
 const files=[{path:'public/portal/index.html',text:portal.html},{path:'public/module-portal.js',text:client},
  {path:'private/presentation.json',text:canonicalJSON(compiled.specification.presentation,12000)},
  {path:'README.txt',text:'Whumpo maintained visitor presentation v1\n\nServe the HTML at /portal and the client at /module-portal.js on one isolated visitor origin. This deterministic frontend needs the maintained whumpo-portal v1 configuration and whumpo-modules v1 APIs, with the same-origin access/passkey routes and HttpOnly sessions. Supply destination-side authorized resource mappings; never point it at another tenant or expose platform credentials. Backend modules, visitor identities/values, files, role grants, recovery codes, sessions, provider credentials and publication approvals are not included. Reauthorize, configure and test replacement services before admitting visitors. Preserve the CSP, private/no-store responses, field/tenant/role checks and exact publication/safety gates. This adapter does not change publication or claim a restored application.\n'}];
 return {format:'whumpo-portal-frontend',version:1,compiler:compiled.manifest.lock.compiler,template:compiled.specification.presentation!.template,
  backend:compiled.specification.instances.map(i=>({id:i.id,module:i.module,schema:i.schema,dependencies:i.dependencies})),portability:'requires-authorized-backend-adapter',
  files:await Promise.all(files.map(async f=>({...f,sha256:await sha256(f.text)})))};
}

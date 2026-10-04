import {renderContentSpecification,renderContentChange,renderContentRestore,createContentSpecification} from './v3/content';
import {validateSpecification} from './v3/schema';
import {canonicalJSON,copyJSON,jsonDigest,requireSpec} from './v2/json';
import {compilerArtifacts} from './compiler-artifacts.generated';
import {compilerCatalog,moduleCatalog,type CompilerAvailability,type ModuleAvailability} from './catalog';

// Catalog availability is current server policy, separate from immutable artifact identity.
// Withdrawing an artifact prevents new compilation/apply; historical bytes stay unchanged.
export type {CompilerAvailability,ModuleAvailability} from './catalog';
const lock={formatVersion:1,schemaVersion:3,compiler:{id:'project-content',version:4,digest:compilerArtifacts.compiler},modules:[{id:'content',version:2,digest:compilerArtifacts.content,dependencies:[]}],components:[{id:'site-page',version:1,digest:compilerArtifacts.component},{id:'photo-page',version:1,digest:compilerArtifacts.component}]};
export function currentCompilerLock(){return copyJSON(lock);}

/** Availability must come from trusted server state, never a model/request payload. */
export function assertCompilerAvailable(value:unknown,available:readonly CompilerAvailability[]){
 requireSpec(canonicalJSON(value,4096)===canonicalJSON(lock,4096),'COMPILER_LOCK_MISMATCH','lock');
 for(const artifact of [lock.compiler,...lock.modules,...lock.components]){
  const match=available.find(entry=>entry.id===artifact.id&&entry.version===artifact.version&&entry.digest===artifact.digest);
  requireSpec(match&&match.state==='available','COMPILER_UNAVAILABLE','lock');
 }
}
/** Exact module/schema pins from trusted server state only: another digest is stale, never a fallback. */
export function assertModulesAvailable(input:unknown,available:readonly ModuleAvailability[]){
 const spec=validateSpecification(input),same=(a:unknown,b:unknown)=>canonicalJSON(a)===canonicalJSON(b);
 for(const instance of spec.instances){
  const entry=available.find(row=>row.kind===instance.kind);
  requireSpec(entry,'MODULE_UNAVAILABLE','instances.kind');
  requireSpec(same(instance.module,entry.module)&&same(instance.schema,entry.schema),'STALE_MODULE_VERSION','instances.module');
  requireSpec(entry.state==='available','MODULE_UNAVAILABLE','instances.module');
 }
 return spec;
}
export async function compileProjectSpecification(input:unknown,expectedLock:unknown){
 assertCompilerAvailable(expectedLock,compilerCatalog);
 const result=await renderContentSpecification(assertModulesAvailable(input,moduleCatalog));
 const manifest={formatVersion:1,specificationDigest:result.specificationDigest,lock:currentCompilerLock(),
  artifacts:result.artifacts.map(({html:_,...artifact})=>artifact),previewHeaders:result.previewHeaders,activation:'not-configured',published:false};
 return {...result,manifest,manifestDigest:await jsonDigest(manifest)};
}
export async function compileSpecificationChange(before:unknown,operations:unknown,expectedLock:unknown){
 assertCompilerAvailable(expectedLock,compilerCatalog);
 const change=await renderContentChange(assertModulesAvailable(before,moduleCatalog),operations),compiled=await compileProjectSpecification(change.next.specification,expectedLock);
 return {baseDigest:change.baseDigest,nextDigest:compiled.specificationDigest,diff:change.diff,requiredReviews:change.requiredReviews,migration:change.migration,compiled};
}
/** Restore compiles the saved target under its own exact lock and classifies it against the current base. */
export async function compileSpecificationRestore(before:unknown,target:unknown,expectedLock:unknown){
 assertCompilerAvailable(expectedLock,compilerCatalog);
 const change=await renderContentRestore(assertModulesAvailable(before,moduleCatalog),assertModulesAvailable(target,moduleCatalog)),compiled=await compileProjectSpecification(change.next.specification,expectedLock);
 return {baseDigest:change.baseDigest,nextDigest:compiled.specificationDigest,requiredReviews:change.requiredReviews,migration:change.migration,compiled};
}
export async function compileNewWebsite(input:unknown){
 return compileProjectSpecification(createContentSpecification(input),currentCompilerLock());
}

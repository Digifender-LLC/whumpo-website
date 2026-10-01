import {renderContentSpecification,renderContentChange,createContentSpecification} from './v2/content';
import {canonicalJSON,copyJSON,jsonDigest,requireSpec} from './v2/json';
import {compilerArtifacts} from './compiler-artifacts.generated';
import {compilerCatalog,type CompilerAvailability} from './catalog';

// Catalog availability is current server policy, separate from immutable artifact identity.
// Withdrawing an artifact prevents new compilation/apply; historical bytes stay unchanged.
export type {CompilerAvailability} from './catalog';
const lock={formatVersion:1,schemaVersion:2,compiler:{id:'project-content',version:2,digest:compilerArtifacts.compiler},modules:[{id:'content',version:2,digest:compilerArtifacts.content,dependencies:[]}],components:[{id:'site-page',version:1,digest:compilerArtifacts.component},{id:'photo-page',version:1,digest:compilerArtifacts.component}]};
export function currentCompilerLock(){return copyJSON(lock);}

/** Availability must come from trusted server state, never a model/request payload. */
export function assertCompilerAvailable(value:unknown,available:readonly CompilerAvailability[]){
 requireSpec(canonicalJSON(value,4096)===canonicalJSON(lock,4096),'COMPILER_LOCK_MISMATCH','lock');
 for(const artifact of [lock.compiler,...lock.modules,...lock.components]){
  const match=available.find(entry=>entry.id===artifact.id&&entry.version===artifact.version&&entry.digest===artifact.digest);
  requireSpec(match&&match.state==='available','COMPILER_UNAVAILABLE','lock');
 }
}
export async function compileProjectSpecification(input:unknown,expectedLock:unknown){
 assertCompilerAvailable(expectedLock,compilerCatalog);
 const result=await renderContentSpecification(input);
 const manifest={formatVersion:1,specificationDigest:result.specificationDigest,lock:currentCompilerLock(),
  artifacts:result.artifacts.map(({html:_,...artifact})=>artifact),previewHeaders:result.previewHeaders,activation:'not-configured',published:false};
 return {...result,manifest,manifestDigest:await jsonDigest(manifest)};
}
export async function compileSpecificationChange(before:unknown,operations:unknown,expectedLock:unknown){
 assertCompilerAvailable(expectedLock,compilerCatalog);
 const change=await renderContentChange(before,operations),compiled=await compileProjectSpecification(change.next.specification,expectedLock);
 return {baseDigest:change.baseDigest,nextDigest:compiled.specificationDigest,diff:change.diff,requiredReviews:change.requiredReviews,compiled};
}
export async function compileNewWebsite(input:unknown){
 return compileProjectSpecification(createContentSpecification(input),currentCompilerLock());
}

import {renderServiceClients} from './v5/core';
import {serviceClientArtifacts} from './artifacts.generated';
import {serviceClientCatalog} from './catalog';
import {canonicalJSON,copyJSON,jsonDigest,requireSpec} from '../v2/json';
import type {CompilerAvailability} from '../catalog';
export {validateServiceClientSpecification,validateServiceClientTarget} from './v5/core';
export type {ServiceClientSpecification,ServiceClientTarget} from './v5/core';
const lock={formatVersion:1,schemaVersion:1,compiler:{id:'project-service-clients',version:5,digest:serviceClientArtifacts.compiler},
 modules:[{id:'contact-link',version:1,digest:serviceClientArtifacts.renderer},{id:'stateless-form',version:1,digest:serviceClientArtifacts.renderer}]};
export function currentServiceClientLock(){return copyJSON(lock);}
/** Only trusted server catalog entries may be supplied. No request-supplied availability. */
export function assertServiceClientCompilerAvailable(value:unknown,available:readonly CompilerAvailability[]){
 requireSpec(canonicalJSON(value,4096)===canonicalJSON(lock,4096),'COMPILER_LOCK_MISMATCH','lock');
 for(const artifact of [lock.compiler,...lock.modules])requireSpec(available.some(row=>row.id===artifact.id&&row.version===artifact.version&&row.digest===artifact.digest&&row.state==='available'),'COMPILER_UNAVAILABLE','lock');
}
export async function compileServiceClientArtifacts(specification:unknown,target:unknown,website:unknown,expectedLock:unknown){
 assertServiceClientCompilerAvailable(expectedLock,serviceClientCatalog);
 const result=await renderServiceClients(specification,target,website);
 const manifest={formatVersion:1,lock:currentServiceClientLock(),specificationDigest:result.specificationDigest,target:result.target,targetDigest:result.targetDigest,
  artifacts:result.artifacts.map(({html:_,...artifact})=>artifact),services:result.services,previewHeaders:result.previewHeaders,candidateScriptPolicy:result.candidateScriptPolicy,
  requiredReviews:result.requiredReviews,activation:'not-authorized',published:false};
 return {...result,manifest,manifestDigest:await jsonDigest(manifest,16384)};
}

import {compilerArtifacts} from './compiler-artifacts.generated';

export type CompilerAvailability={id:string;version:number;digest:string;state:'available'|'withdrawn'};
// Current server policy is deliberately separate from pinned implementation bytes.
// A withdrawal changes admission, never the historical artifact or saved lock.
export const compilerCatalog:readonly CompilerAvailability[]=Object.freeze([
 Object.freeze({id:'project-content',version:1,digest:compilerArtifacts.compiler,state:'available' as const}),
 Object.freeze({id:'content',version:1,digest:compilerArtifacts.content,state:'available' as const}),
 Object.freeze({id:'site-page',version:1,digest:compilerArtifacts.component,state:'available' as const}),
]);

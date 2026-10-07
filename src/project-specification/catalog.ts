import {compilerArtifacts} from './compiler-artifacts.generated';
import {moduleKinds,type ModuleKind,type ModulePin} from './v3/modules';

export type CompilerAvailability={id:string;version:number;digest:string;state:'available'|'withdrawn'};
// Current server policy is deliberately separate from pinned implementation bytes.
// A withdrawal changes admission, never the historical artifact or saved lock.
export const compilerCatalog:readonly CompilerAvailability[]=Object.freeze([
 Object.freeze({id:'project-content',version:6,digest:compilerArtifacts.compiler,state:'available' as const}),
 Object.freeze({id:'content',version:2,digest:compilerArtifacts.content,state:'available' as const}),
 Object.freeze({id:'photo-page',version:1,digest:compilerArtifacts.component,state:'available' as const}),
 Object.freeze({id:'site-page',version:1,digest:compilerArtifacts.component,state:'available' as const}),
]);

export type ModuleAvailability={kind:ModuleKind;module:ModulePin;schema:ModulePin;state:'available'|'withdrawn'};
// Trusted WH-067 module/schema pins (WH-124). `available` admits configuration in a saved specification
// (project-content@5) only; it is not activation or serving, which needs the WH-125 activation review.
// Withdrawal rejects compilation of any instance of that kind.
const modulePin=(kind:ModuleKind,state:ModuleAvailability['state']):ModuleAvailability=>Object.freeze({kind,state,
 module:Object.freeze({name:moduleKinds[kind].module,version:1 as const,digest:compilerArtifacts.modules[kind].module}),
 schema:Object.freeze({name:moduleKinds[kind].schema,version:1 as const,digest:compilerArtifacts.modules[kind].schema})});
export const moduleCatalog:readonly ModuleAvailability[]=Object.freeze([
 modulePin('content','available'),
 modulePin('records','available'),
 modulePin('files','available'),
 modulePin('access','available'),
]);

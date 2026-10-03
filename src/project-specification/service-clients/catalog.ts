import {serviceClientArtifacts} from './artifacts.generated';
import type {CompilerAvailability} from '../catalog';
export const serviceClientCatalog:readonly CompilerAvailability[]=Object.freeze([
 Object.freeze({id:'project-service-clients',version:3,digest:serviceClientArtifacts.compiler,state:'available' as const}),
 Object.freeze({id:'contact-link',version:1,digest:serviceClientArtifacts.renderer,state:'available' as const}),
 Object.freeze({id:'stateless-form',version:1,digest:serviceClientArtifacts.renderer,state:'available' as const}),
]);

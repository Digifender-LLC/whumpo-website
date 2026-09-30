import type {BackendForm} from './backend-form-shape';
/** Derived from an owned, immutable page review and exact server receipt. */
export type AppPageReviewPresentation={
 id:string;projectId:string;projectName:string;
 state:'ready'|'applied'|'expired'|'changed';expiresAt:string;
 form:BackendForm|null;programRevision:number;pageRevision:number;
};

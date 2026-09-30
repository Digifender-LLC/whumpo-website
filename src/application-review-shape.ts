/** Server-authenticated presentation; model prose cannot supply this metadata. */
export type ApplicationReviewPresentation={
 id:string;projectName:string;operation:'enable'|'disable';
 state:'ready'|'applied'|'expired'|'changed';expiresAt:string;
 source:string;digest:string;testId:string|null;
};

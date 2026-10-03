export type ProjectRow={id:string;name:string;revision:number;versionId:string|null};
export type ReviewRow={id:string;projectId:string;name:string;expectedRevision:number;expiresAt:string;status:'pending'|'applied';revision:number;versionId:string|null;appliedAt:string|null};
export type SiteSafetyReview=ReviewRow&{url:string;state:'pending'|'applied'|'expired'|'changed'};
export type SiteSafetyInventory={version:1;projects:(ProjectRow&{url:string})[];next:string|null};
export type SiteSafetyReviews={version:1;reviews:SiteSafetyReview[];next:string|null};

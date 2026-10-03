export type SafetyService='backend'|'application';
export type ServiceSafetyResource={kind:SafetyService;projectId:string;name:string;url:string;published:boolean;revision:number;programRevision:number|null;versionId:string|null};
export type ServiceSafetyReview={id:string;kind:SafetyService;projectId:string;name:string;url:string;state:'pending'|'applied'|'expired'|'changed';expiresAt:string;expectedRevision:number;programRevision:number|null;versionId:string|null;publishedNow:boolean};
export type ServiceSafetyReceipt={version:1;review:ServiceSafetyReview};
export type ServiceSafetyReviews={version:1;reviews:ServiceSafetyReview[];next:string|null};

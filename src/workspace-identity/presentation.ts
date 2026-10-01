/** Non-secret browser state. It is a review snapshot, never an authorization capability. */
export type IdentityOffer={id:string;generation:number;attemptId:string|null;expectedRevision:number;expectedEpoch:number;createdAt:number;expiresAt:number;saved:boolean};
export type IdentityKey={id:string;name:string;status:'active'|'staged';created_at:number};
export type IdentityReview={id:string;mode:'all'|'some'|'none';lostIds:string[];retainedIds:string[];generation:number|null;savedAt:number|null;secured:boolean};
export type IdentityState={accountId:string;email:string;purpose:'workspace'|'enrollment'|'recovery';stage:'enrolling'|'ready'|'recovering';
 attemptId:string|null;expectedRevision:number;expectedEpoch:number;keys:IdentityKey[];freshPasskey:boolean;expiresAt:number;
 kit:{activeGeneration:number;offer:IdentityOffer|null};recovery:null|{status:string;review:IdentityReview|null;canComplete:boolean}};
export type IdentityStateResponse={version:1;identity:IdentityState|null};
export type PreparedIdentityKit={offer:IdentityOffer|null;key:string|null;filename:string|null;text:string|null};

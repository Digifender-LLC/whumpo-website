/** Pure view-fact shape shared by the server read binding, the shared client validator and the owner panel. */
export type GuestPreviewFacts={
 canIssue:boolean;
 versions:{id:string;createdAt:string}[];
 links:{id:string;versionId:string|null;label:string;feedbackEnabled:boolean;createdAt:number;expiresAt:number;revokedAt:number|null;state:'active'|'expired'|'revoked'|'removed';feedbackCount:number;openFeedbackCount:number}[];
};

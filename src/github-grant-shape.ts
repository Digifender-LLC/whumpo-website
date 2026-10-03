/** Public review metadata only. Provider credentials never cross this boundary. */
export type GitHubGrantReview={
 id:string;state:'review'|'expired'|'dispatching'|'uncertain'|'revoked'|'cancelled';
 githubUserId:string;login:string;credentialCount:number;expiresAt:string;settledAt:string|null;
 scope:'all-app-access';disclosure:string;
};

/** Owner-scoped metadata derived from an exact server-authored restore receipt. */
export type AppRestorePresentation={id:string;projectId:string;projectName:string;pointId:string;pointCreatedAt:string;versionId:string;documents:number;expiresAt:string;state:'ready'|'applied'|'expired'|'changed'};

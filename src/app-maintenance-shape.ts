export type AppMaintenancePresentation={
 kind:'upgrade'|'rollback';id:string;projectId:string;projectName:string;documents:number;expiresAt:string;
 state:'preparing'|'ready'|'uncertain'|'failed'|'changed'|'cancelled'|'applied'|'expired';
 fromVersion:string;toVersion:string;pointId:string;beforePointId:string;
 transformVersion?:string;testId?:string;pointCreatedAt?:string;
 ready:number;pending:number;failed:number;busy?:number;changedDocuments?:number;
};

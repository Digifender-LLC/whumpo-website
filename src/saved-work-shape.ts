export const savedWorkKinds={
 chat:'Chat request',form:'Chat form or handoff',inference:'Assistant request',website:'Website publication',
 'website-change':'Private website change','website-save':'Saved website result','service-change':'Website service settings','service-save':'Saved service result',
 'service-activation':'Website service activation','backend-test':'Backend test','backend-data':'Backend data change',backend:'Backend publication',
 'website-tool':'Website tool settings','app-authority':'App authorization',application:'Visitor app publication','app-restore':'App data restore','app-upgrade':'App upgrade check',
 backup:'GitHub backup',dns:'DNS change',hosting:'Domain hosting','github-access':'GitHub access removal',
 'source-import':'Imported source',photo:'Photo upload',checkout:'Subscription checkout',
 'usage-review':'Usage support request','photo-removal':'Photo removal','version-removal':'Version removal','domain-proof':'Domain proof removal',contact:'Contact settings',directory:'Directory change',
} as const;
export type SavedWorkKind=keyof typeof savedWorkKinds;
export type SavedWorkPhase='review'|'working'|'uncertain'|'attention'|'finished'|'expired'|'form';
export type SavedWorkItem={key:string;kind:SavedWorkKind;id:string;projectId:string|null;projectName:string|null;state:string;phase:SavedWorkPhase;expiresAt:string|null;turnId:string|null;interactionId:string|null;safety:'website'|'backend'|'application'|null};
export type SavedWorkList={version:1;items:SavedWorkItem[];next:string|null};
export type SavedWorkDetail={version:1;item:SavedWorkItem};

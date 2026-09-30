// Version the complete contract: consumers must not infer support from the control Worker version.
export const cmsCapabilitiesPath='/_emdash/api/whumpo/capabilities';
export const cmsCapabilities={
 contract:'whumpo-cms-capabilities',version:1,
 media:{uploadVersion:1,uploadMaxBytes:1048576,uploadMimeType:'image/jpeg',metadataVersion:1,pageSize:20,previewVersion:1,previewMaxBytes:5242880},
 draftIdentity:{version:1,readRecovery:true},
 taxonomyManagement:{version:1,readRecovery:true,names:['categories','tags'],locale:'en',collection:'posts',articleAssignments:false,initialAssignmentVersion:1,maxInitialTerms:20},
 structuredContent:{excerptVersion:1,excerptMaxChars:512,excerptCollections:['posts'],imageVersion:1,version:1,collections:['posts','pages'],maxRequestBytes:4096,revisionRequired:true,stagedEdits:true},
} as const;
export function supportsStructuredCMS(value:unknown):boolean{
 if(!value||typeof value!=='object')return false;
 const v=value as Record<string,unknown>,s=v.structuredContent as Record<string,unknown>|undefined;
 return v.contract===cmsCapabilities.contract&&v.version===1&&!!s&&s.version===1&&s.maxRequestBytes===4096&&s.revisionRequired===true&&s.stagedEdits===true&&Array.isArray(s.collections)&&s.collections.length===2&&s.collections[0]==='posts'&&s.collections[1]==='pages';
}

export function supportsCMSUpload(value:unknown):boolean{
 if(!value||typeof value!=='object')return false;
 const v=value as {contract?:unknown;version?:unknown;media?:{uploadVersion?:unknown;uploadMaxBytes?:unknown;uploadMimeType?:unknown}};
 return v.contract===cmsCapabilities.contract&&v.version===1&&v.media?.uploadVersion===1&&v.media.uploadMaxBytes===1048576&&v.media.uploadMimeType==='image/jpeg';
}

export function supportsCMSImages(value:unknown):boolean{return supportsStructuredCMS(value)&&supportsCMSUpload(value)&&(value as {structuredContent:{imageVersion?:unknown}}).structuredContent.imageVersion===1;}

export function supportsCMSExcerpts(value:unknown):boolean{const s=(value as {structuredContent?:Record<string,unknown>}|null)?.structuredContent;return supportsStructuredCMS(value)&&s?.excerptVersion===1&&s.excerptMaxChars===512&&Array.isArray(s.excerptCollections)&&s.excerptCollections.length===1&&s.excerptCollections[0]==='posts';}

export function supportsCMSImportTaxonomies(value:unknown):boolean{
 const v=value as {draftIdentity?:Record<string,unknown>;taxonomyManagement?:Record<string,unknown>}|null,t=v?.taxonomyManagement;
 return supportsStructuredCMS(value)&&v?.draftIdentity?.version===1&&v.draftIdentity.readRecovery===true&&t?.version===1&&t.readRecovery===true&&t.locale==='en'&&t.collection==='posts'&&t.initialAssignmentVersion===1&&t.maxInitialTerms===20&&Array.isArray(t.names)&&t.names.length===2&&t.names[0]==='categories'&&t.names[1]==='tags';
}

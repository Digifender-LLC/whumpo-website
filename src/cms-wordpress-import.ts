import {captureCMSWordPressSource} from './cms-wordpress-sources';
import {prepareCMSImport} from './cms-imports';
import {CMSProjectError} from './cms-error';
type StagedArticle={sourceId:number;collection:'posts'|'pages'|null;sourceHTML:string;sourceAuthor:string|null;sourceURL:string|null;sourceStatus:string;sourceDate:string|null;sourceSlug:string|null;candidate:{data:{title:string;content:unknown}}|null};
/** Parser is a fixed server dependency, never a request body, model tool, URL or customer script. */
export type WordPressAnalyzer=(bytes:Uint8Array)=>Promise<{source:{digest:string};articles:StagedArticle[]}>;
export async function prepareCMSWordPressImport(db:D1Database,files:R2Bucket,user:string,project:string,sourceUploadId:string,sourceItemId:number,reviewId:string,env:Record<string,unknown>,analyze:WordPressAnalyzer){
 const {source,bytes}=await captureCMSWordPressSource(db,files,user,sourceUploadId);if(source.projectId!==project)throw new CMSProjectError(404,'Source file is not in this publishing space');
 const report=await analyze(bytes);if(report.source.digest!==source.digest)throw new CMSProjectError(503,'Source analysis did not match the retained export');
 const articles=report.articles.filter(a=>a.sourceId===sourceItemId);if(articles.length!==1||!articles[0].candidate||!articles[0].collection)throw new CMSProjectError(409,'This source article needs changes before import');
 const a=articles[0];
 return prepareCMSImport(db,user,project,reviewId,{sourceDigest:source.digest,sourceId:a.sourceId,collection:a.collection!,title:a.candidate!.data.title,content:a.candidate!.data.content,provenance:{sourceHTML:a.sourceHTML,author:a.sourceAuthor??'',sourceURL:a.sourceURL??'',sourceStatus:a.sourceStatus,sourceDate:a.sourceDate??'',sourceSlug:a.sourceSlug??''}},{...env,FILES:files},sourceUploadId);
}

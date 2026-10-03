import {noteSourceExport} from './fair-use-observation';
import {requireSpecificationAvailable} from './specification-safety';
import { versionPhotos, type PhotoAsset } from './photo-versions';
import {FileError} from './photo-format';
import { strToU8, zipSync } from 'fflate';
import { siteConfig, photoConfig, previewHeaders } from './components';
import { hashToken } from './security';

type ExportVersion = {id:string;component_id:string;config_json:string;html:string;digest:string;created_at:string};
/** Only bounded site artifacts enter this archive. No account, conversation or runtime bindings. */
export async function siteArchive(version:ExportVersion,photos:PhotoAsset[]=[]) {
 const config=version.component_id==='site-page@1'?siteConfig(JSON.parse(version.config_json)):version.component_id==='photo-page@1'?photoConfig(JSON.parse(version.config_json)):null;
 if(!config || strToU8(version.html).length>32768 || strToU8(version.config_json).length>8192 || await hashToken(version.html)!==version.digest)throw Error('Saved site cannot be exported');
 if(photos.length>4||photos.some(p=>p.bytes.length>1048576))throw new FileError(503,'Photo export exceeds the test limit');
 const manifest={...(photos.length?{photos:photos.map(p=>({id:p.id,alt:p.alt,sha256:p.digest,bytes:p.size}))}:{}),format:'whumpo-static-site',formatVersion:1,version:version.id,component:version.component_id,createdAt:version.created_at,htmlSha256:version.digest,configuration:config};
 const headers='/*\n'+Object.entries({...previewHeaders,...(version.component_id==='photo-page@1'?{'content-security-policy':previewHeaders['content-security-policy']+"; img-src 'self' data:"}:{})}).filter(([key])=>!['content-type','cache-control'].includes(key)).map(([key,value])=>`  ${key}: ${value}`).join('\n')+'\n';
 const readme=`Whumpo website export\n\nThis archive contains one exact saved website version.\n\npublic/index.html is the standalone HTML and CSS source. Open it in a browser to preview it, or upload only the public directory to a static website host. No build step, Whumpo account or model API is required to serve this file.\n\npublic/_headers retains the current website security policy on hosts that support Cloudflare-style header files. On other hosts, configure equivalent HTTP response headers yourself. The exported page has no scripts, external assets, forms or backend. Contact intake and website tools added by Whumpo hosting are not bundled here. Saved service-client settings are private configuration, not a portable backend. Those hosted services require their separately authorized Whumpo runtime; moving the static page elsewhere does not transfer their endpoints, data or approvals.\n\nwhumpo/site.json records the component configuration, version and SHA-256 checksum of index.html. Keep this metadata outside the public directory. Modifying index.html invalidates the recorded checksum. Importing a modified archive into Whumpo is not supported yet.\n\nThis export does not contain workspace accounts, chat history, API keys, billing data, databases or domain configuration. It does not publish, unpublish or otherwise change your Whumpo site. Your site text, attached photos and configuration are included, so share the archive only where you intend to share that content.\n`;
 // Text is bounded below 50 KiB; up to four checked 1 MiB photos may accompany it.
 // Fixed archive timestamp makes repeated downloads byte-identical.
 const assets=Object.fromEntries(photos.map(p=>[`public/assets/${p.id}.jpg`,p.bytes]));
 return zipSync({...assets,'public/index.html':strToU8(version.html),'public/_headers':strToU8(headers),'whumpo/site.json':strToU8(JSON.stringify(manifest,null,2)+'\n'),'README.txt':strToU8(readme)},{level:0,mtime:new Date('2020-01-01T00:00:00Z')});
}
export async function ownedExport(db:D1Database,userId:string,id:string,bucket?:R2Bucket) {
 const version=await db.prepare('SELECT v.id,v.component_id,v.config_json,v.html,v.digest,v.created_at FROM site_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=? AND p.owner_user_id=?').bind(id,userId).first<ExportVersion>();
 if(!version)return null;
 await requireSpecificationAvailable(db,version.id);
 let photos:PhotoAsset[]=[];
 if(version.component_id==='photo-page@1'){if(!bucket)throw new FileError(503,'Photo storage is unavailable');photos=await versionPhotos({DB:db,FILES:bucket},version.id,photoConfig(JSON.parse(version.config_json)));}
 const archive=await siteArchive(version,photos);
 try{await noteSourceExport(db,userId,id);}catch{console.warn(JSON.stringify({event:'fair_use.export_observation_unavailable'}));}
 return archive;
}

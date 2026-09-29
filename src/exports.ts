import { strToU8, zipSync } from 'fflate';
import { launchConfig, siteConfig, previewHeaders } from './components';
import { hashToken } from './security';

type ExportVersion = {id:string;component_id:string;config_json:string;html:string;digest:string;created_at:string};
/** Only bounded site artifacts enter this archive. No account, conversation or runtime bindings. */
export async function siteArchive(version:ExportVersion) {
 const config=version.component_id==='launch-page@1'?launchConfig(JSON.parse(version.config_json)):version.component_id==='site-page@1'?siteConfig(JSON.parse(version.config_json)):null;
 if(!config || strToU8(version.html).length>32768 || strToU8(version.config_json).length>8192 || await hashToken(version.html)!==version.digest)throw Error('Saved site cannot be exported');
 const manifest={format:'tellumo-static-site',formatVersion:1,version:version.id,component:version.component_id,createdAt:version.created_at,htmlSha256:version.digest,configuration:config};
 const headers='/*\n'+Object.entries(previewHeaders).filter(([key])=>!['content-type','cache-control'].includes(key)).map(([key,value])=>`  ${key}: ${value}`).join('\n')+'\n';
 const readme=`TellUmo website export\n\nThis archive contains one exact saved website version.\n\npublic/index.html is the standalone HTML and CSS source. Open it in a browser to preview it, or upload only the public directory to a static website host. No build step, TellUmo account or model API is required to serve this file.\n\npublic/_headers retains the current website security policy on hosts that support Cloudflare-style header files. On other hosts, configure equivalent HTTP response headers yourself. The exported page has no scripts, external assets, forms or backend.\n\ntellumo/site.json records the component configuration, version and SHA-256 checksum of index.html. Keep this metadata outside the public directory. Modifying index.html invalidates the recorded checksum. Importing a modified archive into TellUmo is not supported yet.\n\nThis export does not contain workspace accounts, chat history, API keys, billing data, databases or domain configuration. It does not publish, unpublish or otherwise change your TellUmo site. Your site text and configuration are included, so share the archive only where you intend to share that content.\n`;
 // Stored ZIP avoids compression CPU; payload is bounded below 50 KiB by schema.
 // Fixed archive timestamp makes repeated downloads byte-identical.
 return zipSync({'public/index.html':strToU8(version.html),'public/_headers':strToU8(headers),'tellumo/site.json':strToU8(JSON.stringify(manifest,null,2)+'\n'),'README.txt':strToU8(readme)},{level:0,mtime:new Date('2020-01-01T00:00:00Z')});
}
export async function ownedExport(db:D1Database,userId:string,id:string) {
 const version=await db.prepare('SELECT v.id,v.component_id,v.config_json,v.html,v.digest,v.created_at FROM site_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=? AND p.owner_user_id=?').bind(id,userId).first<ExportVersion>();
 return version ? siteArchive(version) : null;
}

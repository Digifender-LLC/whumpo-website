import {previewHeaders} from './components';
/** `_headers` for a static copy of one saved website page, shared by the `whumpo-static-site` v1 source download
 * (exports.ts) and the WH-187 portable bundle's `site/public/_headers`, so both static paths keep the same security
 * policy (docs/portable-exports.md decision 4). Cloudflare-style header file; hosts without it set these themselves. */
export function staticSiteHeaders(componentId:string){
 return '/*\n'+Object.entries({...previewHeaders,...(componentId==='photo-page@1'?{'content-security-policy':previewHeaders['content-security-policy']+"; img-src 'self' data:"}:{})}).filter(([key])=>!['content-type','cache-control'].includes(key)).map(([key,value])=>`  ${key}: ${value}`).join('\n')+'\n';
}

import {CMSProjectError} from './cms-error';
/** Native Portable Text image subset. URLs/providers/layout extensions are deliberately unsupported. */
export type CMSImageBlock={_type:'image';_key:string;asset:{_ref:string};alt:string;caption?:string};
export type CMSResolvedImage={src:string;width:number;height:number};
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const invalid=()=>new CMSProjectError(409,'This image needs a supported local media reference and description');
export function cmsImageBlock(value:unknown):CMSImageBlock{
 const b=object(value),asset=object(b?.asset);
 if(!b||b._type!=='image'||typeof b._key!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(b._key)||Object.keys(b).some(k=>!['_type','_key','asset','alt','caption'].includes(k)))throw invalid();
 if(!asset||Object.keys(asset).length!==1||typeof asset._ref!=='string'||!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(asset._ref))throw invalid();
 if(typeof b.alt!=='string'||b.alt.length>500||/[\x00-\x1f\x7f]/.test(b.alt)||b.caption!==undefined&&(typeof b.caption!=='string'||b.caption.length>1000||/[\x00-\x1f\x7f]/.test(b.caption)))throw invalid();
 return {_type:'image',_key:b._key,asset:{_ref:asset._ref},alt:b.alt,...(b.caption===undefined?{}:{caption:b.caption as string})};
}
/** Inventory only: callers must still authorize every reference against this CMS instance. */
export function cmsImageReferences(content:unknown):CMSImageBlock[]{
 if(!Array.isArray(content)||content.length>30)throw invalid();
 const images:CMSImageBlock[]=[],keys=new Set<string>();
 for(const block of content){if(object(block)?._type!=='image')continue;const image=cmsImageBlock(block);if(keys.has(image._key))throw invalid();keys.add(image._key);images.push(image);}
 if(images.length>4)throw new CMSProjectError(409,'Use at most four article images');
 return images;
}
/** Only Whumpo-controlled owner preview and immutable publication image routes can be rendered. */
export function cmsResolvedImage(value:CMSResolvedImage){
 const uuid='[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
 const preview=new RegExp('^/api/cms/'+uuid+'/media/[0-9A-HJKMNP-TV-Z]{26}/preview$');
 const published=new RegExp('^/cms/media/'+uuid+'/[0-9a-f]{64}\\.jpg$');
 if(!value||typeof value.src!=='string'||!preview.test(value.src)&&!published.test(value.src)||!Number.isSafeInteger(value.width)||!Number.isSafeInteger(value.height)||value.width<1||value.height<1||value.width>1600||value.height>1600)throw new CMSProjectError(409,'Article image bytes have not been resolved for this view');
 return value;
}

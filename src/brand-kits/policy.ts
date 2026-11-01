import {BackendError} from '../backend-error';
import {brandDensities,brandFonts,brandProblems,brandRadii,isHex,sectionVariants,validateBrand,type Brand,type BrandColors,type SectionVariant} from '../brand-tokens';
import {canonicalJSON,jsonDigest} from '../project-specification/v2/json';

/** WH-091 shared policy for owner kits and saved sections (docs/brand-kits.md). Pure: the owner handlers and the apply controls
 * import only this, and neither the compiler nor the Worker serving a site ever reads a kit. */
export const brandKitFeature='creator.brand-kits' as const;
export const savedSectionFeature='creator.saved-sections' as const;
export class BrandKitError extends BackendError{constructor(status:number,message:string){super(status,message);}}
export const kitLimits=Object.freeze({kits:20,sections:60,versions:50});
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export const isUuid=(v:unknown):v is string=>typeof v==='string'&&uuid.test(v);
const record=(v:unknown,keys:readonly string[],message:string):Record<string,unknown>=>{
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||!keys.every(k=>Object.hasOwn(v,k)))throw new BrandKitError(400,message);
 return v as Record<string,unknown>;
};
export function cleanName(value:unknown,what:string){
 if(typeof value!=='string'||!value.trim()||value.trim().length>60||/[\u0000-\u001f\u007f]/.test(value))throw new BrandKitError(400,`Give the ${what} a name of up to 60 characters.`);
 return value.trim();
}
export type KitTokens={light:BrandColors;dark:BrandColors|null;font:Brand['font'];radius:Brand['radius'];density:Brand['density'];logoAlt:string|null};
const palette=(v:unknown,label:string):BrandColors=>{
 const p=record(v,['ink','paper','accent'],`Choose ${label} text, background and accent colors.`);
 for(const key of ['ink','paper','accent'])if(!isHex(p[key]))throw new BrandKitError(400,`Use colors in the form #rrggbb (${label} ${key==='ink'?'text':key==='paper'?'background':'accent'}).`);
 return {ink:p.ink as string,paper:p.paper as string,accent:p.accent as string};
};
/** The one gate for what a kit may hold. Colors that cannot be read are refused with the reason in plain words. */
export function kitTokens(value:unknown):KitTokens{
 const t=record(value,['light','dark','font','radius','density','logoAlt'],'Send light colors, dark colors or none, a type style, corner style, spacing and a logo description or none.');
 const tokens:KitTokens={light:palette(t.light,'light mode'),dark:t.dark===null?null:palette(t.dark,'dark mode'),font:t.font as Brand['font'],radius:t.radius as Brand['radius'],density:t.density as Brand['density'],logoAlt:t.logoAlt as string|null};
 if(typeof tokens.font!=='string'||!Object.hasOwn(brandFonts,tokens.font))throw new BrandKitError(400,'Choose one of the listed type styles.');
 if(typeof tokens.radius!=='string'||!Object.hasOwn(brandRadii,tokens.radius))throw new BrandKitError(400,'Choose one of the listed corner styles.');
 if(typeof tokens.density!=='string'||!Object.hasOwn(brandDensities,tokens.density))throw new BrandKitError(400,'Choose one of the listed spacing options.');
 if(tokens.logoAlt!==null&&(typeof tokens.logoAlt!=='string'||!tokens.logoAlt.trim()||tokens.logoAlt.length>100||/[\u0000-\u001f\u007f]/.test(tokens.logoAlt)))throw new BrandKitError(400,'Describe the logo in up to 100 characters, or leave it empty.');
 if(tokens.logoAlt!==null)tokens.logoAlt=tokens.logoAlt.trim();
 const {logoAlt:_alt,...style}=tokens,problems=brandProblems({source:null,logo:null,...style});
 if(problems.length)throw new BrandKitError(422,'These colors cannot be saved. '+problems.map(p=>p.message).join(' '));
 // Same closed validation the compiler runs, so a saved kit can never be refused later for shape.
 validateBrand({source:null,logo:null,...style},(code,path)=>{throw new BrandKitError(400,`The brand colors and styles are not valid (${code} at ${path}).`);});
 return tokens;
}
export type SectionContent={heading:string;text:string;variant:SectionVariant};
export function sectionContent(value:unknown):SectionContent{
 const s=record(value,['heading','text','variant'],'Send a heading, text and a section style.');
 const line=(v:unknown,max:number,what:string)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))throw new BrandKitError(400,`${what} must be 1 to ${max} characters of plain text.`);return v.trim();};
 if(typeof s.variant!=='string'||!(sectionVariants as readonly string[]).includes(s.variant))throw new BrandKitError(400,'Choose one of the listed section styles.');
 return {heading:line(s.heading,100,'The heading'),text:line(s.text,800,'The text'),variant:s.variant as SectionVariant};
}
export const tokensJSON=(t:KitTokens)=>canonicalJSON(t,1024);
// The 2,048 byte budget is on UTF-8 bytes, so text the character limits allow can exceed it (800 Japanese characters are 2,400). Say so as a 400.
export function contentJSON(c:SectionContent){
 try{return canonicalJSON(c,2048);}
 catch(error){if((error as {code?:string}).code==='INPUT_TOO_LARGE')throw new BrandKitError(400,'This section is too long to save (limit 2,048 bytes; characters outside the basic Latin alphabet count for more). Shorten the heading or text.');throw error;}
}
export const digestOf=(canonical:string)=>jsonDigest(JSON.parse(canonical));

import {brandDensities,brandFonts,brandRadii,sectionVariants,tintOf,validateBrand,type Brand,type SectionVariant} from './brand-tokens';
/** Platform-authored source only. Never populate this catalog from tenant records. */
export const componentCatalog = Object.freeze([
  Object.freeze({ id: 'photo-page@1', name: 'Website with photos', version: 1, capabilities: ['project-photos'], source: 'Whumpo platform', configuration: ['name','description','theme','brand','headline','aboutTitle','aboutText','sections','photos'] }),
  Object.freeze({ id: 'site-page@1', name: 'Information site', version: 1, capabilities: [] as string[], source: 'Whumpo platform', configuration: ['name','description','theme','brand','headline','aboutTitle','aboutText','sections'] })
]);
type BasePageConfig = { name: string; description: string; theme: 'ocean' | 'clay' | 'forest'; brand?: Brand };
function brandOf(value: unknown): Brand | undefined { if (value === undefined) return undefined; validateBrand(value, () => { throw new Error('Invalid component configuration'); }); return value; }
function basePageConfig(value: unknown): BasePageConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid component configuration');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !['name', 'description', 'theme', 'brand'].includes(key)) || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100 || typeof data.description !== 'string' || data.description.length > 1000 || !['ocean','clay','forest'].includes(String(data.theme))) throw new Error('Invalid component configuration');
  const brand = brandOf(data.brand);
  return {name:data.name.trim(),description:data.description.trim(),theme:data.theme as BasePageConfig['theme'],...(brand?{brand}:{})};
}
function escape(value: string) { return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }
/** Configuration is plain text, never markup, CSS, URLs or executable expressions. Brand values are the only owner-chosen
 * styling: each is a validated #rrggbb string or a key into a fixed table (src/brand-tokens.ts), never owner text.
 * Every `replace` passes a function so a `$&` or `$'` in owner text is copied literally (D50). */
function palette(theme: BasePageConfig['theme']) { return {ocean:['#123f4e','#d9eef0','#f3f9f9'],clay:['#6c3928','#f0d2bf','#fcf5ed'],forest:['#254b38','#dbe8c9','#f6f8ef']}[theme]; }
function rootCss(config: BasePageConfig) {
  const b = config.brand, p = palette(config.theme);
  const font = brandFonts[b?.font ?? 'classic'], radius = b ? brandRadii[b.radius].px : 24, space = brandDensities[b?.density ?? 'comfortable'].scale;
  const colors = b ? {ink: b.light.ink, tint: tintOf(b.light), paper: b.light.paper, accent: b.light.accent} : {ink: p[0], tint: p[1], paper: p[2], accent: p[0]};
  let css = `:root{color-scheme:${b?.dark ? 'light dark' : 'light'};--ink:${colors.ink};--tint:${colors.tint};--paper:${colors.paper};--accent:${colors.accent};--radius:${radius}px;--space:${space};--heading:${font.heading};--body:${font.body}}`;
  if (b?.dark) css += `@media(prefers-color-scheme:dark){:root{--ink:${b.dark.ink};--tint:${tintOf(b.dark)};--paper:${b.dark.paper};--accent:${b.dark.accent}}}`;
  return css;
}
function renderPageShell(value: BasePageConfig) {
  const config = basePageConfig(value);
  const logo = config.brand?.logo ? `<img class="logo" src="assets/${config.brand.logo.id}.jpg" alt="${escape(config.brand.logo.alt)}">` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(config.name)}</title><style>
${rootCss(config)}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--body)}a{color:var(--accent)}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid var(--accent);outline-offset:3px}header,main,footer{max-width:1120px;margin:auto;padding:calc(28px*var(--space)) 7%}header{display:flex;justify-content:space-between;gap:24px;align-items:center;border-bottom:1px solid var(--tint)}.brand{display:flex;align-items:center;gap:12px;font-size:18px;font-weight:700;overflow-wrap:anywhere}.logo{display:block;height:40px;width:auto;max-width:160px;object-fit:contain;border-radius:calc(var(--radius)*.3)}.tag{font-size:11px;text-transform:uppercase;letter-spacing:.15em;white-space:nowrap;color:var(--accent)}.hero{padding-top:calc(90px*var(--space));padding-bottom:calc(85px*var(--space))}.eyebrow{text-transform:uppercase;letter-spacing:.18em;font-size:12px;color:var(--accent)}h1{font-family:var(--heading);font-weight:400;font-size:clamp(46px,8vw,92px);line-height:1.05;letter-spacing:-.045em;max-width:850px;margin:24px 0;overflow-wrap:anywhere}.intro{max-width:660px;font-size:20px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}.rule{width:64px;height:5px;background:var(--accent);margin:38px 0}.about{background:var(--tint);border-radius:var(--radius);padding:calc(36px*var(--space));display:grid;grid-template-columns:1fr 2fr;gap:32px}.about h2{font-family:var(--heading);font-size:32px;font-weight:400;margin:0}.about p{margin:0;line-height:1.8;font-size:17px;overflow-wrap:anywhere}footer{padding-top:40px;padding-bottom:40px;font-size:12px;display:flex;justify-content:space-between;gap:20px}@media(max-width:600px){.hero{padding-top:calc(50px*var(--space));padding-bottom:calc(48px*var(--space))}.about{grid-template-columns:1fr;padding:calc(26px*var(--space))}.intro{font-size:18px}header .tag{display:none}footer{display:block}}
</style></head><body><header><span class="brand">${logo}<span>${escape(config.name)}</span></span><span class="tag">Something good is taking shape</span></header><main><section class="hero"><p class="eyebrow">Welcome to</p><h1>${escape(config.name)}</h1><div class="rule"></div><p class="intro">${escape(config.description || 'Our next chapter starts here.')}</p></section><section class="about"><h2>A little introduction.</h2><p>${escape(config.description || 'More details are coming soon.')}</p></section></main><footer><span>${escape(config.name)}</span><span>First draft · Made with Whumpo</span></footer></body></html>`;
}
export const previewHeaders = {
 'content-type':'text/html; charset=utf-8', 'cache-control':'private, no-store',
 'content-security-policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
 'x-content-type-options':'nosniff', 'x-frame-options':'DENY', 'referrer-policy':'no-referrer',
 'cross-origin-opener-policy':'same-origin', 'permissions-policy':'camera=(), microphone=(), geolocation=()'
};

export type SiteSection={heading:string;text:string;variant:SectionVariant};
export type SiteConfig = BasePageConfig & {headline:string; aboutTitle:string; aboutText:string; sections:SiteSection[]};
/** A versioned component contract. Changes to the renderer require a new component ID. */
export function siteConfig(value:unknown):SiteConfig {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid site configuration');
 const data=value as Record<string,unknown>;
 const keys=['name','description','theme','headline','aboutTitle','aboutText','sections'];
 if(Object.keys(data).some(k=>!keys.includes(k)&&k!=='brand')||keys.some(k=>!(k in data)))throw Error('Invalid site configuration');
 const core=basePageConfig({name:data.name,description:data.description,theme:data.theme,...(data.brand!==undefined?{brand:data.brand}:{})});
 function field(v:unknown,max:number){if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('Invalid site text');return v.trim();}
 if(!Array.isArray(data.sections)||data.sections.length>6)throw Error('Invalid site sections');
 const sections=data.sections.map(section=>{
  if(!section||typeof section!=='object'||Array.isArray(section)||Object.keys(section).some(k=>!['heading','text','variant'].includes(k)))throw Error('Invalid section');
  const variant=(section as Record<string,unknown>).variant??'plain';
  if(typeof variant!=='string'||!(sectionVariants as readonly string[]).includes(variant))throw Error('Invalid section');
  return {heading:field(section.heading,100),text:field(section.text,800),variant:variant as SectionVariant};
 });
 const config={...core,headline:field(data.headline,160),aboutTitle:field(data.aboutTitle,100),aboutText:field(data.aboutText,1000),sections};
 if(new TextEncoder().encode(JSON.stringify(config)).length>7168)throw Error('Site configuration too large');
 return config;
}
const SECTION_CSS='.sections{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:28px;margin:40px 0}.feature{padding:calc(24px*var(--space)) 0;border-top:1px solid var(--accent)}.feature h2{font-family:var(--heading);font-size:28px;font-weight:400;overflow-wrap:anywhere}.feature p{line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.feature-card{background:var(--tint);border-top:0;border-radius:var(--radius);padding:calc(24px*var(--space))}.feature-callout{background:var(--tint);border-top:0;border-left:6px solid var(--accent);border-radius:0 var(--radius) var(--radius) 0;padding:calc(24px*var(--space))}.feature-quote{border-top:0;border-left:3px solid var(--accent);padding-left:24px}.feature-quote p{font-family:var(--heading);font-size:22px;font-style:italic}';
export function renderSite(value:SiteConfig){
 const c=siteConfig(value);
 const base=renderPageShell({name:c.name,description:c.description,theme:c.theme,...(c.brand?{brand:c.brand}:{})});
 const html=base.replace(`<h1>${escape(c.name)}</h1>`,()=>`<h1>${escape(c.headline)}</h1>`)
 .replace(`<section class="about"><h2>A little introduction.</h2><p>${escape(c.description||'More details are coming soon.')}</p></section>`,()=>`<section class="about"><h2>${escape(c.aboutTitle)}</h2><p>${escape(c.aboutText)}</p></section>`)
 .replace('</main>',()=>`<div class="sections">${c.sections.map(s=>`<section class="feature${s.variant==='plain'?'':' feature-'+s.variant}"><h2>${escape(s.heading)}</h2><p>${escape(s.text)}</p></section>`).join('')}</div></main>`)
 .replace('</style>',()=>`${SECTION_CSS}</style>`)
 .replace('First draft · Made with Whumpo','Made with Whumpo');
 if(new TextEncoder().encode(html).length>32768)throw Error('Rendered site too large');
 return html;
}

export type PhotoConfig=SiteConfig & {photos:{id:string;alt:string}[]};
export function photoConfig(value:unknown):PhotoConfig {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid photo page');
 const {photos,...base}=value as Record<string,unknown>;
 if(!Array.isArray(photos)||photos.length>4)throw Error('Use at most four photos');
 const ids=new Set<string>();
 const validated=photos.map(p=>{
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['id','alt'].includes(k))||typeof p.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(p.id)||ids.has(p.id)||typeof p.alt!=='string'||!p.alt.trim()||p.alt.length>200)throw Error('Invalid photo reference');
  ids.add(p.id);return {id:p.id,alt:p.alt.trim()};
 });
 const result={...siteConfig(base),photos:validated};
 if(new TextEncoder().encode(JSON.stringify(result)).length>9216)throw Error('Photo page too large');return result;
}
export function renderPhotoPage(value:PhotoConfig){
 const c=photoConfig(value);
 const {photos,...base}=c;
 const html=renderSite(base).replace('</main>',()=>`<section class="photo-gallery" aria-label="Photos">${c.photos.map(p=>`<figure><img src="assets/${p.id}.jpg" alt="${escape(p.alt)}" loading="lazy"></figure>`).join('')}</section></main>`).replace('</style>',()=>`.photo-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:24px;margin:40px 0}.photo-gallery figure{margin:0}.photo-gallery img{display:block;width:100%;height:auto;border-radius:calc(var(--radius)*.75)}</style>`);
 if(new TextEncoder().encode(html).length>32768)throw Error('Rendered site too large');return html;
}

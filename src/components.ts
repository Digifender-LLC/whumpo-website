/** Platform-authored source only. Never populate this catalog from tenant records. */
export const componentCatalog = Object.freeze([
  Object.freeze({ id: 'launch-page@1', name: 'Launch page', version: 1, capabilities: [] as string[], source: 'Whumpo platform', configuration: ['name', 'description', 'theme'] }),
  Object.freeze({ id: 'photo-page@1', name: 'Website with photos', version: 1, capabilities: ['project-photos'], source: 'Whumpo platform', configuration: ['name','description','theme','headline','aboutTitle','aboutText','sections','photos'] }),
  Object.freeze({ id: 'site-page@1', name: 'Information site', version: 1, capabilities: [] as string[], source: 'Whumpo platform', configuration: ['name','description','theme','headline','aboutTitle','aboutText','sections'] })
]);
export type LaunchConfig = { name: string; description: string; theme: 'ocean' | 'clay' | 'forest' };
export function launchConfig(value: unknown): LaunchConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid component configuration');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !['name', 'description', 'theme'].includes(key)) || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100 || typeof data.description !== 'string' || data.description.length > 1000 || !['ocean','clay','forest'].includes(String(data.theme))) throw new Error('Invalid component configuration');
  return {name:data.name.trim(),description:data.description.trim(),theme:data.theme as LaunchConfig['theme']};
}
function escape(value: string) { return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }
/** Configuration is plain text, never markup, CSS, URLs or executable expressions. */
export function renderLaunch(value: LaunchConfig) {
  const config = launchConfig(value);
  const palette = {ocean:['#123f4e','#d9eef0','#f3f9f9'],clay:['#6c3928','#f0d2bf','#fcf5ed'],forest:['#254b38','#dbe8c9','#f6f8ef']}[config.theme];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(config.name)}</title><style>
:root{color-scheme:light;--ink:${palette[0]};--tint:${palette[1]};--paper:${palette[2]}}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Arial,sans-serif}header,main,footer{max-width:1120px;margin:auto;padding:28px 7%}header{display:flex;justify-content:space-between;gap:24px;align-items:center;border-bottom:1px solid var(--tint)}.brand{font-size:18px;font-weight:700;overflow-wrap:anywhere}.tag{font-size:11px;text-transform:uppercase;letter-spacing:.15em;white-space:nowrap}.hero{padding-top:90px;padding-bottom:85px}.eyebrow{text-transform:uppercase;letter-spacing:.18em;font-size:12px}h1{font-family:Georgia,serif;font-weight:400;font-size:clamp(46px,8vw,92px);line-height:1.05;letter-spacing:-.045em;max-width:850px;margin:24px 0;overflow-wrap:anywhere}.intro{max-width:660px;font-size:20px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}.rule{width:64px;height:5px;background:var(--ink);margin:38px 0}.about{background:var(--tint);border-radius:24px;padding:36px;display:grid;grid-template-columns:1fr 2fr;gap:32px}.about h2{font-family:Georgia,serif;font-size:32px;font-weight:400;margin:0}.about p{margin:0;line-height:1.8;font-size:17px;overflow-wrap:anywhere}footer{padding-top:40px;padding-bottom:40px;font-size:12px;display:flex;justify-content:space-between;gap:20px}@media(max-width:600px){.hero{padding-top:50px;padding-bottom:48px}.about{grid-template-columns:1fr;padding:26px}.intro{font-size:18px}header .tag{display:none}footer{display:block}}
</style></head><body><header><span class="brand">${escape(config.name)}</span><span class="tag">Something good is taking shape</span></header><main><section class="hero"><p class="eyebrow">Welcome to</p><h1>${escape(config.name)}</h1><div class="rule"></div><p class="intro">${escape(config.description || 'Our next chapter starts here.')}</p></section><section class="about"><h2>A little introduction.</h2><p>${escape(config.description || 'More details are coming soon.')}</p></section></main><footer><span>${escape(config.name)}</span><span>First draft · Made with Whumpo</span></footer></body></html>`;
}
export const previewHeaders = {
 'content-type':'text/html; charset=utf-8', 'cache-control':'private, no-store',
 'content-security-policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
 'x-content-type-options':'nosniff', 'x-frame-options':'DENY', 'referrer-policy':'no-referrer',
 'cross-origin-opener-policy':'same-origin', 'permissions-policy':'camera=(), microphone=(), geolocation=()'
};

export type SiteConfig = LaunchConfig & {headline:string; aboutTitle:string; aboutText:string; sections:{heading:string;text:string}[]};
/** A versioned component contract. Changes to the renderer require a new component ID. */
export function siteConfig(value:unknown):SiteConfig {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid site configuration');
 const data=value as Record<string,unknown>;
 const keys=['name','description','theme','headline','aboutTitle','aboutText','sections'];
 if(Object.keys(data).some(k=>!keys.includes(k))||keys.some(k=>!(k in data)))throw Error('Invalid site configuration');
 const core=launchConfig({name:data.name,description:data.description,theme:data.theme});
 function field(v:unknown,max:number){if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('Invalid site text');return v.trim();}
 if(!Array.isArray(data.sections)||data.sections.length>6)throw Error('Invalid site sections');
 const sections=data.sections.map(section=>{
  if(!section||typeof section!=='object'||Array.isArray(section)||Object.keys(section).some(k=>!['heading','text'].includes(k)))throw Error('Invalid section');
  return {heading:field(section.heading,100),text:field(section.text,800)};
 });
 const config={...core,headline:field(data.headline,160),aboutTitle:field(data.aboutTitle,100),aboutText:field(data.aboutText,1000),sections};
 if(new TextEncoder().encode(JSON.stringify(config)).length>6144)throw Error('Site configuration too large');
 return config;
}
export function renderSite(value:SiteConfig){
 const c=siteConfig(value);
 const base=renderLaunch({name:c.name,description:c.description,theme:c.theme});
 const html=base.replace(`<h1>${escape(c.name)}</h1>`,`<h1>${escape(c.headline)}</h1>`)
 .replace(`<section class="about"><h2>A little introduction.</h2><p>${escape(c.description||'More details are coming soon.')}</p></section>`,`<section class="about"><h2>${escape(c.aboutTitle)}</h2><p>${escape(c.aboutText)}</p></section>`)
 .replace('</main>',`<div class="sections">${c.sections.map(s=>`<section class="feature"><h2>${escape(s.heading)}</h2><p>${escape(s.text)}</p></section>`).join('')}</div></main>`)
 .replace('</style>',`.sections{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:28px;margin:40px 0}.feature{padding:24px 0;border-top:1px solid var(--ink)}.feature h2{font-family:Georgia,serif;font-size:28px;font-weight:400;overflow-wrap:anywhere}.feature p{line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}</style>`)
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
 if(new TextEncoder().encode(JSON.stringify(result)).length>8192)throw Error('Photo page too large');return result;
}
export function renderPhotoPage(value:PhotoConfig){
 const c=photoConfig(value);
 const {photos,...base}=c;
 const html=renderSite(base).replace('</main>',`<section class="photo-gallery" aria-label="Photos">${c.photos.map(p=>`<figure><img src="assets/${p.id}.jpg" alt="${escape(p.alt)}" loading="lazy"></figure>`).join('')}</section></main>`).replace('</style>',`.photo-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:24px;margin:40px 0}.photo-gallery figure{margin:0}.photo-gallery img{display:block;width:100%;height:auto;border-radius:18px}</style>`);
 if(new TextEncoder().encode(html).length>32768)throw Error('Rendered site too large');return html;
}

import {BackendError} from '../backend-error';
import {assertFeature} from '../feature-admission';
import {featureRequest} from '../feature-inclusion';
import {readSpecification,prepareSpecification} from '../project-specification/store';
import {validateSpecification} from '../project-specification/v3/schema';
import {assertWorkspace} from '../workspace-identity/admission';
import type {Brand} from '../brand-tokens';
import {brandKitFeature,savedSectionFeature,isUuid,type KitTokens,type SectionContent} from './policy';

/** WH-091 typed owner controls `brandKitReview`, `brandRemoveReview` and `savedSectionReview`. Same shape as the appointment form
 * setup: never a model action. Each reads one saved, immutable, owner-scoped version and prepares the existing exact private website
 * review (`prepareSpecification`), so stale detection, safety holds, photo clearance for a logo, bounds and the reply are all the
 * existing ones. The tokens or text are copied into that review; nothing links the site back to the kit, so editing or deleting
 * a kit never changes a saved or published site. Saving stays the recent-sign-in `specificationApply`. */
async function head(db:D1Database,user:string,project:string){
 if(!isUuid(project))throw new BackendError(400,'Choose an owned project.');
 await assertWorkspace(db,user);
 const read=await readSpecification(db,user,project);
 if(!read.specification)throw new BackendError(404,'This project has no saved website yet. Ask Whumpo to draft the private website first.');
 return {revision:read.revision,spec:validateSpecification(read.specification)};
}
const review=(db:D1Database,user:string,turn:string,project:string,revision:number,operations:unknown[])=>
 prepareSpecification(db,user,turn,{kind:'specification',operation:'change',projectId:project,expectedRevision:revision,operations});

/** `/review-brand-kit PROJECT KIT VERSION LOGO|none` */
export async function prepareBrandKitCommand(db:D1Database,user:string,turn:string,command:string){
 if(!command.startsWith('/review-brand-kit '))return;
 const m=/^\/review-brand-kit ([0-9a-f-]{36}) ([0-9a-f-]{36}) ([1-9][0-9]?) ([0-9a-f-]{36}|none)$/.exec(command);
 if(!m||![m[1],m[2]].every(isUuid)||(m[4]!=='none'&&!isUuid(m[4])))throw new BackendError(400,'Choose an owned project and brand kit.');
 const [,project,kit,version,logo]=m;
 await assertFeature(db,featureRequest({userId:user,projectId:null,featureId:brandKitFeature,operation:'prepare'}));
 const row=await db.prepare('SELECT v.tokens_json FROM brand_kit_versions v JOIN brand_kits k ON k.id=v.kit_id WHERE v.kit_id=? AND v.version=? AND k.owner_user_id=?').bind(kit,Number(version),user).first<{tokens_json:string}>();
 if(!row)throw new BackendError(404,'Brand kit not found.');
 const tokens=JSON.parse(row.tokens_json) as KitTokens;
 if(logo!=='none'&&!tokens.logoAlt)throw new BackendError(409,'This brand kit has no logo description. Add one to the kit before choosing a logo.');
 const {revision}=await head(db,user,project);
 const brand:Brand={source:{kitId:kit,version:Number(version)},light:tokens.light,dark:tokens.dark,font:tokens.font,radius:tokens.radius,density:tokens.density,logo:logo==='none'?null:{id:logo,alt:tokens.logoAlt!}};
 return review(db,user,turn,project,revision,[{type:'design.setBrand',brand}]);
}
/** `/review-brand-remove PROJECT` */
export async function prepareBrandRemoveCommand(db:D1Database,user:string,turn:string,command:string){
 const m=/^\/review-brand-remove ([0-9a-f-]{36})$/.exec(command);
 if(!m)return;
 const {revision,spec}=await head(db,user,m[1]);
 if(!spec.design.brand)throw new BackendError(409,'This website has no brand kit applied.');
 return review(db,user,turn,m[1],revision,[{type:'design.setBrand',brand:null}]);
}
/** `/review-saved-section PROJECT SECTION VERSION PAGE`: appends one copy of the saved section to the end of a page. */
export async function prepareSavedSectionCommand(db:D1Database,user:string,turn:string,command:string){
 if(!command.startsWith('/review-saved-section '))return;
 const m=/^\/review-saved-section ([0-9a-f-]{36}) ([0-9a-f-]{36}) ([1-9][0-9]?) ([a-z][a-z0-9-]{0,39})$/.exec(command);
 if(!m||!isUuid(m[1])||!isUuid(m[2]))throw new BackendError(400,'Choose an owned project and saved section.');
 const [,project,section,version,pageId]=m;
 await assertFeature(db,featureRequest({userId:user,projectId:null,featureId:savedSectionFeature,operation:'prepare'}));
 const row=await db.prepare('SELECT v.content_json FROM saved_section_versions v JOIN saved_sections s ON s.id=v.section_id WHERE v.section_id=? AND v.version=? AND s.owner_user_id=?').bind(section,Number(version),user).first<{content_json:string}>();
 if(!row)throw new BackendError(404,'Saved section not found.');
 const content=JSON.parse(row.content_json) as SectionContent;
 const {revision,spec}=await head(db,user,project);
 const page=spec.pages.find(p=>p.id===pageId);
 if(!page)throw new BackendError(404,'Page not found.');
 if(page.sections.length>=6)throw new BackendError(409,'This page already has six sections, the most it can hold. Remove one first.');
 const text=(contentId:string)=>spec.content.find(c=>c.id===contentId)!.text;
 const sections=[...page.sections.map(s=>({heading:text(s.heading),text:text(s.text),variant:s.variant})),{heading:content.heading,text:content.text,variant:content.variant}];
 return review(db,user,turn,project,revision,[{type:'pages.setSections',pageId,sections}]);
}

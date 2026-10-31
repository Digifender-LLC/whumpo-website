import {featurePredicate} from '../feature-admission';
import {featureRequest,resolveFeatureInclusion} from '../feature-inclusion';
import {assertWorkspace} from '../workspace-identity/admission';
import {BrandKitError,brandKitFeature,savedSectionFeature,cleanName,contentJSON,digestOf,isUuid,kitTokens,sectionContent,tokensJSON,kitLimits,type KitTokens,type SectionContent} from './policy';

/** WH-091 owner handlers over the owner's own kits and saved sections. Reading, listing and deleting need only the current
 * workspace identity and ownership (saved history stays available if the plan ends); creating or saving a new version also
 * needs current `creator.brand-kits` / `creator.saved-sections`, composed into the insert so a plan change cannot race it.
 * A saved version is immutable. A stale save (another tab saved first) is refused, never merged. */
type Row={id:string;name:string;latest_version:number;created_at:string;updated_at:string;body:string;digest:string};
const id=(v:unknown,what:string)=>{if(!isUuid(v))throw new BrandKitError(400,`Choose an exact ${what}.`);return v;};
const clean=(v:unknown,keys:string[],message:string)=>{
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw new BrandKitError(400,message);
 return v as Record<string,unknown>;
};
async function gate(db:D1Database,userId:string,featureId:typeof brandKitFeature|typeof savedSectionFeature){
 const request=featureRequest({userId,projectId:null,featureId,operation:'confirm'});
 await assertWorkspace(db,userId);
 if(!(await resolveFeatureInclusion(db,request)).included)throw new BrandKitError(403,(featureId===brandKitFeature?'Brand kits':'Saved sections')+' need the Creator plan or higher, or an explicit scoped test grant. Your saved ones stay available to read, apply from earlier reviews, export and delete.');
 return featurePredicate(db,request);
}
function mapFailure(error:unknown,what:string){
 const text=String(error);
 if(text.includes('capacity'))return new BrandKitError(409,`You have reached the limit of saved ${what}s (${what==='brand kit'?kitLimits.kits:kitLimits.sections}). Delete one you no longer use first.`);
 if(text.includes('version_order')||text.includes('UNIQUE')||text.includes('PRIMARY KEY')||text.includes('CHECK constraint failed: version'))return new BrandKitError(409,`This ${what} changed since you opened it, or it already has ${kitLimits.versions} versions. Reload it and try again.`);
 return null;
}
const ownerKit=(r:Row)=>({id:r.id,name:r.name,version:r.latest_version,createdAt:r.created_at,updatedAt:r.updated_at,tokens:JSON.parse(r.body) as KitTokens,digest:r.digest});
const ownerSection=(r:Row)=>({id:r.id,name:r.name,version:r.latest_version,createdAt:r.created_at,updatedAt:r.updated_at,content:JSON.parse(r.body) as SectionContent,digest:r.digest});

export async function listBrandKits(db:D1Database,userId:string){
 await assertWorkspace(db,userId);
 const {results}=await db.prepare(`SELECT k.id,k.name,k.latest_version,k.created_at,k.updated_at,v.tokens_json body,v.tokens_digest digest FROM brand_kits k JOIN brand_kit_versions v ON v.kit_id=k.id AND v.version=k.latest_version
  WHERE k.owner_user_id=? ORDER BY k.updated_at DESC,k.id LIMIT ${kitLimits.kits}`).bind(userId).all<Row>();
 return {version:1 as const,kits:results.map(ownerKit)};
}
/** An exact earlier version, for reading what a site was built from. Owner-scoped. */
export async function readBrandKitVersion(db:D1Database,userId:string,kitId:string,version:number){
 id(kitId,'brand kit');
 const row=await db.prepare(`SELECT k.id,k.name,v.version latest_version,k.created_at,v.created_at updated_at,v.tokens_json body,v.tokens_digest digest FROM brand_kits k JOIN brand_kit_versions v ON v.kit_id=k.id
  WHERE k.id=? AND v.version=? AND k.owner_user_id=?`).bind(kitId,version,userId).first<Row>();
 if(!row)throw new BrandKitError(404,'Brand kit not found.');
 return ownerKit(row);
}
export async function createBrandKit(db:D1Database,userId:string,value:unknown){
 const v=clean(value,['id','name','tokens'],'Send a request ID, a name and the kit colors and styles.');
 const kit=id(v.id,'request ID'),name=cleanName(v.name,'brand kit'),tokens=kitTokens(v.tokens),body=tokensJSON(tokens),digest=await digestOf(body);
 const existing=await db.prepare('SELECT k.name,d.tokens_digest FROM brand_kits k JOIN brand_kit_versions d ON d.kit_id=k.id AND d.version=1 WHERE k.id=? AND k.owner_user_id=?').bind(kit,userId).first<{name:string;tokens_digest:string}>();
 if(existing){if(existing.name!==name||existing.tokens_digest!==digest)throw new BrandKitError(409,'This request ID was already used for a different brand kit.');}
 else{
  const g=await gate(db,userId,brandKitFeature),now=new Date().toISOString();
  try{
   await db.batch([
    db.prepare(`INSERT INTO brand_kits(id,owner_user_id,name,latest_version,created_at,updated_at) SELECT ?,?,?,1,?,? WHERE ${g.sql}`).bind(kit,userId,name,now,now,...g.params),
    db.prepare('INSERT INTO brand_kit_versions(kit_id,version,tokens_json,tokens_digest,created_at) VALUES(?,1,?,?,?)').bind(kit,body,digest,now)
   ]);
  }catch(error){throw mapFailure(error,'brand kit')??new BrandKitError(403,'Feature eligibility changed. Refresh the current plan and try again.');}
 }
 return (await listBrandKits(db,userId)).kits.find(k=>k.id===kit)!;
}
/** Saves a new immutable version. `expectedVersion` must be the version the owner was looking at. */
export async function saveBrandKitVersion(db:D1Database,userId:string,kitId:string,value:unknown){
 id(kitId,'brand kit');
 const v=clean(value,['expectedVersion','name','tokens'],'Send the version you were editing, a name and the kit colors and styles.');
 if(!Number.isSafeInteger(v.expectedVersion)||(v.expectedVersion as number)<1)throw new BrandKitError(400,'Send the version you were editing.');
 const expected=v.expectedVersion as number,name=cleanName(v.name,'brand kit'),tokens=kitTokens(v.tokens),body=tokensJSON(tokens),digest=await digestOf(body);
 const current=await db.prepare('SELECT latest_version FROM brand_kits WHERE id=? AND owner_user_id=?').bind(kitId,userId).first<{latest_version:number}>();
 if(!current)throw new BrandKitError(404,'Brand kit not found.');
 if(current.latest_version!==expected)throw new BrandKitError(409,'This brand kit changed since you opened it. Reload it and try again.');
 const g=await gate(db,userId,brandKitFeature),now=new Date().toISOString();
 try{
  await db.batch([
   db.prepare(`UPDATE brand_kits SET latest_version=latest_version+1,name=?,updated_at=? WHERE id=? AND owner_user_id=? AND latest_version=? AND ${g.sql}`).bind(name,now,kitId,userId,expected,...g.params),
   db.prepare('INSERT INTO brand_kit_versions(kit_id,version,tokens_json,tokens_digest,created_at) SELECT id,latest_version,?,?,? FROM brand_kits WHERE id=? AND owner_user_id=? AND latest_version=?').bind(body,digest,now,kitId,userId,expected+1)
  ]);
 }catch(error){throw mapFailure(error,'brand kit')??error;}
 const saved=(await listBrandKits(db,userId)).kits.find(k=>k.id===kitId);
 if(!saved||saved.version!==expected+1)throw new BrandKitError(409,'This brand kit changed since you opened it. Reload it and try again.');
 return saved;
}
/** Deleting a kit never touches a project: sites keep the tokens they copied in. */
export async function deleteBrandKit(db:D1Database,userId:string,kitId:string){
 await assertWorkspace(db,userId);
 const n=(await db.prepare('DELETE FROM brand_kits WHERE id=? AND owner_user_id=?').bind(id(kitId,'brand kit'),userId).run()).meta.changes;
 if(n<1)throw new BrandKitError(404,'Brand kit not found.');
 return {version:1 as const,deleted:true};
}

export async function listSavedSections(db:D1Database,userId:string){
 await assertWorkspace(db,userId);
 const {results}=await db.prepare(`SELECT s.id,s.name,s.latest_version,s.created_at,s.updated_at,v.content_json body,v.content_digest digest FROM saved_sections s JOIN saved_section_versions v ON v.section_id=s.id AND v.version=s.latest_version
  WHERE s.owner_user_id=? ORDER BY s.updated_at DESC,s.id LIMIT ${kitLimits.sections}`).bind(userId).all<Row>();
 return {version:1 as const,sections:results.map(ownerSection)};
}
export async function readSavedSectionVersion(db:D1Database,userId:string,sectionId:string,version:number){
 id(sectionId,'saved section');
 const row=await db.prepare(`SELECT s.id,s.name,v.version latest_version,s.created_at,v.created_at updated_at,v.content_json body,v.content_digest digest FROM saved_sections s JOIN saved_section_versions v ON v.section_id=s.id
  WHERE s.id=? AND v.version=? AND s.owner_user_id=?`).bind(sectionId,version,userId).first<Row>();
 if(!row)throw new BrandKitError(404,'Saved section not found.');
 return ownerSection(row);
}
export async function createSavedSection(db:D1Database,userId:string,value:unknown){
 const v=clean(value,['id','name','content'],'Send a request ID, a name and the section.');
 const section=id(v.id,'request ID'),name=cleanName(v.name,'saved section'),content=sectionContent(v.content),body=contentJSON(content),digest=await digestOf(body);
 const existing=await db.prepare('SELECT s.name,d.content_digest FROM saved_sections s JOIN saved_section_versions d ON d.section_id=s.id AND d.version=1 WHERE s.id=? AND s.owner_user_id=?').bind(section,userId).first<{name:string;content_digest:string}>();
 if(existing){if(existing.name!==name||existing.content_digest!==digest)throw new BrandKitError(409,'This request ID was already used for a different saved section.');}
 else{
  const g=await gate(db,userId,savedSectionFeature),now=new Date().toISOString();
  try{
   await db.batch([
    db.prepare(`INSERT INTO saved_sections(id,owner_user_id,name,latest_version,created_at,updated_at) SELECT ?,?,?,1,?,? WHERE ${g.sql}`).bind(section,userId,name,now,now,...g.params),
    db.prepare('INSERT INTO saved_section_versions(section_id,version,content_json,content_digest,created_at) VALUES(?,1,?,?,?)').bind(section,body,digest,now)
   ]);
  }catch(error){throw mapFailure(error,'saved section')??new BrandKitError(403,'Feature eligibility changed. Refresh the current plan and try again.');}
 }
 return (await listSavedSections(db,userId)).sections.find(s=>s.id===section)!;
}
export async function saveSavedSectionVersion(db:D1Database,userId:string,sectionId:string,value:unknown){
 id(sectionId,'saved section');
 const v=clean(value,['expectedVersion','name','content'],'Send the version you were editing, a name and the section.');
 if(!Number.isSafeInteger(v.expectedVersion)||(v.expectedVersion as number)<1)throw new BrandKitError(400,'Send the version you were editing.');
 const expected=v.expectedVersion as number,name=cleanName(v.name,'saved section'),content=sectionContent(v.content),body=contentJSON(content),digest=await digestOf(body);
 const current=await db.prepare('SELECT latest_version FROM saved_sections WHERE id=? AND owner_user_id=?').bind(sectionId,userId).first<{latest_version:number}>();
 if(!current)throw new BrandKitError(404,'Saved section not found.');
 if(current.latest_version!==expected)throw new BrandKitError(409,'This saved section changed since you opened it. Reload it and try again.');
 const g=await gate(db,userId,savedSectionFeature),now=new Date().toISOString();
 try{
  await db.batch([
   db.prepare(`UPDATE saved_sections SET latest_version=latest_version+1,name=?,updated_at=? WHERE id=? AND owner_user_id=? AND latest_version=? AND ${g.sql}`).bind(name,now,sectionId,userId,expected,...g.params),
   db.prepare('INSERT INTO saved_section_versions(section_id,version,content_json,content_digest,created_at) SELECT id,latest_version,?,?,? FROM saved_sections WHERE id=? AND owner_user_id=? AND latest_version=?').bind(body,digest,now,sectionId,userId,expected+1)
  ]);
 }catch(error){throw mapFailure(error,'saved section')??error;}
 const saved=(await listSavedSections(db,userId)).sections.find(s=>s.id===sectionId);
 if(!saved||saved.version!==expected+1)throw new BrandKitError(409,'This saved section changed since you opened it. Reload it and try again.');
 return saved;
}
export async function deleteSavedSection(db:D1Database,userId:string,sectionId:string){
 await assertWorkspace(db,userId);
 const n=(await db.prepare('DELETE FROM saved_sections WHERE id=? AND owner_user_id=?').bind(id(sectionId,'saved section'),userId).run()).meta.changes;
 if(n<1)throw new BrandKitError(404,'Saved section not found.');
 return {version:1 as const,deleted:true};
}

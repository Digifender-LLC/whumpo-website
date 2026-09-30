/** Trusted database view checks owner, exact digest, policy, coverage and expiry. */
export const approvedPhotoSQL="EXISTS(SELECT 1 FROM approved_project_photos safe WHERE safe.id=f.id AND safe.digest=f.digest)";
export const photoSafetySQL=`CASE WHEN ${approvedPhotoSQL} THEN 'approved' WHEN EXISTS(SELECT 1 FROM project_photo_safety safety WHERE safety.file_id=f.id AND safety.digest=f.digest AND safety.state='blocked') THEN 'blocked' ELSE 'pending' END`;
export async function photoBytesMatch(bytes:Uint8Array,digest:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('')===digest;}

import {hashToken} from './security';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
type DB=Pick<D1Database,'prepare'>;
type Metadata={id:string;version_id:string;digest:string;consent_at:string};
const selection=`SELECT n.id,n.version_id,n.digest,n.consent_at FROM backend_nominations n
 JOIN backend_versions v ON v.id=n.version_id JOIN projects p ON p.id=v.project_id
 WHERE n.state='nominated' AND n.consent_at IS NOT NULL AND n.withdrawn_at IS NULL
 AND p.owner_user_id=n.user_id AND v.digest=n.digest`;
function validate(row:Metadata){
 if(!uuid.test(row.id)||!uuid.test(row.version_id)||!/^[0-9a-f]{64}$/.test(row.digest)||!Number.isFinite(Date.parse(row.consent_at)))throw Error('Invalid intake record');
 return row;
}
/** Operator metadata only. IDs are cursors, not permission grants. No source is read by listing. */
export async function nominationQueue(db:DB,after?:string){
 if(after!==undefined&&!uuid.test(after))throw Error('Invalid intake cursor');
 const {results}=await db.prepare(selection+' AND n.id>? ORDER BY n.id LIMIT 51').bind(after??'').all<Metadata>();
 const items=results.slice(0,50).map(validate);
 return {items,nextCursor:results.length>50?items.at(-1)!.id:null,
  notice:'Current consent metadata only; recheck each nomination before review. This queue is not a publication or license approval.'};
}
/** Hash privately, return metadata only. Never mount on a customer route or pass source to a model. */
export async function inspectNominationIntegrity(db:DB,id:string){
 if(!uuid.test(id))throw Error('Invalid nomination');
 const initial=await db.prepare(selection+' AND n.id=?').bind(id).first<Metadata>();
 if(!initial)throw Error('Nomination is not available for review');validate(initial);
 const source=await db.prepare(`SELECT v.source FROM backend_versions v JOIN backend_nominations n ON n.version_id=v.id
 JOIN projects p ON p.id=v.project_id WHERE n.id=? AND n.state='nominated' AND n.withdrawn_at IS NULL
 AND n.consent_at=? AND n.digest=? AND v.digest=n.digest AND p.owner_user_id=n.user_id`).bind(id,initial.consent_at,initial.digest).first<{source:string}>();
 if(!source||typeof source.source!=='string'||new TextEncoder().encode(source.source).length>8192)throw Error('Nomination is not available for review');
 const digest=await hashToken(source.source);
 if(digest!==initial.digest)throw Error('Nominated source integrity check failed');
 // Withdrawal or owner deletion during the read invalidates the inspection result.
 const current=await db.prepare(selection+' AND n.id=?').bind(id).first<Metadata>();
 if(!current||current.version_id!==initial.version_id||current.digest!==initial.digest||current.consent_at!==initial.consent_at)throw Error('Nomination changed during inspection');
 return {...validate(current),integrity:'verified_at_read',sharingAuthorized:false,
  pending:['human_source_review','synthetic_candidate','privacy_and_secret_screening','license_and_provenance','behavior_and_security_tests','maintainer_publication_review'],
  notice:'This point-in-time integrity result expires as evidence when consent changes. It neither screens the code nor grants permission to publish it.'};
}

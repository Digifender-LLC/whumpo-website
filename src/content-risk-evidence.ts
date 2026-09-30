import {assessContentRisk,type ContentRiskEvent,type ContentRiskHistory} from './content-risk';
type Evidence={id:string;userId:string;incidentId:string;kind:ContentRiskEvent['kind'];occurredAt:number;evidenceRef:string;reviewerRef:string};
const opaque=/^[a-zA-Z0-9_.:-]{1,128}$/;
function refs(...values:string[]){if(values.some(v=>typeof v!=='string'||!opaque.test(v)))throw Error('Invalid risk evidence reference');}
function equal(row:Record<string,unknown>|null,expected:Record<string,unknown>){return !!row&&Object.entries(expected).every(([k,v])=>row[k]===v);}
/** Trusted operator integration only. Never grant these methods to a customer or building agent.
 * References identify independently reviewed records; no raw content or credentials belong here. */
export async function recordContentRiskEvidence(db:D1Database,event:Evidence){
 refs(event.id,event.userId,event.incidentId,event.evidenceRef,event.reviewerRef);
 assessContentRisk({userId:event.userId,complete:false,events:[{...event,disposition:'active'}]});
 const expected={id:event.id,user_id:event.userId,incident_id:event.incidentId,kind:event.kind,occurred_at:event.occurredAt,evidence_ref:event.evidenceRef,reviewer_ref:event.reviewerRef};
 const read=()=>db.prepare('SELECT id,user_id,incident_id,kind,occurred_at,evidence_ref,reviewer_ref FROM content_risk_evidence WHERE id=? AND user_id=?').bind(event.id,event.userId).first<Record<string,unknown>>();
 const prior=await read();if(prior){if(!equal(prior,expected))throw Error('Conflicting risk evidence');return;}
 try{await db.prepare('INSERT INTO content_risk_evidence(id,user_id,incident_id,kind,occurred_at,evidence_ref,reviewer_ref) VALUES(?,?,?,?,?,?,?)').bind(...Object.values(expected)).run();}
 catch{if(!equal(await read(),expected))throw Error('Risk evidence not confirmed');}
}
export async function reverseContentRiskIncident(db:D1Database,userId:string,incidentId:string,evidenceRef:string,reviewerRef:string){
 refs(userId,incidentId,evidenceRef,reviewerRef);
 const expected={evidence_ref:evidenceRef,reviewer_ref:reviewerRef};
 const read=()=>db.prepare('SELECT evidence_ref,reviewer_ref FROM content_risk_reversals WHERE user_id=? AND incident_id=?').bind(userId,incidentId).first<Record<string,unknown>>();
 const prior=await read();if(prior){if(!equal(prior,expected))throw Error('Conflicting risk reversal');return;}
 try{await db.prepare('INSERT INTO content_risk_reversals(user_id,incident_id,evidence_ref,reviewer_ref) VALUES(?,?,?,?)').bind(userId,incidentId,evidenceRef,reviewerRef).run();}
 catch{if(!equal(await read(),expected))throw Error('Risk reversal not confirmed');}
}
/** All ages are read: unresolved critical cases must not disappear after 90 days.
 * Coverage stays incomplete until a verified ingestion/backfill workflow exists. */
export async function readContentRiskHistory(db:D1Database,userId:string,currentContentFlag=false):Promise<ContentRiskHistory>{
 refs(userId);if(typeof currentContentFlag!=='boolean')throw Error('Invalid current content flag');
 if(!await db.prepare('SELECT 1 AS present FROM users WHERE id=?').bind(userId).first())throw Error('Risk account unavailable');
 const result=await db.prepare(`SELECT e.incident_id AS incidentId,e.occurred_at AS occurredAt,e.kind,
 CASE WHEN r.incident_id IS NULL THEN 'active' ELSE 'overturned' END AS disposition
 FROM content_risk_evidence e LEFT JOIN content_risk_reversals r ON r.user_id=e.user_id AND r.incident_id=e.incident_id
 WHERE e.user_id=? ORDER BY e.id LIMIT 10001`).bind(userId).all<Omit<ContentRiskEvent,'userId'>>();
 if(!result.success||!Array.isArray(result.results)||result.results.length>10000)throw Error('Risk history unavailable');
 const history:ContentRiskHistory={userId,complete:false,currentContentFlag,events:result.results.map(e=>({...e,userId}))};
 assessContentRisk(history);return history;
}

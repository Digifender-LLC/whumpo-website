/** WH-145 minimal rule-approval store over the `rule_approvals` table (schema/platform.sql). Issue, read and count a use; nothing
 * calls it yet (the job runner, WH-069, and the review route are later). The schema guards bind the approval and keep the use
 * counter on the database clock; this module only issues the statements. The row converts to the `RuleApproval` that
 * `admitRuleAction` takes plus `usedThisPeriod`, so a caller reads, admits, then counts the use before dispatch. */
import type {RuleApproval} from './rule-authority';

export type RuleApprovalIssue=RuleApproval&{ownerId:string;ruleId:string;ruleRevision:number;providerId:string};
type Row={approval_id:string;rule_id:string;rule_revision:number;provider:string;operation_id:string;destination_digest:string;template_digest:string;credential_id:string;max_per_period:number;period_start:number;used_count:number;revoked_at:number|null};
const day=86400000;

/** Stores one approval for a rule revision and returns its id. A duplicate (owner, rule, revision) or a malformed field is
 * refused by the table (UNIQUE or CHECK); nothing is replaced. */
export async function issueRuleApproval(db:Pick<D1Database,'prepare'>,input:RuleApprovalIssue,now:number=Date.now()){
 const id=crypto.randomUUID();
 await db.prepare('INSERT INTO rule_approvals(approval_id,owner_id,rule_id,rule_revision,provider,operation_id,destination_digest,template_digest,credential_id,max_per_period,period_start,used_count,created_at,revoked_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?,0,0,?,NULL,1)')
  .bind(id,input.ownerId,input.ruleId,input.ruleRevision,input.providerId,input.operationId,input.destinationDigest,input.bodyTemplateDigest,input.credentialId,input.maxPerPeriod,now).run();
 return id;
}

/** The owner's unrevoked approval for a rule revision with today's use count (zero once the UTC day rolled over), or null. */
export async function readRuleApproval(db:Pick<D1Database,'prepare'>,ownerId:string,ruleId:string,ruleRevision:number,now:number=Date.now()){
 const r=await db.prepare('SELECT approval_id,rule_id,rule_revision,provider,operation_id,destination_digest,template_digest,credential_id,max_per_period,period_start,used_count,revoked_at FROM rule_approvals WHERE owner_id=? AND rule_id=? AND rule_revision=?')
  .bind(ownerId,ruleId,ruleRevision).first<Row>();
 if(!r||r.revoked_at!==null)return null;
 const approval:RuleApproval={operationId:r.operation_id,destinationDigest:r.destination_digest,bodyTemplateDigest:r.template_digest,maxPerPeriod:r.max_per_period,credentialId:r.credential_id};
 return {approvalId:r.approval_id,providerId:r.provider,approval,usedThisPeriod:r.period_start===Math.floor(now/day)*day?r.used_count:0};
}

/** Claims one use in a single statement: false when the approval is missing, revoked or at today's limit. The trigger repeats the
 * rule on the database clock, so two racing claims cannot pass the limit. */
export async function countRuleUse(db:Pick<D1Database,'prepare'>,ownerId:string,approvalId:string){
 const today='(unixepoch()*1000)/86400000*86400000';
 const r=await db.prepare(`UPDATE rule_approvals SET revision=revision+1,used_count=CASE WHEN period_start=${today} THEN used_count+1 ELSE 1 END,period_start=${today}
  WHERE approval_id=? AND owner_id=? AND revoked_at IS NULL AND (period_start!=${today} OR used_count<max_per_period)`).bind(approvalId,ownerId).run();
 return r.meta.changes===1;
}

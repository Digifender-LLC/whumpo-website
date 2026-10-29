/** WH-145 rule authority for connector actions (docs/connectors.md). Pure and unwired: no storage, clock, hashing, route,
 * job-runner (WH-069) or provider import. The caller derives the principal on the server, computes the digests with the
 * canonical digest, and counts claim-time uses; this module only decides. It binds an approval to
 * {operation, destination digest, template digest, limit, credential} and refuses any mismatch with the codes of the
 * reference runtime (tools/prototypes/connectors.mjs). A provider whose readiness is not `live-accepted` refuses. */
import {check,plain,type ConnectorCatalog} from './catalog';

export type RuleApproval={operationId:string;destinationDigest:string;bodyTemplateDigest:string;maxPerPeriod:number;credentialId:string};
export type RulePrincipal={kind:string;ownerId:string;ruleId?:string;ruleRevision?:number;jobDigest?:string;approval?:unknown};
export type RuleUse={providerId:string;operationId:string;destinationDigest:string;bodyTemplateDigest:string;credentialId:string;usedThisPeriod:number};

const text=(v:unknown)=>typeof v==='string'&&v.length>0;

/** Returns the approval when the rule may dispatch this exact use; otherwise throws ConnectorContractError. */
export function admitRuleAction(catalog:ConnectorCatalog,principal:RulePrincipal,use:RuleUse):RuleApproval {
 check(principal.kind==='rule','PRINCIPAL_FORBIDDEN',String(principal.kind));
 const provider=catalog.providers[use.providerId as keyof typeof catalog.providers];
 check(provider,'UNKNOWN_PROVIDER',use.providerId);
 const op=provider.operations[use.operationId];
 check(op,'UNKNOWN_OPERATION',use.operationId);
 check(op.kind==='action','RULE_READ_FORBIDDEN',use.operationId);
 check(op.authority.includes('approved-rule'),'OWNER_REQUEST_ONLY',use.operationId);
 const a=principal.approval as Record<string,unknown>|undefined;
 check(plain(a)&&text(principal.ruleId)&&Number.isSafeInteger(principal.ruleRevision)&&text(principal.jobDigest)
  &&text(a.operationId)&&text(a.destinationDigest)&&text(a.bodyTemplateDigest)&&text(a.credentialId)
  &&Number.isSafeInteger(a.maxPerPeriod)&&(a.maxPerPeriod as number)>=1,'RULE_APPROVAL_REQUIRED',use.operationId);
 check(provider.readiness==='live-accepted','ADAPTER_NOT_ACCEPTED',use.providerId);
 check(a.operationId===use.operationId&&a.destinationDigest===use.destinationDigest&&a.bodyTemplateDigest===use.bodyTemplateDigest,'RULE_DESTINATION_MISMATCH',use.operationId);
 check(a.credentialId===use.credentialId,'RULE_CREDENTIAL_MISMATCH',use.operationId);
 check(Number.isSafeInteger(use.usedThisPeriod)&&use.usedThisPeriod>=0&&use.usedThisPeriod<(a.maxPerPeriod as number),'RULE_LIMIT',use.operationId);
 return a as RuleApproval;
}

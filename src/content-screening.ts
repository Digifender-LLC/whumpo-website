import {assessContentRisk, contentRiskPolicyVersion, type ContentRiskHistory} from './content-risk';

export type ScreeningTarget = {
  userId: string;
  /** SHA-256 of the exact normalized content AND all action-relevant context. */
  digest: string;
  kind: 'chat_text' | 'generated_artifact' | 'media' | 'imported_code';
};
const encoder = new TextEncoder();

/** Internal planning only. No result from this function grants publication or execution.
 * Use a dedicated secret, never a customer/model-selected seed. Persist selected checks
 * before acting; risk decreases/key rotation must never cancel an outstanding check. */
export async function planContentScreening(
  history: ContentRiskHistory,
  target: ScreeningTarget,
  samplingKey: string | undefined,
  now = Date.now(),
) {
  if (!target || target.userId !== history.userId || !/^[a-f0-9]{64}$/.test(target.digest) || !['chat_text','generated_artifact','media','imported_code'].includes(target.kind)) throw Error('Invalid screening target');
  const risk = assessContentRisk(history,now);
  const result = (required: boolean, reason: 'mandatory_format'|'risk_or_missing_history'|'sample_selected'|'not_sampled'|'sampling_unavailable', percent: number) => ({
    policy:contentRiskPolicyVersion, userId:target.userId, digest:target.digest, kind:target.kind,
    required, reason, percent, riskScore:risk.score,
    permissionGranted:false as const,
  });
  if (target.kind === 'media' || target.kind === 'imported_code') return result(true,'mandatory_format',100);
  const percent = target.kind === 'chat_text' ? risk.supplementalTextScanPercent : risk.generatedArtifactScanPercent;
  if (percent === 100) return result(true,'risk_or_missing_history',100);
  if (typeof samplingKey !== 'string' || !/^[a-f0-9]{64}$/.test(samplingKey)) return result(true,'sampling_unavailable',100);
  try {
    const bytes = Uint8Array.from(samplingKey.match(/../g)!,x=>parseInt(x,16));
    const key = await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
    // No request ID or timestamp: repeating exact work with a new ID cannot reroll it.
    // Structured encoding prevents delimiter ambiguity; the domain separates other HMAC uses.
    const message = JSON.stringify(['whumpo-supplemental-screening-v1',contentRiskPolicyVersion,target.userId,target.kind,target.digest]);
    const signature = await crypto.subtle.sign('HMAC',key,encoder.encode(message));
    const bucket = new DataView(signature).getUint32(0,false);
    const required = bucket < Math.floor(2 ** 32 * percent / 100);
    return result(required,required?'sample_selected':'not_sampled',percent);
  } catch {
    return result(true,'sampling_unavailable',100);
  }
}

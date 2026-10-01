/** Remove only unused platform proof records; provider operations/history are retained. */
export async function domainProofRemoval(db:D1Database,user:string,turn:string,command:string){
 const [verb,id,...extra]=command.split(/\s+/);
 if(!['/remove-domain-proof','/confirm-domain-proof-remove'].includes(verb))return;
 const result=(reply:string,statements:D1PreparedStatement[]=[])=>({reply,statements});
 if(extra.length||!id||!/^[0-9a-f-]{36}$/.test(id))return result("Choose an unused saved domain ownership proof to review its removal.");
 if(verb==='/confirm-domain-proof-remove'){
  const review=await db.prepare('SELECT r.status,r.expires_at,r.hostname FROM domain_proof_removals r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.user_id=? AND p.owner_user_id=?').bind(id,user,user).first<{status:string;expires_at:string;hostname:string}>();
  if(!review)return result('Domain proof removal review not found.');
  if(review.status==='applied')return result('That ownership proof was already removed. External DNS records are unchanged.');
  if(review.expires_at<=new Date().toISOString())return result("This removal review expired. Ask for a fresh domain-proof removal review.");
  return result(`Removed the unused ownership proof for ${review.hostname}. No domain registration, DNS record or hosting service was changed. You can add this hostname again with a fresh proof.`,[db.prepare("UPDATE domain_proof_removals SET status='applied',confirmed_by=? WHERE id=? AND user_id=? AND status='pending' AND EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)").bind(turn,id,user,turn,user)]);
 }
 const claim=await db.prepare('SELECT d.*,EXISTS(SELECT 1 FROM domain_connections WHERE claim_id=d.id) OR EXISTS(SELECT 1 FROM cloudflare_dns_actions WHERE claim_id=d.id) AS retained FROM domain_claims d JOIN projects p ON p.id=d.project_id WHERE d.id=? AND p.owner_user_id=?').bind(id,user).first<{id:string;project_id:string;hostname:string;token:string;expires_at:string;retained:number}>();
 if(!claim)return result("Domain ownership proof not found. Ask to list your saved proofs.");
 if(claim.retained)return result("This proof is retained for hosting or Cloudflare DNS review and recovery history. Ask to inspect those saved operations; removing a proof cannot discard their recovery records.");
 return result(`Remove the unused ownership proof for ${claim.hostname}?\n\nOnly the saved Whumpo proof will be removed, freeing a domain-proof slot. Your registration, website, and external DNS records stay unchanged. Any TXT record you added manually will remain at your DNS provider. Adding this hostname again requires a fresh proof.\n\nNothing changes until you use this review’s confirmation button within 10 minutes.`,[db.prepare('INSERT INTO domain_proof_removals(id,user_id,project_id,claim_id,hostname,proof_token,proof_expires_at,expires_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(turn,user,claim.project_id,claim.id,claim.hostname,claim.token,claim.expires_at,new Date(Date.now()+600000).toISOString(),turn,user)]);
}

// Synthetic owner clients echo the exact saved review and explicit price. Production has no fallback.
export function withConnectorConfirmations(m){
 const methods={...m};
 if(m.confirmBackup)methods.confirmBackup=async(...args)=>{
  const row=(await m.listBackups(args[0],args[2])).backups.find(r=>r.id===args[3]);
  args[6]??=row?{reviewDigest:row.connector.reviewDigest,acceptedPrice:row.connector.price}:undefined;
  return m.confirmBackup(...args);
 };
 if(m.confirmDNS)methods.confirmDNS=async(...args)=>{
  const row=(await m.listDNSActions(args[0],args[1])).actions.find(r=>r.id===args[2]);
  args[6]??=row?{reviewDigest:row.connector.reviewDigest,acceptedPrice:row.connector.price}:undefined;
  return m.confirmDNS(...args);
 };
 return methods;
}
export async function connectorConfirmationCommand(db,command){
 const match=/^\/(confirm-backup|confirm-dns) ([0-9a-f-]{36})$/.exec(command);if(!match)return command;
 const table=match[1]==='confirm-backup'?'github_backups':'cloudflare_dns_actions';
 const row=await db.prepare(`SELECT review_digest,price_json FROM ${table} WHERE id=?`).bind(match[2]).first();
 return command+' '+(row?.review_digest??'0'.repeat(64))+' 0 plan-inclusion';
}

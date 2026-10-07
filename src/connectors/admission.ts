import {isActiveConnectorProvider,type ActiveConnectorProvider} from '../connector-catalog';
import {ConnectionError} from '../github-connection';
/** Exact captured credential, independently repeated inside consent and dispatch statements.
 * Future providers register a source-owned predicate when their adapter is implemented. */
export function connectorCredentialPredicate(provider:ActiveConnectorProvider,user:string,id:string|null=null){
 if(!isActiveConnectorProvider(provider))throw new ConnectionError(503,'This connector is not configured.');
 if(provider==='github')return {sql:"EXISTS(SELECT 1 FROM github_connections c JOIN github_token_vault t ON t.id=c.active_token_id AND t.user_id=c.user_id WHERE c.user_id=? AND (? IS NULL OR t.id=?) AND t.state='active' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",params:[user,id,id]};
 return {sql:"EXISTS(SELECT 1 FROM cloudflare_token_vault t WHERE t.user_id=? AND (? IS NULL OR t.id=?) AND t.state='active' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",params:[user,id,id]};
}
export async function connectorCredentialId(db:D1Database,user:string,provider:ActiveConnectorProvider){
 const gate=connectorCredentialPredicate(provider,user);
 const row=provider==='github'?await db.prepare(`SELECT c.active_token_id id FROM github_connections c WHERE c.user_id=? AND ${gate.sql}`).bind(user,...gate.params).first<{id:string}>():await db.prepare(`SELECT t.id FROM cloudflare_token_vault t WHERE t.user_id=? AND t.state='active' AND ${gate.sql}`).bind(user,...gate.params).first<{id:string}>();
 if(!row)throw new ConnectionError(401,'Connect this provider before preparing a lookup.');return row.id;
}

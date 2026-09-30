// Fixed, reviewed SQL only. due_at means eligible since, not customer content.
const daily=25*3600000;
const queue=(table,predicate,column,threshold= daily)=>({sql:`SELECT ${column??'NULL'} AS due_at FROM ${table} WHERE ${predicate}`,threshold});
const expiry=table=>queue(table,'expires_at<=?1','expires_at');
const date=(column,modifier)=>`strftime('%Y-%m-%dT%H:%M:%fZ',${column},'${modifier}')`;
const aged=(table,column,modifier)=>queue(table,`${date(column,modifier)}<=?1`,date(column,modifier));
const healthMatch=`h.project_id=p.id AND h.publication_revision=s.revision AND h.contact_revision=COALESCE(c.revision,-1) AND h.form_review_id IS (SELECT id FROM backend_live_forms WHERE project_id=p.id)`;
export const backlogInventory={
 imports:queue('backend_imports',"state='pending'",'created_at',3600000),
 photos:queue('file_cleanup','1=1','created_at'),
 github:queue('github_token_vault t LEFT JOIN github_revocation_health h ON h.token_id=t.id',"t.state='revoking'",'h.requested_at'),
 cloudflare:queue('cloudflare_token_vault t LEFT JOIN cloudflare_revocation_health h ON h.token_id=t.id',"t.state='revoking'",'h.requested_at'),
 legacy_ai:queue('usage_operations',"status IN ('reserved','dispatched','uncertain')",'updated_at',600000),
 standard_ai:queue('standard_ai_requests',"state IN ('reserved','dispatched','uncertain')",'updated_at',600000),
 fair_use:aged('fair_use_project_lifecycle','removed_at','+90 days'),
 traffic:aged('site_traffic_daily','day','+30 days'),
 app_migration_documents:queue('app_migration_documents','NOT EXISTS(SELECT 1 FROM app_migration_current c WHERE c.id=migration_id)',null),
 app_owner_erasures:expiry('app_owner_erasures'),
 app_deletion_receipts:expiry('app_deletion_receipts'),
 app_usage:aged('app_daily_usage','day','+36 days'),
 contact_submissions:expiry('contact_submissions'),
 contact_receipts:expiry('contact_receipts'),
 github_oauth:expiry('github_oauth_states'),
 github_expired_tokens:expiry('github_token_vault'),
 cloudflare_oauth:expiry('cloudflare_oauth_states'),
 cloudflare_expired_tokens:expiry('cloudflare_token_vault'),
 cloudflare_staged:queue('cloudflare_token_vault',`state='staged' AND ${date('created_at','+2 minutes')}<=?1`,date('created_at','+2 minutes')),
 hosting_refresh:queue('domain_connections',"state IN ('active','provisioning','disconnecting')",'checked_at',2*3600000),
 hosting_unknown:queue('domain_connections',"state IN ('creating','uncertain')",'created_at',600000),
 health_due:{sql:`SELECT ${date(`(SELECT MAX(h.started_at) FROM site_health_checks h WHERE ${healthMatch})`,'+6 hours')} AS due_at FROM projects p JOIN publications s ON s.project_id=p.id AND s.version_id IS NOT NULL LEFT JOIN contact_settings c ON c.project_id=p.id WHERE NOT EXISTS(SELECT 1 FROM site_health_checks h WHERE ${healthMatch} AND h.started_at>${date('?1','-6 hours')})`,threshold:2*3600000},
 health_checking:queue('site_health_checks',"state='checking'",'started_at',900000),
 health_retention:aged('site_health_checks','started_at','+30 days'),
 health_budget:aged('site_health_budget','day','+63 days'),
 backup_unknown:queue('github_backups',"state IN ('dispatching','uncertain')",'dispatched_at',600000),
 dns_unknown:queue('cloudflare_dns_actions',"state IN ('sending','uncertain')",'created_at',600000),
};
export const operationInventory={
 legacy_ai:{table:'usage_operations',state:'status',states:['reserved','dispatched','uncertain'],time:'updated_at',guide:'docs/usage-recovery.md'},
 standard_ai:{table:'standard_ai_requests',state:'state',states:['reserved','dispatched','uncertain'],time:'updated_at',guide:'docs/standard-ai-accounting.md'},
 hosting:{table:'domain_connections',state:'state',states:['creating','uncertain','disconnecting','provisioning'],time:'created_at',guide:'docs/integrations/domain-hosting.md'},
 backups:{table:'github_backups',state:'state',states:['dispatching','uncertain'],time:'dispatched_at',guide:'docs/integrations/github-backups.md'},
 dns:{table:'cloudflare_dns_actions',state:'state',states:['sending','uncertain'],time:'created_at',guide:'docs/integrations/cloudflare-dns.md'},
};

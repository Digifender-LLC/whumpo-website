// Fixed, reviewed SQL only. due_at means eligible since, not customer content.
const daily=25*3600000;
const queue=(table,predicate,column,threshold= daily)=>({sql:`SELECT ${column??'NULL'} AS due_at FROM ${table} WHERE ${predicate}`,threshold});
const expiry=table=>queue(table,'expires_at<=?1','expires_at');
const date=(column,modifier)=>`strftime('%Y-%m-%dT%H:%M:%fZ',${column},'${modifier}')`;
const aged=(table,column,modifier)=>queue(table,`${date(column,modifier)}<=?1`,date(column,modifier));
const healthMatch=`h.project_id=p.id AND h.publication_revision=s.revision AND h.contact_revision=COALESCE(c.revision,-1) AND h.form_review_id IS (SELECT id FROM backend_live_forms WHERE project_id=p.id)`;
export const backlogInventory={
 chat_drafts:queue('chat_interactions',`removed_at IS NULL AND state!='submitted' AND ${date('COALESCE(draft_saved_at,created_at)','+7 days')}<=?1`,date('COALESCE(draft_saved_at,created_at)','+7 days'),2*3600000),
 connection_exchanges:queue('connection_oauth_exchanges',"state='dispatched'",'created_at',600000),
 imports:queue('backend_imports',"state='pending'",'created_at',3600000),
 // WH-132: objects/rows retained by an active preservation hold are intentionally not backlog.
 photos:queue('file_cleanup',"NOT EXISTS(SELECT 1 FROM safety_preservation_holds h WHERE h.released_at IS NULL AND ((h.scope='account' AND h.subject_user_id=file_cleanup.owner_user_id) OR (h.scope='project' AND h.project_id=file_cleanup.project_id)))",'created_at'),
 github:queue('github_token_vault t LEFT JOIN github_revocation_health h ON h.token_id=t.id',"t.state='revoking'",'h.requested_at'),
 cloudflare:queue('cloudflare_token_vault t LEFT JOIN cloudflare_revocation_health h ON h.token_id=t.id',"t.state='revoking'",'h.requested_at'),
 standard_ai:queue('standard_ai_requests',"state IN ('reserved','dispatched','uncertain')",'updated_at',600000),
 fair_use:aged('fair_use_project_lifecycle','removed_at','+90 days'),
 traffic:queue('site_traffic_daily',`${date('day','+30 days')}<=?1 AND project_id NOT IN (SELECT project_id FROM safety_held_projects)`,date('day','+30 days')),
 traffic_quality:queue('site_traffic_quality',`${date('day','+30 days')}<=?1 AND project_id NOT IN (SELECT project_id FROM safety_held_projects)`,date('day','+30 days')),
 public_clients:aged('public_client_usage','day','+2 days'),
 app_migration_documents:queue('app_migration_documents','NOT EXISTS(SELECT 1 FROM app_migration_current c WHERE c.id=migration_id)',null),
 app_owner_erasures:expiry('app_owner_erasures'),
 app_deletion_receipts:expiry('app_deletion_receipts'),
 app_deletion_reviews:expiry('app_deletion_reviews'),
 app_usage:aged('app_daily_usage','day','+36 days'),
 contact_submissions:queue('contact_submissions','expires_at<=?1 AND project_id NOT IN (SELECT project_id FROM safety_held_projects)','expires_at'),
 guest_previews:queue('guest_preview_links l',"coalesce(l.revoked_at,l.expires_at)+2592000<=unixepoch(?1) AND NOT EXISTS(SELECT 1 FROM guest_preview_feedback f WHERE f.link_id=l.id)","strftime('%Y-%m-%dT%H:%M:%fZ',coalesce(l.revoked_at,l.expires_at)+2592000,'unixepoch')"),
 contact_receipts:expiry('contact_receipts'),
 github_oauth:expiry('github_oauth_states'),
 github_staged:expiry('github_token_staging'),
 github_refresh_grants:queue('github_refresh_custody r JOIN github_token_vault t ON t.id=r.token_id LEFT JOIN github_revocation_health h ON h.token_id=t.id',"t.state='revoking'",'COALESCE(r.access_revoked_at,h.requested_at)'),
 github_grant_unknown:queue('github_grant_revocations',"state IN ('dispatching','uncertain')",'dispatched_at',600000),
 github_expired_tokens:queue('github_token_vault',"expires_at<=?1 AND NOT EXISTS(SELECT 1 FROM github_refresh_custody WHERE token_id=github_token_vault.id)",'expires_at'),
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
 // Internal attention thresholds only: they promise customers no response time.
 support_open:queue('usage_review_requests',"state='open'",'created_at',3*daily),
 support_delivery:queue('support_deliveries',"state='queued'",'next_attempt_at',3600000),
};
export const operationInventory={
 standard_ai:{table:'standard_ai_requests',state:'state',states:['reserved','dispatched','uncertain'],time:'updated_at',guide:'docs/standard-ai-accounting.md'},
 hosting:{table:'domain_connections',state:'state',states:['creating','uncertain','disconnecting','provisioning'],time:'created_at',guide:'docs/integrations/domain-hosting.md'},
 backups:{table:'github_backups',state:'state',states:['dispatching','uncertain'],time:'dispatched_at',guide:'docs/integrations/github-backups.md'},
 dns:{table:'cloudflare_dns_actions',state:'state',states:['sending','uncertain'],time:'created_at',guide:'docs/integrations/cloudflare-dns.md'},
};
// WH-050 F8 / runbook G1: shared platform counters against the ceilings their admission triggers enforce.
// ?1 is the observation instant. `evidence` must appear in `enforcedBy`'s current schema SQL (tests check for drift).
// Read-only and pull-based: nothing here delivers an alert; alert delivery stays owner-gated.
export const counterThresholds=Object.freeze({warn:0.5,act:0.8});
const day="strftime('%Y-%m-%d',?1)",month="strftime('%Y-%m',?1)";
export const platformCounterInventory={
 public_backend_calls:{sql:`SELECT coalesce(sum(calls),0) AS used FROM backend_public_usage WHERE day=${day}`,ceiling:1000,window:'UTC day',enforcedBy:'backend_public_usage_insert',evidence:'sum(calls) FROM backend_public_usage WHERE day=NEW.day),0)>=1000',note:'Account fair share starts at 50%.'},
 visitor_transitions:{sql:`SELECT coalesce(sum(attempts),0) AS used FROM app_daily_usage WHERE day=${day}`,ceiling:1000,window:'UTC day',enforcedBy:'app_run_admit',evidence:'sum(attempts) FROM app_daily_usage WHERE day=NEW.day),0)>=1000',note:'Account fair share starts at 50%.'},
 contact_receipts:{sql:'SELECT count(*) AS used FROM contact_receipts',ceiling:1000,window:'retained',enforcedBy:'contact_submission_guard',evidence:'(SELECT COUNT(*) FROM contact_receipts)>=1000',note:'Account fair share starts at 50%.'},
 r2_reads:{sql:`SELECT coalesce((SELECT read_ops FROM storage_usage WHERE period=${month}),0) AS used`,ceiling:100000,window:'UTC month',enforcedBy:'storage_usage',evidence:'read_ops BETWEEN 0 AND 100000',note:'Public photo account fair share starts at 50%.'},
 r2_writes:{sql:`SELECT coalesce((SELECT write_ops FROM storage_usage WHERE period=${month}),0) AS used`,ceiling:10000,window:'UTC month',enforcedBy:'storage_usage',evidence:'write_ops BETWEEN 0 AND 10000'},
 visitor_runs:{sql:'SELECT count(*) AS used FROM app_runs',ceiling:10000,window:'retained',enforcedBy:'app_run_admit',evidence:'(SELECT count(*) FROM app_runs)>=10000'},
 visitor_sessions:{sql:'SELECT count(*) AS used FROM app_sessions',ceiling:5000,window:'retained',enforcedBy:'app_session_admit',evidence:'(SELECT count(*) FROM app_sessions)>=5000'},
 visitors:{sql:'SELECT count(*) AS used FROM app_visitors',ceiling:1000,window:'retained',enforcedBy:'app_visitor_admit',evidence:'(SELECT count(*) FROM app_visitors)>=1000'},
 owner_backend_runs:{sql:`SELECT count(*) AS used FROM backend_runs WHERE day=${day}`,ceiling:1000,window:'UTC day',enforcedBy:'backend_runs_quota',evidence:'(SELECT count(*) FROM backend_runs WHERE day=NEW.day)>=1000'},
 owner_backend_runs_retained:{sql:'SELECT count(*) AS used FROM backend_runs',ceiling:5000,window:'retained',enforcedBy:'backend_runs_quota',evidence:'(SELECT count(*) FROM backend_runs)>=5000'},
 photo_files:{sql:'SELECT (SELECT count(*) FROM project_files)+(SELECT count(*) FROM file_cleanup) AS used',ceiling:500,window:'retained',enforcedBy:'project_file_cleanup_capacity',evidence:'(SELECT COUNT(*) FROM project_files)+(SELECT COUNT(*) FROM file_cleanup)>=500'},
 operator_containments:{sql:'SELECT count(*) AS used FROM operator_containments',ceiling:10000,window:'retained',enforcedBy:'operator_containment_admit',evidence:'(SELECT count(*) FROM operator_containments)>=10000',note:'Containment audit rows are never deleted; at the ceiling new containment fails closed.'},
};

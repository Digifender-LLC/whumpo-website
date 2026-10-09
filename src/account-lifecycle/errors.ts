/** WH-018 account lifecycle refusal: a typed status and code the owner route returns as JSON (http.ts). Kept apart from
 * closure.ts so the export review and section readers do not import the closure engine. */
export class AccountLifecycleError extends Error{
 constructor(readonly status:400|404|409|413|503,readonly code:'invalid_request'|'not_found'|'stale_review'|'request_conflict'|'action_required'|'closure_exists'|'closure_unavailable'|'bundle_too_large',message:string){super(message);this.name='AccountLifecycleError';}
}

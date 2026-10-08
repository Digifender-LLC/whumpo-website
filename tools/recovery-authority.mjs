import {inspectSchema,currentSchemaArtifact} from './current-schema.mjs';
import {workerOrder,same} from './release-manifest.mjs';

// WH-008 recovery SOURCE authority. The only database a recovery point or restore
// evidence may be read from is the one bound as `DB` to the active platform Worker
// while apps and sites are bound to that same database. It is derived from the
// release provider's own read-only observation of the account (the same observer the
// journaled release uses) and from the database the provider itself opens, never from
// a caller-supplied adapter, account or identifier.
//
// What this proves: each observation (and a bracketing pair around a read) saw the
// same Worker versions, the same single `DB` binding, the same account scope and the
// exact current schema in the opened database. What it does NOT prove: that nothing
// changed BETWEEN two observations (a binding moved and moved back, or a rollback to
// an earlier Worker version, is invisible), or that the read itself was not racing a
// write. There is no monotonic generation or write fence to bind a read to. See
// docs/disaster-recovery.md. Nothing here grants restore, serving or activation.
export class DrillHold extends Error{constructor(code){super('Recovery drill step held: '+code);this.code=code;}}
const hold=(value,code)=>{if(!value)throw new DrillHold(code);};
const account=v=>typeof v==='string'&&/^[0-9a-f]{32}$/.test(v);
// The D1 database id format the release observer and the repository configuration use: a lowercase UUID.
const database=v=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const bound=['apps','sites','platform'];
const states=new WeakMap();
const unobservable=new Set(['source-observation','source-database']);

// The exact current contract: each of apps, sites and platform binds exactly ONE D1
// database, named `DB`, with a lowercase UUID id and no other field (the observer's
// own summary shape). A duplicate, an extra database, a renamed binding or a
// malformed id is not interpreted: it refuses, so a list that merely contains the
// right entry cannot pass. `empty` is the hold for a role with no `DB` binding.
function singleBinding(databases,empty){
 hold(Array.isArray(databases),'source-observation');
 hold(databases.every(d=>d&&typeof d==='object'&&!Array.isArray(d)),'source-binding-invalid');
 hold(databases.some(d=>d.binding==='DB'),empty);
 hold(databases.length===1,'source-binding-invalid');
 const [only]=databases;
 hold(Object.keys(only).length===2&&database(only.id),'source-binding-invalid');
 return only.id;
}

// Observation of the Worker bindings. Throws the fixed hold code for every shape that
// is not one platform-bound database shared by apps, sites and platform.
async function observeBinding(state){
 let observed;
 try{observed=await state.observe();}catch{throw new DrillHold('source-observation');}
 const workers=observed?.workers;hold(workers&&typeof workers==='object','source-observation');
 for(const role of bound)hold(workers[role]&&typeof workers[role].id==='string','source-observation');
 const selected=singleBinding(workers.platform.databases,'source-binding-missing');
 // Authority is split while a cutover is mid-flight: visitor writes follow the new
 // database, owner and authority reads follow the old one. Neither side is chosen.
 for(const role of ['apps','sites'])hold(singleBinding(workers[role].databases,'source-binding-mixed')===selected,'source-binding-mixed');
 return {databaseId:selected,versions:Object.fromEntries(bound.map(role=>[role,workers[role].id]))};
}
async function observeSchema(state,db){
 let actual;try{actual=await inspectSchema(db);}catch{throw new DrillHold('source-database');}
 // The schema comes from the database actually opened for the platform binding. The
 // provider's own `schema` result describes the CONFIGURED database, which differs
 // from the bound one during a prepared or interrupted cutover, and is ignored.
 hold(same(actual,state.expected),'source-schema');
 return actual;
}

/** Open the recovery source authority through a trusted release provider
 * (`releaseProvider()`: read-only `observe()` without a manifest, `openDatabase()`,
 * account and client provenance). Refuses with a fixed hold code unless the
 * platform-bound database is the single database for apps, sites and platform,
 * belongs to the provider's account scope, can be read, and has the exact current
 * schema. The returned authority is frozen and unforgeable. */
export async function observeRecoveryAuthority({provider,...unknown}={}){
 hold(Object.keys(unknown).length===0,'source-input');
 hold(provider&&typeof provider.observe==='function'&&typeof provider.openDatabase==='function'&&provider.configs&&typeof provider.configs==='object'&&['account-client','injected-client'].includes(provider.apiOrigin)&&account(provider.accountId),'source-provider');
 // Every Worker configuration the observer uses must name the provider's account.
 // The observer and the opened database share the provider's account-scoped client.
 for(const role of workerOrder)hold(provider.configs[role]?.account_id===provider.accountId,'source-account');
 const state={observe:provider.observe.bind(provider),accountId:provider.accountId,provenance:provider.apiOrigin};
 let artifact;try{artifact=await currentSchemaArtifact();}catch{throw new DrillHold('source-schema');}
 state.expected=artifact.expected;
 const binding=await observeBinding(state);
 let db;try{db=await provider.openDatabase(binding.databaseId);}catch{throw new DrillHold('source-database');}
 hold(db&&typeof db.prepare==='function'&&typeof db.batch==='function','source-database');
 const schema=await observeSchema(state,db);
 const pin=Object.freeze({databaseId:binding.databaseId,versions:Object.freeze(binding.versions),schemaSha256:schema.sha256});
 const authority=Object.freeze({
  version:1,scope:'recovery-source-authority',provenance:state.provenance,accountId:state.accountId,databaseId:pin.databaseId,
  versions:pin.versions,schema:Object.freeze({sqlSha256:artifact.sqlSha256,objectsSha256:schema.sha256,objects:schema.objects}),
 });
 states.set(authority,{...state,db,pin});
 return authority;
}

export const isRecoveryAuthority=value=>typeof value==='object'&&value!==null&&states.has(value);
/** The opened source database capability; exists only for a real authority. */
export function recoveryAuthorityDatabase(authority){hold(isRecoveryAuthority(authority),'source-not-authority');return states.get(authority).db;}

/** Observe again and require exactly the pinned database, Worker versions and schema.
 * Used before and after a read: it proves the endpoints, not the interval between. */
export async function reobserveRecoveryAuthority(authority){
 hold(isRecoveryAuthority(authority),'source-not-authority');
 const state=states.get(authority);let binding,schema;
 try{
  binding=await observeBinding(state);
  // A different bound database would have been read through the pinned adapter, which
  // still points at the original one; compare the observed binding before the schema.
  hold(binding.databaseId===state.pin.databaseId,'source-binding-changed');
  schema=await observeSchema(state,state.db);
 }catch(error){
  if(error instanceof DrillHold&&unobservable.has(error.code))throw error;
  throw new DrillHold('source-binding-changed');
 }
 hold(same({databaseId:binding.databaseId,versions:binding.versions,schemaSha256:schema.sha256},state.pin),'source-binding-changed');
}
